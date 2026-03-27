import { db, auth } from './firebase-config.js';
import { 
    collection, 
    addDoc, 
    onSnapshot, 
    query, 
    where, 
    doc, 
    updateDoc, 
    getDocs, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let currentUser = null;
let currentView = 'welcome-view';
let pendingRequestBookId = null;

let libraryData = {
    books: [],
    requests: []
};

// DOM Elements
const views = document.querySelectorAll('.view');
const headerTitle = document.getElementById('header-title');
const navItems = document.querySelectorAll('.nav-item');

export function initApp() {
    const userStr = localStorage.getItem('navodaya_user');
    if (userStr) {
        currentUser = JSON.parse(userStr);
    }
    setupEventListeners();
    setupFirestoreListeners();
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
        const q = query(collection(db, "requests"), where("userPhone", "==", currentUser.phone));
        onSnapshot(q, (snapshot) => {
            libraryData.requests = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            if (currentView === 'library-view') renderLibraryView();
            if (currentView === 'my-books-view') renderMyBooksView();
        });
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

    document.getElementById('auth-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('user-name').value;
        const phone = document.getElementById('user-phone').value;
        
        currentUser = { name, phone };
        localStorage.setItem('navodaya_user', JSON.stringify(currentUser));
        
        closeAuthModal();
        setupFirestoreListeners(); // Refresh listener for new user

        if (pendingRequestBookId) {
            processRequestBook(pendingRequestBookId);
            pendingRequestBookId = null;
        } else {
            renderMyBooksView();
        }
    });
}

function navigateTo(viewId, action = null) {
    views.forEach(view => view.classList.remove('active-view'));
    document.getElementById(viewId).classList.add('active-view');
    currentView = viewId;

    const header = document.getElementById('app-header');
    const bottomNav = document.getElementById('bottom-nav');

    if (viewId === 'welcome-view') {
        header.style.display = 'none';
        bottomNav.style.display = 'none';
    } else {
        header.style.display = 'grid';
        bottomNav.style.display = 'flex';
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
            openAuthModal("Enter details to view your books");
            document.getElementById('borrowed-list').innerHTML = `
                <div style="text-align: center; padding: 40px 20px;">
                    <button class="btn btn-primary" onclick="openAuthModal('Enter details to view your books')">Identify Yourself</button>
                    <p style="margin-top:16px; color:var(--text-secondary);">Enter your phone number to see your requests.</p>
                </div>
            `;
            document.getElementById('my-books-header').innerHTML = '';
        } else {
            renderMyBooksView();
        }
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
        const titleMatch = book.title.toLowerCase().includes(searchQuery);
        const authorMatch = book.author.toLowerCase().includes(searchQuery);
        const sectionMatch = book.section?.toLowerCase().includes(searchQuery);
        const shelfMatch = book.shelf_number?.toLowerCase().includes(searchQuery);
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
            r.userPhone === currentUser.phone && targetStatuses.includes(r.status)
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
        } else if (book.available) {
            statusHtml = '<span class="status-badge status-available">Available</span>';
        } else {
            statusHtml = '<span class="status-badge status-borrowed">Unavailable</span>';
        }

        const locationText = `${book.section || 'N/A'} • ${book.shelf_number || 'N/A'}`;

        const card = document.createElement('div');
        card.className = 'book-card';
        card.innerHTML = `
            <div class="book-img-placeholder">
                📚
            </div>
            <div class="book-info">
                <h3 class="book-title">${book.title}</h3>
                <p class="book-author">${book.author}</p>
                <div style="display:flex; align-items:center; gap:6px; color:var(--text-muted); font-size:12px; font-weight:700; margin-bottom:10px;">
                    <span>📍</span> ${locationText}
                </div>
                ${statusHtml}
            </div>
        `;
        
        card.addEventListener('click', () => {
            showBookDetail(book, myRequest);
        });
        
        listContainer.appendChild(card);
    });
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
    } else if (book.available) {
        actionBtnHtml = `<button class="btn btn-primary w-100" id="req-btn-${book.id}">Request Book</button>`;
    } else {
        actionBtnHtml = `<button class="btn btn-primary w-100" style="background-color:#9e9e9e;" disabled>Unavailable</button>`;
    }

    container.innerHTML = `
        <div class="detail-img-container">
            📖
        </div>
        <h2 class="detail-title">${book.title}</h2>
        <p class="detail-author">${book.author}</p>
        
        <div class="glass" style="padding:16px 20px; border-radius:var(--radius-md); margin-bottom:24px; display:flex; align-items:center; gap:12px;">
            <div style="font-size:24px;">📍</div>
            <div>
                <p style="font-size:11px; text-transform:uppercase; font-weight:800; color:var(--text-muted); letter-spacing:1px; margin:0;">Location</p>
                <p style="font-size:15px; color:var(--primary-color); font-weight:700; margin:0;">${book.section} • Shelf ${book.shelf_number}</p>
            </div>
        </div>

        <p class="detail-desc">This copy is kept in the ${book.section} section. Use our digital map to locate the exact shelf.</p>
        <div class="detail-actions">
            ${actionBtnHtml}
        </div>
    `;

    const btn = container.querySelector(`#req-btn-${book.id}`);
    if (btn) {
        btn.onclick = () => handleRequestAction(book.id);
    }
    
    navigateTo('book-detail-view');
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

window.logoutUser = function () {
    localStorage.removeItem('navodaya_user');
    currentUser = null;
    navigateTo('library-view');
    window.location.reload();
};

// Export to window for inline onclick handlers
window.navigateTo = navigateTo;
window.updateNavActive = updateNavActive;

async function processRequestBook(bookId) {
    const book = libraryData.books.find(b => b.id === bookId);
    if (book && book.available) {
        try {
            await addDoc(collection(db, "requests"), {
                userPhone: currentUser.phone,
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
            <div>
                <p style="font-size:11px; text-transform:uppercase; font-weight:800; color:var(--text-muted); letter-spacing:1px; margin:0;">Verified User</p>
                <p style="font-size:15px; color:var(--primary-color); font-weight:700; margin:0;">${currentUser.name}</p>
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
                📚
            </div>
            <div class="book-info">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:4px;">
                    <h3 class="book-title" style="margin:0;">${req.bookTitle || 'Book'}</h3>
                </div>
                <div style="margin-bottom:12px;">${statusHtml}</div>
                <div style="display:flex; align-items:center; gap:6px; color:var(--text-muted); font-size:11px; font-weight:700;">
                    <span>🕒</span> ${req.timestamp ? new Date(req.timestamp.seconds * 1000).toLocaleDateString() : 'Just now'}
                </div>
            </div>
        `;
        
        listContainer.appendChild(card);
    });
}
