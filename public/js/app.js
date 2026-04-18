import { db, auth, googleProvider } from './firebase-config.js';
import {
    collection,
    addDoc,
    onSnapshot,
    query,
    where,
    limit,
    orderBy,
    doc,
    getDoc,
    updateDoc,
    getDocs,
    serverTimestamp,
    startAfter
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
    signInWithPopup,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { NetworkMonitor } from './network-monitor.js';


// Global Exports for inline onclick handlers
window.navigateTo = navigateTo;
window.updateNavActive = updateNavActive;
window.openPwaModal = openPwaModal;
window.closePwaModal = closePwaModal;

let deferredPrompt = null;

let currentUser = null;
let currentView = 'welcome-view';
let lastView = 'welcome-view';
let pendingRequestBookId = null;

const LANGUAGE_MAP = {
    '1': 'Malayalam',
    '2': 'English',
    '3': 'Hindi'
};

function getLanguageName(lang) {
    if (!lang) return 'English';
    const langStr = String(lang);
    return LANGUAGE_MAP[langStr] || langStr;
}

let libraryData = {
    books: [],
    requests: [],
    member: null,
    isLoading: true,
    errorMessage: null,
    lastVisible: null,
    hasMore: true,
    currentGenre: 'All',
    isNextPageLoading: false,
    searchType: 'title'
};

// DOM Elements (Initialized in initApp)
let views = null;
let headerTitle = null;
let navItems = null;

export function initApp() {
    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js')
                .then(reg => console.log('[PWA] Service Worker registered:', reg.scope))
                .catch(err => console.log('[PWA] Service Worker failed:', err));
        });
    }

    // Initialize Network Monitor
    new NetworkMonitor();


    // Populate DOM references
    views = document.querySelectorAll('.view');
    headerTitle = document.getElementById('header-title');
    navItems = document.querySelectorAll('.nav-item');

    // Monitor Auth State
    onAuthStateChanged(auth, (user) => {
        if (user) {
            currentUser = {
                uid: user.uid,
                name: user.displayName,
                email: user.email,
                photo: user.photoURL
            };
            closeAuthModal();
        } else {
            currentUser = null;
        }

        setupFirestoreListeners();

        if (currentView === 'my-books-view') renderMyBooksView();
        if (currentView === 'membership-view') renderMembershipView();
        if (currentView === 'library-view') renderLibraryView();
    });

    setupEventListeners();
    navigateTo('welcome-view');

    // Trigger PWA prompt if applicable
    checkPwaStatus();
}

function checkPwaStatus(isManual = false) {
    // Check if already in standalone mode
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    
    // Update manual button visibility
    const manualBtn = document.getElementById('manual-install-btn');
    if (manualBtn) {
        manualBtn.style.display = (!isStandalone && (isManual || deferredPrompt || /iPad|iPhone|iPod/.test(navigator.userAgent))) ? 'flex' : 'none';
        if (window.lucide) lucide.createIcons();
    }

    if (isStandalone) return;

    if (!isManual) {
        // Check if dismissed recently (skip for 48 hours)
        const lastPrompt = localStorage.getItem('pwa_prompt_dismissed');
        if (lastPrompt) {
            const hoursAgo = (Date.now() - parseInt(lastPrompt)) / (1000 * 60 * 60);
            if (hoursAgo < 48) return;
        }
    }

    // Show after 4 seconds for better engagement, or immediately if manual
    const delay = isManual ? 0 : 4000;
    setTimeout(() => {
        // iOS Detection
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        if (isIOS) {
            openPwaModal('ios');
        } else if (deferredPrompt) {
            openPwaModal('android');
        } else if (isManual) {
            // If manual but no prompt yet, maybe it's not supported or not ready
            showAlertModal("Installation is not supported on this browser or the app is already installed.", "Notice", "info");
        }
    }, delay);
}

window.checkPwaStatus = checkPwaStatus; // Export for inline onclick

window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent Chrome 67 and earlier from automatically showing the prompt
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt = e;
    
    // If user is already on welcome view, maybe show it soon
    if (currentView === 'welcome-view') {
        checkPwaStatus();
    }
});

function openPwaModal(type) {
    const modal = document.getElementById('pwa-install-modal');
    if (!modal) return;

    const androidContent = document.getElementById('pwa-android-content');
    const iosContent = document.getElementById('pwa-ios-content');

    if (type === 'ios') {
        androidContent.style.display = 'none';
        iosContent.style.display = 'block';
    } else {
        androidContent.style.display = 'block';
        iosContent.style.display = 'none';
        
        const installBtn = document.getElementById('pwa-install-btn');
        if (installBtn) {
            installBtn.onclick = async () => {
                if (!deferredPrompt) return;
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                if (outcome === 'accepted') {
                    console.log('User accepted the A2HS prompt');
                    closePwaModal();
                }
                deferredPrompt = null;
            };
        }
    }

    modal.style.display = 'flex';
    if (window.lucide) lucide.createIcons();
}

function closePwaModal() {
    const modal = document.getElementById('pwa-install-modal');
    if (modal) modal.style.display = 'none';
    localStorage.setItem('pwa_prompt_dismissed', Date.now().toString());
}


function updateNavActive(targetId) {
    navItems.forEach(item => {
        item.classList.toggle('active', item.dataset.target === targetId);
    });
}

function showAuthLoading() {
    const modal = document.getElementById('auth-loading-modal');
    if (modal) modal.style.display = 'flex';
}

function hideAuthLoading() {
    const modal = document.getElementById('auth-loading-modal');
    if (modal) modal.style.display = 'none';
}

function setupFirestoreListeners() {
    // Initial fetch: Load first 10 books
    fetchBooksBatch();

    // Listen for requests (user specific if logged in)
    if (currentUser) {
        // Query by email and uid for redundancy/transition
        const q = query(collection(db, "requests"), where("userEmail", "==", currentUser.email));
        onSnapshot(q, (snapshot) => {
            libraryData.requests = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            if (currentView === 'library-view') renderLibraryView();
            if (currentView === 'my-books-view') renderMyBooksView();
        });

        // Listen for membership (user specific)
        const memQuery = query(collection(db, "members"), where("email", "==", currentUser.email), limit(1));
        onSnapshot(memQuery, (snapshot) => {
            if (!snapshot.empty) {
                const docSnap = snapshot.docs[0];
                libraryData.member = { id: docSnap.id, ...docSnap.data() };
            } else {
                libraryData.member = null;
            }

            if (pendingRequestBookId) {
                const bookId = pendingRequestBookId;
                pendingRequestBookId = null;
                closeAuthModal();
                if (!libraryData.member || libraryData.member.status !== 'approved') {
                    showAlertModal("You need an approved Library Membership to borrow books. Please apply in the Library Card section.", "Membership Required");
                    navigateTo('membership-view');
                    updateNavActive('membership-view');
                } else {
                    processRequestBook(bookId);
                }
            }

            if (currentView === 'membership-view') renderMembershipView();
        });
    } else {
        // Clear user data if logged out
        libraryData.requests = [];
        libraryData.member = null;
    }
}

