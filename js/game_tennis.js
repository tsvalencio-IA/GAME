// =============================================================================
// TABLE TENNIS LEGENDS: TITANIUM EDITION (V5.0 - SPATIAL MAPPING & PHYSICS)
// ARQUITETO: SENIOR GAME ENGINE ARCHITECT
// STATUS: 3D PHYSICS, SPATIAL CALIBRATION, MULTIPLAYER SYNC
// =============================================================================

(function() {
    "use strict";

    // -----------------------------------------------------------------
    // 1. CONFIGURAÇÃO E FÍSICA
    // -----------------------------------------------------------------
    const CONF = {
        // Dimensões Virtuais (Unidades de Jogo)
        TABLE_W: 1000,
        TABLE_L: 1800,
        NET_H: 120,
        BALL_R: 22,
        
        // Física
        GRAVITY: 0.55,
        AIR_DRAG: 0.985,    // Resistência do ar
        BOUNCE_LOSS: 0.82,  // Energia perdida ao quicar na mesa
        FLOOR_LEVEL: 600,   // Onde 'morre' a bola
        
        // Gameplay
        PADDLE_SIZE: 130,   // Tamanho da raquete (Hitbox generosa)
        SWING_FORCE: 2.5,   // Multiplicador de força do jogador (Arcade feel)
        MAX_SPEED: 75,
        
        // Multiplayer
        SYNC_RATE: 2        // Enviar dados a cada X frames
    };

    // -----------------------------------------------------------------
    // 2. ENGINE 3D & UTILITÁRIOS (PROJEÇÃO PERSPECTIVA)
    // -----------------------------------------------------------------
    const Utils3D = {
        // Projeta coordenadas 3D (x,y,z) para 2D (x,y,scale) na tela
        project: (x, y, z, w, h) => {
            const fov = 850;
            const camHeight = -600; // Câmera acima da mesa
            const camZ = -950;      // Câmera recuada
            
            // Fator de escala baseado na profundidade (Z)
            // Quanto maior o Z, menor a escala (longe)
            const scale = fov / (fov + (z - camZ));
            
            const x2d = (x * scale) + w/2;
            const y2d = ((y - camHeight) * scale) + h/2;
            
            return { x: x2d, y: y2d, s: scale };
        },

        lerp: (start, end, amt) => (1 - amt) * start + amt * end,
        
        dist2d: (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y),

        // Mapeia valor de um range para outro (Matemática da Calibração)
        map: (value, inMin, inMax, outMin, outMax) => {
            return (value - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
        }
    };

    // -----------------------------------------------------------------
    // 3. LÓGICA DO JOGO (STATE MACHINE)
    // -----------------------------------------------------------------
    const Game = {
        state: 'INIT',      // MODE_SELECT, LOBBY, CALIB_CENTER, CALIB_BOUNDS, SERVE, RALLY, END
        roomId: 'ping_titanium',
        isOnline: false,
        isHost: false,
        dbRef: null,
        
        // Placar
        scoreP1: 0,
        scoreP2: 0,
        serverTurn: 'p1', // Quem está sacando

        // Objetos
        ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, active: false },
        
        // Jogadores
        p1: { 
            handX: 0, handY: 0, // Posição virtual na mesa
            prevX: 0, prevY: 0, 
            velX: 0, velY: 0,
            swingTimer: 0, // Cooldown visual
            history: []    // Histórico para cálculo de velocidade
        },
        p2: { handX: 0, handY: 0 }, // Oponente (IA ou Rede)

        // Controle de Estado
        lastBounceZ: 0,     // Lado do último quique (-1 ou 1)
        bounceCount: 0,     // Quantos quiques no mesmo lado
        gameTimer: 0,
        particles: [],
        hitStop: 0,         // Congelamento de impacto
        
        // --- SISTEMA DE CALIBRAÇÃO ESPACIAL ---
        calib: {
            step: 0,
            timer: 0,
            // Valores iniciais extremos invertidos para forçar detecção
            minX: 1000, maxX: -1000, 
            minY: 1000, maxY: -1000,
            ready: false,
            msg: "INICIANDO..."
        },

        // Mensagens Flutuantes
        msg: { text: "", timer: 0, color: "#fff" },

        init: function() {
            this.state = 'MODE_SELECT';
            this.scoreP1 = 0;
            this.scoreP2 = 0;
            this.serverTurn = 'p1';
            this.setupInput();
            if(window.System && window.System.msg) window.System.msg("PING PONG TITANIUM");
        },

        setupInput: function() {
            // Input de clique para menus
            if(window.System.canvas) {
                window.System.canvas.onclick = (e) => {
                    const r = window.System.canvas.getBoundingClientRect();
                    const my = e.clientY - r.top;
                    const h = r.height;

                    if (this.state === 'MODE_SELECT') {
                        if (my < h/2) this.setMode('OFFLINE');
                        else this.setMode('ONLINE');
                        if(window.Sfx) window.Sfx.click();
                    }
                    else if (this.state === 'END') {
                        this.init();
                    }
                };
            }
        },

        setMode: function(mode) {
            if (mode === 'ONLINE') {
                if (typeof window.DB === 'undefined') {
                    this.showMsg("ERRO: FIREBASE OFF", "#f00");
                    return;
                }
                this.isOnline = true;
                this.connectLobby();
            } else {
                this.isOnline = false;
                this.isHost = true; // Offline eu processo tudo
                this.state = 'CALIB_CENTER'; // Começa calibração
            }
        },

        connectLobby: function() {
            this.state = 'LOBBY';
            const myId = window.System.playerId || 'p_' + Math.floor(Math.random()*9999);
            this.dbRef = window.DB.ref('rooms/' + this.roomId);
            
            // Tenta entrar ou criar sala
            this.dbRef.child('players').once('value', snap => {
                const players = snap.val() || {};
                const pIds = Object.keys(players);
                
                if (pIds.length === 0) {
                    this.isHost = true;
                    this.dbRef.child('players/' + myId).set({ score: 0 });
                    this.waitOpponent(myId);
                } else if (pIds.length === 1) {
                    this.isHost = false;
                    this.dbRef.child('players/' + myId).set({ score: 0 });
                    this.startGameOnline(myId);
                } else {
                    this.showMsg("SALA CHEIA", "#f00");
                    setTimeout(() => this.init(), 2000);
                }
            });
        },

        waitOpponent: function(myId) {
            this.dbRef.child('players').on('value', snap => {
                if (Object.keys(snap.val() || {}).length === 2) {
                    this.state = 'CALIBR_CENTER'; // Inicia calibração mesmo online
                    this.calibTimer = 0;
                    this.dbRef.child('ball').set(this.ball);
                }
            });
            this.dbRef.child('players/' + myId).onDisconnect().remove();
        },

        startGameOnline: function(myId) {
            this.state = 'CALIB_CENTER';
            this.calibTimer = 0;
            this.dbRef.child('players/' + myId).onDisconnect().remove();
        },

        // -----------------------------------------------------------------
        // LOOP PRINCIPAL (UPDATE)
        // -----------------------------------------------------------------
        update: function(ctx, w, h, pose) {
            this.gameTimer++;

            // 1. Hit Stop (Congela lógica para dar impacto)
            if (this.hitStop > 0) {
                this.hitStop--;
                this.renderAll(ctx, w, h); // Apenas renderiza estático
                return this.scoreP1;
            }

            // 2. Renderizar Ambiente
            this.renderEnvironment(ctx, w, h);

            // 3. UI de Menus
            if (this.state === 'MODE_SELECT') { this.renderUI_Mode(ctx, w, h); return; }
            if (this.state === 'LOBBY') { this.renderUI_Lobby(ctx, w, h); return; }
            
            // 4. Calibração Obrigatória
            if (this.state.startsWith('CALIB')) { 
                this.processCalibration(ctx, w, h, pose); 
                return; 
            }

            // 5. Input & IA
            this.processInput(pose, w, h);
            
            if (this.isOnline) this.syncNetwork();
            else this.updateAI();

            // 6. Física (Host)
            if (this.isHost || !this.isOnline) {
                this.updatePhysics();
                this.checkPaddleHit('p1'); // Checa Player
                this.checkPaddleHit('p2'); // Checa IA/Remote
                this.checkRules();
            }

            // 7. Render Game
            this.renderAll(ctx, w, h);

            // Mensagens
            if (this.msg.timer > 0) {
                this.msg.timer--;
                ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(0, h/2 - 50, w, 100);
                ctx.fillStyle = this.msg.color; ctx.textAlign = "center";
                ctx.font = "bold 50px 'Russo One'"; ctx.fillText(this.msg.text, w/2, h/2 + 20);
            }

            return this.scoreP1;
        },

        // -----------------------------------------------------------------
        // SISTEMA DE CALIBRAÇÃO ESPACIAL (BOUNDING BOX)
        // -----------------------------------------------------------------
        processCalibration: function(ctx, w, h, pose) {
            // Overlay Escuro
            ctx.fillStyle = "rgba(0,0,0,0.9)"; ctx.fillRect(0,0,w,h);
            
            if (!pose || !pose.keypoints) {
                ctx.fillStyle = "#e74c3c"; ctx.textAlign = "center"; ctx.font = "20px sans-serif";
                ctx.fillText("📷 CÂMERA NÃO DETECTADA", w/2, h/2);
                return;
            }

            // Pega o pulso (direita ou esquerda, o que tiver melhor score)
            const wrist = pose.keypoints.find(k => (k.name === 'right_wrist' || k.name === 'left_wrist') && k.score > 0.4);

            if (!wrist) {
                ctx.fillStyle = "#f39c12"; ctx.textAlign = "center"; ctx.font = "24px sans-serif";
                ctx.fillText("👋 LEVANTE A MÃO PARA A CÂMERA", w/2, h/2);
                return;
            }

            // Visualização da mão (Espelhada visualmente para UX)
            const visualHandX = w - (wrist.x / 640 * w); 
            const visualHandY = wrist.y / 480 * h;
            
            ctx.beginPath(); ctx.arc(visualHandX, visualHandY, 20, 0, Math.PI*2); 
            ctx.fillStyle = "#0ff"; ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth=3; ctx.stroke();

            ctx.fillStyle = "#fff"; ctx.textAlign = "center";

            // -- ESTADO 1: CENTRO --
            if (this.state === 'CALIB_CENTER') {
                ctx.font = "bold 40px 'Russo One'"; ctx.fillText("PASSO 1: CENTRO", w/2, h*0.3);
                ctx.font = "20px sans-serif"; ctx.fillText("Fique no meio e coloque a mão no círculo", w/2, h*0.4);
                
                // Alvo
                ctx.beginPath(); ctx.arc(w/2, h/2, 50, 0, Math.PI*2);
                ctx.strokeStyle = "#fff"; ctx.stroke();

                const dist = Math.hypot(visualHandX - w/2, visualHandY - h/2);
                if (dist < 50) {
                    this.calib.timer++;
                    ctx.fillStyle = "#2ecc71"; ctx.fill(); // Preenche verde
                    
                    if (this.calib.timer > 40) { // ~0.7 seg
                        this.state = 'CALIB_BOUNDS';
                        this.calib.timer = 0;
                        if(window.Sfx) window.Sfx.play(600, 'sine', 0.2);
                    }
                } else {
                    this.calib.timer = 0;
                }
            }
            // -- ESTADO 2: DEFINIR LIMITES (BOUNDING BOX) --
            else if (this.state === 'CALIB_BOUNDS') {
                ctx.font = "bold 30px 'Russo One'"; ctx.fillText("PASSO 2: ALCANCE", w/2, h*0.15);
                ctx.font = "20px sans-serif"; 
                ctx.fillText("Mova a mão para TODOS os cantos da tela", w/2, h*0.22);
                ctx.fillText("Pinte toda a área da tela", w/2, h*0.27);

                // Captura extremos (RAW coordinates 0-640/480)
                if (wrist.x < this.calib.minX) this.calib.minX = wrist.x;
                if (wrist.x > this.calib.maxX) this.calib.maxX = wrist.x;
                if (wrist.y < this.calib.minY) this.calib.minY = wrist.y;
                if (wrist.y > this.calib.maxY) this.calib.maxY = wrist.y;

                // Desenha a caixa sendo formada (Visual Feedback)
                const boxX = w - (this.calib.maxX / 640 * w);
                const boxW = (this.calib.maxX - this.calib.minX) / 640 * w;
                const boxY = this.calib.minY / 480 * h;
                const boxH = (this.calib.maxY - this.calib.minY) / 480 * h;

                ctx.strokeStyle = "rgba(46, 204, 113, 0.5)"; ctx.lineWidth = 4;
                ctx.strokeRect(boxX, boxY, boxW, boxH);
                ctx.fillStyle = "rgba(46, 204, 113, 0.1)"; ctx.fillRect(boxX, boxY, boxW, boxH);

                this.calib.timer++;
                
                // Barra de progresso da calibração
                const totalTime = 180; // 3 segundos de movimento
                const prog = Math.min(this.calib.timer / totalTime, 1.0);
                
                ctx.fillStyle = "#333"; ctx.fillRect(w/2 - 150, h*0.85, 300, 20);
                ctx.fillStyle = "#2ecc71"; ctx.fillRect(w/2 - 150, h*0.85, 300 * prog, 20);
                ctx.strokeStyle = "#fff"; ctx.strokeRect(w/2 - 150, h*0.85, 300, 20);

                if (this.calib.timer > totalTime) {
                    // Adiciona margem de segurança (Buffer)
                    const bufferX = (this.calib.maxX - this.calib.minX) * 0.1;
                    const bufferY = (this.calib.maxY - this.calib.minY) * 0.1;
                    
                    this.calib.minX += bufferX; this.calib.maxX -= bufferX;
                    this.calib.minY += bufferY; this.calib.maxY -= bufferY;
                    
                    this.calib.ready = true;
                    this.state = 'SERVE';
                    this.resetBall('p1');
                    if(window.Sfx) window.Sfx.play(800, 'square', 0.2);
                }
            }
        },

        // -----------------------------------------------------------------
        // PROCESSAMENTO DE INPUT (MAPA 1:1)
        // -----------------------------------------------------------------
        processInput: function(pose, w, h) {
            // Guarda posição anterior
            this.p1.prevX = this.p1.handX;
            this.p1.prevY = this.p1.handY;

            if (pose && pose.keypoints && this.calib.ready) {
                const wrist = pose.keypoints.find(k => (k.name === 'right_wrist' || k.name === 'left_wrist') && k.score > 0.3);
                
                if (wrist) {
                    // 1. Normalização (Map Raw -> 0..1 usando Calibration Box)
                    // X é invertido para espelhar
                    let normX = Utils3D.map(wrist.x, this.calib.maxX, this.calib.minX, 0, 1); 
                    let normY = Utils3D.map(wrist.y, this.calib.minY, this.calib.maxY, 0, 1);

                    // Clamp
                    normX = Math.max(-0.1, Math.min(1.1, normX));
                    normY = Math.max(-0.1, Math.min(1.1, normY));

                    // 2. Mapear para Coordenadas da Mesa
                    // Mesa Virtual X: -600 a 600
                    const gameRangeX = CONF.TABLE_W * 1.6; 
                    const gameRangeY = 700; 

                    const targetX = (normX - 0.5) * gameRangeX;
                    const targetY = (normY * gameRangeY) - (gameRangeY/2) - 150; 

                    // 3. Suavização
                    this.p1.handX = Utils3D.lerp(this.p1.handX, targetX, 0.5); 
                    this.p1.handY = Utils3D.lerp(this.p1.handY, targetY, 0.5);
                }
            }

            // Calcula vetor de velocidade (Swing)
            // Usa histórico para suavizar "pulos" da câmera
            this.p1.history.unshift({x: this.p1.handX, y: this.p1.handY});
            if(this.p1.history.length > 4) this.p1.history.pop();

            if(this.p1.history.length > 1) {
                const old = this.p1.history[this.p1.history.length-1];
                this.p1.velX = (this.p1.handX - old.x) / this.p1.history.length;
                this.p1.velY = (this.p1.handY - old.y) / this.p1.history.length;
            }

            // Lógica de Saque
            if (this.state === 'SERVE' && this.serverTurn === 'p1') {
                this.ball.x = this.p1.handX;
                this.ball.y = this.p1.handY - 50; 
                this.ball.z = -CONF.TABLE_L/2 - 20; 
                this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;

                // Gesto de Saque: Movimento rápido para cima ou frente
                if (this.p1.velY < -12 || Math.abs(this.p1.velX) > 15) {
                    this.performServe('p1');
                }
            }
        },

        performServe: function(who) {
            this.state = 'RALLY';
            this.ball.active = true;
            this.bounceCount = 0;
            this.lastBounceZ = 0; 

            const dir = who === 'p1' ? 1 : -1;
            
            // Saque: Impulso inicial
            this.ball.vz = (35 + Math.random() * 5) * dir; 
            this.ball.vy = -18; // Arco para cima
            
            if (who === 'p1') {
                // Efeito do movimento da mão
                this.ball.vx = this.p1.velX * 0.6; 
                this.ball.vy -= Math.abs(this.p1.velY) * 0.2;
                if(window.Sfx) window.Sfx.play(400, 'square', 0.1);
            } else {
                this.ball.vx = (Math.random() - 0.5) * 20;
            }
        },

        // -----------------------------------------------------------------
        // IA E FÍSICA
        // -----------------------------------------------------------------
        updateAI: function() {
            if (this.serverTurn === 'p2' && this.state === 'SERVE') {
                if (this.gameTimer % 120 === 0) this.performServe('p2');
                this.p2.handX = 0;
                this.p2.handY = -150;
            } 
            else if (this.state === 'RALLY') {
                // IA Preditiva
                let targetX = this.ball.x;
                targetX += Math.sin(this.gameTimer * 0.15) * 80; // Erro humano

                this.p2.handX = Utils3D.lerp(this.p2.handX, targetX, 0.08);
                this.p2.handY = Utils3D.lerp(this.p2.handY, this.ball.y, 0.1);
                
                // IA Rebate
                if (this.ball.z > CONF.TABLE_L/2 - 100 && this.ball.vz > 0) {
                    if (Utils3D.dist2d({x:this.ball.x, y:this.ball.y}, {x:this.p2.handX, y:this.p2.handY}) < CONF.PADDLE_SIZE) {
                        this.hitBall('p2');
                    }
                }
            }
        },

        updatePhysics: function() {
            if (!this.ball.active) return;

            const b = this.ball;

            // Gravidade e Ar
            b.vy += CONF.GRAVITY;
            b.vx *= CONF.AIR_DRAG;
            b.vz *= CONF.AIR_DRAG;

            b.x += b.vx; b.y += b.vy; b.z += b.vz;

            // COLISÃO COM A MESA
            if (b.y > 0) {
                const halfW = CONF.TABLE_W / 2;
                const halfL = CONF.TABLE_L / 2;

                if (Math.abs(b.x) < halfW && Math.abs(b.z) < halfL) {
                    b.y = 0;
                    b.vy *= -CONF.BOUNCE_LOSS;
                    if(window.Sfx) window.Sfx.play(200, 'sine', 0.1);
                    this.createParticle(b.x, 0, b.z, '#fff');

                    const currentSide = b.z < 0 ? -1 : 1; 
                    if (currentSide === this.lastBounceZ) {
                        this.scorePoint(currentSide === -1 ? 'p2' : 'p1', "DOIS QUIQUES!");
                    } else {
                        this.lastBounceZ = currentSide;
                        this.bounceCount++;
                    }
                } else {
                    if (b.y > CONF.FLOOR_LEVEL) { 
                        const attacker = b.vz > 0 ? 'p1' : 'p2';
                        const targetSide = attacker === 'p1' ? 1 : -1;
                        if (this.lastBounceZ === targetSide) {
                            this.scorePoint(attacker, "PONTO!");
                        } else {
                            this.scorePoint(attacker === 'p1' ? 'p2' : 'p1', "FORA!");
                        }
                    }
                }
            }

            // Colisão REDE
            if (Math.abs(b.z) < 15 && b.y > -CONF.NET_H) {
                b.vz *= -0.4; b.vx *= 0.5;
                if(window.Sfx) window.Sfx.play(150, 'sawtooth', 0.2);
            }
        },

        checkPaddleHit: function(player) {
            if (!this.ball.active) return;

            const isP1 = player === 'p1';
            const pHand = isP1 ? this.p1 : this.p2;
            const paddleZ = isP1 ? (-CONF.TABLE_L/2 - 50) : (CONF.TABLE_L/2 + 50);
            const dir = isP1 ? 1 : -1; 

            const ballComing = isP1 ? (this.ball.vz < 0) : (this.ball.vz > 0);
            
            if (ballComing && Math.abs(this.ball.z - paddleZ) < 200) {
                const dist = Utils3D.dist2d({x:this.ball.x, y:this.ball.y}, {x:pHand.handX, y:pHand.handY});
                
                if (dist < CONF.PADDLE_SIZE) {
                    this.hitBall(player);
                }
            }
        },

        hitBall: function(who) {
            const b = this.ball;
            const isP1 = who === 'p1';
            const dir = isP1 ? 1 : -1;
            
            // Fator SWING
            let swingX = 0, swingY = 0;
            if (isP1) {
                swingX = this.p1.velX;
                swingY = this.p1.velY;
            } else {
                swingX = (Math.random()-0.5)*20;
                swingY = (Math.random()-0.5)*15;
            }

            // Física de Rebate
            let power = 45 + (Math.abs(swingY) * 0.5) + (Math.abs(swingX) * 0.2);
            power = Math.min(power, CONF.MAX_SPEED);

            b.vz = power * dir; 
            
            const offsetHit = (b.x - (isP1 ? this.p1.handX : this.p2.handX)) * 0.25;
            b.vx = offsetHit + (swingX * 0.6); 
            b.vy = -18 - (Math.abs(swingY) * 0.3); 

            this.lastBounceZ = 0; 
            
            if(window.Sfx) window.Sfx.hit();
            this.createParticle(b.x, b.y, b.z, isP1 ? '#0ff' : '#f00', 12);
            
            if (isP1) {
                this.hitStop = 4; // Congela por 4 frames
                if(window.Gfx) window.Gfx.shakeScreen(15);
            }
        },

        checkRules: function() {
            if (Math.abs(this.ball.z) > 3500 || Math.abs(this.ball.x) > 2500) {
                const winner = this.ball.vz > 0 ? 'p1' : 'p2';
                if (this.lastBounceZ !== (winner==='p1'?1:-1)) {
                    this.scorePoint(winner==='p1'?'p2':'p1', "LONGE DEMAIS!");
                }
            }
        },

        scorePoint: function(winner, reason) {
            if (winner === 'p1') {
                this.scoreP1++;
                this.showMsg(reason, "#2ecc71");
            } else {
                this.scoreP2++;
                this.showMsg(reason, "#e74c3c");
            }
            this.ball.active = false;
            this.serverTurn = winner;
            
            if (this.scoreP1 >= 7 || this.scoreP2 >= 7) setTimeout(() => this.state = 'END', 2500);
            else setTimeout(() => this.resetBall(winner), 2000);
        },

        resetBall: function(server) {
            this.state = 'SERVE';
            this.ball = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, active: false };
            this.serverTurn = server;
            this.lastBounceZ = 0;
            this.bounceCount = 0;
            this.showMsg(server === 'p1' ? "SEU SAQUE" : "SAQUE CPU", "#fff");
        },

        syncNetwork: function() {
            if (!this.dbRef) return;
            if (this.gameTimer % CONF.SYNC_RATE === 0) {
                this.dbRef.child(this.isHost ? 'p1' : 'p2').set({
                    handX: this.p1.handX, handY: this.p1.handY
                });
                if (this.isHost) {
                    this.dbRef.child('ball').set(this.ball);
                    this.dbRef.child('score').set({p1: this.scoreP1, p2: this.scoreP2, turn: this.serverTurn});
                }
            }
            const target = this.isHost ? 'p2' : 'p1';
            this.dbRef.child(target).once('value', s => {
                const v = s.val();
                if(v) { this.p2.handX = v.handX; this.p2.handY = v.handY; }
            });
            if (!this.isHost) {
                this.dbRef.child('ball').once('value', s => { if(s.val()) this.ball = s.val(); });
                this.dbRef.child('score').once('value', s => { 
                    const v = s.val();
                    if(v) { this.scoreP1 = v.p1; this.scoreP2 = v.p2; this.serverTurn = v.turn; }
                });
            }
        },

        // -----------------------------------------------------------------
        // RENDERIZAÇÃO
        // -----------------------------------------------------------------
        renderAll: function(ctx, w, h) {
            const grad = ctx.createLinearGradient(0,0,0,h);
            grad.addColorStop(0, "#2c3e50"); grad.addColorStop(1, "#1a252f");
            ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);

            this.renderEnvironment(ctx, w, h);
            this.renderGame(ctx, w, h);
            this.renderHUD(ctx, w, h);
        },

        renderEnvironment: function(ctx, w, h) {
            ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = 1;
            ctx.beginPath();
            for (let i = -3000; i < 3000; i+= 400) {
                let p1 = Utils3D.project(i, 600, -3000, w, h);
                let p2 = Utils3D.project(i, 600, 3000, w, h);
                ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
                let p3 = Utils3D.project(-3000, 600, i, w, h);
                let p4 = Utils3D.project(3000, 600, i, w, h);
                ctx.moveTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y);
            }
            ctx.stroke();
        },

        renderGame: function(ctx, w, h) {
            // Mesa
            const hw = CONF.TABLE_W/2, hl = CONF.TABLE_L/2;
            const c1 = Utils3D.project(-hw, 0, -hl, w, h); 
            const c2 = Utils3D.project(hw, 0, -hl, w, h); 
            const c3 = Utils3D.project(hw, 0, hl, w, h); 
            const c4 = Utils3D.project(-hw, 0, hl, w, h); 

            ctx.fillStyle = "#2980b9";
            ctx.beginPath(); ctx.moveTo(c1.x,c1.y); ctx.lineTo(c2.x,c2.y); ctx.lineTo(c3.x,c3.y); ctx.lineTo(c4.x,c4.y); ctx.fill();
            ctx.strokeStyle = "#fff"; ctx.lineWidth = 4; ctx.stroke();
            
            // Rede
            const n1 = Utils3D.project(-hw-30, 0, 0, w, h);
            const n2 = Utils3D.project(hw+30, 0, 0, w, h);
            const n1t = Utils3D.project(-hw-30, -CONF.NET_H, 0, w, h);
            const n2t = Utils3D.project(hw+30, -CONF.NET_H, 0, w, h);
            ctx.fillStyle = "rgba(220,220,220,0.6)";
            ctx.beginPath(); ctx.moveTo(n1.x,n1.y); ctx.lineTo(n2.x,n2.y); ctx.lineTo(n2t.x,n2t.y); ctx.lineTo(n1t.x,n1t.y); ctx.fill();
            ctx.strokeStyle = "#eee"; ctx.lineWidth = 2; ctx.stroke();

            // P2 Paddle (Longe)
            const p2Pos = Utils3D.project(-this.p2.handX, this.p2.handY, CONF.TABLE_L/2 + 50, w, h);
            this.drawPaddle(ctx, p2Pos, "#e74c3c", false);

            // Bola
            this.drawBall(ctx, w, h);

            // P1 Paddle (Perto)
            const p1Pos = Utils3D.project(this.p1.handX, this.p1.handY, -CONF.TABLE_L/2 - 50, w, h);
            this.drawPaddle(ctx, p1Pos, "#3498db", true);

            // Partículas
            this.particles.forEach((p, i) => {
                p.x += p.vx; p.y += p.vy; p.life -= 0.05;
                if(p.life <= 0) this.particles.splice(i, 1);
                else {
                    const pos = Utils3D.project(p.x, p.y, p.z, w, h);
                    ctx.fillStyle = p.c; ctx.globalAlpha = p.life;
                    ctx.beginPath(); ctx.arc(pos.x, pos.y, 4 * pos.s, 0, Math.PI*2); ctx.fill();
                }
            });
            ctx.globalAlpha = 1.0;
        },

        drawBall: function(ctx, w, h) {
            const b = this.ball;
            const pos = Utils3D.project(b.x, b.y, b.z, w, h);
            
            if (b.y < 0) { // Sombra
                const shadow = Utils3D.project(b.x, 0, b.z, w, h);
                ctx.fillStyle = "rgba(0,0,0,0.4)";
                ctx.beginPath(); 
                ctx.ellipse(shadow.x, shadow.y, 14 * shadow.s, 6 * shadow.s, 0, 0, Math.PI*2); 
                ctx.fill();
            }

            const rad = CONF.BALL_R * pos.s;
            const grad = ctx.createRadialGradient(pos.x - rad*0.3, pos.y - rad*0.3, rad*0.1, pos.x, pos.y, rad);
            grad.addColorStop(0, "#fff"); grad.addColorStop(1, "#f39c12");
            ctx.fillStyle = grad;
            ctx.beginPath(); ctx.arc(pos.x, pos.y, rad, 0, Math.PI*2); ctx.fill();
        },

        drawPaddle: function(ctx, pos, color, isP1) {
            const s = pos.s * (CONF.PADDLE_SIZE / 100);
            const size = 65 * s;

            ctx.fillStyle = "#8e44ad"; 
            ctx.fillRect(pos.x - 10*s, pos.y + size*0.8, 20*s, 60*s);

            ctx.fillStyle = "#222"; 
            ctx.beginPath(); ctx.arc(pos.x, pos.y, size, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = color; 
            ctx.beginPath(); ctx.arc(pos.x, pos.y, size-5, 0, Math.PI*2); ctx.fill();
            
            if (isP1 && Math.hypot(this.p1.velX, this.p1.velY) > 8) {
                ctx.strokeStyle = "rgba(255,255,255,0.4)";
                ctx.lineWidth = 8;
                ctx.beginPath();
                ctx.moveTo(pos.x, pos.y);
                ctx.lineTo(pos.x - this.p1.velX * s * 1.5, pos.y - this.p1.velY * s * 1.5);
                ctx.stroke();
            }
        },

        renderHUD: function(ctx, w, h) {
            ctx.fillStyle = "#000"; ctx.fillRect(w/2 - 120, 20, 240, 60);
            ctx.strokeStyle = "#fff"; ctx.lineWidth=3; ctx.strokeRect(w/2 - 120, 20, 240, 60);
            ctx.font = "bold 40px 'Russo One'"; ctx.textAlign = "center";
            ctx.fillStyle = "#3498db"; ctx.fillText(this.scoreP1, w/2 - 60, 65);
            ctx.fillStyle = "#fff"; ctx.fillText("-", w/2, 65);
            ctx.fillStyle = "#e74c3c"; ctx.fillText(this.scoreP2, w/2 + 60, 65);
        },

        renderUI_Mode: function(ctx, w, h) {
            ctx.fillStyle = "rgba(0,0,0,0.9)"; ctx.fillRect(0,0,w,h);
            ctx.fillStyle = "#fff"; ctx.textAlign = "center";
            ctx.font = "bold 60px 'Russo One'"; ctx.fillText("PING PONG", w/2, 120);
            ctx.font = "bold 30px 'Russo One'"; ctx.fillText("TITANIUM EDITION", w/2, 170);

            const btnH = 90;
            ctx.fillStyle = "#3498db"; ctx.fillRect(w/2 - 180, h/2 - 120, 360, btnH);
            ctx.fillStyle = "#fff"; ctx.fillText("OFFLINE (VS CPU)", w/2, h/2 - 65);

            ctx.fillStyle = "#e67e22"; ctx.fillRect(w/2 - 180, h/2 + 20, 360, btnH);
            ctx.fillStyle = "#fff"; ctx.fillText("ONLINE (2P)", w/2, h/2 + 75);
        },

        renderUI_Lobby: function(ctx, w, h) {
            ctx.fillStyle = "#2c3e50"; ctx.fillRect(0,0,w,h);
            ctx.fillStyle = "#fff"; ctx.textAlign = "center";
            ctx.font = "30px sans-serif"; 
            ctx.fillText("LOBBY: " + this.roomId, w/2, h/2 - 50);
            ctx.fillText(this.isHost ? "AGUARDANDO OPOSTO..." : "CONECTANDO...", w/2, h/2 + 50);
        },

        createParticle: function(x, y, z, color) {
            for(let i=0; i<15; i++) {
                this.particles.push({
                    x, y, z, c: color, life: 1.0,
                    vx: (Math.random()-0.5)*25, vy: (Math.random()-0.5)*25
                });
            }
        },

        showMsg: function(text, color) {
            this.msg.text = text;
            this.msg.color = color;
            this.msg.timer = 90;
        }
    };

    if (window.System && window.System.registerGame) {
        window.System.registerGame('tennis', 'Ping Pong Titanium', '🏓', Game, { camOpacity: 0.1 });
    }

})();