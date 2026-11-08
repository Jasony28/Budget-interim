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

// 🔐 App Check (protège ton quota Gemini) — remplis UNE des deux clés :
// reCAPTCHA v3 (gratuit, recommandé) : clé de SITE créée sur https://www.google.com/recaptcha/admin
export const recaptchaV3SiteKey = "";
// ou reCAPTCHA Enterprise
export const recaptchaEnterpriseSiteKey = "6LeX-RYuAAAAAJFxD3d2GAmRK2ccNFsDRJFo1aLz";

// 🤖 Modèle Gemini utilisé pour lire les fiches de paie
export const geminiModel = "gemini-3.5-flash";