function setupEventListeners() {
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            
            const target = item.dataset.target;
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            navigateTo(target);
        });
    });

    // Custom Search Dropdown Logic
    const searchDropdown = document.getElementById('search-type-dropdown');
    const searchTrigger = document.getElementById('search-type-trigger');
    const searchOptions = document.querySelectorAll('.dropdown-option');
    const selectedTypeText = document.getElementById('selected-type-text');
    const searchInput = document.getElementById('search-input');

    searchTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        searchDropdown.classList.toggle('active');
    });

    searchOptions.forEach(option => {
        option.addEventListener('click', () => {
            const value = option.dataset.value;
            const label = option.dataset.label;

            // Update UI
            searchOptions.forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');
            selectedTypeText.textContent = label;
            searchDropdown.classList.remove('active');

            // Update Logic
            libraryData.searchType = value;
            const labels = {
                'title': 'Search by title...',
                'author': 'Search by author...',
                'stock_number': 'Search by Book ID...'
            };
            searchInput.placeholder = labels[value] || 'Search...';

            if (searchInput.value.length > 0) {
                searchInput.dispatchEvent(new Event('input'));
            }
        });
    });

    // Close dropdown on outside click
    document.addEventListener('click', () => {
        if (searchDropdown) searchDropdown.classList.remove('active');
    });

    searchInput.addEventListener('input', async (e) => {
        const term = e.target.value;
        const searchField = libraryData.searchType;

        if (term.length > 2) {
            // Reset pagination for search
            libraryData.hasMore = false;
            // Perform server-side prefix search for performance
            const q = query(
                collection(db, "books"),
                where(searchField, ">=", term),
                where(searchField, "<=", term + '\uf8ff'),
                limit(50)
            );
            const snapshot = await getDocs(q);
            const results = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            renderLibraryView(term, results);
        } else {
            // Restore from libraryData.books if search is cleared
            // But we might want to re-fetch if they cleared search to get original pagination back
            if (term.length === 0) {
                resetPagination();
                fetchBooksBatch();
            } else {
                renderLibraryView(term);
            }
        }
    });

    document.getElementById('back-to-library').addEventListener('click', () => {
        
        if (lastView === 'my-books-view') {
            navigateTo('my-books-view');
            updateNavActive('my-books-view');
        } else {
            navigateTo('library-view');
            updateNavActive('library-view');
        }
    });

    document.getElementById('google-signin-btn').addEventListener('click', async () => {
        showAuthLoading();
        try {
            // Environment detection to choose best Auth flow
            // Simple Popup Sign-in for Website
            await signInWithPopup(auth, googleProvider);
        } catch (error) {
            console.error("Login failed", error);
            if (error.code !== 'auth/popup-closed-by-user') {
                showAlertModal("Sign in failed. Please try again or check if popups are blocked.", "Error", 'error');
            }
        } finally {
            hideAuthLoading();
        }
    });
}

function navigateTo(viewId, action = null) {
    if (!views || views.length === 0) {
        console.warn("navigateTo called before views were initialized. Re-scanning DOM.");
        views = document.querySelectorAll('.view');
    }

    if (viewId !== 'book-detail-view' && viewId !== currentView) {
        lastView = currentView;
    }
    views.forEach(view => view.classList.remove('active-view'));
    const target = document.getElementById(viewId);
    if (target) {
        target.classList.add('active-view');

        // Reset scroll for detail views or primary entry views
        if (viewId === 'book-detail-view' || viewId === 'welcome-view' || action === 'reset-scroll') {
            target.scrollTop = 0;
        }
    }

    currentView = viewId;

    const header = document.getElementById('app-header');
    const bottomNav = document.getElementById('bottom-nav');

    if (viewId === 'welcome-view' || viewId === 'genre-selection-view') {
        if (header) header.style.display = 'grid';
        if (bottomNav) bottomNav.style.display = 'none';
    } else {
        if (header) header.style.display = 'grid';
        if (bottomNav) bottomNav.style.display = 'flex';
    }

    if (viewId === 'library-view') {
        headerTitle.textContent = `Browse Catalog`;
        renderLibraryView();
        if (action === 'focus-search') {
            document.getElementById('search-input').focus();
        }
    } else if (viewId === 'map-view') {
        headerTitle.textContent = 'Library Map';
    } else if (viewId === 'my-books-view') {
        headerTitle.textContent = 'My Requests';
        if (!currentUser) {
            document.getElementById('borrowed-list').innerHTML = `
                <div style="text-align: center; padding: 60px 20px;">
                    <div class="glass" style="padding: 32px; border-radius: 24px; border: 1px solid var(--border-color);">
                        <i data-lucide="user-plus" style="width: 48px; height: 48px; color: var(--primary-color); margin-bottom: 20px;"></i>
                        <h3 style="margin-bottom: 8px;">Identify Yourself</h3>
                        <p style="color: var(--text-secondary); margin-bottom: 24px; font-size: 14px;">Sign in with Google to view and manage your borrowed books.</p>
                        <button class="btn btn-primary w-100" onclick="openAuthModal('Sign in to view your books')">Sign In Now</button>
                    </div>
                </div>
            `;
            document.getElementById('my-books-header').innerHTML = '';
        } else {
            renderMyBooksView();
        }
    } else if (viewId === 'membership-view') {
        headerTitle.textContent = 'Library Card';
        renderMembershipView();
    }
}

