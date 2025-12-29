/**
 * thIAguinho Game Engine v9.3 — "Nintendo Spirit"
 * Objetivo: Fazer o jogador sorrir ao abrir, vibrar ao tocar, e se emocionar ao jogar.
 */

// === SOUND SYSTEM ===
const AudioSys = {
    ctx: null,
    init() {
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) { console.warn("Web Audio não disponível"); }
    },
    play(freq, type, time, vol = 0.1, decay = 0.3) {
        if (!this.ctx) this.init();
        if (this.ctx?.state === 'suspended') this.ctx.resume();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(vol, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + decay);
        osc.connect(gain).connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + decay);
    },
    sfx: {
        coin: () => AudioSys.play(1800 + Math.random() * 600, 'sine', 0.1, 0.12, 0.15),
        crash: () => {
            AudioSys.play(120, 'sawtooth', 0.4, 0.3, 0.6);
            AudioSys.play(60, 'sine', 0.4, 0.2, 0.8);
        },
        start: () => {
            AudioSys.play(500, 'square', 0.2, 0.2, 0.25);
            setTimeout(() => AudioSys.play(800, 'square', 0.2, 0.2, 0.25), 100);
        },
        combo: (level) => AudioSys.play(900 + level * 150, 'sine', 0.15, 0.15, 0.2),
        whoosh: () => AudioSys.play(300, 'triangle', 0.2, 0.05, 0.3)
    }
};

// === VISUAL FEEDBACK SYSTEM ===
const FX = {
    create(pos, type) {
        const el = document.createElement('div');
        el.style.position = 'absolute';
        el.style.left = (pos.x * 50 + 50) + '%';
        el.style.top = (100 - (pos.y * 50 + 50)) + '%';
        el.style.transform = 'translate(-50%, -50%)';
        el.style.pointerEvents = 'none';
        el.style.zIndex = '30';
        el.style.fontWeight = 'bold';
        el.style.textShadow = '0 0 8px currentColor';
        el.style.fontSize = '28px';
        el.style.opacity = '1';
        el.style.transition = 'opacity 0.8s, transform 0.8s';
        document.getElementById('hud-layer').appendChild(el);

        if (type === 'coin') {
            el.textContent = '+500';
            el.style.color = '#FFD700';
            el.style.fontSize = '32px';
            el.style.transform = 'translate(-50%, -50%) scale(1.2)';
        } else if (type === 'combo') {
            el.textContent = `x${Combo.count}!`;
            el.style.color = '#FF5722';
            el.style.fontSize = '40px';
            el.style.transform = 'translate(-50%, -50%) scale(1.5)';
        }

        setTimeout(() => {
            el.style.opacity = '0';
            el.style.transform = `translate(-50%, -100%) scale(0.5)`;
        }, 100);

        setTimeout(() => el.remove(), 900);
    }
};

// === COMBO SYSTEM ===
const Combo = {
    count: 0,
    timer: null,
    add() {
        this.count++;
        FX.create({x: 0, y: 0}, 'combo');
        AudioSys.sfx.combo(Math.min(this.count, 5));
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.reset(), 1000);
    },
    reset() {
        this.count = 0;
    }
};

// === PARTICLE SYSTEM ===
const Particles = {
    list: [],
    create(pos, color, count = 10, direction = new THREE.Vector3(0, 1, 0)) {
        for (let i = 0; i < count; i++) {
            const speed = 0.8 + Math.random() * 1.2;
            const p = {
                pos: new THREE.Vector3().copy(pos),
                vel: new THREE.Vector3(
                    (Math.random() - 0.5) * 1.5 + direction.x * 2,
                    Math.random() * 1.5 + direction.y * 2,
                    (Math.random() - 0.5) * 0.5 + direction.z * 0.5
                ).multiplyScalar(speed),
                color: color,
                size: 0.03 + Math.random() * 0.04,
                life: 1.0,
                decay: 0.02
            };
            this.list.push(p);
        }
    },
    update(scene) {
        for (let i = this.list.length - 1; i >= 0; i--) {
            const p = this.list[i];
            p.life -= p.decay;
            if (p.life <= 0) {
                this.list.splice(i, 1);
                continue;
            }

            p.pos.add(p.vel.clone().multiplyScalar(Engine.delta));
            p.vel.y -= Engine.delta * 20;
            p.vel.multiplyScalar(0.98);

            const material = new THREE.MeshBasicMaterial({
                color: p.color,
                transparent: true,
                opacity: p.life * 0.9,
                depthWrite: false
            });
            const geo = new THREE.SphereGeometry(p.size * (0.5 + p.life), 4, 4);
            const mesh = new THREE.Mesh(geo, material);
            mesh.position.copy(p.pos);
            scene.add(mesh);
            setTimeout(() => scene.remove(mesh), 16);
        }
    }
};

