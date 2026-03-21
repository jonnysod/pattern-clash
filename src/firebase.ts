// Firebase initialization

import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAHSAyOyZqAw0mRVbMBy_djgJIXsFnmDxQ",
  authDomain: "pattern-clash.firebaseapp.com",
  projectId: "pattern-clash",
  storageBucket: "pattern-clash.firebasestorage.app",
  messagingSenderId: "921028301120",
  appId: "1:921028301120:web:1ccdc0747f118f0d236aa5",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
