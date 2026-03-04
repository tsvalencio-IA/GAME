/* =================================================================
   CORE DO SISTEMA - BYPASS DE CACHE ATIVO E LOGIN GHOST
   ================================================================= */

window.Sfx = {
    ctx: null,
    init: () => { 
        window.AudioContext = window.AudioContext || window.webkitAudioContext; 
        if (!window.Sfx.ctx) window.Sfx.ctx = new AudioContext(); 
        if (window.Sfx.ctx.state === 'suspended') window.Sfx.ctx.resume();
    },
    play: (f, t, d, v=0.1) => {
        if(!window.Sfx.ctx) return;
        try {
            const o = window.Sfx.ctx.createOscillator(); const g = window.Sfx.ctx.createGain();
            o.type=t; o.frequency.value=f; 
            g.gain.setValueAtTime(v, window.Sfx.ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.001, window.Sfx.ctx.currentTime+d);
            o.connect(g); g.connect(window.Sfx.ctx.destination); 
            o.start(); o.stop(window.Sfx.ctx.currentTime+d);
        } catch(e){}
    },
    hover: () => window.Sfx.play(800, 'sine', 0.05, 0.04),
    click: () => window.Sfx.play(1000, 'square', 0.1, 0.05),
    error: () => window.Sfx.play(150, 'sawtooth', 0.3, 0.1),
    coin: () => { window.Sfx.play(1200, 'sine', 0.1, 0.05); setTimeout(()=>window.Sfx.play(1600, 'sine', 0.1, 0.05), 100); }
};

window.Profile = {
    username: "Piloto", coins: 0, xp: 0, permissions: {},

    login: async function() {
        window.Sfx.click();
        let userLogin = document.getElementById('auth-email').value.trim();
        const pass = document.getElementById('auth-pass').value;
        if(!userLogin || !pass) { alert("Preencha o login e senha!"); return; }
        
        // MANOBRA DE ADMIN: Se escrever só "thiago", injeta um domínio invisível
        let email = userLogin.includes('@') ? userLogin : userLogin.toLowerCase() + '@console.com';

        try {
            document.getElementById('loading-text').innerText = "AUTENTICANDO...";
            document.getElementById('auth-screen').classList.add('hidden');
            document.getElementById('loading').classList.remove('hidden');
            
            await window.AuthApp.signInWithEmailAndPassword(email, pass);
        } catch(e) {
            document.getElementById('loading').classList.add('hidden');
            document.getElementById('auth-screen').classList.remove('hidden');
            
            // TRADUTOR DE ERROS PARA DEBUG
            if (e.code === 'auth/user-not-found') {
                alert("❌ PILOTO NÃO ENCONTRADO!\n\nSe esta é a primeira vez rodando a versão atualizada, clique em 'NOVO REGISTRO' para regravar o seu usuário 'thiago'.");
            } else if (e.code === 'auth/wrong-password') {
                alert("❌ SENHA INCORRETA!");
            } else {
                alert("ERRO: " + e.message);
            }
        }
    },

    register: async function() {
        window.Sfx.click();
        let userLogin = document.getElementById('auth-email').value.trim();
        const pass = document.getElementById('auth-pass').value;
        if(!userLogin || !pass) { alert("Preencha o login e senha!"); return; }
        
        let email = userLogin.includes('@') ? userLogin : userLogin.toLowerCase() + '@console.com';
        let username = userLogin.includes('@') ? prompt("Nome de Piloto:") : userLogin;
        if(!username || username.trim() === '') return;

        try {
            document.getElementById('loading-text').innerText = "CRIANDO PERFIL...";
            document.getElementById('auth-screen').classList.add('hidden');
            document.getElementById('loading').classList.remove('hidden');
            
            const cred = await window.AuthApp.createUserWithEmailAndPassword(email, pass);
            
            await window.DB.ref('users/' + cred.user.uid).set({
                username: username, coins: 0, xp: 0,
                permissions: { 'kart': true, 'box_pro': true, 'usarmy_flight_sim': true, 'ping_pong': true, 'ar_truck_sim': true }
            });
        } catch(e) {
            document.getElementById('loading').classList.add('hidden');
            document.getElementById('auth-screen').classList.remove('hidden');
            if(e.code === 'auth/email-already-in-use') alert("Esta conta já existe! Clique em ENTRAR.");
            else alert("Erro: " + e.message);
        }
    },

    loadFromFirebase: async function(uid) {
        return new Promise((resolve) => {
            window.DB.ref('users/' + uid).on('value', (snap) => {
                const data = snap.val();
                if(data) {
                    this.username = data.username || "Piloto";
                    this.coins = data.coins || 0;
                    this.xp = data.xp || 0;
                    this.permissions = data.permissions || {};
                    this.updateUI();
                    
                    if (this.username.toLowerCase() === "thiago" || this.username.toLowerCase() === "admin") {
                        document.getElementById('btn-admin-panel').classList.remove('hidden');
                    } else {
                        document.getElementById('btn-admin-panel').classList.add('hidden');
                    }
                    
                    window.System.renderMenu();
                }
                resolve();
            });
        });
    },

    updateUI: function() {
        let elName = document.getElementById('ui-username');
        let elCoins = document.getElementById('ui-coins');
        let elLvl = document.getElementById('ui-level');
        if(elName) elName.innerText = this.username;
        if(elCoins) elCoins.innerText = this.coins;
        if(elLvl) elLvl.innerText = "Lvl " + Math.max(1, Math.floor(Math.sqrt(this.xp / 100)));
    }
};