// === INPUT SYSTEM ===
const Input = {
    mode: 'TOUCH',
    x: 0,
    action: false,
    init() {
        const zone = document.getElementById('touch-controls');
        if (zone) {
            zone.addEventListener('touchstart', (e) => {
                if (this.mode !== 'TOUCH') return;
                e.preventDefault();
                this.action = true;
                AudioSys.sfx.whoosh();
            }, { passive: false });
            zone.addEventListener('touchmove', (e) => {
                if (this.mode !== 'TOUCH') return;
                e.preventDefault();
                this.x = (e.touches[0].clientX / window.innerWidth - 0.5) * 3;
            }, { passive: false });
            zone.addEventListener('touchend', () => this.action = false);
        }
        window.addEventListener('deviceorientation', e => {
            if (this.mode === 'TILT') this.x = (e.gamma || 0) / 20;
        });
        if (typeof Vision !== 'undefined') Vision.setup('input-video', 'camera-feed');
    },
    setMode(m) {
        this.mode = m;
        const zone = document.getElementById('touch-controls');
        const cam = document.getElementById('camera-feed');
        if (m === 'TOUCH') {
            zone?.classList.remove('hidden');
            cam && (cam.style.opacity = '0');
            Vision.stop();
        } else if (m === 'BODY') {
            zone?.classList.add('hidden');
            Engine.setScreen('screen-calibration');
            Vision.start().then(() => {
                const iv = setInterval(() => {
                    if (Vision.data.gesture === 'T-POSE') {
                        clearInterval(iv);
                        Engine.setScreen(null);
                        AudioSys.sfx.start();
                        Engine.toast("PRONTO!");
                    }
                }, 300);
            }).catch(() => { alert("Câmera negada. Usando toque."); this.setMode('TOUCH'); });
        } else {
            zone?.classList.add('hidden');
            cam && (cam.style.opacity = '0');
            Vision.stop();
            if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
                DeviceOrientationEvent.requestPermission();
            }
        }
    },
    update() {
        if (this.mode === 'BODY' && Vision.active) this.x = Vision.data.x;
        this.x = Math.max(-1.8, Math.min(1.8, this.x));
    }
};

