/**
 * NEO-WII Game Engine v40.0 (REFLEXIVE REVOLUTION)
 * Status: GOLD MASTER 🟢
 * Architecture: Reflexive Buffer, Newtonian Physics, DSP Biofeedback.
 */

const AudioSys = {
    ctx: null,
    master: null,
    drone: { osc: null, gain: null, panner: null },
    filter: null,
    
    init: function() {
        if (this.ctx) return;
        window.AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();
        
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.4;
        
        // Lowpass Filter para simular "Abafamento" em momentos de tensão
        this.filter = this.ctx.createBiquadFilter();
        this.filter.type = "lowpass";
        this.filter.frequency.value = 20000;
        
        this.master.connect(this.filter);
        this.filter.connect(this.ctx.destination);
    },

    startDrone: function(mode) {
        if (!this.ctx) this.init();
        if (this.drone.osc) { try{this.drone.osc.stop();}catch(e){} }

        this.drone.osc = this.ctx.createOscillator();
        this.drone.gain = this.ctx.createGain();
        this.drone.gain.gain.value = 0;

        if (mode === 'kart') {
            this.drone.osc.type = 'sawtooth'; // Motor térmico
            this.drone.osc.frequency.value = 60;
        } else if (mode === 'zen') {
            this.drone.osc.type = 'sine'; // Harmonia Pura
            this.drone.osc.frequency.value = 180;
        } else {
            this.drone.osc = null; // Run é percussivo
            return;
        }

        this.drone.osc.connect(this.drone.gain);
        this.drone.gain.connect(this.master);
        this.drone.osc.start();
    },

    // DSP: Digital Signal Processing baseado em Estado Físico
    updateDrone: function(physicsValue, tension, mode) {
        if (!this.drone.osc) return;
        const t = this.ctx.currentTime;

        if (mode === 'kart') {
            // physicsValue = Speed (RPM)
            // tension = Drift Angle (Pneu cantando)
            const rpm = 60 + (physicsValue * 250);
            this.drone.osc.frequency.setTargetAtTime(rpm, t, 0.1);
            
            // Volume sobe com carga, mas "engasga" se sair da pista
            const vol = 0.1 + (physicsValue * 0.1) + (tension * 0.05);
            this.drone.gain.gain.setTargetAtTime(vol, t, 0.1);
        } 
        else if (mode === 'zen') {
            // physicsValue = Harmonia (0-1)
            // tension = Jitter/Ansiedade (0-1)
            
            // Se tenso, o som desafina (Detune) e fica grave (Filter)
            const detune = tension * 300; 
            const baseFreq = 180 + (physicsValue * 20);
            
            this.drone.osc.frequency.setTargetAtTime(baseFreq + detune, t, 0.5);
            this.drone.gain.gain.setTargetAtTime(0.1, t, 0.5);
            
            // Efeito de "Ouvido Tapado" na tensão
            const filterFreq = 20000 - (tension * 19000);
            this.filter.frequency.setTargetAtTime(filterFreq, t, 0.5);
        }
    },

    play: function(type, intensity = 1.0) {
        if(!this.ctx) this.init();
        if(this.ctx.state === 'suspended') this.ctx.resume().catch(()=>{});

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const t = this.ctx.currentTime;
        
        osc.connect(gain); gain.connect(this.master);

        switch (type) {
            case 'start': 
                osc.type = 'sine';
                osc.frequency.setValueAtTime(440, t);
                osc.frequency.exponentialRampToValueAtTime(880, t + 0.4);
                gain.gain.setValueAtTime(0.5, t);
                gain.gain.linearRampToValueAtTime(0, t + 0.5);
                this.vibrate(200);
                break;
            case 'boost': 
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(100, t);
                osc.frequency.linearRampToValueAtTime(600, t + 0.5);
                gain.gain.setValueAtTime(0.3, t);
                gain.gain.linearRampToValueAtTime(0, t + 0.5);
                break;
            case 'step': 
                // Percussão baseada na força da pisada
                osc.type = 'square';
                osc.frequency.setValueAtTime(60, t);
                osc.frequency.exponentialRampToValueAtTime(10, t + 0.1);
                gain.gain.setValueAtTime(0.1 * intensity, t);
                gain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
                break;
            case 'rupture': // Som de quebra mental (Zen)
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(100, t);
                osc.frequency.exponentialRampToValueAtTime(50, t + 1.0);
                gain.gain.setValueAtTime(0.3, t);
                gain.gain.exponentialRampToValueAtTime(0.01, t + 1.0);
                break;
            case 'resolve': // Harmonia (Zen)
                osc.type = 'sine';
                osc.frequency.setValueAtTime(440, t);
                gain.gain.setValueAtTime(0.0, t);
                gain.gain.linearRampToValueAtTime(0.2, t + 1.0);
                gain.gain.linearRampToValueAtTime(0.0, t + 3.0);
                break;
        }
        osc.start(); osc.stop(t + 3.0);
    },
    vibrate: function(pattern) {
        if (navigator.vibrate) navigator.vibrate(pattern);
    }
};

