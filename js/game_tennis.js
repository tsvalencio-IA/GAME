// =============================================================================
// LÓGICA DO JOGO: PING PONG PRO (FIXED REACH & SPEED)
// ARQUITETO: SENIOR DEV V3
// =============================================================================

(function() {
    // Configurações da Mesa e Física
    const TABLE_W = 500;
    const TABLE_L = 1200;
    const NET_Z = 600;
    const BALL_RADIUS = 12;
    
    const Logic = {
        state: 'MODE_SELECT',
        score: 0,
        ball: { x: 0, y: -200, z: 1000, vx: 0, vy: 0, vz: 0 },
        
        // Calibração
        hand: { x: 0, y: 0 },
        handCenter: { x: 0, y: 0 },
        handRaw: { x: 0, y: 0 },
        handScale: 3.5, // Multiplicador de movimento (Magic Number para alcançar cantos)
        
        calibTimer: 0, particles: [],

        init: function() {
            this.score = 0;
            this.state = 'MODE_SELECT';
            this.resetBall(false);
            this.particles = [];
            window.System.msg("PING PONG");
        },

        resetBall: function(playerServe) {
            const speed = 25 + (this.score * 1.5); // Velocidade aumenta com score
            this.ball = {
                x: (Math.random() - 0.5) * 250,
                y: -300,
                z: playerServe ? 1100 : 100,
                vx: (Math.random() - 0.5) * 8,
                vy: 5,
                vz: playerServe ? -speed : speed
            };
        },

        update: function(ctx, w, h, pose) {
            const cx = w / 2; const cy = h / 2;

            // 1. INPUT
            if (pose && pose.keypoints) {
                const rw = pose.keypoints.find(k => k.name === 'right_wrist' || k.name === 'left_wrist');
                if (rw && rw.score > 0.3) {
                    const m = window.Gfx.map(rw, w, h);
                    this.handRaw = m;
                    
                    if (this.state === 'PLAY') {
                        // Aplica escala relativa ao centro calibrado
                        this.hand.x = (m.x - this.handCenter.x) * this.handScale;
                        this.hand.y = (m.y - this.handCenter.y) * this.handScale;
                    }
                }
            }

            if (this.state === 'MODE_SELECT') { this.drawMenu(ctx, w, h); return 0; }
            if (this.state === 'CALIBRATE') { this.drawCalibration(ctx, w, h, cx, cy); return 0; }

            // 2. FÍSICA
            const b = this.ball;
            b.x += b.vx; b.y += b.vy; b.z += b.vz;

            // Gravidade e Quique
            if (b.y < 100) b.vy += 0.8;
            else if (b.vy > 0 && b.z > 0 && b.z < TABLE_L && Math.abs(b.x) < TABLE_W) {
                b.vy *= -0.85; // Quique
                window.Sfx.play(250, 'sine', 0.05, 0.05);
            }

            // Colisão Jogador (Raquete)
            if (b.z > 1000 && b.z < 1200 && b.vz > 0) {
                // Hitbox circular na mão
                const scale = 500 / (500 + b.z);
                const screenBx = b.x * scale;
                const screenBy = (b.y + 150) * scale;
                
                // Distância entre bola (projetada) e mão
                const dist = Math.hypot(screenBx - this.hand.x, screenBy - this.hand.y);
                
                if (dist < 100) { // Hitbox generosa
                    this.score++;
                    window.Sfx.hit();
                    
                    // Rebater
                    b.vz = -(Math.abs(b.vz) + 2); // Acelera
                    b.vy = -15; // Arco
                    b.vx = (screenBx - this.hand.x) * 0.5; // Efeito lateral
                    
                    this.spawnParticles(cx + screenBx, cy + screenBy, '#ffaa00');
                }
            }

            // IA (Adversário simples no fundo)
            if (b.z < 100 && b.vz < 0) {
                b.vz *= -1;
                b.vx = (Math.random() - 0.5) * 15;
                window.Sfx.play(200, 'square', 0.1, 0.05);
            }

            // Game Over
            if (b.z > 1400) window.System.gameOver(this.score);

            // 3. RENDER
            this.drawRoom(ctx, w, h);
            this.drawTable(ctx, cx, cy);
            this.drawBall(ctx, cx, cy);
            
            // Raquete (segue a mão)
            const rx = cx + this.hand.x;
            const ry = cy + this.hand.y;
            this.drawRacket(ctx, rx, ry);

            this.renderParticles(ctx);

            return this.score;
        },

        drawRoom: function(ctx, w, h) {
            const grad = ctx.createLinearGradient(0,0,0,h);
            grad.addColorStop(0, '#2c3e50'); grad.addColorStop(1, '#000');
            ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);
        },

        drawTable: function(ctx, cx, cy) {
            const project = (x, y, z) => {
                const s = 500 / (500 + z);
                return { x: cx + x * s, y: cy + (y + 150) * s };
            };

            const p1 = project(-TABLE_W, 0, TABLE_L); const p2 = project(TABLE_W, 0, TABLE_L);
            const p3 = project(TABLE_W, 0, 0); const p4 = project(-TABLE_W, 0, 0);

            // Tampo Azul
            ctx.fillStyle = '#2980b9'; ctx.beginPath();
            ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y);
            ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.stroke();

            // Rede
            const n1 = project(-TABLE_W, -50, NET_Z); const n2 = project(TABLE_W, -50, NET_Z);
            const n3 = project(TABLE_W, 0, NET_Z); const n4 = project(-TABLE_W, 0, NET_Z);
            ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath();
            ctx.moveTo(n1.x, n1.y); ctx.lineTo(n2.x, n2.y); ctx.lineTo(n3.x, n3.y); ctx.lineTo(n4.x, n4.y); ctx.fill();
        },

        drawBall: function(ctx, cx, cy) {
            const b = this.ball;
            const s = 500 / (500 + b.z);
            const bx = cx + b.x * s; const by = cy + (b.y + 150) * s;
            
            // Sombra
            ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); 
            ctx.ellipse(bx, cy + 150*s, 10*s, 3*s, 0, 0, Math.PI*2); ctx.fill();

            // Bola
            ctx.fillStyle = '#f39c12'; ctx.beginPath(); ctx.arc(bx, by, BALL_RADIUS*s, 0, Math.PI*2); ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
        },

        drawRacket: function(ctx, x, y) {
            ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.arc(x, y, 40, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = '#ecf0f1'; ctx.beginPath(); ctx.arc(x, y, 40, 0, Math.PI*2); ctx.stroke();
            ctx.fillStyle = '#8e44ad'; ctx.fillRect(x-5, y+35, 10, 30); // Cabo
        },

        drawCalibration: function(ctx, w, h, cx, cy) {
            ctx.fillStyle = 'rgba(0,0,0,0.9)'; ctx.fillRect(0,0,w,h);
            ctx.strokeStyle = '#00ffff'; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.arc(cx, cy, 60, 0, Math.PI*2); ctx.stroke();
            ctx.fillStyle = '#fff'; ctx.textAlign='center'; ctx.font="20px sans-serif";
            ctx.fillText("ALINHE SUA MÃO NO CENTRO", cx, cy-80);
            
            const dist = Math.hypot(this.handRaw.x - cx, this.handRaw.y - cy);
            if(dist < 60) {
                this.calibTimer++;
                ctx.fillStyle = '#0f0'; ctx.fillRect(cx-50, cy+80, this.calibTimer*2, 10);
                if(this.calibTimer > 50) {
                    this.handCenter = { ...this.handRaw };
                    this.state = 'PLAY';
                    window.System.msg("PLAY!");
                }
            } else this.calibTimer = 0;
            
            ctx.fillStyle='#0ff'; ctx.beginPath(); ctx.arc(this.handRaw.x, this.handRaw.y, 10, 0, Math.PI*2); ctx.fill();
        },

        drawMenu: function(ctx, w, h) {
            ctx.fillStyle = '#000'; ctx.fillRect(0,0,w,h);
            ctx.fillStyle = '#fff'; ctx.textAlign='center'; ctx.font="bold 40px 'Russo One'";
            ctx.fillText("PING PONG PRO", w/2, h/2);
            ctx.font="20px sans-serif"; ctx.fillText("CLIQUE PARA INICIAR", w/2, h/2+40);
            if(!window.System.canvas.onclick) {
                window.System.canvas.onclick = () => {
                    this.state = 'CALIBRATE';
                    window.System.canvas.onclick = null;
                };
            }
        },

        spawnParticles: function(x, y, color) {
            for(let i=0; i<5; i++) this.particles.push({x, y, vx:(Math.random()-0.5)*10, vy:(Math.random()-0.5)*10, life:1, color});
        },
        renderParticles: function(ctx) {
            this.particles.forEach((p,i) => {
                p.x+=p.vx; p.y+=p.vy; p.life-=0.1;
                if(p.life<=0) this.particles.splice(i,1);
                else { ctx.globalAlpha=p.life; ctx.fillStyle=p.color; ctx.fillRect(p.x,p.y,4,4); }
            });
            ctx.globalAlpha=1;
        }
    };

    window.System.registerGame('tennis', 'Ping Pong', '🏓', Logic, {camOpacity: 0.1});
})();
