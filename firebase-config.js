// ══════════════════════════════════════════════════════════
//  FIREBASE CONFIGURATION — barbi-manicura
//  Reemplazá los valores de firebaseConfig con los tuyos.
//
//  Cómo obtenerlos:
//  1. Entrá a https://console.firebase.google.com
//  2. Creá un proyecto nuevo (ej: "barbi-manicura")
//  3. Agregá una app web (ícono </>)
//  4. Copiá el objeto firebaseConfig que te muestra
//  5. En Firestore → Crear base de datos → Modo producción
//  6. En Reglas de Firestore, pegá esto y publicá:
//
//     rules_version = '2';
//     service cloud.firestore {
//       match /databases/{database}/documents {
//         match /{document=**} {
//           allow read, write: if true;
//         }
//       }
//     }
//
//  (Regla temporal — sin auth. Para producción real agregá auth.)
// ══════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ▼▼▼ REEMPLAZÁ ESTOS DATOS CON LOS TUYOS ▼▼▼
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCdfeIQXY-7dHKJWP48NewcG6rG5MKmRnc",
  authDomain: "barbimanicurapricingapp.firebaseapp.com",
  projectId: "barbimanicurapricingapp",
  storageBucket: "barbimanicurapricingapp.firebasestorage.app",
  messagingSenderId: "1056163227126",
  appId: "1:1056163227126:web:168b2a0340b68e276013d7"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
// ▲▲▲ REEMPLAZÁ ESTOS DATOS CON LOS TUYOS ▲▲▲

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

export { db };
