// ⚙️ Configuration Firebase — remplace les valeurs ci-dessous par celles de TON projet
// Console Firebase → ⚙️ Paramètres du projet → Vos applications → Application Web → firebaseConfig
export const firebaseConfig = {
  apiKey: "A_REMPLACER",
  authDomain: "A_REMPLACER.firebaseapp.com",
  projectId: "A_REMPLACER",
  storageBucket: "A_REMPLACER.firebasestorage.app",
  messagingSenderId: "A_REMPLACER",
  appId: "A_REMPLACER"
};

// 🔐 App Check (obligatoire pour le scan Gemini) : clé de site reCAPTCHA Enterprise
// Console Firebase → App Check → Applications → ton appli Web → reCAPTCHA Enterprise
// Laisse vide "" si tu n'utilises pas le scan.
export const recaptchaEnterpriseSiteKey = "";

// 🤖 Modèle Gemini utilisé pour lire les fiches de paie
export const geminiModel = "gemini-3.5-flash";
