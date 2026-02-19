// =============================================================================
// TABLE TENNIS: PROTOCOL 177 (MULTIPLAYER P2P + GOLD MASTER)
// ARQUITETO: SENIOR GAME ENGINE ARCHITECT
// STATUS: 10/10 ABSOLUTE - VISÃO PANORÂMICA + TRACKING 1:1 (ZERO LAG)
// =============================================================================

(function() {
    "use strict";

    // -----------------------------------------------------------------
    // 1. CONFIGURAÇÕES FÍSICAS (VISÃO PANORÂMICA WII)
    // -----------------------------------------------------------------
    const CONF = {
        TABLE_W: 1525,  
        TABLE_L: 2740,
        TABLE_Y: 0,          
        NET_H: 152,     
        FLOOR_Y: 760,        
        
        BALL_R: 36,          // Bolinha bem maior para ser vista de longe
        GRAVITY: 0.65,       
        AIR_DRAG: 0.994,     
        BOUNCE_LOSS: 0.78,   
        MAGNUS_FORCE: 0.16,
        MAX_TOTAL_SPEED: 55, // Velocidade máxima da bolinha aumentada
        
        AUTO_SERVE_DELAY: 2000,
        PADDLE_SCALE: 2.8,   // Raquete gigante para compensar a câmera longe
        PADDLE_HITBOX: 220,  // Hitbox mais generosa para não furar a bola
        SWING_FORCE: 4.0,    // Força da raquetada mais intensa
        SMASH_THRESH: 35,    

        // === CÂMERA DE JOGO PROFISSIONAL ===
        CAM_Y: -1500,       // Bem mais alto
        CAM_Z: -5800,       // Muito mais longe (3ª pessoa real)
        CAM_TILT: 250,      // Inclinada olhando para a mesa
        FOV: 1000,          // Campo de visão expandido para ver as laterais

        // Calibração
        CALIB_TIME: 1500,      
        HAND_SELECT_TIME: 1500 
    };

    const AI_PROFILES = {
        'PRO': { speed: 0.14, difficultyFactor: 0.85, baseSpeed: 0.14 } // IA um pouco mais esperta
    };

    // -----------------------------------------------------------------
    // 2. MATH CORE
    // -----------------------------------------------------------------
    const MathCore = {
        project: (x, y, z, w, h) => {
            const depth = (z - CONF.CAM_Z);
            if (depth <= 1) return { x: -9999, y: -9999, s: 0, visible: false, depth: depth };
            
            const scale = CONF.FOV / depth;
            return {
                x: (x * scale) + w/2,
                y: ((y - CONF.CAM_Y) * scale) + (h/2) + CONF.CAM_TILT,
                s: scale,
                visible: true,
                depth: depth
            };
        },
        lerp: (a, b, t) => a + (b - a) * t,
        clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
        
        dist3d: (x1, y1, z1, x2, y2, z2) => {
            const dx = x1 - x2;
            const dy = y1 - y2;
            const dz = z1 - z2;
            return Math.sqrt(dx*dx + dy*dy + dz*dz);
        },

        dot3d: (x1, y1, z1, x2, y2, z2) => {
            return x1*x2 + y1*y2 + z1*z2;
        },
        
        predict: (b, targetZ) => {
            let sx = b.x, sy = b.y, sz = b.z;
            let svx = b.vx, svy = b.vy, svz = b.vz;
            let steps = 0;
            while(sz < targetZ && steps < 300) {
                svx += (b.spinY * svz * CONF.MAGNUS_FORCE * 0.005);
                svy += (b.spinX * svz * CONF.MAGNUS_FORCE * 0.005) + CONF.GRAVITY;
                svx *= CONF.AIR_DRAG; svy *= CONF.AIR_DRAG; svz *= CONF.AIR_DRAG;
                sx += svx; sy += svy; sz += svz;
                if(sy > 0) { sy = 0; svy *= -0.8; }
                steps++;
            }
            return sx;
        },

        predictY: (b, targetZ) => {
            let sy = b.y, sz = b.z;
            let svy = b.vy, svz = b.vz;
            let steps = 0;
            while(sz < targetZ && steps < 300) {
                svy += CONF.GRAVITY;
                svy *= CONF.AIR_DRAG; svz *= CONF.AIR_DRAG;
                sy += svy; sz += svz;
                if(sy > 0) { sy = 0; svy *= -0.8; }
                steps++;
            }
            return sy;
        }
    };

    // -----------------------------------------------------------------
    // 3. GAME ENGINE
    // -----------------------------------------------------------------
    const Game = {
        state: 'MODE_SELECT', 
        timer: 0,
        idleTimer: 0, 
        endTimer: 0,  
        pose: null, 
        handedness: null, 
        polyfillDone: false,
        
        roundTimeout: null,
        calibTimer: 0,
        calibHandCandidate: null,
        audioCtx: null,
        
        lastFrameTime: 0,
        activeAIProfile: { speed: 0.12, difficultyFactor: 0.8, baseSpeed: 0.12 },

        aiFrame: 0,
        aiRecalcCounter: 0, 

        useMouse: false,
        mouseX: 320,
        mouseY: 240,

        // Network Integration
        isOnline: false,
        isHost: false,
        roomId: 'tennis_pro_v1',
        dbRef: null,
        roomRef: null,
        remotePlayersData: {},
        lastSync: 0,
        maintenanceInterval: null,
        
        p1: { 
            gameX: 0, gameY: -200, gameZ: -CONF.TABLE_L/2 - 400, 
            prevX: 0, prevY: 0, 
            velX: 0, velY: 0,
            currRawX: 0, currRawY: 0,
            elbowX: 0, elbowY: 0
        },
        p2: { 
            gameX: 0, gameY: -200, gameZ: CONF.TABLE_L/2 + 200,
            targetX: 0, targetZ: 0, targetY: -200,
            velX: 0, velZ: 0
        },
        ball: { 
            x: 0, y: -300, z: -CONF.TABLE_L/2, 
            vx: 0, vy: 0, vz: 0, 
            prevY: -300,
            spinX: 0, spinY: 0,
            active: false,
            lastHitBy: null, 
            bounceCount: 0,
            trail: []
        },

        score: { p1: 0, p2: 0 },
        server: 'p1',
        lastHitter: null,
        rallyCount: 0,

        shake: 0,
        shakeX: 0, shakeY: 0,
        flash: 0,
        particles: [],
        msgs: [],
        calib: { tlX: 0, tlY: 0, brX: 640, brY: 480 },

        init: function() {
            this.cleanup();
            this.state = 'MODE_SELECT';
            this.handedness = null; 
            this.useMouse = false;
            this.activeAIProfile = JSON.parse(JSON.stringify(AI_PROFILES.PRO));
            this.lastFrameTime = performance.now();
            this.loadCalib();
            if(window.System && window.System.msg) window.System.msg("PING PONG MULTIPLAYER");
            this.setupInput();
        },

        cleanup: function() {
            if (this.dbRef && window.System && window.System.playerId) {
                try { 
                    this.dbRef.child('players/' + window.System.playerId).remove(); 
                    this.dbRef.off(); 
                } catch(e){}
            }
            if (this.roomRef) try { this.roomRef.off(); } catch(e){}
            if (this.maintenanceInterval) {
                clearInterval(this.maintenanceInterval);
                this.maintenanceInterval = null;
            }
            if (this.roundTimeout) {
                clearTimeout(this.roundTimeout);
                this.roundTimeout = null;
            }
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
                    if (typeof window.Sfx[action] === 'function') {
                        window.Sfx[action](...args);
                    } else if (action === 'coin' && typeof window.Sfx.play === 'function') {
                        window.Sfx.play(1200, 'sine', 0.1);
                    } else if (action === 'click' && typeof window.Sfx.play === 'function') {
                        window.Sfx.play(1000, 'sine', 0.1, 0.08);
                    } else if (action === 'hit' && typeof window.Sfx.play === 'function') {
                        window.Sfx.play(300, 'sine', 0.1, 0.1);
                    }
                }
            } catch (e) {
                console.error("SFX Exception:", e);
            }
        },

        loadCalib: function() {
            try {
                const s = localStorage.getItem('tennis_calib_auto');
                if(s) {
                    const data = JSON.parse(s);
                    if(data.calib) {
                        this.calib.tlX = Number(data.calib.tlX) || 0;
                        this.calib.tlY = Number(data.calib.tlY) || 0;
                        this.calib.brX = Number(data.calib.brX) || 640;
                        this.calib.brY = Number(data.calib.brY) || 480;
                    }
                    if(data.hand) this.handedness = data.hand;
                }
            } catch(e) { console.error("Calib Load Error", e); }
        },

        setupInput: function() {
            if(!window.System.canvas) return;
            
            const handlePointer = (e) => {
                const rect = window.System.canvas.getBoundingClientRect();
                let cx = e.clientX;
                let cy = e.clientY;
                if (e.touches && e.touches.length > 0) {
                    cx = e.touches[0].clientX;
                    cy = e.touches[0].clientY;
                }
                if (cx !== undefined && cy !== undefined) {
                    this.mouseX = cx - rect.left;
                    this.mouseY = cy - rect.top;
                }
            };

            window.System.canvas.onmousemove = handlePointer;
            window.System.canvas.ontouchstart = handlePointer;
            window.System.canvas.ontouchmove = (e) => {
                handlePointer(e);
                // Evita que a tela role para baixo enquanto joga
                if (this.useMouse && e.cancelable) e.preventDefault();
            };

            window.System.canvas.onclick = (e) => {
                const h = window.System.canvas.height;
                const rect = window.System.canvas.getBoundingClientRect();
                let cy = e.clientY;
                if (e.touches && e.touches.length > 0) cy = e.touches[0].clientY;
                const my = cy - rect.top;

                if (this.state === 'MODE_SELECT') {
                    if (my < h * 0.45) {
                        this.isOnline = false;
                        this.useMouse = false;
                        this.state = 'CALIB_HAND_SELECT';
                    } else if (my < h * 0.60) {
                        this.isOnline = false;
                        this.useMouse = true;
                        this.handedness = 'right';
                        this.startGame();
                    } else {
                        this.isOnline = !!window.DB;
                        this.useMouse = false;
                        if (!window.DB) {
                            if(window.System.msg) window.System.msg("MODO OFFLINE");
                            this.isOnline = false;
                        }
                        this.state = 'CALIB_HAND_SELECT';
                    }
                    this.calibTimer = 0;
                    this.sfx('click');
                } 
                else if (this.state === 'SERVE' && this.useMouse && this.server === 'p1') {
                    this.hitBall('p1', 0, -20);
                }
                else if (this.state === 'LOBBY') {
                    if (this.isHost) {
                        const pCount = Object.keys(this.remotePlayersData || {}).length;
                        if (pCount >= 2) {
                            this.roomRef.update({ gameState: 'STARTING' });
                            this.startGame();
                            this.sfx('coin');
                        }
                    }
                }
                else if (this.state === 'END') {
                    this.init(); 
                }
            };
        },

        connectMultiplayer: function() {
            this.state = 'LOBBY';
            try {
                this.roomRef = window.DB.ref('rooms/' + this.roomId);
                this.dbRef = this.roomRef;
                
                const myData = { 
                    name: 'Player', 
                    x: this.p1.gameX || 0, 
                    y: this.p1.gameY || -200, 
                    velX: this.p1.velX || 0, 
                    velY: this.p1.velY || 0,
                    lastSeen: firebase.database.ServerValue.TIMESTAMP 
                };
                
                this.dbRef.child('players/' + window.System.playerId).set(myData);
                this.dbRef.child('players/' + window.System.playerId).onDisconnect().remove();

                this.maintenanceInterval = setInterval(() => {
                    if (!this.isHost || !this.remotePlayersData) return;
                    const now = Date.now();
                    Object.keys(this.remotePlayersData).forEach(pid => {
                        if (pid === window.System.playerId) return;
                        const p = this.remotePlayersData[pid];
                        if (now - (p.lastSeen || 0) > 15000) {
                            this.dbRef.child('players/' + pid).remove();
                            this.addMsg("JOGADOR CAIU", "#f00");
                        }
                    });
                }, 2000);

                this.roomRef.child('gameState').on('value', (snap) => {
                    const globalState = snap.val();
                    if(globalState === 'STARTING' && this.state === 'LOBBY' && !this.isHost) {
                        this.startGame();
                    }
                    if(globalState === 'END' && this.state !== 'END') {
                        this.state = 'END';
                    }
                });

                this.roomRef.child('ball').on('value', (snap) => {
                    if (this.isHost || !this.isOnline || !snap.exists()) return;
                    const ballData = snap.val();
                    this.ball.x = -ballData.x; 
                    this.ball.y = ballData.y;
                    this.ball.z = -ballData.z; 
                    this.ball.vx = -ballData.vx;
                    this.ball.vy = ballData.vy;
                    this.ball.vz = -ballData.vz;
                    this.ball.spinX = -ballData.spinX;
                    this.ball.spinY = -ballData.spinY;
                    this.ball.active = ballData.active;
                    this.ball.lastHitBy = ballData.lastHitBy === 'p1' ? 'p2' : (ballData.lastHitBy === 'p2' ? 'p1' : null);
                });

                this.roomRef.child('score').on('value', (snap) => {
                    if (this.isHost || !this.isOnline || !snap.exists()) return;
                    const s = snap.val();
                    this.score.p1 = s.p2; 
                    this.score.p2 = s.p1;
                });

                this.dbRef.child('players').on('value', (snap) => {
                    const data = snap.val(); if (!data) return;
                    this.remotePlayersData = data;
                    const ids = Object.keys(data).sort();
                    
                    this.isHost = (ids[0] === window.System.playerId);

                    const opId = ids.find(id => id !== window.System.playerId);
                    if (opId) {
                        const opData = data[opId];
                        this.p2.gameX = -opData.x;
                        this.p2.gameY = opData.y;
                        this.p2.velX = -opData.velX;
                        this.p2.velY = opData.velY;
                    }
                });

            } catch(e) {
                console.error("Erro no Multiplayer", e);
                this.state = 'MODE_SELECT';
            }
        },

        syncMultiplayer: function() {
            if (!this.dbRef || !this.isOnline) return;
            const now = Date.now();
            if (now - this.lastSync > 30) {
                this.lastSync = now;
                
                this.dbRef.child('players/' + window.System.playerId).update({
                    x: this.p1.gameX || 0,
                    y: this.p1.gameY || -200,
                    velX: this.p1.velX || 0,
                    velY: this.p1.velY || 0,
                    lastSeen: firebase.database.ServerValue.TIMESTAMP
                });

                if (this.isHost) {
                    this.roomRef.update({
                        ball: {
                            x: this.ball.x || 0, y: this.ball.y || -300, z: this.ball.z || 0,
                            vx: this.ball.vx || 0, vy: this.ball.vy || 0, vz: this.ball.vz || 0,
                            spinX: this.ball.spinX || 0, spinY: this.ball.spinY || 0,
                            active: this.ball.active,
                            lastHitBy: this.ball.lastHitBy
                        },
                        score: this.score,
                        gameState: this.state
                    });
                }
            }
        },

        spawnParticles: function(x, y, z, count, color) {
            for (let i = 0; i < count; i++) {
                this.particles.push({
                    x: x, y: y, z: z,
                    vx: (Math.random() - 0.5) * 12,
                    vy: (Math.random() - 0.5) * 12,
                    vz: (Math.random() - 0.5) * 12,
                    life: 1,
                    c: color
                });
            }
            if (this.particles.length > 150) {
                this.particles = this.particles.slice(this.particles.length - 150);
            }
        },

        playHitSound: function(speed) {
            try {
                if (!window.AudioContext && !window.webkitAudioContext) return;
                if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                if (this.audioCtx.state === 'suspended') this.audioCtx.resume();

                const osc = this.audioCtx.createOscillator();
                const gain = this.audioCtx.createGain();
                
                osc.connect(gain);
                gain.connect(this.audioCtx.destination);

                osc.frequency.value = 200 + Math.min(speed * 3, 600);
                osc.type = 'sine';

                const vol = Math.min(speed / 300, 0.5);
                gain.gain.setValueAtTime(vol, this.audioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.1);

                osc.start();
                osc.stop(this.audioCtx.currentTime + 0.1);
            } catch(e) {}
        },

        startGame: function() {
            if (this.roundTimeout) {
                clearTimeout(this.roundTimeout);
                this.roundTimeout = null;
            }
            this.state = 'STARTING'; 
            this.score = { p1: 0, p2: 0 };
            this.server = 'p1';
            this.activeAIProfile = JSON.parse(JSON.stringify(AI_PROFILES.PRO));
            this.resetRound();
        },

        update: function(ctx, w, h, pose) {
            const now = performance.now();
            const dt = this.lastFrameTime ? (now - this.lastFrameTime) : 16;
            this.lastFrameTime = now;

            if (!this.polyfillDone) {
                if (!ctx.roundRect) {
                    ctx.roundRect = function(x, y, w, h, r) {
                        if (w < 2 * r) r = w / 2;
                        if (h < 2 * r) r = h / 2;
                        ctx.beginPath();
                        ctx.moveTo(x + r, y);
                        ctx.arcTo(x + w, y, x + w, y + h, r);
                        ctx.arcTo(x + w, y + h, x, y + h, r);
                        ctx.arcTo(x, y + h, x, y, r);
                        ctx.arcTo(x, y, x + w, y, r);
                        ctx.closePath();
                    };
                }
                this.polyfillDone = true;
            }

            if (this.state === 'MODE_SELECT') {
                this.p1.gameX = Math.sin(now * 0.002) * 200;
                this.p2.gameX = Math.cos(now * 0.002) * 200;
            } else if (this.state !== 'LOBBY' && this.state !== 'END') {
                if (this.state === 'IDLE') {
                    this.idleTimer += dt;
                    if (this.idleTimer > 1000) {
                        this.state = 'SERVE';
                        this.idleTimer = 0;
                        this.timer = 0;
                    }
                } else if (this.state === 'END_WAIT') {
                    this.endTimer += dt;
                    if (this.endTimer > 2000) {
                        this.state = 'END';
                        if (this.isOnline && this.isHost) {
                            this.roomRef.update({ gameState: 'END' });
                        }
                        this.endTimer = 0;
                    }
                }

                this.processPose(pose);

                if (this.state.startsWith('CALIB')) {
                    this.updateAutoCalibration(dt);
                }

                if (this.state === 'RALLY' || this.state === 'SERVE') {
                    if (!this.isOnline || this.isHost) {
                        this.updatePhysics();
                        if (!this.isOnline) this.updateAI();
                        this.updateRules(dt);
                    } else {
                        this.updatePhysicsClient(dt);
                    }
                }
            }

            ctx.save();
            if(this.shake > 0 && !isNaN(this.shake)) {
                this.shakeX = (Math.random()-0.5) * this.shake;
                this.shakeY = (Math.random()-0.5) * this.shake;
                ctx.translate(this.shakeX, this.shakeY);
                this.shake *= 0.9;
                if(this.shake < 0.5) this.shake = 0;
            }

            this.renderScene(ctx, w, h);
            ctx.restore();

            if (this.flash > 0 && !isNaN(this.flash)) {
                ctx.fillStyle = `rgba(255,255,255,${this.flash})`;
                ctx.fillRect(0,0,w,h);
                this.flash *= 0.8;
                if(this.flash < 0.05) this.flash = 0;
            }

            if (this.state === 'MODE_SELECT') this.renderModeSelect(ctx, w, h);
            else if (this.state === 'LOBBY') this.renderLobby(ctx, w, h);
            else if (this.state.startsWith('CALIB')) this.renderCalibration(ctx, w, h);
            else if (this.state === 'END') this.renderEnd(ctx, w, h);
            else this.renderHUD(ctx, w, h);

            if (this.isOnline) this.syncMultiplayer();

            return this.score.p1;
        },

        updateAutoCalibration: function(dt) {
            const deltaFactor = dt / 16;
            this.calibTimer = Math.max(0, this.calibTimer - (10 * deltaFactor));

            if (this.state === 'CALIB_HAND_SELECT') {
                if (this.calibHandCandidate) {
                    this.calibTimer += 25 * deltaFactor; 
                    if (this.calibTimer > CONF.HAND_SELECT_TIME) {
                        this.handedness = this.calibHandCandidate;
                        this.state = 'CALIB_TL';
                        this.calibTimer = 0;
                        this.sfx('coin');
                    }
                }
            } 
            else if (this.state === 'CALIB_TL') {
                if (this.p1.currRawX !== undefined && this.p1.currRawX !== null && !isNaN(this.p1.currRawX)) {
                    this.calibTimer += 25 * deltaFactor;
                    if (this.calibTimer > CONF.CALIB_TIME) {
                        this.calib.tlX = this.p1.currRawX;
                        this.calib.tlY = this.p1.currRawY;
                        this.state = 'CALIB_BR';
                        this.calibTimer = 0;
                        this.sfx('coin');
                    }
                }
            } 
            else if (this.state === 'CALIB_BR') {
                if (this.p1.currRawX !== undefined && this.p1.currRawX !== null && !isNaN(this.p1.currRawX)) {
                    this.calibTimer += 25 * deltaFactor;
                    if (this.calibTimer > CONF.CALIB_TIME) {
                        this.calib.brX = this.p1.currRawX;
                        this.calib.brY = this.p1.currRawY;
                        
                        if (Math.abs(this.calib.tlX - this.calib.brX) < 50) {
                            this.calib.brX = this.calib.tlX + 150;
                        }
                        if (Math.abs(this.calib.tlY - this.calib.brY) < 50) {
                            this.calib.brY = this.calib.tlY + 150;
                        }
                        
                        try {
                            localStorage.setItem('tennis_calib_auto', JSON.stringify({
                                calib: this.calib,
                                hand: this.handedness
                            }));
                        } catch(e) {}
                        
                        this.calibTimer = 0; 
                        
                        if (this.isOnline) {
                            this.connectMultiplayer();
                        } else {
                            this.startGame(); 
                        }
                        this.sfx('coin');
                    }
                }
            }
        },

        handleLostTracking: function() {
            if(this.state.startsWith('CALIB')) {
                this.calibHandCandidate = null;
            } else if (this.state === 'SERVE' || this.state === 'RALLY' || this.state === 'IDLE') {
                // Se perder a mão, volta suave pro centro
                this.p1.gameX = MathCore.lerp(this.p1.gameX || 0, 0, 0.1);
                this.p1.gameY = MathCore.lerp(this.p1.gameY || -200, -200, 0.1);
                
                if (this.state === 'SERVE' && this.server === 'p1') {
                    this.ball.x = this.p1.gameX;
                    this.ball.y = this.p1.gameY - 50; 
                    this.ball.z = this.p1.gameZ + 50; 
                }
            }
        },

        processPose: function(pose) {
            this.pose = pose; 

            // ==========================================
            // CONTROLES POR TOQUE NA TELA (RÁPIDO)
            // ==========================================
            if (this.useMouse) {
                const w = window.System?.canvas?.width || 640;
                const h = window.System?.canvas?.height || 480;
                let nx = this.mouseX / w;
                let ny = this.mouseY / h;
                
                nx = MathCore.clamp(nx, 0, 1);
                ny = MathCore.clamp(ny, 0, 1);

                // Alcance maior (pode ir até as pontas da mesa com facilidade)
                const targetX = MathCore.lerp(-CONF.TABLE_W*0.8, CONF.TABLE_W*0.8, nx); 
                const targetY = MathCore.lerp(-900, 200, ny); 

                // Resposta rápida (0.85 = quase instantâneo)
                this.p1.gameX = MathCore.lerp(this.p1.gameX || 0, targetX, 0.85);
                this.p1.gameY = MathCore.lerp(this.p1.gameY || -200, targetY, 0.85);
                this.p1.gameZ = -CONF.TABLE_L/2 - 400; // Posição fixa de defesa
                this.p1.elbowX = this.p1.gameX + 100;
                this.p1.elbowY = this.p1.gameY + 300;

                let calcVX = this.p1.gameX - (this.p1.prevX !== undefined ? this.p1.prevX : this.p1.gameX);
                let calcVY = this.p1.gameY - (this.p1.prevY !== undefined ? this.p1.prevY : this.p1.gameY);

                if (Math.abs(calcVX) > 200) calcVX = 0;
                if (Math.abs(calcVY) > 200) calcVY = 0;

                this.p1.velX = calcVX;
                this.p1.velY = calcVY;

                this.p1.prevX = this.p1.gameX;
                this.p1.prevY = this.p1.gameY;

                if (this.state === 'SERVE' && this.server === 'p1') {
                    this.ball.x = this.p1.gameX;
                    this.ball.y = this.p1.gameY - 50; 
                    this.ball.z = this.p1.gameZ + 50; 
                    this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;
                    this.ball.active = false;
                    
                    if (this.p1.velY < -20) {
                        this.hitBall('p1', 0, 0);
                    }
                }
                return;
            }

            // ==========================================
            // CÂMERA INTELIGENTE E CAPTURA DE CORPO (1:1 FIDELIDADE)
            // ==========================================
            if (this.state === 'CALIB_HAND_SELECT') {
                if (!pose || !pose.keypoints) {
                    this.calibHandCandidate = null;
                    return;
                }
                const nose = pose.keypoints.find(k => k.name === 'nose');
                const leftW = pose.keypoints.find(k => k.name === 'left_wrist');
                const rightW = pose.keypoints.find(k => k.name === 'right_wrist');

                this.calibHandCandidate = null;

                if (nose && leftW && rightW) {
                    const leftUp = leftW.y < nose.y;   
                    const rightUp = rightW.y < nose.y;

                    if (leftUp && !rightUp) {
                        this.calibHandCandidate = 'left';
                        this.p1.currRawX = 640 - leftW.x;
                        this.p1.currRawY = leftW.y;
                    } 
                    else if (rightUp && !leftUp) {
                        this.calibHandCandidate = 'right';
                        this.p1.currRawX = 640 - rightW.x;
                        this.p1.currRawY = rightW.y;
                    }
                }
                return;
            }

            if (!this.handedness) return; 

            if (!pose || !pose.keypoints) {
                this.handleLostTracking();
                return;
            }

            const wristName = this.handedness + '_wrist';
            const elbowName = this.handedness + '_elbow';

            const wrist = pose.keypoints.find(k => k.name === wristName && k.score > 0.3);
            const elbow = pose.keypoints.find(k => k.name === elbowName && k.score > 0.3);

            if (wrist) {
                const rawX = 640 - wrist.x; 
                const rawY = wrist.y;
                
                if (this.state.startsWith('CALIB')) {
                    this.p1.currRawX = rawX;
                    this.p1.currRawY = rawY;
                } 
                else {
                    let safeRangeX = (this.calib.brX || 640) - (this.calib.tlX || 0);
                    let safeRangeY = (this.calib.brY || 480) - (this.calib.tlY || 0);
                    
                    if (Math.abs(safeRangeX) < 1 || isNaN(safeRangeX)) safeRangeX = 640;
                    if (Math.abs(safeRangeY) < 1 || isNaN(safeRangeY)) safeRangeY = 480;
                    
                    let nx = (rawX - (this.calib.tlX || 0)) / safeRangeX;
                    let ny = (rawY - (this.calib.tlY || 0)) / safeRangeY;
                    
                    if (isNaN(nx)) nx = 0.5;
                    if (isNaN(ny)) ny = 0.5;

                    nx = MathCore.clamp(nx, 0, 1);
                    ny = MathCore.clamp(ny, 0, 1);

                    // ALCANCE AMPLIADO: O jogador agora consegue defender cantos distantes facilmente
                    const targetX = MathCore.lerp(-CONF.TABLE_W*0.8, CONF.TABLE_W*0.8, nx); 
                    const targetY = MathCore.lerp(-900, 200, ny); 

                    // MOVIMENTO 1:1 ZERO LAG (0.85 segue a mão perfeitamente)
                    this.p1.gameX = MathCore.lerp(this.p1.gameX || 0, targetX, 0.85);
                    this.p1.gameY = MathCore.lerp(this.p1.gameY || -200, targetY, 0.85);
                    this.p1.gameZ = -CONF.TABLE_L/2 - 400; // Recuado para trás da mesa

                    if (elbow) {
                        const rawEx = 640 - elbow.x;
                        const rawEy = elbow.y;
                        let nex = (rawEx - (this.calib.tlX||0)) / safeRangeX;
                        let ney = (rawEy - (this.calib.tlY||0)) / safeRangeY;
                        if(isNaN(nex)) nex = 0.5;
                        if(isNaN(ney)) ney = 0.5;
                        nex = MathCore.clamp(nex, 0, 1);
                        ney = MathCore.clamp(ney, 0, 1);
                        
                        const targetEx = MathCore.lerp(-CONF.TABLE_W*0.8, CONF.TABLE_W*0.8, nex);
                        const targetEy = MathCore.lerp(-900, 200, ney);
                        
                        this.p1.elbowX = MathCore.lerp(this.p1.elbowX || targetEx, targetEx, 0.85);
                        this.p1.elbowY = MathCore.lerp(this.p1.elbowY || targetEy, targetEy, 0.85);
                    } else {
                        this.p1.elbowX = this.p1.gameX + (this.handedness === 'right' ? 150 : -150);
                        this.p1.elbowY = this.p1.gameY + 300;
                    }

                    let calculatedVelX = this.p1.gameX - (this.p1.prevX !== undefined ? this.p1.prevX : this.p1.gameX);
                    let calculatedVelY = this.p1.gameY - (this.p1.prevY !== undefined ? this.p1.prevY : this.p1.gameY);

                    // Impede pulos bruscos de tracking
                    if (Math.abs(calculatedVelX) > 200) calculatedVelX = 0;
                    if (Math.abs(calculatedVelY) > 200) calculatedVelY = 0;

                    this.p1.velX = calculatedVelX;
                    this.p1.velY = calculatedVelY;

                    this.p1.prevX = this.p1.gameX;
                    this.p1.prevY = this.p1.gameY;

                    if (this.state === 'SERVE' && this.server === 'p1') {
                        this.ball.x = this.p1.gameX;
                        this.ball.y = this.p1.gameY - 50; 
                        this.ball.z = this.p1.gameZ + 50; 
                        this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;
                        this.ball.active = false;

                        if (this.p1.velY < -15) {
                            this.hitBall('p1', 0, 0);
                        }
                    }
                }
            } else {
                this.handleLostTracking();
            }
        },

        updatePhysicsClient: function(dt) {
            if (!this.ball.active) return;
            const b = this.ball;
            b.prevY = b.y;
            
            b.x += b.vx; 
            b.y += b.vy; 
            b.z += b.vz;

            if (b.y >= 0 && b.prevY < 0) {
                b.y = 0; 
                b.vy = -Math.abs(b.vy) * CONF.BOUNCE_LOSS;
                this.spawnParticles(b.x, 0, b.z, 5, '#fff');
                this.playHitSound(Math.sqrt(b.vx**2 + b.vy**2 + b.vz**2));
            }

            if (Math.abs(b.vz) > 30) {
                this.ball.trail.push({x:b.x, y:b.y, z:b.z, a:1.0});
                if (this.ball.trail.length > 30) this.ball.trail.shift();
            }

            this.checkPaddleHitClient();
        },

        updatePhysics: function() {
            if (!this.ball.active) return;
            
            const b = this.ball;

            if (isNaN(b.x) || isNaN(b.y) || isNaN(b.z)) {
                this.resetRound();
                return;
            }

            b.prevY = b.y;

            const magX = b.spinY * b.vz * CONF.MAGNUS_FORCE * 0.01;
            const magY = b.spinX * b.vz * CONF.MAGNUS_FORCE * 0.01;
            
            b.vx += isNaN(magX) ? 0 : magX;
            b.vy += (isNaN(magY) ? 0 : magY) + CONF.GRAVITY;
            b.vx *= CONF.AIR_DRAG; b.vy *= CONF.AIR_DRAG; b.vz *= CONF.AIR_DRAG;

            const currentSpeed = Math.sqrt(b.vx*b.vx + b.vy*b.vy + b.vz*b.vz);
            let steps = 1;
            if (currentSpeed > 50) steps = 3; 
            
            for(let s=0; s<steps; s++) {
                const previousY = b.y;

                b.x += b.vx / steps; 
                b.y += b.vy / steps; 
                b.z += b.vz / steps;

                if ((b.z > 0 && b.lastHitBy === 'p1') || (b.z < 0 && b.lastHitBy === 'p2')) {
                    b.lastHitBy = null;
                }

                if (b.y >= 0 && previousY < 0) { 
                    if (Math.abs(b.x) <= CONF.TABLE_W/2 && Math.abs(b.z) <= CONF.TABLE_L/2) {
                        b.y = 0; 
                        b.vy = -Math.abs(b.vy) * CONF.BOUNCE_LOSS; 
                        b.vx += b.spinY * 0.5;
                        b.vz += b.spinX * 0.5;
                        
                        this.spawnParticles(b.x, 0, b.z, 5, '#fff');
                        this.playHitSound(currentSpeed);

                        const side = b.z < 0 ? 'p1' : 'p2';
                        if (this.lastHitter === side) this.scorePoint(side === 'p1' ? 'p2' : 'p1', "DOIS TOQUES");
                        else {
                            this.ball.bounceCount = Math.min(this.ball.bounceCount + 1, 2);
                            if(this.ball.bounceCount >= 2) this.scorePoint(side === 'p1' ? 'p2' : 'p1', "DOIS QUIQUES");
                        }
                    }
                }

                this.checkPaddleHit();
            }

            const totalSpeed = Math.sqrt(b.vx*b.vx + b.vy*b.vy + b.vz*b.vz);
            if (totalSpeed > CONF.MAX_TOTAL_SPEED && !isNaN(totalSpeed)) {
                const scale = CONF.MAX_TOTAL_SPEED / totalSpeed;
                b.vx *= scale; b.vy *= scale; b.vz *= scale;
            }

            b.spinX *= 0.99; b.spinY *= 0.99;

            if (Math.abs(b.vz) > 30) {
                this.ball.trail.push({x:b.x, y:b.y, z:b.z, a:1.0});
                if (this.ball.trail.length > 30) this.ball.trail.shift();
            }

            if (b.y > CONF.FLOOR_Y) this.handleOut();

            if (Math.abs(b.z) < 20 && b.y > -CONF.NET_H && b.y < 0) {
                b.vz *= -0.2; b.vx *= 0.5;
                this.shake = 5;
                this.playHitSound(currentSpeed * 0.5);
                b.lastHitBy = null;
            }
        },

        checkPaddleHitClient: function() {
            if (this.ball.vz < 0 && this.ball.lastHitBy !== 'p1') {
                const distP1 = MathCore.dist3d(this.ball.x, this.ball.y, this.ball.z, this.p1.gameX, this.p1.gameY, this.p1.gameZ);
                if (distP1 < CONF.PADDLE_HITBOX) {
                    const toPaddleX = this.p1.gameX - this.ball.x;
                    const toPaddleY = this.p1.gameY - this.ball.y;
                    const toPaddleZ = this.p1.gameZ - this.ball.z;
                    const dot = MathCore.dot3d(toPaddleX, toPaddleY, toPaddleZ, this.ball.vx, this.ball.vy, this.ball.vz);
                    if (dot > 0) {
                        this.sfx('hit');
                        this.spawnParticles(this.ball.x, this.ball.y, this.ball.z, 15, '#0ff');
                        this.ball.lastHitBy = 'p1'; 
                    }
                }
            }
        },

        checkPaddleHit: function() {
            if (this.ball.vz < 0 && this.ball.lastHitBy !== 'p1') {
                const distP1 = MathCore.dist3d(this.ball.x, this.ball.y, this.ball.z, this.p1.gameX, this.p1.gameY, this.p1.gameZ);
                if (distP1 < CONF.PADDLE_HITBOX) {
                    const toPaddleX = this.p1.gameX - this.ball.x;
                    const toPaddleY = this.p1.gameY - this.ball.y;
                    const toPaddleZ = this.p1.gameZ - this.ball.z;
                    const dot = MathCore.dot3d(toPaddleX, toPaddleY, toPaddleZ, this.ball.vx, this.ball.vy, this.ball.vz);
                    if (dot > 0) {
                        const dx = this.ball.x - this.p1.gameX;
                        const dy = this.ball.y - this.p1.gameY;
                        this.hitBall('p1', dx, dy);
                    }
                }
            }
            if (this.ball.vz > 0 && this.ball.lastHitBy !== 'p2') {
                const distP2 = MathCore.dist3d(this.ball.x, this.ball.y, this.ball.z, this.p2.gameX, this.p2.gameY, this.p2.gameZ);
                if (distP2 < CONF.PADDLE_HITBOX) {
                    const toPaddleX = this.p2.gameX - this.ball.x;
                    const toPaddleY = this.p2.gameY - this.ball.y;
                    const toPaddleZ = this.p2.gameZ - this.ball.z;
                    const dot = MathCore.dot3d(toPaddleX, toPaddleY, toPaddleZ, this.ball.vx, this.ball.vy, this.ball.vz);
                    if (dot > 0) this.hitBall('p2', 0, 0);
                }
            }
        },

        hitBall: function(who, offX, offY) {
            const isP1 = who === 'p1';
            const paddle = isP1 ? this.p1 : this.p2;
            let velX = paddle.velX || 0;
            let velY = isP1 ? (paddle.velY || 0) : (paddle.velZ ? paddle.velZ * 0.15 : 0);
            
            if (isNaN(velX)) velX = 0;
            if (isNaN(velY)) velY = 0;

            const speed = Math.sqrt(velX**2 + velY**2);
            // NOVA FÓRMULA DE FORÇA: Jogo rápido e dinâmico
            let force = 55 + (speed * CONF.SWING_FORCE);
            let isSmash = speed > CONF.SMASH_THRESH;

            if (isSmash) {
                force *= 1.45;
                this.shake = 15;
                this.flash = 0.3;
                if(isP1) this.addMsg("SMASH!", "#0ff");
            } else {
                this.shake = 3;
            }

            this.playHitSound(force * 3);

            this.ball.active = true;
            this.ball.lastHitBy = who;
            this.ball.vz = Math.abs(force) * (isP1 ? 1 : -1); 
            this.ball.vx = ((offX||0) * 0.35) + (velX * 0.7);
            this.ball.vy = -20 + (velY * 0.5) + ((offY||0) * 0.1); 
            this.ball.spinY = velX * 1.2;
            this.ball.spinX = velY * 1.2;

            this.lastHitter = who;
            this.ball.bounceCount = 0;
            this.rallyCount++;
            this.state = 'RALLY';
            this.spawnParticles(this.ball.x, this.ball.y, this.ball.z, 15, isP1 ? '#0ff' : '#f00');
            
            if (isP1 && (!this.isOnline || this.isHost)) {
                this.calculateAITarget();
            }
        },

        updateRules: function(dt) {
            const delta = dt || 16;
            if (this.state === 'SERVE') {
                this.timer += delta;
                if (this.timer > CONF.AUTO_SERVE_DELAY) {
                    if (this.server === 'p1') {
                        this.addMsg("SAQUE AUTOMÁTICO", "#fff");
                        this.ball.x = this.p1.gameX || 0; 
                        this.ball.y = -200; 
                        this.ball.z = (this.p1.gameZ || -CONF.TABLE_L/2 - 200) + 50;
                        this.hitBall('p1', 0, 0);
                    } else {
                        if (!this.isOnline || this.isHost) {
                            this.aiServe();
                        }
                    }
                    this.timer = 0;
                }
            } else if (this.state === 'RALLY') {
                if (!this.ball.active || (Math.abs(this.ball.vx) < 0.1 && Math.abs(this.ball.vz) < 0.1)) {
                     if (this.ball.y > 0) this.handleOut();
                }
            }
        },

        calculateAITarget: function() {
            if (this.isOnline && !this.isHost) return; 
            const profile = this.activeAIProfile;
            let predX = MathCore.predict(this.ball, this.p2.gameZ);
            let predY = MathCore.predictY(this.ball, this.p2.gameZ);
            
            if (isNaN(predX)) predX = 0;
            if (isNaN(predY)) predY = -200;

            const baseError = 40;
            const speedFactor = Math.min(1, Math.abs(this.ball.vx || 0) / 25);
            const humanError = baseError * profile.difficultyFactor * speedFactor;
            
            const errorX = (Math.random() - 0.5) * humanError;
            const errorY = (Math.random() - 0.5) * Math.abs(this.ball.vz || 0) * 0.15; 

            this.p2.targetX = predX + errorX;
            this.p2.targetY = predY + errorY; 
            
            if (Math.abs(this.ball.vz || 0) < 50) this.p2.targetZ = CONF.TABLE_L/2; 
            else this.p2.targetZ = CONF.TABLE_L/2 + 300;
        },

        updateAI: function() {
            if (this.isOnline) return; 

            if (this.state === 'RALLY' && this.ball.vz > 0) {
                this.aiRecalcCounter++;
                if (this.aiRecalcCounter >= 4) {
                    this.calculateAITarget();
                    this.aiRecalcCounter = 0;
                }
            }

            this.aiFrame++;
            if (this.aiFrame % 2 !== 0) return;

            const ai = this.p2;
            const profile = this.activeAIProfile;
            const dx = (ai.targetX || 0) - (ai.gameX || 0);
            
            ai.velX += dx * profile.speed;
            ai.velX *= 0.80; 
            ai.gameX += ai.velX;
            
            const dz = (ai.targetZ || 0) - (ai.gameZ || 0);
            ai.velZ += dz * 0.05;
            ai.velZ *= 0.85;
            ai.gameZ += ai.velZ;

            ai.gameY = MathCore.lerp(ai.gameY || -200, ai.targetY || -200, 0.08);
            
            if (this.ball.vz < 0) {
                ai.targetX = 0;
                ai.targetZ = CONF.TABLE_L/2 + 300;
                ai.targetY = -200; 
            }
        },

        aiServe: function() {
            this.ball.x = this.p2.gameX || 0;
            this.ball.y = this.p2.gameY || -200;
            this.ball.z = (this.p2.gameZ || CONF.TABLE_L/2 + 200) - 100;
            this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;
            this.hitBall('p2', (Math.random()-0.5)*20, 0);
        },

        handleOut: function() {
            if (this.ball.bounceCount === 0) this.scorePoint(this.lastHitter === 'p1' ? 'p2' : 'p1', "FORA");
            else this.scorePoint(this.lastHitter, "PONTO");
        },

        scorePoint: function(winner, txt) {
            this.score[winner]++;
            this.addMsg(txt, winner === 'p1' ? "#0f0" : "#f00");
            this.ball.active = false;
            this.rallyCount = 0;
            
            const profile = this.activeAIProfile;
            if (winner === 'p2') {
                profile.speed = Math.min(profile.speed * 1.02, profile.baseSpeed * 1.5);
            } else {
                profile.speed = Math.max(profile.speed * 0.99, profile.baseSpeed);
            }

            const s1 = this.score.p1;
            const s2 = this.score.p2;
            if ((s1 >= 11 || s2 >= 11) && Math.abs(s1 - s2) >= 2) {
                this.state = 'END_WAIT';
                this.endTimer = 0;
            } else {
                this.server = winner;
                this.resetRound();
            }
        },

        resetRound: function() {
            this.state = 'IDLE'; 
            this.idleTimer = 0;
            this.endTimer = 0;

            this.ball.active = false;
            this.ball.vx = 0;
            this.ball.vy = 0;
            this.ball.vz = 0;
            this.ball.x = 0;
            this.ball.y = -300;
            this.ball.z = 0;
            this.ball.lastHitBy = null;
            this.ball.bounceCount = 0;
            this.ball.trail = [];
            
            this.lastHitter = null;
            this.aiRecalcCounter = 0;
            this.timer = 0;
        },

        renderModeSelect: function(ctx, w, h) {
            ctx.fillStyle = "rgba(10, 20, 30, 0.85)"; ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = "white"; ctx.textAlign = "center"; ctx.font = "bold 50px 'Russo One'";
            ctx.fillText("PING PONG WII", w/2, h * 0.20);
            
            ctx.fillStyle = "#e67e22"; ctx.fillRect(w/2 - 160, h * 0.35, 320, 55);
            ctx.fillStyle = "#f39c12"; ctx.fillRect(w/2 - 160, h * 0.50, 320, 55);
            ctx.fillStyle = "#27ae60"; ctx.fillRect(w/2 - 160, h * 0.65, 320, 55);
            
            ctx.fillStyle = "white"; ctx.font = "bold 20px 'Russo One'";
            ctx.fillText("OFFLINE (CÂMERA)", w/2, h * 0.35 + 35);
            ctx.fillText("OFFLINE (TOQUE/DEDO) 👆", w/2, h * 0.50 + 35);
            ctx.fillText("ONLINE (P2P)", w/2, h * 0.65 + 35);
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
                } else {
                    ctx.fillText("AGUARDANDO OPONENTE...", w/2, h/2);
                }
            } else {
                ctx.fillText("CONECTADO! AGUARDANDO HOST...", w/2, h/2);
            }
        },

        renderScene: function(ctx, w, h) {
            const grad = ctx.createRadialGradient(w/2, h/2, 100, w/2, h/2, w);
            grad.addColorStop(0, "#2c3e50"); grad.addColorStop(1, "#1a1a1a");
            ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);

            // ==========================================
            // GRID NO CHÃO PARA NOÇÃO DE PROFUNDIDADE
            // ==========================================
            ctx.fillStyle = "rgba(0,0,0,0.3)";
            const f1 = MathCore.project(-3000, CONF.FLOOR_Y, 3000, w, h);
            const f2 = MathCore.project(3000, CONF.FLOOR_Y, 3000, w, h);
            const f3 = MathCore.project(3000, CONF.FLOOR_Y, -3000, w, h);
            const f4 = MathCore.project(-3000, CONF.FLOOR_Y, -3000, w, h);
            if(f1.visible && !isNaN(f1.x)) {
                ctx.beginPath(); ctx.moveTo(f1.x, f1.y); ctx.lineTo(f2.x, f2.y);
                ctx.lineTo(f3.x, f3.y); ctx.lineTo(f4.x, f4.y); ctx.fill();
            }

            ctx.strokeStyle = "rgba(255,255,255,0.06)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            for(let z = -3000; z <= 3000; z += 400) {
                let p1 = MathCore.project(-3000, CONF.FLOOR_Y, z, w, h);
                let p2 = MathCore.project(3000, CONF.FLOOR_Y, z, w, h);
                if(p1.visible && p2.visible) { ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); }
            }
            for(let x = -3000; x <= 3000; x += 400) {
                let p1 = MathCore.project(x, CONF.FLOOR_Y, -3000, w, h);
                let p2 = MathCore.project(x, CONF.FLOOR_Y, 3000, w, h);
                if(p1.visible && p2.visible) { ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); }
            }
            ctx.stroke();

            this.drawTable(ctx, w, h);
            this.drawPaddle(ctx, this.p2.gameX, this.p2.gameY, this.p2.gameZ, '#e74c3c', w, h);
            this.drawBall(ctx, w, h);
            
            if (!this.state.startsWith('CALIB')) {
                this.drawPlayerArm(ctx, w, h);
                this.drawPaddle(ctx, this.p1.gameX, this.p1.gameY, this.p1.gameZ, '#3498db', w, h);
            }
            
            this.drawParticles(ctx, w, h);
        },
        
        drawPlayerArm: function(ctx, w, h) {
            if(!this.handedness || this.useMouse) return; 
            const wristZ = this.p1.gameZ;
            const elbowZ = this.p1.gameZ + 400; 
            const pWrist = MathCore.project(this.p1.gameX, this.p1.gameY, wristZ, w, h);
            const pElbow = MathCore.project(this.p1.elbowX, this.p1.elbowY, elbowZ, w, h);
            
            if (pWrist.visible && pElbow.visible && !isNaN(pWrist.x) && !isNaN(pElbow.x)) {
                ctx.strokeStyle = "#e0ac69"; ctx.lineWidth = 18 * pWrist.s; ctx.lineCap = "round";
                ctx.beginPath(); ctx.moveTo(pElbow.x, pElbow.y); ctx.lineTo(pWrist.x, pWrist.y); ctx.stroke();
                ctx.fillStyle = "#e0ac69"; ctx.beginPath(); ctx.arc(pWrist.x, pWrist.y, 10*pWrist.s, 0, Math.PI*2); ctx.fill();
            }
        },

        drawTable: function(ctx, w, h) {
            const hw = CONF.TABLE_W/2; const hl = CONF.TABLE_L/2; const th = 40; const legH = CONF.FLOOR_Y; 
            ctx.fillStyle = "#222";
            const drawLeg = (x, z) => {
                const p1 = MathCore.project(x-20, 0, z, w, h);
                const p2 = MathCore.project(x+20, 0, z, w, h);
                const p3 = MathCore.project(x+20, legH, z, w, h);
                const p4 = MathCore.project(x-20, legH, z, w, h);
                if(p1.visible && !isNaN(p1.x)) {
                    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
                    ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y); ctx.fill();
                }
            };
            drawLeg(-hw+100, -hl+200); drawLeg(hw-100, -hl+200); drawLeg(-hw+100, hl-200); drawLeg(hw-100, hl-200);

            const c1 = MathCore.project(-hw, 0, -hl, w, h);
            const c2 = MathCore.project(hw, 0, -hl, w, h);
            const c3 = MathCore.project(hw, 0, hl, w, h);
            const c4 = MathCore.project(-hw, 0, hl, w, h);
            const c1b = MathCore.project(-hw, th, -hl, w, h);
            const c2b = MathCore.project(hw, th, -hl, w, h);
            const c3b = MathCore.project(hw, th, hl, w, h);

            if (!c1.visible || isNaN(c1.x)) return;

            // Laterais da mesa
            ctx.fillStyle = "#052040"; ctx.beginPath(); ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.lineTo(c2b.x, c2b.y); ctx.lineTo(c1b.x, c1b.y); ctx.fill();
            ctx.fillStyle = "#052550"; ctx.beginPath(); ctx.moveTo(c2.x, c2.y); ctx.lineTo(c3.x, c3.y); ctx.lineTo(c3b.x, c3b.y); ctx.lineTo(c2b.x, c2b.y); ctx.fill();
            
            // Tampo azul da mesa
            ctx.fillStyle = "#1e6091"; ctx.beginPath(); ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.lineTo(c3.x, c3.y); ctx.lineTo(c4.x, c4.y); ctx.fill();
            
            // Linhas brancas de marcação da mesa
            ctx.strokeStyle = "#fff"; ctx.lineWidth = 4 * c1.s;
            ctx.beginPath(); ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.lineTo(c3.x, c3.y); ctx.lineTo(c4.x, c4.y); ctx.closePath(); ctx.stroke(); 
            
            const m1 = MathCore.project(0, 0, -hl, w, h); const m2 = MathCore.project(0, 0, hl, w, h);
            ctx.lineWidth = 2 * c1.s;
            ctx.beginPath(); ctx.moveTo(m1.x, m1.y); ctx.lineTo(m2.x, m2.y); ctx.stroke();

            // Rede
            const n1 = MathCore.project(-hw-50, 0, 0, w, h); const n2 = MathCore.project(hw+50, 0, 0, w, h);
            const n1t = MathCore.project(-hw-50, -CONF.NET_H, 0, w, h); const n2t = MathCore.project(hw+50, -CONF.NET_H, 0, w, h);
            ctx.fillStyle = "rgba(240,240,240,0.3)"; ctx.beginPath(); ctx.moveTo(n1.x, n1.y); ctx.lineTo(n2.x, n2.y); ctx.lineTo(n2t.x, n2t.y); ctx.lineTo(n1t.x, n1t.y); ctx.fill();
            ctx.strokeStyle = "#fff"; ctx.lineWidth = 3 * c1.s; ctx.beginPath(); ctx.moveTo(n1t.x, n1t.y); ctx.lineTo(n2t.x, n2t.y); ctx.stroke();
        },

        drawPaddle: function(ctx, x, y, z, color, w, h) {
            const pos = MathCore.project(x, y, z, w, h);
            if (!pos.visible || isNaN(pos.x)) return;
            const scale = pos.s * CONF.PADDLE_SCALE;
            ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 20;
            ctx.fillStyle = "#333"; ctx.beginPath(); ctx.arc(pos.x, pos.y, 65*scale, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = color; ctx.beginPath(); ctx.arc(pos.x, pos.y, 60*scale, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = "#8d6e63"; ctx.fillRect(pos.x - 15*scale, pos.y + 40*scale, 30*scale, 60*scale);
            ctx.shadowBlur = 0;
            ctx.fillStyle = "rgba(255,255,255,0.15)"; ctx.beginPath(); ctx.arc(pos.x - 15*scale, pos.y - 15*scale, 25*scale, 0, Math.PI*2); ctx.fill();
        },

        drawBall: function(ctx, w, h) {
            if (!this.ball.active && !['SERVE', 'IDLE', 'END_WAIT'].includes(this.state)) return;

            // Sombra exata para noçao de profundidade na hora do quique
            if (this.ball.y < CONF.FLOOR_Y) {
                const shadowPos = MathCore.project(this.ball.x, 0, this.ball.z, w, h); 
                if (Math.abs(this.ball.x) > CONF.TABLE_W/2 || Math.abs(this.ball.z) > CONF.TABLE_L/2) {
                    MathCore.project(this.ball.x, CONF.FLOOR_Y, this.ball.z, w, h); 
                }
                if (shadowPos.visible && !isNaN(shadowPos.x)) {
                    const distToShadow = Math.abs(this.ball.y);
                    const alpha = MathCore.clamp(1 - (distToShadow/1000), 0.1, 0.6);
                    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
                    const sr = CONF.BALL_R * shadowPos.s * (1 + distToShadow/2000);
                    ctx.beginPath(); ctx.ellipse(shadowPos.x, shadowPos.y, sr*1.5, sr*0.5, 0, 0, Math.PI*2); ctx.fill();
                }
            }

            ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.lineWidth = 10;
            ctx.beginPath();
            this.ball.trail.forEach((t, i) => {
                const tp = MathCore.project(t.x, t.y, t.z, w, h);
                if (tp.visible && !isNaN(tp.x)) {
                    if(i===0) ctx.moveTo(tp.x, tp.y); else ctx.lineTo(tp.x, tp.y);
                }
                t.a -= 0.05;
            });
            ctx.stroke();
            this.ball.trail = this.ball.trail.filter(t => t.a > 0);

            const pos = MathCore.project(this.ball.x, this.ball.y, this.ball.z, w, h);
            if(pos.visible && !isNaN(pos.x)) {
                const r = CONF.BALL_R * pos.s;
                const grad = ctx.createRadialGradient(pos.x-r*0.3, pos.y-r*0.3, r*0.1, pos.x, pos.y, r);
                grad.addColorStop(0, "#fff"); grad.addColorStop(1, "#f39c12");
                ctx.fillStyle = grad;
                ctx.beginPath(); ctx.arc(pos.x, pos.y, r, 0, Math.PI*2); ctx.fill();
            }
        },

        drawParticles: function(ctx, w, h) {
            this.particles.forEach(p => {
                p.x += p.vx; p.y += p.vy; p.z += p.vz; p.life -= 0.05;
                const pos = MathCore.project(p.x, p.y, p.z, w, h);
                if(pos.visible && !isNaN(pos.x)) {
                    ctx.globalAlpha = p.life; ctx.fillStyle = p.c; ctx.fillRect(pos.x, pos.y, 4*pos.s, 4*pos.s);
                }
            });
            this.particles = this.particles.filter(p => p.life > 0);
            ctx.globalAlpha = 1;
        },

        addMsg: function(t, c) {
            this.msgs.push({t, c, y: 300, a: 1.5});
        },

        renderHUD: function(ctx, w, h) {
            const cx = w/2;
            ctx.fillStyle = "#000"; ctx.beginPath();
            ctx.roundRect(cx-100, 20, 200, 60, 8); ctx.fill();
            ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
            ctx.font = "bold 40px 'Russo One'"; ctx.textAlign = "center";
            ctx.fillStyle = "#3498db"; ctx.fillText(this.score.p1, cx-50, 65);
            ctx.fillStyle = "#555"; ctx.fillText("-", cx, 65);
            ctx.fillStyle = "#e74c3c"; ctx.fillText(this.score.p2, cx+50, 65);

            this.msgs.forEach(m => {
                m.y -= 1; m.a -= 0.02;
                if(m.a > 0) {
                    ctx.globalAlpha = Math.min(1, m.a);
                    ctx.font = "bold 50px 'Russo One'";
                    ctx.strokeStyle = "black"; ctx.lineWidth = 4; ctx.strokeText(m.t, cx, m.y);
                    ctx.fillStyle = m.c; ctx.fillText(m.t, cx, m.y);
                }
            });
            this.msgs = this.msgs.filter(m => m.a > 0);
            ctx.globalAlpha = 1;

            if (this.state === 'SERVE' && this.server === 'p1') {
                ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(cx-150, h-60, 300, 40);
                
                let textoSaque = this.useMouse ? "TOQUE NA TELA PARA SACAR" : "LEVANTE A RAQUETE PARA SACAR";
                ctx.fillStyle = "#fff"; ctx.font = "16px sans-serif"; ctx.fillText(textoSaque, cx, h-33);
                
                const progress = Math.min(1, this.timer / CONF.AUTO_SERVE_DELAY);
                ctx.fillStyle = "#f1c40f"; ctx.fillRect(cx-150, h-20, 300*progress, 4);
            }
        },

        renderMenu: function(ctx, w, h) {
            ctx.fillStyle = "rgba(10,15,20,0.95)"; ctx.fillRect(0,0,w,h);
            ctx.shadowColor = "#3498db"; ctx.shadowBlur = 20;
            ctx.fillStyle = "#fff"; ctx.textAlign = "center";
            ctx.font = "bold 60px 'Russo One'"; ctx.fillText("TABLE TENNIS", w/2, h*0.3);
            ctx.font = "italic 30px sans-serif"; ctx.fillText("AAA EDITION", w/2, h*0.4);
            ctx.shadowBlur = 0;
            ctx.font = "bold 24px sans-serif"; ctx.fillStyle = "#f1c40f";
            ctx.fillText("CLIQUE PARA JOGAR", w/2, h*0.7);
        },

        renderCalibration: function(ctx, w, h) {
            ctx.fillStyle = "#111"; ctx.fillRect(0,0,w,h);
            
            if (this.pose && this.pose.keypoints) {
                this.drawSkeleton(ctx, w, h);
                
                if (this.handedness && this.p1.currRawX !== undefined && this.p1.currRawX !== null && !isNaN(this.p1.currRawX)) {
                    const cx = (this.p1.currRawX / 640) * w;
                    const cy = (this.p1.currRawY / 480) * h;
                    ctx.translate(cx, cy); ctx.rotate(-0.2);
                    ctx.fillStyle = "#8d6e63"; ctx.fillRect(-5, 0, 10, 30); 
                    ctx.fillStyle = "#3498db"; ctx.beginPath(); ctx.arc(0, -20, 25, 0, Math.PI*2); ctx.fill(); 
                    ctx.rotate(0.2); ctx.translate(-cx, -cy);
                    
                    if (this.calibTimer > 0 && (this.state === 'CALIB_TL' || this.state === 'CALIB_BR')) {
                        const progress = Math.min(1, this.calibTimer / CONF.CALIB_TIME);
                        ctx.strokeStyle = "#0ff"; ctx.lineWidth = 6;
                        ctx.beginPath(); ctx.arc(cx, cy, 40, -Math.PI/2, (-Math.PI/2) + (Math.PI*2*progress)); ctx.stroke();
                    }
                }
            } else {
                ctx.fillStyle = "#fff"; ctx.font = "30px sans-serif"; ctx.textAlign = "center";
                ctx.fillText("PROCURANDO JOGADOR...", w/2, h*0.5);
                ctx.font = "20px sans-serif"; ctx.fillStyle = "#aaa";
                ctx.fillText("Fique em frente à câmera e certifique-se de que há luz.", w/2, h*0.6);
            }

            ctx.fillStyle = "#fff"; ctx.textAlign = "center";

            if (this.state === 'CALIB_HAND_SELECT') {
                ctx.font = "bold 40px sans-serif"; ctx.fillText("ESCOLHA SUA MÃO", w/2, h*0.15);
                ctx.font = "24px sans-serif"; ctx.fillStyle = "#aaa";
                ctx.fillText("Levante a mão para selecionar (Segure)", w/2, h*0.22);
                
                ctx.font = "50px sans-serif";
                
                const drawSelectRing = (x, y, hand) => {
                    ctx.fillStyle = "#fff";
                    ctx.fillText(hand === 'left' ? "✋ Esquerda" : "Direita ✋", x, y);
                    if (this.calibHandCandidate === hand) {
                        const progress = Math.min(1, this.calibTimer / CONF.HAND_SELECT_TIME);
                        ctx.strokeStyle = "#0f0"; ctx.lineWidth = 5;
                        ctx.beginPath(); ctx.arc(x, y-20, 60, -Math.PI/2, (-Math.PI/2) + (Math.PI*2*progress)); ctx.stroke();
                    }
                };
                
                drawSelectRing(w*0.2, h*0.5, 'left');
                drawSelectRing(w*0.8, h*0.5, 'right');

            } else {
                const isTL = this.state === 'CALIB_TL';
                ctx.font = "bold 30px sans-serif"; ctx.fillStyle = "#fff";
                ctx.fillText(isTL ? "SEGURE A MÃO NO ALVO VERDE" : "SEGURE A MÃO NO ALVO VERMELHO", w/2, h*0.15);
                
                const tx = isTL ? 100 : w-100;
                const ty = isTL ? 100 : h-100;
                const color = isTL ? "#0f0" : "#f00";
                
                ctx.strokeStyle = color; ctx.lineWidth = 4;
                ctx.beginPath(); ctx.arc(tx, ty, 50, 0, Math.PI*2); ctx.stroke();
                
                if(this.p1.currRawX !== undefined && this.p1.currRawX !== null && !isNaN(this.p1.currRawX)) {
                    const cx = (this.p1.currRawX / 640) * w;
                    const cy = (this.p1.currRawY / 480) * h;
                    ctx.setLineDash([10, 10]); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
                    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke();
                    ctx.setLineDash([]);
                }
            }
        },

        drawSkeleton: function(ctx, w, h) {
             const kps = this.pose.keypoints;
             const find = (n) => kps.find(k => k.name === n && k.score > 0.3);
             const bones = [
                 ['nose', 'left_eye'], ['nose', 'right_eye'],
                 ['left_shoulder', 'right_shoulder'],
                 ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'],
                 ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'],
                 ['left_shoulder', 'left_hip'], ['right_shoulder', 'right_hip'],
                 ['left_hip', 'right_hip']
             ];
             ctx.strokeStyle = "rgba(0, 255, 0, 0.6)"; ctx.lineWidth = 3;
             bones.forEach(bone => {
                 const p1 = find(bone[0]); const p2 = find(bone[1]);
                 if(p1 && p2) {
                     const x1 = ((640 - p1.x) / 640) * w; const y1 = (p1.y / 480) * h;
                     const x2 = ((640 - p2.x) / 640) * w; const y2 = (p2.y / 480) * h;
                     if(!isNaN(x1) && !isNaN(y1) && !isNaN(x2) && !isNaN(y2)) {
                        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
                     }
                 }
             });
             kps.forEach(k => {
                 if(k.score > 0.3) {
                     const x = ((640 - k.x) / 640) * w; const y = (k.y / 480) * h;
                     if(!isNaN(x) && !isNaN(y)) {
                        ctx.fillStyle = "#0f0"; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI*2); ctx.fill();
                     }
                 }
             });
        },

        renderEnd: function(ctx, w, h) {
            ctx.fillStyle = "rgba(0,0,0,0.9)"; ctx.fillRect(0,0,w,h);
            const win = this.score.p1 > this.score.p2;
            ctx.fillStyle = win ? "#f1c40f" : "#e74c3c";
            ctx.font = "bold 80px 'Russo One'"; ctx.textAlign = "center";
            ctx.fillText(win ? "VITÓRIA!" : "DERROTA", w/2, h*0.4);
            ctx.fillStyle = "#fff"; ctx.font = "40px sans-serif";
            ctx.fillText(`${this.score.p1} - ${this.score.p2}`, w/2, h*0.55);
        }
    };

    if (window.System && window.System.registerGame) {
        window.System.registerGame('tennis', 'Table Tennis Pro', '🏆', Game, { camOpacity: 0.1 });
    }

})();