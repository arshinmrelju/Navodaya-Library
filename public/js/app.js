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

let currentUser = null;
let currentView = 'welcome-view';
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
    isNextPageLoading: false
};

// DOM Elements
const views = document.querySelectorAll('.view');
const headerTitle = document.getElementById('header-title');
const navItems = document.querySelectorAll('.nav-item');

export function initApp() {
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
            // Pending requests will be processed after membership is loaded
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
        const mq = query(collection(db, "members"), where("email", "==", currentUser.email));
        onSnapshot(mq, (snapshot) => {
            if (!snapshot.empty) {
                libraryData.member = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
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

    document.getElementById('search-input').addEventListener('input', async (e) => {
        const term = e.target.value;
        if (term.length > 2) {
            // Reset pagination for search
            libraryData.hasMore = false; 
            // Perform server-side prefix search for performance
            const q = query(
                collection(db, "books"), 
                where("title", ">=", term), 
                where("title", "<=", term + '\uf8ff'),
                limit(50)
            );
            const snapshot = await getDocs(q);
            const results = snapshot.docs.map(d => ({id: d.id, ...d.data()}));
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
        navigateTo('library-view');
        updateNavActive('library-view');
    });

    document.getElementById('google-signin-btn').addEventListener('click', async () => {
        try {
            await signInWithPopup(auth, googleProvider);
            // closeAuthModal is handled by onAuthStateChanged
        } catch (error) {
            console.error("Login failed", error);
            showAlertModal("Sign in failed. Please try again.", "Error");
        }
    });
}

function navigateTo(viewId, action = null) {
    views.forEach(view => view.classList.remove('active-view'));
    const target = document.getElementById(viewId);
    if (target) target.classList.add('active-view');
    currentView = viewId;

    const header = document.getElementById('app-header');
    const bottomNav = document.getElementById('bottom-nav');

    if (viewId === 'welcome-view') {
        if (header) header.style.display = 'grid';
        if (bottomNav) bottomNav.style.display = 'none';
    } else if (viewId === 'genre-selection-view') {
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
                    <div style="background: var(--glass-bg); padding: 32px; border-radius: 24px; border: 1px solid var(--border-color);">
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

function updateNavActive(viewId) {
    navItems.forEach(nav => {
        if (nav.dataset.target === viewId) nav.classList.add('active');
        else nav.classList.remove('active');
    });
}

function renderLibraryView(searchQuery = '', serverResults = null) {
    const listContainer = document.getElementById('book-list');
    listContainer.innerHTML = '';

    // If serverResults specifically provided, use them. Otherwise use the standard libraryData.books.
    const sourceBooks = serverResults || libraryData.books;

    const booksToRender = sourceBooks.filter(book => {
        if (serverResults) return true; // Already filtered by server
        if (!searchQuery) return true; // Show all if no search

        const titleMatch = book.title?.toLowerCase().includes(searchQuery.toLowerCase());
        const authorMatch = book.author?.toLowerCase().includes(searchQuery.toLowerCase());
        return titleMatch || authorMatch;
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
                statusHtml = '<span class="status-badge" style="background-color:#fff3e0; color:#e65100;">Request Pending</span>';
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
                <i data-lucide="book" style="width:40px; height:40px; color:var(--primary-light); opacity:0.5;"></i>
                <span style="position: absolute; bottom: 8px; right: 8px; font-size: 10px; font-weight: 800; color: var(--text-muted); opacity: 0.5;">#${book.stock_number || '000'}</span>
            </div>
            <div class="book-info">
                <h3 class="book-title">${book.title}</h3>
                <p class="book-author">${book.author}</p>
                <div style="display:flex; align-items:center; gap:6px; color:var(--text-muted); font-size:12px; font-weight:700; margin-bottom:10px;">
                    <i data-lucide="map-pin"></i> ${locationText}
                </div>
                ${statusHtml}
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
    if (myRequest) {
        if (myRequest.status === 'pending') {
            actionBtnHtml = `<button class="btn btn-primary w-100" style="background-color:#fb8c00;" disabled>Request is Pending</button>`;
        } else if (myRequest.status === 'borrowed') {
            actionBtnHtml = `<button class="btn btn-primary w-100" style="background-color:#4caf50;" disabled>You Borrowed This</button>`;
        }
    } else if (book.available !== false) {
        actionBtnHtml = `<button class="btn btn-primary w-100" id="req-btn-${book.id}">Request Book</button>`;
    } else {
        actionBtnHtml = `<button class="btn btn-primary w-100" style="background-color:#9e9e9e;" disabled>Unavailable</button>`;
    }

    const section = book.section || book.category || 'N/A';
    const shelf = book.shelf_number || book.shelf || 'N/A';

    container.innerHTML = `
        <div class="detail-img-container" style="background: var(--glass-bg); border-radius: 24px; margin-bottom: 24px;">
            <i data-lucide="book-open" style="width:100px; height:100px; color:var(--primary-color);"></i>
            <p style="margin-top: 12px; font-size: 12px; font-weight: 800; color: var(--text-muted); opacity: 0.6;">Inventory ID: ${book.stock_number || book.id.substring(0, 6)}</p>
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

        <p class="detail-desc">This copy (${book.call_number || 'N/A'}) is kept in the ${section} section. Use our digital map to locate the exact shelf.</p>
        <div class="detail-actions">
            ${actionBtnHtml}
        </div>
    `;

    const btn = container.querySelector(`#req-btn-${book.id}`);
    if (btn) {
        btn.onclick = () => handleRequestAction(book.id);
    }

    navigateTo('book-detail-view');
    lucide.createIcons();
}

window.resetPagination = function() {
    libraryData.books = [];
    libraryData.lastVisible = null;
    libraryData.hasMore = true;
    libraryData.isLoading = true;
    libraryData.errorMessage = null;
};

window.fetchBooksBatch = async function() {
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

window.loadMoreBooks = function() {
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

window.showAlertModal = function (message, title = "Notice") {
    document.getElementById('alert-modal-title').textContent = title;
    document.getElementById('alert-modal-desc').textContent = message;
    document.getElementById('alert-modal').style.display = 'flex';
    lucide.createIcons();
};

window.closeAlertModal = function () {
    document.getElementById('alert-modal').style.display = 'none';
};

window.openAuthModal = function (title) {
    document.getElementById('auth-modal-title').textContent = title;
    document.getElementById('auth-modal').style.display = 'flex';
};

window.closeAuthModal = function () {
    document.getElementById('auth-modal').style.display = 'none';
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

// Export to window for inline onclick handlers
window.navigateTo = navigateTo;
window.updateNavActive = updateNavActive;

window.selectGenre = async function(genre, icon) {
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
    const phone = document.getElementById('mem-phone').value;
    const address = document.getElementById('mem-address').value;

    try {
        await addDoc(collection(db, "members"), {
            uid: currentUser.uid,
            email: currentUser.email,
            photoURL: currentUser.photoURL || null,
            name: name,
            phone: phone,
            address: address,
            status: 'pending',
            timestamp: serverTimestamp()
        });
        showAlertModal('Application submitted successfully!', 'Success');

        if (!libraryData.member) {
            libraryData.member = { status: 'pending' };
            renderMembershipView();
        }
    } catch (error) {
        console.error(error);
        showAlertModal('Error submitting application. Check Firebase connection.', 'Error');
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
                    <div class="input-group">
                        <label>Phone Number</label>
                        <input type="tel" id="mem-phone" required pattern="[0-9]{10}" placeholder="10-digit number">
                    </div>
                    <div class="input-group">
                        <label>Address</label>
                        <input type="text" id="mem-address" placeholder="e.g. 123 Main St..." required>
                    </div>
                    <button type="submit" class="btn btn-primary w-100" style="padding: 16px;">Submit Application</button>
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
                    <span style="background:rgba(255,255,255,0.1); padding:4px 8px; border-radius:12px;">Valid Lifetime</span>
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

window.printMyCard = function() {
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
                userName: currentUser.name,
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

            showAlertModal(`You requested "${book.title}".`, "Request Sent");
            navigateTo('my-books-view');
        } catch (e) {
            console.error(e);
            showAlertModal("Failed to send request.", "Error");
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
                    <p style="font-size:15px; color:var(--primary-color); font-weight:700; margin:0;">${currentUser.name}</p>
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

        let statusHtml = '';
        let color = '#e65100';
        let bg = '#fff3e0';

        if (req.status === 'borrowed') {
            statusHtml = 'Borrowed';
            color = '#2e7d32';
            bg = '#e8f5e9';
        } else if (req.status === 'returned') {
            statusHtml = 'Returned';
            color = '#667781';
            bg = '#f1f5f9';
        } else if (req.status === 'pending') {
            statusHtml = 'Pending';
        }

        const card = document.createElement('div');
        card.className = 'book-card';
        card.innerHTML = `
            <div class="book-img-placeholder">
                <i data-lucide="book" style="width:40px; height:40px; color:var(--primary-light); opacity:0.5;"></i>
            </div>
            <div class="book-info">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:4px;">
                    <h3 class="book-title" style="margin:0;">${req.bookTitle || 'Book'}</h3>
                </div>
                <div style="margin-bottom:12px;">${statusHtml}</div>
                <div style="display:flex; align-items:center; gap:6px; color:var(--text-muted); font-size:11px; font-weight:700;">
                    <i data-lucide="clock"></i> ${req.timestamp ? new Date(req.timestamp.seconds * 1000).toLocaleDateString() : 'Just now'}
                </div>
            </div>
        `;

        listContainer.appendChild(card);
    });
    lucide.createIcons();
}
