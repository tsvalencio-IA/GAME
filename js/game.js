/**
 * thIAguinho Game Engine v5.0 (Controller Fix)
 * Gestão Robusta de Inputs: Touch, Tilt (com permissão iOS) e Body (Câmera).
 */

// --- GERENCIADOR DE INPUTS ---
const InputSys = {
    mode: 'TOUCH', // TOUCH, TILT, BODY
    sensitivity: 1.0,
    axisX: 0, // Output final (-1 a 1)
    isAction: false,

    init: function() {
        // Touch Listeners (Sempre ativos, mas só processados se mode == TOUCH)
        const touchZone = document.getElementById('touch-zone');
        
        touchZone.addEventListener('touchmove', (e) => {
            if(this.mode !== 'TOUCH') return;
            e.preventDefault(); // Evita scroll
            const x = e.touches[0].clientX / window.innerWidth;
            this.axisX = (x - 0.5) * 2 * this.sensitivity;
            this.axisX = Math.max(-1, Math.min(1, this.axisX));
        }, {passive: false});

        touchZone.addEventListener('touchstart', (e) => {
            if(this.mode !== 'TOUCH') return;
            this.isAction = true;
        });
        
        touchZone.addEventListener('touchend', () => { this.isAction = false; });

        // Inicializa o Vision Setup (mas não liga câmera ainda)
        if(typeof Vision !== 'undefined') {
            const cvs = document.getElementById('camera-canvas');
            // Ajusta tamanho do canvas da câmera
            cvs.width = window.innerWidth;
            cvs.height = window.innerHeight;
            Vision.setup('input-video', 'camera-canvas');
        }
    },

    // FUNÇÃO CRÍTICA: Troca de Modos
    changeMode: function(newMode) {
        console.log(`InputSys: Trocando para ${newMode}`);
        this.mode = newMode;

        // 1. Gerenciar TILT (Permissão iOS)
        if (newMode === 'TILT') {
            this.requestTiltPermission();
        } else {
            // Remove listener se sair do tilt (opcional, mas boa prática)
            window.removeEventListener('deviceorientation', this.handleTilt);
        }

        // 2. Gerenciar CAMERA (Ligar/Desligar)
        if (newMode === 'BODY') {
            Vision.start();
        } else {
            Vision.stop();
        }

        // 3. Gerenciar TOUCH (Mostrar/Esconder Zona)
        const tZone = document.getElementById('touch-zone');
        if (newMode === 'TOUCH') tZone.classList.remove('hidden');
        else tZone.classList.add('hidden');

        // 4. Atualizar UI (Botões Ativos)
        document.querySelectorAll('.ctrl-btn').forEach(btn => btn.classList.remove('active'));
        document.getElementById(`btn-mode-${newMode.toLowerCase()}`).classList.add('active');

        // Feedback
        UI.showToast(`MODO: ${newMode}`);
    },

    // Lógica Específica de iOS 13+
    requestTiltPermission: function() {
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            DeviceOrientationEvent.requestPermission()
                .then(response => {
                    if (response === 'granted') {
                        window.addEventListener('deviceorientation', this.handleTilt.bind(this));
                    } else {
                        alert("Permissão de giroscópio negada.");
                        this.changeMode('TOUCH'); // Fallback
                    }
                })
                .catch(console.error);
        } else {
            // Android ou iOS antigo (Não precisa de requestPermission)
            window.addEventListener('deviceorientation', this.handleTilt.bind(this));
        }
    },

    handleTilt: function(e) {
        if (InputSys.mode !== 'TILT') return;
        const gamma = e.gamma || 0; 
        InputSys.axisX = (gamma / 40) * InputSys.sensitivity;
        InputSys.axisX = Math.max(-1, Math.min(1, InputSys.axisX));
    },

    update: function() {
        // Se for BODY, pega do Vision a cada frame
        if (this.mode === 'BODY' && Vision.active && Vision.results.visible) {
            const rawX = (Vision.results.x - 0.5) * 2;
            this.axisX = rawX * this.sensitivity;
        }
    },

    setSensitivity: function(val) {
        this.sensitivity = parseFloat(val);
        document.getElementById('sens-display').innerText = this.sensitivity.toFixed(1);
    }
};

// --- UI MANAGER ---
const UI = {
    toggleSettings: function() {
        const m = document.getElementById('settings-modal');
        m.classList.toggle('hidden');
    },
    showToast: function(msg) {
        const t = document.getElementById('control-feedback');
        t.innerText = msg;
        t.classList.remove('hidden');
        t.style.opacity = 1;
        setTimeout(() => { t.style.opacity = 0; }, 2000);
    }
};

