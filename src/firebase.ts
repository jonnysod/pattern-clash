// Firebase initialization.
//
// We only use Realtime Database — no Auth, no Firestore, no Storage.
// The web API key is not a secret (it's bundled into the browser
// anyway); access control is enforced via Database Rules.

import { initializeApp, type FirebaseApp } from "firebase/app";
import { getDatabase, type Database } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyAHSAyOyZqAw0mRVbMBy_djgJIXsFnmDxQ",
  authDomain: "pattern-clash.firebaseapp.com",
  databaseURL:
    "https://pattern-clash-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "pattern-clash",
  storageBucket: "pattern-clash.firebasestorage.app",
  messagingSenderId: "921028301120",
  appId: "1:921028301120:web:1ccdc0747f118f0d236aa5",
};

let app: FirebaseApp | null = null;
let db: Database | null = null;

export function getFirebaseDb(): Database {
  if (!db) {
    app = initializeApp(firebaseConfig);
    db = getDatabase(app);
  }
  return db;
}
