import { db, auth, googleProvider } from './firebase-config.js';
import {
    onAuthStateChanged,
    signInWithPopup,
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
    limit,
    query,
    getDocs,
    getDoc,
    setDoc,
    startAfter,
    where
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let currentView = 'requests-view';
let currentRequestSubView = 'requests';
let currentMembersSubView = 'members-pending';
let adminCategoryFilter = 'All';
const views = document.querySelectorAll('.view');
const navItems = document.querySelectorAll('.nav-item');
let syncClickCount = 0;
let lastSyncClickTime = 0;

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
    members: [],
    lastVisible: null,
    membersLastVisible: null,
    borrowsLastVisible: null,
    hasMore: true,
    membersHasMore: true,
    borrowsHasMore: true,
    isLoading: true,
    isNextPageLoading: false,
    isMembersLoading: false,
    isBorrowsLoading: false
};

export function initAdmin() {
    // Listen for Auth changes (modern Firebase approach)
    onAuthStateChanged(auth, (user) => {
        if (user) {
            const adminEmail = 'navodhayamlibraryamarakuni@gmail.com';
            if (user.email === adminEmail) {
                showApp();
            } else {
                console.warn("Unauthorized login attempt:", user.email);
                showAlertModal("Access Denied. This account is not authorized to access the Librarian Portal.", "Unauthorized");
                auth.signOut();
                showLogin();
            }
        } else {
            showLogin();
        }
    });

    // Google Login Button Listener
    const googleBtn = document.getElementById('admin-google-login');
    if (googleBtn) {
        googleBtn.addEventListener('click', async () => {
            try {
                await signInWithPopup(auth, googleProvider);
            } catch (error) {
                console.error("Google Sign-In Error:", error);
                showAlertModal("Failed to sign in with Google. " + error.message, "Sign-in Error");
            }
        });
    }
}

function showLogin() {
    document.getElementById('admin-login-screen').style.display = 'flex';
    document.getElementById('admin-app').style.display = 'none';
    document.getElementById('header-logout-btn').style.display = 'none';
}

function showApp() {
    document.getElementById('admin-login-screen').style.display = 'none';
    const isDesktop = window.matchMedia('(min-width: 1024px)').matches;
    document.getElementById('admin-app').style.display = isDesktop ? 'grid' : 'flex';
    document.getElementById('header-logout-btn').style.display = 'flex';
    // Keep layout correct on resize
    window.addEventListener('resize', () => {
        const adminApp = document.getElementById('admin-app');
        if (adminApp && adminApp.style.display !== 'none') {
            adminApp.style.display = window.matchMedia('(min-width: 1024px)').matches ? 'grid' : 'flex';
        }
    }, { passive: true });
    setupListeners();
    setupDataListeners();
    lucide.createIcons();
}

window.logout = function () {
    signOut(auth).then(() => {
        window.location.reload();
    });
};

function setupListeners() {
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            navigateTo(item.dataset.target);
        });
    });

    // Hidden Sync Toggle: Tap title 3 times
    const title = document.getElementById('header-title');
    if (title) {
        title.addEventListener('click', () => {
            const now = Date.now();
            if (now - lastSyncClickTime > 1000) syncClickCount = 0; // Reset if > 1s gap
            syncClickCount++;
            lastSyncClickTime = now;

            if (syncClickCount === 3) {
                const container = document.getElementById('sync-progress-container');
                if (container) {
                    container.style.display = 'block';
                    showAlertModal("Sync details revealed!", "Debug Mode");
                }
            }
        });
    }

    // Category Filter Chips Listener
    const filterContainer = document.getElementById('admin-category-filter');
    if (filterContainer) {
        filterContainer.addEventListener('click', (e) => {
            const chip = e.target.closest('.filter-chip');
            if (!chip) return;

            filterContainer.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');

            adminCategoryFilter = chip.dataset.category;
            resetPagination();
            fetchBooksBatch();
        });
    }

    // Requests View Sub-Navigation
    const requestsSubNav = document.getElementById('requests-sub-nav');
    if (requestsSubNav) {
        requestsSubNav.addEventListener('click', (e) => {
            const chip = e.target.closest('.sub-nav-chip');
            if (!chip) return;

            const targetSub = chip.dataset.sub;
            switchRequestSubView(targetSub);
        });
    }

    // Members View Sub-Navigation
    const membersSubNav = document.getElementById('members-sub-nav');
    if (membersSubNav) {
        membersSubNav.addEventListener('click', (e) => {
            const chip = e.target.closest('.sub-nav-chip');
            if (!chip) return;

            const targetSub = chip.dataset.sub;
            switchMembersSubView(targetSub);
        });
    }
}

function setupDataListeners() {
    // Listen for PENDING requests (Real-time, small subset)
    const pq = query(collection(db, "requests"), where("status", "==", "pending"), limit(50));
    onSnapshot(pq, (snapshot) => {
        const pendings = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

        const others = libraryData.requests.filter(r => r.status !== 'pending');
        libraryData.requests = [...pendings, ...others];
        if (currentView === 'requests-view') renderRequests();
    }, (error) => {
        console.error("PENDING Requests Listener Error:", error);
        const list = document.getElementById('pending-list');
        if (list) list.innerHTML = `<p style="color:var(--danger-color); text-align:center;">Error loading requests: ${error.message}</p>`;
    });

    // Initial fetch for HISTORY (Borrowed/Returned) - Paginated
    fetchBorrowsBatch();

    // Listen for PENDING members (Real-time)
    const pmq = query(collection(db, "members"), where("status", "==", "pending"), limit(50));
    onSnapshot(pmq, (snapshot) => {
        const pendings = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

        const others = libraryData.members.filter(m => m.status !== 'pending');
        libraryData.members = [...pendings, ...others];
        if (currentView === 'members-view') renderMembers();
    }, (error) => {
        console.error("PENDING Members Listener Error:", error);
        const pendingList = document.getElementById('pending-members-list');
        if (pendingList) pendingList.innerHTML = `<p style="color:var(--danger-color); text-align:center;">Error loading pending members: ${error.message}</p>`;
    });

    // Initial fetch for APPROVED members - Paginated
    fetchMembersBatch();

    // Initial fetch for BOOKS - Paginated
    fetchBooksBatch();

    // Listen for Cloud Sync Progress (from Sheets)
    setupSyncProgress();
}