/* --- INPUT TRANSLATOR (Raw Sensor -> Physical Intent) --- */
const Input = {
    // Vetores de Intenção
    intentX: 0, 
    intentY: 0,
    kineticEnergy: 0, // Energia total do movimento (Run)
    jitter: 0,        // Instabilidade/Tremor (Zen)
    
    // Internal
    lastRawX: 0, lastRawY: 0, lastTime: 0,
    historyX: [], // Buffer para cálculo de jitter
    source: 'TOUCH',

    init: function() {
        const zone = document.getElementById('touch-controls');
        if(zone) {
            zone.addEventListener('touchmove', (e) => {
                e.preventDefault();
                this.source = 'TOUCH';
                this.intentX = ((e.touches[0].clientX / window.innerWidth) - 0.5) * 3.0;
                this.intentY = 1.0; 
                this.kineticEnergy = 1.0;
            }, {passive: false});
            zone.addEventListener('touchend', () => { 
                if(this.source==='TOUCH') { this.intentX=0; this.intentY=0; this.kineticEnergy=0; } 
            });
        }
        window.addEventListener('deviceorientation', (e) => {
            if(this.source === 'TOUCH' || this.source === 'CAM') return;
            this.source = 'TILT';
            this.intentX = (e.gamma || 0) / 20;
            this.intentY = 1.0;
            this.kineticEnergy = 0.5;
        });
        this.lastTime = Date.now();
    },

    forceMode: function(mode) {
        this.source = mode;
        if(mode === 'CAM') {
            if(typeof Vision !== 'undefined') Vision.start().catch(console.error);
        } else {
            if(typeof Vision !== 'undefined' && Vision.stop) Vision.stop();
        }
        Game.togglePause(false);
    },

    update: function(mode) {
        if (typeof Vision !== 'undefined' && Vision.active && Vision.data.presence) {
            this.source = 'CAM';
            
            const currX = Vision.data.x; 
            const currY = Vision.data.y;

            // 1. INPUT DIRETO
            this.intentX = currX;
            this.intentY = currY;

            // 2. ANÁLISE TEMPORAL (Jitter & Energy)
            const now = Date.now();
            const dt = now - this.lastTime;
            
            if (dt > 60) { // ~15Hz sample rate
                // JITTER CALC (Micro-tremores)
                this.historyX.push(currX);
                if(this.historyX.length > 5) this.historyX.shift();
                
                // Variância simples
                let avg = 0;
                this.historyX.forEach(v => avg += v);
                avg /= this.historyX.length;
                let variance = 0;
                this.historyX.forEach(v => variance += Math.abs(v - avg));
                
                // Jitter suavizado
                this.jitter += (variance - this.jitter) * 0.1;

                // KINETIC ENERGY (Run Force)
                const dx = Math.abs(currX - this.lastRawX);
                const dy = Math.abs(currY - this.lastRawY);
                const movement = dx + (dy * 2.5); 
                
                if (movement > 0.03) this.kineticEnergy += movement * 4.0;
                this.kineticEnergy *= 0.85; // Drag corporal
                this.kineticEnergy = Math.min(1.5, this.kineticEnergy);

                this.lastRawX = currX;
                this.lastRawY = currY;
                this.lastTime = now;
            }
        } else {
            this.intentX = Math.max(-1.5, Math.min(1.5, this.intentX));
            this.jitter = 0;
        }
    }
};

