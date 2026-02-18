// =============================================================================
// TABLE TENNIS: PRO TOUR (V6 - PROFESSIONAL SIMULATION LOGIC)
// ARQUITETO: SENIOR GAME DEV (PHYSICS & CV SPECIALIST)
// STATUS: CALIBRAÇÃO DE 2 PONTOS, FÍSICA DE SPIN, IA PREDITIVA
// =============================================================================

(function() {
    "use strict";

    // -----------------------------------------------------------------
    // 1. CONFIGURAÇÕES FÍSICAS (ESCALA REAL)
    // -----------------------------------------------------------------
    const CONF = {
        // Mesa Oficial (mm convertidos para unidades de jogo 1:1 aproximado)
        TABLE_W: 1525, 
        TABLE_L: 2740,
        NET_H: 152,
        NET_Z: 0,
        
        // Bola (40mm)
        BALL_R: 20,
        
        // Física
        GRAVITY: 0.55,        // Gravidade ajustada para 60FPS
        AIR_DRAG: 0.99,       // Resistência do ar
        TABLE_BOUNCE: 0.85,   // Restituição da mesa
        FLOOR_Y: 760,         // Altura do chão em relação à mesa (mesa é Y=0)
        
        // Raquete & Jogador
        PADDLE_OFFSET_Z: 300, // Distância Z da mão até a zona de impacto ideal
        PADDLE_LENGTH: 150,   // Distância do pulso ao centro da raquete
        HIT_RADIUS: 180,      // Área de hit (generosa para compensar falta de profundidade real)
        SWING_MULT: 2.2,      // Força do braço aplicada à bola
        MAX_SPEED: 85         // Velocidade terminal (km/h simulado)
    };

    // -----------------------------------------------------------------
    // 2. MOTOR MATEMÁTICO (3D PROJECTION & VECTORS)
    // -----------------------------------------------------------------
    const Math3D = {
        // Projeta Ponto 3D (World) -> 2D (Screen)
        project: (x, y, z, w, h) => {
            const fov = 850;
            const camX = 0;
            const camY = -1500; // Câmera alta (visão TV)
            const camZ = -1600; // Câmera recuada
            
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

        lerp: (start, end, t) => start + (end - start) * t,
        
        // Mapeamento linear preciso
        map: (val, inMin, inMax, outMin, outMax) => {
            return outMin + (outMax - outMin) * ((val - inMin) / (inMax - inMin));
        },

        distSq: (x1, y1, x2, y2) => (x1-x2)**2 + (y1-y2)**2
    };

    // -----------------------------------------------------------------
    // 3. ENGINE DO JOGO
    // -----------------------------------------------------------------
    const Game = {
        state: 'INIT', // INIT -> CALIB_L -> CALIB_R -> MENU -> SERVE -> RALLY -> END
        
        // Jogador (P1)
        p1: { 
            rawX: 0, rawY: 0,       // Input câmera
            gameX: 0, gameY: 0,     // Posição na mesa (World Coords)
            velX: 0, velY: 0,       // Vetor de velocidade (Swing)
            prevX: 0, prevY: 0,
            history: []             // Histórico para suavização de vetor
        },

        // Oponente (IA/Remote)
        p2: { gameX: 0, gameY: 0, gameZ: CONF.TABLE_L/2 + 200, targetX: 0 },

        // Bola
        ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spinY: 0, active: false },

        // Sistema de Calibração Profissional (2 Pontos)
        calib: {
            // Pontos de calibração (0.0 a 1.0 relativos à câmera)
            minX: 0, minY: 0, // Top-Left
            maxX: 1, maxY: 1, // Bottom-Right
            step: 0,
            timer: 0,
            samples: []
        },

        score: { p1: 0, p2: 0 },
        server: 'p1',
        
        // Regras
        bounceSide: 0, // -1 (P1), 1 (P2), 0 (Air)
        bounceCount: 0,
        
        // Efeitos
        particles: [],
        shake: 0,
        msg: { txt: "", a: 0 },

        // -----------------------------------------------------------------
        // INICIALIZAÇÃO
        // -----------------------------------------------------------------
        init: function() {
            this.state = 'INIT';
            this.score = { p1: 0, p2: 0 };
            
            // Carrega calibração anterior se existir
            const saved = localStorage.getItem('pingpong_calib_v6');
            if (saved) {
                try {
                    const c = JSON.parse(saved);
                    this.calib.minX = c.minX; this.calib.maxX = c.maxX;
                    this.calib.minY = c.minY; this.calib.maxY = c.maxY;
                    this.state = 'MENU';
                } catch(e) { this.state = 'CALIB_INTRO'; }
            } else {
                this.state = 'CALIB_INTRO';
            }

            if(window.System && window.System.msg) window.System.msg("PING PONG PRO");
            this.setupInput();
        },

        setupInput: function() {
            if(!window.System.canvas) return;
            window.System.canvas.onclick = (e) => {
                // Navegação simples por clique
                if (this.state === 'MENU') {
                    this.state = 'SERVE';
                    this.resetBall();
                } else if (this.state === 'END') {
                    this.init();
                } else if (this.state === 'CALIB_INTRO') {
                    this.state = 'CALIB_TL';
                    this.calib.timer = 0;
                    this.calib.samples = [];
                }
            };
        },

        // -----------------------------------------------------------------
        // GAME LOOP PRINCIPAL
        // -----------------------------------------------------------------
        update: function(ctx, w, h, pose) {
            // 1. Processar Visão Computacional
            this.processInput(pose, w, h);

            // 2. Máquina de Estados
            switch(this.state) {
                case 'CALIB_INTRO': this.renderCalibIntro(ctx, w, h); break;
                case 'CALIB_TL':    this.processCalibration(ctx, w, h, 'TL'); break;
                case 'CALIB_BR':    this.processCalibration(ctx, w, h, 'BR'); break;
                
                case 'MENU': 
                    this.renderEnvironment(ctx, w, h);
                    this.renderMenu(ctx, w, h); 
                    break;
                
                case 'SERVE':
                case 'RALLY':
                    // Lógica de Jogo
                    this.updateGameLogic();
                    // Renderização
                    this.renderEnvironment(ctx, w, h);
                    this.renderGame(ctx, w, h);
                    this.renderHUD(ctx, w, h);
                    break;
                    
                case 'END':
                    this.renderEnd(ctx, w, h);
                    break;
            }

            return this.score.p1;
        },

        // -----------------------------------------------------------------
        // INPUT & MAPA ESPACIAL (A LÓGICA DO JOGADOR)
        // -----------------------------------------------------------------
        processInput: function(pose, w, h) {
            if (!pose || !pose.keypoints) return;

            const wrist = pose.keypoints.find(k => (k.name === 'right_wrist' || k.name === 'left_wrist') && k.score > 0.4);
            
            if (wrist) {
                // Normaliza coordenadas da câmera (0 a 1)
                // Espelha X (1 - x) para movimento intuitivo
                const rawX = (1 - (wrist.x / 640)); 
                const rawY = (wrist.y / 480);

                this.p1.rawX = rawX;
                this.p1.rawY = rawY;

                // Mapeamento Calibrado (World Coordinates)
                if (this.state === 'SERVE' || this.state === 'RALLY' || this.state === 'MENU') {
                    
                    // Transforma input calibrado (0..1) para Espaço da Mesa (mm)
                    // Mesa vai de -W/2 a W/2. Adicionamos margem lateral (1.5x) para alcançar bolas difíceis
                    const normX = Math3D.map(rawX, this.calib.minX, this.calib.maxX, 0, 1);
                    const normY = Math3D.map(rawY, this.calib.minY, this.calib.maxY, 0, 1);

                    const targetX = Math3D.lerp(-CONF.TABLE_W * 0.8, CONF.TABLE_W * 0.8, normX);
                    // Altura: Mapeia movimento vertical para altura da raquete em relação à mesa
                    const targetY = Math3D.lerp(-400, 600, normY) - CONF.PADDLE_LENGTH;

                    // Suavização Exponencial (Filtro)
                    const smooth = 0.3; // Rápido
                    this.p1.gameX = Math3D.lerp(this.p1.gameX, targetX, smooth);
                    this.p1.gameY = Math3D.lerp(this.p1.gameY, targetY, smooth);

                    // Cálculo do Vetor Swing (Velocidade)
                    this.p1.velX = this.p1.gameX - this.p1.prevX;
                    this.p1.velY = this.p1.gameY - this.p1.prevY;

                    this.p1.prevX = this.p1.gameX;
                    this.p1.prevY = this.p1.gameY;
                }
            }
        },

        // -----------------------------------------------------------------
        // SISTEMA DE CALIBRAÇÃO (2 PONTOS)
        // -----------------------------------------------------------------
        processCalibration: function(ctx, w, h, step) {
            ctx.fillStyle = "#000"; ctx.fillRect(0,0,w,h);
            
            // Cursor
            const cx = this.p1.rawX * w;
            const cy = this.p1.rawY * h;
            
            // Alvo
            const tx = step === 'TL' ? 100 : w - 100;
            const ty = step === 'TL' ? 100 : h - 100;
            
            // Instruções
            ctx.fillStyle = "#fff"; ctx.textAlign = "center";
            ctx.font = "bold 30px sans-serif";
            if (step === 'TL') {
                ctx.fillText("PASSO 1: CANTO SUPERIOR ESQUERDO", w/2, h/2 - 50);
                ctx.font = "20px sans-serif";
                ctx.fillText("Leve o objeto na mão até o alvo verde", w/2, h/2);
            } else {
                ctx.fillText("PASSO 2: CANTO INFERIOR DIREITO", w/2, h/2 - 50);
                ctx.font = "20px sans-serif";
                ctx.fillText("Agora vá até o canto oposto", w/2, h/2);
            }

            // Desenha Alvo
            ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(tx, ty, 40, 0, Math.PI*2); ctx.stroke();

            // Desenha Cursor
            ctx.fillStyle = "#0ff"; ctx.beginPath(); ctx.arc(cx, cy, 15, 0, Math.PI*2); ctx.fill();

            // Detecta "Hold"
            const dist = Math.hypot(cx - tx, cy - ty);
            if (dist < 60) {
                ctx.fillStyle = "rgba(46, 204, 113, 0.5)"; 
                ctx.beginPath(); ctx.arc(tx, ty, 50, 0, Math.PI*2); ctx.fill();
                
                this.calib.timer++;
                this.calib.samples.push({x: this.p1.rawX, y: this.p1.rawY});

                // Barra
                ctx.fillStyle = "#0f0"; ctx.fillRect(w/2 - 100, h*0.8, (this.calib.timer/60)*200, 20);
                
                if (this.calib.timer > 60) { // 1 segundo
                    // Média das amostras para estabilidade
                    const avgX = this.calib.samples.reduce((a,b)=>a+b.x,0)/this.calib.samples.length;
                    const avgY = this.calib.samples.reduce((a,b)=>a+b.y,0)/this.calib.samples.length;

                    if (step === 'TL') {
                        this.calib.minX = avgX; this.calib.minY = avgY;
                        this.state = 'CALIB_BR';
                        this.calib.timer = 0;
                        this.calib.samples = [];
                        window.Sfx.play(600, 'sine', 0.1);
                    } else {
                        this.calib.maxX = avgX; this.calib.maxY = avgY;
                        localStorage.setItem('pingpong_calib_v6', JSON.stringify(this.calib));
                        this.state = 'MENU';
                        window.Sfx.play(800, 'square', 0.1);
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
            ctx.font = "24px sans-serif"; 
            ctx.fillText("Para jogar profissionalmente, pegue uma raquete ou objeto.", w/2, h*0.5);
            ctx.fillStyle = "#f1c40f"; ctx.fillText("CLIQUE PARA INICIAR", w/2, h*0.7);
        },

        // -----------------------------------------------------------------
        // LÓGICA DE JOGO (FÍSICA REAL)
        // -----------------------------------------------------------------
        updateGameLogic: function() {
            // Saque
            if (this.state === 'SERVE') {
                if (this.server === 'p1') {
                    // Bola na mão do P1
                    this.ball.x = this.p1.gameX;
                    this.ball.y = this.p1.gameY - 50;
                    this.ball.z = -CONF.TABLE_L/2 - 100;
                    this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;

                    // Toss (Lançar a bola para cima para sacar)
                    if (this.p1.velY < -15) { 
                        this.serveBall('p1');
                    }
                } else {
                    // IA Saca
                    if (Math.random() < 0.02) this.serveBall('p2');
                }
            } 
            else if (this.state === 'RALLY') {
                this.updatePhysics();
                this.updateAI();
                this.checkCollisions();
            }
        },

        serveBall: function(who) {
            this.state = 'RALLY';
            this.ball.active = true;
            this.bounceCount = 0;
            this.bounceSide = 0;

            const dir = who === 'p1' ? 1 : -1;
            
            // Saque consistente mas desafiador
            this.ball.vz = (45 + Math.random()*5) * dir;
            this.ball.vy = -18; // Arco
            this.ball.vx = (who==='p1') ? this.p1.velX * 0.5 : (Math.random()-0.5)*20;
            
            window.Sfx.play(400, 'square', 0.1);
        },

        updatePhysics: function() {
            if (!this.ball.active) return;
            const b = this.ball;

            // Gravidade e Arrasto
            b.vy += CONF.GRAVITY;
            b.vx *= CONF.AIR_DRAG;
            b.vz *= CONF.AIR_DRAG;

            b.x += b.vx; b.y += b.vy; b.z += b.vz;

            // 1. Colisão com Mesa
            if (b.y > 0) {
                const hw = CONF.TABLE_W/2;
                const hl = CONF.TABLE_L/2;

                // Dentro da Mesa
                if (Math.abs(b.x) < hw && Math.abs(b.z) < hl) {
                    b.y = 0;
                    b.vy *= -CONF.TABLE_BOUNCE;
                    window.Sfx.play(200, 'sine', 0.1);
                    this.spawnParticles(b.x, 0, b.z, '#fff');

                    // Regra: Quique
                    const side = b.z < 0 ? -1 : 1; 
                    if (side === this.bounceSide) {
                        this.scorePoint(side === -1 ? 'p2' : 'p1', "DOIS QUIQUES!");
                    } else {
                        this.bounceSide = side;
                        this.bounceCount++;
                    }
                } 
                // Fora da Mesa (Chão)
                else if (b.y > CONF.FLOOR_Y) {
                    const attacker = b.vz > 0 ? 'p1' : 'p2';
                    const targetSide = attacker === 'p1' ? 1 : -1;
                    
                    if (this.bounceSide === targetSide) {
                        this.scorePoint(attacker, "PONTO!");
                    } else {
                        this.scorePoint(attacker === 'p1' ? 'p2' : 'p1', "FORA!");
                    }
                }
            }

            // 2. Colisão com Rede
            if (Math.abs(b.z) < 10 && b.y > -CONF.NET_H) {
                b.vz *= -0.3; // Perde força
                b.vx *= 0.5;
                window.Sfx.play(150, 'sawtooth', 0.2);
            }
        },

        checkCollisions: function() {
            if (!this.ball.active) return;

            // --- Colisão P1 (Física de Swing) ---
            // Verifica se a bola cruza o plano da raquete P1
            // Raquete P1 está em Z ~ -TABLE_L/2 - 100
            const p1Z = -CONF.TABLE_L/2 - 100;
            
            // Se bola vem na direção do P1 e está perto
            if (this.ball.vz < 0 && this.ball.z < p1Z + 200 && this.ball.z > p1Z - 200) {
                
                // Distância entre bola e raquete
                const dist = Math3D.distSq(this.ball.x, this.ball.y, this.p1.gameX, this.p1.gameY);
                
                if (dist < CONF.HIT_RADIUS * CONF.HIT_RADIUS) {
                    this.hitBall('p1');
                }
            }
        },

        hitBall: function(who) {
            const b = this.ball;
            const isP1 = who === 'p1';
            const dir = isP1 ? 1 : -1;

            // VETOR DE SWING REAL
            let swingX = 0, swingY = 0;
            if (isP1) {
                swingX = this.p1.velX * CONF.SWING_MULT;
                swingY = this.p1.velY * CONF.SWING_MULT;
            } else {
                swingX = (Math.random()-0.5)*30; // IA
                swingY = (Math.random()-0.5)*20;
            }

            // A força do golpe define a velocidade de retorno
            // Velocidade mínima de bloqueio + força do braço
            let speedZ = 50 + (Math.abs(swingY) * 0.5) + (Math.abs(swingX) * 0.3);
            speedZ = Math.min(speedZ, CONF.MAX_SPEED);

            b.vz = speedZ * dir;

            // Efeito Direcional (Onde bateu na raquete + Movimento lateral)
            const paddleX = isP1 ? this.p1.gameX : this.p2.gameX;
            const hitOffset = (b.x - paddleX) * 0.3; // Efeito "Sinuca"
            b.vx = hitOffset + (swingX * 0.6);

            // Topspin vs Backspin (Altura)
            // Se bater subindo (velY < 0), levanta a bola. Se descer, corta.
            b.vy = -18 + (swingY * 0.4);

            this.bounceSide = 0; // Reset para voo
            window.Sfx.hit();
            this.spawnParticles(b.x, b.y, b.z, isP1 ? '#0ff' : '#f00');
            
            if (isP1) this.shake = 10;
        },

        updateAI: function() {
            if (this.state === 'RALLY') {
                // IA tenta prever onde a bola vai estar em Z = P2_Z
                let targetX = this.ball.x;
                
                // Adiciona erro humano
                targetX += Math.sin(Date.now()*0.003) * 100;

                this.p2.gameX = Math3D.lerp(this.p2.gameX, targetX, 0.08);
                this.p2.gameY = Math3D.lerp(this.p2.gameY, this.ball.y, 0.1);

                // Colisão IA
                if (this.ball.vz > 0 && this.ball.z > (this.p2.gameZ - 100)) {
                    const dist = Math3D.distSq(this.ball.x, this.ball.y, this.p2.gameX, this.p2.gameY);
                    if (dist < CONF.HIT_RADIUS**2) this.hitBall('p2');
                }
            }
        },

        scorePoint: function(winner, txt) {
            this.score[winner]++;
            this.msg = { txt: txt, a: 1.0 };
            this.ball.active = false;
            this.server = winner;
            
            if (this.score.p1 >= 11 || this.score.p2 >= 11) {
                setTimeout(() => this.state = 'END', 2000);
            } else {
                setTimeout(() => this.resetBall(), 1500);
            }
        },

        resetBall: function() {
            this.state = 'SERVE';
            this.ball = { x:0, y:0, z:0, vx:0, vy:0, vz:0, active:false };
            this.bounceSide = 0;
            this.msg = { txt: this.server === 'p1' ? "SEU SAQUE" : "IA SACA", a: 1.0 };
        },

        // -----------------------------------------------------------------
        // RENDERIZAÇÃO 3D (VISUAL STYLE)
        // -----------------------------------------------------------------
        renderEnvironment: function(ctx, w, h) {
            // Fundo Pro
            const grad = ctx.createRadialGradient(w/2, h/2, 100, w/2, h/2, w);
            grad.addColorStop(0, "#2c3e50"); grad.addColorStop(1, "#000");
            ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);

            // Grid Chão
            ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth=1;
            ctx.beginPath();
            for(let i=-3000; i<3000; i+=500) {
                let p1 = Math3D.project(i, 800, -3000, w, h);
                let p2 = Math3D.project(i, 800, 3000, w, h);
                ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
            }
            ctx.stroke();
        },

        renderGame: function(ctx, w, h) {
            // Efeito Shake
            if (this.shake > 0) {
                ctx.save();
                ctx.translate((Math.random()-.5)*this.shake, (Math.random()-.5)*this.shake);
                this.shake *= 0.9;
            }

            // Mesa
            const hw = CONF.TABLE_W/2, hl = CONF.TABLE_L/2;
            const c1 = Math3D.project(-hw, 0, -hl, w, h);
            const c2 = Math3D.project(hw, 0, -hl, w, h);
            const c3 = Math3D.project(hw, 0, hl, w, h);
            const c4 = Math3D.project(-hw, 0, hl, w, h);

            // Tampo Azul
            ctx.fillStyle = "#2980b9";
            ctx.beginPath(); ctx.moveTo(c1.x,c1.y); ctx.lineTo(c2.x,c2.y); ctx.lineTo(c3.x,c3.y); ctx.lineTo(c4.x,c4.y); ctx.fill();
            ctx.strokeStyle = "#fff"; ctx.lineWidth=4; ctx.stroke();

            // Rede
            const n1 = Math3D.project(-hw-20, 0, 0, w, h);
            const n2 = Math3D.project(hw+20, 0, 0, w, h);
            const n1t = Math3D.project(-hw-20, -CONF.NET_H, 0, w, h);
            const n2t = Math3D.project(hw+20, -CONF.NET_H, 0, w, h);
            ctx.fillStyle="rgba(255,255,255,0.3)"; ctx.beginPath();
            ctx.moveTo(n1.x,n1.y); ctx.lineTo(n2.x,n2.y); ctx.lineTo(n2t.x,n2t.y); ctx.lineTo(n1t.x,n1t.y); ctx.fill();

            // P2 Paddle (Longe)
            const posP2 = Math3D.project(-this.p2.gameX, this.p2.gameY, this.p2.gameZ, w, h);
            this.drawPaddle(ctx, posP2, "#e74c3c", false);

            // Bola (com Sombra)
            const b = this.ball;
            if (b.y < 0) {
                const shad = Math3D.project(b.x, 0, b.z, w, h);
                ctx.fillStyle="rgba(0,0,0,0.4)"; ctx.beginPath(); ctx.ellipse(shad.x, shad.y, 15*shad.s, 6*shad.s, 0, 0, Math.PI*2); ctx.fill();
            }
            const posB = Math3D.project(b.x, b.y, b.z, w, h);
            if (posB.visible) {
                const r = CONF.BALL_R * posB.s;
                const g = ctx.createRadialGradient(posB.x-r*0.3, posB.y-r*0.3, r*0.1, posB.x, posB.y, r);
                g.addColorStop(0,"#fff"); g.addColorStop(1,"#f39c12");
                ctx.fillStyle=g; ctx.beginPath(); ctx.arc(posB.x, posB.y, r, 0, Math.PI*2); ctx.fill();
            }

            // P1 Paddle (Perto) - Segue a mão
            const posP1 = Math3D.project(this.p1.gameX, this.p1.gameY, -CONF.TABLE_L/2 - 100, w, h);
            this.drawPaddle(ctx, posP1, "#3498db", true);

            // Partículas
            this.particles.forEach((p,i) => {
                p.x+=p.vx; p.y+=p.vy; p.z+=p.vz; p.life-=0.05;
                if(p.life<=0) this.particles.splice(i,1);
                else {
                    const pp = Math3D.project(p.x, p.y, p.z, w, h);
                    if(pp.visible) {
                        ctx.fillStyle=p.c; ctx.globalAlpha=p.life;
                        ctx.beginPath(); ctx.arc(pp.x, pp.y, 4*pp.s, 0, Math.PI*2); ctx.fill();
                    }
                }
            });
            ctx.globalAlpha = 1.0;

            if (this.shake > 0) ctx.restore();
        },

        drawPaddle: function(ctx, pos, col, isP1) {
            if (!pos.visible) return;
            const s = pos.s * 1.5;
            
            // Cabo
            ctx.fillStyle="#8d6e63"; ctx.fillRect(pos.x-10*s, pos.y+50*s, 20*s, 70*s);
            // Face
            ctx.fillStyle="#222"; ctx.beginPath(); ctx.arc(pos.x, pos.y, 65*s, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle=col; ctx.beginPath(); ctx.arc(pos.x, pos.y, 60*s, 0, Math.PI*2); ctx.fill();
            
            // Swing Trail
            if (isP1 && Math.hypot(this.p1.velX, this.p1.velY) > 8) {
                ctx.strokeStyle="rgba(255,255,255,0.3)"; ctx.lineWidth=8*s;
                ctx.beginPath(); ctx.moveTo(pos.x, pos.y);
                ctx.lineTo(pos.x - this.p1.velX*s*2, pos.y - this.p1.velY*s*2);
                ctx.stroke();
            }
        },

        renderHUD: function(ctx, w, h) {
            ctx.fillStyle="#000"; ctx.fillRect(w/2-100, 20, 200, 60);
            ctx.strokeStyle="#fff"; ctx.lineWidth=3; ctx.strokeRect(w/2-100, 20, 200, 60);
            ctx.font="bold 40px 'Russo One'"; ctx.textAlign="center";
            ctx.fillStyle="#3498db"; ctx.fillText(this.score.p1, w/2-50, 65);
            ctx.fillStyle="#fff"; ctx.fillText("-", w/2, 65);
            ctx.fillStyle="#e74c3c"; ctx.fillText(this.score.p2, w/2+50, 65);

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

        spawnParticles: function(x, y, z, c) {
            for(let i=0; i<10; i++) this.particles.push({x,y,z,c, vx:(Math.random()-.5)*20, vy:(Math.random()-.5)*20, vz:(Math.random()-.5)*20, life:1});
        },
        resetBall: function() {
            this.ball = { x:0, y:0, z:0, vx:0, vy:0, vz:0, active:false };
            this.bounceSide = 0;
            this.msg = { txt: this.server === 'p1' ? "SEU SAQUE (Levante para sacar)" : "IA SACA", a: 1.0 };
        }
    };

    if (window.System && window.System.registerGame) {
        window.System.registerGame('tennis', 'Table Tennis Pro', '🏓', Game, { camOpacity: 0.1 });
    }
})();
