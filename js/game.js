/**
 * thIAguinho Game Engine v4.1 (Fix: Loading Robusto)
 * Foco: Garantir que o jogo abra mesmo se o modelo 3D falhar.
 */

// --- 1. SISTEMA DE INPUT (Mantido igual, pois funciona) ---
const InputSys = {
    mode: 'TOUCH', 
    sensitivity: 1.0,
    axisX: 0,      
    isAction: false,

    init: function() {
        // TILT
        window.addEventListener('deviceorientation', (e) => {
            if (this.mode === 'TILT') {
                const gamma = e.gamma || 0; 
                this.axisX = (gamma / 40) * this.sensitivity; 
                this.axisX = Math.max(-1, Math.min(1, this.axisX));
            }
        });

        // TOUCH
        const touchLayer = document.getElementById('ui-layer');
        touchLayer.addEventListener('touchmove', (e) => {
            if (this.mode === 'TOUCH') {
                const screenX = e.touches[0].clientX / window.innerWidth;
                this.axisX = (screenX - 0.5) * 2 * this.sensitivity;
                this.axisX = Math.max(-1, Math.min(1, this.axisX));
            }
        });
        
        touchLayer.addEventListener('touchstart', () => { 
            if(this.mode === 'TOUCH' || Game.config.mode === 'run') this.isAction = true; 
        });
        touchLayer.addEventListener('touchend', () => { this.isAction = false; });
    },

    update: function() {
        if (this.mode === 'BODY' && typeof Vision !== 'undefined' && Vision.active) {
            const rawX = (Vision.results.x - 0.5) * 2;
            this.axisX = rawX * this.sensitivity;
            if (Vision.results.activityLevel > 0.8) this.isAction = true;
            else this.isAction = false;
        }
    },

    setMode: function(newMode) {
        this.mode = newMode;
        document.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('active'));
        const btn = document.getElementById(`btn-${newMode.toLowerCase()}`);
        if(btn) btn.classList.add('active');
        
        const desc = document.getElementById('ctrl-desc');
        const touchUI = document.getElementById('touch-controls');
        const canvasCam = document.getElementById('camera-canvas');

        if (newMode === 'BODY') {
            if(desc) desc.innerText = "Afaste-se e use seu corpo.";
            if(touchUI) touchUI.classList.add('hidden');
            if(canvasCam) canvasCam.style.opacity = 1;
        } else if (newMode === 'TILT') {
            if(desc) desc.innerText = "Incline o celular.";
            if(touchUI) touchUI.classList.add('hidden');
            if(canvasCam) canvasCam.style.opacity = 0;
        } else {
            if(desc) desc.innerText = "Deslize o dedo na tela.";
            if(touchUI) touchUI.classList.remove('hidden');
            if(canvasCam) canvasCam.style.opacity = 0;
        }
    },

    setSensitivity: function(val) {
        this.sensitivity = parseFloat(val);
        const display = document.getElementById('sens-display');
        if(display) display.innerText = this.sensitivity.toFixed(1);
    }
};

