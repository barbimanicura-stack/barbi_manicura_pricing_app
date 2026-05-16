import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCdfeIQXY-7dHKJWP48NewcG6rG5MKmRnc",
  authDomain: "barbimanicurapricingapp.firebaseapp.com",
  projectId: "barbimanicurapricingapp",
  storageBucket: "barbimanicurapricingapp.firebasestorage.app",
  messagingSenderId: "1056163227126",
  appId: "1:1056163227126:web:168b2a0340b68e276013d7"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

export { db };
