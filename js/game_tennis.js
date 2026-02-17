// =============================================================================
// TABLE TENNIS LEGENDS: TITANIUM EDITION (V5 - SPATIAL MAPPING)
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
        NET_H: 100,
        BALL_R: 20,
        
        // Física
        GRAVITY: 0.5,
        AIR_DRAG: 0.99,
        BOUNCE_LOSS: 0.85,  // Energia perdida ao quicar
        NET_BOUNCE: 0.5,
        
        // Gameplay
        PADDLE_SIZE: 110,
        SWING_FORCE: 2.2,   // Multiplicador de força do jogador
        MAX_SPEED: 70,
        
        // Multiplayer
        SYNC_RATE: 3        // Enviar dados a cada X frames
    };

    // -----------------------------------------------------------------
    // 2. ENGINE 3D & UTILITÁRIOS
    // -----------------------------------------------------------------
    const Utils3D = {
        // Projeta coordenadas 3D (x,y,z) para 2D (x,y,scale) na tela
        project: (x, y, z, w, h) => {
            const fov = 850;
            const camHeight = -550; // Câmera acima da mesa
            const camZ = -900;      // Câmera recuada
            
            // Fator de escala baseado na profundidade (Z)
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
    // 3. LÓGICA DO JOGO
    // -----------------------------------------------------------------
    const Game = {
        state: 'INIT',      // MODE_SELECT, LOBBY, CALIB_CENTER, CALIB_BOUNDS, SERVE, RALLY, END
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
        p1: { 
            x: 0, y: 0, 
            handX: 0, handY: 0, 
            prevX: 0, prevY: 0, 
            velX: 0, velY: 0,
            rawX: 0, rawY: 0 // Input cru da câmera
        },
        p2: { x: 0, y: 0, handX: 0, handY: 0, targetX: 0 }, // P2 pode ser IA ou Remote

        // Controle de Estado
        lastBounceZ: 0,     // Onde a bola quicou por último (lado < 0 ou lado > 0)
        bounceCount: 0,     // Quantos quiques no lado atual
        gameTimer: 0,
        particles: [],
        
        // --- SISTEMA DE CALIBRAÇÃO ESPACIAL ---
        calib: {
            step: 0,        // 0: Centro, 1: Topo-Esq, 2: Baixo-Dir
            timer: 0,
            minX: 0, maxX: 640, // Limites detectados da câmera
            minY: 0, maxY: 480,
            ready: false
        },

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
                this.state = 'CALIB_CENTER'; // Inicia calibração rigorosa
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
                    this.state = 'CALIB_CENTER';
                    this.dbRef.child('ball').set(this.ball); // Host inicializa bola
                }
            });
            this.dbRef.child('players/' + myId).onDisconnect().remove();
        },

        startGameOnline: function(myId, hostId) {
            this.state = 'CALIB_CENTER';
            this.dbRef.child('players/' + myId).onDisconnect().remove();
        },

        // -----------------------------------------------------------------
        // LOOP PRINCIPAL
        // -----------------------------------------------------------------
        update: function(ctx, w, h, pose) {
            this.gameTimer++;

            // Fundo e Mesa (Render sempre ativo)
            this.renderEnvironment(ctx, w, h);

            if (this.state === 'MODE_SELECT') { this.renderUI_Mode(ctx, w, h); return; }
            if (this.state === 'LOBBY') { this.renderUI_Lobby(ctx, w, h); return; }
            
            // Fases de Calibração
            if (this.state.startsWith('CALIB')) { 
                this.processCalibration(ctx, w, h, pose); 
                return; 
            }

            // Processar Input (Normalizado pela calibração)
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

            // Renderizar Objetos do Jogo
            this.renderGame(ctx, w, h);
            this.renderHUD(ctx, w, h);
            
            // Mensagens Temporárias
            if (this.msg.timer > 0) {
                this.msg.timer--;
                ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(0, h/2 - 50, w, 100);
                ctx.fillStyle = this.msg.color; ctx.textAlign = "center";
                ctx.font = "bold 50px 'Russo One'";
                ctx.fillText(this.msg.text, w/2, h/2 + 20);
            }

            return this.scoreP1; // Retorna score para o Core
        },

        // -----------------------------------------------------------------
        // CALIBRAÇÃO ESPACIAL AVANÇADA
        // -----------------------------------------------------------------
        processCalibration: function(ctx, w, h, pose) {
            // Fundo escuro para foco
            ctx.fillStyle = "rgba(0,0,0,0.85)"; ctx.fillRect(0,0,w,h);
            
            if (!pose || !pose.keypoints) {
                ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = "20px sans-serif";
                ctx.fillText("NENHUM JOGADOR DETECTADO", w/2, h/2);
                return;
            }

            const wrist = pose.keypoints.find(k => (k.name === 'right_wrist' || k.name === 'left_wrist') && k.score > 0.4);
            const nose = pose.keypoints.find(k => k.name === 'nose');

            if (!wrist) return;

            // Desenha indicador da mão
            const handX = w - (wrist.x / 640 * w); // Espelhado visualmente
            const handY = wrist.y / 480 * h;
            ctx.beginPath(); ctx.arc(handX, handY, 15, 0, Math.PI*2); 
            ctx.fillStyle = "#0ff"; ctx.fill(); ctx.strokeStyle = "#fff"; ctx.stroke();

            ctx.fillStyle = "#fff"; ctx.textAlign = "center";

            if (this.state === 'CALIB_CENTER') {
                ctx.font = "bold 40px 'Russo One'"; ctx.fillText("CALIBRAÇÃO: PASSO 1", w/2, h*0.3);
                ctx.font = "24px sans-serif"; ctx.fillText("Fique no CENTRO e levante a mão", w/2, h*0.4);
                
                // Círculo alvo no centro
                ctx.beginPath(); ctx.arc(w/2, h/2, 40, 0, Math.PI*2);
                ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.stroke();

                const dist = Math.hypot(handX - w/2, handY - h/2);
                if (dist < 50) {
                    this.calib.timer++;
                    ctx.fillStyle = "#2ecc71"; ctx.fill();
                    if (this.calib.timer > 50) {
                        this.state = 'CALIB_BOUNDS';
                        this.calib.timer = 0;
                        // Reset valores extremos
                        this.calib.minX = 1000; this.calib.maxX = -1000;
                        this.calib.minY = 1000; this.calib.maxY = -1000;
                        window.Sfx.play(600, 'sine', 0.2);
                    }
                } else {
                    this.calib.timer = 0;
                }
            }
            else if (this.state === 'CALIB_BOUNDS') {
                ctx.font = "bold 40px 'Russo One'"; ctx.fillText("CALIBRAÇÃO: PASSO 2", w/2, h*0.2);
                ctx.font = "20px sans-serif"; 
                ctx.fillText("Estique o braço para TODOS OS CANTOS", w/2, h*0.28);
                ctx.fillText("Desenhe um retângulo no ar com sua mão", w/2, h*0.33);

                // Captura extremos
                // Nota: Usamos raw camera coords para lógica interna (espelhadas ou nao)
                // Aqui capturamos o RAW da pose (0..640)
                if (wrist.x < this.calib.minX) this.calib.minX = wrist.x;
                if (wrist.x > this.calib.maxX) this.calib.maxX = wrist.x;
                if (wrist.y < this.calib.minY) this.calib.minY = wrist.y;
                if (wrist.y > this.calib.maxY) this.calib.maxY = wrist.y;

                // Visualiza a caixa detectada (convertida pra tela)
                const boxX = w - (this.calib.maxX / 640 * w);
                const boxW = (this.calib.maxX - this.calib.minX) / 640 * w;
                const boxY = this.calib.minY / 480 * h;
                const boxH = (this.calib.maxY - this.calib.minY) / 480 * h;

                ctx.strokeStyle = "#2ecc71"; ctx.lineWidth = 4;
                ctx.strokeRect(boxX, boxY, boxW, boxH);

                this.calib.timer++;
                
                // Feedback de progresso
                const prog = Math.min(this.calib.timer / 150, 1.0); // 2.5 segundos movendo
                ctx.fillStyle = "#2ecc71"; ctx.fillRect(w/2 - 150, h*0.8, 300 * prog, 15);
                ctx.strokeStyle = "#fff"; ctx.strokeRect(w/2 - 150, h*0.8, 300, 15);

                if (this.calib.timer > 150) {
                    // Adiciona margem de segurança (buffer)
                    this.calib.minX -= 20; this.calib.maxX += 20;
                    this.calib.minY -= 20; this.calib.maxY += 20;
                    
                    this.calib.ready = true;
                    this.state = 'SERVE';
                    this.resetBall('p1');
                    window.Sfx.play(800, 'square', 0.2);
                }
            }
        },

        // -----------------------------------------------------------------
        // PROCESSAMENTO DE INPUT (MAPA ESPACIAL)
        // -----------------------------------------------------------------
        processInput: function(pose, w, h) {
            // Suavização
            this.p1.prevX = this.p1.handX;
            this.p1.prevY = this.p1.handY;

            if (pose && pose.keypoints) {
                const wrist = pose.keypoints.find(k => (k.name === 'right_wrist' || k.name === 'left_wrist') && k.score > 0.3);
                
                if (wrist && this.calib.ready) {
                    // 1. Normalizar entrada com base na Calibração (0.0 a 1.0)
                    // Invertemos X para espelhar (se necessário)
                    let normX = Utils3D.map(wrist.x, this.calib.maxX, this.calib.minX, 0, 1); 
                    let normY = Utils3D.map(wrist.y, this.calib.minY, this.calib.maxY, 0, 1);

                    // Clamp (limitar a 0-1)
                    normX = Math.max(0, Math.min(1, normX));
                    normY = Math.max(0, Math.min(1, normY));

                    // 2. Mapear para Coordenadas da Mesa
                    // Mesa X: -TABLE_W/2 a TABLE_W/2 (com margem extra para alcançar fora)
                    const reachX = CONF.TABLE_W * 1.5; 
                    const reachY = 600; // Altura alcançável

                    const targetX = (normX - 0.5) * reachX;
                    const targetY = (normY * reachY) - (reachY/2) - 100; // Ajuste de offset altura

                    // 3. Suavização (Lerp)
                    this.p1.handX = Utils3D.lerp(this.p1.handX, targetX, 0.4); // Rápido
                    this.p1.handY = Utils3D.lerp(this.p1.handY, targetY, 0.4);
                }
            }

            // Calcula velocidade do "Swing" (Vetor de movimento)
            this.p1.velX = this.p1.handX - this.p1.prevX;
            this.p1.velY = this.p1.handY - this.p1.prevY;

            // SAQUE: Bola gruda na mão
            if (this.state === 'SERVE' && this.serverTurn === 'p1') {
                this.ball.x = this.p1.handX;
                this.ball.y = this.p1.handY - 50; // Um pouco acima da raquete
                this.ball.z = -CONF.TABLE_L/2 - 50;
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
            
            // Física inicial do saque
            this.ball.vz = (30 + Math.random() * 5) * dir; // Força para frente
            this.ball.vy = -15; // Arco para cima
            
            if (who === 'p1') {
                // Adiciona efeito do movimento da mão
                this.ball.vx = this.p1.velX * 0.6; 
                this.ball.vy -= Math.abs(this.p1.velY) * 0.2;
                window.Sfx.play(400, 'square', 0.1);
            } else {
                this.ball.vx = (Math.random() - 0.5) * 15;
            }
        },

        updateAI: function() {
            if (this.serverTurn === 'p2' && this.state === 'SERVE') {
                if (this.gameTimer % 100 === 0) this.performServe('p2');
                this.p2.handX = 0;
                this.p2.handY = -150;
            } 
            else if (this.state === 'RALLY') {
                // IA Preditiva
                let targetX = this.ball.x;
                
                // Erro humano (senoidal)
                targetX += Math.sin(this.gameTimer * 0.1) * 60;

                // Move IA
                this.p2.handX = Utils3D.lerp(this.p2.handX, targetX, 0.09);
                
                // IA Rebate
                if (this.ball.z > CONF.TABLE_L/2 - 100 && this.ball.vz > 0) {
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

            // Colisão MESA (Y = 0)
            if (b.y > 0) {
                const halfW = CONF.TABLE_W / 2;
                const halfL = CONF.TABLE_L / 2;

                // Dentro da mesa?
                if (Math.abs(b.x) < halfW && Math.abs(b.z) < halfL) {
                    // QUIQUE
                    b.y = 0;
                    b.vy *= -CONF.BOUNCE_LOSS; 
                    window.Sfx.play(200, 'sine', 0.1);
                    this.createParticle(b.x, 0, b.z, '#fff');

                    // Regras
                    const currentSide = b.z < 0 ? -1 : 1; 

                    if (currentSide === this.lastBounceZ) {
                        // Dois quiques = Ponto
                        this.scorePoint(currentSide === -1 ? 'p2' : 'p1', "DOIS QUIQUES!");
                    } else {
                        this.lastBounceZ = currentSide;
                        this.bounceCount++;
                    }

                } else {
                    // CAIU FORA (CHÃO)
                    if (b.y > 500) { 
                        const attacker = b.vz > 0 ? 'p1' : 'p2';
                        const targetSide = attacker === 'p1' ? 1 : -1;
                        
                        // Se quicou no lado alvo antes de cair fora, ponto do atacante
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
                b.vz *= -0.4; 
                b.vx *= 0.5;
                window.Sfx.play(150, 'sawtooth', 0.2);
            }
        },

        checkCollisions: function() {
            if (!this.ball.active) return;

            // Raquete P1
            const p1Z = -CONF.TABLE_L/2 - 50;
            
            // Verifica se a bola cruza o plano do jogador
            if (this.ball.vz < 0 && this.ball.z < p1Z + 150 && this.ball.z > p1Z - 100) {
                const dist = Utils3D.dist2d({x: this.ball.x, y: this.ball.y}, {x: this.p1.handX, y: this.p1.handY});
                
                if (dist < CONF.PADDLE_SIZE) {
                    this.hitBall('p1');
                }
            }
        },

        hitBall: function(who) {
            const b = this.ball;
            const dir = who === 'p1' ? 1 : -1;
            
            // Fator SWING: Transfere movimento da mão para a bola
            const swingX = who === 'p1' ? this.p1.velX : (Math.random()-0.5)*20;
            const swingY = who === 'p1' ? this.p1.velY : (Math.random()-0.5)*10;

            // Física de Rebate
            b.vz = (40 + Math.abs(swingY) * 0.5) * dir; // Velocidade frontal
            b.vx = (b.x - (who==='p1'?this.p1.handX : this.p2.handX)) * 0.25 + (swingX * 0.6); // Efeito lateral (spin)
            b.vy = -18 - (Math.abs(swingY) * 0.3); // Lift (arco)

            // Clamp velocidade máxima
            if (Math.abs(b.vz) > CONF.MAX_SPEED) b.vz = CONF.MAX_SPEED * dir;

            this.lastBounceZ = 0; 
            
            window.Sfx.hit();
            if(who === 'p1' && window.Gfx) window.Gfx.shakeScreen(6);
            this.createParticle(b.x, b.y, b.z, '#ffff00', 12);
        },

        checkRules: function() {
            // Reset se bola sair voando
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
                this.showMsg(reason || "PONTO P1", "#2ecc71");
            } else {
                this.scoreP2++;
                this.showMsg(reason || "PONTO CPU", "#e74c3c");
            }

            this.ball.active = false;
            this.serverTurn = winner; 
            
            if (this.scoreP1 >= 7 || this.scoreP2 >= 7) {
                setTimeout(() => this.state = 'END', 2500);
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

            if (this.gameTimer % CONF.SYNC_RATE === 0) {
                this.dbRef.child(this.isHost ? 'p1' : 'p2').set({
                    handX: this.p1.handX,
                    handY: this.p1.handY
                });
                if (this.isHost) {
                    this.dbRef.child('ball').set(this.ball);
                    this.dbRef.child('score').set({p1: this.scoreP1, p2: this.scoreP2, turn: this.serverTurn, state: this.state});
                }
            }

            const target = this.isHost ? 'p2' : 'p1';
            this.dbRef.child(target).once('value', snap => {
                const val = snap.val();
                if (val) {
                    this.p2.handX = val.handX;
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
            // Fundo Gradiente Esportivo
            const grad = ctx.createLinearGradient(0, 0, 0, h);
            grad.addColorStop(0, "#2c3e50");
            grad.addColorStop(1, "#1a252f");
            ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);

            // Chão (Grid 3D Infinito)
            ctx.strokeStyle = "rgba(255,255,255,0.08)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let i = -3000; i < 3000; i+= 300) {
                const p1 = Utils3D.project(i, 500, -3000, w, h);
                const p2 = Utils3D.project(i, 500, 3000, w, h);
                ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
                
                const p3 = Utils3D.project(-3000, 500, i, w, h);
                const p4 = Utils3D.project(3000, 500, i, w, h);
                ctx.moveTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y);
            }
            ctx.stroke();
        },

        renderGame: function(ctx, w, h) {
            // 1. MESA
            const hw = CONF.TABLE_W/2;
            const hl = CONF.TABLE_L/2;
            
            const c1 = Utils3D.project(-hw, 0, -hl, w, h); 
            const c2 = Utils3D.project(hw, 0, -hl, w, h); 
            const c3 = Utils3D.project(hw, 0, hl, w, h); 
            const c4 = Utils3D.project(-hw, 0, hl, w, h); 

            // Tampo
            ctx.fillStyle = "#2980b9";
            ctx.beginPath();
            ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.lineTo(c3.x, c3.y); ctx.lineTo(c4.x, c4.y);
            ctx.fill();
            
            // Bordas e Detalhes
            ctx.strokeStyle = "#fff"; ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.lineTo(c3.x, c3.y); ctx.lineTo(c4.x, c4.y); ctx.closePath();
            ctx.stroke();
            
            // Rede
            const n1 = Utils3D.project(-hw - 30, 0, 0, w, h);
            const n2 = Utils3D.project(hw + 30, 0, 0, w, h);
            const n1t = Utils3D.project(-hw - 30, -CONF.NET_H, 0, w, h);
            const n2t = Utils3D.project(hw + 30, -CONF.NET_H, 0, w, h);
            
            ctx.fillStyle = "rgba(220,220,220,0.6)";
            ctx.beginPath(); ctx.moveTo(n1.x, n1.y); ctx.lineTo(n2.x, n2.y); ctx.lineTo(n2t.x, n2t.y); ctx.lineTo(n1t.x, n1t.y); ctx.fill();
            ctx.strokeStyle = "#eee"; ctx.lineWidth = 1; ctx.stroke();

            // 2. OBJETOS
            // Raquete P2 (Longe)
            const p2Pos = Utils3D.project(-this.p2.handX, this.p2.handY, CONF.TABLE_L/2 + 50, w, h);
            this.drawPaddle(ctx, p2Pos, "#e74c3c", false);

            // Bola
            this.drawBall(ctx, w, h);

            // Raquete P1 (Perto - Segue calibração)
            // Visualmente fixamos Z perto da câmera para feedback
            const p1Pos = Utils3D.project(this.p1.handX, this.p1.handY, -CONF.TABLE_L/2 - 50, w, h);
            this.drawPaddle(ctx, p1Pos, "#3498db", true);

            // Partículas
            this.particles.forEach((p, i) => {
                p.x += p.vx; p.y += p.vy; p.life -= 0.05;
                if (p.life <= 0) this.particles.splice(i, 1);
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
            
            // Sombra
            if (b.y < 0) {
                const shadow = Utils3D.project(b.x, 0, b.z, w, h);
                ctx.fillStyle = "rgba(0,0,0,0.4)";
                ctx.beginPath(); 
                ctx.ellipse(shadow.x, shadow.y, 12 * shadow.s, 5 * shadow.s, 0, 0, Math.PI*2); 
                ctx.fill();
            }

            // Bola com Brilho
            const rad = CONF.BALL_R * pos.s;
            const grad = ctx.createRadialGradient(pos.x - rad*0.3, pos.y - rad*0.3, rad*0.1, pos.x, pos.y, rad);
            grad.addColorStop(0, "#fff"); grad.addColorStop(1, "#f39c12");
            
            ctx.fillStyle = grad;
            ctx.beginPath(); ctx.arc(pos.x, pos.y, rad, 0, Math.PI*2); ctx.fill();
        },

        drawPaddle: function(ctx, pos, color, isPlayer) {
            const s = pos.s * (CONF.PADDLE_SIZE / 100);
            const size = 65 * s;

            // Cabo
            ctx.fillStyle = "#8e44ad"; 
            ctx.fillRect(pos.x - 8*s, pos.y + size*0.8, 16*s, 50*s);

            // Raquete
            ctx.fillStyle = "#111"; // Borracha preta atrás
            ctx.beginPath(); ctx.arc(pos.x, pos.y, size, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = color;  // Borracha colorida frente
            ctx.beginPath(); ctx.arc(pos.x, pos.y, size-4, 0, Math.PI*2); ctx.fill();
            
            // Rastro de Swing
            if (isPlayer) {
                const speed = Math.hypot(this.p1.velX, this.p1.velY);
                if (speed > 5) {
                    ctx.strokeStyle = "rgba(255,255,255,0.4)";
                    ctx.lineWidth = 6;
                    ctx.beginPath();
                    ctx.moveTo(pos.x, pos.y);
                    ctx.lineTo(pos.x - this.p1.velX * s * 2, pos.y - this.p1.velY * s * 2);
                    ctx.stroke();
                }
            }
        },

        renderHUD: function(ctx, w, h) {
            // Placar TV Style
            ctx.fillStyle = "#000"; ctx.fillRect(w/2 - 100, 20, 200, 60);
            ctx.strokeStyle = "#fff"; ctx.lineWidth=2; ctx.strokeRect(w/2 - 100, 20, 200, 60);
            
            ctx.font = "bold 40px 'Russo One'"; ctx.textAlign = "center";
            ctx.fillStyle = "#3498db"; ctx.fillText(this.scoreP1, w/2 - 50, 65);
            ctx.fillStyle = "#fff"; ctx.fillText("-", w/2, 65);
            ctx.fillStyle = "#e74c3c"; ctx.fillText(this.scoreP2, w/2 + 50, 65);
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

        // -----------------------------------------------------------------
        // AUXILIARES
        // -----------------------------------------------------------------
        createParticle: function(x, y, z, color) {
            for(let i=0; i<12; i++) {
                this.particles.push({
                    x, y, z, c: color, life: 1.0,
                    vx: (Math.random()-0.5)*20, vy: (Math.random()-0.5)*20
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