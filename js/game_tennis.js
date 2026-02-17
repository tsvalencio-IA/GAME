// =============================================================================
// TABLE TENNIS PRO: REALISTIC PHYSICS & SWING SYSTEM
// ARQUITETO: SENIOR DEV (V4 - SIMULATION UPDATE)
// =============================================================================

(function() {
    "use strict";

    const CONF = {
        TABLE_W: 1525,      // Largura oficial (mm)
        TABLE_L: 2740,      // Comprimento oficial (mm)
        NET_H: 152,         // Altura rede (mm)
        BALL_R: 40,         // Raio visual bola
        GRAVITY: 0.18,      // Gravidade simulada
        AIR_RESISTANCE: 0.995,
        BOUNCE_DAMPING: 0.85,
        PADDLE_SIZE: 120,
        SWING_POWER: 1.8,   // Multiplicador de força do movimento
        MAX_SPEED: 45
    };

    const SafeUtils = {
        project: (x, y, z, w, h) => {
            const fov = 800;
            const scale = fov / (fov + z);
            return {
                x: w/2 + x * scale,
                y: h/2 + y * scale,
                s: scale
            };
        }
    };

    const Logic = {
        state: 'MENU', // MENU, SERVE, RALLY, END
        scorePlayer: 0,
        scoreCPU: 0,
        
        // Física da Bola
        ball: { x: 0, y: -400, z: 0, vx: 0, vy: 0, vz: 0 },
        isBallInPlay: false,
        lastHitter: null, // 'player' ou 'cpu'
        bounceCount: 0,   // Quantas vezes quicou no lado atual

        // Jogador (Input)
        hand: { x: 0, y: 0 },
        prevHand: { x: 0, y: 0 },
        handVel: { x: 0, y: 0 },
        calibration: { cx: 0, cy: 0, scale: 4.0 },
        
        // IA
        cpu: { x: 0, y: -100, z: CONF.TABLE_L + 200, tx: 0, speed: 8 },

        // Visual
        particles: [],
        msgTimer: 0,
        msgText: "",

        init: function() {
            this.state = 'MENU';
            this.scorePlayer = 0;
            this.scoreCPU = 0;
            this.resetRound(true);
            window.System.msg("TABLE TENNIS PRO");
        },

        resetRound: function(playerServe) {
            this.isBallInPlay = false;
            this.bounceCount = 0;
            this.lastHitter = null;
            
            // Posiciona bola para saque
            if (playerServe) {
                this.state = 'SERVE';
                this.ball = { x: 0, y: -300, z: 100, vx: 0, vy: 0, vz: 0 };
                this.showMessage("SEU SAQUE! LEVANTE A MÃO");
            } else {
                this.state = 'RALLY'; // CPU saca auto
                this.ball = { x: 0, y: -300, z: CONF.TABLE_L, vx: (Math.random()-0.5)*10, vy: 12, vz: -18 };
                this.lastHitter = 'cpu';
            }
        },

        update: function(ctx, w, h, pose) {
            // 1. INPUT HANDLING
            this.processInput(pose, w, h);

            if (this.state === 'MENU') { this.renderMenu(ctx, w, h); return 0; }
            if (this.state === 'CALIBRATION') { this.renderCalibration(ctx, w, h); return 0; }

            // 2. LOGIC & PHYSICS
            if (this.state === 'SERVE') {
                // Bola segue a mão no saque
                this.ball.x += (this.hand.x - this.ball.x) * 0.2;
                this.ball.y = -350; // Altura fixa
                this.ball.z = 100;
                
                // Gatilho de saque: Movimento rápido para frente (ou para cima visualmente)
                // Simplificação: Se a mão subir rápido ou "bater", lança a bola
                if (Math.abs(this.handVel.y) > 15 || Math.abs(this.handVel.x) > 15) {
                    this.serveBall();
                }
            }
            else if (this.state === 'RALLY') {
                this.updatePhysics();
                this.updateAI();
                this.checkCollisions();
            }

            // 3. RENDER
            this.renderWorld(ctx, w, h);
            this.renderUI(ctx, w, h);

            return this.scorePlayer;
        },

        processInput: function(pose, w, h) {
            if (pose && pose.keypoints) {
                const wrist = pose.keypoints.find(k => k.name === 'right_wrist' && k.score > 0.3) 
                           || pose.keypoints.find(k => k.name === 'left_wrist' && k.score > 0.3);
                
                if (wrist) {
                    // Mapeamento Raw
                    const rawX = (1 - wrist.x/640) * w;
                    const rawY = (wrist.y/480) * h;

                    if (this.state === 'CALIBRATION') {
                        this.calibration.cx = rawX;
                        this.calibration.cy = rawY;
                        return;
                    }

                    // Aplica calibração
                    const targetX = (rawX - this.calibration.cx) * this.calibration.scale;
                    const targetY = (rawY - this.calibration.cy) * (this.calibration.scale * 0.8) - 200;

                    // Suavização (Lerp)
                    this.prevHand = { ...this.hand };
                    this.hand.x += (targetX - this.hand.x) * 0.3;
                    this.hand.y += (targetY - this.hand.y) * 0.3;

                    // Calcula velocidade do "Swing"
                    this.handVel.x = (this.hand.x - this.prevHand.x);
                    this.handVel.y = (this.hand.y - this.prevHand.y);
                }
            }
        },

        serveBall: function() {
            this.state = 'RALLY';
            this.isBallInPlay = true;
            this.lastHitter = 'player';
            this.bounceCount = 0;
            
            // Física baseada no movimento do saque
            this.ball.vx = this.handVel.x * 0.5;
            this.ball.vy = -10; // Leve arco para cima
            this.ball.vz = 15 + Math.abs(this.handVel.y * 0.5); // Velocidade para frente
            
            window.Sfx.play(400, 'square', 0.1);
        },

        updatePhysics: function() {
            const b = this.ball;

            // Gravidade
            b.vy += CONF.GRAVITY;
            
            // Resistência do Ar
            b.vx *= CONF.AIR_RESISTANCE;
            b.vz *= CONF.AIR_RESISTANCE;

            // Movimento
            b.x += b.vx;
            b.y += b.vy;
            b.z += b.vz;

            // --- COLISÃO COM A MESA ---
            // A mesa está em Y = 0 (teoricamente). Vamos considerar Y > 0 como impacto.
            // Z range: 0 a TABLE_L. X range: -TABLE_W/2 a TABLE_W/2
            
            if (b.y > 0) { // Tocou o nível da mesa
                const halfW = CONF.TABLE_W / 2;
                const inTableX = b.x > -halfW && b.x < halfW;
                const inTableZ = b.z > 0 && b.z < CONF.TABLE_L;

                if (inTableX && inTableZ) {
                    // QUIQUE VÁLIDO
                    b.y = 0;
                    b.vy *= -CONF.BOUNCE_DAMPING;
                    this.bounceCount++;
                    window.Sfx.play(200, 'sine', 0.05);
                    this.spawnParticles(b.x, 0, b.z, '#fff', 3);

                    // Regras de Ponto (Básico)
                    // Se quicou 2 vezes no mesmo lado ou quicou no lado errado sem passar a rede...
                    // Para simplificar a simulação:
                    // Se quicou no lado do oponente (Z > L/2) e lastHitter foi player -> OK
                } else {
                    // CAIU FORA (CHÃO)
                    if (b.y > 400) { // Chão visual
                        this.resolvePoint(false); // Bola morreu
                    }
                }
            }

            // --- REDE ---
            // Z = TABLE_L / 2. Altura = -NET_H
            const netZ = CONF.TABLE_L / 2;
            if (Math.abs(b.z - netZ) < 20 && b.y > -CONF.NET_H) {
                // Bateu na rede
                b.vz *= -0.3; // Perde força e inverte levemente
                b.vx *= 0.5;
                window.Sfx.play(100, 'sawtooth', 0.1);
            }
        },

        updateAI: function() {
            // CPU tenta seguir a bola apenas se ela estiver indo na direção dele
            if (this.ball.vz > 0) {
                // Previsão simples
                const targetX = this.ball.x;
                this.cpu.x += (targetX - this.cpu.x) * 0.08;
            } else {
                // Volta pro centro
                this.cpu.x += (0 - this.cpu.x) * 0.05;
            }
            
            // Limites da CPU
            this.cpu.x = Math.max(-600, Math.min(600, this.cpu.x));

            // CPU REBATE
            // Se bola perto da CPU (Z approx TABLE_L) e bounceCount >= 1 (quicou na mesa dele)
            if (this.ball.z > CONF.TABLE_L - 100 && this.ball.z < CONF.TABLE_L + 200 && this.lastHitter === 'player') {
                if (Math.abs(this.ball.x - this.cpu.x) < 200) {
                    this.hitBall('cpu');
                }
            }
        },

        checkCollisions: function() {
            // COLISÃO DO JOGADOR (Raquete)
            // A raquete está visualmente em Z ~ 0 a 100
            if (this.ball.z < 300 && this.ball.vz < 0) { // Bola vindo
                // Hitbox da raquete (circular em torno da mão)
                const dist = Math.hypot(this.ball.x - this.hand.x, (this.ball.y) - this.hand.y);
                
                if (dist < CONF.PADDLE_SIZE) {
                    this.hitBall('player');
                }
            }
        },

        hitBall: function(who) {
            this.lastHitter = who;
            this.bounceCount = 0;
            this.isBallInPlay = true;

            const b = this.ball;

            if (who === 'player') {
                window.Sfx.hit();
                // A força depende do SWING (handVel)
                // Se o jogador estiver parado, a bola morre (bloqueio passivo)
                // Se o jogador bater forte, a bola acelera
                
                const swingX = Math.max(-20, Math.min(20, this.handVel.x));
                const swingY = Math.max(-20, Math.min(20, this.handVel.y));

                // Velocidade base de retorno + swing
                b.vz = Math.abs(b.vz) * 0.4 + 15 + (Math.abs(swingY) * 0.5); 
                b.vx = (b.x - this.hand.x) * 0.1 + (swingX * 0.8); // Efeito lateral
                b.vy = -10 - (Math.abs(swingY) * 0.5); // Arco

                // Limite de velocidade
                b.vz = Math.min(b.vz, CONF.MAX_SPEED);

                this.spawnParticles(b.x, b.y, b.z, '#ffcc00', 8);
                
                // Feedback visual de impacto
                if(window.Gfx) window.Gfx.shakeScreen(5);

            } else {
                // CPU Hit
                window.Sfx.play(300, 'square', 0.1);
                const aimX = (Math.random() - 0.5) * (CONF.TABLE_W * 0.8); // Mira em lugar aleatorio
                b.vz = - (18 + Math.random() * 10);
                b.vx = (aimX - b.x) * 0.02;
                b.vy = -12;
            }
        },

        resolvePoint: function(ballDead) {
            // Lógica simplificada de pontos baseada em quem bateu por ultimo e onde caiu
            // Se caiu fora e o ultimo a bater foi Player -> Ponto CPU
            // Se caiu fora e o ultimo a bater foi CPU -> Ponto Player
            
            let winner = null;
            if (this.lastHitter === 'player') winner = 'cpu';
            else winner = 'player';

            if (winner === 'player') {
                this.scorePlayer++;
                this.showMessage("PONTO JOGADOR!", "#0f0");
                window.Sfx.play(600, 'sine', 0.5);
                this.resetRound(true);
            } else {
                this.scoreCPU++;
                this.showMessage("PONTO CPU", "#f00");
                window.Sfx.play(150, 'sawtooth', 0.5);
                this.resetRound(false);
            }
        },

        // =================================================================
        // RENDERIZAÇÃO
        // =================================================================
        
        renderWorld: function(ctx, w, h) {
            // Fundo
            const grad = ctx.createRadialGradient(w/2, h/2, 100, w/2, h/2, w);
            grad.addColorStop(0, '#34495e'); grad.addColorStop(1, '#111');
            ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);

            // Chão (Grid)
            ctx.strokeStyle = 'rgba(255,255,255,0.05)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for(let i=-2000; i<2000; i+=200) {
                const p1 = SafeUtils.project(i, 400, 0, w, h);
                const p2 = SafeUtils.project(i, 400, 4000, w, h);
                ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
            }
            ctx.stroke();

            // MESA
            this.drawTable(ctx, w, h);

            // CPU
            const cpuPos = SafeUtils.project(this.cpu.x, this.cpu.y, this.cpu.z, w, h);
            this.drawPaddle(ctx, cpuPos.x, cpuPos.y, cpuPos.s, '#e74c3c');

            // BOLA
            // Sombra da bola
            if (this.ball.y < 0) {
                const shadow = SafeUtils.project(this.ball.x, 0, this.ball.z, w, h);
                ctx.fillStyle = 'rgba(0,0,0,0.3)';
                ctx.beginPath(); ctx.ellipse(shadow.x, shadow.y, 15*shadow.s, 5*shadow.s, 0, 0, Math.PI*2); ctx.fill();
            }
            
            const b = SafeUtils.project(this.ball.x, this.ball.y, this.ball.z, w, h);
            ctx.fillStyle = '#f1c40f';
            ctx.beginPath(); ctx.arc(b.x, b.y, CONF.BALL_R * b.s, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.beginPath(); ctx.arc(b.x - 5*b.s, b.y - 5*b.s, 8*b.s, 0, Math.PI*2); ctx.fill(); // Brilho

            // JOGADOR (Raquete)
            // A raquete segue a mão mas tem profundidade fixa visual
            const pScale = 1.0; 
            const paddleX = w/2 + this.hand.x;
            const paddleY = h/2 + this.hand.y;
            this.drawPaddle(ctx, paddleX, paddleY, pScale, '#3498db', true);

            // Particulas
            this.renderParticles(ctx, w, h);
        },

        drawTable: function(ctx, w, h) {
            const hw = CONF.TABLE_W / 2;
            const l = CONF.TABLE_L;
            
            // Pontos da mesa
            const p1 = SafeUtils.project(-hw, 0, 0, w, h); // Near Left
            const p2 = SafeUtils.project(hw, 0, 0, w, h);  // Near Right
            const p3 = SafeUtils.project(hw, 0, l, w, h);  // Far Right
            const p4 = SafeUtils.project(-hw, 0, l, w, h); // Far Left

            // Tampo
            ctx.fillStyle = '#273c75';
            ctx.beginPath(); 
            ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); 
            ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y); 
            ctx.fill();
            
            // Bordas
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
            
            // Rede
            const netZ = l/2;
            const n1 = SafeUtils.project(-hw - 50, 0, netZ, w, h);
            const n2 = SafeUtils.project(hw + 50, 0, netZ, w, h);
            const n1t = SafeUtils.project(-hw - 50, -CONF.NET_H, netZ, w, h);
            const n2t = SafeUtils.project(hw + 50, -CONF.NET_H, netZ, w, h);

            ctx.fillStyle = 'rgba(200,200,200,0.6)';
            ctx.beginPath(); ctx.moveTo(n1.x, n1.y); ctx.lineTo(n2.x, n2.y); ctx.lineTo(n2t.x, n2t.y); ctx.lineTo(n1t.x, n1t.y); ctx.fill();
            ctx.beginPath(); ctx.moveTo(n1t.x, n1t.y); ctx.lineTo(n2t.x, n2t.y); ctx.strokeStyle='#eee'; ctx.lineWidth=1; ctx.stroke();
        },

        drawPaddle: function(ctx, x, y, s, color, isPlayer) {
            const size = CONF.PADDLE_SIZE * s;
            
            // Cabo
            ctx.fillStyle = '#8e44ad'; // Roxo madeira
            ctx.fillRect(x - 10*s, y + size*0.4, 20*s, 60*s);

            // Borracha
            ctx.fillStyle = '#2c3e50'; // Base
            ctx.beginPath(); ctx.arc(x, y, size/2, 0, Math.PI*2); ctx.fill();
            
            ctx.fillStyle = color; // Cor da borracha
            ctx.beginPath(); ctx.arc(x, y, (size/2) - 4, 0, Math.PI*2); ctx.fill();
            
            // Brilho de movimento
            if (isPlayer && (Math.abs(this.handVel.x) > 5 || Math.abs(this.handVel.y) > 5)) {
                ctx.strokeStyle = 'rgba(255,255,255,0.5)';
                ctx.lineWidth = 2;
                ctx.beginPath(); 
                ctx.moveTo(x - this.handVel.x*2, y - this.handVel.y*2); 
                ctx.lineTo(x, y); 
                ctx.stroke();
            }
        },

        renderUI: function(ctx, w, h) {
            // Placar
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(w/2 - 100, 20, 200, 50);
            ctx.fillStyle = '#fff';
            ctx.font = "bold 30px 'Russo One'";
            ctx.textAlign = 'center';
            ctx.fillText(`${this.scorePlayer}  -  ${this.scoreCPU}`, w/2, 55);
            ctx.font = "12px sans-serif";
            ctx.fillText("PLAYER      CPU", w/2, 30);

            // Mensagens
            if (this.msgTimer > 0) {
                this.msgTimer--;
                ctx.fillStyle = 'rgba(0,0,0,0.7)';
                ctx.fillRect(0, h/2 - 40, w, 80);
                ctx.fillStyle = '#fff';
                ctx.font = "bold 40px 'Russo One'";
                ctx.fillText(this.msgText, w/2, h/2 + 10);
            }
        },

        renderMenu: function(ctx, w, h) {
            ctx.fillStyle = '#2c3e50'; ctx.fillRect(0,0,w,h);
            ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
            ctx.font = "bold 50px 'Russo One'"; ctx.fillText("TABLE TENNIS PRO", w/2, h*0.4);
            ctx.font = "20px sans-serif"; ctx.fillText("LEVANTE A MÃO PARA CALIBRAR", w/2, h*0.6);
            
            // Botão de Start Simulado
            if (!this.calibrating) {
                ctx.fillStyle = '#2ecc71'; ctx.fillRect(w/2-100, h*0.7, 200, 50);
                ctx.fillStyle = '#fff'; ctx.font="bold 20px sans-serif"; ctx.fillText("INICIAR", w/2, h*0.7+33);
                
                // Lógica simples de clique via mouse para desktop
                if (!window.System.canvas.onclick) {
                    window.System.canvas.onclick = () => {
                        this.state = 'CALIBRATION';
                        window.System.canvas.onclick = null;
                        this.calibration.cx = 0; // Reset
                    };
                }
            }
        },

        renderCalibration: function(ctx, w, h) {
            ctx.fillStyle = 'rgba(0,0,0,0.9)'; ctx.fillRect(0,0,w,h);
            ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
            ctx.font = "bold 30px sans-serif"; ctx.fillText("CALIBRANDO...", w/2, h/2 - 50);
            ctx.font = "20px sans-serif"; ctx.fillText("Fique no centro e levante a mão direita", w/2, h/2);

            // Se detectou a mão e definiu cx/cy (feito no processInput)
            if (this.calibration.cx !== 0) {
                // Aguarda um pouco e inicia
                setTimeout(() => {
                    this.state = 'SERVE';
                    this.showMessage("VAMOS JOGAR!", "#fff");
                }, 1000);
            }
        },

        spawnParticles: function(x, y, z, color, count=5) {
            for(let i=0; i<count; i++) {
                this.particles.push({
                    x, y, z,
                    vx: (Math.random()-0.5)*10, vy: (Math.random()-0.5)*10, vz: (Math.random()-0.5)*10,
                    life: 1.0, color
                });
            }
        },

        renderParticles: function(ctx, w, h) {
            this.particles.forEach((p, i) => {
                p.x += p.vx; p.y += p.vy; p.z += p.vz;
                p.life -= 0.05;
                if (p.life <= 0) {
                    this.particles.splice(i, 1);
                } else {
                    const pos = SafeUtils.project(p.x, p.y, p.z, w, h);
                    ctx.globalAlpha = p.life;
                    ctx.fillStyle = p.color;
                    ctx.beginPath(); ctx.arc(pos.x, pos.y, 3*pos.s, 0, Math.PI*2); ctx.fill();
                }
            });
            ctx.globalAlpha = 1.0;
        },

        showMessage: function(text) {
            this.msgText = text;
            this.msgTimer = 90; // 1.5s a 60fps
        }
    };

    window.System.registerGame('tennis', 'Table Tennis Pro', '🏓', Logic, { camOpacity: 0.1 });

})();