// =============================================================================
// LÓGICA DO JOGO: OTTO SUPER RUN (CORREÇÃO TOTAL: VISÃO TRASEIRA & HITBOX)
// ARQUITETO: THIAGUINHO WII (CODE 177)
// =============================================================================

(function() {
    // --- CONFIGURAÇÕES VISUAIS & GAMEPLAY ---
    const CONF = {
        SPEED: 22,               // Velocidade do mundo (Game Loop Speed)
        HORIZON_Y: 0.38,         // Altura do horizonte (0.0 a 1.0)
        LANE_SPREAD: 0.8,        // Espalhamento das faixas na tela
        FOCAL_LENGTH: 320,       // Distância focal para perspectiva 3D
        COLORS: {
            SKY_TOP: '#5c94fc',    // Azul Mario Bros
            SKY_BOT: '#95b8ff',
            GRASS: '#00cc00',      // Verde Vibrante
            TRACK: '#d65a4e',      // Terracota (Pista Olímpica)
            LINES: '#ffffff',
            PIPE:  '#00aa00'
        }
    };

    let particles = [];
    let clouds = [];
    let decors = []; 

    const Logic = {
        // Estado
        sc: 0,
        f: 0,
        lane: 0,            // -1, 0, 1
        currentLaneX: 0,    // Valor suavizado para animação
        action: 'run',      // 'run', 'jump', 'crouch'
        
        // Calibração
        state: 'calibrate',
        baseNoseY: 0,
        calibSamples: [],
        
        // Objetos
        obs: [],
        
        // Efeitos
        hitTimer: 0,        // Piscar tela ao bater

        init: function() { 
            this.sc = 0; 
            this.f = 0; 
            this.obs = []; 
            this.state = 'calibrate';
            this.calibSamples = [];
            this.baseNoseY = 0;
            this.action = 'run';
            this.hitTimer = 0;
            
            // Reinicia sistemas de partículas e ambiente
            particles = [];
            clouds = [];
            decors = [];
            
            // Gera nuvens iniciais
            for(let i=0; i<8; i++) {
                clouds.push({ x: (Math.random()*2000)-1000, y: Math.random()*200, z: Math.random()*1000 + 500 });
            }

            window.System.msg("CALIBRANDO..."); 
        },

        update: function(ctx, w, h, pose) {
            const cx = w / 2;
            const cy = h / 2;
            const horizon = h * CONF.HORIZON_Y;
            const groundH = h - horizon;

            this.f++;

            // =================================================================
            // 1. INPUT E LÓGICA DE CONTROLE
            // =================================================================
            
            if(pose && this.hitTimer <= 0) {
                const n = pose.keypoints.find(k => k.name === 'nose');
                
                if(n && n.score > 0.4) {
                    // --- CALIBRAÇÃO ---
                    if(this.state === 'calibrate') {
                        this.calibSamples.push(n.y);
                        this.drawCalibration(ctx, w, h, cx);
                        
                        if(this.calibSamples.length > 60) {
                            const sum = this.calibSamples.reduce((a, b) => a + b, 0);
                            this.baseNoseY = sum / this.calibSamples.length;
                            this.state = 'play';
                            window.System.msg("LARGADA!"); 
                            window.Sfx.play(400, 'square', 0.5, 0.1); 
                        }
                        return 0; 
                    }
                    
                    // --- GAMEPLAY ---
                    else if(this.state === 'play') {
                        // Lane Switching (Suavizado)
                        // Espelhado: Esquerda na cam = Direita na tela
                        if(n.x < w * 0.35) this.lane = 1;       
                        else if(n.x > w * 0.65) this.lane = -1; 
                        else this.lane = 0;

                        // Detecção de Ação (Jump/Crouch)
                        const diff = n.y - this.baseNoseY;
                        const sensitivity = 45; 

                        if(diff < -sensitivity) this.action = 'jump';
                        else if (diff > sensitivity) this.action = 'crouch';
                        else this.action = 'run';
                    }
                }
            }

            // Suavização do movimento lateral do personagem (Lerp)
            const targetLaneX = this.lane * (w * 0.25);
            this.currentLaneX += (targetLaneX - this.currentLaneX) * 0.15;

            // =================================================================
            // 2. RENDERIZAÇÃO DO CENÁRIO
            // =================================================================
            
            // Céu
            const gradSky = ctx.createLinearGradient(0, 0, 0, horizon);
            gradSky.addColorStop(0, CONF.COLORS.SKY_TOP);
            gradSky.addColorStop(1, CONF.COLORS.SKY_BOT);
            ctx.fillStyle = gradSky; ctx.fillRect(0, 0, w, horizon);

            // Nuvens
            this.drawClouds(ctx, w, horizon);

            // Blocos Decorativos
            this.drawFloatingBlocks(ctx, w, horizon);

            // Arquibancada
            const standH = h * 0.12;
            ctx.fillStyle = '#666'; ctx.fillRect(0, horizon - standH, w, standH);
            // Torcida Pixelizada
            const pixelSize = 8;
            for(let py = horizon - standH; py < horizon; py += pixelSize) {
                for(let px = 0; px < w; px += pixelSize) {
                    if(Math.random() > 0.6) {
                        const cols = ['#ff3333', '#33ff33', '#3333ff', '#ffff33', '#ffffff'];
                        ctx.fillStyle = cols[Math.floor(Math.random() * cols.length)];
                        ctx.fillRect(px, py, pixelSize, pixelSize);
                    }
                }
            }

            // Gramado
            ctx.fillStyle = CONF.COLORS.GRASS;
            ctx.fillRect(0, horizon, w, groundH);

            // =================================================================
            // 3. PISTA E DECORAÇÕES
            // =================================================================
            
            ctx.save();
            ctx.translate(cx, horizon);

            // Larguras para perspectiva trapezoidal
            const trackTopW = w * 0.05; 
            const trackBotW = w * 1.1; 
            
            // Asfalto
            ctx.beginPath();
            ctx.fillStyle = CONF.COLORS.TRACK; 
            ctx.moveTo(-trackTopW, 0); ctx.lineTo(trackTopW, 0);
            ctx.lineTo(trackBotW, groundH); ctx.lineTo(-trackBotW, groundH);
            ctx.fill();

            // Linhas das Raias
            const lanes = [-1, -0.33, 0.33, 1];
            ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 4;
            
            lanes.forEach(l => {
                ctx.beginPath();
                ctx.moveTo(l * trackTopW, 0);
                ctx.lineTo(l * trackBotW, groundH);
                ctx.stroke();
            });

            ctx.restore();

            // =================================================================
            // 4. OBJETOS E COLISÃO (CORRIGIDA E PRECISA)
            // =================================================================
            
            // Spawn Obstáculos
            if(this.state === 'play' && this.f % 80 === 0) {
                const type = Math.random() < 0.5 ? 'hurdle' : 'sign';
                const obsLane = Math.floor(Math.random() * 3) - 1; 
                this.obs.push({ lane: obsLane, z: 1500, type: type, passed: false, animOffset: Math.random() * 10 });
            }

            // Spawn Decorações
            if(this.state === 'play' && this.f % 30 === 0) {
                decors.push({ z: 1500, side: -1, type: Math.random() < 0.5 ? 'pipe' : 'bush' }); 
                decors.push({ z: 1500, side: 1, type: Math.random() < 0.5 ? 'pipe' : 'bush' });
            }

            // Z-Sort (Renderizar do fundo para frente)
            const renderQueue = [];

            this.obs.forEach((o, i) => {
                o.z -= CONF.SPEED;
                if(o.z < -200) { this.obs.splice(i, 1); return; }
                renderQueue.push({ type: 'obs', obj: o, z: o.z });
            });

            decors.forEach((d, i) => {
                d.z -= CONF.SPEED;
                if(d.z < -200) { decors.splice(i, 1); return; }
                renderQueue.push({ type: 'decor', obj: d, z: d.z });
            });

            renderQueue.sort((a, b) => b.z - a.z);

            renderQueue.forEach(item => {
                const scale = CONF.FOCAL_LENGTH / (CONF.FOCAL_LENGTH + item.z);
                if(scale <= 0) return;

                const screenY = horizon + (groundH * scale); 
                const size = (w * 0.15) * scale; 
                
                if(item.type === 'decor') {
                    // Desenha decorações laterais (Canos/Arbustos)
                    const d = item.obj;
                    const spread = (w * 1.2) * scale; 
                    const sx = cx + (d.side * spread);
                    
                    if(d.type === 'pipe') {
                        const pH = size * 1.0; const pW = size * 0.6;
                        ctx.fillStyle = CONF.COLORS.PIPE; ctx.strokeStyle = '#004400'; ctx.lineWidth = 2 * scale;
                        ctx.fillRect(sx - pW/2, screenY - pH, pW, pH); ctx.strokeRect(sx - pW/2, screenY - pH, pW, pH);
                        ctx.fillRect(sx - pW/2 - (5*scale), screenY - pH, pW + (10*scale), 15*scale); ctx.strokeRect(sx - pW/2 - (5*scale), screenY - pH, pW + (10*scale), 15*scale);
                    } else {
                        ctx.fillStyle = '#228B22'; ctx.beginPath();
                        ctx.arc(sx, screenY, size*0.5, Math.PI, 0); ctx.arc(sx+size*0.4, screenY, size*0.4, Math.PI, 0); ctx.arc(sx-size*0.4, screenY, size*0.4, Math.PI, 0); ctx.fill();
                    }
                }
                else if (item.type === 'obs') {
                    const o = item.obj;
                    const currentTrackW = trackTopW + (trackBotW - trackTopW) * scale;
                    const laneSpread = currentTrackW * CONF.LANE_SPREAD;
                    const sx = cx + (o.lane * laneSpread);

                    // Sombra do Obstáculo
                    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(sx, screenY, size*0.6, size*0.2, 0, 0, Math.PI*2); ctx.fill();

                    if(o.type === 'hurdle') {
                        // Barreira (Estilo Atletismo)
                        const hH = size * 0.6;
                        ctx.lineWidth = 4 * scale; ctx.strokeStyle = '#fff';
                        ctx.beginPath(); ctx.moveTo(sx-size/2, screenY); ctx.lineTo(sx-size/2, screenY-hH); ctx.moveTo(sx+size/2, screenY); ctx.lineTo(sx+size/2, screenY-hH); ctx.stroke();
                        ctx.fillStyle = '#ff3333'; ctx.fillRect(sx-size/2-2, screenY-hH-(20*scale), size+4, 20*scale); // Barra Vermelha
                        ctx.fillStyle = '#fff'; 
                        const shift = Math.sin(this.f * 0.2 + o.animOffset) * (size*0.1);
                        ctx.fillRect(sx-size/4+shift, screenY-hH-(20*scale), size/5, 20*scale); // Listra
                        
                        if(scale > 0.5 && !o.passed) this.drawActionHint(ctx, sx, screenY - hH - 30*scale, "PULO!", scale, '#ffff00');
                    } 
                    else {
                        // Placa (Estilo Bloco ?)
                        const signH = size * 2.5; const signBox = size * 0.8;
                        ctx.fillStyle = '#333'; ctx.fillRect(sx-2*scale, screenY-signH, 4*scale, signH); // Poste
                        const boxY = screenY - signH;
                        ctx.fillStyle = '#f1c40f'; ctx.fillRect(sx-signBox/2, boxY, signBox, signBox); // Box Ouro
                        ctx.strokeStyle = '#c27c0e'; ctx.lineWidth = 3*scale; ctx.strokeRect(sx-signBox/2, boxY, signBox, signBox);
                        ctx.fillStyle = '#fff'; ctx.font=`bold ${30*scale}px monospace`; ctx.textAlign='center'; ctx.fillText("?", sx, boxY + signBox*0.7); 

                        if(scale > 0.5 && !o.passed) this.drawActionHint(ctx, sx, boxY - 20*scale, "ABAIXE!", scale, '#fff');
                    }

                    // --- COLISÃO ULTRA PRECISA (Fix para "morrer mesmo pulando") ---
                    // Reduzi a janela de Z para 15. Só colide se estiver EXATAMENTE na linha.
                    if(o.z < 15 && o.z > -15 && this.state === 'play') {
                        if(o.lane === this.lane) {
                            let hit = false;
                            
                            // Lógica rigorosa
                            if(o.type === 'hurdle') {
                                // Se for barreira, TEM QUE estar pulando
                                if(this.action !== 'jump') hit = true;
                            }
                            if(o.type === 'sign') {
                                // Se for placa, TEM QUE estar agachado
                                if(this.action !== 'crouch') hit = true;
                            }

                            if(hit) {
                                this.hitTimer = 10;
                                window.Gfx.shake(20);
                                window.Sfx.crash();
                                window.System.gameOver(this.sc);
                            } else if(!o.passed) {
                                // SUCESSO!
                                this.sc += 100;
                                window.Sfx.coin();
                                o.passed = true;
                                this.spawnParticles(sx, screenY - size, 10, '#ffff00');
                            }
                        }
                    }
                }
            });

            // =================================================================
            // 5. PERSONAGEM (VISÃO TRASEIRA REAL - SEM ROSTO)
            // =================================================================
            
            const charX = cx + this.currentLaneX;
            let charY = h * 0.85; // Base do chão

            // Física Vertical
            if(this.action === 'jump') charY -= h * 0.20; 
            if(this.action === 'crouch') charY += h * 0.05;

            this.drawBackViewCharacter(ctx, charX, charY, w, h);

            // =================================================================
            // 6. EFEITOS
            // =================================================================
            
            particles.forEach((p, i) => {
                p.x += p.vx; p.y += p.vy; p.life--; p.vy += 0.5;
                if(p.life <= 0) particles.splice(i, 1);
                else { ctx.fillStyle = p.c; ctx.fillRect(p.x, p.y, p.s, p.s); }
            });

            if(this.hitTimer > 0) {
                ctx.fillStyle = `rgba(255, 0, 0, ${this.hitTimer * 0.1})`;
                ctx.fillRect(0, 0, w, h);
                this.hitTimer--;
            }

            return this.sc;
        },

        // --- FUNÇÕES DE DESENHO AUXILIARES ---

        drawClouds: function(ctx, w, horizon) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            clouds.forEach(c => {
                c.x -= 0.5; if(c.x < -200) c.x = w + 200;
                const s = 1000 / c.z;
                const cx = c.x; const cy = c.y + (horizon * 0.2);
                ctx.beginPath(); ctx.arc(cx, cy, 30*s, 0, Math.PI*2); ctx.arc(cx+25*s, cy-10*s, 35*s, 0, Math.PI*2); ctx.arc(cx+50*s, cy, 30*s, 0, Math.PI*2); ctx.fill();
            });
        },

        drawFloatingBlocks: function(ctx, w, horizon) {
            const blockSize = 30; const offset = (this.f * 0.5) % 1000; const blockY = horizon * 0.5;
            ctx.fillStyle = '#b85c00'; ctx.strokeStyle = '#000';
            for(let i=0; i<w; i+= 300) {
                const bx = (i - offset + 1000) % (w + 200) - 100;
                ctx.fillRect(bx, blockY, blockSize, blockSize); ctx.strokeRect(bx, blockY, blockSize, blockSize);
                if(i % 600 === 0) { 
                    ctx.fillStyle = '#f1c40f'; ctx.fillRect(bx+35, blockY - 40, blockSize, blockSize); ctx.strokeRect(bx+35, blockY - 40, blockSize, blockSize); ctx.fillStyle = '#b85c00';
                }
            }
        },

        // --- DESENHO DO PERSONAGEM (COSTAS VERDADEIRAS) ---
        drawBackViewCharacter: function(ctx, x, y, w, h) {
            const s = w * 0.0035; // Escala Chibi
            
            // Sombra no chão
            const groundY = h * 0.88;
            const shadowS = this.action === 'jump' ? s * 0.5 : s;
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.beginPath(); ctx.ellipse(x, groundY, 45*shadowS, 12*shadowS, 0, 0, Math.PI*2); ctx.fill();

            ctx.save();
            ctx.translate(x, y);
            ctx.scale(s, s);

            const cycle = Math.sin(this.f * 0.4) * 20;
            
            // CORES
            const C_SKIN = '#ffccaa';
            const C_SHIRT = '#ff0000'; // Vermelho
            const C_OVERALL = '#0000ff'; // Azul
            const C_HAIR = '#4a3222'; // Castanho escuro
            const C_BOOT = '#654321';
            const C_BUTTON = '#ffff00';

            // 1. PERNAS (Azul)
            ctx.fillStyle = C_OVERALL;
            if(this.action === 'run') {
                this.drawLimb(ctx, -15, 0, 14, 30, cycle); // Esq
                this.drawLimb(ctx, 15, 0, 14, 30, -cycle); // Dir
            } else if (this.action === 'jump') {
                this.drawLimb(ctx, -15, -10, 14, 25, -20);
                this.drawLimb(ctx, 15, 5, 14, 35, 10);
            } else { // Crouch
                this.drawLimb(ctx, -20, -5, 14, 20, -40);
                this.drawLimb(ctx, 20, -5, 14, 20, 40);
            }

            // 2. BOTAS (Visão Traseira - Sola visível quando levanta)
            const drawBootBack = (bx, by, lift) => {
                ctx.fillStyle = C_BOOT;
                this.drawOval(ctx, bx, by, 16, 12); // Calcanhar
                if(lift > 5) { // Sola Cinza se o pé estiver no ar
                    ctx.fillStyle = '#333';
                    this.drawOval(ctx, bx, by+2, 14, 10);
                }
            };
            if(this.action === 'run') {
                drawBootBack(-15 + (cycle*0.8), 30 - (Math.abs(cycle)*0.2), cycle);
                drawBootBack(15 - (cycle*0.8), 30 - (Math.abs(cycle)*0.2), -cycle);
            } else if (this.action === 'jump') {
                drawBootBack(-18, 15, 10); drawBootBack(18, 40, 0);  
            } else {
                drawBootBack(-25, 15, 0); drawBootBack(25, 15, 0);
            }

            // 3. CORPO (COSTAS - Alças Cruzadas)
            const bodyY = this.action === 'crouch' ? -20 : -40;
            
            // Camisa Vermelha (Base)
            ctx.fillStyle = C_SHIRT;
            ctx.beginPath(); ctx.arc(0, bodyY, 28, 0, Math.PI*2); ctx.fill();
            
            // Macacão Azul (Costas)
            ctx.fillStyle = C_OVERALL;
            ctx.fillRect(-20, bodyY, 40, 30);
            ctx.beginPath(); ctx.arc(0, bodyY+30, 21, 0, Math.PI, false); ctx.fill(); 
            
            // Alças (Suspensórios nas costas formando um X ou V)
            ctx.fillStyle = C_OVERALL; 
            ctx.beginPath(); ctx.moveTo(-15, bodyY-15); ctx.lineTo(15, bodyY+15); ctx.lineTo(5, bodyY+15); ctx.lineTo(-25, bodyY-15); ctx.fill(); 
            ctx.beginPath(); ctx.moveTo(15, bodyY-15); ctx.lineTo(-15, bodyY+15); ctx.lineTo(-5, bodyY+15); ctx.lineTo(25, bodyY-15); ctx.fill(); 
            
            // Botões das alças (nas costas fica o ajuste)
            ctx.fillStyle = C_BUTTON;
            ctx.beginPath(); ctx.arc(-18, bodyY-10, 3, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.arc(18, bodyY-10, 3, 0, Math.PI*2); ctx.fill();

            // 4. BRAÇOS (Movimento de corrida)
            ctx.fillStyle = C_SHIRT;
            const armY = bodyY - 5;
            const armSwing = this.action === 'run' ? -cycle : 0;
            // Esq
            ctx.beginPath(); ctx.ellipse(-28 + (armSwing*0.5), armY + 10, 10, 18, 0.5 + (armSwing*0.02), 0, Math.PI*2); ctx.fill();
            // Dir
            ctx.beginPath(); ctx.ellipse(28 - (armSwing*0.5), armY + 10, 10, 18, -0.5 - (armSwing*0.02), 0, Math.PI*2); ctx.fill();
            // Luvas Brancas (Mãos)
            ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.arc(-32 + (armSwing*0.8), armY+25, 10, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.arc(32 - (armSwing*0.8), armY+25, 10, 0, Math.PI*2); ctx.fill();

            // 5. CABEÇA (VISÃO TRASEIRA - NUCA)
            const headY = bodyY - 25;
            
            // Pele (Base da cabeça)
            ctx.fillStyle = C_SKIN;
            ctx.beginPath(); ctx.arc(0, headY, 26, 0, Math.PI*2); ctx.fill();
            
            // Cabelo (Cobre a nuca na parte inferior)
            // Aqui garantimos que parece a parte de trás
            ctx.fillStyle = C_HAIR;
            ctx.beginPath(); 
            ctx.arc(0, headY+2, 25, 0, Math.PI, false); // Meia lua inferior
            ctx.fill();
            
            // Recorte pequeno do pescoço
            ctx.fillStyle = C_SKIN; ctx.beginPath(); ctx.ellipse(0, headY+18, 8, 6, 0, 0, Math.PI*2); ctx.fill();

            // 6. BONÉ (Cúpula Vermelha cobrindo o topo)
            ctx.fillStyle = C_SHIRT; // Vermelho
            ctx.beginPath(); ctx.arc(0, headY-5, 27, Math.PI, 0); ctx.fill(); // Cúpula
            
            // Detalhe: Ajuste de plástico do boné atrás
            ctx.fillStyle = '#cc0000'; 
            ctx.beginPath(); ctx.rect(-10, headY-5, 20, 4); ctx.fill();

            // *** SEM OLHOS, SEM NARIZ, SEM BIGODE ***

            ctx.restore();

            // HUD
            if(this.state === 'play') {
                ctx.font = "bold 26px 'Chakra Petch'"; ctx.textAlign = "center";
                ctx.shadowColor = "black"; ctx.shadowBlur = 4;
                if(this.action === 'jump') { ctx.fillStyle = "#00ff00"; ctx.fillText("PULO!", x, y - (h*0.25)); }
                else if(this.action === 'crouch') { ctx.fillStyle = "#ffff00"; ctx.fillText("AGACHADO", x, y - (h*0.22)); }
                ctx.shadowBlur = 0;
            }
        },

        drawLimb: function(ctx, x, y, w, h, angleDeg) {
            ctx.save(); ctx.translate(x, y); ctx.rotate(angleDeg * Math.PI / 180);
            ctx.beginPath(); ctx.ellipse(0, h/2, w/2, h/2, 0, 0, Math.PI*2); ctx.fill(); ctx.restore();
        },

        drawOval: function(ctx, x, y, w, h) {
            ctx.beginPath();
            ctx.ellipse(x, y, w/2, h/2, 0, 0, Math.PI*2); ctx.fill();
        },

        drawCalibration: function(ctx, w, h, cx) {
            ctx.fillStyle = "rgba(0,0,0,0.85)"; ctx.fillRect(0,0,w,h);
            ctx.fillStyle = "#fff"; ctx.font = "bold 30px 'Russo One'"; ctx.textAlign = "center";
            ctx.fillText("FIQUE EM POSIÇÃO NEUTRA", cx, h*0.4);
            const pct = this.calibSamples.length / 60;
            ctx.fillStyle = "#3498db"; ctx.fillRect(cx - 150, h*0.5, 300 * pct, 20);
            ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.strokeRect(cx - 150, h*0.5, 300, 20);
        },

        drawActionHint: function(ctx, x, y, text, scale, color) {
            ctx.font = `bold ${16*scale}px Arial`; ctx.textAlign='center';
            ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillText(text, x+2, y+2);
            ctx.fillStyle = color; ctx.fillText(text, x, y);
        },

        spawnParticles: function(x, y, count, color) {
            for(let i=0; i<count; i++) {
                particles.push({ x: x, y: y, vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 1.0) * 10, life: 20 + Math.random() * 10, c: color, s: 4 + Math.random() * 4 });
            }
        }
    };

    // --- REGISTRO NO SISTEMA ---
    const regLoop = setInterval(() => {
        if(window.System && window.System.registerGame) {
            window.System.registerGame('run', 'Otto Super Run', '🏃', Logic, {camOpacity: 0.3, showWheel: false});
            clearInterval(regLoop);
        }
    }, 100);

})();