function setupSyncProgress() {
    console.log("Setting up sync progress listener...");
    const syncDoc = doc(db, "metadata", "sync_stats");
    onSnapshot(syncDoc, (snapshot) => {
        const container = document.getElementById('sync-progress-container');
        const bar = document.getElementById('sync-progress-bar');
        const text = document.getElementById('sync-count-text');
        const msg = document.getElementById('sync-status-msg');
        const iconDiv = document.getElementById('sync-icon');
        const percentDiv = document.getElementById('sync-percent-text');

        if (!snapshot.exists()) {
            console.warn("Sync stats document does not exist in Firestore.");
            if (syncClickCount >= 3 && msg) {
                msg.textContent = "Waiting for first sync run from Google Sheets...";
            }
            return;
        }

        const data = snapshot.data();
        console.log("Sync data received:", data);

        const synced = parseInt(data.synced_books) || 0;
        const total = parseInt(data.total_books) || 0;
        const left = Math.max(0, total - synced);

        if (container) {
            // Only show if we have the 3-tap secret
            if (syncClickCount >= 3) {
                container.style.display = 'block';
            }

            if (total > 0) {
                const percent = Math.min(100, Math.floor((synced / total) * 100));
                if (bar) bar.style.width = `${percent}%`;
                if (percentDiv) percentDiv.textContent = `${percent}%`;

                if (percent < 100) {
                    if (text) text.innerHTML = `<span style="color:var(--primary-color)">${synced.toLocaleString()}</span> synced | <span style="color:var(--danger-color)">${left.toLocaleString()}</span> left`;
                    if (msg) msg.textContent = `Syncing from Google Sheets... Last activity: ${data.last_run ? new Date(data.last_run).toLocaleTimeString() : 'Just now'}`;
                    if (iconDiv) {
                        iconDiv.innerHTML = '<i data-lucide="refresh-cw" class="lucide-spin"></i>';
                        iconDiv.style.color = 'var(--primary-color)';
                    }
                } else {
                    if (text) text.textContent = `${total.toLocaleString()} Books Total`;
                    if (msg) msg.innerHTML = '<span style="color:var(--success-color); font-weight:700;">✓ Database Fully Synced</span>. All records from Sheets are in Firestore.';
                    if (iconDiv) {
                        iconDiv.style.color = 'var(--success-color)';
                        iconDiv.innerHTML = '<i data-lucide="check-circle"></i>';
                    }
                    if (percentDiv) percentDiv.style.color = 'var(--success-color)';
                }
            } else {
                if (msg) msg.textContent = "Total books count is 0. Check Google Sheets connection.";
            }
            lucide.createIcons();
        }
    });
}

function navigateTo(viewId) {
    views.forEach(view => view.classList.remove('active-view'));
    const target = document.getElementById(viewId);
    if (target) {
        target.classList.add('active-view');
        // Reset scroll position to top when switching views in admin
        target.scrollTop = 0;
    }
    currentView = viewId;

    if (viewId === 'requests-view') {
        switchRequestSubView(currentRequestSubView);
        renderRequests();
        renderBorrows();
    } else if (viewId === 'inventory-view') {
        renderInventory();
    } else if (viewId === 'members-view') {
        switchMembersSubView(currentMembersSubView);
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
        // Resolve Member ID from request or lookup from members list
        const member = libraryData.members.find(m => m.email === req.userEmail || m.uid === req.uid);
        const resolvedMemberId = req.memberId && req.memberId !== 'N/A' ? req.memberId : (member ? member.memberId : 'N/A');

        const card = document.createElement('div');
        card.className = 'book-card req-card';
        card.innerHTML = `
            <div class="req-header">
                <span class="req-user">${req.userName}</span>
                <span>${req.timestamp ? new Date(req.timestamp.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '...'}</span>
            </div>
            <div class="req-info" style="margin-bottom:20px;">
                <div class="book-img-placeholder" style="width:50px; height:70px;"><i data-lucide="book" style="width:24px; height:24px;"></i></div>
                <div class="book-info">
                    <h3 class="book-title" style="font-size:16px; margin:0;">${req.bookTitle}</h3>
                    <p style="font-size:12px; color:var(--text-muted); margin:4px 0 0 0;">Member ID: <span style="font-weight:700; color:var(--primary-color);">${resolvedMemberId}</span></p>
                    <p style="font-size:11px; color:var(--text-muted); margin:2px 0 0 0;">Phone: ${req.userPhone || 'N/A'}</p>
                </div>
            </div>
            <div class="req-actions" style="display:flex; flex-direction:column; gap:12px;">
                <button class="btn btn-primary" style="padding:14px; font-weight:700; width:100%; display:flex; align-items:center; justify-content:center; gap:8px;" id="scan-${req.id}">
                    <i data-lucide="scan-line" style="width:18px; height:18px;"></i> Scan to Approve
                </button>
                <div style="display:flex; gap:12px;">
                    <button class="btn btn-success" style="flex:1; padding:10px; font-size:12px; font-weight:600;" id="approve-${req.id}">Manual Approve</button>
                    <button class="btn btn-danger-soft" style="flex:1; padding:10px; font-size:12px; font-weight:600;" id="reject-${req.id}">Reject</button>
                </div>
            </div>
        `;
        list.appendChild(card);
        card.querySelector(`#scan-${req.id}`).onclick = () => openScanner(req.id, resolvedMemberId, req.bookId);
        card.querySelector(`#approve-${req.id}`).onclick = () => updateRequestStatus(req.id, 'borrowed', req.bookId);
        card.querySelector(`#reject-${req.id}`).onclick = () => {
            if (confirm("Reject this book request? The record will be removed.")) {
                updateRequestStatus(req.id, 'rejected', req.bookId);
            }
        };
    });
    lucide.createIcons();
}

function renderBorrows() {
    const list = document.getElementById('borrowed-list');
    const pagination = document.getElementById('borrows-pagination');
    const historyList = document.getElementById('history-list');
    const historyPagination = document.getElementById('borrows-pagination'); // Using same pagination container for now, placed at bottom

    list.innerHTML = '';
    if (historyList) historyList.innerHTML = '';

    const activeBorrows = libraryData.requests.filter(r => r.status === 'borrowed');
    const historyBorrows = libraryData.requests.filter(r => r.status === 'returned');

    if (activeBorrows.length === 0 && !libraryData.isBorrowsLoading) {
        list.innerHTML = '<p style="color:var(--text-secondary); text-align:center;">No active borrows.</p>';
    }

    if (historyBorrows.length === 0 && !libraryData.isBorrowsLoading) {
        if (historyList) historyList.innerHTML = '<p style="color:var(--text-secondary); text-align:center;">No history found.</p>';
    }

    activeBorrows.forEach(req => {
        const card = document.createElement('div');
        card.className = 'book-card req-card';
        card.innerHTML = `
            <div class="req-header">
                <span><strong>${req.userName}</strong></span>
                <span style="color:var(--success-color);">In Progress</span>
            </div>
            <div class="req-body">
                <div class="book-info">
                    <h3 class="book-title" style="font-size:14px; margin-bottom:4px;">${req.bookTitle}</h3>
                    <p style="font-size:11px; color:var(--text-muted); margin:0;">Phone: ${req.userPhone || 'N/A'}</p>
                </div>
            </div>
            <div class="req-actions" style="display:flex; margin-top:12px;">
                <button class="btn" style="background:var(--bg-color); color:var(--text-secondary); padding: 10px 18px; font-size:13px; font-weight:700; flex:1; border-radius:12px; border:1px solid var(--border-color); transition: all 0.2s;" id="return-${req.id}">Mark Returned</button>
            </div>
        `;
        list.appendChild(card);
        card.querySelector(`#return-${req.id}`).onclick = () => updateRequestStatus(req.id, 'returned', req.bookId);
    });

    if (historyList) {
        historyBorrows.forEach(req => {
            const card = document.createElement('div');
            card.className = 'book-card';
            card.style.padding = '12px 16px';
            card.style.marginBottom = '8px';
            card.style.gap = '12px';
            card.style.alignItems = 'center';

            card.innerHTML = `
                <div style="flex: 1; min-width: 0;">
                    <h3 style="font-size: 14px; font-weight: 700; margin: 0 0 2px 0; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${req.bookTitle}</h3>
                    <div style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-muted);">
                        <span style="font-weight: 600; color: var(--primary-light);">${req.userName}</span>
                        <span>•</span>
                        <span>${req.userPhone || 'N/A'}</span>
                    </div>
                </div>
                <button class="btn btn-danger-soft" style="width: 36px; height: 36px; padding: 0; border-radius: 10px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;" id="delete-hist-${req.id}" title="Delete Record">
                    <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
                </button>
            `;
            historyList.appendChild(card);
            card.querySelector(`#delete-hist-${req.id}`).onclick = () => window.deleteHistoryRecord(req.id);
        });
    }

    // Render Load More button at the bottom of history
    if (libraryData.borrowsHasMore) {
        if (historyPagination) {
            historyPagination.innerHTML = `
                <button class="btn btn-load-more w-100" id="load-more-borrows" ${libraryData.isBorrowsLoading ? 'disabled' : ''}>
                    ${libraryData.isBorrowsLoading ? '<span class="spinner-small"></span> Loading...' : '<i data-lucide="plus-circle"></i> Load More History'}
                </button>
            `;
            historyPagination.querySelector('#load-more-borrows').onclick = fetchBorrowsBatch;
        }
    } else {
        if (historyPagination) {
            historyPagination.innerHTML = libraryData.requests.length > 0 ? '<p style="text-align:center; color:var(--text-muted); font-size:12px; margin:20px 0;">End of history.</p>' : '';
        }
    }

    lucide.createIcons();
}

