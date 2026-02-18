// =============================================================================
// TABLE TENNIS: FIRST PARTY EDITION (V10 - GOLD MASTER PATCHED)
// ARQUITETO: SENIOR GAME ENGINE ARCHITECT
// STATUS: 10/10 STABLE - OFFICIAL RULES, PHYSICS SIMULATION, AI DYNAMIC
// =============================================================================

(function() {
    "use strict";

    // -----------------------------------------------------------------
    // 1. CONFIGURAÇÕES & TUNING (AAA FEEL)
    // -----------------------------------------------------------------
    const CONF = {
        // Dimensões Oficiais (Escala ajustada para gameplay)
        TABLE_W: 1525,  
        TABLE_L: 2740,  
        NET_H: 152,     
        FLOOR_Y: 760,   

        // Física Avançada
        BALL_R: 22,           // [PATCH] Definido oficialmente
        GRAVITY: 0.58,        // Gravidade levemente "arcade"
        AIR_DRAG: 0.994,      // Resistência do ar
        BOUNCE_LOSS: 0.78,    // Restituição de energia
        FRICTION_TABLE: 0.96, // Atrito no quique (spin reaction)
        MAGNUS_FORCE: 0.14,   // Força da curva
        MAX_SPEED: 190,       // Teto de velocidade física

        // Raquete e Jogador
        PADDLE_SIZE: 140,
        PADDLE_Z_OFFSET: 300,
        SWING_FORCE_MULT: 3.2, // Multiplicador de input -> força
        SMASH_TRIGGER: 28,     // Velocidade para considerar Smash

        // Câmera
        CAM_Y: -1350,
        CAM_Z: -1750,
        FOV: 900
    };

    const AI_LEVELS = {
        'EASY':   { accel: 0.04, maxSpeed: 12, error: 280, reactDelay: 25 },
        'NORMAL': { accel: 0.08, maxSpeed: 22, error: 90,  reactDelay: 12 },
        'HARD':   { accel: 0.22, maxSpeed: 38, error: 15,  reactDelay: 4 }
    };

    // -----------------------------------------------------------------
    // 2. MATH & PHYSICS KERNEL
    // -----------------------------------------------------------------
    const MathCore = {
        project: (x, y, z, w, h) => {
            const depth = (z - CONF.CAM_Z);
            if (depth <= 10) return { x: -9999, y: -9999, s: 0, visible: false }; // Proteção Z
            const scale = CONF.FOV / depth;
            return {
                x: (x * scale) + w/2,
                y: ((y - CONF.CAM_Y) * scale) + h/2,
                s: scale,
                visible: true,
                depth: depth
            };
        },
        lerp: (a, b, t) => a + (b - a) * t,
        clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
        
        // [PATCH] Função faltante adicionada
        dist3d: (x1, y1, z1, x2, y2, z2) => {
            const dx = x1 - x2;
            const dy = y1 - y2;
            const dz = z1 - z2;
            return Math.sqrt(dx*dx + dy*dy + dz*dz);
        },

        // Simulação de trajetória futura para IA (Physics Step-ahead)
        simulateTrajectory: (b, targetZ) => {
            // Clona o estado da bola para não afetar o jogo real
            let sx = b.x, sy = b.y, sz = b.z;
            let svx = b.vx, svy = b.vy, svz = b.vz;
            
            // [PATCH] Spin local para decaimento na simulação
            let sSpinX = b.spinX;
            let sSpinY = b.spinY;
            
            let limit = 200; // Evita loop infinito

            while (sz < targetZ && limit > 0) {
                limit--;
                
                // Aplica forças (versão simplificada da updatePhysics)
                // [PATCH] Usa spin local
                svx += (sSpinY * svz * CONF.MAGNUS_FORCE * 0.01);
                svy += (sSpinX * svz * CONF.MAGNUS_FORCE * 0.01) + CONF.GRAVITY;
                
                svx *= CONF.AIR_DRAG; svy *= CONF.AIR_DRAG; svz *= CONF.AIR_DRAG;
                
                // [PATCH] Decaimento de spin na simulação
                sSpinX *= 0.99;
                sSpinY *= 0.99;

                sx += svx; sy += svy; sz += svz;

                // Bounce Simulation
                if (sy > 0 && Math.abs(sx) < CONF.TABLE_W/2 && Math.abs(sz) < CONF.TABLE_L/2) {
                    sy = 0;
                    svy = -svy * CONF.BOUNCE_LOSS;
                }
            }
            return sx; // Retorna onde X estará quando Z chegar no alvo
        }
    };

    // -----------------------------------------------------------------
    // 3. GAME ENGINE
    // -----------------------------------------------------------------
    const Game = {
        state: 'INIT', 
        difficulty: 'NORMAL',
        
        // Player 1 (Humano)
        p1: { 
            gameX: 0, gameY: 0, 
            prevX: 0, prevY: 0, 
            velX: 0, velY: 0 
        },
        
        // Player 2 (IA)
        p2: { 
            gameX: 0, gameY: 0, gameZ: CONF.TABLE_L/2 + 200,
            currVelX: 0, currVelZ: 0, // Inércia
            targetX: 0, targetZ: 0,
            reactionTimer: 0,
            lastSpeed: 0, recalcTimer: 0 // [PATCH] Variáveis IA dinâmica
        },

        ball: { 
            x: 0, y: 0, z: 0, 
            vx: 0, vy: 0, vz: 0, 
            spinX: 0, spinY: 0,
            active: false,
            trail: [] 
        },

        // Estado Global
        score: { p1: 0, p2: 0 },
        server: 'p1',
        bounceCount: 0,
        lastHitter: null,
        rallyCount: 0,

        // Efeitos Visuais
        shake: 0,
        flash: 0,
        particles: [],
        msgs: [],
        calib: { tlX: 0, tlY: 0, brX: 640, brY: 480 },

        init: function() {
            this.state = 'MENU';
            this.score = { p1: 0, p2: 0 };
            
            const saved = localStorage.getItem('tennis_calib_v2');
            if(saved) this.calib = JSON.parse(saved);

            if(window.System && window.System.msg) window.System.msg("TABLE TENNIS PRO V10");
            this.setupInput();
        },

        setupInput: function() {
            if(!window.System.canvas) return;
            window.System.canvas.onclick = (e) => {
                const rect = window.System.canvas.getBoundingClientRect();
                const my = e.clientY - rect.top;
                const h = window.System.canvas.height;

                if (this.state === 'MENU') {
                    if (my > h * 0.75) {
                        this.state = 'CALIB_TL';
                    } else {
                        if (my < h * 0.4) this.difficulty = 'EASY';
                        else if (my < h * 0.6) this.difficulty = 'NORMAL';
                        else this.difficulty = 'HARD';
                        
                        this.score = { p1: 0, p2: 0 };
                        this.state = 'SERVE';
                        this.resetRound();
                        window.Sfx.click();
                    }
                } else if (this.state.startsWith('CALIB')) {
                    this.handleCalibration();
                } else if (this.state === 'END') {
                    this.init();
                }
            };
        },

        handleCalibration: function() {
            // Calibração segura (Requisito Estrutural 2)
            if (this.state === 'CALIB_TL') {
                this.state = 'CALIB_BR';
                window.Sfx.click();
            } else if (this.state === 'CALIB_BR') {
                if(this.p1.currRawX !== undefined) {
                    // Proteção contra calibração inválida (divisão por zero)
                    if (Math.abs(this.calib.tlX - this.calib.brX) < 10) this.calib.brX = this.calib.tlX + 10;
                    if (Math.abs(this.calib.tlY - this.calib.brY) < 10) this.calib.brY = this.calib.tlY + 10;
                    
                    localStorage.setItem('tennis_calib_v2', JSON.stringify(this.calib));
                    this.state = 'MENU';
                    window.Sfx.coin();
                }
            }
        },

        // -----------------------------------------------------------------
        // UPDATE LOOP
        // -----------------------------------------------------------------
        update: function(ctx, w, h, pose) {
            // 1. Inputs & IA
            this.processInput(pose);
            
            // 2. Game Logic
            if (this.state === 'RALLY' || this.state === 'SERVE') {
                this.updatePhysics();
                this.updateAI();
                this.updateEffects();
            }

            // 3. Render Pipeline
            // Fundo
            this.renderEnvironment(ctx, w, h);

            // Jogo (Com Screen Shake Isolado - Requisito 1)
            ctx.save();
            if(this.shake > 0) {
                const s = this.shake;
                // Shake translacional aleatório
                ctx.translate((Math.random()-0.5)*s, (Math.random()-0.5)*s);
                // Leve rotação para impacto extra
                ctx.rotate((Math.random()-0.5) * s * 0.002);
            }
            
            if (this.state !== 'MENU' && this.state !== 'END' && !this.state.startsWith('CALIB')) {
                this.renderGame(ctx, w, h);
            }
            ctx.restore(); // FIM DO SHAKE

            // UI Layers (Não sofrem shake)
            if (this.flash > 0) {
                ctx.fillStyle = `rgba(255,255,255,${this.flash})`;
                ctx.fillRect(0,0,w,h);
            }

            if (this.state === 'MENU') this.renderMenu(ctx, w, h);
            else if (this.state.startsWith('CALIB')) this.renderCalibration(ctx, w, h);
            else if (this.state === 'END') this.renderEndScreen(ctx, w, h);
            else this.renderHUD(ctx, w, h);

            return this.score.p1;
        },

        // -----------------------------------------------------------------
        // INPUT PROCESSING (ROBUST)
        // -----------------------------------------------------------------
        processInput: function(pose) {
            if (!pose || !pose.keypoints) return;

            let wrist = pose.keypoints.find(k => k.name === 'right_wrist' && k.score > 0.3);
            if (!wrist) wrist = pose.keypoints.find(k => k.name === 'left_wrist' && k.score > 0.3);

            if (wrist) {
                const rawX = 640 - wrist.x; // Mirror
                const rawY = wrist.y;
                this.p1.currRawX = rawX; this.p1.currRawY = rawY;

                if (this.state.startsWith('CALIB')) {
                    if (this.state === 'CALIB_TL') { this.calib.tlX = rawX; this.calib.tlY = rawY; }
                    if (this.state === 'CALIB_BR') { this.calib.brX = rawX; this.calib.brY = rawY; }
                } else {
                    // Proteção de divisão (Requisito 2)
                    const rangeX = (this.calib.brX - this.calib.tlX) || 1;
                    const rangeY = (this.calib.brY - this.calib.tlY) || 1;

                    const nx = (rawX - this.calib.tlX) / rangeX;
                    const ny = (rawY - this.calib.tlY) / rangeY;

                    const targetX = MathCore.lerp(-CONF.TABLE_W * 0.75, CONF.TABLE_W * 0.75, nx);
                    const targetY = MathCore.lerp(-700, 100, ny); // Y negativo é para cima

                    // Low-pass filter para suavizar jitter da câmera
                    this.p1.gameX = MathCore.lerp(this.p1.gameX, targetX, 0.4);
                    this.p1.gameY = MathCore.lerp(this.p1.gameY, targetY, 0.4);

                    // Velocidade Instantânea
                    const ivx = this.p1.gameX - this.p1.prevX;
                    const ivy = this.p1.gameY - this.p1.prevY;
                    
                    this.p1.velX = ivx;
                    this.p1.velY = ivy;

                    this.p1.prevX = this.p1.gameX;
                    this.p1.prevY = this.p1.gameY;

                    // Toss logic (Saque)
                    if (this.state === 'SERVE' && this.server === 'p1') {
                        this.ball.x = this.p1.gameX;
                        this.ball.y = this.p1.gameY - 40;
                        this.ball.z = -CONF.TABLE_L/2 - 50;
                        if (this.p1.velY < -12) this.hitBall('p1', 0, 0); // Saque detectado
                    }
                }
            }
        },

        // -----------------------------------------------------------------
        // PHYSICS ENGINE (V10)
        // -----------------------------------------------------------------
        updatePhysics: function() {
            if (!this.ball.active) return;
            const b = this.ball;

            // 1. Aerodinâmica Avançada (Magnus + Drag)
            // Topspin (spinX > 0) pressiona bola pra baixo
            // Sidespin (spinY) empurra lateralmente
            const magX = b.spinY * b.vz * CONF.MAGNUS_FORCE * 0.01;
            const magY = b.spinX * b.vz * CONF.MAGNUS_FORCE * 0.01;

            b.vx += magX;
            b.vy += magY + CONF.GRAVITY;

            // Drag aéreo (simulado não-linear para realismo)
            b.vx *= CONF.AIR_DRAG;
            b.vy *= CONF.AIR_DRAG;
            b.vz *= CONF.AIR_DRAG;

            // Decaimento do Spin
            b.spinX *= 0.99;
            b.spinY *= 0.99;

            // Integração
            b.x += b.vx;
            b.y += b.vy;
            b.z += b.vz;

            // Trail System (Otimizado)
            if (this.rallyCount > 0 && Math.abs(b.vz) > 20) {
                this.ball.trail.unshift({x:b.x, y:b.y, z:b.z, a: 0.8});
                if(this.ball.trail.length > 8) this.ball.trail.pop();
            }

            // 2. Colisão Mesa (Com Atrito e Spin Check)
            if (b.y > 0) { // Nível 0 é a mesa
                if (Math.abs(b.x) <= CONF.TABLE_W/2 && Math.abs(b.z) <= CONF.TABLE_L/2) {
                    // Hit Mesa
                    b.y = 0;
                    b.vy = -b.vy * CONF.BOUNCE_LOSS;
                    
                    // A mesa "morde" a bola baseada no spin (Kick)
                    // Se bola tem sidespin, ela espirra pro lado ao quicar
                    b.vx += b.spinY * 0.6; 
                    // Se bola tem topspin, ela acelera pra frente (kick), backspin freia
                    b.vz += b.spinX * 0.4; 

                    window.Sfx.play(200 + (Math.abs(b.vz)*2), 'sine', 0.05);
                    this.spawnParticles(b.x, 0, b.z, 4, '#fff');

                    // Regra de validação
                    const side = b.z < 0 ? 'p1' : 'p2';
                    if (this.lastHitter === side) {
                        this.scorePoint(side === 'p1' ? 'p2' : 'p1', "2 TOQUES"); // Falha
                    } else if (this.bounceCount >= 1) {
                         this.scorePoint(side === 'p1' ? 'p2' : 'p1', "2 QUIQUES"); // Falha
                    } else {
                        this.bounceCount++;
                    }
                } else if (b.y > CONF.FLOOR_Y) {
                    this.handleFloor();
                }
            }

            // 3. Colisão Rede
            if (Math.abs(b.z) < 15 && b.y > -CONF.NET_H && b.y < 0) {
                b.vz *= -0.3; // Morre
                b.vx *= 0.5;
                this.shake = 6;
                window.Sfx.play(100, 'sawtooth', 0.1);
            }

            // 4. Detecção Raquetes
            this.checkPaddleHit();
        },

        checkPaddleHit: function() {
            // Player 1
            const p1Z = -CONF.TABLE_L/2 - CONF.PADDLE_Z_OFFSET;
            if (this.ball.vz < 0 && this.ball.z > p1Z - 150 && this.ball.z < p1Z + 150) {
                const dist = MathCore.dist3d(this.ball.x, this.ball.y, 0, this.p1.gameX, this.p1.gameY, 0);
                if (dist < CONF.PADDLE_SIZE) this.hitBall('p1', this.ball.x - this.p1.gameX, this.ball.y - this.p1.gameY);
            }

            // Player 2 (IA)
            const p2Z = this.p2.gameZ;
            if (this.ball.vz > 0 && this.ball.z > p2Z - 150 && this.ball.z < p2Z + 150) {
                 const dist = MathCore.dist3d(this.ball.x, this.ball.y, 0, this.p2.gameX, this.p2.gameY, 0);
                 if (dist < CONF.PADDLE_SIZE) this.hitBall('p2', this.ball.x - this.p2.gameX, this.ball.y - this.p2.gameY);
            }
        },

        hitBall: function(who, offX, offY) {
            const isP1 = who === 'p1';
            const paddle = isP1 ? this.p1 : this.p2;
            
            // Vetor de movimento da raquete
            let pVelX = isP1 ? paddle.velX : paddle.currVelX;
            let pVelY = isP1 ? paddle.velY : (paddle.gameY - paddle.prevY); // Aproximação para IA

            // Força Resultante
            const speed = Math.sqrt(pVelX**2 + pVelY**2);
            let force = 45 + (speed * CONF.SWING_FORCE_MULT);
            
            // SMASH?
            let isSmash = speed > CONF.SMASH_TRIGGER;
            if (isSmash) {
                force *= 1.35;
                this.shake = 18; // Shake forte
                this.flash = 0.2; // Flash branco
                this.addMsg("SMASH!", isP1 ? "#0ff" : "#f00");
                window.Sfx.crash();
            } else {
                window.Sfx.hit();
                this.shake = 3; // Shake leve
            }

            // Direção Física
            this.ball.vz = Math.abs(force) * (isP1 ? 1 : -1);
            this.ball.vx = (offX * 0.25) + (pVelX * 0.6); // Mistura ângulo de contato + movimento braço
            this.ball.vy = -18 + (pVelY * 0.5) + (offY * 0.15); // Arco natural

            // SPIN (A Alma do Tênis)
            // Se mover lateralmente = Side Spin
            // Se mover verticalmente = Top/Back Spin
            this.ball.spinY = pVelX * 0.9;
            this.ball.spinX = pVelY * 0.9;

            // Estado
            this.lastHitter = who;
            this.bounceCount = 0;
            this.rallyCount++;
            this.ball.active = true;

            // Efeitos
            this.spawnParticles(this.ball.x, this.ball.y, this.ball.z, 12, isP1 ? '#0ff' : '#f00');

            // Acorda IA
            if (isP1) {
                this.p2.reactionTimer = AI_LEVELS[this.difficulty].reactDelay;
                this.calculateAITarget();
            }
        },

        // -----------------------------------------------------------------
        // AI 2.0 (SIMULATED & ORGANIC)
        // -----------------------------------------------------------------
        calculateAITarget: function() {
            const aiConf = AI_LEVELS[this.difficulty];
            
            // Simula onde a bola estará quando cruzar a linha da IA
            // Isso considera gravidade e curva, diferent do código anterior linear
            let futureX = MathCore.simulateTrajectory(this.ball, this.p2.gameZ);

            // Adiciona erro humano dependendo da dificuldade
            // Erro é maior se a bola vem com muito Spin
            const spinFactor = Math.abs(this.ball.spinY) * 0.1;
            const errorMargin = (aiConf.error + spinFactor) * (Math.random() - 0.5);

            this.p2.targetX = futureX + errorMargin;
            this.p2.targetZ = CONF.TABLE_L/2 + 200; // Posição base de defesa

            // Se bola curta, avança
            if (Math.abs(this.ball.vz) < 30) this.p2.targetZ -= 300; 
        },

        updateAI: function() {
            const ai = this.p2;
            const conf = AI_LEVELS[this.difficulty];

            // [PATCH] Recálculo dinâmico
            const currSpeed = Math.abs(this.ball.vz);
            if (this.ball.active && this.ball.vz > 0) { // Bola vindo
                if (currSpeed > CONF.SMASH_TRIGGER || Math.abs(currSpeed - (ai.lastSpeed||0)) > 5) {
                    if (!ai.recalcTimer) {
                         this.calculateAITarget();
                         ai.recalcTimer = 10;
                    }
                }
            }
            if(ai.recalcTimer > 0) ai.recalcTimer--;
            ai.lastSpeed = currSpeed;

            if (ai.reactionTimer > 0) {
                ai.reactionTimer--;
                return; // Simulando tempo de reação humano
            }

            ai.prevY = ai.gameY; // Salva para física do hit

            let destX = ai.targetX;
            let destY = this.ball.y;

            if (this.ball.vz < 0) { // Bola indo embora
                destX = 0; // Volta pro meio
                destY = -200;
            }

            // Movimento Orgânico (Aceleração e Inércia)
            // X Movement
            const dx = destX - ai.gameX;
            ai.currVelX += dx * conf.accel; // Acelera
            ai.currVelX *= 0.85; // Atrito
            ai.currVelX = MathCore.clamp(ai.currVelX, -conf.maxSpeed, conf.maxSpeed); // Limite físico
            ai.gameX += ai.currVelX;

            // Z Movement
            ai.gameZ = MathCore.lerp(ai.gameZ, ai.targetZ, 0.05);

            // Y Movement (Auto adjust to ball height)
            ai.gameY = MathCore.lerp(ai.gameY, destY, 0.15);
        },

        handleFloor: function() {
            if (this.bounceCount === 0) {
                this.scorePoint(this.lastHitter === 'p1' ? 'p2' : 'p1', "FORA!");
            } else {
                this.scorePoint(this.lastHitter, "PONTO!");
            }
        },

        // -----------------------------------------------------------------
        // SCORING SYSTEM (OFFICIAL RULES)
        // -----------------------------------------------------------------
        scorePoint: function(winner, reason) {
            this.score[winner]++;
            this.addMsg(reason, winner === 'p1' ? "#2ecc71" : "#e74c3c");
            this.ball.active = false;
            this.rallyCount = 0;
            this.shake = 5;

            const s1 = this.score.p1;
            const s2 = this.score.p2;

            // [PATCH] Regras Oficiais (11 pontos, diff 2)
            let gameOver = false;

            if (s1 >= 10 && s2 >= 10) {
                if (Math.abs(s1 - s2) >= 2) gameOver = true;
                else {
                    if (s1 > s2) this.addMsg("VANTAGEM P1", "#ffff00");
                    else if (s2 > s1) this.addMsg("VANTAGEM CPU", "#ffff00");
                    else this.addMsg("DEUCE", "#fff");
                }
            } else if (s1 >= 11 || s2 >= 11) {
                gameOver = true;
            }

            if (gameOver) {
                setTimeout(() => this.state = 'END', 1500);
            } else {
                this.server = winner;
                setTimeout(() => this.resetRound(), 2000);
            }
        },

        resetRound: function() {
            this.ball.active = false;
            this.ball.x = 0; this.ball.y = 0; this.ball.z = 0;
            this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;
            this.ball.trail = [];
            this.bounceCount = 0;
            this.lastHitter = null;
            this.state = 'SERVE';
            
            if (this.server === 'p2') setTimeout(() => this.aiServe(), 1000);
        },

        aiServe: function() {
            if (this.state !== 'SERVE') return;
            this.ball.x = this.p2.gameX;
            this.ball.y = this.p2.gameY;
            this.ball.z = this.p2.gameZ - 60;
            this.ball.active = true;
            this.hitBall('p2', 0, 0); // Saque padrão
            this.state = 'RALLY';
        },

        // -----------------------------------------------------------------
        // VISUAL EFFECTS & RENDER
        // -----------------------------------------------------------------
        updateEffects: function() {
            // Shake Decay
            this.shake *= 0.9;
            if(this.shake < 0.5) this.shake = 0;

            // Flash Decay
            this.flash *= 0.85;
            if(this.flash < 0.05) this.flash = 0;

            // Particles
            for(let i = this.particles.length-1; i>=0; i--) {
                let p = this.particles[i];
                p.x += p.vx; p.y += p.vy; p.z += p.vz;
                p.life -= 0.05;
                if(p.life <= 0) this.particles.splice(i, 1);
            }
            
            // Trail Cleanup
            this.ball.trail.forEach(t => t.a -= 0.08);
            this.ball.trail = this.ball.trail.filter(t => t.a > 0);
        },

        renderEnvironment: function(ctx, w, h) {
            // Gradiente Pro
            const grad = ctx.createLinearGradient(0, 0, 0, h);
            grad.addColorStop(0, "#1a252f"); 
            grad.addColorStop(1, "#111");
            ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);

            // Piso Refletivo (Grid)
            ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = 1;
            ctx.beginPath();
            for (let z = -3000; z < 2000; z+=600) {
                let p1 = MathCore.project(-3000, CONF.FLOOR_Y, z, w, h);
                let p2 = MathCore.project(3000, CONF.FLOOR_Y, z, w, h);
                if(p1.visible && p2.visible) { ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); }
            }
            ctx.stroke();
        },

        renderGame: function(ctx, w, h) {
            this.drawTable(ctx, w, h);

            // IA
            const p2Pos = MathCore.project(this.p2.gameX, this.p2.gameY, this.p2.gameZ, w, h);
            if (p2Pos.visible) this.drawPaddle(ctx, p2Pos, '#e74c3c', 0.8);

            // Bola e Efeitos
            this.drawBall(ctx, w, h);

            // Player
            const p1Pos = MathCore.project(this.p1.gameX, this.p1.gameY, -CONF.TABLE_L/2 - CONF.PADDLE_Z_OFFSET, w, h);
            if (p1Pos.visible) this.drawPaddle(ctx, p1Pos, '#3498db', 1.0);

            this.drawParticles(ctx, w, h);
        },

        drawTable: function(ctx, w, h) {
            const hw = CONF.TABLE_W/2;
            const hl = CONF.TABLE_L/2;

            const c1 = MathCore.project(-hw, 0, -hl, w, h);
            const c2 = MathCore.project(hw, 0, -hl, w, h);
            const c3 = MathCore.project(hw, 0, hl, w, h);
            const c4 = MathCore.project(-hw, 0, hl, w, h);

            if (!c1.visible) return;

            // Tampo da mesa
            ctx.fillStyle = "#27ae60"; // Verde Torneio
            ctx.beginPath(); ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.lineTo(c3.x, c3.y); ctx.lineTo(c4.x, c4.y); ctx.fill();
            
            // Bordas e Detalhes
            ctx.strokeStyle = "#fff"; ctx.lineWidth = 4 * c1.s; ctx.stroke();
            
            // Rede
            const n1 = MathCore.project(-hw-20, 0, 0, w, h);
            const n2 = MathCore.project(hw+20, 0, 0, w, h);
            const n1t = MathCore.project(-hw-20, -CONF.NET_H, 0, w, h);
            const n2t = MathCore.project(hw+20, -CONF.NET_H, 0, w, h);

            ctx.fillStyle = "rgba(200,200,200,0.5)";
            ctx.beginPath(); ctx.moveTo(n1.x, n1.y); ctx.lineTo(n2.x, n2.y); ctx.lineTo(n2t.x, n2t.y); ctx.lineTo(n1t.x, n1t.y); ctx.fill();
            ctx.strokeStyle = "#ddd"; ctx.lineWidth = 1; ctx.stroke();
        },

        drawPaddle: function(ctx, pos, color, sMod) {
            const s = pos.s * sMod;
            // Efeito visual de movimento (Motion Blur simplificado)
            ctx.shadowBlur = 10; ctx.shadowColor = color;
            ctx.fillStyle = "#333";
            ctx.beginPath(); ctx.arc(pos.x, pos.y, 70*s, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = color;
            ctx.beginPath(); ctx.arc(pos.x, pos.y, 65*s, 0, Math.PI*2); ctx.fill();
            ctx.shadowBlur = 0;
            
            // Cabo
            ctx.fillStyle = "#a1887f"; 
            ctx.fillRect(pos.x - 10*s, pos.y + 40*s, 20*s, 60*s);
        },

        drawBall: function(ctx, w, h) {
            if (!this.ball.active && this.state !== 'SERVE') return;

            // Trail Suave (Requisito Visual 1)
            this.ball.trail.forEach((t) => {
                const p = MathCore.project(t.x, t.y, t.z, w, h);
                if (p.visible) {
                    ctx.fillStyle = `rgba(255,255,255,${t.a * 0.4})`;
                    ctx.beginPath(); ctx.arc(p.x, p.y, CONF.BALL_R * p.s * 0.8, 0, Math.PI*2); ctx.fill();
                }
            });

            const p = MathCore.project(this.ball.x, this.ball.y, this.ball.z, w, h);
            if (!p.visible) return;

            // Sombra
            if (this.ball.y < 0) {
                const sp = MathCore.project(this.ball.x, 0, this.ball.z, w, h);
                const alpha = Math.max(0, 0.4 + (this.ball.y / 2000));
                ctx.fillStyle = `rgba(0,0,0,${alpha})`;
                ctx.beginPath(); ctx.ellipse(sp.x, sp.y, 18*p.s, 6*p.s, 0, 0, Math.PI*2); ctx.fill();
            }

            // Bola
            const r = CONF.BALL_R * p.s;
            const grad = ctx.createRadialGradient(p.x-r*0.3, p.y-r*0.3, r*0.1, p.x, p.y, r);
            grad.addColorStop(0, "#fff"); grad.addColorStop(1, "#f1c40f");
            
            ctx.fillStyle = grad;
            ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI*2); ctx.fill();
        },

        drawParticles: function(ctx, w, h) {
            this.particles.forEach(p => {
                const pos = MathCore.project(p.x, p.y, p.z, w, h);
                if(pos.visible) {
                    ctx.globalAlpha = p.life;
                    ctx.fillStyle = p.color;
                    ctx.beginPath(); ctx.fillRect(pos.x, pos.y, 6*pos.s, 6*pos.s); 
                }
            });
            ctx.globalAlpha = 1;
        },

        // -----------------------------------------------------------------
        // UI LAYERS
        // -----------------------------------------------------------------
        renderHUD: function(ctx, w, h) {
            const cx = w/2;
            
            // Placar Moderno
            ctx.fillStyle = "#111"; ctx.beginPath();
            ctx.roundRect(cx - 130, 20, 260, 70, 10); ctx.fill();
            ctx.strokeStyle = "#444"; ctx.lineWidth = 2; ctx.stroke();

            ctx.font = "bold 45px 'Russo One'"; ctx.textAlign = "center";
            ctx.fillStyle = "#3498db"; ctx.fillText(this.score.p1, cx - 60, 70);
            ctx.fillStyle = "#555"; ctx.fillText("-", cx, 68);
            ctx.fillStyle = "#e74c3c"; ctx.fillText(this.score.p2, cx + 60, 70);

            // Mensagens
            this.msgs.forEach(m => {
                m.y -= 1.5; m.life -= 0.02;
                ctx.globalAlpha = Math.max(0, m.life);
                ctx.fillStyle = m.color; 
                ctx.font = "bold 50px 'Russo One'";
                ctx.strokeStyle = "#000"; ctx.lineWidth = 5;
                ctx.strokeText(m.txt, w/2, m.y);
                ctx.fillText(m.txt, w/2, m.y);
            });
            this.msgs = this.msgs.filter(m => m.life > 0);
            ctx.globalAlpha = 1;

            if (this.state === 'SERVE' && this.server === 'p1') {
                ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.roundRect(cx-200, h-80, 400, 50, 25); ctx.fill();
                ctx.fillStyle = "#fff"; ctx.font = "20px sans-serif";
                ctx.fillText("LEVANTE A RAQUETE PARA SACAR", cx, h-48);
            }
        },

        renderMenu: function(ctx, w, h) {
            ctx.fillStyle = "rgba(20,20,30,0.95)"; ctx.fillRect(0,0,w,h);
            
            ctx.shadowBlur = 20; ctx.shadowColor = "#3498db";
            ctx.fillStyle = "#fff"; ctx.textAlign = "center";
            ctx.font = "bold 70px 'Russo One'"; ctx.fillText("TABLE TENNIS", w/2, h*0.25);
            ctx.font = "italic 30px sans-serif"; ctx.fillText("PRO EDITION", w/2, h*0.32);
            ctx.shadowBlur = 0;

            const drawBtn = (y, txt, active) => {
                ctx.fillStyle = active ? "#f1c40f" : "#2c3e50";
                if(active) { ctx.shadowBlur = 15; ctx.shadowColor = "#f1c40f"; }
                ctx.fillRect(w/2 - 160, y, 320, 65);
                ctx.shadowBlur = 0;
                
                ctx.fillStyle = active ? "#000" : "#fff"; 
                ctx.font = "bold 28px 'Russo One'";
                ctx.fillText(txt, w/2, y + 43);
            };

            ctx.fillStyle = "#aaa"; ctx.font = "18px sans-serif";
            ctx.fillText("DIFICULDADE", w/2, h*0.42);

            drawBtn(h*0.45, "EASY", false);
            drawBtn(h*0.60, "NORMAL", true);
            drawBtn(h*0.75, "PRO (HARD)", false);
            
            ctx.fillStyle = "#555"; ctx.font = "16px sans-serif";
            ctx.fillText("CLIQUE NO FUNDO PARA RECALIBRAR", w/2, h*0.95);
        },

        renderCalibration: function(ctx, w, h) {
            ctx.fillStyle = "#000"; ctx.fillRect(0,0,w,h);
            ctx.fillStyle = "#fff"; ctx.textAlign = "center";
            
            const isTL = this.state === 'CALIB_TL';
            ctx.font = "bold 35px sans-serif"; 
            ctx.fillText(isTL ? "TOQUE NO CANTO SUPERIOR ESQUERDO" : "TOQUE NO CANTO INFERIOR DIREITO", w/2, h*0.15);
            
            // Grid Guia
            ctx.strokeStyle = "#333"; ctx.lineWidth = 1;
            ctx.beginPath(); 
            ctx.moveTo(w/2, 0); ctx.lineTo(w/2, h);
            ctx.moveTo(0, h/2); ctx.lineTo(w, h/2);
            ctx.stroke();

            // Alvo
            const tx = isTL ? 60 : w-60;
            const ty = isTL ? 60 : h-60;
            
            // Pulso
            const pulse = 1 + Math.sin(Date.now()*0.01)*0.1;
            ctx.strokeStyle = isTL ? "#0f0" : "#f00"; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(tx, ty, 30*pulse, 0, Math.PI*2); ctx.stroke();
            
            // Cursor
            if (this.p1.currRawX !== undefined) {
                const cx = (this.p1.currRawX / 640) * w; 
                const cy = (this.p1.currRawY / 480) * h;
                ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI*2); ctx.fill();
                ctx.strokeStyle = "#fff"; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke();
            }
        },

        renderEndScreen: function(ctx, w, h) {
            ctx.fillStyle = "rgba(0,0,0,0.92)"; ctx.fillRect(0,0,w,h);
            
            const win = this.score.p1 > this.score.p2;
            ctx.fillStyle = win ? "#f1c40f" : "#e74c3c";
            ctx.font = "bold 90px 'Russo One'"; ctx.textAlign = "center";
            ctx.fillText(win ? "WINNER!" : "GAME OVER", w/2, h*0.4);
            
            ctx.fillStyle = "#fff"; ctx.font = "40px sans-serif";
            ctx.fillText(`${this.score.p1}  -  ${this.score.p2}`, w/2, h*0.55);
            
            ctx.fillStyle = "#777"; ctx.font = "20px sans-serif";
            ctx.fillText("CLIQUE PARA VOLTAR", w/2, h*0.8);
        },

        spawnParticles: function(x, y, z, count, color) {
            for(let i=0; i<count; i++) {
                this.particles.push({
                    x, y, z, 
                    vx: (Math.random()-0.5)*25, vy: (Math.random()-0.5)*25, vz: (Math.random()-0.5)*25,
                    life: 1.0, color
                });
            }
        },

        addMsg: function(txt, color) {
            this.msgs.push({txt, color, y: 350, life: 1.2});
        }
    };

    if (window.System && window.System.registerGame) {
        window.System.registerGame('tennis', 'Table Tennis Pro', '🏓', Game, { camOpacity: 0.1 });
    }

})();
