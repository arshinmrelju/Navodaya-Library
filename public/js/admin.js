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
    requests: [],
    members: []
};

export function initAdmin() {
    // Check if user is already "logged in" via sessionStorage
    if (sessionStorage.getItem('isAdminLoggedIn') === 'true') {
        showApp();
    } else {
        showLogin();
    }

    // Removed Firebase onAuthStateChanged for hardcoded bypass
    
    document.getElementById('admin-login-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const pwd = document.getElementById('admin-password').value;
        
        // HARDCODED PASSWORD CHECK
        if (pwd === 'admin123') {
            sessionStorage.setItem('isAdminLoggedIn', 'true');
            showApp();
        } else {
            alert("Login failed. The password is 'admin123'");
        }
    });
}

function showLogin() {
    document.getElementById('admin-login-screen').style.display = 'flex';
    document.getElementById('admin-app').style.display = 'none';
    document.getElementById('header-logout-btn').style.display = 'none';
}

function showApp() {
    document.getElementById('admin-login-screen').style.display = 'none';
    document.getElementById('admin-app').style.display = 'flex';
    document.getElementById('header-logout-btn').style.display = 'flex';
    setupListeners();
    setupDataListeners();
    lucide.createIcons();
}

window.logout = function () {
    sessionStorage.removeItem('isAdminLoggedIn');
    window.location.reload();
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
        if (currentView === 'requests-view') {
            renderRequests();
            renderBorrows();
        }
    });

    const mq = query(collection(db, "members"), orderBy("timestamp", "desc"));
    onSnapshot(mq, (snapshot) => {
        libraryData.members = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (currentView === 'members-view') renderMembers();
    });
}

function navigateTo(viewId) {
    views.forEach(view => view.classList.remove('active-view'));
    document.getElementById(viewId).classList.add('active-view');
    currentView = viewId;

    if (viewId === 'requests-view') {
        renderRequests();
        renderBorrows();
    } else if (viewId === 'inventory-view') {
        renderInventory();
    } else if (viewId === 'members-view') {
        renderMembers();
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
                <div class="book-img-placeholder" style="width:50px; height:70px;"><i data-lucide="book" style="width:24px; height:24px;"></i></div>
                <div class="book-info">
                    <h3 class="book-title" style="font-size:16px; margin:0;">${req.bookTitle}</h3>
                    <p style="font-size:12px; color:var(--text-muted); margin:4px 0 0 0;">ID: ${req.userPhone}</p>
                </div>
            </div>
            <div class="req-actions" style="display:flex; gap:12px;">
                <button class="btn btn-success" style="flex:1; padding:12px; font-weight:700;" id="approve-${req.id}">Approve</button>
                <button class="btn btn-danger-soft" style="flex:1; padding:12px; font-weight:700;" id="reject-${req.id}">Reject</button>
            </div>
        `;
        list.appendChild(card);
        card.querySelector(`#approve-${req.id}`).onclick = () => updateRequestStatus(req.id, 'borrowed', req.bookId);
        card.querySelector(`#reject-${req.id}`).onclick = () => updateRequestStatus(req.id, 'rejected', req.bookId);
    });
    lucide.createIcons();
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
            <div class="req-actions" style="display:flex; margin-top:12px;">
                <button class="btn" style="background:var(--bg-color); color:var(--text-secondary); padding: 10px 18px; font-size:13px; font-weight:700; flex:1; border-radius:12px; border:1px solid var(--border-color); transition: all 0.2s;" id="return-${req.id}">Mark Returned</button>
            </div>
        `;
        list.appendChild(card);
        card.querySelector(`#return-${req.id}`).onclick = () => updateRequestStatus(req.id, 'returned', req.bookId);
    });
    lucide.createIcons();
}

