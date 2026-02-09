// =============================================================================
// SUPER PUNCH-OUT: TITANIUM EDITION (WII STYLE + PRO AUDIO + NETCODE)
// ARQUITETO: SENIOR DEV (CODE 177)
// STATUS: GOLD MASTER - PHYSICS, AUDIO SYNTH, NETWORKING & 3D FAKE DEPTH
// =============================================================================

(function() {
    "use strict";

    // -----------------------------------------------------------------
    // 1. CONFIGURAÇÕES & BALANCEAMENTO
    // -----------------------------------------------------------------
    const CONF = {
        ROUNDS: 3,
        ROUND_TIME: 99,
        GRAVITY: 0.5,
        
        // Física de Soco
        VEL_THRESH: 8,       // Velocidade do pulso p/ considerar soco
        REACH_EXT: 120,      // Extensão do braço p/ impacto
        BLOCK_DIST: 60,      // Distância mão-rosto p/ block
        
        // Game Feel
        HIT_STOP: 6,         // Frames congelados no impacto
        SHAKE_AMO: 15,       // Força do tremor
        
        // Escala Visual
        P_SCALE: 1.4,        // Player (Frente)
        E_SCALE: 1.0         // Inimigo (Fundo)
    };

    const CHARS = [
        { id: 0, name: 'LITTLE MAC', c: { skin:'#ffccaa', glove:'#2ecc71', shirt:'#000', pants:'#2ecc71' }, stats: { pwr:1.0, spd:1.2 } },
        { id: 1, name: 'KING HIPPO', c: { skin:'#f1c40f', glove:'#e74c3c', shirt:'#2c3e50', pants:'#f39c12' }, stats: { pwr:1.5, spd:0.7 } },
        { id: 2, name: 'GLASS JOE',  c: { skin:'#ffccaa', glove:'#fff',    shirt:'#fff',    pants:'#3498db' }, stats: { pwr:0.8, spd:1.0 } },
        { id: 3, name: 'MR. SAND',   c: { skin:'#8d6e63', glove:'#f1c40f', shirt:'#f1c40f', pants:'#000'    }, stats: { pwr:1.3, spd:1.1 } }
    ];

    // -----------------------------------------------------------------
    // 2. ENGINE DE ÁUDIO PROCEDURAL (BOXE)
    // -----------------------------------------------------------------
    const BoxAudio = {
        ctx: null, master: null, initialized: false,
        
        init: function() {
            if(this.initialized) return;
            try {
                const AC = window.AudioContext || window.webkitAudioContext;
                this.ctx = new AC();
                this.master = this.ctx.createGain();
                this.master.gain.value = 0.4;
                this.master.connect(this.ctx.destination);
                this.initialized = true;
            } catch(e) { console.warn("Audio fail"); }
        },

        playTone: function(freq, type, dur, vol=0.5) {
            if(!this.initialized) return;
            if(this.ctx.state === 'suspended') this.ctx.resume();
            const t = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, t);
            g.gain.setValueAtTime(vol, t);
            g.gain.exponentialRampToValueAtTime(0.01, t + dur);
            osc.connect(g); g.connect(this.master);
            osc.start(t); osc.stop(t + dur);
        },

        noise: function(dur, vol=0.5) {
            if(!this.initialized) return;
            const t = this.ctx.currentTime;
            const bSize = this.ctx.sampleRate * dur;
            const buf = this.ctx.createBuffer(1, bSize, this.ctx.sampleRate);
            const data = buf.getChannelData(0);
            for(let i=0; i<bSize; i++) data[i] = Math.random()*2-1;
            
            const src = this.ctx.createBufferSource();
            const g = this.ctx.createGain();
            const f = this.ctx.createBiquadFilter();
            
            src.buffer = buf;
            f.type = 'lowpass'; f.frequency.value = 1000;
            g.gain.setValueAtTime(vol, t);
            g.gain.linearRampToValueAtTime(0, t+dur);
            
            src.connect(f); f.connect(g); g.connect(this.master);
            src.start(t);
        },

        sfx: function(name) {
            switch(name) {
                case 'swish': this.noise(0.15, 0.1); break;
                case 'hit_light': this.playTone(200, 'square', 0.1, 0.2); this.noise(0.1, 0.3); break;
                case 'hit_heavy': this.playTone(100, 'sawtooth', 0.3, 0.4); this.noise(0.2, 0.5); break;
                case 'block': this.playTone(800, 'triangle', 0.05, 0.3); break;
                case 'bell': this.playTone(1200, 'sine', 1.5, 0.3); break; // Gongo
                case 'click': this.playTone(600, 'sine', 0.1, 0.1); break;
                case 'crowd': this.noise(1.0, 0.05); break; // Torcida (noise longo low)
            }
        }
    };

    // -----------------------------------------------------------------
    // 3. LÓGICA DO JOGO
    // -----------------------------------------------------------------
    const Game = {
        state: 'INIT',
        roomId: 'boxe_titanium_v1',
        isOnline: false,
        dbRef: null,
        
        // Seleção
        selChar: 0,
        
        // Loop
        timer: 99,
        round: 1,
        hitStop: 0,
        shake: 0,
        frameCount: 0,
        
        // Entidades
        p1: null, // Jogador Local
        p2: null, // Oponente (IA ou Rede)
        effects: [],

        init: function() {
            this.cleanup();
            this.state = 'MODE_SELECT';
            BoxAudio.init();
            window.System.msg("SUPER PUNCH-OUT");
        },

        cleanup: function() {
            if(this.dbRef) {
                try { this.dbRef.child('players/'+window.System.playerId).remove(); } catch(e){}
                this.dbRef.off();
            }
            if(window.System.canvas) window.System.canvas.onclick = null;
        },

        createFighter: function(charId, isAI) {
            return {
                charId: charId,
                isAI: isAI,
                hp: 100, maxHp: 100,
                stamina: 100,
                guard: false,
                pose: { // Pose Normalizada (0-1)
                    head: {x:0.5, y:0.3},
                    wrL: {x:0.6, y:0.5}, wrR: {x:0.4, y:0.5}
                },
                hands: {
                    l: { state:'IDLE', z:0, vel:0, cd:0 },
                    r: { state:'IDLE', z:0, vel:0, cd:0 }
                },
                aiTimer: 0 // Para lógica de IA
            };
        },

        setupInput: function() {
            window.System.canvas.onclick = (e) => {
                const rect = window.System.canvas.getBoundingClientRect();
                const y = (e.clientY - rect.top) / rect.height;
                const x = (e.clientX - rect.left) / rect.width;

                BoxAudio.init(); // Garante audio context
                if(BoxAudio.ctx && BoxAudio.ctx.state === 'suspended') BoxAudio.ctx.resume();

                if (this.state === 'MODE_SELECT') {
                    if (y < 0.5) this.startOffline();
                    else this.startOnline();
                    BoxAudio.sfx('click');
                }
                else if (this.state === 'CHAR_SELECT') {
                    if(y > 0.7) { // Confirmar
                        this.startMatch();
                        BoxAudio.sfx('bell');
                    } else { // Escolher
                        const idx = Math.floor(x * CHARS.length);
                        if(idx >= 0 && idx < CHARS.length) {
                            this.selChar = idx;
                            BoxAudio.sfx('click');
                        }
                    }
                }
                else if (this.state === 'GAMEOVER') {
                    this.init();
                }
            };
        },

        startOffline: function() {
            this.isOnline = false;
            this.state = 'CHAR_SELECT';
        },

        startOnline: function() {
            if(!window.DB) { window.System.msg("OFFLINE ONLY"); return; }
            this.isOnline = true;
            this.state = 'CHAR_SELECT';
        },

        startMatch: function() {
            this.p1 = this.createFighter(this.selChar, false);
            
            if(!this.isOnline) {
                // IA Random
                const cpuChar = Math.floor(Math.random() * CHARS.length);
                this.p2 = this.createFighter(cpuChar, true);
                this.state = 'FIGHT';
                this.resetRound();
            } else {
                this.connectNet();
            }
        },

        connectNet: function() {
            this.state = 'LOBBY';
            this.dbRef = window.DB.ref('rooms/' + this.roomId);
            const myRef = this.dbRef.child('players/' + window.System.playerId);
            
            myRef.set({
                charId: this.selChar,
                hp: 100,
                pose: this.p1.pose,
                lastSeen: firebase.database.ServerValue.TIMESTAMP
            });
            myRef.onDisconnect().remove();

            // Listener de oponentes
            this.dbRef.child('players').on('value', snap => {
                const players = snap.val();
                if(!players) return;
                
                const opId = Object.keys(players).find(id => id !== window.System.playerId);
                if(opId) {
                    const opData = players[opId];
                    if(!this.p2) { // Entrou oponente
                        this.p2 = this.createFighter(opData.charId, false);
                        this.state = 'FIGHT';
                        this.resetRound();
                        BoxAudio.sfx('bell');
                    }
                    // Sync Oponente
                    this.p2.hp = opData.hp;
                    if(opData.pose) this.syncPose(this.p2, opData.pose);
                    
                    // Verifica Hits Recebidos (Trust Client do Atacante)
                    if(opData.hitOn === window.System.playerId) {
                        this.takeDamage(this.p1, opData.dmg || 5);
                        // Limpa o hit flag remotamente seria ideal, mas aqui só aceitamos
                    }
                } else if (this.state === 'FIGHT') {
                    // Oponente saiu
                    this.state = 'GAMEOVER';
                    window.System.msg("OPONENTE DESCONECTOU");
                }
            });
        },

        resetRound: function() {
            this.timer = CONF.ROUND_TIME;
            this.effects = [];
            this.shake = 0;
            window.System.msg("FIGHT!");
        },

        // --- GAME LOOP ---
        update: function(ctx, w, h, pose) {
            if(this.state === 'INIT') { this.init(); return; }
            if(this.state === 'MODE_SELECT') { this.drawMenu(ctx, w, h); return; }
            if(this.state === 'CHAR_SELECT') { this.drawCharSelect(ctx, w, h); return; }
            if(this.state === 'LOBBY') { this.drawLobby(ctx, w, h); return; }
            if(this.state === 'GAMEOVER') { this.drawGameOver(ctx, w, h); return; }

            // HIT STOP
            if(this.hitStop > 0) {
                this.hitStop--;
                this.drawFight(ctx, w, h); // Renderiza estático
                return;
            }

            this.frameCount++;
            if(this.frameCount % 60 === 0 && this.timer > 0) this.timer--;
            if(this.timer <= 0) this.checkWinner();

            // 1. INPUT PLAYER
            if(pose && pose.keypoints) this.processInput(this.p1, pose.keypoints, w, h);

            // 2. IA / REDE
            if(this.isOnline) {
                this.syncNet(); // Envia dados
            } else {
                this.processAI(); // Roda IA
            }

            // 3. EFEITOS
            this.updateEffects();

            // 4. REGRAS
            if(this.p1.hp <= 0 || this.p2.hp <= 0) this.checkWinner();

            // 5. RENDER
            this.drawFight(ctx, w, h);
        },

        // --- FÍSICA & INPUT ---
        processInput: function(p, kps, w, h) {
            // Mapeia Keypoints (Nose:0, WrL:9, WrR:10)
            const get = (i) => kps[i] && kps[i].score > 0.3 ? kps[i] : null;
            const nose = get(0);
            const wrL = get(9); 
            const wrR = get(10);

            // Suavização da Pose (Lerp)
            if(nose) {
                p.pose.head.x += (nose.x/640 - p.pose.head.x) * 0.2;
                p.pose.head.y += (nose.y/480 - p.pose.head.y) * 0.2;
            }
            // Guarda (Mãos perto do rosto)
            let gL=false, gR=false;
            
            // Processa Mão Esquerda
            if(wrL) this.processHand(p, p.hands.l, wrL, p.pose.head, 'l');
            // Processa Mão Direita
            if(wrR) this.processHand(p, p.hands.r, wrR, p.pose.head, 'r');

            // Stamina regen
            p.stamina = Math.min(100, p.stamina + 0.2);
        },

        processHand: function(p, h, raw, head, side) {
            // Normaliza posições
            const nx = raw.x / 640;
            const ny = raw.y / 480;
            
            // Velocidade
            const dx = (nx - (h.lx || nx)) * 640; // pixel/frame aprox
            const dy = (ny - (h.ly || ny)) * 480;
            const vel = Math.hypot(dx, dy);
            
            h.lx = nx; h.ly = ny; // last pos

            // Atualiza posição visual da mão na pose
            const targetPos = { x: nx, y: ny };
            if(side==='l') p.pose.wrL = targetPos; else p.pose.wrR = targetPos;

            // Bloqueio?
            const distHead = Math.hypot((nx - head.x)*640, (ny - head.y)*480);
            if(distHead < CONF.BLOCK_DIST) p.guard = true;
            else if(p.guard && side==='l') p.guard = false; // Simplificado

            // Lógica de Soco
            if(h.state === 'IDLE') {
                if(vel > CONF.VEL_THRESH && p.stamina > 10 && h.cd <= 0) {
                    h.state = 'PUNCH';
                    h.z = 0; // Profundidade (0 a 1)
                    p.stamina -= 15;
                    BoxAudio.sfx('swish');
                }
            } else if (h.state === 'PUNCH') {
                h.z += 0.15; // Velocidade do soco indo
                if(h.z > 0.5 && !h.hit) { // Zona de impacto
                    this.checkHit(p, this.p2, side); // Checa se acertou p2
                    h.hit = true; // Só acerta uma vez
                }
                if(h.z >= 1.0) h.state = 'RETRACT';
            } else if (h.state === 'RETRACT') {
                h.z -= 0.1;
                if(h.z <= 0) {
                    h.z = 0; h.state = 'IDLE'; h.hit = false; h.cd = 10;
                }
            }
            if(h.cd > 0) h.cd--;
        },

        checkHit: function(atk, def, hand) {
            // Defesa?
            if(def.guard) {
                BoxAudio.sfx('block');
                this.spawnFx(window.innerWidth/2, window.innerHeight/2, 'BLOCK', '#aaa');
                return;
            }

            // Hit!
            const isCrit = Math.random() > 0.8;
            const dmg = (CHARS[atk.charId].stats.pwr * 5) * (isCrit ? 2 : 1);
            
            this.takeDamage(def, dmg);
            
            // Efeitos
            this.hitStop = CONF.HIT_STOP + (isCrit ? 4 : 0);
            this.shake = CONF.SHAKE_AMO;
            BoxAudio.sfx(isCrit ? 'hit_heavy' : 'hit_light');
            this.spawnFx(window.innerWidth/2 + (Math.random()-0.5)*100, window.innerHeight/2 - 100, isCrit?"CRITICAL!":"HIT", isCrit?'#f00':'#ff0');
            
            // Netcode: Sinaliza hit
            if(this.isOnline && this.dbRef) {
                this.dbRef.child('players/'+window.System.playerId).update({
                    hitOn: this.p2.id || 'cpu',
                    dmg: dmg,
                    t: Date.now() // Timestamp pra forçar update
                });
            }
        },

        takeDamage: function(p, val) {
            p.hp = Math.max(0, p.hp - val);
        },

        // --- IA SIMPLES ---
        processAI: function() {
            if(this.p2.hp <= 0) return;
            const ai = this.p2;
            ai.aiTimer++;

            // Movimento idle "bouncing"
            const t = Date.now() * 0.005;
            ai.pose.head.x = 0.5 + Math.sin(t)*0.05;
            ai.pose.head.y = 0.3 + Math.cos(t*2)*0.02;

            // Decisão
            if(ai.aiTimer > 60) {
                const r = Math.random();
                if(r < 0.05) { // Soco
                    const h = Math.random()>0.5 ? ai.hands.l : ai.hands.r;
                    if(h.state === 'IDLE') {
                        h.state = 'PUNCH'; h.z = 0; h.hit = false;
                        BoxAudio.sfx('swish');
                    }
                } else if (r < 0.08) { // Bloqueio
                    ai.guard = !ai.guard;
                }
                ai.aiTimer = 0;
            }

            // Animação Socos IA
            ['l','r'].forEach(s => {
                const h = ai.hands[s];
                if(h.state === 'PUNCH') {
                    h.z += 0.1;
                    if(h.z > 0.7 && !h.hit) {
                        // IA Acerta Player (Se player não bloquear)
                        if(!this.p1.guard) {
                            this.takeDamage(this.p1, 5);
                            this.shake = 10;
                            BoxAudio.sfx('hit_light');
                            this.spawnFx(window.innerWidth/2, window.innerHeight/2+50, "OUCH", '#f00');
                        } else {
                            BoxAudio.sfx('block');
                        }
                        h.hit = true;
                    }
                    if(h.z >= 1) h.state = 'RETRACT';
                } else if (h.state === 'RETRACT') {
                    h.z -= 0.1; if(h.z<=0) { h.z=0; h.state='IDLE'; }
                }
            });
        },

        // --- NETCODE SYNC ---
        syncNet: function() {
            if(!this.dbRef) return;
            if(this.frameCount % 5 === 0) { // Throttle updates
                this.dbRef.child('players/'+window.System.playerId).update({
                    pose: this.p1.pose,
                    hp: this.p1.hp
                });
            }
        },

        syncPose: function(p, raw) {
            // Lerp para suavizar o lag da rede
            const f = 0.3;
            p.pose.head.x += (raw.head.x - p.pose.head.x) * f;
            p.pose.head.y += (raw.head.y - p.pose.head.y) * f;
            p.pose.wrL.x += (raw.wrL.x - p.pose.wrL.x) * f;
            p.pose.wrL.y += (raw.wrL.y - p.pose.wrL.y) * f;
            p.pose.wrR.x += (raw.wrR.x - p.pose.wrR.x) * f;
            p.pose.wrR.y += (raw.wrR.y - p.pose.wrR.y) * f;
        },

        // --- RENDERIZAÇÃO ---
        drawFight: function(ctx, w, h) {
            // 1. Fundo (Pseudo 3D Ring)
            this.drawRing(ctx, w, h);

            // 2. Shake Global
            ctx.save();
            if(this.shake > 0) {
                const dx = (Math.random()-0.5)*this.shake;
                const dy = (Math.random()-0.5)*this.shake;
                ctx.translate(dx, dy);
                this.shake *= 0.9;
                if(this.shake < 1) this.shake = 0;
            }

            // 3. Oponente (Fundo)
            this.drawChar(ctx, this.p2, w, h, false);

            // 4. Player (Frente - Fantasma)
            ctx.globalAlpha = 0.6; // Wireframe style
            this.drawChar(ctx, this.p1, w, h, true);
            ctx.globalAlpha = 1.0;

            // 5. Efeitos
            this.drawFx(ctx);

            ctx.restore();

            // 6. HUD
            this.drawHUD(ctx, w, h);
        },

        drawRing: function(ctx, w, h) {
            // Céu
            const g = ctx.createLinearGradient(0,0,0,h);
            g.addColorStop(0, '#203a43'); g.addColorStop(1, '#2c5364');
            ctx.fillStyle = g; ctx.fillRect(0,0,w,h);

            // Cordas (Perspectiva)
            ctx.beginPath();
            const topY = h*0.4;
            ctx.moveTo(0, topY); ctx.lineTo(w, topY);
            ctx.moveTo(0, topY+40); ctx.lineTo(w, topY+40);
            ctx.moveTo(0, topY+80); ctx.lineTo(w, topY+80);
            ctx.strokeStyle = '#f1c40f'; ctx.lineWidth = 4; ctx.stroke();

            // Chão
            ctx.fillStyle = '#3e2723';
            ctx.beginPath();
            ctx.moveTo(0, topY+100); ctx.lineTo(w, topY+100); ctx.lineTo(w, h); ctx.lineTo(0, h);
            ctx.fill();
        },

        drawChar: function(ctx, p, w, h, isSelf) {
            // Conversão de Pose Normalizada (0-1) para Tela
            const S = (n) => ({ 
                x: isSelf ? (1-n.x)*w : n.x*w, // Espelha se for player
                y: n.y*h 
            }); 
            
            const head = S(p.pose.head);
            const wrL = S(p.pose.wrL || {x:0,y:0});
            const wrR = S(p.pose.wrR || {x:0,y:0});
            const scale = isSelf ? CONF.P_SCALE : CONF.E_SCALE;
            const c = CHARS[p.charId || 0].c;

            // Corpo (Abstrato)
            ctx.fillStyle = c.shirt;
            ctx.beginPath(); 
            // Desenha um torso baseado na posição da cabeça
            const shY = head.y + 60*scale;
            ctx.moveTo(head.x - 40*scale, shY);
            ctx.lineTo(head.x + 40*scale, shY);
            ctx.lineTo(head.x, shY + 150*scale);
            ctx.fill();

            // Cabeça
            ctx.fillStyle = c.skin;
            ctx.beginPath(); ctx.arc(head.x, head.y, 40*scale, 0, Math.PI*2); ctx.fill();
            // Cabelo/Chapeu
            ctx.fillStyle = isSelf ? 'rgba(0,0,0,0.5)' : '#000'; // Sombra rosto se for inimigo
            if(!isSelf) { // Rosto inimigo
                ctx.fillStyle = '#fff';
                ctx.beginPath(); ctx.arc(head.x-10*scale, head.y-5*scale, 8*scale, 0, Math.PI*2); ctx.fill();
                ctx.beginPath(); ctx.arc(head.x+10*scale, head.y-5*scale, 8*scale, 0, Math.PI*2); ctx.fill();
            }

            // Luvas (Z-Depth Trick)
            // Quanto maior o Z, maior a luva (mais perto da câmera ou do inimigo)
            const drawGlove = (pos, handData) => {
                const z = handData ? handData.z : 0;
                // Se for inimigo, Z=1 significa que veio pra minha cara (grande)
                // Se for eu, Z=1 significa que foi pra longe (pequeno no 3D, mas vamos fazer grande para impacto)
                // Na verdade, estilo Punch-Out: Luva fica GRANDE quando bate
                const size = (30 + (z * 30)) * scale;
                
                ctx.fillStyle = c.glove;
                ctx.beginPath(); ctx.arc(pos.x, pos.y, size, 0, Math.PI*2); ctx.fill();
                ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke();
                
                // Brilho
                ctx.fillStyle = 'rgba(255,255,255,0.3)';
                ctx.beginPath(); ctx.arc(pos.x-size*0.3, pos.y-size*0.3, size*0.4, 0, Math.PI*2); ctx.fill();
            };

            // Desenha luvas (ordem de profundidade)
            drawGlove(wrL, p.hands.l);
            drawGlove(wrR, p.hands.r);

            // Guarda Visual
            if(p.guard) {
                ctx.strokeStyle = '#0ff'; ctx.lineWidth = 5; ctx.globalAlpha = 0.5;
                ctx.beginPath(); ctx.arc(head.x, head.y, 60*scale, 0, Math.PI*2); ctx.stroke();
                ctx.globalAlpha = 1.0;
            }
        },

        drawHUD: function(ctx, w, h) {
            // Barras de Vida Estilo Arcade
            const barW = w * 0.4;
            const drawBar = (x, y, pct, col, name) => {
                ctx.fillStyle = '#333'; ctx.fillRect(x, y, barW, 30);
                ctx.fillStyle = col; ctx.fillRect(x+4, y+4, (barW-8)*pct, 22);
                ctx.fillStyle = '#fff'; ctx.font="bold 20px 'Russo One'"; 
                ctx.textAlign = x < w/2 ? 'left' : 'right';
                ctx.fillText(name, x < w/2 ? x : x+barW, y-10);
            };

            drawBar(20, 40, this.p1.hp/100, '#2ecc71', CHARS[this.p1.charId].name); // P1
            drawBar(w-barW-20, 40, this.p2.hp/100, '#e74c3c', CHARS[this.p2.charId].name); // P2

            // Clock
            ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = "bold 50px 'Russo One'";
            ctx.fillText(Math.ceil(this.timer), w/2, 70);
        },

        drawMenu: function(ctx, w, h) {
            ctx.fillStyle = '#2c3e50'; ctx.fillRect(0,0,w,h);
            ctx.fillStyle = '#fff'; ctx.textAlign='center'; 
            ctx.font = "bold 60px 'Russo One'"; ctx.fillText("SUPER PUNCH-OUT", w/2, h*0.3);
            
            this.drawBtn(ctx, w/2, h*0.5, "OFFLINE", !this.isOnline);
            this.drawBtn(ctx, w/2, h*0.65, "ONLINE", this.isOnline);
        },

        drawCharSelect: function(ctx, w, h) {
            ctx.fillStyle = '#111'; ctx.fillRect(0,0,w,h);
            ctx.fillStyle = '#fff'; ctx.textAlign='center'; 
            ctx.font = "bold 40px 'Russo One'"; ctx.fillText("SELECT FIGHTER", w/2, 80);

            const cw = w / CHARS.length;
            CHARS.forEach((c, i) => {
                if(i === this.selChar) { ctx.fillStyle = '#e67e22'; ctx.fillRect(i*cw, 120, cw, h-200); }
                ctx.fillStyle = c.c.skin; ctx.beginPath(); ctx.arc(i*cw + cw/2, h/2, 50, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle = '#fff'; ctx.font="20px Arial"; ctx.fillText(c.name, i*cw+cw/2, h/2+80);
            });
            this.drawBtn(ctx, w/2, h-80, "FIGHT!", true);
        },

        drawLobby: function(ctx, w, h) {
            ctx.fillStyle = '#000'; ctx.fillRect(0,0,w,h);
            ctx.fillStyle = '#fff'; ctx.textAlign='center'; ctx.font = "30px Arial";
            ctx.fillText("SEARCHING OPPONENT...", w/2, h/2);
            ctx.font = "16px Arial"; ctx.fillText("ROOM: "+this.roomId, w/2, h/2+40);
        },

        drawGameOver: function(ctx, w, h) {
            ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fillRect(0,0,w,h);
            const win = this.p1.hp > 0;
            ctx.fillStyle = win ? '#f1c40f' : '#e74c3c'; ctx.textAlign='center'; 
            ctx.font = "bold 80px 'Russo One'"; ctx.fillText(win ? "KNOCKOUT!" : "YOU LOSE", w/2, h/2);
            ctx.fillStyle = '#fff'; ctx.font="30px Arial"; ctx.fillText("Tap to Retry", w/2, h/2+100);
        },

        drawBtn: function(ctx, x, y, txt, active) {
            ctx.fillStyle = active ? '#e67e22' : '#34495e';
            ctx.fillRect(x-100, y-30, 200, 60);
            ctx.strokeStyle = '#fff'; ctx.lineWidth=2; ctx.strokeRect(x-100, y-30, 200, 60);
            ctx.fillStyle = '#fff'; ctx.font="bold 24px Arial"; ctx.fillText(txt, x, y+10);
        },

        // --- SISTEMA DE PARTÍCULAS (FX) ---
        spawnFx: function(x, y, txt, col) {
            this.effects.push({t:txt, x:x, y:y, c:col, l:40, type:'txt'});
            for(let i=0; i<8; i++) {
                this.effects.push({
                    x:x, y:y, vx:(Math.random()-0.5)*15, vy:(Math.random()-0.5)*15, 
                    c:col, l:20, type:'dot'
                });
            }
        },

        drawFx: function(ctx) {
            this.effects.forEach(e => {
                e.l--;
                if(e.type === 'txt') {
                    e.y -= 2;
                    ctx.globalAlpha = e.l/40;
                    ctx.font = "bold 50px 'Russo One'"; ctx.fillStyle = e.c; 
                    ctx.strokeText(e.t, e.x, e.y); ctx.fillText(e.t, e.x, e.y);
                } else {
                    e.x += e.vx; e.y += e.vy;
                    ctx.globalAlpha = e.l/20;
                    ctx.fillStyle = e.c; ctx.beginPath(); ctx.arc(e.x, e.y, 5, 0, Math.PI*2); ctx.fill();
                }
            });
            ctx.globalAlpha = 1.0;
            this.effects = this.effects.filter(e => e.l > 0);
        },

        checkWinner: function() {
            this.state = 'GAMEOVER';
            BoxAudio.sfx(this.p1.hp > 0 ? 'bell' : 'hit_heavy');
        }
    };

    if(window.System) window.System.registerGame('box_plat', 'Super Boxing', '🥊', Game, { camOpacity: 0.1 });

})();