// === ENGINE PRINCIPAL ===
const Engine = {
    mode: 'kart',
    scene: null,
    camera: null,
    renderer: null,
    mascot: null,
    floor: null,
    objects: [],
    state: { playing: false, paused: false, speed: 0, score: 0, time: 0 },
    mascotBox: null,
    lastFrame: 0,
    delta: 0,

    init() {
        const p = new URLSearchParams(window.location.search);
        this.mode = p.get('mode') || 'kart';
        Input.init();
        if (['run', 'zen'].includes(this.mode)) Input.setMode('BODY');
        else Input.setMode('TOUCH');
        this.initGraphics();
    },

    initGraphics() {
        const cvs = document.getElementById('game-canvas');
        this.renderer = new THREE.WebGLRenderer({ canvas: cvs, alpha: true, antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x88ccff);
        this.scene.fog = new THREE.Fog(0x88ccff, 15, 70);

        this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);
        this.camera.position.set(0, 2.5, 5);
        this.camera.lookAt(0, 0, -10);

        const hemi = new THREE.HemisphereLight(0xffffff, 0x66aaff, 1.2);
        const sun = new THREE.DirectionalLight(0xffeeaa, 1.3);
        sun.position.set(10, 15, 5);
        sun.castShadow = true;
        sun.shadow.mapSize.set(1024, 1024);
        this.scene.add(hemi, sun);

        this.createEnvironment();
        this.loadMascot();
    },

    createEnvironment() {
        const geo = new THREE.PlaneGeometry(15, 300);
        const mat = new THREE.MeshPhongMaterial({ color: 0x336699, shininess: 80 });
        this.floor = new THREE.Mesh(geo, mat);
        this.floor.rotation.x = -Math.PI / 2;
        this.floor.position.z = -100;
        this.floor.receiveShadow = true;
        this.scene.add(this.floor);
    },

    loadMascot() {
        const loader = new THREE.GLTFLoader();
        loader.load('assets/mascote.glb', gltf => {
            this.mascot = gltf.scene;
            this.mascot.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
            this.scene.add(this.mascot);
            this.startGame();
        }, undefined, () => {
            // Fallback visualmente atraente
            const geo = new THREE.CapsuleGeometry(0.4, 0.8, 4, 8);
            const mat = new THREE.MeshStandardMaterial({ color: 0xff5722, metalness: 0.2, roughness: 0.3 });
            this.mascot = new THREE.Mesh(geo, mat);
            this.mascot.castShadow = true;
            this.scene.add(this.mascot);
            this.startGame();
        });
    },

    startGame() {
        this.state = { playing: true, paused: false, speed: 0.4, score: 0, time: 0 };
        Combo.reset();
        document.getElementById('screen-loading')?.classList.add('hidden');
        AudioSys.sfx.start();
        this.lastFrame = performance.now();
        this.animate();
    },

    animate(now) {
        requestAnimationFrame(this.animate.bind(this));
        if (!this.state.playing || this.state.paused) return;

        this.delta = Math.min((now - this.lastFrame) / 1000, 0.1);
        this.lastFrame = now;
        this.state.time += this.delta;

        Input.update();
        this.updateGameLogic();
        this.updateMascot();
        this.updateEnvironment();
        Particles.update(this.scene);
        this.renderer.render(this.scene, this.camera);
    },

    updateGameLogic() {
        if (this.mode === 'kart') {
            this.state.speed = 0.4 + this.state.time * 0.08;
            this.state.score += Math.floor(this.state.speed * 10);
            if (Math.random() < 0.02 + this.state.time * 0.001) this.spawn('obstacle');
            if (Math.random() < 0.015 + this.state.time * 0.0008) this.spawn('coin');
            this.manage(true);
        } else if (this.mode === 'run') {
            if (Input.action) this.state.speed = Math.min(this.state.speed + 0.3 * this.delta, 2.5);
            else this.state.speed *= 0.92;
            this.state.score += Math.floor(this.state.speed * 30 * this.delta);
            this.manage(false);
        } else {
            this.state.speed = 0.7;
            if (Math.random() < 0.04) this.spawn('coin');
            this.manage(false);
        }
        this.updateHUD();
    },

    updateMascot() {
        if (!this.mascot) return;
        const targetX = Input.x * 1.8;
        this.mascot.position.x += (targetX - this.mascot.position.x) * (8 * this.delta);
        this.mascot.rotation.z = -this.mascot.position.x * 0.4;
        this.mascot.rotation.y = Math.PI;

        // Squash & stretch visual (sutil)
        const speedFactor = Math.min(this.state.speed / 2, 1);
        this.mascot.scale.y = 1 - speedFactor * 0.15;
        this.mascot.scale.z = 1 + speedFactor * 0.15;

        // Atualiza caixa de colisão
        if (!this.mascotBox) this.mascotBox = new THREE.Box3();
        this.mascotBox.setFromObject(this.mascot);
        this.mascotBox.min.x -= 0.3;
        this.mascotBox.max.x += 0.3;
        this.mascotBox.min.z -= 0.4;
        this.mascotBox.max.z += 0.2;
    },

    updateEnvironment() {
        if (this.floor) this.floor.position.z = -100 + (this.state.time * this.state.speed * 40) % 300;
    },

    spawn(type) {
        const mesh = type === 'obstacle'
            ? new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.2, 8), new THREE.MeshStandardMaterial({ color: 0xff3366, emissive: 0x440022 }))
            : new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.15, 12, 24), new THREE.MeshStandardMaterial({ color: 0xffd700, emissive: 0x664400, metalness: 0.8 }));
        
        mesh.position.set([-3, 0, 3][Math.floor(Math.random() * 3)], type === 'obstacle' ? 0.6 : 0.5, -60);
        mesh.castShadow = true;
        mesh.userData = { type, bbox: new THREE.Box3().setFromObject(mesh) };
        this.scene.add(mesh);
        this.objects.push(mesh);
    },

    manage(deadly) {
        for (let i = this.objects.length - 1; i >= 0; i--) {
            const obj = this.objects[i];
            obj.position.z += this.state.speed * 2.5;
            if (obj.userData.type === 'coin') obj.rotation.x += 0.2;

            const objBox = obj.userData.bbox.clone().translate(obj.position);
            if (this.mascotBox?.intersectsBox(objBox)) {
                if (obj.userData.type === 'obstacle' && deadly) {
                    this.crash(obj.position);
                } else if (obj.userData.type === 'coin') {
                    this.collect(obj.position);
                    this.scene.remove(obj);
                    this.objects.splice(i, 1);
                }
            } else if (obj.position.z > 10) {
                this.scene.remove(obj);
                this.objects.splice(i, 1);
            }
        }
    },

    collect(pos) {
        this.state.score += 500 + Combo.count * 100;
        Combo.add();
        FX.create({ x: (pos.x / 5), y: (pos.z / 20) }, 'coin');
        Particles.create(pos, 0xffee00, 16, new THREE.Vector3(0, 1, 1));
        AudioSys.sfx.coin();
    },

    crash(pos) {
        AudioSys.sfx.crash();
        Particles.create(pos, 0xff3366, 25, new THREE.Vector3(0, 1, 2));
        this.gameOver();
    },

    updateHUD() {
        const el = document.getElementById('score-display');
        if (el) el.textContent = this.state.score.toLocaleString('pt-BR');
    },

    toast(msg) {
        const t = document.getElementById('toast');
        if (t) {
            t.textContent = msg;
            t.classList.remove('hidden');
            setTimeout(() => t.classList.add('hidden'), 800);
        }
    },

    togglePause() {
        this.state.paused = !this.state.paused;
        Combo.reset();
        const s = document.getElementById('screen-pause');
        s?.classList.toggle('hidden', !this.state.paused);
    },

    setScreen(id) {
        document.querySelectorAll('.modal-overlay').forEach(el => el.classList.add('hidden'));
        if (id) document.getElementById(id)?.classList.remove('hidden');
    },

    gameOver() {
        this.state.playing = false;
        const final = document.getElementById('final-score');
        if (final) final.textContent = this.state.score.toLocaleString('pt-BR');
        this.setScreen('screen-gameover');
    },

    restart() {
        this.objects.forEach(o => this.scene.remove(o));
        this.objects = [];
        this.setScreen(null);
        this.startGame();
    }
};

window.onload = () => Engine.init();