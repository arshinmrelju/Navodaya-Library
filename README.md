# 🏛️ nayodayam Library Web App

nayodayam Library is a professional, mobile-first digital library assistant designed for rural communities. It provides an intuitive interface for users to browse books, locate them on physical shelves, and request titles seamlessly. The app is powered by **Firebase** for real-time data synchronization and secure administrative control.

## ✨ Features

- **📱 Professional Mobile-First Design**: Clean, modern UI tailored for smartphones with smooth transitions.
- **🚀 Real-Time Synchronization**: Powered by **Firebase Firestore**, book availability and requests update instantly.
- **📚 Smart Catalog & Search**: Browse the collection or search by Title, Author, or Category.
- **📍 Physical Book Mapping**: Visual guides to help users find books on specific shelves.
- **📥 Frictionless Requests**: Users enter their Name and Phone Number to request a book; no complex account creation needed.
- **🔐 Secure Librarian Portal**: A protected dashboard (`admin.html`) for managing inventory and approving borrow requests via **Firebase Authentication**.

## 🚀 Getting Started

### 1. Prerequisites
- A modern web browser.
- A **Firebase Project** (Create one at [console.firebase.google.com](https://console.firebase.google.com/)).

### 2. Configuration
1. Enable **Firestore Database** and **Authentication** (Email/Password) in your Firebase Console.
2. In your Project Settings, register a Web App and copy the `firebaseConfig` object.
3. Open `js/firebase-config.js` and paste your configuration.

### 3. Installation & Run
1. Clone the repository:
   ```bash
   git clone https://github.com/arshinmrelju/Navodaya-Library.git
   ```
2. Open `index.html` in your browser (use a local server like VS Code Live Server for the best experience with JS Modules).
3. Access the Librarian Portal at `admin.html`.

## 🛠️ Technical Stack
- **Frontend**: HTML5, CSS3 (Custom Design System, Flexbox/Grid)
- **Logic**: Vanilla JavaScript (ES6 Modules)
- **Backend/Database**: Firebase (Firestore & Authentication)

## ⚖️ License
This project is open-source and designed for community use.