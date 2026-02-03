/* =================================================================
   CORE DO SISTEMA (CÉREBRO) - VERSÃO SENIOR V3 (PATCHED)
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
            const o = window.Sfx.ctx.createOscillator(); 
            const g = window.Sfx.ctx.createGain();
            o.type=t; o.frequency.value=f; 
            g.gain.setValueAtTime(v, window.Sfx.ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.001, window.Sfx.ctx.currentTime+d);
            o.connect(g); g.connect(window.Sfx.ctx.destination); 
            o.start(); o.stop(window.Sfx.ctx.currentTime+d);
        } catch(e){}
    },
    hover: () => window.Sfx.play(800, 'sine', 0.05, 0.04),
    click: () => window.Sfx.play(1000, 'sine', 0.1, 0.08),
    crash: () => window.Sfx.play(100, 'sawtooth', 0.4, 0.15),
    coin: () => window.Sfx.play(1200, 'sine', 0.1, 0.1),
    hit: () => window.Sfx.play(400, 'square', 0.1, 0.1)
};

window.Gfx = {
    shake: 0,
    updateShake: (ctx) => {
        if(window.Gfx.shake > 0) {
            ctx.translate((Math.random()-0.5)*window.Gfx.shake, (Math.random()-0.5)*window.Gfx.shake);
            window.Gfx.shake *= 0.9;
            if(window.Gfx.shake < 0.5) window.Gfx.shake = 0;
        }
    },
    shakeScreen: (i) => { window.Gfx.shake = i; },
    map: (pt, w, h) => ({ x: (1 - pt.x/640) * w, y: (pt.y/480) * h })
};

window.System = {
    video: null, canvas: null, detector: null,
    games: [], activeGame: null, loopId: null,
    playerId: 'Player_' + Math.floor(Math.random() * 9999),

    init: async () => {
        // FIX: Verifica se o elemento existe antes de usar
        const loadingText = document.getElementById('loading-text');
        window.System.canvas = document.getElementById('game-canvas');
        window.System.resize();
        window.addEventListener('resize', window.System.resize);

        try {
            window.System.video = document.getElementById('webcam');
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: 640, height: 480, frameRate: 30 } 
            });
            window.System.video.srcObject = stream;
            await new Promise(r => window.System.video.onloadedmetadata = r);
            window.System.video.play();
        } catch(e) { 
            if(loadingText) loadingText.innerText = "SEM CÂMERA DETECTADA"; 
        }

        if (typeof poseDetection !== 'undefined') {
            window.System.detector = await poseDetection.createDetector(
                poseDetection.SupportedModels.MoveNet, 
                { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
            );
        }

        const fbConfig = {
            apiKey: "AIzaSyB0ThqhfK6xc8P1D4WCkavhdXbb7zIaQJk",
            databaseURL: "https://thiaguinhowii-default-rtdb.firebaseio.com"
        };
        try {
            if(!firebase.apps.length) firebase.initializeApp(fbConfig);
            window.DB = firebase.database();
            const netStatus = document.getElementById('net-status');
            if(netStatus) {
                netStatus.innerText = "ONLINE 🟢";
                netStatus.style.color = "#4CAF50";
            }
        } catch(e) {}

        const loadEl = document.getElementById('loading');
        if(loadEl) loadEl.classList.add('hidden');
        window.System.menu();
        document.body.addEventListener('click', () => window.Sfx.init(), {once:true});
    },

    registerGame: (id, title, icon, logic, opts) => {
        if(window.System.games.find(g => g.id === id)) return;
        window.System.games.push({ id, title, icon, logic, opts });
        const grid = document.getElementById('channel-grid');
        if(grid) {
            const div = document.createElement('div');
            div.className = 'channel';
            div.innerHTML = `<div class="channel-icon">${icon}</div><div class="channel-title">${title}</div>`;
            div.onclick = () => window.System.loadGame(id);
            div.onmouseenter = window.Sfx.hover;
            grid.appendChild(div);
        }
    },

    menu: () => {
        window.System.stopGame();
        document.getElementById('menu-screen').classList.remove('hidden');
        document.getElementById('game-ui').classList.add('hidden');
        document.getElementById('screen-over').classList.add('hidden');
        document.getElementById('webcam').style.opacity = 0;
    },

    loadGame: (id) => {
        const game = window.System.games.find(g => g.id === id);
        if(!game) return;
        window.System.activeGame = game;
        document.getElementById('menu-screen').classList.add('hidden');
        document.getElementById('game-ui').classList.remove('hidden');
        document.getElementById('webcam').style.opacity = game.opts.camOpacity || 0.2;
        if (game.logic.init) game.logic.init();
        window.Sfx.click();
        window.System.loop();
    },

    loop: async () => {
        if(!window.System.activeGame) return;
        const ctx = window.System.canvas.getContext('2d');
        const w = window.System.canvas.width;
        const h = window.System.canvas.height;

        let pose = null;
        if (window.System.detector && window.System.video && window.System.video.readyState === 4) {
            const p = await window.System.detector.estimatePoses(window.System.video, {flipHorizontal: false});
            if(p.length > 0) pose = p[0];
        }

        ctx.save();
        window.Gfx.updateShake(ctx);
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

    home: () => { window.Sfx.click(); window.System.menu(); },
    
    gameOver: (s) => {
        window.System.stopGame();
        document.getElementById('final-score').innerText = s;
        document.getElementById('game-ui').classList.add('hidden');
        document.getElementById('screen-over').classList.remove('hidden');
    },

    resize: () => {
        if(window.System.canvas) {
            window.System.canvas.width = window.innerWidth;
            window.System.canvas.height = window.innerHeight;
        }
    },

    msg: (t) => {
        const el = document.getElementById('game-msg');
        if(el) {
            el.innerText = t; el.style.opacity = 1;
            setTimeout(() => el.style.opacity = 0, 1500);
        }
    }
};

window.onload = window.System.init;
