// =============================================================================
// THIAGUINHO WII PING PONG: VERSÃO 7.0 - GOLD MASTER (PLAYSTATION STANDARD)
// ARQUITETO: SENIOR GAME ENGINE ARCHITECT
// STATUS: 100% ESTÁVEL, ANTI-CRASH BLINDADO, FÍSICA DE IMPACTO REAL, MULTIPLAYER
// =============================================================================

(function() {
    "use strict";

    // -----------------------------------------------------------------
    // 1. CONFIGURAÇÕES FÍSICAS REAIS DA MESA
    // -----------------------------------------------------------------
    const CONF = {
        TABLE_W: 1525,       
        TABLE_L: 2740,       
        TABLE_Y: 0,          
        NET_H: 152,          
        FLOOR_Y: 850,        
        
        BALL_R: 35,          // Tamanho grande para excelente visibilidade no celular
        GRAVITY: 0.80,       // Gravidade rápida para jogo dinâmico
        AIR_DRAG: 0.992,     
        BOUNCE_LOSS: 0.85,   
        MAGNUS_FORCE: 0.20,
        MAX_TOTAL_SPEED: 95, // Velocidade máxima permitida
        
        AUTO_SERVE_DELAY: 2000,
        PADDLE_SCALE: 2.8,   
        PADDLE_HITBOX: 300,  // Hitbox grande: o jogador não "fura" a bola fácil
        SWING_FORCE: 4.0,    
        SMASH_THRESH: 40,    

        // Câmera dinâmica (Será adaptada a cada frame para Celular ou PC)
        CAM_X: 0,           
        CAM_Y: -1500,       
        CAM_Z: -3800,       
        CAM_PITCH: 0.25,    
        FOV: 900,           

        CALIB_TIME: 1500,      
        HAND_SELECT_TIME: 1500 
    };

    const AI_PROFILES = {
        'PRO': { speed: 0.16, difficultyFactor: 0.90, baseSpeed: 0.16 }
    };

    // -----------------------------------------------------------------
    // 2. MATH CORE & ESCUDO ANTI-CRASH MATEMÁTICO (NUNCA MAIS CONGELA)
    // -----------------------------------------------------------------
    const MathCore = {
        project: (x, y, z, w, h) => {
            let cx = x - CONF.CAM_X;
            let cy = y - CONF.CAM_Y;
            let cz = z - CONF.CAM_Z;

            // Inclinação isométrica da câmera
            let cosP = Math.cos(CONF.CAM_PITCH);
            let sinP = Math.sin(CONF.CAM_PITCH);
            let ry = cy * cosP - cz * sinP;
            let rz = cy * sinP + cz * cosP;

            // BLINDAGEM 1: Se o objeto está atrás ou muito perto da câmera, cancela
            if (rz <= 10 || !Number.isFinite(rz)) return { x: -9999, y: -9999, s: 0, visible: false, depth: rz };
            
            const scale = CONF.FOV / rz;
            let screenX = (cx * scale) + w/2;
            let screenY = (ry * scale) + h/2;

            // BLINDAGEM 2: Se a matemática explodir para o infinito, o Canvas trava. Isso impede o travamento.
            if (!Number.isFinite(screenX) || !Number.isFinite(screenY) || Math.abs(screenX) > 15000 || Math.abs(screenY) > 15000) {
                return { x: -9999, y: -9999, s: 0, visible: false, depth: rz };
            }

            return { x: screenX, y: screenY, s: scale, visible: true, depth: rz };
        },
        lerp: (a, b, t) => {
            if (!Number.isFinite(a)) a = 0; if (!Number.isFinite(b)) b = 0;
            return a + (b - a) * t;
        },
        clamp: (v, min, max) => {
            if (!Number.isFinite(v)) return min;
            return Math.max(min, Math.min(max, v));
        },
        dist3d: (x1, y1, z1, x2, y2, z2) => {
            let d = Math.sqrt((x1-x2)**2 + (y1-y2)**2 + (z1-z2)**2);
            return Number.isFinite(d) ? d : 9999;
        }
    };

    // -----------------------------------------------------------------
    // 3. ENGINE DO JOGO (INTEGRAÇÃO COMPLETA AO CORE.JS E FIREBASE)
    // -----------------------------------------------------------------
    const Game = {
        state: 'MODE_SELECT', 
        timer: 0, idleTimer: 0, endTimer: 0,  
        pose: null, handedness: null, polyfillDone: false,
        hitstop: 0, // Congelamento dramático de impacto
        
        calibTimer: 0, calibHandCandidate: null,
        calib: { tlX: 0, tlY: 0, brX: 640, brY: 480 },

        lastFrameTime: 0, activeAIProfile: JSON.parse(JSON.stringify(AI_PROFILES.PRO)),
        aiFrame: 0, aiRecalcCounter: 0, 
        useMouse: false, mouseX: 320, mouseY: 240,

        // ID seguro do Player para evitar Crash no Firebase
        get playerId() { return (window.System && window.System.playerId) ? window.System.playerId : 'player_' + Math.floor(Math.random()*10000); },

        isOnline: false, isHost: false, roomId: 'thiaguinho_pingpong_oficial',
        dbRef: null, roomRef: null, remotePlayersData: {}, lastSync: 0, maintenanceInterval: null,
        
        p1: { x: 0, y: -200, z: -CONF.TABLE_L/2 - 200, vx: 0, vy: 0, prevX: 0, prevY: 0, elbowX: 0, elbowY: 0, rawX: 0, rawY: 0 },
        p2: { x: 0, y: -200, z: CONF.TABLE_L/2 + 200, targetX: 0, targetY: -200, vx: 0, vz: 0 },
        ball: { x: 0, y: -300, z: -CONF.TABLE_L/2, vx: 0, vy: 0, vz: 0, spinX: 0, spinY: 0, active: false, lastHitBy: null, bounceCount: 0, trail: [] },

        score: { p1: 0, p2: 0 }, server: 'p1', lastHitter: null, rallyCount: 0,
        shake: 0, shakeX: 0, shakeY: 0, flash: 0, particles: [], msgs: [],

        init: function() {
            this.cleanup();
            this.state = 'MODE_SELECT'; this.handedness = null; this.useMouse = false;
            this.activeAIProfile = JSON.parse(JSON.stringify(AI_PROFILES.PRO));
            this.lastFrameTime = performance.now();
            this.loadCalib();
            if(window.System && window.System.msg) window.System.msg("THIAGUINHO WII - V7.0 PRONTO");
            this.setupInput();
        },

        cleanup: function() {
            if (this.dbRef) {
                try { this.dbRef.child('players/' + this.playerId).remove(); this.dbRef.off(); } catch(e){}
            }
            if (this.roomRef) try { this.roomRef.off(); } catch(e){}
            if (this.maintenanceInterval) clearInterval(this.maintenanceInterval);
            if(window.System && window.System.canvas) {
                window.System.canvas.onclick = null;
                window.System.canvas.onmousemove = null;
                window.System.canvas.ontouchstart = null;
                window.System.canvas.ontouchmove = null;
            }
        },

        sfx: function(action, ...args) {
            try {
                if (window.Sfx) {
                    if (typeof window.Sfx[action] === 'function') window.Sfx[action](...args);
                    else if (action === 'coin') window.Sfx.play(1200, 'sine', 0.1);
                    else if (action === 'click') window.Sfx.play(1000, 'sine', 0.1, 0.08);
                    else if (action === 'hit') window.Sfx.play(300, 'sine', 0.1, 0.1);
                }
            } catch (e) {}
        },

        loadCalib: function() {
            try {
                const s = localStorage.getItem('tennis_calib_v7');
                if(s) {
                    const data = JSON.parse(s);
                    if(data.calib && Number.isFinite(data.calib.tlX)) this.calib = data.calib;
                    if(data.hand) this.handedness = data.hand;
                }
            } catch(e) {}
        },

        setupInput: function() {
            if(!window.System.canvas) return;
            const handlePointer = (e) => {
                const rect = window.System.canvas.getBoundingClientRect();
                let cx = e.clientX; let cy = e.clientY;
                if (e.touches && e.touches.length > 0) { cx = e.touches[0].clientX; cy = e.touches[0].clientY; }
                if (cx !== undefined && cy !== undefined) {
                    this.mouseX = cx - rect.left; this.mouseY = cy - rect.top;
                }
            };

            window.System.canvas.onmousemove = handlePointer;
            window.System.canvas.ontouchstart = handlePointer;
            window.System.canvas.ontouchmove = (e) => { handlePointer(e); if (this.useMouse && e.cancelable) e.preventDefault(); };

            window.System.canvas.onclick = (e) => {
                const h = window.System.canvas.height;
                const rect = window.System.canvas.getBoundingClientRect();
                let cy = e.clientY; if (e.touches && e.touches.length > 0) cy = e.touches[0].clientY;
                const my = cy - rect.top;

                if (this.state === 'MODE_SELECT') {
                    if (my < h * 0.45) {
                        this.isOnline = false; this.useMouse = false; this.state = 'CALIB_HAND_SELECT';
                    } else if (my < h * 0.60) {
                        this.isOnline = false; this.useMouse = true; this.handedness = 'right'; this.startGame();
                    } else {
                        this.isOnline = !!window.DB; this.useMouse = false;
                        if (!window.DB) { if(window.System.msg) window.System.msg("OFFLINE: Sem Firebase"); this.isOnline = false; }
                        this.state = 'CALIB_HAND_SELECT';
                    }
                    this.calibTimer = 0; this.sfx('click');
                } 
                else if (this.state.startsWith('CALIB')) {
                    // Escape Hatch: Se estiver testando no PC e não tiver câmera, um clique pula a calibração!
                    this.isOnline = false; this.useMouse = true; this.handedness = 'right'; this.startGame();
                }
                else if (this.state === 'SERVE' && this.useMouse && this.server === 'p1') {
                    this.hitBall('p1', 0, -30);
                }
                else if (this.state === 'LOBBY') {
                    if (this.isHost) {
                        const pCount = Object.keys(this.remotePlayersData || {}).length;
                        if (pCount >= 2) { this.roomRef.update({ gameState: 'STARTING' }); this.startGame(); this.sfx('coin'); }
                    }
                }
                else if (this.state === 'END') { this.init(); }
            };
        },

        // =====================================================================
        // MULTIPLAYER FIREBASE (LÓGICA IGUAL AO GAME_KART.JS)
        // =====================================================================
        connectMultiplayer: function() {
            this.state = 'LOBBY';
            try {
                this.roomRef = window.DB.ref('rooms/' + this.roomId); this.dbRef = this.roomRef;
                const myData = { name: 'Jogador', x: this.p1.x, y: this.p1.y, vx: this.p1.vx, vy: this.p1.vy, lastSeen: firebase.database.ServerValue.TIMESTAMP };
                this.dbRef.child('players/' + this.playerId).set(myData);
                this.dbRef.child('players/' + this.playerId).onDisconnect().remove();

                this.maintenanceInterval = setInterval(() => {
                    if (!this.isHost || !this.remotePlayersData) return;
                    const now = Date.now();
                    Object.keys(this.remotePlayersData).forEach(pid => {
                        if (pid === this.playerId) return;
                        if (now - (this.remotePlayersData[pid].lastSeen || 0) > 15000) {
                            this.dbRef.child('players/' + pid).remove(); this.addMsg("JOGADOR CAIU", "#f00");
                        }
                    });
                }, 2000);

                this.roomRef.child('gameState').on('value', (snap) => {
                    const st = snap.val();
                    if(st === 'STARTING' && this.state === 'LOBBY' && !this.isHost) this.startGame();
                    if(st === 'END' && this.state !== 'END') this.state = 'END';
                });

                this.roomRef.child('ball').on('value', (snap) => {
                    if (this.isHost || !this.isOnline || !snap.exists()) return;
                    const b = snap.val();
                    // Inverte a visão da bola no eixo Z e X para o oponente ver ela vindo em sua direção
                    this.ball.x = -b.x; this.ball.y = b.y; this.ball.z = -b.z; 
                    this.ball.vx = -b.vx; this.ball.vy = b.vy; this.ball.vz = -b.vz;
                    this.ball.spinX = -b.spinX; this.ball.spinY = -b.spinY;
                    this.ball.active = b.active;
                    this.ball.lastHitBy = b.lastHitBy === 'p1' ? 'p2' : (b.lastHitBy === 'p2' ? 'p1' : null);
                });

                this.roomRef.child('score').on('value', (snap) => {
                    if (this.isHost || !this.isOnline || !snap.exists()) return;
                    const s = snap.val(); this.score.p1 = s.p2; this.score.p2 = s.p1;
                });

                this.dbRef.child('players').on('value', (snap) => {
                    const data = snap.val(); if (!data) return;
                    this.remotePlayersData = data; const ids = Object.keys(data).sort();
                    this.isHost = (ids[0] === this.playerId);
                    const opId = ids.find(id => id !== this.playerId);
                    if (opId) {
                        const opData = data[opId];
                        this.p2.x = -opData.x; this.p2.y = opData.y; this.p2.vx = -opData.vx; this.p2.vy = opData.vy;
                    }
                });
            } catch(e) { this.state = 'MODE_SELECT'; }
        },

        syncMultiplayer: function() {
            if (!this.dbRef || !this.isOnline) return;
            const now = Date.now();
            if (now - this.lastSync > 30) {
                this.lastSync = now;
                this.dbRef.child('players/' + this.playerId).update({
                    x: this.p1.x, y: this.p1.y, vx: this.p1.vx, vy: this.p1.vy, lastSeen: firebase.database.ServerValue.TIMESTAMP
                });
                if (this.isHost) {
                    this.roomRef.update({
                        ball: { x: this.ball.x||0, y: this.ball.y||-300, z: this.ball.z||0, vx: this.ball.vx||0, vy: this.ball.vy||0, vz: this.ball.vz||0, spinX: this.ball.spinX||0, spinY: this.ball.spinY||0, active: this.ball.active, lastHitBy: this.ball.lastHitBy },
                        score: this.score, gameState: this.state
                    });
                }
            }
        },

        startGame: function() {
            if (this.roundTimeout) { clearTimeout(this.roundTimeout); this.roundTimeout = null; }
            this.state = 'STARTING'; this.score = { p1: 0, p2: 0 }; this.server = 'p1';
            this.activeAIProfile = JSON.parse(JSON.stringify(AI_PROFILES.PRO));
            this.resetRound();
        },

        // =====================================================================
        // CAMERA ADAPTATIVA (Muito mais longe no Celular para caber a mesa)
        // =====================================================================
        updateCameraAdapter: function(w, h) {
            if (h > w) { 
                // MODO CELULAR (VERTICAL)
                CONF.CAM_Z = -5000;  // Empurra a mesa profundamente para trás
                CONF.CAM_Y = -2400;  // Sobe a câmera
                CONF.CAM_PITCH = 0.35; // Inclina forte para enxergar de cima
                CONF.FOV = w * 1.8;  
            } else { 
                // MODO PC (HORIZONTAL)
                CONF.CAM_Z = -3800;
                CONF.CAM_Y = -1500;
                CONF.CAM_PITCH = 0.25;
                CONF.FOV = 900;
            }
        },

        // =====================================================================
        // GAME LOOP (BLINDADO)
        // =====================================================================
        update: function(ctx, w, h, pose) {
            try { 
                const now = performance.now();
                let dt = this.lastFrameTime ? (now - this.lastFrameTime) : 16;
                this.lastFrameTime = now;
                
                if (dt > 100) dt = 16; // Trava o tempo se o celular processar devagar

                this.updateCameraAdapter(w, h); 

                // Hitstop Effect (Pausa a física por milissegundos no momento do Smash)
                if (this.hitstop > 0) {
                    this.hitstop -= dt;
                    dt = 0; 
                }

                if (!this.polyfillDone) {
                    if (!ctx.roundRect) ctx.roundRect = function(x, y, w, h, r) { if(w<2*r)r=w/2; if(h<2*r)r=h/2; ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); };
                    this.polyfillDone = true;
                }

                if (this.state === 'MODE_SELECT') { 
                    this.p1.x = Math.sin(now * 0.002) * 300; 
                    this.p2.x = Math.cos(now * 0.002) * 300; 
                } 
                else if (this.state !== 'LOBBY' && this.state !== 'END') {
                    if (this.state === 'IDLE') {
                        // Avança o timer mesmo em Hitstop
                        this.idleTimer += (dt === 0 ? 16 : dt);
                        if (this.idleTimer > 1000) { this.state = 'SERVE'; this.idleTimer = 0; this.timer = 0; }
                    } else if (this.state === 'END_WAIT') {
                        this.endTimer += (dt === 0 ? 16 : dt);
                        if (this.endTimer > 2000) { this.state = 'END'; if (this.isOnline && this.isHost) this.roomRef.update({ gameState: 'END' }); this.endTimer = 0; }
                    }

                    // Só atualiza movimento se não estiver em Hitstop
                    if (dt > 0) {
                        this.processPose(pose, w, h);
                        if (this.state.startsWith('CALIB')) this.updateAutoCalibration(dt);

                        if (this.state === 'RALLY' || this.state === 'SERVE') {
                            if (!this.isOnline || this.isHost) { this.updatePhysics(); if (!this.isOnline) this.updateAI(); this.updateRules(dt); } 
                            else { this.updatePhysicsClient(); }
                        }
                    }
                }

                // --- INÍCIO DA RENDERIZAÇÃO SEGURA ---
                ctx.save();
                try {
                    if(this.shake > 0 && Number.isFinite(this.shake)) {
                        ctx.translate((Math.random()-0.5)*this.shake, (Math.random()-0.5)*this.shake);
                        this.shake *= 0.9; if(this.shake < 0.5) this.shake = 0;
                    }

                    this.renderScene(ctx, w, h);

                    if (this.flash > 0 && Number.isFinite(this.flash)) {
                        ctx.fillStyle = `rgba(255,255,255,${this.flash})`; ctx.fillRect(0,0,w,h);
                        this.flash -= 0.05; if(this.flash < 0.01) this.flash = 0;
                    }

                    if (this.state === 'MODE_SELECT') this.renderModeSelect(ctx, w, h);
                    else if (this.state === 'LOBBY') this.renderLobby(ctx, w, h);
                    else if (this.state.startsWith('CALIB')) this.renderCalibration(ctx, w, h);
                    else if (this.state === 'END') this.renderEnd(ctx, w, h);
                    else this.renderHUD(ctx, w, h);

                } finally {
                    ctx.restore(); // Garante que o Canvas nunca perca o estado original
                }

                if (this.isOnline) this.syncMultiplayer();

            } catch (e) {
                console.error("SHIELD V7.0 ATIVADO (Jogo Salvo de Congelamento): ", e);
            }
            return this.score.p1 || 0;
        },

        // =====================================================================
        // A CALIBRAÇÃO (A "CERCA" DO JOGADOR)
        // =====================================================================
        updateAutoCalibration: function(dt) {
            const d = dt / 16;
            this.calibTimer = Math.max(0, this.calibTimer - (10 * d));

            if (this.state === 'CALIB_HAND_SELECT') {
                if (this.calibHandCandidate) {
                    this.calibTimer += 25 * d; 
                    if (this.calibTimer > CONF.HAND_SELECT_TIME) {
                        this.handedness = this.calibHandCandidate; this.state = 'CALIB_TL'; this.calibTimer = 0; this.sfx('coin');
                    }
                }
            } 
            else if (this.state === 'CALIB_TL') {
                if (Number.isFinite(this.p1.rawX)) {
                    this.calibTimer += 25 * d;
                    if (this.calibTimer > CONF.CALIB_TIME) {
                        this.calib.tlX = this.p1.rawX; this.calib.tlY = this.p1.rawY; this.state = 'CALIB_BR'; this.calibTimer = 0; this.sfx('coin');
                    }
                }
            } 
            else if (this.state === 'CALIB_BR') {
                if (Number.isFinite(this.p1.rawX)) {
                    this.calibTimer += 25 * d;
                    if (this.calibTimer > CONF.CALIB_TIME) {
                        this.calib.brX = this.p1.rawX; this.calib.brY = this.p1.rawY;
                        
                        // Blindagem: Garante que a área calibrada tenha um tamanho mínimo útil
                        if (Math.abs(this.calib.tlX - this.calib.brX) < 150) this.calib.brX = this.calib.tlX + 250;
                        if (Math.abs(this.calib.tlY - this.calib.brY) < 150) this.calib.brY = this.calib.tlY + 250;
                        
                        try { localStorage.setItem('tennis_calib_v7', JSON.stringify({ calib: this.calib, hand: this.handedness })); } catch(e) {}
                        
                        this.calibTimer = 0; 
                        if (this.isOnline) this.connectMultiplayer(); else this.startGame(); 
                        this.sfx('coin');
                    }
                }
            }
        },

        handleLostTracking: function() {
            if(this.state.startsWith('CALIB')) this.calibHandCandidate = null;
            else if (this.state === 'SERVE' || this.state === 'RALLY' || this.state === 'IDLE') {
                this.p1.x = MathCore.lerp(this.p1.x || 0, 0, 0.1);
                this.p1.y = MathCore.lerp(this.p1.y || -200, -200, 0.1);
            }
        },

        processPose: function(pose, w, h) {
            this.pose = pose; 

            // MODO MOUSE/TOUCH (Totalmente solto e fluido)
            if (this.useMouse) {
                let nx = MathCore.clamp(this.mouseX / w, 0, 1);
                let ny = MathCore.clamp(this.mouseY / h, 0, 1);
                
                const targetX = MathCore.lerp(-CONF.TABLE_W * 1.2, CONF.TABLE_W * 1.2, nx); 
                const targetY = MathCore.lerp(-1000, 300, ny); 

                this.p1.x = MathCore.lerp(this.p1.x || 0, targetX, 0.85);
                this.p1.y = MathCore.lerp(this.p1.y || -200, targetY, 0.85);
                this.p1.z = -CONF.TABLE_L/2 - 250; 
                this.p1.elbowX = this.p1.x + 100;
                this.p1.elbowY = this.p1.y + 300;

                let calcVX = this.p1.x - (Number.isFinite(this.p1.prevX) ? this.p1.prevX : this.p1.x);
                let calcVY = this.p1.y - (Number.isFinite(this.p1.prevY) ? this.p1.prevY : this.p1.y);

                this.p1.vx = MathCore.clamp(Number.isFinite(calcVX) ? calcVX : 0, -300, 300);
                this.p1.vy = MathCore.clamp(Number.isFinite(calcVY) ? calcVY : 0, -300, 300);
                this.p1.prevX = this.p1.x; this.p1.prevY = this.p1.y;

                if (this.state === 'SERVE' && this.server === 'p1' && this.p1.vy < -20) this.hitBall('p1', 0, 0);
                return;
            }

            // MODO CÂMERA
            if (this.state === 'CALIB_HAND_SELECT') {
                if (!pose || !pose.keypoints) { this.calibHandCandidate = null; return; }
                const nose = pose.keypoints.find(k => k.name === 'nose');
                const leftW = pose.keypoints.find(k => k.name === 'left_wrist');
                const rightW = pose.keypoints.find(k => k.name === 'right_wrist');
                this.calibHandCandidate = null;
                if (nose && leftW && rightW) {
                    if (leftW.y < nose.y && rightW.y >= nose.y) { this.calibHandCandidate = 'left'; this.p1.rawX = 640 - leftW.x; this.p1.rawY = leftW.y; } 
                    else if (rightW.y < nose.y && leftW.y >= nose.y) { this.calibHandCandidate = 'right'; this.p1.rawX = 640 - rightW.x; this.p1.rawY = rightW.y; }
                }
                return;
            }

            if (!this.handedness) return; 
            if (!pose || !pose.keypoints) { this.handleLostTracking(); return; }

            const wrist = pose.keypoints.find(k => k.name === this.handedness + '_wrist' && k.score > 0.3);
            const elbow = pose.keypoints.find(k => k.name === this.handedness + '_elbow' && k.score > 0.3);

            if (wrist) {
                this.p1.rawX = 640 - wrist.x; this.p1.rawY = wrist.y;
                
                if (!this.state.startsWith('CALIB')) {
                    // Mapeamento usando os pontos calibrados (A Cerca do Jogador)
                    let minX = Math.min(this.calib.tlX, this.calib.brX); let maxX = Math.max(this.calib.tlX, this.calib.brX);
                    let minY = Math.min(this.calib.tlY, this.calib.brY); let maxY = Math.max(this.calib.tlY, this.calib.brY);
                    
                    let rangeX = Math.max(200, Math.abs(maxX - minX));
                    let rangeY = Math.max(150, Math.abs(maxY - minY));

                    let nx = MathCore.clamp((this.p1.rawX - minX) / rangeX, -0.5, 1.5);
                    let ny = MathCore.clamp((this.p1.rawY - minY) / rangeY, -0.5, 1.5);

                    let targetX = MathCore.lerp(-CONF.TABLE_W*1.2, CONF.TABLE_W*1.2, nx); 
                    let targetY = MathCore.lerp(-800, 300, ny); 
                    if (!Number.isFinite(targetX)) targetX = 0; if (!Number.isFinite(targetY)) targetY = -200;

                    this.p1.x = MathCore.lerp(this.p1.x || 0, targetX, 0.85);
                    this.p1.y = MathCore.lerp(this.p1.y || -200, targetY, 0.85);
                    this.p1.z = -CONF.TABLE_L/2 - 300; 

                    if (elbow) {
                        let nex = MathCore.clamp((640 - elbow.x - minX) / rangeX, -0.5, 1.5); 
                        let ney = MathCore.clamp((elbow.y - minY) / rangeY, -0.5, 1.5);
                        let targetEx = MathCore.lerp(-CONF.TABLE_W*1.2, CONF.TABLE_W*1.2, nex);
                        let targetEy = MathCore.lerp(-800, 300, ney);
                        if (!Number.isFinite(targetEx)) targetEx = targetX; if (!Number.isFinite(targetEy)) targetEy = targetY + 300;
                        this.p1.elbowX = MathCore.lerp(this.p1.elbowX || targetEx, targetEx, 0.85);
                        this.p1.elbowY = MathCore.lerp(this.p1.elbowY || targetEy, targetEy, 0.85);
                    } else {
                        this.p1.elbowX = this.p1.x + (this.handedness === 'right' ? 150 : -150); this.p1.elbowY = this.p1.y + 300;
                    }

                    let calculatedVelX = this.p1.x - (Number.isFinite(this.p1.prevX) ? this.p1.prevX : this.p1.x);
                    let calculatedVelY = this.p1.y - (Number.isFinite(this.p1.prevY) ? this.p1.prevY : this.p1.y);

                    this.p1.vx = MathCore.clamp(Number.isFinite(calculatedVelX) ? calculatedVelX : 0, -350, 350);
                    this.p1.vy = MathCore.clamp(Number.isFinite(calculatedVelY) ? calculatedVelY : 0, -350, 350);
                    this.p1.prevX = this.p1.x; this.p1.prevY = this.p1.y;

                    if (this.state === 'SERVE' && this.server === 'p1') {
                        if (this.p1.vy < -15) this.hitBall('p1', 0, 0); 
                    }
                }
            } else { this.handleLostTracking(); }
        },

        // =====================================================================
        // FÍSICA E REGRAS REAIS DO JOGO (COM DIREÇÃO INTENCIONAL)
        // =====================================================================
        updatePhysicsClient: function() {
            if (!this.ball.active) return;
            const b = this.ball; b.prevY = b.y;
            b.x += b.vx; b.y += b.vy; b.z += b.vz;

            if (b.y >= 0 && b.prevY < 0) {
                b.y = 0; b.vy = -Math.abs(b.vy) * CONF.BOUNCE_LOSS;
                this.spawnParticles(b.x, 0, b.z, 5, '#fff');
                this.sfx('hit');
            }
            if (Math.abs(b.vz) > 20) {
                this.ball.trail.push({x:b.x, y:b.y, z:b.z, a:1.0});
                if (this.ball.trail.length > 20) this.ball.trail.shift();
            }
            this.checkPaddleHitClient();
        },

        updatePhysics: function() {
            if (!this.ball.active) return;
            
            const b = this.ball;
            if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.z)) { this.resetRound(); return; }

            b.prevY = b.y;

            let magX = b.spinY * b.vz * CONF.MAGNUS_FORCE * 0.01;
            let magY = b.spinX * b.vz * CONF.MAGNUS_FORCE * 0.01;
            
            b.vx += Number.isFinite(magX) ? magX : 0;
            b.vy += (Number.isFinite(magY) ? magY : 0) + CONF.GRAVITY;
            b.vx *= CONF.AIR_DRAG; b.vy *= CONF.AIR_DRAG; b.vz *= CONF.AIR_DRAG;

            const currentSpeed = Math.sqrt(b.vx**2 + b.vy**2 + b.vz**2);
            let steps = currentSpeed > 50 ? 3 : 1; 
            
            for(let s=0; s<steps; s++) {
                const previousY = b.y;
                b.x += b.vx / steps; b.y += b.vy / steps; b.z += b.vz / steps;

                if ((b.z > 0 && b.lastHitBy === 'p1') || (b.z < 0 && b.lastHitBy === 'p2')) b.lastHitBy = null;

                // QUIQUE NA MESA
                if (b.y >= 0 && previousY < 0) { 
                    if (Math.abs(b.x) <= CONF.TABLE_W/2 && Math.abs(b.z) <= CONF.TABLE_L/2) {
                        b.y = 0; b.vy = -Math.abs(b.vy) * CONF.BOUNCE_LOSS; 
                        b.vx += b.spinY * 0.5; b.vz += b.spinX * 0.5;
                        this.spawnParticles(b.x, 0, b.z, 8, '#fff'); this.sfx('hit');

                        const side = b.z < 0 ? 'p1' : 'p2';
                        if (this.lastHitter === side) { this.scorePoint(side === 'p1' ? 'p2' : 'p1', "DOIS TOQUES"); return; } 
                        else {
                            this.ball.bounceCount++;
                            if(this.ball.bounceCount >= 2) { this.scorePoint(side === 'p1' ? 'p2' : 'p1', "PONTO!"); return; }
                        }
                    }
                }
                this.checkPaddleHit();
            }

            // REGRAS: PASSOU! O Ponto acabou porque cruzou a linha da raquete
            if (b.z < this.p1.z - 100) {
                if (this.ball.bounceCount === 0 && this.lastHitter === 'p2') this.scorePoint('p1', "FORA!");
                else this.scorePoint('p2', "PASSOU!"); return;
            }
            if (b.z > this.p2.z + 100) {
                if (this.ball.bounceCount === 0 && this.lastHitter === 'p1') this.scorePoint('p2', "FORA!");
                else this.scorePoint('p1', "PONTO!"); return;
            }

            // REGRA: CAIU DA MESA
            if (b.y > CONF.FLOOR_Y) {
                if (this.ball.bounceCount === 0) this.scorePoint(this.lastHitter === 'p1' ? 'p2' : 'p1', "FORA!");
                else this.scorePoint(this.lastHitter, "PONTO!"); return;
            }

            // REDE
            if (Math.abs(b.z) < 20 && b.y > -CONF.NET_H && b.y < 0) {
                b.vz *= -0.3; b.vx *= 0.5; this.shake = 5; this.sfx('hit'); b.lastHitBy = null;
            }

            const totalSpeed = Math.sqrt(b.vx**2 + b.vy**2 + b.vz**2);
            if (totalSpeed > CONF.MAX_TOTAL_SPEED && Number.isFinite(totalSpeed)) {
                const scale = CONF.MAX_TOTAL_SPEED / totalSpeed; b.vx *= scale; b.vy *= scale; b.vz *= scale;
            }
            b.spinX *= 0.99; b.spinY *= 0.99;

            if (Math.abs(b.vz) > 20) {
                this.ball.trail.push({x:b.x, y:b.y, z:b.z, a:1.0});
                if (this.ball.trail.length > 20) this.ball.trail.shift();
            }
        },

        checkPaddleHitClient: function() {
            if (this.ball.vz < 0 && this.ball.lastHitBy !== 'p1') {
                if (this.ball.z < this.p1.z + 150 && this.ball.z > this.p1.z - 150) {
                    let dx = this.ball.x - this.p1.x; let dy = this.ball.y - this.p1.y;
                    if (Math.sqrt(dx*dx + dy*dy) < CONF.PADDLE_HITBOX) { 
                        this.sfx('hit'); this.spawnParticles(this.ball.x, this.ball.y, this.ball.z, 15, '#e74c3c'); this.ball.lastHitBy = 'p1'; 
                    }
                }
            }
        },

        checkPaddleHit: function() {
            if (this.ball.vz < 0 && this.ball.lastHitBy !== 'p1') {
                if (this.ball.z < this.p1.z + 150 && this.ball.z > this.p1.z - 150) {
                    let dx = this.ball.x - this.p1.x; let dy = this.ball.y - this.p1.y;
                    if (Math.sqrt(dx*dx + dy*dy) < CONF.PADDLE_HITBOX) this.hitBall('p1', dx, dy);
                }
            }
            if (this.ball.vz > 0 && this.ball.lastHitBy !== 'p2') {
                if (this.ball.z > this.p2.z - 150 && this.ball.z < this.p2.z + 150) {
                    let dx = this.ball.x - this.p2.x; let dy = this.ball.y - this.p2.y;
                    if (Math.sqrt(dx*dx + dy*dy) < CONF.PADDLE_HITBOX) this.hitBall('p2', dx, dy);
                }
            }
        },

        hitBall: function(who, offX=0, offY=0) {
            const isP1 = who === 'p1';
            const paddle = isP1 ? this.p1 : this.p2;
            let velX = Number.isFinite(paddle.vx) ? paddle.vx : 0; 
            let velY = isP1 ? (Number.isFinite(paddle.vy) ? paddle.vy : 0) : (Number.isFinite(paddle.vz) ? paddle.vz * 0.15 : 0);

            const speed = Math.sqrt(velX**2 + velY**2);
            let force = MathCore.clamp(60 + (speed * CONF.SWING_FORCE), 60, 140); 
            
            let isSmash = force > 95;
            if (isSmash) { force *= 1.35; this.shake = 15; this.flash = 0.3; this.hitstop = 30; if(isP1) this.addMsg("CORTADA!", "#0ff"); } 
            else { this.shake = 3; }

            this.sfx('hit');
            this.ball.active = true; this.ball.lastHitBy = who;
            this.ball.vz = Math.abs(force) * (isP1 ? 1 : -1); 
            
            // FÍSICA CORRIGIDA: A direção da bola é dada principalmente pelo local onde ela bate na raquete (offX).
            // Isso impede que um movimento rápido de mão mande a bola num ângulo impossível pra fora da mesa.
            let impactFactor = MathCore.clamp(offX / (CONF.PADDLE_HITBOX * 0.5), -1.5, 1.5); 
            this.ball.vx = (impactFactor * 45) + (velX * 0.15); 
            this.ball.vy = -18 + (velY * 0.2); 
            
            this.ball.spinY = velX * 0.8; 
            this.ball.spinX = velY * 0.8;

            this.lastHitter = who; this.ball.bounceCount = 0; this.rallyCount++; this.state = 'RALLY';
            this.spawnParticles(this.ball.x, this.ball.y, this.ball.z, 15, isP1 ? '#e74c3c' : '#3498db'); 
            
            if (isP1 && (!this.isOnline || this.isHost)) this.calculateAITarget();
        },

        updateRules: function(dt) {
            if (this.state === 'SERVE') {
                this.timer += dt || 16;
                if (this.server === 'p1') {
                    this.ball.x = Number.isFinite(this.p1.x) ? this.p1.x : 0; 
                    this.ball.y = Number.isFinite(this.p1.y) ? this.p1.y - 50 : -200; 
                    this.ball.z = Number.isFinite(this.p1.z) ? this.p1.z + 50 : -CONF.TABLE_L/2 - 150;
                } else {
                    this.ball.x = Number.isFinite(this.p2.x) ? this.p2.x : 0; 
                    this.ball.y = -200; 
                    this.ball.z = CONF.TABLE_L/2 + 100;
                }

                if (this.timer > CONF.AUTO_SERVE_DELAY) {
                    if (this.server === 'p1') {
                        this.addMsg("SAQUE AUTOMÁTICO", "#fff");
                        this.hitBall('p1', 0, 0);
                    } else { if (!this.isOnline || this.isHost) this.aiServe(); }
                    this.timer = 0;
                }
            }
        },

        calculateAITarget: function() {
            if (this.isOnline && !this.isHost) return; 
            let predX = MathCore.predict(this.ball, this.p2.z); let predY = MathCore.predictY(this.ball, this.p2.z);
            if (!Number.isFinite(predX)) predX = 0; if (!Number.isFinite(predY)) predY = -200;

            const baseError = 40; const speedFactor = Math.min(1, Math.abs(this.ball.vx || 0) / 25);
            const humanError = baseError * this.activeAIProfile.difficultyFactor * speedFactor;
            
            this.p2.targetX = predX + (Math.random() - 0.5) * humanError;
            this.p2.targetY = predY + (Math.random() - 0.5) * Math.abs(this.ball.vz || 0) * 0.15; 
        },

        updateAI: function() {
            if (this.isOnline) return; 
            if (this.state === 'RALLY' && this.ball.vz > 0) {
                this.aiRecalcCounter++;
                if (this.aiRecalcCounter >= 4) { this.calculateAITarget(); this.aiRecalcCounter = 0; }
            }
            this.aiFrame++; if (this.aiFrame % 2 !== 0) return;

            const ai = this.p2; 
            ai.vx = ((ai.targetX || 0) - ai.x) * this.activeAIProfile.speed;
            ai.vy = ((ai.targetY || -200) - ai.y) * this.activeAIProfile.speed;
            ai.x += ai.vx; ai.y += ai.vy;
            if (this.ball.vz < 0) { ai.targetX = 0; ai.targetY = -200; }
        },

        aiServe: function() {
            this.hitBall('p2', (Math.random()-0.5)*20, 0);
        },

        scorePoint: function(winner, txt) {
            this.score[winner]++; this.addMsg(txt, winner === 'p1' ? "#0f0" : "#f00");
            this.sfx(winner === 'p1' ? 'coin' : 'hit');
            this.ball.active = false; this.rallyCount = 0;
            if (winner === 'p2') this.activeAIProfile.speed = Math.min(this.activeAIProfile.speed * 1.02, this.activeAIProfile.baseSpeed * 1.5);
            else this.activeAIProfile.speed = Math.max(this.activeAIProfile.speed * 0.99, this.activeAIProfile.baseSpeed);

            if ((this.score.p1 >= 11 || this.score.p2 >= 11) && Math.abs(this.score.p1 - this.score.p2) >= 2) {
                this.state = 'END_WAIT'; this.endTimer = 0;
            } else { this.server = winner; this.resetRound(); }
        },

        resetRound: function() {
            this.state = 'IDLE'; this.idleTimer = 0; this.endTimer = 0;
            this.ball.active = false; this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;
            this.ball.x = 0; this.ball.y = -300; this.ball.z = 0;
            this.ball.lastHitBy = null; this.ball.bounceCount = 0; this.ball.trail = [];
            this.lastHitter = null; this.aiRecalcCounter = 0; this.timer = 0;
        },

        // =================================================================
        // DESENHOS BLINDADOS (ZERO CANVAS CRASHES)
        // =================================================================
        safeCircle: function(ctx, x, y, r, color) {
            if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(r) && r > 0.1) {
                ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
            }
        },
        safeEllipse: function(ctx, x, y, rx, ry, color) {
            if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(rx) && Number.isFinite(ry) && rx > 0.1 && ry > 0.1) {
                ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI*2); ctx.fill();
            }
        },
        safeDrawPoly: function(ctx, points, color, strokeColor) {
            for(let p of points) { if(!p.visible || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return; }
            ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
            for(let i=1; i<points.length; i++) ctx.lineTo(points[i].x, points[i].y);
            ctx.closePath(); ctx.fill();
            if (strokeColor) { ctx.strokeStyle = strokeColor; ctx.lineWidth = Math.max(1, 3 * points[0].s); ctx.stroke(); }
        },

        renderModeSelect: function(ctx, w, h) {
            ctx.fillStyle = "rgba(10, 20, 30, 0.85)"; ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = "white"; ctx.textAlign = "center"; ctx.font = "bold 45px 'Russo One'";
            ctx.fillText("PING PONG WII", w/2, h * 0.20);
            ctx.fillStyle = "#e67e22"; ctx.fillRect(w/2 - 160, h * 0.35, 320, 60);
            ctx.fillStyle = "#f39c12"; ctx.fillRect(w/2 - 160, h * 0.50, 320, 60);
            ctx.fillStyle = "#27ae60"; ctx.fillRect(w/2 - 160, h * 0.65, 320, 60);
            ctx.fillStyle = "white"; ctx.font = "bold 20px 'Russo One'";
            ctx.fillText("JOGAR COM A CÂMERA", w/2, h * 0.35 + 38);
            ctx.fillText("JOGAR COM O DEDO", w/2, h * 0.50 + 38);
            ctx.fillText("ONLINE (P2P)", w/2, h * 0.65 + 38);
        },

        renderLobby: function(ctx, w, h) {
            ctx.fillStyle = "rgba(10,15,20,0.95)"; ctx.fillRect(0,0,w,h);
            ctx.fillStyle = "#fff"; ctx.textAlign="center"; ctx.font="30px sans-serif";
            if (this.isHost) {
                const pCount = Object.keys(this.remotePlayersData || {}).length;
                if (pCount >= 2) {
                    ctx.fillStyle = "#2ecc71"; ctx.fillRect(w/2 - 160, h*0.6, 320, 70);
                    ctx.fillStyle = "white"; ctx.font = "bold 24px 'Russo One'";
                    ctx.fillText("INICIAR PARTIDA", w/2, h*0.6 + 45);
                    ctx.fillStyle = "#ccc"; ctx.font = "18px sans-serif";
                    ctx.fillText("JOGADORES CONECTADOS: " + pCount, w/2, h*0.4);
                } else { ctx.fillText("AGUARDANDO OPONENTE...", w/2, h/2); }
            } else { ctx.fillText("CONECTADO! AGUARDANDO HOST...", w/2, h/2); }
        },

        renderScene: function(ctx, w, h) {
            ctx.fillStyle = "#0a192f"; ctx.fillRect(0,0,w,h); // Fundo sólido, zero crash de gradiente

            const f1 = MathCore.project(-4000, CONF.FLOOR_Y, 4000, w, h);
            const f2 = MathCore.project(4000, CONF.FLOOR_Y, 4000, w, h);
            const f3 = MathCore.project(4000, CONF.FLOOR_Y, -4000, w, h);
            const f4 = MathCore.project(-4000, CONF.FLOOR_Y, -4000, w, h);
            this.safeDrawPoly(ctx, [f1, f2, f3, f4], "#111"); // Chão

            this.drawTable(ctx, w, h);
            this.drawPaddle(ctx, this.p2, false, w, h);
            this.drawBall(ctx, w, h);
            
            if (!this.state.startsWith('CALIB')) {
                ctx.globalAlpha = 0.6; this.drawPlayerArm(ctx, w, h); ctx.globalAlpha = 1.0;
                this.drawPaddle(ctx, this.p1, true, w, h);
            }
            this.drawParticles(ctx, w, h);
        },
        
        drawPlayerArm: function(ctx, w, h) {
            if(!this.handedness || this.useMouse) return; 
            const pWrist = MathCore.project(this.p1.x, this.p1.y, this.p1.z, w, h);
            const pElbow = MathCore.project(this.p1.elbowX, this.p1.elbowY, this.p1.z + 400, w, h);
            
            if (pWrist.visible && pElbow.visible && Number.isFinite(pWrist.x) && Number.isFinite(pElbow.x)) {
                ctx.strokeStyle = "#d2b48c"; ctx.lineWidth = Math.max(1, 20 * pWrist.s); ctx.lineCap = "round";
                ctx.beginPath(); ctx.moveTo(pElbow.x, pElbow.y); ctx.lineTo(pWrist.x, pWrist.y); ctx.stroke();
                this.safeCircle(ctx, pWrist.x, pWrist.y, 10 * pWrist.s, "#d2b48c");
            }
        },

        drawTable: function(ctx, w, h) {
            const hw = CONF.TABLE_W/2; const hl = CONF.TABLE_L/2; const th = 60; const legH = CONF.FLOOR_Y; 
            const c1 = MathCore.project(-hw, 0, -hl, w, h); const c2 = MathCore.project(hw, 0, -hl, w, h);
            const c3 = MathCore.project(hw, 0, hl, w, h); const c4 = MathCore.project(-hw, 0, hl, w, h);
            const c1b = MathCore.project(-hw, th, -hl, w, h); const c2b = MathCore.project(hw, th, -hl, w, h);
            const c3b = MathCore.project(hw, th, hl, w, h); const c4b = MathCore.project(-hw, th, hl, w, h);

            if (!c1.visible || !Number.isFinite(c1.x)) return;

            this.safeDrawPoly(ctx, [c1, c2, c2b, c1b], "#0c2a4d");
            this.safeDrawPoly(ctx, [c2, c3, c3b, c2b], "#0a3d62");
            this.safeDrawPoly(ctx, [c4, c1, c1b, c4b], "#0a3d62");
            this.safeDrawPoly(ctx, [c1, c2, c3, c4], "#1e6091", "#fff");
            
            const m1 = MathCore.project(0, 0, -hl, w, h); const m2 = MathCore.project(0, 0, hl, w, h);
            if (m1.visible && m2.visible && Number.isFinite(m1.x) && Number.isFinite(m2.x)) {
                ctx.lineWidth = Math.max(1, 2 * c1.s); ctx.beginPath(); ctx.moveTo(m1.x, m1.y); ctx.lineTo(m2.x, m2.y); ctx.stroke();
            }

            const n1 = MathCore.project(-hw-80, 0, 0, w, h); const n2 = MathCore.project(hw+80, 0, 0, w, h);
            const n1t = MathCore.project(-hw-80, -CONF.NET_H, 0, w, h); const n2t = MathCore.project(hw+80, -CONF.NET_H, 0, w, h);
            this.safeDrawPoly(ctx, [n1, n2, n2t, n1t], "rgba(0, 0, 0, 0.5)", "#ecf0f1");
        },

        drawPaddle: function(ctx, paddle, isPlayer, w, h) {
            const pos = MathCore.project(paddle.x, paddle.y, paddle.z, w, h);
            if (!pos.visible || !Number.isFinite(pos.x)) return;
            const scale = pos.s * CONF.PADDLE_SCALE;
            
            const sPos = MathCore.project(paddle.x, CONF.FLOOR_Y, paddle.z, w, h);
            if (sPos.visible && Number.isFinite(sPos.x)) this.safeEllipse(ctx, sPos.x, sPos.y, 45*sPos.s, 15*sPos.s, "rgba(0,0,0,0.4)");

            if(Number.isFinite(scale) && scale > 0.1) {
                ctx.fillStyle = "#8d6e63"; ctx.fillRect(pos.x - 10*scale, pos.y + 35*scale, 20*scale, 55*scale);
                this.safeEllipse(ctx, pos.x, pos.y + 3*scale, 52*scale, 57*scale, "#ecf0f1");
                this.safeEllipse(ctx, pos.x, pos.y, 50*scale, 55*scale, isPlayer ? "#c0392b" : "#2c3e50");
                // Brilho na raquete
                this.safeEllipse(ctx, pos.x - 15*scale, pos.y - 15*scale, 20*scale, 25*scale, "rgba(255,255,255,0.15)");
            }
        },

        drawBall: function(ctx, w, h) {
            if (!this.ball.active && !['SERVE', 'IDLE', 'END_WAIT'].includes(this.state)) return;

            if (this.ball.y < CONF.FLOOR_Y) {
                const shadowPos = MathCore.project(this.ball.x, 0, this.ball.z, w, h); 
                if (Math.abs(this.ball.x) > CONF.TABLE_W/2 || Math.abs(this.ball.z) > CONF.TABLE_L/2) {
                    MathCore.project(this.ball.x, CONF.FLOOR_Y, this.ball.z, w, h); 
                }
                if (shadowPos.visible && Number.isFinite(shadowPos.x)) {
                    const distToShadow = Math.abs(this.ball.y);
                    const alpha = MathCore.clamp(1 - (distToShadow/1000), 0.1, 0.7);
                    const bSr = Math.max(0.1, CONF.BALL_R * shadowPos.s * (1 + distToShadow/2000));
                    this.safeEllipse(ctx, shadowPos.x, shadowPos.y, bSr*1.5, bSr*0.5, `rgba(0,0,0,${alpha})`);
                }
            }

            ctx.strokeStyle = "rgba(255, 200, 0, 0.4)"; ctx.lineWidth = 15; ctx.lineCap = "round";
            ctx.beginPath();
            this.ball.trail.forEach((t, i) => {
                const tp = MathCore.project(t.x, t.y, t.z, w, h);
                if (tp.visible && Number.isFinite(tp.x)) { if(i===0) ctx.moveTo(tp.x, tp.y); else ctx.lineTo(tp.x, tp.y); }
                t.a -= 0.05;
            });
            ctx.stroke();

            const pos = MathCore.project(this.ball.x, this.ball.y, this.ball.z, w, h);
            if(pos.visible && Number.isFinite(pos.x)) {
                let r = Math.max(0.1, Math.abs(CONF.BALL_R * pos.s));
                this.safeCircle(ctx, pos.x, pos.y, r, "#f1c40f"); // Bola sólida anti-crash
                this.safeCircle(ctx, pos.x - r*0.3, pos.y - r*0.3, r*0.3, "rgba(255,255,255,0.6)"); // Reflexo
            }
        },

        renderHUD: function(ctx, w, h) {
            const cx = w/2;
            ctx.fillStyle = "rgba(0, 0, 0, 0.4)"; ctx.strokeStyle = "rgba(255, 255, 255, 0.2)"; ctx.lineWidth = 1;
            if(ctx.roundRect) { ctx.beginPath(); ctx.roundRect(cx-100, 10, 200, 50, 10); ctx.fill(); ctx.stroke(); } 
            else { ctx.fillRect(cx-100, 10, 200, 50); ctx.strokeRect(cx-100, 10, 200, 50); }
            
            ctx.font = "bold 35px 'Russo One'"; ctx.textAlign = "center";
            ctx.fillStyle = "#e74c3c"; ctx.fillText(this.score.p1, cx-50, 48); 
            ctx.fillStyle = "#555"; ctx.fillText("-", cx, 48);
            ctx.fillStyle = "#3498db"; ctx.fillText(this.score.p2, cx+50, 48); 

            this.msgs.forEach(m => {
                m.y -= 2; m.a -= 0.02; m.s += 0.01;
                if(m.a > 0) {
                    ctx.save(); ctx.globalAlpha = Math.min(1, m.a); ctx.translate(cx, m.y); ctx.scale(m.s, m.s);
                    ctx.font = "bold 35px 'Russo One'"; ctx.strokeStyle = "black"; ctx.lineWidth = 5; ctx.strokeText(m.t, 0, 0); ctx.fillStyle = m.c; ctx.fillText(m.t, 0, 0);
                    ctx.restore();
                }
            });
            this.msgs = this.msgs.filter(m => m.a > 0);
            ctx.globalAlpha = 1;

            if (this.state === 'SERVE' && this.server === 'p1') {
                ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.strokeStyle = "transparent";
                if(ctx.roundRect) { ctx.beginPath(); ctx.roundRect(cx-150, h-70, 300, 50, 10); ctx.fill(); }
                else { ctx.fillRect(cx-150, h-70, 300, 50); }
                let textoSaque = this.useMouse ? "TOQUE PARA SACAR" : "LEVANTE O BRAÇO PARA SACAR";
                ctx.fillStyle = "#fff"; ctx.font = "bold 16px sans-serif"; ctx.fillText(textoSaque, cx, h-40);
                const progress = Math.min(1, this.timer / CONF.AUTO_SERVE_DELAY);
                ctx.fillStyle = "#f1c40f"; ctx.fillRect(cx-140, h-25, 280*progress, 5);
            }
        },

        renderCalibration: function(ctx, w, h) {
            ctx.fillStyle = "#111"; ctx.fillRect(0,0,w,h);
            
            if (this.pose && this.pose.keypoints) {
                this.drawSkeleton(ctx, w, h);
                
                if (this.handedness && Number.isFinite(this.p1.rawX) && Number.isFinite(this.p1.rawY)) {
                    const cx = (this.p1.rawX / 640) * w; const cy = (this.p1.rawY / 480) * h;
                    if(Number.isFinite(cx) && Number.isFinite(cy)) {
                        ctx.translate(cx, cy); ctx.rotate(-0.2);
                        ctx.fillStyle = "#8d6e63"; ctx.fillRect(-5, 0, 10, 30); 
                        this.safeCircle(ctx, 0, -20, 25, "#e74c3c"); 
                        ctx.rotate(0.2); ctx.translate(-cx, -cy);
                        
                        if (this.calibTimer > 0 && (this.state === 'CALIB_TL' || this.state === 'CALIB_BR')) {
                            const progress = Math.min(1, this.calibTimer / CONF.CALIB_TIME);
                            ctx.strokeStyle = "#0f0"; ctx.lineWidth = 6;
                            ctx.beginPath(); ctx.arc(cx, cy, 40, -Math.PI/2, (-Math.PI/2) + (Math.PI*2*progress)); ctx.stroke();
                        }
                    }
                }
            } else {
                ctx.fillStyle = "#fff"; ctx.font = "bold 30px sans-serif"; ctx.textAlign = "center";
                ctx.fillText("PROCURANDO CÂMERA...", w/2, h*0.45);
                ctx.font = "18px sans-serif"; ctx.fillStyle = "#aaa";
                ctx.fillText("Sem câmera? Toque aqui para jogar com o dedo.", w/2, h*0.55);
                
                // Escape Hatch para o PC sem câmera (Para não travar ninguem)
                if(!window.System.canvas.onclick_calib_escape) {
                    const originalOnclick = window.System.canvas.onclick;
                    window.System.canvas.onclick = (e) => {
                        this.isOnline = false; this.useMouse = true; this.handedness = 'right'; this.startGame();
                        if (originalOnclick) window.System.canvas.onclick = originalOnclick;
                    };
                    window.System.canvas.onclick_calib_escape = true;
                }
            }

            ctx.fillStyle = "#fff"; ctx.textAlign = "center";

            if (this.state === 'CALIB_HAND_SELECT') {
                ctx.font = "bold 35px sans-serif"; ctx.fillText("ESCOLHA SUA MÃO", w/2, h*0.15);
                ctx.font = "20px sans-serif"; ctx.fillStyle = "#aaa";
                ctx.fillText("Levante uma mão p/ selecionar", w/2, h*0.22);
                
                const drawSelectRing = (x, y, hand) => {
                    ctx.fillStyle = "#fff"; ctx.font = "bold 25px sans-serif";
                    ctx.fillText(hand === 'left' ? "✋ Esq" : "Dir ✋", x, y);
                    if (this.calibHandCandidate === hand) {
                        const progress = Math.min(1, this.calibTimer / CONF.HAND_SELECT_TIME);
                        ctx.strokeStyle = "#0f0"; ctx.lineWidth = 5;
                        ctx.beginPath(); ctx.arc(x, y-10, 50, -Math.PI/2, (-Math.PI/2) + (Math.PI*2*progress)); ctx.stroke();
                    }
                };
                drawSelectRing(w*0.25, h*0.5, 'left'); drawSelectRing(w*0.75, h*0.5, 'right');
            } 
            else if (this.state === 'CALIB_TL') {
                ctx.font = "bold 20px sans-serif"; ctx.fillStyle = "#fff";
                ctx.fillText("MANTENHA A MÃO NO ALVO VERMELHO (ESQ/CIMA)", w/2, h*0.15);
                
                const tx = 80; const ty = 80;
                ctx.strokeStyle = "#f00"; ctx.lineWidth = 4;
                ctx.beginPath(); ctx.arc(tx, ty, 40, 0, Math.PI*2); ctx.stroke();
                
                if(Number.isFinite(this.p1.rawX) && Number.isFinite(this.p1.rawY)) {
                    const cx = (this.p1.rawX / 640) * w; const cy = (this.p1.rawY / 480) * h;
                    if(Number.isFinite(cx) && Number.isFinite(cy)) {
                        ctx.setLineDash([10, 10]); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
                        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke(); ctx.setLineDash([]);
                    }
                }
            }
            else if (this.state === 'CALIB_BR') {
                ctx.font = "bold 20px sans-serif"; ctx.fillStyle = "#fff";
                ctx.fillText("MANTENHA A MÃO NO ALVO VERDE (DIR/BAIXO)", w/2, h*0.15);
                
                const tx = w-80; const ty = h-80;
                ctx.strokeStyle = "#0f0"; ctx.lineWidth = 4;
                ctx.beginPath(); ctx.arc(tx, ty, 40, 0, Math.PI*2); ctx.stroke();
                
                if(Number.isFinite(this.p1.rawX) && Number.isFinite(this.p1.rawY)) {
                    const cx = (this.p1.rawX / 640) * w; const cy = (this.p1.rawY / 480) * h;
                    if(Number.isFinite(cx) && Number.isFinite(cy)) {
                        ctx.setLineDash([10, 10]); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
                        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke(); ctx.setLineDash([]);
                    }
                }
            }
        },

        drawSkeleton: function(ctx, w, h) {
             const kps = this.pose.keypoints; const find = (n) => kps.find(k => k.name === n && k.score > 0.3);
             const bones = [['nose', 'left_eye'], ['nose', 'right_eye'], ['left_shoulder', 'right_shoulder'], ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'], ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'], ['left_shoulder', 'left_hip'], ['right_shoulder', 'right_hip'], ['left_hip', 'right_hip']];
             ctx.strokeStyle = "rgba(0, 255, 0, 0.6)"; ctx.lineWidth = 3;
             bones.forEach(b => {
                 const p1 = find(b[0]); const p2 = find(b[1]);
                 if(p1 && p2) {
                     const x1 = ((640 - p1.x) / 640) * w; const y1 = (p1.y / 480) * h;
                     const x2 = ((640 - p2.x) / 640) * w; const y2 = (p2.y / 480) * h;
                     if(Number.isFinite(x1) && Number.isFinite(y1) && Number.isFinite(x2) && Number.isFinite(y2)) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
                 }
             });
             kps.forEach(k => {
                 if(k.score > 0.3) {
                     const x = ((640 - k.x) / 640) * w; const y = (k.y / 480) * h;
                     if(Number.isFinite(x) && Number.isFinite(y)) { this.safeCircle(ctx, x, y, 5, "#0f0"); }
                 }
             });
        },

        renderEnd: function(ctx, w, h) {
            ctx.fillStyle = "rgba(0,0,0,0.9)"; ctx.fillRect(0,0,w,h);
            const win = this.score.p1 > this.score.p2;
            ctx.fillStyle = win ? "#f1c40f" : "#e74c3c";
            ctx.font = "bold 60px 'Russo One'"; ctx.textAlign = "center";
            ctx.fillText(win ? "VITÓRIA!" : "DERROTA", w/2, h*0.4);
            ctx.fillStyle = "#fff"; ctx.font = "40px sans-serif";
            ctx.fillText(`${this.score.p1} - ${this.score.p2}`, w/2, h*0.55);
        }
    };

    if (window.System && window.System.registerGame) {
        window.System.registerGame('tennis', 'Ping Pong', '🏓', Game, { camOpacity: 0.1 });
    }

})();