function renderLibraryView(searchQuery = '', serverResults = null) {
    const listContainer = document.getElementById('book-list');
    listContainer.innerHTML = '';

    // If serverResults specifically provided, use them. Otherwise use the standard libraryData.books.
    const sourceBooks = serverResults || libraryData.books;

    const booksToRender = sourceBooks.filter(book => {
        if (serverResults) return true; // Already filtered by server
        if (!searchQuery) return true; // Show all if no search

        const searchField = libraryData.searchType || 'title';
        const fieldValue = book[searchField] ? String(book[searchField]).toLowerCase() : '';
        return fieldValue.includes(searchQuery.toLowerCase());
    });

    if (libraryData.isLoading) {
        listContainer.innerHTML = `
            <div class="loading-spinner">
                <div class="spinner"></div>
                <p>Curating your library...</p>
            </div>
        `;
        return;
    } else if (libraryData.errorMessage) {
        listContainer.innerHTML = `
            <div style="text-align: center; color: #e11d48; margin-top: 40px; padding: 20px; background: rgba(225, 29, 72, 0.05); border-radius: 12px; border: 1px solid rgba(225, 29, 72, 0.1);">
                <i data-lucide="shield-alert" style="width: 32px; height: 32px; margin-bottom: 12px;"></i>
                <p style="font-weight:700;">Data Sync Issue</p>
                <p style="font-size: 14px; margin-top: 4px;">${libraryData.errorMessage}</p>
            </div>
        `;
        lucide.createIcons();
        return;
    } else if (booksToRender.length === 0) {
        listContainer.innerHTML = '<p style="text-align: center; color: var(--text-secondary); margin-top: 20px;">' + (searchQuery ? 'No books found for this search.' : 'No books available in the catalog yet.') + '</p>';
        return;
    }

    const targetStatuses = ['pending', 'borrowed'];
    let myRequests = [];
    if (currentUser) {
        myRequests = libraryData.requests.filter(r =>
            r.userEmail === currentUser.email && targetStatuses.includes(r.status)
        );
    }

    booksToRender.forEach(book => {
        const myRequest = myRequests.find(r => r.bookId === book.id);

        let statusHtml = '';
        if (myRequest) {
            if (myRequest.status === 'pending') {
                statusHtml = '<span class="status-badge status-pending">Request Pending</span>';
            } else if (myRequest.status === 'borrowed') {
                statusHtml = '<span class="status-badge status-borrowed">Borrowed</span>';
            }
        } else if (book.available !== false) { // Default to true if not specified
            statusHtml = '<span class="status-badge status-available">Available</span>';
        } else {
            statusHtml = '<span class="status-badge status-borrowed">Unavailable</span>';
        }

        const section = book.section || book.category || 'N/A';
        const shelf = book.shelf_number || book.shelf || 'N/A';
        const locationText = `${section} • ${shelf}`;

        const card = document.createElement('div');
        card.className = 'book-card';
        card.innerHTML = `
            <div class="book-img-placeholder" style="background: var(--bg-color); position: relative;">
                ${book.coverImageBase64
                ? `<img src="${book.coverImageBase64}" class="book-cover-img-card doc-scan-filter" alt="cover">`
                : `<i data-lucide="book" style="width:40px; height:40px; color:var(--primary-light); opacity:0.5;"></i>
                       <div style="position: absolute; top: 8px; right: 8px; font-size: 8px; font-weight: 800; color: white; background: var(--primary-color); padding: 2px 6px; border-radius: 6px; text-transform: uppercase; letter-spacing: 0.5px;">${section}</div>
                       <span style="position: absolute; bottom: 8px; right: 8px; font-size: 10px; font-weight: 800; color: var(--text-muted); opacity: 0.5;">#${book.stock_number || '000'}</span>`
            }
            </div>
            <div class="book-info">
                <div style="flex-grow: 1;">
                    <h3 class="book-title">${book.title}</h3>
                    <p class="book-author">${book.author}</p>
                    <div style="display:flex; align-items:center; gap:6px; color:var(--text-muted); font-size:12px; font-weight:700; margin-bottom:12px;">
                        <i data-lucide="map-pin"></i> ${locationText}
                    </div>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top: auto;">
                    ${statusHtml}
                    <div class="card-action-hint">
                        Explore <i data-lucide="arrow-right" style="width:14px; height:14px;"></i>
                    </div>
                </div>
            </div>
        `;

        card.addEventListener('click', () => {
            showBookDetail(book, myRequest);
        });

        listContainer.appendChild(card);
    });

    // Add Load More button
    if (libraryData.hasMore && !searchQuery) {
        const loadMoreBtn = document.createElement('button');
        loadMoreBtn.className = 'btn btn-load-more w-100';
        loadMoreBtn.style.marginTop = '20px';
        loadMoreBtn.style.marginBottom = '20px';

        if (libraryData.isNextPageLoading) {
            loadMoreBtn.innerHTML = '<span class="spinner-small"></span> Loading...';
            loadMoreBtn.disabled = true;
        } else {
            loadMoreBtn.innerHTML = '<i data-lucide="plus-circle"></i> Load More Books';
            loadMoreBtn.onclick = loadMoreBooks;
        }

        listContainer.appendChild(loadMoreBtn);
    } else if (!libraryData.hasMore && libraryData.books.length > 0 && !searchQuery) {
        const endMessage = document.createElement('p');
        endMessage.style.textAlign = 'center';
        endMessage.style.color = 'var(--text-muted)';
        endMessage.style.fontSize = '12px';
        endMessage.style.margin = '32px 0';
        endMessage.innerHTML = 'You\'ve reached the end of the collection.';
        listContainer.appendChild(endMessage);
    }

    lucide.createIcons();
}

function showBookDetail(book, myRequest) {
    const container = document.getElementById('book-detail-content');

    let actionBtnHtml = '';
    let statusGuidance = '';
    let scanCoverBtnHtml = '';

    if (myRequest) {
        if (myRequest.status === 'pending') {
            actionBtnHtml = `<button class="btn btn-primary w-100" style="background-color:#fb8c00;" disabled>Request is Pending</button>`;
            statusGuidance = `<p style="margin-top:12px; font-size:13px; color:var(--text-secondary); text-align:center;">Librarian is currently reviewing your request. Please wait for approval.</p>`;
        } else if (myRequest.status === 'borrowed') {
            actionBtnHtml = `<button class="btn btn-primary w-100" style="background-color:#4caf50;" disabled>Currently Borrowed</button>`;
            statusGuidance = `<div class="glass" style="margin-top:16px; padding:16px; border-radius:12px; border:1px solid #4caf5050;">
                <p style="font-size:12px; font-weight:800; color:#2e7d32; text-transform:uppercase; margin-bottom:4px; display:flex; align-items:center; gap:6px;"><i data-lucide="info" style="width:14px;"></i> Return Guidance</p>
                <p style="font-size:13px; color:var(--text-secondary); margin:0;">Please return this copy to <strong>Shelf ${book.section || book.category || 'N/A'} - Row ${book.row || 'N/A'}</strong> when you are finished reading.</p>
            </div>`;
            // Scan cover button for borrowers
            const hasCover = !!book.coverImageBase64;
            scanCoverBtnHtml = `
                <button class="btn btn-add-cover w-100" id="scan-cover-btn-detail" style="margin-top:16px; padding:14px; display:flex; align-items:center; justify-content:center; gap:10px;">
                    <i data-lucide="${hasCover ? 'refresh-cw' : 'camera'}"></i>
                    ${hasCover ? 'Replace Book Cover Scan' : 'Scan Book Cover'}
                </button>
                <p style="margin-top:8px; font-size:11px; color:var(--text-muted); text-align:center;">
                    ${hasCover ? 'A cover scan already exists. Scan again to update it.' : 'Help the library — scan the cover page of this book!'}
                </p>
            `;
        } else if (myRequest.status === 'returned') {
            actionBtnHtml = `<button class="btn btn-primary w-100" style="background-color:var(--primary-color);" disabled>Completed</button>`;
            statusGuidance = `<p style="margin-top:12px; font-size:13px; color:var(--text-secondary); text-align:center;">You have successfully returned this book. Thank you!</p>`;
        } else if (myRequest.status === 'rejected') {
            actionBtnHtml = `<button class="btn btn-primary w-100" style="background-color:var(--danger-color);" disabled>Request Rejected</button>`;
            statusGuidance = `<p style="margin-top:12px; font-size:13px; color:var(--danger-color); text-align:center;">Unfortunately, this request was not approved.</p>`;
        }
    } else if (book.available !== false) {
        actionBtnHtml = `<button class="btn btn-primary w-100" id="req-btn-${book.id}">Request Book</button>`;
    } else {
        actionBtnHtml = `<button class="btn btn-primary w-100" style="background-color:#9e9e9e;" disabled>Unavailable</button>`;
    }

    const section = book.section || book.category || 'N/A';
    const shelf = book.shelf_number || book.shelf || 'N/A';

    // Book cover: real scan or default icon
    const coverHtml = book.coverImageBase64
        ? `<img src="${book.coverImageBase64}" class="book-cover-img doc-scan-filter" alt="Book cover" style="border-radius:12px;">`
        : `<i data-lucide="book-open" style="width:100px; height:100px; color:var(--primary-color);"></i>
           <p style="margin-top: 12px; font-size: 12px; font-weight: 800; color: var(--text-muted); opacity: 0.6;">No cover scan yet</p>`;

    container.innerHTML = `
        <div class="detail-img-container" style="background: ${book.coverImageBase64 ? '#000' : 'var(--glass-bg)'}; border-radius: 24px; margin-bottom: 24px; position: relative; overflow: hidden;">
            ${coverHtml}
            <div style="position:absolute; bottom:8px; right:12px; font-size:10px; font-weight:800; color:${book.coverImageBase64 ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)'}; opacity:0.7;">ID: ${book.stock_number || book.id.substring(0, 6)}</div>
        </div>
        <h2 class="detail-title">${book.title}</h2>
        <p class="detail-author">${book.author}</p>
        
        <div class="glass" style="padding:16px 20px; border-radius:var(--radius-md); margin-bottom: 24px; display:flex; align-items:center; gap:12px;">
            <div style="color:var(--primary-color);"><i data-lucide="map-pin"></i></div>
            <div>
                <p style="font-size:11px; text-transform:uppercase; font-weight:800; color:var(--text-muted); letter-spacing:1px; margin:0;">Location</p>
                <p style="font-size:15px; color:var(--primary-color); font-weight:700; margin:0;">${section} • Shelf ${shelf}</p>
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px;">
            <div class="glass" style="padding: 12px; border-radius: 12px; text-align: center;">
                <p style="font-size:10px; text-transform:uppercase; font-weight:800; color:var(--text-muted); margin:0;">Category</p>
                <p style="font-size:14px; font-weight:700; color:var(--text-primary); margin:2px 0 0 0;">${section}</p>
            </div>
            <div class="glass" style="padding: 12px; border-radius: 12px; text-align: center;">
                <p style="font-size:10px; text-transform:uppercase; font-weight:800; color:var(--text-muted); margin:0;">Language</p>
                <p style="font-size:14px; font-weight:700; color:var(--text-primary); margin:2px 0 0 0;">${getLanguageName(book.language)}</p>
            </div>
        </div>

        <p class="detail-desc">Shelf ${shelf}, Row ${book.row || 'N/A'}. This copy is kept in the ${section} section. Use our digital map to locate the exact shelf.</p>
        <div class="detail-actions">
            ${actionBtnHtml}
            ${statusGuidance}
            ${scanCoverBtnHtml}
        </div>
    `;

    const btn = container.querySelector(`#req-btn-${book.id}`);
    if (btn) {
        btn.onclick = () => handleRequestAction(book.id);
    }

    const scanBtn = container.querySelector('#scan-cover-btn-detail');
    if (scanBtn) {
        scanBtn.onclick = () => window.openDocScanner(book.id);
    }

    navigateTo('book-detail-view');
    lucide.createIcons();
}

window.resetPagination = function () {
    libraryData.books = [];
    libraryData.lastVisible = null;
    libraryData.hasMore = true;
    libraryData.isLoading = true;
    libraryData.errorMessage = null;
};

window.fetchBooksBatch = async function () {
    const batchSize = 10;
    try {
        let q;
        if (libraryData.currentGenre === 'All') {
            q = query(
                collection(db, "books"),
                orderBy("last_updated", "desc"),
                limit(batchSize)
            );
        } else {
            q = query(
                collection(db, "books"),
                where("category", "==", libraryData.currentGenre),
                orderBy("last_updated", "desc"),
                limit(batchSize)
            );
        }

        if (libraryData.lastVisible) {
            q = query(q, startAfter(libraryData.lastVisible));
        }

        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            libraryData.hasMore = false;
        } else {
            const newBooks = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            libraryData.books = [...libraryData.books, ...newBooks];
            libraryData.lastVisible = snapshot.docs[snapshot.docs.length - 1];

            if (snapshot.docs.length < batchSize) {
                libraryData.hasMore = false;
            }
        }

        libraryData.isLoading = false;
        libraryData.isNextPageLoading = false;
        renderLibraryView();
    } catch (error) {
        console.error("Error fetching books:", error);
        libraryData.isLoading = false;
        libraryData.errorMessage = error.message;
        renderLibraryView();
    }
};

