// Firebase Configuration for Nayodayam Library
// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-analytics.js";

// Your app's Firebase project configuration
const firebaseConfig = {
    apiKey: "AIzaSyDHVoMliBWV_zikCnievv7T1igbtQRXD2s",
    authDomain: "navodaymlibrary.firebaseapp.com",
    projectId: "navodaymlibrary",
    storageBucket: "navodaymlibrary.firebasestorage.app",
    messagingSenderId: "1015676164901",
    appId: "1:1015676164901:web:9c24f1812443d882da18cc",
    measurementId: "G-92C8DYG7H7"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const analytics = getAnalytics(app);
const googleProvider = new GoogleAuthProvider();

export { db, auth, analytics, googleProvider };
