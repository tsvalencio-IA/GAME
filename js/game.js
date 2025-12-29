/**
 * thIAguinho Game Engine v12.0 (Gold Master)
 * - Safe Asset Loading
 * - Procedural Fallback
 * - Audio Synthesis
 */

// --- 1. AUDIO (Sintetizador) ---
const AudioSys = {
    ctx: null,
    init: function() {
        if(this.ctx) return;
        try {
            window.AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext();
        } catch(e) {}
    },
    play: function(type) {
        if(!this.ctx || this.ctx.state === 'suspended') this.ctx?.resume();
        if(!this.ctx) return;
        
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        if(type==='coin') {
            osc.frequency.setValueAtTime(1200, t);
            osc.frequency.linearRampToValueAtTime(2000, t+0.1);
            gain.gain.setValueAtTime(0.1, t);
            gain.gain.linearRampToValueAtTime(0, t+0.1);
            osc.type = 'sine';
        } else if(type==='crash') {
            osc.frequency.setValueAtTime(100, t);
            osc.frequency.exponentialRampToValueAtTime(10, t+0.4);
            gain.gain.setValueAtTime(0.3, t);
            gain.gain.linearRampToValueAtTime(0, t+0.4);
            osc.type = 'sawtooth';
        }
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.start(); osc.stop(t+0.5);
    }
};

// --- 2. INPUT ---
const Input = {
    mode: 'TOUCH', x: 0,
    init: function() {
        const zone = document.getElementById('touch-zone');
        zone.addEventListener('touchmove', (e) => {
            if(this.mode !== 'TOUCH') return;
            e.preventDefault();
            const tx = e.touches[0].clientX / window.innerWidth;
            this.x = (tx - 0.5) * 3.0;
        }, {passive:false});

        window.addEventListener('deviceorientation', (e) => {
            if(this.mode === 'TILT') this.x = (e.gamma || 0) / 30;
        });

        if(typeof Vision !== 'undefined') Vision.setup('input-video');
    },
    setMode: function(m) {
        this.mode = m;
        const zone = document.getElementById('touch-zone');
        const calib = document.getElementById('screen-calib');
        
        // Reset
        zone.classList.add('hidden');
        calib.classList.add('hidden');
        Vision.stop();

        if(m === 'TOUCH') {
            zone.classList.remove('hidden');
        } else if (m === 'BODY') {
            Engine.setScreen(null); // Limpa
            calib.classList.remove('hidden'); // Mostra Mira
            Vision.start().then(() => {
                setTimeout(() => { // Simula calibração rápida
                    calib.classList.add('hidden');
                }, 2500);
            }).catch(e => {
                alert("Câmera indisponível. Usando Toque.");
                this.setMode('TOUCH');
            });
        } else if (m === 'TILT') {
            if(typeof DeviceOrientationEvent.requestPermission === 'function') DeviceOrientationEvent.requestPermission();
        }
        Engine.togglePause(false);
    },
    update: function() {
        if(this.mode === 'BODY' && Vision.active) {
            this.x += (Vision.data.x - this.x) * 0.15; // Suavização
        }
        this.x = Math.max(-1.5, Math.min(1.5, this.x));
    },
    forceTouch: function() { this.setMode('TOUCH'); }
};

