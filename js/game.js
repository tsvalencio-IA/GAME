/**
 * thIAguinho Game Engine
 * Integra Three.js com os dados do Vision.js
 */

const Game = {
    mode: 'race', // 'race', 'run', 'dance'
    scene: null, camera: null, renderer: null,
    mascot: null, floor: null,
    
    // Entidades do Jogo
    obstacles: [],
    collectibles: [], // Para o modo Dance
    
    // Estado
    isPlaying: false,
    score: 0,
    speed: 0,
    laneX: 0, // Posição alvo do jogador
    
    init: function() {
        const params = new URLSearchParams(window.location.search);
        this.mode = params.get('mode') || 'race';
        
        console.log("Iniciando Modo:", this.mode);
        
        // 1. Setup Three.js
        this.setup3D();
        
        // 2. Setup Vision (Tracking)
        Vision.init(() => {
            document.getElementById('game-message').style.display = 'none';
            this.isPlaying = true;
            this.animate();
        });
    },

    setup3D: function() {
        // Canvas overlay
        const canvas = document.getElementById('output-canvas');
        
        this.scene = new THREE.Scene();
        // Não definimos background para ver o vídeo atrás
        
        // Luzes
        const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
        const dir = new THREE.DirectionalLight(0xffffff, 1.2);
        dir.position.set(5, 10, 7);
        dir.castShadow = true;
        this.scene.add(hemi, dir);

        // Câmera
        this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
        this.camera.position.set(0, 2, 5); // Atrás do boneco

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        // Chão (Diferente por modo)
        this.createEnvironment();
        
        // Mascote
        this.loadMascot();
    },

    createEnvironment: function() {
        // Textura infinita
        const tex = new THREE.TextureLoader().load('assets/estrada.jpg');
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(1, 10);
        
        const mat = new THREE.MeshPhongMaterial({ map: tex, transparent: true, opacity: 0.9 });
        this.floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 100), mat);
        this.floor.rotation.x = -Math.PI / 2;
        this.floor.position.z = -40;
        this.scene.add(this.floor);
    },

    loadMascot: function() {
        const loader = new THREE.GLTFLoader();
        const draco = new THREE.DRACOLoader();
        draco.setDecoderPath('https://www.jsdelivr.com/package/npm/three/examples/js/libs/draco/'); // Path genérico ou local
        // Fallback seguro para Draco CDN
        draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.5/');
        loader.setDRACOLoader(draco);

        loader.load('assets/mascote.glb', (gltf) => {
            this.mascot = gltf.scene;
            
            // Escala e posição inicial
            const box = new THREE.Box3().setFromObject(this.mascot);
            const scale = 1.8 / box.getSize(new THREE.Vector3()).y;
            this.mascot.scale.setScalar(scale);
            
            this.mascot.position.set(0, 0, -2);
            this.mascot.rotation.y = Math.PI; // Costas para câmera
            
            this.scene.add(this.mascot);
        }, undefined, (err) => {
            console.error("Erro loading model", err);
            // Cria um cubo se falhar
            const cube = new THREE.Mesh(new THREE.BoxGeometry(1,2,1), new THREE.MeshStandardMaterial({color:0xffcc00}));
            cube.position.set(0,1,-2);
            this.mascot = cube;
            this.scene.add(this.mascot);
        });
    },

    // --- GAME LOOP PRINCIPAL ---
    update: function() {
        if(!this.isPlaying) return;
        
        // 1. Ler dados da Visão Computacional
        const tracking = Vision.results;

        // LÓGICA ESPECÍFICA POR MODO
        
        if (this.mode === 'race') {
            // --- MODO RACE: Desviar ---
            this.speed = 0.5; // Velocidade constante
            
            // O X do tracking (-1 a 1) vira a posição X do boneco (-3 a 3)
            // Sensibilidade aumentada (x3)
            let targetX = tracking.x * 3.5;
            this.laneX = Math.max(-3, Math.min(3, targetX));
            
            // Spawn Obstáculos
            if (Math.random() < 0.02) this.spawnObstacle();

        } else if (this.mode === 'run') {
            // --- MODO RUN: Correr no lugar ---
            // A velocidade depende da "atividade" (quanto o ombro mexe)
            // Se activity > 0.5, speed aumenta. Senão, cai.
            if (tracking.activity > 0.05) {
                this.speed += 0.02;
            } else {
                this.speed *= 0.95;
            }
            this.speed = Math.min(this.speed, 1.5);
            
            // Centraliza o boneco
            this.laneX = 0;

        } else if (this.mode === 'dance') {
            // --- MODO DANCE: Coletar Orbes ---
            this.speed = 0.4;
            // O boneco segue o corpo
            this.laneX = tracking.x * 3;
            
            // Spawn Colecionáveis (Orbes)
            if (Math.random() < 0.03) this.spawnCollectible();
        }

        // 2. Aplicar Movimento ao Mascote
        if (this.mascot) {
            // Lerp para suavizar
            this.mascot.position.x += (this.laneX - this.mascot.position.x) * 0.2;
            
            // Animação de "pulo" ao correr
            if (this.speed > 0.1) {
                this.mascot.position.y = Math.abs(Math.sin(Date.now() * 0.01)) * 0.2;
            }
            
            // Inclinação nas curvas
            this.mascot.rotation.z = -this.mascot.position.x * 0.1;
            this.mascot.rotation.y = Math.PI;
        }

        // 3. Mover Chão
        if (this.floor) {
            this.floor.material.map.offset.y -= this.speed * 0.05;
        }

        // 4. Gerenciar Objetos (Inimigos/Itens)
        this.manageEntities();
        
        // 5. Score
        if (this.speed > 0) {
            this.score += Math.round(this.speed);
            document.getElementById('score-val').innerText = this.score;
        }
    },

    spawnObstacle: function() {
        const geo = new THREE.ConeGeometry(0.5, 1.5, 16);
        const mat = new THREE.MeshPhongMaterial({ color: 0xff0000 });
        const obj = new THREE.Mesh(geo, mat);
        
        // Posição aleatória na pista
        const lanes = [-2, 0, 2];
        const lane = lanes[Math.floor(Math.random() * lanes.length)];
        
        obj.position.set(lane, 0.75, -60); // Longe
        this.scene.add(obj);
        this.obstacles.push(obj);
    },

    spawnCollectible: function() {
        const geo = new THREE.SphereGeometry(0.4, 16, 16);
        const mat = new THREE.MeshPhongMaterial({ color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 0.5 });
        const obj = new THREE.Mesh(geo, mat);
        
        // Aleatório X
        const x = (Math.random() * 6) - 3;
        obj.position.set(x, 1.5, -60); // Mais alto (para pegar com a mão)
        this.scene.add(obj);
        this.collectibles.push(obj);
    },

    manageEntities: function() {
        // Mover Obstáculos
        for (let i = this.obstacles.length - 1; i >= 0; i--) {
            let obj = this.obstacles[i];
            obj.position.z += this.speed * 1.5; // Vêm em direção à câmera

            // Colisão (Simples Box Check)
            if (this.mascot) {
                const dx = Math.abs(obj.position.x - this.mascot.position.x);
                const dz = Math.abs(obj.position.z - this.mascot.position.z);
                
                if (dx < 0.8 && dz < 1.0) {
                    this.gameOver();
                }
            }

            if (obj.position.z > 5) {
                this.scene.remove(obj);
                this.obstacles.splice(i, 1);
            }
        }

        // Mover Colecionáveis (Dance Mode)
        for (let i = this.collectibles.length - 1; i >= 0; i--) {
            let obj = this.collectibles[i];
            obj.position.z += this.speed * 1.5;

            // Checar colisão com as mãos do Vision!
            const handL = Vision.results.hands.left;
            const handR = Vision.results.hands.right;
            
            // Projetar posição 3D do objeto para coordenada 2D aproximada?
            // Simplificação: Verificar proximidade X e Z com o mascote
            const dx = Math.abs(obj.position.x - this.mascot.position.x);
            const dz = Math.abs(obj.position.z - this.mascot.position.z);

            if (dx < 1.0 && dz < 1.0) {
                // Pegou!
                this.score += 500;
                this.scene.remove(obj);
                this.collectibles.splice(i, 1);
                // Feedback visual (flash) pode ser add aqui
            } else if (obj.position.z > 5) {
                this.scene.remove(obj);
                this.collectibles.splice(i, 1);
            }
        }
    },

    gameOver: function() {
        this.isPlaying = false;
        alert("GAME OVER! Pontuação: " + this.score);
        window.location.reload();
    },

    animate: function() {
        requestAnimationFrame(() => this.animate());
        this.update();
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }
};

// Iniciar
window.onload = () => Game.init();
