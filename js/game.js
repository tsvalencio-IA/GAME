/**
 * thIAguinho Game Engine v24.0 (FIXED & COMPLETE)
 * Architecture: Nintendo Style AR (Passthrough)
 */

const AudioSys = {
    ctx: null,
    init: function() {
        window.AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();
    },
    play: function(type) {
        if(!this.ctx) return;
        if(this.ctx.state === 'suspended') this.ctx.resume();
        
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const t = this.ctx.currentTime;
        
        osc.connect(gain); 
        gain.connect(this.ctx.destination);
        
        if (type === 'start') {
            osc.frequency.setValueAtTime(440, t); 
            osc.frequency.exponentialRampToValueAtTime(880, t+0.4);
            gain.gain.setValueAtTime(0.1, t); 
            gain.gain.linearRampToValueAtTime(0, t+0.4);
            osc.type = 'sine';
            this.vibrate(50);
        } else if (type === 'coin') {
            osc.frequency.setValueAtTime(1200, t); 
            osc.frequency.linearRampToValueAtTime(1800, t+0.08);
            gain.gain.setValueAtTime(0.08, t); 
            gain.gain.linearRampToValueAtTime(0, t+0.08);
            osc.type = 'square';
        } else if (type === 'crash') {
            osc.frequency.setValueAtTime(150, t); 
            osc.frequency.exponentialRampToValueAtTime(10, t+0.4);
            gain.gain.setValueAtTime(0.2, t); 
            gain.gain.exponentialRampToValueAtTime(0.01, t+0.4);
            osc.type = 'sawtooth';
            this.vibrate([30, 50, 30]);
        }
        osc.start(); 
        osc.stop(t + 0.5);
    },
    vibrate: function(pattern) {
        if (navigator.vibrate) navigator.vibrate(pattern);
    }
};

const Input = {
    x: 0, y: 0, 
    lastY: 0, lastTime: 0,
    velocityY: 0,
    source: 'TOUCH',

    init: function() {
        const zone = document.getElementById('touch-controls');
        if(zone) {
            zone.addEventListener('touchmove', (e) => {
                e.preventDefault();
                this.source = 'TOUCH';
                // Mapeia toque: Centro da tela = 0
                this.x = ((e.touches[0].clientX / window.innerWidth) - 0.5) * 3.0;
            }, {passive: false});
            
            zone.addEventListener('touchend', () => { 
                if(this.source==='TOUCH') this.x = 0; 
            });
        }
        
        // Tilt Setup (Permissão é pedida no Boot do Game)
        window.addEventListener('deviceorientation', (e) => {
            if(this.source === 'TOUCH') return;
            // Se o modo for CAM, a câmera sobrepõe o tilt
            if(this.source === 'CAM') return;
            
            this.source = 'TILT';
            this.x = (e.gamma || 0) / 20;
        });
        
        this.lastTime = Date.now();
    },

    // --- CORREÇÃO 2: forceMode EXISTENTE ---
    forceMode: function(mode) {
        this.source = mode;
        console.log("Input Mode Forçado:", mode);
        
        if(mode === 'CAM') {
            Vision.start().catch(console.error);
        } else {
            Vision.stop();
        }
        
        // Fecha o menu de pause ao selecionar
        Game.togglePause(false);
    },

    update: function(mode) {
        // Prioridade: Câmera > Tilt > Toque (se Câmera estiver ativa e detectando)
        if (Vision.active && Vision.data.presence) {
            this.source = 'CAM';
            
            // Smoothing Dinâmico
            const lerp = (mode === 'zen') ? 0.05 : 0.2;
            this.x += (Vision.data.x - this.x) * lerp;
            this.y += (Vision.data.y - this.y) * lerp;

            // Física de Esforço (Delta Y) para modo Run
            const now = Date.now();
            const dt = now - this.lastTime;
            
            if (dt > 60) { 
                const rawDelta = Math.abs(Vision.raw.y - this.lastY);
                const effectiveDelta = (rawDelta > 0.03) ? rawDelta : 0;
                
                // Ease-Out Curve (Esforço não linear)
                const effort = Math.min(1.0, effectiveDelta * 5); 
                const curvedEffort = 1 - Math.pow(1 - effort, 2);
                
                this.velocityY = curvedEffort * 1.5; 
                this.lastY = Vision.raw.y;
                this.lastTime = now;
            }
        } else {
            // Fallback físico
            this.x = Math.max(-1.5, Math.min(1.5, this.x));
            this.velocityY = 0.5; // Auto-run se não tiver câmera
        }
    }
};

