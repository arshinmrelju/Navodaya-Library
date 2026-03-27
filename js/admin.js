import { db, auth } from './firebase-config.js';
import { 
    onAuthStateChanged, 
    signInWithEmailAndPassword, 
    signOut 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    collection, 
    onSnapshot, 
    doc, 
    addDoc, 
    updateDoc, 
    deleteDoc, 
    serverTimestamp,
    orderBy,
    query
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let currentView = 'requests-view';
const views = document.querySelectorAll('.view');
const navItems = document.querySelectorAll('.nav-item');

let libraryData = {
    books: [],
    requests: []
};

export function initAdmin() {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            showApp();
        } else {
            showLogin();
        }
    });

    document.getElementById('admin-login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = "admin@navodaya.lib"; // Default admin email
        const pwd = document.getElementById('admin-password').value;
        try {
            await signInWithEmailAndPassword(auth, email, pwd);
        } catch (err) {
            alert("Login failed. Check password.");
        }
    });
}

function showLogin() {
    document.getElementById('admin-login-screen').style.display = 'flex';
    document.getElementById('admin-app').style.display = 'none';
}

function showApp() {
    document.getElementById('admin-login-screen').style.display = 'none';
    document.getElementById('admin-app').style.display = 'flex';
    setupListeners();
    setupDataListeners();
}

window.logout = async function () {
    await signOut(auth);
};

function setupListeners() {
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            navigateTo(item.dataset.target);
        });
    });
}

function setupDataListeners() {
    onSnapshot(collection(db, "books"), (snapshot) => {
        libraryData.books = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (currentView === 'inventory-view') renderInventory();
        else {
            renderRequests();
            renderBorrows();
        }
    });

    const q = query(collection(db, "requests"), orderBy("timestamp", "desc"));
    onSnapshot(q, (snapshot) => {
        libraryData.requests = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderRequests();
        renderBorrows();
    });
}

function navigateTo(viewId) {
    views.forEach(view => view.classList.remove('active-view'));
    document.getElementById(viewId).classList.add('active-view');
    currentView = viewId;

    if (viewId === 'requests-view') {
        renderRequests();
        renderBorrows();
    } else {
        renderInventory();
    }
}
window.navigateTo = navigateTo;

function renderRequests() {
    const list = document.getElementById('pending-list');
    list.innerHTML = '';
    const pendings = libraryData.requests.filter(r => r.status === 'pending');

    if (pendings.length === 0) {
        list.innerHTML = '<p style="color:var(--text-secondary); text-align:center;">No pending requests.</p>';
        return;
    }

    pendings.forEach(req => {
        const card = document.createElement('div');
        card.className = 'book-card req-card';
        card.innerHTML = `
            <div class="req-header">
                <span class="req-user">${req.userName}</span>
                <span>${req.timestamp ? new Date(req.timestamp.seconds * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '...'}</span>
            </div>
            <div class="req-info" style="margin-bottom:20px;">
                <div class="book-img-placeholder" style="width:50px; height:70px; font-size:24px;">📚</div>
                <div class="book-info">
                    <h3 class="book-title" style="font-size:16px; margin:0;">${req.bookTitle}</h3>
                    <p style="font-size:12px; color:var(--text-muted); margin:4px 0 0 0;">ID: ${req.userPhone}</p>
                </div>
            </div>
            <div class="req-actions" style="display:flex; gap:12px;">
                <button class="btn btn-primary" style="flex:1; padding:12px;" id="approve-${req.id}">Approve</button>
                <button class="btn" style="flex:1; padding:12px; background:var(--bg-color); color:var(--text-secondary);" id="reject-${req.id}">Reject</button>
            </div>
        `;
        list.appendChild(card);
        card.querySelector(`#approve-${req.id}`).onclick = () => updateRequestStatus(req.id, 'borrowed', req.bookId);
        card.querySelector(`#reject-${req.id}`).onclick = () => updateRequestStatus(req.id, 'rejected', req.bookId);
    });
}

