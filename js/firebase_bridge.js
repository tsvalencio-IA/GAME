/* =================================================================
   FIREBASE BRIDGE (MODULE -> GLOBAL)
   Conecta o módulo ES6 seguro ao escopo global do Sistema Wii
   ================================================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getDatabase, ref, set, push, onValue, query, orderByChild, limitToLast } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyB0ThqhfK6xc8P1D4WCkavhdXbb7zIaQJk",
  authDomain: "thiaguinhowii.firebaseapp.com",
  databaseURL: "https://thiaguinhowii-default-rtdb.firebaseio.com",
  projectId: "thiaguinhowii",
  storageBucket: "thiaguinhowii.firebasestorage.app",
  messagingSenderId: "63695043126",
  appId: "1:63695043126:web:abd6a8ba7792313991b697"
};

// Objeto Global Seguro
window.CoreFB = {
    db: null,
    user: null,
    
    init: async function() {
        console.log("🔥 [BRIDGE] Conectando Firebase...");
        try {
            const app = initializeApp(firebaseConfig);
            this.db = getDatabase(app);
            const auth = getAuth(app);
            
            const userCred = await signInAnonymously(auth);
            this.user = userCred.user;
            console.log("✅ [BRIDGE] Conectado! UID:", this.user.uid);
            return true;
        } catch(e) {
            console.error("❌ [BRIDGE] Erro Firebase:", e);
            return false;
        }
    },

    saveScore: function(gameId, score) {
        if(!this.db || !this.user) return;
        const path = `leaderboard/${gameId}`;
        const scoreRef = push(ref(this.db, path));
        set(scoreRef, {
            score: parseInt(score),
            uid: this.user.uid,
            timestamp: Date.now()
        });
    }
};

// Auto-boot do Bridge
window.CoreFB.init();