window.loadMoreBooks = function () {
    if (libraryData.isNextPageLoading || !libraryData.hasMore) return;
    libraryData.isNextPageLoading = true;
    renderLibraryView();
    fetchBooksBatch();
};

window.handleRequestAction = function (bookId) {
    if (!currentUser) {
        pendingRequestBookId = bookId;
        openAuthModal("Sign in to request this book");
    } else if (!libraryData.member || libraryData.member.status !== 'approved') {
        showAlertModal("You need an approved Library Membership to borrow books. Please apply in the Library Card section.", "Access Denied");
        navigateTo('membership-view');
        updateNavActive('membership-view');
    } else {
        processRequestBook(bookId);
    }
};

window.showAlertModal = function (message, title = "Notice", type = 'warning') {
    const titleEl = document.getElementById('alert-modal-title');
    const descEl = document.getElementById('alert-modal-desc');
    const iconContainer = document.getElementById('alert-modal-icon-container');
    const iconEl = document.getElementById('alert-modal-icon');

    if (titleEl) titleEl.textContent = title;
    if (descEl) descEl.textContent = message;

    // Type styling
    if (iconContainer && iconEl) {
        if (type === 'success') {
            iconContainer.style.color = 'var(--success-color)';
            iconEl.setAttribute('data-lucide', 'check-circle');
        } else if (type === 'error') {
            iconContainer.style.color = 'var(--danger-color)';
            iconEl.setAttribute('data-lucide', 'x-circle');
        } else {
            iconContainer.style.color = '#fb8c00'; // Warning orange
            iconEl.setAttribute('data-lucide', 'alert-circle');
        }
    }

    const modal = document.getElementById('alert-modal');
    if (modal) modal.style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.closeAlertModal = function () {
    const modal = document.getElementById('alert-modal');
    if (modal) modal.style.display = 'none';
};

window.openAuthModal = function (title) {
    const titleEl = document.getElementById('auth-modal-title');
    if (titleEl) titleEl.textContent = title;
    const modal = document.getElementById('auth-modal');
    if (modal) modal.style.display = 'flex';
};

window.closeAuthModal = function () {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.style.display = 'none';
};

window.logoutUser = async function () {
    try {
        await signOut(auth);
        navigateTo('library-view');
        window.location.reload();
    } catch (error) {
        console.error("Logout failed", error);
    }
};



window.selectGenre = async function (genre, icon) {
    const listTitle = document.getElementById('library-view-title');
    if (listTitle) {
        listTitle.innerHTML = `<button class="header-action" onclick="navigateTo('genre-selection-view')" style="background:none; border:none; color:inherit; padding:0; cursor:pointer;"><i data-lucide="${icon}" style="width:20px; vertical-align:middle; margin-right:8px;"></i> ${genre} Collection</button>`;
    }

    libraryData.currentGenre = genre;
    resetPagination();
    navigateTo('library-view');

    fetchBooksBatch();
};

window.applyMembership = async function (e) {
    if (e) e.preventDefault();

    if (!currentUser) {
        openAuthModal("Sign in to apply for membership");
        return;
    }

    const name = document.getElementById('mem-name').value;
    const age = document.getElementById('mem-age').value;
    const phone = document.getElementById('mem-phone').value;
    const address = document.getElementById('mem-address').value;
    const bloodGroup = document.getElementById('mem-blood').value;
    const recommender = document.getElementById('mem-recommender').value;
    const joiningDate = document.getElementById('mem-joining').value;
    const deposit = document.getElementById('mem-deposit').value;

    try {
        await addDoc(collection(db, "members"), {
            uid: currentUser.uid,
            email: currentUser.email,
            photoURL: currentUser.photoURL || null,
            name: name,
            age: age,
            phone: phone,
            address: address,
            bloodGroup: bloodGroup,
            recommender: recommender,
            joiningDate: joiningDate,
            deposit: deposit,
            status: 'pending',
            timestamp: serverTimestamp(),
            last_updated: serverTimestamp(),
            source: 'web'
        });
        showAlertModal('Application submitted successfully!', 'Success', 'success');

        if (!libraryData.member) {
            libraryData.member = { status: 'pending' };
            renderMembershipView();
        }
    } catch (error) {
        console.error(error);
        showAlertModal('Error submitting application. Check Firebase connection.', 'Error', 'error');
    }
};

function renderMembershipView() {
    const container = document.getElementById('membership-content');
    if (!currentUser || !libraryData.member) {
        let defaultName = currentUser ? currentUser.name : '';
        let showLoginPrompt = !currentUser;

        container.innerHTML = `
            <div class="glass" style="padding: 24px; border-radius: var(--radius-lg);">
                <div style="text-align:center; margin-bottom:24px;">
                    <i data-lucide="user-plus" style="width:48px; height:48px; color:var(--primary-color);"></i>
                    <h3 style="margin-top:12px; color:var(--primary-color);">Apply for Membership</h3>
                    <p style="color:var(--text-secondary); font-size:14px;">Join the library to borrow books easily.</p>
                    ${showLoginPrompt ? `<button class="btn btn-primary w-100" style="margin-top:20px; background: white; color: var(--text-primary); border: 1px solid var(--border-color);" onclick="openAuthModal('Sign in to apply')">Sign in with Google First</button>` : ''}
                </div>
                
                <form id="membership-form" onsubmit="applyMembership(event)" style="${showLoginPrompt ? 'opacity:0.3; pointer-events:none;' : ''}">
                    <div class="input-group">
                        <label>Full Name</label>
                        <input type="text" id="mem-name" value="${defaultName}" placeholder="Your Full Name" required>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                        <div class="input-group">
                            <label>Age</label>
                            <input type="number" id="mem-age" placeholder="Age" required>
                        </div>
                        <div class="input-group">
                            <label>Blood Group</label>
                            <select id="mem-blood" required>
                                <option value="" disabled selected>Select</option>
                                <option value="A+">A+</option>
                                <option value="A-">A-</option>
                                <option value="B+">B+</option>
                                <option value="B-">B-</option>
                                <option value="O+">O+</option>
                                <option value="O-">O-</option>
                                <option value="AB+">AB+</option>
                                <option value="AB-">AB-</option>
                                <option value="Unknown">Unknown</option>
                            </select>
                        </div>
                    </div>

                    <div class="input-group">
                        <label>Phone Number</label>
                        <input type="tel" id="mem-phone" required pattern="[0-9]{10}" placeholder="10-digit number">
                    </div>
                    
                    <div class="input-group">
                        <label>Address</label>
                        <input type="text" id="mem-address" placeholder="e.g. 123 Main St..." required>
                    </div>

                    <div class="input-group">
                        <label>Recommender</label>
                        <input type="text" id="mem-recommender" placeholder="Who recommended you?">
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                        <div class="input-group">
                            <label>Joining Date</label>
                            <input type="date" id="mem-joining" value="${new Date().toISOString().split('T')[0]}" required>
                        </div>
                        <div class="input-group">
                            <label>Deposit (₹)</label>
                            <input type="number" id="mem-deposit" placeholder="Amount" value="0">
                        </div>
                    </div>

                    <button type="submit" class="btn btn-primary w-100" style="padding: 16px; margin-top: 8px;">Submit Application</button>
                </form>
            </div>
        `;
    } else if (libraryData.member.status === 'pending') {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px 20px;">
                <div style="color: var(--secondary-color); margin-bottom: 16px;">
                    <i data-lucide="clock" style="width: 64px; height: 64px;"></i>
                </div>
                <h3 style="color:var(--primary-color); font-size:24px; margin-bottom:8px;">Application Pending</h3>
                <p style="color:var(--text-secondary);">Your membership is currently under review by the librarian. Please check back later.</p>
            </div>
        `;
    } else if (libraryData.member.status === 'approved') {
        const m = libraryData.member;
        container.innerHTML = `
            <div style="background: linear-gradient(135deg, var(--primary-color), var(--primary-dark)); border-radius: 16px; padding: 24px; color: white; box-shadow: 0 10px 25px rgba(0,0,0,0.2); position:relative; overflow:hidden; margin-top:20px;">
                <div style="position:absolute; top:-20%; right:-10%; width:150px; height:150px; background:rgba(255,255,255,0.05); border-radius:50%;"></div>
                <div style="position:absolute; bottom:-10%; left:-10%; width:100px; height:100px; background:rgba(255,255,255,0.05); border-radius:50%;"></div>
                
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 32px; position:relative; z-index:1;">
                    <div>
                        <h4 style="font-size: 11px; opacity:0.8; text-transform:uppercase; letter-spacing:2px; margin:0; margin-bottom:4px;">Nayodayam Library</h4>
                        <h2 style="margin:0; font-size: 20px; font-weight:800; letter-spacing:-0.5px;">Membership Card</h2>
                    </div>
                    <i data-lucide="library" style="width:36px; height:36px; opacity:0.9;"></i>
                </div>
                
                <div style="margin-bottom:28px; position:relative; z-index:1; display:flex; align-items:center; gap: 16px;">
                    ${m.photoURL ? `<img src="${m.photoURL}" style="width: 56px; height: 56px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.5); object-fit: cover; flex-shrink: 0;">` : `<div style="width: 56px; height: 56px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.5); background: rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; flex-shrink: 0;"><i data-lucide="user" style="width: 28px; height: 28px; color: white; opacity: 0.8;"></i></div>`}
                    <div>
                        <p style="font-size:11px; opacity:0.7; margin:0; text-transform:uppercase; letter-spacing:1px;">Member Name</p>
                        <p style="font-size:24px; font-weight:700; margin:0; letter-spacing:-0.5px;">${m.name}</p>
                    </div>
                </div>
                
                <div style="background:white; padding: 16px; border-radius: 12px; text-align:center; position:relative; z-index:1;">
                    <svg id="barcode"></svg>
                </div>
                
                <div style="margin-top:20px; display:flex; justify-content:space-between; align-items:center; font-size:11px; opacity:0.8; position:relative; z-index:1;">
                    <span style="font-weight:700; letter-spacing:1px;">ID: ${m.memberId || 'N/A'}</span>
                    <span style="${m.isLifetime ? 'background:#fcd34d; color:#92400e; font-weight:800;' : 'background:rgba(255,255,255,0.1);'} padding:4px 8px; border-radius:12px;">${m.isLifetime ? 'Lifetime Member' : 'Active Member'}</span>
                </div>
            </div>
            
            <button class="btn btn-primary w-100" style="margin-top: 24px; background: white; color: var(--primary-color); border: 2px solid var(--primary-light); box-shadow: var(--shadow-sm);" onclick="printMyCard()">
                <i data-lucide="printer"></i> Download / Print ID Card
            </button>
            
            <div style="margin-top:24px; text-align:center; padding:16px; border:1px solid var(--border-color); border-radius:12px; background:white;">
                <p style="color:var(--text-secondary); font-size:14px; margin-bottom:8px;"><i data-lucide="info" style="width:16px; height:16px; display:inline-block; vertical-align:middle; margin-right:4px;"></i> Show this card at the checkout counter.</p>
            </div>
        `;
        setTimeout(() => {
            if (window.JsBarcode && m.memberId) {
                JsBarcode("#barcode", m.memberId, {
                    format: "CODE128",
                    width: 2,
                    height: 50,
                    displayValue: false,
                    background: "#ffffff",
                    lineColor: "#0f172a",
                    margin: 0
                });
            }
        }, 150);
    }
    lucide.createIcons();
}

window.printMyCard = function () {
    const m = libraryData.member;
    if (!m || m.status !== 'approved') return;

    const printArea = document.getElementById('printable-card-area');
    printArea.innerHTML = `
        <div class="print-card">
            <div class="print-card-header">
                <div>
                    <h2>Nayodayam Library</h2>
                    <p>Membership Card</p>
                </div>
                <div style="color: #083344; font-weight: 800; font-size: 14px;">NYD</div>
            </div>
            
            <div style="margin-top: 12px;">
                <p style="font-size: 10px; opacity: 0.7; text-transform: uppercase;">Member Name</p>
                <p style="font-size: 18px; font-weight: 800; margin: 0; color: #0f172a;">${m.name}</p>
            </div>

            <div class="print-barcode-container">
                <svg id="print-barcode-member"></svg>
            </div>

            <div class="print-card-footer">
                <div>ID: ${m.memberId}</div>
                <div>SINCE ${m.timestamp ? new Date(m.timestamp.seconds * 1000).getFullYear() : new Date().getFullYear()}</div>
            </div>
        </div>
    `;

    // Generate barcode
    setTimeout(() => {
        if (window.JsBarcode && m.memberId) {
            JsBarcode("#print-barcode-member", m.memberId, {
                format: "CODE128",
                width: 2,
                height: 40,
                displayValue: false,
                margin: 0
            });
            window.print();
        }
    }, 100);
};

async function processRequestBook(bookId) {
    const book = libraryData.books.find(b => b.id === bookId);
    if (book && book.available) {
        try {
            await addDoc(collection(db, "requests"), {
                uid: currentUser.uid,
                userEmail: currentUser.email,
                userName: libraryData.member?.name || currentUser.name,
                userPhone: libraryData.member?.phone || 'N/A',
                memberId: libraryData.member?.memberId || 'N/A',
                bookId: book.id,
                bookTitle: book.title,
                status: 'pending',
                timestamp: serverTimestamp()
            });

            // Mark book as unavailable (optional, usually admin does this upon approval, 
            // but for self-service simplicity we can do it here or let admin manage availability)
            // For now, per requirements, we store request with status: Pending.

            showAlertModal(`You requested "${book.title}".`, "Request Sent", 'success');
            navigateTo('my-books-view');
        } catch (e) {
            console.error(e);
            showAlertModal("Failed to send request.", "Error", 'error');
        }
    }
}

function renderMyBooksView() {
    const listContainer = document.getElementById('borrowed-list');
    listContainer.innerHTML = '';

    document.getElementById('my-books-header').innerHTML = `
        <div class="glass" style="padding:16px; border-radius:var(--radius-md); margin-bottom:24px; display:flex; align-items:center; justify-content:space-between;">
            <div style="display:flex; align-items:center; gap:12px;">
                ${currentUser.photo ? `<img src="${currentUser.photo}" style="width:40px; height:40px; border-radius:50%; border:2px solid var(--primary-color); flex-shrink: 0; object-fit: cover;">` : `<div style="width:40px; height:40px; border-radius:50%; background:var(--primary-color); color:white; display:flex; align-items:center; justify-content:center; font-weight:800; flex-shrink: 0;">${currentUser.name[0]}</div>`}
                <div>
                    <p style="font-size:11px; text-transform:uppercase; font-weight:800; color:var(--text-muted); letter-spacing:1px; margin:0;">Welcome back</p>
                    <p style="font-size:15px; color:var(--primary-color); font-weight:700; margin:0;">${libraryData.member?.name || currentUser.name}</p>
                </div>
            </div>
            <button onclick="logoutUser()" class="btn" style="background:var(--danger-color); color:white; padding:8px 12px; font-size:12px; border-radius:8px;">Logout</button>
        </div>
    `;

    if (libraryData.requests.length === 0) {
        listContainer.innerHTML = `
            <div style="text-align: center; padding: 40px 20px;">
                <p style="color: var(--text-secondary); margin-bottom: 24px;">No requests found.</p>
                <button class="btn btn-primary" onclick="navigateTo('library-view')">Browse Books</button>
            </div>
        `;
        return;
    }

    libraryData.requests.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0)).forEach(req => {
        const book = libraryData.books.find(b => b.id === req.bookId);

        let statusHtml = req.status.charAt(0).toUpperCase() + req.status.slice(1);
        let statusClass = `status-${req.status}`;

        if (req.status === 'borrowed') {
            statusClass = 'status-borrowed';
        } else if (req.status === 'returned') {
            statusClass = 'status-returned';
        } else if (req.status === 'pending') {
            statusClass = 'status-pending';
        }

        const card = document.createElement('div');
        card.className = 'book-card';
        card.style.cursor = 'pointer';
        card.onclick = () => {
            const fullBook = libraryData.books.find(b => b.id === req.bookId) || {
                id: req.bookId,
                title: req.bookTitle,
                author: 'Member Request',
                category: 'My Books',
                available: false
            };
            showBookDetail(fullBook, req);
        };
        card.innerHTML = `
            <div class="book-img-placeholder">
                <i data-lucide="book" style="width:40px; height:40px; color:var(--primary-light); opacity:0.5;"></i>
            </div>
            <div class="book-info">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:4px;">
                    <h3 class="book-title" style="margin:0;">${req.bookTitle || 'Book'}</h3>
                </div>
                <div style="margin-bottom:12px;"><span class="status-badge ${statusClass}">${statusHtml}</span></div>
                <div style="display:flex; align-items:center; gap:6px; color:var(--text-muted); font-size:11px; font-weight:700;">
                    <i data-lucide="clock"></i> ${req.timestamp ? new Date(req.timestamp.seconds * 1000).toLocaleDateString() : 'Just now'}
                </div>
            </div>
        `;

        listContainer.appendChild(card);
    });
    lucide.createIcons();
}

// ================================================================
//  DOCUMENT SCANNER ENGINE — WhatsApp-style book cover scanner
// ================================================================

let _scannerStream = null;
let _scannerTargetBookId = null;
let _scannerCapturedDataUrl = null;

/**
 * Apply document-scan post-processing to a canvas:
 * 1. Slight desaturation to remove colour casts from room lighting
 * 2. Contrast / level stretch — shadows deeper, whites brighter
 * 3. Warm paper tint on very light areas for that scanned-doc look
 */
function applyDocScanEffect(canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imageData.data;

    for (let i = 0; i < d.length; i += 4) {
        let r = d[i], g = d[i + 1], b = d[i + 2];

        // 1. Slight desaturation — reduce colour casts from lighting
        const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const desatFactor = 0.25; // 0 = full grey, 1 = full colour
        r = r * (1 - desatFactor) + gray * desatFactor;
        g = g * (1 - desatFactor) + gray * desatFactor;
        b = b * (1 - desatFactor) + gray * desatFactor;

        // 2. Contrast + brightness lift
        const contrast = 1.45;
        const brightness = 18;
        r = Math.min(255, Math.max(0, contrast * (r - 128) + 128 + brightness));
        g = Math.min(255, Math.max(0, contrast * (g - 128) + 128 + brightness));
        b = Math.min(255, Math.max(0, contrast * (b - 128) + 128 + brightness));

        // 3. Warm paper tint on bright areas
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        if (luma > 200) {
            r = Math.min(255, r + 6);
            g = Math.min(255, g + 4);
            b = Math.max(0, b - 4);
        }

        d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
    ctx.putImageData(imageData, 0, 0);
}

/** Open the scanner modal for a specific book */
window.openDocScanner = async function (bookId) {
    _scannerTargetBookId = bookId;
    _scannerCapturedDataUrl = null;

    const modal = document.getElementById('doc-scanner-modal');
    if (!modal) return;

    _showScannerPhase('camera');
    modal.classList.add('active');
    lucide.createIcons();

    try {
        _scannerStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: false
        });
        const video = document.getElementById('scanner-video');
        video.srcObject = _scannerStream;
        // Start auto-detection once video is playing
        video.addEventListener('playing', _startAutoDetect, { once: true });
    } catch (err) {
        console.warn('Camera unavailable, falling back to file picker:', err);
        const vf = document.getElementById('scanner-viewfinder');
        if (vf) vf.style.display = 'none';
        document.getElementById('scanner-file-input').click();
    }
};

// ── Auto-detect state ────────────────────────────────────────────
let _detectRafId = null;   // requestAnimationFrame id
let _detectTimer = null;   // countdown timeout
let _detectStable = false;  // is a document currently detected?
let _detectCountdown = 0;      // ms remaining before auto-capture
const AUTO_CAPTURE_DELAY = 1500; // ms to hold steady before capture

/** Start the background frame-analysis loop */
function _startAutoDetect() {
    _stopAutoDetect(); // clear any previous loop
    _detectStable = false;
    _setFrameState('searching');

    // Offscreen analysis canvas — tiny for speed (160×120)
    const offscreen = document.createElement('canvas');
    offscreen.width = 160;
    offscreen.height = 120;
    const octx = offscreen.getContext('2d');

    let lastDetectTime = 0;

    function loop(ts) {
        if (!_scannerStream) return; // scanner was closed

        // Throttle analysis to ~5 fps (every 200ms) to save CPU
        if (ts - lastDetectTime >= 200) {
            lastDetectTime = ts;
            const video = document.getElementById('scanner-video');
            if (!video || video.readyState < 2) {
                _detectRafId = requestAnimationFrame(loop);
                return;
            }

            // Draw downscaled frame
            octx.drawImage(video, 0, 0, 160, 120);
            const detected = _analyzeEdges(octx, 160, 120);

            if (detected && !_detectStable) {
                // Document just appeared → start countdown
                _detectStable = true;
                _setFrameState('detected');
                _startCountdown();
            } else if (!detected && _detectStable) {
                // Document moved away → cancel countdown
                _detectStable = false;
                _setFrameState('searching');
                _cancelCountdown();
            }
        }

        _detectRafId = requestAnimationFrame(loop);
    }

    _detectRafId = requestAnimationFrame(loop);
}

/** Stop the detection loop */
function _stopAutoDetect() {
    if (_detectRafId) { cancelAnimationFrame(_detectRafId); _detectRafId = null; }
    _cancelCountdown();
    _detectStable = false;
}

/**
 * Edge-density analysis using a simplified Sobel operator on a 160×120 downscale.
 * We sample the INNER region of the frame (the guide zone) and check:
 *   1. Total edge density (are there high-contrast edges = document content?)
 *   2. Corner-area edges (does this look like a rectangular object?)
 * Returns true when a document-like object is detected.
 */
function _analyzeEdges(ctx, w, h) {
    const data = ctx.getImageData(0, 0, w, h).data;

    // Focus on the center 60% of the frame (matching our guide frame)
    const x0 = Math.floor(w * 0.2), x1 = Math.floor(w * 0.8);
    const y0 = Math.floor(h * 0.1), y1 = Math.floor(h * 0.9);

    let totalEdge = 0;
    let edgePixels = 0;

    // Sobel on luminance
    for (let y = y0 + 1; y < y1 - 1; y++) {
        for (let x = x0 + 1; x < x1 - 1; x++) {
            const lum = (px, py) => {
                const i = (py * w + px) * 4;
                return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            };
            const gx = -lum(x - 1, y - 1) + lum(x + 1, y - 1)
                - 2 * lum(x - 1, y) + 2 * lum(x + 1, y)
                - lum(x - 1, y + 1) + lum(x + 1, y + 1);
            const gy = -lum(x - 1, y - 1) - 2 * lum(x, y - 1) - lum(x + 1, y - 1)
                + lum(x - 1, y + 1) + 2 * lum(x, y + 1) + lum(x + 1, y + 1);
            const mag = Math.sqrt(gx * gx + gy * gy);
            totalEdge += mag;
            if (mag > 40) edgePixels++; // strong edge threshold
        }
    }

    const roiPixels = (x1 - x0 - 2) * (y1 - y0 - 2);
    const edgeDensity = edgePixels / roiPixels;
    const avgEdge = totalEdge / roiPixels;

    // A book cover has lots of text/art = high edge density
    // Thresholds tuned for typical book covers under indoor lighting
    return edgeDensity > 0.06 && avgEdge > 12;
}

/** Visual state of the guide frame corners */
function _setFrameState(state) {
    const frame = document.getElementById('scanner-doc-frame');
    if (!frame) return;
    frame.classList.remove('frame-searching', 'frame-detected', 'frame-capturing');
    frame.classList.add('frame-' + state);

    const label = frame.querySelector('.scanner-frame-label');
    if (label) {
        if (state === 'searching') label.textContent = 'Align book cover inside the frame';
        if (state === 'detected') label.textContent = 'Hold still…';
        if (state === 'capturing') label.textContent = 'Scanning ✓';
    }
}

/** Begin the 1.5-second auto-capture countdown */
function _startCountdown() {
    const frame = document.getElementById('scanner-doc-frame');
    if (frame) {
        // Drive a CSS custom property so the SVG ring animates
        frame.style.setProperty('--countdown-ms', AUTO_CAPTURE_DELAY + 'ms');
        frame.classList.add('counting');
    }
    _detectTimer = setTimeout(() => {
        if (_detectStable) {
            _setFrameState('capturing');
            _stopAutoDetect();
            _captureFrame();
        }
    }, AUTO_CAPTURE_DELAY);
}

function _cancelCountdown() {
    if (_detectTimer) { clearTimeout(_detectTimer); _detectTimer = null; }
    const frame = document.getElementById('scanner-doc-frame');
    if (frame) frame.classList.remove('counting');
}

function _showScannerPhase(phase) {
    const captureCtrl = document.getElementById('scanner-capture-controls');
    const previewCtrl = document.getElementById('scanner-preview-controls');
    const viewfinder = document.getElementById('scanner-viewfinder');
    const previewWrap = document.getElementById('scanner-preview-wrap');

    if (phase === 'camera') {
        if (viewfinder) viewfinder.style.display = '';
        if (previewWrap) previewWrap.classList.remove('active');
        if (captureCtrl) captureCtrl.style.display = 'flex';
        if (previewCtrl) previewCtrl.style.display = 'none';
    } else {
        _stopAutoDetect();
        if (viewfinder) viewfinder.style.display = 'none';
        if (previewWrap) previewWrap.classList.add('active');
        if (captureCtrl) captureCtrl.style.display = 'none';
        if (previewCtrl) previewCtrl.style.display = 'flex';
    }
}

function _closeScanner() {
    _stopAutoDetect();
    if (_scannerStream) {
        _scannerStream.getTracks().forEach(t => t.stop());
        _scannerStream = null;
    }
    const modal = document.getElementById('doc-scanner-modal');
    if (modal) modal.classList.remove('active');
    _scannerCapturedDataUrl = null;
    const vf = document.getElementById('scanner-viewfinder');
    if (vf) vf.style.display = '';
    _setFrameState('searching');
}

function _captureFrame() {
    const video = document.getElementById('scanner-video');
    const canvas = document.getElementById('scanner-preview-canvas');
    const frame = document.getElementById('scanner-doc-frame');
    if (!video || !canvas || !frame) return;

    // Calculate crop coordinates based on object-fit: cover CSS
    const videoRect = video.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();

    let vw = video.videoWidth;
    let vh = video.videoHeight;
    if (!vw || !vh) return; // Video metadata not ready

    // Workaround for iOS Safari swapping width/height on camera streams
    if (videoRect.height > videoRect.width && vw > vh) {
        vw = video.videoHeight;
        vh = video.videoWidth;
    } else if (videoRect.width > videoRect.height && vh > vw) {
        vw = video.videoHeight;
        vh = video.videoWidth;
    }

    // Mathematical equivalent of CSS object-fit: cover
    const coverScale = Math.max(videoRect.width / vw, videoRect.height / vh);
    const renderedW = vw * coverScale;
    const renderedH = vh * coverScale;

    // Center offsets for cover fitting
    const offsetX = (renderedW - videoRect.width) / 2;
    const offsetY = (renderedH - videoRect.height) / 2;

    // Set canvas dimensions to the green frame's size (capped at MAX)
    let dstW = frameRect.width;
    let dstH = frameRect.height;
    const MAX_W = 800, MAX_H = 1067; // max output bounds

    if (dstW > MAX_W) { dstH = dstH * (MAX_W / dstW); dstW = MAX_W; }
    if (dstH > MAX_H) { dstW = dstW * (MAX_H / dstH); dstH = MAX_H; }

    canvas.width = dstW;
    canvas.height = dstH;

    const ctx = canvas.getContext('2d');

    // Scale rendering from CSS pixels to exported image pixels
    const outputScale = dstW / frameRect.width;

    ctx.save();

    // 1. Scale to final output dimensions
    ctx.scale(outputScale, outputScale);

    // 2. Shift the drawing origin so the green frame perfectly aligns to (0,0) in the canvas
    ctx.translate(
        -(frameRect.left - videoRect.left + offsetX),
        -(frameRect.top - videoRect.top + offsetY)
    );

    // 3. Draw video using 5-args instead of 9-args to avoid iOS Safari source clipping bugs
    ctx.drawImage(video, 0, 0, renderedW, renderedH);

    ctx.restore();

    const proc = document.getElementById('scanner-processing');
    if (proc) proc.classList.add('active');

    setTimeout(() => {
        applyDocScanEffect(canvas);
        if (proc) proc.classList.remove('active');
        _scannerCapturedDataUrl = canvas.toDataURL('image/jpeg', 0.82);
        _showScannerPhase('preview');
    }, 60);
}

function _processFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const MAX_W = 800, MAX_H = 1067;
            let dstW = img.width, dstH = img.height;
            if (dstW > MAX_W) { dstH = Math.round(dstH * MAX_W / dstW); dstW = MAX_W; }
            if (dstH > MAX_H) { dstW = Math.round(dstW * MAX_H / dstH); dstH = MAX_H; }

            const canvas = document.getElementById('scanner-preview-canvas');
            canvas.width = dstW;
            canvas.height = dstH;
            canvas.getContext('2d').drawImage(img, 0, 0, dstW, dstH);

            const proc = document.getElementById('scanner-processing');
            if (proc) proc.classList.add('active');
            setTimeout(() => {
                applyDocScanEffect(canvas);
                if (proc) proc.classList.remove('active');
                _scannerCapturedDataUrl = canvas.toDataURL('image/jpeg', 0.82);
                const modal = document.getElementById('doc-scanner-modal');
                if (modal) modal.classList.add('active');
                _showScannerPhase('preview');
                lucide.createIcons();
            }, 60);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

async function _saveCover() {
    if (!_scannerCapturedDataUrl || !_scannerTargetBookId) return;
    const saveBtn = document.getElementById('scanner-save-btn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

    try {
        await updateDoc(doc(db, 'books', _scannerTargetBookId), {
            coverImageBase64: _scannerCapturedDataUrl,
            coverUpdatedAt: serverTimestamp()
        });
        _closeScanner();
        _showScannerToast('✅ Cover scan saved successfully!');

        // Patch local cache for instant UI update
        const local = libraryData.books.find(b => b.id === _scannerTargetBookId);
        if (local) local.coverImageBase64 = _scannerCapturedDataUrl;

        if (currentView === 'book-detail-view') {
            const currentBook = libraryData.books.find(b => b.id === _scannerTargetBookId);
            const req = libraryData.requests.find(r => r.bookId === _scannerTargetBookId);
            if (currentBook) showBookDetail(currentBook, req);
        }
        if (currentView === 'library-view') renderLibraryView();
    } catch (err) {
        console.error('Cover save failed:', err);
        _showScannerToast('❌ Save failed: ' + err.message);
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i data-lucide="check"></i> Use This Scan';
            lucide.createIcons();
        }
    }
}

function _showScannerToast(msg) {
    const t = document.getElementById('scanner-toast');;
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}

// Wire up all scanner events on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('scanner-close-btn')?.addEventListener('click', _closeScanner);

    // Manual shutter still works (user can tap anytime)
    document.getElementById('scanner-shutter-btn')?.addEventListener('click', () => {
        _stopAutoDetect();
        _captureFrame();
    });

    document.getElementById('scanner-retake-btn')?.addEventListener('click', () => {
        _scannerCapturedDataUrl = null;
        _showScannerPhase('camera');
        // Restart auto-detect after retake
        const video = document.getElementById('scanner-video');
        if (video && _scannerStream) _startAutoDetect();
    });

    document.getElementById('scanner-save-btn')?.addEventListener('click', _saveCover);

    document.getElementById('scanner-file-input')?.addEventListener('change', (e) => {
        if (e.target.files?.[0]) _processFile(e.target.files[0]);
        e.target.value = '';
    });

    document.getElementById('scanner-flash-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('scanner-flash-btn');
        if (!_scannerStream) return;
        const track = _scannerStream.getVideoTracks()[0];
        if (!track) return;
        try {
            const current = track.getSettings().torch;
            await track.applyConstraints({ advanced: [{ torch: !current }] });
            btn.classList.toggle('on', !current);
        } catch (_) { /* torch not supported on this device */ }
    });
});

