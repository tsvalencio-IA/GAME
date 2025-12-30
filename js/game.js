/**
 * NEO-WII GAME ENGINE vFINAL (COMMERCIAL GRADE)
 * Physics: Newtonian Integration + Grip Simulation + Rhythm Analysis
 * Audio: Procedural DSP generated in real-time
 */

// --- SISTEMA DE ÁUDIO PROCEDURAL (Sem arquivos externos) ---
const AudioSys = {
    ctx: null,
    master: null,
    drone: { osc: null, gain: null },
    
    init: function() {
        if (this.ctx) return;
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.4;
        this.master.connect(this.ctx.destination);
    },

    startDrone: function(mode) {
        if (!this.ctx) this.init();
        if (this.drone.osc) { try{this.drone.osc.stop();}catch(e){} }

        this.drone.osc = this.ctx.createOscillator();
        this.drone.gain = this.ctx.createGain();
        this.drone.gain.gain.value = 0;

        if (mode === 'kart') {
            this.drone.osc.type = 'sawtooth'; // Som de motor
            this.drone.osc.frequency.value = 60;
        } else if (mode === 'zen') {
            this.drone.osc.type = 'sine'; // Som etéreo
            this.drone.osc.frequency.value = 180;
        } else {
            this.drone.osc = null; return; // Run usa som de passos
        }

        this.drone.osc.connect(this.drone.gain);
        this.drone.gain.connect(this.master);
        this.drone.osc.start();
    },

    updateDrone: function(val1, val2, mode) {
        if (!this.drone.osc) return;
        const t = this.ctx.currentTime;

        if (mode === 'kart') {
            // Val1: Velocidade (RPM), Val2: Drift Stress
            const rpm = 60 + (val1 * 250);
            this.drone.osc.frequency.setTargetAtTime(rpm, t, 0.1);
            // Volume sobe com carga, treme com drift
            const vol = 0.1 + (val1 * 0.1) + (val2 * 0.05);
            this.drone.gain.gain.setTargetAtTime(vol, t, 0.1);
        } else if (mode === 'zen') {
            // Val1: Harmonia, Val2: Jitter
            const detune = val2 * 100; // Desafina se tremer
            this.drone.osc.frequency.setTargetAtTime(180 + detune, t, 0.5);
            this.drone.gain.gain.setTargetAtTime(0.15, t, 0.5);
        }
    },

    play: function(type) {
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
                gain.gain.exponentialRampToValueAtTime(0.01, t + 0.5);
                break;
            case 'boost': 
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(100, t);
                osc.frequency.linearRampToValueAtTime(600, t + 0.5);
                gain.gain.setValueAtTime(0.3, t);
                gain.gain.linearRampToValueAtTime(0, t + 0.5);
                break;
            case 'step': 
                osc.type = 'square';
                osc.frequency.setValueAtTime(80, t);
                osc.frequency.exponentialRampToValueAtTime(10, t + 0.08);
                gain.gain.setValueAtTime(0.1, t);
                gain.gain.exponentialRampToValueAtTime(0.01, t + 0.08);
                break;
            case 'crash': 
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(100, t);
                osc.frequency.exponentialRampToValueAtTime(20, t + 0.4);
                gain.gain.setValueAtTime(0.4, t);
                gain.gain.exponentialRampToValueAtTime(0.01, t + 0.4);
                break;
        }
        osc.start(); osc.stop(t + 1.0);
    }
};

