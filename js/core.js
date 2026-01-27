/**
 * =============================================================================
 * THIAGUINHO CORE v10.0 (DYNAMIC KERNEL)
 * =============================================================================
 * - Gerenciamento robusto de memória e câmera.
 * - Sistema de Menu Reativo (Atualiza assim que um jogo é instalado).
 * - Tratamento de erro para jogos não encontrados.
 * =============================================================================
 */

window.Sfx = {
    ctx: null,
    init: function() {
        if (!this.ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (AC) this.ctx = new AC();
        }
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },
    play: function(freq, type, dur, vol = 0.1) {
        if (!this.ctx) return;
        try {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type; osc.frequency.value = freq;
            gain.gain.setValueAtTime(vol, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.start(); osc.stop(this.ctx.currentTime + dur);
        } catch(e) {}
    },
    boot: function() { this.play(1046, 'square', 0.1, 0.1); setTimeout(()=>this.play(2093, 'square', 0.2, 0.1), 100); },
    click: function() { this.play(800, 'triangle', 0.05, 0.1); },
    coin: function() { this.play(1500,'square',0.1, 0.05); setTimeout(()=>this.play(2000,'square',0.1, 0.05), 80); },
    crash: function() { this.play(80,'sawtooth',0.5, 0.5); window.Sfx.play(50,'square',0.6, 0.5); }
};

window.Gfx = {
    shakeIntensity: 0,
    map: function(p, w, h) { return { x: w - (p.x / 640 * w), y: p.y / 480 * h }; },
    shake: function(amount) { this.shakeIntensity = amount; },
    updateShake: function(ctx) {
        if (this.shakeIntensity > 0) {
            const dx = (Math.random() - 0.5) * this.shakeIntensity;
            const dy = (Math.random() - 0.5) * this.shakeIntensity;
            ctx.translate(dx, dy);
            this.shakeIntensity *= 0.9;
            if (this.shakeIntensity < 0.5) this.shakeIntensity = 0;
        }
    },
    drawSkeleton: function(ctx, pose, w, h) {
        if(!pose) return;
        const kp = pose.keypoints;
        ctx.strokeStyle = '#00ff00'; ctx.lineWidth = 2;
        const connect = (a,b) => {
            const p1=kp.find(k=>k.name===a), p2=kp.find(k=>k.name===b);
            if(p1&&p2&&p1.score>0.3&&p2.score>0.3) {
                const m1=this.map(p1,w,h), m2=this.map(p2,w,h);
                ctx.beginPath(); ctx.moveTo(m1.x,m1.y); ctx.lineTo(m2.x,m2.y); ctx.stroke();
            }
        };
        connect('left_shoulder','right_shoulder');
        connect('left_shoulder','left_elbow'); connect('left_elbow','left_wrist');
        connect('right_shoulder','right_elbow'); connect('right_elbow','right_wrist');
    }
};

window.System = {
    video: null, canvas: null, ctx: null, detector: null,
    activeGame: null, loopId: null, 
    games: {}, // Registro de jogos instalados

    // --- REGISTRO DE JOGOS (MÉTODO CRÍTICO) ---
    registerGame: function(id, meta, logic) {
        console.log(`[SYSTEM] Instalando jogo: ${id}`);
        this.games[id] = { meta, logic };
        // Atualiza o menu instantaneamente se ele já estiver visível ou carregado no DOM
        this.renderMenu(); 
    },

    // --- BOOT DO SISTEMA ---
    boot: async function() {
        const log = document.getElementById('boot-log');
        const safetyScreen = document.getElementById('screen-safety');
        const loadScreen = document.getElementById('screen-load');
        
        log.innerText = "INICIANDO SISTEMA...";
        window.Sfx.init();

        try {
            // 1. Câmera
            log.innerText = "BUSCANDO CÂMERA...";
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, 
                audio: false 
            });
            
            this.video = document.getElementById('video-source');
            this.video.srcObject = stream;
            document.getElementById('webcam').srcObject = stream;
            
            await new Promise(r => this.video.onloadedmetadata = r);
            this.video.play();

            // 2. TensorFlow (Pose Detection)
            log.innerText = "CARREGANDO IA...";
            await tf.setBackend('webgl');
            this.detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
                modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING
            });

            // 3. Interface
            this.canvas = document.getElementById('game-canvas');
            this.ctx = this.canvas.getContext('2d', { alpha: true });
            
            safetyScreen.classList.add('hidden');
            loadScreen.classList.remove('hidden');
            
            setTimeout(() => {
                loadScreen.classList.add('hidden');
                this.menu();
                window.Sfx.boot();
            }, 2000);

        } catch (e) {
            log.innerText = "ERRO: " + e.message;
            console.error(e);
            alert("Erro ao acessar câmera ou carregar IA. Verifique permissões.");
        }
    },

    // --- MENU DINÂMICO ---
    renderMenu: function() {
        const grid = document.getElementById('channel-grid');
        if(!grid) return;

        grid.innerHTML = ''; // Limpa grid atual
        const gameKeys = Object.keys(this.games);

        // Renderiza Canais de Jogos
        gameKeys.forEach(id => {
            const g = this.games[id];
            const div = document.createElement('div');
            div.className = 'channel';
            div.innerHTML = `
                <div class="channel-icon">${g.meta.icon}</div>
                <div class="channel-name">${g.meta.name}</div>
            `;
            div.onclick = () => window.System.launchGame(id);
            grid.appendChild(div);
        });

        // Preenche espaços vazios (Estética Wii)
        for(let i=0; i < (12 - gameKeys.length); i++) {
            const div = document.createElement('div');
            div.className = 'channel channel-empty';
            grid.appendChild(div);
        }
    },

    menu: function() {
        this.stopGame();
        document.getElementById('screen-menu').classList.remove('hidden');
        document.getElementById('game-ui').classList.add('hidden');
        document.getElementById('screen-over').classList.add('hidden');
        document.getElementById('webcam').style.opacity = 0;
        this.renderMenu();
    },

    // --- LANÇADOR DE JOGOS ---
    launchGame: function(id) {
        if (!this.games[id]) {
            console.error(`[SYSTEM] Erro fatal: Jogo '${id}' não encontrado no registro.`);
            alert("Erro: Jogo não instalado corretamente.");
            return;
        }

        window.Sfx.click();
        const game = this.games[id];
        
        // UI Transition
        document.getElementById('screen-menu').classList.add('hidden');
        document.getElementById('game-ui').classList.remove('hidden');
        document.getElementById('webcam').style.opacity = game.meta.camOpacity || 0.2;
        
        // Start Engine
        this.activeGame = game;
        this.resize();
        game.logic.init();
        this.loop();
    },

    // --- LOOP PRINCIPAL (ENGINE) ---
    loop: async function() {
        if(!this.activeGame) return;

        const w = window.System.canvas.width;
        const h = window.System.canvas.height;
        let pose = null;

        try {
            if (this.detector && this.video.readyState === 4) {
                const p = await this.detector.estimatePoses(this.video, {flipHorizontal: false});
                if(p.length > 0) pose = p[0];
            }
        } catch(e) {}
        
        const ctx = this.ctx;
        ctx.clearRect(0,0,w,h);
        
        ctx.save();
        window.Gfx.updateShake(ctx); // Aplica shake global se houver
        const score = this.activeGame.logic.update(ctx, w, h, pose);
        ctx.restore();

        // Atualiza HUD Score se disponível
        const hud = document.getElementById('hud-score');
        if(hud && score !== undefined) hud.innerText = Math.floor(score).toString();

        this.loopId = requestAnimationFrame(() => this.loop());
    },

    stopGame: function() {
        if(this.loopId) cancelAnimationFrame(this.loopId);
        this.activeGame = null;
        this.ctx.clearRect(0,0, this.canvas.width, this.canvas.height);
    },

    gameOver: function(score) {
        this.stopGame();
        window.Sfx.crash();
        document.getElementById('final-score').innerText = Math.floor(score);
        document.getElementById('game-ui').classList.add('hidden');
        document.getElementById('screen-over').classList.remove('hidden');
    },

    msg: function(text) { 
        const el = document.getElementById('game-msg'); 
        if(el) {
            el.innerText = text;
            el.classList.remove('pop');
            void el.offsetWidth; // Trigger reflow
            el.classList.add('pop');
            setTimeout(() => el.classList.remove('pop'), 2000);
        }
    },

    home: function() { 
        window.Sfx.click(); 
        this.menu(); 
    },
    
    resize: function() {
        if(this.canvas) {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
        }
    }
};

window.addEventListener('resize', () => window.System.resize());