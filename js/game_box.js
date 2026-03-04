// =============================================================================
// SUPER BOXING: ENTERPRISE EDITION (WII PHYSICS OVERHAUL + MISSIONS)
// ARQUITETO: SENIOR DEV (CODE 177) & PARCEIRO DE PROGRAMACAO
// STATUS: PLATINUM MASTER V4.0 + FASES DE CAMPANHA E MOEDAS POR HABILIDADE
// =============================================================================

(function() {
    "use strict"; 

    // -----------------------------------------------------------------
    // 1. CONSTANTES E CONFIGURAÇÃO
    // -----------------------------------------------------------------
    const CONF = {
        DEBUG: false,
        ROUNDS: 3,
        ROUND_TIME: 90,      
        BLOCK_DIST: 120,     
        PUNCH_THRESH: 350,   
        MIN_EXTENSION: 40,   
        PUNCH_SPEED_BASE: 500, 
        RETRACT_SPEED: 400,  
        PLAYER_SCALE: 1.4,
        ENEMY_SCALE: 1.0,
        SMOOTHING: 20.0      
    };

    const CHARACTERS = [
        { id: 0, name: 'MARIO',   c: { hat: '#d32f2f', shirt: '#e74c3c', overall: '#3498db', skin: '#ffccaa' }, pwr: 1.0, speed: 1.0 },
        { id: 1, name: 'LUIGI',   c: { hat: '#27ae60', shirt: '#2ecc71', overall: '#2b3a8f', skin: '#ffccaa' }, pwr: 0.9, speed: 1.2 },
        { id: 2, name: 'WARIO',   c: { hat: '#f1c40f', shirt: '#f39c12', overall: '#8e44ad', skin: '#e67e22' }, pwr: 1.3, speed: 0.8 },
        { id: 3, name: 'WALUIGI', c: { hat: '#5e2d85', shirt: '#8e44ad', overall: '#2c3e50', skin: '#ffccaa' }, pwr: 1.0, speed: 1.1 }
    ];

    const ARENAS = [
        { name: 'CHAMPIONSHIP', bg: '#2c3e50', floor: '#95a5a6', rope: '#c0392b' },
        { name: 'UNDERGROUND',  bg: '#1a1a1a', floor: '#3e2723', rope: '#f1c40f' }
    ];

    // -----------------------------------------------------------------
    // 2. UTILITÁRIOS SEGUROS
    // -----------------------------------------------------------------
    const SafeUtils = {
        lerpDt: (a, b, decay, dt) => {
            if (typeof a !== 'number') return b;
            return b + (a - b) * Math.exp(-decay * dt);
        },
        
        lerpPoint: (curr, target, decay, dt) => {
            if (!curr) return target || {x:0, y:0};
            if (!target) return curr;
            const f = Math.exp(-decay * dt);
            return {
                x: target.x + (curr.x - target.x) * f,
                y: target.y + (curr.y - target.y) * f
            };
        },

        dist: (p1, p2) => {
            if (!p1 || !p2) return 9999;
            return Math.hypot(p1.x - p2.x, p1.y - p2.y);
        },

        toScreen: (kp, w, h) => {
            if (!kp || typeof kp.x !== 'number') return {x: w/2, y: h/2};
            return { x: (1 - kp.x / 640) * w, y: (kp.y / 480) * h };
        },

        createPose: () => ({
            head: {x:0, y:0},
            shoulders: {l:{x:0,y:0}, r:{x:0,y:0}},
            elbows: {l:{x:0,y:0}, r:{x:0,y:0}},
            wrists: {
                l:{x:0,y:0, z:0, state:'IDLE', hasHit: false, velocity: 0, punchForce: 1}, 
                r:{x:0,y:0, z:0, state:'IDLE', hasHit: false, velocity: 0, punchForce: 1}
            }
        })
    };

    // -----------------------------------------------------------------
    // 3. ENGINE DO JOGO (COM MISSÕES INJETADAS)
    // -----------------------------------------------------------------
    const Game = {
        state: 'INIT',
        roomId: 'box_pro_v1',
        isOnline: false,
        dbRef: null,
        
        lastTime: 0, 
        
        selChar: 0,
        selArena: 0,
        timer: 0,
        round: 1,

        p1: null,
        p2: null,
        msgs: [], 
        particles: [],

        // Variáveis de Calibração
        calibTimer: 0,
        calibration: null,
        dynamicMinExtension: null,
        dynamicPunchThresh: null,
        dynamicBlockDist: null,
        calibSuccessTimer: 0,

        // Efeitos Visuais
        screenFlash: 0.0, 
        enemyFlash: 0.0,  
        counterTimer: 0.0, 

        // --- NOVO: GERENCIAMENTO DE MISSÕES E RECOMPENSAS ---
        currentFase: null,
        matchCoins: 0,
        matchEnded: false,

        init: function(faseData) {
            try {
                this.currentFase = faseData || { id: 'arcade', mode: 'FIGHT', desc: 'Vença a Luta!' };
                this.cleanup();
                
                // Se for missão de campanha, salta o menu de rede e vai direto para a escolha de personagem
                if (this.currentFase.id !== 'arcade') {
                    this.state = 'CHAR_SELECT';
                    this.isOnline = false;
                } else {
                    this.state = 'MODE_SELECT';
                }

                if(window.System && window.System.msg) window.System.msg("BOXING PRO");
                
                this.lastTime = performance.now();
                this.p1 = this.createPlayer('p1', 0);
                this.p2 = this.createPlayer('p2', 1);
                
                this.calibration = null;
                this.dynamicMinExtension = null;
                this.dynamicPunchThresh = null;
                this.dynamicBlockDist = null;
                this.particles = [];
                this.matchCoins = 0;
                this.matchEnded = false;
                
                this.setupInput();
            } catch(e) {
                console.error("Critical Init Error:", e);
            }
        },

        createPlayer: function(id, charId) {
            return {
                id: id,
                charId: charId,
                hp: 100, maxHp: 100,
                stamina: 100,
                guard: false,
                isDodging: false, 
                score: 0,
                pose: SafeUtils.createPose(),
                aiState: { timer: 0, action: 'IDLE', targetX: 0, targetY: 0 }, 
                isRemote: false
            };
        },

        cleanup: function() {
            if (this.dbRef && window.System.playerId) {
                try { 
                    this.dbRef.child('players/' + window.System.playerId).remove(); 
                    this.dbRef.off(); 
                } catch(e){ console.warn("Firebase cleanup error", e); }
            }
            if(window.System.canvas) window.System.canvas.onclick = null;
        },

        setupInput: function() {
            window.System.canvas.onclick = (e) => {
                if (this.matchEnded) return; // Bloqueia cliques no fim da luta
                const r = window.System.canvas.getBoundingClientRect();
                const x = (e.clientX - r.left);
                const y = (e.clientY - r.top);
                const w = r.width;
                const h = r.height;

                if (this.state === 'MODE_SELECT') {
                    this.setMode(y < h/2 ? 'OFFLINE' : 'ONLINE');
                    this.playSound('sine', 600);
                } 
                else if (this.state === 'CHAR_SELECT') {
                    const colW = w / CHARACTERS.length;
                    const clickedIndex = Math.floor(x / colW);
                    
                    if (clickedIndex >= 0 && clickedIndex < CHARACTERS.length) {
                        this.selChar = clickedIndex;
                        this.p1.charId = clickedIndex; 
                        this.playSound('sine', 600);
                        
                        if (y > h * 0.75) {
                            this.state = 'CALIBRATION';
                            this.calibTimer = 0;
                            this.calibSuccessTimer = 0;
                            this.playSound('square', 400);
                        }
                    }
                }
            };
        },

        setMode: function(mode) {
            this.state = 'CHAR_SELECT';
            this.isOnline = (mode === 'ONLINE' && !!window.DB);
            if(mode === 'ONLINE' && !window.DB) window.System.msg("OFFLINE MODE");
        },

        startGame: function() {
            this.p1 = this.createPlayer('p1', this.selChar);
            
            if (this.isOnline) {
                this.connectLobby();
            } else {
                // --- INJEÇÃO 20/10: CONFIGURAÇÃO DE MISSÕES (BOSS FIGHTS E ADVERSÁRIOS) ---
                let cpuId = (this.selChar + 1) % CHARACTERS.length; // Default
                let buffHp = 100;
                let buffDmg = 1.0;

                if (this.currentFase.id === 'f1') { cpuId = 1; } // Luigi (Treino)
                if (this.currentFase.id === 'f2') { cpuId = 3; } // Waluigi (Agressivo)
                if (this.currentFase.id === 'f3') { 
                    cpuId = 2; // Wario (Boss)
                    buffHp = 150; // Boss tem mais vida
                    buffDmg = 1.5; // Boss bate mais forte
                }

                this.p2 = this.createPlayer('p2', cpuId);
                this.p2.maxHp = buffHp;
                this.p2.hp = buffHp;
                CHARACTERS[cpuId].pwr = buffDmg;

                this.state = 'FIGHT';
                this.timer = CONF.ROUND_TIME; 
                this.round = 1;
                this.lastTime = performance.now();
                window.System.msg("FIGHT!");
            }
        },

        connectLobby: function() {
            this.state = 'LOBBY';
            try {
                this.dbRef = window.DB.ref('rooms/' + this.roomId);
                const myData = { charId: this.selChar, hp: 100, pose: this.p1.pose };
                this.dbRef.child('players/' + window.System.playerId).set(myData);
                this.dbRef.child('players/' + window.System.playerId).onDisconnect().remove();

                this.dbRef.child('players').on('value', snap => {
                    const players = snap.val();
                    if (!players) return;
                    const opId = Object.keys(players).find(id => id !== window.System.playerId);
                    
                    if (opId) {
                        const opData = players[opId];
                        if (this.state === 'LOBBY') {
                            this.p2 = this.createPlayer('p2', opData.charId || 0);
                            this.p2.isRemote = true;
                            this.p2.id = opId;
                            this.state = 'FIGHT';
                            this.timer = CONF.ROUND_TIME;
                            this.lastTime = performance.now();
                            window.System.msg("VS ONLINE");
                        } 
                        else if (this.state === 'FIGHT') {
                            this.p2.hp = opData.hp;
                            if (opData.pose) this.syncPose(this.p2.pose, opData.pose);
                        }
                    } else if (this.state === 'FIGHT') {
                        window.System.msg("OPONENTE DESCONECTOU");
                        this.processMatchEnd(true); // Ganha por W.O.
                    }
                });
            } catch(e) {
                this.state = 'MODE_SELECT';
            }
        },

        syncPose: function(local, remote) {
            const f = 0.5; 
            const syncPart = (l, r) => {
                if(!r) return;
                const next = SafeUtils.lerpPoint(l, r, f, 1);
                l.x = next.x; l.y = next.y;
            };
            const syncLimb = (l, r) => {
                if(!r) return;
                syncPart(l, r);
                l.z = (r.z !== undefined) ? r.z : 0;
                l.state = r.state || 'IDLE';
            };
            syncPart(local.head, remote.head);
            syncPart(local.shoulders.l, remote.shoulders.l);
            syncPart(local.shoulders.r, remote.shoulders.r);
            syncPart(local.elbows.l, remote.elbows.l);
            syncPart(local.elbows.r, remote.elbows.r);
            syncLimb(local.wrists.l, remote.wrists.l);
            syncLimb(local.wrists.r, remote.wrists.r);
        },

        // --- NOVO: LÓGICA DE FIM DE LUTA PARA O MODO CARREIRA ---
        processMatchEnd: function() {
            if (this.matchEnded) return;
            this.matchEnded = true;
            this.state = 'GAMEOVER';

            let isWin = false;
            
            if (this.p1.hp > 0 && this.p2.hp <= 0) {
                isWin = true; // Ganhou a luta
                this.matchCoins += 15; // Bónus de Nocaute!
                this.p1.score += 500;
                
                // Regra Específica: Fase 2 exige vitória no 1º Round
                if (this.currentFase.id === 'f2' && this.round > 1) {
                    isWin = false;
                    this.spawnMsg(window.innerWidth/2, window.innerHeight/2, "TEMPO ESGOTADO!", "#e74c3c");
                }
            }

            // Pausa dramática para saborear o nocaute antes de fechar o jogo
            setTimeout(() => {
                if(window.System.gameOver) {
                    window.System.gameOver(this.p1.score, isWin, this.matchCoins);
                } else {
                    window.System.home();
                }
            }, 2500); 
        },

        update: function(ctx, w, h, inputPose) {
            try {
                const now = performance.now();
                const dt = Math.min((now - this.lastTime) / 1000, 0.1); 
                this.lastTime = now;

                if (this.state !== 'FIGHT' && this.state !== 'CALIBRATION' && this.state !== 'GAMEOVER') {
                    ctx.fillStyle = '#2c3e50'; ctx.fillRect(0,0,w,h);
                }

                if (this.state === 'MODE_SELECT') { this.uiMode(ctx, w, h); return; }
                if (this.state === 'CHAR_SELECT') { this.uiChar(ctx, w, h); return; }
                if (this.state === 'LOBBY') { this.uiLobby(ctx, w, h); return; }
                
                if (this.state === 'CALIBRATION') {
                    this.processInput(inputPose, w, h, dt); 
                    this.uiCalibration(ctx, w, h, dt);
                    return;
                }

                // Renderiza a Luta (Mesmo se estiver em GAMEOVER para ver a queda)
                if (this.state === 'FIGHT' || this.state === 'GAMEOVER') {
                    if (this.state === 'FIGHT') {
                        this.processInput(inputPose, w, h, dt);

                        if (this.isOnline) this.sendUpdate();
                        else this.updateAI(w, h, dt);

                        if (this.timer > 0) this.timer -= dt;
                        else this.endRound();

                        // Verifica Nocaute
                        if (this.p1.hp <= 0 || this.p2.hp <= 0) {
                            this.processMatchEnd();
                        }
                    }

                    if (this.screenFlash > 0) this.screenFlash -= dt * 2;
                    if (this.enemyFlash > 0) this.enemyFlash -= dt * 5;
                    if (this.counterTimer > 0) this.counterTimer -= dt;

                    this.drawArena(ctx, w, h);
                    
                    if (this.screenFlash > 0) {
                        ctx.fillStyle = `rgba(255, 0, 0, ${this.screenFlash * 0.5})`;
                        ctx.fillRect(0, 0, w, h);
                    }

                    // Se a IA morrer, ela "cai" para baixo (Efeito de Nocaute)
                    if (this.p2.hp <= 0) { this.p2.pose.head.y += 100 * dt; }

                    this.drawCharacter(ctx, this.p2, w, h, false, this.enemyFlash > 0);
                    
                    ctx.globalAlpha = 0.7;
                    this.drawCharacter(ctx, this.p1, w, h, true, false);
                    ctx.globalAlpha = 1.0;

                    this.drawHUD(ctx, w, h);
                    this.renderMsgs(ctx, dt);

                    // Renderizar Partículas Sangue/Suor
                    if (this.particles && this.particles.length > 0) {
                        this.particles.forEach(p => {
                            p.x += p.vx; p.y += p.vy; p.vy += 0.8; p.life -= dt * 2;
                            ctx.fillStyle = p.c; ctx.globalAlpha = Math.max(0, p.life);
                            ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI*2); ctx.fill();
                        });
                        this.particles = this.particles.filter(p => p.life > 0);
                        ctx.globalAlpha = 1.0;
                    }

                    if (this.state === 'GAMEOVER') {
                        ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(0,0,w,h);
                        ctx.fillStyle = this.p1.hp > 0 ? "#f1c40f" : "#e74c3c";
                        ctx.textAlign="center"; ctx.font="bold 80px 'Russo One'";
                        ctx.fillText(this.p1.hp > 0 ? "NOCAUTE!" : "CAIU!", w/2, h/2);
                    }
                }

                return this.p1.score;

            } catch (err) {
                console.error("Game Loop Error:", err);
                return 0;
            }
        },

        uiCalibration: function(ctx, w, h, dt) {
            ctx.fillStyle = '#111'; ctx.fillRect(0,0,w,h);
            this.drawCharacter(ctx, this.p1, w, h, true, false);

            const p = this.p1.pose;
            ctx.strokeStyle = "rgba(255, 255, 255, 0.5)"; ctx.lineWidth = 3;
            
            const drawGuide = (pt, r) => { ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, Math.PI*2); ctx.stroke(); };
            drawGuide(p.shoulders.l, 20); drawGuide(p.shoulders.r, 20);

            ctx.fillStyle = "#FFF"; ctx.textAlign = "center";
            
            if (this.calibSuccessTimer > 0) {
                ctx.font = "bold 50px Arial"; ctx.fillStyle = "#2ecc71";
                ctx.fillText("CALIBRAÇÃO OK", w/2, h/2);
                this.calibSuccessTimer += dt;
                if (this.calibSuccessTimer > 1.0) this.startGame();
                return;
            }

            ctx.font = "bold 40px Arial"; ctx.fillText("FAÇA A POSE T", w/2, h * 0.2);
            ctx.font = "20px Arial"; ctx.fillText("ABRA OS BRAÇOS EM 90°", w/2, h * 0.25);

            const armL = Math.abs(p.wrists.l.x - p.shoulders.l.x);
            const armR = Math.abs(p.wrists.r.x - p.shoulders.r.x);
            const shWidth = Math.abs(p.shoulders.r.x - p.shoulders.l.x);
            
            const extendedL = armL > (shWidth * 0.9);
            const extendedR = armR > (shWidth * 0.9);
            const verticalTolerance = shWidth * 1.2;
            const levelL = Math.abs(p.shoulders.l.y - p.wrists.l.y) < verticalTolerance;
            const levelR = Math.abs(p.shoulders.r.y - p.wrists.r.y) < verticalTolerance;

            const isValid = extendedL && extendedR;

            ctx.fillStyle = (isValid) ? "#2ecc71" : "#e74c3c";
            ctx.beginPath(); ctx.arc(p.wrists.l.x, p.wrists.l.y, 10, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.arc(p.wrists.r.x, p.wrists.r.y, 10, 0, Math.PI*2); ctx.fill();

            if (isValid && shWidth > 20) {
                this.calibTimer += dt;
                const progress = Math.min(1.0, this.calibTimer / 1.2);
                ctx.fillStyle = "#2ecc71"; ctx.fillRect(w/2 - 100, h * 0.3, 200 * progress, 20);
                ctx.strokeStyle = "#fff"; ctx.strokeRect(w/2 - 100, h * 0.3, 200, 20);

                if (this.calibTimer > 1.2) {
                    const avgArm = (armL + armR) / 2;
                    this.calibration = { armLengthBase: avgArm, shoulderWidthBase: shWidth, scaleFactor: avgArm / 120 };
                    this.dynamicMinExtension = 0.25 * avgArm;
                    this.dynamicPunchThresh = 2.2 * avgArm; 
                    this.dynamicBlockDist = 0.9 * avgArm;
                    this.calibSuccessTimer = 0.01; 
                    this.playSound('sine', 800);
                }
            } else {
                this.calibTimer -= dt * 0.3;
                if(this.calibTimer < 0) this.calibTimer = 0;
            }
        },

        processInput: function(input, w, h, dt) {
            if (!input || !input.keypoints) return;
            const kp = input.keypoints;
            const p = this.p1.pose;
            const smooth = CONF.SMOOTHING;

            const get = (name, currentPos) => {
                const point = kp.find(k => k.name === name);
                if (point && point.score > 0.3) {
                    const target = SafeUtils.toScreen(point, w, h);
                    return SafeUtils.lerpPoint(currentPos, target, smooth, dt);
                }
                return currentPos;
            };

            const updatePart = (curr, name) => {
                const next = get(name, curr);
                curr.x = next.x; curr.y = next.y;
            };

            updatePart(p.head, 'nose');
            updatePart(p.shoulders.l, 'left_shoulder');
            updatePart(p.shoulders.r, 'right_shoulder');
            updatePart(p.elbows.l, 'left_elbow');
            updatePart(p.elbows.r, 'right_elbow');
            
            const nextWrL = get('left_wrist', p.wrists.l);
            const nextWrR = get('right_wrist', p.wrists.r);
            
            if (this.state === 'FIGHT') {
                // Sistema de Esquiva Dinâmica
                let noseSpeedX = p.head.x - (this.lastHeadX || p.head.x);
                if (Math.abs(noseSpeedX) > 20) {
                    this.p1.isDodging = true;
                } else {
                    this.p1.isDodging = false;
                }
                this.lastHeadX = p.head.x;

                this.updateHandLogic(p.wrists.l, nextWrL, p.shoulders.l, this.p1, this.p2, dt);
                this.updateHandLogic(p.wrists.r, nextWrR, p.shoulders.r, this.p1, this.p2, dt);

                const distL = SafeUtils.dist(p.wrists.l, p.head);
                const distR = SafeUtils.dist(p.wrists.r, p.head);
                const blockDist = this.dynamicBlockDist || CONF.BLOCK_DIST;
                const handsHigh = (p.wrists.l.y < p.shoulders.l.y + 20) && (p.wrists.r.y < p.shoulders.r.y + 20);
                this.p1.guard = (distL < blockDist && distR < blockDist && handsHigh);
                
                if(this.p1.stamina < 100) this.p1.stamina += (10 * dt);
            } else {
                p.wrists.l.x = nextWrL.x; p.wrists.l.y = nextWrL.y;
                p.wrists.r.x = nextWrR.x; p.wrists.r.y = nextWrR.y;
            }
        },

        updateHandLogic: function(hand, targetPos, shoulderPos, owner, opponent, dt) {
            const MIN_EXTENSION = this.dynamicMinExtension || CONF.MIN_EXTENSION;
            const PUNCH_THRESH = this.dynamicPunchThresh || CONF.PUNCH_THRESH;

            const distMoved = SafeUtils.dist(hand, targetPos);
            const instVelocity = distMoved / (dt || 0.016);
            hand.velocity = instVelocity;

            const currentExt = SafeUtils.dist(hand, shoulderPos);
            const targetExt = SafeUtils.dist(targetPos, shoulderPos);
            const isExtending = targetExt > currentExt + 2; 

            hand.x = targetPos.x;
            hand.y = targetPos.y;

            if (hand.state === 'IDLE' && owner.stamina > 15) {
                if (instVelocity > PUNCH_THRESH && isExtending && targetExt > MIN_EXTENSION) {
                    hand.state = 'PUNCH';
                    hand.z = 0;
                    hand.hasHit = false; 
                    const speedFactor = Math.min(2.0, instVelocity / PUNCH_THRESH);
                    hand.punchForce = speedFactor; 
                    owner.stamina -= 20;
                    this.playSound('noise', 200 + (speedFactor * 100), 0.05);
                }
            }

            if (hand.state === 'PUNCH') {
                const charStats = CHARACTERS[owner.charId];
                const fatigue = Math.max(0.4, owner.stamina / 100);
                const spd = CONF.PUNCH_SPEED_BASE * charStats.speed * fatigue * hand.punchForce;
                
                hand.z += spd * dt;
                
                if (hand.z > 50 && hand.z < 95) {
                    this.checkHit(hand, owner, opponent);
                }
                if (hand.z > 100) {
                    hand.state = 'RETRACT';
                    if (!hand.hasHit) this.playSound('noise', 100, 0.02);
                }
            } 
            else if (hand.state === 'RETRACT') {
                hand.z -= CONF.RETRACT_SPEED * dt;
                if (hand.z <= 0) {
                    hand.z = 0; hand.state = 'IDLE'; hand.hasHit = false; hand.punchForce = 1;
                }
            }
        },

        checkHit: function(hand, attacker, defender) {
            if (hand.hasHit) return;

            const enemyPose = defender.pose;
            const headBox = { x: enemyPose.head.x, y: enemyPose.head.y, r: 80 };
            const cx = (enemyPose.shoulders.l.x + enemyPose.shoulders.r.x) / 2;
            const cy = (enemyPose.shoulders.l.y + enemyPose.shoulders.r.y) / 2;
            const bodyBox = { x: cx, y: cy + 70, r: 100 };

            const hitHead = SafeUtils.dist(hand, headBox) < headBox.r;
            const hitBody = SafeUtils.dist(hand, bodyBox) < bodyBox.r;

            if (hitHead || hitBody) {
                hand.hasHit = true; 

                // --- INJEÇÃO 20/10: MOEDAS POR ESQUIVA PERFEITA ---
                if (defender === this.p1 && defender.isDodging) {
                    this.spawnMsg(headBox.x, headBox.y - 40, "ESQUIVA!", "#2ecc71");
                    this.playSound('sine', 800, 0.2);
                    this.counterTimer = 1.5; 
                    if(window.Gfx) window.Gfx.shakeScreen(5);
                    this.matchCoins += 3; // Recompensa a Esquiva!
                    this.p1.score += 50;
                    hand.z = 80; hand.state = 'RETRACT';
                    return; 
                }
                
                const basePwr = CHARACTERS[attacker.charId].pwr;
                const fatigue = Math.max(0.3, attacker.stamina / 100);
                let damage = basePwr * 5 * fatigue * hand.punchForce; 

                // Counter Attack Massivo
                if (attacker === this.p1 && this.counterTimer > 0) {
                    damage *= 2.0;
                    this.spawnMsg(cx, cy, "COUNTER!!", "#f39c12");
                    this.playSound('sawtooth', 300, 0.3);
                    this.counterTimer = 0; 
                }

                if (defender.guard) {
                    damage *= 0.2; 
                    if (defender === this.p1) {
                        this.spawnMsg(headBox.x, headBox.y - 60, "PERFECT BLOCK!", "#3498db");
                        this.counterTimer = 1.0; 
                        this.matchCoins += 1; // Recompensa a Defesa!
                        this.p1.score += 20;
                    } else {
                        this.spawnMsg(headBox.x, headBox.y - 40, "BLOCKED", "#aaa");
                    }
                    this.playSound('square', 100, 0.1);
                    hand.z = 80; hand.state = 'RETRACT';
                } else {
                    if (hitHead) {
                        damage *= 2.0;
                        if(attacker === this.p1) { 
                            this.spawnMsg(headBox.x, headBox.y - 50, "CRITICAL!", "#f00"); 
                            this.matchCoins += 2; // Recompensa o Headshot!
                        } else this.spawnMsg(window.innerWidth/2, window.innerHeight/2, "OUCH!", "#e74c3c"); 
                        
                        if(window.Gfx) window.Gfx.shakeScreen(15 * hand.punchForce);
                        this.playSound('sawtooth', 150, 0.2);
                    } else {
                        if(attacker === this.p1) this.spawnMsg(bodyBox.x, bodyBox.y, "HIT", "#ff0");
                        if(window.Gfx) window.Gfx.shakeScreen(5 * hand.punchForce);
                        this.playSound('sine', 100, 0.1);
                    }
                    
                    attacker.score += Math.floor(damage * 10);

                    if (defender === this.p1) this.screenFlash = 1.0; 
                    else this.enemyFlash = 1.0; 

                    for(let i=0; i<8; i++) {
                        this.particles.push({
                            x: defender === this.p1 ? headBox.x : cx,
                            y: defender === this.p1 ? headBox.y : cy,
                            vx: (Math.random()-0.5)*20, vy: -Math.random()*15, 
                            life: 1.0, c: hitHead ? "#e74c3c" : "#bdc3c7"
                        });
                    }
                }
                
                defender.hp = Math.max(0, defender.hp - damage);
                
                if(this.isOnline && this.dbRef && attacker === this.p1) {
                     this.dbRef.child('players/' + defender.id).update({ hp: defender.hp });
                }

                hand.state = 'RETRACT';
            }
        },

        updateAI: function(w, h, dt) {
            const ai = this.p2;
            const p = ai.pose;
            const t = this.timer; 
            
            const cx = w/2;
            const cy = h * 0.35;
            p.head = { x: cx + Math.sin(t*2)*30, y: cy + Math.cos(t*3)*10 };
            p.shoulders.l = { x: p.head.x - 50, y: p.head.y + 60 };
            p.shoulders.r = { x: p.head.x + 50, y: p.head.y + 60 };
            p.elbows.l = { x: p.shoulders.l.x - 20, y: p.shoulders.l.y + 60 };
            p.elbows.r = { x: p.shoulders.r.x + 20, y: p.shoulders.r.y + 60 };

            if (this.p1.stamina < 50) ai.guard = true;
            else if (ai.stamina > 70) ai.guard = false;

            const attackPattern = Math.sin(t * 5); 
            
            ['l', 'r'].forEach(s => {
                const hnd = p.wrists[s];
                let tx = p.head.x + (s==='l'?-40:40);
                let ty = p.head.y + (ai.guard ? 20 : 80); 

                if (attackPattern > 0.9 && hnd.state === 'IDLE' && ai.stamina > 30) {
                      ai.aiState.targetX = w/2 + (Math.sin(t)*50);
                      ai.aiState.targetY = h/2 + 50;
                      tx = ai.aiState.targetX;
                      ty = ai.aiState.targetY;
                }

                const speed = 8.0; 
                const nextPos = SafeUtils.lerpPoint(hnd, {x: tx, y: ty}, speed, dt);
                const shoulder = (s === 'l') ? p.shoulders.l : p.shoulders.r;
                this.updateHandLogic(hnd, nextPos, shoulder, ai, this.p1, dt);
            });
            
            if(ai.stamina < 100) ai.stamina += (10 * dt);
        },

        sendUpdate: function() {
            if (Math.floor(this.timer * 10) % 3 === 0 && this.dbRef) {
                const r = (v) => ({x: Math.round(v.x), y: Math.round(v.y), z: Math.round(v.z||0)});
                const p = this.p1.pose;
                this.dbRef.child('players/' + window.System.playerId).update({
                    hp: this.p1.hp,
                    pose: {
                        head: r(p.head),
                        shoulders: {l: r(p.shoulders.l), r: r(p.shoulders.r)},
                        elbows: {l: r(p.elbows.l), r: r(p.elbows.r)},
                        wrists: {
                            l: {...r(p.wrists.l), state: p.wrists.l.state},
                            r: {...r(p.wrists.r), state: p.wrists.r.state}
                        }
                    }
                });
            }
        },

        drawArena: function(ctx, w, h) {
            const ar = ARENAS[this.selArena];
            const mid = h * 0.6;
            const g = ctx.createLinearGradient(0,0,0,mid);
            g.addColorStop(0, ar.bg); g.addColorStop(1, '#000');
            ctx.fillStyle = g; ctx.fillRect(0,0,w,mid);
            ctx.fillStyle = ar.floor; ctx.fillRect(0,mid,w,h-mid);
            ctx.strokeStyle = ar.rope; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.moveTo(0, mid-50); ctx.lineTo(w, mid-50); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, mid-120); ctx.lineTo(w, mid-120); ctx.stroke();
        },

        drawCharacter: function(ctx, player, w, h, isSelf, flash) {
            const p = player.pose;
            if (p.shoulders.l.x === 0) return;

            const c = CHARACTERS[player.charId].c;
            let size = SafeUtils.dist(p.shoulders.l, p.shoulders.r) / 100;
            if (!isSelf) size = 1.0; 
            const s = size * (isSelf ? CONF.PLAYER_SCALE : CONF.ENEMY_SCALE);
            const cx = (p.shoulders.l.x + p.shoulders.r.x) / 2;
            const cy = (p.shoulders.l.y + p.shoulders.r.y) / 2;

            if (flash) {
                ctx.save();
                ctx.globalCompositeOperation = "source-over"; 
            }

            const limb = (p1, p2, width) => {
                if(p1.x===0 || p2.x===0) return;
                ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
                ctx.lineWidth = width * s; ctx.lineCap='round'; 
                ctx.strokeStyle = flash ? '#FFF' : c.shirt; 
                ctx.stroke();
            };

            ctx.fillStyle = flash ? '#FFF' : c.shirt; 
            ctx.beginPath(); ctx.ellipse(cx, cy + (40*s), 50*s, 70*s, 0, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = flash ? '#FFF' : c.overall; 
            ctx.fillRect(cx - 35*s, cy + 50*s, 70*s, 80*s);
            
            limb(p.shoulders.l, p.elbows.l, 25);
            limb(p.elbows.l, p.wrists.l, 25);
            limb(p.shoulders.r, p.elbows.r, 25);
            limb(p.elbows.r, p.wrists.r, 25);

            ctx.fillStyle = flash ? '#FFF' : c.skin; ctx.beginPath(); ctx.arc(p.head.x, p.head.y, 45*s, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = flash ? '#FFF' : c.hat; 
            ctx.beginPath(); ctx.arc(p.head.x, p.head.y - 10*s, 48*s, Math.PI, 0); ctx.fill();
            ctx.beginPath(); ctx.ellipse(p.head.x, p.head.y - 10*s, 50*s, 15*s, 0, Math.PI, 0); ctx.fill();
            
            if (!flash) {
                ctx.fillStyle = "#fff"; ctx.font = `bold ${30*s}px Arial`; ctx.textAlign = 'center';
                ctx.fillText(CHARACTERS[player.charId].name[0], p.head.x, p.head.y - 35*s);
            }

            this.drawGlove(ctx, p.wrists.l, s, flash);
            this.drawGlove(ctx, p.wrists.r, s, flash);

            if (flash) ctx.restore();
        },

        drawGlove: function(ctx, hand, s, flash) {
            if (hand.x === 0) return;
            const zVal = hand.z || 0;
            const zScale = Math.max(0.5, 1.0 - (zVal * 0.003)); 
            const size = s * zScale * 35;
            
            ctx.save();
            ctx.translate(hand.x, hand.y);
            ctx.shadowBlur = hand.state === 'PUNCH' ? 25 : 0;
            ctx.shadowColor = '#000';
            
            if (flash) {
                ctx.fillStyle = "#FFF";
            } else {
                const g = ctx.createRadialGradient(-5, -5, 2, 0, 0, size);
                g.addColorStop(0, '#fff'); g.addColorStop(1, '#ddd');
                ctx.fillStyle = g;
            }
            
            ctx.beginPath(); ctx.arc(0, 0, size, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = flash ? '#FFF' : '#d00'; 
            ctx.fillRect(-size/2, size*0.3, size, size*0.3);
            ctx.restore();
        },

        uiMode: function(ctx, w, h) {
            ctx.fillStyle = "#fff"; ctx.font="bold 50px 'Russo One'"; ctx.textAlign="center";
            ctx.fillText("BOXING PRO", w/2, 100);
            this.drawBtn(ctx, w/2, h/2 - 60, "OFFLINE (VS CPU)", this.state);
            this.drawBtn(ctx, w/2, h/2 + 60, "ONLINE (VS PLAYER)", this.state);
        },

        uiChar: function(ctx, w, h) {
            ctx.fillStyle = "#222"; ctx.fillRect(0,0,w,h);
            const colW = w / CHARACTERS.length;
            CHARACTERS.forEach((c, i) => {
                const x = i * colW;
                const center = x + colW/2;
                if (i === this.selChar) {
                    ctx.fillStyle = c.c.overall;
                    ctx.fillRect(x, 0, colW, h);
                }
                ctx.fillStyle = "#fff"; ctx.textAlign="center";
                ctx.font = i === this.selChar ? "bold 30px Arial" : "20px Arial";
                ctx.fillText(c.name, center, 100);
                ctx.fillStyle = c.c.hat;
                ctx.beginPath(); ctx.arc(center, 200, 40, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle = "#fff"; ctx.font="30px Arial"; 
                ctx.fillText(c.name[0], center, 210);
            });
            
            // --- NOVO: INDICAÇÃO DE MISSÃO NO ECRÃ DE SELEÇÃO ---
            if (this.currentFase.id !== 'arcade') {
                ctx.fillStyle = "rgba(0,0,0,0.8)"; ctx.fillRect(0, 0, w, 60);
                ctx.fillStyle = "#f1c40f"; ctx.font="bold 24px Arial";
                ctx.fillText(`MISSÃO: ${this.currentFase.desc}`, w/2, 35);
            }

            ctx.fillStyle = "#2ecc71"; ctx.fillRect(0, h-80, w, 80);
            ctx.fillStyle = "#fff"; ctx.font="bold 40px Arial";
            ctx.fillText("INICIAR LUTA", w/2, h-25);
        },

        uiLobby: function(ctx, w, h) {
            ctx.fillStyle = "#111"; ctx.fillRect(0,0,w,h);
            ctx.fillStyle = "#fff"; ctx.textAlign="center"; ctx.font="30px sans-serif";
            ctx.fillText("AGUARDANDO OPONENTE...", w/2, h/2);
        },

        drawHUD: function(ctx, w, h) {
            const barW = w * 0.4;
            ctx.fillStyle = "#444"; ctx.fillRect(10, 10, barW, 25);
            ctx.fillStyle = "#e74c3c"; ctx.fillRect(10, 10, barW * (this.p1.hp/this.p1.maxHp), 25);
            ctx.fillStyle = "#444"; ctx.fillRect(w-10-barW, 10, barW, 25);
            ctx.fillStyle = "#3498db"; ctx.fillRect(w-10-barW, 10, barW * (this.p2.hp/this.p2.maxHp), 25);
            ctx.fillStyle = "#f1c40f"; ctx.fillRect(10, 40, barW * (this.p1.stamina/100), 5);
            
            if (this.counterTimer > 0) {
                ctx.fillStyle = "#f39c12"; ctx.font="bold 20px Arial"; ctx.textAlign="left";
                ctx.fillText("COUNTER READY!", 20, 70);
            }

            // Central HUD
            ctx.fillStyle = "#fff"; ctx.font="bold 30px Arial"; ctx.textAlign="center";
            ctx.fillText(Math.ceil(this.timer), w/2, 35);

            // --- NOVO: MOEDAS COLETADAS NA LUTA ---
            ctx.fillStyle = "#f1c40f"; ctx.font="bold 20px 'Russo One'";
            ctx.fillText(`🪙 ${this.matchCoins}`, w/2, 65);
            
            if (this.currentFase.id !== 'arcade') {
                ctx.fillStyle = "#ecf0f1"; ctx.font="14px Arial";
                ctx.fillText(`Missão: ${this.currentFase.desc}`, w/2, 85);
            }
        },

        drawBtn: function(ctx, x, y, txt) {
            ctx.fillStyle = "#34495e"; ctx.fillRect(x-150, y-30, 300, 60);
            ctx.strokeStyle = "#fff"; ctx.strokeRect(x-150, y-30, 300, 60);
            ctx.fillStyle = "#fff"; ctx.font="20px sans-serif"; ctx.fillText(txt, x, y+8);
        },

        spawnMsg: function(x, y, txt, col) {
            this.msgs.push({x, y, t:txt, c:col, life: 1.0}); 
        },
        
        renderMsgs: function(ctx, dt) {
            this.msgs.forEach(m => {
                m.y -= (30 * dt); m.life -= dt;
                ctx.fillStyle = m.c; ctx.font = "bold 30px 'Russo One'"; 
                ctx.strokeText(m.t, m.x, m.y); ctx.fillText(m.t, m.x, m.y);
            });
            this.msgs = this.msgs.filter(m => m.life > 0);
        },

        playSound: function(type, freq, vol=0.1) {
            if(window.Sfx) window.Sfx.play(freq, type, 0.1, vol);
        },

        endRound: function() {
            if(this.round < CONF.ROUNDS) {
                this.round++;
                this.timer = CONF.ROUND_TIME;
                window.System.msg("ROUND " + this.round);
            } else {
                this.processMatchEnd();
            }
        }
    };

    const register = () => {
        if(window.System && window.System.registerGame) {
            window.System.registerGame('box_pro', 'Boxing Pro', '🥊', Game, { 
                camOpacity: 0.1,
                // --- NOVO: FASES DE CAMPANHA DO BOXE ---
                phases: [
                    { id: 'f1', name: 'TREINO AMADOR', desc: 'Derrote o Luigi (Fácil).', reqLvl: 1 },
                    { id: 'f2', name: 'RIVALIDADE', desc: 'Vença o Waluigi antes do 2º Round.', reqLvl: 2 },
                    { id: 'f3', name: 'O CINTURÃO', desc: 'Derrote o Wario (Status de Campeão).', reqLvl: 3 },
                    { id: 'arcade', name: 'MODO LIVRE', desc: 'Lute offline/online sem restrições.', reqLvl: 1 }
                ]
            });
        } else {
            setTimeout(register, 500);
        }
    };
    register();

})();