function renderBorrows() {
    const list = document.getElementById('borrowed-list');
    list.innerHTML = '';
    const borrows = libraryData.requests.filter(r => r.status === 'borrowed');

    if (borrows.length === 0) {
        list.innerHTML = '<p style="color:var(--text-secondary); text-align:center;">No active borrows.</p>';
        return;
    }

    borrows.forEach(req => {
        const card = document.createElement('div');
        card.className = 'book-card req-card';
        card.innerHTML = `
            <div class="req-header">
                <span><strong>${req.userName}</strong> (${req.userPhone})</span>
                <span>In Progress</span>
            </div>
            <div class="req-body">
                <div class="book-info">
                    <h3 class="book-title" style="font-size:14px;">${req.bookTitle}</h3>
                </div>
            </div>
            <div class="req-actions">
                <button class="btn" style="background:#e0e0e0; color:black; padding: 8px 16px; font-size:14px; flex:1;" id="return-${req.id}">Mark Returned</button>
            </div>
        `;
        list.appendChild(card);
        card.querySelector(`#return-${req.id}`).onclick = () => updateRequestStatus(req.id, 'returned', req.bookId);
    });
}

async function updateRequestStatus(reqId, newStatus, bookId) {
    try {
        await updateDoc(doc(db, "requests", reqId), { status: newStatus });
        
        // If borrowed, mark book unavailable. If returned/rejected, mark available.
        const available = (newStatus !== 'borrowed');
        if (newStatus === 'borrowed' || newStatus === 'returned' || newStatus === 'rejected') {
            await updateDoc(doc(db, "books", bookId), { available: available });
        }
    } catch (e) {
        console.error(e);
    }
}

function renderInventory() {
    const list = document.getElementById('inventory-list');
    list.innerHTML = '';

    libraryData.books.forEach(book => {
        const card = document.createElement('div');
        card.className = 'book-card';
        card.style.alignItems = 'center';
        card.innerHTML = `
            <div class="book-img-placeholder" style="width:60px; height:80px; font-size:28px;">
                📚
            </div>
            <div class="book-info">
                <h3 class="book-title" style="font-size:16px;">${book.title}</h3>
                <p class="book-author" style="font-size:13px; margin-bottom:8px;">${book.author}</p>
                <span class="status-badge ${book.available ? 'status-available' : 'status-borrowed'}">
                    ${book.available ? 'Available' : 'Unavailable'}
                </span>
            </div>
            <div style="display:flex; gap:8px;">
                <button class="edit-book-btn" id="edit-${book.id}" title="Edit">✏️</button>
                <button class="delete-book-btn" id="delete-${book.id}" title="Delete">🗑️</button>
            </div>
        `;
        list.appendChild(card);
        card.querySelector(`#edit-${book.id}`).onclick = () => openBookForm(book.id);
        card.querySelector(`#delete-${book.id}`).onclick = () => deleteBook(book.id);
    });
}

window.openBookForm = function (bookId = null) {
    const formContainer = document.getElementById('book-form-container');
    const title = document.getElementById('book-form-title');
    const idField = document.getElementById('edit-book-id');
    const titleField = document.getElementById('new-title');
    const authorField = document.getElementById('new-author');
    const sectionField = document.getElementById('new-section');
    const shelfField = document.getElementById('new-shelf');

    if (bookId) {
        const book = libraryData.books.find(b => b.id === bookId);
        if (book) {
            title.textContent = 'Edit Book';
            idField.value = book.id;
            titleField.value = book.title;
            authorField.value = book.author;
            sectionField.value = book.section || '';
            shelfField.value = book.shelf_number || '';
        }
    } else {
        title.textContent = 'New Book';
        idField.value = '';
        titleField.value = '';
        authorField.value = '';
        sectionField.value = '';
        shelfField.value = '';
    }
    formContainer.style.display = 'block';
};

window.closeBookForm = function () {
    document.getElementById('book-form-container').style.display = 'none';
};

window.saveBook = async function () {
    const editId = document.getElementById('edit-book-id').value;
    const bookData = {
        title: document.getElementById('new-title').value.trim(),
        author: document.getElementById('new-author').value.trim(),
        section: document.getElementById('new-section').value.trim(),
        shelf_number: document.getElementById('new-shelf').value.trim(),
        available: true
    };

    if (!bookData.title || !bookData.author) return;

    try {
        if (editId) {
            await updateDoc(doc(db, "books", editId), bookData);
        } else {
            await addDoc(collection(db, "books"), bookData);
        }
        closeBookForm();
    } catch (e) {
        console.error(e);
    }
};

async function deleteBook(id) {
    if (confirm("Delete book?")) {
        await deleteDoc(doc(db, "books", id));
    }
}