// --- CORE GAME ENGINE ---
const Game = {
    mode: 'kart', state: 'BOOT', score: 0,
    clock: new THREE.Clock(),
    
    // ESTADO FÍSICO CENTRAL (A Verdade do Jogo)
    phy: {
        pos: { x:0, y:0, z:0 }, // Posição Mundo
        vel: { x:0, y:0, z:0 }, // Velocidade Vetorial
        acc: { x:0, y:0, z:0 }, // Aceleração
        rot: { y:0, z:0 },      // Rotação (Heading, Roll)
        grip: 1.0,              // Aderência (Kart)
        rpm: 0,                 // Motor (Kart)
        fatigue: 0              // Cansaço (Run)
    },

    // Variáveis de Gameplay
    offRoad: false,
    inTheZone: false,
    zoneTimer: 0,
    
    // Zen Buffer (Para atraso orgânico)
    zenHistory: [],

    // Render
    scene: null, camera: null, renderer: null, 
    player: null, avatarMesh: null, floor: null, objects: [],
    
    init: function() {
        // Service Worker silencioso
        if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
        
        const p = new URLSearchParams(window.location.search);
        this.mode = p.get('mode') || 'kart';
        
        this.setupUI();
        
        // Inicializa sistemas
        if(typeof Vision !== 'undefined') Vision.init();
        if(typeof Input !== 'undefined') Input.init();
        
        this.setup3D();
        
        // Loop principal
        this.loop();
    },

    setupUI: function() {
        const t = document.getElementById('game-title');
        const m = document.getElementById('boot-msg');
        
        // Textos contextuais
        if(this.mode === 'kart') { t.innerText = "TURBO KART"; m.innerText = "Incline para Dirigir"; }
        else if(this.mode === 'run')  { t.innerText = "MARATHON"; m.innerText = "Mantenha o Ritmo"; }
        else if(this.mode === 'zen')  { t.innerText = "REFLEXIVE"; m.innerText = "Flua com o Avatar"; }
        
        document.getElementById('screen-boot').classList.remove('hidden');
        
        // Start via clique (necessário para áudio web)
        document.getElementById('btn-start').onclick = () => {
            AudioSys.init();
            this.startGame();
        };
    },

    setup3D: function() {
        const cvs = document.getElementById('game-canvas');
        this.renderer = new THREE.WebGLRenderer({ canvas: cvs, alpha: true, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // Balancear performance
        
        // Cores temáticas profissionais
        let bg = 0x111111;
        if (this.mode === 'run') bg = 0x203040; 
        if (this.mode === 'zen') bg = 0x110022;

        this.renderer.setClearColor(bg, 0); 
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(bg, 0.015);

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 100);
        this.camera.position.set(0, 2, 5);

        // Iluminação "Hero"
        const amb = new THREE.AmbientLight(0xffffff, 0.6);
        const dir = new THREE.DirectionalLight(0xffffff, 1);
        dir.position.set(5, 10, 5);
        this.scene.add(amb, dir);

        this.createWorld();
    },

    createWorld: function() {
        // Chão Infinito Texturizado
        const texLoader = new THREE.TextureLoader();
        texLoader.load('./assets/estrada.jpg', (tex) => {
            tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
            tex.repeat.set(1, 20);
            const mat = new THREE.MeshPhongMaterial({ map: tex });
            this.floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 200), mat);
            this.floor.rotation.x = -Math.PI/2;
            this.floor.position.z = -80;
            this.scene.add(this.floor);
        }, undefined, () => {
            // Fallback se textura falhar
            const mat = new THREE.MeshPhongMaterial({ color: 0x333333, wireframe: false });
            this.floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 200), mat);
            this.floor.rotation.x = -Math.PI/2;
            this.floor.position.z = -80;
            this.scene.add(this.floor);
        });
        
        this.createAvatar();
    },

    createAvatar: function() {
        this.player = new THREE.Group();
        this.scene.add(this.player);

        if (this.mode === 'kart') {
            // Chassi de Kart
            const mat = new THREE.MeshPhongMaterial({ color: 0x00bebd, specular: 0xffffff, shininess: 30 });
            const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 2.2), mat);
            chassis.position.y = 0.4;
            this.avatarMesh = chassis;
            this.player.add(chassis);
            
            // Rodas
            const wGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 16);
            const wMat = new THREE.MeshBasicMaterial({color: 0x111});
            [[-0.8,0.4,0.8], [0.8,0.4,0.8], [-0.8,0.4,-0.8], [0.8,0.4,-0.8]].forEach(p => {
                const w = new THREE.Mesh(wGeo, wMat);
                w.rotation.z = Math.PI/2; w.position.set(...p);
                this.player.add(w);
            });
        } else {
            // Avatar Humanoide (Abstrato)
            const color = (this.mode === 'run') ? 0xffaa00 : 0x00ffff;
            const mat = new THREE.MeshPhongMaterial({ color: color });
            const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.15, 1.4, 8), mat);
            body.position.y = 0.7;
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 16), new THREE.MeshPhongMaterial({color: 0xffffff}));
            head.position.y = 1.55;
            
            this.avatarMesh = new THREE.Group();
            this.avatarMesh.add(body); this.avatarMesh.add(head);
            this.player.add(this.avatarMesh);
        }
    },

    startGame: function() {
        document.getElementById('screen-boot').classList.add('hidden');
        document.getElementById('hud-layer').classList.remove('hidden');
        
        AudioSys.startDrone(this.mode);
        AudioSys.play('start');
        
        this.state = 'PLAY';
        this.score = 0;
        
        // Reset Física
        this.phy = { pos:{x:0,y:0,z:0}, vel:{x:0,y:0,z:0}, acc:{x:0,y:0,z:0}, rot:{y:0,z:0}, grip:1, rpm:0 };
        
        if(this.mode === 'zen') {
            this.zenHistory = [];
        } else {
            this.spawnObj();
        }
    },

    loop: function() {
        requestAnimationFrame(() => this.loop());
        
        const dt = Math.min(this.clock.getDelta(), 0.1); // Cap delta para estabilidade
        const time = this.clock.getElapsedTime();

        if (this.state !== 'PLAY') {
            this.renderer.render(this.scene, this.camera);
            return;
        }

        Input.update(); // Processa todos os sensores

        // 1. ATUALIZAÇÃO FÍSICA (Por Modo)
        if (this.mode === 'kart') this.updateKart(dt);
        else if (this.mode === 'run') this.updateRun(dt);
        else if (this.mode === 'zen') this.updateZen(dt, time);

        // 2. INTEGRAÇÃO NEWTONIANA (Move objetos baseados na força calculada)
        if (this.mode !== 'zen') {
            // v = v0 + a*t
            this.phy.vel.x += this.phy.acc.x * dt;
            this.phy.vel.z += this.phy.acc.z * dt;
            
            // x = x0 + v*t
            this.phy.pos.x += this.phy.vel.x * dt;
            // Z é relativo (mundo move, player fica)
            
            // Scroll do Chão
            const speed = this.phy.vel.z;
            if (this.floor && this.floor.material.map) {
                this.floor.material.map.offset.y -= (speed * 0.05) * dt;
            }
            
            // Audio Update
            AudioSys.updateDrone(speed, 1.0 - this.phy.grip, this.mode);
            this.manageObstacles(dt);
        }

        // 3. SINCRONIA VISUAL (Avatar & Câmera)
        this.syncAvatar(dt, time);
        this.syncCamera(dt);

        this.renderer.render(this.scene, this.camera);
        this.updateHUD();
    },

    // --- FÍSICA KART: Torque & Grip ---
    updateKart: function(dt) {
        // Aceleração: Input Y (frente) controla força Z
        const throttle = Math.max(0, Input.intentY);
        this.phy.rpm += (throttle - this.phy.rpm) * 3.0 * dt; // Inércia do motor
        
        const engineForce = this.phy.rpm * 25.0; // Potência do motor
        const drag = this.phy.vel.z * 0.8;       // Resistência do ar
        
        this.phy.acc.z = engineForce - drag;

        // Direção: Torque + Aderência
        const steerInput = Input.intentX;
        const turnRate = steerInput * 2.0; 
        
        // Heading (Rotação do chassi)
        this.phy.rot.y += turnRate * dt;
        this.phy.rot.y = Math.max(-0.8, Math.min(0.8, this.phy.rot.y * 0.95)); // Auto-center

        // Cálculo de Aderência (Se virar muito rápido, perde grip)
        const lateralStress = Math.abs(turnRate) * this.phy.vel.z;
        this.phy.grip = Math.max(0.3, 1.0 - (lateralStress * 0.02));

        // Vetor de Velocidade Lateral (Drift Physics)
        const intendedVelX = Math.sin(this.phy.rot.y) * this.phy.vel.z;
        this.phy.vel.x += (intendedVelX - this.phy.vel.x) * this.phy.grip * 5.0 * dt;

        // Off-road Penalty (Parede Elástica Invisível)
        if(Math.abs(this.phy.pos.x) > 4.0) {
            this.phy.vel.z *= 0.95; // Grama segura
            this.phy.pos.x *= 0.98; // Empurra suavemente para o centro
            if(!this.offRoad) { Feedback.trigger('collision'); this.offRoad = true; }
        } else {
            this.offRoad = false;
        }
        
        this.score += Math.round(this.phy.vel.z);
    },

    // --- FÍSICA RUN: Energia & Ritmo ---
    updateRun: function(dt) {
        // Força vem da Energia Cinética acumulada no Input
        const force = Input.kineticEnergy * 30.0;
        
        // Fadiga: Se correr muito rápido (Speed > 15), cansaço aumenta
        if(this.phy.vel.z > 15) this.phy.fatigue += 0.1 * dt;
        else this.phy.fatigue = Math.max(0, this.phy.fatigue - 0.2 * dt);
        
        const effectiveForce = force * (1.0 - Math.min(0.5, this.phy.fatigue));
        const friction = this.phy.vel.z * 1.5; // Atrito do chão
        
        this.phy.acc.z = effectiveForce - friction;
        
        // Movimento Lateral Direto (Strafe)
        const strafeTarget = Input.intentX * 3.0;
        this.phy.pos.x += (strafeTarget - this.phy.pos.x) * 5.0 * dt;
        
        // Mecânica de "Zone"
        if(this.phy.vel.z > 10 && this.phy.vel.z < 14) {
            this.zoneTimer += dt;
            if(this.zoneTimer > 3 && !this.inTheZone) {
                this.inTheZone = true;
                Feedback.trigger('boost'); // Visual Flash
                AudioSys.play('boost');
            }
        } else {
            this.zoneTimer = 0;
            this.inTheZone = false;
        }
        
        // Som de passos sincronizado com a velocidade
        if(this.phy.vel.z > 1.0) {
            const stepFreq = 0.02 + (this.phy.vel.z * 0.01);
            const phase = Math.sin(Date.now() * stepFreq);
            if(phase > 0.9 && !this.stepped) {
                AudioSys.play('step');
                this.stepped = true;
            } else if (phase < 0) this.stepped = false;
        }
        
        this.score += Math.round(this.phy.vel.z);
    },

    // --- LÓGICA ZEN: Fluidez & Buffer ---
    updateZen: function(dt, time) {
        // Armazena input no histórico para criar delay orgânico
        this.zenHistory.push({ x: Input.intentX, y: Input.intentY });
        if(this.zenHistory.length > 25) this.zenHistory.shift();
        
        // Pega um frame passado (Buffer de atraso)
        // Isso faz o avatar parecer ter peso e fluidez
        const frame = this.zenHistory[0] || {x:0, y:0};
        
        // Alvo suave
        const targetX = frame.x * 3.5;
        const targetY = 1.0 + (frame.y * 0.5);
        
        // Interpolação suave (Lerp)
        this.phy.pos.x += (targetX - this.phy.pos.x) * 2.0 * dt;
        this.phy.pos.y += (targetY - this.phy.pos.y) * 2.0 * dt;
        
        // Pontua pela suavidade (pouco jitter no input)
        if(Input.jitter < 0.01) {
            this.score += 1;
            // Som harmônico reage à estabilidade
            AudioSys.updateDrone(1.0, 0, 'zen');
        } else {
            // Som desafina se tremer
            AudioSys.updateDrone(0.5, Input.jitter, 'zen');
        }
    },

    // --- SINCRONIA VISUAL ---
    syncAvatar: function(dt, time) {
        if(!this.player) return;
        this.player.position.x = this.phy.pos.x;
        
        if(this.mode === 'kart') {
            this.player.rotation.y = this.phy.rot.y;
            // Banking (Inclinação na curva)
            const bankAngle = -this.phy.rot.y * 0.5;
            this.player.rotation.z += (bankAngle - this.player.rotation.z) * 5.0 * dt;
            // Empinada na aceleração
            const pitchAngle = -this.phy.acc.z * 0.05;
            this.avatarMesh.rotation.x = pitchAngle;
        } 
        else if (this.mode === 'run') {
            this.player.rotation.y = Math.PI; // Costas para câmera
            // Bobbing (Passada)
            const bobFreq = this.phy.vel.z * 1.5;
            const bobAmp = 0.1;
            this.avatarMesh.position.y = 0.5 + Math.abs(Math.sin(time * bobFreq)) * bobAmp;
            // Inclinação do corpo para frente baseada na velocidade
            this.avatarMesh.rotation.x = 0.2 + (this.phy.vel.z * 0.02);
        }
        else if (this.mode === 'zen') {
            this.player.rotation.y = Math.PI;
            // Flutuação suave
            if(this.avatarMesh) {
                this.avatarMesh.position.y = this.phy.pos.y + Math.sin(time) * 0.1;
            }
        }
    },

    syncCamera: function(dt) {
        if(!this.camera) return;
        
        if (this.mode === 'kart') {
            // Spring Arm: Câmera segue o carro com atraso no eixo X
            const targetX = this.phy.pos.x * 0.6; 
            this.camera.position.x += (targetX - this.camera.position.x) * 3.0 * dt;
            
            // FOV Dinâmico (Sensação de velocidade)
            const baseFov = 60;
            const speedFov = this.phy.vel.z * 0.5;
            this.camera.fov += ((baseFov + speedFov) - this.camera.fov) * 2.0 * dt;
            this.camera.updateProjectionMatrix();
            
            // Shake se estiver offroad
            if(this.offRoad) {
                this.camera.position.y = 2.0 + (Math.random() * 0.1);
            } else {
                this.camera.position.y += (2.0 - this.camera.position.y) * 5.0 * dt;
            }
        } else {
            // Câmera estável para Run/Zen
            this.camera.position.set(0, 2.5, 6);
            this.camera.lookAt(0, 1.5, 0);
            this.camera.fov = 60;
            this.camera.updateProjectionMatrix();
        }
    },

    manageObstacles: function(dt) {
        // Spawn
        if(Math.random() < 0.02 && this.phy.vel.z > 5) this.spawnObj();
        
        // Move & Collide
        for(let i=this.objects.length-1; i>=0; i--) {
            let o = this.objects[i];
            o.position.z += (this.phy.vel.z + 10) * dt; // Velocidade relativa visual
            
            // Colisão Simples (AABB)
            if(o.position.z > 0 && o.position.z < 2) {
                if(Math.abs(o.position.x - this.player.position.x) < 1.2) {
                    if(o.userData.type === 'bad') {
                        Feedback.trigger('collision');
                        this.phy.vel.z *= 0.5; // Punição Física: Perda de momento
                        AudioSys.play('crash');
                        o.visible = false; // Desaparece após bater
                    } else {
                        Feedback.trigger('coin');
                        this.score += 500;
                        o.visible = false;
                    }
                }
            }
            if(o.position.z > 10) { this.scene.remove(o); this.objects.splice(i,1); }
        }
    },

    spawnObj: function() {
        const isBad = Math.random() > 0.3;
        const geo = new THREE.ConeGeometry(0.5, 1, 8);
        const mat = new THREE.MeshPhongMaterial({ color: isBad ? 0xff0000 : 0xffff00 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData = { type: isBad ? 'bad' : 'good' };
        
        // Pistas: -2.5, 0, 2.5
        const lane = (Math.floor(Math.random()*3) - 1) * 2.5;
        mesh.position.set(lane, 0.5, -80);
        this.scene.add(mesh);
        this.objects.push(mesh);
    },

    updateHUD: function() {
        const el = document.getElementById('score-val');
        if(el) el.innerText = this.score;
        
        // Opcional: Debug Overlay
        if(this.mode === 'run' && this.inTheZone) {
            el.style.color = '#00ffff';
            el.style.textShadow = '0 0 10px #00ffff';
        } else {
            el.style.color = '#fff';
            el.style.textShadow = 'none';
        }
    }
};

window.onload = () => Game.init();
