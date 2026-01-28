/* =================================================================
   CORE DO SISTEMA (CÉREBRO) - VERSÃO MULTIPLAYER ESTÁVEL
   ================================================================= */

// 1. AUDIO GLOBAL
window.Sfx = {
    ctx: null,
    init: () => { window.AudioContext = window.AudioContext || window.webkitAudioContext; window.Sfx.ctx = new AudioContext(); },
    play: (f, t, d, v=0.1) => {
        if(!window.Sfx.ctx) return;
        const o = window.Sfx.ctx.createOscillator(); 
        const g = window.Sfx.ctx.createGain();
        o.type=t; o.frequency.value=f; 
        g.gain.setValueAtTime(v, window.Sfx.ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, window.Sfx.ctx.currentTime+d);
        o.connect(g); g.connect(window.Sfx.ctx.destination); 
        o.start(); o.stop(window.Sfx.ctx.currentTime+d);
    },
    hover: () => window.Sfx.play(800, 'sine', 0.05, 0.05),
    click: () => window.Sfx.play(1200, 'sine', 0.1, 0.1),
    crash: () => window.Sfx.play(100, 'sawtooth', 0.5, 0.2)
};

// 2. SISTEMA GRÁFICO
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
    map: (pt, w, h) => ({ x: (1 - pt.x) * w, y: pt.y * h }),
    drawSkeleton: (ctx, pose, w, h) => { /* Opcional: Debug visual do esqueleto */ }
};

// 3. SISTEMA PRINCIPAL
window.System = {
    video: null, canvas: null, detector: null,
    games: [], activeGame: null, loopId: null,
    playerId: null, // Será definido no init

    init: async () => {
        console.log("Iniciando System Wii...");
        
        // Gestão de Identidade do Jogador (Persistente)
        let savedId = localStorage.getItem('wii_player_id');
        if (!savedId) {
            savedId = 'Player_' + Math.floor(Math.random() * 9999);
            localStorage.setItem('wii_player_id', savedId);
        }
        window.System.playerId = savedId;
        console.log("Identidade:", window.System.playerId);

        // Câmera
        window.System.video = document.getElementById('webcam');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: 640, height: 480, frameRate: { ideal: 30 } } 
            });
            window.System.video.srcObject = stream;
            await new Promise(r => window.System.video.onloadedmetadata = r);
        } catch(e) {
            alert("Erro na Câmera! O jogo precisa de câmera para funcionar.");
        }

        // IA (MoveNet)
        const model = poseDetection.SupportedModels.MoveNet;
        window.System.detector = await poseDetection.createDetector(model, { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING });

        // Inicialização de Audio
        document.body.addEventListener('click', () => window.Sfx.init(), {once:true});

        // Canvas e Redimensionamento
        window.System.canvas = document.getElementById('game-canvas');
        window.System.resize();
        window.addEventListener('resize', window.System.resize);

        // UI
        document.getElementById('loading').classList.add('hidden');
        window.System.menu();
    },

    registerGame: (id, title, icon, logic, opts) => {
        if(!window.System.games.find(g => g.id === id)) {
            window.System.games.push({ id, title, icon, logic, opts });
            const grid = document.getElementById('channel-grid');
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
        
        const ctx = window.System.canvas.getContext('2d');
        ctx.fillStyle = "#ececec";
        ctx.fillRect(0, 0, window.System.canvas.width, window.System.canvas.height);
    },

    loadGame: (id) => {
        const game = window.System.games.find(g => g.id === id);
        if(!game) return;

        window.System.activeGame = game;
        document.getElementById('menu-screen').classList.add('hidden');
        document.getElementById('game-ui').classList.remove('hidden');
        document.getElementById('webcam').style.opacity = game.opts.camOpacity || 0.3;

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
        if (window.System.detector && window.System.video.readyState === 4) {
            try {
                const p = await window.System.detector.estimatePoses(window.System.video, {flipHorizontal: false});
                if(p.length > 0) pose = p[0];
            } catch(e) { /* Ignora frames ruins */ }
        }

        ctx.save();
        window.Gfx.updateShake(ctx);
        const s = window.System.activeGame.logic.update(ctx, w, h, pose);
        ctx.restore();

        if(typeof s === 'number') document.getElementById('hud-score').innerText = s;

        window.System.loopId = requestAnimationFrame(window.System.loop);
    },

    stopGame: () => {
        if (window.System.activeGame && window.System.activeGame.logic.cleanup) {
            window.System.activeGame.logic.cleanup();
        }
        window.System.activeGame = null;
        if(window.System.loopId) {
            cancelAnimationFrame(window.System.loopId);
            window.System.loopId = null;
        }
    },

    home: () => { window.Sfx.click(); window.System.menu(); },
    
    gameOver: (s) => {
        window.System.stopGame();
        window.Sfx.crash();
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
        el.innerText = t; el.style.opacity = 1;
        setTimeout(() => el.style.opacity = 0, 2000);
    }
};

window.onload = window.System.init;