function renderMembers() {
    const pendingList = document.getElementById('pending-members-list');
    const approvedList = document.getElementById('approved-members-list');
    if (!pendingList || !approvedList) return;
    pendingList.innerHTML = '';
    approvedList.innerHTML = '';

    const pendings = libraryData.members.filter(m => m.status === 'pending');
    const approved = libraryData.members.filter(m => m.status === 'approved');

    if (pendings.length === 0) {
        pendingList.innerHTML = '<p style="color:var(--text-secondary); text-align:center;">No pending applications.</p>';
    } else {
        pendings.forEach(m => {
            const card = document.createElement('div');
            card.className = 'book-card req-card';
            card.innerHTML = `
                <div class="req-header">
                    <span class="req-user">${m.name}</span>
                    <span>${m.timestamp ? new Date(m.timestamp.seconds * 1000).toLocaleDateString() : 'New'}</span>
                </div>
                <div class="req-info" style="margin-bottom:20px;">
                    <div class="book-img-placeholder" style="width:50px; height:50px; border-radius:50%;"><i data-lucide="user" style="width:24px; height:24px;"></i></div>
                    <div class="book-info">
                        <p style="font-size:14px; margin:0;">Phone: ${m.phone}</p>
                        <p style="font-size:12px; color:var(--text-muted); margin:4px 0 0 0;">Address: ${m.address}</p>
                    </div>
                </div>
                <div class="req-actions" style="display:flex; gap:12px;">
                    <button class="btn btn-success" style="flex:1; padding:12px; font-weight:700;" onclick="approveMember('${m.id}')">Approve</button>
                    <button class="btn btn-danger-soft" style="flex:1; padding:12px; font-weight:700;" onclick="rejectMember('${m.id}')">Reject</button>
                </div>
            `;
            pendingList.appendChild(card);
        });
    }

    if (approved.length === 0) {
        approvedList.innerHTML = '<p style="color:var(--text-secondary); text-align:center;">No approved members yet.</p>';
    } else {
        approved.forEach(m => {
            const card = document.createElement('div');
            card.className = 'book-card req-card';
            card.innerHTML = `
                <div class="req-header">
                    <span class="req-user">${m.name}</span>
                    <span style="color:var(--success-color);">Active</span>
                </div>
                <div class="req-info">
                    <div class="book-img-placeholder" style="width:50px; height:50px; border-radius:50%;"><i data-lucide="id-card" style="width:24px; height:24px;"></i></div>
                    <div class="book-info">
                        <p style="font-size:14px; margin:0; font-weight:bold;">ID: ${m.memberId}</p>
                        <p style="font-size:12px; color:var(--text-muted); margin:4px 0 0 0;">Phone: ${m.phone}</p>
                    </div>
                </div>
            `;
            approvedList.appendChild(card);
        });
    }
    lucide.createIcons();
}

window.approveMember = async function(id) {
    const randDigits = Math.floor(1000 + Math.random() * 9000);
    const mId = "NYD-" + randDigits;
    try {
        await updateDoc(doc(db, "members", id), {
            status: 'approved',
            memberId: mId
        });
    } catch(e) {
        console.error("Error approving:", e);
    }
};

window.rejectMember = async function(id) {
    if (confirm("Reject this application?")) {
        try {
            await deleteDoc(doc(db, "members", id));
        } catch(e) {
            console.error(e);
        }
    }
};

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
            <div class="book-img-placeholder" style="width:60px; height:80px;">
                <i data-lucide="book" style="width:28px; height:28px;"></i>
            </div>
            <div class="book-info">
                <h3 class="book-title" style="font-size:16px;">${book.title}</h3>
                <p class="book-author" style="font-size:13px; margin-bottom:8px;">${book.author}</p>
                <span class="status-badge ${book.available ? 'status-available' : 'status-borrowed'}">
                    ${book.available ? 'Available' : 'Unavailable'}
                </span>
            </div>
            <div style="display:flex; gap:8px;">
                <button class="edit-book-btn" id="edit-${book.id}" title="Edit"><i data-lucide="edit"></i></button>
                <button class="delete-book-btn" id="delete-${book.id}" title="Delete"><i data-lucide="trash-2"></i></button>
            </div>
        `;
        list.appendChild(card);
        card.querySelector(`#edit-${book.id}`).onclick = () => openBookForm(book.id);
        card.querySelector(`#delete-${book.id}`).onclick = () => deleteBook(book.id);
    });
    lucide.createIcons();
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
    } catch (e) {
        console.error("Firebase Error:", e);
        alert("Warning: Could not save to Cloud. If your'e using placeholders in js/firebase-config.js, please update them with your real Firebase keys. For now, the form will close.");
    }
    // Always close the form to prevent it from getting stuck
    closeBookForm();
};

async function deleteBook(id) {
    if (confirm("Delete book?")) {
        await deleteDoc(doc(db, "books", id));
    }
}
