/**
 * NEO-WII Game Engine v25.0 (Golden Master)
 * Arquitetura: SPA / Loop Unificado / Three.js
 */

const Game = {
    mode: 'kart',
    state: 'BOOT', // BOOT, PLAY, PAUSE, OVER
    score: 0,
    speed: 0,
    
    // Three.js Core
    scene: null, camera: null, renderer: null,
    player: null, floor: null, objects: [],
    
    // Telemetria
    clock: new THREE.Clock(),

    init: function() {
        if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

        const params = new URLSearchParams(window.location.search);
        this.mode = params.get('mode') || 'kart';

        const config = {
            'kart': { t: 'TURBO KART', msg: 'Use o celular como volante.' },
            'run':  { t: 'MARATHON',  msg: 'Corra no lugar para mover.' },
            'zen':  { t: 'ZEN GLIDER',msg: 'Incline o corpo para flutuar.' }
        };
        const c = config[this.mode];
        document.getElementById('game-title').innerText = c.t;
        document.getElementById('boot-msg').innerText = c.msg;

        Vision.init();
        Input.init();

        this.setupGraphics();

        document.getElementById('btn-start').classList.remove('hidden');
    },

    setupGraphics: function() {
        const canvas = document.getElementById('game-canvas');
        this.renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x000000, 0.02);

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
        this.camera.position.set(0, 3, 6);
        this.camera.lookAt(0, 0, -4);

        const amb = new THREE.AmbientLight(0xffffff, 0.6);
        const dir = new THREE.DirectionalLight(0xffffff, 0.8);
        dir.position.set(5, 10, 7);
        this.scene.add(amb, dir);

        this.buildWorld();
    },

    buildWorld: function() {
        const texLoader = new THREE.TextureLoader();
        texLoader.load('./assets/estrada.jpg', (tex) => {
            tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
            tex.repeat.set(1, 20);
            this.spawnFloor(new THREE.MeshPhongMaterial({ map: tex }));
        }, null, () => {
            this.spawnFloor(new THREE.MeshPhongMaterial({ color: 0x222222 }));
        });

        const gltfLoader = new THREE.GLTFLoader();
        gltfLoader.load('./assets/mascote.glb', (gltf) => {
            this.player = gltf.scene;
            this.setupPlayerMesh();
        }, null, () => {
            this.player = new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 2), new THREE.MeshPhongMaterial({ color: 0x00bebd }));
            this.setupPlayerMesh();
        });
    },

    spawnFloor: function(mat) {
        this.floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 200), mat);
        this.floor.rotation.x = -Math.PI / 2;
        this.floor.position.z = -80;
        this.scene.add(this.floor);
    },

    setupPlayerMesh: function() {
        this.player.position.set(0, 0, 0);
        this.player.rotation.y = Math.PI; 
        this.scene.add(this.player);
    },

    // --- BOOT SEQUENCE ---
    startRequest: function() {
        Feedback.init();
        Feedback.sfx('start');

        if (this.mode === 'kart') {
            Input.requestTiltPermission().then(() => this.launch());
        } else {
            Vision.start().then(success => {
                if (success) {
                    // --- CORREÇÃO CRÍTICA: Nome correto da função ---
                    Vision.resetCalibration(); 
                    this.launch();
                } else {
                    alert("Câmera indisponível. Alternando para modo Toque.");
                    Input.source = 'TOUCH';
                    this.launch();
                }
            });
        }
    },

    launch: function() {
        document.getElementById('screen-boot').classList.add('hidden');
        document.getElementById('hud-layer').classList.remove('hidden');
        
        this.state = 'PLAY';
        this.score = 0;
        this.speed = 0;
        this.loop();
    },

    // --- MAIN GAME LOOP ---
    loop: function() {
        requestAnimationFrame(() => this.loop());
        const delta = this.clock.getDelta();

        if (this.state !== 'PLAY') return;

        Input.update(this.mode);

        if (this.mode === 'kart') this.logicKart(delta);
        else if (this.mode === 'run') this.logicRun(delta);
        else if (this.mode === 'zen') this.logicZen(delta);

        if (this.floor && this.floor.material.map) {
            this.floor.material.map.offset.y -= this.speed * 0.05;
        }

        if (this.player) {
            const targetX = Input.steering * 3.5;
            this.player.position.x += (targetX - this.player.position.x) * 0.1;
            this.player.rotation.z = -(this.player.position.x * 0.25);
            this.player.rotation.y = Math.PI;
            
            if (this.mode === 'zen') {
                this.player.position.y = 1 + Input.action * 1.5;
            }
        }

        this.manageObstacles();
        this.renderer.render(this.scene, this.camera);
    },

    logicKart: function(dt) {
        const targetSpeed = Input.throttle;
        this.speed += (targetSpeed - this.speed) * 0.02;
        this.score += Math.round(this.speed * 10);
    },

    logicRun: function(dt) {
        const targetSpeed = Input.throttle;
        this.speed += (targetSpeed - this.speed) * 0.05;
        if (this.speed > 1.2) this.speed = 1.2;
        if (this.speed < 0) this.speed = 0;
        this.score += Math.round(this.speed * 20);
    },

    logicZen: function(dt) {
        this.speed = 0.4;
        this.score += 1;
    },

    manageObstacles: function() {
        if (Math.random() < 0.02 && this.speed > 0.1) this.spawnObj();

        for (let i = this.objects.length - 1; i >= 0; i--) {
            let o = this.objects[i];
            o.position.z += this.speed * 1.5 + 0.2;

            if (o.visible && Math.abs(o.position.z - this.player.position.z) < 1.0) {
                if (Math.abs(o.position.x - this.player.position.x) < 1.0) {
                    if (o.userData.type === 'bad') {
                        if (this.mode !== 'zen') {
                            Feedback.sfx('crash');
                            Feedback.rumble('impact');
                            this.gameOver();
                        }
                    } else {
                        Feedback.sfx('coin');
                        Feedback.rumble('bump');
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
        document.getElementById('score-val').innerText = this.score;
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
        
        this.scene.add(mesh);
        this.objects.push(mesh);
    },

    togglePause: function(forceState) {
        if (typeof forceState !== 'undefined') this.state = forceState ? 'PAUSE' : 'PLAY';
        else this.state = (this.state === 'PLAY') ? 'PAUSE' : 'PLAY';

        const el = document.getElementById('screen-pause');
        if (this.state === 'PAUSE') el.classList.remove('hidden');
        else el.classList.add('hidden');
    },

    gameOver: function() {
        this.state = 'OVER';
        document.getElementById('final-score').innerText = this.score;
        document.getElementById('screen-over').classList.remove('hidden');
    }
};

window.onload = () => Game.init();
