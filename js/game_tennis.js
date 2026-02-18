// =============================================================================
// TABLE TENNIS: GRAND SLAM EDITION (PHYSICS V2 + NINTENDO AI + JUICE)
// ARQUITETO: SENIOR GAME ENGINE ARCHITECT
// STATUS: GOLD MASTER - FULL SPIN PHYSICS & PREDICTIVE AI
// =============================================================================

(function() {
    "use strict";

    // -----------------------------------------------------------------
    // 1. CONFIGURAÇÕES E CONSTANTES (TUNING PROFISSIONAL)
    // -----------------------------------------------------------------
    const CONF = {
        // Dimensões da Mesa e Mundo
        TABLE_W: 1525,  // Largura oficial (mm)
        TABLE_L: 2740,  // Comprimento oficial (mm)
        NET_H: 152,     // Altura da rede
        FLOOR_Y: 760,   // Distância do chão
        
        // Física da Bola
        BALL_R: 30,           // Raio visual da bola (Requisito 1)
        MAX_SPEED: 180,       // Velocidade terminal (Requisito 1)
        GRAVITY: 0.55,        // Gravidade customizada para "feel" de TV
        AIR_DRAG: 0.992,      // Resistência do ar linear
        SPIN_DRAG: 0.995,     // Decaimento do efeito
        MAGNUS_EFFECT: 0.12,  // Força da curva baseada no spin
        BOUNCE_LOSS: 0.75,    // Perda de energia no quique
        TABLE_FRICTION: 0.92, // Atrito horizontal da mesa (spin reaction)
        
        // Raquete e Jogador
        PADDLE_SIZE: 140,
        PADDLE_Z_OFFSET: 300,
        SWING_MULTIPLIER: 2.8, // Multiplicador de força do braço
        SMASH_THRESH: 25,      // Velocidade do braço para considerar Smash
        
        // Câmera
        CAM_Y: -1400,
        CAM_Z: -1800,
        FOV: 950
    };

    const AI_PROFILES = {
        'EASY':   { speed: 0.08, error: 300, reaction: 30, predictionDepth: 0.5 },
        'NORMAL': { speed: 0.15, error: 100, reaction: 15, predictionDepth: 0.8 },
        'HARD':   { speed: 0.28, error: 20,  reaction: 5,  predictionDepth: 1.0 }
    };

    // -----------------------------------------------------------------
    // 2. MATH & PHYSICS ENGINE
    // -----------------------------------------------------------------
    const MathCore = {
        // Projeção 3D para 2D (Perspective Projection)
        project: (x, y, z, w, h) => {
            const depth = (z - CONF.CAM_Z);
            if (depth <= 0) return { x: -5000, y: -5000, s: 0, visible: false };
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
        dist3d: (x1, y1, z1, x2, y2, z2) => Math.sqrt((x2-x1)**2 + (y2-y1)**2 + (z2-z1)**2),
        randRange: (min, max) => Math.random() * (max - min) + min
    };

    // -----------------------------------------------------------------
    // 3. GAME ENGINE
    // -----------------------------------------------------------------
    const Game = {
        state: 'INIT', // INIT, MENU, SERVE, RALLY, END
        difficulty: 'NORMAL',
        
        // Entidades
        p1: { 
            gameX: 0, gameY: 0, 
            prevX: 0, prevY: 0, 
            velX: 0, velY: 0,
            targetX: 0, targetY: 0 
        },
        
        p2: { 
            gameX: 0, gameY: 0, gameZ: CONF.TABLE_L/2 + 200,
            targetX: 0, state: 'IDLE', timer: 0 
        },

        ball: { 
            x: 0, y: 0, z: 0, 
            vx: 0, vy: 0, vz: 0, 
            spinX: 0, spinY: 0, // SpinX = Top/Back, SpinY = Side
            active: false,
            trail: [] 
        },

        // Estado do Jogo
        score: { p1: 0, p2: 0 },
        server: 'p1',
        bounceCount: 0,
        lastHitter: null,
        
        // Efeitos
        shake: 0,
        particles: [],
        msgs: [],
        calib: { tlX: 0, tlY: 0, brX: 640, brY: 480 },

        init: function() {
            this.state = 'MENU';
            this.score = { p1: 0, p2: 0 };
            
            // Carrega calibração se existir
            const saved = localStorage.getItem('tennis_calib');
            if(saved) this.calib = JSON.parse(saved);

            if(window.System && window.System.msg) window.System.msg("TABLE TENNIS PRO");
            this.setupInput();
        },

        setupInput: function() {
            if(!window.System.canvas) return;
            window.System.canvas.onclick = (e) => {
                const rect = window.System.canvas.getBoundingClientRect();
                const my = e.clientY - rect.top;

                if (this.state === 'MENU') {
                    // Seleção de Dificuldade
                    const h = window.System.canvas.height;
                    if (my > h * 0.7) {
                        this.state = 'CALIB_TL'; // Recalibrar
                    } else {
                        if (my < h * 0.4) this.difficulty = 'EASY';
                        else if (my < h * 0.55) this.difficulty = 'NORMAL';
                        else this.difficulty = 'HARD';
                        
                        this.state = 'SERVE';
                        this.resetRound();
                        window.Sfx.click();
                    }
                } else if (this.state.startsWith('CALIB')) {
                    this.handleCalibrationClick();
                } else if (this.state === 'END') {
                    this.init();
                }
            };
        },

        handleCalibrationClick: function() {
            if (this.state === 'CALIB_TL') {
                this.state = 'CALIB_BR';
                window.Sfx.click();
            } else if (this.state === 'CALIB_BR') {
                // Salva calibração
                if(this.p1.currRawX) { // Verifica se temos input
                    localStorage.setItem('tennis_calib', JSON.stringify(this.calib));
                    this.state = 'MENU';
                    window.Sfx.coin();
                }
            }
        },

        // -----------------------------------------------------------------
        // CORE LOOP
        // -----------------------------------------------------------------
        update: function(ctx, w, h, pose) {
            // 1. Process Input
            this.processInput(pose, w, h);

            // 2. Logic Update
            if (this.state === 'RALLY' || this.state === 'SERVE') {
                this.updatePhysics();
                this.updateAI();
                this.updateParticles();
            }

            // 3. Render
            this.renderEnvironment(ctx, w, h);
            
            if (this.state === 'MENU') this.renderMenu(ctx, w, h);
            else if (this.state.startsWith('CALIB')) this.renderCalibration(ctx, w, h);
            else if (this.state === 'END') this.renderEndScreen(ctx, w, h);
            else {
                this.renderGame(ctx, w, h);
                this.renderHUD(ctx, w, h);
            }

            // Screen Shake Decay
            if(this.shake > 0) {
                const s = Math.random() * this.shake;
                ctx.translate((Math.random()-0.5)*s, (Math.random()-0.5)*s);
                this.shake *= 0.9;
                if(this.shake < 0.5) this.shake = 0;
            }

            return this.score.p1;
        },

        // -----------------------------------------------------------------
        // INPUT PROCESSING (COM FILTRO E PREDIÇÃO)
        // -----------------------------------------------------------------
        processInput: function(pose, w, h) {
            if (!pose || !pose.keypoints) return;

            // Detecta pulso (prioriza direita, fallback esquerda)
            let wrist = pose.keypoints.find(k => k.name === 'right_wrist' && k.score > 0.3);
            if (!wrist) wrist = pose.keypoints.find(k => k.name === 'left_wrist' && k.score > 0.3);

            if (wrist) {
                const rawX = 640 - wrist.x; // Espelhado
                const rawY = wrist.y;

                if (this.state.startsWith('CALIB')) {
                    this.p1.currRawX = rawX; this.p1.currRawY = rawY; // Para feedback visual
                    if (this.state === 'CALIB_TL') { this.calib.tlX = rawX; this.calib.tlY = rawY; }
                    if (this.state === 'CALIB_BR') { this.calib.brX = rawX; this.calib.brY = rawY; }
                } else {
                    // Mapeamento Calibrado
                    const nx = (rawX - this.calib.tlX) / (this.calib.brX - this.calib.tlX);
                    const ny = (rawY - this.calib.tlY) / (this.calib.brY - this.calib.tlY);

                    // Converte para coordenadas do jogo (Mesa)
                    // X: De -Largura a +Largura (com folga extra)
                    const targetX = MathCore.lerp(-CONF.TABLE_W * 0.8, CONF.TABLE_W * 0.8, nx);
                    // Y: Altura (invertido, y sobe para cima no jogo 3d standard, mas aqui y+ é baixo)
                    // Vamos usar Y negativo como altura acima da mesa
                    const targetY = MathCore.lerp(-600, 200, ny); 

                    // Suavização do Movimento (Lerp) para evitar jitter do webcam
                    this.p1.gameX = MathCore.lerp(this.p1.gameX, targetX, 0.3);
                    this.p1.gameY = MathCore.lerp(this.p1.gameY, targetY, 0.3);

                    // Cálculo de Velocidade (Física do Braço)
                    const vx = this.p1.gameX - this.p1.prevX;
                    const vy = this.p1.gameY - this.p1.prevY;
                    
                    // Média móvel simples para suavizar picos de velocidade
                    this.p1.velX = (this.p1.velX * 0.6) + (vx * 0.4);
                    this.p1.velY = (this.p1.velY * 0.6) + (vy * 0.4);

                    this.p1.prevX = this.p1.gameX;
                    this.p1.prevY = this.p1.gameY;

                    // Mecânica de Saque (Toss)
                    if (this.state === 'SERVE' && this.server === 'p1') {
                        this.ball.x = this.p1.gameX;
                        this.ball.y = this.p1.gameY - 50;
                        this.ball.z = -CONF.TABLE_L/2 - 50;
                        
                        // Se mover a raquete rápido para cima, saca
                        if (this.p1.velY < -15) this.hitServe('p1');
                    }
                }
            }
        },

        // -----------------------------------------------------------------
        // PHYSICS ENGINE (SPIN & TRAJETÓRIA)
        // -----------------------------------------------------------------
        updatePhysics: function() {
            if (!this.ball.active) return;
            const b = this.ball;

            // 1. Magnus Effect (Curva)
            // SpinX afeta Y e Z (Topspin faz cair rápido), SpinY afeta X (Curva lateral)
            const magnusX = b.spinY * b.vz * CONF.MAGNUS_EFFECT * 0.01;
            const magnusY = b.spinX * b.vz * CONF.MAGNUS_EFFECT * 0.01;

            b.vx += magnusX;
            b.vy += magnusY + CONF.GRAVITY; // Gravidade constante

            // 2. Air Drag
            b.vx *= CONF.AIR_DRAG;
            b.vy *= CONF.AIR_DRAG;
            b.vz *= CONF.AIR_DRAG;

            // 3. Spin Decay
            b.spinX *= CONF.SPIN_DRAG;
            b.spinY *= CONF.SPIN_DRAG;

            // 4. Integração de Posição
            b.x += b.vx;
            b.y += b.vy;
            b.z += b.vz;

            // Limite de Velocidade
            const speed = Math.sqrt(b.vx**2 + b.vy**2 + b.vz**2);
            if (speed > CONF.MAX_SPEED) {
                const scale = CONF.MAX_SPEED / speed;
                b.vx *= scale; b.vy *= scale; b.vz *= scale;
            }

            // 5. Trail System
            if (this.state === 'RALLY' && speed > 20) {
                this.ball.trail.push({x:b.x, y:b.y, z:b.z, age: 1.0});
            }

            // 6. Colisão com a Mesa
            if (b.y > 0) { // Nível da mesa é 0
                // Verifica limites da mesa
                const halfW = CONF.TABLE_W / 2;
                const halfL = CONF.TABLE_L / 2;

                if (Math.abs(b.x) <= halfW && Math.abs(b.z) <= halfL) {
                    // QUIQUE NA MESA
                    b.y = 0;
                    b.vy = -b.vy * CONF.BOUNCE_LOSS;
                    
                    // Reação do Spin na Mesa (Kick)
                    b.vx += b.spinY * 0.5; // Side spin "espirra" para o lado
                    b.vz += b.spinX * 0.5; // Topspin acelera, Backspin freia

                    // Som & VFX
                    window.Sfx.play(200 + (speed*2), 'sine', 0.05);
                    this.spawnParticles(b.x, 0, b.z, 5, '#fff');

                    // Regras
                    const hitZone = b.z < 0 ? 'p1' : 'p2';
                    
                    if (this.lastHitter === hitZone) {
                        // Bateu no próprio campo ou quicou duas vezes
                        this.scorePoint(hitZone === 'p1' ? 'p2' : 'p1', "DOIS TOQUES");
                    } else if (this.bounceCount >= 1) {
                         this.scorePoint(hitZone === 'p1' ? 'p2' : 'p1', "DOIS QUIQUES");
                    } else {
                        this.bounceCount++;
                    }
                } else if (b.y > CONF.FLOOR_Y) {
                    // Caiu no chão
                    this.handleFloorHit();
                }
            }

            // 7. Colisão com Rede
            if (Math.abs(b.z) < 20 && b.y > -CONF.NET_H && b.y < 0) {
                b.vz *= -0.2; // Morre na rede
                b.vx *= 0.5;
                window.Sfx.play(100, 'sawtooth', 0.1);
                this.shake = 5;
            }

            // 8. Colisão com Raquetes
            this.checkPaddleCollision();
        },

        checkPaddleCollision: function() {
            // P1 Collision Zone
            const p1Z = -CONF.TABLE_L/2 - CONF.PADDLE_Z_OFFSET;
            if (this.ball.vz < 0 && this.ball.z < p1Z + 100 && this.ball.z > p1Z - 100) {
                const dx = this.ball.x - this.p1.gameX;
                const dy = this.ball.y - this.p1.gameY;
                const dist = Math.sqrt(dx*dx + dy*dy);
                
                if (dist < CONF.PADDLE_SIZE) {
                    this.playerHitBall('p1', dx, dy);
                }
            }

            // P2 Collision Zone (IA)
            const p2Z = this.p2.gameZ; // Posição dinâmica Z da IA
            if (this.ball.vz > 0 && this.ball.z > p2Z - 100 && this.ball.z < p2Z + 100) {
                 const dx = this.ball.x - this.p2.gameX;
                 const dy = this.ball.y - this.p2.gameY;
                 const dist = Math.sqrt(dx*dx + dy*dy);
                 
                 if (dist < CONF.PADDLE_SIZE) {
                     this.playerHitBall('p2', dx, dy);
                 }
            }
        },

        playerHitBall: function(who, hitOffsetX, hitOffsetY) {
            const isP1 = who === 'p1';
            const paddleVelX = isP1 ? this.p1.velX : (this.p2.gameX - this.p2.prevX);
            const paddleVelY = isP1 ? this.p1.velY : (this.p2.gameY - this.p2.prevY);
            
            // 1. Velocidade Base
            const armSpeed = Math.sqrt(paddleVelX**2 + paddleVelY**2);
            let power = 40 + (armSpeed * CONF.SWING_MULTIPLIER);
            
            // Smash Detection
            let isSmash = armSpeed > CONF.SMASH_THRESH;
            if (isSmash) {
                power *= 1.3;
                this.shake = 15;
                this.addMsg("SMASH!", isP1 ? "#0ff" : "#f00");
                window.Sfx.crash();
            } else {
                window.Sfx.hit();
            }

            // 2. Direção
            // Inverte Z e adiciona componente da batida
            this.ball.vz = Math.abs(power) * (isP1 ? 1 : -1);
            
            // X e Y dependem de onde bateu na raquete (ângulo) e movimento do braço
            this.ball.vx = (hitOffsetX * 0.2) + (paddleVelX * 0.5);
            this.ball.vy = -15 + (paddleVelY * 0.4) + (hitOffsetY * 0.1); // Sempre joga um pouco pra cima

            // 3. Cálculo de SPIN (A Mágica)
            // Movimento lateral rápido gera spin lateral. Movimento vertical gera top/back spin.
            this.ball.spinY = paddleVelX * 0.8; // Side Spin
            this.ball.spinX = paddleVelY * 0.8; // Top/Back Spin

            // Update State
            this.lastHitter = who;
            this.bounceCount = 0;
            
            // VFX
            this.spawnParticles(this.ball.x, this.ball.y, this.ball.z, 15, isP1 ? '#0ff' : '#f00');
            
            // AI Trigger
            if (isP1) this.predictBallTrajectory();
        },

        hitServe: function(who) {
            this.ball.active = true;
            this.ball.trail = [];
            this.playerHitBall(who, 0, 0); // Hit neutro inicial
            this.state = 'RALLY';
        },

        handleFloorHit: function() {
            // A bola caiu no chão. Quem perdeu?
            if (this.bounceCount === 0) {
                // Caiu fora direto sem tocar na mesa
                this.scorePoint(this.lastHitter === 'p1' ? 'p2' : 'p1', "FORA!");
            } else {
                // Tocou na mesa validamente e o oponente não devolveu
                this.scorePoint(this.lastHitter, "PONTO!");
            }
        },

        scorePoint: function(winner, reason) {
            this.score[winner]++;
            this.addMsg(reason, winner === 'p1' ? "#0f0" : "#f00");
            this.ball.active = false;
            
            // Lógica de Fim de Jogo
            if (this.score.p1 >= 11 || this.score.p2 >= 11) {
                if (Math.abs(this.score.p1 - this.score.p2) >= 2) {
                    setTimeout(() => this.state = 'END', 1500);
                    return;
                }
            }

            this.server = winner; // Regra simples: quem ganha saca
            setTimeout(() => this.resetRound(), 2000);
        },

        resetRound: function() {
            // Reposiciona bola para saque
            this.ball.active = false;
            this.ball.x = 0; this.ball.y = 0; this.ball.z = 0;
            this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;
            this.ball.trail = [];
            this.bounceCount = 0;
            this.lastHitter = null;
            this.state = 'SERVE';
            
            // Se IA saca
            if (this.server === 'p2') {
                setTimeout(() => this.aiServe(), 1000);
            }
        },

        // -----------------------------------------------------------------
        // AI INTELLIGENCE (NINTENDO STYLE)
        // -----------------------------------------------------------------
        updateAI: function() {
            const ai = this.p2;
            const profile = AI_PROFILES[this.difficulty];

            // Salvar posição anterior para calcular velocidade (para bater na bola)
            ai.prevX = ai.gameX;
            ai.prevY = ai.gameY;

            let targetX = ai.gameX;
            let targetY = this.ball.y;

            if (this.ball.vz > 0) { // Bola vindo para IA
                // Usa posição preditiva calculada no momento da batida do P1
                targetX = ai.targetX; 
                
                // Adiciona Erro Humano (Noise)
                const noise = Math.sin(Date.now() * 0.005) * profile.error;
                targetX += noise;

            } else { // Bola indo embora ou saque IA
                // Centraliza
                targetX = 0;
                targetY = -200;
            }

            // Movimento Suave da Raquete (Reaction Time)
            ai.gameX = MathCore.lerp(ai.gameX, targetX, profile.speed);
            ai.gameY = MathCore.lerp(ai.gameY, targetY, profile.speed);

            // Z Movement (Avança ou recua dependendo da bola)
            // Se a bola está lenta e curta, IA avança
            let targetZ = CONF.TABLE_L/2 + 200;
            if (this.ball.vz > 0 && this.ball.z > 0 && Math.abs(this.ball.vz) < 20) {
                targetZ = CONF.TABLE_L/2 - 200; // Entra na mesa
            }
            ai.gameZ = MathCore.lerp(ai.gameZ, targetZ, 0.05);
        },

        predictBallTrajectory: function() {
            // Simulação rápida para saber onde a bola vai cruzar a linha da IA
            // Simples projeção linear + gravidade para performance
            const profile = AI_PROFILES[this.difficulty];
            
            // Se dificuldade é fácil, predição é ruim (foca só na posição atual projetada)
            // Se hard, calcula interseção
            
            const timeToIntercept = (this.p2.gameZ - this.ball.z) / this.ball.vz;
            
            if (timeToIntercept > 0 && timeToIntercept < 200) {
                // Onde X estará?
                let predX = this.ball.x + (this.ball.vx * timeToIntercept);
                // Magnus effect simples na predição
                predX += (this.ball.spinY * 0.5 * timeToIntercept);
                
                // Aplica o fator de "Inteligência"
                this.p2.targetX = MathCore.lerp(0, predX, profile.predictionDepth);
            } else {
                this.p2.targetX = 0;
            }
        },

        aiServe: function() {
            if (this.state !== 'SERVE') return;
            this.ball.x = this.p2.gameX;
            this.ball.y = this.p2.gameY;
            this.ball.z = this.p2.gameZ - 50;
            this.ball.active = true;
            this.playerHitBall('p2', (Math.random()-0.5)*10, (Math.random()-0.5)*10);
            this.state = 'RALLY';
        },

        // -----------------------------------------------------------------
        // RENDER & VISUALS
        // -----------------------------------------------------------------
        renderEnvironment: function(ctx, w, h) {
            // Background Gradiente
            const grad = ctx.createLinearGradient(0, 0, 0, h);
            grad.addColorStop(0, "#2c3e50"); 
            grad.addColorStop(1, "#1a1a1a");
            ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);

            // Grid no Chão (Perspectiva)
            ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = 1;
            ctx.beginPath();
            for (let z = -2000; z < 2000; z+=500) {
                let p1 = MathCore.project(-2000, CONF.FLOOR_Y, z, w, h);
                let p2 = MathCore.project(2000, CONF.FLOOR_Y, z, w, h);
                if(p1.visible && p2.visible) { ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); }
            }
            ctx.stroke();
        },

        renderGame: function(ctx, w, h) {
            // 1. Mesa
            this.drawTable(ctx, w, h);

            // 2. IA Paddle (Longe)
            const p2Pos = MathCore.project(this.p2.gameX, this.p2.gameY, this.p2.gameZ, w, h);
            if (p2Pos.visible) this.drawPaddle(ctx, p2Pos, '#e74c3c', 0.8);

            // 3. Bola e Trail
            this.drawBall(ctx, w, h);

            // 4. Player Paddle (Perto)
            const p1Pos = MathCore.project(this.p1.gameX, this.p1.gameY, -CONF.TABLE_L/2 - CONF.PADDLE_Z_OFFSET, w, h);
            if (p1Pos.visible) this.drawPaddle(ctx, p1Pos, '#3498db', 1.0);

            // 5. Partículas
            this.drawParticles(ctx, w, h);
        },

        drawTable: function(ctx, w, h) {
            const hw = CONF.TABLE_W/2;
            const hl = CONF.TABLE_L/2;

            // Pontos da Mesa
            const c1 = MathCore.project(-hw, 0, -hl, w, h); // Near Left
            const c2 = MathCore.project(hw, 0, -hl, w, h);  // Near Right
            const c3 = MathCore.project(hw, 0, hl, w, h);   // Far Right
            const c4 = MathCore.project(-hw, 0, hl, w, h);  // Far Left

            if (!c1.visible) return;

            // Superfície Azul
            ctx.fillStyle = "#2980b9";
            ctx.beginPath(); ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.lineTo(c3.x, c3.y); ctx.lineTo(c4.x, c4.y); ctx.fill();
            
            // Bordas Brancas
            ctx.strokeStyle = "#fff"; ctx.lineWidth = 4 * c1.s;
            ctx.stroke();

            // Linha Central
            const m1 = MathCore.project(0, 0, -hl, w, h);
            const m2 = MathCore.project(0, 0, hl, w, h);
            ctx.lineWidth = 2 * c1.s; ctx.globalAlpha = 0.5;
            ctx.beginPath(); ctx.moveTo(m1.x, m1.y); ctx.lineTo(m2.x, m2.y); ctx.stroke();
            ctx.globalAlpha = 1.0;

            // Rede
            const n1 = MathCore.project(-hw-20, 0, 0, w, h);
            const n2 = MathCore.project(hw+20, 0, 0, w, h);
            const n1t = MathCore.project(-hw-20, -CONF.NET_H, 0, w, h);
            const n2t = MathCore.project(hw+20, -CONF.NET_H, 0, w, h);

            ctx.fillStyle = "rgba(230,230,230,0.4)";
            ctx.beginPath(); ctx.moveTo(n1.x, n1.y); ctx.lineTo(n2.x, n2.y); ctx.lineTo(n2t.x, n2t.y); ctx.lineTo(n1t.x, n1t.y); ctx.fill();
            ctx.strokeStyle = "#eee"; ctx.lineWidth = 1; ctx.stroke();
        },

        drawPaddle: function(ctx, pos, color, scaleMod) {
            const s = pos.s * scaleMod;
            
            // Sombra Fake
            ctx.fillStyle = "rgba(0,0,0,0.3)";
            ctx.beginPath(); ctx.ellipse(pos.x + 10*s, pos.y + 10*s, 70*s, 70*s, 0, 0, Math.PI*2); ctx.fill();

            // Cabo
            ctx.fillStyle = "#8d6e63"; 
            ctx.fillRect(pos.x - 10*s, pos.y + 40*s, 20*s, 60*s);
            
            // Borracha
            ctx.fillStyle = "#333";
            ctx.beginPath(); ctx.arc(pos.x, pos.y, 70*s, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = color;
            ctx.beginPath(); ctx.arc(pos.x, pos.y, 65*s, 0, Math.PI*2); ctx.fill();
            
            // Brilho
            ctx.fillStyle = "rgba(255,255,255,0.2)";
            ctx.beginPath(); ctx.arc(pos.x - 20*s, pos.y - 20*s, 25*s, 0, Math.PI*2); ctx.fill();
        },

        drawBall: function(ctx, w, h) {
            if (!this.ball.active && this.state !== 'SERVE') return;

            // Trail
            if (this.ball.trail.length > 1) {
                ctx.beginPath();
                this.ball.trail.forEach((t, i) => {
                    const p = MathCore.project(t.x, t.y, t.z, w, h);
                    if (!p.visible) return;
                    if (i === 0) ctx.moveTo(p.x, p.y);
                    else ctx.lineTo(p.x, p.y);
                });
                ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
                ctx.lineWidth = 10 * MathCore.project(this.ball.x, this.ball.y, this.ball.z, w, h).s;
                ctx.lineCap = 'round';
                ctx.stroke();
            }

            const p = MathCore.project(this.ball.x, this.ball.y, this.ball.z, w, h);
            if (!p.visible) return;

            // Sombra da Bola
            if (this.ball.y < 0) {
                const shadowP = MathCore.project(this.ball.x, 0, this.ball.z, w, h);
                const alpha = MathCore.map(this.ball.y, -1000, 0, 0, 0.5);
                ctx.fillStyle = `rgba(0,0,0,${MathCore.clamp(alpha, 0, 0.5)})`;
                ctx.beginPath(); ctx.ellipse(shadowP.x, shadowP.y, 15*p.s, 6*p.s, 0, 0, Math.PI*2); ctx.fill();
            }

            // Bola
            const r = CONF.BALL_R * p.s;
            const grad = ctx.createRadialGradient(p.x - r*0.3, p.y - r*0.3, r*0.1, p.x, p.y, r);
            grad.addColorStop(0, "#fff");
            grad.addColorStop(1, "#f39c12"); // Laranja clássico
            
            ctx.fillStyle = grad;
            ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI*2); ctx.fill();
        },

        spawnParticles: function(x, y, z, count, color) {
            for(let i=0; i<count; i++) {
                this.particles.push({
                    x, y, z, 
                    vx: (Math.random()-0.5)*30, vy: (Math.random()-0.5)*30, vz: (Math.random()-0.5)*30,
                    life: 1.0, color
                });
            }
        },

        updateParticles: function() {
            for(let i = this.particles.length-1; i>=0; i--) {
                const p = this.particles[i];
                p.x += p.vx; p.y += p.vy; p.z += p.vz;
                p.life -= 0.05;
                if(p.life <= 0) this.particles.splice(i, 1);
            }
            
            // Trail Cleanup
            this.ball.trail = this.ball.trail.filter(t => { t.age -= 0.1; return t.age > 0; });
        },

        drawParticles: function(ctx, w, h) {
            this.particles.forEach(p => {
                const pos = MathCore.project(p.x, p.y, p.z, w, h);
                if(pos.visible) {
                    ctx.globalAlpha = p.life;
                    ctx.fillStyle = p.color;
                    ctx.beginPath(); ctx.arc(pos.x, pos.y, 5*pos.s, 0, Math.PI*2); ctx.fill();
                }
            });
            ctx.globalAlpha = 1;
        },

        // -----------------------------------------------------------------
        // UI & HUD
        // -----------------------------------------------------------------
        renderHUD: function(ctx, w, h) {
            // Placar estilo TV
            const cx = w/2;
            ctx.fillStyle = "#111"; ctx.fillRect(cx - 120, 20, 240, 60);
            ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.strokeRect(cx - 120, 20, 240, 60);
            
            ctx.font = "bold 40px 'Russo One'"; ctx.textAlign = "center";
            ctx.fillStyle = "#3498db"; ctx.fillText(this.score.p1, cx - 60, 65);
            ctx.fillStyle = "#fff"; ctx.fillText("-", cx, 65);
            ctx.fillStyle = "#e74c3c"; ctx.fillText(this.score.p2, cx + 60, 65);

            // Mensagens flutuantes
            this.msgs.forEach((m, i) => {
                m.y -= 1; m.life -= 0.02;
                ctx.globalAlpha = Math.max(0, m.life);
                ctx.fillStyle = m.color; 
                ctx.font = "bold 40px 'Russo One'";
                ctx.strokeStyle = "#000"; ctx.lineWidth = 4;
                ctx.strokeText(m.txt, w/2, m.y);
                ctx.fillText(m.txt, w/2, m.y);
            });
            this.msgs = this.msgs.filter(m => m.life > 0);
            ctx.globalAlpha = 1;
            
            // Tutorial de Saque
            if (this.state === 'SERVE' && this.server === 'p1') {
                ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(0, h-60, w, 60);
                ctx.fillStyle = "#fff"; ctx.font = "20px sans-serif";
                ctx.fillText("MOVIMENTE A RAQUETE RÁPIDO PARA CIMA PARA SACAR", w/2, h-25);
            }
        },

        renderMenu: function(ctx, w, h) {
            ctx.fillStyle = "rgba(0,0,0,0.85)"; ctx.fillRect(0,0,w,h);
            
            ctx.fillStyle = "#fff"; ctx.textAlign = "center";
            ctx.font = "bold 60px 'Russo One'"; ctx.fillText("TABLE TENNIS PRO", w/2, h*0.25);
            
            const drawBtn = (y, txt, active) => {
                ctx.fillStyle = active ? "#f39c12" : "#34495e";
                ctx.fillRect(w/2 - 150, y, 300, 60);
                ctx.fillStyle = "#fff"; ctx.font = "bold 30px 'Russo One'";
                ctx.fillText(txt, w/2, y + 42);
            };

            ctx.font = "20px sans-serif"; ctx.fillStyle = "#aaa";
            ctx.fillText("SELECIONE A DIFICULDADE:", w/2, h*0.35);

            drawBtn(h*0.4, "EASY", false);
            drawBtn(h*0.55, "NORMAL", true);
            drawBtn(h*0.7, "HARD", false);
            
            ctx.fillStyle = "#aaa"; ctx.font = "16px sans-serif";
            ctx.fillText("CLIQUE ABAIXO PARA RECALIBRAR", w/2, h*0.9);
        },

        renderCalibration: function(ctx, w, h) {
            ctx.fillStyle = "#000"; ctx.fillRect(0,0,w,h);
            ctx.fillStyle = "#fff"; ctx.textAlign = "center";
            
            const isTL = this.state === 'CALIB_TL';
            ctx.font = "bold 40px sans-serif"; 
            ctx.fillText(isTL ? "SUPERIOR ESQUERDO" : "INFERIOR DIREITO", w/2, h*0.2);
            ctx.font = "20px sans-serif"; 
            ctx.fillText("Mova sua mão até o alvo e clique", w/2, h*0.3);

            // Alvo
            const tx = isTL ? 50 : w-50;
            const ty = isTL ? 50 : h-50;
            ctx.strokeStyle = "#0f0"; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.arc(tx, ty, 40, 0, Math.PI*2); ctx.stroke();

            // Cursor Atual
            if (this.p1.currRawX) {
                const cx = (this.p1.currRawX / 640) * w; // Desinverte visualmente apenas para calibração
                const cy = (this.p1.currRawY / 480) * h;
                ctx.fillStyle = "#0ff"; 
                ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI*2); ctx.fill();
                
                // Linha guia
                ctx.strokeStyle = "#555"; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke();
            }
        },

        renderEndScreen: function(ctx, w, h) {
            ctx.fillStyle = "rgba(0,0,0,0.9)"; ctx.fillRect(0,0,w,h);
            const win = this.score.p1 > this.score.p2;
            
            ctx.fillStyle = win ? "#f1c40f" : "#e74c3c";
            ctx.font = "bold 80px 'Russo One'"; ctx.textAlign = "center";
            ctx.fillText(win ? "VITÓRIA!" : "DERROTA", w/2, h*0.4);
            
            ctx.fillStyle = "#fff"; ctx.font = "30px sans-serif";
            ctx.fillText(`PLACAR FINAL: ${this.score.p1} - ${this.score.p2}`, w/2, h*0.55);
            ctx.font = "20px sans-serif"; ctx.fillStyle = "#aaa";
            ctx.fillText("CLIQUE PARA VOLTAR AO MENU", w/2, h*0.8);
        },

        addMsg: function(txt, color) {
            this.msgs.push({txt, color, y: 300, life: 1.0});
        }
    };

    // Math Helper for Map
    MathCore.map = (v, iMin, iMax, oMin, oMax) => oMin + (oMax - oMin) * ((v - iMin) / (iMax - iMin));

    // Registro no Console
    if (window.System && window.System.registerGame) {
        window.System.registerGame('tennis', 'Table Tennis Pro', '🏓', Game, { camOpacity: 0.1 });
    }

})();
