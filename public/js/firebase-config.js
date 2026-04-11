// Firebase Configuration for Nayodayam Library
// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
    getFirestore,
    enableMultiTabIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-analytics.js";

// Your app's Firebase project configuration
const firebaseConfig = {
    apiKey: "AIzaSyDiF6_pOdspr1rD0nIlWW4TgVmN2KMbzUI",
    authDomain: "navodhayam-library.firebaseapp.com",
    projectId: "navodhayam-library",
    storageBucket: "navodhayam-library.firebasestorage.app",
    messagingSenderId: "637237931320",
    appId: "1:637237931320:web:112a66d0b264a05b74a5cd",
    measurementId: "G-TB71NJ58PY"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Enable Offline Persistence for much faster loads and lower quota usage
enableMultiTabIndexedDbPersistence(db).catch((err) => {
    if (err.code == 'failed-precondition') {
        // Multiple tabs open, persistence can only be enabled in one tab at a a time.
        console.warn('Firestore persistence failed: Multiple tabs open');
    } else if (err.code == 'unimplemented') {
        // The current browser does not support all of the features required to enable persistence
        console.warn('Firestore persistence is not supported by this browser');
    }
});

const auth = getAuth(app);
const analytics = getAnalytics(app);
const googleProvider = new GoogleAuthProvider();

export { db, auth, analytics, googleProvider };