async function fetchBorrowsBatch() {
    if (libraryData.isBorrowsLoading || !libraryData.borrowsHasMore) return;

    libraryData.isBorrowsLoading = true;
    renderBorrows();

    const batchSize = 10;
    try {
        let q = query(
            collection(db, "requests"),
            where("status", "in", ["borrowed", "returned"]),
            orderBy("timestamp", "desc"),
            limit(batchSize)
        );

        if (libraryData.borrowsLastVisible) {
            q = query(q, startAfter(libraryData.borrowsLastVisible));
        }

        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            libraryData.borrowsHasMore = false;
        } else {
            const newRequests = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            // Avoid duplicates
            newRequests.forEach(nr => {
                if (!libraryData.requests.find(r => r.id === nr.id)) {
                    libraryData.requests.push(nr);
                }
            });
            libraryData.borrowsLastVisible = snapshot.docs[snapshot.docs.length - 1];
            if (snapshot.docs.length < batchSize) libraryData.borrowsHasMore = false;
        }
    } catch (e) {
        console.error("Error fetching borrows:", e);
        const list = document.getElementById('borrowed-list');
        if (list) list.innerHTML = `<p style="color:var(--danger-color); text-align:center;">Error fetching history: ${e.message}</p>`;
    } finally {
        libraryData.isBorrowsLoading = false;
        renderBorrows();
    }
}

function renderMembers() {
    const pendingList = document.getElementById('pending-members-list');
    const approvedList = document.getElementById('approved-members-list');
    const pagination = document.getElementById('members-pagination');
    if (!pendingList || !approvedList) return;

    pendingList.innerHTML = '';
    approvedList.innerHTML = '';

    const pendings = libraryData.members.filter(m => m.status === 'pending');
    const approved = libraryData.members.filter(m => m.status === 'approved');

    // 🔥 Sort numerically (1, 2, 3...) instead of lexicographically (1, 10, 2)
    const sortById = (a, b) => {
        const idA = parseInt(a.memberId || 0);
        const idB = parseInt(b.memberId || 0);
        return idA - idB;
    };

    pendings.sort(sortById);
    approved.sort(sortById);

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
                    ${m.photoURL ? `<img src="${m.photoURL}" style="width:50px; height:50px; border-radius:50%; object-fit:cover;">` : `<div class="book-img-placeholder" style="width:50px; height:50px; border-radius:50%;"><svg class="lucide" style="width:24px; height:24px;"><use href="#icon-users"/></svg></div>`}
                    <div class="book-info">
                        <p style="font-size:14px; margin:0;">Phone: ${m.phone}</p>
                        <p style="font-size:12px; color:var(--text-muted); margin:4px 0 0 0;">Address: ${m.address}</p>
                    </div>
                </div>
                <div class="req-actions" style="display:flex; gap:12px;">
                    <button class="btn btn-success" style="flex:1; padding:12px; font-weight:700;" id="approve-mem-${m.id}">Approve</button>
                    <button class="btn btn-danger-soft" style="flex:1; padding:12px; font-weight:700;" id="reject-mem-${m.id}">Reject</button>
                </div>
            `;
            pendingList.appendChild(card);

            // Attach event listeners via JS for reliable scoping
            card.querySelector(`#approve-mem-${m.id}`).onclick = (e) => {
                e.stopPropagation();
                window.approveMember(m.id);
            };
            card.querySelector(`#reject-mem-${m.id}`).onclick = (e) => {
                e.stopPropagation();
                window.rejectMember(m.id);
            };

            card.onclick = (e) => {
                if (!e.target.closest('button')) showMemberDetail(m.id);
            };
        });
    }

    if (approved.length === 0 && !libraryData.isMembersLoading) {
        approvedList.innerHTML = '<p style="color:var(--text-secondary); text-align:center;">No approved members yet.</p>';
        pagination.innerHTML = '';
    } else {
        approved.forEach(m => {
            const card = document.createElement('div');
            card.className = 'book-card req-card';
            card.style.cursor = 'pointer';
            card.innerHTML = `
                <div class="req-header">
                    <span class="req-user">${m.name}</span>
                    <span style="color:var(--success-color);">Active</span>
                </div>
                <div class="req-info">
                    ${m.photoURL ? `<img src="${m.photoURL}" style="width:50px; height:50px; border-radius:50%; object-fit:cover;">` : `<div class="book-img-placeholder" style="width:50px; height:50px; border-radius:50%;"><svg class="lucide" style="width:24px; height:24px;"><use href="#icon-users"/></svg></div>`}
                    <div class="book-info">
                        <p style="font-size:14px; margin:0; font-weight:bold;">ID: ${m.memberId}</p>
                        <p style="font-size:12px; color:var(--text-muted); margin:4px 0 0 0;">Phone: ${m.phone}</p>
                    </div>
                </div>
            `;
            approvedList.appendChild(card);
            card.onclick = () => showMemberDetail(m.id);
        });
    }

    // Render Load More button for members
    if (libraryData.membersHasMore) {
        pagination.innerHTML = `
            <button class="btn btn-load-more w-100" id="load-more-members" ${libraryData.isMembersLoading ? 'disabled' : ''}>
                ${libraryData.isMembersLoading ? '<span class="spinner-small"></span> Loading...' : '<i data-lucide="plus-circle"></i> Load More Members'}
            </button>
        `;
        pagination.querySelector('#load-more-members').onclick = fetchMembersBatch;
    } else {
        pagination.innerHTML = approved.length > 0 ? '<p style="text-align:center; color:var(--text-muted); font-size:12px; margin:20px 0;">End of member list.</p>' : '';
    }

    lucide.createIcons();
}

