/**
 * NEO-WII GAME ENGINE vFINAL (GOLD MASTER - FIXED BOOT FLOW)
 * Physics: Newtonian Integration + Grip Simulation + Rhythm Analysis
 * Architecture: State Machine (BOOT -> PLAY <-> PAUSE -> OVER)
 */

// --- SISTEMA DE ÁUDIO PROCEDURAL ---
const AudioSys = {
    ctx: null, master: null, drone: { osc: null, gain: null },
    
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
            this.drone.osc.type = 'sawtooth'; 
            this.drone.osc.frequency.value = 60;
        } else if (mode === 'zen') {
            this.drone.osc.type = 'sine'; 
            this.drone.osc.frequency.value = 180;
        } else {
            this.drone.osc = null; return; 
        }
        this.drone.osc.connect(this.drone.gain);
        this.drone.gain.connect(this.master);
        this.drone.osc.start();
    },

    updateDrone: function(val1, val2, mode) {
        if (!this.drone.osc) return;
        const t = this.ctx.currentTime;
        if (mode === 'kart') {
            const rpm = 60 + (val1 * 250);
            this.drone.osc.frequency.setTargetAtTime(rpm, t, 0.1);
            const vol = 0.1 + (val1 * 0.1) + (val2 * 0.05);
            this.drone.gain.gain.setTargetAtTime(vol, t, 0.1);
        } else if (mode === 'zen') {
            const detune = val2 * 100;
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
            case 'start': osc.type='sine'; osc.frequency.setValueAtTime(440, t); osc.frequency.exponentialRampToValueAtTime(880, t+0.4); gain.gain.setValueAtTime(0.5, t); gain.gain.exponentialRampToValueAtTime(0.01, t+0.5); break;
            case 'boost': osc.type='triangle'; osc.frequency.setValueAtTime(100, t); osc.frequency.linearRampToValueAtTime(600, t+0.5); gain.gain.setValueAtTime(0.3, t); gain.gain.linearRampToValueAtTime(0, t+0.5); break;
            case 'step': osc.type='square'; osc.frequency.setValueAtTime(80, t); osc.frequency.exponentialRampToValueAtTime(10, t+0.08); gain.gain.setValueAtTime(0.1, t); gain.gain.exponentialRampToValueAtTime(0.01, t+0.08); break;
            case 'crash': osc.type='sawtooth'; osc.frequency.setValueAtTime(100, t); osc.frequency.exponentialRampToValueAtTime(20, t+0.4); gain.gain.setValueAtTime(0.4, t); gain.gain.exponentialRampToValueAtTime(0.01, t+0.4); break;
        }
        osc.start(); osc.stop(t + 1.0);
    }
};

