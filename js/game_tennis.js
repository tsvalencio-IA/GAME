// =============================================================================
// TABLE TENNIS: PROTOCOL 177 (FINAL GOLD MASTER PATCHED)
// ARQUITETO: SENIOR GAME ENGINE ARCHITECT
// STATUS: 10/10 ABSOLUTE PHYSICS & LOGIC FIX (SUBSTEP, DOT, AI HUMANIZED)
// =============================================================================

(function() {
    "use strict";

    // -----------------------------------------------------------------
    // 1. CONFIGURAÇÕES FÍSICAS
    // -----------------------------------------------------------------
    const CONF = {
        TABLE_W: 1525,  
        TABLE_L: 2740,
        TABLE_Y: 0,          
        NET_H: 152,     
        FLOOR_Y: 760,        
        
        BALL_R: 24,          
        GRAVITY: 0.65,       
        AIR_DRAG: 0.994,     
        BOUNCE_LOSS: 0.78,   
        MAGNUS_FORCE: 0.16,
        MAX_TOTAL_SPEED: 180, 
        
        AUTO_SERVE_DELAY: 2000,
        PADDLE_SCALE: 1.8,   
        PADDLE_HITBOX: 160,  
        SWING_FORCE: 3.6,    
        SMASH_THRESH: 30,    

        CAM_Y: -1400,        
        CAM_Z: -1800,        
        FOV: 900
    };

    const AI_PROFILES = {
        'PRO': { speed: 0.12, difficultyFactor: 0.8 }
    };

    // -----------------------------------------------------------------
    // 2. MATH CORE
    // -----------------------------------------------------------------
    const MathCore = {
        project: (x, y, z, w, h) => {
            const depth = (z - CONF.CAM_Z);
            if (depth <= 1) return { x: -9999, y: -9999, s: 0, visible: false, depth: depth };
            
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
        
        dist3d: (x1, y1, z1, x2, y2, z2) => {
            const dx = x1 - x2;
            const dy = y1 - y2;
            const dz = z1 - z2;
            return Math.sqrt(dx*dx + dy*dy + dz*dz);
        },

        dot3d: (x1, y1, z1, x2, y2, z2) => {
            return x1*x2 + y1*y2 + z1*z2;
        },
        
        predict: (b, targetZ) => {
            let sx = b.x, sy = b.y, sz = b.z;
            let svx = b.vx, svy = b.vy, svz = b.vz;
            let steps = 0;
            while(sz < targetZ && steps < 300) {
                svx += (b.spinY * svz * CONF.MAGNUS_FORCE * 0.005);
                svy += (b.spinX * svz * CONF.MAGNUS_FORCE * 0.005) + CONF.GRAVITY;
                svx *= CONF.AIR_DRAG; svy *= CONF.AIR_DRAG; svz *= CONF.AIR_DRAG;
                sx += svx; sy += svy; sz += svz;
                if(sy > 0) { sy = 0; svy *= -0.8; }
                steps++;
            }
            return sx;
        },

        // CORREÇÃO 3 (Parte 1): Previsão de Y para IA
        predictY: (b, targetZ) => {
            let sy = b.y, sz = b.z;
            let svy = b.vy, svz = b.vz;
            let steps = 0;
            // Simulação simplificada apenas para altura
            while(sz < targetZ && steps < 300) {
                svy += CONF.GRAVITY;
                svy *= CONF.AIR_DRAG; svz *= CONF.AIR_DRAG;
                sy += svy; sz += svz;
                if(sy > 0) { sy = 0; svy *= -0.8; }
                steps++;
            }
            return sy;
        }
    };

    // -----------------------------------------------------------------
    // 3. GAME ENGINE
    // -----------------------------------------------------------------
    const Game = {
        state: 'INIT', 
        timer: 0,
        
        p1: { 
            gameX: 0, gameY: -200, gameZ: -CONF.TABLE_L/2 - 200, 
            prevX: 0, prevY: 0, 
            velX: 0, velY: 0,
            currRawX: 0, currRawY: 0
        },
        p2: { 
            gameX: 0, gameY: -200, gameZ: CONF.TABLE_L/2 + 200,
            targetX: 0, targetZ: 0, targetY: -200, // Adicionado targetY
            velX: 0, velZ: 0
        },
        ball: { 
            x: 0, y: -300, z: -CONF.TABLE_L/2, 
            vx: 0, vy: 0, vz: 0, 
            prevY: -300,
            spinX: 0, spinY: 0,
            active: false,
            lastHitBy: null, 
            trail: []
        },

        score: { p1: 0, p2: 0 },
        server: 'p1',
        bounceCount: 0,
        lastHitter: null,
        rallyCount: 0,

        shake: 0,
        shakeX: 0, shakeY: 0,
        flash: 0,
        particles: [],
        msgs: [],
        calib: { tlX: 0, tlY: 0, brX: 640, brY: 480 },

        init: function() {
            this.state = 'MENU';
            this.loadCalib();
            if(window.System && window.System.msg) window.System.msg("TABLE TENNIS: PROTOCOL 177 PATCHED");
            this.setupInput();
        },

        loadCalib: function() {
            const s = localStorage.getItem('tennis_calib_177');
            if(s) this.calib = JSON.parse(s);
        },

        setupInput: function() {
            if(!window.System.canvas) return;
            window.System.canvas.onclick = (e) => {
                const h = window.System.canvas.height;
                const my = e.clientY - window.System.canvas.getBoundingClientRect().top;

                if (this.state === 'MENU') {
                    if (my > h*0.8) this.state = 'CALIB_TL';
                    else {
                        this.startGame();
                        window.Sfx.click();
                    }
                } else if (this.state.startsWith('CALIB')) {
                    this.doCalibStep();
                } else if (this.state === 'END') {
                    this.state = 'MENU';
                }
            };
        },

        startGame: function() {
            this.score = { p1: 0, p2: 0 };
            this.server = 'p1';
            this.resetRound();
        },

        doCalibStep: function() {
            if (this.state === 'CALIB_TL') {
                this.state = 'CALIB_BR';
                window.Sfx.click();
            } else if (this.state === 'CALIB_BR') {
                if(this.p1.currRawX) {
                    if(Math.abs(this.calib.tlX - this.calib.brX) < 10) this.calib.brX = this.calib.tlX + 100;
                    if(Math.abs(this.calib.tlY - this.calib.brY) < 10) this.calib.brY = this.calib.tlY + 100;
                    localStorage.setItem('tennis_calib_177', JSON.stringify(this.calib));
                    this.state = 'MENU';
                    window.Sfx.coin();
                }
            }
        },

        update: function(ctx, w, h, pose) {
            this.processPose(pose);

            if (this.state === 'RALLY' || this.state === 'SERVE') {
                this.updatePhysics();
                this.updateAI();
                this.updateRules();
            }

            ctx.save();
            if(this.shake > 0) {
                this.shakeX = (Math.random()-0.5) * this.shake;
                this.shakeY = (Math.random()-0.5) * this.shake;
                ctx.translate(this.shakeX, this.shakeY);
                this.shake *= 0.9;
                if(this.shake < 0.5) this.shake = 0;
            }

            this.renderScene(ctx, w, h);
            ctx.restore();

            if (this.flash > 0) {
                ctx.fillStyle = `rgba(255,255,255,${this.flash})`;
                ctx.fillRect(0,0,w,h);
                this.flash *= 0.8;
                if(this.flash < 0.05) this.flash = 0;
            }

            if (this.state === 'MENU') this.renderMenu(ctx, w, h);
            else if (this.state.startsWith('CALIB')) this.renderCalibration(ctx, w, h);
            else if (this.state === 'END') this.renderEnd(ctx, w, h);
            else this.renderHUD(ctx, w, h);

            return this.score.p1;
        },

        processPose: function(pose) {
            if (!pose || !pose.keypoints) return;
            let wrist = pose.keypoints.find(k => k.name === 'right_wrist' && k.score > 0.3) || 
                        pose.keypoints.find(k => k.name === 'left_wrist' && k.score > 0.3);

            if (wrist) {
                const rawX = 640 - wrist.x; 
                const rawY = wrist.y;
                this.p1.currRawX = rawX; this.p1.currRawY = rawY;

                if (!this.state.startsWith('CALIB')) {
                    const rangeX = (this.calib.brX - this.calib.tlX) || 1;
                    const rangeY = (this.calib.brY - this.calib.tlY) || 1;
                    
                    let nx = (rawX - this.calib.tlX) / rangeX;
                    let ny = (rawY - this.calib.tlY) / rangeY;
                    
                    nx = Math.max(0, Math.min(1, nx));
                    ny = Math.max(0, Math.min(1, ny));

                    const targetX = MathCore.lerp(-CONF.TABLE_W*0.6, CONF.TABLE_W*0.6, nx); 
                    const targetY = MathCore.lerp(-800, 100, ny); 

                    this.p1.gameX = MathCore.lerp(this.p1.gameX, targetX, 0.5);
                    this.p1.gameY = MathCore.lerp(this.p1.gameY, targetY, 0.5);
                    this.p1.gameZ = -CONF.TABLE_L/2 - 200;

                    this.p1.velX = this.p1.gameX - this.p1.prevX;
                    this.p1.velY = this.p1.gameY - this.p1.prevY;
                    this.p1.prevX = this.p1.gameX;
                    this.p1.prevY = this.p1.gameY;

                    if (this.state === 'SERVE' && this.server === 'p1') {
                        this.ball.x = this.p1.gameX;
                        this.ball.y = this.p1.gameY - 50; 
                        this.ball.z = this.p1.gameZ + 50; 
                        this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;
                        this.ball.active = false;

                        if (this.p1.velY < -15) {
                            this.hitBall('p1', 0, 0);
                        }
                    }
                }
            }
        },

        updatePhysics: function() {
            if (!this.ball.active) return;
            
            const b = this.ball;
            b.prevY = b.y;

            const magX = b.spinY * b.vz * CONF.MAGNUS_FORCE * 0.01;
            const magY = b.spinX * b.vz * CONF.MAGNUS_FORCE * 0.01;
            
            b.vx += magX;
            b.vy += magY + CONF.GRAVITY;
            b.vx *= CONF.AIR_DRAG; b.vy *= CONF.AIR_DRAG; b.vz *= CONF.AIR_DRAG;

            const speed = Math.sqrt(b.vx*b.vx + b.vy*b.vy + b.vz*b.vz);
            if (speed > CONF.MAX_TOTAL_SPEED) {
                const scale = CONF.MAX_TOTAL_SPEED / speed;
                b.vx *= scale; b.vy *= scale; b.vz *= scale;
            }

            let steps = 1;
            if (speed > 50) steps = 3; 
            
            for(let s=0; s<steps; s++) {
                // CORREÇÃO 1: prevY local dentro do substep
                const previousY = b.y;

                b.x += b.vx / steps; 
                b.y += b.vy / steps; 
                b.z += b.vz / steps;

                if ((b.z > 0 && b.lastHitBy === 'p1') || (b.z < 0 && b.lastHitBy === 'p2')) {
                    b.lastHitBy = null;
                }

                // Uso de previousY para detecção de bounce
                if (b.y >= 0 && previousY < 0) { 
                    if (Math.abs(b.x) <= CONF.TABLE_W/2 && Math.abs(b.z) <= CONF.TABLE_L/2) {
                        b.y = 0; 
                        b.vy = -Math.abs(b.vy) * CONF.BOUNCE_LOSS; 
                        b.vx += b.spinY * 0.5;
                        b.vz += b.spinX * 0.5;
                        
                        window.Sfx.play(200, 'sine', 0.1);
                        this.spawnParticles(b.x, 0, b.z, 5, '#fff');

                        const side = b.z < 0 ? 'p1' : 'p2';
                        if (this.lastHitter === side) this.scorePoint(side === 'p1' ? 'p2' : 'p1', "DOIS TOQUES");
                        else if (this.bounceCount >= 1) this.scorePoint(side === 'p1' ? 'p2' : 'p1', "DOIS QUIQUES");
                        else this.bounceCount++;
                    }
                }

                this.checkPaddleHit();
            }

            b.spinX *= 0.99; b.spinY *= 0.99;

            if (Math.abs(b.vz) > 30) this.ball.trail.push({x:b.x, y:b.y, z:b.z, a:1.0});

            if (b.y > CONF.FLOOR_Y) this.handleOut();

            if (Math.abs(b.z) < 20 && b.y > -CONF.NET_H && b.y < 0) {
                b.vz *= -0.2; b.vx *= 0.5;
                this.shake = 5;
                window.Sfx.play(100, 'sawtooth', 0.1);
                b.lastHitBy = null;
            }
        },

        checkPaddleHit: function() {
            // CORREÇÃO 2: Dot Product (paddle - ball) e dot > 0

            // P1
            if (this.ball.vz < 0 && this.ball.lastHitBy !== 'p1') {
                const distP1 = MathCore.dist3d(this.ball.x, this.ball.y, this.ball.z, this.p1.gameX, this.p1.gameY, this.p1.gameZ);
                
                if (distP1 < CONF.PADDLE_HITBOX) {
                    const toPaddleX = this.p1.gameX - this.ball.x;
                    const toPaddleY = this.p1.gameY - this.ball.y;
                    const toPaddleZ = this.p1.gameZ - this.ball.z;
                    
                    const dot = MathCore.dot3d(toPaddleX, toPaddleY, toPaddleZ, this.ball.vx, this.ball.vy, this.ball.vz);
                    
                    // Bola deve estar se aproximando do paddle (dot > 0)
                    if (dot > 0) {
                        const dx = this.ball.x - this.p1.gameX;
                        const dy = this.ball.y - this.p1.gameY;
                        this.hitBall('p1', dx, dy);
                    }
                }
            }

            // P2
            if (this.ball.vz > 0 && this.ball.lastHitBy !== 'p2') {
                const distP2 = MathCore.dist3d(this.ball.x, this.ball.y, this.ball.z, this.p2.gameX, this.p2.gameY, this.p2.gameZ);
                
                if (distP2 < CONF.PADDLE_HITBOX) {
                    const toPaddleX = this.p2.gameX - this.ball.x;
                    const toPaddleY = this.p2.gameY - this.ball.y;
                    const toPaddleZ = this.p2.gameZ - this.ball.z;

                    const dot = MathCore.dot3d(toPaddleX, toPaddleY, toPaddleZ, this.ball.vx, this.ball.vy, this.ball.vz);

                    if (dot > 0) {
                        this.hitBall('p2', 0, 0);
                    }
                }
            }
        },

        hitBall: function(who, offX, offY) {
            const isP1 = who === 'p1';
            const paddle = isP1 ? this.p1 : this.p2;
            
            let velX = isP1 ? paddle.velX : paddle.velX;
            let velY = isP1 ? paddle.velY : 0;
            const speed = Math.sqrt(velX**2 + velY**2);
            
            let force = 45 + (speed * CONF.SWING_FORCE);
            let isSmash = speed > CONF.SMASH_THRESH;

            if (isSmash) {
                force *= 1.35;
                this.shake = 15;
                this.flash = 0.3;
                if(isP1) this.addMsg("SMASH!", "#0ff");
                window.Sfx.crash();
            } else {
                window.Sfx.hit();
                this.shake = 3;
            }

            this.ball.active = true;
            this.ball.lastHitBy = who;
            
            this.ball.vz = Math.abs(force) * (isP1 ? 1 : -1); 
            this.ball.vx = (offX * 0.35) + (velX * 0.6);
            this.ball.vy = -18 + (velY * 0.4) + (offY * 0.1); 

            this.ball.spinY = velX * 1.0;
            this.ball.spinX = velY * 1.0;

            this.lastHitter = who;
            this.bounceCount = 0;
            this.rallyCount++;
            this.state = 'RALLY';
            
            this.spawnParticles(this.ball.x, this.ball.y, this.ball.z, 15, isP1 ? '#0ff' : '#f00');
            
            if(isP1) this.calculateAITarget();
        },

        updateRules: function() {
            if (this.state === 'SERVE') {
                this.timer += 16;
                if (this.timer > CONF.AUTO_SERVE_DELAY) {
                    if (this.server === 'p1') {
                        this.addMsg("AUTO-SAQUE", "#fff");
                        this.ball.x = 0; this.ball.y = -200; this.ball.z = this.p1.gameZ + 50;
                        this.hitBall('p1', 0, 0);
                    } else {
                        this.aiServe();
                    }
                }
            } else if (this.state === 'RALLY') {
                if (!this.ball.active || (Math.abs(this.ball.vx) < 0.1 && Math.abs(this.ball.vz) < 0.1)) {
                     if (this.ball.y > 0) this.handleOut();
                }
            }
        },

        calculateAITarget: function() {
            const predX = MathCore.predict(this.ball, this.p2.gameZ);
            
            // CORREÇÃO 3: IA Humanizada Vertical
            const predY = MathCore.predictY(this.ball, this.p2.gameZ);

            const speed = Math.abs(this.ball.vz);
            const errorBase = speed * 0.2; 
            const errorX = (Math.random() - 0.5) * errorBase;
            const errorY = (Math.random() - 0.5) * speed * 0.15; // Erro vertical

            this.p2.targetX = predX + errorX;
            this.p2.targetY = predY + errorY; // Target dinâmico Y
            
            if (Math.abs(this.ball.vz) < 50) this.p2.targetZ = CONF.TABLE_L/2; 
            else this.p2.targetZ = CONF.TABLE_L/2 + 300;
        },

        updateAI: function() {
            const ai = this.p2;
            const dx = ai.targetX - ai.gameX;
            ai.velX += dx * 0.1;
            ai.velX *= 0.80; 
            ai.gameX += ai.velX;
            
            const dz = ai.targetZ - ai.gameZ;
            ai.velZ += dz * 0.05;
            ai.velZ *= 0.85;
            ai.gameZ += ai.velZ;

            // IA não segue bola, segue targetY previsto
            ai.gameY = MathCore.lerp(ai.gameY, ai.targetY, 0.08);
            
            if (this.ball.vz < 0) {
                ai.targetX = 0;
                ai.targetZ = CONF.TABLE_L/2 + 300;
                ai.targetY = -200; // Reset altura em standby
            }
        },

        aiServe: function() {
            this.ball.x = this.p2.gameX;
            this.ball.y = this.p2.gameY;
            this.ball.z = this.p2.gameZ - 100;
            this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;
            this.hitBall('p2', (Math.random()-0.5)*20, 0);
        },

        handleOut: function() {
            if (this.bounceCount === 0) this.scorePoint(this.lastHitter === 'p1' ? 'p2' : 'p1', "FORA");
            else this.scorePoint(this.lastHitter, "PONTO");
        },

        scorePoint: function(winner, txt) {
            this.score[winner]++;
            this.addMsg(txt, winner === 'p1' ? "#0f0" : "#f00");
            this.ball.active = false;
            this.rallyCount = 0;
            
            const s1 = this.score.p1;
            const s2 = this.score.p2;

            if ((s1 >= 11 || s2 >= 11) && Math.abs(s1 - s2) >= 2) {
                setTimeout(() => this.state = 'END', 2000);
            } else {
                this.server = winner;
                this.resetRound();
            }
        },

        resetRound: function() {
            this.ball.active = false;
            this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;
            this.ball.x = 0; this.ball.y = -300; this.ball.z = 0;
            this.ball.lastHitBy = null;
            this.bounceCount = 0;
            this.lastHitter = null;
            this.timer = 0;
            
            setTimeout(() => {
                this.state = 'SERVE';
            }, 1000);
        },

        renderScene: function(ctx, w, h) {
            const grad = ctx.createRadialGradient(w/2, h/2, 100, w/2, h/2, w);
            grad.addColorStop(0, "#2c3e50"); grad.addColorStop(1, "#1a1a1a");
            ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);

            ctx.fillStyle = "rgba(0,0,0,0.3)";
            const f1 = MathCore.project(-2000, CONF.FLOOR_Y, 2000, w, h);
            const f2 = MathCore.project(2000, CONF.FLOOR_Y, 2000, w, h);
            const f3 = MathCore.project(2000, CONF.FLOOR_Y, -2000, w, h);
            const f4 = MathCore.project(-2000, CONF.FLOOR_Y, -2000, w, h);
            if(f1.visible) {
                ctx.beginPath(); ctx.moveTo(f1.x, f1.y); ctx.lineTo(f2.x, f2.y);
                ctx.lineTo(f3.x, f3.y); ctx.lineTo(f4.x, f4.y); ctx.fill();
            }

            this.drawTable(ctx, w, h);
            this.drawPaddle(ctx, this.p2.gameX, this.p2.gameY, this.p2.gameZ, '#e74c3c', w, h);
            this.drawBall(ctx, w, h);
            this.drawPaddle(ctx, this.p1.gameX, this.p1.gameY, this.p1.gameZ, '#3498db', w, h);
            this.drawParticles(ctx, w, h);
        },

        drawTable: function(ctx, w, h) {
            const hw = CONF.TABLE_W/2;
            const hl = CONF.TABLE_L/2;
            const th = 40;
            const legH = CONF.FLOOR_Y; 

            ctx.fillStyle = "#222";
            const drawLeg = (x, z) => {
                const p1 = MathCore.project(x-20, 0, z, w, h);
                const p2 = MathCore.project(x+20, 0, z, w, h);
                const p3 = MathCore.project(x+20, legH, z, w, h);
                const p4 = MathCore.project(x-20, legH, z, w, h);
                if(p1.visible) {
                    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
                    ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y); ctx.fill();
                }
            };
            drawLeg(-hw+100, -hl+200); drawLeg(hw-100, -hl+200);
            drawLeg(-hw+100, hl-200);  drawLeg(hw-100, hl-200);

            const c1 = MathCore.project(-hw, 0, -hl, w, h);
            const c2 = MathCore.project(hw, 0, -hl, w, h);
            const c3 = MathCore.project(hw, 0, hl, w, h);
            const c4 = MathCore.project(-hw, 0, hl, w, h);
            const c1b = MathCore.project(-hw, th, -hl, w, h);
            const c2b = MathCore.project(hw, th, -hl, w, h);
            const c3b = MathCore.project(hw, th, hl, w, h);

            if (!c1.visible) return;

            ctx.fillStyle = "#052040"; 
            ctx.beginPath(); ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); 
            ctx.lineTo(c2b.x, c2b.y); ctx.lineTo(c1b.x, c1b.y); ctx.fill();

            ctx.fillStyle = "#052550";
            ctx.beginPath(); ctx.moveTo(c2.x, c2.y); ctx.lineTo(c3.x, c3.y); 
            ctx.lineTo(c3b.x, c3b.y); ctx.lineTo(c2b.x, c2b.y); ctx.fill();

            ctx.fillStyle = "#1e6091"; 
            ctx.beginPath(); ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); 
            ctx.lineTo(c3.x, c3.y); ctx.lineTo(c4.x, c4.y); ctx.fill();

            ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 2 * c1.s;
            ctx.stroke(); 
            const m1 = MathCore.project(0, 0, -hl, w, h);
            const m2 = MathCore.project(0, 0, hl, w, h);
            ctx.beginPath(); ctx.moveTo(m1.x, m1.y); ctx.lineTo(m2.x, m2.y); ctx.stroke();

            const n1 = MathCore.project(-hw-50, 0, 0, w, h);
            const n2 = MathCore.project(hw+50, 0, 0, w, h);
            const n1t = MathCore.project(-hw-50, -CONF.NET_H, 0, w, h);
            const n2t = MathCore.project(hw+50, -CONF.NET_H, 0, w, h);

            ctx.fillStyle = "rgba(240,240,240,0.3)";
            ctx.beginPath(); ctx.moveTo(n1.x, n1.y); ctx.lineTo(n2.x, n2.y);
            ctx.lineTo(n2t.x, n2t.y); ctx.lineTo(n1t.x, n1t.y); ctx.fill();
            ctx.strokeStyle = "#fff"; ctx.lineWidth = 2 * c1.s;
            ctx.beginPath(); ctx.moveTo(n1t.x, n1t.y); ctx.lineTo(n2t.x, n2t.y); ctx.stroke();
        },

        drawPaddle: function(ctx, x, y, z, color, w, h) {
            const pos = MathCore.project(x, y, z, w, h);
            if (!pos.visible) return;
            const scale = pos.s * CONF.PADDLE_SCALE;
            
            ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 20;
            ctx.fillStyle = "#333";
            ctx.beginPath(); ctx.arc(pos.x, pos.y, 65*scale, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = color;
            ctx.beginPath(); ctx.arc(pos.x, pos.y, 60*scale, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = "#8d6e63";
            ctx.fillRect(pos.x - 15*scale, pos.y + 40*scale, 30*scale, 60*scale);
            ctx.shadowBlur = 0;
            
            ctx.fillStyle = "rgba(255,255,255,0.15)";
            ctx.beginPath(); ctx.arc(pos.x - 15*scale, pos.y - 15*scale, 25*scale, 0, Math.PI*2); ctx.fill();
        },

        drawBall: function(ctx, w, h) {
            if (!this.ball.active && this.state !== 'SERVE') return;

            if (this.ball.y < CONF.FLOOR_Y) {
                const shadowPos = MathCore.project(this.ball.x, 0, this.ball.z, w, h); 
                if (Math.abs(this.ball.x) > CONF.TABLE_W/2 || Math.abs(this.ball.z) > CONF.TABLE_L/2) {
                    MathCore.project(this.ball.x, CONF.FLOOR_Y, this.ball.z, w, h); 
                }
                
                if (shadowPos.visible) {
                    const distToShadow = Math.abs(this.ball.y);
                    const alpha = MathCore.clamp(1 - (distToShadow/1000), 0.1, 0.5);
                    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
                    const sr = CONF.BALL_R * shadowPos.s * (1 + distToShadow/2000);
                    ctx.beginPath(); ctx.ellipse(shadowPos.x, shadowPos.y, sr*1.5, sr*0.5, 0, 0, Math.PI*2); ctx.fill();
                }
            }

            ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.lineWidth = 10;
            ctx.beginPath();
            this.ball.trail.forEach((t, i) => {
                const tp = MathCore.project(t.x, t.y, t.z, w, h);
                if (tp.visible) {
                    if(i===0) ctx.moveTo(tp.x, tp.y); else ctx.lineTo(tp.x, tp.y);
                }
                t.a -= 0.05;
            });
            ctx.stroke();
            this.ball.trail = this.ball.trail.filter(t => t.a > 0);

            const pos = MathCore.project(this.ball.x, this.ball.y, this.ball.z, w, h);
            if(pos.visible) {
                const r = CONF.BALL_R * pos.s;
                const grad = ctx.createRadialGradient(pos.x-r*0.3, pos.y-r*0.3, r*0.1, pos.x, pos.y, r);
                grad.addColorStop(0, "#fff"); grad.addColorStop(1, "#f39c12");
                ctx.fillStyle = grad;
                ctx.beginPath(); ctx.arc(pos.x, pos.y, r, 0, Math.PI*2); ctx.fill();
            }
        },

        drawParticles: function(ctx, w, h) {
            this.particles.forEach(p => {
                p.x += p.vx; p.y += p.vy; p.z += p.vz; p.life -= 0.05;
                const pos = MathCore.project(p.x, p.y, p.z, w, h);
                if(pos.visible) {
                    ctx.globalAlpha = p.life;
                    ctx.fillStyle = p.c;
                    ctx.fillRect(pos.x, pos.y, 4*pos.s, 4*pos.s);
                }
            });
            this.particles = this.particles.filter(p => p.life > 0);
            ctx.globalAlpha = 1;
        },

        addMsg: function(t, c) {
            this.msgs.push({t, c, y: 300, a: 1.5});
        },

        renderHUD: function(ctx, w, h) {
            const cx = w/2;
            ctx.fillStyle = "#000"; ctx.beginPath();
            ctx.roundRect(cx-100, 20, 200, 60, 8); ctx.fill();
            ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
            
            ctx.font = "bold 40px 'Russo One'"; ctx.textAlign = "center";
            ctx.fillStyle = "#3498db"; ctx.fillText(this.score.p1, cx-50, 65);
            ctx.fillStyle = "#555"; ctx.fillText("-", cx, 65);
            ctx.fillStyle = "#e74c3c"; ctx.fillText(this.score.p2, cx+50, 65);

            this.msgs.forEach(m => {
                m.y -= 1; m.a -= 0.02;
                if(m.a > 0) {
                    ctx.globalAlpha = Math.min(1, m.a);
                    ctx.font = "bold 50px 'Russo One'";
                    ctx.strokeStyle = "black"; ctx.lineWidth = 4;
                    ctx.strokeText(m.t, cx, m.y);
                    ctx.fillStyle = m.c; ctx.fillText(m.t, cx, m.y);
                }
            });
            this.msgs = this.msgs.filter(m => m.a > 0);
            ctx.globalAlpha = 1;

            if (this.state === 'SERVE' && this.server === 'p1') {
                ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(cx-150, h-60, 300, 40);
                ctx.fillStyle = "#fff"; ctx.font = "18px sans-serif";
                ctx.fillText("ERGUER RAQUETE PARA SACAR", cx, h-33);
                const progress = Math.min(1, this.timer / CONF.AUTO_SERVE_DELAY);
                ctx.fillStyle = "#f1c40f"; ctx.fillRect(cx-150, h-20, 300*progress, 4);
            }
        },

        renderMenu: function(ctx, w, h) {
            ctx.fillStyle = "rgba(10,15,20,0.95)"; ctx.fillRect(0,0,w,h);
            ctx.shadowColor = "#3498db"; ctx.shadowBlur = 20;
            ctx.fillStyle = "#fff"; ctx.textAlign = "center";
            ctx.font = "bold 60px 'Russo One'"; ctx.fillText("TABLE TENNIS", w/2, h*0.3);
            ctx.font = "italic 30px sans-serif"; ctx.fillText("PROTOCOL 177", w/2, h*0.4);
            ctx.shadowBlur = 0;
            ctx.font = "bold 24px sans-serif"; ctx.fillStyle = "#f1c40f";
            ctx.fillText("CLIQUE PARA JOGAR", w/2, h*0.7);
        },

        renderCalibration: function(ctx, w, h) {
            ctx.fillStyle = "#111"; ctx.fillRect(0,0,w,h);
            const isTL = this.state === 'CALIB_TL';
            ctx.fillStyle = "#fff"; ctx.textAlign = "center";
            ctx.font = "30px sans-serif";
            ctx.fillText(isTL ? "TOQUE CANTO SUPERIOR ESQUERDO" : "TOQUE CANTO INFERIOR DIREITO", w/2, h*0.2);
            const tx = isTL ? 50 : w-50;
            const ty = isTL ? 50 : h-50;
            ctx.strokeStyle = "#0f0"; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(tx, ty, 40, 0, Math.PI*2); ctx.stroke();
            if(this.p1.currRawX) {
                const cx = (this.p1.currRawX / 640) * w;
                const cy = (this.p1.currRawY / 480) * h;
                ctx.fillStyle = "#f00"; ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI*2); ctx.fill();
            }
        },

        renderEnd: function(ctx, w, h) {
            ctx.fillStyle = "rgba(0,0,0,0.9)"; ctx.fillRect(0,0,w,h);
            const win = this.score.p1 > this.score.p2;
            ctx.fillStyle = win ? "#f1c40f" : "#e74c3c";
            ctx.font = "bold 80px 'Russo One'"; ctx.textAlign = "center";
            ctx.fillText(win ? "VITÓRIA!" : "DERROTA", w/2, h*0.4);
            ctx.fillStyle = "#fff"; ctx.font = "40px sans-serif";
            ctx.fillText(`${this.score.p1} - ${this.score.p2}`, w/2, h*0.55);
        }
    };

    if (window.System && window.System.registerGame) {
        window.System.registerGame('tennis', 'Table Tennis Pro', '🏆', Game, { camOpacity: 0.1 });
    }

})();