async function fetchMembersBatch() {
    if (libraryData.isMembersLoading || !libraryData.membersHasMore) return;

    libraryData.isMembersLoading = true;
    renderMembers();

    const batchSize = 500;
    try {
        let q = query(
            collection(db, "members"),
            where("status", "==", "approved"),
            limit(batchSize)
        );

        if (libraryData.membersLastVisible) {
            q = query(q, startAfter(libraryData.membersLastVisible));
        }

        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            libraryData.membersHasMore = false;
        } else {
            const newMembers = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            newMembers.forEach(nm => {
                if (!libraryData.members.find(m => m.id === nm.id)) {
                    libraryData.members.push(nm);
                }
            });
            libraryData.membersLastVisible = snapshot.docs[snapshot.docs.length - 1];
            if (snapshot.docs.length < batchSize) libraryData.membersHasMore = false;
        }
    } catch (e) {
        console.error("Error fetching members:", e);
        const approvedList = document.getElementById('approved-members-list');
        if (approvedList) approvedList.innerHTML = `<p style="color:var(--danger-color); text-align:center;">Error fetching members: ${e.message}</p>`;
    } finally {
        libraryData.isMembersLoading = false;
        renderMembers();
    }
}

window.showMemberDetail = function (memberId) {
    const m = libraryData.members.find(mem => mem.id === memberId);
    if (!m) return;

    const modal = document.getElementById('member-detail-modal');
    const content = document.getElementById('member-detail-content');

    const statusBadge = m.status === 'approved'
        ? '<span style="background:#ecfdf5; color:#059669; padding:4px 12px; border-radius:20px; font-size:11px; font-weight:800; text-transform:uppercase;">Active Member</span>'
        : '<span style="background:#fff7ed; color:#9a3412; padding:4px 12px; border-radius:20px; font-size:11px; font-weight:800; text-transform:uppercase;">Pending Approval</span>';

    const memberRequests = libraryData.requests ? libraryData.requests.filter(req => {
        const emailMatch = Boolean(m.email && m.email !== "" && m.email !== "N/A" && req.userEmail === m.email);
        const uidMatch = Boolean(m.uid && m.uid !== "" && (req.uid === m.uid || req.userId === m.uid));
        const memberIdMatch = Boolean(m.memberId && m.memberId !== "" && m.memberId !== "N/A" && req.memberId && req.memberId.toString() === m.memberId.toString());
        return emailMatch || uidMatch || memberIdMatch;
    }) : [];
    memberRequests.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

    let historyHtml = '<div style="margin-top: 32px; border-top: 1px solid var(--border-color); padding-top: 24px;"><h3 style="font-size: 16px; font-weight: 800; color: var(--text-primary); margin-bottom: 16px;"><i data-lucide="history" style="width:18px; height:18px; margin-right:8px; vertical-align:middle; display:inline-block;"></i>Borrowing History</h3>';
    if (memberRequests.length === 0) {
        historyHtml += '<p style="color: var(--text-secondary); font-size: 14px; text-align: center; padding: 24px; background: #f8fafc; border-radius: 12px;">No borrowing history found.</p>';
    } else {
        memberRequests.forEach(req => {
            const reqDate = req.timestamp ? new Date(req.timestamp.seconds * 1000).toLocaleDateString() : 'N/A';

            let statusColor = '#94a3b8';
            let statusBg = '#f1f5f9';
            let statusText = req.status;
            if (req.status === 'borrowed') { statusColor = '#d97706'; statusBg = '#fef3c7'; statusText = 'Borrowing'; }
            if (req.status === 'returned') { statusColor = '#059669'; statusBg = '#dcfce7'; statusText = 'Returned'; }
            if (req.status === 'pending') { statusColor = '#2563eb'; statusBg = '#dbeafe'; statusText = 'Pending'; }
            if (req.status === 'rejected') { statusColor = '#dc2626'; statusBg = '#fee2e2'; statusText = 'Rejected'; }

            historyHtml += `
                <div style="padding: 16px; border: 1px solid var(--border-color); border-radius: 12px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; background: white;">
                    <div style="flex: 1; min-width: 0;">
                        <p style="margin: 0; font-weight: 700; font-size: 14px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${req.bookTitle}</p>
                        <p style="margin: 4px 0 0 0; font-size: 12px; color: var(--text-secondary);"><i data-lucide="calendar" style="width:12px; height:12px; display:inline-block; vertical-align:middle; margin-right:4px;"></i>${reqDate}</p>
                    </div>
                    <div style="margin-left: 12px; flex-shrink: 0;">
                        <span style="font-size: 11px; font-weight: 700; color: ${statusColor}; background: ${statusBg}; padding: 4px 10px; border-radius: 12px; text-transform: uppercase;">${statusText}</span>
                    </div>
                </div>
            `;
        });
    }
    historyHtml += '</div>';

    content.innerHTML = `
        <div style="text-align: center; margin-bottom: 24px;">
            ${m.photoURL ? `<img src="${m.photoURL}" style="width: 80px; height: 80px; border-radius: 50%; object-fit: cover; margin: 0 auto 16px; border: 3px solid var(--primary-light);">` : `<div style="width: 80px; height: 80px; background: var(--bg-color); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; color: var(--primary-color);">
                <svg class="lucide" style="width: 40px; height: 40px;"><use href="#icon-users"/></svg>
            </div>`}
            <h2 style="font-size: 24px; font-weight: 800; color: var(--text-primary); margin-bottom: 8px;">${m.name}</h2>
            ${statusBadge}
        </div>

        <div style="display: flex; flex-direction: column; gap: 20px; padding-bottom: 40px;">
            ${m.memberId ? `
            <div style="display: flex; align-items: center; gap: 16px; padding: 16px; background: #f8fafc; border-radius: 16px; border: 1px solid var(--border-color);">
                <div style="color: var(--primary-color);"><svg class="lucide" style="width:24px; height:24px;"><use href="#icon-lock"/></svg></div>
                <div>
                    <p style="font-size: 11px; font-weight: 800; color: var(--text-muted); text-transform: uppercase; margin-bottom: 2px;">Member ID</p>
                    <p style="font-size: 16px; font-weight: 700; color: var(--text-primary);">${m.memberId}</p>
                </div>
            </div>` : ''}

            <div style="display: flex; align-items: center; gap: 16px; padding: 16px; background: #f8fafc; border-radius: 16px; border: 1px solid var(--border-color);">
                <div style="color: var(--primary-color);"><svg class="lucide" style="width:24px; height:24px;"><use href="#icon-phone"/></svg></div>
                <div>
                    <p style="font-size: 11px; font-weight: 800; color: var(--text-muted); text-transform: uppercase; margin-bottom: 2px;">Phone Number</p>
                    <p style="font-size: 16px; font-weight: 700; color: var(--text-primary);">${m.phone}</p>
                </div>
            </div>

            <div style="display: flex; align-items: center; gap: 16px; padding: 16px; background: #f8fafc; border-radius: 16px; border: 1px solid var(--border-color);">
                <div style="color: var(--primary-color);"><svg class="lucide" style="width:24px; height:24px;"><use href="#icon-mail"/></svg></div>
                <div>
                    <p style="font-size: 11px; font-weight: 800; color: var(--text-muted); text-transform: uppercase; margin-bottom: 2px;">Email Address</p>
                    <p style="font-size: 16px; font-weight: 700; color: var(--text-primary); text-break: break-all;">${m.email || 'N/A'}</p>
                </div>
            </div>

            <div style="display: flex; align-items: center; gap: 16px; padding: 16px; background: #f8fafc; border-radius: 16px; border: 1px solid var(--border-color);">
                <div style="color: var(--primary-color);"><svg class="lucide" style="width:24px; height:24px;"><use href="#icon-map-pin"/></svg></div>
                <div>
                    <p style="font-size: 11px; font-weight: 800; color: var(--text-muted); text-transform: uppercase; margin-bottom: 2px;">Residential Address</p>
                    <p style="font-size: 15px; font-weight: 500; color: var(--text-primary); line-height: 1.4;">${m.address}</p>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: #f8fafc; border-radius: 12px; border: 1px solid var(--border-color);">
                    <div>
                        <p style="font-size: 10px; font-weight: 800; color: var(--text-muted); text-transform: uppercase; margin-bottom: 2px;">Age</p>
                        <p style="font-size: 14px; font-weight: 700; color: var(--text-primary);">${m.age || 'N/A'}</p>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: #f8fafc; border-radius: 12px; border: 1px solid var(--border-color);">
                    <div>
                        <p style="font-size: 10px; font-weight: 800; color: var(--text-muted); text-transform: uppercase; margin-bottom: 2px;">Blood</p>
                        <p style="font-size: 14px; font-weight: 700; color: var(--text-primary);">${m.bloodGroup || 'N/A'}</p>
                    </div>
                </div>
            </div>

            <div style="display: flex; align-items: center; gap: 16px; padding: 16px; background: #f8fafc; border-radius: 16px; border: 1px solid var(--border-color);">
                <div style="color: var(--primary-color);"><svg class="lucide" style="width:24px; height:24px;"><use href="#icon-users"/></svg></div>
                <div>
                    <p style="font-size: 11px; font-weight: 800; color: var(--text-muted); text-transform: uppercase; margin-bottom: 2px;">Recommender</p>
                    <p style="font-size: 15px; font-weight: 500; color: var(--text-primary);">${m.recommender || 'Direct Application'}</p>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: #f8fafc; border-radius: 12px; border: 1px solid var(--border-color);">
                    <div>
                        <p style="font-size: 10px; font-weight: 800; color: var(--text-muted); text-transform: uppercase; margin-bottom: 2px;">Joined</p>
                        <p style="font-size: 14px; font-weight: 700; color: var(--text-primary);">${m.joiningDate || 'N/A'}</p>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: #f8fafc; border-radius: 12px; border: 1px solid var(--border-color);">
                    <div>
                        <p style="font-size: 10px; font-weight: 800; color: var(--text-muted); text-transform: uppercase; margin-bottom: 2px;">Deposit</p>
                        <p style="font-size: 14px; font-weight: 700; color: var(--text-primary);">₹${m.deposit || '0'}</p>
                    </div>
                </div>
            </div>

            <div style="display: flex; align-items: center; gap: 16px; padding: 16px; background: #f8fafc; border-radius: 16px; border: 1px solid var(--border-color);">
                <div style="color: var(--primary-color);"><svg class="lucide" style="width:24px; height:24px;"><use href="#icon-calendar"/></svg></div>
                <div>
                    <p style="font-size: 11px; font-weight: 800; color: var(--text-muted); text-transform: uppercase; margin-bottom: 2px;">Submission Date</p>
                    <p style="font-size: 15px; font-weight: 500; color: var(--text-primary);">${m.timestamp ? new Date(m.timestamp.seconds * 1000).toLocaleString() : 'N/A'}</p>
                </div>
            </div>
        </div>

        ${historyHtml}

        ${m.status === 'approved' ? `
        <div style="margin-top: 32px;">
            <button class="btn btn-primary w-100" style="padding: 16px; background: #083344;" onclick="printMemberCard('${m.id}')">
                <svg class="lucide" style="width:20px; height:20px; margin-right:8px;"><use href="#icon-calendar"/></svg>
                Print Library Card (PDF)
            </button>
        </div>` : ''}

        ${m.status === 'pending' ? `
        <div style="display: flex; gap: 12px; margin-top: 32px;">
            <button class="btn btn-success" style="flex: 1; padding: 16px;" onclick="handleApproveFromDetail('${m.id}')">Approve Member</button>
            <button class="btn btn-danger-soft" style="flex: 1; padding: 16px;" onclick="handleRejectFromDetail('${m.id}')">Reject</button>
        </div>` : ''}
    `;

    modal.style.display = 'flex';
    lucide.createIcons();
};

