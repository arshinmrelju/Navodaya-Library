import { db, auth, googleProvider } from './firebase-config.js';
import {
    collection,
    addDoc,
    onSnapshot,
    query,
    where,
    doc,
    getDoc,
    updateDoc,
    getDocs,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
    signInWithPopup,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

let currentUser = null;
let currentView = 'welcome-view';
let pendingRequestBookId = null;

let libraryData = {
    books: [],
    requests: [],
    member: null
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
            // If they were in the middle of a request, process it
            if (pendingRequestBookId) {
                processRequestBook(pendingRequestBookId);
                pendingRequestBookId = null;
                closeAuthModal();
            }
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
    // Listen for books
    onSnapshot(collection(db, "books"), (snapshot) => {
        libraryData.books = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        if (currentView === 'library-view') renderLibraryView();
        if (currentView === 'my-books-view') renderMyBooksView();
    });

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

    document.getElementById('search-input').addEventListener('input', (e) => {
        renderLibraryView(e.target.value.toLowerCase());
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
            alert("Sign in failed. Please try again.");
        }
    });
}

function navigateTo(viewId, action = null) {
    views.forEach(view => view.classList.remove('active-view'));
    document.getElementById(viewId).classList.add('active-view');
    currentView = viewId;

    const header = document.getElementById('app-header');
    const bottomNav = document.getElementById('bottom-nav');

    const appContent = document.getElementById('app-content');
    if (viewId === 'welcome-view') {
        header.style.display = 'grid';
        bottomNav.style.display = 'none';
        appContent.style.paddingTop = 'calc(70px + env(safe-area-inset-top))';
    } else {
        header.style.display = 'grid';
        bottomNav.style.display = 'flex';
        appContent.style.paddingTop = ''; // Revert to CSS default
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

function renderLibraryView(searchQuery = '') {
    const listContainer = document.getElementById('book-list');
    listContainer.innerHTML = '';

    const booksToRender = libraryData.books.filter(book => {
        const titleMatch = book.title?.toLowerCase().includes(searchQuery);
        const authorMatch = book.author?.toLowerCase().includes(searchQuery);
        const sectionMatch = (book.section || book.category)?.toLowerCase().includes(searchQuery);
        const shelfMatch = (book.shelf_number || book.shelf)?.toLowerCase().includes(searchQuery);
        return titleMatch || authorMatch || sectionMatch || shelfMatch;
    });

    if (booksToRender.length === 0 && libraryData.books.length > 0) {
        listContainer.innerHTML = '<p style="text-align: center; color: var(--text-secondary); margin-top: 20px;">No books found.</p>';
        return;
    } else if (libraryData.books.length === 0) {
        listContainer.innerHTML = `
            <div class="loading-spinner">
                <div class="spinner"></div>
                <p>Curating your library...</p>
            </div>
        `;
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
                <p style="font-size:14px; font-weight:700; color:var(--text-primary); margin:2px 0 0 0;">${book.language || 'English'}</p>
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

window.handleRequestAction = function (bookId) {
    if (!currentUser) {
        pendingRequestBookId = bookId;
        openAuthModal("Enter details to request this book");
    } else {
        processRequestBook(bookId);
    }
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
            name: name,
            phone: phone,
            address: address,
            status: 'pending',
            timestamp: serverTimestamp()
        });
        alert('Application submitted successfully!');

        if (!libraryData.member) {
            libraryData.member = { status: 'pending' };
            renderMembershipView();
        }
    } catch (error) {
        console.error(error);
        alert('Error submitting application. Check Firebase connection.');
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
                
                <div style="margin-bottom:28px; position:relative; z-index:1;">
                    <p style="font-size:11px; opacity:0.7; margin:0; text-transform:uppercase; letter-spacing:1px;">Member Name</p>
                    <p style="font-size:24px; font-weight:700; margin:0; letter-spacing:-0.5px;">${m.name}</p>
                </div>
                
                <div style="background:white; padding: 16px; border-radius: 12px; text-align:center; position:relative; z-index:1;">
                    <svg id="barcode"></svg>
                </div>
                
                <div style="margin-top:20px; display:flex; justify-content:space-between; align-items:center; font-size:11px; opacity:0.8; position:relative; z-index:1;">
                    <span style="font-weight:700; letter-spacing:1px;">ID: ${m.memberId || 'N/A'}</span>
                    <span style="background:rgba(255,255,255,0.1); padding:4px 8px; border-radius:12px;">Valid Lifetime</span>
                </div>
            </div>
            
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

async function processRequestBook(bookId) {
    const book = libraryData.books.find(b => b.id === bookId);
    if (book && book.available) {
        try {
            await addDoc(collection(db, "requests"), {
                uid: currentUser.uid,
                userEmail: currentUser.email,
                userName: currentUser.name,
                bookId: book.id,
                bookTitle: book.title,
                status: 'pending',
                timestamp: serverTimestamp()
            });

            // Mark book as unavailable (optional, usually admin does this upon approval, 
            // but for self-service simplicity we can do it here or let admin manage availability)
            // For now, per requirements, we store request with status: Pending.

            alert(`You requested "${book.title}".`);
            navigateTo('my-books-view');
        } catch (e) {
            console.error(e);
            alert("Failed to send request.");
        }
    }
}

function renderMyBooksView() {
    const listContainer = document.getElementById('borrowed-list');
    listContainer.innerHTML = '';

    document.getElementById('my-books-header').innerHTML = `
        <div class="glass" style="padding:16px; border-radius:var(--radius-md); margin-bottom:24px; display:flex; align-items:center; justify-content:space-between;">
            <div style="display:flex; align-items:center; gap:12px;">
                ${currentUser.photo ? `<img src="${currentUser.photo}" style="width:40px; height:40px; border-radius:50%; border:2px solid var(--primary-color);">` : `<div style="width:40px; height:40px; border-radius:50%; background:var(--primary-color); color:white; display:flex; align-items:center; justify-content:center; font-weight:800;">${currentUser.name[0]}</div>`}
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