// --- 3. ENGINE ---
const Engine = {
    scene: null, camera: null, renderer: null,
    player: null, floor: null, objects: [],
    state: { playing: false, paused: false, speed: 0, score: 0 },

    bootSystem: function() {
        // Ponto de entrada do usuário
        AudioSys.init();
        document.getElementById('screen-boot').classList.add('hidden');
        this.init3D();
        this.startGame();
    },

    init3D: function() {
        const cvs = document.getElementById('game-canvas');
        this.renderer = new THREE.WebGLRenderer({ canvas:cvs, alpha:true, antialias:true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog(0x000000, 10, 60);

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 100);
        this.camera.position.set(0, 3, 6);
        this.camera.lookAt(0, 0, -5);

        const amb = new THREE.AmbientLight(0xffffff, 0.6);
        const dir = new THREE.DirectionalLight(0xffffff, 1);
        dir.position.set(5,10,5); dir.castShadow = true;
        this.scene.add(amb, dir);

        this.createWorld();
        
        Input.init();
        const p = new URLSearchParams(window.location.search);
        const mode = p.get('mode') || 'kart';
        
        if(mode === 'run' || mode === 'zen') Input.setMode('BODY');
        else Input.setMode('TOUCH');

        this.animate();
    },

    createWorld: function() {
        // Tenta carregar textura, senão cria grid
        const texLoader = new THREE.TextureLoader();
        texLoader.load('assets/estrada.jpg', (tex) => {
            tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1, 20);
            const mat = new THREE.MeshPhongMaterial({ map: tex });
            this.spawnFloor(mat);
        }, undefined, () => {
            const mat = new THREE.MeshPhongMaterial({ color: 0x333333 }); // Fallback cinza
            this.spawnFloor(mat);
        });

        // Tenta carregar Mascote, senão cria carro procedural
        const loader = new THREE.GLTFLoader();
        const draco = new THREE.DRACOLoader();
        draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.5/');
        loader.setDRACOLoader(draco);

        loader.load('assets/mascote.glb', (gltf) => {
            this.player = gltf.scene;
            this.setupPlayer();
        }, undefined, () => {
            this.createProceduralKart(); // FALLBACK INTELIGENTE
        });
    },

    spawnFloor: function(mat) {
        this.floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 200), mat);
        this.floor.rotation.x = -Math.PI/2; this.floor.position.z = -80;
        this.floor.receiveShadow = true; this.scene.add(this.floor);
    },

    createProceduralKart: function() {
        // Cria um carro caso o arquivo 3D falhe
        this.player = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 2), new THREE.MeshPhongMaterial({color: 0x00bebd}));
        body.position.y = 0.5; body.castShadow = true;
        
        const wMat = new THREE.MeshBasicMaterial({color:0x222});
        const wGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 16);
        const pos = [[0.6, 0.3, 0.8], [-0.6, 0.3, 0.8], [0.6, 0.3, -0.8], [-0.6, 0.3, -0.8]];
        
        pos.forEach(p => {
            const w = new THREE.Mesh(wGeo, wMat);
            w.rotation.z = Math.PI/2; w.position.set(...p);
            this.player.add(w);
        });
        
        this.setupPlayer();
    },

    setupPlayer: function() {
        this.player.position.set(0, 0, -2);
        this.player.rotation.y = Math.PI;
        this.scene.add(this.player);
    },

    startGame: function() {
        this.state.playing = true;
        this.state.score = 0;
        this.state.speed = 0;
    },

    animate: function() {
        requestAnimationFrame(() => this.animate());
        if(!this.state.playing || this.state.paused) return;

        Input.update();

        // Lógica
        if(this.state.speed < 1.2) this.state.speed += 0.001;
        
        if(this.player) {
            this.player.position.x += (Input.x * 3.5 - this.player.position.x) * 0.15;
            this.player.rotation.z = -(this.player.position.x - Input.x * 3.5) * 0.3;
            this.player.rotation.y = Math.PI;
        }

        if(this.floor && this.floor.material.map) this.floor.material.map.offset.y -= this.state.speed * 0.05;

        // Obstáculos
        if(Math.random() < 0.02) this.spawnObj();
        this.manageObjects();

        this.state.score += Math.round(this.state.speed);
        document.getElementById('score-val').innerText = this.state.score;

        this.renderer.render(this.scene, this.camera);
    },

    spawnObj: function() {
        const type = Math.random() > 0.3 ? 'bad' : 'good';
        let mesh;
        if(type==='bad') mesh = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 16), new THREE.MeshPhongMaterial({color:0xff4444}));
        else {
            mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.1, 16), new THREE.MeshPhongMaterial({color:0xffd700}));
            mesh.rotation.x = Math.PI/2;
        }
        mesh.userData = {type:type};
        const lane = [-2.5, 0, 2.5][Math.floor(Math.random()*3)];
        mesh.position.set(lane, 0.5, -60);
        this.scene.add(mesh); this.objects.push(mesh);
    },

    manageObjects: function() {
        for(let i=this.objects.length-1; i>=0; i--) {
            let o = this.objects[i];
            o.position.z += this.state.speed * 1.5;
            if(o.userData.type === 'good') o.rotation.z += 0.1;

            if(this.player && Math.abs(o.position.z - this.player.position.z) < 1.0) {
                if(Math.abs(o.position.x - this.player.position.x) < 0.9) {
                    if(o.userData.type === 'bad') { AudioSys.play('crash'); this.gameOver(); }
                    else { AudioSys.play('coin'); this.state.score += 500; this.removeObj(o, i); }
                }
            }
            if(o.position.z > 5) this.removeObj(o, i);
        }
    },

    removeObj: function(o, i) { this.scene.remove(o); this.objects.splice(i, 1); },
    togglePause: function(force) {
        if(force === false) { this.state.paused = false; this.setScreen(null); return; }
        this.state.paused = !this.state.paused;
        this.setScreen(this.state.paused ? 'screen-pause' : null);
    },
    setScreen: function(id) {
        document.querySelectorAll('.overlay').forEach(el => {
            if(el.id !== 'screen-calib') el.classList.add('hidden');
        });
        if(id) document.getElementById(id).classList.remove('hidden');
    },
    gameOver: function() {
        this.state.playing = false;
        document.getElementById('final-score').innerText = this.state.score;
        this.setScreen('screen-over');
    },
    restart: function() {
        this.objects.forEach(o => this.scene.remove(o));
        this.objects = [];
        this.setScreen(null);
        this.startGame();
    }
};

window.onload = () => {
    document.querySelector('.spinner').classList.add('hidden');
    document.getElementById('boot-status').innerText = "Sistema Pronto.";
    document.getElementById('btn-start').classList.remove('hidden');
};
