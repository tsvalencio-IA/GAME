/**
 * thIAguinho Game Engine v12.0 (Gold Master)
 * - Carro Procedural (Garante visualização)
 * - Input Híbrido
 * - Audio Sintetizado
 */

// --- 1. AUDIO SYSTEM (No MP3 files required) ---
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
        
        if(type === 'coin') {
            osc.frequency.setValueAtTime(1200, t);
            osc.frequency.exponentialRampToValueAtTime(2000, t+0.1);
            gain.gain.setValueAtTime(0.1, t);
            gain.gain.linearRampToValueAtTime(0, t+0.15);
            osc.type = 'sine';
        } else if(type === 'crash') {
            osc.frequency.setValueAtTime(100, t);
            osc.frequency.linearRampToValueAtTime(50, t+0.3);
            gain.gain.setValueAtTime(0.2, t);
            gain.gain.linearRampToValueAtTime(0, t+0.3);
            osc.type = 'sawtooth';
        }
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(t+0.4);
    }
};

// --- 2. INPUT MANAGER ---
const Input = {
    mode: 'TOUCH', // 'TOUCH', 'TILT', 'BODY'
    x: 0, // Output (-1 to 1)
    
    init: function() {
        // Touch Listener
        const zone = document.getElementById('touch-zone');
        zone.addEventListener('touchmove', (e) => {
            if(this.mode !== 'TOUCH') return;
            e.preventDefault();
            const tx = e.touches[0].clientX / window.innerWidth;
            this.x = (tx - 0.5) * 2.5;
        }, {passive: false});

        // Tilt Listener
        window.addEventListener('deviceorientation', (e) => {
            if(this.mode === 'TILT') this.x = (e.gamma || 0) / 30;
        });

        // Vision Init
        if(typeof Vision !== 'undefined') Vision.setup('input-video');
    },

    setMode: function(m) {
        this.mode = m;
        const reticle = document.getElementById('reticle-layer');
        const touchZone = document.getElementById('touch-zone');
        const camFeed = document.getElementById('camera-feed');

        // Reset UI
        reticle.classList.add('hidden');
        touchZone.classList.add('hidden');
        if(camFeed) camFeed.style.opacity = 0;
        Vision.stop();

        if(m === 'TOUCH') {
            touchZone.classList.remove('hidden');
        } else if (m === 'BODY') {
            // Activa Calibração
            Engine.setScreen(null); // Limpa telas anteriores
            reticle.classList.remove('hidden');
            Vision.start().then(() => {
                // Timer de Calibração
                setTimeout(() => {
                    reticle.classList.add('hidden');
                    if(camFeed) camFeed.style.opacity = 1; // Show AR background
                    Engine.toast("CALIBRADO!");
                }, 3000); // 3 segundos para calibrar
            }).catch(err => {
                alert("Erro Câmera: " + err);
                this.setMode('TOUCH');
            });
        } else if (m === 'TILT') {
            if(typeof DeviceOrientationEvent.requestPermission === 'function') {
                DeviceOrientationEvent.requestPermission();
            }
        }
        Engine.togglePause(false); // Fecha menu
    },

    update: function() {
        if(this.mode === 'BODY' && Vision.active) {
            // Suavização (Lerp) para a câmera não tremer
            this.x += (Vision.data.x - this.x) * 0.2;
        }
        this.x = Math.max(-1.5, Math.min(1.5, this.x));
    }
};

