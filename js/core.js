/* =================================================================
   CORE DO SISTEMA (CÉREBRO) - REMASTERED + MULTIPLAYER READY
   ================================================================= */

// 1. AUDIO GLOBAL (COM VARIAÇÃO DE PITCH PARA REALISMO)
window.Sfx = {
    ctx: null,
    init: () => { window.AudioContext = window.AudioContext || window.webkitAudioContext; window.Sfx.ctx = new AudioContext(); },
    play: (f, t, d, v=0.1) => {
        if(!window.Sfx.ctx) return;
        const o = window.Sfx.ctx.createOscillator(); 
        const g = window.Sfx.ctx.createGain();
        
        // Variação orgânica (pitch wobble)
        const detune = (Math.random() - 0.5) * 100; // +/- 50 cents
        o.detune.value = detune;

        o.type=t; o.frequency.value=f; 
        g.gain.setValueAtTime(v, window.Sfx.ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, window.Sfx.ctx.currentTime+d);
        
        o.connect(g); g.connect(window.Sfx.ctx.destination); 
        o.start(); o.stop(window.Sfx.ctx.currentTime+d);
    },
    hover: () => window.Sfx.play(600 + Math.random()*50, 'sine', 0.1, 0.05),
    click: () => window.Sfx.play(800, 'square', 0.1, 0.1),
    crash: () => {
        // Som complexo de batida (Ruído)
        if(!window.Sfx.ctx) return;
        const bufferSize = window.Sfx.ctx.sampleRate * 0.5; // 0.5 sec
        const buffer = window.Sfx.ctx.createBuffer(1, bufferSize, window.Sfx.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        
        const noise = window.Sfx.ctx.createBufferSource();
        noise.buffer = buffer;
        const gain = window.Sfx.ctx.createGain();
        gain.gain.setValueAtTime(0.5, window.Sfx.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, window.Sfx.ctx.currentTime + 0.5);
        noise.connect(gain); gain.connect(window.Sfx.ctx.destination);
        noise.start();
    },
    skid: () => window.Sfx.play(150, 'sawtooth', 0.1, 0.05) // Som de derrapagem
};

// 2. SISTEMA GRÁFICO (Canvas & Helpers)
window.Gfx = {
    shake: 0,
    updateShake: (ctx) => {
        if(window.Gfx.shake > 0) {
            const dx = (Math.random()-0.5)*window.Gfx.shake;
            const dy = (Math.random()-0.5)*window.Gfx.shake;
            ctx.translate(dx, dy);
            window.Gfx.shake *= 0.9;
            if(window.Gfx.shake < 0.5) window.Gfx.shake = 0;
        }
    },
    shakeScreen: (intensity) => { window.Gfx.shake = intensity; },
    
    // Mapeia coordenadas normalizadas da IA para a tela
    map: (pt, w, h) => ({ x: (1 - pt.x) * w, y: pt.y * h }), // Espelhado horizontalmente

    // Desenha esqueleto básico para debug ou jogos de dança
    drawSkeleton: (ctx, pose, w, h) => {
        if(!pose) return;
        ctx.strokeStyle = '#00ff00'; ctx.lineWidth = 2;
        const connectors = [[5,7],[7,9],[6,8],[8,10],[5,6],[5,11],[6,12],[11,12]]; // Ombros, Braços, Tronco
        connectors.forEach(pair => {
            const p1 = pose.keypoints[pair[0]]; const p2 = pose.keypoints[pair[1]];
            if(p1.score>0.3 && p2.score>0.3) {
                const c1 = window.Gfx.map(p1, w, h); const c2 = window.Gfx.map(p2, w, h);
                ctx.beginPath(); ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.stroke();
            }
        });
    }
};

// 3. SISTEMA PRINCIPAL (Boot, Menu, Loop)
window.System = {
    video: null, canvas: null, detector: null,
    games: [], activeGame: null, loopId: null,
    sens: 1.0,
    playerId: "player_" + Math.floor(Math.random() * 9999), // ID para Multiplayer

    init: async () => {
        document.getElementById('loading').classList.remove('hidden');
        
        // Setup Webcam
        window.System.video = document.getElementById('webcam');
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: 640, height: 480, frameRate: 30 } 
        });
        window.System.video.srcObject = stream;
        await new Promise(r => window.System.video.onloadedmetadata = r);
        
        // Setup IA
        const model = poseDetection.SupportedModels.MoveNet;
        window.System.detector = await poseDetection.createDetector(model, {
            modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING // Versão rápida
        });

        // Setup Audio
        document.body.addEventListener('click', () => window.Sfx.init(), {once:true});

        // Setup Canvas
        window.System.canvas = document.getElementById('game-canvas');
        window.System.resize();
        window.addEventListener('resize', window.System.resize);

        document.getElementById('loading').classList.add('hidden');
        window.System.menu();
    },

    registerGame: (id, title, icon, logic, opts) => {
        // Evita duplicatas ao recarregar arquivos
        if(!window.System.games.find(g => g.id === id)) {
            window.System.games.push({ id, title, icon, logic, opts });
            // Cria ícone no menu
            const div = document.createElement('div');
            div.className = 'channel';
            div.onclick = () => window.System.loadGame(id);
            div.onmouseenter = window.Sfx.hover;
            div.innerHTML = `<div class="channel-icon">${icon}</div><div class="channel-title">${title}</div>`;
            document.getElementById('channel-grid').appendChild(div);
        }
    },

    menu: () => {
        window.System.stopGame();
        document.getElementById('menu-screen').classList.remove('hidden');
        document.getElementById('game-ui').classList.add('hidden');
        document.getElementById('screen-over').classList.add('hidden');
        document.getElementById('webcam').style.opacity = 0;
        document.getElementById('mp-status').style.display = 'none';
        
        // Limpa canvas
        const ctx = window.System.canvas.getContext('2d');
        ctx.clearRect(0, 0, window.System.canvas.width, window.System.canvas.height);
    },

    loadGame: (id) => {
        const game = window.System.games.find(g => g.id === id);
        if(!game) return;

        window.System.activeGame = game;
        document.getElementById('menu-screen').classList.add('hidden');
        document.getElementById('game-ui').classList.remove('hidden');
        document.getElementById('webcam').style.opacity = game.opts.camOpacity || 0.3;
        
        if (window.DB) document.getElementById('mp-status').style.display = 'block';

        game.logic.init();
        window.Sfx.click();
        window.System.loop();
    },

    loop: async () => {
        if(!window.System.activeGame) return;

        const ctx = window.System.canvas.getContext('2d');
        const w = window.System.canvas.width;
        const h = window.System.canvas.height;
        
        let pose = null; 
        try { 
            const p = await window.System.detector.estimatePoses(window.System.video, {flipHorizontal: false}); 
            if(p.length > 0) pose = p[0]; 
        } catch(e) {}
        
        ctx.save();
        window.Gfx.updateShake(ctx); // Aplica shake global
        
        // Roda o update do jogo (blindado dentro do próprio jogo)
        const s = window.System.activeGame.logic.update(ctx, w, h, pose);
        ctx.restore();

        document.getElementById('hud-score').innerText = s;
        window.System.loopId = requestAnimationFrame(window.System.loop);
    },

    stopGame: () => { 
        window.System.activeGame = null; 
        if(window.System.loopId) cancelAnimationFrame(window.System.loopId); 
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
        if(window.System.canvas){
            window.System.canvas.width = window.innerWidth; 
            window.System.canvas.height = window.innerHeight;
        } 
    },
    
    setSens: (v) => window.System.sens = parseFloat(v),
    
    msg: (t) => { 
        const el = document.getElementById('game-msg'); 
        el.innerText = t; 
        el.style.opacity = 1; el.style.transform = "translate(-50%, -50%) scale(1.2)";
        setTimeout(() => { 
            el.style.opacity = 0; el.style.transform = "translate(-50%, -50%) scale(1)"; 
        }, 1500);
    }
};

// Inicia
window.onload = window.System.init;
