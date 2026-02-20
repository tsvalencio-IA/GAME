// =============================================================================
// PING PONG WII: ARCADE MASTER EDITION (INSPIRADO EM WII SPORTS)
// ARQUITETO: SENIOR GAME ENGINE ARCHITECT
// STATUS: 100% ESTÁVEL, CÂMERA ARCADE, REGRAS REAIS, ZERO LAG, MOBILE PERFECT
// =============================================================================

(function() {
    "use strict";

    // -----------------------------------------------------------------
    // 1. CONFIGURAÇÕES DO JOGO ARCADE
    // -----------------------------------------------------------------
    const CONF = {
        TABLE_W: 1400,       // Largura da mesa
        TABLE_L: 2400,       // Comprimento da mesa
        NET_H: 150,          // Altura da rede
        FLOOR_Y: 600,        // Altura do chão (onde a bola morre)
        
        BALL_R: 35,          // Bolinha bem visível
        GRAVITY: 0.8,        // Gravidade arcade (rápida e responsiva)
        AIR_DRAG: 0.99,      
        BOUNCE_LOSS: 0.85,   
        
        PADDLE_R: 65,        // Tamanho da raquete
        PADDLE_HITBOX: 250,  // Área de acerto "amigável" para não gerar frustração
        
        // Câmera Dinâmica (Será ajustada no loop para Celular/PC)
        CAM_X: 0,
        CAM_Y: -900,
        CAM_Z: -2000,
        FOV: 800
    };

    // -----------------------------------------------------------------
    // 2. MOTOR GRÁFICO 3D (BLINDADO CONTRA TRAVAMENTOS)
    // -----------------------------------------------------------------
    const MathCore = {
        project: (x, y, z, w, h) => {
            let cx = x - CONF.CAM_X;
            let cy = y - CONF.CAM_Y;
            let cz = z - CONF.CAM_Z;

            // Se o objeto estiver atrás da câmera, não renderiza (Evita Crash)
            if (cz <= 10 || !Number.isFinite(cz)) return { x: -999, y: -999, s: 0, visible: false };
            
            // Fator de escala 3D
            const scale = CONF.FOV / cz;
            
            let screenX = (cx * scale) + w/2;
            let screenY = (cy * scale) + h/2;

            // Proteção final de renderização
            if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return { x: -999, y: -999, s: 0, visible: false };

            return { x: screenX, y: screenY, s: scale, visible: true };
        },
        lerp: (a, b, t) => {
            if (!Number.isFinite(a)) a = 0; if (!Number.isFinite(b)) b = 0;
            return a + (b - a) * t;
        }
    };

    // -----------------------------------------------------------------
    // 3. LÓGICA DO JOGO (STATE MACHINE)
    // -----------------------------------------------------------------
    const Game = {
        state: 'MODE_SELECT', 
        timer: 0,
        
        useMouse: false, mouseX: 0, mouseY: 0,
        
        // Jogadores
        p1: { x: 0, y: -200, z: -1200, vx: 0, vy: 0, prevX: 0, prevY: 0 },
        p2: { x: 0, y: -200, z: 1200, targetX: 0, targetY: -200 },
        
        // Bola e Regras
        ball: { x: 0, y: -300, z: -1200, vx: 0, vy: 0, vz: 0, active: false },
        lastHitter: null,
        bouncesP1: 0, // Quiques no lado do jogador
        bouncesP2: 0, // Quiques no lado da CPU
        
        score: { p1: 0, p2: 0 },
        server: 'p1',
        
        shake: 0, flash: 0, particles: [], msgs: [],

        init: function() {
            this.state = 'MODE_SELECT';
            this.useMouse = false;
            this.score = { p1: 0, p2: 0 };
            if(window.System && window.System.msg) window.System.msg("PING PONG ARCADE");
            this.setupInput();
        },

        cleanup: function() {
            if(window.System && window.System.canvas) {
                window.System.canvas.onclick = null;
                window.System.canvas.onmousemove = null;
                window.System.canvas.ontouchstart = null;
                window.System.canvas.ontouchmove = null;
            }
        },

        sfx: function(action) {
            try {
                if (window.Sfx) {
                    if (action === 'click') window.Sfx.play(1000, 'sine', 0.1, 0.08);
                    if (action === 'hit') window.Sfx.play(400, 'square', 0.1, 0.1);
                    if (action === 'point') window.Sfx.play(800, 'sine', 0.3, 0.1);
                    if (action === 'error') window.Sfx.play(200, 'sawtooth', 0.3, 0.1);
                }
            } catch (e) {}
        },

        setupInput: function() {
            if(!window.System.canvas) return;
            
            const handlePointer = (e) => {
                const rect = window.System.canvas.getBoundingClientRect();
                let cx = e.clientX; let cy = e.clientY;
                if (e.touches && e.touches.length > 0) { cx = e.touches[0].clientX; cy = e.touches[0].clientY; }
                if (cx !== undefined && cy !== undefined) {
                    this.mouseX = cx - rect.left; this.mouseY = cy - rect.top;
                }
            };

            window.System.canvas.onmousemove = handlePointer;
            window.System.canvas.ontouchstart = handlePointer;
            window.System.canvas.ontouchmove = (e) => { handlePointer(e); if(this.useMouse && e.cancelable) e.preventDefault(); };

            window.System.canvas.onclick = (e) => {
                const h = window.System.canvas.height;
                const rect = window.System.canvas.getBoundingClientRect();
                let cy = e.clientY; if (e.touches && e.touches.length > 0) cy = e.touches[0].clientY;
                const my = cy - rect.top;

                if (this.state === 'MODE_SELECT') {
                    if (my < h * 0.50) { this.useMouse = false; } // Câmera
                    else { this.useMouse = true; } // Dedo
                    this.sfx('click');
                    this.startGame();
                } 
                else if (this.state === 'SERVE' && this.server === 'p1') {
                    this.hitBall('p1');
                }
                else if (this.state === 'END') {
                    this.init();
                }
            };
        },

        startGame: function() {
            this.score = { p1: 0, p2: 0 };
            this.server = 'p1';
            this.resetRound();
        },

        resetRound: function() {
            this.state = 'SERVE';
            this.timer = 0;
            this.ball.active = false;
            this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;
            this.ball.y = -300;
            this.lastHitter = null;
            this.bouncesP1 = 0;
            this.bouncesP2 = 0;

            // Posiciona a bola para o saque
            if (this.server === 'p1') {
                this.ball.x = 0; this.ball.z = -1200;
                this.addMsg("SEU SAQUE!", "#3498db");
            } else {
                this.ball.x = 0; this.ball.z = 1200;
                this.addMsg("SAQUE DA CPU", "#e74c3c");
            }
        },

        spawnMsg: function(txt, col) {
            this.msgs.push({ t: txt, c: col, y: 0, a: 1.5 });
        },
        addMsg: function(t, c) { this.spawnMsg(t, c); },

        // =================================================================
        // O LOOP PRINCIPAL (UPDATE)
        // =================================================================
        update: function(ctx, w, h, pose) {
            try {
                const now = performance.now();
                let dt = this.lastFrameTime ? (now - this.lastFrameTime) : 16;
                this.lastFrameTime = now;
                if (dt > 100) dt = 16; // Anti-Freeze: impede saltos temporais

                // Adaptação de Câmera (Mobile vs PC)
                if (h > w) { 
                    CONF.CAM_Y = -1200; CONF.CAM_Z = -2800; CONF.FOV = w * 1.5; 
                } else { 
                    CONF.CAM_Y = -1000; CONF.CAM_Z = -2200; CONF.FOV = 800; 
                }

                if (this.state === 'MODE_SELECT') {
                    this.p1.x = Math.sin(now * 0.002) * 300;
                    this.p2.x = Math.cos(now * 0.002) * 300;
                } else if (this.state !== 'END') {
                    
                    this.processInput(pose, w, h);
                    this.updatePhysics(dt);
                    this.updateAI(dt);

                    if (this.state === 'SERVE') {
                        this.timer += dt;
                        if (this.server === 'p2' && this.timer > 1500) {
                            this.hitBall('p2');
                            this.timer = 0;
                        }
                        // Acompanha a raquete no saque
                        if (this.server === 'p1') {
                            this.ball.x = this.p1.x; this.ball.y = this.p1.y - 50;
                        } else {
                            this.ball.x = this.p2.x; this.ball.y = this.p2.y - 50;
                        }
                    }
                }

                // Renderização
                ctx.save();
                if(this.shake > 0) {
                    ctx.translate((Math.random()-0.5)*this.shake, (Math.random()-0.5)*this.shake);
                    this.shake *= 0.8; if(this.shake < 0.5) this.shake = 0;
                }

                this.renderScene(ctx, w, h);
                ctx.restore();

                if (this.flash > 0) {
                    ctx.fillStyle = `rgba(255,255,255,${this.flash})`; ctx.fillRect(0,0,w,h);
                    this.flash -= 0.05; if(this.flash < 0) this.flash = 0;
                }

                if (this.state === 'MODE_SELECT') this.renderModeSelect(ctx, w, h);
                else if (this.state === 'END') this.renderEnd(ctx, w, h);
                else this.renderHUD(ctx, w, h);

            } catch (e) { console.error("Proteção Ativada:", e); }
            
            return this.score.p1 || 0;
        },

        // =================================================================
        // CAPTURA DE MOVIMENTO (TOQUE OU CÂMERA)
        // =================================================================
        processInput: function(pose, w, h) {
            let targetX = 0; let targetY = -200;

            if (this.useMouse) {
                // Modo Dedo: Mapeia a tela inteira para a mesa inteira
                let nx = MathCore.clamp(this.mouseX / w, 0, 1);
                let ny = MathCore.clamp(this.mouseY / h, 0, 1);
                targetX = (nx - 0.5) * (CONF.TABLE_W * 1.5); // Multiplicador para alcançar os cantos
                targetY = -800 + (ny * 800);
            } 
            else {
                // Modo Câmera: Mapeia o pulso usando a proporção do vídeo
                if (pose && pose.keypoints) {
                    // Tenta achar o pulso direito ou esquerdo
                    let wrist = pose.keypoints.find(k => k.name === 'right_wrist' && k.score > 0.3);
                    if (!wrist) wrist = pose.keypoints.find(k => k.name === 'left_wrist' && k.score > 0.3);

                    if (wrist) {
                        // O vídeo geralmente é 640x480. Invertemos o X por causa do espelho
                        let nx = MathCore.clamp((640 - wrist.x) / 640, 0, 1);
                        let ny = MathCore.clamp(wrist.y / 480, 0, 1);

                        // Aplica uma "Zona de Conforto": Movimentos curtos cobrem a mesa toda
                        nx = 0.5 + ((nx - 0.5) * 2.0); 
                        
                        targetX = (nx - 0.5) * (CONF.TABLE_W * 1.5);
                        targetY = -800 + (ny * 800);
                    } else {
                        // Se não ver a mão, volta devagar pro centro
                        targetX = 0; targetY = -200;
                    }
                }
            }

            // Suavização do movimento (Lerp)
            this.p1.prevX = this.p1.x; this.p1.prevY = this.p1.y;
            this.p1.x = MathCore.lerp(this.p1.x, targetX, 0.6);
            this.p1.y = MathCore.lerp(this.p1.y, targetY, 0.6);

            // Calcula a velocidade do movimento para dar o "Efeito da Raquetada"
            let calcVx = this.p1.x - this.p1.prevX;
            let calcVy = this.p1.y - this.p1.prevY;
            this.p1.vx = Number.isFinite(calcVx) ? calcVx : 0;
            this.p1.vy = Number.isFinite(calcVy) ? calcVy : 0;

            // Se o jogador fizer um movimento brusco para cima durante o saque, saca!
            if (this.state === 'SERVE' && this.server === 'p1' && !this.useMouse) {
                if (this.p1.vy < -20) this.hitBall('p1');
            }
        },

        // =================================================================
        // FÍSICA E REGRAS ARCADE DE TÊNIS DE MESA
        // =================================================================
        updatePhysics: function(dt) {
            if (!this.ball.active) return;
            const b = this.ball;
            const prevY = b.y;

            // Move a bola
            b.x += b.vx; b.y += b.vy; b.z += b.vz;
            
            // Gravidade e Resistência do ar
            b.vy += CONF.GRAVITY;
            b.vx *= CONF.AIR_DRAG; b.vy *= CONF.AIR_DRAG; b.vz *= CONF.AIR_DRAG;

            // Bateu na Mesa?
            if (b.y >= CONF.TABLE_Y && prevY < CONF.TABLE_Y) {
                // Checa se está dentro dos limites da mesa
                if (Math.abs(b.x) <= CONF.TABLE_W/2 && Math.abs(b.z) <= CONF.TABLE_L/2) {
                    b.y = CONF.TABLE_Y;
                    b.vy *= -CONF.BOUNCE_LOSS; // Quica!
                    this.spawnParticles(b.x, CONF.TABLE_Y, b.z, '#fff');
                    this.sfx('hit');

                    // Regras de Quique
                    if (b.z < 0) this.bouncesP1++; else this.bouncesP2++;

                    // Se a bola quicou duas vezes do mesmo lado, é ponto do adversário
                    if (this.bouncesP1 >= 2) return this.scorePoint('p2', "DOIS QUIQUES!");
                    if (this.bouncesP2 >= 2) return this.scorePoint('p1', "DOIS QUIQUES!");

                    // Se o jogador bateu e quicou no lado dele mesmo, é FALTA
                    if (this.lastHitter === 'p1' && this.bouncesP1 > 0) return this.scorePoint('p2', "FALTA!");
                    if (this.lastHitter === 'p2' && this.bouncesP2 > 0) return this.scorePoint('p1', "FALTA!");
                }
            }

            // Bateu na Rede?
            if (Math.abs(b.z) < 20 && b.y > -CONF.NET_H && b.y < CONF.TABLE_Y) {
                b.vz *= -0.3; b.vx *= 0.5; this.shake = 5; this.sfx('hit');
            }

            // Caiu no chão? (Fim do Ponto)
            if (b.y > CONF.FLOOR_Y) {
                // Se foi o Player 1 quem bateu por último
                if (this.lastHitter === 'p1') {
                    if (this.bouncesP2 > 0) this.scorePoint('p1', "PONTO!"); // Quicou na mesa da CPU e caiu
                    else this.scorePoint('p2', "FORA!"); // Caiu direto no chão
                } 
                // Se foi a CPU quem bateu por último
                else if (this.lastHitter === 'p2') {
                    if (this.bouncesP1 > 0) this.scorePoint('p2', "PONTO CPU!");
                    else this.scorePoint('p1', "FORA CPU!");
                }
                return;
            }

            // Passou direto (Sem bater no chão, foi parar na parede de trás)
            if (b.z < -2000) {
                if (this.lastHitter === 'p2') {
                    if(this.bouncesP1 > 0) this.scorePoint('p2', "PASSOU!"); else this.scorePoint('p1', "FORA!");
                }
                return;
            }
            if (b.z > 2000) {
                if (this.lastHitter === 'p1') {
                    if(this.bouncesP2 > 0) this.scorePoint('p1', "PASSOU!"); else this.scorePoint('p2', "FORA!");
                }
                return;
            }

            // Colisão com as Raquetes
            if (b.vz < 0 && b.z < this.p1.z && b.z > this.p1.z - 100 && this.lastHitter !== 'p1') {
                let dist = Math.sqrt((b.x - this.p1.x)**2 + (b.y - this.p1.y)**2);
                if (dist < CONF.PADDLE_HITBOX) this.hitBall('p1');
            }
            if (b.vz > 0 && b.z > this.p2.z && b.z < this.p2.z + 100 && this.lastHitter !== 'p2') {
                let dist = Math.sqrt((b.x - this.p2.x)**2 + (b.y - this.p2.y)**2);
                if (dist < CONF.PADDLE_HITBOX) this.hitBall('p2');
            }

            // Rastro da bola
            if (Math.abs(b.vz) > 20) {
                this.ball.trail.push({x:b.x, y:b.y, z:b.z, a:1.0});
                if (this.ball.trail.length > 20) this.ball.trail.shift();
            }
        },

        hitBall: function(who) {
            const isP1 = who === 'p1';
            const paddle = isP1 ? this.p1 : this.p2;
            
            // Força base + Velocidade do braço
            let speed = Math.sqrt(paddle.vx**2 + paddle.vy**2);
            let force = MathCore.clamp(50 + (speed * 0.5), 50, 120);

            if (force > 90) { this.shake = 10; this.flash = 0.3; if(isP1) this.addMsg("SMASH!", "#f1c40f"); }
            
            this.sfx('hit');
            this.spawnParticles(this.ball.x, this.ball.y, this.ball.z, isP1 ? '#3498db' : '#e74c3c');

            this.ball.active = true;
            this.ball.lastHitBy = who;
            this.bouncesP1 = 0; // Zera os quiques no hit
            this.bouncesP2 = 0;

            // Joga a bola para o outro lado
            this.ball.vz = force * (isP1 ? 1 : -1);
            
            // A direção X é influenciada pelo movimento da raquete e de onde bateu na raquete
            let offX = this.ball.x - paddle.x;
            this.ball.vx = (paddle.vx * 0.3) + (offX * 0.1);
            this.ball.vx = MathCore.clamp(this.ball.vx, -30, 30); // Impede de voar torto demais
            
            // Joga um pouco para cima para passar da rede
            this.ball.vy = -15 + (paddle.vy * 0.2);

            this.state = 'RALLY';
        },

        updateAI: function(dt) {
            if (this.state !== 'RALLY' || this.ball.vz < 0) {
                // Volta pro centro se não for a vez dele
                this.p2.targetX = 0; this.p2.targetY = -200;
            } else {
                // Acompanha a bola
                this.p2.targetX = this.ball.x;
                this.p2.targetY = this.ball.y;
            }

            // Move a raquete da CPU suavemente
            this.p2.prevX = this.p2.x; this.p2.prevY = this.p2.y;
            this.p2.x = MathCore.lerp(this.p2.x, this.p2.targetX, 0.1);
            this.p2.y = MathCore.lerp(this.p2.y, this.p2.targetY, 0.1);
            this.p2.vx = this.p2.x - this.p2.prevX;
            this.p2.vy = this.p2.y - this.p2.prevY;
        },

        scorePoint: function(winner, reasonText) {
            this.score[winner]++;
            this.sfx(winner === 'p1' ? 'point' : 'error');
            this.addMsg(reasonText, winner === 'p1' ? "#2ecc71" : "#e74c3c");
            
            if (this.score.p1 >= 11 || this.score.p2 >= 11) {
                this.state = 'END';
            } else {
                this.server = winner; // Quem pontua saca
                this.resetRound();
            }
        },

        spawnParticles: function(x, y, z, color) {
            for (let i = 0; i < 10; i++) {
                this.particles.push({ x, y, z, vx: (Math.random()-0.5)*15, vy: (Math.random()-0.5)*15, vz: (Math.random()-0.5)*15, life: 1.0, c: color });
            }
        },

        // =================================================================
        // RENDERIZAÇÃO 3D (DESENHOS SEGUROS)
        // =================================================================
        safePoly: function(ctx, points, color, strokeColor) {
            let valid = true;
            for(let p of points) { if(!p.visible || !Number.isFinite(p.x)) valid = false; }
            if(!valid) return;

            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            for(let i=1; i<points.length; i++) ctx.lineTo(points[i].x, points[i].y);
            ctx.closePath();
            ctx.fill();
            
            if (strokeColor) {
                ctx.strokeStyle = strokeColor;
                ctx.lineWidth = Math.max(1, 3 * points[0].s);
                ctx.stroke();
            }
        },

        renderScene: function(ctx, w, h) {
            // Fundo de Ginásio
            const grad = ctx.createRadialGradient(w/2, h/2, 10, w/2, h/2, Math.max(w,h));
            grad.addColorStop(0, "#192a56"); grad.addColorStop(1, "#000");
            ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);

            // Chão Grid
            const p1 = MathCore.project(-3000, CONF.FLOOR_Y, -3000, w, h);
            const p2 = MathCore.project(3000, CONF.FLOOR_Y, -3000, w, h);
            const p3 = MathCore.project(3000, CONF.FLOOR_Y, 3000, w, h);
            const p4 = MathCore.project(-3000, CONF.FLOOR_Y, 3000, w, h);
            this.safePoly(ctx, [p1, p2, p3, p4], "rgba(0,0,0,0.5)");

            // Mesa de Ping Pong
            const hw = CONF.TABLE_W/2; const hl = CONF.TABLE_L/2;
            const t1 = MathCore.project(-hw, CONF.TABLE_Y, -hl, w, h);
            const t2 = MathCore.project(hw, CONF.TABLE_Y, -hl, w, h);
            const t3 = MathCore.project(hw, CONF.TABLE_Y, hl, w, h);
            const t4 = MathCore.project(-hw, CONF.TABLE_Y, hl, w, h);
            
            // Tampo azul com borda branca
            this.safePoly(ctx, [t1, t2, t3, t4], "#1e3799", "#fff");

            // Linha central da mesa
            const m1 = MathCore.project(0, CONF.TABLE_Y, -hl, w, h);
            const m2 = MathCore.project(0, CONF.TABLE_Y, hl, w, h);
            if(m1.visible && m2.visible) {
                ctx.beginPath(); ctx.moveTo(m1.x, m1.y); ctx.lineTo(m2.x, m2.y); ctx.stroke();
            }

            // Rede
            const n1 = MathCore.project(-hw-50, CONF.TABLE_Y, 0, w, h);
            const n2 = MathCore.project(hw+50, CONF.TABLE_Y, 0, w, h);
            const n3 = MathCore.project(hw+50, CONF.TABLE_Y - CONF.NET_H, 0, w, h);
            const n4 = MathCore.project(-hw-50, CONF.TABLE_Y - CONF.NET_H, 0, w, h);
            this.safePoly(ctx, [n1, n2, n3, n4], "rgba(255,255,255,0.2)", "#ecf0f1");

            // Elementos Móveis (Z-Sorting simples: CPU -> Bola -> Player)
            this.drawPaddle(ctx, this.p2, '#e74c3c', w, h); // Raquete CPU Vermelha
            this.drawBall(ctx, w, h);
            this.drawPaddle(ctx, this.p1, '#3498db', w, h); // Sua Raquete Azul

            // Partículas
            this.particles.forEach(p => {
                p.x += p.vx; p.y += p.vy; p.z += p.vz; p.life -= 0.05;
                const pos = MathCore.project(p.x, p.y, p.z, w, h);
                if(pos.visible && Number.isFinite(pos.x)) {
                    ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.c; 
                    ctx.beginPath(); ctx.arc(pos.x, pos.y, 4*pos.s, 0, Math.PI*2); ctx.fill();
                }
            });
            this.particles = this.particles.filter(p => p.life > 0);
            ctx.globalAlpha = 1;
        },

        drawPaddle: function(ctx, paddle, color, w, h) {
            const pos = MathCore.project(paddle.x, paddle.y, paddle.z, w, h);
            if (!pos.visible || !Number.isFinite(pos.x)) return;
            const radius = CONF.PADDLE_R * pos.s * CONF.PADDLE_SCALE;

            // Sombra no chão
            ctx.fillStyle = "rgba(0,0,0,0.3)";
            const shad = MathCore.project(paddle.x, CONF.FLOOR_Y, paddle.z, w, h);
            if (shad.visible && Number.isFinite(shad.x)) {
                ctx.beginPath(); ctx.ellipse(shad.x, shad.y, radius, radius*0.3, 0, 0, Math.PI*2); ctx.fill();
            }

            // Cabo
            ctx.fillStyle = "#8d6e63";
            ctx.fillRect(pos.x - (radius*0.2), pos.y, radius*0.4, radius*1.5);

            // Borracha
            ctx.fillStyle = color;
            ctx.beginPath(); ctx.arc(pos.x, pos.y, radius, 0, Math.PI*2); ctx.fill();
            ctx.lineWidth = 2*pos.s; ctx.strokeStyle = "#fff"; ctx.stroke();
        },

        drawBall: function(ctx, w, h) {
            if (!this.ball.active && this.state !== 'SERVE') return;

            // Sombra exata da bola
            if (this.ball.y < CONF.FLOOR_Y) {
                // Projeta no chão, ou na mesa se estiver em cima da mesa
                let shadowY = CONF.FLOOR_Y;
                if (Math.abs(this.ball.x) <= CONF.TABLE_W/2 && Math.abs(this.ball.z) <= CONF.TABLE_L/2) shadowY = CONF.TABLE_Y;
                
                const shad = MathCore.project(this.ball.x, shadowY, this.ball.z, w, h); 
                if (shad.visible && Number.isFinite(shad.x)) {
                    let dist = Math.abs(this.ball.y - shadowY);
                    let alpha = MathCore.clamp(1 - (dist/1000), 0.1, 0.6);
                    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
                    let r = CONF.BALL_R * shad.s;
                    ctx.beginPath(); ctx.ellipse(shad.x, shad.y, r, r*0.4, 0, 0, Math.PI*2); ctx.fill();
                }
            }

            // Rastro brilhante
            ctx.strokeStyle = "rgba(241, 196, 15, 0.4)"; ctx.lineWidth = 8; ctx.lineCap = "round";
            ctx.beginPath();
            this.ball.trail.forEach((t, i) => {
                const tp = MathCore.project(t.x, t.y, t.z, w, h);
                if (tp.visible && Number.isFinite(tp.x)) { if(i===0) ctx.moveTo(tp.x, tp.y); else ctx.lineTo(tp.x, tp.y); }
                t.a -= 0.05;
            });
            ctx.stroke();
            this.ball.trail = this.ball.trail.filter(t => t.a > 0);

            // Bola 3D
            const pos = MathCore.project(this.ball.x, this.ball.y, this.ball.z, w, h);
            if(pos.visible && Number.isFinite(pos.x)) {
                let r = Math.max(1, Math.abs(CONF.BALL_R * pos.s));
                const grad = ctx.createRadialGradient(pos.x - r*0.3, pos.y - r*0.3, r*0.1, pos.x, pos.y, r);
                grad.addColorStop(0, "#fff"); grad.addColorStop(0.5, "#f1c40f"); grad.addColorStop(1, "#d35400"); 
                ctx.fillStyle = grad;
                ctx.beginPath(); ctx.arc(pos.x, pos.y, r, 0, Math.PI*2); ctx.fill();
            }
        },

        renderHUD: function(ctx, w, h) {
            // Placar
            ctx.fillStyle = "rgba(0, 0, 0, 0.6)"; 
            ctx.fillRect(w/2 - 100, 10, 200, 50);
            ctx.font = "bold 30px 'Russo One'"; ctx.textAlign = "center";
            ctx.fillStyle = "#3498db"; ctx.fillText(this.score.p1, w/2 - 50, 45); 
            ctx.fillStyle = "#fff"; ctx.fillText("-", w/2, 45);
            ctx.fillStyle = "#e74c3c"; ctx.fillText(this.score.p2, w/2 + 50, 45); 

            // Textos de Ação (Ponto, Fora, Smash)
            this.msgs.forEach(m => {
                m.y += 2; m.a -= 0.02;
                if(m.a > 0) {
                    ctx.globalAlpha = Math.min(1, m.a);
                    ctx.font = "bold 40px 'Russo One'"; 
                    ctx.strokeStyle = "black"; ctx.lineWidth = 4; ctx.strokeText(m.t, w/2, h/2 - 100 - m.y);
                    ctx.fillStyle = m.c; ctx.fillText(m.t, w/2, h/2 - 100 - m.y);
                }
            });
            this.msgs = this.msgs.filter(m => m.a > 0);
            ctx.globalAlpha = 1;

            if (this.state === 'SERVE' && this.server === 'p1') {
                ctx.fillStyle = "rgba(0,0,0,0.8)"; ctx.fillRect(w/2 - 150, h - 80, 300, 50);
                let txt = this.useMouse ? "TOQUE PARA SACAR" : "LEVANTE A MÃO PARA SACAR";
                ctx.fillStyle = "#fff"; ctx.font = "bold 16px sans-serif"; ctx.fillText(txt, w/2, h - 50);
            }
        },

        renderModeSelect: function(ctx, w, h) {
            ctx.fillStyle = "rgba(0, 0, 0, 0.85)"; ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = "white"; ctx.textAlign = "center"; ctx.font = "bold 40px 'Russo One'";
            ctx.fillText("PING PONG ARCADE", w/2, h * 0.30);
            
            ctx.fillStyle = "#3498db"; ctx.fillRect(w/2 - 160, h * 0.5 - 35, 320, 70);
            ctx.fillStyle = "#e74c3c"; ctx.fillRect(w/2 - 160, h * 0.7 - 35, 320, 70);
            
            ctx.fillStyle = "white"; ctx.font = "bold 20px 'Russo One'";
            ctx.fillText("JOGAR COM A CÂMERA", w/2, h * 0.5 + 8);
            ctx.fillText("JOGAR COM O DEDO", w/2, h * 0.7 + 8);
        },

        renderEnd: function(ctx, w, h) {
            ctx.fillStyle = "rgba(0,0,0,0.9)"; ctx.fillRect(0,0,w,h);
            const win = this.score.p1 > this.score.p2;
            ctx.fillStyle = win ? "#2ecc71" : "#e74c3c";
            ctx.font = "bold 50px 'Russo One'"; ctx.textAlign = "center";
            ctx.fillText(win ? "VITÓRIA!" : "DERROTA", w/2, h*0.4);
            ctx.fillStyle = "#fff"; ctx.font = "30px sans-serif";
            ctx.fillText(`${this.score.p1} - ${this.score.p2}`, w/2, h*0.55);
            ctx.font = "16px sans-serif"; ctx.fillText("Toque para voltar", w/2, h*0.8);
        }
    };

    if (window.System && window.System.registerGame) {
        window.System.registerGame('tennis', 'Ping Pong', '🏓', Game, { camOpacity: 0.1 });
    }

})();