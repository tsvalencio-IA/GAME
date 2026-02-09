// =============================================================================
// SUPER BOXING: PLATINUM EDITION (FINAL)
// ARQUITETO: SENIOR DEV
// FUSÃO: Lógica de Simulação + Visuais Nintendo Style + Netcode Robusto
// =============================================================================

(function() {
    "use strict";

    // -----------------------------------------------------------------
    // 1. CONFIGURAÇÕES & "GAME FEEL"
    // -----------------------------------------------------------------
    const CONF = {
        ROUNDS: 3,
        ROUND_TIME: 90,
        
        // Física
        REACH_MIN: 0.15,     // Extensão mínima (0-1)
        VEL_THRESH: 0.01,    // Velocidade mínima do soco
        BLOCK_DIST: 0.15,    // Distância da mão para o rosto
        
        // Impacto Visual (Juice)
        SHAKE_POWER: 15,     // Intensidade do tremor
        HIT_STOP: 4,         // Frames congelados no impacto (peso)
        
        // Escala
        PLAYER_SCALE: 1.4,   // Você (frente)
        ENEMY_SCALE: 1.0     // Rival (fundo)
    };

    const CHARS = [
        { id: 0, name: 'MARIO',   c: { skin:'#ffccaa', hat:'#d32f2f', shirt:'#e74c3c', over:'#3498db', glove:'#eee' }, stats: { pwr:1.0, spd:1.0 } },
        { id: 1, name: 'LUIGI',   c: { skin:'#ffccaa', hat:'#27ae60', shirt:'#2ecc71', over:'#2b3a8f', glove:'#eee' }, stats: { pwr:0.9, spd:1.2 } },
        { id: 2, name: 'WARIO',   c: { skin:'#e67e22', hat:'#f1c40f', shirt:'#f39c12', over:'#8e44ad', glove:'#fff' }, stats: { pwr:1.4, spd:0.7 } },
        { id: 3, name: 'WALUIGI', c: { skin:'#ffccaa', hat:'#5e2d85', shirt:'#8e44ad', over:'#2c3e50', glove:'#fff' }, stats: { pwr:1.1, spd:0.9 } }
    ];

    const ARENAS = [
        { name: 'WORLD CIRCUIT', sky:'#2c3e50', floor:'#95a5a6', rope:'#e74c3c' },
        { name: 'UNDERGROUND',   sky:'#1a1a1a', floor:'#3e2723', rope:'#f1c40f' }
    ];

    // -----------------------------------------------------------------
    // 2. UTILITÁRIOS
    // -----------------------------------------------------------------
    const Utils = {
        dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
        lerp: (a, b, t) => a + (b - a) * t,
        toScreen: (norm, w, h) => ({ x: (1 - norm.x) * w, y: norm.y * h })
    };

    // -----------------------------------------------------------------
    // 3. ENGINE
    // -----------------------------------------------------------------
    const Game = {
        state: 'INIT',
        roomId: 'box_plat_v1',
        isOnline: false,
        dbRef: null,

        // Seleção
        selChar: 0,
        
        // Loop
        timer: 99,
        round: 1,
        frameCount: 0,
        
        // Efeitos
        shake: 0,
        hitStop: 0,
        
        // Entidades
        p1: null,
        p2: null,
        effects: [],

        init: function() {
            this.state = 'MODE_SELECT';
            this.cleanup();
            if(window.System && window.System.msg) window.System.msg("SUPER BOXING");
            
            this.p1 = this.createFighter('p1', 0, false);
            this.p2 = this.createFighter('p2', 1, true);
            this.setupInput();
        },

        createFighter: function(id, charIdx, isAI) {
            const stats = CHARS[charIdx].stats;
            return {
                id: id,
                charId: charIdx,
                isAI: isAI,
                hp: 100, maxHp: 100,
                guard: false,
                stamina: 100,
                score: 0,
                combo: 0,
                // Pose Normalizada (0-1) para Lógica
                pose: {
                    head:{x:0.5,y:0.3}, 
                    shL:{x:0.6,y:0.4}, shR:{x:0.4,y:0.4}, 
                    elL:{x:0.65,y:0.5}, elR:{x:0.35,y:0.5},
                    wrL:{x:0.6,y:0.45}, wrR:{x:0.4,y:0.45}
                },
                // Estado das Mãos
                hands: {
                    l: { state:'IDLE', z:0, vel:0, hit:false, cd:0 },
                    r: { state:'IDLE', z:0, vel:0, hit:false, cd:0 }
                },
                ai: { timer: 0, state: 'IDLE' }
            };
        },

        cleanup: function() {
            if(this.dbRef && window.System.playerId) {
                try { this.dbRef.child('players/'+window.System.playerId).remove(); this.dbRef.off(); } catch(e){}
            }
            if(window.System.canvas) window.System.canvas.onclick = null;
        },

        setupInput: function() {
            window.System.canvas.onclick = (e) => {
                const r = window.System.canvas.getBoundingClientRect();
                const x = (e.clientX - r.left) / r.width;
                const y = (e.clientY - r.top) / r.height;

                if (this.state === 'MODE_SELECT') {
                    this.isOnline = (y > 0.5);
                    if(this.isOnline && !window.DB) {
                        window.System.msg("OFFLINE ONLY");
                        return;
                    }
                    this.state = 'CHAR_SELECT';
                    this.playSfx('click');
                } 
                else if (this.state === 'CHAR_SELECT') {
                    // Seleção Determinística por colunas
                    if (y < 0.7) {
                        const idx = Math.floor(x * 4);
                        if(idx >= 0 && idx < CHARS.length) {
                            this.selChar = idx;
                            this.playSfx('hover');
                        }
                    } else {
                        this.startGame();
                        this.playSfx('start');
                    }
                }
                else if (this.state === 'GAMEOVER') {
                    this.init();
                }
            };
        },

        playSfx: function(type) {
            if(!window.Sfx) return;
            if(type==='hit_heavy') window.Sfx.play(150, 'sawtooth', 0.1);
            if(type==='hit_light') window.Sfx.play(200, 'square', 0.1);
            if(type==='block') window.Sfx.play(100, 'sine', 0.1);
            if(type==='swish') window.Sfx.play(400, 'noise', 0.05);
            if(type==='click') window.Sfx.play(600, 'sine', 0.1);
            if(type==='start') window.Sfx.play(400, 'square', 0.2);
        },

        startGame: function() {
            this.p1 = this.createFighter('p1', this.selChar, false);
            if (this.isOnline) {
                this.connectLobby();
            } else {
                let cpuId = (this.selChar + 1) % CHARS.length;
                this.p2 = this.createFighter('p2', cpuId, true);
                this.startMatch();
            }
        },

        startMatch: function() {
            this.state = 'FIGHT';
            this.timer = CONF.ROUND_TIME;
            window.System.msg("ROUND 1");
        },

        connectLobby: function() {
            this.state = 'LOBBY';
            try {
                this.dbRef = window.DB.ref('rooms/' + this.roomId);
                const myRef = this.dbRef.child('players/' + window.System.playerId);
                
                // Envia pacote inicial
                const initData = this.serialize(this.p1);
                initData.charId = this.selChar; // Garante char correto
                
                myRef.set(initData);
                myRef.onDisconnect().remove();

                this.dbRef.child('players').on('value', snap => {
                    const players = snap.val();
                    if(!players) return;
                    const opId = Object.keys(players).find(id => id !== window.System.playerId);
                    
                    if(opId) {
                        const opData = players[opId];
                        if(this.state === 'LOBBY') {
                            this.p2 = this.createFighter('p2', opData.charId || 0, false);
                            this.p2.isRemote = true;
                            this.p2.id = opId;
                            this.startMatch();
                            window.System.msg("VS ONLINE");
                        } else if (this.state === 'FIGHT') {
                            this.p2.hp = opData.hp;
                            if(opData.pose) this.syncPose(this.p2, opData);
                        }
                    } else if (this.state === 'FIGHT') {
                        this.state = 'GAMEOVER';
                        window.System.msg("OPONENTE SAIU");
                    }
                });
            } catch(e) { console.error(e); this.state = 'MODE_SELECT'; }
        },

        // --- UPDATE LOOP ---
        update: function(ctx, w, h, input) {
            this.frameCount++;

            // Hit Stop (Congelamento de impacto)
            if (this.hitStop > 0) {
                this.hitStop--;
                this.render(ctx, w, h);
                return this.p1.score;
            }

            if (this.state !== 'FIGHT') {
                // Desenha menus
                if (this.state === 'MODE_SELECT') this.uiMode(ctx, w, h);
                else if (this.state === 'CHAR_SELECT') this.uiChar(ctx, w, h);
                else if (this.state === 'LOBBY') this.uiLobby(ctx, w, h);
                else if (this.state === 'GAMEOVER') this.uiGameOver(ctx, w, h);
                return 0;
            }

            // === LUTA ===
            
            // 1. Física Player
            if(input && input.keypoints) this.updatePhysics(this.p1, input.keypoints);

            // 2. AI ou Rede
            if(this.isOnline) this.netTick();
            else this.updateAI();

            // 3. Render
            this.render(ctx, w, h);

            // 4. Regras
            if(this.frameCount % 60 === 0 && this.timer > 0) this.timer--;
            if(this.p1.hp <= 0 || this.p2.hp <= 0) this.state = 'GAMEOVER';

            return this.p1.score;
        },

        updatePhysics: function(f, kps) {
            const p = f.pose;
            const get = (idx) => {
                const k = kps[idx];
                return (k && k.score > 0.3) ? {x: k.x, y: k.y} : null; // Retorna raw normalizado (0-1) se o core mandar assim, ou ajusta
            };

            // O Core manda normalizado? Assumindo que sim baseado no prompt anterior
            // Se não, o utils.toScreen cuida na renderização. Aqui processamos lógica 0-1
            
            // Mapeamento (Indices MoveNet: 0:Nose, 5:LSh, 6:RSh, 9:LWr, 10:RWr)
            // Usamos lerp para suavizar
            const map = (curr, raw) => {
                if(!raw) return;
                curr.x = Utils.lerp(curr.x, raw.x, 0.5);
                curr.y = Utils.lerp(curr.y, raw.y, 0.5);
            };

            map(p.head, get(0));
            map(p.shL, get(5)); map(p.shR, get(6));
            map(p.elL, get(7)); map(p.elR, get(8));
            
            // Mãos e Socos
            this.processHand(f, f.hands.l, p.wrL, get(9), p.shL);
            this.processHand(f, f.hands.r, p.wrR, get(10), p.shR);

            // Guarda
            const dL = Utils.dist(p.wrL, p.head);
            const dR = Utils.dist(p.wrR, p.head);
            f.guard = (dL < CONF.BLOCK_DIST && dR < CONF.BLOCK_DIST);
            
            // Stamina
            f.stamina = Math.min(100, f.stamina + 0.3);
        },

        processHand: function(f, h, pos, raw, sh) {
            if(!raw) return;
            
            // Velocidade e Extensão
            const vel = Utils.dist(raw, pos); // Delta frame
            const ext = Utils.dist(raw, sh);  // Distância do ombro
            
            // Atualiza posição
            pos.x = Utils.lerp(pos.x, raw.x, 0.5);
            pos.y = Utils.lerp(pos.y, raw.y, 0.5);

            // Cooldown
            if(h.cd > 0) h.cd--;

            // Máquina de Estados
            if(h.state === 'IDLE') {
                if(vel > CONF.VEL_THRESH && ext > CONF.REACH_MIN && h.cd <= 0 && f.stamina > 10) {
                    h.state = 'PUNCH';
                    h.z = 0;
                    h.hit = false;
                    f.stamina -= 10;
                    this.playSfx('swish');
                }
            } 
            else if(h.state === 'PUNCH') {
                h.z += 0.15; // Z virtual (0 a 1)
                
                // Colisão (Entre 0.5 e 0.8 do soco)
                if(h.z > 0.5 && h.z < 0.8 && !h.hit) {
                    this.checkHit(f, h, pos);
                }
                
                if(h.z >= 1.0) h.state = 'RETRACT';
            } 
            else if(h.state === 'RETRACT') {
                h.z -= 0.1;
                if(h.z <= 0) { h.z = 0; h.state = 'IDLE'; h.cd = 10; }
            }
        },

        checkHit: function(atk, hand, pos) {
            const def = (atk === this.p1) ? this.p2 : this.p1;
            const targetHead = def.pose.head; // Normalizado
            
            // Distância do golpe
            const d = Utils.dist(pos, targetHead);
            
            if(d < 0.15) { // Hit!
                hand.hit = true;
                
                if(def.guard) {
                    this.spawnPopup("BLOCK", '#aaa');
                    this.playSfx('block');
                    def.hp -= 1;
                } else {
                    const dmg = 8 * CHARS[atk.charId].stats.pwr;
                    const crit = Math.random() > 0.8;
                    
                    def.hp -= (crit ? dmg * 1.5 : dmg);
                    atk.score += (crit ? 100 : 50);
                    atk.combo++;
                    
                    // JUICE: Impacto
                    this.hitStop = CONF.HIT_STOP;
                    this.shake = CONF.SHAKE_POWER;
                    this.spawnParticles(10, crit ? '#ff0' : '#fff');
                    this.spawnPopup(crit ? "CRITICAL!" : "HIT!", crit ? '#f00' : '#ff0');
                    this.playSfx(crit ? 'hit_heavy' : 'hit_light');
                    
                    if(window.Gfx) window.Gfx.shakeScreen(5);
                }
                
                if(this.isOnline && this.dbRef) {
                    this.dbRef.child('players/'+def.id).update({hp: def.hp});
                }
            }
        },

        updateAI: function() {
            if(this.p2.hp <= 0) return;
            
            const ai = this.p2.pose;
            const t = Date.now() * 0.002;
            
            // Movimento Vivo
            ai.head.x = 0.5 + Math.sin(t)*0.05;
            ai.head.y = 0.3 + Math.cos(t*2)*0.02;
            ai.shL = {x: ai.head.x+0.1, y: ai.head.y+0.15};
            ai.shR = {x: ai.head.x-0.1, y: ai.head.y+0.15};
            
            // Decisão
            this.p2.ai.timer--;
            if(this.p2.ai.timer <= 0) {
                const rand = Math.random();
                if(rand < 0.05) { // Soco
                    const h = (Math.random()>0.5) ? this.p2.hands.l : this.p2.hands.r;
                    h.state = 'PUNCH';
                    this.p2.ai.timer = 60;
                } else if(rand < 0.05) { // Guarda
                    this.p2.guard = !this.p2.guard;
                    this.p2.ai.timer = 40;
                }
            }
            
            // Animação Mãos AI
            ['l','r'].forEach(s => {
                const h = this.p2.hands[s];
                const w = (s==='l') ? ai.wrL : ai.wrR;
                const rest = {x: ai.head.x + (s==='l'?0.1:-0.1), y: ai.head.y + 0.2};
                
                if(h.state === 'IDLE') {
                    if(this.p2.guard) rest.y -= 0.1;
                    w.x = Utils.lerp(w.x, rest.x, 0.1);
                    w.y = Utils.lerp(w.y, rest.y, 0.1);
                } else if (h.state === 'PUNCH') {
                    h.z += 0.1;
                    w.x = Utils.lerp(w.x, 0.5, 0.2); // Mira no centro (você)
                    w.y = Utils.lerp(w.y, 0.4, 0.2);
                    
                    if(h.z > 0.6 && !h.hit) { // Hit check simples vs player
                        if(!this.p1.guard) {
                            this.p1.hp -= 2;
                            this.spawnPopup("OUCH", '#f00');
                            this.shake = 10;
                        }
                        h.hit = true;
                    }
                    if(h.z >= 1) h.state = 'RETRACT';
                } else {
                    h.z -= 0.1; if(h.z<=0) { h.z=0; h.state='IDLE'; h.hit=false; }
                }
            });
        },

        // --- NETCODE ---
        netTick: function() {
            if(this.frameCount % 4 === 0 && this.dbRef) {
                this.dbRef.child('players/'+window.System.playerId).update(this.serialize(this.p1));
            }
        },
        
        serialize: function(p) {
            const f = n => Math.floor(n*100)/100;
            return {
                hp: p.hp,
                pose: {
                    head: {x:f(p.pose.head.x), y:f(p.pose.head.y)},
                    wrL: {x:f(p.pose.wrL.x), y:f(p.pose.wrL.y), z:f(p.hands.l.z)},
                    wrR: {x:f(p.pose.wrR.x), y:f(p.pose.wrR.y), z:f(p.hands.r.z)}
                }
            };
        },
        
        syncPose: function(p, data) {
            const pose = data.pose;
            const f = 0.3;
            if(pose.head) {
                p.pose.head.x = Utils.lerp(p.pose.head.x, pose.head.x, f);
                p.pose.head.y = Utils.lerp(p.pose.head.y, pose.head.y, f);
                // Inferir ombros
                p.pose.shL = {x: p.pose.head.x+0.1, y: p.pose.head.y+0.15};
                p.pose.shR = {x: p.pose.head.x-0.1, y: p.pose.head.y+0.15};
            }
            if(pose.wrL) {
                p.pose.wrL.x = Utils.lerp(p.pose.wrL.x, pose.wrL.x, f);
                p.pose.wrL.y = Utils.lerp(p.pose.wrL.y, pose.wrL.y, f);
                p.hands.l.z = pose.wrL.z;
            }
            if(pose.wrR) {
                p.pose.wrR.x = Utils.lerp(p.pose.wrR.x, pose.wrR.x, f);
                p.pose.wrR.y = Utils.lerp(p.pose.wrR.y, pose.wrR.y, f);
                p.hands.r.z = pose.wrR.z;
            }
        },

        // --- RENDER (A MÁGICA VISUAL) ---
        render: function(ctx, w, h) {
            // Apply Shake
            ctx.save();
            if(this.shake > 0) {
                ctx.translate((Math.random()-0.5)*this.shake, (Math.random()-0.5)*this.shake);
                this.shake *= 0.9;
                if(this.shake < 1) this.shake = 0;
            }

            this.drawArena(ctx, w, h);
            this.drawChar(ctx, this.p2, w, h, false); // Inimigo (Fundo)
            
            ctx.globalAlpha = 0.8; // Transparência "Ghost" para o Player
            this.drawChar(ctx, this.p1, w, h, true);  // Player (Frente)
            ctx.globalAlpha = 1.0;

            this.drawEffects(ctx, w, h);
            this.drawHUD(ctx, w, h);
            ctx.restore();
        },

        drawChar: function(ctx, f, w, h, isSelf) {
            const p = f.pose;
            const c = CHARS[f.charId].c;
            const S = (n) => Utils.toScreen(n, w, h);
            
            // Escala Visual
            const scale = isSelf ? CONF.PLAYER_SCALE : CONF.ENEMY_SCALE;
            
            // Pontos Tela
            const head = S(p.head);
            const shL = S(p.shL); const shR = S(p.shR);
            const wrL = S(p.wrL); const wrR = S(p.wrR);
            
            // Cotovelos IK (Visual apenas)
            const elL = { x: (shL.x + wrL.x)/2 - 20*scale, y: (shL.y + wrL.y)/2 + 20*scale };
            const elR = { x: (shR.x + wrR.x)/2 + 20*scale, y: (shR.y + wrR.y)/2 + 20*scale };

            // FUNÇÕES DE DESENHO (Estilo Luigi Training)
            const limb = (a, b, wid) => {
                ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
                ctx.lineWidth = wid * scale; ctx.lineCap='round'; ctx.strokeStyle = c.shirt; ctx.stroke();
            };
            const circle = (pos, r, col) => {
                ctx.beginPath(); ctx.arc(pos.x, pos.y, r*scale, 0, Math.PI*2); ctx.fillStyle=col; ctx.fill();
            };

            // 1. Corpo
            const chestX = (shL.x + shR.x)/2;
            const chestY = (shL.y + shR.y)/2;
            
            ctx.fillStyle = c.shirt;
            ctx.beginPath(); ctx.ellipse(chestX, chestY+40*scale, 50*scale, 70*scale, 0, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = c.over;
            ctx.fillRect(chestX-35*scale, chestY+50*scale, 70*scale, 80*scale); // Macacão

            // 2. Braços
            limb(shL, elL, 25); limb(elL, wrL, 20);
            limb(shR, elR, 25); limb(elR, wrR, 20);

            // 3. Cabeça
            circle(head, 45, c.skin);
            // Boné
            ctx.fillStyle = c.hat;
            ctx.beginPath(); ctx.arc(head.x, head.y-10*scale, 46*scale, Math.PI, 0); ctx.fill(); // Domo
            ctx.beginPath(); ctx.ellipse(head.x, head.y-12*scale, 50*scale, 15*scale, 0, 0, Math.PI*2); ctx.fill(); // Aba
            // Letra
            circle({x:head.x, y:head.y-35*scale}, 12, '#fff');
            ctx.fillStyle = c.hat; ctx.font = `bold ${20*scale}px Arial`; ctx.textAlign='center';
            ctx.fillText(CHARS[f.charId].name[0], head.x, head.y-28*scale);

            // 4. Luvas (Com efeito 3D de Z)
            const drawGlove = (pos, hData) => {
                const zScale = 1 + (hData.z * 0.5); // Aumenta quando soco sai
                const size = 30 * scale * zScale;
                
                // Sombra
                ctx.fillStyle='rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(pos.x+10, pos.y+10, size, 0, Math.PI*2); ctx.fill();
                
                // Luva
                const g = ctx.createRadialGradient(pos.x-10, pos.y-10, 5, pos.x, pos.y, size);
                g.addColorStop(0, '#fff'); g.addColorStop(1, c.glove);
                ctx.fillStyle = g;
                ctx.beginPath(); ctx.arc(pos.x, pos.y, size, 0, Math.PI*2); ctx.fill();
                
                // Faixa
                ctx.fillStyle = '#d00'; ctx.fillRect(pos.x-size/2, pos.y+size*0.3, size, size*0.4);
            };
            drawGlove(wrL, f.hands.l);
            drawGlove(wrR, f.hands.r);
        },

        drawArena: function(ctx, w, h) {
            const ar = ARENAS[this.selArena]; // Só tem 1 arena na seleção simples, mas preparado para mais
            const mid = h * 0.5;
            const g = ctx.createLinearGradient(0,0,0,mid);
            g.addColorStop(0, ar.sky); g.addColorStop(1, '#000');
            ctx.fillStyle = g; ctx.fillRect(0,0,w,mid);
            ctx.fillStyle = ar.floor; ctx.fillRect(0,mid,w,h-mid);
            // Cordas
            ctx.strokeStyle = ar.rope; ctx.lineWidth = 5;
            ctx.beginPath(); ctx.moveTo(0, mid-50); ctx.lineTo(w, mid-50); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, mid-120); ctx.lineTo(w, mid-120); ctx.stroke();
        },

        // --- SISTEMA DE EFEITOS (POP UPS) ---
        spawnPopup: function(t, c) { this.effects.push({type:'txt', t:t, c:c, x:window.innerWidth/2, y:window.innerHeight/2, l:40}); },
        spawnParticles: function(n, c) { 
            for(let i=0;i<n;i++) this.effects.push({type:'part', x:window.innerWidth/2, y:window.innerHeight/2, vx:(Math.random()-0.5)*20, vy:(Math.random()-0.5)*20, c:c, l:30});
        },
        drawEffects: function(ctx, w, h) {
            this.effects.forEach(e => {
                e.l--;
                if(e.type === 'txt') {
                    e.y -= 2;
                    ctx.globalAlpha = e.l/40;
                    ctx.font = "bold 60px 'Russo One'"; ctx.fillStyle = e.c; ctx.strokeStyle='#000'; ctx.lineWidth=3;
                    ctx.textAlign='center'; ctx.strokeText(e.t, e.x, e.y); ctx.fillText(e.t, e.x, e.y);
                } else {
                    e.x += e.vx; e.y += e.vy;
                    ctx.globalAlpha = e.l/30;
                    ctx.fillStyle = e.c; ctx.beginPath(); ctx.arc(e.x, e.y, 5, 0, Math.PI*2); ctx.fill();
                }
            });
            ctx.globalAlpha = 1.0;
            this.effects = this.effects.filter(e => e.l > 0);
        },

        // --- UI ---
        uiMode: function(ctx, w, h) {
            ctx.fillStyle = '#2c3e50'; ctx.fillRect(0,0,w,h);
            ctx.fillStyle = '#fff'; ctx.textAlign='center'; ctx.font="bold 60px 'Russo One'"; 
            ctx.fillText("SUPER BOXING", w/2, 100);
            this.btn(ctx, w/2, h/2-60, "OFFLINE", !this.isOnline);
            this.btn(ctx, w/2, h/2+60, "ONLINE", this.isOnline);
        },
        uiChar: function(ctx, w, h) {
            ctx.fillStyle = '#222'; ctx.fillRect(0,0,w,h);
            const cw = w / 4;
            CHARS.forEach((c, i) => {
                if(i === this.selChar) { ctx.fillStyle = c.c.over; ctx.fillRect(i*cw, 0, cw, h); }
                ctx.fillStyle = c.c.hat; ctx.beginPath(); ctx.arc(i*cw + cw/2, h/2, 60, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle = '#fff'; ctx.font="30px Arial"; ctx.textAlign='center';
                ctx.fillText(c.name, i*cw + cw/2, h/2 + 100);
            });
            ctx.fillStyle='#fff'; ctx.font="40px 'Russo One'"; ctx.fillText("CONFIRMAR ->", w/2, h-50);
        },
        uiLobby: function(ctx, w, h) {
            ctx.fillStyle = '#000'; ctx.fillRect(0,0,w,h);
            ctx.fillStyle = '#fff'; ctx.textAlign='center'; ctx.font="30px sans-serif"; ctx.fillText("AGUARDANDO...", w/2, h/2);
        },
        uiGameOver: function(ctx, w, h) {
            ctx.fillStyle = 'rgba(0,0,0,0.9)'; ctx.fillRect(0,0,w,h);
            ctx.fillStyle = this.p1.hp>0?'#f1c40f':'#e74c3c'; ctx.textAlign='center'; ctx.font="bold 80px 'Russo One'";
            ctx.fillText(this.p1.hp>0?"YOU WIN":"KO!", w/2, h/2);
            ctx.fillStyle='#fff'; ctx.font="30px Arial"; ctx.fillText("CLIQUE PARA VOLTAR", w/2, h/2+80);
        },
        drawHUD: function(ctx, w, h) {
            const bw = w*0.4;
            ctx.fillStyle='#333'; ctx.fillRect(20,20,bw,30); ctx.fillRect(w-20-bw,20,bw,30);
            ctx.fillStyle='#2ecc71'; ctx.fillRect(20,20,bw*(this.p1.hp/100),30);
            ctx.fillStyle='#e74c3c'; ctx.fillRect(w-20-bw*(this.p2.hp/100),20,bw*(this.p2.hp/100),30);
            ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.font="bold 40px 'Russo One'"; ctx.fillText(Math.ceil(this.timer), w/2, 50);
        },
        btn: function(ctx, x, y, t, s) {
            ctx.fillStyle = s?'#e67e22':'#34495e'; ctx.fillRect(x-150, y-30, 300, 60);
            ctx.strokeStyle='#fff'; ctx.lineWidth=3; ctx.strokeRect(x-150, y-30, 300, 60);
            ctx.fillStyle='#fff'; ctx.font="bold 30px sans-serif"; ctx.fillText(t, x, y+10);
        }
    };

    if(window.System) window.System.registerGame('box_plat', 'Super Boxing', '🥊', Game, { camOpacity: 0.1 });
})();
