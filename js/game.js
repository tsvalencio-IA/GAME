/**
 * NEO-WII Game Engine v26.1 (PLATINUM FINAL)
 * Status: GOLDEN MASTER 🟢
 * Fixes: CVS variable bug, Physics Stability, Nintendo Feel Math.
 */

const AudioSys = {
    ctx: null,
    init: function() {
        if (this.ctx) return;
        window.AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();
    },
    play: function(type) {
        if(!this.ctx) this.init();
        if(this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(()=>{});
        if(!this.ctx) return;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const t = this.ctx.currentTime;
        
        osc.connect(gain); gain.connect(this.ctx.destination);
        
        if (type === 'start') {
            osc.frequency.setValueAtTime(440, t); osc.frequency.exponentialRampToValueAtTime(880, t+0.4);
            gain.gain.setValueAtTime(0.1, t); gain.gain.linearRampToValueAtTime(0, t+0.4);
            osc.type = 'sine';
            this.vibrate(50);
        } else if (type === 'coin') {
            osc.frequency.setValueAtTime(1200, t); osc.frequency.linearRampToValueAtTime(1800, t+0.08);
            gain.gain.setValueAtTime(0.08, t); gain.gain.linearRampToValueAtTime(0, t+0.08);
            osc.type = 'square';
        } else if (type === 'crash') {
            osc.frequency.setValueAtTime(150, t); osc.frequency.exponentialRampToValueAtTime(10, t+0.4);
            gain.gain.setValueAtTime(0.2, t); gain.gain.exponentialRampToValueAtTime(0.01, t+0.4);
            osc.type = 'sawtooth';
            this.vibrate([30, 50, 30]);
        }
        osc.start(); osc.stop(t + 0.5);
    },
    vibrate: function(pattern) {
        if (navigator.vibrate) navigator.vibrate(pattern);
    }
};

const Game = {
    mode: 'kart', state: 'BOOT', score: 0, speed: 0,
    clock: new THREE.Clock(),
    
    // PHYSICS STATE
    playerVelX: 0, 
    fatigue: 0,    
    
    scene: null, camera: null, renderer: null, player: null, floor: null, objects: [],
    debugClickCount: 0, fps: 0, frames: 0, lastFpsTime: 0,

    init: function() {
        console.log("⚙️ Engine: Booting v26.1...");
        if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

        const p = new URLSearchParams(window.location.search);
        this.mode = p.get('mode') || 'kart';
        
        const config = { 
            'kart': { t: 'TURBO KART', msg: 'Use o celular como volante' }, 
            'run':  { t: 'MARATHON',  msg: 'Corra no lugar (Pule/Agache)' }, 
            'zen':  { t: 'ZEN GLIDER',msg: 'Incline a cabeça para flutuar' } 
        };
        const c = config[this.mode];
        if(document.getElementById('game-title')) {
            document.getElementById('game-title').innerText = c.t;
            document.getElementById('boot-msg').innerText = c.msg;
        }
        
        if(typeof Vision !== 'undefined') Vision.init();
        if(typeof Input !== 'undefined') Input.init();
        AudioSys.init();

        this.setup3D();
        
        setTimeout(() => {
            console.log("🚀 Engine: Ignition");
            this.forceStart();
        }, 300);
    },

    setup3D: function() {
        const cvs = document.getElementById('game-canvas');
        // FIX 1: Verificação correta da variável 'cvs'
        if (!cvs) return console.error("Canvas not found");

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
    },

    forceStart: function() {
        const boot = document.getElementById('screen-boot');
        if(boot) boot.classList.add('hidden');
        const hud = document.getElementById('hud-layer');
        if(hud) hud.classList.remove('hidden');

        AudioSys.play('start');
        
        if(typeof Vision !== 'undefined') {
            Vision.start().then(() => console.log("📸 Vision: Active"))
                  .catch(e => console.warn("Vision: Passive"));
        }

        this.state = 'PLAY';
        this.score = 0;
        this.speed = 0.3;
        
        this.playerVelX = 0;
        this.fatigue = 0;
        
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
            this.renderer.render(this.scene, this.camera);
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

        // SPRING-DAMPER PHYSICS (Nintendo Feel)
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
            // Usa Input.action para flutuação (Agora alimentado)
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
