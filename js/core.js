/* =================================================================
   CORE DO SISTEMA - VERSÃO COM LOGIN E INTEGRAÇÃO FIREBASE DB
   STATUS: GESTÃO DE SESSÃO E PERMISSÕES DE JOGOS ATIVADAS
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
    click: () => window.Sfx.play(1000, 'sine', 0.1, 0.08),
    error: () => window.Sfx.play(150, 'sawtooth', 0.3, 0.1),
    coin: () => { window.Sfx.play(988, 'sine', 0.1, 0.1); setTimeout(()=>window.Sfx.play(1319, 'sine', 0.2, 0.1), 100); },
    epic: () => { window.Sfx.play(400, 'square', 0.5, 0.2); setTimeout(()=>window.Sfx.play(600, 'sawtooth', 0.5, 0.2), 200); setTimeout(()=>window.Sfx.play(800, 'sine', 1.0, 0.3), 400); }
};

window.Gfx = {
    shake: 0,
    addShake: (val) => { window.Gfx.shake = Math.min(window.Gfx.shake + val, 30); },
    updateShake: (ctx) => {
        if(window.Gfx.shake > 0.5) {
            ctx.translate((Math.random()-0.5)*window.Gfx.shake, (Math.random()-0.5)*window.Gfx.shake);
            window.Gfx.shake *= 0.85;
        } else window.Gfx.shake = 0;
    },
    shakeScreen: (val) => { window.Gfx.addShake(val); }
};

window.Auth = {
    getFakeEmail: (username) => {
        return username.trim().toLowerCase().replace(/\s+/g, '') + '@thiaguinho.os';
    },
    
    showError: (msg) => {
        const errEl = document.getElementById('auth-error');
        errEl.innerText = msg;
        errEl.style.display = 'block';
        window.Sfx.error();
    },

    login: async () => {
        window.Sfx.click();
        const user = document.getElementById('auth-user').value;
        const pass = document.getElementById('auth-pass').value;
        if(!user || !pass) return window.Auth.showError("Preenche nome e senha!");
        
        try {
            document.getElementById('loading').classList.remove('hidden');
            await window.AuthApp.signInWithEmailAndPassword(window.Auth.getFakeEmail(user), pass);
        } catch(e) {
            document.getElementById('loading').classList.add('hidden');
            window.Auth.showError("Credenciais inválidas. Tenta de novo!");
        }
    },

    register: async () => {
        window.Sfx.click();
        const user = document.getElementById('auth-user').value.trim();
        const pass = document.getElementById('auth-pass').value;
        if(!user || pass.length < 6) return window.Auth.showError("O nome não pode estar vazio e a senha deve ter 6 dígitos!");
        
        try {
            document.getElementById('loading').classList.remove('hidden');
            const cred = await window.AuthApp.createUserWithEmailAndPassword(window.Auth.getFakeEmail(user), pass);
            
            const role = user.toLowerCase() === 'thiago' ? 'admin' : 'player';
            
            const initialProfile = {
                username: user,
                role: role,
                xp: 0,
                level: 1,
                coins: 0,
                permissions: {}
            };
            
            if(window.Games) {
                window.Games.forEach(g => {
                    initialProfile.permissions[g.id] = (role === 'admin' || g.id === 'drive'); 
                });
            }

            await window.DB.ref('users/' + cred.user.uid).set(initialProfile);
        } catch(e) {
            document.getElementById('loading').classList.add('hidden');
            window.Auth.showError("Nome já existe ou ocorreu um erro.");
        }
    },

    logout: () => {
        window.Sfx.click();
        window.AuthApp.signOut();
    }
};

window.Profile = {
    username: 'Jogador', role: 'player', xp: 0, level: 1, coins: 0, permissions: {},
    
    // Suporte aos Dados do Jogo de AR
    arSave: { 
        upgrades: { engine: 1, battery: 1, radar: 1, chassis: 1, scout: false } 
    },

    loadFromFirebase: (uid) => {
        return new Promise((resolve) => {
            window.DB.ref('users/' + uid).on('value', snap => {
                const data = snap.val();
                if(data) {
                    window.Profile.username = data.username || 'Jogador';
                    window.Profile.role = data.role || 'player';
                    window.Profile.xp = data.xp || 0;
                    window.Profile.level = data.level || 1;
                    window.Profile.coins = data.coins || 0;
                    window.Profile.permissions = data.permissions || {};
                    if(data.arSave) window.Profile.arSave = data.arSave;
                    window.Profile.updateUI();
                    window.System.renderChannels(); 
                }
                resolve();
            });
        });
    },

    save: () => { 
        if(window.System.playerId && window.System.playerId.length > 20) {
            window.DB.ref('users/' + window.System.playerId).update({
                xp: window.Profile.xp,
                level: window.Profile.level,
                coins: window.Profile.coins,
                arSave: window.Profile.arSave
            });
        }
        window.Profile.updateUI(); 
    },

    // Função que o game_ar.js vai chamar para gastar/ganhar dinheiro
    saveAR: (arMoney, arUpgrades) => {
        window.Profile.coins = arMoney;
        window.Profile.arSave.upgrades = arUpgrades;
        window.Profile.save();
    },

    addReward: (score, isWin, extraCoins = 0) => {
        let xpGained = isWin ? Math.max(100, Math.floor(score * 2.0)) : Math.max(20, Math.floor(score * 0.5));
        let coinsGained = (isWin ? Math.max(10, Math.floor(score * 0.2)) : 0) + extraCoins; 
        
        window.Profile.xp += xpGained; window.Profile.coins += coinsGained;
        
        let nextLevelXP = window.Profile.level * 1000; let leveledUp = false;
        while(window.Profile.xp >= nextLevelXP) {
            window.Profile.level++; window.Profile.xp -= nextLevelXP; nextLevelXP = window.Profile.level * 1000; leveledUp = true;
        }
        window.Profile.save(); return { xp: xpGained, coins: coinsGained, leveledUp };
    },

    updateUI: () => {
        const reqXP = window.Profile.level * 1000; const pct = Math.min(100, (window.Profile.xp / reqXP) * 100);
        const nameEl = document.getElementById('ui-username'); if(nameEl) nameEl.innerText = window.Profile.username;
        document.getElementById('ui-level').innerText = window.Profile.level;
        document.getElementById('ui-xp-text').innerText = `${window.Profile.xp}/${reqXP}`;
        document.getElementById('ui-xp-bar').style.width = `${pct}%`;
        document.getElementById('ui-coins').innerText = window.Profile.coins;

        const adminBtnContainer = document.getElementById('admin-btn-container');
        if (adminBtnContainer) {
            if (window.Profile.role === 'admin') {
                adminBtnContainer.innerHTML = `<div class="wii-oval-btn" onclick="window.Admin.init()" style="border-color:#e67e22; color:#e67e22;">Painel Admin</div>`;
            } else {
                adminBtnContainer.innerHTML = '';
            }
        }
    },

    getRank: (score, isWin) => {
        if(!isWin) return { rank: 'D', color: '#95a5a6', msg: "FALHOU" };
        if(score > 3000) return { rank: 'S', color: '#f1c40f', msg: "LENDÁRIO!" };
        if(score > 1500) return { rank: 'A', color: '#e74c3c', msg: "EXCELENTE!" };
        if(score > 800)  return { rank: 'B', color: '#3498db', msg: "MUITO BOM" };
        return { rank: 'C', color: '#2ecc71', msg: "SUCESSO" };
    }
};

window.System = {
    playerId: 'p_' + Math.floor(Math.random()*10000), 
    activeGame: null, loopId: null, canvas: null, video: null, detector: null,
    currentCameraMode: null,

    switchCamera: async (facingMode) => {
        if (window.System.currentCameraMode === facingMode) return;
        if (window.System.video.srcObject) {
            window.System.video.srcObject.getTracks().forEach(track => track.stop());
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: facingMode }, width: 640, height: 480 },
                audio: false
            });
            window.System.video.srcObject = stream;
            
            if (facingMode === 'environment') {
                window.System.video.style.transform = "none";
            } else {
                window.System.video.style.transform = "scaleX(-1)";
            }
            
            await new Promise((resolve) => { window.System.video.onloadedmetadata = () => resolve(); });
            window.System.currentCameraMode = facingMode;
        } catch(error) {
            console.error("Erro ao trocar de câmera:", error);
        }
    },

    registerGame: (id, title, icon, logic, opts={}) => {
        if(!window.Games) window.Games = [];
        const existing = window.Games.findIndex(g => g.id === id);
        if(existing >= 0) window.Games[existing] = {id, title, icon, logic, opts};
        else window.Games.push({id, title, icon, logic, opts});
        window.System.renderChannels();
    },

    renderChannels: () => {
        const grid = document.getElementById('channel-grid'); if(!grid) return; grid.innerHTML = '';
        window.Games.forEach(g => {
            const hasAccess = window.Profile.role === 'admin' || window.Profile.permissions[g.id] === true;
            if (hasAccess) {
                const div = document.createElement('div'); div.className = 'channel';
                div.innerHTML = `<div class="channel-icon">${g.icon}</div><div class="channel-title">${g.title}</div>`;
                div.onclick = () => { window.Sfx.click(); window.System.openPhases(g); };
                div.onmouseenter = () => window.Sfx.hover(); grid.appendChild(div);
            }
        });
    },

    openPhases: (game) => {
        document.getElementById('menu-screen').classList.add('hidden');
        document.getElementById('phase-screen').classList.remove('hidden');
        document.getElementById('phase-title').innerText = game.title.toUpperCase();
        
        const grid = document.getElementById('phase-grid'); grid.innerHTML = '';
        const phases = game.opts.phases || [ { id: 'arcade', name: 'MODO ARCADE', desc: 'Jogue livremente offline ou online', reqLvl: 1 } ];

        phases.forEach(fase => {
            const isUnlocked = window.Profile.level >= fase.reqLvl;
            const card = document.createElement('div');
            card.className = `mission-card ${isUnlocked ? '' : 'locked'}`;
            card.innerHTML = `
                <div class="mission-info">
                    <h2>${fase.name}</h2>
                    <p>${fase.desc}</p>
                </div>
                <div class="mission-icon">${isUnlocked ? '⭐' : '🔒'}</div>
            `;
            
            if(isUnlocked) {
                card.onclick = async () => {
                    window.Sfx.click();
                    document.getElementById('phase-screen').classList.add('hidden');
                    document.getElementById('loading').classList.remove('hidden');
                    document.getElementById('loading-text').innerText = "AJUSTANDO SENSORES...";

                    const targetCamera = game.opts.camera === 'environment' ? 'environment' : 'user';
                    await window.System.switchCamera(targetCamera);

                    document.getElementById('loading-text').innerText = "CARREGANDO MISSÃO...";
                    
                    setTimeout(() => {
                        document.getElementById('loading').classList.add('hidden');
                        document.getElementById('game-ui').classList.remove('hidden');
                        window.System.activeGame = game;
                        if(game.logic.init) game.logic.init(fase);
                        window.System.loop();
                    }, 500);
                };
            } else {
                card.onclick = () => window.System.msg(`Requer Nível ${fase.reqLvl}`);
            }
            grid.appendChild(card);
        });
    },

    loop: async () => {
        if(!window.System.activeGame) return;
        const w = window.System.canvas.width; const h = window.System.canvas.height;
        const ctx = window.System.canvas.getContext('2d');
        let pose = null;

        const isArMode = window.System.activeGame.opts.camera === 'environment';

        if(!isArMode && window.System.detector && window.System.video.readyState === 4) {
            const p = await window.System.detector.estimatePoses(window.System.video, {flipHorizontal: false});
            if(p.length > 0) pose = p[0];
        }

        ctx.save(); window.Gfx.updateShake(ctx);
        const score = window.System.activeGame.logic.update(ctx, w, h, pose);
        ctx.restore();
        
        const hud = document.getElementById('hud-score');
        if(hud) hud.innerText = Math.floor(score || 0);
        window.System.loopId = requestAnimationFrame(window.System.loop);
    },

    stopGame: () => {
        if(window.System.loopId) cancelAnimationFrame(window.System.loopId);
        if(window.System.activeGame?.logic.cleanup) window.System.activeGame.logic.cleanup();
        window.System.activeGame = null;
    },

    menu: () => { 
        window.System.stopGame(); 
        document.getElementById('game-ui').classList.add('hidden');
        document.getElementById('screen-over').classList.add('hidden');
        document.getElementById('phase-screen').classList.add('hidden');
        document.getElementById('menu-screen').classList.remove('hidden');
        window.Profile.updateUI(); 
    },
    home: () => { window.Sfx.click(); window.System.menu(); },
    
    gameOver: (score, isWin = true, coinsInGame = 0) => {
        window.System.stopGame();
        let finalScore = Math.floor(score || 0);
        
        let rewards = window.Profile.addReward(finalScore, isWin, coinsInGame);
        let rankData = window.Profile.getRank(finalScore, isWin);

        document.getElementById('result-header').innerText = isWin ? "MISSÃO CONCLUÍDA!" : "FALHA NA MISSÃO";
        document.getElementById('result-header').style.color = isWin ? "#2ecc71" : "#e74c3c";
        document.getElementById('final-score').innerText = finalScore;
        document.getElementById('result-status').innerText = rankData.msg;
        document.getElementById('result-xp').innerText = `+${rewards.xp}`;
        document.getElementById('result-coins').innerText = `+${rewards.coins}`;
        
        const rankStamp = document.getElementById('result-rank');
        rankStamp.innerText = rankData.rank;
        rankStamp.style.color = rankData.color;
        rankStamp.classList.remove('show');

        document.getElementById('game-ui').classList.add('hidden');
        document.getElementById('screen-over').classList.remove('hidden');
        
        setTimeout(() => {
            rankStamp.classList.add('show');
            if (isWin && (rankData.rank === 'S' || rankData.rank === 'A')) { window.Sfx.epic(); window.Gfx.shakeScreen(15); } 
            else if (isWin) { window.Sfx.coin(); }
            else { window.Sfx.error(); }
            if(rewards.leveledUp) setTimeout(() => window.System.msg("🔥 LEVEL UP! 🔥"), 1000);
        }, 300); 
    },

    resize: () => { if(window.System.canvas) { window.System.canvas.width = window.innerWidth; window.System.canvas.height = window.innerHeight; } },
    msg: (t) => {
        const el = document.getElementById('game-msg');
        if(el) { el.innerText = t; el.style.animation = 'none'; el.offsetHeight; el.style.animation = 'popMsg 1.5s forwards'; }
    }
};

const style = document.createElement('style');
style.innerHTML = `@keyframes popMsg { 0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0; } 15% { transform: translate(-50%, -50%) scale(1.2); opacity: 1; } 30% { transform: translate(-50%, -50%) scale(1); opacity: 1; } 80% { transform: translate(-50%, -50%) scale(1); opacity: 1; } 100% { transform: translate(-50%, -50%) scale(1.5); opacity: 0; } }`;
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