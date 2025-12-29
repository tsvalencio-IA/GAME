/**
 * thIAguinho Game Engine v6.0 (Distinct Gameplay)
 * Três lógicas de jogo separadas e únicas.
 */

// --- 1. SISTEMA DE INPUT (Hardware Manager) ---
const InputSys = {
    mode: 'TOUCH', 
    sensitivity: 1.2,
    axisX: 0,      // -1 (Esq) a 1 (Dir)
    isAction: false, // Pulso de ação (Tap ou Pulo)

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
        const touchZone = document.getElementById('touch-zone');
        if(touchZone) {
            touchZone.addEventListener('touchmove', (e) => {
                if (this.mode !== 'TOUCH') return;
                e.preventDefault();
                const screenX = e.touches[0].clientX / window.innerWidth;
                this.axisX = (screenX - 0.5) * 2.5 * this.sensitivity;
                this.axisX = Math.max(-1, Math.min(1, this.axisX));
            }, {passive: false});

            touchZone.addEventListener('touchstart', () => { 
                if(this.mode === 'TOUCH') this.isAction = true; 
            });
            touchZone.addEventListener('touchend', () => { this.isAction = false; });
        }

        // Vision Setup
        if(typeof Vision !== 'undefined') {
            const cvs = document.getElementById('camera-canvas');
            if(cvs) {
                cvs.width = window.innerWidth; cvs.height = window.innerHeight;
                Vision.setup('input-video', 'camera-canvas');
            }
        }
    },

    changeMode: function(newMode) {
        this.mode = newMode;
        
        // Tilt Permissions (iOS)
        if (newMode === 'TILT' && typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            DeviceOrientationEvent.requestPermission().then(r => {
                if(r !== 'granted') this.changeMode('TOUCH');
            });
        }

        // Camera Power Management
        if (newMode === 'BODY') Vision.start();
        else Vision.stop();

        // UI Updates
        const tZone = document.getElementById('touch-zone');
        if (tZone) {
            if (newMode === 'TOUCH') tZone.classList.remove('hidden');
            else tZone.classList.add('hidden');
        }

        document.querySelectorAll('.ctrl-btn').forEach(btn => btn.classList.remove('active'));
        const activeBtn = document.getElementById(`btn-mode-${newMode.toLowerCase()}`);
        if(activeBtn) activeBtn.classList.add('active');

        // Feedback
        if(typeof UI !== 'undefined' && UI.showToast) UI.showToast(`MODO: ${newMode}`);
    },

    update: function() {
        // Body Tracking Update
        if (this.mode === 'BODY' && Vision.active && Vision.results.visible) {
            const rawX = (Vision.results.x - 0.5) * 2.5; // Amplifica movimento
            this.axisX = rawX * this.sensitivity;
            
            // Detectar "Corrida no Lugar" (Sobe e desce dos ombros)
            if (Vision.results.activity > 1.5) {
                this.isAction = true;
            } else {
                this.isAction = false;
            }
        }
    },

    setSensitivity: function(val) {
        this.sensitivity = parseFloat(val);
        const el = document.getElementById('sens-display');
        if(el) el.innerText = this.sensitivity.toFixed(1);
    }
};

