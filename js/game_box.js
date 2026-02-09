// =============================================================================
// SUPER PUNCH-OUT: LEGENDARY EDITION (FINAL GOLD MASTER)
// ARQUITETO: SENIOR DEV (CODE 177)
// ENGINE: "N-SPORTS" PHYSICS & RENDER PIPELINE
// =============================================================================

(function() {
    "use strict";

    // -----------------------------------------------------------------
    // 1. GAME DESIGN DATA (NINTENDO POLISH)
    // -----------------------------------------------------------------
    const CONF = {
        // Gameplay
        ROUNDS: 3,
        ROUND_TIME: 60,
        KNOCKDOWN_HP: 0,
        
        // Physics (Wii Feel)
        PUNCH_TRIGGER_SPEED: 18, // Sensibilidade do soco (menor = mais fácil)
        PUNCH_EXTEND_SPEED: 0.15,// Velocidade visual do braço indo
        PUNCH_RETRACT_SPEED: 0.1,// Velocidade visual do braço voltando
        REACH_DEPTH: 0.8,        // Profundidade necessária para acertar (0.0 a 1.0)
        
        // Visuals
        PLAYER_SCALE: 1.6,       // Jogador (Fantasma/Frente)
        ENEMY_SCALE: 0.9,        // Oponente (Fundo)
        FOV: 400,                // Campo de visão simulado
        
        // Juice
        HIT_STOP: 8,             // Frames congelados no impacto
        SHAKE_PWR: 20            // Força do tremor de tela
    };

    const CHARACTERS = [
        { id: 0, name: 'LITTLE MAC', color: '#2ecc71', skin: '#ffccaa', gloves: '#27ae60', power: 1.0, speed: 1.2 },
        { id: 1, name: 'GLASS JOE',  color: '#ffffff', skin: '#ffccaa', gloves: '#e74c3c', power: 0.8, speed: 1.0 },
        { id: 2, name: 'BALD BULL',  color: '#f1c40f', skin: '#e67e22', gloves: '#f39c12', power: 1.5, speed: 0.7 },
        { id: 3, name: 'MR. SAND',   color: '#e74c3c', skin: '#8d6e63', gloves: '#c0392b', power: 1.3, speed: 1.1 }
    ];

    // -----------------------------------------------------------------
    // 2. AUDIO SYNTHESIZER (NO ASSETS REQUIRED)
    // -----------------------------------------------------------------
    const AudioSys = {
        ctx: null,
        master: null,
        init: function() {
            if (this.ctx) return;
            const AC = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AC();
            this.master = this.ctx.createGain();
            this.master.gain.value = 0.3;
            this.master.connect(this.ctx.destination);
        },
        resume: function() {
            if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
        },
        play: function(id) {
            if (!this.ctx) this.init();
            const t = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            osc.connect(g); g.connect(this.master);

            switch (id) {
                case 'swish': // Ar cortando
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(400, t);
                    osc.frequency.exponentialRampToValueAtTime(100, t + 0.15);
                    g.gain.setValueAtTime(0.1, t);
                    g.gain.linearRampToValueAtTime(0, t + 0.15);
                    osc.start(t); osc.stop(t + 0.15);
                    break;
                case 'hit_light': // Soco rápido
                    osc.type = 'square';
                    osc.frequency.setValueAtTime(200, t);
                    osc.frequency.exponentialRampToValueAtTime(50, t + 0.1);
                    g.gain.setValueAtTime(0.2, t);
                    g.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
                    osc.start(t); osc.stop(t + 0.1);
                    break;
                case 'hit_heavy': // Soco forte
                    osc.type = 'sawtooth';
                    osc.frequency.setValueAtTime(120, t);
                    osc.frequency.exponentialRampToValueAtTime(20, t + 0.3);
                    g.gain.setValueAtTime(0.4, t);
                    g.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
                    osc.start(t); osc.stop(t + 0.3);
                    break;
                case 'block': // Bloqueio
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(800, t);
                    g.gain.setValueAtTime(0.1, t);
                    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
                    osc.start(t); osc.stop(t + 0.05);
                    break;
                case 'bell': // Gongo
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(1500, t);
                    g.gain.setValueAtTime(0.5, t);
                    g.gain.exponentialRampToValueAtTime(0.001, t + 2.0);
                    osc.start(t); osc.stop(t + 2.0);
                    break;
                case 'select':
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(600, t);
                    g.gain.setValueAtTime(0.1, t);
                    g.gain.linearRampToValueAtTime(0, t+0.1);
                    osc.start(t); osc.stop(t + 0.1);
                    break;
            }
        }
    };

    // -----------------------------------------------------------------
    // 3. GAME ENGINE
    // -----------------------------------------------------------------
    const Game = {
        state: 'INIT', // INIT, TITLE, CHAR_SELECT, LOBBY, FIGHT, GAMEOVER
        roomId: 'wii_box_v1',
        isOnline: false,
        dbRef: null,
        
        // State Vars
        selChar: 0,
        timer: 99,
        round: 1,
        winner: null,
        
        // Game Feel
        shake: 0,
        hitStop: 0,
        msgs: [], // Popups de texto

        // Entidades
        p1: null, // Jogador Local (Sempre)
        p2: null, // Oponente (AI ou Remoto)

        // ============================
        // LIFECYCLE
        // ============================
        init: function() {
            this.state = 'TITLE';
            this.cleanup();
            AudioSys.init();
            window.System.msg("SUPER PUNCH-OUT");
            
            // Hook Input Global
            window.System.canvas.onclick = (e) => this.onClick(e);
        },

        cleanup: function() {
            if (this.dbRef) {
                try { this.dbRef.child('players/'+window.System.playerId).remove(); } catch(e){}
                this.dbRef.off();
            }
        },

        createFighter: function(charId, isAI, isRemote) {
            return {
                charId: charId,
                isAI: isAI,
                isRemote: isRemote,
                hp: 100, maxHp: 100,
                stamina: 100,
                guard: false,
                // Pose Lógica (0.0 - 1.0)
                pose: {
                    head: {x:0.5, y:0.3},
                    handL: {x:0.6, y:0.5, z:0, state:'IDLE', cd:0}, // Z: 0=perto corpo, 1=estendido
                    handR: {x:0.4, y:0.5, z:0, state:'IDLE', cd:0}
                },
                // Raw Input suavizado
                raw: { head:{x:0,y:0}, l:{x:0,y:0}, r:{x:0,y:0} },
                // AI State
                aiTimer: 0
            };
        },

        // ============================
        // UPDATE LOOP (60 FPS)
        // ============================
        update: function(ctx, w, h, input) {
            // Hit Stop Logic (Congela o jogo para impacto)
            if (this.hitStop > 0) {
                this.hitStop--;
                this.render(ctx, w, h); // Renderiza estático
                return;
            }

            // State Machine
            switch (this.state) {
                case 'INIT': this.init(); break;
                case 'TITLE': this.drawTitle(ctx, w, h); break;
                case 'CHAR_SELECT': this.drawCharSelect(ctx, w, h); break;
                case 'LOBBY': this.drawLobby(ctx, w, h); break;
                case 'GAMEOVER': this.drawGameOver(ctx, w, h); break;
                case 'FIGHT':
                    this.updateFight(w, h, input);
                    this.render(ctx, w, h);
                    break;
            }
            return 0; // Score dummy
        },

        updateFight: function(w, h, input) {
            // Timer
            if (Math.random() < 0.016) { // ~1 segundo
                this.timer -= 1/60; 
                if (this.timer < 0) this.endRound();
            }

            // 1. Processa Input Player (P1)
            if (!this.p1.isAI && input && input.keypoints) {
                this.processPose(this.p1, input.keypoints, w, h);
            }

            // 2. Processa P2 (AI ou Sync)
            if (this.p2.isAI) {
                this.processAI(this.p2);
            } else if (this.isOnline) {
                this.syncNetwork(); // Envia P1, Recebe P2
            }

            // 3. Física de Mãos (Animação do Soco)
            this.updateHands(this.p1);
            this.updateHands(this.p2);

            // 4. Efeitos
            this.shake *= 0.9;
            if (this.shake < 0.5) this.shake = 0;
            this.msgs.forEach(m => { m.y -= 1; m.life--; });
            this.msgs = this.msgs.filter(m => m.life > 0);

            // 5. Win Condition
            if (this.p1.hp <= 0 || this.p2.hp <= 0) {
                this.winner = this.p1.hp > 0 ? this.p1 : this.p2;
                this.state = 'GAMEOVER';
                AudioSys.play('bell');
            }
        },

        // --- FÍSICA DE SOCO E POSE ---
        processPose: function(p, kp, w, h) {
            const get = (idx) => kp[idx] && kp[idx].score > 0.3 ? kp[idx] : null;
            const nose = get(0); // Nariz
            const wl = get(9);   // Pulso Esq
            const wr = get(10);  // Pulso Dir

            // Suavização (Lerp) para remover tremedeira da webcam
            const lerp = (curr, target) => curr + (target - curr) * 0.3;

            // Cabeça (Esquiva)
            if (nose) {
                // Mapeia X (0-640) para (-1 a 1) para inclinação
                // Espelhado: (1 - x)
                const nx = (1 - nose.x/640); 
                const ny = nose.y/480;
                p.pose.head.x = lerp(p.pose.head.x, nx);
                p.pose.head.y = lerp(p.pose.head.y, ny);
            }

            // Mãos
            const processHand = (hand, rawKP, side) => {
                if (!rawKP) return;
                const nx = (1 - rawKP.x/640); // Espelhado
                const ny = rawKP.y/480;

                // Velocidade do movimento (Detecção de Soco)
                const dx = (nx - p.raw[side].x) * 100;
                const dy = (ny - p.raw[side].y) * 100;
                const vel = Math.sqrt(dx*dx + dy*dy);

                // Armazena raw para proximo frame
                p.raw[side] = {x: nx, y: ny};

                // Lógica de Estado
                if (hand.state === 'IDLE') {
                    // Segue a mão visualmente
                    hand.x = lerp(hand.x, nx);
                    hand.y = lerp(hand.y, ny);

                    // Trigger Soco
                    if (vel > CONF.PUNCH_TRIGGER_SPEED && hand.cd <= 0) {
                        hand.state = 'PUNCH';
                        hand.z = 0;
                        AudioSys.play('swish');
                    }
                    
                    // Defesa (Mãos próximas ao rosto ou centro alto)
                    const distToHead = Math.hypot(hand.x - p.pose.head.x, hand.y - p.pose.head.y);
                    if (distToHead < 0.15) p.guard = true;
                    else if (side==='l' && !p.guard) p.guard = false; // Simplificação
                }
            };

            processHand(p.pose.handL, wl, 'l');
            processHand(p.pose.handR, wr, 'r');
            
            // Stamina regen
            p.stamina = Math.min(100, p.stamina + 0.2);
        },

        updateHands: function(p) {
            ['handL', 'handR'].forEach(hKey => {
                const h = p.pose[hKey];
                
                if (h.state === 'PUNCH') {
                    h.z += CONF.PUNCH_EXTEND_SPEED; // Soco vai para frente
                    
                    // Zona de Impacto (Extensão máx)
                    if (h.z >= CONF.REACH_DEPTH && !h.hitFrame) {
                        h.hitFrame = true; // Só processa colisão uma vez
                        this.checkCollision(p, h);
                    }

                    if (h.z >= 1.0) {
                        h.state = 'RETRACT';
                    }
                } 
                else if (h.state === 'RETRACT') {
                    h.z -= CONF.PUNCH_RETRACT_SPEED; // Soco volta
                    if (h.z <= 0) {
                        h.z = 0;
                        h.state = 'IDLE';
                        h.hitFrame = false;
                        h.cd = 10; // Cooldown frames
                    }
                }
                else if (h.cd > 0) h.cd--;
            });
        },

        checkCollision: function(attacker, hand) {
            const defender = (attacker === this.p1) ? this.p2 : this.p1;
            
            // 1. Checa Defesa
            if (defender.guard) {
                this.spawnMsg("BLOCK", '#aaa');
                AudioSys.play('block');
                defender.stamina -= 5;
                return;
            }

            // 2. Acerto (Hit)
            // Dano base
            let dmg = 8 * CHARACTERS[attacker.charId].power;
            
            // Crítico (Se a mão alvo estiver alinhada com a cabeça do inimigo)
            // Em 2.5D simplificado, assumimos que soco sempre mira no centro/cabeça
            const isCrit = Math.random() > 0.8; 
            if (isCrit) {
                dmg *= 1.5;
                this.shake = CONF.SHAKE_PWR;
                this.hitStop = CONF.HIT_STOP + 4;
                AudioSys.play('hit_heavy');
                this.spawnMsg("CRITICAL!", '#ff0');
            } else {
                this.shake = CONF.SHAKE_PWR / 2;
                this.hitStop = CONF.HIT_STOP;
                AudioSys.play('hit_light');
                this.spawnMsg("HIT", '#fff');
            }

            defender.hp = Math.max(0, defender.hp - dmg);
            
            // Atualiza rede se for ataque local
            if (this.isOnline && attacker === this.p1) {
                this.dbRef.child('players/'+defender.id).update({hp: defender.hp});
            }
        },

        // --- IA Oponente ---
        processAI: function(ai) {
            ai.aiTimer++;
            const t = Date.now() / 1000;
            
            // Movimento da Cabeça (Bobbing)
            ai.pose.head.x = 0.5 + Math.sin(t * 2) * 0.1;
            ai.pose.head.y = 0.3 + Math.cos(t * 4) * 0.05;

            // Mãos em guarda
            ai.pose.handL.x = ai.pose.head.x + 0.1;
            ai.pose.handL.y = ai.pose.head.y + 0.2;
            ai.pose.handR.x = ai.pose.head.x - 0.1;
            ai.pose.handR.y = ai.pose.head.y + 0.2;

            // Decisão de Atacar
            if (ai.aiTimer > 60 && ai.hp > 0) { // A cada ~1s
                const r = Math.random();
                if (r < 0.4) { // 40% chance soco
                    const hand = r < 0.2 ? ai.pose.handL : ai.pose.handR;
                    if (hand.state === 'IDLE') {
                        hand.state = 'PUNCH';
                        AudioSys.play('swish');
                    }
                    ai.aiTimer = 0;
                } else if (r < 0.7) { // Bloqueio
                    ai.guard = true;
                    setTimeout(() => ai.guard = false, 500);
                    ai.aiTimer = 30;
                }
            }
        },

        // --- RENDERIZAÇÃO (WII STYLE) ---
        render: function(ctx, w, h) {
            // Apply Camera Shake
            ctx.save();
            if (this.shake > 0) {
                const dx = (Math.random()-0.5) * this.shake;
                const dy = (Math.random()-0.5) * this.shake;
                ctx.translate(dx, dy);
            }

            // 1. Ringue (Fundo)
            this.drawArena(ctx, w, h);

            // 2. Oponente (Background - Escala Normal)
            this.drawFighter(ctx, this.p2, w, h, false);

            // 3. Player (Foreground - Escala Aumentada e Transparente)
            ctx.globalAlpha = 0.6; // Efeito Wireframe/Fantasma para não tampar a visão
            this.drawFighter(ctx, this.p1, w, h, true);
            ctx.globalAlpha = 1.0;

            // 4. Efeitos e UI
            this.drawFX(ctx, w, h);
            this.drawHUD(ctx, w, h);

            ctx.restore();
        },

        drawArena: function(ctx, w, h) {
            // Gradiente Estilo Estádio
            const g = ctx.createLinearGradient(0,0,0,h);
            g.addColorStop(0, '#2c3e50'); 
            g.addColorStop(0.5, '#000'); 
            g.addColorStop(1, '#2c3e50');
            ctx.fillStyle = g; ctx.fillRect(0,0,w,h);

            // Cordas (Perspectiva)
            const pad = 100;
            ctx.strokeStyle = '#e74c3c'; ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(0, h*0.4); ctx.lineTo(w, h*0.4); // Corda Fundo
            ctx.moveTo(-pad, h*0.6); ctx.lineTo(w+pad, h*0.6); // Corda Frente
            ctx.stroke();

            // Chão
            ctx.fillStyle = '#34495e';
            ctx.beginPath();
            ctx.moveTo(0, h*0.45); ctx.lineTo(w, h*0.45); ctx.lineTo(w, h); ctx.lineTo(0, h);
            ctx.fill();
        },

        drawFighter: function(ctx, f, w, h, isSelf) {
            const scale = isSelf ? CONF.PLAYER_SCALE : CONF.ENEMY_SCALE;
            const c = CHARACTERS[f.charId];
            const p = f.pose;
            
            // Coordenadas de Tela
            // Se for Inimigo, espelhamos X? Não necessariamente, mas centralizamos.
            // Posição base (Head)
            const hx = isSelf ? (1-p.head.x)*w : p.head.x*w;
            const hy = p.head.y*h;
            
            // Corpo (Abstrato para parecer estilo Wii Sports Boxing)
            ctx.fillStyle = c.color;
            ctx.beginPath();
            // Torso segue a cabeça levemente
            ctx.roundRect(hx - 50*scale, hy + 50*scale, 100*scale, 150*scale, 20);
            ctx.fill();

            // Cabeça
            ctx.fillStyle = c.skin;
            ctx.beginPath(); ctx.arc(hx, hy, 40*scale, 0, Math.PI*2); ctx.fill();
            
            // Luvas (Depth Logic)
            const drawGlove = (hand) => {
                // Posição XY
                const gx = isSelf ? (1-hand.x)*w : hand.x*w;
                const gy = hand.y*h;
                
                // Z-Scale: Soco vindo em sua direção (Inimigo) ou indo longe (Player)
                // Inimigo: Z=1 (perto da camera). Player: Z=1 (longe da camera/no inimigo)
                // Ajuste visual para parecer profundidade
                let zSize = 1.0;
                if (isSelf) zSize = 1.0 - (hand.z * 0.4); // Player soco diminui (vai longe)
                else zSize = 1.0 + (hand.z * 0.5); // Inimigo soco aumenta (vem perto)

                const size = 45 * scale * zSize;
                
                ctx.fillStyle = c.gloves;
                ctx.beginPath(); ctx.arc(gx, gy, size, 0, Math.PI*2); ctx.fill();
                ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
            };

            // Desenha luvas (Se for inimigo, luva com maior Z desenha por último para ficar em cima)
            if (p.handL.z < p.handR.z) { drawGlove(p.handL); drawGlove(p.handR); }
            else { drawGlove(p.handR); drawGlove(p.handL); }

            // Escudo de Bloqueio
            if (f.guard) {
                ctx.strokeStyle = '#00ffff'; ctx.lineWidth = 4; ctx.globalAlpha = 0.5;
                ctx.beginPath(); ctx.arc(hx, hy, 70*scale, 0, Math.PI*2); ctx.stroke();
                ctx.globalAlpha = isSelf ? 0.6 : 1.0; // Restaura alpha original
            }
        },

        drawHUD: function(ctx, w, h) {
            const bw = w * 0.4;
            // P1 Bar
            ctx.fillStyle = '#444'; ctx.fillRect(20, 20, bw, 30);
            ctx.fillStyle = '#2ecc71'; ctx.fillRect(25, 25, (bw-10)*(this.p1.hp/100), 20);
            // P2 Bar
            ctx.fillStyle = '#444'; ctx.fillRect(w-bw-20, 20, bw, 30);
            ctx.fillStyle = '#e74c3c'; ctx.fillRect(w-bw-15, 25, (bw-10)*(this.p2.hp/100), 20);
            
            // Timer
            ctx.fillStyle = '#fff'; ctx.font = "bold 50px 'Russo One'"; ctx.textAlign='center';
            ctx.fillText(Math.ceil(this.timer), w/2, 60);
        },

        drawFX: function(ctx, w, h) {
            this.msgs.forEach(m => {
                ctx.fillStyle = m.col; 
                ctx.font = "bold 40px 'Russo One'"; ctx.textAlign='center';
                ctx.fillText(m.text, w/2, h/2 - 100 + (100 - m.life*2)); // Sobe
            });
        },

        spawnMsg: function(text, col) {
            this.msgs.push({text, col, life: 50});
        },

        // ============================
        // INTERFACE (MENU & LOBBY)
        // ============================
        onClick: function(e) {
            AudioSys.resume(); // Acorda audio
            AudioSys.play('select');
            
            const r = window.System.canvas.getBoundingClientRect();
            const y = (e.clientY - r.top) / r.height;
            const x = (e.clientX - r.left) / r.width;

            if (this.state === 'TITLE') {
                if (y < 0.5) this.startOffline();
                else this.startOnline();
            }
            else if (this.state === 'CHAR_SELECT') {
                if (y > 0.8) {
                    this.startGame();
                    AudioSys.play('bell');
                } else {
                    this.selChar = Math.floor(x * CHARACTERS.length);
                }
            }
            else if (this.state === 'GAMEOVER') {
                this.init();
            }
        },

        startOffline: function() {
            this.isOnline = false;
            this.state = 'CHAR_SELECT';
        },
        startOnline: function() {
            if (!window.DB) { window.System.msg("OFFLINE ONLY"); return; }
            this.isOnline = true;
            this.state = 'CHAR_SELECT';
        },
        startGame: function() {
            this.p1 = this.createFighter(this.selChar, false, false);
            if (this.isOnline) {
                this.state = 'LOBBY';
                this.connect();
            } else {
                this.state = 'FIGHT';
                const cpu = Math.floor(Math.random()*CHARACTERS.length);
                this.p2 = this.createFighter(cpu, true, false);
                window.System.msg("ROUND 1");
            }
        },

        connect: function() {
            const ref = window.DB.ref('rooms/' + this.roomId);
            this.dbRef = ref;
            const me = ref.child('players/'+window.System.playerId);
            me.set({ charId: this.selChar, hp: 100, ready: true });
            me.onDisconnect().remove();

            ref.child('players').on('value', snap => {
                const ps = snap.val();
                if (!ps) return;
                const opId = Object.keys(ps).find(id => id !== window.System.playerId);
                
                if (this.state === 'LOBBY' && opId) {
                    this.p2 = this.createFighter(ps[opId].charId, false, true);
                    this.p2.id = opId;
                    this.state = 'FIGHT';
                    window.System.msg("ONLINE MATCH");
                }
                
                if (this.state === 'FIGHT' && opId) {
                    // Sync Pose
                    const op = ps[opId];
                    if (op.pose) this.p2.pose = op.pose;
                    if (op.hp !== undefined) this.p2.hp = op.hp;
                }
            });
        },

        // TELAS DE MENU
        drawTitle: function(ctx, w, h) {
            ctx.fillStyle = '#2c3e50'; ctx.fillRect(0,0,w,h);
            ctx.fillStyle = '#fff'; ctx.textAlign='center'; 
            ctx.font = "bold 60px 'Russo One'"; ctx.fillText("SUPER PUNCH-OUT", w/2, h*0.3);
            
            // Botões
            ctx.fillStyle = '#34495e'; ctx.fillRect(w/2-150, h*0.4, 300, 60);
            ctx.fillStyle = '#fff'; ctx.font="30px Arial"; ctx.fillText("OFFLINE", w/2, h*0.4+40);
            
            ctx.fillStyle = '#34495e'; ctx.fillRect(w/2-150, h*0.6, 300, 60);
            ctx.fillStyle = '#fff'; ctx.fillText("ONLINE", w/2, h*0.6+40);
        },
        drawCharSelect: function(ctx, w, h) {
            ctx.fillStyle = '#111'; ctx.fillRect(0,0,w,h);
            const cw = w / CHARACTERS.length;
            CHARACTERS.forEach((c, i) => {
                if (i === this.selChar) { ctx.fillStyle = '#e67e22'; ctx.fillRect(i*cw, 0, cw, h); }
                ctx.fillStyle = c.color; ctx.beginPath(); ctx.arc(i*cw+cw/2, h/2, 50, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle = '#fff'; ctx.textAlign='center'; ctx.fillText(c.name, i*cw+cw/2, h/2+80);
            });
            ctx.fillStyle = '#27ae60'; ctx.fillRect(0, h-80, w, 80);
            ctx.fillStyle = '#fff'; ctx.font="40px 'Russo One'"; ctx.fillText("FIGHT!", w/2, h-25);
        },
        drawLobby: function(ctx, w, h) {
            ctx.fillStyle = '#000'; ctx.fillRect(0,0,w,h);
            ctx.fillStyle = '#fff'; ctx.textAlign='center'; ctx.fillText("WAITING FOR OPPONENT...", w/2, h/2);
        },
        drawGameOver: function(ctx, w, h) {
            ctx.fillStyle = 'rgba(0,0,0,0.9)'; ctx.fillRect(0,0,w,h);
            const win = this.winner === this.p1;
            ctx.fillStyle = win ? '#f1c40f' : '#e74c3c'; 
            ctx.font = "bold 80px 'Russo One'"; ctx.fillText(win ? "KO! YOU WIN" : "YOU LOSE", w/2, h/2);
            ctx.font = "30px Arial"; ctx.fillStyle = '#fff'; ctx.fillText("CLICK TO MENU", w/2, h/2+100);
        }
    };

    if(window.System) window.System.registerGame('box_leg', 'Super Boxing', '🥊', Game, { camOpacity: 0.1 });

})();