// --- 3. ENGINE CORE ---
const Engine = {
    scene: null, camera: null, renderer: null,
    player: null, floor: null,
    objects: [],
    
    state: { playing: false, paused: false, speed: 0, score: 0 },
    
    boot: function() {
        // Primeira interação do usuário (Desbloqueia Audio)
        AudioSys.init();
        document.getElementById('screen-boot').classList.add('hidden');
        this.init3D();
        this.startGame();
    },

    init3D: function() {
        const cvs = document.getElementById('game-canvas');
        this.renderer = new THREE.WebGLRenderer({ canvas: cvs, alpha: true, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;

        this.scene = new THREE.Scene();
        // Fog para profundidade
        this.scene.fog = new THREE.Fog(0x000000, 10, 60);

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 100);
        this.camera.position.set(0, 3, 6);
        this.camera.lookAt(0, 0, -5);

        // Luzes
        const amb = new THREE.AmbientLight(0xffffff, 0.6);
        const dir = new THREE.DirectionalLight(0xffffff, 1);
        dir.position.set(5, 10, 5);
        dir.castShadow = true;
        this.scene.add(amb, dir);

        // Chão
        this.createRoad();
        
        // Player (Tenta carregar GLB, senão cria Procedural)
        this.loadPlayer();

        Input.init();
        // Detecta modo da URL
        const p = new URLSearchParams(window.location.search);
        const mode = p.get('mode') || 'kart';
        
        // Define controle inicial
        if(mode === 'run' || mode === 'zen') Input.setMode('BODY');
        else Input.setMode('TOUCH');

        this.animate();
    },

    createRoad: function() {
        const texLoader = new THREE.TextureLoader();
        // Tenta carregar textura, senão usa cor sólida
        texLoader.load('assets/estrada.jpg', (tex) => {
            tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
            tex.repeat.set(1, 20);
            const mat = new THREE.MeshPhongMaterial({ map: tex });
            this.spawnFloorMesh(mat);
        }, undefined, () => {
            // Fallback Road (Grid)
            const mat = new THREE.MeshPhongMaterial({ color: 0x333333 });
            this.spawnFloorMesh(mat);
        });
    },

    spawnFloorMesh: function(mat) {
        this.floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 200), mat);
        this.floor.rotation.x = -Math.PI / 2;
        this.floor.position.z = -80;
        this.floor.receiveShadow = true;
        this.scene.add(this.floor);
    },

    loadPlayer: function() {
        const loader = new THREE.GLTFLoader();
        // Usar CDN do Draco para garantir descompressão
        const draco = new THREE.DRACOLoader();
        draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.5/');
        loader.setDRACOLoader(draco);

        loader.load('assets/mascote.glb', (gltf) => {
            this.player = gltf.scene;
            this.setupPlayerMesh();
        }, undefined, (err) => {
            console.log("GLB Failed. Creating Procedural Kart.");
            this.createProceduralKart();
        });
    },

    createProceduralKart: function() {
        // Cria um carro com primitivos do ThreeJS (Garante que nunca fica invisível)
        this.player = new THREE.Group();
        
        // Corpo
        const bodyGeo = new THREE.BoxGeometry(1, 0.5, 2);
        const bodyMat = new THREE.MeshPhongMaterial({ color: 0x00bebd }); // Wii Blue
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 0.5;
        body.castShadow = true;
        this.player.add(body);

        // Rodas
        const wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 16);
        const wheelMat = new THREE.MeshPhongMaterial({ color: 0x333333 });
        const pos = [[0.6, 0.3, 0.8], [-0.6, 0.3, 0.8], [0.6, 0.3, -0.8], [-0.6, 0.3, -0.8]];
        
        pos.forEach(p => {
            const w = new THREE.Mesh(wheelGeo, wheelMat);
            w.rotation.z = Math.PI / 2;
            w.position.set(...p);
            this.player.add(w);
        });

        this.setupPlayerMesh();
    },

    setupPlayerMesh: function() {
        this.player.position.set(0, 0, -2);
        this.player.rotation.y = Math.PI; // Virar pra frente
        this.scene.add(this.player);
    },

    startGame: function() {
        this.state.playing = true;
        this.state.score = 0;
        this.state.speed = 0;
        this.toast("GO!");
    },

    animate: function() {
        requestAnimationFrame(() => this.animate());
        if(!this.state.playing || this.state.paused) return;

        Input.update();

        // Lógica de Movimento
        if(this.state.speed < 1.0) this.state.speed += 0.001; // Aceleração
        
        // Movimento do Player (Lerp)
        if(this.player) {
            this.player.position.x += (Input.x * 3.5 - this.player.position.x) * 0.15;
            this.player.rotation.z = -(this.player.position.x - Input.x * 3.5) * 0.3; // Inclinação
            this.player.rotation.y = Math.PI;
        }

        // Movimento do Chão
        if(this.floor && this.floor.material.map) {
            this.floor.material.map.offset.y -= this.state.speed * 0.05;
        }

        // Spawns
        if(Math.random() < 0.02) this.spawnObj();
        this.manageObjects();

        this.state.score += Math.round(this.state.speed);
        document.getElementById('score-val').innerText = this.state.score;

        this.renderer.render(this.scene, this.camera);
    },

    spawnObj: function() {
        const type = Math.random() > 0.3 ? 'bad' : 'good';
        let mesh;
        
        if(type === 'bad') {
            mesh = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 16), new THREE.MeshPhongMaterial({color: 0xff4444}));
        } else {
            mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.1, 16), new THREE.MeshPhongMaterial({color: 0xffcc00}));
            mesh.rotation.x = Math.PI/2;
        }
        
        mesh.userData = { type: type };
        // Pistas: Esquerda, Centro, Direita
        const lane = [-2.5, 0, 2.5][Math.floor(Math.random() * 3)];
        mesh.position.set(lane, 0.5, -60);
        
        this.scene.add(mesh);
        this.objects.push(mesh);
    },

    manageObjects: function() {
        for(let i=this.objects.length-1; i>=0; i--) {
            let o = this.objects[i];
            o.position.z += this.state.speed * 1.5;
            
            // Giro da moeda
            if(o.userData.type === 'good') o.rotation.z += 0.1;

            // Colisão (Box simples)
            if(this.player && Math.abs(o.position.z - this.player.position.z) < 1.0) {
                if(Math.abs(o.position.x - this.player.position.x) < 0.9) {
                    if(o.userData.type === 'bad') {
                        AudioSys.play('crash');
                        this.gameOver();
                    } else {
                        AudioSys.play('coin');
                        this.state.score += 500;
                        this.popCombo();
                        this.removeObj(o, i);
                    }
                }
            }
            // Remove se passou
            if(o.position.z > 5) this.removeObj(o, i);
        }
    },

    removeObj: function(o, i) {
        this.scene.remove(o);
        this.objects.splice(i, 1);
    },

    // UI Helpers
    toast: function(msg) {
        const t = document.getElementById('center-hint');
        if(t) { t.innerHTML = msg; t.classList.remove('hidden'); setTimeout(()=>t.classList.add('hidden'), 1000); }
    },
    popCombo: function() {
        const el = document.getElementById('combo-box');
        el.classList.add('combo-pop');
        setTimeout(()=>el.classList.remove('combo-pop'), 200);
    },
    setScreen: function(id) {
        document.querySelectorAll('.overlay-layer').forEach(el => {
            if(el.id !== 'reticle-layer') el.classList.add('hidden'); // Reticle gerenciado separadamente
        });
        if(id) document.getElementById(id).classList.remove('hidden');
    },
    togglePause: function(force) {
        if(force === false) { this.state.paused = false; this.setScreen(null); return; }
        this.state.paused = !this.state.paused;
        this.setScreen(this.state.paused ? 'screen-pause' : null);
    },
    gameOver: function() {
        this.state.playing = false;
        document.getElementById('final-pts').innerText = this.state.score;
        this.setScreen('screen-over');
    },
    restart: function() {
        this.objects.forEach(o => this.scene.remove(o));
        this.objects = [];
        this.setScreen(null);
        this.startGame();
    }
};

// Bootstrap Seguro
window.onload = () => {
    // Esconde spinner inicial e mostra botão de boot
    document.querySelector('#screen-boot .spinner').classList.add('hidden');
    document.getElementById('boot-status').innerText = "Sistema Pronto.";
    document.getElementById('btn-start').classList.remove('hidden');
};
