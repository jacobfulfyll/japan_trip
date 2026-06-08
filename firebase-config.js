// firebase-config.js — Firebase web config for the japan_trip photo journal.
//
// TRACKED (committed) on purpose: GitHub Pages serves the committed repo root,
// so the gitignored `firebase-config.local.js` would 404 in production and the
// auth gate could never init Firebase. These values are NOT secrets — Firebase
// web config is designed to ship in public client-side JS; access is enforced
// by Firestore/Storage security rules (request.auth != null), not by hiding
// these keys. The only secret is the shared password (never stored in code).
//
// Keep this in sync with firebase-config.local.js (the untracked dev copy).

export const firebaseConfig = {
  apiKey: 'AIzaSyBUXwKll1-XZBL8l1U9X44tJspHlSKzfWA',
  authDomain: 'japan-trip-5daf1.firebaseapp.com',
  projectId: 'japan-trip-5daf1',
  storageBucket: 'japan-trip-5daf1.firebasestorage.app',
  messagingSenderId: '251843386612',
  appId: '1:251843386612:web:5ff86ddb498f65592c92a1',
  measurementId: 'G-Q7KJ4PWMRP',
};
