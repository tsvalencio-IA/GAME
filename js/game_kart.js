// =============================================================================
// KART DO OTTO – VERSÃO FINAL (CORREÇÃO DE GFX SHAKE + VOLANTE FANTASMA)
// =============================================================================

(function() {

    // -----------------------------------------------------------------
    // 1. DADOS E CONFIGURAÇÕES
    // -----------------------------------------------------------------
    const CHARACTERS = [
        { id: 0, name: 'OTTO', color: '#e74c3c', speedInfo: 1.0, turnInfo: 1.0, desc: 'Equilibrado' },
        { id: 1, name: 'SPEED', color: '#f1c40f', speedInfo: 1.08, turnInfo: 0.85, desc: 'Velocidade Máxima' },
        { id: 2, name: 'TANK', color: '#3498db', speedInfo: 0.92, turnInfo: 1.15, desc: 'Controle Total' }
    ];

    const TRACKS = [
        { id: 0, name: 'GP CIRCUITO', theme: 'grass', sky: 0, curveMult: 1.0 },
        { id: 1, name: 'DESERTO SECO', theme: 'sand', sky: 1, curveMult: 0.8 },
        { id: 2, name: 'PICO NEVADO', theme: 'snow', sky: 2, curveMult: 1.3 }
    ];

    const CONF = {
        MAX_SPEED: 235,
        TURBO_MAX_SPEED: 420,
        ACCEL: 1.5,
        FRICTION: 0.985,
        OFFROAD_DECEL: 0.93,
        CENTRIFUGAL_FORCE: 0.19,
        STEER_AUTHORITY: 0.18,
        GRIP_DRIFT: 0.94,
        CRASH_PENALTY: 0.55,
        DEADZONE: 0.05,
        INPUT_SMOOTHING: 0.22,
        TURBO_ZONE_Y: 0.35, 
        DRAW_DISTANCE: 60
    };

    // Variáveis Globais do Jogo
    let minimapPoints = [];
    let particles = []; 
    let nitroBtn = null;
    let lapPopupTimer = 0;
    let lapPopupText = "";
    
    const SEGMENT_LENGTH = 200; 
    const RUMBLE_LENGTH = 3;    
    let segments = [];
    let trackLength = 0;

    const DUMMY_SEG = { curve: 0, y: 0, color: 'light', obs: [], theme: 'grass' };

    function getSegment(index) {
        if (!segments || segments.length === 0) return DUMMY_SEG;
        // Matematica segura para pegar segmento sem erro
        return segments[((Math.floor(index) % segments.length) + segments.length) % segments.length] || DUMMY_SEG;
    }

    function buildMiniMap(segments) {
        minimapPoints = [];
        let x = 0; let y = 0; let dir = -Math.PI / 2;
        segments.forEach(seg => {
            dir += seg.curve * 0.002;
            x += Math.cos(dir) * 4; y += Math.sin(dir) * 4;
            minimapPoints.push({ x, y });
        });
    }

    // -----------------------------------------------------------------
    // 2. LÓGICA DO JOGO
    // -----------------------------------------------------------------
    const Logic = {
        state: 'MODE_SELECT',
        roomId: 'room_01',
        
        selectedChar: 0,
        selectedTrack: 0,
        isReady: false,
        isOnline: false,
        
        dbRef: null,
        lastSync: 0,
        autoStartTimer: null,

        speed: 0, pos: 0, playerX: 0, steer: 0, targetSteer: 0,
        nitro: 100, turboLock: false,
        driftState: 0, driftDir: 0, driftCharge: 0, mtStage: 0, boostTimer: 0,    
        
        lap: 1, totalLaps: 3, time: 0, rank: 1, score: 0, finishTimer: 0,
        
        visualTilt: 0, bounce: 0, skyColor: 0, 
        inputState: 0, gestureTimer: 0,
        
        virtualWheel: { x:0, y:0, r:0, opacity:0 },
        rivals: [],

        // --- INICIALIZAÇÃO ---
        init: function() { 
            this.cleanup(); 
            this.state = 'MODE_SELECT';
            this.setupUI();
            this.resetPhysics();
            particles = []; 
            window.System.msg("SELECIONE O MODO");
        },

        // --- LIMPEZA ---
        cleanup: function() {
            if (this.dbRef) {
                try { this.dbRef.child('players').off(); } catch(e){}
            }
            if(nitroBtn) nitroBtn.remove();
            window.System.canvas.onclick = null;
        },

        setupUI: function() {
            const old = document.getElementById('nitro-btn-kart');
            if(old) old.remove();

            nitroBtn = document.createElement('div');
            nitroBtn.id = 'nitro-btn-kart';
            nitroBtn.innerHTML = "NITRO";
            Object.assign(nitroBtn.style, {
                position: 'absolute', top: '35%', right: '20px', width: '85px', height: '85px',
                borderRadius: '50%', background: 'radial-gradient(#ffaa00, #cc5500)', border: '4px solid #fff',
                color: '#fff', display: 'none', alignItems: 'center', justifyContent: 'center',
                fontFamily: "sans-serif", fontWeight: "bold", fontSize: '16px', zIndex: '100',
                boxShadow: '0 0 20px rgba(255, 100, 0, 0.5)', cursor: 'pointer', userSelect: 'none'
            });

            // Eventos de toque com preventDefault para evitar conflitos no mobile
            const toggleTurbo = (e) => {
                if(e) { 
                    if(e.cancelable) e.preventDefault(); 
                    e.stopPropagation(); 
                }
                if(this.state !== 'RACE') return;
                
                if(this.nitro > 5) {
                    this.turboLock = !this.turboLock;
                    nitroBtn.style.transform = this.turboLock ? 'scale(0.95)' : 'scale(1)';
                    nitroBtn.style.filter = this.turboLock ? 'brightness(1.5)' : 'brightness(1)';
                    if(this.turboLock) window.Sfx.play(600, 'square', 0.1, 0.1);
                }
            };
            
            nitroBtn.addEventListener('touchstart', toggleTurbo, {passive:false});
            nitroBtn.addEventListener('mousedown', toggleTurbo);
            document.getElementById('game-ui').appendChild(nitroBtn);

            // Controle de Menus
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
            this.lap = 1; this.score = 0; this.driftState = 0; this.nitro = 100;
            this.virtualWheel = { x:0, y:0, r:0, opacity:0 };
            particles = [];
        },

        buildTrack: function(trackId) {
            segments = [];
            const trkConfig = TRACKS[trackId];
            this.skyColor = trkConfig.sky;
            const mult = trkConfig.curveMult;

            const addRoad = (enter, curve, y) => {
                for(let i = 0; i < enter; i++) {
                    const isDark = Math.floor(segments.length / RUMBLE_LENGTH) % 2;
                    segments.push({ curve: curve * mult, y: y, color: isDark ? 'dark' : 'light', obs: [], theme: trkConfig.theme });
                }
            };
            const addProp = (index, type, offset) => { if (segments[index]) segments[index].obs.push({ type: type, x: offset }); };

            addRoad(50, 0, 0); 
            addRoad(20, 0.5, 0); 
            addRoad(20, 1.5, 0);             
            let sApex = segments.length; addRoad(30, 3.5, 0); addProp(sApex + 5, 'cone', 0.9);
            addRoad(40, 0, 0);
            addRoad(20, -1.0, 0); addRoad(60, -3.5, 0); 
            let sHazards = segments.length; addRoad(70, 0, 0); 
            addProp(sHazards + 15, 'cone', 0); addProp(sHazards + 35, 'cone', -0.6); 
            addRoad(40, 1.2, 0);

            trackLength = segments.length * SEGMENT_LENGTH;
            if(trackLength === 0) trackLength = 2000; // Segurança
            buildMiniMap(segments);
        },

        // --- GERENCIAMENTO DE REDE ---
        selectMode: function(mode) {
            this.resetPhysics();
            if (mode === 'OFFLINE') {
                this.isOnline = false;
                window.System.msg("MODO SOLO");
                this.rivals = [
                    { pos: 1000, lap: 1, x: -0.4, speed: 0, color: '#2ecc71', name: 'Luigi', aggro: 0.03 },
                    { pos: 800,  lap: 1, x: 0.4,  speed: 0, color: '#3498db', name: 'Toad',  aggro: 0.025 }
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
            myRef.set({
                name: 'Player',
                charId: 0,
                ready: false,
                lastSeen: firebase.database.ServerValue.TIMESTAMP
            });
            myRef.onDisconnect().remove();

            this.dbRef.child('players').on('value', (snap) => {
                const data = snap.val();
                if (!data) return;
                
                const now = Date.now();
                const newRivals = Object.keys(data)
                    .filter(id => id !== window.System.playerId)
                    .filter(id => (now - (data[id].lastSeen || 0)) < 15000)
                    .map(id => ({
                        id: id,
                        ...data[id],
                        isRemote: true,
                        speed: 0,
                        color: CHARACTERS[data[id].charId || 0].color
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

            if (totalPlayers >= 2 && readyCount === totalPlayers) {
                this.startRace(this.selectedTrack);
            }
            else if (totalPlayers >= 2 && readyCount >= 2) {
                 if (!this.autoStartTimer) this.autoStartTimer = Date.now() + 15000;
                 if (Date.now() > this.autoStartTimer) this.startRace(this.selectedTrack);
            } else {
                this.autoStartTimer = null;
            }
        },

        toggleReady: function() {
            if (this.state !== 'LOBBY') return;
            
            if (!this.isOnline) {
                this.startRace(this.selectedTrack);
                return;
            }

            this.isReady = !this.isReady;
            window.Sfx.click();
            
            if (this.isReady) {
                this.state = 'WAITING';
                window.System.msg("AGUARDANDO...");
            } else {
                this.state = 'LOBBY';
                this.autoStartTimer = null;
            }
            this.syncLobby();
        },

        syncLobby: function() {
            if (this.dbRef) {
                this.dbRef.child('players/' + window.System.playerId).update({
                    charId: this.selectedChar,
                    trackId: this.selectedTrack,
                    ready: this.isReady,
                    lastSeen: firebase.database.ServerValue.TIMESTAMP
                });
            }
        },

        startRace: function(trackId) {
            if (this.state === 'RACE') return;
            this.state = 'RACE';
            this.buildTrack(trackId); 
            nitroBtn.style.display = 'flex';
            window.System.msg("VAI! VAI! VAI!");
            window.Sfx.play(600, 'square', 0.5, 0.2);
            window.System.canvas.onclick = null;
        },

        // -------------------------------------------------------------
        // UPDATE LOOP
        // -------------------------------------------------------------
        update: function(ctx, w, h, pose) {
            // Bloco de segurança total para evitar Crash do Navegador
            try {
                if (this.state === 'MODE_SELECT') { this.renderModeSelect(ctx, w, h); return; }
                if (this.state === 'LOBBY' || this.state === 'WAITING') { this.renderLobby(ctx, w, h); return; }

                if (!segments || segments.length === 0) return 0;
                
                this.updatePhysics(w, h, pose);
                this.renderWorld(ctx, w, h);
                this.renderUI(ctx, w, h);
                
                if (this.isOnline) {
                    try { this.syncMultiplayer(); } catch(e) {}
                }
                
                return Math.floor(this.score);
            } catch (err) {
                // Se der erro, reseta a física mas NÃO trava o navegador
                console.error("Erro recuperado:", err);
                this.speed = 0;
                return 0;
            }
        },

        syncMultiplayer: function() {
            if (Date.now() - this.lastSync > 80) {
                this.lastSync = Date.now();
                this.dbRef.child('players/' + window.System.playerId).update({
                    pos: Math.floor(this.pos),
                    x: this.playerX,
                    lap: this.lap,
                    lastSeen: firebase.database.ServerValue.TIMESTAMP
                });
            }
        },

        // -------------------------------------------------------------
        // FÍSICA E DETECÇÃO (BLINDADA)
        // -------------------------------------------------------------
        updatePhysics: function(w, h, pose) {
            const d = Logic;
            const charStats = CHARACTERS[this.selectedChar];

            // 1. LIMPEZA DE VALORES INVÁLIDOS (NaN Fix)
            if (!Number.isFinite(d.speed)) d.speed = 0;
            if (!Number.isFinite(d.pos)) d.pos = 0;
            if (!Number.isFinite(d.playerX)) d.playerX = 0;
            
            // 2. DETECÇÃO DE MOVIMENTO (Pose)
            let detected = 0;
            let pLeft = null, pRight = null;

            if (d.state === 'RACE' && pose && pose.keypoints) {
                const lw = pose.keypoints.find(k => k.name === 'left_wrist');
                const rw = pose.keypoints.find(k => k.name === 'right_wrist');
                
                if (lw && lw.score > 0.15) { pLeft = window.Gfx.map(lw, w, h); detected++; }
                if (rw && rw.score > 0.15) { pRight = window.Gfx.map(rw, w, h); detected++; }
                
                if (detected >= 1) {
                    let avgY = (detected === 2) ? (pLeft.y + pRight.y) / 2 : (pLeft ? pLeft.y : pRight.y);
                    if (avgY < h * CONF.TURBO_ZONE_Y) {
                        d.gestureTimer++;
                        if (d.gestureTimer === 15 && d.nitro > 5) {
                            d.turboLock = !d.turboLock; 
                            window.System.msg(d.turboLock ? "TURBO MAX!" : "TURBO OFF");
                        }
                    } else { d.gestureTimer = 0; }
                }
            }

            // VOLANTE VIRTUAL (MODIFICADO: AGORA APARECE FANTASMA)
            if (detected === 2) {
                d.inputState = 2;
                const dx = pRight.x - pLeft.x; 
                const dy = pRight.y - pLeft.y;
                const rawAngle = Math.atan2(dy, dx);
                
                d.targetSteer = (Math.abs(rawAngle) > CONF.DEADZONE) ? rawAngle * 2.5 : 0;
                
                d.virtualWheel.x = (pLeft.x + pRight.x) / 2; 
                d.virtualWheel.y = (pLeft.y + pRight.y) / 2;
                d.virtualWheel.r = Math.max(40, Math.hypot(dx, dy) / 2);
                d.virtualWheel.opacity = 1.0; 
            } else {
                d.inputState = 0; 
                d.targetSteer = 0; 
                
                // MODO FANTASMA: Se não detectar mãos, centraliza e fica transparente
                // Em vez de opacity = 0, mantemos em 0.3 para você ver o volante
                if (d.virtualWheel.x === 0) { d.virtualWheel.x = w/2; d.virtualWheel.y = h*0.75; }
                
                d.virtualWheel.x += ((w / 2) - d.virtualWheel.x) * 0.1;
                d.virtualWheel.y += ((h * 0.75) - d.virtualWheel.y) * 0.1;
                d.virtualWheel.r += (60 - d.virtualWheel.r) * 0.1;
                d.virtualWheel.opacity += (0.3 - d.virtualWheel.opacity) * 0.1;
            }
            
            d.steer += (d.targetSteer - d.steer) * CONF.INPUT_SMOOTHING;
            d.steer = Math.max(-1.5, Math.min(1.5, d.steer));

            // CÁLCULO DE VELOCIDADE
            let currentMax = CONF.MAX_SPEED * charStats.speedInfo;
            if (d.turboLock && d.nitro > 0) {
                currentMax = CONF.TURBO_MAX_SPEED; d.nitro -= 0.6;
                if(d.nitro <= 0) { d.nitro = 0; d.turboLock = false; }
            } else { d.turboLock = false; d.nitro = Math.min(100, d.nitro + 0.15); }
            
            if(d.boostTimer > 0) { currentMax += 80; d.boostTimer--; }

            const hasGas = (d.inputState > 0 || d.turboLock);
            if (hasGas && d.state === 'RACE') d.speed += (currentMax - d.speed) * 0.075;
            else d.speed *= CONF.FRICTION;

            if (Math.abs(d.playerX) > 2.2) d.speed *= CONF.OFFROAD_DECEL;
            
            // Segurança extra para velocidade
            if (!Number.isFinite(d.speed)) d.speed = 0;

            // FÍSICA NA PISTA
            const segIdx = Math.floor(d.pos / SEGMENT_LENGTH);
            const seg = getSegment(segIdx);
            const speedRatio = d.speed / CONF.MAX_SPEED;
            const centrifugal = -seg.curve * (speedRatio * speedRatio) * CONF.CENTRIFUGAL_FORCE; 
            
            let dynamicGrip = 1.0; 
            if(d.driftState === 1) dynamicGrip = CONF.GRIP_DRIFT; 
            
            const steerPower = CONF.STEER_AUTHORITY * charStats.turnInfo;
            d.playerX += (d.steer * steerPower * dynamicGrip * speedRatio) + (centrifugal * (1 - Math.abs(d.steer)*0.5));

            if(d.playerX < -4.5) { d.playerX = -4.5; d.speed *= 0.95; }
            if(d.playerX > 4.5)  { d.playerX = 4.5;  d.speed *= 0.95; }

            // Drift Logic
            if (d.driftState === 0) {
                if (Math.abs(d.steer) > 1.0 && speedRatio > 0.6) {
                    d.driftState = 1; d.driftDir = Math.sign(d.steer); d.driftCharge = 0; d.bounce = -8; window.Sfx.skid();
                }
            } else {
                if (Math.abs(d.steer) < 0.3 || speedRatio < 0.3) {
                    if (d.mtStage > 0) { 
                        d.boostTimer = d.mtStage * 40; 
                        window.System.msg("BOOST!"); 
                        window.Sfx.play(800, 'square', 0.2, 0.2); 
                    }
                    d.driftState = 0; d.mtStage = 0;
                } else { 
                    d.driftCharge++; 
                    if(d.driftCharge > 80) d.mtStage = 2; else if(d.driftCharge > 40) d.mtStage = 1; 
                }
            }

            // Colisão - CORRIGIDO O ERRO DE SHAKE
            seg.obs.forEach(o => {
                if(o.x < 10 && Math.abs(d.playerX - o.x) < 0.35 && Math.abs(d.playerX) < 4.0) {
                    d.speed *= CONF.CRASH_PENALTY; o.x = 999;
                    d.bounce = -15; 
                    window.Sfx.crash(); 
                    window.Gfx.shakeScreen(15); // CORREÇÃO AQUI
                }
            });

            // --- CORREÇÃO FINAL DO TRAVAMENTO ---
            d.pos += d.speed;

            // Se a posição for maior que a pista, volta para o começo (Safe Mode)
            if (d.pos >= trackLength) {
                d.pos -= trackLength;
                d.lap++;
                if (d.lap <= d.totalLaps) { 
                    lapPopupText = `VOLTA ${d.lap}/${d.totalLaps}`; 
                    lapPopupTimer = 120; 
                    window.System.msg(lapPopupText); 
                }
                if(d.lap > d.totalLaps && d.state === 'RACE') { 
                    d.state = 'FINISHED'; 
                    window.System.msg(d.rank === 1 ? "VITÓRIA!" : "FIM!"); 
                }
            }
            
            // Se a posição for negativa, volta para o fim (Safe Mode)
            if (d.pos < 0) {
                d.pos += trackLength;
            }

            // --- IA DOS RIVAIS ---
            let pAhead = 0;
            d.rivals.forEach(r => {
                if (!r.isRemote) {
                    let dist = r.pos - d.pos;
                    if(dist > trackLength/2) dist -= trackLength; if(dist < -trackLength/2) dist += trackLength;
                    let targetS = CONF.MAX_SPEED * 0.45;
                    if(dist > 1200) targetS *= 0.82; if(dist < -1200) targetS *= 1.05;
                    r.speed += (targetS - r.speed) * (r.aggro || 0.03);
                    r.pos += r.speed;
                    
                    // IA Loop Logic (Safe)
                    if(r.pos >= trackLength) { r.pos -= trackLength; r.lap++; }
                    if(r.pos < 0) r.pos += trackLength;

                    const rSeg = getSegment(Math.floor(r.pos/SEGMENT_LENGTH));
                    let idealLine = -(rSeg.curve * 0.6);
                    r.x += (idealLine - r.x) * 0.05;
                }
                let playerTotalDist = d.pos + (d.lap * trackLength);
                let rivalTotalDist = r.pos + (r.lap * trackLength);
                if (rivalTotalDist > playerTotalDist) pAhead++;
            });
            d.rank = 1 + pAhead;

            d.time++; d.score += d.speed * 0.01; d.bounce *= 0.8;
            
            // CORREÇÃO DO SHAKE OFFROAD
            if(Math.abs(d.playerX) > 2.2) { 
                d.bounce = Math.sin(d.time)*5; 
                window.Gfx.shakeScreen(2); // CORREÇÃO AQUI TAMBÉM
            }
            d.visualTilt += (d.steer * 15 - d.visualTilt) * 0.1;
            
            if (d.state === 'FINISHED') {
                d.speed *= 0.95;
                if(d.speed < 2 && d.finishTimer === 0) {
                    d.finishTimer = 1; setTimeout(()=> window.System.gameOver(Math.floor(d.score)), 2000);
                }
            }
        },

        renderWorld: function(ctx, w, h) {
            const d = Logic; const cx = w / 2; const horizon = h * 0.40;
            const currentSegIndex = Math.floor(d.pos / SEGMENT_LENGTH);
            const isOffRoad = Math.abs(d.playerX) > 2.2;

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

            for(let n = 0; n < 80; n++) {
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
                
                ctx.fillStyle = (seg.color === 'dark') ? '#c00' : '#fff'; 
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

            for(let n = 79; n >= 0; n--) {
                const coord = segmentCoords[n]; 
                if (!coord) continue;
                const seg = getSegment(coord.index);
                d.rivals.forEach(r => {
                    let rRelPos = r.pos - d.pos; if(rRelPos < -trackLength/2) rRelPos += trackLength; if(rRelPos > trackLength/2) rRelPos -= trackLength;
                    if (Math.abs(Math.floor(rRelPos / SEGMENT_LENGTH) - n) < 1.5 && n > 1) {
                        ctx.save(); 
                        ctx.translate(coord.x + (r.x * (w * 3) * coord.scale / 2), coord.y); 
                        ctx.scale(coord.scale * 12, coord.scale * 12);
                        ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(0, 0, 8, 3, 0, 0, Math.PI*2); ctx.fill();
                        ctx.fillStyle = r.color; ctx.fillRect(-6, -8, 12, 6);
                        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, -12, 4, 0, Math.PI*2); ctx.fill();
                        if (r.isRemote) { ctx.fillStyle = '#0f0'; ctx.font='bold 2px Arial'; ctx.textAlign='center'; ctx.fillText('P2', 0, -18); }
                        ctx.restore();
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
                    else { 
                        ctx.fillStyle = '#f1c40f'; ctx.fillRect(sX - size/2, coord.y - size, size, size*0.6); 
                        ctx.fillStyle = '#000'; ctx.textAlign='center'; ctx.font = `bold ${size*0.4}px Arial`; 
                        ctx.fillText(seg.curve > 0 ? ">>>" : "<<<", sX, coord.y - size*0.2); 
                    }
                });
            }
            
            const playerColor = CHARACTERS[d.selectedChar].color;
            this.drawKartSprite(ctx, cx, h*0.85 + d.bounce, w * 0.0055, d.steer, d.visualTilt, d, playerColor);
            
            particles.forEach((p, i) => { 
                p.x += p.vx; p.y += p.vy; p.l--; 
                if(p.l<=0) particles.splice(i,1); 
                else { ctx.fillStyle=p.c; ctx.globalAlpha = p.l / 50; ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI*2); ctx.fill(); ctx.globalAlpha = 1.0; } 
            });
            
            if(particles.length > 40) particles = particles.slice(particles.length - 40);
        },

        drawKartSprite: function(ctx, cx, y, carScale, steer, tilt, d, color) {
            ctx.save(); ctx.translate(cx, y); ctx.scale(carScale, carScale);
            ctx.rotate(tilt * 0.02 + (d.driftState === 1 ? d.driftDir * 0.3 : 0));
            
            ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.ellipse(0, 35, 60, 15, 0, 0, Math.PI*2); ctx.fill();
            const gradBody = ctx.createLinearGradient(-30, 0, 30, 0); 
            gradBody.addColorStop(0, color); gradBody.addColorStop(0.5, '#fff'); gradBody.addColorStop(1, color);
            ctx.fillStyle = gradBody; 
            ctx.beginPath(); ctx.moveTo(-25, -30); ctx.lineTo(25, -30); ctx.lineTo(40, 10); ctx.lineTo(10, 35); ctx.lineTo(-10, 35); ctx.lineTo(-40, 10); ctx.fill();
            
            if (d.turboLock || d.boostTimer > 0) { 
                ctx.fillStyle = (d.mtStage === 2 || d.turboLock) ? '#00ffff' : '#ffaa00'; 
                ctx.beginPath(); ctx.arc(-20, -30, 10 + Math.random() * 15, 0, Math.PI*2); 
                ctx.arc(20, -30, 10 + Math.random() * 15, 0, Math.PI*2); ctx.fill(); 
            }
            
            const wheelAngle = steer * 0.8; 
            const dw = (wx, wy) => { 
                ctx.save(); ctx.translate(wx, wy); ctx.rotate(wheelAngle); 
                ctx.fillStyle = '#111'; ctx.fillRect(-12, -15, 24, 30); 
                ctx.fillStyle = '#666'; ctx.fillRect(-5, -5, 10, 10); 
                ctx.restore(); 
            };
            dw(-45, 15); dw(45, 15); ctx.fillStyle='#111'; ctx.fillRect(-50, -25, 20, 30); ctx.fillRect(30, -25, 20, 30);
            
            ctx.save(); ctx.translate(0, -10); ctx.rotate(steer * 0.3); 
            ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, -20, 18, 0, Math.PI*2); ctx.fill(); 
            ctx.fillStyle = '#333'; ctx.fillRect(-15, -25, 30, 8); 
            ctx.fillStyle = 'red'; ctx.font='bold 12px Arial'; ctx.textAlign='center'; ctx.fillText('M', 0, -32);
            ctx.restore(); ctx.restore(); 
        },

        renderModeSelect: function(ctx, w, h) {
            ctx.fillStyle = "#2c3e50"; ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = "white"; ctx.textAlign = "center"; ctx.font = "bold 40px 'Russo One'";
            ctx.fillText("ESCOLHA O MODO DE JOGO", w/2, h * 0.2);

            ctx.fillStyle = "#e67e22"; ctx.fillRect(w/2 - 200, h * 0.35, 400, 80);
            ctx.fillStyle = "white"; ctx.font = "bold 30px sans-serif";
            ctx.fillText("JOGAR SOZINHO (OFFLINE)", w/2, h * 0.35 + 50);

            ctx.fillStyle = "#27ae60"; ctx.fillRect(w/2 - 200, h * 0.55, 400, 80);
            ctx.fillStyle = "white";
            ctx.fillText("MULTIPLAYER (ONLINE)", w/2, h * 0.55 + 50);
        },

        renderLobby: function(ctx, w, h) {
            ctx.fillStyle = "#2c3e50"; ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = "white"; ctx.textAlign = "center"; ctx.font = "bold 40px 'Russo One'";
            ctx.fillText("LOBBY DA CORRIDA", w/2, 60);

            const c = CHARACTERS[this.selectedChar];
            ctx.fillStyle = c.color; ctx.beginPath(); ctx.arc(w/2, h*0.3, 60, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = "white"; ctx.font = "bold 30px sans-serif";
            ctx.fillText(c.name, w/2, h*0.3 + 100);
            ctx.font = "20px sans-serif"; ctx.fillText(c.desc, w/2, h*0.3 + 130);
            ctx.fillText("◄ TOQUE SUPERIOR P/ MUDAR ►", w/2, h*0.3 - 80);

            const t = TRACKS[this.selectedTrack];
            ctx.fillStyle = "#34495e"; ctx.fillRect(w/2 - 150, h*0.55, 300, 60);
            ctx.fillStyle = "#ecf0f1"; ctx.fillText("PISTA: " + t.name, w/2, h*0.55 + 40);

            let btnText = "PRONTO (TOQUE EM BAIXO)";
            let btnColor = "#e67e22";

            if (this.state === 'WAITING') {
                btnText = "AGUARDANDO JOGADORES...";
                if (this.autoStartTimer) {
                    const timeLeft = Math.ceil((this.autoStartTimer - Date.now()) / 1000);
                    btnText = `INICIANDO EM ${timeLeft}s...`;
                    btnColor = "#c0392b";
                }
            } else if (this.state === 'LOBBY') {
                btnColor = "#27ae60";
            }

            ctx.fillStyle = btnColor; ctx.fillRect(w/2 - 200, h*0.8, 400, 70);
            ctx.fillStyle = "white"; ctx.font = "bold 25px 'Russo One'"; ctx.fillText(btnText, w/2, h*0.8 + 45);

            ctx.textAlign = "left"; ctx.font = "14px monospace"; ctx.fillStyle = "#bdc3c7";
            const onlineStatus = this.isOnline ? `Online (${this.rivals.length + 1})` : "Offline (Local)";
            ctx.fillText(`Jogadores: ${onlineStatus}`, 20, h - 20);
        },

        renderUI: function(ctx, w, h) {
            const d = Logic;
            if (d.state === 'RACE') {
                if (lapPopupTimer > 0) { 
                    ctx.save(); ctx.globalAlpha = Math.min(1, lapPopupTimer / 30); 
                    ctx.fillStyle = '#00ffff'; ctx.font = "bold 48px 'Russo One'"; ctx.textAlign = 'center'; 
                    ctx.fillText(lapPopupText, w / 2, h * 0.45); ctx.restore(); lapPopupTimer--; 
                }
                
                // HUD
                const hudX = w - 80; const hudY = h - 60; 
                ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.arc(hudX, hudY, 55, 0, Math.PI * 2); ctx.fill();
                const rpm = Math.min(1, d.speed / CONF.TURBO_MAX_SPEED); 
                ctx.beginPath(); ctx.arc(hudX, hudY, 50, Math.PI, Math.PI + Math.PI * rpm); 
                ctx.lineWidth = 6; ctx.strokeStyle = (d.turboLock || d.boostTimer > 0) ? '#00ffff' : '#ff3300'; ctx.stroke();
                
                ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; 
                ctx.font = "bold 36px 'Russo One'"; ctx.fillText(Math.floor(d.speed), hudX, hudY + 10);
                ctx.font = "bold 14px Arial"; ctx.fillText(`POSIÇÃO`, hudX, hudY + 22); 
                ctx.font = "bold 18px 'Russo One'"; ctx.fillText(`${d.rank} / ${d.rivals.length + 1}`, hudX, hudY + 42);
                
                const nW = 220; ctx.fillStyle = '#111'; ctx.fillRect(w / 2 - nW / 2, 20, nW, 20); 
                ctx.fillStyle = d.turboLock ? '#00ffff' : (d.nitro > 20 ? '#00aa00' : '#ff3300'); 
                ctx.fillRect(w / 2 - nW / 2 + 2, 22, (nW - 4) * (d.nitro / 100), 16);

                // MINI MAPA
                if (minimapPoints.length > 0) {
                    const mapSize = 130; const mapX = 25; const mapY = 95; ctx.save();
                    ctx.fillStyle = 'rgba(10, 25, 40, 0.8)'; ctx.strokeStyle = '#00ffff'; ctx.lineWidth = 2; 
                    ctx.fillRect(mapX - 5, mapY - 5, mapSize + 10, mapSize + 10); 
                    ctx.strokeRect(mapX - 5, mapY - 5, mapSize + 10, mapSize + 10);
                    
                    ctx.beginPath(); ctx.rect(mapX, mapY, mapSize, mapSize); ctx.clip();
                    const b = minimapPoints.reduce((acc, p) => ({ minX: Math.min(acc.minX, p.x), maxX: Math.max(acc.maxX, p.x), minY: Math.min(acc.minY, p.y), maxY: Math.max(acc.maxY, p.y) }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
                    const s = Math.min(mapSize / (b.maxX - b.minX), mapSize / (b.maxY - b.minY)) * 0.85;
                    
                    ctx.translate(mapX + mapSize / 2, mapY + mapSize / 2); ctx.scale(s, s); 
                    ctx.rotate(-getSegment(Math.floor(d.pos / SEGMENT_LENGTH)).curve * 0.7);
                    ctx.translate(-(b.minX + b.maxX) / 2, -(b.minY + b.maxY) / 2); 
                    
                    ctx.strokeStyle = '#39ff14'; ctx.lineWidth = 4; ctx.beginPath();
                    minimapPoints.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }); ctx.stroke();
                    
                    const pi = Math.floor((d.pos / trackLength) * minimapPoints.length) % minimapPoints.length;
                    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(minimapPoints[pi].x, minimapPoints[pi].y, 6, 0, Math.PI * 2); ctx.fill();
                    d.rivals.forEach(r => { ctx.fillStyle = r.color; ctx.beginPath(); ctx.arc(minimapPoints[Math.floor((r.pos / trackLength) * minimapPoints.length) % minimapPoints.length].x, minimapPoints[Math.floor((r.pos / trackLength) * minimapPoints.length) % minimapPoints.length].y, 4, 0, Math.PI * 2); ctx.fill(); });
                    ctx.restore();
                }

                // VOLANTE
                if (d.virtualWheel.opacity > 0.01) {
                    const vw = d.virtualWheel; 
                    ctx.save(); 
                    ctx.globalAlpha = vw.opacity; 
                    ctx.translate(vw.x, vw.y);
                    
                    ctx.lineWidth = 8; ctx.strokeStyle = '#222'; ctx.beginPath(); ctx.arc(0, 0, vw.r, 0, Math.PI * 2); ctx.stroke();
                    ctx.lineWidth = 4; ctx.strokeStyle = '#00ffff'; ctx.beginPath(); ctx.arc(0, 0, vw.r - 8, 0, Math.PI * 2); ctx.stroke();
                    ctx.rotate(d.steer * 1.4); 
                    ctx.fillStyle = '#ff3300'; ctx.beginPath(); ctx.fillRect(-4, -vw.r + 10, 8, 22);
                    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill(); 
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
        window.System.registerGame('drive', 'Otto Kart GP', '🏎️', Logic, {
            camOpacity: 0.1, 
            showWheel: true 
        });
    }
})()