window.System = {
    canvas: null, video: null, detector: null, ctx: null, w: 0, h: 0,
    games: {}, activeGame: null, loopId: null, lastPose: null, camFacing: 'user', playerId: null,

    registerGame: function(id, name, icon, gameObj, config={}) {
        this.games[id] = { id, name, icon, obj: gameObj, conf: config };
        this.renderMenu();
    },

    renderMenu: function() {
        const grid = document.getElementById('menu-grid');
        if(!grid) return;
        grid.innerHTML = '';
        for(const id in this.games) {
            const g = this.games[id];
            if (window.Profile.permissions && window.Profile.permissions[id] === false) continue; 
            const card = document.createElement('div');
            card.className = 'game-card';
            card.innerHTML = `<div class="game-icon">${g.icon}</div><div class="game-title">${g.name}</div>`;
            card.onclick = () => { window.Sfx.click(); this.launchGame(id); };
            grid.appendChild(card);
        }
    },

    launchGame: async function(id) {
        this.activeGame = this.games[id];
        document.getElementById('menu-screen').classList.add('hidden');
        document.getElementById('admin-screen').classList.add('hidden');
        document.getElementById('loading-text').innerText = "INICIANDO " + this.activeGame.name.toUpperCase() + "...";
        document.getElementById('loading').classList.remove('hidden');
        
        if (this.activeGame.conf && this.activeGame.conf.camera) await this.switchCamera(this.activeGame.conf.camera);
        
        let op = this.activeGame.conf.camOpacity !== undefined ? this.activeGame.conf.camOpacity : 0.2;
        this.video.style.opacity = op;
        
        setTimeout(() => {
            document.getElementById('loading').classList.add('hidden');
            this.ctx = this.canvas.getContext('2d');
            this.activeGame.obj.init(this.activeGame.conf.phases ? this.activeGame.conf.phases[0] : null);
            this.startEngine();
        }, 1000);
    },

    home: function() {
        this.stopEngine();
        if(this.activeGame && this.activeGame.obj.cleanup) this.activeGame.obj.cleanup();
        this.activeGame = null;
        this.ctx.clearRect(0,0,this.w,this.h);
        document.getElementById('menu-screen').classList.remove('hidden');
    },

    msg: function(text, color) {
        const el = document.createElement('div');
        el.style.position = 'absolute'; el.style.top = '100px'; el.style.left = '50%'; el.style.transform = 'translateX(-50%)';
        el.style.background = 'rgba(0,0,0,0.8)'; el.style.color = color || '#00ffcc'; el.style.padding = '10px 20px';
        el.style.borderRadius = '10px'; el.style.fontFamily = "'Russo One', Arial"; el.style.fontSize = '20px'; el.style.zIndex = '100';
        el.innerText = text; document.body.appendChild(el); setTimeout(()=>el.remove(), 2000);
    },

    gameOver: function(score, isWin, extraCoins=0) {
        this.stopEngine();
        if(this.activeGame && this.activeGame.obj.cleanup) this.activeGame.obj.cleanup();
        this.ctx.fillStyle = isWin ? 'rgba(46, 204, 113, 0.9)' : 'rgba(231, 76, 60, 0.9)';
        this.ctx.fillRect(0,0,this.w,this.h);
        this.ctx.fillStyle = 'white'; this.ctx.textAlign = 'center'; this.ctx.font = "bold 50px 'Russo One'";
        this.ctx.fillText(isWin ? "VITÓRIA!" : "FIM DE JOGO", this.w/2, this.h/2 - 20);
        if(isWin) window.Sfx.coin(); else window.Sfx.error();
        setTimeout(() => { this.home(); }, 3000);
    },

    resize: function() {
        if(!window.System.canvas) return;
        window.System.w = window.innerWidth; window.System.h = window.innerHeight;
        window.System.canvas.width = window.System.w; window.System.canvas.height = window.System.h;
    },

    switchCamera: async function(facingMode) {
        if (this.camFacing === facingMode && this.video && this.video.srcObject) return;
        if (this.video && this.video.srcObject) this.video.srcObject.getTracks().forEach(t => t.stop());
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facingMode, width: 640, height: 480 } });
            this.video.srcObject = stream; this.camFacing = facingMode;
            if(facingMode === 'user') this.video.style.transform = 'scaleX(-1)'; else this.video.style.transform = 'scaleX(1)';
        } catch(e) {}
    },

    startEngine: function() {
        if(this.loopId) return;
        const tick = async () => {
            if(this.detector && this.video.readyState === 4) {
                try { const poses = await this.detector.estimatePoses(this.video); this.lastPose = poses; } catch(e){}
            }
            if(this.activeGame && this.activeGame.obj.update) this.activeGame.obj.update(this.ctx, this.w, this.h, this.lastPose);
            this.loopId = requestAnimationFrame(tick);
        };
        tick();
    },

    stopEngine: function() {
        if(this.loopId) cancelAnimationFrame(this.loopId);
        this.loopId = null;
    }
};

