/**
 * NEO-WII Game Engine v27.0 (UX FIXED)
 * Status: WAITING FOR PLAYER
 * Fixes: Auto-start removed. Explicit Start Ritual implemented.
 */

const AudioSys = {
    ctx: null,
    init: function() {
        if (this.ctx) return;
        window.AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();
    },
    play: function(type) {
        // Tenta iniciar contexto se não existir (no clique do usuário)
        if(!this.ctx) this.init();
        if(this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(()=>{});
        if(!this.ctx) return;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const t = this.ctx.currentTime;
        
        osc.connect(gain); gain.connect(this.ctx.destination);
        
        if (type === 'start') {
            osc.frequency.setValueAtTime(440, t); 
            osc.frequency.exponentialRampToValueAtTime(880, t+0.4);
            gain.gain.setValueAtTime(0.1, t); 
            gain.gain.linearRampToValueAtTime(0, t+0.4);
            osc.type = 'sine';
            this.vibrate(100); // Vibração longa de confirmação
        } else if (type === 'coin') {
            osc.frequency.setValueAtTime(1200, t); 
            osc.frequency.linearRampToValueAtTime(1800, t+0.08);
            gain.gain.setValueAtTime(0.08, t); 
            gain.gain.linearRampToValueAtTime(0, t+0.08);
            osc.type = 'square';
        } else if (type === 'crash') {
            osc.frequency.setValueAtTime(150, t); 
            osc.frequency.exponentialRampToValueAtTime(10, t+0.4);
            gain.gain.setValueAtTime(0.2, t); 
            gain.gain.exponentialRampToValueAtTime(0.01, t+0.4);
            osc.type = 'sawtooth';
            this.vibrate([30, 50, 30]);
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
    // Constantes de suavização
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
        console.log("🎮 Input Force:", mode);
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
                const effort = Math.min(1.0, effectiveDelta * 5); 
                const curvedEffort = 1 - Math.pow(1 - effort, 2);
                this.velocityY = curvedEffort * 1.5; 
                this.lastY = Vision.raw.y;
                this.lastTime = now;
            }
            if(mode === 'run') this.throttle = this.velocityY;
            
        } else {
            rawSteering = Math.max(-1.5, Math.min(1.5, this.x));
            if(this.source === 'TOUCH' && this.x === 0) this.throttle = 0.5;
            else if(this.source === 'TILT') this.throttle = 1.0;
        }

        // EMA Smoothing
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
    playerVelX: 0, fatigue: 0,
    scene: null, camera: null, renderer: null, player: null, floor: null, objects: [],
    debugClickCount: 0, fps: 0, frames: 0, lastFpsTime: 0,

    init: function() {
        console.log("⚙️ Engine: Waiting for Player...");
        if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

        const p = new URLSearchParams(window.location.search);
        this.mode = p.get('mode') || 'kart';
        
        // 1. Configura UI de Boot
        const config = { 
            'kart': { t: 'TURBO KART', msg: 'Toque para Iniciar' }, 
            'run':  { t: 'MARATHON',  msg: 'Toque para Iniciar' }, 
            'zen':  { t: 'ZEN GLIDER',msg: 'Toque para Iniciar' } 
        };
        const c = config[this.mode];
        if(document.getElementById('game-title')) {
            document.getElementById('game-title').innerText = c.t;
            document.getElementById('boot-msg').innerText = c.msg;
        }
        
        // 2. Prepara Motor (Mas não liga)
        if(typeof Vision !== 'undefined') Vision.init();
        if(typeof Input !== 'undefined') Input.init();
        
        // 3. Prepara Gráficos (Renderiza o primeiro frame estático)
        this.setup3D();
        
        // 4. MOSTRA O BOTÃO DE START (O Convite)
        // Remove loaders, spinners, e deixa o botão visível
        const btn = document.getElementById('btn-start');
        if(btn) btn.classList.remove('hidden');
        
        const bootScreen = document.getElementById('screen-boot');
        if(bootScreen) bootScreen.classList.remove('hidden');

        // Debug trigger
        const board = document.querySelector('.score-board');
        if(board) board.addEventListener('click', () => {
            this.debugClickCount++;
            if(this.debugClickCount === 5) this.toggleDebug();
        });
        
        // NOTA: Não chamamos forceStart() aqui. O HTML chama startRequest() no clique.
    },

    setup3D: function() {
        const cvs = document.getElementById('game-canvas');
        if (!cvs) return;

        this.renderer = new THREE.WebGLRenderer({ canvas: cvs, alpha: true, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x000000, 0); 

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x000000, 0.02);

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 100);
        this.camera.position.set(0, 3, 6);
        this.camera.lookAt(0, 0, -5);

        const amb = new THREE.AmbientLight(0xffffff, 0.6);
        const dir = new THREE.DirectionalLight(0xffffff, 1);
        dir.position.set(10, 20, 10);
        this.scene.add(amb, dir);

        this.createWorld();
        
        // Renderiza um frame inicial para não ficar tela preta
        this.renderer.render(this.scene, this.camera);
    },

    createWorld: function() {
        const texLoader = new THREE.TextureLoader();
        texLoader.load('./assets/estrada.jpg', (tex) => {
            tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
            tex.repeat.set(1, 20);
            this.spawnFloor(new THREE.MeshPhongMaterial({map:tex}));
        }, null, () => this.spawnFloor(new THREE.MeshPhongMaterial({color:0x333})));

        const loader = new THREE.GLTFLoader();
        loader.load('./assets/mascote.glb', (gltf) => {
            this.player = gltf.scene;
            this.setupPlayerMesh();
        }, null, () => {
            this.player = new THREE.Mesh(new THREE.BoxGeometry(1,0.5,2), new THREE.MeshPhongMaterial({color:0x00bebd}));
            this.setupPlayerMesh();
        });
    },

    spawnFloor: function(mat) {
        this.floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 200), mat);
        this.floor.rotation.x = -Math.PI/2; 
        this.floor.position.z = -80;
        this.scene.add(this.floor);
    },

    setupPlayerMesh: function() {
        this.player.position.set(0, 0, 0);
        this.player.rotation.y = Math.PI;
        this.scene.add(this.player);
        // Render de atualização
        if(this.renderer && this.scene && this.camera) 
            this.renderer.render(this.scene, this.camera);
    },

    // --- O RITUAL DE INÍCIO (Chamado pelo botão) ---
    startRequest: function() {
        console.log("👆 Player Clicked Start");
        
        // 1. Feedback Imediato (Som + Vibração)
        // Isso confirma que o jogo "sentiu" o toque
        AudioSys.init(); // Garante contexto no clique
        AudioSys.play('start');

        // 2. Solicita Hardware
        if (this.mode === 'kart') {
            if(typeof Input.requestTiltPermission === 'function') {
                Input.requestTiltPermission().then(() => this.forceStart());
            } else {
                this.forceStart();
            }
        } else {
            // Run/Zen usam Câmera
            if(typeof Vision !== 'undefined') {
                Vision.start().then(ok => {
                    if(ok) {
                        Vision.resetCalibration(); 
                        this.forceStart();
                    } else {
                        alert("Câmera bloqueada. Usando Toque.");
                        Input.source = 'TOUCH';
                        this.forceStart();
                    }
                });
            } else {
                this.forceStart();
            }
        }
    },

    forceStart: function() {
        // Transição Visual
        const boot = document.getElementById('screen-boot');
        if(boot) boot.classList.add('hidden');
        
        const hud = document.getElementById('hud-layer');
        if(hud) hud.classList.remove('hidden');

        // Injeção de Estado
        this.state = 'PLAY';
        this.score = 0;
        this.speed = 0.3; // Velocidade inicial para "Kick" visual
        
        this.playerVelX = 0;
        this.fatigue = 0;
        
        // Inicia Loop Real
        this.lastFpsTime = performance.now();
        this.loop();
    },

    powerCurve: function(x) {
        return 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 2.5);
    },

    loop: function() {
        requestAnimationFrame(() => this.loop());
        
        const delta = Math.min(this.clock.getDelta(), 0.1);
        const dt = delta * 60; 

        if (this.state !== 'PLAY') {
            // Se pausado ou em boot, renderiza mas não roda lógica
            if(this.renderer) this.renderer.render(this.scene, this.camera);
            return;
        }

        if(typeof Input !== 'undefined') Input.update(this.mode);

        if (this.mode === 'kart') this.logicKart(dt);
        else if (this.mode === 'run') this.logicRun(dt);
        else if (this.mode === 'zen') this.logicZen(dt);

        if (this.floor && this.floor.material.map) {
            this.floor.material.map.offset.y -= (this.speed * 0.05) * dt;
            this.floor.material.map.needsUpdate = true;
        }

        // SPRING-DAMPER PHYSICS
        if (this.player && typeof Input !== 'undefined') {
            const targetX = Input.steering * 3.5;
            const STIFFNESS = 0.18 * dt; 
            const DAMPING = 0.78;        

            const displacement = targetX - this.player.position.x;
            this.playerVelX += displacement * STIFFNESS;
            this.playerVelX *= DAMPING; 
            this.player.position.x += this.playerVelX;

            this.player.rotation.z = -(this.player.position.x * 0.25) - (this.playerVelX * 2.0);
            this.player.rotation.y = Math.PI;
        }

        this.manageObstacles(dt);
        this.renderer.render(this.scene, this.camera);
        this.updateTelemetry();
    },

    logicKart: function(dt) {
        const rawThrottle = Input.throttle;
        const curvedThrottle = this.powerCurve(rawThrottle);
        this.speed += (curvedThrottle - this.speed) * (0.02 * dt);
        this.score += Math.round(this.speed * 10 * dt);
    },

    logicRun: function(dt) {
        const rawThrottle = Input.throttle;
        this.fatigue += (this.speed * 0.0005) * dt;
        this.fatigue = Math.min(this.fatigue, 0.25); 
        
        const curvedThrottle = this.powerCurve(rawThrottle);
        const effectiveThrottle = curvedThrottle * (1 - this.fatigue);

        this.speed += (effectiveThrottle - this.speed) * (0.05 * dt);
        if (this.speed > 1.2) this.speed = 1.2;
        if (this.speed < 0) this.speed = 0;
        this.score += Math.round(this.speed * 20 * dt);
    },

    logicZen: function(dt) {
        this.speed = 0.4;
        this.score += Math.round(1 * dt);
        
        if(this.player) {
            const time = performance.now() / 1000;
            const breathe = Math.sin(time * 0.8) * 0.12;
            const inputBias = 1 + Input.action * 1.5;
            this.player.position.y += ((inputBias + breathe) - this.player.position.y) * (0.04 * dt);
        }
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
        if(s) { 
            if(this.state === 'PAUSE') s.classList.remove('hidden'); 
            else s.classList.add('hidden'); 
        }
    },

    gameOver: function() {
        this.state = 'OVER';
        const el = document.getElementById('final-score');
        if(el) el.innerText = this.score;
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
        if(d) d.innerHTML = `MODE: ${this.mode}<br>ACT: ${Input.action.toFixed(2)}<br>FPS: ${this.fps}`;
    }
};

window.onload = () => Game.init();
