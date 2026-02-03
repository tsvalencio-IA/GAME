// =============================================================================
// KART LEGENDS: MARIO GP EDITION (FÍSICA HÍBRIDA V18)
// MODO: SIMULADOR ARCADE (COM SPIN, DRIFT E ELENCO NINTENDO)
// =============================================================================

(function() {

    // -----------------------------------------------------------------
    // 1. DADOS E CONFIGURAÇÕES
    // -----------------------------------------------------------------
    
    // === PERSONAGENS DO UNIVERSO MARIO ===
    const CHARACTERS = [
        { id: 0, name: 'MARIO',  color: '#e74c3c', hat: '#d32f2f', speedInfo: 1.00, turnInfo: 1.00, weight: 1.0 },
        { id: 1, name: 'LUIGI',  color: '#2ecc71', hat: '#27ae60', speedInfo: 1.05, turnInfo: 0.90, weight: 1.0 },
        { id: 2, name: 'PEACH',  color: '#ff9ff3', hat: '#fd79a8', speedInfo: 0.95, turnInfo: 1.15, weight: 0.8 },
        { id: 3, name: 'BOWSER', color: '#f1c40f', hat: '#e67e22', speedInfo: 1.10, turnInfo: 0.70, weight: 1.4 },
        { id: 4, name: 'TOAD',   color: '#3498db', hat: '#ecf0f1', speedInfo: 0.90, turnInfo: 1.25, weight: 0.6 }
    ];

    const TRACKS = [
        { id: 0, name: 'COGUMELO CUP', theme: 'grass', sky: 0, curveMult: 1.0 },
        { id: 1, name: 'DESERTO KALIMARI', theme: 'sand', sky: 1, curveMult: 0.8 },
        { id: 2, name: 'MONTANHA GELADA', theme: 'snow', sky: 2, curveMult: 1.3 }
    ];

    const CONF = {
        SPEED: 120,
        MAX_SPEED: 220,
        TURBO_MAX_SPEED: 330,
        FRICTION: 0.98,
        OFFROAD_DECEL: 0.92,
        CAMERA_DEPTH: 0.84,
        CAMERA_HEIGHT: 1000,
        ROAD_WIDTH: 2000,
        SEGMENT_LENGTH: 200,
        DRAW_DISTANCE: 200, // Aumentado para ver mais longe
        RUMBLE_LENGTH: 3
    };

    // === TUNING DE JOGABILIDADE (ORÁCULO MASTER) ===
    const GAME_TUNING = {
        steerSensitivity: 0.11,   // Precisão do volante
        gripAsphalt: 0.96,        // Aderência na pista
        gripOffroad: 0.30,        // Escorrega muito na grama
        centrifugalForce: 0.18,   // Força G nas curvas
        lateralInertiaDecay: 0.92, // Suavidade da derrapagem
        collisionBounce: 1.6,     // Força da batida
        spinThreshold: 0.85,      // Limite para rodar na pista
        draftingBoost: 1.05       // Vácuo
    };

    // Globais
    let segments = [];
    let trackLength = 0;
    let minimapPath = [];
    let minimapBounds = {minX:0, maxX:0, minZ:0, maxZ:0, w:1, h:1};
    let particles = []; 
    let hudMessages = [];
    let nitroBtn = null;
    
    // Objeto vazio para evitar crash
    const DUMMY_SEG = { curve: 0, y: 0, color: 'light', obs: [], theme: 'grass' };

    function getSegment(index) {
        if (!segments || segments.length === 0) return DUMMY_SEG;
        return segments[((Math.floor(index) % segments.length) + segments.length) % segments.length] || DUMMY_SEG;
    }

    // Geração Avançada de Minimapa (Traçado Real)
    function buildMiniMap(segments) {
        minimapPath = [];
        let x = 0, z = 0, angle = 0;
        segments.forEach(seg => {
            angle += seg.curve * 0.003; 
            x += Math.sin(angle) * 10;
            z -= Math.cos(angle) * 10;
            minimapPath.push({ x, z });
        });
        
        let minX=Infinity, maxX=-Infinity, minZ=Infinity, maxZ=-Infinity;
        minimapPath.forEach(p => {
            if(p.x < minX) minX = p.x; if(p.x > maxX) maxX = p.x;
            if(p.z < minZ) minZ = p.z; if(p.z > maxZ) maxZ = p.z;
        });
        minimapBounds = { minX, maxX, minZ, maxZ, w: maxX-minX, h: maxZ-minZ };
    }

    // -----------------------------------------------------------------
    // 2. LÓGICA DO JOGO
    // -----------------------------------------------------------------
    const Logic = {
        state: 'MODE_SELECT',
        roomId: 'mario_kart_v1',
        
        selectedChar: 0,
        selectedTrack: 0,
        isReady: false,
        isOnline: false,
        dbRef: null,
        lastSync: 0,
        autoStartTimer: null,

        // Física
        speed: 0, pos: 0, playerX: 0, steer: 0, targetSteer: 0,
        nitro: 100, turboLock: false, boostTimer: 0,
        
        // Mecânicas Avançadas
        spinAngle: 0, spinSpeed: 0, spinTimer: 0,
        lateralInertia: 0, vibration: 0,
        
        lap: 1, totalLaps: 3, time: 0, rank: 1, score: 0, finishTimer: 0,
        visualTilt: 0, bounce: 0, skyColor: 0, 
        
        // Input
        inputState: 0, gestureTimer: 0,
        virtualWheel: { x:0, y:0, r:60, opacity:0, isHigh: false },
        rivals: [], 

        init: function() { 
            this.cleanup(); 
            this.state = 'MODE_SELECT';
            this.setupUI();
            this.resetPhysics();
            particles = []; hudMessages = [];
            window.System.msg("ESCOLHA O MODO");
        },

        cleanup: function() {
            if (this.dbRef) try { this.dbRef.child('players').off(); } catch(e){}
            if(nitroBtn) nitroBtn.remove();
            window.System.canvas.onclick = null;
        },

        pushMsg: function(text, color='#fff', size=40) {
            hudMessages.push({ text, color, size, life: 60, scale: 0.1 });
        },

        setupUI: function() {
            const old = document.getElementById('nitro-btn-kart');
            if(old) old.remove();

            nitroBtn = document.createElement('div');
            nitroBtn.id = 'nitro-btn-kart';
            nitroBtn.innerHTML = "NITRO";
            Object.assign(nitroBtn.style, {
                position: 'absolute', top: '35%', right: '20px', width: '85px', height: '85px',
                borderRadius: '50%', background: 'radial-gradient(#ffcc00, #ff6600)', border: '4px solid #fff',
                color: '#fff', display: 'none', alignItems: 'center', justifyContent: 'center',
                fontFamily: "sans-serif", fontWeight: "bold", fontSize: '16px', zIndex: '100',
                boxShadow: '0 0 20px rgba(255, 100, 0, 0.6)', cursor: 'pointer', userSelect: 'none',
                textShadow: '0 2px 0 rgba(0,0,0,0.5)'
            });

            const toggleTurbo = (e) => {
                if(e && e.cancelable) { e.preventDefault(); e.stopPropagation(); }
                if(this.state !== 'RACE') return;
                
                if(this.nitro > 10) {
                    this.turboLock = !this.turboLock;
                    if(this.turboLock) {
                        this.pushMsg("TURBO!", "#00ffff", 50);
                        window.Sfx.play(600, 'square', 0.1, 0.1);
                    }
                    nitroBtn.style.transform = this.turboLock ? 'scale(0.95)' : 'scale(1)';
                    nitroBtn.style.filter = this.turboLock ? 'brightness(1.5)' : 'brightness(1)';
                }
            };
            
            nitroBtn.addEventListener('touchstart', toggleTurbo, {passive:false});
            nitroBtn.addEventListener('mousedown', toggleTurbo);
            document.getElementById('game-ui').appendChild(nitroBtn);

            window.System.canvas.onclick = (e) => {
                const rect = window.System.canvas.getBoundingClientRect();
                const y = e.clientY - rect.top;
                const h = window.System.canvas.height;

                if (this.state === 'MODE_SELECT') {
                    if (y < h * 0.5) this.selectMode('OFFLINE');
                    else this.selectMode('ONLINE');
                    window.Sfx.click();
                    return;
                }

                if (this.state === 'LOBBY') {
                    if (y > h * 0.7) this.toggleReady(); 
                    else if (y < h * 0.3) {
                        this.selectedChar = (this.selectedChar + 1) % CHARACTERS.length;
                        window.Sfx.hover();
                        if(this.isOnline) this.syncLobby();
                    } else {
                        this.selectedTrack = (this.selectedTrack + 1) % TRACKS.length;
                        window.Sfx.hover();
                        if(this.isOnline) this.syncLobby();
                    }
                }
            };
        },

        resetPhysics: function() {
            this.speed = 0; this.pos = 0; this.playerX = 0; this.steer = 0;
            this.lap = 1; this.score = 0; this.nitro = 100;
            this.spinAngle = 0; this.spinSpeed = 0; this.spinTimer = 0;
            this.lateralInertia = 0; this.vibration = 0;
            this.virtualWheel = { x:0, y:0, r:60, opacity:0, isHigh: false };
            particles = []; hudMessages = [];
        },

        buildTrack: function(trackId) {
            segments = [];
            const trkConfig = TRACKS[trackId];
            this.skyColor = trkConfig.sky;
            const mult = trkConfig.curveMult;

            const addRoad = (enter, curve, y) => {
                for(let i = 0; i < enter; i++) {
                    const isDark = Math.floor(segments.length / CONF.RUMBLE_LENGTH) % 2;
                    segments.push({ curve: curve * mult, y: y, color: isDark ? 'dark' : 'light', obs: [], theme: trkConfig.theme });
                }
            };
            const addProp = (index, type, offset) => { if (segments[index]) segments[index].obs.push({ type: type, x: offset }); };

            addRoad(50, 0, 0); 
            addRoad(40, 2, 0); 
            addRoad(20, 0, 0);
            addRoad(50, -1.5, 0); 
            addRoad(30, -3.0, 0); 
            let sApex = segments.length; addProp(sApex, 'cone', -1.2); 
            addRoad(60, 0, 0);
            addRoad(30, 1.5, 0);
            addRoad(30, -1.5, 0); 
            addRoad(80, 4.0, 0); 
            addProp(segments.length-40, 'cone', 0.5);
            addRoad(50, 0, 0);

            trackLength = segments.length * CONF.SEGMENT_LENGTH;
            if(trackLength === 0) trackLength = 2000;
            buildMiniMap(segments);
        },

        selectMode: function(mode) {
            this.resetPhysics();
            if (mode === 'OFFLINE') {
                this.isOnline = false;
                window.System.msg("MODO ARCADE");
                // GERA RIVAIS DO UNIVERSO MARIO
                this.rivals = [
                    { pos: 1000, lap: 1, x: -0.4, speed: 0, color: '#3498db', name: 'Toad', aggro: 0.04, id: 'cpu1' },
                    { pos: 800,  lap: 1, x: 0.4,  speed: 0, color: '#9b59b6', name: 'Waluigi', aggro: 0.05, id: 'cpu2' },
                    { pos: 600,  lap: 1, x: 0.0,  speed: 0, color: '#f1c40f', name: 'Wario', aggro: 0.06, id: 'cpu3' }
                ];
                this.state = 'LOBBY';
            } else {
                if (!window.DB) {
                    window.System.msg("SEM NET! INDO P/ SOLO");
                    this.selectMode('OFFLINE');
                    return;
                }
                this.isOnline = true;
                window.System.msg("CONECTANDO...");
                this.connectMultiplayer();
                this.state = 'LOBBY';
            }
        },

        connectMultiplayer: function() {
            if (this.dbRef) this.dbRef.child('players').off(); 
            this.dbRef = window.DB.ref('rooms/' + this.roomId);
            const myRef = this.dbRef.child('players/' + window.System.playerId);
            myRef.set({ name: 'Player', charId: 0, ready: false, lastSeen: firebase.database.ServerValue.TIMESTAMP });
            myRef.onDisconnect().remove();

            this.dbRef.child('players').on('value', (snap) => {
                const data = snap.val(); if (!data) return;
                const now = Date.now();
                const newRivals = Object.keys(data)
                    .filter(id => id !== window.System.playerId)
                    .filter(id => (now - (data[id].lastSeen || 0)) < 15000)
                    .map(id => ({
                        id: id, ...data[id], isRemote: true,
                        speed: data[id].speed || 0, pos: data[id].pos || 0, x: data[id].x || 0,
                        spinAngle: data[id].spinAngle || 0,
                        color: (data[id].charId !== undefined) ? CHARACTERS[data[id].charId].color : '#fff'
                    }));
                this.rivals = newRivals;
                this.checkAutoStart(data);
            });
        },

        checkAutoStart: function(allPlayers) {
            if (this.state !== 'WAITING' && this.state !== 'LOBBY') return;
            let readyCount = (this.isReady ? 1 : 0);
            this.rivals.forEach(r => { if(r.ready) readyCount++; });
            const totalPlayers = this.rivals.length + 1;

            if (totalPlayers >= 2 && readyCount === totalPlayers) { this.startRace(this.selectedTrack); }
            else if (totalPlayers >= 2 && readyCount >= 2) {
                 if (!this.autoStartTimer) this.autoStartTimer = Date.now() + 15000;
                 if (Date.now() > this.autoStartTimer) this.startRace(this.selectedTrack);
            } else { this.autoStartTimer = null; }
        },

        toggleReady: function() {
            if (this.state !== 'LOBBY') return;
            if (!this.isOnline) { this.startRace(this.selectedTrack); return; }
            this.isReady = !this.isReady;
            window.Sfx.click();
            if (this.isReady) { this.state = 'WAITING'; window.System.msg("AGUARDANDO..."); } 
            else { this.state = 'LOBBY'; this.autoStartTimer = null; }
            this.syncLobby();
        },

        syncLobby: function() {
            if (this.dbRef) {
                this.dbRef.child('players/' + window.System.playerId).update({
                    charId: this.selectedChar, trackId: this.selectedTrack,
                    ready: this.isReady, lastSeen: firebase.database.ServerValue.TIMESTAMP
                });
            }
        },

        startRace: function(trackId) {
            if (this.state === 'RACE') return;
            this.state = 'RACE';
            this.buildTrack(trackId); 
            nitroBtn.style.display = 'flex';
            this.pushMsg("LARGADA!", "#00ff00", 60);
            window.Sfx.play(600, 'square', 0.5, 0.2);
            window.System.canvas.onclick = null;
        },

        update: function(ctx, w, h, pose) {
            try {
                if (this.state === 'MODE_SELECT') { this.renderModeSelect(ctx, w, h); return; }
                if (this.state === 'LOBBY' || this.state === 'WAITING') { this.renderLobby(ctx, w, h); return; }
                if (!segments || segments.length === 0) return 0;
                
                this.updatePhysics(w, h, pose);
                this.renderWorld(ctx, w, h);
                this.renderUI(ctx, w, h);
                
                if (this.isOnline) this.syncMultiplayer();
                return Math.floor(this.score);
            } catch (err) { console.error("Erro recuperado:", err); return 0; }
        },

        syncMultiplayer: function() {
            if (Date.now() - this.lastSync > 100) {
                this.lastSync = Date.now();
                this.dbRef.child('players/' + window.System.playerId).update({
                    pos: Math.floor(this.pos), x: this.playerX, lap: this.lap,
                    steer: this.steer, speed: this.speed, spinAngle: this.spinAngle,
                    charId: this.selectedChar, lastSeen: firebase.database.ServerValue.TIMESTAMP
                });
            }
        },

        // =================================================================
        // FÍSICA PRO (PESO, INÉRCIA, DRIFT E SPIN)
        // =================================================================
        updatePhysics: function(w, h, pose) {
            const d = Logic;
            const charStats = CHARACTERS[this.selectedChar];

            // 1. INPUT
            let detected = 0;
            let pLeft = null, pRight = null;
            let nose = null;

            if (d.state === 'RACE' && pose && pose.keypoints) {
                const mapPoint = (pt) => ({ x: (1 - (pt.x > 1 ? pt.x/640 : pt.x)) * w, y: (pt.y > 1 ? pt.y/480 : pt.y) * h });
                const lw = pose.keypoints.find(k => k.name === 'left_wrist');
                const rw = pose.keypoints.find(k => k.name === 'right_wrist');
                const n  = pose.keypoints.find(k => k.name === 'nose');

                if (lw && lw.score > 0.15) { pLeft = mapPoint(lw); detected++; }
                if (rw && rw.score > 0.15) { pRight = mapPoint(rw); detected++; }
                if (n && n.score > 0.15) { nose = mapPoint(n); }

                if (detected === 2 && nose) {
                    const isHandsHigh = (pLeft.y < nose.y && pRight.y < nose.y);
                    d.virtualWheel.isHigh = isHandsHigh;
                    if (isHandsHigh) {
                         d.gestureTimer++;
                         if (d.gestureTimer > 20 && d.nitro > 15 && !d.turboLock) { 
                             d.turboLock = true; d.pushMsg("TURBO MAX!", "#00ffff");
                         }
                    } else { d.gestureTimer = 0; }
                }
            }

            // 2. STEERING
            if (detected === 2 && d.spinTimer <= 0) {
                d.inputState = 2;
                const dx = pRight.x - pLeft.x; const dy = pRight.y - pLeft.y;
                const rawAngle = Math.atan2(dy, dx);
                d.targetSteer = (Math.abs(rawAngle) > 0.05) ? rawAngle * 3.0 : 0;
                d.virtualWheel.x = (pLeft.x + pRight.x) / 2; d.virtualWheel.y = (pLeft.y + pRight.y) / 2;
                d.virtualWheel.r = Math.max(40, Math.hypot(dx, dy) / 2); d.virtualWheel.opacity = 1.0; 
            } else {
                d.inputState = 0; d.targetSteer = 0; 
                d.virtualWheel.x += ((w / 2) - d.virtualWheel.x) * 0.1;
                d.virtualWheel.y += ((h * 0.75) - d.virtualWheel.y) * 0.1;
                d.virtualWheel.opacity *= 0.9;
            }
            d.steer += (d.targetSteer - d.steer) * GAME_TUNING.steerSensitivity;
            d.steer = Math.max(-1.5, Math.min(1.5, d.steer));

            // 3. TERRENO E ADERÊNCIA
            const absX = Math.abs(d.playerX);
            let currentGrip = GAME_TUNING.gripAsphalt;
            let currentDrag = CONF.FRICTION;

            if (absX > 1.0) { // Offroad
                const isZebra = (absX < 1.3); 
                currentGrip = isZebra ? 0.75 : GAME_TUNING.gripOffroad;
                currentDrag = isZebra ? 0.96 : CONF.OFFROAD_DECEL;
                d.vibration = isZebra ? 3 : 6;
                if(window.Gfx) window.Gfx.shakeScreen(d.speed * 0.02);
                if(!isZebra) d.speed *= 0.97; 
            } else { d.vibration = 0; }

            // 4. VELOCIDADE
            let targetMax = CONF.MAX_SPEED * charStats.speedInfo;
            if (d.turboLock && d.nitro > 0) { 
                targetMax = CONF.TURBO_MAX_SPEED; d.nitro -= 0.6; 
                if(d.nitro <= 0) { d.nitro = 0; d.turboLock = false; d.pushMsg("TURBO OFF"); } 
            } else { d.nitro = Math.min(100, d.nitro + 0.15); }
            if(d.boostTimer > 0) { targetMax += 80; d.boostTimer--; }

            const hasGas = ((d.inputState > 0 || d.turboLock) && d.spinTimer <= 0); 
            if (hasGas && d.state === 'RACE') {
                d.speed += (targetMax - d.speed) * (0.04 / charStats.weight);
            } else { d.speed *= currentDrag; }

            // 5. FÍSICA CENTRÍFUGA (Simulador)
            const segIdx = Math.floor(d.pos / CONF.SEGMENT_LENGTH);
            const seg = getSegment(segIdx);
            const speedRatio = (d.speed / CONF.MAX_SPEED);
            
            // Empurra para fora na curva
            const centrifugalForce = -(seg.curve * (speedRatio ** 2)) * GAME_TUNING.centrifugalForce;
            // Força de virada do jogador
            const turnForce = d.steer * currentGrip * speedRatio * charStats.turnInfo;
            
            // Inércia Lateral (Drift Feeling)
            const deltaX = turnForce + centrifugalForce;
            d.lateralInertia = (d.lateralInertia * GAME_TUNING.lateralInertiaDecay) + (deltaX * (1-GAME_TUNING.lateralInertiaDecay));
            d.playerX += d.lateralInertia;

            if(d.playerX < -3.5) { d.playerX = -3.5; d.speed *= 0.5; }
            if(d.playerX > 3.5)  { d.playerX = 3.5;  d.speed *= 0.5; }

            // 6. SPIN & COLISÃO
            if (d.spinTimer > 0) {
                d.spinTimer--; d.spinAngle += d.spinSpeed;
                d.speed *= 0.92; d.playerX += d.spinSpeed * 0.2;
                if (d.spinTimer <= 0) { d.spinAngle = 0; d.pushMsg("RECUPEROU!", "#fff"); }
            } else {
                if (absX > 1.4 && speedRatio > GAME_TUNING.spinThreshold && Math.abs(d.lateralInertia) > 0.08) {
                    d.spinTimer = 45; d.spinSpeed = (d.lateralInertia > 0 ? 0.4 : -0.4);
                    d.pushMsg("DERRAPOU!", "#ff3300", 50); window.Sfx.crash();
                }
            }

            seg.obs.forEach(o => {
                if(Math.abs(d.playerX - o.x) < 0.4 && o.x < 100) {
                    d.speed *= 0.3; o.x = 999; 
                    d.spinTimer = 50; d.spinSpeed = 0.5; d.bounce = -20;
                    window.Sfx.crash(); if(window.Gfx) window.Gfx.shakeScreen(30);
                    d.pushMsg("POW!", "#ff0000");
                }
            });

            // 7. RIVAIS
            let pAhead = 0;
            d.rivals.forEach(r => {
                let distZ = r.pos - d.pos;
                if (distZ > trackLength / 2) distZ -= trackLength;
                if (distZ < -trackLength / 2) distZ += trackLength;
                let distX = r.x - d.playerX;

                if (Math.abs(distZ) < 250 && Math.abs(distX) < 0.8) {
                    const impact = GAME_TUNING.collisionBounce * (d.speed/100);
                    if (Math.abs(distZ) < 60) { // Lateral
                         d.lateralInertia -= (distX > 0 ? impact : -impact) * 0.2;
                         d.speed *= 0.98;
                         if (!r.isRemote) r.x += (distX > 0 ? impact : -impact) * 0.2;
                         if(window.Gfx) window.Gfx.shakeScreen(10); window.Sfx.crash();
                    } else { // Traseira
                        if (distZ > 0) { d.speed *= 0.8; d.pushMsg("BATIDA!", "#ffaa00"); if(!r.isRemote) { r.speed += 40; r.x += (Math.random()-0.5); } } 
                        else { d.speed += 20; d.pushMsg("IMPULSO!", "#00ff00"); if(!r.isRemote) r.speed *= 0.8; }
                    }
                }
                
                let pDist = d.pos + (d.lap * trackLength);
                let rDist = r.pos + ((r.lap||1) * trackLength);
                if (rDist > pDist) pAhead++;
            });
            
            if ((1+pAhead) < d.rank) d.pushMsg("ULTRAPASSAGEM!", "#ffff00", 50);
            d.rank = 1 + pAhead;

            d.pos += d.speed;
            if (d.pos >= trackLength) {
                d.pos -= trackLength; d.lap++;
                if (d.lap <= d.totalLaps) { 
                    const isLast = (d.lap === d.totalLaps);
                    d.pushMsg(isLast ? "ÚLTIMA VOLTA!" : `VOLTA ${d.lap}/${d.totalLaps}`, isLast ? "#ff0000" : "#fff", 60); 
                }
                if(d.lap > d.totalLaps && d.state === 'RACE') { 
                    d.state = 'FINISHED'; d.pushMsg(d.rank === 1 ? "VITÓRIA!" : "FIM DE JOGO", "#fff", 80);
                }
            }
            if (d.pos < 0) d.pos += trackLength;

            // IA
            d.rivals.forEach(r => {
                if (r.isRemote) {
                    r.pos += r.speed; if(r.pos >= trackLength) { r.pos -= trackLength; r.lap++; }
                } else {
                    const rSegIdx = Math.floor(r.pos/CONF.SEGMENT_LENGTH);
                    const rSeg = getSegment(rSegIdx);
                    let targetX = 0; 
                    if (Math.abs(rSeg.curve) > 2) targetX = (rSeg.curve > 0 ? -0.6 : 0.6);
                    if (Math.random() < 0.01) targetX = (Math.random() > 0.5 ? 1.5 : -1.5);
                    
                    let maxCpu = CONF.MAX_SPEED * 0.95;
                    if (d.rank === 1 && d.rivals.indexOf(r) > 0) maxCpu *= 1.15; // Rubber banding
                    if (Math.abs(r.x) > 1.2) maxCpu = 80;
                    
                    r.speed += (maxCpu - r.speed) * r.aggro;
                    const cpuCentrifugal = -(rSeg.curve * ((r.speed/CONF.MAX_SPEED)**2)) * GAME_TUNING.centrifugalForce;
                    const cpuSteer = (targetX - r.x) * 0.05;
                    r.x += cpuSteer + cpuCentrifugal;
                    r.pos += r.speed;
                    if(r.pos >= trackLength) { r.pos -= trackLength; r.lap++; }
                }
            });

            d.time++; d.score += d.speed * 0.01; 
            d.bounce = (Math.random() - 0.5) * d.vibration;
            const targetTilt = (d.steer * 12) + (d.spinAngle * 20); 
            d.visualTilt += (targetTilt - d.visualTilt) * 0.1;
            
            if (d.state === 'FINISHED') {
                d.speed *= 0.95;
                if(d.speed < 2 && d.finishTimer === 0) { d.finishTimer = 1; setTimeout(()=> window.System.gameOver(Math.floor(d.score)), 2000); }
            }
        },

        renderWorld: function(ctx, w, h) {
            const d = Logic; const cx = w / 2; const horizon = h * 0.40 + d.bounce;
            const currentSegIndex = Math.floor(d.pos / CONF.SEGMENT_LENGTH);
            const isOffRoad = Math.abs(d.playerX) > 1.2;

            const skyGrads = [['#3388ff', '#88ccff'], ['#e67e22', '#f1c40f'], ['#0984e3', '#74b9ff']];
            const currentSky = skyGrads[d.skyColor] || skyGrads[0];
            const gradSky = ctx.createLinearGradient(0, 0, 0, horizon);
            gradSky.addColorStop(0, currentSky[0]); gradSky.addColorStop(1, currentSky[1]);
            ctx.fillStyle = gradSky; ctx.fillRect(0, 0, w, horizon);

            const bgOffset = (getSegment(currentSegIndex).curve * 30) + (d.steer * 20);
            ctx.fillStyle = d.skyColor === 0 ? '#44aa44' : (d.skyColor===1 ? '#d35400' : '#fff'); 
            ctx.beginPath(); ctx.moveTo(0, horizon);
            for(let i=0; i<=12; i++) { ctx.lineTo((w/12 * i) - (bgOffset * 0.5), horizon - 50 - Math.abs(Math.sin(i + d.pos*0.0001))*40); }
            ctx.lineTo(w, horizon); ctx.fill();

            const themes = {
                'grass': { light: '#55aa44', dark: '#448833', off: '#336622' },
                'sand':  { light: '#f1c40f', dark: '#e67e22', off: '#d35400' },
                'snow':  { light: '#ffffff', dark: '#dfe6e9', off: '#b2bec3' }
            };
            const theme = themes[getSegment(currentSegIndex).theme || 'grass'];
            ctx.fillStyle = isOffRoad ? theme.off : theme.dark; ctx.fillRect(0, horizon, w, h-horizon);

            let dx = 0; let camX = d.playerX * (w * 0.4);
            let segmentCoords = [];

            for(let n = 0; n < CONF.DRAW_DISTANCE; n++) {
                const segIdx = currentSegIndex + n;
                const seg = getSegment(segIdx);
                const segTheme = themes[seg.theme || 'grass'];

                dx += (seg.curve * 0.8);
                const z = n * 20; const scale = 1 / (1 + (z * 0.05));
                const scaleNext = 1 / (1 + ((z+20) * 0.05));
                const screenY = horizon + ((h - horizon) * scale);
                const screenYNext = horizon + ((h - horizon) * scaleNext);
                const screenX = cx - (camX * scale) - (dx * z * scale * 2);
                const screenXNext = cx - (camX * scaleNext) - ((dx + seg.curve*0.8) * (z+20) * scaleNext * 2);
                
                segmentCoords.push({ x: screenX, y: screenY, scale: scale, index: segIdx });

                ctx.fillStyle = (seg.color === 'dark') ? (isOffRoad?segTheme.off:segTheme.dark) : (isOffRoad?segTheme.off:segTheme.light);
                ctx.fillRect(0, screenYNext, w, screenY - screenYNext);
                
                ctx.fillStyle = (seg.color === 'dark') ? '#c0392b' : '#ecf0f1'; 
                ctx.beginPath(); 
                ctx.moveTo(screenX - (w*3*scale)/2 - (w*3*scale)*0.1, screenY); 
                ctx.lineTo(screenX + (w*3*scale)/2 + (w*3*scale)*0.1, screenY); 
                ctx.lineTo(screenXNext + (w*3*scaleNext)/2 + (w*3*scaleNext)*0.1, screenYNext); 
                ctx.lineTo(screenXNext - (w*3*scaleNext)/2 - (w*3*scaleNext)*0.1, screenYNext); 
                ctx.fill();
                
                ctx.fillStyle = (seg.color === 'dark') ? '#666' : '#636363'; 
                ctx.beginPath(); 
                ctx.moveTo(screenX - (w*3*scale)/2, screenY); 
                ctx.lineTo(screenX + (w*3*scale)/2, screenY); 
                ctx.lineTo(screenXNext + (w*3*scaleNext)/2, screenYNext); 
                ctx.lineTo(screenXNext - (w*3*scaleNext)/2, screenYNext); 
                ctx.fill();
            }

            for(let n = CONF.DRAW_DISTANCE - 1; n >= 0; n--) {
                const coord = segmentCoords[n]; 
                if (!coord) continue;
                const seg = getSegment(coord.index);

                d.rivals.forEach(r => {
                    let rRelPos = r.pos - d.pos; 
                    if(rRelPos < -trackLength/2) rRelPos += trackLength; 
                    if(rRelPos > trackLength/2) rRelPos -= trackLength;

                    if (Math.abs(Math.floor(rRelPos / CONF.SEGMENT_LENGTH) - n) < 2.0 && n > 0) {
                        const rScale = coord.scale * w * 0.0055;
                        const rx = coord.x + (r.x * (w * 3) * coord.scale / 2);
                        this.drawKartSprite(ctx, rx, coord.y, rScale, 0, 0, r.spinAngle || 0, r, r.color, true);
                    }
                });

                seg.obs.forEach(o => {
                    if (o.x > 500) return;
                    const sX = coord.x + (o.x * (w * 3) * coord.scale / 2); const size = (w * 0.22) * coord.scale;
                    if (o.type === 'cone') { 
                        ctx.fillStyle = '#ff5500'; ctx.beginPath(); 
                        ctx.moveTo(sX, coord.y - size); ctx.lineTo(sX - size*0.3, coord.y); ctx.lineTo(sX + size*0.3, coord.y); 
                        ctx.fill(); 
                    }
                });
            }
            
            const playerColor = CHARACTERS[d.selectedChar].color;
            this.drawKartSprite(ctx, cx, h*0.85 + d.bounce, w * 0.0055, d.steer, d.visualTilt, d.spinAngle, d, playerColor, false);
            
            if (isOffRoad || d.spinTimer > 0) {
                for(let k=0; k<2; k++) particles.push({ x: cx + (Math.random()-0.5)*80, y: h*0.85+40, vx: (Math.random()-0.5)*5 - (d.steer*20), vy: Math.random()*2, l: 20, c: isOffRoad ? '#795548' : '#bdc3c7' });
            }
            particles.forEach((p, i) => { 
                p.x += p.vx; p.y += p.vy; p.l--; 
                if(p.l<=0) particles.splice(i,1); 
                else { ctx.fillStyle=p.c; ctx.globalAlpha = p.l / 20; ctx.beginPath(); ctx.arc(p.x, p.y, 4 + (20-p.l), 0, Math.PI*2); ctx.fill(); ctx.globalAlpha = 1.0; } 
            });
        },

        drawKartSprite: function(ctx, cx, y, carScale, steer, tilt, spinAngle, d, color, isRival) {
            ctx.save(); 
            ctx.translate(cx, y); 
            ctx.scale(carScale, carScale);
            ctx.rotate(tilt * 0.02 + spinAngle);
            
            // Sombra
            ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.ellipse(0, 35, 60, 15, 0, 0, Math.PI*2); ctx.fill();
            
            // Corpo e Chapéu (Mecanica de cores)
            const hatColor = isRival && d.charId !== undefined ? CHARACTERS[d.charId].hat : CHARACTERS[d.selectedChar].hat;
            
            const gradBody = ctx.createLinearGradient(-30, 0, 30, 0); 
            gradBody.addColorStop(0, color); gradBody.addColorStop(0.5, '#fff'); gradBody.addColorStop(1, color);
            ctx.fillStyle = gradBody; 
            ctx.beginPath(); ctx.moveTo(-25, -30); ctx.lineTo(25, -30); ctx.lineTo(40, 10); ctx.lineTo(10, 35); ctx.lineTo(-10, 35); ctx.lineTo(-40, 10); ctx.fill();
            
            // Rodas
            const wheelAngle = steer * 0.8; 
            const dw = (wx, wy) => { 
                ctx.save(); ctx.translate(wx, wy); ctx.rotate(wheelAngle); 
                ctx.fillStyle = '#111'; ctx.fillRect(-12, -15, 24, 30); 
                ctx.fillStyle = '#666'; ctx.fillRect(-5, -5, 10, 10); 
                ctx.restore(); 
            };
            dw(-45, 15); dw(45, 15); ctx.fillStyle='#111'; ctx.fillRect(-50, -25, 20, 30); ctx.fillRect(30, -25, 20, 30);
            
            // Motorista (Estilo M)
            ctx.save(); ctx.translate(0, -10); ctx.rotate(steer * 0.3); 
            ctx.fillStyle = '#ffccaa'; // Pele
            ctx.beginPath(); ctx.arc(0, -20, 18, 0, Math.PI*2); ctx.fill(); 
            ctx.fillStyle = hatColor; // Chapéu
            ctx.beginPath(); ctx.arc(0, -25, 18, Math.PI, 0); ctx.fill();
            ctx.fillRect(-22, -25, 44, 8);
            
            // Símbolo M
            ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, -32, 6, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = '#000'; ctx.font='bold 8px Arial'; ctx.textAlign='center'; ctx.fillText(isRival?'R':'M', 0, -30);

            if (isRival) {
                ctx.fillStyle = '#0f0'; ctx.font='bold 12px Arial'; ctx.textAlign='center'; ctx.fillText('CPU', 0, -50);
            } else {
                ctx.fillStyle = 'red'; ctx.font='bold 12px Arial'; ctx.textAlign='center'; ctx.fillText('EU', 0, -50);
            }
            ctx.restore(); 
            ctx.restore(); 
        },

        renderModeSelect: function(ctx, w, h) {
            ctx.fillStyle = "#2c3e50"; ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = "white"; ctx.textAlign = "center"; ctx.font = "bold 40px 'Russo One'";
            ctx.fillText("ESCOLHA O MODO", w/2, h * 0.2);
            ctx.fillStyle = "#e67e22"; ctx.fillRect(w/2 - 200, h * 0.35, 400, 80);
            ctx.fillStyle = "white"; ctx.font = "bold 30px sans-serif";
            ctx.fillText("ARCADE (SOLO)", w/2, h * 0.35 + 50);
            ctx.fillStyle = "#27ae60"; ctx.fillRect(w/2 - 200, h * 0.55, 400, 80);
            ctx.fillStyle = "white"; ctx.fillText("ONLINE (P2P)", w/2, h * 0.55 + 50);
        },

        renderLobby: function(ctx, w, h) {
            ctx.fillStyle = "#2c3e50"; ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = "white"; ctx.textAlign = "center"; ctx.font = "bold 40px 'Russo One'";
            ctx.fillText("GARAGEM", w/2, 60);

            const c = CHARACTERS[this.selectedChar];
            ctx.fillStyle = c.color; ctx.beginPath(); ctx.arc(w/2, h*0.3, 60, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = "white"; ctx.font = "bold 30px sans-serif";
            ctx.fillText(c.name, w/2, h*0.3 + 100);
            
            const t = TRACKS[this.selectedTrack];
            ctx.fillStyle = "#34495e"; ctx.fillRect(w/2 - 150, h*0.55, 300, 60);
            ctx.fillStyle = "#ecf0f1"; ctx.fillText("PISTA: " + t.name, w/2, h*0.55 + 40);

            let btnText = "PRONTO"; let btnColor = "#e67e22";
            if (this.state === 'WAITING') {
                btnText = "AGUARDANDO...";
                if (this.autoStartTimer) {
                    const timeLeft = Math.ceil((this.autoStartTimer - Date.now()) / 1000);
                    btnText = `INICIANDO EM ${timeLeft}s...`;
                }
            } else if (this.state === 'LOBBY') { btnColor = "#27ae60"; }

            ctx.fillStyle = btnColor; ctx.fillRect(w/2 - 200, h*0.8, 400, 70);
            ctx.fillStyle = "white"; ctx.font = "bold 25px 'Russo One'"; ctx.fillText(btnText, w/2, h*0.8 + 45);
        },

        renderUI: function(ctx, w, h) {
            const d = Logic;
            if (d.state === 'RACE') {
                // JUICE MESSAGES
                hudMessages = hudMessages.filter(m => m.life > 0);
                hudMessages.forEach((m, i) => {
                    ctx.save(); ctx.translate(w/2, h/2 - (i*40));
                    let s = 1 + Math.sin(Date.now() * 0.02) * 0.1; 
                    if(m.scale < 1) m.scale += 0.2;
                    ctx.scale(m.scale * s, m.scale * s);
                    ctx.shadowColor = "black"; ctx.shadowBlur = 10;
                    ctx.fillStyle = m.color; ctx.font = `italic bold ${m.size}px 'Russo One'`; 
                    ctx.textAlign = 'center'; ctx.globalAlpha = Math.min(1, m.life / 20);
                    ctx.fillText(m.text, 0, 0); ctx.lineWidth = 2; ctx.strokeStyle = "black"; ctx.strokeText(m.text, 0, 0);
                    ctx.restore(); m.life--;
                });

                const hudX = w - 80; const hudY = h - 60; 
                let shakeX = (d.vibration > 0) ? (Math.random()-0.5)*4 : 0;
                let shakeY = (d.vibration > 0) ? (Math.random()-0.5)*4 : 0;
                
                ctx.translate(shakeX, shakeY);
                ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.arc(hudX, hudY, 55, 0, Math.PI * 2); ctx.fill();
                const rpm = Math.min(1, d.speed / CONF.TURBO_MAX_SPEED); 
                ctx.beginPath(); ctx.arc(hudX, hudY, 50, Math.PI, Math.PI + Math.PI * rpm); 
                ctx.lineWidth = 6; ctx.strokeStyle = (d.turboLock || d.boostTimer > 0) ? '#00ffff' : '#ff3300'; ctx.stroke();
                
                ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; 
                ctx.font = "bold 36px 'Russo One'"; ctx.fillText(Math.floor(d.speed), hudX, hudY + 10);
                ctx.font = "bold 18px 'Russo One'"; ctx.fillText(`${d.rank} / ${d.rivals.length + 1}`, hudX, hudY + 42);
                ctx.translate(-shakeX, -shakeY);
                
                const nW = 220; ctx.fillStyle = '#111'; ctx.fillRect(w / 2 - nW / 2, 20, nW, 20); 
                ctx.fillStyle = d.turboLock ? '#00ffff' : (d.nitro > 20 ? '#00aa00' : '#ff3300'); 
                ctx.fillRect(w / 2 - nW / 2 + 2, 22, (nW - 4) * (d.nitro / 100), 16);

                // MINIMAPA REAL
                if (minimapPath.length > 0) {
                    const mapSize = 130; const mapX = 25; const mapY = 95;
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
                    ctx.fillRect(mapX, mapY, mapSize, mapSize); ctx.strokeRect(mapX, mapY, mapSize, mapSize);
                    ctx.save(); ctx.beginPath(); ctx.rect(mapX, mapY, mapSize, mapSize); ctx.clip();
                    const scale = Math.min((mapSize - 20) / minimapBounds.w, (mapSize - 20) / minimapBounds.h);
                    ctx.translate(mapX + mapSize/2, mapY + mapSize/2);
                    ctx.scale(scale, scale);
                    ctx.translate(-(minimapBounds.minX + minimapBounds.maxX)/2, -(minimapBounds.minZ + minimapBounds.maxZ)/2);
                    
                    ctx.strokeStyle = '#aaa'; ctx.lineWidth = 15; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
                    ctx.beginPath(); minimapPath.forEach((p, i) => { if(i===0) ctx.moveTo(p.x, p.z); else ctx.lineTo(p.x, p.z); });
                    ctx.closePath(); ctx.stroke();
                    ctx.strokeStyle = '#555'; ctx.lineWidth = 10; ctx.stroke();

                    const drawDot = (pos, color, radius) => {
                        const idx = Math.floor((pos / trackLength) * minimapPath.length) % minimapPath.length;
                        const pt = minimapPath[idx];
                        if(pt) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(pt.x, pt.z, radius, 0, Math.PI*2); ctx.fill(); }
                    };
                    d.rivals.forEach(r => drawDot(r.pos, r.color, 8));
                    drawDot(d.pos, '#ff0000', 12); 
                    ctx.restore();
                }

                if (d.virtualWheel.opacity > 0.01) {
                    const vw = d.virtualWheel; ctx.save(); ctx.globalAlpha = vw.opacity; ctx.translate(vw.x, vw.y);
                    if (vw.isHigh) { ctx.shadowBlur = 25; ctx.shadowColor = '#00ffff'; }
                    const safeR = Math.max(10, vw.r);
                    ctx.lineWidth = 8; ctx.strokeStyle = '#222'; ctx.beginPath(); ctx.arc(0, 0, safeR, 0, Math.PI * 2); ctx.stroke();
                    ctx.rotate(d.steer * 1.4); 
                    ctx.fillStyle = '#ff3300'; ctx.beginPath(); ctx.fillRect(-4, -safeR + 10, 8, 22);
                    ctx.restore();
                }
            } else {
                ctx.fillStyle = "rgba(0,0,0,0.85)"; ctx.fillRect(0, 0, w, h);
                ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = "bold 60px 'Russo One'";
                ctx.fillText(d.rank === 1 ? "VITÓRIA!" : `${d.rank}º LUGAR`, w / 2, h * 0.3);
            }
        }
    };

    if(window.System) {
        window.System.registerGame('drive', 'Kart Legends', '🏎️', Logic, { camOpacity: 0.1, showWheel: true });
    }
})();