// --- 2. GAME ENGINE ---
const Game = {
    config: { mode: 'race' },
    scene: null, camera: null, renderer: null,
    mascot: null, floor: null,
    entities: [], // Obstáculos ou Coletáveis
    
    // Estado
    isPlaying: false,
    score: 0,
    speed: 0,
    combo: 0, // Para o modo Dance

    init: function() {
        const params = new URLSearchParams(window.location.search);
        this.config.mode = params.get('mode') || 'race';
        
        const badge = document.getElementById('mode-badge');
        if(badge) badge.innerText = this.config.mode.toUpperCase();

        // Ajustes de UI por modo
        this.setupGameModeUI();

        InputSys.init();
        
        // Padrão de input por modo
        if(this.config.mode === 'dance') InputSys.changeMode('BODY');
        else if(this.config.mode === 'run') InputSys.changeMode('TOUCH');
        else InputSys.changeMode('TOUCH'); // Race

        this.init3D();
    },

    setupGameModeUI: function() {
        const hint = document.querySelector('.touch-visual-hint');
        if(!hint) return;

        if(this.config.mode === 'run') {
            hint.innerHTML = "<i class='bx bx-run'></i><br>TOQUE RÁPIDO PARA CORRER!";
        } else if (this.config.mode === 'race') {
            hint.innerHTML = "<i class='bx bxs-car-crash'></i><br>DESLIZE PARA DESVIAR";
        } else {
            hint.innerHTML = "<i class='bx bxs-music'></i><br>MOVA-SE PARA PEGAR ORBES";
        }
    },

    init3D: function() {
        const loadText = document.getElementById('loading-text');
        if(loadText) loadText.innerText = "Carregando Engine...";

        this.scene = new THREE.Scene();
        // Fog diferente para cada modo
        if(this.config.mode === 'race') this.scene.fog = new THREE.Fog(0x000000, 10, 50); // Escuro/Tenso
        if(this.config.mode === 'dance') this.scene.fog = new THREE.FogExp2(0x100020, 0.03); // Neon/Disco
        if(this.config.mode === 'run') this.scene.fog = new THREE.Fog(0x87CEEB, 20, 80); // Dia/Claro

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 100);
        this.camera.position.set(0, 2.5, 6);
        this.camera.lookAt(0, 0, -4);

        const canvas = document.getElementById('game-canvas');
        this.renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;

        // Luzes
        const amb = new THREE.AmbientLight(0xffffff, 0.6);
        const dir = new THREE.DirectionalLight(0xffffff, 1.2);
        dir.position.set(5, 10, 7);
        dir.castShadow = true;
        this.scene.add(amb, dir);

        this.createEnvironment();
        this.loadMascot();

        const screen = document.getElementById('loading-screen');
        if(screen) screen.classList.add('hidden');
        this.isPlaying = true;
        this.animate();
    },

    createEnvironment: function() {
        const texLoader = new THREE.TextureLoader();
        // Texturas diferentes? Por enquanto usamos a mesma estrada
        texLoader.load('assets/estrada.jpg', (tex) => {
            tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1, 20);
            const mat = new THREE.MeshPhongMaterial({ map: tex });
            this.floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 200), mat);
            this.floor.rotation.x = -Math.PI / 2;
            this.floor.position.z = -80;
            this.floor.receiveShadow = true;
            this.scene.add(this.floor);
        }, undefined, () => {
            // Fallback cinza
            const mat = new THREE.MeshPhongMaterial({ color: 0x333333 });
            this.floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 200), mat);
            this.floor.rotation.x = -Math.PI / 2;
            this.floor.position.z = -80;
            this.scene.add(this.floor);
        });
    },

    loadMascot: function() {
        const loader = new THREE.GLTFLoader();
        const draco = new THREE.DRACOLoader();
        draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.5/');
        loader.setDRACOLoader(draco);

        loader.load('assets/mascote.glb', (gltf) => {
            this.mascot = gltf.scene;
            this.normalizeMascot();
            this.scene.add(this.mascot);
        }, undefined, () => {
            // Fallback Cube
            this.mascot = new THREE.Mesh(new THREE.BoxGeometry(1,2,1), new THREE.MeshNormalMaterial());
            this.normalizeMascot();
            this.scene.add(this.mascot);
        });
    },

    normalizeMascot: function() {
        const box = new THREE.Box3().setFromObject(this.mascot);
        const scale = 1.8 / box.getSize(new THREE.Vector3()).y;
        this.mascot.scale.setScalar(scale);
        this.mascot.position.set(0, 0, -2);
        this.mascot.rotation.y = Math.PI;
    },

    // --- LOOP LÓGICO PRINCIPAL ---
    update: function() {
        if (!this.isPlaying) return;
        InputSys.update();

        // Roteamento de Lógica por Modo
        if (this.config.mode === 'race') this.updateRaceMode();
        else if (this.config.mode === 'run') this.updateRunMode();
        else if (this.config.mode === 'dance') this.updateDanceMode();

        // Física Global (Chão)
        if (this.floor && this.floor.material.map) {
            this.floor.material.map.offset.y -= this.speed * 0.05;
        }

        // Movimento Global do Mascote (Lateral)
        if (this.mascot) {
            // No modo Run, o mascote fica mais centralizado
            let targetX = InputSys.axisX * 3.0;
            if(this.config.mode === 'run') targetX = 0; // Run é reto

            this.mascot.position.x += (targetX - this.mascot.position.x) * 0.15;
            this.mascot.rotation.z = -this.mascot.position.x * 0.1;
            this.mascot.rotation.y = Math.PI;
        }
    },

    // --- LÓGICA 1: RACE (Sobrevivência) ---
    updateRaceMode: function() {
        // Aceleração automática constante
        if (this.speed < 1.0) this.speed += 0.0005;
        
        // Pontuação por distância
        this.score += Math.round(this.speed * 2);
        
        // Spawn Inimigos (Cones Vermelhos)
        if (Math.random() < 0.02) this.spawnEntity('obstacle');
        
        this.manageEntities(true); // true = Game Over se bater
        this.updateUI();
    },

    // --- LÓGICA 2: RUN (Resistência Física) ---
    updateRunMode: function() {
        // Decaimento Rápido (Atrito)
        this.speed *= 0.96; 
        
        // Input de Ação (Tap ou Pulo) aumenta velocidade
        if (InputSys.isAction) {
            this.speed += 0.08;
            // Visual de pulo
            if(this.mascot && this.mascot.position.y < 0.5) this.mascot.position.y += 0.1;
        } else {
            // Gravidade
            if(this.mascot && this.mascot.position.y > 0) this.mascot.position.y -= 0.1;
        }

        // Limite
        this.speed = Math.min(this.speed, 1.5);
        if(this.speed < 0.01) this.speed = 0;

        // Pontuação baseada na velocidade mantida
        if(this.speed > 0.1) this.score += Math.round(this.speed * 5);
        
        // Sem obstáculos, apenas corrida contra a exaustão
        this.updateUI();
    },

    // --- LÓGICA 3: DANCE (Coleta Rítmica) ---
    updateDanceMode: function() {
        this.speed = 0.6; // Velocidade constante e confortável
        
        // Spawn Itens Bons (Orbes Azuis)
        if (Math.random() < 0.025) this.spawnEntity('collectible');
        
        this.manageEntities(false); // false = Não morre, apenas coleta
        this.updateUI();
    },

    updateUI: function() {
        const sEl = document.getElementById('score-val');
        if(sEl) sEl.innerText = this.score;
    },

    // --- GERENCIADOR DE OBJETOS ---
    spawnEntity: function(type) {
        let obj;
        if (type === 'obstacle') {
            const geo = new THREE.ConeGeometry(0.5, 1.5, 16);
            const mat = new THREE.MeshPhongMaterial({ color: 0xff0000 }); // Vermelho
            obj = new THREE.Mesh(geo, mat);
            obj.userData = { type: 'bad' };
            // Posições fixas: Esquerda, Meio, Direita
            const lanes = [-2.5, 0, 2.5];
            obj.position.set(lanes[Math.floor(Math.random()*3)], 0.75, -70);
        
        } else if (type === 'collectible') {
            const geo = new THREE.SphereGeometry(0.4);
            const mat = new THREE.MeshPhongMaterial({ color: 0x00ffff, emissive: 0x00ffff }); // Azul Neon
            obj = new THREE.Mesh(geo, mat);
            obj.userData = { type: 'good' };
            // Posição aleatória suave
            obj.position.set((Math.random()*6)-3, 1.5, -70);
        }

        this.scene.add(obj);
        this.entities.push(obj);
    },

    manageEntities: function(isDeadly) {
        for (let i = this.entities.length - 1; i >= 0; i--) {
            let e = this.entities[i];
            e.position.z += this.speed * 1.5; // Aproximação

            // Check Colisão
            if (this.mascot) {
                const dx = Math.abs(e.position.x - this.mascot.position.x);
                const dz = Math.abs(e.position.z - this.mascot.position.z);
                
                // Zona de colisão
                if (dz < 1.0 && dx < 0.9) {
                    if (e.userData.type === 'bad' && isDeadly) {
                        this.gameOver(); // Bateu no cone
                    } else if (e.userData.type === 'good') {
                        this.score += 500; // Pegou orbe
                        this.removeEntity(e, i);
                        this.flashScreen('#00ffff');
                    }
                }
            }

            // Remove se passou
            if (e.position.z > 5) this.removeEntity(e, i);
        }
    },

    removeEntity: function(e, index) {
        this.scene.remove(e);
        this.entities.splice(index, 1);
    },

    flashScreen: function(color) {
        // Efeito visual rápido (opcional)
    },

    gameOver: function() {
        this.isPlaying = false;
        const go = document.getElementById('game-over-screen');
        if(go) {
            go.classList.remove('hidden');
            document.getElementById('final-score').innerText = this.score;
        }
    },

    restart: function() {
        this.entities.forEach(e => this.scene.remove(e));
        this.entities = [];
        this.score = 0;
        this.speed = 0;
        document.getElementById('game-over-screen').classList.add('hidden');
        this.isPlaying = true;
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
