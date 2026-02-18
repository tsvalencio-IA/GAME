// =============================================================================
// TABLE TENNIS: PRO TOUR (V6 - PROFESSIONAL CALIBRATION & PHYSICS)
// ARQUITETO: SENIOR GAME DEV (EX-NINTENDO/KONAMI STYLE LOGIC)
// STATUS: CALIBRAÇÃO DE 2 PONTOS, FÍSICA DE VETORES, HUD PROFISSIONAL
// =============================================================================

(function() {
    "use strict";

    // -----------------------------------------------------------------
    // 1. CONFIGURAÇÕES GLOBAIS (FÍSICA REALISTA)
    // -----------------------------------------------------------------
    const CONF = {
        // Mesa Oficial (Escala Virtual)
        TABLE_W: 1525, 
        TABLE_L: 2740,
        NET_H: 152,
        
        // Física
        GRAVITY: 0.65,        // Gravidade "snappy" para reação rápida
        AIR_RESISTANCE: 0.99, // Arrasto aerodinâmico
        BOUNCE_FACTOR: 0.8,   // Restituição da mesa
        
        // Raquete & Jogador
        PADDLE_OFFSET_Z: 200, // Distância virtual da raquete em relação à câmera
        PADDLE_LENGTH: 150,   // Comprimento do "cabo" virtual (do pulso até o centro da raquete)
        HIT_RADIUS: 160,      // Área de contato
        SWING_POWER: 2.5,     // Multiplicador de força do braço
        
        // Sistema
        SMOOTHING: 0.4        // Fator de suavização (0.1 = muito suave/lento, 0.9 = cru/rápido)
    };

    // -----------------------------------------------------------------
    // 2. SISTEMA MATEMÁTICO (PROJEÇÃO & VETORES)
    // -----------------------------------------------------------------
    const Math3D = {
        // Projeta mundo 3D para tela 2D
        project: (x, y, z, w, h) => {
            const fov = 850;
            const camX = 0;
            const camY = -1600; // Câmera alta (visão TV)
            const camZ = -1400; // Câmera recuada
            
            const depth = (z - camZ);
            if (depth <= 0) return { x: -9999, y: -9999, s: 0, visible: false };

            const scale = fov / depth;
            return {
                x: (x * scale) + w/2,
                y: ((y - camY) * scale) + h/2,
                s: scale,
                visible: true
            };
        },

        // Mapeia valores de um intervalo para outro
        map: (v, iMin, iMax, oMin, oMax) => {
            return oMin + (oMax - oMin) * ((v - iMin) / (iMax - iMin));
        },

        lerp: (start, end, t) => start + (end - start) * t,
        
        distSq: (x1, y1, x2, y2) => (x1-x2)**2 + (y1-y2)**2
    };

    // -----------------------------------------------------------------
    // 3. CLASSE DO JOGO
    // -----------------------------------------------------------------
    const Game = {
        state: 'INIT',      // INIT -> CALIB_L -> CALIB_R -> MENU -> SERVE -> RALLY -> END
        
        // Dados do Jogador (P1)
        p1: { 
            // Posição bruta da câmera
            rawX: 0, rawY: 0,
            // Posição no mundo do jogo (Mesa)
            gameX: 0, gameY: 0, 
            // Vetores de movimento (Swing)
            velX: 0, velY: 0,
            // Histórico para suavização
            prevX: 0, prevY: 0
        },

        // Oponente (IA)
        p2: { gameX: 0, gameY: 0, speed: 0.1, error: 0 },

        // Bola
        ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, active: false },

        // Calibração (Limites da Câmera)
        calib: {
            minX: 0, minY: 0, // Canto Superior Esquerdo
            maxX: 0, maxY: 0, // Canto Inferior Direito
            timer: 0,
            samples: []
        },

        // Placar
        score: { p1: 0, p2: 0 },
        server: 'p1', // Quem saca
        
        // Estado da Rodada
        bounceSide: 0, // -1: P1, 1: P2
        bounceCount: 0,
        
        // Efeitos
        particles: [],
        shake: 0,
        msg: { txt: "", a: 0 }, // Texto flutuante

        // -----------------------------------------------------------------
        // INICIALIZAÇÃO
        // -----------------------------------------------------------------
        init: function() {
            this.state = 'INIT';
            this.score = { p1: 0, p2: 0 };
            this.server = 'p1';
            
            // Tenta recuperar calibração salva
            const savedCalib = localStorage.getItem('tennis_calib');
            if (savedCalib) {
                const c = JSON.parse(savedCalib);
                this.calib.minX = c.minX; this.calib.maxX = c.maxX;
                this.calib.minY = c.minY; this.calib.maxY = c.maxY;
                this.state = 'MENU'; // Pula calibração se já tem
            } else {
                this.state = 'CALIB_INTRO';
            }

            if(window.System && window.System.msg) window.System.msg("PING PONG PRO TOUR");
            
            // Clique para avançar nos menus
            if(window.System.canvas) {
                window.System.canvas.onclick = () => {
                    if (this.state === 'MENU') {
                        this.state = 'SERVE';
                        this.resetBall();
                    } else if (this.state === 'END') {
                        this.state = 'MENU';
                        this.score = { p1: 0, p2: 0 };
                    } else if (this.state === 'CALIB_INTRO') {
                        this.state = 'CALIB_TL'; // Inicia calibração Top-Left
                        this.calib.timer = 0;
                        this.calib.samples = [];
                    }
                };
            }
        },

        // -----------------------------------------------------------------
        // LOOP PRINCIPAL (UPDATE)
        // -----------------------------------------------------------------
        update: function(ctx, w, h, pose) {
            // 1. Processar Input da Câmera
            this.processInput(pose, w, h);

            // 2. Máquina de Estados
            switch (this.state) {
                case 'CALIB_INTRO': this.renderCalibIntro(ctx, w, h); break;
                case 'CALIB_TL':    this.processCalibrationStep(ctx, w, h, 'TL'); break;
                case 'CALIB_BR':    this.processCalibrationStep(ctx, w, h, 'BR'); break;
                case 'MENU':        this.renderMenu(ctx, w, h); break;
                case 'SERVE':       
                case 'RALLY':       
                    this.updateGameLogic();
                    this.renderGame(ctx, w, h);
                    break;
                case 'END':         this.renderEnd(ctx, w, h); break;
            }

            return this.score.p1;
        },

        // -----------------------------------------------------------------
        // INPUT E MAPA ESPACIAL (CRUCIAL PARA JOGABILIDADE)
        // -----------------------------------------------------------------
        processInput: function(pose, w, h) {
            if (!pose || !pose.keypoints) return;

            // Detecta pulso (Direita ou Esquerda)
            const wrist = pose.keypoints.find(k => (k.name === 'right_wrist' || k.name === 'left_wrist') && k.score > 0.4);
            
            if (wrist) {
                // Inverte X (Espelho) para ficar intuitivo
                const rawX = 640 - wrist.x; 
                const rawY = wrist.y;

                this.p1.rawX = rawX;
                this.p1.rawY = rawY;

                // Se já estiver calibrado, mapeia para a mesa
                if (this.state === 'SERVE' || this.state === 'RALLY' || this.state === 'MENU') {
                    // Mapeamento 1:1 da Calibração para o Mundo do Jogo
                    // Mesa Virtual X: -800 a 800 (Mais largo que a mesa real para alcance)
                    // Mesa Virtual Y: -400 a 500 (Altura)
                    
                    const normX = Math3D.map(rawX, this.calib.minX, this.calib.maxX, 0, 1);
                    const normY = Math3D.map(rawY, this.calib.minY, this.calib.maxY, 0, 1);

                    const targetX = Math3D.lerp(-CONF.TABLE_W * 0.8, CONF.TABLE_W * 0.8, normX);
                    const targetY = Math3D.lerp(-500, 600, normY) - CONF.PADDLE_LENGTH; // Offset do cabo

                    // Suavização
                    this.p1.gameX = Math3D.lerp(this.p1.gameX, targetX, CONF.SMOOTHING);
                    this.p1.gameY = Math3D.lerp(this.p1.gameY, targetY, CONF.SMOOTHING);

                    // Cálculo de Velocidade (Swing)
                    this.p1.velX = this.p1.gameX - this.p1.prevX;
                    this.p1.velY = this.p1.gameY - this.p1.prevY;

                    this.p1.prevX = this.p1.gameX;
                    this.p1.prevY = this.p1.gameY;
                }
            }
        },

        // -----------------------------------------------------------------
        // CALIBRAÇÃO PROFISSIONAL (2 PONTOS)
        // -----------------------------------------------------------------
        processCalibrationStep: function(ctx, w, h, step) {
            ctx.fillStyle = "#000"; ctx.fillRect(0,0,w,h);
            
            // Cursor da mão
            const cursorX = Math3D.map(this.p1.rawX, 0, 640, 0, w);
            const cursorY = Math3D.map(this.p1.rawY, 0, 480, 0, h);
            
            // Desenha Alvo
            const targetX = step === 'TL' ? 100 : w - 100;
            const targetY = step === 'TL' ? 100 : h - 100;
            
            ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(targetX, targetY, 40, 0, Math.PI*2); ctx.stroke();
            
            ctx.fillStyle = "#fff"; ctx.textAlign = "center";
            ctx.font = "bold 30px sans-serif";
            
            if (step === 'TL') {
                ctx.fillText("PASSO 1: CANTO SUPERIOR ESQUERDO", w/2, h/2 - 50);
                ctx.font = "20px sans-serif";
                ctx.fillText("Leve sua mão (com o objeto) até o alvo verde", w/2, h/2);
            } else {
                ctx.fillText("PASSO 2: CANTO INFERIOR DIREITO", w/2, h/2 - 50);
                ctx.font = "20px sans-serif";
                ctx.fillText("Agora vá até o canto oposto", w/2, h/2);
            }

            // Desenha cursor
            ctx.fillStyle = "#0ff"; ctx.beginPath(); ctx.arc(cursorX, cursorY, 15, 0, Math.PI*2); ctx.fill();

            // Verifica se está no alvo
            const dist = Math.hypot(cursorX - targetX, cursorY - targetY);
            if (dist < 60) {
                ctx.fillStyle = "rgba(46, 204, 113, 0.5)"; 
                ctx.beginPath(); ctx.arc(targetX, targetY, 50, 0, Math.PI*2); ctx.fill();
                
                this.calib.timer++;
                this.calib.samples.push({x: this.p1.rawX, y: this.p1.rawY});

                // Barra de progresso
                ctx.fillStyle = "#0f0"; ctx.fillRect(w/2 - 100, h*0.8, (this.calib.timer/60)*200, 20);
                ctx.strokeStyle = "#fff"; ctx.strokeRect(w/2 - 100, h*0.8, 200, 20);

                if (this.calib.timer > 60) { // 1 segundo segurando
                    // Média das amostras para precisão
                    const avgX = this.calib.samples.reduce((a,b)=>a+b.x,0) / this.calib.samples.length;
                    const avgY = this.calib.samples.reduce((a,b)=>a+b.y,0) / this.calib.samples.length;

                    if (step === 'TL') {
                        this.calib.minX = avgX;
                        this.calib.minY = avgY;
                        this.state = 'CALIB_BR';
                        this.calib.timer = 0;
                        this.calib.samples = [];
                        window.Sfx.play(600, 'sine', 0.2);
                    } else {
                        this.calib.maxX = avgX;
                        this.calib.maxY = avgY;
                        
                        // Salva e finaliza
                        localStorage.setItem('tennis_calib', JSON.stringify(this.calib));
                        this.state = 'MENU';
                        window.Sfx.play(800, 'square', 0.2);
                    }
                }
            } else {
                this.calib.timer = 0;
                this.calib.samples = [];
            }
        },

        renderCalibIntro: function(ctx, w, h) {
            ctx.fillStyle = "#111"; ctx.fillRect(0,0,w,h);
            ctx.fillStyle = "#fff"; ctx.textAlign = "center";
            ctx.font = "bold 40px sans-serif"; ctx.fillText("CALIBRAÇÃO", w/2, h*0.4);
            ctx.font = "24px sans-serif"; ctx.fillText("Segure um objeto (Raquete/Controle)", w/2, h*0.5);
            ctx.fillStyle = "#f1c40f"; ctx.fillText("CLIQUE PARA INICIAR", w/2, h*0.7);
        },

        // -----------------------------------------------------------------
        // LÓGICA DE JOGO (FÍSICA & IA)
        // -----------------------------------------------------------------
        updateGameLogic: function() {
            // Efeitos de Shake
            if (this.shake > 0) this.shake *= 0.9;

            if (this.state === 'SERVE' && this.server === 'p1') {
                // Bola segue a mão no saque
                this.ball.x = this.p1.gameX;
                this.ball.y = this.p1.gameY - 50; 
                this.ball.z = -CONF.TABLE_L/2 - 50;
                this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;

                // Gesto de Saque: Movimento rápido para cima (Toss)
                if (this.p1.velY < -15) {
                    this.performServe('p1');
                }
            } else if (this.state === 'SERVE' && this.server === 'p2') {
                // IA saca
                if (Math.random() < 0.02) this.performServe('p2');
                this.p2.gameX = 0; this.p2.gameY = -150;
            } else if (this.state === 'RALLY') {
                this.updatePhysics();
                this.updateAI();
                this.checkCollisions();
            }
        },

        performServe: function(who) {
            this.state = 'RALLY';
            this.ball.active = true;
            this.bounceCount = 0;
            this.bounceSide = 0; // 0 = ninguém tocou ainda

            const dir = who === 'p1' ? 1 : -1;
            
            // Saque Física
            this.ball.vz = (45 + Math.random()*5) * dir; 
            this.ball.vy = -18; // Arco
            
            if (who === 'p1') {
                this.ball.vx = this.p1.velX * 0.5; // Efeito lateral
                window.Sfx.play(400, 'square', 0.1);
            } else {
                this.ball.vx = (Math.random()-0.5) * 20;
            }
        },

        updatePhysics: function() {
            const b = this.ball;
            if (!b.active) return;

            // Integração de Verlet/Euler
            b.vy += CONF.GRAVITY;
            b.vx *= CONF.AIR_RESISTANCE;
            b.vz *= CONF.AIR_RESISTANCE;

            b.x += b.vx; b.y += b.vy; b.z += b.vz;

            // Mesa (Y=0)
            if (b.y > 0) {
                // Checa limites da mesa
                if (Math.abs(b.x) < CONF.TABLE_W/2 && Math.abs(b.z) < CONF.TABLE_L/2) {
                    // Quique
                    b.y = 0;
                    b.vy *= -CONF.BOUNCE_FACTOR;
                    window.Sfx.play(200, 'sine', 0.1);
                    this.createParticle(b.x, 0, b.z, '#fff');

                    const side = b.z < 0 ? -1 : 1;
                    if (side === this.bounceSide) {
                        // Dois quiques no mesmo lado = Ponto
                        this.scorePoint(side === -1 ? 'p2' : 'p1', "DOIS QUIQUES!");
                    } else {
                        this.bounceSide = side;
                        this.bounceCount++;
                    }
                } else if (b.y > 600) { // Chão
                    // Caiu fora
                    const attacker = b.vz > 0 ? 'p1' : 'p2';
                    const targetSide = attacker === 'p1' ? 1 : -1;
                    
                    if (this.bounceSide === targetSide) this.scorePoint(attacker, "PONTO!");
                    else this.scorePoint(attacker === 'p1' ? 'p2' : 'p1', "FORA!");
                }
            }

            // Rede
            if (Math.abs(b.z) < 20 && b.y > -CONF.NET_H) {
                b.vz *= -0.3; b.vx *= 0.5; // Bate e perde força
                window.Sfx.play(100, 'sawtooth', 0.2);
            }
        },

        checkCollisions: function() {
            // Raquete P1
            if (this.ball.vz < 0 && this.ball.z < (-CONF.TABLE_L/2 + 200)) {
                // Distância 3D Simplificada (Ignora Z fino para facilitar)
                const dx = this.ball.x - this.p1.gameX;
                const dy = this.ball.y - this.p1.gameY;
                const dist = Math.sqrt(dx*dx + dy*dy);

                if (dist < CONF.HIT_RADIUS) {
                    this.hitBall('p1');
                }
            }
        },

        hitBall: function(who) {
            const b = this.ball;
            const isP1 = who === 'p1';
            const dir = isP1 ? 1 : -1;

            // Swing Vector (A Mágica do "Feel")
            let swingX = 0, swingY = 0;
            if (isP1) {
                swingX = this.p1.velX * CONF.SWING_POWER;
                swingY = this.p1.velY * CONF.SWING_POWER;
            } else {
                swingX = (Math.random()-0.5) * 30; // IA Random
                swingY = (Math.random()-0.5) * 20;
            }

            // Física de Rebate
            // Velocidade Z (Profundidade)
            let speed = 50 + Math.abs(swingY * 0.6) + Math.abs(swingX * 0.3);
            b.vz = Math.min(speed, 90) * dir;

            // Direção X (Mirar nos cantos)
            // Onde bateu na raquete influencia o ângulo
            const paddleX = isP1 ? this.p1.gameX : this.p2.gameX;
            const hitOffset = (b.x - paddleX) * 0.3;
            b.vx = hitOffset + (swingX * 0.7);

            // Altura (Lift vs Cortada)
            b.vy = -20 + (swingY * 0.4); 

            // Feedback
            this.bounceSide = 0;
            window.Sfx.hit();
            this.createParticle(b.x, b.y, b.z, isP1 ? '#0ff' : '#f00');
            
            if (isP1) {
                this.shake = 10;
                if(window.navigator.vibrate) window.navigator.vibrate(50);
            }
        },

        updateAI: function() {
            // IA tenta seguir a bola
            let targetX = this.ball.x;
            targetX += Math.sin(Date.now() * 0.005) * 100; // Erro humano
            
            this.p2.gameX = Math3D.lerp(this.p2.gameX, targetX, 0.08);
            this.p2.gameY = Math3D.lerp(this.p2.gameY, this.ball.y, 0.1);

            // Colisão IA
            if (this.ball.vz > 0 && this.ball.z > (CONF.TABLE_L/2 - 100)) {
                const dist = Math.hypot(this.ball.x - this.p2.gameX, this.ball.y - this.p2.gameY);
                if (dist < CONF.HIT_RADIUS) this.hitBall('p2');
            }
        },

        scorePoint: function(winner, reason) {
            this.score[winner]++;
            this.msg = { txt: reason, a: 1.0 };
            this.ball.active = false;
            this.server = winner;
            
            if (this.score.p1 >= 7 || this.score.p2 >= 7) {
                setTimeout(() => this.state = 'END', 2000);
            } else {
                setTimeout(() => this.resetBall(), 1500);
            }
        },

        resetBall: function() {
            this.ball = { x:0, y:0, z:0, vx:0, vy:0, vz:0, active:false };
            this.bounceSide = 0;
            this.msg = { txt: this.server === 'p1' ? "SEU SAQUE" : "IA SACA", a: 1.0 };
        },

        // -----------------------------------------------------------------
        // RENDERIZAÇÃO 3D (VISUAL AAA)
        // -----------------------------------------------------------------
        renderGame: function(ctx, w, h) {
            // Fundo
            const grad = ctx.createLinearGradient(0,0,0,h);
            grad.addColorStop(0, "#2c3e50"); grad.addColorStop(1, "#000");
            ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);

            // Shake
            if (this.shake > 0) {
                ctx.save();
                ctx.translate((Math.random()-.5)*this.shake, (Math.random()-.5)*this.shake);
                this.shake *= 0.9;
            }

            // Mesa
            this.drawTable(ctx, w, h);

            // Raquete P2 (Longe)
            const posP2 = Math3D.project(-this.p2.gameX, this.p2.gameY, CONF.TABLE_L/2 + 200, w, h);
            this.drawPaddle(ctx, posP2, "#e74c3c", false);

            // Bola
            this.drawBall(ctx, w, h);

            // Raquete P1 (Perto) - Segue a mão do jogador
            const posP1 = Math3D.project(this.p1.gameX, this.p1.gameY, -CONF.TABLE_L/2 - 200, w, h);
            this.drawPaddle(ctx, posP1, "#3498db", true);

            // Partículas
            this.renderParticles(ctx, w, h);

            // HUD
            this.renderHUD(ctx, w, h);

            if (this.shake > 0) ctx.restore();
        },

        drawTable: function(ctx, w, h) {
            const hw = CONF.TABLE_W/2;
            const hl = CONF.TABLE_L/2;
            
            // Vértices da Mesa
            const p1 = Math3D.project(-hw, 0, -hl, w, h); // Near Left
            const p2 = Math3D.project(hw, 0, -hl, w, h);  // Near Right
            const p3 = Math3D.project(hw, 0, hl, w, h);   // Far Right
            const p4 = Math3D.project(-hw, 0, hl, w, h);  // Far Left

            if (!p1.visible) return;

            // Tampo
            ctx.fillStyle = "#2980b9";
            ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y); ctx.fill();
            
            // Bordas
            ctx.strokeStyle = "#fff"; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y); ctx.closePath(); ctx.stroke();

            // Rede
            const n1 = Math3D.project(-hw-20, 0, 0, w, h);
            const n2 = Math3D.project(hw+20, 0, 0, w, h);
            const n1t = Math3D.project(-hw-20, -CONF.NET_H, 0, w, h);
            const n2t = Math3D.project(hw+20, -CONF.NET_H, 0, w, h);
            
            ctx.fillStyle = "rgba(255,255,255,0.4)";
            ctx.beginPath(); ctx.moveTo(n1.x, n1.y); ctx.lineTo(n2.x, n2.y); ctx.lineTo(n2t.x, n2t.y); ctx.lineTo(n1t.x, n1t.y); ctx.fill();
        },

        drawBall: function(ctx, w, h) {
            const b = this.ball;
            const pos = Math3D.project(b.x, b.y, b.z, w, h);
            if (!pos.visible) return;

            // Sombra
            if (b.y < 0) {
                const shad = Math3D.project(b.x, 0, b.z, w, h);
                ctx.fillStyle = "rgba(0,0,0,0.4)";
                ctx.beginPath(); ctx.ellipse(shad.x, shad.y, 15*shad.s, 6*shad.s, 0, 0, Math.PI*2); ctx.fill();
            }

            // Bola
            const r = CONF.BALL_R * pos.s;
            const grad = ctx.createRadialGradient(pos.x-r*0.3, pos.y-r*0.3, r*0.1, pos.x, pos.y, r);
            grad.addColorStop(0, "#fff"); grad.addColorStop(1, "#f39c12");
            ctx.fillStyle = grad;
            ctx.beginPath(); ctx.arc(pos.x, pos.y, r, 0, Math.PI*2); ctx.fill();
        },

        drawPaddle: function(ctx, pos, color, isP1) {
            if (!pos.visible) return;
            const s = pos.s * 1.5;
            
            // Cabo (Segurando o objeto)
            ctx.fillStyle = "#8d6e63";
            ctx.fillRect(pos.x - 10*s, pos.y + 60*s, 20*s, 80*s);

            // Raquete
            ctx.fillStyle = "#222"; 
            ctx.beginPath(); ctx.arc(pos.x, pos.y, 70*s, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = color; 
            ctx.beginPath(); ctx.arc(pos.x, pos.y, 65*s, 0, Math.PI*2); ctx.fill();

            // Rastro de Swing (Motion Blur)
            if (isP1) {
                const speed = Math.hypot(this.p1.velX, this.p1.velY);
                if (speed > 8) {
                    ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = 10*s;
                    ctx.beginPath(); ctx.moveTo(pos.x, pos.y);
                    ctx.lineTo(pos.x - this.p1.velX*s*2, pos.y - this.p1.velY*s*2);
                    ctx.stroke();
                }
            }
        },

        renderHUD: function(ctx, w, h) {
            ctx.fillStyle = "#000"; ctx.fillRect(w/2-100, 20, 200, 60);
            ctx.strokeStyle = "#fff"; ctx.lineWidth=3; ctx.strokeRect(w/2-100, 20, 200, 60);
            
            ctx.font = "bold 40px 'Russo One'"; ctx.textAlign = "center";
            ctx.fillStyle = "#3498db"; ctx.fillText(this.score.p1, w/2-50, 65);
            ctx.fillStyle = "#fff"; ctx.fillText("-", w/2, 65);
            ctx.fillStyle = "#e74c3c"; ctx.fillText(this.score.p2, w/2+50, 65);

            // Mensagem Flutuante
            if (this.msg.a > 0) {
                this.msg.a -= 0.02;
                ctx.globalAlpha = this.msg.a;
                ctx.fillStyle = "#000"; ctx.fillRect(0, h/2-40, w, 80);
                ctx.fillStyle = "#fff"; ctx.fillText(this.msg.txt, w/2, h/2+15);
                ctx.globalAlpha = 1.0;
            }
        },

        renderMenu: function(ctx, w, h) {
            ctx.fillStyle = "rgba(0,0,0,0.9)"; ctx.fillRect(0,0,w,h);
            ctx.fillStyle = "#fff"; ctx.textAlign = "center";
            ctx.font = "bold 60px 'Russo One'"; ctx.fillText("PING PONG PRO", w/2, h*0.4);
            ctx.font = "30px sans-serif"; ctx.fillText("CLIQUE PARA JOGAR", w/2, h*0.6);
        },

        renderEnd: function(ctx, w, h) {
            ctx.fillStyle = "rgba(0,0,0,0.95)"; ctx.fillRect(0,0,w,h);
            const win = this.score.p1 > this.score.p2;
            ctx.fillStyle = win ? "#f1c40f" : "#e74c3c"; ctx.textAlign = "center";
            ctx.font = "bold 60px 'Russo One'"; ctx.fillText(win ? "VITÓRIA!" : "DERROTA", w/2, h*0.4);
            ctx.fillStyle = "#fff"; ctx.font = "30px sans-serif"; ctx.fillText("CLIQUE PARA REINICIAR", w/2, h*0.6);
        },

        createParticle: function(x, y, z, c) {
            for(let i=0; i<10; i++) this.particles.push({x,y,z,c, vx:(Math.random()-.5)*20, vy:(Math.random()-.5)*20, life:1});
        },
        renderParticles: function(ctx, w, h) {
            this.particles.forEach((p,i) => {
                p.x+=p.vx; p.y+=p.vy; p.life-=0.05;
                if(p.life<=0) this.particles.splice(i,1);
                else {
                    const pos = Math3D.project(p.x, p.y, p.z, w, h);
                    if(pos.visible) {
                        ctx.fillStyle=p.c; ctx.globalAlpha=p.life;
                        ctx.beginPath(); ctx.arc(pos.x, pos.y, 5*pos.s, 0, Math.PI*2); ctx.fill();
                    }
                }
            });
            ctx.globalAlpha = 1.0;
        }
    };

    if (window.System && window.System.registerGame) {
        window.System.registerGame('tennis', 'Table Tennis Pro', '🏓', Game, { camOpacity: 0.1 });
    }
})();
