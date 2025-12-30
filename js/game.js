/**
 * NEO-WII Game Engine v36.0 (TRUE GAMEPLAY FEEL)
 * Status: FINAL RELEASE 🟢
 * Mechanics: Vector Steering (Kart), Cadence Analysis (Run), Stability Check (Zen).
 */

const AudioSys = {
    ctx: null,
    droneOsc: null,
    droneGain: null,
    
    init: function() {
        if (this.ctx) return;
        window.AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();
        
        this.droneGain = this.ctx.createGain();
        this.droneGain.gain.value = 0;
        this.droneGain.connect(this.ctx.destination);
    },

    startDrone: function(mode) {
        if (!this.ctx) this.init();
        if (this.droneOsc) this.droneOsc.stop();

        this.droneOsc = this.ctx.createOscillator();
        if (mode === 'kart') {
            this.droneOsc.type = 'sawtooth'; this.droneOsc.frequency.value = 50;
        } else if (mode === 'zen') {
            this.droneOsc.type = 'sine'; this.droneOsc.frequency.value = 150;
        } else {
            this.droneOsc = null; return;
        }
        this.droneOsc.connect(this.droneGain);
        this.droneOsc.start();
    },

    updateDrone: function(val1, val2, mode) {
        if (!this.droneOsc) return;
        const now = this.ctx.currentTime;
        if (mode === 'kart') {
            // Val1: Speed, Val2: Drift Stress
            this.droneOsc.frequency.setTargetAtTime(50 + (val1 * 120), now, 0.1);
            this.droneGain.gain.setTargetAtTime(0.05 + (val1 * 0.1) + (val2 * 0.05), now, 0.1);
        } else if (mode === 'zen') {
            // Val1: Harmony Level
            this.droneOsc.frequency.setTargetAtTime(100 + (val1 * 100), now, 0.5);
            this.droneGain.gain.setTargetAtTime(0.05 * val1, now, 0.5);
        }
    },

    play: function(type, pitchMod = 1.0) {
        if(!this.ctx) this.init();
        if(this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(()=>{});
        
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const t = this.ctx.currentTime;
        
        osc.connect(gain); gain.connect(this.ctx.destination);
        
        if (type === 'start') {
            osc.frequency.setValueAtTime(440, t); osc.frequency.exponentialRampToValueAtTime(880, t+0.4);
            gain.gain.setValueAtTime(0.1, t); gain.gain.linearRampToValueAtTime(0, t+0.4);
            osc.type = 'sine';
            this.vibrate(100);
        } else if (type === 'step') { // Metronome Step
            osc.frequency.setValueAtTime(150, t); osc.frequency.exponentialRampToValueAtTime(50, t+0.1);
            gain.gain.setValueAtTime(0.1, t); gain.gain.linearRampToValueAtTime(0, t+0.1);
            osc.type = 'triangle';
        } else if (type === 'zone') { 
            osc.frequency.setValueAtTime(300, t); osc.frequency.linearRampToValueAtTime(600, t+1.0);
            gain.gain.setValueAtTime(0.1, t); gain.gain.exponentialRampToValueAtTime(0.01, t+1.0);
            osc.type = 'sine';
        } else if (type === 'perfect') { 
            const base = 1000 * pitchMod;
            osc.frequency.setValueAtTime(base, t); osc.frequency.exponentialRampToValueAtTime(base + 500, t+0.2);
            gain.gain.setValueAtTime(0.1, t); gain.gain.exponentialRampToValueAtTime(0.01, t+0.3);
            osc.type = 'sine';
        } else if (type === 'crash') {
            osc.frequency.setValueAtTime(100, t); osc.frequency.exponentialRampToValueAtTime(20, t+0.4);
            gain.gain.setValueAtTime(0.3, t); gain.gain.exponentialRampToValueAtTime(0.01, t+0.4);
            osc.type = 'sawtooth';
            this.vibrate([30, 30, 30]);
        }
        osc.start(); osc.stop(t + 1.0);
    },
    vibrate: function(pattern) {
        if (navigator.vibrate) navigator.vibrate(pattern);
    }
};

const Input = {
    x: 0, y: 0, steering: 0, throttle: 0.5, action: 0,
    lastY: 0, lastTime: 0, velocityY: 0, source: 'TOUCH',
    SMOOTHING: { kart: 0.1, run: 0.15, zen: 0.08 }, // Less smoothing for raw data access

    init: function() {
        const zone = document.getElementById('touch-controls');
        if(zone) {
            zone.addEventListener('touchmove', (e) => {
                e.preventDefault();
                this.source = 'TOUCH';
                this.x = ((e.touches[0].clientX / window.innerWidth) - 0.5) * 3.0;
                this.throttle = 1.0;
            }, {passive: false});
            zone.addEventListener('touchend', () => { if(this.source==='TOUCH') this.x = 0; });
        }
        window.addEventListener('deviceorientation', (e) => {
            if(this.source === 'TOUCH' || this.source === 'CAM') return;
            this.source = 'TILT';
            this.x = (e.gamma || 0) / 20;
            this.throttle = 1.0;
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
        let rawSteering = 0;

        if (typeof Vision !== 'undefined' && Vision.active && Vision.data.presence) {
            this.source = 'CAM';
            rawSteering = Vision.data.x;
            this.y = Vision.data.y; 

            const now = Date.now();
            const dt = now - this.lastTime;
            
            // Raw Effort Calculation
            if (dt > 60) { 
                const rawDelta = Math.abs(Vision.raw.y - this.lastY);
                // Amplifica movimento real, ignora ruído
                const effectiveDelta = (rawDelta > 0.02) ? rawDelta * 8.0 : 0; 
                this.velocityY = Math.min(1.5, effectiveDelta);
                this.lastY = Vision.raw.y;
                this.lastTime = now;
            }
            if(mode === 'run') this.throttle = this.velocityY;
            else this.throttle = 0.5;
            
        } else {
            rawSteering = Math.max(-1.5, Math.min(1.5, this.x));
            if(this.source === 'TOUCH' && this.x === 0) this.throttle = 0.5;
            else if(this.source === 'TILT') this.throttle = 1.0;
        }

        const alpha = this.SMOOTHING[mode] || 0.15;
        this.steering += (rawSteering - this.steering) * alpha;
        
        // No deadzone here anymore - logic handled in game loop per mode
        this.action = this.steering; 
    }
};

const Game = {
    mode: 'kart', state: 'BOOT', score: 0, speed: 0,
    clock: new THREE.Clock(),
    
    // KART PHYSICS
    carHeading: 0, 
    driftStress: 0,
    
    // RUN CADENCE ENGINE
    lastStepTime: 0,
    stepInterval: 0,
    cadenceScore: 0,
    inTheZone: false,
    
    // ZEN HARMONY
    harmony: 0,
    zenTarget: 0,
    
    // DANCE STATE
    danceState: 'PREPARE', danceTimer: 0, currentPose: 0, roundsPlayed: 0, maxRounds: 10, combo: 0,
    
    scene: null, camera: null, renderer: null, 
    player: null, avatarMesh: null, floor: null, objects: [],
    feedbackEl: null,
    
    debugClickCount: 0, fps: 0, frames: 0, lastFpsTime: 0,

    init: function() {
        if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

        const p = new URLSearchParams(window.location.search);
        this.mode = p.get('mode') || 'kart';
        
        const config = { 
            'kart': { t: 'TURBO KART', msg: 'Gire para Curvar' }, 
            'run':  { t: 'MARATHON',  msg: 'Mantenha o Ritmo' }, 
            'zen':  { t: 'DANCE FIT', msg: 'Copie e Sustente' } 
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
        
        const btn = document.getElementById('btn-start');
        if(btn) btn.classList.remove('hidden');
        const bootScreen = document.getElementById('screen-boot');
        if(bootScreen) bootScreen.classList.remove('hidden');

        document.querySelector('.score-board').addEventListener('click', () => {
            this.debugClickCount++;
            if(this.debugClickCount === 5) this.toggleDebug();
        });
    },

    createFeedbackUI: function() {
        if(!document.getElementById('game-feedback')) {
            const el = document.createElement('div');
            el.id = 'game-feedback';
            el.style.cssText = `
                position: absolute; top: 35%; left: 50%; transform: translate(-50%, -50%);
                font-family: 'Arial Black', sans-serif; font-size: 48px; color: #fff;
                text-shadow: 0 4px 10px rgba(0,0,0,0.5); pointer-events: none; opacity: 0;
                transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.2s;
                z-index: 100; text-align: center; width: 100%; letter-spacing: 2px;
            `;
            document.getElementById('game-wrapper').appendChild(el);
            this.feedbackEl = el;
        } else {
            this.feedbackEl = document.getElementById('game-feedback');
        }
    },

    showFeedback: function(text, type) {
        if(!this.feedbackEl) return;
        this.feedbackEl.innerText = text;
        this.feedbackEl.style.opacity = '1';
        this.feedbackEl.style.transform = 'translate(-50%, -50%) scale(1.3)';
        
        let color = '#fff';
        if(type === 'good') color = '#aaffaa';
        else if(type === 'bad') color = '#ff5555';
        else if(type === 'perfect') color = '#00ffff';
        else if(type === 'zone') color = '#ffff00';
        
        this.feedbackEl.style.color = color;
        setTimeout(() => {
            this.feedbackEl.style.transform = 'translate(-50%, -50%) scale(1)';
            this.feedbackEl.style.opacity = '0';
        }, 900);
    },

    setup3D: function() {
        const cvs = document.getElementById('game-canvas');
        if (!cvs) return;

        this.renderer = new THREE.WebGLRenderer({ canvas: cvs, alpha: true, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        
        let clearColor = 0x111111; let fogColor = 0x111111;
        if (this.mode === 'kart') { clearColor = 0x111111; fogColor = 0x111111; } 
        else if (this.mode === 'run') { clearColor = 0x203040; fogColor = 0x203040; } 
        else { clearColor = 0x220033; fogColor = 0x220033; }

        this.renderer.setClearColor(clearColor, 0); 
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(fogColor, 0.02);

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 100);
        
        if (this.mode === 'kart') { this.camera.position.set(0, 1.5, 4.5); this.camera.lookAt(0, 0.5, -4); } 
        else if (this.mode === 'run') { this.camera.position.set(0, 3.0, 6.0); this.camera.lookAt(0, 1.0, -5); } 
        else { this.camera.position.set(0, 2.5, 7.0); this.camera.lookAt(0, 1.5, 0); }

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
            const gridHelper = new THREE.GridHelper(20, 20, 0xff00ff, 0x00ffff);
            gridHelper.position.y = 0; gridHelper.position.z = -5;
            this.scene.add(gridHelper);
            this.floor = gridHelper;
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
            // Wheels
            const wGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 16);
            const wMat = new THREE.MeshBasicMaterial({color: 0x111});
            [[-0.8,0.3,0.8], [0.8,0.3,0.8], [-0.8,0.3,-0.8], [0.8,0.3,-0.8]].forEach(p => {
                const w = new THREE.Mesh(wGeo, wMat);
                w.rotation.z = Math.PI/2; w.position.set(...p);
                this.player.add(w);
            });
        } else {
            const color = this.mode === 'run' ? 0xffaa00 : 0xff00ff;
            const mat = new THREE.MeshPhongMaterial({color: color});
            const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.15, 1.4, 8), mat);
            body.position.y = 0.7;
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 16), new THREE.MeshPhongMaterial({color: 0xffffff}));
            head.position.y = 1.55;
            const armGeo = new THREE.BoxGeometry(0.9, 0.1, 0.1);
            const arms = new THREE.Mesh(armGeo, mat);
            arms.position.y = 1.3;
            this.avatarMesh = new THREE.Group();
            this.avatarMesh.add(body); this.avatarMesh.add(head); this.avatarMesh.add(arms);
            this.player.add(this.avatarMesh);
        }
    },

    spawnFloor: function(mat) {
        this.floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 200), mat);
        this.floor.rotation.x = -Math.PI/2; this.floor.position.z = -80;
        this.scene.add(this.floor);
    },

    startRequest: function() {
        AudioSys.init(); AudioSys.play('start');
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
        
        if (this.mode === 'kart') {
            this.speed = 0.8; this.spawnObj();
        } else if (this.mode === 'zen') {
            this.speed = 0;
            this.danceState = 'PREPARE';
            this.danceTimer = 3.0;
            this.harmony = 1.0;
            this.roundsPlayed = 0;
            this.showFeedback("GET READY!", "normal");
        } else {
            this.speed = 0.5; this.spawnObj();
        }

        this.carHeading = 0;
        this.cadenceScore = 0;
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

        // --- NEW PHYSICS KERNELS (v36) ---
        if (this.mode === 'kart') this.logicKart(dt);
        else if (this.mode === 'run') this.logicRun(dt);
        else if (this.mode === 'zen') this.logicDance(delta);

        AudioSys.updateDrone(this.speed, this.driftStress, this.mode);

        if (this.mode !== 'zen' && this.floor && this.floor.material.map) {
            this.floor.material.map.offset.y -= (this.speed * 0.05) * dt;
            this.floor.material.map.needsUpdate = true;
        }

        // Avatar & Camera Physics
        if (this.player && typeof Input !== 'undefined') {
            
            // KART: HEADING PHYSICS
            if (this.mode === 'kart') {
                // Input rotates heading, Speed moves X
                const lateralSpeed = Math.sin(this.carHeading) * this.speed;
                this.player.position.x += lateralSpeed * 0.2 * dt;
                
                // Visual Rotation
                this.player.rotation.y = Math.PI + this.carHeading;
                // Banking (Roll)
                this.player.rotation.z = this.carHeading * -0.5; 
                
                // Camera follows car but delayed
                this.camera.position.x += (this.player.position.x * 0.5 - this.camera.position.x) * 0.1 * dt;
                // Look ahead
                this.camera.lookAt(this.player.position.x * 0.8, 0.5, -10);

            // RUN: BOBBING & BREATHING
            } else if (this.mode === 'run') {
                // Bobbing based on speed
                const bob = Math.abs(Math.sin(Date.now() * 0.015)) * 0.2;
                if(this.avatarMesh) this.avatarMesh.position.y = bob;
                // Camera Bob
                this.camera.position.y = 3.0 + (bob * 0.5);
                this.player.rotation.y = Math.PI;
            }
        }

        if (this.mode !== 'zen') this.manageObstacles(dt);
        
        this.renderer.render(this.scene, this.camera);
        this.updateTelemetry();
    },

    logicKart: function(dt) {
        const targetSpeed = Input.throttle; 
        
        // HEADING MECHANIC
        // Steering input adds to rotation (Torque)
        this.carHeading += Input.steering * 0.03 * dt;
        // Auto-center steering (Resistance)
        this.carHeading *= 0.95;
        
        // Clamp Heading
        this.carHeading = Math.max(-0.8, Math.min(0.8, this.carHeading));

        // OFF-ROAD
        if (Math.abs(this.player.position.x) > 3.8) {
            this.speed *= 0.95; 
            if(Math.random() < 0.1) AudioSys.vibrate(20); 
            this.driftStress = 0;
        } else {
            this.speed += (targetSpeed - this.speed) * (0.02 * dt);
            
            // DRIFT STRESS (Turning hard at high speed)
            if(Math.abs(this.carHeading) > 0.5 && this.speed > 0.6) {
                this.driftStress += dt;
                if(this.driftStress > 100) { // Burst
                    this.speed += 0.3;
                    AudioSys.play('boost');
                    this.showFeedback("DRIFT!", "boost");
                    this.driftStress = 0;
                }
            } else {
                this.driftStress = 0;
            }
        }
        
        this.score += Math.round(this.speed * 10 * dt);
    },

    logicRun: function(dt) {
        const impulse = Input.throttle; // Raw effort (0-1.5)
        const now = Date.now();
        
        // CADENCE ENGINE
        // Detect peak efforts (Step detection)
        if(impulse > 0.8 && (now - this.lastStepTime) > 300) {
            const interval = now - this.lastStepTime;
            this.lastStepTime = now;
            
            // Analyze Rhythm Consistency
            // Ideal cadence: 400ms - 600ms (Running BPM)
            if(interval > 300 && interval < 700) {
                this.cadenceScore += 10;
                AudioSys.play('step');
                // Speed Boost from Rhythm
                this.speed += 0.1;
            } else {
                this.cadenceScore = Math.max(0, this.cadenceScore - 5); // Arrhythmia penalty
            }
        }
        
        // IN THE ZONE
        if(this.cadenceScore > 50 && !this.inTheZone) {
            this.inTheZone = true;
            AudioSys.play('zone');
            this.showFeedback("IN THE ZONE!", "zone");
        } else if(this.cadenceScore < 20) {
            this.inTheZone = false;
        }
        this.cadenceScore = Math.min(100, this.cadenceScore);

        // Speed Decay (Friction)
        this.speed *= 0.98;
        
        // Visuals
        if(this.inTheZone) {
            this.camera.fov = 75;
            if(this.avatarMesh) this.avatarMesh.children.forEach(m => m.material.color.setHex(0x00ffff));
        } else {
            this.camera.fov = 60;
            if(this.avatarMesh) this.avatarMesh.children.forEach(m => m.material.color.setHex(0xffaa00));
        }
        this.camera.updateProjectionMatrix();

        this.score += Math.round(this.speed * 20 * dt);
    },

    logicDance: function(seconds) {
        this.danceTimer -= seconds;
        
        if (this.danceState === 'PREPARE') {
            if (this.danceTimer <= 0) {
                if(this.roundsPlayed >= this.maxRounds) {
                    this.gameOver("DANCE COMPLETE");
                    return;
                }
                this.roundsPlayed++;
                this.currentPose = Math.floor(Math.random() * 3) - 1; 
                this.showFeedback("MATCH!", "normal");
                if(this.avatarMesh) this.avatarMesh.rotation.z = -this.currentPose * 0.5;
                
                this.danceState = 'HOLD';
                this.danceTimer = 3.0; // Long hold
                this.harmony = 100; // Start perfect, lose if shake
            }
        } 
        else if (this.danceState === 'HOLD') {
            // CONTINUOUS EVALUATION
            const playerInput = Input.steering; 
            const targetInput = -this.currentPose * 0.8; // Target value
            
            // Check delta
            let error = 0;
            if (this.currentPose === 0) error = Math.abs(playerInput);
            else if (this.currentPose === -1) error = Math.abs(playerInput + 0.8); // Left
            else if (this.currentPose === 1) error = Math.abs(playerInput - 0.8); // Right
            
            // Stability Penalty
            if(error > 0.4) {
                this.harmony -= 2; // Lose harmony fast if wrong
                if(this.avatarMesh) this.avatarMesh.scale.setScalar(0.8); // Visual shrink
            } else {
                this.harmony += 0.5; // Gain if holding
                if(this.avatarMesh) this.avatarMesh.scale.setScalar(1.2); // Bloom
            }
            this.harmony = Math.max(0, Math.min(100, this.harmony));

            if (this.danceTimer <= 0) {
                this.danceState = 'JUDGE';
            }
        } 
        else if (this.danceState === 'JUDGE') {
            if(this.harmony > 60) {
                this.combo++;
                AudioSys.play('perfect');
                this.showFeedback("PERFECT!", "perfect");
                this.score += 1000 + (this.combo * 100);
            } else {
                this.combo = 0;
                AudioSys.play('miss');
                this.showFeedback("SHAKY...", "bad");
            }
            
            this.danceState = 'PREPARE';
            this.danceTimer = 1.0; 
            if(this.avatarMesh) {
                this.avatarMesh.rotation.z = 0;
                this.avatarMesh.scale.setScalar(1);
            }
        }
        document.getElementById('score-val').innerText = this.score;
    },

    manageObstacles: function(dt) {
        if (Math.random() < (0.02 * dt) && this.speed > 0.1) this.spawnObj();

        for (let i = this.objects.length - 1; i >= 0; i--) {
            let o = this.objects[i];
            o.position.z += (this.speed * 1.5 + 0.2) * dt;

            if (o.visible && Math.abs(o.position.z - this.player.position.z) < 1.0) {
                if (Math.abs(o.position.x - this.player.position.x) < 1.0) {
                    if (o.userData.type === 'bad') {
                        AudioSys.play('crash');
                        this.showFeedback("CRASH!", "bad");
                        this.speed *= 0.5; // Kart punish
                        this.cadenceScore = 0; // Run punish
                        this.inTheZone = false;
                    } else {
                        AudioSys.play('coin');
                        this.score += 500;
                        o.visible = false;
                    }
                }
            }
            if (o.position.z > 5) {
                this.scene.remove(o);
                this.objects.splice(i, 1);
            }
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

    gameOver: function(msg) {
        this.state = 'OVER';
        const el = document.getElementById('final-score');
        if(el) el.innerText = this.score;
        const title = document.querySelector('#screen-over h1');
        if(title) title.innerText = msg || "FIM DE JOGO";
        const screen = document.getElementById('screen-over');
        if(screen) screen.classList.remove('hidden');
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
    },

    updateTelemetry: function() {
        if(!this.debugMode) return;
        const d = document.getElementById('debug-overlay');
        if(d) d.innerHTML = `MODE: ${this.mode}<br>CAD: ${this.cadenceScore}<br>HARM: ${this.harmony.toFixed(0)}`;
    }
};

window.onload = () => Game.init();