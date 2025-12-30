/**
 * NEO-WII GAME ENGINE v42.0 (COMMERCIAL GRADE)
 * Physics: Newtonian Integration + Grip Simulation + Rhythm Analysis
 * Audio: Procedural DSP
 */

const Game = {
    mode: 'kart', 
    state: 'BOOT', 
    score: 0,
    clock: new THREE.Clock(),
    
    // --- ESTADO FÍSICO CENTRAL ---
    phy: {
        pos: { x:0, y:0, z:0 }, // Posição Mundo
        vel: { x:0, y:0, z:0 }, // Velocidade Linear
        acc: { x:0, y:0, z:0 }, // Aceleração
        rot: { y:0, z:0 },      // Heading (Y) e Roll (Z)
        grip: 1.0,              // Aderência (Kart)
        rpm: 0,                 // Rotação Motor (Audio)
        fatigue: 0              // Cansaço (Run)
    },

    // Variáveis de Gameplay
    combo: 0,
    zoneTimer: 0,
    offRoad: false,
    
    // Zen Buffer
    zenHistory: [],

    // Render
    scene: null, camera: null, renderer: null, 
    player: null, avatarMesh: null, floor: null, objects: [],
    
    init: function() {
        const p = new URLSearchParams(window.location.search);
        this.mode = p.get('mode') || 'kart';
        
        this.setup3D();
        this.setupUI();
        
        // Audio Init (Wait for interaction)
        document.body.addEventListener('click', () => AudioSys.init(), {once:true});
        
        this.loop();
    },

    setupUI: function() {
        const t = document.getElementById('game-title');
        const m = document.getElementById('boot-msg');
        if(this.mode === 'kart') { t.innerText = "TURBO KART"; m.innerText = "Incline para Dirigir"; }
        if(this.mode === 'run')  { t.innerText = "MARATHON"; m.innerText = "Ritmo Constante"; }
        if(this.mode === 'zen')  { t.innerText = "REFLEXIVE"; m.innerText = "Flua com o Avatar"; }
        
        document.getElementById('screen-boot').classList.remove('hidden');
        document.getElementById('btn-start').onclick = () => this.startGame();
    },

    setup3D: function() {
        const cvs = document.getElementById('game-canvas');
        this.renderer = new THREE.WebGLRenderer({ canvas: cvs, alpha: true, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        
        this.scene = new THREE.Scene();
        // Fog atmosférico para profundidade
        const fogCol = this.mode === 'run' ? 0x203040 : (this.mode==='zen'?0x110022:0x111111);
        this.scene.fog = new THREE.FogExp2(fogCol, 0.015);
        this.renderer.setClearColor(fogCol);

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 100);
        this.camera.position.set(0, 2, 5);

        // Luzes "Hero"
        const amb = new THREE.AmbientLight(0xffffff, 0.6);
        const dir = new THREE.DirectionalLight(0xffffff, 1);
        dir.position.set(5, 10, 5);
        this.scene.add(amb, dir);

        this.createWorld();
    },

    createWorld: function() {
        // Chão Infinito (Textura em Loop)
        const texLoader = new THREE.TextureLoader();
        texLoader.load('./assets/estrada.jpg', (tex) => {
            tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
            tex.repeat.set(1, 20);
            const mat = new THREE.MeshPhongMaterial({ map: tex });
            this.floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 200), mat);
            this.floor.rotation.x = -Math.PI/2;
            this.floor.position.z = -80;
            this.scene.add(this.floor);
        });
        
        this.createAvatar();
    },

    createAvatar: function() {
        this.player = new THREE.Group();
        this.scene.add(this.player);

        let geo, mat;
        if (this.mode === 'kart') {
            geo = new THREE.BoxGeometry(1.4, 0.4, 2.2);
            mat = new THREE.MeshPhongMaterial({ color: 0x00bebd, shininess: 100 });
        } else {
            geo = new THREE.CylinderGeometry(0.3, 0.1, 1.5, 8);
            mat = new THREE.MeshPhongMaterial({ color: 0xffaa00 });
        }
        
        this.avatarMesh = new THREE.Mesh(geo, mat);
        this.avatarMesh.position.y = 0.5;
        this.player.add(this.avatarMesh);
    },

    startGame: function() {
        document.getElementById('screen-boot').classList.add('hidden');
        document.getElementById('hud-layer').classList.remove('hidden');
        AudioSys.startDrone(this.mode);
        AudioSys.play('start');
        this.state = 'PLAY';
        
        // Reset Física
        this.phy = { pos:{x:0,y:0,z:0}, vel:{x:0,y:0,z:0}, acc:{x:0,y:0,z:0}, rot:{y:0,z:0}, grip:1, rpm:0 };
        this.score = 0;
        
        if(this.mode !== 'zen') this.spawnObject();
    },

    // --- CORE LOOP (60 FPS FIXED) ---
    loop: function() {
        requestAnimationFrame(() => this.loop());
        
        const dt = Math.min(this.clock.getDelta(), 0.1);
        const time = this.clock.getElapsedTime();

        if (this.state !== 'PLAY') {
            this.renderer.render(this.scene, this.camera);
            return;
        }

        Input.update();

        // 1. PHYSICS UPDATE
        if (this.mode === 'kart') this.updateKart(dt);
        else if (this.mode === 'run') this.updateRun(dt);
        else if (this.mode === 'zen') this.updateZen(dt, time);

        // 2. INTEGRATION (Newton)
        // Vel += Acc * dt
        this.phy.vel.x += this.phy.acc.x * dt;
        this.phy.vel.z += this.phy.acc.z * dt;
        
        // Pos += Vel * dt
        this.phy.pos.x += this.phy.vel.x * dt;
        // Z é relativo (mundo move, player fica)
        
        // 3. RENDER SYNC
        this.syncAvatar(dt, time);
        this.syncCamera(dt);
        this.syncWorld(dt);
        
        // 4. AUDIO & GAMEPLAY
        AudioSys.updateDrone(this.phy.vel.z, 1.0 - this.phy.grip, this.mode);
        if(this.mode !== 'zen') this.manageObstacles(dt);

        this.renderer.render(this.scene, this.camera);
        this.updateHUD();
    },

    // --- KART PHYSICS (Torque & Grip) ---
    updateKart: function(dt) {
        // Acelerador: Input Y (frente) controla força Z
        const throttle = Math.max(0, Input.intentY);
        this.phy.rpm += (throttle - this.phy.rpm) * 5.0 * dt; // Inércia do motor
        
        const engineForce = this.phy.rpm * 25.0;
        const drag = this.phy.vel.z * 0.8; // Resistência do ar
        
        this.phy.acc.z = engineForce - drag;

        // Direção: Torque + Grip
        const steerInput = Input.intentX;
        const turnRate = steerInput * 2.0; // Radianos por segundo
        
        // Só vira se estiver andando
        const speedFactor = Math.min(1.0, this.phy.vel.z / 5.0);
        
        this.phy.rot.y += turnRate * speedFactor * dt;
        // Clamp rotação visual
        this.phy.rot.y = Math.max(-0.8, Math.min(0.8, this.phy.rot.y * 0.95)); // Auto-center leve

        // Grip Logic: Se virar muito rápido, perde aderência lateral
        const lateralStress = Math.abs(turnRate) * this.phy.vel.z;
        this.phy.grip = Math.max(0.2, 1.0 - (lateralStress * 0.02));

        // Vetor de Velocidade Lateral (Baseado no Heading)
        const intendedVelX = Math.sin(this.phy.rot.y) * this.phy.vel.z;
        
        // Drift: Velocidade X atual tenta alcançar a pretendida, mas limitada pelo grip
        this.phy.vel.x += (intendedVelX - this.phy.vel.x) * this.phy.grip * 5.0 * dt;

        // Off-road Penalty
        if(Math.abs(this.phy.pos.x) > 4.0) {
            this.phy.vel.z *= 0.95; // Grama segura
            if(!this.offRoad) { Feedback.trigger('collision'); this.offRoad = true; }
        } else {
            this.offRoad = false;
        }
        
        this.score += Math.round(this.phy.vel.z);
    },

    // --- RUN PHYSICS (Energy & Rhythm) ---
    updateRun: function(dt) {
        // Energia Cinética do Input vira Força
        const force = Input.kineticEnergy * 30.0;
        
        // Fadiga: Se correr muito rápido por muito tempo
        if(this.phy.vel.z > 15) this.phy.fatigue += 0.1 * dt;
        else this.phy.fatigue = Math.max(0, this.phy.fatigue - 0.2 * dt);
        
        const effectiveForce = force * (1.0 - Math.min(0.5, this.phy.fatigue));
        const friction = this.phy.vel.z * 1.5; // Atrito alto (chão)
        
        this.phy.acc.z = effectiveForce - friction;
        
        // Movimento Lateral Direto (Strafe)
        const strafeTarget = Input.intentX * 3.0;
        this.phy.pos.x += (strafeTarget - this.phy.pos.x) * 5.0 * dt;
        
        // Zona de Fluxo
        if(this.phy.vel.z > 10 && this.phy.vel.z < 14) {
            this.zoneTimer += dt;
            if(this.zoneTimer > 3 && !this.inTheZone) {
                this.inTheZone = true;
                Feedback.trigger('boost'); // Efeito visual de "Zone"
            }
        } else {
            this.zoneTimer = 0;
            this.inTheZone = false;
        }
        
        this.score += Math.round(this.phy.vel.z);
    },

    // --- ZEN LOGIC (Reflexive Lag) ---
    updateZen: function(dt, time) {
        // Armazena input no histórico para criar delay orgânico
        this.zenHistory.push({ x: Input.intentX, y: Input.intentY });
        if(this.zenHistory.length > 30) this.zenHistory.shift();
        
        // Pega um frame passado (Delay)
        const frame = this.zenHistory[0] || {x:0, y:0};
        
        // Alvo suave
        const targetX = frame.x * 4.0;
        const targetY = 1.0 + (frame.y * 0.5);
        
        // Interpolação super suave (Fluidez)
        this.phy.pos.x += (targetX - this.phy.pos.x) * 2.0 * dt;
        this.phy.pos.y += (targetY - this.phy.pos.y) * 2.0 * dt;
        
        // Pontua pela suavidade (pouco jitter)
        if(Input.jitter < 0.01) this.score += 1;
        
        // Avatar flutua
        if(this.avatarMesh) {
            this.avatarMesh.position.y = this.phy.pos.y + Math.sin(time) * 0.1;
        }
    },

    // --- VISUAL SYNC ---
    syncAvatar: function(dt, time) {
        if(!this.player) return;
        this.player.position.x = this.phy.pos.x;
        
        // Rotação Visual
        this.player.rotation.y = this.phy.rot.y; // Heading
        
        if(this.mode === 'kart') {
            // Banking (Inclinação na curva)
            const bankAngle = -this.phy.rot.y * 0.5;
            this.player.rotation.z += (bankAngle - this.player.rotation.z) * 5.0 * dt;
            
            // Empinada na aceleração
            const pitchAngle = -this.phy.acc.z * 0.05;
            this.avatarMesh.rotation.x = pitchAngle;
        } 
        else if (this.mode === 'run') {
            // Bobbing (Passada)
            const bobFreq = this.phy.vel.z * 1.5;
            const bobAmp = 0.1;
            this.avatarMesh.position.y = 0.5 + Math.abs(Math.sin(time * bobFreq)) * bobAmp;
            
            // Inclinação do corpo para frente
            this.avatarMesh.rotation.x = 0.2 + (this.phy.vel.z * 0.02);
        }
    },

    syncCamera: function(dt) {
        if(!this.camera) return;
        
        // Câmera segue o player com "Spring Arm" (Atraso)
        const targetX = this.phy.pos.x * 0.5; // Segue 50% lateralmente
        this.camera.position.x += (targetX - this.camera.position.x) * 3.0 * dt;
        
        // FOV Dinâmico (Sensação de velocidade)
        const baseFov = 60;
        const speedFov = this.phy.vel.z * 0.5;
        this.camera.fov += ((baseFov + speedFov) - this.camera.fov) * 2.0 * dt;
        this.camera.updateProjectionMatrix();
        
        // Shake se estiver offroad ou crash
        if(this.offRoad) {
            this.camera.position.y = 2.0 + (Math.random() * 0.1);
        } else {
            this.camera.position.y += (2.0 - this.camera.position.y) * 5.0 * dt;
        }
    },

    syncWorld: function(dt) {
        if(!this.floor) return;
        // O mundo se move na velocidade Z do player
        const speed = this.phy.vel.z;
        this.floor.material.map.offset.y -= speed * 0.01 * dt;
    },

    manageObstacles: function(dt) {
        // Spawn
        if(Math.random() < 0.02 && this.phy.vel.z > 5) this.spawnObject();
        
        // Move & Collide
        for(let i=this.objects.length-1; i>=0; i--) {
            let o = this.objects[i];
            o.position.z += (this.phy.vel.z + 5) * dt; // Relativo
            
            // Colisão Simples (AABB)
            if(o.position.z > 0 && o.position.z < 2) {
                if(Math.abs(o.position.x - this.player.position.x) < 1.2) {
                    if(o.userData.type === 'bad') {
                        Feedback.trigger('collision');
                        this.phy.vel.z *= 0.5; // Impacto físico
                        AudioSys.play('crash');
                    } else {
                        Feedback.trigger('coin');
                        this.score += 500;
                        AudioSys.play('coin');
                        o.visible = false;
                    }
                }
            }
            if(o.position.z > 10) { this.scene.remove(o); this.objects.splice(i,1); }
        }
    },

    spawnObject: function() {
        const isBad = Math.random() > 0.3;
        const geo = new THREE.ConeGeometry(0.5, 1, 8);
        const mat = new THREE.MeshPhongMaterial({ color: isBad ? 0xff0000 : 0xffff00 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData = { type: isBad ? 'bad' : 'good' };
        
        // Pistas: -2.5, 0, 2.5
        const lane = (Math.floor(Math.random()*3) - 1) * 2.5;
        mesh.position.set(lane, 0.5, -80);
        this.scene.add(mesh);
        this.objects.push(mesh);
    },

    updateHUD: function() {
        document.getElementById('score-val').innerText = this.score;
        // Debug visual se necessário
        // console.log(this.phy.vel.z);
    }
};

window.onload = () => Game.init();