// --- GAME ENGINE ---
const Game = {
    config: { mode: 'race' },
    scene: null, camera: null, renderer: null,
    mascot: null, floor: null,
    obstacles: [],
    
    isPlaying: false,
    score: 0,
    speed: 0,

    init: function() {
        const params = new URLSearchParams(window.location.search);
        this.config.mode = params.get('mode') || 'race';
        
        document.getElementById('mode-badge').innerText = this.config.mode.toUpperCase();

        // Inicia Inputs
        InputSys.init();
        
        // Define modo inicial padrão
        // Se for 'dance', tenta ir direto pro corpo. Se não, touch.
        if(this.config.mode === 'dance') InputSys.changeMode('BODY');
        else InputSys.changeMode('TOUCH');

        // Inicia 3D
        this.init3D();
    },

    init3D: function() {
        document.getElementById('loading-text').innerText = "Carregando Gráficos...";
        
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 100);
        this.camera.position.set(0, 2.5, 6);
        this.camera.lookAt(0, 0, -4);

        const canvas = document.getElementById('game-canvas');
        this.renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;

        const light = new THREE.DirectionalLight(0xffffff, 1.2);
        light.position.set(5, 10, 7);
        light.castShadow = true;
        this.scene.add(light, new THREE.AmbientLight(0xffffff, 0.5));

        this.createEnvironment();
        this.loadMascot();

        document.getElementById('loading-screen').classList.add('hidden');
        this.isPlaying = true;
        this.animate();
    },

    createEnvironment: function() {
        const tex = new THREE.TextureLoader().load('assets/estrada.jpg');
        tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1, 20);
        const mat = new THREE.MeshPhongMaterial({ map: tex, transparent: true, opacity: 0.9 });
        this.floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 200), mat);
        this.floor.rotation.x = -Math.PI / 2;
        this.floor.position.z = -80;
        this.scene.add(this.floor);
    },

    loadMascot: function() {
        const loader = new THREE.GLTFLoader();
        const draco = new THREE.DRACOLoader();
        draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.5/');
        loader.setDRACOLoader(draco);

        loader.load('assets/mascote.glb', (gltf) => {
            this.mascot = gltf.scene;
            this.fixMascot();
            this.scene.add(this.mascot);
        }, undefined, () => {
            // Fallback
            this.mascot = new THREE.Mesh(new THREE.BoxGeometry(1,2,1), new THREE.MeshNormalMaterial());
            this.fixMascot();
            this.scene.add(this.mascot);
        });
    },

    fixMascot: function() {
        const box = new THREE.Box3().setFromObject(this.mascot);
        const scale = 1.8 / box.getSize(new THREE.Vector3()).y;
        this.mascot.scale.setScalar(scale);
        this.mascot.position.set(0, 0, -2);
        this.mascot.rotation.y = Math.PI;
    },

    update: function() {
        if(!this.isPlaying) return;

        // Atualiza inputs (Camera, Tilt ou Touch)
        InputSys.update();

        // Aumenta velocidade
        if(this.speed < 0.8) this.speed += 0.001;

        // Movimento Mascote
        if(this.mascot) {
            const targetX = InputSys.axisX * 3.0;
            this.mascot.position.x += (targetX - this.mascot.position.x) * 0.15;
            this.mascot.rotation.z = -this.mascot.position.x * 0.1;
            this.mascot.rotation.y = Math.PI;
        }

        // Movimento Chão
        if(this.floor && this.floor.material.map) {
            this.floor.material.map.offset.y -= this.speed * 0.05;
        }

        // Score
        if(this.speed > 0) {
            this.score += Math.round(this.speed * 2);
            document.getElementById('score-val').innerText = this.score;
        }

        // Spawns
        if(Math.random() < 0.02) this.spawnObstacle();
        this.manageObstacles();
    },

    spawnObstacle: function() {
        const geo = new THREE.ConeGeometry(0.5, 1.5, 16);
        const mat = new THREE.MeshPhongMaterial({ color: 0xff4757 });
        const obj = new THREE.Mesh(geo, mat);
        obj.position.set([-2.5, 0, 2.5][Math.floor(Math.random()*3)], 0.75, -60);
        this.scene.add(obj);
        this.obstacles.push(obj);
    },

    manageObstacles: function() {
        for(let i=this.obstacles.length-1; i>=0; i--) {
            let o = this.obstacles[i];
            o.position.z += this.speed * 1.5;

            // Colisão
            if(this.mascot && o.position.z > -3 && o.position.z < -1) {
                if(Math.abs(o.position.x - this.mascot.position.x) < 0.8) this.gameOver();
            }

            if(o.position.z > 5) {
                this.scene.remove(o);
                this.obstacles.splice(i,1);
            }
        }
    },

    gameOver: function() {
        this.isPlaying = false;
        document.getElementById('final-score').innerText = this.score;
        document.getElementById('game-over-screen').classList.remove('hidden');
    },

    restart: function() {
        this.obstacles.forEach(o => this.scene.remove(o));
        this.obstacles = [];
        this.score = 0;
        this.speed = 0;
        document.getElementById('game-over-screen').classList.add('hidden');
        this.isPlaying = true;
    },

    animate: function() {
        requestAnimationFrame(() => this.animate());
        this.update();
        if(this.renderer) this.renderer.render(this.scene, this.camera);
    }
};

window.onload = () => Game.init();