/* --- CORE GAME ENGINE (Physicality Kernel) --- */
const Game = {
    mode: 'kart', state: 'BOOT', score: 0,
    clock: new THREE.Clock(),
    
    // PHYSICS STATE (The Truth)
    phy: {
        pos: { x:0, y:0, z:0 }, // World Pos
        vel: { x:0, y:0, z:0 }, // Velocity
        acc: { x:0, y:0, z:0 }, // Acceleration
        rot: { y:0, z:0 },      // Heading/Roll
        torque: 0,              // Steering Force
        tension: 0,             // Stress Level (0-1)
    },

    // ZEN REFLEXIVE STATE
    zenPhase: 0,      // 0:Welcome, 1:Mirror, 2:Rupture, 3:Confront, 4:Resolve
    zenTimer: 0,
    zenLatency: 20,   // Frames de atraso do avatar
    inputBuffer: [],  // Buffer para espelhamento com atraso
    zenStatus: "...", // Texto qualitativo

    scene: null, camera: null, renderer: null, 
    player: null, avatarMesh: null, floor: null, objects: [],
    feedbackEl: null,
    
    debugClickCount: 0, fps: 0, frames: 0, lastFpsTime: 0,

    init: function() {
        if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
        const p = new URLSearchParams(window.location.search);
        this.mode = p.get('mode') || 'kart';
        
        const config = { 
            'kart': { t: 'TURBO KART', msg: 'Incline o corpo para acelerar' }, 
            'run':  { t: 'MARATHON',  msg: 'Corra no lugar para mover' }, 
            'zen':  { t: 'REFLEXIVE', msg: 'O Avatar é seu espelho' } 
        };
        const c = config[this.mode];
        if(document.getElementById('game-title')) {
            document.getElementById('game-title').innerText = c.t;
            document.getElementById('boot-msg').innerText = c.msg;
        }
        
        this.createFeedbackUI();
        if(typeof Vision !== 'undefined') Vision.init();
        if(typeof Input !== 'undefined') Input.init();
        this.setup3D();
        
        document.getElementById('btn-start').classList.remove('hidden');
        document.getElementById('screen-boot').classList.remove('hidden');
    },

    createFeedbackUI: function() {
        if(!document.getElementById('game-feedback')) {
            const el = document.createElement('div');
            el.id = 'game-feedback';
            el.style.cssText = `position: absolute; top: 30%; left: 50%; transform: translate(-50%, -50%); font-family: 'Arial Black', sans-serif; font-size: 32px; color: #fff; text-shadow: 0 2px 10px rgba(0,0,0,0.5); pointer-events: none; opacity: 0; transition: all 0.5s ease; z-index: 100; text-align: center; width: 100%; letter-spacing: 4px;`;
            document.getElementById('game-wrapper').appendChild(el);
            this.feedbackEl = el;
        } else { this.feedbackEl = document.getElementById('game-feedback'); }
    },

    feedback: function(text, style='neutral') {
        if(!this.feedbackEl) return;
        this.feedbackEl.innerText = text;
        this.feedbackEl.style.opacity = '0.8';
        this.feedbackEl.style.letterSpacing = '8px'; // Expand text
        
        let color = '#fff';
        if(style === 'tense') color = '#ff5555';
        if(style === 'fluid') color = '#aaffaa';
        if(style === 'connected') color = '#00ffff';
        
        this.feedbackEl.style.color = color;
    },

    setup3D: function() {
        const cvs = document.getElementById('game-canvas');
        if (!cvs) return;

        this.renderer = new THREE.WebGLRenderer({ canvas: cvs, alpha: true, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        
        let bg = 0x000000;
        if (this.mode === 'kart') bg = 0x111111; 
        else if (this.mode === 'run') bg = 0x203040; 
        else bg = 0x050505; // Zen Dark

        this.renderer.setClearColor(bg, 0); 
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(bg, 0.02);

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 100);
        this.camera.position.set(0, 2, 5);

        const amb = new THREE.AmbientLight(0xffffff, 0.6);
        const dir = new THREE.DirectionalLight(0xffffff, 1);
        dir.position.set(5, 10, 10);
        this.scene.add(amb, dir);

        this.createWorld();
        this.renderer.render(this.scene, this.camera);
    },

    createWorld: function() {
        if (this.mode !== 'zen') {
            const texLoader = new THREE.TextureLoader();
            texLoader.load('./assets/estrada.jpg', (tex) => {
                tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
                tex.repeat.set(1, 20);
                this.spawnFloor(new THREE.MeshPhongMaterial({map:tex}));
            }, null, () => this.spawnFloor(new THREE.MeshPhongMaterial({color:0x333})));
        } else {
            // Zen Floor: Reflective minimal grid
            const grid = new THREE.GridHelper(40, 40, 0x333333, 0x111111);
            grid.position.y = -1; 
            this.scene.add(grid);
            this.floor = grid;
        }
        this.createAvatar();
    },

    createAvatar: function() {
        this.player = new THREE.Group();
        this.scene.add(this.player);

        if (this.mode === 'kart') {
            const mat = new THREE.MeshPhongMaterial({color: 0x00bebd});
            const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 2.2), mat);
            chassis.position.y = 0.3;
            this.avatarMesh = chassis;
            this.player.add(chassis);
            const wGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 16);
            const wMat = new THREE.MeshBasicMaterial({color: 0x111});
            [[-0.8,0.3,0.8], [0.8,0.3,0.8], [-0.8,0.3,-0.8], [0.8,0.3,-0.8]].forEach(p => {
                const w = new THREE.Mesh(wGeo, wMat);
                w.rotation.z = Math.PI/2; w.position.set(...p);
                this.player.add(w);
            });
        } else if (this.mode === 'run') {
            const color = 0xffaa00;
            const mat = new THREE.MeshPhongMaterial({color: color});
            const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.15, 1.4, 8), mat);
            body.position.y = 0.7;
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 16), new THREE.MeshPhongMaterial({color: 0xffffff}));
            head.position.y = 1.55;
            const arms = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 0.1), mat);
            arms.position.y = 1.3;
            this.avatarMesh = new THREE.Group();
            this.avatarMesh.add(body); this.avatarMesh.add(head); this.avatarMesh.add(arms);
            this.player.add(this.avatarMesh);
        } else {
            // ZEN AVATAR: Ethereal Energy
            const geo = new THREE.IcosahedronGeometry(0.5, 1);
            const mat = new THREE.MeshPhongMaterial({color: 0x00ffff, wireframe: true, transparent: true, opacity: 0.8});
            const core = new THREE.Mesh(geo, mat);
            core.position.y = 1.5;
            
            const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.02, 16, 32), new THREE.MeshBasicMaterial({color: 0xffffff}));
            ring.position.y = 1.5;

            this.avatarMesh = new THREE.Group();
            this.avatarMesh.add(core); this.avatarMesh.add(ring);
            this.player.add(this.avatarMesh);
        }
    },

    spawnFloor: function(mat) {
        this.floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 200), mat);
        this.floor.rotation.x = -Math.PI/2; this.floor.position.z = -80;
        this.scene.add(this.floor);
    },

    startRequest: function() {
        AudioSys.init(); 
        AudioSys.play('start');
        
        if (this.mode !== 'run') AudioSys.startDrone(this.mode);

        if (this.mode === 'kart') {
            if(typeof Input.requestTiltPermission === 'function') Input.requestTiltPermission().then(() => this.forceStart());
            else this.forceStart();
        } else {
            if(typeof Vision !== 'undefined') {
                Vision.start().then(ok => {
                    if(ok) { Vision.resetCalibration(); this.forceStart(); } 
                    else { alert("Sem Câmera. Modo Toque."); Input.source = 'TOUCH'; this.forceStart(); }
                });
            } else { this.forceStart(); }
        }
    },

    forceStart: function() {
        document.getElementById('screen-boot').classList.add('hidden');
        document.getElementById('hud-layer').classList.remove('hidden');

        this.state = 'PLAY';
        this.score = 0;
        
        // Reset Física
        this.phy = { pos:{x:0,y:0,z:0}, vel:{x:0,y:0,z:0}, acc:{x:0,y:0,z:0}, rot:{y:0,z:0}, torque:0, tension:0 };

        if (this.mode === 'kart') {
            this.phy.vel.z = 0.5; this.spawnObj();
        } else if (this.mode === 'zen') {
            // REFLEXIVE ENGINE START
            this.zenPhase = 0;
            this.zenTimer = 0;
            this.zenLatency = 10;
            this.inputBuffer = [];
            this.feedback("...", "neutral");
        } else {
            this.spawnObj();
        }

        this.lastFpsTime = performance.now();
        this.loop();
    },

    loop: function() {
        requestAnimationFrame(() => this.loop());
        const delta = Math.min(this.clock.getDelta(), 0.1);
        const dt = delta * 60; 

        if (this.state !== 'PLAY') {
            if(this.renderer) this.renderer.render(this.scene, this.camera);
            return;
        }

        if(typeof Input !== 'undefined') Input.update(this.mode);

        if (this.mode === 'kart') this.physicsKart(dt);
        else if (this.mode === 'run') this.physicsRun(dt);
        else if (this.mode === 'zen') this.logicReflexiveZen(dt);

        // Integração Física (Move o Mundo ou o Avatar)
        if (this.mode !== 'zen') {
            this.phy.vel.x += this.phy.acc.x * dt;
            this.phy.vel.z += this.phy.acc.z * dt;
            this.phy.pos.x += this.phy.vel.x * dt;
            
            const speed = this.phy.vel.z;
            if (this.floor && this.floor.material.map) {
                this.floor.material.map.offset.y -= (speed * 0.05) * dt;
                this.floor.material.map.needsUpdate = true;
            }
            
            // Audio Update
            AudioSys.updateDrone(speed, this.phy.tension, this.mode);
            this.manageObstacles(dt);
        }

        this.updateAvatar(dt);
        this.updateCamera(dt);
        this.renderer.render(this.scene, this.camera);
        this.updateTelemetry();
    },

    physicsKart: function(dt) {
        // LEAN = GAS
        const gasForce = Math.max(0, Input.intentY) * 0.015;
        this.phy.acc.z = gasForce;
        
        // STEER = TORQUE
        const steerForce = Input.intentX * 0.06;
        this.phy.torque += (steerForce - this.phy.torque) * 0.1 * dt;
        
        this.phy.rot.y += this.phy.torque * dt;
        this.phy.rot.y *= 0.94; // Friction
        this.phy.rot.y = Math.max(-0.8, Math.min(0.8, this.phy.rot.y));

        this.phy.vel.x = Math.sin(this.phy.rot.y) * this.phy.vel.z * 0.8;
        this.phy.vel.z *= 0.985; // Drag
        
        this.phy.rot.z = -this.phy.rot.y * 0.5; // Banking

        // Stress Calculation (For Audio)
        this.phy.tension = Math.abs(this.phy.rot.y) * this.phy.vel.z;

        if (Math.abs(this.phy.pos.x) > 3.8) {
            this.phy.vel.z *= 0.9;
            this.phy.pos.x *= 0.95;
            if(Math.random()<0.1) AudioSys.vibrate(20);
        }
        this.score += Math.round(this.phy.vel.z * 10 * dt);
    },

    physicsRun: function(dt) {
        const forceZ = Input.kineticEnergy * 0.04;
        this.phy.acc.z = forceZ;
        this.phy.vel.z *= 0.92; // Heavy Body
        
        const forceX = Input.intentX * 0.1;
        this.phy.vel.x += (forceX - this.phy.vel.x) * 0.1 * dt;
        this.phy.vel.x *= 0.8;
        
        if(this.phy.vel.z > 0.3) {
            const phase = Math.sin(Date.now() * 0.015 * (1+this.phy.vel.z));
            if(phase > 0.9 && !this.stepped) {
                AudioSys.play('step', this.phy.vel.z);
                this.stepped = true;
            } else if(phase < 0) this.stepped = false;
        }
        this.score += Math.round(this.phy.vel.z * 20 * dt);
    },

    // --- REFLEXIVE ENGINE LOGIC (NEW) ---
    logicReflexiveZen: function(dt) {
        this.zenTimer += (1/60) * dt; // Segundos reais
        
        // Input Recording
        const inputFrame = { x: Input.intentX, y: Input.intentY, jitter: Input.jitter };
        this.inputBuffer.push(inputFrame);
        if(this.inputBuffer.length > 200) this.inputBuffer.shift();

        // Phase Controller
        if(this.zenTimer < 30) this.setPhase(0); // Acolhimento
        else if(this.zenTimer < 90) this.setPhase(1); // Espelhamento
        else if(this.zenTimer < 100) this.setPhase(2); // Ruptura
        else if(this.zenTimer < 120) this.setPhase(3); // Confronto
        else this.setPhase(4); // Resolução

        // Avatar Control Logic based on Phase
        let targetFrame = inputFrame;
        
        if (this.zenPhase === 1 || this.zenPhase === 4) {
            // Mirror with Latency (Delayed input)
            const latencyIdx = Math.max(0, this.inputBuffer.length - this.zenLatency);
            targetFrame = this.inputBuffer[latencyIdx] || inputFrame;
        } 
        else if (this.zenPhase === 2) {
            // Rupture: Freeze or glitch
            if(Math.random() > 0.9) targetFrame = {x:0, y:0}; // Stutter
        }
        else if (this.zenPhase === 3) {
            // Confront: Exaggerate Jitter
            targetFrame.x += (Math.random()-0.5) * Input.jitter * 5.0;
        }

        // Apply to Physics
        const targetX = targetFrame.x * 4.0;
        const targetY = 1.5 + targetFrame.y;
        
        // Smooth Move
        this.phy.pos.x += (targetX - this.phy.pos.x) * 0.05 * dt;
        
        // Avatar Mesh follows physics
        if(this.player) {
            this.player.position.x = this.phy.pos.x;
            this.player.position.y += (targetY - this.player.position.y) * 0.05 * dt;
            
            // Visual Tension based on Jitter
            if(this.avatarMesh) {
                const shake = Input.jitter * 0.5;
                this.avatarMesh.position.x = (Math.random()-0.5) * shake;
                this.avatarMesh.position.y += (Math.random()-0.5) * shake;
            }
        }

        // Audio Biofeedback
        AudioSys.updateDrone(1.0, Input.jitter, 'zen'); // Tension affects pitch
    },

    setPhase: function(p) {
        if(this.zenPhase === p) return;
        this.zenPhase = p;
        
        if(p === 0) this.feedback("PRESENCE", "fluid");
        if(p === 1) { this.feedback("CONNECTED", "connected"); this.zenLatency = 15; }
        if(p === 2) { this.feedback("FRAGMENTED", "tense"); AudioSys.play('rupture'); }
        if(p === 3) { this.feedback("CHAOTIC", "tense"); this.zenLatency = 5; }
        if(p === 4) { this.feedback("RESOLVED", "fluid"); AudioSys.play('resolve'); }
    },

    updateCamera: function(dt) {
        if(!this.camera) return;
        
        if (this.mode === 'kart') {
            const targetX = this.phy.pos.x * 0.6;
            this.camera.position.x += (targetX - this.camera.position.x) * 0.1 * dt;
            // FOV Dynamic based on speed
            const fov = 60 + (this.phy.vel.z * 15);
            this.camera.fov += (fov - this.camera.fov) * 0.1 * dt;
        } else if (this.mode === 'run') {
            this.camera.position.y = 3.0 + (Math.sin(Date.now()*0.01)*0.1);
        } else {
            // Zen Camera drifts slowly
            this.camera.position.x = Math.sin(Date.now()*0.0005) * 0.5;
        }
        this.camera.updateProjectionMatrix();
    },

    updateAvatar: function(dt) {
        if (!this.player) return;
        this.player.position.x = this.phy.pos.x;
        
        this.player.rotation.y += (this.phy.rot.y - this.player.rotation.y) * 0.2 * dt;
        this.player.rotation.z += (this.phy.rot.z - this.player.rotation.z) * 0.1 * dt;

        if (this.mode === 'run' && this.avatarMesh) {
            const bob = Math.abs(Math.sin(Date.now() * 0.015 * (1 + this.phy.vel.z))) * 0.2;
            this.avatarMesh.position.y = bob;
        }
    },

    manageObstacles: function(dt) {
        const speed = this.phy.vel.z;
        if (Math.random() < (0.02 * dt) && speed > 0.1) this.spawnObj();

        for (let i = this.objects.length - 1; i >= 0; i--) {
            let o = this.objects[i];
            o.position.z += (speed * 1.5 + 0.2) * dt;

            if (o.visible && Math.abs(o.position.z - this.player.position.z) < 1.0) {
                if (Math.abs(o.position.x - this.player.position.x) < 1.0) {
                    if (o.userData.type === 'bad') {
                        AudioSys.play('crash');
                        this.feedback("CRASH!", "tense");
                        this.phy.vel.z *= 0.2; 
                    } else {
                        AudioSys.play('perfect');
                        this.score += 500;
                        o.visible = false;
                    }
                }
            }
            if (o.position.z > 5) { this.scene.remove(o); this.objects.splice(i, 1); }
        }
        document.getElementById('score-val').innerText = this.score;
    },

    spawnObj: function() {
        const isBad = Math.random() > 0.3;
        const geo = isBad ? new THREE.ConeGeometry(0.5, 1, 16) : new THREE.TorusGeometry(0.4, 0.1, 8, 16);
        const mat = new THREE.MeshPhongMaterial({ color: isBad ? 0xff4444 : 0xffd700 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = isBad ? 0 : Math.PI / 2;
        const lane = [-2.5, 0, 2.5][Math.floor(Math.random() * 3)];
        mesh.position.set(lane, 0.5, -80);
        mesh.userData = { type: isBad ? 'bad' : 'good' };
        this.scene.add(mesh); this.objects.push(mesh);
    },

    togglePause: function(forceState) {
        if(typeof forceState !== 'undefined') this.state = forceState ? 'PAUSE' : 'PLAY';
        else this.state = (this.state === 'PLAY') ? 'PAUSE' : 'PLAY';
        const s = document.getElementById('screen-pause');
        if(s) { if(this.state === 'PAUSE') s.classList.remove('hidden'); else s.classList.add('hidden'); }
    },

    updateTelemetry: function() {
        if(!this.debugMode) return;
        const d = document.getElementById('debug-overlay');
        if(d) d.innerHTML = `MODE: ${this.mode}<br>JITTER: ${Input.jitter.toFixed(3)}<br>PHASE: ${this.zenPhase}`;
    },
    
    toggleDebug: function() {
        this.debugMode = !this.debugMode;
        let d = document.getElementById('debug-overlay');
        if(!d) {
            d = document.createElement('div'); d.id = 'debug-overlay';
            d.style.cssText = "position:absolute; top:80px; left:10px; color:#0f0; font-family:monospace; font-size:12px; background:rgba(0,0,0,0.8); padding:10px; pointer-events:none; z-index:100;";
            document.body.appendChild(d);
        }
        d.style.display = this.debugMode ? 'block' : 'none';
    }
};

window.onload = () => Game.init();
