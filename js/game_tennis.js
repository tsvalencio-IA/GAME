// =============================================================================
// TABLE TENNIS LEGENDS: TITANIUM EDITION (V5 - FULL SIMULATION)
// ARQUITETO: SENIOR GAME ENGINE ARCHITECT
// STATUS: 3D PHYSICS, MULTIPLAYER SYNC, SWING DETECTION
// =============================================================================

(function() {
    "use strict";

    // -----------------------------------------------------------------
    // 1. CONFIGURAÇÃO E FÍSICA
    // -----------------------------------------------------------------
    const CONF = {
        // Dimensões Virtuais (mm convertidos para unidades de jogo)
        TABLE_W: 1000,
        TABLE_L: 1800,
        NET_H: 100,
        BALL_R: 25,
        
        // Física
        GRAVITY: 0.55,
        AIR_DRAG: 0.99,
        BOUNCE_LOSS: 0.85,  // Energia perdida ao quicar
        NET_BOUNCE: 0.5,
        
        // Gameplay
        PADDLE_SIZE: 100,
        SWING_FORCE: 1.8,   // Multiplicador de força do jogador
        MAX_SPEED: 60,
        
        // Multiplayer
        SYNC_RATE: 3        // Enviar dados a cada X frames
    };

    // -----------------------------------------------------------------
    // 2. ENGINE 3D & UTILITÁRIOS
    // -----------------------------------------------------------------
    const Utils3D = {
        // Projeta coordenadas 3D (x,y,z) para 2D (x,y,scale) na tela
        project: (x, y, z, w, h) => {
            const fov = 900;
            const camHeight = -500; // Câmera acima da mesa
            const camZ = -800;      // Câmera recuada
            
            const scale = fov / (fov + (z - camZ));
            const x2d = (x * scale) + w/2;
            const y2d = ((y - camHeight) * scale) + h/2;
            
            return { x: x2d, y: y2d, s: scale };
        },

        lerp: (start, end, amt) => (1 - amt) * start + amt * end,
        
        dist2d: (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y)
    };

    // -----------------------------------------------------------------
    // 3. LÓGICA DO JOGO
    // -----------------------------------------------------------------
    const Game = {
        state: 'INIT',      // MODE_SELECT, LOBBY, CALIBRATION, SERVE, RALLY, END
        roomId: 'ping_v1',
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
        p1: { x: 0, y: 0, handX: 0, handY: 0, prevX: 0, prevY: 0, velX: 0, velY: 0 },
        p2: { x: 0, y: 0, handX: 0, handY: 0, targetX: 0 }, // P2 pode ser IA ou Remote

        // Controle de Estado
        lastBounceZ: 0,     // Onde a bola quicou por último (lado < 0 ou lado > 0)
        bounceCount: 0,     // Quantos quiques no lado atual
        gameTimer: 0,
        particles: [],
        
        // Calibração
        calib: { cx: 0, cy: 0, scale: 3.5, timer: 0 },

        // Mensagens
        msg: { text: "", timer: 0, color: "#fff" },

        init: function() {
            this.state = 'MODE_SELECT';
            this.scoreP1 = 0;
            this.scoreP2 = 0;
            this.serverTurn = 'p1';
            this.setupInput();
            window.System.msg("TABLE TENNIS LEGENDS");
        },

        setupInput: function() {
            window.System.canvas.onclick = (e) => {
                const r = window.System.canvas.getBoundingClientRect();
                const my = e.clientY - r.top;
                const h = r.height;

                if (this.state === 'MODE_SELECT') {
                    if (my < h/2) this.setMode('OFFLINE');
                    else this.setMode('ONLINE');
                    window.Sfx.click();
                }
                else if (this.state === 'END') {
                    this.init();
                }
            };
        },

        setMode: function(mode) {
            if (mode === 'ONLINE') {
                if (typeof window.DB === 'undefined') {
                    this.showMsg("ERRO: FIREBASE NÃO CARREGADO", "#f00");
                    return;
                }
                this.isOnline = true;
                this.connectLobby();
            } else {
                this.isOnline = false;
                this.isHost = true; // Offline eu sou o host da física
                this.state = 'CALIBRATION';
            }
        },

        connectLobby: function() {
            this.state = 'LOBBY';
            const myId = window.System.playerId || 'p_' + Math.floor(Math.random()*9999);
            this.dbRef = window.DB.ref('rooms/' + this.roomId);
            
            // Entrar na sala
            this.dbRef.child('players').once('value', snap => {
                const players = snap.val() || {};
                const pIds = Object.keys(players);
                
                if (pIds.length === 0) {
                    this.isHost = true;
                    this.dbRef.child('players/' + myId).set({ x: 0, y: 0, score: 0 });
                    this.waitOpponent(myId);
                } else if (pIds.length === 1) {
                    this.isHost = false;
                    this.dbRef.child('players/' + myId).set({ x: 0, y: 0, score: 0 });
                    this.startGameOnline(myId, pIds[0]);
                } else {
                    this.showMsg("SALA CHEIA", "#f00");
                    setTimeout(() => this.init(), 2000);
                }
            });
        },

        waitOpponent: function(myId) {
            this.showMsg("AGUARDANDO OPONENTE...", "#fff");
            this.dbRef.child('players').on('value', snap => {
                if (Object.keys(snap.val() || {}).length === 2) {
                    this.state = 'CALIBRATION';
                    this.dbRef.child('ball').set(this.ball); // Host inicializa bola
                }
            });
            // Cleanup on disconnect
            this.dbRef.child('players/' + myId).onDisconnect().remove();
        },

        startGameOnline: function(myId, hostId) {
            this.state = 'CALIBRATION';
            this.dbRef.child('players/' + myId).onDisconnect().remove();
        },

        // -----------------------------------------------------------------
        // LOOP PRINCIPAL
        // -----------------------------------------------------------------
        update: function(ctx, w, h, pose) {
            this.gameTimer++;

            // Fundo e Mesa (Render)
            this.renderEnvironment(ctx, w, h);

            if (this.state === 'MODE_SELECT') { this.renderUI_Mode(ctx, w, h); return; }
            if (this.state === 'LOBBY') { this.renderUI_Lobby(ctx, w, h); return; }
            if (this.state === 'CALIBRATION') { this.processCalibration(ctx, w, h, pose); return; }

            // Processar Input (Local)
            this.processInput(pose, w, h);

            // Sincronização Multiplayer
            if (this.isOnline) {
                this.syncNetwork();
            } else {
                this.updateAI(); // Offline: P2 é IA
            }

            // Física e Regras (Apenas Host calcula)
            if (this.isHost || !this.isOnline) {
                this.updatePhysics();
                this.checkCollisions();
                this.checkRules();
            }

            // Renderizar Objetos
            this.renderGame(ctx, w, h);
            this.renderHUD(ctx, w, h);
            
            // Mensagens Temporárias
            if (this.msg.timer > 0) {
                this.msg.timer--;
                ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(0, h/2 - 40, w, 80);
                ctx.fillStyle = this.msg.color; ctx.textAlign = "center";
                ctx.font = "bold 40px 'Russo One'";
                ctx.fillText(this.msg.text, w/2, h/2 + 15);
            }

            return this.scoreP1; // Retorna score para o Core
        },

        // -----------------------------------------------------------------
        // INPUT E CALIBRAÇÃO
        // -----------------------------------------------------------------
        processCalibration: function(ctx, w, h, pose) {
            ctx.fillStyle = "rgba(0,0,0,0.8)"; ctx.fillRect(0,0,w,h);
            ctx.fillStyle = "#fff"; ctx.textAlign = "center";
            ctx.font = "bold 30px 'Russo One'"; ctx.fillText("CALIBRAÇÃO", w/2, h/2 - 50);
            ctx.font = "20px sans-serif"; ctx.fillText("FIQUE NO CENTRO E LEVANTE A MÃO", w/2, h/2);

            if (pose && pose.keypoints) {
                const wrist = pose.keypoints.find(k => (k.name === 'right_wrist' || k.name === 'left_wrist') && k.score > 0.4);
                if (wrist) {
                    this.calib.timer++;
                    
                    // Barra de progresso
                    const prog = Math.min(this.calib.timer / 60, 1.0);
                    ctx.fillStyle = "#2ecc71"; ctx.fillRect(w/2 - 100, h/2 + 40, 200 * prog, 10);
                    ctx.strokeStyle = "#fff"; ctx.strokeRect(w/2 - 100, h/2 + 40, 200, 10);

                    if (this.calib.timer > 60) {
                        this.calib.cx = wrist.x;
                        this.calib.cy = wrist.y;
                        this.state = 'SERVE';
                        this.resetBall('p1');
                        window.Sfx.play(600, 'sine', 0.2);
                    }
                } else {
                    this.calib.timer = 0;
                }
            }
        },

        processInput: function(pose, w, h) {
            // Suavização do movimento da raquete
            this.p1.prevX = this.p1.handX;
            this.p1.prevY = this.p1.handY;

            if (pose && pose.keypoints) {
                const wrist = pose.keypoints.find(k => (k.name === 'right_wrist' || k.name === 'left_wrist') && k.score > 0.3);
                
                if (wrist) {
                    // Mapeia input da câmera para coordenadas da mesa
                    // Câmera: 0..640. Mesa Virtual: -500..500
                    const rawX = (1 - (wrist.x / 640)) * w; // Espelhado
                    const rawY = (wrist.y / 480) * h;

                    // Aplica calibração e sensibilidade
                    const sensitivity = 3.5;
                    const targetX = (rawX - (w/2)) * sensitivity; 
                    const targetY = (rawY - (h/2)) * sensitivity;

                    // Lerp para suavizar tremoc da webcam
                    this.p1.handX = Utils3D.lerp(this.p1.handX, targetX, 0.3);
                    this.p1.handY = Utils3D.lerp(this.p1.handY, targetY, 0.3);
                }
            }

            // Calcula velocidade do "Swing" (Movimento)
            this.p1.velX = this.p1.handX - this.p1.prevX;
            this.p1.velY = this.p1.handY - this.p1.prevY;

            // Se for saque, bola segue a mão
            if (this.state === 'SERVE' && this.serverTurn === 'p1') {
                this.ball.x = this.p1.handX;
                this.ball.y = -200; // Altura fixa
                this.ball.z = -CONF.TABLE_L/2 - 50; // Perto do jogador
                this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;

                // Detectar gesto de saque (movimento rápido pra frente/cima)
                if (this.p1.velY < -15 || Math.abs(this.p1.velX) > 15) {
                    this.performServe('p1');
                }
            }
        },

        performServe: function(who) {
            this.state = 'RALLY';
            this.ball.active = true;
            this.bounceCount = 0;
            this.lastBounceZ = 0; // Reset

            const dir = who === 'p1' ? 1 : -1;
            
            // Física inicial do saque
            this.ball.vz = (25 + Math.random() * 5) * dir; // Vai pra frente
            this.ball.vy = -12; // Arco pra cima
            
            if (who === 'p1') {
                this.ball.vx = this.p1.velX * 0.5; // Efeito lateral
                window.Sfx.play(400, 'square', 0.1);
            } else {
                this.ball.vx = (Math.random() - 0.5) * 10;
            }
        },

        updateAI: function() {
            if (this.serverTurn === 'p2' && this.state === 'SERVE') {
                // IA Saca depois de um tempo
                if (this.gameTimer % 100 === 0) this.performServe('p2');
                // Posiciona IA para saque
                this.p2.handX = 0;
                this.p2.handY = -100;
            } 
            else if (this.state === 'RALLY') {
                // IA tenta seguir a bola
                let targetX = this.ball.x;
                
                // Erro humano da IA
                targetX += Math.sin(this.gameTimer * 0.1) * 50;

                this.p2.handX = Utils3D.lerp(this.p2.handX, targetX, 0.08); // Velocidade de reação
                
                // IA bate na bola quando chega perto (no eixo Z)
                if (this.ball.z > CONF.TABLE_L/2 - 100 && this.ball.vz > 0) {
                    // Distancia da raquete
                    if (Math.abs(this.ball.x - this.p2.handX) < CONF.PADDLE_SIZE) {
                        this.hitBall('p2');
                    }
                }
            }
        },

        // -----------------------------------------------------------------
        // FÍSICA E COLISÃO (AUTHORITATIVE)
        // -----------------------------------------------------------------
        updatePhysics: function() {
            if (!this.ball.active) return;

            const b = this.ball;

            // Gravidade
            b.vy += CONF.GRAVITY;
            
            // Resistência do Ar
            b.vx *= CONF.AIR_DRAG;
            b.vz *= CONF.AIR_DRAG;

            // Movimento
            b.x += b.vx;
            b.y += b.vy;
            b.z += b.vz;

            // Colisão com a MESA (Y = 0 é o nível da mesa)
            if (b.y > 0) {
                const halfW = CONF.TABLE_W / 2;
                const halfL = CONF.TABLE_L / 2;

                // Verifica se caiu dentro dos limites da mesa
                if (Math.abs(b.x) < halfW && Math.abs(b.z) < halfL) {
                    // QUIQUE VÁLIDO
                    b.y = 0;
                    b.vy *= -CONF.BOUNCE_LOSS; // Perde energia
                    window.Sfx.play(200, 'sine', 0.1);
                    this.createParticle(b.x, 0, b.z, '#fff');

                    // Lógica de Regras de Ping Pong
                    // Determinar em qual lado quicou
                    const currentSide = b.z < 0 ? -1 : 1; // -1 = P1, 1 = P2

                    if (currentSide === this.lastBounceZ) {
                        // Quicou duas vezes no mesmo lado = Ponto pro outro
                        this.scorePoint(currentSide === -1 ? 'p2' : 'p1', "DOIS QUIQUES!");
                    } else {
                        this.lastBounceZ = currentSide;
                        this.bounceCount++;
                    }

                } else {
                    // CAIU FORA (CHÃO)
                    if (b.y > 500) { // Chão visual
                        // Quem bateu por último?
                        // Se a bola veio do P1 (vz > 0) e caiu fora -> Ponto P2
                        // Se a bola veio do P2 (vz < 0) e caiu fora -> Ponto P1
                        // MAS, tem que ver se quicou na mesa antes.
                        
                        // Simplificação: Se quicou no lado do oponente antes de cair fora, ponto do batedor.
                        // Se não quicou, ponto do oponente.
                        
                        const attacker = b.vz > 0 ? 'p1' : 'p2';
                        // Se o ultimo quique foi no lado do oponente (1 se attacker p1, -1 se attacker p2)
                        const targetSide = attacker === 'p1' ? 1 : -1;
                        
                        if (this.lastBounceZ === targetSide) {
                            this.scorePoint(attacker, "PONTO!");
                        } else {
                            this.scorePoint(attacker === 'p1' ? 'p2' : 'p1', "FORA!");
                        }
                    }
                }
            }

            // Colisão com a REDE
            if (Math.abs(b.z) < 10 && b.y > -CONF.NET_H) {
                b.vz *= -0.5; // Bate e volta/cai
                b.vx *= 0.5;
                window.Sfx.play(150, 'sawtooth', 0.2);
            }
        },

        checkCollisions: function() {
            if (!this.ball.active) return;

            // Raquete P1 (Visualmente em Z = -TABLE_L/2 - 50)
            const p1Z = -CONF.TABLE_L/2 - 50;
            
            // Se bola está chegando no P1
            if (this.ball.vz < 0 && this.ball.z < p1Z + 100 && this.ball.z > p1Z - 100) {
                const dist = Utils3D.dist2d({x: this.ball.x, y: this.ball.y}, {x: this.p1.handX, y: this.p1.handY});
                
                if (dist < CONF.PADDLE_SIZE) {
                    this.hitBall('p1');
                }
            }
        },

        hitBall: function(who) {
            // Validar se pode bater (bola tem que ter quicado no seu lado ou ser voleio longe da mesa)
            // Simplificação Arcade: Pode bater sempre que a bola vem
            
            const b = this.ball;
            const dir = who === 'p1' ? 1 : -1;
            
            // Fator SWING: Velocidade da mão afeta a bola
            const swingX = who === 'p1' ? this.p1.velX : (Math.random()-0.5)*20;
            const swingY = who === 'p1' ? this.p1.velY : (Math.random()-0.5)*10;

            // Velocidade base + Swing
            b.vz = (35 + Math.abs(swingY)) * dir; // Rebate forte
            b.vx = (b.x - (who==='p1'?this.p1.handX : this.p2.handX)) * 0.2 + (swingX * 0.5); // Efeito lateral
            b.vy = -15 - (Math.abs(swingY) * 0.2); // Arco pra cima (lift)

            // Limites
            if (Math.abs(b.vz) > CONF.MAX_SPEED) b.vz = CONF.MAX_SPEED * dir;

            this.lastBounceZ = 0; // Reset quiques validos
            
            window.Sfx.hit();
            if(who === 'p1' && window.Gfx) window.Gfx.shakeScreen(5);
            this.createParticle(b.x, b.y, b.z, '#ffff00', 10);
        },

        checkRules: function() {
            // Resetar bola se for longe demais
            if (Math.abs(this.ball.z) > 3000 || Math.abs(this.ball.x) > 2000) {
                // Bola perdida
                const winner = this.ball.vz > 0 ? 'p1' : 'p2';
                // Se saiu sem quicar na mesa adversária
                if (this.lastBounceZ !== (winner==='p1'?1:-1)) {
                    this.scorePoint(winner==='p1'?'p2':'p1', "LONGE DEMAIS!");
                }
            }
        },

        scorePoint: function(winner, reason) {
            if (winner === 'p1') {
                this.scoreP1++;
                this.showMsg(reason || "PONTO P1", "#2ecc71");
            } else {
                this.scoreP2++;
                this.showMsg(reason || "PONTO CPU", "#e74c3c");
            }

            this.ball.active = false;
            this.serverTurn = winner; // Quem marca saca (regra de rua)
            
            if (this.scoreP1 >= 5 || this.scoreP2 >= 5) {
                setTimeout(() => this.state = 'END', 2000);
            } else {
                setTimeout(() => this.resetBall(winner), 2000);
            }
        },

        resetBall: function(server) {
            this.state = 'SERVE';
            this.ball = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, active: false };
            this.serverTurn = server;
            this.lastBounceZ = 0;
            this.bounceCount = 0;
            
            if (server === 'p1') this.showMsg("SEU SAQUE", "#fff");
            else this.showMsg("SAQUE ADVERSÁRIO", "#aaa");
        },

        // -----------------------------------------------------------------
        // NETWORK
        // -----------------------------------------------------------------
        syncNetwork: function() {
            if (!this.dbRef) return;

            // Enviar meus dados
            if (this.gameTimer % CONF.SYNC_RATE === 0) {
                this.dbRef.child(this.isHost ? 'p1' : 'p2').set({
                    handX: this.p1.handX,
                    handY: this.p1.handY
                });
                
                // Se for Host, envia a bola e placar
                if (this.isHost) {
                    this.dbRef.child('ball').set(this.ball);
                    this.dbRef.child('score').set({p1: this.scoreP1, p2: this.scoreP2, turn: this.serverTurn, state: this.state});
                }
            }

            // Receber dados
            // Se sou Host, leio P2. Se sou Client, leio P1 e Bola.
            const target = this.isHost ? 'p2' : 'p1';
            this.dbRef.child(target).once('value', snap => {
                const val = snap.val();
                if (val) {
                    this.p2.handX = val.handX; // P2 visual é sempre o "outro"
                    this.p2.handY = val.handY;
                }
            });

            if (!this.isHost) {
                this.dbRef.child('ball').once('value', snap => {
                    const b = snap.val();
                    if (b) this.ball = b;
                });
                this.dbRef.child('score').once('value', snap => {
                    const s = snap.val();
                    if (s) {
                        this.scoreP1 = s.p1;
                        this.scoreP2 = s.p2;
                        this.serverTurn = s.turn;
                        if (this.state !== s.state) this.state = s.state;
                    }
                });
            }
        },

        // -----------------------------------------------------------------
        // RENDERIZAÇÃO
        // -----------------------------------------------------------------
        renderEnvironment: function(ctx, w, h) {
            // Fundo Gradiente
            const grad = ctx.createLinearGradient(0, 0, 0, h);
            grad.addColorStop(0, "#2c3e50");
            grad.addColorStop(1, "#000");
            ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);

            // Chão (Grid 3D)
            ctx.strokeStyle = "rgba(255,255,255,0.1)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let i = -2000; i < 2000; i+= 200) {
                const p1 = Utils3D.project(i, 500, -2000, w, h);
                const p2 = Utils3D.project(i, 500, 2000, w, h);
                ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
                
                const p3 = Utils3D.project(-2000, 500, i, w, h);
                const p4 = Utils3D.project(2000, 500, i, w, h);
                ctx.moveTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y);
            }
            ctx.stroke();
        },

        renderGame: function(ctx, w, h) {
            // 1. MESA (Trapezio 3D)
            const hw = CONF.TABLE_W/2;
            const hl = CONF.TABLE_L/2;
            
            // Cantos da mesa
            const c1 = Utils3D.project(-hw, 0, -hl, w, h); // Near Left
            const c2 = Utils3D.project(hw, 0, -hl, w, h);  // Near Right
            const c3 = Utils3D.project(hw, 0, hl, w, h);   // Far Right
            const c4 = Utils3D.project(-hw, 0, hl, w, h);  // Far Left

            // Tampo Azul Profundo
            ctx.fillStyle = "#2980b9";
            ctx.beginPath();
            ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.lineTo(c3.x, c3.y); ctx.lineTo(c4.x, c4.y);
            ctx.fill();
            
            // Bordas Brancas
            ctx.strokeStyle = "#fff"; ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.lineTo(c3.x, c3.y); ctx.lineTo(c4.x, c4.y); ctx.closePath();
            ctx.stroke();
            
            // Linha Central
            const m1 = Utils3D.project(0, 0, -hl, w, h);
            const m2 = Utils3D.project(0, 0, hl, w, h);
            ctx.globalAlpha = 0.5;
            ctx.beginPath(); ctx.moveTo(m1.x, m1.y); ctx.lineTo(m2.x, m2.y); ctx.stroke();
            ctx.globalAlpha = 1.0;

            // Rede
            const n1 = Utils3D.project(-hw - 20, 0, 0, w, h);
            const n2 = Utils3D.project(hw + 20, 0, 0, w, h);
            const n1t = Utils3D.project(-hw - 20, -CONF.NET_H, 0, w, h);
            const n2t = Utils3D.project(hw + 20, -CONF.NET_H, 0, w, h);
            
            ctx.fillStyle = "rgba(200,200,200,0.5)";
            ctx.beginPath(); ctx.moveTo(n1.x, n1.y); ctx.lineTo(n2.x, n2.y); ctx.lineTo(n2t.x, n2t.y); ctx.lineTo(n1t.x, n1t.y); ctx.fill();
            ctx.strokeStyle = "#ddd"; ctx.lineWidth = 1; ctx.stroke();

            // 2. OBJETOS DINÂMICOS (Ordernar por Z para render correto)
            // Raquete P2 (Longe) -> Bola -> Raquete P1 (Perto)
            
            // Raquete P2 (Vermelha) - Invertida visualmente pois está do outro lado
            // Precisamos espelhar a posição X/Y para parecer que está lá
            const p2Pos = Utils3D.project(-this.p2.handX, this.p2.handY, CONF.TABLE_L/2 + 50, w, h);
            this.drawPaddle(ctx, p2Pos, "#e74c3c", false);

            // Bola
            this.drawBall(ctx, w, h);

            // Raquete P1 (Azul) - Segue o mouse/mão
            // Fixamos o Z visual da raquete perto da tela
            const p1Pos = Utils3D.project(this.p1.handX, this.p1.handY, -CONF.TABLE_L/2 - 50, w, h);
            this.drawPaddle(ctx, p1Pos, "#3498db", true);

            // Partículas
            this.particles.forEach((p, i) => {
                p.x += p.vx; p.y += p.vy; p.life -= 0.05;
                if (p.life <= 0) this.particles.splice(i, 1);
                else {
                    const pos = Utils3D.project(p.x, p.y, p.z, w, h);
                    ctx.fillStyle = p.c; ctx.globalAlpha = p.life;
                    ctx.beginPath(); ctx.arc(pos.x, pos.y, 3 * pos.s, 0, Math.PI*2); ctx.fill();
                }
            });
            ctx.globalAlpha = 1.0;
        },

        drawBall: function(ctx, w, h) {
            const b = this.ball;
            const pos = Utils3D.project(b.x, b.y, b.z, w, h);
            
            // Sombra (Projetada no chão Y=0)
            if (b.y < 0) {
                const shadow = Utils3D.project(b.x, 0, b.z, w, h);
                ctx.fillStyle = "rgba(0,0,0,0.3)";
                ctx.beginPath(); 
                ctx.ellipse(shadow.x, shadow.y, 10 * shadow.s, 4 * shadow.s, 0, 0, Math.PI*2); 
                ctx.fill();
            }

            // Bola
            const rad = CONF.BALL_R * pos.s;
            const grad = ctx.createRadialGradient(pos.x - rad*0.3, pos.y - rad*0.3, rad*0.1, pos.x, pos.y, rad);
            grad.addColorStop(0, "#fff");
            grad.addColorStop(1, "#f39c12"); // Bola laranja clássica
            
            ctx.fillStyle = grad;
            ctx.beginPath(); ctx.arc(pos.x, pos.y, rad, 0, Math.PI*2); ctx.fill();
            ctx.strokeStyle = "rgba(0,0,0,0.2)"; ctx.lineWidth = 1; ctx.stroke();
        },

        drawPaddle: function(ctx, pos, color, isPlayer) {
            const s = pos.s * (CONF.PADDLE_SIZE / 100);
            const size = 60 * s;

            // Cabo
            ctx.fillStyle = "#8e44ad"; // Madeira roxa
            ctx.fillRect(pos.x - 5*s, pos.y + size, 10*s, 40*s);

            // Raquete
            ctx.fillStyle = color;
            ctx.beginPath(); ctx.arc(pos.x, pos.y, size, 0, Math.PI*2); ctx.fill();
            
            // Borda
            ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();

            // Rastro de Swing (se estiver movendo rápido)
            if (isPlayer) {
                const speed = Math.hypot(this.p1.velX, this.p1.velY);
                if (speed > 5) {
                    ctx.strokeStyle = "rgba(255,255,255,0.5)";
                    ctx.lineWidth = 4;
                    ctx.beginPath();
                    ctx.moveTo(pos.x, pos.y);
                    ctx.lineTo(pos.x - this.p1.velX * s, pos.y - this.p1.velY * s);
                    ctx.stroke();
                }
            }
        },

        renderHUD: function(ctx, w, h) {
            // Placar estilo TV
            ctx.fillStyle = "#000";
            ctx.fillRect(w/2 - 80, 20, 160, 50);
            ctx.strokeStyle = "#fff"; ctx.strokeRect(w/2 - 80, 20, 160, 50);
            
            ctx.font = "bold 30px 'Russo One'"; ctx.textAlign = "center";
            ctx.fillStyle = "#3498db"; ctx.fillText(this.scoreP1, w/2 - 40, 55);
            ctx.fillStyle = "#fff"; ctx.fillText("-", w/2, 55);
            ctx.fillStyle = "#e74c3c"; ctx.fillText(this.scoreP2, w/2 + 40, 55);
        },

        renderUI_Mode: function(ctx, w, h) {
            ctx.fillStyle = "rgba(0,0,0,0.9)"; ctx.fillRect(0,0,w,h);
            ctx.fillStyle = "#fff"; ctx.textAlign = "center";
            ctx.font = "bold 50px 'Russo One'"; ctx.fillText("TABLE TENNIS", w/2, 100);
            ctx.font = "bold 30px 'Russo One'"; ctx.fillText("LEGENDS", w/2, 140);

            // Botões Simulados
            const btnH = 80;
            ctx.fillStyle = "#3498db"; ctx.fillRect(w/2 - 150, h/2 - 100, 300, btnH);
            ctx.fillStyle = "#fff"; ctx.fillText("OFFLINE (VS CPU)", w/2, h/2 - 50);

            ctx.fillStyle = "#e67e22"; ctx.fillRect(w/2 - 150, h/2 + 20, 300, btnH);
            ctx.fillStyle = "#fff"; ctx.fillText("ONLINE (2P)", w/2, h/2 + 70);
        },

        renderUI_Lobby: function(ctx, w, h) {
            ctx.fillStyle = "#2c3e50"; ctx.fillRect(0,0,w,h);
            ctx.fillStyle = "#fff"; ctx.textAlign = "center";
            ctx.font = "30px sans-serif"; 
            ctx.fillText("LOBBY: " + this.roomId, w/2, h/2 - 50);
            ctx.fillText(this.isHost ? "AGUARDANDO PLAYER 2..." : "CONECTANDO...", w/2, h/2 + 50);
        },

        // -----------------------------------------------------------------
        // AUXILIARES
        // -----------------------------------------------------------------
        createParticle: function(x, y, z, color) {
            for(let i=0; i<8; i++) {
                this.particles.push({
                    x, y, z, c: color, life: 1.0,
                    vx: (Math.random()-0.5)*15, vy: (Math.random()-0.5)*15
                });
            }
        },

        showMsg: function(text, color) {
            this.msg.text = text;
            this.msg.color = color;
            this.msg.timer = 90; // 1.5 seg
        }
    };

    // Registrar no Core
    if (window.System && window.System.registerGame) {
        window.System.registerGame('tennis', 'Tennis Legends', '🏓', Game, { camOpacity: 0.2 });
    }

})();