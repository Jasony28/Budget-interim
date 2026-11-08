// ⚙️ Configuration Firebase — remplace les valeurs ci-dessous par celles de TON projet
// Console Firebase → ⚙️ Paramètres du projet → Vos applications → Application Web → firebaseConfig
export const firebaseConfig = {
  apiKey: "AIzaSyChyWdD6tsdajg_xJiK54Z8K-cRWOuXVa8",
  authDomain: "budget-interim.firebaseapp.com",
  projectId: "budget-interim",
  storageBucket: "budget-interim.firebasestorage.app",
  messagingSenderId: "819863866359",
  appId: "1:819863866359:web:05cb983370458b52b5fcf2",
  measurementId: "G-TGE32BV1TR"
};

// 🔐 App Check (obligatoire pour le scan Gemini) : clé de site reCAPTCHA Enterprise
// Console Firebase → App Check → Applications → ton appli Web → reCAPTCHA Enterprise
// Laisse vide "" si tu n'utilises pas le scan.
export const recaptchaEnterpriseSiteKey = "";

// 🤖 Modèle Gemini utilisé pour lire les fiches de paie
export const geminiModel = "gemini-3.5-flash";