const style = document.createElement('style');
style.innerHTML = `.ripple { position: absolute; border: 2px solid #00b0f0; border-radius: 50%; animation: ripple 1s linear infinite; pointer-events: none;} @keyframes ripple { 0% { transform: translate(-50%, -50%) scale(0); opacity: 1; } 100% { transform: translate(-50%, -50%) scale(1.5); opacity: 0; } }`;
document.head.appendChild(style);

window.onload = async () => {
    window.System.canvas = document.getElementById('game-canvas'); window.System.video = document.getElementById('webcam');
    window.System.resize(); window.addEventListener('resize', window.System.resize);

    await window.System.switchCamera('user');

    document.getElementById('loading-text').innerText = "CARREGANDO MOTOR IA...";
    await tf.ready();
    window.System.detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING });

    window.AuthApp.onAuthStateChanged(async (user) => {
        if (user) {
            window.System.playerId = user.uid;
            document.getElementById('loading-text').innerText = "SINCRONIZANDO PERFIL...";
            await window.Profile.loadFromFirebase(user.uid);
            
            document.getElementById('loading').classList.add('hidden');
            document.getElementById('auth-screen').classList.add('hidden');
            document.getElementById('menu-screen').classList.remove('hidden');
        } else {
            window.System.playerId = null;
            document.getElementById('loading').classList.add('hidden');
            document.getElementById('menu-screen').classList.add('hidden');
            document.getElementById('auth-screen').classList.remove('hidden');
        }
    });
};
