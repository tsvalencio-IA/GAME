// =============================================================================
// SUPER BOXING: ENTERPRISE EDITION (ROBUST & CRASH-PROOF)
// ARQUITETO: SENIOR DEV (CODE 177)
// STATUS: GOLD MASTER (REFACTORED v2.1 - MULTIPLAYER FIX)
// =============================================================================

(function() {
    "use strict"; 

    // -----------------------------------------------------------------
    // 1. CONSTANTES E CONFIGURAÇÃO
    // -----------------------------------------------------------------
    const CONF = {
        DEBUG: false,
        ROUNDS: 3,
        ROUND_TIME: 90,      // Segundos
        BLOCK_DIST: 100,     // Distância para defesa
        PUNCH_THRESH: 400,   // Velocidade pixel/s para ativar soco
        PUNCH_SPEED: 400,    // Velocidade do soco (Z-axis) unit/s
        RETRACT_SPEED: 200,  // Velocidade de retorno unit/s
        PLAYER_SCALE: 1.4,
        ENEMY_SCALE: 1.0,
        SMOOTHING: 15.0      // Fator de lerp ajustado para DeltaTime
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
    // 2. UTILITÁRIOS SEGUROS (CRASH-PROOF & PHYSICS)
    // -----------------------------------------------------------------
    const SafeUtils = {
        // Lerp independente de frame: a = start, b = end, decay = speed, dt = delta time
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
            wrists: {l:{x:0,y:0, z:0, state:'IDLE', hasHit: false}, r:{x:0,y:0, z:0, state:'IDLE', hasHit: false}}
        })
    };

    // -----------------------------------------------------------------
    // 3. ENGINE DO JOGO
    // -----------------------------------------------------------------
    const Game = {
        state: 'INIT',
        roomId: 'box_pro_v1',
        isOnline: false,
        dbRef: null,
        
        lastTime: 0, // Para cálculo de DeltaTime
        
        selChar: 0,
        selArena: 0,
        timer: 0,
        round: 1,

        p1: null,
        p2: null,
        msgs: [], 

        init: function() {
            try {
                this.state = 'MODE_SELECT';
                this.cleanup();
                if(window.System && window.System.msg) window.System.msg("BOXING PRO");
                
                this.lastTime = performance.now();
                this.p1 = this.createPlayer('p1', 0);
                this.p2 = this.createPlayer('p2', 1);
                
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
                score: 0,
                pose: SafeUtils.createPose(),
                aiState: { timer: 0, action: 'IDLE', targetX: 0, targetY: 0 }, // Estado determinístico da AI
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
                        this.playSound('sine', 600);
                        
                        if (y > h * 0.75) {
                            this.startGame();
                            this.playSound('square', 400);
                        }
                    }
                } 
                else if (this.state === 'GAMEOVER') {
                    this.init();
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
                const cpuId = (this.selChar + 1) % CHARACTERS.length;
                this.p2 = this.createPlayer('p2', cpuId);
                this.state = 'FIGHT';
                this.timer = CONF.ROUND_TIME; 
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
                        this.state = 'GAMEOVER';
                    }
                });
            } catch(e) {
                this.state = 'MODE_SELECT';
            }
        },

        syncPose: function(local, remote) {
            // Interpolação para rede (suave)
            const f = 0.5; // Fator fixo para rede
            
            // Helper que atualiza propriedades em vez de substituir objeto
            // e GARANTE que Z seja preservado
            const syncPart = (l, r) => {
                if(!r) return;
                const next = SafeUtils.lerpPoint(l, r, f, 1);
                l.x = next.x;
                l.y = next.y;
            };

            const syncLimb = (l, r) => {
                if(!r) return;
                syncPart(l, r);
                // CRUCIAL: Atualiza Z e State explicitamente
                l.z = (r.z !== undefined) ? r.z : 0;
                l.state = r.state || 'IDLE';
            };

            syncPart(local.head, remote.head);
            syncPart(local.shoulders.l, remote.shoulders.l);
            syncPart(local.shoulders.r, remote.shoulders.r);
            syncPart(local.elbows.l, remote.elbows.l);
            syncPart(local.elbows.r, remote.elbows.r);
            
            // Sincroniza punhos com Z e Estado
            syncLimb(local.wrists.l, remote.wrists.l);
            syncLimb(local.wrists.r, remote.wrists.r);
        },

        // -----------------------------------------------------------------
        // LOOP PRINCIPAL (UPDATE)
        // -----------------------------------------------------------------
        update: function(ctx, w, h, inputPose) {
            try {
                const now = performance.now();
                const dt = Math.min((now - this.lastTime) / 1000, 0.1); 
                this.lastTime = now;

                if (this.state !== 'FIGHT') {
                    ctx.fillStyle = '#2c3e50'; ctx.fillRect(0,0,w,h);
                }

                if (this.state === 'MODE_SELECT') { this.uiMode(ctx, w, h); return; }
                if (this.state === 'CHAR_SELECT') { this.uiChar(ctx, w, h); return; }
                if (this.state === 'LOBBY') { this.uiLobby(ctx, w, h); return; }
                if (this.state === 'GAMEOVER') { this.uiGameOver(ctx, w, h); return; }

                if (this.state === 'FIGHT') {
                    // 1. INPUT PLAYER
                    this.processInput(inputPose, w, h, dt);

                    // 2. LÓGICA (AI ou Rede)
                    if (this.isOnline) this.sendUpdate();
                    else this.updateAI(w, h, dt);

                    // 3. RENDER
                    this.drawArena(ctx, w, h);
                    
                    // Inimigo (Fundo)
                    this.drawCharacter(ctx, this.p2, w, h, false);
                    
                    // Player (Frente - POV)
                    ctx.globalAlpha = 0.7;
                    this.drawCharacter(ctx, this.p1, w, h, true);
                    ctx.globalAlpha = 1.0;

                    // 4. UI
                    this.drawHUD(ctx, w, h);
                    this.renderMsgs(ctx, dt);

                    // Timer
                    if (this.timer > 0) this.timer -= dt;
                    else this.endRound();

                    if (this.p1.hp <= 0 || this.p2.hp <= 0) this.state = 'GAMEOVER';
                }

                return this.p1.score;

            } catch (err) {
                console.error("Game Loop Error:", err);
                return 0;
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
                    // Lerp independente de frame
                    return SafeUtils.lerpPoint(currentPos, target, smooth, dt);
                }
                return currentPos;
            };

            // Atualiza posições preservando objetos
            const updatePart = (curr, name) => {
                const next = get(name, curr);
                curr.x = next.x;
                curr.y = next.y;
            };

            updatePart(p.head, 'nose');
            updatePart(p.shoulders.l, 'left_shoulder');
            updatePart(p.shoulders.r, 'right_shoulder');
            updatePart(p.elbows.l, 'left_elbow');
            updatePart(p.elbows.r, 'right_elbow');
            
            // Mãos precisam de get para lógica de velocidade
            const nextWrL = get('left_wrist', p.wrists.l);
            const nextWrR = get('right_wrist', p.wrists.r);
            
            this.updateHandLogic(p.wrists.l, nextWrL, this.p1, this.p2, dt);
            this.updateHandLogic(p.wrists.r, nextWrR, this.p1, this.p2, dt);

            // Guarda
            const distL = SafeUtils.dist(p.wrists.l, p.head);
            const distR = SafeUtils.dist(p.wrists.r, p.head);
            this.p1.guard = (distL < CONF.BLOCK_DIST && distR < CONF.BLOCK_DIST);
            
            // Stamina regen
            if(this.p1.stamina < 100) this.p1.stamina += (10 * dt);
        },

        updateHandLogic: function(hand, targetPos, owner, opponent, dt) {
            const dist = SafeUtils.dist(hand, targetPos);
            const velocity = dist / (dt || 0.016);
            
            hand.x = targetPos.x;
            hand.y = targetPos.y;

            // Gatilho de Soco
            if (velocity > CONF.PUNCH_THRESH && hand.state === 'IDLE' && owner.stamina > 15) {
                hand.state = 'PUNCH';
                hand.z = 0;
                hand.hasHit = false; 
                owner.stamina -= 20;
                this.playSound('noise', 200, 0.05);
            }

            // Física do Soco
            if (hand.state === 'PUNCH') {
                const fatigue = Math.max(0.4, owner.stamina / 100);
                const spd = CONF.PUNCH_SPEED * CHARACTERS[owner.charId].speed * fatigue;
                
                hand.z += spd * dt;
                
                if (hand.z > 50 && hand.z < 90) {
                    this.checkHit(hand, owner, opponent);
                }

                if (hand.z > 100) hand.state = 'RETRACT';
            } 
            else if (hand.state === 'RETRACT') {
                hand.z -= CONF.RETRACT_SPEED * dt;
                if (hand.z <= 0) {
                    hand.z = 0;
                    hand.state = 'IDLE';
                    hand.hasHit = false; 
                }
            }
        },

        checkHit: function(hand, attacker, defender) {
            if (hand.hasHit) return;

            const enemyPose = defender.pose;
            const headBox = { x: enemyPose.head.x, y: enemyPose.head.y, r: 70 };
            const cx = (enemyPose.shoulders.l.x + enemyPose.shoulders.r.x) / 2;
            const cy = (enemyPose.shoulders.l.y + enemyPose.shoulders.r.y) / 2;
            const bodyBox = { x: cx, y: cy + 60, r: 90 };

            const hitHead = SafeUtils.dist(hand, headBox) < headBox.r;
            const hitBody = SafeUtils.dist(hand, bodyBox) < bodyBox.r;

            if (hitHead || hitBody) {
                hand.hasHit = true; 
                
                const basePwr = CHARACTERS[attacker.charId].pwr;
                const fatigue = Math.max(0.3, attacker.stamina / 100);
                let damage = basePwr * 5 * fatigue; 

                if (defender.guard) {
                    damage *= 0.25; 
                    this.spawnMsg(headBox.x, headBox.y - 40, "BLOCK", "#aaa");
                    this.playSound('square', 100, 0.1);
                } else {
                    if (hitHead) {
                        damage *= 2.5;
                        this.spawnMsg(headBox.x, headBox.y - 50, "CRITICAL!", "#f00");
                        if(window.Gfx) window.Gfx.shakeScreen(10);
                        this.playSound('sawtooth', 150, 0.1);
                    } else {
                        this.spawnMsg(bodyBox.x, bodyBox.y, "HIT", "#ff0");
                        if(window.Gfx) window.Gfx.shakeScreen(3);
                        this.playSound('sine', 100, 0.1);
                    }
                    attacker.score += Math.floor(damage * 10);
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

            if (this.p1.stamina < 90) ai.guard = true;
            else if (ai.stamina > 90) ai.guard = false;

            const attackPattern = Math.sin(t * 5); 
            
            ['l', 'r'].forEach(s => {
                const hnd = p.wrists[s];
                let tx = p.head.x + (s==='l'?-40:40);
                let ty = p.head.y + (ai.guard ? 0 : 80);

                if (attackPattern > 0.9 && hnd.state === 'IDLE' && ai.stamina > 30) {
                     ai.aiState.targetX = w/2 + (Math.sin(t)*50);
                     ai.aiState.targetY = h/2 + 50;
                     tx = ai.aiState.targetX;
                     ty = ai.aiState.targetY;
                }

                const speed = 5.0; 
                const nextPos = SafeUtils.lerpPoint(hnd, {x: tx, y: ty}, speed, dt);
                
                this.updateHandLogic(hnd, nextPos, ai, this.p1, dt);
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

        // -----------------------------------------------------------------
        // RENDERIZAÇÃO
        // -----------------------------------------------------------------
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

        drawCharacter: function(ctx, player, w, h, isSelf) {
            const p = player.pose;
            if (p.shoulders.l.x === 0) return;

            const c = CHARACTERS[player.charId].c;
            let size = SafeUtils.dist(p.shoulders.l, p.shoulders.r) / 100;
            if (!isSelf) size = 1.0; 
            const s = size * (isSelf ? CONF.PLAYER_SCALE : CONF.ENEMY_SCALE);
            const cx = (p.shoulders.l.x + p.shoulders.r.x) / 2;
            const cy = (p.shoulders.l.y + p.shoulders.r.y) / 2;

            const limb = (p1, p2, width) => {
                if(p1.x===0 || p2.x===0) return;
                ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
                ctx.lineWidth = width * s; ctx.lineCap='round'; ctx.strokeStyle = c.shirt; ctx.stroke();
            };

            ctx.fillStyle = c.shirt; 
            ctx.beginPath(); ctx.ellipse(cx, cy + (40*s), 50*s, 70*s, 0, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = c.overall; 
            ctx.fillRect(cx - 35*s, cy + 50*s, 70*s, 80*s);
            
            limb(p.shoulders.l, p.elbows.l, 25);
            limb(p.elbows.l, p.wrists.l, 25);
            limb(p.shoulders.r, p.elbows.r, 25);
            limb(p.elbows.r, p.wrists.r, 25);

            ctx.fillStyle = c.skin; ctx.beginPath(); ctx.arc(p.head.x, p.head.y, 45*s, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = c.hat; 
            ctx.beginPath(); ctx.arc(p.head.x, p.head.y - 10*s, 48*s, Math.PI, 0); ctx.fill();
            ctx.beginPath(); ctx.ellipse(p.head.x, p.head.y - 10*s, 50*s, 15*s, 0, Math.PI, 0); ctx.fill();
            ctx.fillStyle = "#fff"; ctx.font = `bold ${30*s}px Arial`; ctx.textAlign = 'center';
            ctx.fillText(CHARACTERS[player.charId].name[0], p.head.x, p.head.y - 35*s);

            this.drawGlove(ctx, p.wrists.l, s);
            this.drawGlove(ctx, p.wrists.r, s);
        },

        drawGlove: function(ctx, hand, s) {
            if (hand.x === 0) return;
            // Proteção contra NaN se Z não for sincronizado
            const zVal = hand.z || 0;
            const zScale = Math.max(0.5, 1.0 - (zVal * 0.003)); 
            const size = s * zScale * 35;
            
            ctx.save();
            ctx.translate(hand.x, hand.y);
            ctx.shadowBlur = hand.state === 'PUNCH' ? 20 : 0;
            ctx.shadowColor = '#000';
            const g = ctx.createRadialGradient(-5, -5, 2, 0, 0, size);
            g.addColorStop(0, '#fff'); g.addColorStop(1, '#ddd');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(0, 0, size, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = '#d00'; ctx.fillRect(-size/2, size*0.3, size, size*0.3);
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
            ctx.fillStyle = "#2ecc71"; ctx.fillRect(0, h-80, w, 80);
            ctx.fillStyle = "#fff"; ctx.font="bold 40px Arial";
            ctx.fillText("INICIAR LUTA", w/2, h-25);
        },

        uiLobby: function(ctx, w, h) {
            ctx.fillStyle = "#111"; ctx.fillRect(0,0,w,h);
            ctx.fillStyle = "#fff"; ctx.textAlign="center"; ctx.font="30px sans-serif";
            ctx.fillText("AGUARDANDO OPONENTE...", w/2, h/2);
        },

        uiGameOver: function(ctx, w, h) {
            ctx.fillStyle = "rgba(0,0,0,0.85)"; ctx.fillRect(0,0,w,h);
            const win = this.p1.hp > 0;
            ctx.fillStyle = win ? "#f1c40f" : "#e74c3c";
            ctx.textAlign="center"; ctx.font="bold 60px 'Russo One'";
            ctx.fillText(win ? "VITÓRIA!" : "DERROTA", w/2, h/2);
            ctx.fillStyle = "#fff"; ctx.font="20px sans-serif"; ctx.fillText("CLIQUE PARA REINICIAR", w/2, h-50);
        },

        drawHUD: function(ctx, w, h) {
            const barW = w * 0.4;
            ctx.fillStyle = "#444"; ctx.fillRect(10, 10, barW, 25);
            ctx.fillStyle = "#e74c3c"; ctx.fillRect(10, 10, barW * (this.p1.hp/100), 25);
            ctx.fillStyle = "#444"; ctx.fillRect(w-10-barW, 10, barW, 25);
            ctx.fillStyle = "#3498db"; ctx.fillRect(w-10-barW, 10, barW * (this.p2.hp/100), 25);
            ctx.fillStyle = "#f1c40f"; ctx.fillRect(10, 40, barW * (this.p1.stamina/100), 5);
            ctx.fillStyle = "#fff"; ctx.font="bold 30px Arial"; ctx.textAlign="center";
            ctx.fillText(Math.ceil(this.timer), w/2, 35);
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
            } else this.state = 'GAMEOVER';
        }
    };

    const register = () => {
        if(window.System && window.System.registerGame) {
            window.System.registerGame('box_pro', 'Boxing Pro', '🥊', Game, { camOpacity: 0.1 });
        } else {
            setTimeout(register, 500);
        }
    };
    register();

})();