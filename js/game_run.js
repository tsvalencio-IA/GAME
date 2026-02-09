// =============================================================================
// KART LEGENDS: MARIO GP EDITION (MASTER PHYSICS & GRAPHICS RESTORE)
// ARQUITETO: ENGENHEIRO SÊNIOR V23 - FULL FIDELITY PATCH
// =============================================================================

(function() {

    // -----------------------------------------------------------------
    // 1. DADOS E CONFIGURAÇÕES (SINCRONIZADO COM O ORIGINAL)
    // -----------------------------------------------------------------
    
    const CHARACTERS = [
        { id: 0, name: 'MARIO',  color: '#e74c3c', hat: '#d32f2f', speedInfo: 1.00, turnInfo: 1.00, weight: 1.0, accel: 0.040 },
        { id: 1, name: 'LUIGI',  color: '#2ecc71', hat: '#27ae60', speedInfo: 1.05, turnInfo: 0.90, weight: 1.0, accel: 0.038 },
        { id: 2, name: 'PEACH',  color: '#ff9ff3', hat: '#fd79a8', speedInfo: 0.95, turnInfo: 1.15, weight: 0.7, accel: 0.055 },
        { id: 3, name: 'BOWSER', color: '#f1c40f', hat: '#e67e22', speedInfo: 1.10, turnInfo: 0.70, weight: 1.8, accel: 0.025 },
        { id: 4, name: 'TOAD',   color: '#3498db', hat: '#ecf0f1', speedInfo: 0.90, turnInfo: 1.25, weight: 0.5, accel: 0.070 }
    ];

    const TRACKS = [
        { id: 0, name: 'COGUMELO CUP', theme: 'grass', sky: 0, curveMult: 1.0 },
        { id: 1, name: 'DESERTO KALIMARI', theme: 'sand', sky: 1, curveMult: 0.8 },
        { id: 2, name: 'MONTANHA GELADA', theme: 'snow', sky: 2, curveMult: 1.3 }
    ];

    const CONF = {
        MAX_SPEED: 220,
        TURBO_MAX_SPEED: 330,
        FRICTION: 0.99,
        OFFROAD_DECEL: 0.94,
        ROAD_WIDTH: 2000,
        SEGMENT_LENGTH: 200,
        DRAW_DISTANCE: 200,
        RUMBLE_LENGTH: 3
    };

    // Ajustes Finos de Física (Sem Auto-Steer)
    const PHYSICS = {
        gripAsphalt: 0.98,
        gripZebra: 0.85,
        gripOffroad: 0.35,
        centrifugalForce: 0.22,
        momentumTransfer: 1.6,
        steerSensitivity: 0.12
    };

    let segments = [];
    let trackLength = 0;
    let minimapPath = [];
    let minimapBounds = {minX:0, maxX:0, minZ:0, maxZ:0, w:1, h:1};
    let particles = []; 
    let hudMessages = [];
    let nitroBtn = null;
    
    const DUMMY_SEG = { curve: 0, y: 0, color: 'light', obs: [], theme: 'grass' };

    function getSegment(index) {
        if (!segments || segments.length === 0) return DUMMY_SEG;
        return segments[((Math.floor(index) % segments.length) + segments.length) % segments.length] || DUMMY_SEG;
    }

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
    // 2. LÓGICA DO JOGO (INTEGRADA AO SYSTEM.LOOP)
    // -----------------------------------------------------------------

    const Logic = {
        state: 'MODE_SELECT',
        roomId: 'mario_arena_v23',
        selectedChar: 0,
        selectedTrack: 0,
        isReady: false,
        isOnline: false,
        dbRef: null,
        lastSync: 0,

        // Estado Físico
        speed: 0, pos: 0, playerX: 0, steer: 0, targetSteer: 0,
        nitro: 100, turboLock: false, gestureTimer: 0,
        spinAngle: 0, spinTimer: 0, lateralInertia: 0, vibration: 0,
        
        lap: 1, totalLaps: 3, rank: 1, score: 0,
        visualTilt: 0, bounce: 0, skyColor: 0,
        
        virtualWheel: { x:0, y:0, r:60, opacity:0, isHigh: false },
        rivals: [], 

        init: function() { 
            this.cleanup(); 
            this.state = 'MODE_SELECT';
            this.setupUI();
            this.resetPhysics();
            window.System.msg("SELECIONE O MODO");
        },

        cleanup: function() {
            if (this.dbRef) try { this.dbRef.child('players').off(); } catch(e){}
            if(nitroBtn) nitroBtn.remove();
            window.System.canvas.onclick = null;
        },

        resetPhysics: function() {
            this.speed = 0; this.pos = 0; this.playerX = 0; this.steer = 0;
            this.lap = 1; this.score = 0; this.nitro = 100;
            this.spinAngle = 0; this.spinTimer = 0;
            this.lateralInertia = 0; this.vibration = 0;
            particles = []; hudMessages = [];
        },

        pushMsg: function(text, color='#fff', size=40) {
            hudMessages.push({ text, color, size, life: 60, scale: 0.1 });
        },

        setupUI: function() {
            if(nitroBtn) nitroBtn.remove();
            nitroBtn = document.createElement('div');
            nitroBtn.id = 'nitro-btn-kart';
            nitroBtn.innerHTML = "NITRO";
            Object.assign(nitroBtn.style, {
                position: 'absolute', bottom: '15%', right: '30px', width: '85px', height: '85px',
                borderRadius: '50%', background: 'radial-gradient(#ffcc00, #ff6600)', border: '4px solid #fff',
                color: '#fff', display: 'none', alignItems: 'center', justifyContent: 'center',
                fontFamily: "'Russo One', sans-serif", fontWeight: "bold", fontSize: '14px', zIndex: '100',
                cursor: 'pointer', userSelect: 'none', boxShadow: '0 4px 15px rgba(0,0,0,0.3)'
            });

            const toggleTurbo = (e) => {
                if(e && e.cancelable) e.preventDefault();
                if(this.state === 'RACE' && this.nitro > 15) {
                    this.turboLock = !this.turboLock;
                    window.Sfx.play(600, 'square', 0.1, 0.1);
                    this.pushMsg(this.turboLock ? "TURBO ATIVADO" : "NORMAL", "#0ff");
                }
            };
            nitroBtn.addEventListener('touchstart', toggleTurbo);
            nitroBtn.addEventListener('mousedown', toggleTurbo);
            document.getElementById('game-ui').appendChild(nitroBtn);

            window.System.canvas.onclick = (e) => {
                const rect = window.System.canvas.getBoundingClientRect();
                const y = (e.clientY - rect.top) / rect.height;
                if (this.state === 'MODE_SELECT') {
                    if (y < 0.5) this.selectMode('OFFLINE'); else this.selectMode('ONLINE');
                    window.Sfx.click();
                } else if (this.state === 'LOBBY') {
                    if (y > 0.7) this.toggleReady();
                    else if (y < 0.35) { this.selectedChar = (this.selectedChar + 1) % CHARACTERS.length; window.Sfx.hover(); }
                    else { this.selectedTrack = (this.selectedTrack + 1) % TRACKS.length; window.Sfx.hover(); }
                    if(this.isOnline) this.syncLobby();
                }
            };
        },

        buildTrack: function(trackId) {
            segments = [];
            const trk = TRACKS[trackId];
            this.skyColor = trk.sky;
            const mult = trk.curveMult;

            const addRoad = (len, curve) => {
                for(let i=0; i<len; i++) {
                    segments.push({ 
                        curve: curve * mult, 
                        color: Math.floor(segments.length / CONF.RUMBLE_LENGTH) % 2 ? 'dark' : 'light',
                        theme: trk.theme, obs: []
                    });
                }
            };
            addRoad(60, 0); addRoad(40, 2); addRoad(30, 0); addRoad(60, -3); 
            addRoad(40, 0); addRoad(60, 4); addRoad(40, -2); addRoad(80, 0);

            trackLength = segments.length * CONF.SEGMENT_LENGTH;
            buildMiniMap(segments);
        },

        selectMode: function(mode) {
            this.isOnline = (mode === 'ONLINE' && !!window.DB);
            if(this.isOnline) this.connectMultiplayer();
            else {
                this.rivals = [
                    { id:'cpu1', charId:3, pos: 1200, x:-0.6, speed:0, color: CHARACTERS[3].color, name:'Bowser' },
                    { id:'cpu2', charId:4, pos: 600, x:0.6, speed:0, color: CHARACTERS[4].color, name:'Toad' }
                ];
            }
            this.state = 'LOBBY';
        },

        connectMultiplayer: function() {
            this.dbRef = window.DB.ref('rooms/' + this.roomId);
            const myRef = this.dbRef.child('players/' + window.System.playerId);
            myRef.set({ name: 'Player', charId: 0, ready: false, lastSeen: firebase.database.ServerValue.TIMESTAMP });
            myRef.onDisconnect().remove();

            this.dbRef.child('players').on('value', (snap) => {
                const data = snap.val(); if(!data) return;
                const now = Date.now();
                this.rivals = Object.keys(data)
                    .filter(id => id !== window.System.playerId && (now - data[id].lastSeen < 10000))
                    .map(id => ({ id, ...data[id], isRemote: true, color: CHARACTERS[data[id].charId]?.color || '#fff' }));
                if(this.state === 'WAITING' && Object.values(data).every(p => p.ready)) this.startRace(this.selectedTrack);
            });
        },

        toggleReady: function() {
            this.isReady = !this.isReady;
            if(!this.isOnline) { this.startRace(this.selectedTrack); return; }
            this.state = this.isReady ? 'WAITING' : 'LOBBY';
            this.syncLobby();
        },

        syncLobby: function() {
            if(this.dbRef) this.dbRef.child('players/' + window.System.playerId).update({
                charId: this.selectedChar, ready: this.isReady, lastSeen: firebase.database.ServerValue.TIMESTAMP
            });
        },

        startRace: function(trackId) {
            this.state = 'RACE';
            this.buildTrack(trackId);
            nitroBtn.style.display = 'flex';
            this.pushMsg("LARGADA!", "#0f0", 60);
            window.Sfx.play(600, 'square', 0.5, 0.2);
        },

        // --- UPDATE ENGINE ---
        update: function(ctx, w, h, pose) {
            if (this.state === 'MODE_SELECT') { this.renderMenu(ctx, w, h); return 0; }
            if (this.state === 'LOBBY' || this.state === 'WAITING') { this.renderLobby(ctx, w, h); return 0; }

            this.updatePhysics(w, h, pose);
            this.renderWorld(ctx, w, h);
            this.renderUI(ctx, w, h);

            if (this.isOnline && Date.now() - this.lastSync > 100) {
                this.lastSync = Date.now();
                this.dbRef.child('players/' + window.System.playerId).update({
                    pos: Math.floor(this.pos), x: this.playerX, speed: this.speed,
                    steer: this.steer, charId: this.selectedChar, lastSeen: firebase.database.ServerValue.TIMESTAMP
                });
            }
            return Math.floor(this.score);
        },

        // =================================================================
        // FÍSICA SÊNIOR COM DETECÇÃO DE BRAÇOS ERGUIDOS
        // =================================================================
        updatePhysics: function(w, h, pose) {
            const char = CHARACTERS[this.selectedChar];

            // 1. INPUT E GESTO TURBO
            let detected = false;
            if(pose && pose.keypoints) {
                const mapPt = (p) => ({ x: (1 - p.x/640)*w, y: (p.y/480)*h });
                const lw = pose.keypoints.find(k => k.name === 'left_wrist');
                const rw = pose.keypoints.find(k => k.name === 'right_wrist');
                const nose = pose.keypoints.find(k => k.name === 'nose');

                if(lw?.score > 0.2 && rw?.score > 0.2) {
                    const pl = mapPt(lw); const pr = mapPt(rw);
                    const dx = pr.x - pl.x; const dy = pr.y - pl.y;
                    const angle = Math.atan2(dy, dx);
                    
                    this.targetSteer = angle * 2.8;
                    this.virtualWheel = { x: (pl.x+pr.x)/2, y: (pl.y+pr.y)/2, r: Math.hypot(dx, dy)/2, opacity: 1 };
                    detected = true;

                    // Gesto Turbo: Braços acima do Nariz
                    if(nose && lw.y < nose.y && rw.y < nose.y) {
                        this.gestureTimer++;
                        this.virtualWheel.isHigh = true;
                        if(this.gestureTimer > 25 && this.nitro > 20 && !this.turboLock) {
                            this.turboLock = true;
                            this.pushMsg("TURBO GESTURE!", "#00ffff");
                            window.Sfx.play(800, 'square', 0.1, 0.2);
                        }
                    } else { this.gestureTimer = 0; this.virtualWheel.isHigh = false; }
                }
            }
            if(!detected) { this.targetSteer = 0; this.virtualWheel.opacity *= 0.9; }

            const sens = PHYSICS.steerSensitivity / Math.sqrt(char.weight);
            this.steer += (this.targetSteer - this.steer) * sens;

            // 2. TERRENO E GRIP
            const absX = Math.abs(this.playerX);
            let currentGrip = PHYSICS.gripAsphalt;
            let currentDrag = CONF.FRICTION;
            this.vibration = 0;

            if (absX > 1.45) { // Offroad
                currentGrip = PHYSICS.gripOffroad; currentDrag = PHYSICS.offroadDecel;
                this.vibration = 5; if(this.speed > 55) this.speed *= 0.985;
            } else if (absX > 1.0) { // Zebra
                currentGrip = PHYSICS.gripZebra; this.vibration = 2;
            }

            // 3. ACELERAÇÃO
            let max = CONF.MAX_SPEED * char.speedInfo;
            if(this.turboLock && this.nitro > 0) { 
                max = CONF.TURBO_MAX_SPEED; this.nitro -= 0.6;
                if(this.nitro <= 0) this.turboLock = false;
            } else { this.nitro = Math.min(100, this.nitro + 0.15); }

            if(this.state === 'RACE' && this.spinTimer <= 0) {
                this.speed += (max - this.speed) * char.accel;
            }
            this.speed *= currentDrag;

            // 4. INÉRCIA LATERAL (SEM AUTO-STEER)
            const seg = getSegment(this.pos / CONF.SEGMENT_LENGTH);
            const ratio = this.speed / CONF.MAX_SPEED;
            const centrifugal = -(seg.curve * (ratio**2)) * PHYSICS.centrifugalForce * char.weight;
            const turnForce = this.steer * char.turnInfo * currentGrip * ratio;

            this.lateralInertia = (this.lateralInertia * 0.92) + (turnForce + centrifugal) * 0.08;
            this.playerX += this.lateralInertia;

            // 5. SPIN E COLISÃO
            if(this.spinTimer > 0) {
                this.spinTimer--; this.spinAngle += 0.4; this.speed *= 0.96;
            } else if(absX > 1.55 && ratio > 0.82 && Math.abs(this.lateralInertia) > 0.15) {
                this.spinTimer = 45; window.Sfx.play(200, 'sawtooth', 0.2, 0.1); this.pushMsg("RODOU!");
            }

            this.rivals.forEach(r => {
                let distZ = Math.abs(r.pos - this.pos);
                let distX = Math.abs(r.x - this.playerX);
                if(distZ < 160 && distX < 0.65) {
                    const impact = (this.speed / 100) * PHYSICS.momentumTransfer;
                    const rChar = CHARACTERS[r.charId] || char;
                    this.lateralInertia += (this.playerX > r.x ? 0.12 : -0.12) * impact * (rChar.weight / char.weight);
                    this.speed *= 0.9; window.Sfx.crash();
                }
            });

            this.playerX = Math.max(-3.5, Math.min(3.5, this.playerX));
            this.pos += this.speed;
            if(this.pos >= trackLength) { this.pos -= trackLength; this.lap++; }
            
            this.visualTilt += ((this.steer * 15) - this.visualTilt) * 0.1;
            this.bounce = (Math.random() - 0.5) * this.vibration;
            this.score += this.speed * 0.01;
        },

        // =================================================================
        // RENDERIZAÇÃO (FIDELIDADE ORIGINAL 1:1)
        // =================================================================

        renderWorld: function(ctx, w, h) {
            const cx = w/2; const horizon = h * 0.4 + this.bounce;
            const startIdx = Math.floor(this.pos / CONF.SEGMENT_LENGTH);
            const trk = TRACKS[this.selectedTrack];
            const theme = { grass: ['#5a4', '#483'], sand: ['#ec1', '#d90'], snow: ['#fff', '#dee'] }[trk.theme] || ['#5a4', '#483'];

            // CéU GRADIENTE ORIGINAL
            const gradSky = ctx.createLinearGradient(0, 0, 0, horizon);
            gradSky.addColorStop(0, '#3388ff'); gradSky.addColorStop(1, '#88ccff');
            ctx.fillStyle = gradSky; ctx.fillRect(0, 0, w, horizon);
            ctx.fillStyle = theme[1]; ctx.fillRect(0, horizon, w, h - horizon);

            let dx = 0; let camX = this.playerX * (w * 0.4);
            let segmentCoords = [];

            for (let n = 0; n < CONF.DRAW_DISTANCE; n++) {
                const seg = getSegment(startIdx + n);
                const scale = 1 / (1 + n * 0.05);
                const sy = horizon + (h - horizon) * scale;
                const nextScale = 1 / (1 + (n+1) * 0.05);
                const nsy = horizon + (h - horizon) * nextScale;

                dx += seg.curve;
                const x = cx - (camX * scale) - (dx * n * scale * 2);
                const nx = cx - (camX * nextScale) - ((dx + seg.curve) * (n+1) * nextScale * 2);
                const rw = (w * 3) * scale;
                const nrw = (w * 3) * nextScale;

                segmentCoords.push({ x, y: sy, scale });

                // ZEBRA TRAPEZOIDAL
                ctx.fillStyle = (seg.color === 'dark') ? '#f33' : '#fff';
                ctx.beginPath(); ctx.moveTo(x - rw*0.6, sy); ctx.lineTo(x + rw*0.6, sy);
                ctx.lineTo(nx + nrw*0.6, nsy); ctx.lineTo(nx - nrw*0.6, nsy); ctx.fill();

                // PISTA
                ctx.fillStyle = (seg.color === 'dark') ? '#444' : '#494949';
                ctx.beginPath(); ctx.moveTo(x - rw*0.5, sy); ctx.lineTo(x + rw*0.5, sy);
                ctx.lineTo(nx + nrw*0.5, nsy); ctx.lineTo(nx - nrw*0.5, nsy); ctx.fill();
            }

            // RIVAIS
            this.rivals.forEach(r => {
                let relPos = r.pos - this.pos;
                if(relPos < -trackLength/2) relPos += trackLength;
                if(relPos > 0 && relPos < 4000) {
                    const n = relPos / CONF.SEGMENT_LENGTH;
                    const coord = segmentCoords[Math.floor(n)];
                    if(coord) {
                        const rx = coord.x + (r.x * (w * 1.5) * coord.scale);
                        this.drawKartSprite(ctx, rx, coord.y, w*0.0055*coord.scale, 0, 0, 0, r.color, r.charId, true);
                    }
                }
            });

            // PLAYER KART (FIDELIDADE MÁXIMA)
            this.drawKartSprite(ctx, cx, h*0.85 + this.bounce, w * 0.0055, this.steer, this.visualTilt, this.spinAngle, CHARACTERS[this.selectedChar].color, this.selectedChar, false);
        },

        drawKartSprite: function(ctx, cx, y, carScale, steer, tilt, spinAngle, color, charId, isRival) {
            ctx.save(); ctx.translate(cx, y); ctx.scale(carScale, carScale); ctx.rotate(tilt * 0.02 + spinAngle);
            
            // Sombra
            ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.ellipse(0, 35, 60, 15, 0, 0, Math.PI*2); ctx.fill();
            
            const stats = CHARACTERS[charId] || CHARACTERS[0];
            
            // Corpo (Gradiente Original Linha por Linha)
            const gradBody = ctx.createLinearGradient(-30, 0, 30, 0); 
            gradBody.addColorStop(0, color); gradBody.addColorStop(0.5, '#fff'); gradBody.addColorStop(1, color);
            ctx.fillStyle = gradBody; 
            ctx.beginPath(); ctx.moveTo(-25, -30); ctx.lineTo(25, -30); ctx.lineTo(40, 10); ctx.lineTo(10, 35); ctx.lineTo(-10, 35); ctx.lineTo(-40, 10); ctx.fill();
            
            // Rodas com Rotação
            const wheelAngle = steer * 0.8; 
            const dw = (wx, wy) => { 
                ctx.save(); ctx.translate(wx, wy); ctx.rotate(wheelAngle); 
                ctx.fillStyle = '#111'; ctx.fillRect(-12, -15, 24, 30); 
                ctx.fillStyle = '#666'; ctx.fillRect(-5, -5, 10, 10); 
                ctx.restore(); 
            };
            dw(-45, 15); dw(45, 15); ctx.fillStyle='#111'; ctx.fillRect(-50, -25, 20, 30); ctx.fillRect(30, -25, 20, 30);
            
            // Motorista Detalhado
            ctx.save(); ctx.translate(0, -10); ctx.rotate(steer * 0.3); 
            ctx.fillStyle = '#ffccaa'; ctx.beginPath(); ctx.arc(0, -20, 18, 0, Math.PI*2); ctx.fill(); 
            ctx.fillStyle = stats.hat; ctx.beginPath(); ctx.arc(0, -25, 18, Math.PI, 0); ctx.fill();
            ctx.fillRect(-22, -25, 44, 8);
            
            // Símbolo no Boné
            ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, -32, 6, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = '#000'; ctx.font='bold 8px Arial'; ctx.textAlign='center'; 
            ctx.fillText(stats.name[0], 0, -29);
            
            ctx.fillStyle = isRival ? '#0f0' : 'red'; ctx.font='bold 12px Russo One'; ctx.textAlign='center';
            ctx.fillText(isRival ? 'CPU' : 'EU', 0, -50);
            ctx.restore(); ctx.restore(); 
        },

        renderUI: function(ctx, w, h) {
            // MENSAGENS JUICE (Russo One)
            hudMessages = hudMessages.filter(m => m.life > 0);
            hudMessages.forEach((m, i) => {
                ctx.save(); ctx.translate(w/2, h/2 - i*45); if(m.scale < 1) m.scale += 0.1;
                ctx.scale(m.scale, m.scale); ctx.fillStyle = m.color; 
                ctx.font = `bold ${m.size}px 'Russo One'`; ctx.textAlign = 'center';
                ctx.shadowColor = 'black'; ctx.shadowBlur = 10;
                ctx.fillText(m.text, 0, 0); ctx.restore(); m.life--;
            });

            // VELOCÍMETRO ORIGINAL
            ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.arc(w-75, h-75, 55, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = '#fff'; ctx.textAlign='center'; ctx.font="bold 30px 'Russo One'"; ctx.fillText(Math.floor(this.speed), w-75, h-70);
            ctx.font="10px Arial"; ctx.fillText("KM/H", w-75, h-50);
            
            // NITRO BAR
            ctx.fillStyle = '#111'; ctx.fillRect(w/2 - 100, 20, 200, 15);
            ctx.fillStyle = this.turboLock ? '#0ff' : '#f90'; ctx.fillRect(w/2 - 98, 22, 196 * (this.nitro/100), 11);

            // MINIMAPA (Real Path)
            if (minimapPath.length > 0) {
                const ms = 110; ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(20, 80, ms, ms);
                ctx.save(); ctx.translate(20 + ms/2, 80 + ms/2); ctx.scale(0.35, 0.35);
                ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.beginPath();
                minimapPath.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.z) : ctx.lineTo(p.x, p.z)); ctx.closePath(); ctx.stroke();
                const drawDot = (pos, c) => {
                    const idx = Math.floor((pos/trackLength)*minimapPath.length) % minimapPath.length;
                    const pt = minimapPath[idx]; if(pt) { ctx.fillStyle=c; ctx.beginPath(); ctx.arc(pt.x, pt.z, 12, 0, 7); ctx.fill(); }
                };
                this.rivals.forEach(r => drawDot(r.pos, r.color)); drawDot(this.pos, '#f00');
                ctx.restore();
            }

            // VOLANTE GESTUAL
            if (this.virtualWheel.opacity > 0.05) {
                ctx.save(); ctx.globalAlpha = this.virtualWheel.opacity; ctx.translate(this.virtualWheel.x, this.virtualWheel.y);
                if (this.virtualWheel.isHigh) { ctx.shadowBlur = 20; ctx.shadowColor = '#0ff'; }
                ctx.rotate(this.steer * 1.5); ctx.strokeStyle = '#fff'; ctx.lineWidth = 6;
                ctx.beginPath(); ctx.arc(0,0, this.virtualWheel.r, 0, 7); ctx.stroke();
                ctx.fillStyle = '#f00'; ctx.fillRect(-5, -this.virtualWheel.r, 10, 15);
                ctx.restore();
            }
        },

        renderMenu: function(ctx, w, h) {
            ctx.fillStyle = "#2c3e50"; ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = "white"; ctx.textAlign = "center"; ctx.font = "bold 40px 'Russo One'";
            ctx.fillText("KART LEGENDS", w/2, h * 0.3);
            ctx.fillStyle = "#e67e22"; ctx.fillRect(w/2 - 160, h * 0.45, 320, 65);
            ctx.fillStyle = "#27ae60"; ctx.fillRect(w/2 - 160, h * 0.6, 320, 65);
            ctx.fillStyle = "white"; ctx.font = "bold 20px 'Russo One'";
            ctx.fillText("ARCADE (SOLO)", w/2, h * 0.45 + 40);
            ctx.fillText("ONLINE (P2P)", w/2, h * 0.6 + 40);
        },

        renderLobby: function(ctx, w, h) {
            ctx.fillStyle = "#2c3e50"; ctx.fillRect(0, 0, w, h);
            const char = CHARACTERS[this.selectedChar];
            ctx.fillStyle = char.color; ctx.beginPath(); ctx.arc(w/2, h*0.3, 55, 0, 7); ctx.fill();
            ctx.fillStyle = "white"; ctx.textAlign = "center"; ctx.font = "bold 32px 'Russo One'";
            ctx.fillText(char.name, w/2, h*0.3 + 90);
            ctx.font = "20px 'Russo One'"; ctx.fillText("PISTA: " + TRACKS[this.selectedTrack].name, w/2, h*0.55);
            ctx.fillStyle = this.isReady ? "#e67e22" : "#27ae60"; ctx.fillRect(w/2 - 160, h*0.75, 320, 65);
            ctx.fillStyle = "white"; ctx.fillText(this.isReady ? "AGUARDANDO..." : "PRONTO!", w/2, h*0.75 + 40);
        }
    };

    if(window.System) window.System.registerGame('drive', 'Kart Legends', '🏎️', Logic, { camOpacity: 0.1 });

})();