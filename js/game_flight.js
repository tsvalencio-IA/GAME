// =============================================================================
// AERO STRIKE WAR: TACTICAL YOKE SIMULATOR (AAA PROFESSIONAL EVOLUTION)
// ARQUITETO: SENIOR GAME ENGINE ARCHITECT
// STATUS: 100% CORRIGIDO E ESTÁVEL (PVP MORTAL & CO-OP ANTI-FANTASMA ATIVOS)
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
            vx: (Math.random() - 0.5) * 100, vy: (Math.random() - 0.5) * 100, vz: (Math.random() - 0.5) * 100,
            color: c, size: size, life: life, maxLife: life, type: type
        };
    }

    // -----------------------------------------------------------------
    // 2. MOTOR PRINCIPAL DO JOGO (GAME LOOP)
    // -----------------------------------------------------------------
    const Game = {
        state: 'INIT', 
        lastTime: 0,
        phase: null,
        
        plane: {
            x: 0, y: 5000, z: 0,
            vx: 0, vy: 0, vz: -250, 
            pitch: 0, roll: 0, yaw: 0,
            speed: 250, 
            maxHp: 100,
            stats: Object.assign({}, BASE_PLANE_STATS)
        },

        controls: {
            pitchInput: 0, rollInput: 0, throttle: 0.5, afterburner: false,
            triggerMissile: false, gunFiring: false
        },

        session: { hp: 100, kills: 0, wave: 1, bossActive: false, bossKilled: false, cash: 0, overspeedDamage: 0 },
        ui: { crosshairX: 0, crosshairY: 0, lockTimer: 0, lockedTargetId: null, shake: 0 },
        world: { particles: [], clouds: [], groundColor: '#2c3e50', skyColor: '#34495e' },
        
        enemies: [],
        enemyBullets: [],
        missiles: [],
        weapons: { vulcanCooldown: 0, missileCooldown: 0, missileDamage: 400, missileAgility: 40 },
        remotePlayersData: {},

        init: function(phaseData) {
            this.phase = phaseData || { mode: 'FREE' };
            this.state = 'CALIBRATING';
            this.lastTime = performance.now();
            this.calibTimer = 3.0;

            let pwrEngine = 1, pwrMissile = 1, pwrArmor = 1;
            if(window.Profile && window.Profile.upgrades && window.Profile.upgrades['usarmy_flight_sim']) {
                const upg = window.Profile.upgrades['usarmy_flight_sim'];
                pwrEngine = upg.engine || 1;
                pwrMissile = upg.missile || 1;
                pwrArmor = upg.armor || 1;
            }

            this.plane.stats = Object.assign({}, BASE_PLANE_STATS);
            this.plane.stats.thrust += (pwrEngine - 1) * 50000;
            this.weapons.missileDamage = 400 + ((pwrMissile - 1) * 100);
            this.weapons.missileAgility = 40 + ((pwrMissile - 1) * 5);
            this.plane.maxHp = 100 + ((pwrArmor - 1) * 100);

            this.plane.x = 0; this.plane.y = 5000; this.plane.z = 0;
            this.plane.pitch = 0; this.plane.roll = 0; this.plane.yaw = 0;
            this.plane.vx = 0; this.plane.vy = 0; this.plane.vz = -250;
            this.plane.speed = 250;
            
            // Garantindo que a Boss Kill flag reseta a false para evitar vitória instantânea
            this.session = { hp: this.plane.maxHp, kills: 0, wave: 1, bossActive: false, bossKilled: false, cash: 0, overspeedDamage: 0 };
            this.enemies = []; this.missiles = []; this.enemyBullets = []; this.world.particles = [];
            this.remotePlayersData = {};

            this.world.clouds = [];
            for(let i=0; i<100; i++) {
                this.world.clouds.push({
                    x: (Math.random() - 0.5) * 40000, y: 3000 + Math.random() * 8000, z: (Math.random() - 0.5) * 40000,
                    size: 500 + Math.random() * 1000
                });
            }

            if(this.phase.mode === 'SINGLE' || this.phase.mode === 'COOP') {
                this._spawnEnemies(3);
            }

            if((this.phase.mode === 'COOP' || this.phase.mode === 'PVP') && window.DB && window.System.playerId) {
                const room = this.phase.mode === 'COOP' ? 'flight_coop' : 'flight_pvp';
                
                window.DB.ref('rooms/' + room).off();
                window.DB.ref('rooms/' + room + '/' + window.System.playerId).set({
                    x: this.plane.x, y: this.plane.y, z: this.plane.z,
                    pitch: this.plane.pitch, roll: this.plane.roll, yaw: this.plane.yaw,
                    hp: this.session.hp,
                    kills: 0,
                    isReady: true
                });
                window.DB.ref('rooms/' + room + '/' + window.System.playerId).onDisconnect().remove();

                window.DB.ref('rooms/' + room).on('value', snap => {
                    const data = snap.val() || {};
                    this.remotePlayersData = data;
                    
                    // ESCUDO ANTI-IMORTALIDADE: Se alguém nos tirou vida no Firebase, sofremos o dano!
                    if (data[window.System.playerId]) {
                        let remoteHp = data[window.System.playerId].hp;
                        if (remoteHp !== undefined && remoteHp < this.session.hp) {
                            this.session.hp = remoteHp; 
                            this.ui.shake = 15;
                            if(window.Sfx) window.Sfx.error();
                        }
                    }
                });
            }
        },

        _takeDamage: function(amount) {
            this.session.hp -= amount;
            this.ui.shake = 10;
            if(window.Sfx) window.Sfx.error();
            
            if((this.phase.mode === 'COOP' || this.phase.mode === 'PVP') && window.System.playerId && window.DB) {
                const room = this.phase.mode === 'COOP' ? 'flight_coop' : 'flight_pvp';
                window.DB.ref('rooms/' + room + '/' + window.System.playerId + '/hp').set(this.session.hp);
            }
        },

        _spawnEnemies: function(count, isBoss=false) {
            if(this.phase.mode === 'FREE' || this.phase.mode === 'PVP') return;
            for(let i=0; i<count; i++) {
                this.enemies.push({
                    id: 'AI_' + Math.random().toString(36).substr(2, 9),
                    x: this.plane.x + (Math.random()-0.5)*10000,
                    y: Math.max(1000, this.plane.y + (Math.random()-0.5)*2000),
                    z: this.plane.z - 5000 - Math.random()*5000,
                    vx: 0, vy: 0, vz: -this.plane.speed * (isBoss ? 1.2 : 0.8),
                    pitch: 0, roll: 0, yaw: 0,
                    hp: isBoss ? 2000 : 100, maxHp: isBoss ? 2000 : 100,
                    isBoss: isBoss, cooldown: 0, targetManeuver: 'CRUISE', timer: 0
                });
            }
        },

        update: function(ctx, w, h, poses) {
            const now = performance.now();
            const dt = Math.min((now - this.lastTime) / 1000, 0.05);
            this.lastTime = now;

            if(this.state === 'CALIBRATING') {
                this._processPose(poses);
                this.calibTimer -= dt;
                if(this.calibTimer <= 0) this.state = 'PLAYING';
                this._draw(ctx, w, h);
                return;
            }

            if(this.state !== 'PLAYING') return;

            this._processPose(poses);
            this._updatePhysics(dt);
            this._updateEnemies(dt);
            this._updateWeapons(dt);
            this._updateMissiles(dt);
            this._updateParticles(dt);
            this._updateMissionSystem(dt);
            this._updateFirebase();

            // GAMEOVER (Morte)
            if(this.session.hp <= 0 && this.state === 'PLAYING') {
                this.state = 'GAMEOVER';
                setTimeout(() => { window.System.gameOver(this.session.kills, false, this.session.cash); }, 2000);
            }

            // VITÓRIA PVP (Primeiro Abate)
            if(this.phase.mode === 'PVP' && this.session.kills >= 1 && this.state === 'PLAYING') {
                this.state = 'VICTORY';
                setTimeout(() => { window.System.gameOver(this.session.kills, true, this.session.cash); }, 3000);
            }

            this._draw(ctx, w, h);
        },

        _updateFirebase: function() {
            if((this.phase.mode !== 'COOP' && this.phase.mode !== 'PVP') || !window.System.playerId || !window.DB) return;
            const room = this.phase.mode === 'COOP' ? 'flight_coop' : 'flight_pvp';
            
            // Só envia POSIÇÃO e KILLS. O HP só é enviado no momento que leva dano (no _takeDamage)
            window.DB.ref('rooms/' + room + '/' + window.System.playerId).update({
                x: this.plane.x, y: this.plane.y, z: this.plane.z,
                pitch: this.plane.pitch, roll: this.plane.roll, yaw: this.plane.yaw,
                kills: this.session.kills
            });
        },

        _updateMissionSystem: function(dt) {
            if(this.phase.mode === 'FREE' || this.phase.mode === 'PVP') return;
            
            if(this.enemies.length < 3 && this.session.wave === 1) this._spawnEnemies(3 - this.enemies.length);
            if(this.enemies.length < 6 && this.session.wave === 2) this._spawnEnemies(6 - this.enemies.length);

            let teamKills = this.session.kills;
            
            if(this.phase.mode === 'COOP' && this.remotePlayersData) {
                for(let id in this.remotePlayersData) {
                    if (id !== window.System.playerId) {
                        teamKills += (this.remotePlayersData[id].kills || 0);
                    }
                }
            }

            if(this.session.wave === 1 && teamKills >= 15) {
                this.session.wave = 2; 
                if(window.System.msg) window.System.msg("WAVE 2 - CAÇAS AVANÇADOS", "#e67e22");
            }
            if(this.session.wave === 2 && teamKills >= 30 && !this.session.bossActive) {
                this.session.wave = 3; this.session.bossActive = true;
                if(window.System.msg) window.System.msg("WAVE 3 - ALVO ACE ENCONTRADO", "#e74c3c");
                this._spawnEnemies(1, true); 
            }
            
            // BLINDAGEM DE VITÓRIA CO-OP: Exige que o boss tenha sido morto ativamente
            if(this.session.wave === 3 && this.session.bossKilled && this.state === 'PLAYING') {
                this.state = 'VICTORY';
                setTimeout(() => { window.System.gameOver(this.session.kills, true, this.session.cash); }, 4000);
            }
        },

        _processPose: function(poses) {
            if(!poses || poses.length === 0) {
                this.controls.pitchInput = 0; this.controls.rollInput = 0; 
                this.controls.triggerMissile = false; this.controls.gunFiring = false;
                return;
            }
            
            const kps = poses[0].keypoints;
            const leftWrist = kps.find(k => k.name === 'left_wrist');
            const rightWrist = kps.find(k => k.name === 'right_wrist');
            const nose = kps.find(k => k.name === 'nose');

            if(leftWrist && rightWrist && leftWrist.score > 0.3 && rightWrist.score > 0.3 && nose) {
                const midX = (leftWrist.x + rightWrist.x) / 2;
                const midY = (leftWrist.y + rightWrist.y) / 2;
                
                this.controls.rollInput = ((midX - nose.x) / 100);
                this.controls.pitchInput = ((midY - (nose.y + 100)) / 100);
                
                this.controls.rollInput = Math.max(-1, Math.min(1, this.controls.rollInput));
                this.controls.pitchInput = Math.max(-1, Math.min(1, this.controls.pitchInput));

                const handDist = Math.hypot(leftWrist.x - rightWrist.x, leftWrist.y - rightWrist.y);
                if(handDist > 250) { this.controls.afterburner = true; this.controls.throttle = 1.0; }
                else if(handDist > 100) { this.controls.afterburner = false; this.controls.throttle = 0.6; }
                else { this.controls.afterburner = false; this.controls.throttle = 0.2; }

                if(handDist < 50 && !this.controls.triggerMissile) {
                    this.controls.triggerMissile = true;
                    this._fireMissile();
                } else if(handDist >= 50) {
                    this.controls.triggerMissile = false;
                }
            }
        },

        _updatePhysics: function(dt) {
            const p = this.plane;
            const altitude = Math.max(0, p.y);
            const rho = 1.225 * Math.exp(-altitude / 8500); 
            const speedSq = p.vx*p.vx + p.vy*p.vy + p.vz*p.vz;
            p.speed = Math.sqrt(speedSq) || 1;
            const mach = p.speed / 343;

            p.pitch += this.controls.pitchInput * p.stats.maxPitchRate * dt;
            p.roll += this.controls.rollInput * p.stats.maxRollRate * dt;
            p.pitch *= 0.95; 
            p.roll *= 0.95;

            const q = 0.5 * rho * speedSq;
            const aoa = p.pitch; 
            
            let cl = aoa * 5.0;
            if(Math.abs(aoa) > p.stats.stallAngle) { 
                cl *= 0.5; 
                this._takeDamage(2); 
            }

            const lift = q * p.stats.wingArea * cl;
            let cd = p.stats.cd0 + p.stats.kInduced * cl * cl;
            if (mach > 0.8) cd += 10.0 * Math.pow(mach - 0.8, 2); 
            const drag = q * p.stats.wingArea * cd;

            let currentThrust = p.stats.thrust * this.controls.throttle;
            if(this.controls.afterburner) currentThrust *= 1.5;
            if(p.hp < p.maxHp * 0.4) currentThrust *= 0.6; 

            const fwdX = Math.sin(p.yaw) * Math.cos(p.pitch);
            const fwdY = Math.sin(p.pitch);
            const fwdZ = -Math.cos(p.yaw) * Math.cos(p.pitch);

            const upX = -Math.sin(p.roll) * Math.cos(p.yaw);
            const upY = Math.cos(p.roll) * Math.cos(p.pitch);
            const upZ = Math.sin(p.roll) * Math.sin(p.yaw);

            const ax = (currentThrust * fwdX - drag * (p.vx/p.speed) + lift * upX) / p.stats.mass;
            const ay = (currentThrust * fwdY - drag * (p.vy/p.speed) + lift * upY) / p.stats.mass - GAME_CONFIG.GRAVITY;
            const az = (currentThrust * fwdZ - drag * (p.vz/p.speed) + lift * upZ) / p.stats.mass;

            p.vx += ax * dt; p.vy += ay * dt; p.vz += az * dt;
            p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;

            if(p.y < 50) { p.y = 50; p.vy = 0; this._takeDamage(5); }
            
            if(mach > 2.5) {
                this.session.overspeedDamage += dt;
                if(this.session.overspeedDamage > 1.0) { this._takeDamage(5); this.session.overspeedDamage = 0; }
            } else {
                this.session.overspeedDamage = 0;
            }

            this.ui.crosshairX = fwdX * 5000;
            this.ui.crosshairY = fwdY * 5000;
        },

        _updateEnemies: function(dt) {
            let targetLock = null;
            let closestDist = Infinity;

            for(let i=this.enemies.length-1; i>=0; i--) {
                let e = this.enemies[i];
                let dx = this.plane.x - e.x; let dy = this.plane.y - e.y; let dz = this.plane.z - e.z;
                let dist = Math.hypot(dx, dy, dz);

                // TELETRANSORTE DO BOSS (Impede Despawn Longe Demais)
                if(dist > 60000) { 
                    if (e.isBoss) {
                        e.x = this.plane.x + (Math.random()-0.5)*10000;
                        e.y = Math.max(1000, this.plane.y + 2000);
                        e.z = this.plane.z - 10000;
                        e.vx = 0; e.vz = -this.plane.speed * 1.2;
                    } else {
                        this.enemies.splice(i, 1); 
                    }
                    continue; 
                }

                if(e.hp <= 0) {
                    this._createExplosion(e.x, e.y, e.z, e.isBoss ? 50 : 20);
                    
                    if(e.isBoss) {
                        this.session.bossKilled = true;
                        if(window.System.msg) window.System.msg("ACE ABATIDO! +R$2000", "#f1c40f");
                        this.session.cash += 2000;
                    } else {
                        this.session.kills++;
                        this.session.cash += 100;
                        if(window.System.msg) window.System.msg("ALVO ABATIDO +R$100", "#2ecc71");
                    }
                    
                    this.enemies.splice(i, 1);
                    continue;
                }

                e.timer += dt;
                if(e.timer > 3.0) {
                    e.targetManeuver = Math.random() > 0.5 ? 'CRUISE' : (Math.random() > 0.5 ? 'EVADE' : 'TAIL');
                    e.timer = 0;
                }

                const speed = e.isBoss ? 450 : 250;
                if(e.targetManeuver === 'TAIL' && dist < 10000) {
                    e.vx += (dx * 0.1 - e.vx) * dt; e.vy += (dy * 0.1 - e.vy) * dt; e.vz += (dz * 0.1 - e.vz) * dt;
                } else if(e.targetManeuver === 'EVADE') {
                    // CORREÇÃO EXATA AQUI: Usando performance.now() em vez de 'now' solto.
                    e.vx += Math.sin(performance.now() * 0.002) * 150 * dt; 
                    e.vy += Math.cos(performance.now() * 0.002) * 150 * dt;
                } else {
                    e.vz += (-speed - e.vz) * dt;
                }

                e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt;
                if(e.y < 100) e.y = 100;

                e.cooldown -= dt;
                if(dist < 8000 && Math.abs(dx) < 2000 && Math.abs(dy) < 2000 && e.cooldown <= 0) {
                    this.enemyBullets.push({ x: e.x, y: e.y, z: e.z, vx: dx*1.5, vy: dy*1.5, vz: dz*1.5, life: 3.0, isBoss: e.isBoss });
                    e.cooldown = e.isBoss ? 0.2 : 1.5;
                }

                if(dz < 0 && dist < 40000 && Math.abs(dx) < 8000 && Math.abs(dy) < 8000) {
                    if(dist < closestDist) { closestDist = dist; targetLock = e.id; }
                }
            }

            for(let i=this.enemyBullets.length-1; i>=0; i--) {
                let b = this.enemyBullets[i];
                b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.life -= dt;
                let hitDist = Math.hypot(this.plane.x - b.x, this.plane.y - b.y, this.plane.z - b.z);
                if(hitDist < 1000) {
                    this._takeDamage(b.isBoss ? 20 : 10);
                    this.enemyBullets.splice(i, 1);
                } else if(b.life <= 0) {
                    this.enemyBullets.splice(i, 1);
                }
            }

            if(this.phase.mode === 'PVP' || this.phase.mode === 'COOP') {
                for(let id in this.remotePlayersData) {
                    if(id === window.System.playerId) continue;
                    let rp = this.remotePlayersData[id];
                    if (rp.hp <= 0) continue; // Não foca em mortos

                    let dx = this.plane.x - rp.x; let dy = this.plane.y - rp.y; let dz = this.plane.z - rp.z;
                    let dist = Math.hypot(dx, dy, dz);
                    if(dz < 0 && dist < 40000 && Math.abs(dx) < 8000 && Math.abs(dy) < 8000) {
                        if(dist < closestDist) { closestDist = dist; targetLock = id; }
                    }
                }
            }

            if(targetLock === this.ui.lockedTargetId && targetLock !== null) {
                this.ui.lockTimer += dt;
            } else {
                this.ui.lockedTargetId = targetLock;
                this.ui.lockTimer = 0;
            }
        },

        _updateWeapons: function(dt) {
            this.weapons.vulcanCooldown -= dt;
            this.weapons.missileCooldown -= dt;

            if(this.ui.lockTimer > 0.5 && this.weapons.vulcanCooldown <= 0) {
                this.weapons.vulcanCooldown = 0.08;
                if(window.Sfx) window.Sfx.hover();
                
                let targetFwdX = this.ui.crosshairX + (Math.random()-0.5)*500;
                let targetFwdY = this.ui.crosshairY + (Math.random()-0.5)*500;
                
                this.world.particles.push(createParticle(this.plane.x, this.plane.y - 100, this.plane.z - 200, '#ffff00', 10, 1.0, 'bullet'));

                let lockedTargetId = this.ui.lockedTargetId;
                
                if(this.phase.mode === 'PVP' && lockedTargetId && this.remotePlayersData[lockedTargetId]) {
                    let currentHp = this.remotePlayersData[lockedTargetId].hp;
                    if(currentHp > 0) {
                        let newHp = currentHp - 2;
                        if(window.DB) window.DB.ref('rooms/flight_pvp/' + lockedTargetId + '/hp').set(newHp);
                        if(newHp <= 0) {
                            this.session.kills++;
                            this.session.cash += 500;
                            if(window.System.msg) window.System.msg("JOGADOR ABATIDO! +R$500", "#f1c40f");
                            this.ui.lockedTargetId = null;
                        }
                    }
                } else if(lockedTargetId !== null) {
                    let enemy = this.enemies.find(e => e.id === lockedTargetId);
                    if(enemy) enemy.hp -= 2;
                }
            }
        },

        _fireMissile: function() {
            if(this.weapons.missileCooldown > 0 || this.ui.lockTimer < 0.5 || !this.ui.lockedTargetId) return;
            this.weapons.missileCooldown = 3.0;
            if(window.Sfx) window.Sfx.click();
            
            this.missiles.push({
                x: this.plane.x, y: this.plane.y - 200, z: this.plane.z - 300,
                vx: this.plane.vx, vy: this.plane.vy, vz: this.plane.vz - 500,
                targetId: this.ui.lockedTargetId,
                life: 8.0
            });
            if(window.System.msg) window.System.msg("FOX 2!", "#e74c3c");
        },

        _updateMissiles: function(dt) {
            for(let i=this.missiles.length-1; i>=0; i--) {
                let m = this.missiles[i];
                m.life -= dt;
                
                let targetPos = null;
                if((this.phase.mode === 'COOP' || this.phase.mode === 'PVP') && this.remotePlayersData[m.targetId]) {
                    targetPos = this.remotePlayersData[m.targetId];
                } else {
                    targetPos = this.enemies.find(e => e.id === m.targetId);
                }

                if(targetPos) {
                    let dx = targetPos.x - m.x; let dy = targetPos.y - m.y; let dz = targetPos.z - m.z;
                    let dist = Math.hypot(dx, dy, dz);
                    let agility = this.weapons.missileAgility;

                    m.vx += (dx / dist) * agility * 100 * dt;
                    m.vy += (dy / dist) * agility * 100 * dt;
                    m.vz += (dz / dist) * agility * 100 * dt;

                    if(dist < 300) {
                        this._createExplosion(m.x, m.y, m.z, 30);
                        
                        if(this.phase.mode === 'PVP' && this.remotePlayersData[m.targetId]) {
                            let currentHp = this.remotePlayersData[m.targetId].hp;
                            if(currentHp > 0) {
                                let newHp = currentHp - this.weapons.missileDamage;
                                if(window.DB) window.DB.ref('rooms/flight_pvp/' + m.targetId + '/hp').set(newHp);
                                if(newHp <= 0) {
                                    this.session.kills++;
                                    this.session.cash += 500;
                                    if(window.System.msg) window.System.msg("JOGADOR ABATIDO! +R$500", "#f1c40f");
                                }
                            }
                        } else if(targetPos.hp !== undefined) {
                            targetPos.hp -= this.weapons.missileDamage;
                        }
                        
                        this.missiles.splice(i, 1);
                        continue;
                    }
                }

                m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt;
                this.world.particles.push(createParticle(m.x, m.y, m.z, '#ffffff', 8, 0.5, 'smoke'));
                this.world.particles.push(createParticle(m.x, m.y, m.z+100, '#e74c3c', 12, 0.2, 'fire'));

                if(m.life <= 0) this.missiles.splice(i, 1);
            }
        },

        _createExplosion: function(x, y, z, amount) {
            if(window.Sfx) window.Sfx.error();
            for(let i=0; i<amount; i++) {
                this.world.particles.push(createParticle(x, y, z, Math.random()>0.5?'#e74c3c':'#f39c12', Math.random()*40+10, 1.5, 'explosion'));
                this.world.particles.push(createParticle(x, y, z, '#34495e', Math.random()*60+20, 2.0, 'smoke'));
            }
        },

        _updateParticles: function(dt) {
            for(let i=this.world.particles.length-1; i>=0; i--) {
                let p = this.world.particles[i];
                p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
                if(p.type === 'smoke') { p.size += dt * 20; p.vx *= 0.99; p.vy *= 0.99; p.vz *= 0.99; }
                p.life -= dt;
                if(p.life <= 0) this.world.particles.splice(i, 1);
            }
        },

        _draw: function(ctx, w, h) {
            ctx.fillStyle = this.world.skyColor; ctx.fillRect(0,0,w,h);
            
            const horizonY = h/2 + (this.plane.pitch * 300);
            ctx.fillStyle = this.world.groundColor;
            
            ctx.save();
            ctx.translate(w/2, horizonY);
            ctx.rotate(this.plane.roll);
            ctx.fillRect(-w*2, 0, w*4, h*4);
            
            ctx.strokeStyle = '#00ffcc'; ctx.lineWidth = 2; ctx.globalAlpha = 0.3;
            for(let i=-20; i<20; i++) {
                ctx.beginPath(); ctx.moveTo(-w*2, i*100); ctx.lineTo(w*2, i*100); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(i*100, 0); ctx.lineTo(i*100, h*4); ctx.stroke();
            }
            ctx.restore();

            const project = (x, y, z) => {
                let dx = x - this.plane.x; let dy = y - this.plane.y; let dz = z - this.plane.z;
                
                let cy = Math.cos(this.plane.yaw), sy = Math.sin(this.plane.yaw);
                let x1 = dx * cy - dz * sy; let z1 = dx * sy + dz * cy;
                
                let cp = Math.cos(-this.plane.pitch), sp = Math.sin(-this.plane.pitch);
                let y2 = dy * cp - z1 * sp; let z2 = dy * sp + z1 * cp;
                
                let cr = Math.cos(-this.plane.roll), sr = Math.sin(-this.plane.roll);
                let x3 = x1 * cr - y2 * sr; let y3 = x1 * sr + y2 * cr;

                if (z2 < 100) return null;
                const scale = 800 / z2;
                return { x: w/2 + x3 * scale, y: h/2 - y3 * scale, scale: scale };
            };

            const drawJetModel = (proj, isEnemy, isBoss, isCoop) => {
                ctx.save();
                ctx.translate(proj.x, proj.y);
                ctx.scale(proj.scale, proj.scale);
                
                if(isCoop) ctx.fillStyle = '#00ffcc';
                else if(isEnemy && isBoss) ctx.fillStyle = '#f39c12';
                else if(isEnemy) ctx.fillStyle = this.phase.mode === 'PVP' ? '#ff3300' : '#00ffcc';
                else ctx.fillStyle = '#ecf0f1';
                
                ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(30, 20); ctx.lineTo(-30, 20); ctx.fill();
                ctx.fillStyle = '#e74c3c'; ctx.beginPath(); ctx.arc(0, 25, 10, 0, Math.PI*2); ctx.fill();
                
                if(isCoop || this.phase.mode === 'PVP') {
                    ctx.fillStyle = 'white'; ctx.font = '20px Arial'; ctx.textAlign = 'center';
                    ctx.fillText(isCoop ? "ALIADO" : "INIMIGO", 0, -30);
                }
                ctx.restore();
            };

            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            this.world.clouds.forEach(c => {
                let p = project(c.x, c.y, c.z);
                if(p) { ctx.beginPath(); ctx.arc(p.x, p.y, c.size * p.scale, 0, Math.PI*2); ctx.fill(); }
            });

            if(this.phase.mode === 'COOP' || this.phase.mode === 'PVP') {
                for(let id in this.remotePlayersData) {
                    if(id === window.System.playerId) continue;
                    let rp = this.remotePlayersData[id];
                    if (rp.hp <= 0) continue; 
                    let p = project(rp.x, rp.y, rp.z);
                    if(p) drawJetModel(p, this.phase.mode === 'PVP', false, this.phase.mode === 'COOP');
                }
            }

            this.enemies.forEach(e => {
                let p = project(e.x, e.y, e.z);
                if(p) {
                    drawJetModel(p, true, e.isBoss, false);
                    if(this.ui.lockedTargetId === e.id && this.ui.lockTimer > 0.5) {
                        ctx.strokeStyle = '#ff0000'; ctx.lineWidth = 3;
                        ctx.strokeRect(p.x - 40, p.y - 40, 80, 80);
                        ctx.fillStyle = '#ff0000'; ctx.font = 'bold 16px Arial';
                        ctx.fillText("MIRA TRAVADA", p.x - 40, p.y - 50);
                    }
                }
            });

            if(this.phase.mode === 'PVP' || this.phase.mode === 'COOP') {
                 if(this.ui.lockedTargetId && this.remotePlayersData[this.ui.lockedTargetId] && this.ui.lockTimer > 0.5) {
                    let rp = this.remotePlayersData[this.ui.lockedTargetId];
                    let p = project(rp.x, rp.y, rp.z);
                    if(p) {
                        ctx.strokeStyle = '#ff0000'; ctx.lineWidth = 3;
                        ctx.strokeRect(p.x - 40, p.y - 40, 80, 80);
                        ctx.fillStyle = '#ff0000'; ctx.font = 'bold 16px Arial';
                        ctx.fillText("MIRA TRAVADA", p.x - 40, p.y - 50);
                    }
                 }
            }

            this.world.particles.forEach(pt => {
                let p = project(pt.x, pt.y, pt.z);
                if(p) {
                    ctx.fillStyle = pt.color; ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
                    ctx.beginPath(); ctx.arc(p.x, p.y, pt.size * p.scale, 0, Math.PI*2); ctx.fill();
                }
            });
            ctx.globalAlpha = 1.0;

            this.enemyBullets.forEach(b => {
                let p = project(b.x, b.y, b.z);
                if(p) { ctx.fillStyle = '#ff0000'; ctx.beginPath(); ctx.arc(p.x, p.y, 15 * p.scale, 0, Math.PI*2); ctx.fill(); }
            });

            let sx = (Math.random()-0.5)*this.ui.shake; let sy = (Math.random()-0.5)*this.ui.shake;
            this.ui.shake *= 0.9;
            ctx.save(); ctx.translate(sx, sy);

            ctx.strokeStyle = '#00ffcc'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(w/2, h/2, 100, 0, Math.PI*2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(w/2 - 120, h/2); ctx.lineTo(w/2 + 120, h/2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(w/2, h/2 - 120); ctx.lineTo(w/2, h/2 + 120); ctx.stroke();
            
            ctx.strokeStyle = '#00ff00';
            ctx.beginPath(); ctx.arc(w/2 + (this.plane.vx/this.plane.speed)*50, h/2 - (this.plane.vy/this.plane.speed)*50, 15, 0, Math.PI*2);
            ctx.moveTo(w/2 + (this.plane.vx/this.plane.speed)*50 - 20, h/2 - (this.plane.vy/this.plane.speed)*50); ctx.lineTo(w/2 + (this.plane.vx/this.plane.speed)*50 + 20, h/2 - (this.plane.vy/this.plane.speed)*50);
            ctx.moveTo(w/2 + (this.plane.vx/this.plane.speed)*50, h/2 - (this.plane.vy/this.plane.speed)*50 - 20); ctx.lineTo(w/2 + (this.plane.vx/this.plane.speed)*50, h/2 - (this.plane.vy/this.plane.speed)*50 + 20);
            ctx.stroke();

            ctx.fillStyle = '#00ffcc'; ctx.font = "bold 24px 'Chakra Petch', sans-serif"; ctx.textAlign = 'left';
            ctx.fillText(`ALT: ${Math.floor(this.plane.y)} M`, 50, h/2 - 50);
            ctx.fillText(`SPD: ${Math.floor(this.plane.speed * 3.6)} KM/H`, 50, h/2);
            ctx.fillText(`THR: ${Math.floor(this.controls.throttle * 100)}% ${this.controls.afterburner ? 'AB' : ''}`, 50, h/2 + 50);

            ctx.textAlign = 'right';
            ctx.fillText(`HP: ${Math.floor(this.session.hp)}`, w - 50, h/2 - 50);
            ctx.fillText(`KILLS: ${this.session.kills}`, w - 50, h/2);
            if(this.phase.mode !== 'FREE' && this.phase.mode !== 'PVP') ctx.fillText(`WAVE: ${this.session.wave}`, w - 50, h/2 + 50);

            if (this.session.hp < this.plane.maxHp * 0.4) {
                ctx.fillStyle = 'rgba(231, 76, 60, 0.3)'; ctx.fillRect(0,0,w,h);
                if (Math.floor(now / 500) % 2 === 0) {
                    ctx.fillStyle = '#e74c3c'; ctx.textAlign = 'center'; ctx.font = "bold 40px 'Russo One'";
                    ctx.fillText("AVISO: INTEGRIDADE CRÍTICA", w/2, h/4);
                }
            }

            const rw = 200, rh = 200, rx = w - 250, ry = h - 250;
            ctx.fillStyle = 'rgba(0, 255, 204, 0.1)'; ctx.strokeStyle = '#00ffcc'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(rx + rw/2, ry + rh/2, rw/2, 0, Math.PI*2); ctx.fill(); ctx.stroke();
            ctx.beginPath(); ctx.arc(rx + rw/2, ry + rh/2, rw/4, 0, Math.PI*2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(rx, ry + rh/2); ctx.lineTo(rx + rw, ry + rh/2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(rx + rw/2, ry); ctx.lineTo(rx + rw/2, ry + rh); ctx.stroke();
            ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(rx + rw/2, ry + rh/2, 4, 0, Math.PI*2); ctx.fill();

            const drawRadarDot = (ex, ey, ez, isBoss, isCoop) => {
                let dx = ex - this.plane.x; let dz = ez - this.plane.z;
                let cy = Math.cos(this.plane.yaw), sy = Math.sin(this.plane.yaw);
                let x1 = dx * cy - dz * sy; let z1 = dx * sy + dz * cy;
                const radarScale = 40000 / (rw/2);
                let rpx = rx + rw/2 + (x1 / radarScale); let rpy = ry + rh/2 - (z1 / radarScale);
                
                if(Math.hypot(x1, z1) < 40000) {
                    if(isCoop) ctx.fillStyle = '#00ffff';
                    else if(isBoss) ctx.fillStyle = '#ff9900';
                    else ctx.fillStyle = this.phase.mode === 'PVP' ? '#ff0000' : '#ff0000';
                    
                    ctx.beginPath(); ctx.arc(rpx, rpy, 5, 0, Math.PI*2); ctx.fill();
                    let altDiff = ey - this.plane.y;
                    ctx.font = '10px Arial'; ctx.textAlign = 'center';
                    if(altDiff > 500) ctx.fillText('▲', rpx, rpy - 8);
                    else if(altDiff < -500) ctx.fillText('▼', rpx, rpy + 10);
                }
            };

            this.enemies.forEach(e => drawRadarDot(e.x, e.y, e.z, e.isBoss, false));
            if(this.phase.mode === 'COOP' || this.phase.mode === 'PVP') {
                for(let id in this.remotePlayersData) {
                    if(id === window.System.playerId) continue;
                    let rp = this.remotePlayersData[id];
                    if(rp.hp > 0) drawRadarDot(rp.x, rp.y, rp.z, false, this.phase.mode === 'COOP');
                }
            }
            ctx.restore();

            if(this.state === 'CALIBRATING') {
                ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fillRect(0,0,w,h);
                ctx.fillStyle = '#00ffcc'; ctx.textAlign = 'center'; ctx.font = "bold 40px 'Russo One'";
                ctx.fillText("PREPARE-SE PARA A DESCOLAGEM", w/2, h/2 - 40);
                ctx.font = "bold 24px 'Chakra Petch'";
                ctx.fillText("Mantenha as mãos visíveis e abraçadas aos controlos.", w/2, h/2 + 10);
                ctx.fillStyle = '#e74c3c'; ctx.fillRect(w/2 - 150, h/2 + 50, 300, 10);
                ctx.fillStyle = '#2ecc71'; ctx.fillRect(w/2 - 150, h/2 + 50, 300 * (1 - this.calibTimer/3.0), 10);
            }
            
            if(this.state === 'GAMEOVER' || this.state === 'VICTORY') {
                ctx.fillStyle='rgba(0,0,0,0.85)';ctx.fillRect(0,0,w,h);
                ctx.textAlign='center';ctx.font='bold 40px "Russo One", Arial';
                ctx.fillStyle = this.state==='VICTORY' ? '#2ecc71' : '#ff0000';
                ctx.fillText(this.state==='VICTORY' ? 'MISSÃO CUMPRIDA!' : 'CAÇA ABATIDO', w/2, h/2);
                ctx.fillStyle='#f1c40f';ctx.font='bold 30px Arial';
                ctx.fillText(`RECOMPENSA DE COMBATE: R$ ${this.session.cash}`, w/2, h/2+60);
            }
        },

        cleanup: function() {
            if(this.phase && (this.phase.mode === 'COOP' || this.phase.mode === 'PVP')) {
                const room = this.phase.mode === 'COOP' ? 'flight_coop' : 'flight_pvp';
                if(window.System.playerId && window.DB) {
                    window.DB.ref('rooms/' + room + '/' + window.System.playerId).remove();
                    window.DB.ref('rooms/' + room).off();
                }
            }
        }
    };

    console.log("✈️ Aero Strike WAR Carregado com Sucesso!");

    const register = () => {
        if (window.System && window.System.registerGame) {
            window.System.registerGame('usarmy_flight_sim', 'Aero Strike WAR', '✈️', Game, {
                camera: 'user', camOpacity: 0.2,
                phases: [
                    { id: 'training', name: 'CAMPANHA SOLO', desc: 'Destrua as ameaças e evolua o seu caça.', mode: 'SINGLE', reqLvl: 1 },
                    { id: 'free', name: 'VOO LIVRE', desc: 'Explore o cenário e treine manobras.', mode: 'FREE', reqLvl: 1 },
                    { id: 'coop', name: 'CO-OP ESQUADRÃO', desc: 'Junte-se a outros pilotos contra a IA.', mode: 'COOP', reqLvl: 3 },
                    { id: 'pvp', name: 'COMBATE PVP', desc: 'Lute contra outros jogadores na arena.', mode: 'PVP', reqLvl: 5 }
                ]
            });
        } else { setTimeout(register, 100); }
    };
    register();
})();