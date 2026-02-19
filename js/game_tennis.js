// =============================================================================
// TABLE TENNIS: PROTOCOL 177 (AUTO CALIBRATION + HAND SELECT)
// ARQUITETO: SENIOR GAME ENGINE ARCHITECT
// STATUS: 10/10 STABLE - HOLD-TO-CONFIRM, NO CLICKS REQUIRED
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
        FOV: 900,

        // Calibração
        CALIB_TIME: 2000,    // 2 segundos para confirmar posição
        HAND_SELECT_TIME: 1500 // 1.5 segundos para selecionar mão
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

        predictY: (b, targetZ) => {
            let sy = b.y, sz = b.z;
            let svy = b.vy, svz = b.vz;
            let steps = 0;
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
        pose: null, 
        handedness: null, 
        polyfillDone: false,
        
        // Timer de calibração automática
        calibTimer: 0,
        calibHandCandidate: null,

        p1: { 
            gameX: 0, gameY: -200, gameZ: -CONF.TABLE_L/2 - 200, 
            prevX: 0, prevY: 0, 
            velX: 0, velY: 0,
            currRawX: 0, currRawY: 0,
            elbowX: 0, elbowY: 0
        },
        p2: { 
            gameX: 0, gameY: -200, gameZ: CONF.TABLE_L/2 + 200,
            targetX: 0, targetZ: 0, targetY: -200,
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
            this.handedness = null; 
            this.loadCalib();
            if(window.System && window.System.msg) window.System.msg("TABLE TENNIS: AUTO SETUP");
            this.setupInput();
        },

        loadCalib: function() {
            try {
                const s = localStorage.getItem('tennis_calib_auto');
                if(s) {
                    const data = JSON.parse(s);
                    if(data.calib) this.calib = data.calib;
                    if(data.hand) this.handedness = data.hand;
                }
            } catch(e) { console.error("Calib Load Error", e); }
        },

        setupInput: function() {
            if(!window.System.canvas) return;
            window.System.canvas.onclick = (e) => {
                const h = window.System.canvas.height;
                const my = e.clientY - window.System.canvas.getBoundingClientRect().top;

                // Apenas MENU e END aceitam clique. Calibração é automática.
                if (this.state === 'MENU') {
                    if (my > h*0.7) {
                        this.state = 'CALIB_HAND_SELECT'; 
                        this.calibTimer = 0;
                        window.Sfx.click();
                    } else {
                        if (this.handedness && this.calib.brX !== 640) {
                            this.startGame();
                        } else {
                            this.state = 'CALIB_HAND_SELECT';
                            this.calibTimer = 0;
                        }
                        window.Sfx.click();
                    }
                } else if (this.state === 'END') {
                    this.state = 'MENU';
                }
            };
        },

        spawnParticles: function(x, y, z, count, color) {
            for (let i = 0; i < count; i++) {
                this.particles.push({
                    x: x, y: y, z: z,
                    vx: (Math.random() - 0.5) * 8,
                    vy: (Math.random() - 0.5) * 8,
                    vz: (Math.random() - 0.5) * 8,
                    life: 1,
                    c: color
                });
            }
        },

        startGame: function() {
            this.score = { p1: 0, p2: 0 };
            this.server = 'p1';
            this.resetRound();
        },

        // Lógica de update geral
        update: function(ctx, w, h, pose) {
            // Polyfill protection
            if (!this.polyfillDone) {
                if (!ctx.roundRect) {
                    ctx.roundRect = function(x, y, w, h, r) {
                        if (w < 2 * r) r = w / 2;
                        if (h < 2 * r) r = h / 2;
                        ctx.beginPath();
                        ctx.moveTo(x + r, y);
                        ctx.arcTo(x + w, y, x + w, y + h, r);
                        ctx.arcTo(x + w, y + h, x, y + h, r);
                        ctx.arcTo(x, y + h, x, y, r);
                        ctx.arcTo(x, y, x + w, y, r);
                        ctx.closePath();
                    };
                }
                this.polyfillDone = true;
            }

            this.processPose(pose);

            // Gerenciamento de Estado da Calibração Automática
            if (this.state.startsWith('CALIB')) {
                this.updateAutoCalibration();
            }

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

        // Nova função para gerenciar calibração por tempo
        updateAutoCalibration: function() {
            // Decay timer se nada acontecer
            this.calibTimer = Math.max(0, this.calibTimer - 16);

            if (this.state === 'CALIB_HAND_SELECT') {
                if (this.calibHandCandidate) {
                    this.calibTimer += 32; // Enche mais rápido que esvazia
                    if (this.calibTimer > CONF.HAND_SELECT_TIME) {
                        this.handedness = this.calibHandCandidate;
                        this.state = 'CALIB_TL';
                        this.calibTimer = 0;
                        window.Sfx.coin();
                    }
                }
            } 
            else if (this.state === 'CALIB_TL') {
                if (this.p1.currRawX) {
                    this.calibTimer += 32;
                    if (this.calibTimer > CONF.CALIB_TIME) {
                        this.calib.tlX = this.p1.currRawX;
                        this.calib.tlY = this.p1.currRawY;
                        this.state = 'CALIB_BR';
                        this.calibTimer = 0;
                        window.Sfx.coin();
                    }
                }
            } 
            else if (this.state === 'CALIB_BR') {
                if (this.p1.currRawX) {
                    this.calibTimer += 32;
                    if (this.calibTimer > CONF.CALIB_TIME) {
                        this.calib.brX = this.p1.currRawX;
                        this.calib.brY = this.p1.currRawY;
                        
                        localStorage.setItem('tennis_calib_auto', JSON.stringify({
                            calib: this.calib,
                            hand: this.handedness
                        }));
                        
                        this.startGame(); // Inicia direto
                        window.Sfx.coin();
                    }
                }
            }
        },

        processPose: function(pose) {
            this.pose = pose; 
            if (!pose || !pose.keypoints) return;

            // ---- Lógica de Seleção de Mão ----
            if (this.state === 'CALIB_HAND_SELECT') {
                const nose = pose.keypoints.find(k => k.name === 'nose');
                const leftW = pose.keypoints.find(k => k.name === 'left_wrist');
                const rightW = pose.keypoints.find(k => k.name === 'right_wrist');

                this.calibHandCandidate = null;

                if (nose && leftW && rightW) {
                    // Mão acima do nariz
                    const leftUp = leftW.y < nose.y;
                    const rightUp = rightW.y < nose.y;

                    if (leftUp && !rightUp) {
                        this.calibHandCandidate = 'left';
                        this.p1.currRawX = 640 - leftW.x;
                        this.p1.currRawY = leftW.y;
                    } 
                    else if (rightUp && !leftUp) {
                        this.calibHandCandidate = 'right';
                        this.p1.currRawX = 640 - rightW.x;
                        this.p1.currRawY = rightW.y;
                    }
                }
                return;
            }

            // ---- Lógica de Jogo / Calibração Pontual ----
            if (!this.handedness) return; 

            const wristName = this.handedness + '_wrist';
            const elbowName = this.handedness + '_elbow';

            const wrist = pose.keypoints.find(k => k.name === wristName && k.score > 0.3);
            const elbow = pose.keypoints.find(k => k.name === elbowName && k.score > 0.3);

            if (wrist) {
                const rawX = 640 - wrist.x; 
                const rawY = wrist.y;
                
                if (this.state.startsWith('CALIB')) {
                    this.p1.currRawX = rawX;
                    this.p1.currRawY = rawY;
                } 
                else {
                    const safeRangeX = Math.max(1, this.calib.brX - this.calib.tlX);
                    const safeRangeY = Math.max(1, this.calib.brY - this.calib.tlY);
                    
                    let nx = (rawX - this.calib.tlX) / safeRangeX;
                    let ny = (rawY - this.calib.tlY) / safeRangeY;
                    
                    nx = MathCore.clamp(nx, 0, 1);
                    ny = MathCore.clamp(ny, 0, 1);

                    const targetX = MathCore.lerp(-CONF.TABLE_W*0.6, CONF.TABLE_W*0.6, nx); 
                    const targetY = MathCore.lerp(-800, 100, ny); 

                    this.p1.gameX = MathCore.lerp(this.p1.gameX, targetX, 0.5);
                    this.p1.gameY = MathCore.lerp(this.p1.gameY, targetY, 0.5);
                    this.p1.gameZ = -CONF.TABLE_L/2 - 200;

                    if (elbow) {
                        const rawEx = 640 - elbow.x;
                        const rawEy = elbow.y;
                        let nex = (rawEx - this.calib.tlX) / safeRangeX;
                        let ney = (rawEy - this.calib.tlY) / safeRangeY;
                        nex = MathCore.clamp(nex, 0, 1);
                        ney = MathCore.clamp(ney, 0, 1);
                        
                        const targetEx = MathCore.lerp(-CONF.TABLE_W*0.6, CONF.TABLE_W*0.6, nex);
                        const targetEy = MathCore.lerp(-800, 100, ney);
                        
                        this.p1.elbowX = MathCore.lerp(this.p1.elbowX || targetEx, targetEx, 0.5);
                        this.p1.elbowY = MathCore.lerp(this.p1.elbowY || targetEy, targetEy, 0.5);
                    } else {
                        this.p1.elbowX = this.p1.gameX + (this.handedness === 'right' ? 100 : -100);
                        this.p1.elbowY = this.p1.gameY + 300;
                    }

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
            } else {
                // Se perder tracking durante calibração, zera timer
                if(this.state.startsWith('CALIB')) this.calibTimer = 0;
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
                const previousY = b.y;

                b.x += b.vx / steps; 
                b.y += b.vy / steps; 
                b.z += b.vz / steps;

                if ((b.z > 0 && b.lastHitBy === 'p1') || (b.z < 0 && b.lastHitBy === 'p2')) {
                    b.lastHitBy = null;
                }

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
            if (this.ball.vz < 0 && this.ball.lastHitBy !== 'p1') {
                const distP1 = MathCore.dist3d(this.ball.x, this.ball.y, this.ball.z, this.p1.gameX, this.p1.gameY, this.p1.gameZ);
                if (distP1 < CONF.PADDLE_HITBOX) {
                    const toPaddleX = this.p1.gameX - this.ball.x;
                    const toPaddleY = this.p1.gameY - this.ball.y;
                    const toPaddleZ = this.p1.gameZ - this.ball.z;
                    const dot = MathCore.dot3d(toPaddleX, toPaddleY, toPaddleZ, this.ball.vx, this.ball.vy, this.ball.vz);
                    if (dot > 0) {
                        const dx = this.ball.x - this.p1.gameX;
                        const dy = this.ball.y - this.p1.gameY;
                        this.hitBall('p1', dx, dy);
                    }
                }
            }
            if (this.ball.vz > 0 && this.ball.lastHitBy !== 'p2') {
                const distP2 = MathCore.dist3d(this.ball.x, this.ball.y, this.ball.z, this.p2.gameX, this.p2.gameY, this.p2.gameZ);
                if (distP2 < CONF.PADDLE_HITBOX) {
                    const toPaddleX = this.p2.gameX - this.ball.x;
                    const toPaddleY = this.p2.gameY - this.ball.y;
                    const toPaddleZ = this.p2.gameZ - this.ball.z;
                    const dot = MathCore.dot3d(toPaddleX, toPaddleY, toPaddleZ, this.ball.vx, this.ball.vy, this.ball.vz);
                    if (dot > 0) this.hitBall('p2', 0, 0);
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
            const predY = MathCore.predictY(this.ball, this.p2.gameZ);
            const speed = Math.abs(this.ball.vz);
            const errorBase = speed * 0.2; 
            const errorX = (Math.random() - 0.5) * errorBase;
            const errorY = (Math.random() - 0.5) * speed * 0.15; 
            this.p2.targetX = predX + errorX;
            this.p2.targetY = predY + errorY; 
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
            ai.gameY = MathCore.lerp(ai.gameY, ai.targetY, 0.08);
            if (this.ball.vz < 0) {
                ai.targetX = 0; ai.targetZ = CONF.TABLE_L/2 + 300; ai.targetY = -200; 
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
            setTimeout(() => { this.state = 'SERVE'; }, 1000);
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
            
            if (!this.state.startsWith('CALIB')) {
                this.drawPlayerArm(ctx, w, h);
                this.drawPaddle(ctx, this.p1.gameX, this.p1.gameY, this.p1.gameZ, '#3498db', w, h);
            }
            
            this.drawParticles(ctx, w, h);
        },
        
        drawPlayerArm: function(ctx, w, h) {
            if(!this.handedness) return; 
            const wristZ = this.p1.gameZ;
            const elbowZ = this.p1.gameZ + 400; 
            const pWrist = MathCore.project(this.p1.gameX, this.p1.gameY, wristZ, w, h);
            const pElbow = MathCore.project(this.p1.elbowX, this.p1.elbowY, elbowZ, w, h);
            
            if (pWrist.visible && pElbow.visible) {
                ctx.strokeStyle = "#e0ac69"; ctx.lineWidth = 18 * pWrist.s; ctx.lineCap = "round";
                ctx.beginPath(); ctx.moveTo(pElbow.x, pElbow.y); ctx.lineTo(pWrist.x, pWrist.y); ctx.stroke();
                ctx.fillStyle = "#e0ac69"; ctx.beginPath(); ctx.arc(pWrist.x, pWrist.y, 10*pWrist.s, 0, Math.PI*2); ctx.fill();
            }
        },

        drawTable: function(ctx, w, h) {
            const hw = CONF.TABLE_W/2; const hl = CONF.TABLE_L/2; const th = 40; const legH = CONF.FLOOR_Y; 
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
            drawLeg(-hw+100, -hl+200); drawLeg(hw-100, -hl+200); drawLeg(-hw+100, hl-200); drawLeg(hw-100, hl-200);

            const c1 = MathCore.project(-hw, 0, -hl, w, h);
            const c2 = MathCore.project(hw, 0, -hl, w, h);
            const c3 = MathCore.project(hw, 0, hl, w, h);
            const c4 = MathCore.project(-hw, 0, hl, w, h);
            const c1b = MathCore.project(-hw, th, -hl, w, h);
            const c2b = MathCore.project(hw, th, -hl, w, h);
            const c3b = MathCore.project(hw, th, hl, w, h);

            if (!c1.visible) return;

            ctx.fillStyle = "#052040"; ctx.beginPath(); ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.lineTo(c2b.x, c2b.y); ctx.lineTo(c1b.x, c1b.y); ctx.fill();
            ctx.fillStyle = "#052550"; ctx.beginPath(); ctx.moveTo(c2.x, c2.y); ctx.lineTo(c3.x, c3.y); ctx.lineTo(c3b.x, c3b.y); ctx.lineTo(c2b.x, c2b.y); ctx.fill();
            ctx.fillStyle = "#1e6091"; ctx.beginPath(); ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.lineTo(c3.x, c3.y); ctx.lineTo(c4.x, c4.y); ctx.fill();
            ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 2 * c1.s; ctx.stroke(); 
            const m1 = MathCore.project(0, 0, -hl, w, h); const m2 = MathCore.project(0, 0, hl, w, h);
            ctx.beginPath(); ctx.moveTo(m1.x, m1.y); ctx.lineTo(m2.x, m2.y); ctx.stroke();

            const n1 = MathCore.project(-hw-50, 0, 0, w, h); const n2 = MathCore.project(hw+50, 0, 0, w, h);
            const n1t = MathCore.project(-hw-50, -CONF.NET_H, 0, w, h); const n2t = MathCore.project(hw+50, -CONF.NET_H, 0, w, h);
            ctx.fillStyle = "rgba(240,240,240,0.3)"; ctx.beginPath(); ctx.moveTo(n1.x, n1.y); ctx.lineTo(n2.x, n2.y); ctx.lineTo(n2t.x, n2t.y); ctx.lineTo(n1t.x, n1t.y); ctx.fill();
            ctx.strokeStyle = "#fff"; ctx.lineWidth = 2 * c1.s; ctx.beginPath(); ctx.moveTo(n1t.x, n1t.y); ctx.lineTo(n2t.x, n2t.y); ctx.stroke();
        },

        renderCalibration: function(ctx, w, h) {
            ctx.fillStyle = "#111"; ctx.fillRect(0,0,w,h);
            
            if (this.pose && this.pose.keypoints) {
                this.drawSkeleton(ctx, w, h);
                
                // Feedback: Raquete na mão se já escolheu
                if (this.handedness && this.p1.currRawX) {
                    const cx = (this.p1.currRawX / 640) * w;
                    const cy = (this.p1.currRawY / 480) * h;
                    ctx.translate(cx, cy); ctx.rotate(-0.2);
                    ctx.fillStyle = "#8d6e63"; ctx.fillRect(-5, 0, 10, 30); 
                    ctx.fillStyle = "#3498db"; ctx.beginPath(); ctx.arc(0, -20, 25, 0, Math.PI*2); ctx.fill(); 
                    ctx.rotate(0.2); ctx.translate(-cx, -cy);
                    
                    // ANEL DE PROGRESSO AO REDOR DA MÃO
                    if (this.calibTimer > 0) {
                        const progress = Math.min(1, this.calibTimer / CONF.CALIB_TIME);
                        ctx.strokeStyle = "#0ff"; ctx.lineWidth = 6;
                        ctx.beginPath(); ctx.arc(cx, cy, 40, -Math.PI/2, (-Math.PI/2) + (Math.PI*2*progress)); ctx.stroke();
                    }
                }
            }

            ctx.fillStyle = "#fff"; ctx.textAlign = "center";

            if (this.state === 'CALIB_HAND_SELECT') {
                ctx.font = "bold 40px sans-serif"; ctx.fillText("LEVANTE UMA MÃO PARA ESCOLHER", w/2, h*0.15);
                ctx.font = "50px sans-serif";
                
                // Anéis de progresso para seleção de mão
                const drawSelectRing = (x, y, hand) => {
                    ctx.fillText(hand === 'left' ? "✋ Esquerda" : "Direita ✋", x, y);
                    if (this.calibHandCandidate === hand) {
                        const progress = Math.min(1, this.calibTimer / CONF.HAND_SELECT_TIME);
                        ctx.strokeStyle = "#0f0"; ctx.lineWidth = 5;
                        ctx.beginPath(); ctx.arc(x, y-20, 60, 0, Math.PI*2*progress); ctx.stroke();
                    }
                };
                
                drawSelectRing(w*0.2, h*0.5, 'left');
                drawSelectRing(w*0.8, h*0.5, 'right');

            } else {
                const isTL = this.state === 'CALIB_TL';
                ctx.font = "bold 30px sans-serif"; 
                ctx.fillText(isTL ? "SEGURE A MÃO NO CÍRCULO VERDE" : "SEGURE A MÃO NO CÍRCULO VERMELHO", w/2, h*0.15);
                
                const tx = isTL ? 100 : w-100;
                const ty = isTL ? 100 : h-100;
                const color = isTL ? "#0f0" : "#f00";
                
                ctx.strokeStyle = color; ctx.lineWidth = 4;
                ctx.beginPath(); ctx.arc(tx, ty, 50, 0, Math.PI*2); ctx.stroke();
                
                // Linha Guia
                if(this.p1.currRawX) {
                    const cx = (this.p1.currRawX / 640) * w;
                    const cy = (this.p1.currRawY / 480) * h;
                    ctx.setLineDash([10, 10]); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
                    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke();
                    ctx.setLineDash([]);
                }
            }
        },

        drawSkeleton: function(ctx, w, h) {
             const kps = this.pose.keypoints;
             const find = (n) => kps.find(k => k.name === n && k.score > 0.3);
             const bones = [
                 ['nose', 'left_eye'], ['nose', 'right_eye'],
                 ['left_shoulder', 'right_shoulder'],
                 ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'],
                 ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'],
                 ['left_shoulder', 'left_hip'], ['right_shoulder', 'right_hip'],
                 ['left_hip', 'right_hip']
             ];
             ctx.strokeStyle = "rgba(0, 255, 0, 0.3)"; ctx.lineWidth = 3;
             bones.forEach(bone => {
                 const p1 = find(bone[0]); const p2 = find(bone[1]);
                 if(p1 && p2) {
                     const x1 = ((640 - p1.x) / 640) * w; const y1 = (p1.y / 480) * h;
                     const x2 = ((640 - p2.x) / 640) * w; const y2 = (p2.y / 480) * h;
                     ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
                 }
             });
             kps.forEach(k => {
                 if(k.score > 0.3) {
                     const x = ((640 - k.x) / 640) * w; const y = (k.y / 480) * h;
                     ctx.fillStyle = "#0f0"; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI*2); ctx.fill();
                 }
             });
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

})();l