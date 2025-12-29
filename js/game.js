/**
 * NEO-WII Game Engine v30.0 (PHYSICALITY FINAL)
 * Status: CORE COMPLETE 🟢
 * Features: Torque Steering, Rhythmic Momentum, Breath Buoyancy.
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
            this.droneOsc.type = 'sawtooth'; 
            this.droneOsc.frequency.value = 50;
        } else if (mode === 'zen') {
            this.droneOsc.type = 'sine'; 
            this.droneOsc.frequency.value = 150;
        } else {
            this.droneOsc = null; 
            return;
        }

        this.droneOsc.connect(this.droneGain);
        this.droneOsc.start();
    },

    updateDrone: function(speed, stress, mode) {
        if (!this.droneOsc) return;
        const now = this.ctx.currentTime;
        
        if (mode === 'kart') {
            // Motor geme quando faz curva fechada (stress)
            const pitch = 50 + (speed * 100) - (stress * 20);
            this.droneOsc.frequency.setTargetAtTime(pitch, now, 0.1);
            this.droneGain.gain.setTargetAtTime(0.05 + (speed * 0.1), now, 0.1);
        } else if (mode === 'zen') {
            this.droneGain.gain.setTargetAtTime(0.02, now, 0.5);
        }
    },

    play: function(type) {
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
        } else if (type === 'coin') {
            osc.frequency.setValueAtTime(1200, t); osc.frequency.linearRampToValueAtTime(1800, t+0.08);
            gain.gain.setValueAtTime(0.08, t); gain.gain.linearRampToValueAtTime(0, t+0.08);
            osc.type = 'square';
        } else if (type === 'crash') {
            osc.frequency.setValueAtTime(150, t); osc.frequency.exponentialRampToValueAtTime(10, t+0.4);
            gain.gain.setValueAtTime(0.2, t); gain.gain.exponentialRampToValueAtTime(0.01, t+0.4);
            osc.type = 'sawtooth';
            this.vibrate([30, 50, 30]);
        } else if (type === 'step') {
            osc.frequency.setValueAtTime(80, t); osc.frequency.exponentialRampToValueAtTime(40, t+0.1);
            gain.gain.setValueAtTime(0.15, t); gain.gain.linearRampToValueAtTime(0, t+0.1);
            osc.type = 'triangle';
        }
        osc.start(); osc.stop(t + 0.5);
    },
    vibrate: function(pattern) {
        if (navigator.vibrate) navigator.vibrate(pattern);
    }
};

const Input = {
    x: 0, y: 0, steering: 0, throttle: 0.5, action: 0,
    lastY: 0, lastTime: 0, velocityY: 0, source: 'TOUCH',
    SMOOTHING: { kart: 0.18, run: 0.22, zen: 0.06 },

    init: function() {
        const zone = document.getElementById('touch-controls');
        if(zone) {
            zone.addEventListener('touchmove', (e) => {
                e.preventDefault();
                this.source = 'TOUCH';
                this.x = ((e.touches[0].clientX / window.innerWidth) - 0.5) * 3.0;
                this.throttle = 1.0;
            }, {passive: false});
            zone.addEventListener('touchend', () => { 
                if(this.source==='TOUCH') { this.x = 0; } 
            });
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
            
            if (dt > 60) { 
                const rawDelta = Math.abs(Vision.raw.y - this.lastY);
                const effectiveDelta = (rawDelta > 0.03) ? rawDelta : 0;
                // Run: Esforço físico real
                const effort = Math.min(1.0, effectiveDelta * 5); 
                this.velocityY = effort; // Raw effort
                this.lastY = Vision.raw.y;
                this.lastTime = now;
            }
            if(mode === 'run') this.throttle = this.velocityY;
            
        } else {
            rawSteering = Math.max(-1.5, Math.min(1.5, this.x));
            if(this.source === 'TOUCH' && this.x === 0) this.throttle = 0.5;
            else if(this.source === 'TILT') this.throttle = 1.0;
        }

        const alpha = this.SMOOTHING[mode] || 0.15;
        this.steering += (rawSteering - this.steering) * alpha;
        
        if (Math.abs(rawSteering) < 0.05) {
             this.steering += (0 - this.steering) * 0.1;
        }
        this.action += (this.throttle - this.action) * 0.1;
    }
};

const Game = {
    mode: 'kart', state: 'BOOT', score: 0, speed: 0,
    clock: new THREE.Clock(),
    
    // Physics State
    steeringTorque: 0, // Kart
    runMomentum: 0,    // Run
    zenBuoyancy: 0,    // Zen
    lastZenInput: 0,
    stepPhase: 0,

    scene: null, camera: null, renderer: null, 
    player: null, avatarMesh: null, floor: null, objects: [],
    debugClickCount: 0, fps: 0, frames: 0, lastFpsTime: 0,

    init: function() {
        if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

        const p = new URLSearchParams(window.location.search);
        this.mode = p.get('mode') || 'kart';
        
        const config = { 
            'kart': { t: 'TURBO KART', msg: 'Segure como um Volante' }, 
            'run':  { t: 'MARATHON',  msg: 'Corra no Lugar' }, 
            'zen':  { t: 'ZEN GLIDER',msg: 'Relaxe e Flutue' } 
        };
        const c = config[this.mode];
        if(document.getElementById('game-title')) {
            document.getElementById('game-title').innerText = c.t;
            document.getElementById('boot-msg').innerText = c.msg;
        }
        
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

    setup3D: function() {
        const cvs = document.getElementById('game-canvas');
        if (!cvs) return;

        this.renderer = new THREE.WebGLRenderer({ canvas: cvs, alpha: true, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        
        // Ambiente Diferenciado
        let clearColor = 0x000000;
        let fogColor = 0x000000;
        let fogDensity = 0.02;

        if (this.mode === 'kart') {
            clearColor = 0x111111; fogColor = 0x111111;
        } else if (this.mode === 'run') {
            clearColor = 0x101025; fogColor = 0x101025; fogDensity = 0.015;
        } else if (this.mode === 'zen') {
            clearColor = 0x1a0b2e; fogColor = 0x1a0b2e; fogDensity = 0.01;
        }

        this.renderer.setClearColor(clearColor, 0);
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(fogColor, fogDensity);

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 100);
        
        if (this.mode === 'kart') {
            this.camera.position.set(0, 2.5, 5); this.camera.lookAt(0, 0, -2);
        } else if (this.mode === 'run') {
            this.camera.position.set(0, 3.5, 7); this.camera.lookAt(0, 1, -5);
        } else {
            this.camera.position.set(0, 5, 10); this.camera.lookAt(0, 0, -10);
        }

        const amb = new THREE.AmbientLight(0xffffff, 0.6);
        const dir = new THREE.DirectionalLight(0xffffff, 1);
        dir.position.set(10, 20, 10);
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
            }, null, () => {
                const color = this.mode === 'run' ? 0x334455 : 0x222222;
                this.spawnFloor(new THREE.MeshPhongMaterial({color: color}));
            });
        } 
        this.createAvatar();
    },

    createAvatar: function() {
        this.player = new THREE.Group();
        this.scene.add(this.player);

        if (this.mode === 'kart') {
            const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 2.0), new THREE.MeshPhongMaterial({color: 0x00bebd}));
            chassis.position.y = 0.4;
            this.avatarMesh = chassis;
            this.player.add(chassis);
            const wheelMat = new THREE.MeshBasicMaterial({color: 0x111111});
            [[-0.7,0.3,0.8], [0.7,0.3,0.8], [-0.7,0.3,-0.8], [0.7,0.3,-0.8]].forEach(pos => {
                const w = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 16), wheelMat);
                w.rotation.z = Math.PI/2; w.position.set(...pos);
                this.player.add(w);
            });
        } else if (this.mode === 'run') {
            const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.1, 1.5, 8), new THREE.MeshPhongMaterial({color: 0xffaa00}));
            body.position.y = 0.75;
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 16), new THREE.MeshPhongMaterial({color: 0xffffff}));
            head.position.y = 1.6;
            this.avatarMesh = new THREE.Group();
            this.avatarMesh.add(body); this.avatarMesh.add(head);
            this.player.add(this.avatarMesh);
        } else {
            const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 0), new THREE.MeshPhongMaterial({color: 0xbd00ff, wireframe: true}));
            const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.05, 8, 32), new THREE.MeshBasicMaterial({color: 0x00ffff}));
            this.avatarMesh = new THREE.Group();
            this.avatarMesh.add(core); this.avatarMesh.add(ring);
            this.avatarMesh.position.y = 1.5; 
            this.player.add(this.avatarMesh);
        }
    },

    spawnFloor: function(mat) {
        this.floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 200), mat);
        this.floor.rotation.x = -Math.PI/2; 
        this.floor.position.z = -80;
        this.scene.add(this.floor);
    },

    startRequest: function() {
        AudioSys.init(); 
        AudioSys.play('start');
        
        if (this.mode !== 'run') AudioSys.startDrone(this.mode);

        if (this.mode === 'kart') {
            if(typeof Input.requestTiltPermission === 'function') {
                Input.requestTiltPermission().then(() => this.forceStart());
            } else {
                this.forceStart();
            }
        } else {
            if(typeof Vision !== 'undefined') {
                Vision.start().then(ok => {
                    if(ok) { Vision.resetCalibration(); this.forceStart(); } 
                    else { alert("Sem Câmera. Modo Toque."); Input.source = 'TOUCH'; this.forceStart(); }
                });
            } else {
                this.forceStart();
            }
        }
    },

    forceStart: function() {
        document.getElementById('screen-boot').classList.add('hidden');
        document.getElementById('hud-layer').classList.remove('hidden');

        this.state = 'PLAY';
        this.score = 0;
        this.speed = 0.8; 
        this.spawnObj();

        this.steeringTorque = 0;
        this.runMomentum = 0;
        this.zenBuoyancy = 0;
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

        // 1. PHYSICALITY LOGIC PHASE (Movimento com Massa)
        if (this.mode === 'kart') this.logicKart(dt);
        else if (this.mode === 'run') this.logicRun(dt);
        else if (this.mode === 'zen') this.logicZen(dt);

        // Audio Reactive Drone
        AudioSys.updateDrone(this.speed, Math.abs(this.steeringTorque), this.mode);

        // World Scroll
        if (this.floor && this.floor.material.map) {
            this.floor.material.map.offset.y -= (this.speed * 0.05) * dt;
            this.floor.material.map.needsUpdate = true;
        }

        // Avatar Rendering & Kinematics
        if (this.player && typeof Input !== 'undefined') {
            // Posicionamento X baseado na física acumulada (não input direto)
            this.player.position.x = this.steeringTorque * 3.5;

            // Cinemática
            if (this.mode === 'kart') {
                // Roll agressivo + Pitch na aceleração
                if(this.avatarMesh) {
                    this.avatarMesh.rotation.z = -(this.steeringTorque * 0.5); 
                    this.avatarMesh.rotation.x = -(this.speed * 0.1); // Empina
                }
                this.player.rotation.y = Math.PI - (this.steeringTorque * 0.3); // Drifting angle
                
            } else if (this.mode === 'run') {
                if(this.avatarMesh) {
                    // Inclinação física (Lean forward)
                    this.avatarMesh.rotation.x = 0.2 + (this.runMomentum * 0.4);
                    // Passada sincronizada com velocidade
                    const bob = Math.abs(Math.sin(Date.now() * 0.015 * (1 + this.runMomentum)));
                    this.avatarMesh.position.y = bob * 0.3; 
                }
            } else if (this.mode === 'zen') {
                // Tumble em gravidade zero
                if(this.avatarMesh) {
                    this.avatarMesh.rotation.x += 0.005 * dt;
                    this.avatarMesh.rotation.y += 0.01 * dt;
                }
                // Respiração + Estabilidade
                const breathe = Math.sin(Date.now() / 2000) * 0.2;
                this.player.position.y = 1.0 + this.zenBuoyancy + breathe;
                this.player.rotation.y = Math.PI + (this.steeringTorque * 0.5);
            }
        }

        this.hapticLoop();
        this.manageObstacles(dt);
        this.renderer.render(this.scene, this.camera);
        this.updateTelemetry();
    },

    hapticLoop: function() {
        if (this.mode === 'kart' && Math.abs(this.steeringTorque) > 0.8) {
            // Vibra no limite da aderência (curva forçada)
            if (Math.random() < 0.2) AudioSys.vibrate(10);
        } else if (this.mode === 'run') {
            // Vibração na batida do pé (frequência baseada no momentum)
            this.stepPhase += this.speed * 0.25;
            if (this.stepPhase > Math.PI) {
                this.stepPhase = 0;
                AudioSys.vibrate(20); 
                AudioSys.play('step');
            }
        }
    },

    // --- PHYSICS KERNELS ---

    logicKart: function(dt) {
        // Steering: Torque com mola de retorno
        const targetSteer = Input.steering;
        // Acumula torque (Inércia de volante)
        this.steeringTorque += (targetSteer - this.steeringTorque) * (0.1 * dt);
        
        // Aceleração
        const targetSpeed = Input.throttle; // 0 a 1
        this.speed += (targetSpeed - this.speed) * (0.02 * dt);
        this.score += Math.round(this.speed * 10 * dt);
    },

    logicRun: function(dt) {
        const impulse = Input.throttle; // Vem do Delta Y (esforço)
        
        // Momentum System (Inércia Pesada)
        // Ganha velocidade devagar, perde rápido se parar
        this.runMomentum += impulse * 0.05 * dt;
        this.runMomentum *= 0.95; // Arrasto do ar (Drag)
        
        // Clamp físico
        this.runMomentum = Math.max(0, Math.min(1.5, this.runMomentum));
        
        // Velocidade é reflexo do momentum
        this.speed = this.runMomentum;
        this.score += Math.round(this.speed * 20 * dt);
        
        // Steering mais rígido
        this.steeringTorque += (Input.steering - this.steeringTorque) * (0.1 * dt);
    },

    logicZen: function(dt) {
        this.speed = 0.4;
        this.score += Math.round(1 * dt);
        
        // Stability Analyzer
        // Se input varia muito (ansiedade), buoyancy cai. Se suave, sobe.
        const inputDelta = Math.abs(Input.action - this.lastZenInput);
        const stability = Math.max(0, 1.0 - (inputDelta * 20)); // 1 = Estável, 0 = Caótico
        
        // Buoyancy Target (Sobe se estável)
        const targetBuoyancy = stability * 1.5;
        this.zenBuoyancy += (targetBuoyancy - this.zenBuoyancy) * (0.02 * dt);
        
        this.lastZenInput = Input.action;
        this.steeringTorque += (Input.steering - this.steeringTorque) * (0.05 * dt);
    },

    manageObstacles: function(dt) {
        if (Math.random() < (0.02 * dt) && this.speed > 0.1) this.spawnObj();

        for (let i = this.objects.length - 1; i >= 0; i--) {
            let o = this.objects[i];
            o.position.z += (this.speed * 1.5 + 0.2) * dt;

            if (o.visible && Math.abs(o.position.z - this.player.position.z) < 1.0) {
                if (Math.abs(o.position.x - this.player.position.x) < 1.0) {
                    if (o.userData.type === 'bad') {
                        if (this.mode !== 'zen') {
                            AudioSys.play('crash');
                            this.gameOver();
                        }
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
        const scoreEl = document.getElementById('score-val');
        if(scoreEl) scoreEl.innerText = this.score;
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

    gameOver: function() {
        this.state = 'OVER';
        const el = document.getElementById('final-score');
        if(el) el.innerText = this.score;
        const screen = document.getElementById('screen-over');
        if(screen) screen.classList.remove('hidden');
        if(AudioSys.droneOsc) AudioSys.droneOsc.stop(); // Corta motor
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
        if(d) d.innerHTML = `MODE: ${this.mode}<br>MOMENTUM: ${this.runMomentum?.toFixed(2)}<br>FPS: ${this.fps}`;
    }
};

window.onload = () => Game.init();