const Game = {
    mode: 'kart',
    running: false, paused: false,
    score: 0, speed: 0,
    scene: null, camera: null, renderer: null,
    player: null, floor: null, objects: [],
    
    // Telemetria
    debugClickCount: 0,
    fps: 0, frames: 0, lastFpsTime: 0,

    // --- CORREÇÃO 1: INIT COMPLETO E SEGURO ---
    init: function() {
        // PWA Check
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js').catch(e => console.log("SW Error:", e));
        }

        const p = new URLSearchParams(window.location.search);
        this.mode = p.get('mode') || 'kart';
        
        // Configuração de Títulos
        const config = { 
            'kart': { t: 'TURBO KART', msg: 'Use o celular como volante' }, 
            'run':  { t: 'MARATHON',  msg: 'Corra no lugar (Pule/Agache)' }, 
            'zen':  { t: 'ZEN GLIDER',msg: 'Incline a cabeça para flutuar' } 
        };
        
        const modeConfig = config[this.mode] || config['kart'];
        
        const titleEl = document.getElementById('game-title');
        if(titleEl) titleEl.innerText = modeConfig.t;
        
        const msgEl = document.getElementById('boot-msg');
        if(msgEl) msgEl.innerText = modeConfig.msg;
        
        // Inicializa Vision (mas não liga câmera ainda)
        if(typeof Vision !== 'undefined') Vision.init();
        
        // Botão Play aparece
        const btn = document.getElementById('btn-start');
        if(btn) btn.classList.remove('hidden');
        
        // Debug Secret
        const scoreBoard = document.querySelector('.score-board');
        if(scoreBoard) {
            scoreBoard.addEventListener('click', () => {
                this.debugClickCount++;
                if(this.debugClickCount === 5) this.toggleDebug();
            });
        }

        this.setup3D();
        this.lastFpsTime = performance.now();
    },

    setup3D: function() {
        const cvs = document.getElementById('game-canvas');
        // ALPHA: TRUE é crucial para o AR funcionar (fundo transparente)
        this.renderer = new THREE.WebGLRenderer({ canvas:cvs, alpha:true, antialias:true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x000000, 0); // Transparente!

        this.scene = new THREE.Scene();
        // Neblina para profundidade
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
        // Carrega Textura ou usa Cor Sólida
        texLoader.load('./assets/estrada.jpg', (tex) => {
            tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
            tex.repeat.set(1, 20);
            this.spawnFloor(new THREE.MeshPhongMaterial({map:tex}));
        }, null, () => {
            this.spawnFloor(new THREE.MeshPhongMaterial({color:0x333}));
        });

        // Carrega Modelo ou usa Cubo
        const loader = new THREE.GLTFLoader();
        loader.load('./assets/mascote.glb', (gltf) => {
            this.player = gltf.scene;
            this.setupPlayer();
        }, null, () => {
            this.player = new THREE.Mesh(new THREE.BoxGeometry(1,0.5,2), new THREE.MeshPhongMaterial({color:0x00bebd}));
            this.setupPlayer();
        });
    },

    spawnFloor: function(mat) {
        // Plano da estrada
        this.floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 200), mat);
        this.floor.rotation.x = -Math.PI/2; 
        this.floor.position.z = -80;
        this.scene.add(this.floor);
    },

    setupPlayer: function() {
        this.player.position.set(0, 0, 0);
        this.player.rotation.y = Math.PI;
        this.scene.add(this.player);
    },

    startRequest: function() {
        // Desbloqueia Audio e Contextos
        AudioSys.init();
        AudioSys.play('start');
        Input.init();

        // Permissão iOS Tilt
        if (this.mode === 'kart' && typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            DeviceOrientationEvent.requestPermission().catch(console.warn);
        }

        if (this.mode === 'kart') {
            this.finishBoot();
        } else {
            // Modos de Câmera (Run/Zen)
            Vision.start().then(ok => {
                if(ok) {
                    Vision.calibrate(); 
                    this.finishBoot();
                } else {
                    alert("Câmera indisponível. Alternando para Toque.");
                    Input.source = 'TOUCH';
                    this.finishBoot();
                }
            });
        }
    },

    finishBoot: function() {
        const bootScreen = document.getElementById('screen-boot');
        if(bootScreen) bootScreen.classList.add('hidden');
        
        const hud = document.getElementById('hud-layer');
        if(hud) hud.classList.remove('hidden');
        
        this.running = true;
        this.animate();
    },

    animate: function() {
        requestAnimationFrame(() => this.animate());
        if(!this.running || this.paused) return;

        // FPS Calc
        const now = performance.now();
        this.frames++;
        if (now >= this.lastFpsTime + 1000) {
            this.fps = this.frames;
            this.frames = 0;
            this.lastFpsTime = now;
        }

        Input.update(this.mode);

        // State Machine dos Modos
        if(this.mode === 'kart') this.updateKart();
        else if(this.mode === 'run') this.updateRun();
        else if(this.mode === 'zen') this.updateZen();

        // Movimento do Chão
        if(this.floor && this.floor.material.map) {
            this.floor.material.map.offset.y -= this.speed * 0.05;
        }

        this.renderPhysics();
        this.manageObstacles();
        this.updateTelemetry();
        
        this.renderer.render(this.scene, this.camera);
    },

    updateKart: function() {
        // Aceleração constante
        if(this.speed < 1.0) this.speed += 0.005;
        this.score += Math.round(this.speed * 10);
    },

    updateRun: function() {
        // Velocidade baseada no esforço físico
        const target = Input.velocityY; 
        this.speed += (target - this.speed) * 0.05; // Lerp
        
        // Clamps
        if(this.speed > 1.2) this.speed = 1.2;
        if(this.speed < 0.0) this.speed = 0.0;
        
        this.score += Math.round(this.speed * 20);
    },

    updateZen: function() {
        // Velocidade calma constante
        this.speed = 0.4;
        this.score += 1;
        
        // Flutuação Zen (Senoide + Input Y)
        if(this.player) {
            const bias = 1.0 + (Input.y * 1.5);
            const breathe = Math.sin(Date.now() / 800) * 0.2; 
            this.player.position.y += ((bias + breathe) - this.player.position.y) * 0.05;
        }
    },

    renderPhysics: function() {
        if(!this.player) return;
        
        // Movimento Lateral
        const targetX = Input.x * 3.5;
        this.player.position.x += (targetX - this.player.position.x) * 0.1;
        
        // Inclinação Visual (Banking)
        this.player.rotation.z = -(this.player.position.x * 0.2); 
        this.player.rotation.y = Math.PI;
    },

    manageObstacles: function() {
        // Spawn Aleatório
        if(Math.random() < 0.02 && this.speed > 0.2) this.spawnObj();

        for(let i=this.objects.length-1; i>=0; i--) {
            let o = this.objects[i];
            o.position.z += this.speed * 1.5 + 0.2;

            // Colisão
            if(o.visible && Math.abs(o.position.z - this.player.position.z) < 1.0) {
                if(Math.abs(o.position.x - this.player.position.x) < 1.2) {
                    if(o.userData.type === 'bad') {
                        if(this.mode !== 'zen') { 
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
            // Limpeza
            if(o.position.z > 5) { 
                this.scene.remove(o); 
                this.objects.splice(i,1); 
            }
        }
        
        const scoreEl = document.getElementById('score-val');
        if(scoreEl) scoreEl.innerText = this.score;
    },

    spawnObj: function() {
        const isBad = Math.random() > 0.3;
        const geo = isBad ? new THREE.ConeGeometry(0.5, 1, 16) : new THREE.TorusGeometry(0.4, 0.1, 8, 16);
        const mat = new THREE.MeshPhongMaterial({color: isBad ? 0xff4444 : 0xffd700});
        const mesh = new THREE.Mesh(geo, mat);
        
        mesh.rotation.x = isBad ? 0 : Math.PI/2;
        mesh.position.set([-2.5, 0, 2.5][Math.floor(Math.random()*3)], 0.5, -80);
        mesh.userData = {type: isBad ? 'bad' : 'good'};
        this.scene.add(mesh); 
        this.objects.push(mesh);
    },

    togglePause: function(forceState) {
        if (typeof forceState !== 'undefined') {
            this.paused = forceState;
        } else {
            this.paused = !this.paused;
        }
        
        const s = document.getElementById('screen-pause');
        if(s) {
            if(this.paused) s.classList.remove('hidden'); 
            else s.classList.add('hidden');
        }
    },

    gameOver: function() {
        this.running = false;
        const finalScoreEl = document.getElementById('final-score');
        if(finalScoreEl) finalScoreEl.innerText = this.score;
        
        const overScreen = document.getElementById('screen-over');
        if(overScreen) overScreen.classList.remove('hidden');
    },

    toggleDebug: function() {
        this.debugMode = !this.debugMode;
        let d = document.getElementById('debug-overlay');
        if(!d) {
            d = document.createElement('div');
            d.id = 'debug-overlay';
            d.style.cssText = "position:absolute; top:80px; left:10px; color:#0f0; font-family:monospace; font-size:12px; background:rgba(0,0,0,0.8); padding:10px; pointer-events:none; z-index:100;";
            document.body.appendChild(d);
        }
        d.style.display = this.debugMode ? 'block' : 'none';
    },

    updateTelemetry: function() {
        if(!this.debugMode) return;
        const d = document.getElementById('debug-overlay');
        if(d) {
            d.innerHTML = `
                MODE: ${this.mode.toUpperCase()}<br>
                SRC: ${Input.source}<br>
                FPS: ${this.fps}<br>
                X: ${Input.x.toFixed(2)}<br>
                V: ${Input.velocityY.toFixed(2)}
            `;
        }
    }
};

window.onload = () => Game.init();