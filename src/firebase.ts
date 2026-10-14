// Firebase initialization.
//
// Realtime Database, plus Anonymous Auth for the global leaderboards only
// (each browser gets a stable anonymous uid, so the rules can limit it to
// one entry per board). Online games still run without auth.
// The web API key is not a secret (it's bundled into the browser
// anyway); access control is enforced via Database Rules.

import { initializeApp, type FirebaseApp } from "firebase/app";
import { getDatabase, type Database } from "firebase/database";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  type Auth,
} from "firebase/auth";

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

function getFirebaseApp(): FirebaseApp {
  if (!app) app = initializeApp(firebaseConfig);
  return app;
}

export function getFirebaseDb(): Database {
  if (!db) db = getDatabase(getFirebaseApp());
  return db;
}

// The browser's anonymous uid, signing in on first use. Auth restores a
// persisted session asynchronously, so wait for that first state before
// deciding to sign in — otherwise every page load would mint a new uid and
// a new leaderboard identity.
let uidPromise: Promise<string> | null = null;

export function ensureAnonymousUid(): Promise<string> {
  if (!uidPromise) {
    const auth: Auth = getAuth(getFirebaseApp());
    uidPromise = new Promise<string>((resolve, reject) => {
      const unsubscribe = onAuthStateChanged(
        auth,
        (user) => {
          unsubscribe();
          if (user) {
            resolve(user.uid);
            return;
          }
          signInAnonymously(auth)
            .then((cred) => resolve(cred.user.uid))
            .catch(reject);
        },
        reject,
      );
    });
    // A failed attempt (offline, auth disabled) mustn't stick: allow a retry.
    uidPromise.catch(() => {
      uidPromise = null;
    });
  }
  return uidPromise;
}