// --- 2. GAME ENGINE PRINCIPAL ---
const Game = {
    config: { mode: 'race' },
    scene: null, camera: null, renderer: null,
    mascot: null, floor: null,
    obstacles: [],
    
    isPlaying: false,
    isPaused: false,
    score: 0,
    speed: 0,
    
    // Init Seguro
    init: async function() {
        console.log("Game: Iniciando...");
        const params = new URLSearchParams(window.location.search);
        this.config.mode = params.get('mode') || 'race';
        
        this.setupUI();
        InputSys.init();

        // Tenta iniciar a visão, mas não trava se falhar
        const vid = document.getElementById('input-video');
        const cvs = document.getElementById('camera-canvas');
        
        if(vid && cvs) {
            cvs.width = window.innerWidth; 
            cvs.height = window.innerHeight;
            
            // Se Vision existir, tenta iniciar. Se não, pula.
            if(typeof Vision !== 'undefined') {
                Vision.init(vid, cvs, 
                    () => { console.log("Vision OK"); this.launchEngine(); }, 
                    (err) => { 
                        console.warn("Vision Falhou (Sem Câmera):", err);
                        InputSys.setMode('TOUCH'); 
                        this.launchEngine(); 
                    }
                );
            } else {
                console.warn("Módulo Vision.js não encontrado.");
                this.launchEngine();
            }
        } else {
            this.launchEngine();
        }
    },

    setupUI: function() {
        const badges = { 'race': 'GRAND PRIX', 'run': 'STREET RUN', 'dance': 'DANCE FIT' };
        const badgeEl = document.getElementById('mode-badge');
        if(badgeEl) badgeEl.innerText = badges[this.config.mode];
        
        if (this.config.mode === 'run') {
            const tap = document.getElementById('tap-controls');
            if(tap) tap.classList.remove('hidden');
            InputSys.setMode('TOUCH'); 
        } else if (this.config.mode === 'dance') {
            InputSys.setMode('BODY'); 
        }
    },

    launchEngine: function() {
        const loadText = document.getElementById('loading-text');
        if(loadText) loadText.innerText = "Carregando 3D...";
        
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 100);
        this.camera.position.set(0, 2.5, 6);
        this.camera.lookAt(0, 0, -4);

        const canvas = document.getElementById('game-canvas');
        if(!canvas) { alert("ERRO: Canvas do jogo não encontrado no HTML!"); return; }

        this.renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;

        const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
        const dir = new THREE.DirectionalLight(0xffffff, 1.2);
        dir.position.set(5, 10, 7);
        dir.castShadow = true;
        this.scene.add(hemi, dir);

        this.createEnvironment();
        
        // TENTA CARREGAR MASCOTE COM FALLBACK
        this.loadMascot();
    },

    createEnvironment: function() {
        const texLoader = new THREE.TextureLoader();
        // Carrega textura, mas se falhar, cria chão cinza
        texLoader.load('assets/estrada.jpg', (tex) => {
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            tex.repeat.set(1, 20);
            const mat = new THREE.MeshPhongMaterial({ map: tex, transparent: true, opacity: 0.9 });
            this.spawnFloor(mat);
        }, undefined, (err) => {
            console.warn("Textura de estrada não encontrada. Usando cor sólida.");
            const mat = new THREE.MeshPhongMaterial({ color: 0x333333, transparent: true, opacity: 0.9 });
            this.spawnFloor(mat);
        });
    },

    spawnFloor: function(material) {
        this.floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 200), material);
        this.floor.rotation.x = -Math.PI / 2;
        this.floor.position.z = -80;
        this.floor.receiveShadow = true;
        this.scene.add(this.floor);
    },

    loadMascot: function() {
        const loader = new THREE.GLTFLoader();
        const draco = new THREE.DRACOLoader();
        // URL universal do Google para o decoder Draco (Garante que funciona sem arquivo local)
        draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.5/');
        loader.setDRACOLoader(draco);

        console.log("Tentando carregar: assets/mascote.glb");

        // Timeout de segurança: Se não carregar em 3s, usa o cubo
        const timeout = setTimeout(() => {
            console.warn("Timeout do modelo. Usando fallback.");
            this.useFallbackMascot();
        }, 3000);

        loader.load('assets/mascote.glb', (gltf) => {
            clearTimeout(timeout); // Cancela o timeout, carregou com sucesso!
            console.log("Modelo carregado!");
            
            this.mascot = gltf.scene;
            this.mascot.traverse(o => { if(o.isMesh) o.castShadow = true; });
            
            const box = new THREE.Box3().setFromObject(this.mascot);
            const size = box.getSize(new THREE.Vector3());
            const scale = 1.8 / (size.y || 1); 
            this.mascot.scale.setScalar(scale);
            
            this.mascot.position.set(0, 0, -2);
            this.mascot.rotation.y = Math.PI;
            this.scene.add(this.mascot);
            this.startGameLoop();
            
        }, undefined, (err) => {
            clearTimeout(timeout);
            console.error("Erro ao carregar modelo:", err);
            this.useFallbackMascot();
        });
    },

    useFallbackMascot: function() {
        // Cria um "Mascote" cúbico se o arquivo .glb falhar
        if(this.mascot) return; // Já carregou

        const geo = new THREE.BoxGeometry(1, 2, 1);
        const mat = new THREE.MeshStandardMaterial({ color: 0xFFD700, roughness: 0.3 });
        this.mascot = new THREE.Mesh(geo, mat);
        this.mascot.position.set(0, 1, -2);
        this.mascot.castShadow = true;
        this.scene.add(this.mascot);
        
        console.log("Fallback Mascote ativado.");
        this.startGameLoop();
    },

    startGameLoop: function() {
        const screen = document.getElementById('loading-screen');
        if(screen) screen.classList.add('hidden');
        this.isPlaying = true;
        this.animate();
    },

    // --- GAME LOOP ---
    update: function() {
        if (!this.isPlaying || this.isPaused) return;

        InputSys.update();

        // Lógica de Movimento e Modos (Simplificada e Robusta)
        if (this.config.mode === 'race') {
            if (this.speed < 0.8) this.speed += 0.002;
        } else if (this.config.mode === 'run') {
            if (InputSys.isAction) this.speed += 0.05;
            else this.speed *= 0.95;
            this.speed = Math.min(this.speed, 1.2);
        } else { // Dance
            this.speed = 0.5;
        }

        // Movimento do Mascote
        if (this.mascot) {
            const targetX = InputSys.axisX * 3.0;
            this.mascot.position.x += (targetX - this.mascot.position.x) * 0.2;
            
            // Pulo visual
            if(this.config.mode === 'run' && InputSys.isAction && this.mascot.position.y < 0.5) {
                this.mascot.position.y += 0.1;
            } else if (this.mascot.position.y > 0) {
                this.mascot.position.y -= 0.05;
                if(this.mascot.position.y < 0) this.mascot.position.y = 0;
            }

            this.mascot.rotation.z = -this.mascot.position.x * 0.1;
            this.mascot.rotation.y = Math.PI;
        }

        // Chão
        if (this.floor && this.floor.material.map) {
            this.floor.material.map.offset.y -= this.speed * 0.05;
        }

        // Obstáculos
        if (this.config.mode === 'race' && Math.random() < 0.02) this.spawnEntity('obstacle');
        if (this.config.mode === 'dance' && Math.random() < 0.03) this.spawnEntity('collectible');

        this.manageEntities();

        if (this.speed > 0.1) {
            this.score += Math.round(this.speed);
            const scoreEl = document.getElementById('score-val');
            if(scoreEl) scoreEl.innerText = this.score;
        }
    },

    spawnEntity: function(type) {
        let obj;
        if (type === 'obstacle') {
            obj = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.5, 16), new THREE.MeshPhongMaterial({ color: 0xff4757 }));
            obj.userData = { type: 'obstacle' };
            obj.position.set([-2.5, 0, 2.5][Math.floor(Math.random()*3)], 0.75, -60);
        } else {
            obj = new THREE.Mesh(new THREE.SphereGeometry(0.4), new THREE.MeshPhongMaterial({ color: 0x1e90ff, emissive: 0x00a8ff }));
            obj.userData = { type: 'collectible' };
            obj.position.set((Math.random()*6)-3, 1.5, -60);
        }
        this.scene.add(obj);
        this.obstacles.push(obj);
    },

    manageEntities: function() {
        for (let i = this.obstacles.length - 1; i >= 0; i--) {
            let obj = this.obstacles[i];
            obj.position.z += this.speed * 1.5;

            if (this.mascot) {
                const dx = Math.abs(obj.position.x - this.mascot.position.x);
                const dz = Math.abs(obj.position.z - this.mascot.position.z);
                
                if (dz < 1.0 && dx < 0.8) {
                    if (obj.userData.type === 'obstacle') this.gameOver();
                    else { 
                        this.score += 500; 
                        this.scene.remove(obj); 
                        this.obstacles.splice(i, 1); 
                    }
                }
            }
            if (obj.position.z > 5) {
                this.scene.remove(obj);
                this.obstacles.splice(i, 1);
            }
        }
    },

    gameOver: function() {
        this.isPlaying = false;
        const screen = document.getElementById('game-over-screen');
        if(screen) screen.classList.remove('hidden');
        const final = document.getElementById('final-score');
        if(final) final.innerText = this.score;
    },

    restart: function() {
        this.obstacles.forEach(o => this.scene.remove(o));
        this.obstacles = [];
        this.score = 0;
        this.speed = 0;
        const screen = document.getElementById('game-over-screen');
        if(screen) screen.classList.add('hidden');
        this.isPlaying = true;
    },

    togglePause: function() {
        this.isPaused = !this.isPaused;
        const modal = document.getElementById('settings-modal');
        if(modal) modal.classList.toggle('hidden');
    },

    animate: function() {
        requestAnimationFrame(() => this.animate());
        this.update();
        if(this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }
};

window.onload = () => Game.init();
