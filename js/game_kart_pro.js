// =============================================================================
// OTTO KART PRO: PLATINUM EDITION (ENGINE MODE 177)
// SISTEMA COMERCIAL COMPLETO - 4 PISTAS | 4 PERSONAGENS | DRIFT | PROGRESSÃO
// =============================================================================

(function() {
    // --- CONFIGURAÇÕES DE ENGENHARIA E FÍSICA ---
    const PHY = {
        MAX_SPEED: 280,
        ACCEL: 0.65,
        BRAKE: 0.92,
        FRICTION_ROAD: 0.985,
        FRICTION_GRASS: 0.85,
        GRIP_ROAD: 0.14,
        GRIP_GRASS: 0.03,
        TURN_SPEED: 0.06,
        TRACK_LENGTH: 12000,
        TOTAL_LAPS: 3,
        DRIFT_BOOST: 1.8,   // Multiplicador de torque no boost
        TURBO_DURATION: 45 // Frames de turbo
    };

    // --- BASE DE DADOS: PERSONAGENS (STATS REAIS) ---
    const CHARACTERS = [
        { id: 'otto', name: 'OTTO', color: '#e74c3c', icon: '🔴', speed: 1.0, accel: 1.0, grip: 1.0 },
        { id: 'thiaguinho', name: 'thIAguinho', color: '#3498db', icon: '🔵', speed: 1.2, accel: 0.8, grip: 0.9 },
        { id: 'mii', name: 'MII PLAYER', color: '#f1c40f', icon: '🟡', speed: 0.9, accel: 1.3, grip: 1.1 },
        { id: 'robo', name: 'BOT-177', color: '#2ecc71', icon: '🟢', speed: 1.1, accel: 1.0, grip: 1.2 }
    ];

    // --- BASE DE DADOS: PISTAS (BIOMAS E CURVAS) ---
    const TRACKS = [
        { id: 'circuit', name: 'CIRCUITO OTTO', sky: ['#3498db', '#85c1e9'], grass: '#27ae60', road: '#7f8c8d', difficulty: 'Fácil' },
        { id: 'desert', name: 'DESERTO SECO', sky: ['#f39c12', '#fcebb6'], grass: '#d35400', road: '#e67e22', difficulty: 'Média' },
        { id: 'neon', name: 'CIDADE NEON', sky: ['#1a1a2e', '#16213e'], grass: '#0f3460', road: '#111', difficulty: 'Dificil' },
        { id: 'castle', name: 'CASTELO SOMBRIO', sky: ['#4b0082', '#000000'], grass: '#1a1a1a', road: '#444', difficulty: 'Expert' }
    ];

    // --- SISTEMA DE PISTA (GEOMETRIA) ---
    const TrackSystem = {
        data: [],
        decor: [], // Decorações (árvores, prédios, etc)
        length: PHY.TRACK_LENGTH,
        
        generate: function(trackType) {
            this.data = new Float32Array(this.length);
            this.decor = [];
            let curve = 0;
            let targetCurve = 0;
            
            for(let i = 0; i < this.length; i++) {
                if(i % 500 === 0 && i < this.length - 1000) {
                    const r = Math.random();
                    if(r < 0.2) targetCurve = 0;
                    else if(r < 0.5) targetCurve = (Math.random() - 0.5) * 3;
                    else targetCurve = (Math.sign(Math.random()-0.5)) * (4 + Math.random() * 3);
                }
                curve += (targetCurve - curve) * 0.008;
                this.data[i] = curve;

                // Adiciona decoração lateral aleatória
                if(i % 150 === 0 && Math.random() > 0.4) {
                    this.decor.push({ z: i, side: Math.random() > 0.5 ? 1 : -1, type: Math.floor(Math.random() * 3) });
                }
            }
            // Smoothing final do loop
            for(let i = 0; i < 800; i++) {
                const t = i / 800;
                const idx = this.length - 1 - i;
                this.data[idx] = this.data[idx] * t + this.data[0] * (1-t);
            }
        },

        getCurve: function(z) {
            let idx = Math.floor(z) % this.length;
            if(idx < 0) idx += this.length;
            return this.data[idx];
        }
    };

    // --- CLASSE VEÍCULO ---
    class Kart {
        constructor(isPlayer = false, config, startZ = 0) {
            this.isPlayer = isPlayer;
            this.config = config; // Stats do personagem
            this.x = 0;
            this.z = startZ;
            this.speed = 0;
            this.heading = 0;
            this.velX = 0;
            this.lap = 1;
            this.rank = 0;
            this.finished = false;
            this.turboTimer = 0;
            this.driftAmount = 0; // Acúmulo de drift
        }

        update(dt, inputSteer, inputAccel) {
            if(this.finished) { this.speed *= 0.96; return; }

            const isOffRoad = Math.abs(this.x) > 1.2;
            const grip = (isOffRoad ? PHY.GRIP_GRASS : PHY.GRIP_ROAD) * this.config.grip;
            const friction = isOffRoad ? PHY.FRICTION_GRASS : PHY.FRICTION_ROAD;

            // Motor e Turbo
            if(inputAccel) {
                let torque = PHY.ACCEL * this.config.accel;
                if(this.turboTimer > 0) {
                    torque *= PHY.DRIFT_BOOST;
                    this.turboTimer--;
                }
                this.speed += torque;
            } else {
                this.speed *= PHY.BRAKE;
            }

            let maxS = PHY.MAX_SPEED * this.config.speed;
            if(isOffRoad) maxS *= 0.4;
            this.speed = Math.min(this.speed, maxS);
            this.speed *= friction;

            // Direção e Drift
            if(this.speed > 5) {
                this.heading += inputSteer * PHY.TURN_SPEED * (this.speed / PHY.MAX_SPEED);
                this.heading *= 0.9;

                // Lógica de Mini-Turbo por Drift
                if(Math.abs(inputSteer) > 0.8 && !isOffRoad) {
                    this.driftAmount += 1;
                    if(this.driftAmount > 60 && this.isPlayer) {
                        // Feedback visual de faísca poderia ser adicionado aqui
                    }
                } else {
                    if(this.driftAmount > 50) {
                        this.turboTimer = PHY.TURBO_DURATION;
                        if(this.isPlayer) {
                            window.Sfx.play(1200, 'triangle', 0.2, 0.2);
                            window.System.msg("MINI-TURBO!");
                        }
                    }
                    this.driftAmount = 0;
                }
            }

            // Física Lateral
            this.velX += this.heading * grip * (this.speed * 0.06);
            const currentCurve = TrackSystem.getCurve(this.z);
            const centrifugal = currentCurve * (this.speed / PHY.MAX_SPEED) * 1.2;
            this.velX -= centrifugal * 0.18;
            this.velX *= (isOffRoad ? 0.98 : 0.88);

            this.x += this.velX;
            this.z += this.speed;

            if(this.z >= PHY.TRACK_LENGTH) {
                this.z -= PHY.TRACK_LENGTH;
                this.lap++;
                if(this.isPlayer) {
                    if(this.lap <= PHY.TOTAL_LAPS) window.System.msg(`VOLTA ${this.lap}/${PHY.TOTAL_LAPS}`);
                    window.Sfx.play(880, 'square', 0.3, 0.1);
                }
                if(this.lap > PHY.TOTAL_LAPS) this.finished = true;
            }
        }

        updateAI(playerZ) {
            const lookAhead = 400;
            const curve = TrackSystem.getCurve(this.z + lookAhead);
            let targetX = (Math.abs(curve) > 1.5) ? Math.sign(curve) * 0.7 : 0;
            const steer = (targetX - this.x) * 0.1 + (curve * 0.4);
            this.update(0, Math.max(-1, Math.min(1, steer)), true);
        }
    }

    // --- LÓGICA DO JOGO (SINGLETON) ---
    const Logic = {
        state: 'MENU', // MENU, CHAR_SELECT, TRACK_SELECT, RACE, RESULTS
        selectedChar: 0,
        selectedTrack: 0,
        player: null,
        opponents: [],
        particles: [],
        virtualSteer: 0,
        handInput: { active: false },
        frame: 0,

        init: function() {
            this.state = 'CHAR_SELECT';
            this.frame = 0;
            window.System.msg("ESCOLHA SEU PILOTO");
        },

        update: function(ctx, w, h, pose) {
            this.frame++;
            
            switch(this.state) {
                case 'CHAR_SELECT': this.renderCharSelect(ctx, w, h, pose); break;
                case 'TRACK_SELECT': this.renderTrackSelect(ctx, w, h, pose); break;
                case 'RACE': this.runRace(ctx, w, h, pose); break;
                case 'RESULTS': this.renderResults(ctx, w, h); break;
            }
            return this.player ? Math.floor(this.player.speed) : 0;
        },

        // --- TELAS DE SELEÇÃO ---
        renderCharSelect: function(ctx, w, h, pose) {
            this.drawBackgroundUI(ctx, w, h, "SELEÇÃO DE PILOTO");
            CHARACTERS.forEach((c, i) => {
                const x = w * (0.2 + i * 0.2);
                const y = h * 0.5;
                const isSelected = this.selectedChar === i;
                
                // Card
                ctx.fillStyle = isSelected ? c.color : '#333';
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = isSelected ? 6 : 2;
                ctx.beginPath();
                ctx.roundRect(x - w*0.08, y - h*0.2, w*0.16, h*0.4, 20);
                ctx.fill(); ctx.stroke();

                // Icon & Info
                ctx.fillStyle = '#fff';
                ctx.font = "bold 60px Arial"; ctx.textAlign = "center";
                ctx.fillText(c.icon, x, y - 20);
                ctx.font = "bold 20px 'Chakra Petch'";
                ctx.fillText(c.name, x, y + 40);
                
                // Stats bars
                this.drawStatBar(ctx, x - 40, y + 70, "VEL", c.speed);
                this.drawStatBar(ctx, x - 40, y + 90, "ACC", c.accel);
            });

            this.handleSelectionInput(pose, w, h, CHARACTERS.length, (idx) => {
                this.selectedChar = idx;
                window.Sfx.play(600, 'sine', 0.1, 0.1);
            }, () => {
                this.state = 'TRACK_SELECT';
                window.System.msg("ESCOLHA A PISTA");
                window.Sfx.play(1000, 'square', 0.2, 0.1);
            });
        },

        renderTrackSelect: function(ctx, w, h, pose) {
            this.drawBackgroundUI(ctx, w, h, "SELEÇÃO DE PISTA");
            TRACKS.forEach((t, i) => {
                const x = w * (0.2 + i * 0.2);
                const y = h * 0.5;
                const isSelected = this.selectedTrack === i;
                
                ctx.fillStyle = isSelected ? t.road : '#222';
                ctx.strokeStyle = isSelected ? '#fff' : '#444';
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.roundRect(x - w*0.08, y - h*0.2, w*0.16, h*0.4, 20);
                ctx.fill(); ctx.stroke();

                ctx.fillStyle = '#fff';
                ctx.font = "bold 22px 'Chakra Petch'"; ctx.textAlign = "center";
                ctx.fillText(t.name, x, y);
                ctx.font = "14px Arial";
                ctx.fillStyle = isSelected ? '#ffff00' : '#888';
                ctx.fillText(t.difficulty, x, y + 30);
            });

            this.handleSelectionInput(pose, w, h, TRACKS.length, (idx) => {
                this.selectedTrack = idx;
            }, () => {
                this.startRace();
            });
        },

        // --- MECÂNICA DE SELEÇÃO POR POSE ---
        handleSelectionInput: function(pose, w, h, count, onMove, onSelect) {
            if(!pose) return;
            const nose = pose.keypoints.find(k => k.name === 'nose');
            if(nose && nose.score > 0.5) {
                const sectionWidth = w / count;
                const currentIdx = Math.floor(nose.x / sectionWidth);
                const invertedIdx = (count - 1) - currentIdx; // Espelhado
                
                if(invertedIdx !== this.lastSelected) {
                    onMove(invertedIdx);
                    this.lastSelected = invertedIdx;
                }

                // Seleciona se as mãos estiverem acima do nariz (Gesto Wii)
                const lw = pose.keypoints.find(k => k.name === 'left_wrist');
                const rw = pose.keypoints.find(k => k.name === 'right_wrist');
                if(lw && rw && lw.y < nose.y && rw.y < nose.y) {
                    if(!this.selectLock) {
                        onSelect();
                        this.selectLock = true;
                        setTimeout(() => this.selectLock = false, 1000);
                    }
                }
            }
        },

        // --- CORRIDA ---
        startRace: function() {
            TrackSystem.generate(TRACKS[this.selectedTrack]);
            const char = CHARACTERS[this.selectedChar];
            this.player = new Kart(true, char, 0);
            
            this.opponents = [];
            for(let i=0; i<3; i++) {
                const botChar = CHARACTERS[(this.selectedChar + 1 + i) % CHARACTERS.length];
                this.opponents.push(new Kart(false, botChar, 200 + i*150));
            }
            this.state = 'RACE';
            window.System.msg("3... 2... 1... GO!");
        },

        runRace: function(ctx, w, h, pose) {
            // Processa Input
            this.processDrivingInput(pose, w, h);
            
            // Física
            this.player.update(1, this.virtualSteer, true);
            this.opponents.forEach(o => o.updateAI(this.player.z));

            // Ranking
            const all = [this.player, ...this.opponents].sort((a,b) => {
                const sa = (a.lap-1)*PHY.TRACK_LENGTH + a.z;
                const sb = (b.lap-1)*PHY.TRACK_LENGTH + b.z;
                return sb - sa;
            });
            this.player.rank = all.indexOf(this.player) + 1;

            if(this.player.finished) {
                this.state = 'RESULTS';
                setTimeout(() => window.System.gameOver((5 - this.player.rank) * 1000), 4000);
            }

            this.render3D(ctx, w, h);
            this.renderHUD(ctx, w, h);
        },

        processDrivingInput: function(pose, w, h) {
            if(pose) {
                const lw = pose.keypoints.find(k => k.name === 'left_wrist');
                const rw = pose.keypoints.find(k => k.name === 'right_wrist');
                if(lw && rw && lw.score > 0.4 && rw.score > 0.4) {
                    const lPos = window.Gfx.map(lw, w, h);
                    const rPos = window.Gfx.map(rw, w, h);
                    const angle = Math.atan2(rPos.y - lPos.y, rPos.x - lPos.x);
                    const target = Math.max(-1.5, Math.min(1.5, angle * 2.5));
                    this.virtualSteer += (target - this.virtualSteer) * 0.25;
                    return;
                }
            }
            this.virtualSteer *= 0.8;
        },

        // --- RENDERIZAÇÃO 3D ENGINE ---
        render3D: function(ctx, w, h) {
            const track = TRACKS[this.selectedTrack];
            const horizon = h * 0.45;
            const P = this.player;

            // Sky
            const grad = ctx.createLinearGradient(0, 0, 0, horizon);
            grad.addColorStop(0, track.sky[0]); grad.addColorStop(1, track.sky[1]);
            ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);

            // Ground
            ctx.fillStyle = track.grass;
            ctx.fillRect(0, horizon, w, h - horizon);

            // Renderização da Pista (Scanning)
            const drawDist = 350;
            let xAccum = 0;
            let screenData = [];

            for(let i=0; i<drawDist; i+=2) {
                const z = Math.floor(P.z + i);
                const curve = TrackSystem.getCurve(z);
                xAccum += curve;

                const scale = 1 / (i * 0.012 + 1);
                const screenX = (w/2) + (-P.x + xAccum * 0.5) * w * 0.8 * scale;
                const screenY = h - ((h - horizon) * scale * 0.85);
                const screenW = w * 2.0 * scale;
                screenData[i] = { x: screenX, y: screenY, w: screenW, scale: scale };
            }

            // Draw Road Layers
            for(let i=drawDist-2; i>=0; i-=2) {
                const curr = screenData[i];
                const next = screenData[i+2];
                if(!curr || !next || curr.y >= next.y) continue;

                const isDark = Math.floor((P.z + i) / 25) % 2 === 0;
                
                // Curb
                ctx.fillStyle = isDark ? '#fff' : '#e74c3c';
                ctx.beginPath();
                ctx.moveTo(curr.x - curr.w*1.1, curr.y); ctx.lineTo(curr.x + curr.w*1.1, curr.y);
                ctx.lineTo(next.x + next.w*1.1, next.y); ctx.lineTo(next.x - next.w*1.1, next.y);
                ctx.fill();

                // Road
                ctx.fillStyle = isDark ? track.road : '#555';
                ctx.beginPath();
                ctx.moveTo(curr.x - curr.w, curr.y); ctx.lineTo(curr.x + curr.w, curr.y);
                ctx.lineTo(next.x + next.w, next.y); ctx.lineTo(next.x - next.w, next.y);
                ctx.fill();

                // Lane line
                if(isDark) {
                    ctx.fillStyle = '#fff';
                    ctx.fillRect(curr.x - 2, curr.y, 4, next.y - curr.y + 1);
                }
            }

            // Sprites (Decor & Opponents)
            const sprites = [];
            this.opponents.forEach(o => {
                let rz = o.z - P.z;
                if(rz < -drawDist) rz += PHY.TRACK_LENGTH;
                if(rz > 0 && rz < drawDist) sprites.push({ type: 'kart', obj: o, z: rz });
            });
            TrackSystem.decor.forEach(d => {
                let rz = d.z - P.z;
                if(rz < 0) rz += PHY.TRACK_LENGTH;
                if(rz < drawDist) sprites.push({ type: 'decor', obj: d, z: rz });
            });

            sprites.sort((a,b) => b.z - a.z).forEach(s => {
                const seg = screenData[Math.floor(s.z)];
                if(!seg) return;
                
                if(s.type === 'kart') {
                    const sx = seg.x + (s.obj.x * seg.w * 0.7);
                    this.drawKartSprite(ctx, sx, seg.y, seg.scale * w * 0.003, s.obj);
                } else {
                    const sx = seg.x + (s.obj.side * seg.w * 1.8);
                    this.drawDecorSprite(ctx, sx, seg.y, seg.scale * w * 0.004, s.obj.type);
                }
            });

            // Player Kart
            const pTilt = this.virtualSteer * 0.4 + (P.velX * 4);
            this.drawKartSprite(ctx, w/2, h*0.88, w * 0.0065, P, pTilt);
        },

        drawKartSprite: function(ctx, x, y, scale, kart, tilt=0) {
            ctx.save();
            ctx.translate(x, y); ctx.scale(scale, scale); ctx.rotate(tilt);
            
            // Sombra
            ctx.fillStyle = "rgba(0,0,0,0.3)";
            ctx.beginPath(); ctx.ellipse(0, 10, 45, 12, 0, 0, Math.PI*2); ctx.fill();

            // Chassi
            ctx.fillStyle = kart.config.color;
            ctx.beginPath();
            ctx.moveTo(-30, 0); ctx.lineTo(30, 0); ctx.lineTo(20, -25); ctx.lineTo(-20, -25);
            ctx.fill();
            
            // Detalhes Turbo
            if(kart.turboTimer > 0) {
                ctx.fillStyle = "#f39c12";
                ctx.fillRect(-15, 0, 30, 15 * (Math.random()+0.5));
            }

            // Piloto
            ctx.fillStyle = "#fff";
            ctx.beginPath(); ctx.arc(0, -35, 15, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = "#111"; ctx.fillRect(-15, -40, 30, 8); // Viseira

            ctx.restore();
        },

        drawDecorSprite: function(ctx, x, y, scale, type) {
            ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
            const colors = ['#2ecc71', '#e67e22', '#34495e'];
            ctx.fillStyle = colors[type];
            ctx.beginPath();
            ctx.moveTo(0, 0); ctx.lineTo(-20, -60); ctx.lineTo(20, -60); ctx.fill();
            ctx.restore();
        },

        // --- HUD ---
        renderHUD: function(ctx, w, h) {
            const P = this.player;
            
            // Velocímetro
            ctx.fillStyle = "rgba(0,0,0,0.7)";
            ctx.fillRect(w - 180, h - 80, 160, 60);
            ctx.fillStyle = P.turboTimer > 0 ? '#f1c40f' : '#fff';
            ctx.font = "bold 40px 'Russo One'"; ctx.textAlign = "right";
            ctx.fillText(Math.floor(P.speed), w - 30, h - 35);
            
            // Rank e Volta
            ctx.textAlign = "left";
            ctx.font = "bold 60px 'Russo One'";
            ctx.strokeStyle = '#000'; ctx.lineWidth = 4;
            ctx.strokeText(`${P.rank}º`, 30, h - 40);
            ctx.fillText(`${P.rank}º`, 30, h - 40);
            
            ctx.font = "bold 20px 'Chakra Petch'";
            ctx.fillText(`VOLTA ${Math.min(P.lap, PHY.TOTAL_LAPS)}/${PHY.TOTAL_LAPS}`, 30, h - 110);
        },

        drawStatBar: function(ctx, x, y, label, val) {
            ctx.fillStyle = '#fff'; ctx.font = "10px Arial";
            ctx.fillText(label, x - 20, y + 8);
            ctx.fillStyle = '#444'; ctx.fillRect(x, y, 50, 6);
            ctx.fillStyle = '#2ecc71'; ctx.fillRect(x, y, 50 * (val/1.3), 6);
        },

        drawBackgroundUI: function(ctx, w, h, title) {
            const grad = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, w);
            grad.addColorStop(0, '#444'); grad.addColorStop(1, '#111');
            ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);
            ctx.fillStyle = '#fff'; ctx.font = "bold 40px 'Russo One'"; ctx.textAlign = "center";
            ctx.fillText(title, w/2, 80);
            ctx.font = "16px Arial"; ctx.fillStyle = "#888";
            ctx.fillText("MOVA O NARIZ PARA ESCOLHER • LEVANTE AS MÃOS PARA CONFIRMAR", w/2, 120);
        }
    };

    // --- REGISTRO DO KERNEL ---
    const regLoop = setInterval(() => {
        if(window.System && window.System.registerGame) {
            window.System.registerGame('kart', { 
                name: 'Otto Kart Pro', 
                icon: '🏎️', 
                camOpacity: 0.1, 
                showWheel: false 
            }, Logic);
            clearInterval(regLoop);
        }
    }, 100);
})();
