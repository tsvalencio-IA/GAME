/**
 * thIAguinho Game Engine v9.0 (Production Ready)
 */

// --- SOUND MANAGER ---
const AudioSys = {
    ctx: null,
    init: function() {
        try {
            window.AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext();
        } catch(e) { console.warn("Audio não suportado"); }
    },
    playTone: function(freq, type, duration) {
        if(!this.ctx) this.init();
        if(this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
        if(!this.ctx) return;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    },
    sfx: {
        coin: () => AudioSys.playTone(1200, 'sine', 0.1),
        crash: () => AudioSys.playTone(100, 'sawtooth', 0.4),
        start: () => AudioSys.playTone(600, 'square', 0.5),
        tap: () => AudioSys.playTone(400, 'triangle', 0.05)
    }
};

// --- INPUT MANAGER ---
const Input = {
    mode: 'TOUCH', x: 0, action: false,
    
    init: function() {
        const zone = document.getElementById('touch-controls');
        if(zone) {
            zone.addEventListener('touchmove', (e) => {
                if(this.mode !== 'TOUCH') return;
                e.preventDefault();
                const tx = e.touches[0].clientX / window.innerWidth;
                this.x = (tx - 0.5) * 2.5;
            }, {passive:false});
            
            zone.addEventListener('touchstart', () => { 
                if(this.mode==='TOUCH') { this.action = true; AudioSys.sfx.tap(); } 
            });
            zone.addEventListener('touchend', () => { this.action = false; });
        }

        window.addEventListener('deviceorientation', (e) => {
            if(this.mode === 'TILT') this.x = (e.gamma || 0) / 30;
        });

        // Setup Vision apenas se existir
        if(typeof Vision !== 'undefined') Vision.setup('input-video', 'camera-feed');
    },

    setMode: function(m) {
        this.mode = m;
        const zone = document.getElementById('touch-controls');
        const cam = document.getElementById('camera-feed');
        
        if(m === 'TOUCH') {
            if(zone) zone.classList.remove('hidden');
            if(cam) cam.style.opacity = 0;
            Vision.stop();
        } else if (m === 'BODY') {
            if(zone) zone.classList.add('hidden');
            Engine.setScreen('screen-calibration');
            Vision.start().then(() => {
                const checkCalib = setInterval(() => {
                    const status = document.getElementById('calib-status');
                    if(status) status.innerText = `Pose: ${Vision.data.gesture || '...'}`;
                    
                    if(Vision.data.gesture === 'T-POSE') {
                        clearInterval(checkCalib);
                        Engine.setScreen(null);
                        AudioSys.sfx.start();
                        Engine.toast("CALIBRADO!");
                    }
                }, 500);
            }).catch(() => {
                alert("Falha na câmera. Usando toque.");
                this.setMode('TOUCH');
            });
        } else { // TILT
            if(zone) zone.classList.add('hidden');
            if(cam) cam.style.opacity = 0;
            Vision.stop();
            if(typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
                DeviceOrientationEvent.requestPermission();
            }
        }
    },

    update: function() {
        if(this.mode === 'BODY' && Vision.active) {
            this.x = Vision.data.x;
        }
        this.x = Math.max(-1.5, Math.min(1.5, this.x));
    }
};

// --- ENGINE PRINCIPAL ---
const Engine = {
    mode: 'kart', scene: null, camera: null, renderer: null,
    mascot: null, floor: null, objects: [],
    state: { playing: false, paused: false, speed: 0, score: 0 },

    init: function() {
        console.log("Engine: Init...");
        const p = new URLSearchParams(window.location.search);
        this.mode = p.get('mode') || 'kart';
        
        Input.init();
        if(this.mode === 'run' || this.mode === 'zen') Input.setMode('BODY'); 
        else Input.setMode('TOUCH'); 

        this.initGraphics();
    },

    initGraphics: function() {
        const cvs = document.getElementById('game-canvas');
        this.renderer = new THREE.WebGLRenderer({ canvas:cvs, alpha:true, antialias:true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog(0xdcdcdc, 10, 60);

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 100);
        this.camera.position.set(0, 3, 6);
        this.camera.lookAt(0, 0, -5);

        const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.8);
        const dir = new THREE.DirectionalLight(0xffffff, 0.8);
        dir.position.set(5, 10, 5);
        dir.castShadow = true;
        this.scene.add(hemi, dir);

        this.createEnvironment();
        this.loadAssets();
    },

    createEnvironment: function() {
        const texLoader = new THREE.TextureLoader();
        texLoader.load('assets/estrada.jpg', (tex) => {
            tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1, 20);
            const mat = new THREE.MeshPhongMaterial({ map: tex });
            this.spawnFloor(mat);
        }, undefined, () => {
            const mat = new THREE.MeshPhongMaterial({ color: 0x555555 });
            this.spawnFloor(mat);
        });
    },

    spawnFloor: function(mat) {
        this.floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 200), mat);
        this.floor.rotation.x = -Math.PI/2; 
        this.floor.position.z = -80;
        this.floor.receiveShadow = true;
        this.scene.add(this.floor);
    },

    loadAssets: function() {
        const loader = new THREE.GLTFLoader();
        const draco = new THREE.DRACOLoader();
        draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.5/');
        loader.setDRACOLoader(draco);

        loader.load('assets/mascote.glb', (gltf) => {
            console.log("Assets: Mascote OK");
            this.mascot = gltf.scene;
            this.prepareMascot();
        }, undefined, (err) => {
            console.warn("Assets: Falha no Mascote, usando fallback");
            const geo = new THREE.BoxGeometry(1, 1, 1);
            const mat = new THREE.MeshStandardMaterial({ color: 0xffcc00 });
            this.mascot = new THREE.Mesh(geo, mat);
            this.prepareMascot();
        });
    },

    prepareMascot: function() {
        this.mascot.position.set(0, 0, -2);
        this.mascot.rotation.y = Math.PI;
        this.scene.add(this.mascot);
        
        document.getElementById('screen-loading').classList.add('hidden');
        this.startGame();
        this.animate();
    },

    startGame: function() {
        this.state.playing = true;
        this.state.score = 0;
        this.state.speed = 0;
        AudioSys.sfx.start();
        this.toast("GO!");
    },

    animate: function() {
        requestAnimationFrame(() => this.animate());
        if(!this.state.playing || this.state.paused) return;

        Input.update();
        
        if(this.mode === 'kart') this.updateKart();
        else if(this.mode === 'run') this.updateRun();
        else this.updateZen();

        if(this.mascot) {
            this.mascot.position.x += (Input.x * 3 - this.mascot.position.x) * 0.1;
            this.mascot.rotation.z = -this.mascot.position.x * 0.2;
            this.mascot.rotation.y = Math.PI;
        }

        if(this.floor && this.floor.material.map) {
            this.floor.material.map.offset.y -= this.state.speed * 0.05;
        }

        this.renderer.render(this.scene, this.camera);
    },

    updateKart: function() {
        if(this.state.speed < 1.2) this.state.speed += 0.001;
        this.state.score += Math.round(this.state.speed);
        if(Math.random() < 0.02) this.spawnObj('obstacle');
        if(Math.random() < 0.01) this.spawnObj('coin');
        this.manageObjects(true);
        this.updateHUD();
    },

    updateRun: function() {
        if(Input.action) this.state.speed += 0.05;
        else this.state.speed *= 0.95;
        this.state.speed = Math.min(this.state.speed, 1.5);
        this.state.score += Math.round(this.state.speed * 5);
        this.updateHUD();
    },

    updateZen: function() {
        this.state.speed = 0.6;
        if(Math.random() < 0.03) this.spawnObj('coin');
        this.manageObjects(false);
        this.updateHUD();
    },

    spawnObj: function(type) {
        let mesh;
        if(type === 'obstacle') {
            mesh = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1, 16), new THREE.MeshPhongMaterial({color:0xff3333}));
            mesh.userData = {type:'bad'};
        } else {
            mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.1, 16), new THREE.MeshPhongMaterial({color:0xffd700}));
            mesh.rotation.x = Math.PI/2;
            mesh.userData = {type:'good'};
        }
        const lane = [-2.5, 0, 2.5][Math.floor(Math.random()*3)];
        mesh.position.set(lane, 0.5, -60);
        this.scene.add(mesh);
        this.objects.push(mesh);
    },

    manageObjects: function(deadly) {
        for(let i=this.objects.length-1; i>=0; i--) {
            let o = this.objects[i];
            o.position.z += this.state.speed * 1.5;
            if(o.userData.type === 'good') o.rotation.z += 0.1;

            if(this.mascot && Math.abs(o.position.z - this.mascot.position.z) < 1.0) {
                if(Math.abs(o.position.x - this.mascot.position.x) < 0.8) {
                    if(o.userData.type === 'bad' && deadly) {
                        AudioSys.sfx.crash();
                        this.gameOver();
                    } else if (o.userData.type === 'good') {
                        AudioSys.sfx.coin();
                        this.state.score += 500;
                        this.removeObj(o, i);
                        this.toast("+500");
                    }
                }
            }
            if(o.position.z > 5) this.removeObj(o, i);
        }
    },

    removeObj: function(o, i) {
        this.scene.remove(o);
        this.objects.splice(i, 1);
    },

    updateHUD: function() {
        const el = document.getElementById('score-display');
        if(el) el.innerText = this.state.score;
    },
    toast: function(msg) {
        const t = document.getElementById('toast');
        if(t) { t.innerText = msg; t.classList.remove('hidden'); setTimeout(()=>t.classList.add('hidden'), 1000); }
    },
    togglePause: function() {
        this.state.paused = !this.state.paused;
        const s = document.getElementById('screen-pause');
        if(s) {
            if(this.state.paused) s.classList.remove('hidden');
            else s.classList.add('hidden');
        }
    },
    setScreen: function(id) {
        document.querySelectorAll('.modal-overlay').forEach(el => el.classList.add('hidden'));
        if(id) document.getElementById(id).classList.remove('hidden');
    },
    gameOver: function() {
        this.state.playing = false;
        const el = document.getElementById('final-score');
        if(el) el.innerText = this.state.score;
        this.setScreen('screen-gameover');
    },
    restart: function() {
        this.objects.forEach(o => this.scene.remove(o));
        this.objects = [];
        this.setScreen(null);
        this.startGame();
    }
};

window.onload = () => Engine.init();
