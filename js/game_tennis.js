// =============================================================================
// TABLE TENNIS: PRO TOUR (V7 - FINAL PROFESSIONAL LOGIC)
// ARQUITETO: SENIOR GAME DEV (EX-KONAMI/NINTENDO STYLE)
// STATUS: CALIBRAÇÃO 2-PONTOS OBRIGATÓRIA, FÍSICA VETORIAL, HUD PRO
// =============================================================================

(function() {
    "use strict";

    // -----------------------------------------------------------------
    // 1. CONFIGURAÇÕES FÍSICAS (ESCALA REALISTA)
    // -----------------------------------------------------------------
    const CONF = {
        // Mesa (Escala Virtual)
        TABLE_W: 1400, 
        TABLE_L: 2600,
        NET_H: 140,
        FLOOR: 700,
        
        // Física
        GRAVITY: 0.65,
        AIR_RESISTANCE: 0.99,
        BOUNCE_DAMPING: 0.82,
        
        // Raquete
        PADDLE_Z_OFFSET: 250, // O quanto a raquete entra na mesa (Z)
        PADDLE_SIZE: 130,     // Hitbox
        SWING_POWER: 2.4,     // Multiplicador de força
        
        // Visual
        CAM_Y: -1300,         // Altura da câmera
        CAM_Z: -1500          // Distância da câmera
    };

    // -----------------------------------------------------------------
    // 2. MOTOR MATEMÁTICO
    // -----------------------------------------------------------------
    const Math3D = {
        project: (x, y, z, w, h) => {
            const fov = 850;
            const depth = (z - CONF.CAM_Z);
            if (depth <= 0) return { x: -5000, y: -5000, s: 0, visible: false };
            
            const scale = fov / depth;
            return {
                x: (x * scale) + w/2,
                y: ((y - CONF.CAM_Y) * scale) + h/2,
                s: scale,
                visible: true
            };
        },
        lerp: (a, b, t) => a + (b - a) * t,
        map: (v, iMin, iMax, oMin, oMax) => oMin + (oMax - oMin) * ((v - iMin) / (iMax - iMin)),
        distSq: (p1, p2) => (p1.x - p2.x)**2 + (p1.y - p2.y)**2
    };

    // -----------------------------------------------------------------
    // 3. ENGINE DO JOGO
    // -----------------------------------------------------------------
    const Game = {
        state: 'INIT', // INIT -> CALIB_L -> CALIB_R -> MENU -> SERVE -> RALLY -> END
        
        // Jogador (P1)
        p1: { 
            rawX: 0, rawY: 0, 
            gameX: 0, gameY: 0, 
            velX: 0, velY: 0,
            prevX: 0, prevY: 0
        },
        // Oponente (IA)
        p2: { gameX: 0, gameY: 0, gameZ: CONF.TABLE_L/2 + 200 },

        // Bola
        ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, active: false },

        // Calibração
        calib: {
            tlX: 0, tlY: 0, // Top-Left
            brX: 640, brY: 480, // Bottom-Right
            timer: 0
        },

        score: { p1: 0, p2: 0 },
        server: 'p1',
        bounceSide: 0, // -1: P1, 1: P2
        
        // Efeitos
        shake: 0,
        particles: [],
        msg: { txt: "", a: 0 },

        // -----------------------------------------------------------------
        // INICIALIZAÇÃO
        // -----------------------------------------------------------------
        init: function() {
            this.state = 'CALIB_INTRO';
            this.score = { p1: 0, p2: 0 };
            
            // Verifica se já calibrou na sessão
            if (this.calib.tlX !== 0 && this.calib.brX !== 640) {
                this.state = 'MENU';
            }

            if(window.System && window.System.msg) window.System.msg("PING PONG PRO");
            this.setupInput();
        },

        setupInput: function() {
            if(!window.System.canvas) return;
            window.System.canvas.onclick = (e) => {
                if (this.state === 'CALIB_INTRO') {
                    this.state = 'CALIB_TL';
                    this.calib.timer = 0;
                } else if (this.state === 'MENU') {
                    this.state = 'SERVE';
                    this.resetBall();
                } else if (this.state === 'END') {
                    this.init();
                }
            };
        },

        // -----------------------------------------------------------------
        // LOOP PRINCIPAL
        // -----------------------------------------------------------------
        update: function(ctx, w, h, pose) {
            // Processa Input
            this.processInput(pose, w, h);

            // Renderiza Fundo (Sempre)
            this.renderEnvironment(ctx, w, h);

            switch(this.state) {
                case 'CALIB_INTRO': this.renderCalibIntro(ctx, w, h); break;
                case 'CALIB_TL':    this.processCalibrationStep(ctx, w, h, 'TL'); break;
                case 'CALIB_BR':    this.processCalibrationStep(ctx, w, h, 'BR'); break;
                
                case 'MENU':        this.renderMenu(ctx, w, h); break;
                
                case 'SERVE':
                case 'RALLY':
                    this.updatePhysics();
                    this.updateAI();
                    this.checkCollisions();
                    this.renderGame(ctx, w, h);
                    this.renderHUD(ctx, w, h);
                    break;
                    
                case 'END':         
                    this.renderGame(ctx, w, h); // Fundo estático
                    this.renderEnd(ctx, w, h); 
                    break;
            }

            return this.score.p1;
        },

        // -----------------------------------------------------------------
        // INPUT & MAPEAMENTO
        // -----------------------------------------------------------------
        processInput: function(pose, w, h) {
            if (!pose || !pose.keypoints) return;

            const wrist = pose.keypoints.find(k => (k.name === 'right_wrist' || k.name === 'left_wrist') && k.score > 0.3);
            
            if (wrist) {
                // Inverte X (Espelho)
                this.p1.rawX = 640 - wrist.x;
                this.p1.rawY = wrist.y;

                if (this.state === 'SERVE' || this.state === 'RALLY' || this.state === 'MENU') {
                    // Mapeamento Calibrado
                    // Normaliza (0 a 1) baseado na calibração
                    let nx = Math3D.map(this.p1.rawX, this.calib.tlX, this.calib.brX, 0, 1);
                    let ny = Math3D.map(this.p1.rawY, this.calib.tlY, this.calib.brY, 0, 1);

                    // Clamp e Extensão (Permite alcançar um pouco além)
                    nx = (nx - 0.5) * 1.3 + 0.5;
                    
                    // Converte para Mundo
                    // X: Largura da mesa com margem
                    const targetX = Math3D.lerp(-CONF.TABLE_W*0.7, CONF.TABLE_W*0.7, nx);
                    // Y: Altura em relação à mesa
                    const targetY = Math3D.lerp(-500, 500, ny) - 150; 

                    // Suavização
                    this.p1.gameX = Math3D.lerp(this.p1.gameX, targetX, 0.4);
                    this.p1.gameY = Math3D.lerp(this.p1.gameY, targetY, 0.4);

                    // Velocidade (Swing)
                    this.p1.velX = this.p1.gameX - this.p1.prevX;
                    this.p1.velY = this.p1.gameY - this.p1.prevY;

                    this.p1.prevX = this.p1.gameX;
                    this.p1.prevY = this.p1.gameY;

                    // Saque (Toss)
                    if (this.state === 'SERVE' && this.server === 'p1') {
                        this.ball.x = this.p1.gameX;
                        this.ball.y = this.p1.gameY - 50;
                        this.ball.z = -CONF.TABLE_L/2 - 50;
                        if (this.p1.velY < -18) this.serveBall('p1');
                    }
                }
            }
        },

        // -----------------------------------------------------------------
        // CALIBRAÇÃO (LÓGICA VISUAL)
        // -----------------------------------------------------------------
        processCalibrationStep: function(ctx, w, h, step) {
            ctx.fillStyle = "rgba(0,0,0,0.8)"; ctx.fillRect(0,0,w,h);
            
            // Cursor (Mão)
            const cx = (this.p1.rawX / 640) * w; // Reverte espelho para visualizar na tela
            const cy = (this.p1.rawY / 480) * h;
            
            // Alvo
            const tx = step === 'TL' ? 100 : w - 100;
            const ty = step === 'TL' ? 100 : h - 100;

            // Instruções
            ctx.fillStyle = "#fff"; ctx.textAlign = "center";
            ctx.font = "bold 30px sans-serif";
            ctx.fillText(step === 'TL' ? "CANTO SUPERIOR ESQUERDO" : "CANTO INFERIOR DIREITO", w/2, h*0.3);
            ctx.font = "20px sans-serif";
            ctx.fillText("Leve sua raquete/mão até o alvo verde", w/2, h*0.4);

            // Alvo
            ctx.strokeStyle = "#fff"; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(tx, ty, 40, 0, Math.PI*2); ctx.stroke();

            // Cursor
            ctx.fillStyle = "#0ff"; ctx.beginPath(); ctx.arc(cx, cy, 15, 0, Math.PI*2); ctx.fill();

            // Validação
            if (Math.hypot(cx - tx, cy - ty) < 60) {
                this.calib.timer++;
                ctx.fillStyle = "#0f0"; ctx.beginPath(); ctx.arc(tx, ty, 30 * (this.calib.timer/60), 0, Math.PI*2); ctx.fill();
                
                if (this.calib.timer > 60) {
                    if (step === 'TL') {
                        this.calib.tlX = this.p1.rawX;
                        this.calib.tlY = this.p1.rawY;
                        this.state = 'CALIB_BR';
                    } else {
                        this.calib.brX = this.p1.rawX;
                        this.calib.brY = this.p1.rawY;
                        
                        // Normaliza para garantir min < max
                        if (this.calib.tlX > this.calib.brX) [this.calib.tlX, this.calib.brX] = [this.calib.brX, this.calib.tlX];
                        if (this.calib.tlY > this.calib.brY) [this.calib.tlY, this.calib.brY] = [this.calib.brY, this.calib.tlY];
                        
                        // Persiste
                        localStorage.setItem('tennis_calib', JSON.stringify(this.calib));
                        this.state = 'MENU';
                    }
                    this.calib.timer = 0;
                    if(window.Sfx) window.Sfx.play(600, 'sine', 0.1);
                }
            } else {
                this.calib.timer = 0;
            }
        },

        // -----------------------------------------------------------------
        // FÍSICA
        // -----------------------------------------------------------------
        serveBall: function(who) {
            this.state = 'RALLY';
            this.ball.active = true;
            this.bounceCount = 0;
            this.bounceSide = 0; // 0 = ninguém

            const dir = who === 'p1' ? 1 : -1;
            this.ball.vz = (45 + Math.random()*5) * dir;
            this.ball.vy = -18;
            this.ball.vx = (who === 'p1') ? this.p1.velX * 0.5 : (Math.random()-0.5)*15;
            
            if(window.Sfx) window.Sfx.play(400, 'square', 0.1);
        },

        updatePhysics: function() {
            if (!this.ball.active) return;
            const b = this.ball;

            b.vy += CONF.GRAVITY;
            b.vx *= CONF.AIR_RESISTANCE;
            b.vz *= CONF.AIR_RESISTANCE;

            b.x += b.vx; b.y += b.vy; b.z += b.vz;

            // Mesa
            if (b.y > 0) {
                if (Math.abs(b.x) < CONF.TABLE_W/2 && Math.abs(b.z) < CONF.TABLE_L/2) {
                    b.y = 0; b.vy *= -CONF.BOUNCE_DAMPING;
                    if(window.Sfx) window.Sfx.play(200, 'sine', 0.1);
                    this.spawnParticles(b.x, 0, b.z, '#fff');

                    const side = b.z < 0 ? -1 : 1;
                    if (side === this.bounceSide) this.scorePoint(side === -1 ? 'p2' : 'p1', "DOIS QUIQUES!");
                    else { this.bounceSide = side; this.bounceCount++; }
                } else if (b.y > CONF.FLOOR) {
                    const attacker = b.vz > 0 ? 'p1' : 'p2';
                    const target = attacker === 'p1' ? 1 : -1;
                    if (this.bounceSide === target) this.scorePoint(attacker, "PONTO!");
                    else this.scorePoint(attacker === 'p1' ? 'p2' : 'p1', "FORA!");
                }
            }

            // Rede
            if (Math.abs(b.z) < 20 && b.y > -CONF.NET_H) {
                b.vz *= -0.3; b.vx *= 0.5;
                if(window.Sfx) window.Sfx.play(150, 'sawtooth', 0.2);
            }
        },

        checkCollisions: function() {
            if (!this.ball.active) return;

            // P1 Hit (Zona Z: -1300 a -900)
            const p1Zone = -CONF.TABLE_L/2 - CONF.PADDLE_Z_OFFSET;
            if (this.ball.vz < 0 && this.ball.z < p1Zone + 200 && this.ball.z > p1Zone - 100) {
                const dist = Math3D.distSq({x:this.ball.x, y:this.ball.y}, {x:this.p1.gameX, y:this.p1.gameY});
                if (dist < CONF.PADDLE_SIZE**2) this.hitBall('p1');
            }
        },

        hitBall: function(who) {
            const b = this.ball;
            const isP1 = who === 'p1';
            const dir = isP1 ? 1 : -1;

            let sx = isP1 ? this.p1.velX : (Math.random()-0.5)*30;
            let sy = isP1 ? this.p1.velY : (Math.random()-0.5)*20;

            // Velocidade Base + Força do Braço
            let speed = 55 + (Math.abs(sy)*0.5) + (Math.abs(sx)*0.2);
            b.vz = Math.min(speed, CONF.MAX_SPEED) * dir;

            // Ângulo (X)
            const padX = isP1 ? this.p1.gameX : this.p2.gameX;
            b.vx = (b.x - padX) * 0.3 + (sx * 0.6);

            // Altura (Y)
            b.vy = -18 + (sy * 0.3);

            this.bounceSide = 0;
            if(window.Sfx) window.Sfx.hit();
            this.spawnParticles(b.x, b.y, b.z, isP1 ? '#0ff' : '#f00');
            if(isP1) this.shake = 10;
        },

        updateAI: function() {
            if (this.state === 'RALLY') {
                let tx = this.ball.x + Math.sin(Date.now()*0.003)*100;
                this.p2.gameX = Math3D.lerp(this.p2.gameX, tx, 0.08);
                this.p2.gameY = Math3D.lerp(this.p2.gameY, this.ball.y, 0.1);

                if (this.ball.vz > 0 && this.ball.z > (this.p2.gameZ - 100)) {
                    const dist = Math3D.distSq({x:this.ball.x, y:this.ball.y}, {x:this.p2.gameX, y:this.p2.gameY});
                    if (dist < CONF.PADDLE_SIZE**2) this.hitBall('p2');
                }
            } else if (this.state === 'SERVE' && this.server === 'p2') {
                if (Math.random() < 0.02) this.serveBall('p2');
            }
        },

        scorePoint: function(w, t) {
            this.score[w]++;
            this.msg = { txt: t, a: 1.0 };
            this.ball.active = false;
            this.server = w;
            if(this.score.p1 >= 11 || this.score.p2 >= 11) setTimeout(() => this.state = 'END', 2000);
            else setTimeout(() => this.resetBall(), 1500);
        },

        resetBall: function() {
            this.ball = { x:0, y:0, z:0, vx:0, vy:0, vz:0, active:false };
            this.bounceSide = 0;
            this.msg = { txt: this.server === 'p1' ? "SEU SAQUE" : "IA SACA", a: 1.0 };
            this.state = 'SERVE';
        },

        // -----------------------------------------------------------------
        // RENDER
        // -----------------------------------------------------------------
        renderEnvironment: function(ctx, w, h) {
            const grad = ctx.createRadialGradient(w/2, h/2, 100, w/2, h/2, w);
            grad.addColorStop(0, "#2c3e50"); grad.addColorStop(1, "#000");
            ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);

            // Grid Chão
            ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth=1; ctx.beginPath();
            for(let i=-3000; i<=3000; i+=500) {
                let p1 = Math3D.project(i, CONF.FLOOR, -3000, w, h);
                let p2 = Math3D.project(i, CONF.FLOOR, 3000, w, h);
                ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
            }
            ctx.stroke();
        },

        renderGame: function(ctx, w, h) {
            if(this.shake > 0) {
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

            // P2
            const p2Pos = Math3D.project(-this.p2.gameX, this.p2.gameY, this.p2.gameZ, w, h);
            this.drawPaddle(ctx, p2Pos, "#e74c3c", false);

            // Bola
            this.drawBall(ctx, w, h);

            // P1
            const p1Pos = Math3D.project(this.p1.gameX, this.p1.gameY, -CONF.TABLE_L/2 - CONF.PADDLE_Z_OFFSET, w, h);
            this.drawPaddle(ctx, p1Pos, "#3498db", true);

            // Partículas
            this.particles.forEach((p,i) => {
                p.x+=p.vx; p.y+=p.vy; p.z+=p.vz; p.l-=0.05;
                if(p.l<=0) this.particles.splice(i,1);
                else {
                    const pos = Math3D.project(p.x, p.y, p.z, w, h);
                    if(pos.visible) { ctx.fillStyle=p.c; ctx.globalAlpha=p.l; ctx.beginPath(); ctx.arc(pos.x, pos.y, 4*pos.s, 0, Math.PI*2); ctx.fill(); }
                }
            });
            ctx.globalAlpha=1;

            if(this.shake > 0) ctx.restore();
        },

        drawBall: function(ctx, w, h) {
            const b = this.ball;
            const pos = Math3D.project(b.x, b.y, b.z, w, h);
            if(!pos.visible) return;

            // Sombra
            if(b.y < 0) {
                const sh = Math3D.project(b.x, 0, b.z, w, h);
                ctx.fillStyle="rgba(0,0,0,0.4)"; ctx.beginPath(); ctx.ellipse(sh.x, sh.y, 15*sh.s, 6*sh.s, 0, 0, Math.PI*2); ctx.fill();
            }

            const r = CONF.BALL_R * pos.s;
            const g = ctx.createRadialGradient(pos.x-r*0.3, pos.y-r*0.3, r*0.1, pos.x, pos.y, r);
            g.addColorStop(0,"#fff"); g.addColorStop(1,"#f39c12");
            ctx.fillStyle=g; ctx.beginPath(); ctx.arc(pos.x, pos.y, r, 0, Math.PI*2); ctx.fill();
        },

        drawPaddle: function(ctx, pos, col, isP1) {
            if(!pos.visible) return;
            const s = pos.s * 1.5;
            
            // Cabo
            ctx.fillStyle="#8d6e63"; ctx.fillRect(pos.x-10*s, pos.y+50*s, 20*s, 80*s);
            // Raquete
            ctx.fillStyle="#222"; ctx.beginPath(); ctx.arc(pos.x, pos.y, 70*s, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle=col; ctx.beginPath(); ctx.arc(pos.x, pos.y, 65*s, 0, Math.PI*2); ctx.fill();
            
            if(isP1 && Math.hypot(this.p1.velX, this.p1.velY) > 8) {
                ctx.strokeStyle="rgba(255,255,255,0.4)"; ctx.lineWidth=8*s;
                ctx.beginPath(); ctx.moveTo(pos.x, pos.y);
                ctx.lineTo(pos.x - this.p1.velX*s*2, pos.y - this.p1.velY*s*2); ctx.stroke();
            }
        },

        renderCalibIntro: function(ctx, w, h) {
            ctx.fillStyle="#000"; ctx.fillRect(0,0,w,h);
            ctx.fillStyle="#fff"; ctx.textAlign="center";
            ctx.font="bold 40px sans-serif"; ctx.fillText("CALIBRAÇÃO", w/2, h*0.4);
            ctx.font="20px sans-serif"; ctx.fillText("Toque para iniciar", w/2, h*0.6);
        },

        renderMenu: function(ctx, w, h) {
            ctx.fillStyle="rgba(0,0,0,0.8)"; ctx.fillRect(0,0,w,h);
            ctx.fillStyle="#fff"; ctx.textAlign="center";
            ctx.font="bold 60px 'Russo One'"; ctx.fillText("PING PONG PRO", w/2, h*0.4);
            ctx.font="30px sans-serif"; ctx.fillText("CLIQUE PARA JOGAR", w/2, h*0.6);
        },

        renderEnd: function(ctx, w, h) {
            ctx.fillStyle="rgba(0,0,0,0.9)"; ctx.fillRect(0,0,w,h);
            const win = this.score.p1 > this.score.p2;
            ctx.fillStyle=win?"#f1c40f":"#e74c3c"; ctx.textAlign="center";
            ctx.font="bold 60px 'Russo One'"; ctx.fillText(win?"VITÓRIA!":"DERROTA", w/2, h*0.4);
            ctx.fillStyle="#fff"; ctx.font="30px sans-serif"; ctx.fillText("CLIQUE PARA REINICIAR", w/2, h*0.6);
        },

        renderHUD: function(ctx, w, h) {
            ctx.fillStyle="#000"; ctx.fillRect(w/2-100,20,200,60);
            ctx.strokeStyle="#fff"; ctx.strokeRect(w/2-100,20,200,60);
            ctx.font="bold 40px 'Russo One'"; ctx.textAlign="center";
            ctx.fillStyle="#3498db"; ctx.fillText(this.score.p1, w/2-50, 65);
            ctx.fillStyle="#fff"; ctx.fillText("-", w/2, 65);
            ctx.fillStyle="#e74c3c"; ctx.fillText(this.score.p2, w/2+50, 65);
            
            if(this.msg.a > 0) {
                this.msg.a -= 0.02;
                ctx.globalAlpha=this.msg.a; ctx.fillStyle="#000"; ctx.fillRect(0,h/2-40,w,80);
                ctx.fillStyle="#fff"; ctx.fillText(this.msg.txt, w/2, h/2+15); ctx.globalAlpha=1;
            }
        },

        spawnParticles: function(x, y, z, c) {
            for(let i=0; i<10; i++) this.particles.push({x,y,z,c, vx:(Math.random()-.5)*20, vy:(Math.random()-.5)*20, vz:(Math.random()-.5)*20, l:1});
        },
        
        resetBall: function() {
            this.ball = { x:0, y:0, z:0, vx:0, vy:0, vz:0, active:false };
            this.bounceSide = 0;
            this.msg = { txt: this.server==='p1'?"SEU SAQUE":"IA SACA", a:1 };
        }
    };

    if (window.System && window.System.registerGame) {
        window.System.registerGame('tennis', 'Table Tennis Pro', '🏓', Game, { camOpacity: 0.1 });
    }
})();
