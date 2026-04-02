// =============================================================================
// AERO STRIKE WAR: TACTICAL YOKE SIMULATOR (AAA PROFESSIONAL EVOLUTION)
// ARQUITETO: SENIOR GAME ENGINE ARCHITECT
// STATUS: 100% COMPLETO. FÍSICA CORRIGIDA, MULTIPLAYER SYNC, YOKE BALANCEADO (0.09).
// =============================================================================

(function() {
    "use strict";

    // -----------------------------------------------------------------
    // 1. CONFIGURAÇÕES FÍSICAS E METADADOS AAA
    // -----------------------------------------------------------------
    const GAME_CONFIG = {
        GRAVITY: 9.80665,     
        R_GAS: 287.05,        
        GAMMA: 1.4,           
        MAX_ALTITUDE: 50000   
    };

    const BASE_PLANE_STATS = {
        thrust: 400000,
        mass: 12000, 
        wingArea: 40.0,
        cd0: 0.02, 
        kInduced: 0.04, 
        clMax: 4.5,
        stallAngle: 1.2,
        maxPitchRate: 3.0, 
        maxRollRate: 4.5,
        overheatThreshold: 100
    };

    function createParticle(x, y, z, c, size, life, type) {
        return {
            x: x, y: y, z: z,
            vx: (Math.random() - 0.5) * 200,
            vy: (Math.random() - 0.5) * 200,
            vz: (Math.random() - 0.5) * 200,
            life: life, maxLife: life, c: c, size: size, type: type
        };
    }

    // -----------------------------------------------------------------
    // 2. MOTOR DE RENDERIZAÇÃO 3D VETORIAL (TRUE 3D PROJECTION CORRECTED)
    // -----------------------------------------------------------------
    const Engine3D = {
        fov: 800,
        project: function(objX, objY, objZ, camX, camY, camZ, pitch, yaw, roll, w, h) {
            let dx = objX - camX, dy = objY - camY, dz = objZ - camZ;
            
            let cy = Math.cos(yaw), sy = Math.sin(yaw);
            let x1 = dx * cy - dz * sy;
            let z1 = dx * sy + dz * cy;
            
            let cp = Math.cos(pitch), sp = Math.sin(pitch);
            let y2 = dy * cp - z1 * sp;
            let z2 = dy * sp + z1 * cp;
            
            if (z2 < 10) return { visible: false };
            
            let cr = Math.cos(roll), sr = Math.sin(roll);
            let finalX = x1 * cr - y2 * sr;
            let finalY = x1 * sr + y2 * cr;
            
            let scale = Engine3D.fov / z2;
            return { 
                x: (w/2) + (finalX * scale), 
                y: (h/2) - (finalY * scale), 
                s: scale, 
                z: z2, 
                visible: true 
            };
        },
        
        drawJetModel: function(ctx, px, py, scale, roll, isEnemy, color) {
            ctx.save(); 
            ctx.translate(px, py); 
            ctx.rotate(roll); 
            ctx.scale(scale, scale);
            
            let jetGrad = ctx.createLinearGradient(0, -30, 0, 30);
            if (isEnemy) {
                jetGrad.addColorStop(0, "#441111"); jetGrad.addColorStop(0.5, "#cc2222"); jetGrad.addColorStop(1, "#220000");
                ctx.strokeStyle = "#ff5555";
            } else {
                jetGrad.addColorStop(0, "#113333"); jetGrad.addColorStop(0.5, "#2288aa"); jetGrad.addColorStop(1, "#001111");
                ctx.strokeStyle = color || "#00ffcc";
            }

            ctx.lineWidth = 2; ctx.fillStyle = jetGrad;
            
            ctx.beginPath();
            ctx.moveTo(0, -40); ctx.lineTo(6, -15); ctx.lineTo(35, 10); ctx.lineTo(10, 15); ctx.lineTo(15, 30); 
            ctx.lineTo(0, 25); ctx.lineTo(-15, 30); ctx.lineTo(-10, 15); ctx.lineTo(-35, 10); ctx.lineTo(-6, -15); 
            ctx.closePath();
            
            ctx.shadowBlur = 10; ctx.shadowColor = isEnemy ? "#ff0000" : "#00ffff";
            ctx.fill(); ctx.stroke();
            
            ctx.fillStyle = "rgba(255,255,255,0.7)";
            ctx.beginPath(); ctx.moveTo(0,-25); ctx.lineTo(3,-10); ctx.lineTo(-3,-10); ctx.fill();

            ctx.shadowBlur = 20; ctx.shadowColor = "#ff9900";
            ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(0, 28, Math.random() * 5 + 4, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = "#ff6600"; ctx.beginPath(); ctx.arc(0, 28, Math.random() * 8 + 6, 0, Math.PI*2); ctx.fill();

            ctx.restore();
        }
    };

    const GameSfx = {
        ctx: null, engineSrc: null, ready: false,
        init: function() {
            if (this.ready) return;
            try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); this.ready = true; } catch(e) {}
        },
        startEngine: function() {
            if (!this.ready || this.engineSrc || !this.ctx) return;
            if (this.ctx.state === 'suspended') this.ctx.resume();
            const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
            const data = buf.getChannelData(0);
            for (let i = 0; i < buf.length; i++) data[i] = (Math.random() * 2 - 1) * 0.3;
            this.engineSrc = this.ctx.createBufferSource();
            this.engineSrc.buffer = buf; this.engineSrc.loop = true;
            const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 400;
            const gain = this.ctx.createGain(); gain.gain.value = 0.15;
            this.engineSrc.connect(filter); filter.connect(gain); gain.connect(this.ctx.destination);
            this.engineSrc.start();
        },
        play: function(type) {
            if (!window.Sfx || !window.Sfx.play) return;
            if (type === 'lock') window.Sfx.play(1000, 'square', 0.1, 0.1);
            else if (type === 'vulcan') window.Sfx.play(300, 'sawtooth', 0.08, 0.15);
            else if (type === 'boom') window.Sfx.play(80, 'sawtooth', 0.4, 0.2);
            else if (type === 'buy') window.Sfx.play(1200, 'sine', 0.1, 0.1);
            else if (type === 'missile' && this.ctx) {
                const t=this.ctx.currentTime, o=this.ctx.createOscillator(), g=this.ctx.createGain();
                o.type='square'; o.frequency.setValueAtTime(150,t); o.frequency.linearRampToValueAtTime(900,t+0.5);
                g.gain.setValueAtTime(0.5,t); g.gain.exponentialRampToValueAtTime(0.01,t+1);
                o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t+1);
            }
        },
        stop: function() { if (this.engineSrc) { try { this.engineSrc.stop(); } catch(e){} this.engineSrc = null; } }
    };

    // -----------------------------------------------------------------
    // 3. ESTRUTURA PRINCIPAL
    // -----------------------------------------------------------------
    const Game = {
        state: 'INIT', lastTime: 0, mode: 'SINGLE',
        session: { kills: 0, cash: 0, goal: 15, wave: 1, xp: 0 },
        upgrades: { engine: 1, missiles: 1, armor: 1 },
        currentStats: null,
        ship: { 
            hp: 100, maxHp: 100, speed: 250, x: 0, y: 3000, z: 0, vx: 0, vy: 0, vz: 250, 
            pitch: 0, yaw: 0, roll: 0, gForce: 1, mach: 0, alpha: 0, isStalling: false, 
            inputs: {pitch:0, roll:0}, afterburner: false,
            engineHealth: 100, wingHealth: 100, structuralIntegrity: 100, engineHeat: 0 
        },
        pilot: { active: false, baseY: 0, targetRoll: 0, targetPitch: 0, headTilt: false, throttle: 1.0 },
        timer: 5.0, keys: {}, keysBound: false, touchBound: false,
        entities: [], bullets: [], missiles: [], clouds: [], scenery: [], fx: [], floaters: [],
        combat: { target: null, locked: false, lockTimer: 0, vulcanCd: 0, missileCd: 0 },
        net: { isHost: false, uid: null, players: {}, sessionRef: null, playersRef: null, sharedRef: null, loop: null, sharedData: { wave: 1, teamKills: 0 }, lastSend: 0 },

        init: function(faseData) {
            this._cleanupNet();
            
            this.lastTime = performance.now();
            this.session = { kills: 0, cash: (window.Profile && window.Profile.coins) ? window.Profile.coins : 0, goal: 15, wave: 1, xp: (window.Profile && window.Profile.xp) ? window.Profile.xp : 0 };
            this.upgrades = { engine: 1, missiles: 1, armor: 1 };
            this.currentStats = JSON.parse(JSON.stringify(BASE_PLANE_STATS));
            
            this.ship = { 
                hp: 100, maxHp: 100, speed: 250, x: 0, y: 3000, z: 0, vx: 0, vy: 0, vz: 250, 
                pitch: 0, yaw: 0, roll: 0, gForce: 1, mach: 0, alpha: 0, isStalling: false, 
                inputs: {pitch:0, roll:0}, afterburner: false,
                engineHealth: 100, wingHealth: 100, structuralIntegrity: 100, engineHeat: 0 
            };
            this.pilot = { active: false, baseY: 0, targetRoll: 0, targetPitch: 0, headTilt: false, throttle: 1.0 };
            this.entities = []; this.bullets = []; this.missiles = []; this.clouds = []; this.scenery = []; this.fx = []; this.floaters = [];
            this.combat = { target: null, locked: false, lockTimer: 0, vulcanCd: 0, missileCd: 0 };
            
            for (let i = 0; i < 50; i++) {
                this.clouds.push({ x: (Math.random()-0.5)*120000, y: 4000+Math.random()*15000, z: (Math.random()-0.5)*120000, size: 3000+Math.random()*6000 });
            }

            for (let j = 0; j < 300; j++) {
                this.scenery.push({
                    x: (Math.random() - 0.5) * 100000,
                    z: (Math.random() - 0.5) * 100000,
                    w: 200 + Math.random() * 500,
                    h: 100 + Math.random() * 2000,
                    color: `rgba(${30 + Math.random() * 30}, ${40 + Math.random() * 40}, ${30 + Math.random() * 30}, 1)` 
                });
            }
            
            let baseUid = (window.System && window.System.playerId) ? window.System.playerId : "anon";
            let sessionSuffix = Math.floor(Math.random() * 100000);
            this.net.uid = baseUid + "_" + sessionSuffix;

            this.mode = (faseData && faseData.mode) ? faseData.mode : 'SINGLE';
            
            if (!this.keysBound) {
                window.addEventListener('keydown', (e) => this.keys[e.key] = true);
                window.addEventListener('keyup', (e) => this.keys[e.key] = false);
                this.keysBound = true;
            }
            
            if (!this.touchBound) {
                let self = this;
                let handleTap = function(e) {
                    try {
                        let cvs = window.System && window.System.canvas ? window.System.canvas : document.getElementById('game-canvas');
                        let rect = cvs ? cvs.getBoundingClientRect() : {left:0, top:0, width: window.innerWidth, height: window.innerHeight};
                        let cx = e.clientX; let cy = e.clientY;
                        if (e.touches && e.touches.length > 0) { cx = e.touches[0].clientX; cy = e.touches[0].clientY; }
                        
                        let touchX = ((cx - rect.left) / rect.width) * window.innerWidth;
                        let touchY = ((cy - rect.top) / rect.height) * window.innerHeight;
                        let sc = Math.min(1, window.innerWidth / 600); 

                        if ((self.state === 'LOBBY' || self.state === 'HANGAR') && touchX > 20*sc && touchX < 120*sc && touchY > 20*sc && touchY < 60*sc) {
                            self.cleanup();
                            if(window.System && window.System.home) window.System.home();
                            return;
                        }

                        if (self.state === 'LOBBY' && (self.mode === 'PVP' || self.mode === 'COOP') && touchX > window.innerWidth - 180*sc && touchY > 20*sc && touchY < 60*sc) {
                            if (self.net.sessionRef) {
                                self.net.sessionRef.child('host').set(self.net.uid);
                                self.net.sessionRef.child('state').set('LOBBY'); 
                                self.net.isHost = true;
                                if(window.System && window.System.msg) window.System.msg("VOCÊ ASSUMIU O CONTROLE!", "#00ffcc");
                            }
                            return;
                        }

                        if (self.state === 'LOBBY') {
                            if (self.mode === 'SINGLE' || self.mode === 'FREE') {
                                self.state = 'HANGAR';
                            } else if (self.net.isHost) {
                                if (self.net.sessionRef) self.net.sessionRef.child('state').set('HANGAR');
                                else self.state = 'HANGAR';
                            } else if (!self.net.isHost && self.net.uid && self.net.playersRef) {
                                self.net.playersRef.child(self.net.uid).update({ready: true});
                            }
                        } else if (self.state === 'HANGAR') {
                            self._processHangarClick(touchX, touchY, window.innerWidth, window.innerHeight);
                        } else if (self.state === 'CALIBRATION') {
                            self.timer = 0; 
                        } else if (self.state === 'PLAYING') {
                            self.pilot.headTilt = true;
                            setTimeout(() => { self.pilot.headTilt = false; }, 250);
                        }
                    } catch(err) { console.error("Touch Error:", err); }
                };
                window.addEventListener('pointerdown', handleTap);
                window.addEventListener('touchstart', handleTap);
                this.touchBound = true;
            }

            if ((this.mode === 'PVP' || this.mode === 'COOP') && window.DB) {
                this._initNet();
            } else {
                this.state = 'HANGAR'; 
                this.net.isHost = true; 
            }
            GameSfx.init();
        },

        _initNet: function() {
            this.state = 'LOBBY'; this.net.players = {};
            this.net.sessionRef = window.DB.ref('sessions/flight_' + this.mode);
            this.net.playersRef = this.net.sessionRef.child('players');
            this.net.sharedRef = this.net.sessionRef.child('shared');
            
            this.net.playersRef.child(this.net.uid).onDisconnect().remove();
            
            let self = this;
            let uname = (window.Profile && window.Profile.username) ? window.Profile.username : 'PILOTO';
            
            self.net.playersRef.child(self.net.uid).set({
                name: uname, ready: false, hp: 100, x: 0, y: 3000, z: 0, pitch: 0, yaw: 0, roll: 0, timestamp: Date.now(), firing: false, missilesFired: 0
            });

            this.net.playersRef.on('value', snap => { 
                self.net.players = snap.val() || {}; 
                
                if (self.state === 'PLAYING' && self.net.players[self.net.uid]) {
                    let remoteHp = self.net.players[self.net.uid].hp;
                    if (remoteHp !== undefined && remoteHp < self.ship.hp) {
                        self.ship.hp = remoteHp;
                        if (window.Gfx && window.Gfx.shakeScreen) window.Gfx.shakeScreen(15);
                    }
                }

                this.net.sessionRef.child('host').once('value').then(hSnap => {
                    let currentHost = hSnap.val();
                    let connectedUIDs = Object.keys(self.net.players);
                    
                    if (!currentHost || !self.net.players[currentHost]) {
                        if (connectedUIDs.length > 0) {
                            let newHost = connectedUIDs[0];
                            if (newHost === self.net.uid) {
                                self.net.isHost = true;
                                self.net.sessionRef.child('host').set(self.net.uid);
                                
                                if (connectedUIDs.length === 1) {
                                    self.net.sessionRef.child('state').set('LOBBY');
                                    self.net.sharedRef.set({ wave: 1, teamKills: 0 });
                                }
                            } else {
                                self.net.isHost = false;
                            }
                        }
                    } else {
                        self.net.isHost = (currentHost === self.net.uid);
                    }
                });
            });

            this.net.sharedRef.on('value', snap => { self.net.sharedData = snap.val() || { wave: 1, teamKills: 0 }; });
            
            this.net.sessionRef.child('state').on('value', snap => {
                if (snap.val() === 'HANGAR' && self.state === 'LOBBY') self.state = 'HANGAR';
                if (snap.val() === 'PLAYING' && self.state === 'HANGAR') { self.state = 'CALIBRATION'; self.timer = 5.0; }
            });
        },

        _cleanupNet: function() {
            if (this.net.loop) { clearInterval(this.net.loop); this.net.loop = null; }
            if (this.net.playersRef && this.net.uid) {
                this.net.playersRef.child(this.net.uid).remove();
                this.net.playersRef.off();
            }
            if (this.net.sharedRef) this.net.sharedRef.off();
            if (this.net.sessionRef) this.net.sessionRef.child('state').off();
            
            this.net.isHost = false;
            this.net.players = {};
            this.net.sessionRef = null;
            this.net.playersRef = null;
            this.net.sharedRef = null;
        },

        cleanup: function() {
            GameSfx.stop();
            this._cleanupNet();
            this.state = 'INIT';
        },

        _getRank: function() {
            let ranks = ["RECRUTA", "PILOTO", "VETERANO", "SARGENTO", "TENENTE", "CAPITÃO", "MAJOR", "CORONEL", "COMANDANTE", "ACE", "LENDÁRIO"];
            let idx = Math.min(10, Math.floor(Math.sqrt(this.session.xp / 500)));
            return ranks[idx];
        },

        _processHangarClick: function(x, y, w, h) {
            let buy = (cost, type) => {
                if (this.session.cash >= cost) {
                    this.session.cash -= cost;
                    this.upgrades[type]++;
                    GameSfx.play('buy');
                    let realId = window.System && window.System.playerId;
                    if (window.DB && realId) {
                        window.DB.ref('users/' + realId + '/coins').set(this.session.cash);
                    }
                } else GameSfx.play('vulcan');
            };

            let sc = Math.min(1, w / 600);
            if (y > h*0.3 && y < h*0.45) buy(500 * this.upgrades.engine, 'engine');
            else if (y > h*0.48 && y < h*0.63) buy(800 * this.upgrades.missiles, 'missiles');
            else if (y > h*0.66 && y < h*0.81) buy(1000 * this.upgrades.armor, 'armor');
            else if (y > h*0.85) {
                if ((this.mode === 'PVP' || this.mode === 'COOP') && this.net.isHost && this.net.sessionRef) {
                    this.net.sessionRef.child('state').set('PLAYING');
                    if (this.net.sharedRef) this.net.sharedRef.set({ wave: 1, teamKills: 0 }); 
                } else if (this.mode === 'SINGLE' || this.mode === 'FREE') { 
                    this.state = 'CALIBRATION'; this.timer = 5.0; 
                }
            }
        },

        _startMission: function() {
            this.state = 'PLAYING';
            this.session.wave = 1;
            this.entities = [];
            this.bullets = [];
            this.missiles = [];
        },

        update: function(ctx, w, h, pose) {
            try {
                const now = performance.now();
                let dt = (now - this.lastTime) / 1000;
                this.lastTime = now;
                
                if (dt > 0.05) dt = 0.05; 
                if (dt < 0.001) return this.session.cash || 0;

                if (!Number.isFinite(this.ship.vx)) this.ship.vx = 0;
                if (!Number.isFinite(this.ship.vy)) this.ship.vy = 0;
                if (!Number.isFinite(this.ship.vz)) this.ship.vz = 250;
                if (!Number.isFinite(this.ship.x))  this.ship.x = 0;
                if (!Number.isFinite(this.ship.y))  this.ship.y = 3000;
                if (!Number.isFinite(this.ship.z))  this.ship.z = 0;
                if (!Number.isFinite(this.ship.pitch)) this.ship.pitch = 0;
                if (!Number.isFinite(this.ship.yaw))   this.ship.yaw = 0;
                if (!Number.isFinite(this.ship.roll))  this.ship.roll = 0;

                if (this.state === 'LOBBY') { 
                    if (this.keys[' ']) {
                        if (this.mode === 'SINGLE' || this.mode === 'FREE') {
                            this.state = 'HANGAR';
                        } else if (this.net.isHost && Object.keys(this.net.players).length > 0) { 
                            if(this.net.sessionRef) this.net.sessionRef.child('state').set('HANGAR'); 
                        } else if (!this.net.isHost && this.net.playersRef) { 
                            this.net.playersRef.child(this.net.uid).update({ready: true}); 
                        }
                    }
                    this._drawLobby(ctx, w, h); 
                    return 0; 
                }

                if (this.state === 'HANGAR') {
                    if (this.keys[' ']) {
                        if (this.mode === 'SINGLE' || this.mode === 'FREE') { 
                            this.state = 'CALIBRATION'; this.timer = 5.0; 
                        } else if (this.net.isHost && this.net.sessionRef) { 
                            this.net.sessionRef.child('state').set('PLAYING'); 
                        }
                    }
                    this._drawHangar(ctx, w, h);
                    return 0;
                }
                
                this._readPose(pose, w, h, dt); 

                if (this.state === 'CALIBRATION') {
                    if (this.pilot.active) this.timer -= dt;
                    else {
                        this.timer += dt * 2; 
                        if (this.timer > 5.0) this.timer = 5.0;
                    }
                    
                    this._drawCalib(ctx, w, h);
                    if (this.timer <= 0 || this.keys[' ']) {
                        this.currentStats.thrust = BASE_PLANE_STATS.thrust + ((this.upgrades.engine - 1) * 50000);
                        this.ship.maxHp = 100 + ((this.upgrades.armor - 1) * 100);
                        this.ship.hp = this.ship.maxHp;
                        this.ship.engineHealth = 100;
                        this.ship.wingHealth = 100;
                        this.ship.structuralIntegrity = 100;
                        this._startMission(); 
                    }
                    return 0;
                }

                if (this.state === 'GAMEOVER' || this.state === 'VICTORY') {
                    this._drawEnd(ctx, w, h);
                    return this.session.cash;
                }

                if (this.ship.hp < this.ship.maxHp) {
                    let hpRatio = this.ship.hp / this.ship.maxHp;
                    if (hpRatio < 0.4) {
                        this.ship.engineHealth *= 0.999;
                        if (Math.random() < 0.1) this.fx.push(createParticle(this.ship.x, this.ship.y, this.ship.z, "#333", 10, 1.0, 'smoke'));
                    }
                    if (hpRatio < 0.3) this.ship.wingHealth *= 0.999;
                    if (hpRatio < 0.15) {
                        this.ship.structuralIntegrity *= 0.999;
                        if (Math.random() < 0.05) this.fx.push(createParticle(this.ship.x, this.ship.y, this.ship.z, "#f30", 15, 0.5, 'fire'));
                    }
                }

                let engEff = Math.max(0.3, this.ship.engineHealth / 100);
                let wingEff = Math.max(0.3, this.ship.wingHealth / 100);
                let structEff = Math.max(0.3, this.ship.structuralIntegrity / 100);

                if ((this.mode === 'PVP' || this.mode === 'COOP') && this.net.players) {
                    Object.keys(this.net.players).forEach(uid => {
                        if (uid !== this.net.uid && this.net.players[uid] && this.net.players[uid].hp > 0) {
                            let rp = this.net.players[uid];
                            rp.x += (rp.vx || 0) * dt; 
                            rp.y += (rp.vy || 0) * dt; 
                            rp.z += (rp.vz || 0) * dt;
                            
                            if (rp.firing && Math.random() < 0.2) {
                                let tX = Math.sin(rp.yaw)*Math.cos(rp.pitch);
                                let tY = Math.sin(rp.pitch);
                                let tZ = Math.cos(rp.yaw)*Math.cos(rp.pitch);
                                this.fx.push(createParticle(rp.x+tX*50, rp.y-10, rp.z+tZ*50, "#ff0", 5, 0.2, 'tracer'));
                            }
                            if (rp.missilesFired > (rp.lastMissilesFired || 0)) {
                                rp.lastMissilesFired = rp.missilesFired;
                                this.fx.push(createParticle(rp.x, rp.y-20, rp.z, "#ff9900", 20, 1.0, 'fire'));
                            }
                        }
                    });
                }

                let altitude = Math.max(0, Math.min(GAME_CONFIG.MAX_ALTITUDE, this.ship.y));
                let tempK = 288.15 - 0.0065 * altitude; 
                let airDensity = 1.225 * Math.pow(Math.max(0, 1 - 0.0000225577 * altitude), 4.2561); 
                let speedOfSound = Math.sqrt(Math.max(1, GAME_CONFIG.GAMMA * GAME_CONFIG.R_GAS * tempK));

                let V = Math.hypot(this.ship.vx, this.ship.vy, this.ship.vz);
                if (V === 0) V = 1;
                this.ship.speed = V;
                this.ship.mach = V / speedOfSound;

                let cy = Math.cos(this.ship.yaw), sy = Math.sin(this.ship.yaw);
                let cp = Math.cos(this.ship.pitch), sp = Math.sin(this.ship.pitch);
                let cr = Math.cos(this.ship.roll), sr = Math.sin(this.ship.roll);

                let fwdX = sy * cp, fwdY = sp, fwdZ = cy * cp;
                let upX = -sy*sp*cr - cy*sr, upY = cp*cr, upZ = -cy*sp*cr + sy*sr;

                let vDirX = this.ship.vx/V, vDirY = this.ship.vy/V, vDirZ = this.ship.vz/V;
                let cosAlpha = fwdX*vDirX + fwdY*vDirY + fwdZ*vDirZ;
                this.ship.alpha = Math.acos(Math.max(-1, Math.min(1, cosAlpha))) || 0;

                let CL = this.ship.alpha * (this.currentStats.clMax / this.currentStats.stallAngle) + 0.5; 
                this.ship.isStalling = V < 40; 
                if (this.ship.isStalling) CL = 0.1; 

                let CD = this.currentStats.cd0 + this.currentStats.kInduced * (CL * CL);
                CD *= (1.0 + (1.0 - structEff)); 

                let dynPress = 0.5 * airDensity * (V * V);
                let liftMag = dynPress * this.currentStats.wingArea * CL;
                let dragMag = dynPress * this.currentStats.wingArea * CD;

                let liftFx = upX * liftMag, liftFy = upY * liftMag, liftFz = upZ * liftMag;
                let dragFx = -vDirX * dragMag, dragFy = -vDirY * dragMag, dragFz = -vDirZ * dragMag;
                
                let currentThrust = this.currentStats.thrust * engEff;
                if (this.ship.afterburner) {
                    this.ship.engineHeat += dt * 20;
                    if (this.ship.engineHeat < this.currentStats.overheatThreshold) {
                        currentThrust *= 1.5;
                        if(Math.random() < 0.3) this.fx.push(createParticle(this.ship.x - fwdX*30, this.ship.y - fwdY*30, this.ship.z - fwdZ*30, "#0cf", 8, 0.2, 'afterburner'));
                    } else {
                        currentThrust *= 0.5; 
                    }
                } else {
                    this.ship.engineHeat = Math.max(0, this.ship.engineHeat - dt * 10);
                }

                let thrustMag = currentThrust * this.pilot.throttle;
                let thrustFx = fwdX * thrustMag, thrustFy = fwdY * thrustMag, thrustFz = fwdZ * thrustMag;

                let weight = this.currentStats.mass * GAME_CONFIG.GRAVITY;
                let Fx = liftFx + dragFx + thrustFx;
                let Fy = liftFy + dragFy + thrustFy - weight; 
                let Fz = liftFz + dragFz + thrustFz;

                let ax = Fx / this.currentStats.mass;
                let ay = Fy / this.currentStats.mass;
                let az = Fz / this.currentStats.mass;

                let maxAccel = 15.0 * GAME_CONFIG.GRAVITY; 
                let accMag = Math.hypot(ax, ay, az);
                if (accMag > maxAccel) {
                    ax = (ax / accMag) * maxAccel; ay = (ay / accMag) * maxAccel; az = (az / accMag) * maxAccel;
                }

                this.ship.vx += ax * dt;
                this.ship.vz += az * dt;

                let targetVy = fwdY * this.ship.speed;
                this.ship.vy += (targetVy - this.ship.vy) * 5.0 * dt;

                this.ship.gForce = Math.hypot(ax, ay + GAME_CONFIG.GRAVITY, az) / GAME_CONFIG.GRAVITY;

                this.ship.x += this.ship.vx * dt;
                this.ship.y += this.ship.vy * dt;
                this.ship.z += this.ship.vz * dt;

                if (this.ship.y < 50) { 
                    this.ship.y = 50; 
                    this.ship.vy = Math.max(0, this.ship.vy); 
                    if (this.ship.pitch < 0) this.ship.pitch = 0; 
                }

                let effectiveLift = liftMag * Math.max(0.5, this.ship.inputs.pitch); 
                let turnRate = (effectiveLift * Math.sin(this.ship.roll)) / (this.currentStats.mass * V);
                let arcadeTurn = Math.sin(this.ship.roll) * Math.max(0, this.ship.inputs.pitch) * 2.0; 
                turnRate += arcadeTurn;

                if (!this.ship.isStalling && !isNaN(turnRate)) {
                    this.ship.yaw += Math.max(-2.5, Math.min(2.5, turnRate)) * dt; 
                }

                this.ship.roll += (this.pilot.targetRoll - this.ship.roll) * this.currentStats.maxRollRate * wingEff * dt;
                this.ship.pitch += (this.pilot.targetPitch - this.ship.pitch) * this.currentStats.maxPitchRate * dt;
                
                if (this.ship.isStalling) {
                    this.ship.pitch += (-0.2 - this.ship.pitch) * dt; 
                }
                this.ship.pitch = Math.max(-Math.PI/2.5, Math.min(Math.PI/2.5, this.ship.pitch));
                
                this._processCombat(dt, w, h);
                this._spawnEnemies(); 
                this._updateAI(dt);
                this._updateEntities(dt, now);
                this._updateBullets(dt);
                this._updateMissiles(dt); 
                this._cleanupFx();

                if ((this.mode === 'PVP' || this.mode === 'COOP') && this.net.playersRef && this.net.uid) {
                    if (performance.now() - this.net.lastSend > 100) {
                        this.net.playersRef.child(this.net.uid).update({
                            x: this.ship.x, y: this.ship.y, z: this.ship.z,
                            pitch: this.ship.pitch, yaw: this.ship.yaw, roll: this.ship.roll,
                            vx: this.ship.vx, vy: this.ship.vy, vz: this.ship.vz,
                            timestamp: Date.now()
                        });
                        this.net.lastSend = performance.now();
                    }
                }

                if (this.ship.hp <= 0 && this.state !== 'GAMEOVER') this._endGame('GAMEOVER');

                if (this.mode === 'PVP' && this.session.kills >= 1 && this.state === 'PLAYING') {
                    this._endGame('VICTORY');
                }

                this._draw(ctx, w, h);
                return this.session.cash + this.session.kills * 10;

            } catch (err) {
                console.error("CRITICAL FLIGHT ERROR:", err);
                ctx.fillStyle = '#111'; ctx.fillRect(0, 0, w, h);
                ctx.fillStyle = '#ff0000'; ctx.font = 'bold 20px Arial'; ctx.textAlign = 'left';
                ctx.fillText("SISTEMA DE VOO EM MODO DE SEGURANÇA (RECUPERANDO)...", 50, 50);
                
                this.ship.x = 0; this.ship.y = 3000; this.ship.z = 0;
                this.ship.vx = 0; this.ship.vy = 0; this.ship.vz = 250;
                this.state = 'HANGAR'; 
                
                return 0;
            }
        },

        _readPose: function(pose, w, h, dt) {
            let trgRoll = 0, trgPitch = 0, inputDetected = false;
            this.pilot.headTilt = false; 
            
            if (this.keys['ArrowUp']) trgPitch = 1.0; else if (this.keys['ArrowDown']) trgPitch = -1.0;
            if (this.keys['ArrowRight']) trgRoll = 1.0; else if (this.keys['ArrowLeft']) trgRoll = -1.0;
            if (this.keys[' ']) this.pilot.headTilt = true;
            if (this.keys['Shift']) this.ship.afterburner = true; else this.ship.afterburner = false;
            if (this.keys['ArrowUp'] || this.keys['ArrowDown'] || this.keys['ArrowLeft'] || this.keys['ArrowRight']) inputDetected = true;

            let pts = null;
            if (pose && Array.isArray(pose)) pts = pose;
            else if (pose && pose.keypoints) pts = pose.keypoints;
            else if (pose && Array.isArray(pose) && pose[0] && pose[0].keypoints) pts = pose[0].keypoints;

            if (pts && pts.length > 0) {
                let rightWrist = null, leftWrist = null;
                for (let i = 0; i < pts.length; i++) {
                    let k = pts[i];
                    if (!k) continue;
                    if ((k.name === 'right_wrist' || k.part === 'right_wrist' || i === 10) && k.score > 0.3) rightWrist = k;
                    if ((k.name === 'left_wrist' || k.part === 'left_wrist' || i === 9) && k.score > 0.3) leftWrist = k;
                }
                
                if (rightWrist && leftWrist) {
                    inputDetected = true;
                    let rx = (1 - ((rightWrist.x || 0) / 640)) * w; 
                    let ry = ((rightWrist.y || 0) / 480) * h;
                    let lx = (1 - ((leftWrist.x || 0) / 640)) * w; 
                    let ly = ((leftWrist.y || 0) / 480) * h;
                    
                    let rollInput = Math.atan2(ry - ly, rx - lx) / 1.5;
                    trgRoll = Math.max(-1.0, Math.min(1.0, rollInput));
                    
                    let avgY = (ry + ly) / 2;
                    if (this.state === 'CALIBRATION') {
                        this.pilot.baseY = this.pilot.baseY * 0.95 + avgY * 0.05;
                        if (!this.pilot.baseY) this.pilot.baseY = avgY;
                    } else {
                        let deltaY = avgY - this.pilot.baseY;
                        let safeH = h > 0 ? h : 100; 
                        
                        // FIX V35: PONTO DOCE DO YOKE. 0.09 é o balanço exato entre cansaço (0.15) e jitter (0.05)
                        let pitchInput = -deltaY / (safeH * 0.09); 
                        
                        trgPitch = Math.max(-1.0, Math.min(1.0, pitchInput || 0)); 
                    }

                    let handsDist = Math.hypot(rx - lx, ry - ly);
                    if (handsDist < w * 0.25 && this.state === 'PLAYING') {
                        this.pilot.headTilt = true; 
                    }
                    if (handsDist > w * 0.5) {
                        this.ship.afterburner = true; 
                    } else {
                        this.ship.afterburner = false;
                    }
                }
            }

            if (inputDetected) {
                this.pilot.active = true;
                this.pilot.targetRoll += (trgRoll - this.pilot.targetRoll) * 12 * dt;
                this.pilot.targetPitch += (trgPitch - this.pilot.targetPitch) * 12 * dt;
            } else {
                this.pilot.active = false;
                this.pilot.targetRoll *= 0.9;
                this.pilot.targetPitch *= 0.9;
            }
            
            this.ship.inputs.pitch = this.pilot.targetPitch;
            this.ship.inputs.roll = this.pilot.targetRoll;
        },

        _processCombat: function(dt, w, h) {
            this.combat.target = null; this.combat.locked = false; let closestZ = Infinity;
            
            const scan = (obj, isPlayer, uid) => {
                let p = Engine3D.project(obj.x, obj.y, obj.z, this.ship.x, this.ship.y, this.ship.z, this.ship.pitch, this.ship.yaw, this.ship.roll, w, h);
                let dx = obj.x - this.ship.x, dy = obj.y - this.ship.y, dz = obj.z - this.ship.z;
                let dist = Math.hypot(dx, dy, dz);
                if (dist < 1) dist = 1;
                
                let vDirX = this.ship.vx/this.ship.speed, vDirY = this.ship.vy/this.ship.speed, vDirZ = this.ship.vz/this.ship.speed;
                let dirX = dx/dist, dirY = dy/dist, dirZ = dz/dist;
                let dot = vDirX*dirX + vDirY*dirY + vDirZ*dirZ;

                if (p.visible && p.z > 200 && p.z < 60000 && dot > 0.5 && p.z < closestZ) { 
                    closestZ = p.z;
                    this.combat.target = isPlayer ? {x:obj.x, y:obj.y, z:obj.z, vx:obj.vx||0, vy:obj.vy||0, vz:obj.vz||0, hp:obj.hp, isPlayer:true, uid:uid} : obj;
                }
            };

            this.entities.forEach(e => { if(e.type && (e.type.startsWith('jet') || e.type === 'boss')) scan(e, false); });

            if ((this.mode === 'PVP' || this.mode === 'COOP') && this.net.players) {
                Object.keys(this.net.players).forEach(id => {
                    if (id !== this.net.uid && this.net.players[id]?.hp > 0) scan(this.net.players[id], true, id);
                });
            }

            if (this.combat.target) {
                this.combat.lockTimer += dt;
                if (this.combat.lockTimer >= 0.5) {
                    if (!this.combat.locked) GameSfx.play('lock');
                    this.combat.locked = true;
                    this.combat.lockTimer = 0.5;
                }
            } else {
                this.combat.lockTimer -= dt * 2;
                if (this.combat.lockTimer < 0) this.combat.lockTimer = 0;
            }

            let firingState = false;

            if (this.combat.locked && this.combat.target && performance.now() - this.combat.vulcanCd > 80) {
                this.combat.vulcanCd = performance.now();
                let spd = this.ship.speed + 1200;
                
                let tX = this.combat.target.x + (this.combat.target.vx || 0) * 0.1;
                let tY = this.combat.target.y + (this.combat.target.vy || 0) * 0.1;
                let tZ = this.combat.target.z + (this.combat.target.vz || 0) * 0.1;

                let dx = tX - this.ship.x, dy = tY - this.ship.y, dz = tZ - this.ship.z;
                let distLead = Math.hypot(dx,dy,dz);
                if (distLead < 1) distLead = 1;

                this.bullets.push({
                    x: this.ship.x + Math.cos(this.ship.yaw)*60, y: this.ship.y-20, z: this.ship.z - Math.sin(this.ship.yaw)*60,
                    vx: this.ship.vx + (dx/distLead)*spd, vy: this.ship.vy + (dy/distLead)*spd, vz: this.ship.vz + (dz/distLead)*spd,
                    isEnemy: false, life: 2
                });
                GameSfx.play('vulcan');
                firingState = true;
            }

            if (this.combat.missileCd > 0) this.combat.missileCd -= dt;

            if (this.combat.locked && this.pilot.headTilt && this.combat.missileCd <= 0) {
                if (Math.random() < 0.95) { 
                    this.missiles.push({
                        x: this.ship.x, y: this.ship.y-50, z: this.ship.z,
                        vx: this.ship.vx, vy: this.ship.vy, vz: this.ship.vz,
                        target: this.combat.target, life: 10, maxG: 40 + (this.upgrades.missiles * 5), trackTime: 0
                    });
                    GameSfx.play('missile');
                    if ((this.mode === 'PVP' || this.mode === 'COOP') && this.net.playersRef && this.net.uid) {
                        this.net.playersRef.child(this.net.uid).child('missilesFired').transaction(current => (current || 0) + 1);
                    }
                }
                this.combat.missileCd = Math.max(0.5, 1.5 - (this.upgrades.missiles * 0.2)); 
            }

            if ((this.mode === 'PVP' || this.mode === 'COOP') && this.net.playersRef) {
                if (performance.now() - this.net.lastSend > 100) {
                    this.net.playersRef.child(this.net.uid).update({ firing: firingState, timestamp: Date.now() });
                    this.net.lastSend = performance.now();
                }
            }
        },

        _spawnEnemies: function() {
            if (this.mode === 'PVP' || this.mode === 'FREE') return; 
            
            let currentKills = this.session.kills;
            if (this.mode === 'COOP' && this.net.sharedData) currentKills = this.net.sharedData.teamKills || this.session.kills;

            let maxEnemies = this.session.wave * 3;
            if (this.entities.filter(e => e.type && e.type.startsWith('jet')).length >= maxEnemies || Math.random() > 0.05) return;
            
            let dist = 8000 + Math.random()*10000;
            let fX = Math.sin(this.ship.yaw) * Math.cos(this.ship.pitch);
            let fZ = Math.cos(this.ship.yaw) * Math.cos(this.ship.pitch);
            let sx = this.ship.x + fX*dist + (Math.random()-0.5)*15000;
            let sz = this.ship.z + fZ*dist + (Math.random()-0.5)*15000;
            
            this.entities.push({ 
                type: 'jet_fighter', state: 'PATROL', x: sx, y: Math.max(1000, this.ship.y+(Math.random()-0.5)*4000), z: sz, 
                vx: -fX*250, vy: 0, vz: -fZ*250, hp: 150 * this.session.wave, yaw: this.ship.yaw + Math.PI, roll: 0, pitch: 0,
                target: null, stateTimer: 0, active: true, engineHealth: 100, wingHealth: 100, structuralIntegrity: 100
            });
        },

        _updateAI: function(dt) {
            this.entities.forEach(e => {
                if (!e.active || !(e.type && (e.type.startsWith('jet') || e.type === 'boss'))) return;

                e.stateTimer -= dt;
                
                let target = this.ship;
                let minDist = Math.hypot(this.ship.x - e.x, this.ship.y - e.y, this.ship.z - e.z);
                
                if ((this.mode === 'COOP' || this.mode === 'PVP') && this.net.players) {
                    Object.keys(this.net.players).forEach(uid => {
                        let rp = this.net.players[uid];
                        if (rp && rp.hp > 0) {
                            let d = Math.hypot(rp.x - e.x, rp.y - e.y, rp.z - e.z);
                            if (d < minDist) { minDist = d; target = rp; }
                        }
                    });
                }

                let tX = target.x, tY = target.y, tZ = target.z;

                let dx = target.x - e.x, dy = target.y - e.y, dz = target.z - e.z;
                let directYaw = Math.atan2(dx, dz);
                let yawDiffToPlayer = directYaw - e.yaw;
                while (yawDiffToPlayer > Math.PI) yawDiffToPlayer -= Math.PI * 2;
                while (yawDiffToPlayer < -Math.PI) yawDiffToPlayer += Math.PI * 2;

                if (e.stateTimer <= 0) {
                    if (e.hp < 30) e.state = 'RETREAT';
                    else if (e.isBoss && e.hp < 1000 && Math.random() < 0.3) e.state = 'BOSS_PHASE';
                    else if (minDist < 2000) e.state = 'EVADE'; 
                    else if (minDist > 12000) e.state = 'INTERCEPT';
                    else {
                        e.state = Math.random() > 0.4 ? 'TAIL' : 'ENGAGE';
                    }
                    e.stateTimer = 1.0 + Math.random() * 1.5; 
                }

                if (e.state === 'TAIL') {
                    tX = target.x - Math.sin(target.yaw) * 2000;
                    tZ = target.z - Math.cos(target.yaw) * 2000;
                    tY = target.y + 300; 
                }
                
                let movDx = tX - e.x, movDy = tY - e.y, movDz = tZ - e.z;
                let targetYaw = Math.atan2(movDx, movDz);
                let targetPitch = Math.atan2(movDy, Math.hypot(movDx, movDz));

                let yawDiff = targetYaw - e.yaw;
                while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
                while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
                
                if (e.state === 'EVADE') {
                    targetYaw += Math.PI/2; 
                    e.roll += (Math.PI/2 - e.roll) * 3 * dt;
                } else if (e.state === 'VERTICAL_MANEUVER') {
                    targetPitch += Math.PI/3; 
                    e.roll += (Math.PI - e.roll) * 3 * dt;
                } else if (e.state === 'RETREAT') {
                    targetYaw += Math.PI; 
                    targetPitch = 0.2;
                    e.roll += (0 - e.roll) * 2 * dt;
                } else {
                    e.roll += (yawDiff * 3.0 - e.roll) * 4 * dt;
                }
                
                let newYawDiff = targetYaw - e.yaw;
                while (newYawDiff > Math.PI) newYawDiff -= Math.PI * 2;
                while (newYawDiff < -Math.PI) newYawDiff += Math.PI * 2;
                
                let wingEff = e.wingHealth ? Math.max(0.3, e.wingHealth / 100) : 1.0;
                
                e.yaw += newYawDiff * (e.isBoss ? 2.0 : 1.5) * wingEff * dt;
                e.pitch += (targetPitch - e.pitch) * (e.isBoss ? 2.0 : 1.5) * wingEff * dt;
                
                let speed = e.isBoss ? 450 : (e.state === 'EVADE' ? 380 : 320);
                let engEff = e.engineHealth ? Math.max(0.3, e.engineHealth / 100) : 1.0;
                speed *= engEff;
                
                e.vx = Math.sin(e.yaw) * Math.cos(e.pitch) * speed || 0;
                e.vy = Math.sin(e.pitch) * speed || 0;
                e.vz = Math.cos(e.yaw) * Math.cos(e.pitch) * speed || 0;

                if (minDist < 10000 && Math.abs(yawDiffToPlayer) < 0.3 && (e.state === 'INTERCEPT' || e.state === 'ENGAGE' || e.state === 'TAIL')) {
                    if (Math.random() < (e.isBoss ? 0.1 : 0.03)) { 
                        let bSpd = 800; 
                        if (minDist < 1) minDist = 1;
                        this.bullets.push({
                            x: e.x, y: e.y, z: e.z,
                            vx: e.vx + (dx/minDist)*bSpd, vy: e.vy + (dy/minDist)*bSpd, vz: e.vz + (dz/minDist)*bSpd,
                            isEnemy: true, life: 3.5
                        });
                    }
                }
            });
        },

        _updateMissionSystem: function() {
            if (this.mode === 'PVP' || this.mode === 'FREE') return;
            
            let currentKills = this.session.kills;
            if (this.mode === 'COOP' && this.net.sharedData) {
                currentKills = this.net.sharedData.teamKills || this.session.kills;
            }

            if (currentKills >= 15 && this.session.wave === 1) {
                this.session.wave = 2;
                if(window.System && window.System.msg) window.System.msg("WAVE 2: INIMIGOS REFORÇADOS", "#ffcc00");
                if (this.net.isHost && this.net.sharedRef) this.net.sharedRef.update({wave: 2});
            } else if (currentKills >= 30 && this.session.wave === 2) {
                this.session.wave = 3;
                if(window.System && window.System.msg) window.System.msg("WAVE 3: O CHEFÃO CHEGOU!", "#ff3300");
                if (this.net.isHost && this.net.sharedRef) this.net.sharedRef.update({wave: 3});
                
                let fX = Math.sin(this.ship.yaw) * Math.cos(this.ship.pitch);
                let fZ = Math.cos(this.ship.yaw) * Math.cos(this.ship.pitch);
                this.entities.push({ 
                    type: 'boss', state: 'ENGAGE', x: this.ship.x + fX*12000, y: this.ship.y+2000, z: this.ship.z + fZ*12000, 
                    vx: -fX*350, vy: 0, vz: -fZ*350, hp: 2000, yaw: this.ship.yaw + Math.PI, roll: 0, pitch: 0, isBoss: true, active: true, stateTimer: 0, engineHealth: 100, wingHealth: 100, structuralIntegrity: 100 
                });
            } else if (currentKills >= 31 && this.session.wave === 3) {
                this.session.xp += 1000; 
                this._endGame('VICTORY');
            }
        },

        _updateEntities: function(dt, now) {
            for (let e of this.entities) {
                e.x += e.vx*dt; e.y += e.vy*dt; e.z += e.vz*dt;
                if (e.y < 100) e.y = 100;
                
                let dx = this.ship.x - e.x, dy = this.ship.y - e.y, dz = this.ship.z - e.z;
                if (Math.hypot(dx, dy, dz) > 120000 && !e.isBoss) { e.hp = -1; }
            }
            this.entities = this.entities.filter(e => e.hp > 0);
            this._updateMissionSystem();
        },

        _updateBullets: function(dt) {
            for (let i = this.bullets.length-1; i >= 0; i--) {
                let b = this.bullets[i];
                b.x += b.vx*dt; b.y += b.vy*dt; b.z += b.vz*dt; b.life -= dt;
                if (b.isEnemy) {
                    if (Math.hypot(b.x-this.ship.x, b.y-this.ship.y, b.z-this.ship.z) < 80) {
                        let randHit = Math.random();
                        if (randHit < 0.3) this.ship.engineHealth -= 10;
                        else if (randHit < 0.6) this.ship.wingHealth -= 10;
                        else this.ship.structuralIntegrity -= 10;

                        this.ship.hp -= 10;
                        if (window.Gfx && window.Gfx.shakeScreen) window.Gfx.shakeScreen(15);
                        b.life = 0;
                    }
                } else {
                    for (let e of this.entities) {
                        if (Math.hypot(b.x-e.x, b.y-e.y, b.z-e.z) < (e.isBoss? 300 : 150)) {
                            if (this.mode === 'SINGLE' || this.mode === 'FREE' || this.net.isHost) {
                                e.hp -= 50; 
                                let randHit = Math.random();
                                if (randHit < 0.3) e.engineHealth -= 10;
                                else if (randHit < 0.6) e.wingHealth -= 10;
                                else e.structuralIntegrity -= 10;
                                if (e.hp <= 0) this._kill(e, e.isBoss?2000:150);
                            }
                            b.life = 0;
                            this._fx(e.x,e.y,e.z,'#f90',4,40);
                            break;
                        }
                    }
                    
                    if (this.mode==='PVP' && b.life>0 && this.net.players) {
                        Object.keys(this.net.players).forEach(uid => {
                            if (uid!==this.net.uid && this.net.players[uid]?.hp>0 && Math.hypot(b.x-this.net.players[uid].x, b.y-this.net.players[uid].y, b.z-this.net.players[uid].z)<150) {
                                b.life=0;
                                this._fx(this.net.players[uid].x,this.net.players[uid].y,this.net.players[uid].z,'#f90',4,50);
                                if (window.DB && window.DB.ref) {
                                    let newHp = this.net.players[uid].hp - 10;
                                    window.DB.ref(`sessions/flight_${this.mode}/players/${uid}/hp`).set(newHp);
                                    if (newHp <= 0 && this.state === 'PLAYING') {
                                        this.session.kills++;
                                        this.session.cash += 500;
                                        this.session.xp += 100;
                                    }
                                }
                            }
                        });
                    }
                    if (b.y < 0) { b.life = 0; this._fx(b.x,0,b.z,'#789',3,50); }
                }
                if (b.life <= 0) this.bullets.splice(i,1);
            }
        },

        _updateMissiles: function(dt) {
            for (let i = this.missiles.length-1; i >= 0; i--) {
                let m = this.missiles[i];
                let V = Math.hypot(m.vx, m.vy, m.vz);
                if (V < 1) V = 1;

                m.trackTime = (m.trackTime || 0) + dt;

                if (m.target && (m.target.hp>0 || m.target.isPlayer)) {
                    let rx = m.target.x - m.x, ry = m.target.y - m.y, rz = m.target.z - m.z;
                    let dist = Math.hypot(rx, ry, rz);
                    if (dist < 1) dist = 1;
                    let dist2 = dist * dist;
                    
                    if (dist < 100) { 
                        if (m.target.isPlayer && this.mode==='PVP') {
                            if (window.DB && window.DB.ref) {
                                let newHp = m.target.hp - 50;
                                window.DB.ref(`sessions/flight_${this.mode}/players/${m.target.uid}/hp`).set(newHp);
                                if (newHp <= 0 && this.state === 'PLAYING') {
                                    this.session.kills++;
                                    this.session.cash += 500;
                                    this.session.xp += 100;
                                }
                            }
                            this._fx(m.target.x,m.target.y,m.target.z,'#f33',40,300);
                        } else if (!m.target.isPlayer) {
                            if (this.mode === 'SINGLE' || this.mode === 'FREE' || this.net.isHost) {
                                m.target.hp -= 400 + (this.upgrades.missiles * 100);
                                if (m.target.hp <= 0) this._kill(m.target, m.target.isBoss?2000:300);
                            }
                            this._fx(m.target.x,m.target.y,m.target.z,'#f33',40,300);
                        }
                        m.life = 0;
                    } else {
                        let vDirX = m.vx/V, vDirY = m.vy/V, vDirZ = m.vz/V;
                        let tDirX = rx/dist, tDirY = ry/dist, tDirZ = rz/dist;
                        let dot = vDirX*tDirX + vDirY*tDirY + vDirZ*tDirZ;
                        
                        if (dot < 0.4 || Math.random() < 0.005 || m.trackTime > 15) { 
                            m.target = null; 
                        }

                        if (m.target) {
                            let tx = m.target.vx || 0, ty = m.target.vy || 0, tz = m.target.vz || 0;
                            let vrx = tx - m.vx, vry = ty - m.vy, vrz = tz - m.vz;
                            
                            let cx = ry * vrz - rz * vry, cy = rz * vrx - rx * vrz, cz = rx * vry - ry * vrx;
                            let omx = cx/dist2, omy = cy/dist2, omz = cz/dist2;
                            
                            let Vc = -(rx*vrx + ry*vry + rz*vrz) / dist;
                            
                            let oxux = omy*tDirZ - omz*tDirY, oxuy = omz*tDirX - omx*tDirZ, oxuz = omx*tDirY - omy*tDirX;
                            
                            let N = 5.0;
                            let ax = N * Vc * oxux, ay = N * Vc * oxuy, az = N * Vc * oxuz;
                            
                            let accMag = Math.hypot(ax, ay, az);
                            let maxAcc = m.maxG * GAME_CONFIG.GRAVITY;
                            if (accMag > maxAcc) { ax = (ax/accMag)*maxAcc; ay = (ay/accMag)*maxAcc; az = (az/accMag)*maxAcc; }
                            
                            if (!isNaN(ax)) { m.vx += ax*dt; m.vy += ay*dt; m.vz += az*dt; }
                        }
                    }
                }
                
                let vDirX = m.vx/V, vDirY = m.vy/V, vDirZ = m.vz/V;
                m.vx += vDirX * 800 * dt; m.vy += vDirY * 800 * dt; m.vz += vDirZ * 800 * dt;

                m.x += m.vx*dt; m.y += m.vy*dt; m.z += m.vz*dt; m.life -= dt;
                this.fx.push(createParticle(m.x, m.y, m.z, 'rgba(255,200,100,0.8)', 8, 0.5, 'smoke'));
                if (m.life <= 0) this.missiles.splice(i,1);
            }
        },

        _cleanupFx: function() {
            for (let c of this.clouds) {
                if (Math.hypot(c.x-this.ship.x, c.z-this.ship.z) > 120000) {
                    let fX = Math.sin(this.ship.yaw) * Math.cos(this.ship.pitch);
                    let fZ = Math.cos(this.ship.yaw) * Math.cos(this.ship.pitch);
                    c.z = this.ship.z + fZ*90000 + (Math.random()-0.5)*50000;
                    c.x = this.ship.x + fX*90000 + (Math.random()-0.5)*50000;
                }
            }
            this.floaters = this.floaters.filter(f => { f.life -= 1/60; f.y -= 80/60; return f.life > 0; });
            
            if (this.fx.length > 150) this.fx.splice(0, this.fx.length - 150);
            this.fx = this.fx.filter(f => { f.x+=f.vx/60; f.y+=f.vy/60; f.z+=f.vz/60; f.life-=1/60; return f.life>0; });
        },

        _fx: function(x, y, z, c, n, s) {
            for(let i=0; i<n; i++) {
                this.fx.push(createParticle(x, y, z, c, s + Math.random()*200, 1+Math.random(), 'explosion'));
            }
        },

        _kill: function(t, rew) {
            GameSfx.play('boom');
            this._fx(t.x,t.y,t.z,'#f33',40,300);
            this._fx(t.x,t.y,t.z,'#234',30,600);
            this.floaters.push({x:t.x,y:t.y,z:t.z,text:`+ R$ ${rew}`,life:2});
            this.session.kills++;
            this.session.cash += rew;
            this.session.xp += rew;
            
            if (this.mode === 'COOP' && this.net.sharedRef) {
                let teamKills = (this.net.sharedData.teamKills || 0) + 1;
                this.net.sharedRef.update({ teamKills: teamKills });
            }

            let realId = window.System && window.System.playerId;
            if (window.DB && realId) {
                window.DB.ref('users/' + realId + '/coins').set(this.session.cash);
                window.DB.ref('users/' + realId + '/xp').transaction(current => (current || 0) + this.session.xp);
            }
        },

        _endGame: function(res) {
            this.state = res;
            GameSfx.stop();
            setTimeout(() => {
                if (window.System && window.System.gameOver) window.System.gameOver(this.session.kills*100, res==='VICTORY', this.session.cash);
                else if (window.System && window.System.home) window.System.home();
            }, 2000);
        },

        _draw: function(ctx, w, h) {
            ctx.save();
            let gShake = Math.min(10, Math.max(0, (this.ship.gForce - 6.0) * 1.5));
            if (gShake > 0) {
                ctx.translate((Math.random()-0.5)*gShake, (Math.random()-0.5)*gShake);
            }
            
            this._drawWorld(ctx,w,h);
            this._drawEntities(ctx,w,h);
            this._drawHUD(ctx,w,h);
            this._drawCockpit(ctx,w,h);
            ctx.restore();
            
            ctx.fillStyle='rgba(0,0,0,0.1)';
            for(let i=0;i<h;i+=4) ctx.fillRect(0,i,w,1);
        },

        _drawHangar: function(ctx, w, h) {
            let sc = Math.min(1, w / 600); 
            
            ctx.fillStyle='rgba(10,15,20,0.95)'; ctx.fillRect(0,0,w,h);
            
            ctx.fillStyle='#e74c3c'; ctx.fillRect(20*sc, 20*sc, 100*sc, 40*sc);
            ctx.fillStyle='#fff'; ctx.font=`bold ${14*sc}px Arial`; ctx.textAlign='center'; ctx.fillText('SAIR', 70*sc, 45*sc);

            ctx.fillStyle='#00ffcc'; ctx.font=`bold ${40*sc}px "Russo One", Arial`; 
            ctx.fillText('HANGAR MILITAR', w/2, h*0.15);
            ctx.fillStyle='#f1c40f'; ctx.font=`bold ${24*sc}px Arial`; 
            ctx.fillText(`SALDO: R$ ${this.session.cash} | RANK: ${this._getRank()}`, w/2, h*0.25);

            let drawCard = (cx, cy, title, desc, cost, level, color) => {
                ctx.fillStyle = this.session.cash >= cost ? color : '#333';
                ctx.fillRect(cx - 150*sc, cy - 30*sc, 300*sc, 60*sc);
                ctx.fillStyle = '#fff'; ctx.font=`bold ${16*sc}px Arial`;
                ctx.fillText(`${title} (LVL ${level})`, cx, cy - 5*sc);
                ctx.font=`${12*sc}px Arial`; ctx.fillText(`${desc} - R$ ${cost}`, cx, cy + 15*sc);
            };

            drawCard(w/2, h*0.37, "MOTOR TURBINADO", "Potência e Aceleração", 500 * this.upgrades.engine, this.upgrades.engine, '#2980b9');
            drawCard(w/2, h*0.55, "MÍSSEIS AVANÇADOS", "Dano + Recarga", 800 * this.upgrades.missiles, this.upgrades.missiles, '#c0392b');
            drawCard(w/2, h*0.73, "BLINDAGEM PESADA", "Aumenta Integridade", 1000 * this.upgrades.armor, this.upgrades.armor, '#27ae60');

            ctx.fillStyle='#2c3e50'; ctx.fillRect(w/2-200*sc, h*0.85, 400*sc, 60*sc);
            ctx.fillStyle='#fff'; ctx.font=`bold ${22*sc}px "Russo One", Arial`; 
            
            if (this.mode === 'SINGLE' || this.mode === 'FREE' || this.net.isHost) {
                ctx.fillText('TOQUE AQUI PARA VOAR', w/2, h*0.85+38*sc);
            } else {
                ctx.fillText('AGUARDANDO LÍDER INICIAR...', w/2, h*0.85+38*sc);
            }
        },

        _drawWorld: function(ctx,w,h) {
            let safeH = h > 0 ? h : 100;
            let hy = Math.sin(this.ship.pitch || 0) * safeH * 1.5;
            
            ctx.save();
            ctx.translate(w/2, safeH/2);
            ctx.rotate(-(this.ship.roll || 0));
            
            let skyY0 = -safeH * 4;
            let skyY1 = hy;
            if (Math.abs(skyY0 - skyY1) < 1) skyY1 = skyY0 + 1; 

            let sG = ctx.createLinearGradient(0, skyY0, 0, skyY1);
            sG.addColorStop(0,'#020b14'); sG.addColorStop(0.6,'#0a2342'); sG.addColorStop(1,'#1d4d76');
            ctx.fillStyle = sG;
            ctx.fillRect(-w*3, -safeH*4, w*6, hy + safeH*4);
            
            let groundY0 = hy;
            let groundY1 = safeH * 4;
            if (Math.abs(groundY0 - groundY1) < 1) groundY1 = groundY0 + 1;

            let gG = ctx.createLinearGradient(0, groundY0, 0, groundY1);
            gG.addColorStop(0,'#1b2e1b'); gG.addColorStop(0.3,'#0d170d'); gG.addColorStop(1,'#050805');
            ctx.fillStyle = gG;
            ctx.fillRect(-w*3, hy, w*6, safeH*4);
            ctx.restore();

            let sunP = Engine3D.project(
                this.ship.x, this.ship.y + 50000, this.ship.z + 200000, 
                this.ship.x, this.ship.y, this.ship.z, 
                this.ship.pitch, this.ship.yaw, this.ship.roll, w, safeH
            );
            
            if (sunP.visible) {
                 ctx.fillStyle = "rgba(255, 255, 200, 0.9)";
                 ctx.shadowBlur = 60 * sunP.s; ctx.shadowColor = "#ffaa00";
                 ctx.beginPath(); ctx.arc(sunP.x, sunP.y, 10000 * sunP.s, 0, Math.PI*2); ctx.fill();
                 ctx.shadowBlur = 0;
            }

            ctx.strokeStyle='rgba(40, 150, 40, 0.3)'; ctx.lineWidth=2; ctx.beginPath();
            let st=4000;
            let sx=Math.floor((this.ship.x||0)/st)*st - st*15;
            let sz=Math.floor((this.ship.z||0)/st)*st - st*15;
            
            for(let x=0; x<=30; x++) {
                let p1 = Engine3D.project(sx + x*st, 0, sz, this.ship.x, this.ship.y, this.ship.z, this.ship.pitch, this.ship.yaw, this.ship.roll, w, safeH);
                let p2 = Engine3D.project(sx + x*st, 0, sz + 60*st, this.ship.x, this.ship.y, this.ship.z, this.ship.pitch, this.ship.yaw, this.ship.roll, w, safeH);
                if (p1.visible && p2.visible && Number.isFinite(p1.x) && Number.isFinite(p2.x)) { 
                    ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); 
                }
            }
            for (let z = 0; z <= 60; z++) {
                let p1 = Engine3D.project(sx, 0, sz + z*st, this.ship.x, this.ship.y, this.ship.z, this.ship.pitch, this.ship.yaw, this.ship.roll, w, safeH);
                let p2 = Engine3D.project(sx + 30*st, 0, sz + z*st, this.ship.x, this.ship.y, this.ship.z, this.ship.pitch, this.ship.yaw, this.ship.roll, w, safeH);
                if (p1.visible && p2.visible && Number.isFinite(p1.x) && Number.isFinite(p2.x)) { 
                    ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); 
                }
            }
            ctx.stroke();

            this.scenery.forEach(s => {
                let baseP = Engine3D.project(s.x, 0, s.z, this.ship.x, this.ship.y, this.ship.z, this.ship.pitch, this.ship.yaw, this.ship.roll, w, safeH);
                let topP = Engine3D.project(s.x, s.h, s.z, this.ship.x, this.ship.y, this.ship.z, this.ship.pitch, this.ship.yaw, this.ship.roll, w, safeH);
                
                if (baseP.visible && topP.visible && baseP.y > topP.y && Number.isFinite(baseP.x)) {
                    ctx.strokeStyle = s.color;
                    ctx.lineWidth = s.w * baseP.s;
                    ctx.lineCap = 'butt';
                    ctx.beginPath(); ctx.moveTo(baseP.x, baseP.y); ctx.lineTo(topP.x, topP.y); ctx.stroke();
                    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = (s.w * baseP.s) / 3; ctx.stroke(); 
                }
            });
        },

        _drawEntities: function(ctx,w,h) {
            let buf=[];
            const add=(list,t)=>list.forEach(o=>{
                let p=Engine3D.project(o.x,o.y,o.z,this.ship.x,this.ship.y,this.ship.z,this.ship.pitch,this.ship.yaw,this.ship.roll,w,h);
                if(p.visible && Number.isFinite(p.x)) buf.push({p,t,o});
            });
            add(this.clouds,'c'); add(this.entities,'e'); add(this.bullets,'b'); add(this.missiles,'m'); add(this.fx,'f'); add(this.floaters,'x');
            
            if((this.mode==='PVP' || this.mode==='COOP') && this.net.players) {
                Object.keys(this.net.players).forEach(uid=>{
                    if(uid!==this.net.uid&&this.net.players[uid]?.hp>0){
                        let rp = this.net.players[uid];
                        let px = rp.x + (rp.vx||0)*0.05, py = rp.y + (rp.vy||0)*0.05, pz = rp.z + (rp.vz||0)*0.05; 
                        let p=Engine3D.project(px, py, pz, this.ship.x, this.ship.y, this.ship.z, this.ship.pitch, this.ship.yaw, this.ship.roll, w, h);
                        if(p.visible && Number.isFinite(p.x)) buf.push({p,t:'p',o:rp,id:uid});
                    }
                });
            }
            buf.sort((a,b)=>b.p.z-a.p.z);
            buf.forEach(d=>{
                let p=d.p,s=p.s,o=d.o;
                if(d.t==='c'){ctx.fillStyle='rgba(255,255,255,0.05)';ctx.beginPath();ctx.arc(p.x,p.y,o.size*s,0,Math.PI*2);ctx.fill();}
                else if(d.t==='x'){ctx.fillStyle='#2ecc71';ctx.font=`bold ${Math.max(16,1500*s)}px 'Russo One'`;ctx.textAlign='center';ctx.fillText(o.text,p.x,p.y);}
                else if(d.t==='e'||d.t==='p'){
                    let isNet=d.t==='p';
                    Engine3D.drawJetModel(ctx, p.x, p.y, Math.max(0.1, s*2), o.roll||0, !isNet, isNet?(this.mode==='COOP'?'#00ffcc':'#ff3300'):(o.isBoss?'#f39c12':'#00ffcc'));
                    if(isNet){ctx.fillStyle=this.mode==='COOP'?'#00ffcc':'#ff3300';ctx.font='bold 14px Arial';ctx.textAlign='center';ctx.fillText(o.name||'ALIADO',p.x,p.y-300*s-10);}
                    
                    let dist = Math.hypot(o.x - this.ship.x, o.y - this.ship.y, o.z - this.ship.z);
                    let locked=this.combat.target&&(isNet?this.combat.target.uid===d.id:this.combat.target===o);
                    
                    ctx.strokeStyle = locked ? '#ff0000' : (isNet && this.mode==='COOP' ? '#00ffcc' : '#ff9900');
                    ctx.lineWidth = locked ? 2 : 1;
                    ctx.strokeRect(p.x - 20, p.y - 20, 40, 40);
                    ctx.fillStyle = ctx.strokeStyle;
                    ctx.font = '10px "Russo One", Arial';
                    ctx.textAlign = 'center';
                    
                    ctx.fillText(Math.floor(dist) + 'm', p.x, p.y - 28);
                    ctx.fillText('ALT:' + Math.floor(o.y), p.x, p.y - 15);

                    if(locked){
                        let bs = Math.max(40, 250*s); 
                        ctx.beginPath(); ctx.moveTo(p.x, p.y - bs); ctx.lineTo(p.x, p.y - bs - 20); ctx.stroke();
                        ctx.beginPath(); ctx.moveTo(p.x, p.y + bs); ctx.lineTo(p.x, p.y + bs + 20); ctx.stroke();
                        ctx.beginPath(); ctx.moveTo(p.x - bs, p.y); ctx.lineTo(p.x - bs - 20, p.y); ctx.stroke();
                        ctx.beginPath(); ctx.moveTo(p.x + bs, p.y); ctx.lineTo(p.x + bs + 20, p.y); ctx.stroke();
                        ctx.fillStyle='#ff0000';ctx.font='bold 14px Arial';ctx.textAlign='center';
                        ctx.fillText('MIRA TRAVADA',p.x,p.y+bs+35);
                    }
                }
                else if(d.t==='b'){ctx.globalCompositeOperation='lighter';ctx.fillStyle=o.isEnemy?'#ff0000':'#ffff00';ctx.beginPath();ctx.arc(p.x,p.y,Math.max(2,6*s),0,Math.PI*2);ctx.fill();ctx.globalCompositeOperation='source-over';}
                else if(d.t==='m'){ctx.fillStyle=o.isEnemy?'#ff3300':'#ffffff';ctx.beginPath();ctx.arc(p.x,p.y,Math.max(2,6*s),0,Math.PI*2);ctx.fill();}
                else if(d.t==='f'){ctx.globalCompositeOperation='lighter';ctx.globalAlpha=Math.max(0,o.life);ctx.fillStyle=o.c;ctx.beginPath();ctx.arc(p.x,p.y,Math.max(2,o.size*s),0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';}
            });
        },
        
        _drawHUD: function(ctx,w,h){
            let p = this.ship;
            
            ctx.fillStyle='rgba(0,20,10,0.5)'; ctx.fillRect(10, h/2 - 120, 50, 240);
            ctx.fillStyle='#00ffcc'; ctx.font='bold 14px Arial'; ctx.textAlign='center';
            ctx.fillText("SPD", 35, h/2 - 130);
            for(let i=-4; i<=4; i++) {
                let val = Math.floor(p.speed*3.6) + (i*50);
                let yPos = h/2 - (i*25);
                ctx.fillRect(45, yPos, 15, 2);
                if(i===0) { ctx.fillStyle='#fff'; ctx.fillText(val, 25, yPos+4); ctx.fillStyle='#00ffcc'; }
            }
            ctx.beginPath(); ctx.moveTo(60, h/2); ctx.lineTo(70, h/2-8); ctx.lineTo(70, h/2+8); ctx.fill();

            ctx.fillStyle='rgba(0,20,10,0.5)'; ctx.fillRect(w-60, h/2 - 120, 50, 240);
            ctx.fillStyle='#00ffcc'; ctx.fillText("ALT", w-35, h/2 - 130);
            for(let i=-4; i<=4; i++) {
                let val = Math.floor(p.y) + (i*100);
                let yPos = h/2 - (i*25);
                ctx.fillRect(w-60, yPos, 15, 2);
                if(i===0) { ctx.fillStyle='#fff'; ctx.fillText(val, w-25, yPos+4); ctx.fillStyle='#00ffcc'; }
            }
            ctx.beginPath(); ctx.moveTo(w-60, h/2); ctx.lineTo(w-70, h/2-8); ctx.lineTo(w-70, h/2+8); ctx.fill();

            let hdg=(p.yaw*180/Math.PI)%360;if(hdg<0)hdg+=360;
            ctx.fillStyle='rgba(0,0,0,0.5)';ctx.fillRect(0,0,w,50);
            ctx.textAlign='center';ctx.fillStyle='#fff';ctx.font='bold 22px "Russo One", Arial';ctx.fillText(Math.floor(hdg)+'°',w/2,35);
            
            ctx.strokeStyle='#00ffcc'; ctx.lineWidth=2;
            ctx.beginPath(); ctx.arc(w/2, h/2, 4, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.arc(w/2, h/2, 20, 0, Math.PI*2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(w/2 - 40, h/2); ctx.lineTo(w/2 - 20, h/2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(w/2 + 40, h/2); ctx.lineTo(w/2 + 20, h/2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(w/2, h/2 - 40); ctx.lineTo(w/2, h/2 - 20); ctx.stroke();

            if (this.combat.target) {
                let distToTarget = Math.hypot(this.combat.target.x - p.x, this.combat.target.y - p.y, this.combat.target.z - p.z);
                let spd = p.speed + 1200;
                let leadTime = distToTarget / spd;
                let tX = this.combat.target.x + (this.combat.target.vx || 0) * leadTime;
                let tY = this.combat.target.y + (this.combat.target.vy || 0) * leadTime;
                let tZ = this.combat.target.z + (this.combat.target.vz || 0) * leadTime;
                let leadP = Engine3D.project(tX, tY, tZ, p.x, p.y, p.z, p.pitch, p.yaw, p.roll, w, h);
                if (leadP.visible) {
                    ctx.strokeStyle = 'rgba(255, 200, 0, 0.5)';
                    ctx.beginPath(); ctx.arc(leadP.x, leadP.y, 10, 0, Math.PI*2); ctx.stroke();
                }
            }

            let vDirX = p.vx/p.speed, vDirY = p.vy/p.speed, vDirZ = p.vz/p.speed;
            let vP = Engine3D.project(p.x + vDirX*1000, p.y + vDirY*1000, p.z + vDirZ*1000, p.x, p.y, p.z, p.pitch, p.yaw, p.roll, w, h);
            if (vP.visible) {
                ctx.strokeStyle = 'rgba(0, 255, 0, 0.5)';
                ctx.beginPath(); ctx.arc(vP.x, vP.y, 5, 0, Math.PI*2); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(vP.x-10, vP.y); ctx.lineTo(vP.x-5, vP.y); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(vP.x+10, vP.y); ctx.lineTo(vP.x+5, vP.y); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(vP.x, vP.y-10); ctx.lineTo(vP.x, vP.y-5); ctx.stroke();
            }

            ctx.textAlign='left'; ctx.font='bold 14px Arial'; ctx.fillStyle='#00ffcc';
            ctx.fillText(`FORÇA G: ${p.gForce.toFixed(1)}G`, 20, 80);
            ctx.fillText(`MACH: ${p.mach.toFixed(2)}`, 20, 100);
            ctx.fillText(`AoA: ${(p.alpha * 180/Math.PI).toFixed(1)}°`, 20, 120);
            
            if (p.afterburner) {
                ctx.fillStyle='#ff9900';
                ctx.fillText(`AQUECIMENTO: ${Math.floor(p.engineHeat)}%`, 20, 140);
            }

            if (p.mach > 2.2) {
                ctx.fillStyle='#ff0000'; ctx.font='bold 24px Arial'; ctx.textAlign='center';
                ctx.fillText("ALERTA: OVERSPEED!", w/2, h/2 - 130);
            } else if (p.isStalling) {
                ctx.fillStyle = (Math.floor(performance.now() / 150) % 2 === 0) ? "#ff0000" : "#fff"; 
                ctx.textAlign = "center"; ctx.font = "bold 32px 'Russo One', Arial"; ctx.fillText("ALERTA DE ESTOL! BAIXE O BICO!", w/2, h/2 - 100); 
            }

            const rx=w-90, ry=140, rr=75;
            ctx.fillStyle='rgba(0,30,10,0.85)'; ctx.beginPath(); ctx.arc(rx,ry,rr,0,Math.PI*2); ctx.fill();
            ctx.strokeStyle='rgba(0,255,204,0.3)'; ctx.lineWidth=1;
            ctx.beginPath(); ctx.arc(rx,ry,rr*0.5,0,Math.PI*2); ctx.stroke();
            ctx.beginPath(); ctx.arc(rx,ry,rr,0,Math.PI*2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(rx,ry-rr); ctx.lineTo(rx,ry+rr); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(rx-rr,ry); ctx.lineTo(rx+rr,ry); ctx.stroke();
            
            ctx.beginPath(); ctx.moveTo(rx,ry); ctx.lineTo(rx-rr*0.6, ry-rr*0.8); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(rx,ry); ctx.lineTo(rx+rr*0.6, ry-rr*0.8); ctx.stroke();

            ctx.fillStyle='#fff'; ctx.beginPath(); ctx.moveTo(rx,ry-6); ctx.lineTo(rx-5,ry+4); ctx.lineTo(rx+5,ry+4); ctx.fill();
            
            const RADAR_RANGE = 40000;
            const plot=(tx, ty, tz, col, isTarget)=>{
                let dx = tx - p.x, dy = ty - p.y, dz = tz - p.z;
                let cr = Math.cos(p.yaw), sr = Math.sin(p.yaw);
                let lx = dx*cr - dz*sr;
                let lz = dx*sr + dz*cr;
                let d = Math.hypot(lx, lz);
                
                if(d < RADAR_RANGE) {
                    let px = rx + (lx/RADAR_RANGE)*rr;
                    let py = ry - (lz/RADAR_RANGE)*rr;
                    
                    ctx.fillStyle=col; 
                    ctx.beginPath();
                    
                    if (dy > 500) { 
                        ctx.moveTo(px, py - 6); ctx.lineTo(px - 5, py + 4); ctx.lineTo(px + 5, py + 4); 
                        ctx.fill(); 
                    } else if (dy < -500) { 
                        ctx.moveTo(px, py + 6); ctx.lineTo(px - 5, py - 4); ctx.lineTo(px + 5, py - 4); 
                        ctx.fill(); 
                    } else {
                        ctx.arc(px, py, 4, 0, Math.PI*2); 
                        ctx.fill(); 
                    }
                    
                    if (isTarget) {
                        ctx.strokeStyle = '#ff0000'; ctx.lineWidth = 1;
                        ctx.beginPath(); ctx.arc(px, py, 8, 0, Math.PI*2); ctx.stroke();
                    }
                }
            };

            this.entities.forEach(e => plot(e.x, e.y, e.z, e.isBoss?'#ff9900':'#ff0000', this.combat.target === e));
            if((this.mode==='PVP' || this.mode==='COOP') && this.net.players) {
                Object.keys(this.net.players).forEach(uid => {
                    if(uid!==this.net.uid && this.net.players[uid]?.hp>0) {
                        plot(this.net.players[uid].x, this.net.players[uid].y, this.net.players[uid].z, this.mode==='COOP'?'#00ffff':'#ff0000', false);
                    }
                });
            }
        },

        _drawCockpit: function(ctx,w,h){
            let cx=w/2,cy=h/2;
            
            if(this.pilot.active){
                ctx.save();
                let yokeYOffset = 0;
                if (this.pilot.targetPitch < -0.2) yokeYOffset = 40; 
                else if (this.pilot.targetPitch > 0.2) yokeYOffset = -40; 
                
                let sc = Math.min(1, w/600); 
                ctx.translate(cx, h + yokeYOffset + 20); 
                ctx.scale(sc, sc);
                
                ctx.fillStyle='#050a10';ctx.fillRect(-30,-180,60,180);
                ctx.translate(0,-160);ctx.rotate(this.pilot.targetRoll);
                
                ctx.shadowBlur = 10; ctx.shadowColor = "#000";
                ctx.fillStyle='#1a202c'; ctx.strokeStyle='#00ffcc'; ctx.lineWidth=3; ctx.lineJoin='round';
                
                ctx.beginPath();
                ctx.moveTo(-130, -20);
                ctx.lineTo(-150, 60);
                ctx.lineTo(-80, 80);
                ctx.lineTo(80, 80);
                ctx.lineTo(150, 60);
                ctx.lineTo(130, -20);
                ctx.lineTo(70, -20);
                ctx.lineTo(70, 30);
                ctx.lineTo(-70, 30);
                ctx.lineTo(-70, -20);
                ctx.closePath();
                ctx.fill(); ctx.stroke();
                
                ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(-110, 0, 20, 0, Math.PI*2); ctx.fill();
                ctx.beginPath(); ctx.arc(110, 0, 20, 0, Math.PI*2); ctx.fill();

                ctx.fillStyle = this.combat.missileCd <= 0 ? '#ff3300' : '#440000'; 
                ctx.beginPath(); ctx.arc(-110, 0, 10, 0, Math.PI*2); ctx.fill();

                ctx.fillStyle='#ffcc00'; ctx.beginPath(); ctx.arc(110, 0, 10, 0, Math.PI*2); ctx.fill();
                
                if (this.combat.target) {
                    if (this.combat.lockTimer >= 0.5) {
                        ctx.fillStyle = "#ff0000"; ctx.font = "bold 24px Arial"; ctx.textAlign = "center";
                        ctx.fillText("JUNTE AS MÃOS PARA ATIRAR!", 0, -50);
                    } else {
                        ctx.fillStyle = "#ffcc00"; ctx.font = "bold 16px Arial"; ctx.textAlign = "center";
                        ctx.fillText("TRAVANDO MIRA...", 0, -50);
                    }
                }

                ctx.restore();
            } else {
                ctx.fillStyle='#ff0000';ctx.textAlign='center';ctx.font='bold 22px Arial';ctx.fillText('SEGURE O VOLANTE COM AS DUAS MÃOS',cx,h-100);
            }

            ctx.fillStyle='rgba(0,15,10,0.8)';ctx.fillRect(0,h-50,w,50);
            ctx.fillStyle='#222';ctx.fillRect(20,h-30,w/2 - 40,12);
            ctx.fillStyle=this.ship.hp>30?'#00ffcc':'#ff3300';
            ctx.fillRect(20,h-30,(w/2 - 40)*(Math.max(0,this.ship.hp)/this.ship.maxHp),12);
            ctx.fillStyle='#fff';ctx.font='bold 14px Arial';ctx.textAlign='left';ctx.fillText(`INTEGRIDADE: ${Math.floor(this.ship.hp)} / ${this.ship.maxHp}`,20,h-35);
            ctx.fillStyle='#f1c40f';ctx.font='bold 22px "Russo One", Arial';ctx.textAlign='right';
            
            let coOpText = (this.mode === 'COOP') ? ` | ABATES TIME: ${this.net.sharedData?.teamKills||this.session.kills}` : '';
            ctx.fillText(`R$ ${this.session.cash}${coOpText}`,w-20,h-20);
        },
        
        _drawLobby: function(ctx,w,h){
            let sc = Math.min(1, w / 600); 
            
            ctx.fillStyle='rgba(10,20,10,0.95)';ctx.fillRect(0,0,w,h);
            
            ctx.fillStyle='#e74c3c'; ctx.fillRect(20*sc, 20*sc, 100*sc, 40*sc);
            ctx.fillStyle='#fff'; ctx.font=`bold ${14*sc}px Arial`; ctx.textAlign='center'; ctx.fillText('SAIR', 70*sc, 45*sc);

            if (this.mode === 'PVP' || this.mode === 'COOP') {
                ctx.fillStyle='#f39c12'; ctx.fillRect(w - 180*sc, 20*sc, 160*sc, 40*sc);
                ctx.fillStyle='#fff'; ctx.font=`bold ${14*sc}px Arial`; ctx.textAlign='center'; ctx.fillText('🛠️ ASSUMIR LÍDER', w - 100*sc, 45*sc);
            }

            ctx.fillStyle='#00ffcc'; ctx.font=`bold ${40*sc}px "Russo One", Arial`;ctx.fillText('SALA DE REUNIÃO TÁTICA',w/2,h*0.15);
            const ps=Object.keys(this.net.players);
            ctx.font=`bold ${24*sc}px Arial`;ctx.fillStyle='#fff';ctx.fillText(`PILOTOS CONECTADOS: ${ps.length}`,w/2,h*0.25);
            let py=h*0.35;
            ps.forEach(uid=>{
                let p = this.net.players[uid];
                ctx.fillStyle=p.ready?'#2ecc71':'#e74c3c';ctx.fillText(`[${p.ready?'PRONTO':'AGUARDANDO'}] ${p.name}`,w/2,py);py+=40*sc;
            });
            
            if(this.net.isHost){
                const r=ps.length>=1;
                ctx.fillStyle=r?'#c00':'#333';ctx.fillRect(w/2-250*sc,h*0.85,500*sc,60*sc);
                ctx.fillStyle='#fff';ctx.font=`bold ${22*sc}px "Russo One", Arial`;ctx.fillText(r?'TOQUE NA TELA PARA INICIAR A MISSÃO':'AGUARDANDO...',w/2,h*0.85+38*sc);
            }else{
                let isR = this.net.players[this.net.uid]?.ready;
                ctx.fillStyle=isR?'#e83':'#27a';ctx.fillRect(w/2-250*sc,h*0.85,500*sc,60*sc);
                ctx.fillStyle='#fff';ctx.font=`bold ${22*sc}px "Russo One", Arial`;ctx.fillText(isR?'AGUARDANDO O LÍDER INICIAR':'TOQUE NA TELA: CONFIRMAR PRESENÇA',w/2,h*0.85+38*sc);
            }
        },

        _drawCalib: function(ctx,w,h){
            let sc = Math.min(1, w / 600); 
            
            ctx.fillStyle='rgba(0,10,15,0.95)';ctx.fillRect(0,0,w,h);
            ctx.strokeStyle='rgba(0,255,204,0.2)';ctx.lineWidth=2;ctx.strokeRect(50*sc,50*sc,w-100*sc,h-100*sc);
            ctx.fillStyle='#00ffcc';ctx.textAlign='center';ctx.font=`bold ${30*sc}px "Russo One", Arial`;ctx.fillText('CALIBRAÇÃO DE VOO',w/2,h*0.3);
            ctx.fillStyle='#fff';ctx.font=`bold ${20*sc}px Arial`;ctx.fillText('POSICIONE AS DUAS MÃOS FRENTE À CÂMERA.',w/2,h*0.4);
            ctx.fillStyle='#f1c40f';ctx.font=`bold ${16*sc}px Arial`;ctx.fillText('GIRE COMO UM VOLANTE PARA CURVAR. PUXE PARA SUBIR.',w/2,h*0.48);
            ctx.fillStyle='#ff5555';ctx.font=`bold ${16*sc}px Arial`;ctx.fillText('JUNTE AS MÃOS PARA ATIRAR MÍSSEIS.',w/2,h*0.53);
            
            let pct=1-(this.timer/5.0);
            ctx.fillStyle='#111';ctx.fillRect(w/2-200*sc,h*0.65,400*sc,15*sc);
            
            if (this.pilot.active) {
                ctx.fillStyle='#00ffcc';ctx.fillRect(w/2-200*sc,h*0.65,400*sc*pct,15*sc);
                ctx.fillText(`MANTENHA A POSIÇÃO (${Math.ceil(this.timer)}s)`, w/2, h*0.75);
            } else {
                ctx.fillStyle='#ff0000';
                ctx.fillText('AGUARDANDO MÃOS NA CÂMERA...', w/2, h*0.75);
            }
        },

        _drawEnd: function(ctx,w,h){
            this._draw(ctx,w,h);
            ctx.fillStyle='rgba(0,0,0,0.85)';ctx.fillRect(0,0,w,h);
            ctx.textAlign='center';ctx.font='bold 40px "Russo One", Arial';
            ctx.fillStyle=this.state==='VICTORY'?'#2ecc71':'#ff0000';
            ctx.fillText(this.state==='VICTORY'?'MISSÃO CUMPRIDA!':'CAÇA ABATIDO',w/2,h/2);
            ctx.fillStyle='#f1c40f';ctx.font='bold 30px Arial';
            ctx.fillText(`RECOMPENSA DE COMBATE: R$ ${this.session.cash}`,w/2,h/2+60);
        }
    };

    const register = () => {
        if (window.System && window.System.registerGame) {
            window.System.registerGame('usarmy_flight_sim', 'Aero Strike WAR', '✈️', Game, {
                camera: 'user', camOpacity: 0.2,
                phases: [
                    { id: 'training', name: 'CAMPANHA SOLO', desc: 'Destrua as ameaças e evolua o seu caça.', mode: 'SINGLE', reqLvl: 1 },
                    { id: 'free', name: 'VOO LIVRE', desc: 'Explore o cenário e treine manobras.', mode: 'FREE', reqLvl: 1 },
                    { id: 'coop', name: 'CO-OP ESQUADRÃO', desc: 'Junte-se a aliados para abater o ACE.', mode: 'COOP', reqLvl: 1 },
                    { id: 'pvp', name: 'COMBATE PVP', desc: 'Batalha aérea multijogador.', mode: 'PVP', reqLvl: 1 }
                ]
            });
            return true;
        }
        return false;
    };

    if (!register()) {
        const check = setInterval(() => { if (register()) clearInterval(check); }, 100);
    }
})();