window.printMemberCard = function (memberId) {
    const m = libraryData.members.find(mem => mem.id === memberId);
    if (!m) return;

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
                <svg id="print-barcode"></svg>
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
            JsBarcode("#print-barcode", m.memberId, {
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

window.closeMemberDetail = function () {
    document.getElementById('member-detail-modal').style.display = 'none';
};

window.handleApproveFromDetail = async function (id) {
    await window.approveMember(id);
    closeMemberDetail();
};

window.handleRejectFromDetail = async function (id) {
    await window.rejectMember(id);
    closeMemberDetail();
};

window.approveMember = async function (id) {
    try {
        // Fetch current max ID to generate next sequential ID
        // Note: In a high-concurrency environment, a transaction would be better
        const q = query(collection(db, "members"), orderBy("memberId", "desc"), limit(1));
        const snap = await getDocs(q);
        let nextId = 1;

        if (!snap.empty) {
            const lastMemberId = snap.docs[0].data().memberId;
            if (lastMemberId && !isNaN(lastMemberId)) {
                nextId = parseInt(lastMemberId) + 1;
            }
        }

        const newDocId = `MEM_${nextId}`;
        const newDocRef = doc(db, "members", newDocId);
        const oldDocRef = doc(db, "members", id);

        const oldDocSnap = await getDoc(oldDocRef);
        if (!oldDocSnap.exists()) {
            throw new Error("Pending member document not found.");
        }

        const memberData = oldDocSnap.data();

        const newMemberData = {
            ...memberData,
            status: 'approved',
            memberId: String(nextId),
            last_updated: serverTimestamp(),
            source: 'web'
        };

        // Update local cache instantly
        libraryData.members = libraryData.members.filter(m => m.id !== id);
        libraryData.members.push({ id: newDocId, ...newMemberData, timestamp: memberData.timestamp || { seconds: Date.now() / 1000 } });
        if (currentView === 'members-view') renderMembers();

        await setDoc(newDocRef, newMemberData);

        await deleteDoc(oldDocRef);

        showAlertModal(`Member approved successfully! Assigned ID: ${nextId}`, "Success");
    } catch (e) {
        console.error("Error approving:", e);
        showAlertModal("Failed to approve member. Check console for details.", "Error");
    }
};

window.rejectMember = async function (id) {
    if (confirm("Reject this application?")) {
        try {
            // Update local cache instantly
            libraryData.members = libraryData.members.filter(m => m.id !== id);
            if (currentView === 'members-view') renderMembers();

            await deleteDoc(doc(db, "members", id));
            showAlertModal("Application rejected and removed.", "Success");
        } catch (e) {
            console.error(e);
            showAlertModal("Failed to reject member.", "Error");
        }
    }
};

async function updateRequestStatus(reqId, newStatus, bookId) {
    try {
        // Update locally for instant UI update and to prevent onSnapshot race condition
        const reqIndex = libraryData.requests.findIndex(r => r.id === reqId);
        if (reqIndex !== -1) {
            libraryData.requests[reqIndex].status = newStatus;
            if (currentView === 'requests-view') {
                renderRequests();
                renderBorrows();
            }
        }

        if (newStatus === 'rejected') {
            await deleteDoc(doc(db, "requests", reqId));
        } else {
            await updateDoc(doc(db, "requests", reqId), { status: newStatus });
        }

        // If borrowed, mark book unavailable. If returned/rejected, mark available.
        const available = (newStatus !== 'borrowed');
        if (newStatus === 'borrowed' || newStatus === 'returned' || newStatus === 'rejected') {
            await updateDoc(doc(db, "books", bookId), { available: available });

            // Update book locally
            const bookIdx = libraryData.books.findIndex(b => b.id === bookId);
            if (bookIdx !== -1) {
                libraryData.books[bookIdx].available = available;
                if (currentView === 'inventory-view') renderInventory();
            }
        }
    } catch (e) {
        console.error(e);
    }
}

function renderInventory() {
    const list = document.getElementById('inventory-list');
    list.innerHTML = '';

    const filteredBooks = libraryData.books.filter(book => {
        if (adminCategoryFilter === 'All') return true;
        const bookCat = book.category || book.section || 'Other';
        return bookCat === adminCategoryFilter;
    });

    if (filteredBooks.length === 0) {
        list.innerHTML = `<p style="text-align:center; color:var(--text-muted); padding:40px;">No books found in "${adminCategoryFilter}" collection.</p>`;
        return;
    }

    filteredBooks.forEach(book => {
        const category = book.category || book.section || 'N/A';
        const shelf = book.shelf_number || book.shelf || 'N/A';

        const card = document.createElement('div');
        card.className = 'book-card';
        card.style.alignItems = 'center';
        card.innerHTML = `
            <div class="book-img-placeholder" style="width:60px; height:80px; position:relative;">
                <i data-lucide="book" style="width:28px; height:28px;"></i>
                <span style="position:absolute; bottom:4px; right:4px; font-size:9px; font-weight:800; color:var(--text-muted); opacity:0.5;">#${book.stock_number || '---'}</span>
            </div>
            <div class="book-info">
                <h3 class="book-title" style="font-size:16px;">${book.title}</h3>
                <p class="book-author" style="font-size:13px; margin-bottom:4px;">${book.author}</p>
                <div style="font-size:11px; color:var(--text-muted); margin-bottom:8px;">
                    <span style="background:var(--bg-color); padding:2px 6px; border-radius:4px;">${category}</span>
                    <span style="background:var(--bg-color); padding:2px 6px; border-radius:4px;">Shelf ${shelf}</span>
                    <span style="background:var(--bg-color); padding:2px 6px; border-radius:4px;">${getLanguageName(book.language)}</span>
                </div>
                <span class="status-badge ${book.available !== false ? 'status-available' : 'status-borrowed'}">
                    ${book.available !== false ? 'Available' : 'Unavailable'}
                </span>
            </div>
            <div style="display:flex; gap:8px; margin-left: auto; flex-shrink: 0;">
                <button class="edit-book-btn" id="edit-${book.id}" title="Edit"><i data-lucide="edit"></i></button>
                <button class="delete-book-btn" id="delete-${book.id}" title="Delete"><i data-lucide="trash-2"></i></button>
            </div>
        `;
        list.appendChild(card);
        card.querySelector(`#edit-${book.id}`).onclick = () => openBookForm(book.id);
        card.querySelector(`#delete-${book.id}`).onclick = () => deleteBook(book.id);
    });

    // Add Load More button
    if (libraryData.hasMore) {
        const loadMoreBtn = document.createElement('button');
        loadMoreBtn.className = 'btn btn-load-more w-100';
        loadMoreBtn.style.marginTop = '20px';
        loadMoreBtn.style.marginBottom = '20px';

        if (libraryData.isNextPageLoading) {
            loadMoreBtn.innerHTML = '<span class="spinner-small"></span> Loading...';
            loadMoreBtn.disabled = true;
        } else {
            loadMoreBtn.innerHTML = '<i data-lucide="plus-circle"></i> Load More Books';
            loadMoreBtn.onclick = window.loadMoreBooks;
        }

        list.appendChild(loadMoreBtn);
    } else if (libraryData.books.length > 0) {
        const endMessage = document.createElement('p');
        endMessage.style.textAlign = 'center';
        endMessage.style.color = 'var(--text-muted)';
        endMessage.style.fontSize = '12px';
        endMessage.style.margin = '32px 0';
        endMessage.innerHTML = 'You\'ve reached the end of the collection.';
        list.appendChild(endMessage);
    }
    lucide.createIcons();
}

window.resetPagination = function () {
    libraryData.books = [];
    libraryData.lastVisible = null;
    libraryData.hasMore = true;
    libraryData.isLoading = true;
};

window.fetchBooksBatch = async function () {
    const batchSize = 10;
    try {
        let q;
        if (adminCategoryFilter === 'All') {
            q = query(
                collection(db, "books"),
                orderBy("last_updated", "desc"),
                limit(batchSize)
            );
        } else {
            q = query(
                collection(db, "books"),
                where("category", "==", adminCategoryFilter),
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
        renderInventory();
    } catch (error) {
        console.error("Error fetching books:", error);
        libraryData.isLoading = false;
        libraryData.isNextPageLoading = false;
        showAlertModal("Error fetching books: " + error.message, "System Error");
    }
};

window.loadMoreBooks = function () {
    if (libraryData.isNextPageLoading || !libraryData.hasMore) return;
    libraryData.isNextPageLoading = true;
    renderInventory();
    fetchBooksBatch();
};

window.openBookForm = function (bookId = null) {
    const formContainer = document.getElementById('book-form-container');
    const title = document.getElementById('book-form-title');
    const idField = document.getElementById('edit-book-id');
    const titleField = document.getElementById('new-title');
    const authorField = document.getElementById('new-author');
    const langField = document.getElementById('new-language');
    const shelfField = document.getElementById('new-shelf');
    const rowField = document.getElementById('new-row');
    const checkboxes = document.querySelectorAll('input[name="category"]');

    // Reset checkboxes
    checkboxes.forEach(cb => cb.checked = false);

    if (bookId) {
        const book = libraryData.books.find(b => b.id === bookId);
        if (book) {
            title.textContent = 'Edit Book';
            idField.value = book.id;
            titleField.value = book.title;
            authorField.value = book.author;
            langField.value = book.language || '2';
            shelfField.value = book.shelf_number || '';
            rowField.value = book.row || '';

            // Set checkboxes (supports single or multiple if saved as array/comma string)
            const bookCat = book.category || book.section || '';
            checkboxes.forEach(cb => {
                if (bookCat.includes(cb.value)) cb.checked = true;
            });
        }
    } else {
        title.textContent = 'New Book';
        idField.value = '';
        titleField.value = '';
        authorField.value = '';
        langField.value = '2'; // Default English
        shelfField.value = '';
        rowField.value = '';
    }
    formContainer.style.display = 'block';
};

window.closeBookForm = function () {
    document.getElementById('book-form-container').style.display = 'none';
};

window.saveBook = async function () {
    const editId = document.getElementById('edit-book-id').value;

    // Get selected categories
    const selectedCats = Array.from(document.querySelectorAll('input[name="category"]:checked'))
        .map(cb => cb.value);

    const bookData = {
        title: document.getElementById('new-title').value.trim(),
        author: document.getElementById('new-author').value.trim(),
        language: document.getElementById('new-language').value,
        category: selectedCats.length > 0 ? selectedCats[0] : 'Other', // Using first one for primary category
        categories: selectedCats, // Store all for future use
        shelf_number: document.getElementById('new-shelf').value.trim(),
        row: document.getElementById('new-row').value.trim(),
        available: true,
        last_updated: serverTimestamp()
    };

    if (!bookData.title || !bookData.author) return;

    try {
        if (editId) {
            await updateDoc(doc(db, "books", editId), bookData);
            // Manually update local cache for immediate feedback
            const idx = libraryData.books.findIndex(b => b.id === editId);
            if (idx !== -1) {
                libraryData.books[idx] = { ...libraryData.books[idx], ...bookData };
            }
        } else {
            const docRef = await addDoc(collection(db, "books"), bookData);
            // For new books, we might want to reset pagination to show it at the top
            // since we order by last_updated desc
            resetPagination();
            fetchBooksBatch();
        }
    } catch (e) {
        console.error("Firebase Error:", e);
        showAlertModal("Error saving book. Check your connection or Firebase rules.", "Error");
    }
    // Always close the form and re-render
    closeBookForm();
    renderInventory();
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

async function deleteBook(id) {
    if (confirm("Delete book?")) {
        try {
            await deleteDoc(doc(db, "books", id));
            // Remove from local cache
            libraryData.books = libraryData.books.filter(b => b.id !== id);
            renderInventory();
        } catch (e) {
            console.error("Delete failed:", e);
            showAlertModal("Could not delete book.", "Error");
        }
    }
}

window.printMemberList = function () {
    const list = libraryData.members.filter(m => m.status === 'approved');
    if (list.length === 0) {
        showAlertModal("No approved members to print.", "Notice");
        return;
    }

    // Sort numerically by Member ID (1, 2, 3...)
    list.sort((a, b) => {
        const idA = parseInt(a.memberId || 0);
        const idB = parseInt(b.memberId || 0);
        return idA - idB;
    });

    const printArea = document.getElementById('printable-card-area');

    let rowsHtml = '';
    list.forEach((m, index) => {
        const dateStr = m.timestamp ? new Date(m.timestamp.seconds * 1000).toLocaleDateString() : 'N/A';
        const bg = index % 2 === 0 ? '#ffffff' : '#f8fafc';
        rowsHtml += `
            <tr style="background-color: ${bg}; border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 14px 16px; text-align: center; color: #64748b; font-weight: 600;">${index + 1}</td>
                <td style="padding: 14px 16px; font-weight: 700; color: #0f172a; font-size: 14px;">${m.name}</td>
                <td style="padding: 14px 16px; font-family: 'Inter', monospace; color: #0fa3b1; font-weight: 700;">${m.memberId || 'N/A'}</td>
                <td style="padding: 14px 16px; color: #475569;">${m.phone || 'N/A'}</td>
                <td style="padding: 14px 16px; color: #475569;">${dateStr}</td>
            </tr>
        `;
    });

    const currentDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    printArea.innerHTML = `
        <div class="print-list" style="width: 100%; max-width: 850px; margin: 0 auto; font-family: 'Inter', sans-serif; padding: 30px; -webkit-print-color-adjust: exact; print-color-adjust: exact;">
            <div style="text-align: center; margin-bottom: 30px; border-bottom: 2px solid #e2e8f0; padding-bottom: 20px;">
                <h1 style="color: #083344; font-size: 32px; font-weight: 800; margin: 0; font-family: 'Outfit', sans-serif; display: flex; align-items: center; justify-content: center; gap: 12px;">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #0fa3b1;"><path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/></svg>
                    Nayodayam Library
                </h1>
                <h2 style="color: #64748b; font-size: 14px; margin: 8px 0 0 0; text-transform: uppercase; letter-spacing: 2px; font-weight: 700;">Membership Directory</h2>
                <div style="display: flex; justify-content: center; gap: 12px; margin-top: 16px;">
                    <span style="background: #f1f5f9; padding: 6px 14px; border-radius: 20px; color: #475569; font-size: 12px; font-weight: 600;">Date: ${currentDate}</span>
                    <span style="background: #e0f2fe; padding: 6px 14px; border-radius: 20px; color: #0284c7; font-size: 12px; font-weight: 600;">Total Active: ${list.length}</span>
                </div>
            </div>
            
            <div style="border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="background-color: #083344; color: white;">
                            <th style="padding: 16px; text-align: center; width: 40px; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 1px;">#</th>
                            <th style="padding: 16px; text-align: left; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 1px;">Full Name</th>
                            <th style="padding: 16px; text-align: left; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 1px;">Member ID</th>
                            <th style="padding: 16px; text-align: left; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 1px;">Phone</th>
                            <th style="padding: 16px; text-align: left; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 1px;">Joined Date</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>
            
            <div style="margin-top: 50px; font-size: 11px; color: #94a3b8; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5;"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="12" r="3"/></svg>
                <p style="margin: 0;">Official Record - Nayodayam Library - Amarakuni, Pulpally, Wayanad-673579, Kerala</p>
                <p style="margin: 0; opacity: 0.7;">Developed by Dept. of English Interns, Pazhassiraja College</p>
            </div>
        </div>
    `;

    setTimeout(() => {
        window.print();
    }, 100);
};

// --- Barcode Scanner Logic ---
let html5QrCode = null;
let currentScanContext = null;

window.openScanner = function (requestId, expectedMemberId, bookId) {
    currentScanContext = { requestId, expectedMemberId, bookId };
    const modal = document.getElementById('scanner-modal');
    modal.style.display = 'flex';

    document.getElementById('scanner-msg').textContent = `Please scan the Membership Card of the user. Expected ID: ${expectedMemberId || 'Unknown'}`;
    document.getElementById('force-approve-btn').style.display = 'none';

    if (!html5QrCode) {
        html5QrCode = new Html5Qrcode("reader");
    }

    // Optimization: Increased FPS and refined scan box for better detection
    const config = {
        fps: 25,
        qrbox: { width: 320, height: 200 },
        aspectRatio: 1.0,
        showTorchButtonIfSupported: true
    };

    html5QrCode.start(
        { facingMode: "environment" },
        config,
        (decodedText) => onScanSuccess(decodedText)
    ).catch(err => {
        console.error("Scanner error:", err);
        document.getElementById('scanner-msg').innerHTML = `<span style="color:var(--danger-color);">Camera failed: ${err.message}</span>`;
        document.getElementById('force-approve-btn').style.display = 'block'; // Show fallback
    });
};

window.closeScanner = function () {
    const modal = document.getElementById('scanner-modal');
    modal.style.display = 'none';
    if (html5QrCode && html5QrCode.isScanning) {
        html5QrCode.stop().catch(err => console.error("Error stopping scanner:", err));
    }
    currentScanContext = null;
};

async function onScanSuccess(decodedText) {
    if (!currentScanContext) return;

    const { requestId, expectedMemberId, bookId } = currentScanContext;

    // Normalize comparison: trim and remove non-printable/control characters
    // This prevents "NYD 2" type garbled output by stripping noise
    const scannedId = decodedText.replace(/[^\x20-\x7E]/g, "").trim();

    if (scannedId === expectedMemberId) {
        // Success match
        await html5QrCode.stop();
        showAlertModal(`ID Verified successfully (${scannedId}). Loan approved!`, "Success");
        updateRequestStatus(requestId, 'borrowed', bookId);
        closeScanner();
    } else {
        // Mismatch
        document.getElementById('scanner-msg').innerHTML = `
            <span style="color:var(--danger-color); font-weight:800;">ID MISMATCH!</span><br>
            Scanned: <strong>${scannedId}</strong><br>
            Expected: <strong>${expectedMemberId}</strong><br>
            <span style="font-size:12px;">Please scan the correct member card.</span>
        `;
        document.getElementById('force-approve-btn').style.display = 'block';
    }
}

window.forceApprove = async function () {
    if (confirm("Are you sure you want to approve this loan WITHOUT a successful ID scan?")) {
        const { requestId, bookId } = currentScanContext;
        updateRequestStatus(requestId, 'borrowed', bookId);
        showAlertModal("Loan forced approved by admin.", "Notice");
        closeScanner();
    }
};

window.downloadHistoryPDF = function () {
    const list = libraryData.requests.filter(r => r.status === 'returned');
    if (list.length === 0) {
        showAlertModal("No history available to download.", "Notice");
        return;
    }

    // Sort by most recent
    list.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

    const printArea = document.getElementById('printable-card-area');

    let rowsHtml = '';
    list.forEach((r, index) => {
        const dateStr = r.timestamp ? new Date(r.timestamp.seconds * 1000).toLocaleDateString() : 'N/A';
        const bg = index % 2 === 0 ? '#ffffff' : '#f8fafc';
        rowsHtml += `
            <tr style="background-color: ${bg}; border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 14px 16px; text-align: center; color: #64748b; font-weight: 600;">${index + 1}</td>
                <td style="padding: 14px 16px; font-weight: 700; color: #0f172a; font-size: 14px;">${r.userName}</td>
                <td style="padding: 14px 16px; font-weight: 700; color: #0f172a; font-size: 14px;">${r.bookTitle}</td>
                <td style="padding: 14px 16px; color: #475569;">${dateStr}</td>
                <td style="padding: 14px 16px; color: #166534; font-weight: bold;">Returned</td>
            </tr>
        `;
    });

    const currentDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    printArea.innerHTML = `
        <div class="print-list" style="width: 100%; max-width: 850px; margin: 0 auto; font-family: 'Inter', sans-serif; padding: 30px; -webkit-print-color-adjust: exact; print-color-adjust: exact;">
            <div style="text-align: center; margin-bottom: 30px; border-bottom: 2px solid #e2e8f0; padding-bottom: 20px;">
                <h1 style="color: #083344; font-size: 32px; font-weight: 800; margin: 0; font-family: 'Outfit', sans-serif; display: flex; align-items: center; justify-content: center; gap: 12px;">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #0fa3b1;"><path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/></svg>
                    Nayodayam Library
                </h1>
                <h2 style="color: #64748b; font-size: 14px; margin: 8px 0 0 0; text-transform: uppercase; letter-spacing: 2px; font-weight: 700;">Borrowing History Log</h2>
                <div style="display: flex; justify-content: center; gap: 12px; margin-top: 16px;">
                    <span style="background: #f1f5f9; padding: 6px 14px; border-radius: 20px; color: #475569; font-size: 12px; font-weight: 600;">Date Generated: ${currentDate}</span>
                    <span style="background: #e0f2fe; padding: 6px 14px; border-radius: 20px; color: #0284c7; font-size: 12px; font-weight: 600;">Total Records: ${list.length}</span>
                </div>
            </div>
            
            <div style="border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="background-color: #083344; color: white;">
                            <th style="padding: 16px; text-align: center; width: 40px; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 1px;">#</th>
                            <th style="padding: 16px; text-align: left; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 1px;">Member Name</th>
                            <th style="padding: 16px; text-align: left; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 1px;">Book Title</th>
                            <th style="padding: 16px; text-align: left; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 1px;">Date</th>
                            <th style="padding: 16px; text-align: left; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 1px;">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>
            
            <div style="margin-top: 50px; font-size: 11px; color: #94a3b8; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5;"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="12" r="3"/></svg>
                <p style="margin: 0;">Official Record - Nayodayam Library - Amarakuni, Pulpally, Wayanad-673579, Kerala</p>
                <p style="margin: 0; opacity: 0.7;">Developed by Dept. of English Interns, Pazhassiraja College</p>
            </div>
        </div>
    `;

    setTimeout(() => {
        window.print();
    }, 100);
};

window.deleteHistoryRecord = async function (id) {
    if (confirm("Are you sure you want to delete this history record? This action cannot be undone.")) {
        try {
            await deleteDoc(doc(db, "requests", id));
            // Remove from local array to instantly update UI
            libraryData.requests = libraryData.requests.filter(r => r.id !== id);
            renderBorrows();
            showAlertModal("History record deleted.", "Success");
        } catch (e) {
            console.error("Error deleting history record: ", e);
            showAlertModal("Failed to delete record.", "Error");
        }
    }
};

function switchRequestSubView(sub) {
    currentRequestSubView = sub;
    const chips = document.querySelectorAll('#requests-sub-nav .sub-nav-chip');
    const subviews = document.querySelectorAll('#requests-view .sub-view-container');

    chips.forEach(c => {
        if (c.dataset.sub === sub) c.classList.add('active');
        else c.classList.remove('active');
    });

    subviews.forEach(v => {
        if (v.id === `subview-${sub}`) v.style.display = 'block';
        else v.style.display = 'none';
    });
}
window.switchRequestSubView = switchRequestSubView;

function switchMembersSubView(sub) {
    currentMembersSubView = sub;
    const chips = document.querySelectorAll('#members-sub-nav .sub-nav-chip');
    const subviews = document.querySelectorAll('#members-view .sub-view-container');

    chips.forEach(c => {
        if (c.dataset.sub === sub) c.classList.add('active');
        else c.classList.remove('active');
    });

    subviews.forEach(v => {
        if (v.id === `subview-${sub}`) v.style.display = 'block';
        else v.style.display = 'none';
    });
}
window.switchMembersSubView = switchMembersSubView;