// --- CORE GAME ENGINE ---
const Game = {
    mode: 'kart', state: 'BOOT', score: 0,
    clock: new THREE.Clock(),
    
    // ESTADO FÍSICO CENTRAL
    phy: { pos: {x:0,y:0,z:0}, vel: {x:0,y:0,z:0}, acc: {x:0,y:0,z:0}, rot: {y:0,z:0}, grip: 1.0, rpm: 0, fatigue: 0 },
    
    offRoad: false, inTheZone: false, zoneTimer: 0, zenHistory: [],
    scene: null, camera: null, renderer: null, player: null, avatarMesh: null, floor: null, objects: [],
    
    init: function() {
        if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
        const p = new URLSearchParams(window.location.search);
        this.mode = p.get('mode') || 'kart';
        
        this.setupUI();
        
        if(typeof Vision !== 'undefined') Vision.init();
        if(typeof Input !== 'undefined') Input.init();
        
        this.setup3D();
        this.loop();
    },

    setupUI: function() {
        const t = document.getElementById('game-title');
        const m = document.getElementById('boot-msg');
        
        if(this.mode === 'kart') { t.innerText = "TURBO KART"; m.innerText = "Incline para Dirigir"; }
        else if(this.mode === 'run') { t.innerText = "MARATHON"; m.innerText = "Mantenha o Ritmo"; }
        else if(this.mode === 'zen') { t.innerText = "REFLEXIVE"; m.innerText = "Flua com o Avatar"; }
        
        document.getElementById('screen-boot').classList.remove('hidden');
        document.getElementById('btn-start').classList.remove('hidden'); 
    },

    setup3D: function() {
        const cvs = document.getElementById('game-canvas');
        this.renderer = new THREE.WebGLRenderer({ canvas: cvs, alpha: true, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        
        let bg = 0x111111;
        if (this.mode === 'run') bg = 0x203040; 
        if (this.mode === 'zen') bg = 0x110022;
        this.renderer.setClearColor(bg, 0); 
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(bg, 0.015);

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 100);
        this.camera.position.set(0, 2, 5);

        const amb = new THREE.AmbientLight(0xffffff, 0.6);
        const dir = new THREE.DirectionalLight(0xffffff, 1);
        dir.position.set(5, 10, 5);
        this.scene.add(amb, dir);
        this.createWorld();
        
        // Initial render to prevent black screen on boot
        this.renderer.render(this.scene, this.camera);
    },

    createWorld: function() {
        const texLoader = new THREE.TextureLoader();
        texLoader.load('./assets/estrada.jpg', (tex) => {
            tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
            tex.repeat.set(1, 20);
            const mat = new THREE.MeshPhongMaterial({ map: tex });
            this.floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 200), mat);
            this.floor.rotation.x = -Math.PI/2; this.floor.position.z = -80;
            this.scene.add(this.floor);
        }, undefined, () => {
            const mat = new THREE.MeshPhongMaterial({ color: 0x333333 });
            this.floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 200), mat);
            this.floor.rotation.x = -Math.PI/2; this.floor.position.z = -80;
            this.scene.add(this.floor);
        });
        this.createAvatar();
    },

    createAvatar: function() {
        this.player = new THREE.Group();
        this.scene.add(this.player);
        if (this.mode === 'kart') {
            const mat = new THREE.MeshPhongMaterial({ color: 0x00bebd, specular: 0xffffff, shininess: 30 });
            const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 2.2), mat);
            chassis.position.y = 0.4;
            this.avatarMesh = chassis;
            this.player.add(chassis);
            const wMat = new THREE.MeshBasicMaterial({color: 0x111});
            const wGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 16);
            [[-0.8,0.4,0.8], [0.8,0.4,0.8], [-0.8,0.4,-0.8], [0.8,0.4,-0.8]].forEach(p => {
                const w = new THREE.Mesh(wGeo, wMat); w.rotation.z = Math.PI/2; w.position.set(...p); this.player.add(w);
            });
        } else {
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

    // --- CONTROLE DE ESTADO & INTERFACE ---

    startRequest: function() {
        // Inicialização de áudio requer interação do usuário
        AudioSys.init();
        AudioSys.play('start');
        
        // Tentar fullscreen para imersão
        if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(()=>{});
        }

        this.startGame();
    },

    startGame: function() {
        document.getElementById('screen-boot').classList.add('hidden');
        document.getElementById('hud-layer').classList.remove('hidden');
        document.getElementById('screen-pause').classList.add('hidden');
        document.getElementById('screen-over').classList.add('hidden');
        
        AudioSys.startDrone(this.mode);
        
        this.state = 'PLAY';
        this.score = 0;
        this.phy = { pos:{x:0,y:0,z:0}, vel:{x:0,y:0,z:0}, acc:{x:0,y:0,z:0}, rot:{y:0,z:0}, grip:1, rpm:0, fatigue:0 };
        
        // Limpar objetos
        this.objects.forEach(o => this.scene.remove(o));
        this.objects = [];
        
        if(this.mode === 'zen') this.zenHistory = []; 
        else this.spawnObj();
    },

    togglePause: function() {
        const pauseScreen = document.getElementById('screen-pause');
        
        if (this.state === 'PLAY') {
            this.state = 'PAUSE';
            pauseScreen.classList.remove('hidden');
            if(AudioSys.ctx) AudioSys.ctx.suspend();
        } else if (this.state === 'PAUSE') {
            this.state = 'PLAY';
            pauseScreen.classList.add('hidden');
            if(AudioSys.ctx) AudioSys.ctx.resume();
        }
    },

    gameOver: function() {
        this.state = 'OVER';
        document.getElementById('final-score').innerText = this.score;
        document.getElementById('screen-over').classList.remove('hidden');
        document.getElementById('hud-layer').classList.add('hidden');
    },

    // --- LOOP PRINCIPAL ---

    loop: function() {
        requestAnimationFrame(() => this.loop());
        
        // Renderiza cena estática se pausado
        if (this.state !== 'PLAY') {
            if(this.renderer && this.scene && this.camera) {
                this.renderer.render(this.scene, this.camera);
            }
            return;
        }

        const dt = Math.min(this.clock.getDelta(), 0.1); 
        const time = this.clock.getElapsedTime();

        Input.update(); 

        if (this.mode === 'kart') this.updateKart(dt);
        else if (this.mode === 'run') this.updateRun(dt);
        else if (this.mode === 'zen') this.updateZen(dt, time);

        if (this.mode !== 'zen') {
            this.phy.vel.x += this.phy.acc.x * dt;
            this.phy.vel.z += this.phy.acc.z * dt;
            this.phy.pos.x += this.phy.vel.x * dt;
            const speed = this.phy.vel.z;
            if (this.floor && this.floor.material.map) {
                this.floor.material.map.offset.y -= (speed * 0.05) * dt;
            }
            AudioSys.updateDrone(speed, 1.0 - this.phy.grip, this.mode);
            this.manageObstacles(dt);
        }

        this.syncAvatar(dt, time);
        this.syncCamera(dt);
        this.renderer.render(this.scene, this.camera);
        this.updateHUD();
    },

    updateKart: function(dt) {
        const throttle = Math.max(0, Input.intentY);
        this.phy.rpm += (throttle - this.phy.rpm) * 3.0 * dt;
        
        const engineForce = this.phy.rpm * 28.0; 
        const drag = this.phy.vel.z * 1.2;
        this.phy.acc.z = engineForce - drag;

        const steerInput = Input.intentX;
        const turnRate = steerInput * 1.8; 
        this.phy.rot.y += turnRate * dt;
        this.phy.rot.y = Math.max(-0.8, Math.min(0.8, this.phy.rot.y * 0.95));

        const lateralStress = Math.abs(turnRate) * this.phy.vel.z;
        this.phy.grip = Math.max(0.4, 1.0 - (lateralStress * 0.012)); 

        const intendedVelX = Math.sin(this.phy.rot.y) * this.phy.vel.z;
        this.phy.vel.x += (intendedVelX - this.phy.vel.x) * this.phy.grip * 5.0 * dt;

        if(Math.abs(this.phy.pos.x) > 4.0) {
            this.phy.vel.z *= 0.95; 
            this.phy.pos.x *= 0.98;
            if(!this.offRoad) { 
                if(typeof Feedback !== 'undefined') Feedback.trigger('collision'); 
                this.offRoad = true; 
            }
        } else { this.offRoad = false; }
        this.score += Math.round(this.phy.vel.z);
    },

    updateRun: function(dt) {
        const force = Input.kineticEnergy * 25.0; 
        if(this.phy.vel.z > 15) this.phy.fatigue += 0.05 * dt; 
        else this.phy.fatigue = Math.max(0, this.phy.fatigue - 0.2 * dt);
        
        const effectiveForce = force * (1.0 - Math.min(0.5, this.phy.fatigue));
        const friction = this.phy.vel.z * 1.0; 
        this.phy.acc.z = effectiveForce - friction;
        
        const strafeTarget = Input.intentX * 3.0;
        this.phy.pos.x += (strafeTarget - this.phy.pos.x) * 5.0 * dt;
        
        if(this.phy.vel.z > 9 && this.phy.vel.z < 15) {
            this.zoneTimer += dt;
            if(this.zoneTimer > 2.5 && !this.inTheZone) {
                this.inTheZone = true; 
                if(typeof Feedback !== 'undefined') Feedback.trigger('boost'); 
                AudioSys.play('boost');
            }
        } else { this.zoneTimer = 0; this.inTheZone = false; }
        
        if(this.phy.vel.z > 1.0) {
            const stepFreq = 0.02 + (this.phy.vel.z * 0.01);
            const phase = Math.sin(Date.now() * stepFreq);
            if(phase > 0.9 && !this.stepped) { AudioSys.play('step'); this.stepped = true; }
            else if (phase < 0) this.stepped = false;
        }
        this.score += Math.round(this.phy.vel.z);
    },

    updateZen: function(dt, time) {
        this.zenHistory.push({ x: Input.intentX, y: Input.intentY });
        if(this.zenHistory.length > 20) this.zenHistory.shift(); 
        
        const frame = this.zenHistory[0] || {x:0, y:0};
        const targetX = frame.x * 3.5;
        const targetY = 1.0 + (frame.y * 0.5);
        
        this.phy.pos.x += (targetX - this.phy.pos.x) * 1.5 * dt; 
        this.phy.pos.y += (targetY - this.phy.pos.y) * 1.5 * dt;
        
        if(Input.jitter < 0.03) { 
            this.score += 1; AudioSys.updateDrone(1.0, 0, 'zen'); 
        } else { 
            AudioSys.updateDrone(0.5, Input.jitter, 'zen'); 
        }
    },

    syncAvatar: function(dt, time) {
        if(!this.player) return;
        this.player.position.x = this.phy.pos.x;
        
        if(this.mode === 'kart') {
            this.player.rotation.y = this.phy.rot.y;
            const bankAngle = -this.phy.rot.y * 0.5;
            this.player.rotation.z += (bankAngle - this.player.rotation.z) * 5.0 * dt;
            const pitchAngle = -this.phy.acc.z * 0.05;
            this.avatarMesh.rotation.x = pitchAngle;
        } 
        else if (this.mode === 'run') {
            this.player.rotation.y = Math.PI; 
            const bobFreq = this.phy.vel.z * 1.5;
            this.avatarMesh.position.y = 0.5 + Math.abs(Math.sin(time * bobFreq)) * 0.1;
            this.avatarMesh.rotation.x = 0.2 + (this.phy.vel.z * 0.02);
        }
        else if (this.mode === 'zen') {
            this.player.rotation.y = Math.PI;
            if(this.avatarMesh) this.avatarMesh.position.y = this.phy.pos.y + Math.sin(time) * 0.1;
        }
    },

    syncCamera: function(dt) {
        if(!this.camera) return;
        if (this.mode === 'kart') {
            const targetX = this.phy.pos.x * 0.6; 
            this.camera.position.x += (targetX - this.camera.position.x) * 3.0 * dt;
            const baseFov = 60;
            const speedFov = this.phy.vel.z * 0.5;
            this.camera.fov += ((baseFov + speedFov) - this.camera.fov) * 2.0 * dt;
            this.camera.updateProjectionMatrix();
            if(this.offRoad) this.camera.position.y = 2.0 + (Math.random() * 0.1);
            else this.camera.position.y += (2.0 - this.camera.position.y) * 5.0 * dt;
        } else {
            this.camera.position.set(0, 2.5, 6);
            this.camera.lookAt(0, 1.5, 0);
            this.camera.fov = 60;
            this.camera.updateProjectionMatrix();
        }
    },

    manageObstacles: function(dt) {
        if(Math.random() < 0.02 && this.phy.vel.z > 5) this.spawnObj();
        for(let i=this.objects.length-1; i>=0; i--) {
            let o = this.objects[i];
            o.position.z += (this.phy.vel.z + 10) * dt; 
            if(o.position.z > 0 && o.position.z < 2) {
                if(Math.abs(o.position.x - this.player.position.x) < 1.2) {
                    if(o.userData.type === 'bad') {
                        if(typeof Feedback !== 'undefined') Feedback.trigger('collision');
                        this.phy.vel.z *= 0.5; 
                        AudioSys.play('crash');
                        o.visible = false; 
                    } else {
                        if(typeof Feedback !== 'undefined') Feedback.trigger('coin');
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
        const lane = (Math.floor(Math.random()*3) - 1) * 2.5;
        mesh.position.set(lane, 0.5, -80);
        this.scene.add(mesh);
        this.objects.push(mesh);
    },

    updateHUD: function() {
        const el = document.getElementById('score-val');
        if(el) el.innerText = this.score;
        if(this.mode === 'run' && this.inTheZone) {
            el.style.color = '#00ffff'; el.style.textShadow = '0 0 10px #00ffff';
        } else {
            el.style.color = '#fff'; el.style.textShadow = 'none';
        }
    }
};

window.onload = () => Game.init();
