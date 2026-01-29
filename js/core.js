/* =================================================================
   CORE DO SISTEMA (KERNEL)
   ================================================================= */

window.Sfx = {
    ctx: null,
    init: () => { 
        if(!window.Sfx.ctx) window.Sfx.ctx = new (window.AudioContext || window.webkitAudioContext)(); 
    },
    play: (freq, type, dur, vol=0.1) => {
        if(!window.Sfx.ctx) return;
        const o = window.Sfx.ctx.createOscillator(); 
        const g = window.Sfx.ctx.createGain();
        o.type = type; o.frequency.value = freq; 
        g.gain.setValueAtTime(vol, window.Sfx.ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, window.Sfx.ctx.currentTime + dur);
        o.connect(g); g.connect(window.Sfx.ctx.destination); 
        o.start(); o.stop(window.Sfx.ctx.currentTime + dur);
    },
    hover: () => window.Sfx.play(400, 'sine', 0.1, 0.05),
    click: () => window.Sfx.play(800, 'square', 0.1, 0.1),
    engine: (rpm) => window.Sfx.play(50 + (rpm * 100), 'sawtooth', 0.1, 0.05)
};

window.System = {
    video: null, canvas: null, ctx: null, detector: null,
    activeGame: null, loopId: null, lastTime: 0,
    playerId: 'Player_' + Math.floor(Math.random() * 9999),
    pose: null, // Armazena a última pose detectada globalmente

    init: async () => {
        console.log("🚀 System Booting...");
        window.System.video = document.getElementById('webcam');
        window.System.canvas = document.getElementById('game-canvas');
        window.System.ctx = window.System.canvas.getContext('2d', { alpha: false });
        
        // Setup Inputs
        window.addEventListener('resize', window.System.resize);
        window.System.resize();
        document.body.addEventListener('click', () => window.Sfx.init(), {once:true});

        // 1. Câmera
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: 640, height: 480, frameRate: { ideal: 30 } } 
            });
            window.System.video.srcObject = stream;
            await new Promise(r => window.System.video.onloadedmetadata = r);
            window.System.video.play();
            console.log("📷 Câmera OK");
        } catch(e) {
            console.warn("Sem câmera ou permissão negada. Usando teclado.");
        }

        // 2. IA (MoveNet) - Carregamento em Background
        try {
            const model = poseDetection.SupportedModels.MoveNet;
            window.System.detector = await poseDetection.createDetector(model, { 
                modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING 
            });
            console.log("🧠 IA Carregada");
            window.System.startPoseLoop();
        } catch(e) {
            console.error("Erro IA:", e);
        }

        document.getElementById('loading').classList.add('hidden');
        
        // Inicia o Jogo de Kart direto (ou menu se preferir)
        if(window.KartGame) window.System.loadGame(window.KartGame);
    },

    // Loop Dedicado de IA (Desacoplado do Render)
    startPoseLoop: async () => {
        const detect = async () => {
            if (window.System.detector && window.System.video.readyState === 4) {
                try {
                    const p = await window.System.detector.estimatePoses(window.System.video, {flipHorizontal: true});
                    if(p.length > 0) window.System.pose = p[0];
                } catch(e) { }
            }
            requestAnimationFrame(detect);
        };
        detect();
    },

    loadGame: (gameObj) => {
        if(window.System.activeGame && window.System.activeGame.cleanup) window.System.activeGame.cleanup();
        window.System.activeGame = gameObj;
        gameObj.init();
        window.System.lastTime = performance.now();
        window.System.loop();
    },

    loop: (timestamp) => {
        if(!window.System.activeGame) return;

        const dt = (timestamp - window.System.lastTime) / 1000 || 0.016; // Delta Time em segundos
        window.System.lastTime = timestamp;

        const w = window.System.canvas.width;
        const h = window.System.canvas.height;

        // Update & Render
        window.System.activeGame.update(dt, window.System.pose);
        window.System.activeGame.draw(window.System.ctx, w, h);

        window.System.loopId = requestAnimationFrame(window.System.loop);
    },

    resize: () => {
        if(window.System.canvas) {
            window.System.canvas.width = window.innerWidth;
            window.System.canvas.height = window.innerHeight;
        }
    }
};

window.onload = window.System.init;
