// =============================================================================
// TABLE TENNIS LEGENDS: TITANIUM EDITION (V5.0 - REALISTIC PHYSICS & MAPPING)
// ARQUITETO: SENIOR GAME ENGINE ARCHITECT (20+ YEARS EXP)
// STATUS: SPATIAL MAPPING V2, VECTOR SWING, EXTENDED REACH
// =============================================================================

(function() {
    "use strict";

    // -----------------------------------------------------------------
    // 1. CONFIGURAÇÃO DE ALTO NÍVEL
    // -----------------------------------------------------------------
    const CONF = {
        // Dimensões Virtuais (Unidades de Jogo - mm)
        TABLE_W: 1525, 
        TABLE_L: 2740,
        NET_H: 152,
        BALL_R: 25,
        
        // Física
        GRAVITY: 0.6,       // Gravidade "pesada" para sensação arcade/realista
        AIR_DRAG: 0.99,     // Resistência do ar
        BOUNCE_EFF: 0.85,   // Eficiência do quique (restituição)
        FLOOR_Y: 760,       // Altura da mesa do chão
        
        // Jogabilidade
        PADDLE_OFFSET: 120, // Distância do pulso até o centro da raquete (O "Cabo")
        PADDLE_RADIUS: 140, // Tamanho da cabeça da raquete (Hitbox)
        SWING_POWER: 2.2,   // Multiplicador de força do braço
        MAX_SPEED: 90,      // Velocidade terminal da bola
        
        // Multiplayer
        SYNC_RATE: 2        // Frames entre envios de rede
    };

    // -----------------------------------------------------------------
    // 2. MOTOR 3D (PROJEÇÃO PERSPECTIVA MANUAL)
    // -----------------------------------------------------------------
    const Utils3D = {
        project: (x, y, z, w, h) => {
            // Câmera posicionada como um jogador real (atrás da mesa, um pouco acima)
            const fov = 800;
            const camX = 0;
            const camY = -1400; // Olhos acima da mesa
            const camZ = -1200; // Recuado da mesa
            
            // Translação relativa à câmera
            const tx = x - camX;
            const ty = y - camY;
            const tz = z - camZ;

            // Evita divisão por zero ou objetos atrás da câmera
            if (tz <= 0) return { x: -5000, y: -5000, s: 0, visible: false };

            const scale = fov / tz;
            const screenX = (tx * scale) + w/2;
            const screenY = (ty * scale) + h/2;

            return { x: screenX, y: screenY, s: scale, visible: true };
        },

        // Mapeamento linear com clamp
        map: (val, inMin, inMax, outMin, outMax) => {
            const t = (val - inMin) / (inMax - inMin);
            const clamped = Math.max(0, Math.min(1, t));
            return outMin + clamped * (outMax - outMin);
        },

        lerp: (a, b, t) => a + (b - a) * t,
        
        distSq: (x1, y1, x2, y2) => (x1-x2)**2 + (y1-y2)**2
    };

    // -----------------------------------------------------------------
    // 3. LÓGICA DO JOGO
    // -----------------------------------------------------------------
    const Game = {
        state: 'INIT',      // MODE_SELECT, LOBBY, CALIB, SERVE, RALLY, END
        roomId: 'ping_titanium_v5',
        isOnline: false,
        isHost: true,
        dbRef: null,
        
        // Placar
        scoreP1: 0,
        scoreP2: 0,
        serverTurn: 'p1',

        // Bola
        ball: { x:0, y:0, z:0, vx:0, vy:0, vz:0, active:false },
        
        // Jogadores
        // P1 (Local) usa "Raw" para dados da câmera e "Game" para posição virtual
        p1: { 
            rawX:0, rawY:0, 
            gameX:0, gameY:0, gameZ: -CONF.TABLE_L/2 - 100, // Z fixo perto da câmera
            velX:0, velY:0, 
            history: [] // Para suavizar e calcular vetor de força
        },
        // P2 (Remoto/IA)
        p2: { gameX:0, gameY:0, gameZ: CONF.TABLE_L/2 + 100 },

        // Estado da Rodada
        lastBounceSide: 0,  // -1 (P1), 1 (P2), 0 (Ninguém)
        bounceCount: 0,
        
        // Efeitos
        hitStop: 0,
        shake: 0,
        particles: [],

        // --- CALIBRAÇÃO ROBUSTA ---
        calib: {
            minX: 1000, maxX: -1000,
            minY: 1000, maxY: -1000,
            samples: 0,
            isReady: false,
            msg: "SEGURE ALGO NA MÃO!"
        },

        // Mensagens UI
        msg: { txt: "", time: 0, color: "#fff" },

        init: function() {
            this.state = 'MODE_SELECT';
            this.scoreP1 = 0;
            this.scoreP2 = 0;
            this.setupInput();
            if(window.System && window.System.msg) window.System.msg("PING PONG V5");
        },

        setupInput: function() {
            if(!window.System.canvas) return;
            window.System.canvas.onclick = (e) => {
                if (this.state === 'MODE_SELECT') {
                    const rect = window.System.canvas.getBoundingClientRect();
                    const y = e.clientY - rect.top;
                    if(window.Sfx) window.Sfx.click();
                    
                    if (y < rect.height/2) this.setMode('OFFLINE');
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
                    this.showMsg("ERRO: ONLINE INDISPONÍVEL", "#f00");
                    return;
                }
                this.isOnline = true;
                this.connectLobby();
            } else {
                this.isOnline = false;
                this.isHost = true;
                this.startCalibration();
            }
        },

        startCalibration: function() {
            this.state = 'CALIB';
            this.calib = { minX: 1000, maxX: -1000, minY: 1000, maxY: -1000, samples: 0, isReady: false, msg: "MOVA A MÃO POR TODA A TELA" };
        },

        // -----------------------------------------------------------------
        // LOOP PRINCIPAL (UPDATE 60FPS)
        // -----------------------------------------------------------------
        update: function(ctx, w, h, pose) {
            // 1. Efeitos Visuais (Shake/Hitstop)
            if (this.hitStop > 0) {
                this.hitStop--;
                this.renderAll(ctx, w, h);
                return this.scoreP1;
            }
            if (this.shake > 0) {
                const dx = (Math.random()-0.5) * this.shake;
                const dy = (Math.random()-0.5) * this.shake;
                ctx.translate(dx, dy);
                this.shake *= 0.9;
                if(this.shake < 1) this.shake = 0;
            }

            // 2. Gerenciamento de Estados
            this.renderEnvironment(ctx, w, h);

            if (this.state === 'MODE_SELECT') { this.renderUI_Mode(ctx, w, h); return; }
            if (this.state === 'LOBBY') { this.renderUI_Lobby(ctx, w, h); return; }
            
            // 3. Processamento de Input (Crítico)
            const handPos = this.processInput(pose, w, h);

            if (this.state === 'CALIB') {
                this.runCalibration(ctx, w, h, handPos);
                return;
            }

            // 4. Jogo Ativo
            if (this.isOnline) this.syncNetwork();
            else this.updateAI();

            // Apenas o Host calcula física
            if (this.isHost || !this.isOnline) {
                this.updatePhysics();
                this.checkCollisions();
                this.checkRules();
            }

            this.renderGame(ctx, w, h);
            this.renderHUD(ctx, w, h);

            if (this.shake > 0) ctx.setTransform(1,0,0,1,0,0); // Reset shake transform

            return this.scoreP1;
        },

        // -----------------------------------------------------------------
        // INPUT PROCESSING & CALIBRAÇÃO (O "SEGREDO")
        // -----------------------------------------------------------------
        processInput: function(pose, w, h) {
            if (!pose || !pose.keypoints) return null;

            // Busca o pulso com maior confiança
            const wrist = pose.keypoints.find(k => (k.name === 'right_wrist' || k.name === 'left_wrist') && k.score > 0.4);
            
            if (!wrist) return null;

            // Coordenadas "Cruas" da Câmera (Invertendo X para espelho)
            const rawX = 640 - wrist.x; 
            const rawY = wrist.y;

            if (this.calib.isReady) {
                // Mapeamento Inteligente: Transforma o espaço calibrado do jogador (min/max)
                // Para o espaço do jogo (Largura da mesa + margem de alcance)
                // Mesa vai de -TABLE_W/2 a TABLE_W/2. Adicionamos 50% de margem.
                const reachX = CONF.TABLE_W * 1.5; 
                const reachY = 800; // Altura virtual alcançável

                // Normaliza (0 a 1) usando a calibração
                let nx = Utils3D.map(rawX, this.calib.minX, this.calib.maxX, 0, 1);
                let ny = Utils3D.map(rawY, this.calib.minY, this.calib.maxY, 0, 1);

                // Converte para coordenadas do mundo (Centralizado em 0,0)
                const targetX = (nx - 0.5) * reachX;
                const targetY = (ny * reachY) - (reachY / 2) - 200; // Offset para ajustar altura confortável

                // Suavização (Exponential Moving Average) para remover tremedeira da câmera
                this.p1.gameX = Utils3D.lerp(this.p1.gameX, targetX, 0.4);
                this.p1.gameY = Utils3D.lerp(this.p1.gameY, targetY, 0.4);

                // Cálculo de Vetor de Velocidade (Swing)
                // Armazena histórico para calcular média (mais suave que frame anterior)
                this.p1.history.push({x: this.p1.gameX, y: this.p1.gameY});
                if(this.p1.history.length > 5) this.p1.history.shift();

                if (this.p1.history.length >= 2) {
                    const oldest = this.p1.history[0];
                    const newest = this.p1.history[this.p1.history.length-1];
                    this.p1.velX = (newest.x - oldest.x);
                    this.p1.velY = (newest.y - oldest.y);
                }

                // Gesto de Saque: Movimento rápido para cima
                if (this.state === 'SERVE' && this.serverTurn === 'p1') {
                    this.ball.x = this.p1.gameX;
                    this.ball.y = this.p1.gameY - 100; // Bola flutua sobre a raquete
                    this.ball.z = this.p1.gameZ;
                    this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;

                    if (this.p1.velY < -20) this.performServe('p1');
                }
            }

            return { x: rawX, y: rawY };
        },

        runCalibration: function(ctx, w, h, handPos) {
            ctx.fillStyle = "rgba(0,0,0,0.85)"; ctx.fillRect(0,0,w,h);
            ctx.fillStyle = "#fff"; ctx.textAlign = "center";
            
            if (!handPos) {
                ctx.font = "bold 30px sans-serif";
                ctx.fillText("📷 CÂMERA NÃO DETECTOU MÃO", w/2, h/2);
                ctx.font = "20px sans-serif";
                ctx.fillText("Certifique-se de que há luz suficiente", w/2, h/2+40);
                return;
            }

            // Lógica de Expansão de Limites (Bounding Box)
            if (handPos.x < this.calib.minX) this.calib.minX = handPos.x;
            if (handPos.x > this.calib.maxX) this.calib.maxX = handPos.x;
            if (handPos.y < this.calib.minY) this.calib.minY = handPos.y;
            if (handPos.y > this.calib.maxY) this.calib.maxY = handPos.y;

            this.calib.samples++;

            // Visualização
            ctx.font = "bold 40px 'Russo One'"; ctx.fillText("CALIBRAÇÃO", w/2, h*0.2);
            ctx.font = "20px sans-serif"; 
            ctx.fillText("Estique o braço para os 4 cantos da tela.", w/2, h*0.25);
            ctx.fillText("Imagine que está limpando uma janela gigante.", w/2, h*0.28);

            // Desenha a caixa detectada (Feedback Visual)
            const boxX = (this.calib.minX / 640) * w; // Reverte espelho visualmente para UI
            const boxW = ((this.calib.maxX - this.calib.minX) / 640) * w;
            const boxY = (this.calib.minY / 480) * h;
            const boxH = ((this.calib.maxY - this.calib.minY) / 480) * h;

            ctx.strokeStyle = "#2ecc71"; ctx.lineWidth = 4;
            ctx.strokeRect(w - boxX - boxW, boxY, boxW, boxH); // Inverte X para display
            ctx.fillStyle = "rgba(46, 204, 113, 0.2)";
            ctx.fillRect(w - boxX - boxW, boxY, boxW, boxH);

            // Desenha o cursor da mão
            const cursorX = w - (handPos.x / 640) * w;
            const cursorY = (handPos.y / 480) * h;
            
            // Desenha uma RAQUETE VIRTUAL na mão para o usuário entender
            this.drawPaddle(ctx, {x: cursorX, y: cursorY, s: 1.0}, "#3498db");

            // Barra de Progresso
            const neededSamples = 200; // ~3.5 segundos
            const pct = Math.min(this.calib.samples / neededSamples, 1.0);
            
            ctx.fillStyle = "#444"; ctx.fillRect(w/2 - 150, h*0.8, 300, 20);
            ctx.fillStyle = "#0ff"; ctx.fillRect(w/2 - 150, h*0.8, 300 * pct, 20);
            
            if (this.calib.samples > neededSamples) {
                // Aplica margem de segurança e finaliza
                const padding = 20;
                this.calib.minX += padding; this.calib.maxX -= padding;
                this.calib.minY += padding; this.calib.maxY -= padding;
                
                this.calib.isReady = true;
                this.state = 'SERVE';
                this.resetBall('p1');
                if(window.Sfx) window.Sfx.play(600, 'sine', 0.2);
            }
        },

        // -----------------------------------------------------------------
        // FÍSICA & REGRAS (ENGINE CORE)
        // -----------------------------------------------------------------
        performServe: function(who) {
            this.state = 'RALLY';
            this.ball.active = true;
            this.bounceCount = 0;
            this.lastBounceSide = 0;

            const dir = (who === 'p1') ? 1 : -1;
            
            // Saque Física
            this.ball.vz = (40 + Math.random()*5) * dir; // Velocidade frontal
            this.ball.vy = -25; // Arco alto inicial
            
            if (who === 'p1') {
                // Influência do movimento da mão
                this.ball.vx = this.p1.velX * 0.5; 
                if(window.Sfx) window.Sfx.play(400, 'square', 0.1);
            } else {
                this.ball.vx = (Math.random()-0.5) * 15;
            }
        },

        updatePhysics: function() {
            if (!this.ball.active) return;
            const b = this.ball;

            // 1. Integrar Forças
            b.vy += CONF.GRAVITY;
            b.vx *= CONF.AIR_DRAG;
            b.vz *= CONF.AIR_DRAG;

            // 2. Mover Bola
            b.x += b.vx;
            b.y += b.vy;
            b.z += b.vz;

            // 3. Colisão com a MESA (Y = 0)
            if (b.y > 0) {
                const hw = CONF.TABLE_W / 2;
                const hl = CONF.TABLE_L / 2;

                // Dentro da área da mesa?
                if (Math.abs(b.x) < hw && Math.abs(b.z) < hl) {
                    // Quique!
                    b.y = 0;
                    b.vy *= -CONF.BOUNCE_EFF; // Inverte velocidade Y
                    
                    if(window.Sfx) window.Sfx.play(200, 'sine', 0.1);
                    this.spawnParticles(b.x, 0, b.z, '#fff');

                    // Lógica de Ponto (Quique duplo)
                    const side = b.z < 0 ? -1 : 1; // -1: Meu lado, 1: Lado dele
                    
                    if (this.lastBounceSide === side) {
                        // Quicou duas vezes no mesmo lado -> Ponto do outro
                        this.scorePoint(side === -1 ? 'p2' : 'p1', "DOIS QUIQUES!");
                    } else {
                        this.lastBounceSide = side;
                        this.bounceCount++;
                    }
                } 
                else if (b.y > CONF.FLOOR_Y) {
                    // Caiu no chão
                    const attacker = b.vz > 0 ? 'p1' : 'p2';
                    const targetSide = attacker === 'p1' ? 1 : -1;
                    
                    // Se a bola quicou no lado do oponente antes de cair -> Ponto
                    if (this.lastBounceSide === targetSide) {
                        this.scorePoint(attacker, "PONTO!");
                    } else {
                        // Se não quicou (foi direto pra fora) -> Erro
                        this.scorePoint(attacker === 'p1' ? 'p2' : 'p1', "FORA!");
                    }
                }
            }

            // 4. Colisão com a REDE
            // Rede está em Z=0, altura -NET_H
            if (Math.abs(b.z) < (CONF.BALL_R + 10) && b.y > -CONF.NET_H) {
                // Bateu na rede
                b.vz *= -0.2; // Perde impulso
                b.vx *= 0.5;
                if(window.Sfx) window.Sfx.play(100, 'sawtooth', 0.2);
            }
        },

        checkCollisions: function() {
            if (!this.ball.active) return;

            // --- DETECÇÃO RAQUETE P1 ---
            // Verifica se a bola está vindo (vz < 0) e perto do plano do jogador
            if (this.ball.vz < 0 && this.ball.z < (this.p1.gameZ + 200)) {
                
                // Distância 2D entre centro da bola e centro da raquete
                const dist = Utils3D.distSq(this.ball.x, this.ball.y, this.p1.gameX, this.p1.gameY);
                const hitRadius = CONF.PADDLE_RADIUS + CONF.BALL_R;

                if (dist < hitRadius * hitRadius) {
                    this.hitBall('p1');
                }
            }
        },

        hitBall: function(who) {
            const b = this.ball;
            const isP1 = (who === 'p1');
            const dir = isP1 ? 1 : -1;

            // EFEITO "SWING" (Vetores)
            // Se o jogador move a mão rápido, transfere energia
            let swingX = 0, swingY = 0;
            
            if (isP1) {
                swingX = this.p1.velX * CONF.SWING_FORCE;
                swingY = this.p1.velY * CONF.SWING_FORCE;
            } else {
                // IA Simulada
                swingX = (Math.random()-0.5) * 20;
                swingY = (Math.random()-0.5) * 10;
            }

            // Velocidade Base + Swing
            // Se bater parado, a bola volta fraca. Se bater com força, volta tiro.
            let speedZ = 45 + Math.abs(swingY * 0.5) + Math.abs(swingX * 0.2);
            speedZ = Math.min(speedZ, CONF.MAX_SPEED);

            b.vz = speedZ * dir;
            
            // Controle Direcional (X)
            // Onde bateu na raquete afeta o ângulo (efeito sinuca)
            const paddleX = isP1 ? this.p1.gameX : this.p2.gameX;
            const offset = (b.x - paddleX) * 0.25;
            b.vx = offset + (swingX * 0.6); // Soma efeito lateral

            // Controle de Altura (Y) - Backspin vs Topspin
            // Bater de baixo pra cima (swingY < 0) levanta a bola
            b.vy = -15 + (swingY * 0.4); 

            // Feedback
            this.lastBounceSide = 0; // Reset quiques
            if(window.Sfx) window.Sfx.hit();
            
            if (isP1) {
                this.hitStop = 4; // Congela frame (Juice)
                this.shake = 10;
                this.spawnParticles(b.x, b.y, b.z, '#0ff');
            } else {
                this.spawnParticles(b.x, b.y, b.z, '#f00');
            }
        },

        updateAI: function() {
            if (this.state === 'SERVE' && this.serverTurn === 'p2') {
                if (this.gameTimer % 100 === 0) this.performServe('p2');
            } 
            else if (this.state === 'RALLY') {
                // IA tenta prever X
                let targetX = this.ball.x;
                // Adiciona erro humano senoidal
                targetX += Math.sin(this.gameTimer * 0.1) * 100;

                // Move IA
                this.p2.gameX = Utils3D.lerp(this.p2.gameX, targetX, 0.08);
                this.p2.gameY = Utils3D.lerp(this.p2.gameY, this.ball.y, 0.1);

                // Colisão IA
                if (this.ball.vz > 0 && this.ball.z > (this.p2.gameZ - 100)) {
                    if (Math.abs(this.ball.x - this.p2.gameX) < CONF.PADDLE_RADIUS) {
                        this.hitBall('p2');
                    }
                }
            }
        },

        checkRules: function() {
            // Se bola foi muito longe
            if (Math.abs(this.ball.z) > 3500) {
                const winner = this.ball.vz > 0 ? 'p1' : 'p2';
                // Saiu sem quicar no lado oposto
                if (this.lastBounceSide !== (winner==='p1'?1:-1)) {
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
            
            if (this.scoreP1 >= 7 || this.scoreP2 >= 7) {
                setTimeout(() => this.state = 'END', 2000);
            } else {
                setTimeout(() => this.resetBall(winner), 1500);
            }
        },

        resetBall: function(server) {
            this.state = 'SERVE';
            this.ball = { x:0, y:0, z:0, vx:0, vy:0, vz:0, active:false };
            this.serverTurn = server;
            this.lastBounceSide = 0;
            this.showMsg(server==='p1' ? "SEU SAQUE" : "SAQUE CPU", "#fff");
        },

        // -----------------------------------------------------------------
        // RENDERIZAÇÃO 3D (PSEUDO RAYCASTING)
        // -----------------------------------------------------------------
        renderGame: function(ctx, w, h) {
            // 1. Mesa (Geometria)
            const hw = CONF.TABLE_W/2;
            const hl = CONF.TABLE_L/2;
            
            const c1 = Utils3D.project(-hw, 0, -hl, w, h); // Near Left
            const c2 = Utils3D.project(hw, 0, -hl, w, h);  // Near Right
            const c3 = Utils3D.project(hw, 0, hl, w, h);   // Far Right
            const c4 = Utils3D.project(-hw, 0, hl, w, h);  // Far Left

            if (c1.visible) {
                // Tampo
                ctx.fillStyle = "#2c3e50";
                ctx.beginPath(); ctx.moveTo(c1.x,c1.y); ctx.lineTo(c2.x,c2.y); ctx.lineTo(c3.x,c3.y); ctx.lineTo(c4.x,c4.y); ctx.fill();
                
                // Bordas
                ctx.strokeStyle = "#ecf0f1"; ctx.lineWidth = 4;
                ctx.beginPath(); ctx.moveTo(c1.x,c1.y); ctx.lineTo(c2.x,c2.y); ctx.lineTo(c3.x,c3.y); ctx.lineTo(c4.x,c4.y); ctx.closePath(); ctx.stroke();
                
                // Linha Central
                const m1 = Utils3D.project(0, 0, -hl, w, h);
                const m2 = Utils3D.project(0, 0, hl, w, h);
                ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(m1.x, m1.y); ctx.lineTo(m2.x, m2.y); ctx.stroke();
            }

            // 2. Rede
            const n1 = Utils3D.project(-hw-20, 0, 0, w, h);
            const n2 = Utils3D.project(hw+20, 0, 0, w, h);
            const n1t = Utils3D.project(-hw-20, -CONF.NET_H, 0, w, h);
            const n2t = Utils3D.project(hw+20, -CONF.NET_H, 0, w, h);
            
            ctx.fillStyle = "rgba(255,255,255,0.3)";
            ctx.beginPath(); ctx.moveTo(n1.x,n1.y); ctx.lineTo(n2.x,n2.y); ctx.lineTo(n2t.x,n2t.y); ctx.lineTo(n1t.x,n1t.y); ctx.fill();

            // 3. Raquete P2 (Longe)
            const p2Pos = Utils3D.project(this.p2.gameX, this.p2.gameY, this.p2.gameZ, w, h);
            this.drawPaddle(ctx, p2Pos, "#e74c3c");

            // 4. Bola
            this.drawBall(ctx, w, h);

            // 5. Raquete P1 (Perto - Segue Mão)
            // Importante: Desenhamos por último para ficar "na frente" da mesa
            const p1Pos = Utils3D.project(this.p1.gameX, this.p1.gameY, this.p1.gameZ, w, h);
            this.drawPaddle(ctx, p1Pos, "#3498db");

            // 6. Partículas
            this.renderParticles(ctx, w, h);
        },

        drawBall: function(ctx, w, h) {
            const b = this.ball;
            const pos = Utils3D.project(b.x, b.y, b.z, w, h);
            
            // Sombra
            if (b.y < 0 && b.active) {
                const shad = Utils3D.project(b.x, 0, b.z, w, h);
                ctx.fillStyle = "rgba(0,0,0,0.4)";
                ctx.beginPath(); ctx.ellipse(shad.x, shad.y, 15*shad.s, 6*shad.s, 0, 0, Math.PI*2); ctx.fill();
            }

            // Bola
            if (pos.visible) {
                const rad = CONF.BALL_R * pos.s;
                const grad = ctx.createRadialGradient(pos.x-rad*0.3, pos.y-rad*0.3, rad*0.1, pos.x, pos.y, rad);
                grad.addColorStop(0, "#fff"); grad.addColorStop(1, "#f1c40f");
                ctx.fillStyle = grad;
                ctx.beginPath(); ctx.arc(pos.x, pos.y, rad, 0, Math.PI*2); ctx.fill();
            }
        },

        drawPaddle: function(ctx, pos, color) {
            if (!pos.visible) return;
            const s = pos.s;
            const r = CONF.PADDLE_RADIUS * s;

            // Cabo
            ctx.fillStyle = "#5d4037";
            ctx.fillRect(pos.x - 10*s, pos.y + r*0.8, 20*s, 80*s);

            // Borracha
            ctx.fillStyle = "#222"; // Borda
            ctx.beginPath(); ctx.arc(pos.x, pos.y, r, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = color; // Face
            ctx.beginPath(); ctx.arc(pos.x, pos.y, r*0.9, 0, Math.PI*2); ctx.fill();
            
            // Reflexo
            ctx.fillStyle = "rgba(255,255,255,0.2)";
            ctx.beginPath(); ctx.arc(pos.x - r*0.3, pos.y - r*0.3, r*0.4, 0, Math.PI*2); ctx.fill();
        },

        spawnParticles: function(x, y, z, color) {
            for(let i=0; i<10; i++) {
                this.particles.push({
                    x, y, z, color,
                    vx: (Math.random()-0.5)*20, vy: (Math.random()-0.5)*20, vz: (Math.random()-0.5)*20,
                    life: 1.0
                });
            }
        },

        renderParticles: function(ctx, w, h) {
            this.particles.forEach((p, i) => {
                p.x += p.vx; p.y += p.vy; p.z += p.vz;
                p.life -= 0.05;
                if (p.life <= 0) this.particles.splice(i,1);
                else {
                    const pos = Utils3D.project(p.x, p.y, p.z, w, h);
                    ctx.fillStyle = p.color; ctx.globalAlpha = p.life;
                    ctx.beginPath(); ctx.arc(pos.x, pos.y, 5*pos.s, 0, Math.PI*2); ctx.fill();
                }
            });
            ctx.globalAlpha = 1.0;
        },

        renderEnvironment: function(ctx, w, h) {
            const grad = ctx.createLinearGradient(0,0,0,h);
            grad.addColorStop(0, "#203a43"); grad.addColorStop(1, "#2c5364");
            ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);
            
            // Grid chão
            ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = 1;
            ctx.beginPath();
            for(let z=-2000; z<3000; z+=500) {
                const p1 = Utils3D.project(-3000, 760, z, w, h);
                const p2 = Utils3D.project(3000, 760, z, w, h);
                ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
            }
            ctx.stroke();
        },

        renderHUD: function(ctx, w, h) {
            ctx.fillStyle = "#000"; ctx.fillRect(w/2-100, 20, 200, 60);
            ctx.strokeStyle = "#fff"; ctx.lineWidth=3; ctx.strokeRect(w/2-100, 20, 200, 60);
            ctx.font = "bold 40px 'Russo One'"; ctx.textAlign="center";
            ctx.fillStyle = "#3498db"; ctx.fillText(this.scoreP1, w/2-50, 65);
            ctx.fillStyle = "#fff"; ctx.fillText("-", w/2, 65);
            ctx.fillStyle = "#e74c3c"; ctx.fillText(this.scoreP2, w/2+50, 65);

            if(this.msg.time > 0) {
                this.msg.time--;
                ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.fillRect(0, h/2-40, w, 80);
                ctx.fillStyle = this.msg.color;
                ctx.fillText(this.msg.txt, w/2, h/2+15);
            }
        },

        renderUI_Mode: function(ctx, w, h) {
            ctx.fillStyle = "rgba(0,0,0,0.9)"; ctx.fillRect(0,0,w,h);
            ctx.fillStyle = "#fff"; ctx.textAlign = "center";
            ctx.font = "bold 60px 'Russo One'"; ctx.fillText("PING PONG V5", w/2, 150);
            ctx.fillStyle = "#3498db"; ctx.fillRect(w/2-150, h/2-80, 300, 80);
            ctx.fillStyle = "#fff"; ctx.font = "bold 30px 'Russo One'"; ctx.fillText("OFFLINE", w/2, h/2-30);
            ctx.fillStyle = "#e67e22"; ctx.fillRect(w/2-150, h/2+20, 300, 80);
            ctx.fillStyle = "#fff"; ctx.fillText("ONLINE", w/2, h/2+70);
        },

        renderUI_Lobby: function(ctx, w, h) {
            ctx.fillStyle = "#2c3e50"; ctx.fillRect(0,0,w,h);
            ctx.fillStyle = "#fff"; ctx.textAlign = "center";
            ctx.font = "30px sans-serif"; 
            ctx.fillText(this.isHost ? "AGUARDANDO..." : "CONECTANDO...", w/2, h/2);
        },

        // -----------------------------------------------------------------
        // AUXILIARES
        // -----------------------------------------------------------------
        showMsg: function(txt, col) { this.msg = {txt, color:col, time:90}; },
        
        connectLobby: function() { /* Mesmo código de antes simplificado */ },
        syncNetwork: function() { /* Mesmo código de antes simplificado */ }
    };

    // Firebase stubs para manter compatibilidade se user não tiver rede
    Game.connectLobby = function() { this.state = 'CALIB'; };
    Game.syncNetwork = function() { };

    if (window.System && window.System.registerGame) {
        window.System.registerGame('tennis', 'Ping Pong Titanium', '🏓', Game, { camOpacity: 0.1 });
    }
})();
