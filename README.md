# 🏛️ Navodayam Library Web App

Navodayam Library is a professional, mobile-first digital library assistant designed for rural communities. It provides an intuitive interface for users to browse books, locate them on physical shelves, and request titles seamlessly. The app is powered by **Firebase** for real-time data synchronization and secure administrative control.

## ✨ Key Features

### 👤 User Interface & Experience
- **📱 Professional Mobile-First UI**: Clean, modern design tailored for smartphones, using fast-loading inline SVG icons and fluid layout spacing.
- **📷 Book Cover Scanning**: Integrated WhatsApp-style document scanner allowing users to snap, crop, and upload book covers directly from mobile devices.
- **🚀 High Performance & Pagination**: Optimized to handle large collections (5,000+ books) via paginated data loading, fetching manageable chunks to maintain lightning-fast render speeds.
- **🔍 Multi-Dimensional Search**: Premium glassmorphic search dropdown interfaces supporting multi-criteria queries by Book ID, Member ID, Author name, and Title.

### 📚 Library Catalog
- **📚 Standardized Categorization**: Browse an organized collection by verified categories such as *Novel, Stories, Reference, Poem, Children Literature, Literature, Politics, and Study Materials*.
- **🌐 Multilingual Support**: Built-in language mapping support for Malayalam, English, and Hindi to serve diverse community needs.
- **📍 Physical Book Mapping**: Visual guides to help users find books on specific shelves and sections.
- **📥 Frictionless Requests**: Users enter their Name and Phone Number to request a book; no complex account creation needed.

### 🔐 Admin & Management
- **📊 Complete Admin Dashboard**: A feature-rich secure portal to manage inventory, track member activity, approve new memberships, and manage the full borrowing lifecycle.
- **🚀 Direct Admin Borrowing**: Assign books directly to members from the admin panel with intuitive, custom-branded confirmation modals.
- **🎙️ Real-Time Voice Notifications**: Automated audio alerts (via Web Speech API) notify librarians of new incoming book requests or member applications.
- **🔄 Real-Time UI Updates**: Instantaneous UI reflection for approvals, returns, and issues without page refreshes, powered by Firestore live listeners.
- **📑 Reporting & PDF Exports**: Manage comprehensive borrowing histories with one-click PDF generation for offline records.

## 🚀 Getting Started

### 1. Prerequisites
- A modern web browser.
- A **Firebase Project** (Create one at [console.firebase.google.com](https://console.firebase.google.com/)).

### 2. Configuration
1. Enable **Firestore Database**, **Authentication** (Email/Password), and **Storage** in your Firebase Console.
2. In your Project Settings, register a Web App and copy the `firebaseConfig` object.
3. Open `public/js/firebase-config.js` and paste your configuration.

### 3. Installation & Run
1. Clone the repository:
   ```bash
   git clone https://github.com/arshinmrelju/Navodaya-Library.git
   ```
2. Open `public/index.html` in your browser (use a local server like VS Code Live Server for the best experience with JS Modules).
3. Access the Librarian Portal at `public/admin.html`.

## 🛠️ Technical Stack
- **Frontend**: HTML5, CSS3 (Custom Design System, Glassmorphism, CSS Variables, SVG)
- **Logic**: Vanilla JavaScript (ES6 Modules, Web Speech API)
- **Backend/Database**: Firebase (Firestore, Authentication, Storage)
- **Data Pipeline**: Google Apps Script (Batch Data Sync from Google Sheets)
- **Mobile/Native**: Capacitor (for APK generation)

## ⚖️ License
This project is open-source and designed for community use.