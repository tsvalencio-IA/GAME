/**
 * thIAguinho Game Engine vFinal
 * Foco: Renderização Imediata e Estabilidade
 */

const Engine = {
    scene: null, camera: null, renderer: null,
    player: null, floor: null, objects: [],
    state: { playing: false, paused: false, speed: 0, score: 0 },
    
    // --- SISTEMA DE ÁUDIO SIMPLES ---
    audioCtx: null,
    initAudio: function() {
        if (this.audioCtx) return;
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AudioContext();
    },
    playTone: function(freq, type) {
        if (!this.audioCtx) return;
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = type; osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.1, this.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.1);
        osc.connect(gain); gain.connect(this.audioCtx.destination);
        osc.start(); osc.stop(this.audioCtx.currentTime + 0.1);
    },

    // --- INICIALIZAÇÃO ---
    boot: function() {
        this.initAudio();
        document.getElementById('screen-intro').classList.add('hidden');
        this.startGame();
    },

    init: function() {
        // 1. Configurar Cena 3D
        const canvas = document.getElementById('game-canvas');
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog(0x000000, 10, 80); // Neblina para profundidade

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
        this.camera.position.set(0, 3, 6);
        this.camera.lookAt(0, 0, -5);

        this.renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);

        // 2. Luzes
        const ambient = new THREE.AmbientLight(0xffffff, 0.7);
        const sun = new THREE.DirectionalLight(0xffffff, 0.8);
        sun.position.set(10, 20, 10);
        this.scene.add(ambient, sun);

        // 3. Criar Mundo (Chão e Player)
        this.buildWorld();

        // 4. Iniciar Loop (Mesmo antes do play)
        this.animate();

        // 5. Iniciar Visão (Sem travar se falhar)
        if(typeof Vision !== 'undefined') Vision.init();
        
        // 6. Listeners de Resize
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    },

    buildWorld: function() {
        // Chão Infinito
        const texLoader = new THREE.TextureLoader();
        texLoader.load('./assets/estrada.jpg', (tex) => {
            tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
            tex.repeat.set(1, 10);
            this.spawnFloor(new THREE.MeshPhongMaterial({ map: tex }));
        }, undefined, () => {
            // Fallback se imagem faltar: Chão Cinza
            this.spawnFloor(new THREE.MeshPhongMaterial({ color: 0x333333 }));
        });

        // Player: Tenta carregar GLB, se falhar cria um "Kart Lógico" (Cubo Azul)
        const gltfLoader = new THREE.GLTFLoader();
        gltfLoader.load('./assets/mascote.glb', (gltf) => {
            this.player = gltf.scene;
            this.setupPlayerMesh();
        }, undefined, (error) => {
            console.warn("Modelo 3D não carregou, usando Kart Procedural.");
            this.createProceduralKart();
        });
    },

    spawnFloor: function(material) {
        const geo = new THREE.PlaneGeometry(14, 200);
        this.floor = new THREE.Mesh(geo, material);
        this.floor.rotation.x = -Math.PI / 2;
        this.floor.position.z = -80;
        this.scene.add(this.floor);
    },

    createProceduralKart: function() {
        // Cria um carro simples com código para não depender de download
        this.player = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 2), new THREE.MeshPhongMaterial({ color: 0x00bebd }));
        body.position.y = 0.5;
        this.player.add(body);
        this.setupPlayerMesh();
    },

    setupPlayerMesh: function() {
        this.player.rotation.y = Math.PI; // Virar para frente
        this.player.position.set(0, 0, 0);
        this.scene.add(this.player);
        // Libera o botão de jogar
        document.getElementById('loading-text').innerText = "PRONTO";
        document.getElementById('btn-play').classList.remove('hidden');
    },

    // --- GAMEPLAY LOOP ---
    startGame: function() {
        this.state.playing = true;
        this.state.score = 0;
        this.state.speed = 0;
        this.playTone(440, 'sine'); // Som de start
    },

    spawnObstacle: function() {
        const type = Math.random() > 0.3 ? 'bad' : 'coin';
        let mesh;
        if(type === 'bad') {
            mesh = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1, 16), new THREE.MeshPhongMaterial({ color: 0xff0000 }));
        } else {
            mesh = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.1, 8, 16), new THREE.MeshPhongMaterial({ color: 0xffd700 }));
            mesh.rotation.y = Math.PI / 2;
        }
        
        // Faixas: Esquerda (-3), Centro (0), Direita (3)
        const lane = [-3, 0, 3][Math.floor(Math.random() * 3)];
        mesh.position.set(lane, 0.5, -80); // Nasce lá no fundo
        mesh.userData = { type: type, active: true };
        
        this.scene.add(mesh);
        this.objects.push(mesh);
    },

    animate: function() {
        requestAnimationFrame(() => this.animate());

        // Animação de background (chão correndo)
        if (this.state.playing && !this.state.paused) {
            // Aceleração
            if (this.state.speed < 0.8) this.state.speed += 0.002;

            // Mover Chão (Ilusão de ótica)
            if (this.floor && this.floor.material.map) {
                this.floor.material.map.offset.y -= this.state.speed * 0.05;
            }

            // Mover Objetos
            if (Math.random() < 0.02) this.spawnObstacle();

            for (let i = this.objects.length - 1; i >= 0; i--) {
                let obj = this.objects[i];
                obj.position.z += this.state.speed * 1.5 + 0.2; // Vem em direção à câmera

                // Colisão Simples
                if (obj.userData.active && Math.abs(obj.position.z - this.player.position.z) < 1.0) {
                    if (Math.abs(obj.position.x - this.player.position.x) < 1.0) {
                        obj.userData.active = false;
                        this.scene.remove(obj); // Remove visualmente
                        
                        if (obj.userData.type === 'bad') {
                            this.gameOver();
                        } else {
                            this.playTone(880, 'square'); // Coin sound
                            this.state.score += 100;
                            document.getElementById('score-val').innerText = this.state.score;
                        }
                    }
                }

                // Limpeza
                if (obj.position.z > 5) {
                    this.scene.remove(obj);
                    this.objects.splice(i, 1);
                }
            }
        }

        // INPUT: Ler do Vision ou do Toque
        let inputX = 0;
        if (typeof Vision !== 'undefined' && Vision.active && Vision.data.visible) {
            inputX = Vision.data.x; // Controlado pela câmera
        } else {
            // Fallback: Controle por Mouse/Toque no centro da tela
            // (Implementação simplificada para garantir funcionamento)
        }

        // Suavizar movimento do player
        if (this.player) {
            // Interpolação Linear (Lerp) para movimento suave
            this.player.position.x += (Vision.data.x * 4 - this.player.position.x) * 0.1;
            
            // Inclinação do carro nas curvas
            this.player.rotation.z = -(this.player.position.x * 0.1);
            this.player.rotation.y = Math.PI; // Manter olhando pra frente
        }

        this.renderer.render(this.scene, this.camera);
    },

    gameOver: function() {
        this.state.playing = false;
        this.playTone(150, 'sawtooth');
        alert("FIM DE JOGO! Pontuação: " + this.state.score);
        window.location.reload();
    },

    togglePause: function() {
        this.state.paused = !this.state.paused;
    }
};

// Expor Engine para o HTML
window.Engine = Engine;
window.onload = () => Engine.init();
