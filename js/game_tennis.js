// =============================================================================
// PING PONG LEGENDS: TITANIUM EDITION (V4.0 - GAME FEEL & PRECISION)
// ARQUITETO: SENIOR GAME DEV (SPECIALIST IN MOTION CONTROL)
// STATUS: FINAL POLISH - HIT STOP, SCREEN SHAKE, EXTENDED REACH
// =============================================================================

(function() {
    "use strict";

    // -----------------------------------------------------------------
    // 1. CONFIGURAÇÃO DE FEELING (O SEGREDO DO "GOSTOSO DE JOGAR")
    // -----------------------------------------------------------------
    const CONF = {
        // Dimensões
        TABLE_W: 1100,
        TABLE_L: 1900,
        NET_H: 140,
        BALL_R: 24,
        
        // Física Arcade
        GRAVITY: 0.65,      // Gravidade forte para a bola cair rápido (mais dinâmico)
        AIR_DRAG: 0.98,     // Bola desacelera no ar
        BOUNCE_LOSS: 0.85,  // Quique na mesa
        
        // Jogabilidade
        PADDLE_OFFSET_Y: -60, // A raquete flutua ACIMA do pulso (simula segurar cabo)
        PADDLE_SIZE: 140,     // Hitbox generosa
        SWING_SENSITIVITY: 2.8, // Multiplicador de força
        
        // Juice (Efeitos Visuais)
        HIT_STOP_FRAMES: 4,   // Congela o jogo ao bater (Impacto)
        SHAKE_INTENSITY: 15,  // Treme a tela
    };

    // -----------------------------------------------------------------
    // 2. ENGINE 3D & MATEMÁTICA
    // -----------------------------------------------------------------
    const Utils3D = {
        // Projeção Perspectiva Otimizada
        project: (x, y, z, w, h) => {
            const fov = 850;
            const camHeight = -650; 
            const camZ = -1000;
            
            const scale = fov / (fov + (z - camZ));
            return {
                x: (x * scale) + w/2,
                y: ((y - camHeight) * scale) + h/2,
                s: scale
            };
        },
        lerp: (a, b, t) => (1 - t) * a + t * b,
        dist: (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y),
        map: (v, iMin, iMax, oMin, oMax) => (v - iMin) * (oMax - oMin) / (iMax - iMin) + oMin
    };

    // -----------------------------------------------------------------
    // 3. LÓGICA PRINCIPAL
    // -----------------------------------------------------------------
    const Game = {
        state: 'INIT', 
        roomId: 'ping_v4',
        isOnline: false,
        isHost: true, // Padrão offline
        dbRef: null,
        
        scoreP1: 0,
        scoreP2: 0,
        serverTurn: 'p1',

        // Objetos Físicos
        ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, active: false },
        
        // Jogador (P1)
        p1: { 
            handX: 0, handY: 0, // Posição calculada na mesa
            rawX: 0, rawY: 0,   // Posição crua da câmera
            velX: 0, velY: 0,   // Velocidade do swing
            history: []         // Histórico para suavização inteligente
        },
        // Oponente (P2 - IA ou Online)
        p2: { handX: 0, handY: 0, targetX: 0 },

        // Estado do Jogo
        bounceSide: 0,      // -1 (P1), 1 (P2), 0 (Nenhum)
        bounceCount: 0,
        hitStop: 0,         // Contador de congelamento
        particles: [],
        
        // Calibração Automática (Auto-Tune)
        // O jogo aprende seus limites enquanto você joga/calibra
        bounds: { minX: 1000, maxX: -1000, minY: 1000, maxY: -1000 },
        calibTimer: 0,

        msg: { t: "", c: "#fff", life: 0 },

        init: function() {
            this.state = 'MODE_SELECT';
            this.scoreP1 = 0;
            this.scoreP2 = 0;
            this.serverTurn = 'p1';
            window.System.msg("PING PONG LEGENDS");
            this.setupInput();
        },

        setupInput: function() {
            window.System.canvas.onclick = (e) => {
                const r = window.System.canvas.getBoundingClientRect();
                const my = e.clientY - r.top;
                
                if (this.state === 'MODE_SELECT') {
                    window.Sfx.click();
                    if (my < r.height/2) this.setMode('OFFLINE');
                    else this.setMode('ONLINE');
                }
                else if (this.state === 'END') {
                    this.init();
                }
            };
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
                this.isHost = true;
                this.state = 'CALIBRATION'; // Vai para calibração
                this.calibTimer = 0;
                // Reset limites para forçar calibração
                this.bounds = { minX: 1000, maxX: -1000, minY: 1000, maxY: -1000 };
            }
        },

        connectLobby: function() {
            this.state = 'LOBBY';
            const myId = window.System.playerId || 'p_' + Math.floor(Math.random()*9999);
            this.dbRef = window.DB.ref('rooms/' + this.roomId);
            
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
                    this.state = 'CALIBRATION';
                    this.calibTimer = 0;
                    this.dbRef.child('ball').set(this.ball);
                }
            });
            this.dbRef.child('players/' + myId).onDisconnect().remove();
        },

        startGameOnline: function(myId) {
            this.state = 'CALIBRATION';
            this.calibTimer = 0;
            this.dbRef.child('players/' + myId).onDisconnect().remove();
        },

        // -----------------------------------------------------------------
        // LOOP DE JOGO (UPDATE)
        // -----------------------------------------------------------------
        update: function(ctx, w, h, pose) {
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
            if (this.state === 'CALIBRATION') {
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

            return this.scoreP1;
        },

        // -----------------------------------------------------------------
        // INPUT INTELIGENTE (O CORAÇÃO DO FEELING)
        // -----------------------------------------------------------------
        processInput: function(pose, w, h) {
            if (!pose || !pose.keypoints) return;

            // Pega o pulso com melhor confiança
            const wrist = pose.keypoints.find(k => (k.name === 'right_wrist' || k.name === 'left_wrist') && k.score > 0.3);
            
            if (wrist) {
                // Inverte X (Espelho)
                const rawX = 640 - wrist.x;
                const rawY = wrist.y;

                // Mapeamento Dinâmico (Usa os limites da calibração)
                // Transforma a posição da câmera em posição da mesa
                // Mesa Virtual X: -600 a 600
                // Mesa Virtual Y: -300 a 400
                
                // Normaliza 0..1
                let normX = Utils3D.map(rawX, this.bounds.minX, this.bounds.maxX, 0, 1);
                let normY = Utils3D.map(rawY, this.bounds.minY, this.bounds.maxY, 0, 1);
                
                // Expande um pouco o alcance (Overdrive) para alcançar cantos fácil
                normX = (normX - 0.5) * 1.2 + 0.5; 
                
                const targetX = (normX - 0.5) * (CONF.TABLE_W * 1.4);
                const targetY = (normY * 700) - 350 + CONF.PADDLE_OFFSET_Y;

                // Suavização Adaptativa
                // Se mover rápido = Menos lag (suavização menor)
                // Se mover devagar = Mais precisão (suavização maior)
                const dist = Math.hypot(targetX - this.p1.handX, targetY - this.p1.handY);
                const lerpFactor = dist > 50 ? 0.6 : 0.2;

                this.p1.handX = Utils3D.lerp(this.p1.handX, targetX, lerpFactor);
                this.p1.handY = Utils3D.lerp(this.p1.handY, targetY, lerpFactor);

                // Calcula velocidade (Swing)
                this.p1.velX = this.p1.handX - (this.p1.history[0]?.x || this.p1.handX);
                this.p1.velY = this.p1.handY - (this.p1.history[0]?.y || this.p1.handY);

                // Histórico curto para média de velocidade
                this.p1.history.unshift({x: this.p1.handX, y: this.p1.handY});
                if(this.p1.history.length > 3) this.p1.history.pop();
            }

            // Gesto de Saque
            if (this.state === 'SERVE' && this.serverTurn === 'p1') {
                // Bola segue a mão
                this.ball.x = this.p1.handX;
                this.ball.y = this.p1.handY - 50; 
                this.ball.z = -CONF.TABLE_L/2 - 50;
                this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;

                // Detecta movimento brusco para cima ou frente
                if (this.p1.velY < -15 || Math.abs(this.p1.velX) > 15) {
                    this.performServe('p1');
                }
            }
        },

        processCalibration: function(ctx, w, h, pose) {
            ctx.fillStyle = "rgba(0,0,0,0.85)"; ctx.fillRect(0,0,w,h);
            
            ctx.fillStyle = "#fff"; ctx.textAlign = "center";
            ctx.font = "bold 40px 'Russo One'"; ctx.fillText("CALIBRAÇÃO", w/2, h*0.3);
            ctx.font = "24px sans-serif"; 
            ctx.fillText("Estique seu braço para os 4 cantos", w/2, h*0.4);
            ctx.fillText("da tela como se estivesse pintando", w/2, h*0.45);

            if (pose && pose.keypoints) {
                const wrist = pose.keypoints.find(k => (k.name === 'right_wrist' || k.name === 'left_wrist') && k.score > 0.4);
                
                if (wrist) {
                    const rawX = 640 - wrist.x; // Invertido
                    const rawY = wrist.y;

                    // Expande limites dinamicamente
                    if (rawX < this.bounds.minX) this.bounds.minX = rawX;
                    if (rawX > this.bounds.maxX) this.bounds.maxX = rawX;
                    if (rawY < this.bounds.minY) this.bounds.minY = rawY;
                    if (rawY > this.bounds.maxY) this.bounds.maxY = rawY;

                    // Visualiza mão
                    const visX = (rawX / 640) * w; // Re-normaliza pra tela
                    const visY = (rawY / 480) * h;
                    ctx.beginPath(); ctx.arc(visX, visY, 20, 0, Math.PI*2);
                    ctx.fillStyle = "#0ff"; ctx.fill();

                    // Barra de progresso baseada no tempo
                    this.calibTimer++;
                    const progress = Math.min(this.calibTimer / 150, 1.0); // 2.5 segundos
                    
                    ctx.fillStyle = "#2ecc71"; ctx.fillRect(w/2 - 150, h*0.6, 300 * progress, 20);
                    ctx.strokeStyle = "#fff"; ctx.strokeRect(w/2 - 150, h*0.6, 300, 20);

                    if (this.calibTimer > 150) {
                        // Adiciona margem de segurança (Padding)
                        const padX = (this.bounds.maxX - this.bounds.minX) * 0.1;
                        const padY = (this.bounds.maxY - this.bounds.minY) * 0.1;
                        this.bounds.minX += padX; this.bounds.maxX -= padX;
                        this.bounds.minY += padY; this.bounds.maxY -= padY;

                        this.state = 'SERVE';
                        this.resetBall('p1');
                        window.Sfx.play(600, 'sine', 0.2);
                    }
                }
            }
        },

        // -----------------------------------------------------------------
        // GAMEPLAY (FÍSICA & REGRAS)
        // -----------------------------------------------------------------
        performServe: function(who) {
            this.state = 'RALLY';
            this.ball.active = true;
            this.bounceCount = 0;
            this.bounceSide = 0;

            const dir = who === 'p1' ? 1 : -1;
            
            // Saque consistente
            this.ball.vz = (35 + Math.random() * 5) * dir;
            this.ball.vy = -16;
            
            if (who === 'p1') {
                // Adiciona um pouco do swing do jogador
                this.ball.vx = this.p1.velX * 0.5;
                window.Sfx.play(400, 'square', 0.1);
            } else {
                this.ball.vx = (Math.random() - 0.5) * 15;
            }
        },

        checkPaddleHit: function(player) {
            if (!this.ball.active) return;

            // Define posição da raquete a checar
            const isP1 = player === 'p1';
            const pHand = isP1 ? this.p1 : this.p2;
            
            // Zona Z da raquete (P1 perto, P2 longe)
            const paddleZ = isP1 ? (-CONF.TABLE_L/2 - 50) : (CONF.TABLE_L/2 + 50);
            const dir = isP1 ? 1 : -1; // Direção que a bola deve ir após batida

            // Verifica se a bola está vindo na direção do jogador e está na zona de impacto
            // Zona Z: +/- 200 unidades da raquete
            const ballComing = isP1 ? (this.ball.vz < 0) : (this.ball.vz > 0);
            
            if (ballComing && Math.abs(this.ball.z - paddleZ) < 200) {
                // Hitbox Circular
                const dist = Utils3D.dist2d({x:this.ball.x, y:this.ball.y}, {x:pHand.handX, y:pHand.handY});
                
                if (dist < CONF.PADDLE_SIZE) {
                    // --- IMPACTO CONFIRMADO ---
                    
                    // 1. Som e Visual
                    window.Sfx.hit();
                    this.createParticle(this.ball.x, this.ball.y, this.ball.z, isP1 ? '#0ff' : '#f00');
                    
                    // 2. Hit Stop & Shake (Só pro P1 sentir)
                    if (isP1) {
                        this.hitStop = CONF.HIT_STOP_FRAMES;
                        if(window.Gfx) window.Gfx.shakeScreen(CONF.SHAKE_INTENSITY);
                    }

                    // 3. Física de Rebate (Swing)
                    let swingX = 0, swingY = 0;
                    if (isP1) {
                        swingX = this.p1.velX;
                        swingY = this.p1.velY;
                    } else {
                        // Simula swing da IA
                        swingX = (Math.random()-0.5)*20;
                        swingY = (Math.random()-0.5)*15;
                    }

                    // A bola ganha velocidade base + bônus do swing
                    // Se bater parado, volta fraco. Se bater correndo, volta tijolada.
                    let speedZ = 45 + (Math.abs(swingY) * 0.5) + (Math.abs(swingX) * 0.2);
                    speedZ = Math.min(speedZ, CONF.MAX_SPEED);

                    this.ball.vz = speedZ * dir; 
                    
                    // Ângulo (X) depende de onde bateu na raquete + movimento lateral
                    const offsetHit = (this.ball.x - pHand.handX) * 0.3;
                    this.ball.vx = offsetHit + (swingX * 0.5);
                    
                    // Altura (Y) - Cortada vs Lift
                    // Se bater de cima pra baixo (velY > 0), bola vai reta/baixa
                    // Se bater de baixo pra cima (velY < 0), bola sobe (lift)
                    this.ball.vy = -15 - (swingY * -0.3); 

                    // Reset quiques
                    this.bounceSide = 0;
                    this.bounceCount = 0;
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

            // Mesa (Y=0)
            if (b.y > 0) {
                const hw = CONF.TABLE_W/2;
                const hl = CONF.TABLE_L/2;

                if (Math.abs(b.x) < hw && Math.abs(b.z) < hl) {
                    // Quicou na mesa
                    b.y = 0;
                    b.vy *= -CONF.BOUNCE_LOSS;
                    window.Sfx.play(200, 'sine', 0.1);
                    this.createParticle(b.x, 0, b.z, '#fff');

                    // Regras
                    const side = b.z < 0 ? -1 : 1; // -1: P1, 1: P2
                    if (side === this.bounceSide) {
                        // Dois quiques no mesmo lado
                        this.scorePoint(side === -1 ? 'p2' : 'p1', "DOIS QUIQUES!");
                    } else {
                        this.bounceSide = side;
                        this.bounceCount++;
                    }
                } else if (b.y > 500) {
                    // Caiu no chão
                    const attacker = b.vz > 0 ? 'p1' : 'p2';
                    const targetSide = attacker === 'p1' ? 1 : -1;
                    
                    // Se quicou no lado do oponente antes de cair = Ponto
                    if (this.bounceSide === targetSide) {
                        this.scorePoint(attacker, "PONTO!");
                    } else {
                        this.scorePoint(attacker === 'p1' ? 'p2' : 'p1', "FORA!");
                    }
                }
            }

            // Rede
            if (Math.abs(b.z) < 15 && b.y > -CONF.NET_H) {
                b.vz *= -0.3; b.vx *= 0.5;
                window.Sfx.play(150, 'sawtooth', 0.2);
            }
        },

        updateAI: function() {
            if (this.serverTurn === 'p2' && this.state === 'SERVE') {
                if (this.gameTimer % 100 === 0) this.performServe('p2');
                this.p2.handX = 0; this.p2.handY = -150;
            } 
            else if (this.state === 'RALLY') {
                let tx = this.ball.x;
                // Erro da IA
                tx += Math.sin(this.gameTimer * 0.1) * 80;
                
                this.p2.handX = Utils3D.lerp(this.p2.handX, tx, 0.08);
                // IA tenta acompanhar altura da bola
                this.p2.handY = Utils3D.lerp(this.p2.handY, this.ball.y, 0.1);
            }
        },

        checkRules: function() {
            if (Math.abs(this.ball.z) > 3000) {
                const winner = this.ball.vz > 0 ? 'p1' : 'p2';
                // Saiu sem quicar
                if (this.bounceSide !== (winner==='p1'?1:-1)) {
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
            
            if (this.scoreP1 >= 7 || this.scoreP2 >= 7) setTimeout(() => this.state = 'END', 2000);
            else setTimeout(() => this.resetBall(winner), 1500);
        },

        resetBall: function(server) {
            this.state = 'SERVE';
            this.ball = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, active: false };
            this.serverTurn = server;
            this.bounceSide = 0;
            this.showMsg(server === 'p1' ? "SEU SAQUE" : "SAQUE CPU", "#fff");
        },

        syncNetwork: function() {
            if (!this.dbRef) return;
            // Envia P1
            if (this.gameTimer % CONF.SYNC_RATE === 0) {
                this.dbRef.child(this.isHost ? 'p1' : 'p2').set({
                    handX: this.p1.handX, handY: this.p1.handY
                });
                if (this.isHost) {
                    this.dbRef.child('ball').set(this.ball);
                    this.dbRef.child('score').set({p1: this.scoreP1, p2: this.scoreP2, turn: this.serverTurn});
                }
            }
            // Recebe P2
            const target = this.isHost ? 'p2' : 'p1';
            this.dbRef.child(target).once('value', s => {
                const v = s.val();
                if(v) { this.p2.handX = v.handX; this.p2.handY = v.handY; }
            });
            // Cliente recebe bola/placar
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
            // Environment
            const grad = ctx.createLinearGradient(0,0,0,h);
            grad.addColorStop(0, "#2c3e50"); grad.addColorStop(1, "#1a252f");
            ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);

            // Grid
            ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth=1; ctx.beginPath();
            for(let i=-3000; i<3000; i+=400) {
                let p1 = Utils3D.project(i, 600, -3000, w, h);
                let p2 = Utils3D.project(i, 600, 3000, w, h);
                ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
                let p3 = Utils3D.project(-3000, 600, i, w, h);
                let p4 = Utils3D.project(3000, 600, i, w, h);
                ctx.moveTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y);
            }
            ctx.stroke();

            // Mesa
            const hw = CONF.TABLE_W/2, hl = CONF.TABLE_L/2;
            const c1 = Utils3D.project(-hw, 0, -hl, w, h);
            const c2 = Utils3D.project(hw, 0, -hl, w, h);
            const c3 = Utils3D.project(hw, 0, hl, w, h);
            const c4 = Utils3D.project(-hw, 0, hl, w, h);

            ctx.fillStyle = "#2980b9";
            ctx.beginPath(); ctx.moveTo(c1.x,c1.y); ctx.lineTo(c2.x,c2.y); ctx.lineTo(c3.x,c3.y); ctx.lineTo(c4.x,c4.y); ctx.fill();
            ctx.strokeStyle = "#fff"; ctx.lineWidth=4; ctx.stroke();
            
            // Rede
            const n1 = Utils3D.project(-hw-20, 0, 0, w, h);
            const n2 = Utils3D.project(hw+20, 0, 0, w, h);
            const n1t = Utils3D.project(-hw-20, -CONF.NET_H, 0, w, h);
            const n2t = Utils3D.project(hw+20, -CONF.NET_H, 0, w, h);
            ctx.fillStyle="rgba(255,255,255,0.3)"; ctx.beginPath();
            ctx.moveTo(n1.x,n1.y); ctx.lineTo(n2.x,n2.y); ctx.lineTo(n2t.x,n2t.y); ctx.lineTo(n1t.x,n1t.y); ctx.fill();

            // P2 Paddle
            const posP2 = Utils3D.project(-this.p2.handX, this.p2.handY, CONF.TABLE_L/2 + 50, w, h);
            this.drawPaddle(ctx, posP2, "#e74c3c", false);

            // Bola
            const posB = Utils3D.project(this.ball.x, this.ball.y, this.ball.z, w, h);
            // Sombra
            if (this.ball.y < 0) {
                const shad = Utils3D.project(this.ball.x, 0, this.ball.z, w, h);
                ctx.fillStyle="rgba(0,0,0,0.4)"; ctx.beginPath();
                ctx.ellipse(shad.x, shad.y, 15*shad.s, 6*shad.s, 0, 0, Math.PI*2); ctx.fill();
            }
            // Corpo
            const rad = CONF.BALL_R * posB.s;
            const bg = ctx.createRadialGradient(posB.x-rad*0.3, posB.y-rad*0.3, rad*0.1, posB.x, posB.y, rad);
            bg.addColorStop(0,"#fff"); bg.addColorStop(1,"#f39c12");
            ctx.fillStyle=bg; ctx.beginPath(); ctx.arc(posB.x, posB.y, rad, 0, Math.PI*2); ctx.fill();

            // P1 Paddle (Transparente se estiver na frente da bola para não tapar visão)
            const posP1 = Utils3D.project(this.p1.handX, this.p1.handY, -CONF.TABLE_L/2 - 50, w, h);
            this.drawPaddle(ctx, posP1, "#3498db", true);

            // Partículas
            this.particles.forEach((p, i) => {
                p.x += p.vx; p.y += p.vy; p.life -= 0.05;
                if(p.life<=0) this.particles.splice(i,1);
                else {
                    const pp = Utils3D.project(p.x, p.y, p.z, w, h);
                    ctx.fillStyle=p.c; ctx.globalAlpha=p.life; 
                    ctx.beginPath(); ctx.arc(pp.x, pp.y, 4*pp.s, 0, Math.PI*2); ctx.fill();
                }
            });
            ctx.globalAlpha=1.0;

            // HUD
            ctx.fillStyle="#000"; ctx.fillRect(w/2-90, 20, 180, 50);
            ctx.strokeStyle="#fff"; ctx.lineWidth=2; ctx.strokeRect(w/2-90, 20, 180, 50);
            ctx.font="bold 30px 'Russo One'"; ctx.textAlign="center";
            ctx.fillStyle="#3498db"; ctx.fillText(this.scoreP1, w/2-40, 55);
            ctx.fillStyle="#fff"; ctx.fillText("-", w/2, 55);
            ctx.fillStyle="#e74c3c"; ctx.fillText(this.scoreP2, w/2+40, 55);

            // Mensagem
            if (this.msg.life > 0) {
                this.msg.life--;
                ctx.fillStyle="rgba(0,0,0,0.5)"; ctx.fillRect(0,h/2-40,w,80);
                ctx.fillStyle=this.msg.c; ctx.font="bold 40px 'Russo One'";
                ctx.fillText(this.msg.t, w/2, h/2+15);
            }
        },

        drawPaddle: function(ctx, pos, col, isP1) {
            const s = pos.s * (CONF.PADDLE_SIZE/100);
            // Cabo
            ctx.fillStyle="#8e44ad"; ctx.fillRect(pos.x-10*s, pos.y+50*s, 20*s, 60*s);
            // Face
            ctx.fillStyle="#222"; ctx.beginPath(); ctx.arc(pos.x, pos.y, 60*s, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle=col; ctx.beginPath(); ctx.arc(pos.x, pos.y, 55*s, 0, Math.PI*2); ctx.fill();
            // Swing Trail
            if (isP1 && Math.hypot(this.p1.velX, this.p1.velY) > 5) {
                ctx.strokeStyle="rgba(255,255,255,0.4)"; ctx.lineWidth=5;
                ctx.beginPath(); ctx.moveTo(pos.x, pos.y);
                ctx.lineTo(pos.x - this.p1.velX*s*2, pos.y - this.p1.velY*s*2);
                ctx.stroke();
            }
        },

        renderUI_Mode: function(ctx, w, h) {
            ctx.fillStyle="rgba(0,0,0,0.9)"; ctx.fillRect(0,0,w,h);
            ctx.fillStyle="#fff"; ctx.textAlign="center";
            ctx.font="bold 60px 'Russo One'"; ctx.fillText("PING PONG", w/2, 150);
            ctx.fillStyle="#3498db"; ctx.fillRect(w/2-150, h/2-80, 300, 80);
            ctx.fillStyle="#fff"; ctx.font="bold 30px 'Russo One'"; ctx.fillText("OFFLINE", w/2, h/2-30);
            ctx.fillStyle="#e67e22"; ctx.fillRect(w/2-150, h/2+20, 300, 80);
            ctx.fillStyle="#fff"; ctx.fillText("ONLINE", w/2, h/2+70);
        },

        renderUI_Lobby: function(ctx, w, h) {
            ctx.fillStyle="#2c3e50"; ctx.fillRect(0,0,w,h);
            ctx.fillStyle="#fff"; ctx.textAlign="center"; ctx.font="30px sans-serif";
            ctx.fillText(this.isHost ? "AGUARDANDO..." : "CONECTANDO...", w/2, h/2);
        },

        showMsg: function(t, c) { this.msg = {t, c, life: 90}; },
        createParticle: function(x, y, z, c) {
            for(let i=0; i<8; i++) this.particles.push({x,y,z,c, vx:(Math.random()-.5)*20, vy:(Math.random()-.5)*20, life:1});
        }
    };

    if (window.System && window.System.registerGame) {
        window.System.registerGame('tennis', 'Ping Pong Legends', '🏓', Game, { camOpacity: 0.1 });
    }
})();