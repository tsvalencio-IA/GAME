// =============================================================================
// KART LEGENDS: PLATINUM REMASTER (VISUAL V3 + STABILITY V6)
// CORREÇÕES: PISTA VISÍVEL, PERSPECTIVA LONGA, VOLANTE GT, SEM CRASH NO TURBO
// =============================================================================

(function() {

    // -----------------------------------------------------------------
    // 1. CONFIGURAÇÕES VISUAIS & FÍSICA
    // -----------------------------------------------------------------
    const CONF = {
        MAX_SPEED: 260,
        TURBO_MAX_SPEED: 420,
        ACCEL: 0.12,
        BREAKING: 0.3,
        DECEL: 0.04,
        OFFROAD_DECEL: 0.92,
        
        // --- VISUAL (Perspectiva Panorâmica) ---
        SEGMENT_LENGTH: 200,
        RUMBLE_LENGTH: 3,
        ROAD_WIDTH: 2200,
        DRAW_DISTANCE: 300,  // Aumentado para ver longe
        FOV: 100,
        CAMERA_HEIGHT: 1200, // Câmera mais alta para ver a curva longe
        CAMERA_DEPTH: 0.8,   // Zoom ajustado para profundidade
        
        // --- PERFORMANCE ---
        MAX_PARTICLES: 40    // Limite rígido para evitar crash
    };

    const CHARACTERS = [
        { id: 0, name: 'MARIO',  color: '#e74c3c', hat: '#d32f2f', skin: '#ffccaa', stats: { speed: 1.0, grip: 1.0 } },
        { id: 1, name: 'LUIGI',  color: '#2ecc71', hat: '#27ae60', skin: '#ffccaa', stats: { speed: 1.02, grip: 0.95 } },
        { id: 2, name: 'PEACH',  color: '#ff9ff3', hat: '#fd79a8', skin: '#ffccaa', stats: { speed: 0.96, grip: 1.1 } },
        { id: 3, name: 'BOWSER', color: '#f1c40f', hat: '#e67e22', skin: '#e67e22', stats: { speed: 1.15, grip: 0.7 } },
        { id: 4, name: 'TOAD',   color: '#3498db', hat: '#ecf0f1', skin: '#ffccaa', stats: { speed: 0.9, grip: 1.2 } },
        { id: 5, name: 'YOSHI',  color: '#76ff03', hat: '#64dd17', skin: '#ffccaa', stats: { speed: 1.05, grip: 1.05 } },
        { id: 6, name: 'DK',     color: '#795548', hat: '#5d4037', skin: '#ffccaa', stats: { speed: 1.12, grip: 0.8 } },
        { id: 7, name: 'WARIO',  color: '#ffeb3b', hat: '#fbc02d', skin: '#ffccaa', stats: { speed: 1.08, grip: 0.85 } }
    ];

    const TRACKS = [
        { name: 'GRAND PRIX',    sky: ['#0099ff', '#88ccff'], ground: ['#55aa44', '#448833'], road: ['#666', '#555'], mapColor: '#4d4' },
        { name: 'SUNSET CANYON', sky: ['#e67e22', '#f1c40f'], ground: ['#d35400', '#e67e22'], road: ['#a0522d', '#8b4513'], mapColor: '#d60' },
        { name: 'NEON CITY',     sky: ['#000033', '#000066'], ground: ['#111', '#222'],       road: ['#333', '#222'], mapColor: '#00f' }
    ];

    // -----------------------------------------------------------------
    // 2. ENGINE LÓGICA
    // -----------------------------------------------------------------
    const Game = {
        state: 'INIT',
        
        // Multiplayer
        roomId: 'kart_platinum_v1',
        isOnline: false,
        isHost: false,
        dbRef: null,
        remotePlayers: {},
        lastSync: 0,
        playerId: window.System ? window.System.playerId : 'P'+Math.floor(Math.random()*1000),

        // Estado do Jogo
        selChar: 0,
        selTrack: 0,
        isReady: false,

        // Física
        pos: 0,
        playerX: 0,
        speed: 0,
        steer: 0,
        nitro: 100,
        isTurbo: false,
        lap: 1,
        totalLaps: 3,

        // Render & Efeitos
        segments: [],
        trackLength: 0,
        particles: [],
        hudMsgs: [],
        minimap: { path: [], minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
        shake: 0,
        
        // Input Virtual (Volante)
        wheel: { x:0, y:0, angle:0, active:false },
        
        // Bots
        bots: [],

        init: function() {
            this.state = 'MENU';
            if(window.System) window.System.msg("KART LEGENDS");
            this.createNitroBtn();
            this.reset();
        },

        createNitroBtn: function() {
            const old = document.getElementById('nitro-btn'); if(old) old.remove();
            const btn = document.createElement('div');
            btn.id = 'nitro-btn';
            Object.assign(btn.style, {
                position: 'fixed', bottom: '150px', right: '30px', width: '90px', height: '90px',
                borderRadius: '50%', background: 'radial-gradient(circle, #ffeb3b 0%, #ff9800 100%)',
                border: '4px solid #fff', boxShadow: '0 0 25px rgba(255, 140, 0, 0.8)',
                display: 'none', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontFamily: 'sans-serif', fontWeight: '900', fontSize: '18px',
                textShadow: '0 2px 4px rgba(0,0,0,0.5)', cursor: 'pointer', zIndex: '1000',
                userSelect: 'none', touchAction: 'manipulation'
            });
            btn.innerText = "NITRO";
            
            const action = (e) => {
                if(e) { e.preventDefault(); e.stopPropagation(); }
                if(this.state === 'RACE' && this.nitro > 15) {
                    this.isTurbo = true;
                    if(window.Sfx) window.Sfx.play(600, 'square', 0.5, 0.2);
                    this.msg("TURBO!", "#0ff");
                }
            };
            btn.addEventListener('touchstart', action, {passive: false});
            btn.addEventListener('mousedown', action);
            document.body.appendChild(btn);
            this.nitroEl = btn;
        },

        reset: function() {
            this.pos = 0;
            this.playerX = 0;
            this.speed = 0;
            this.steer = 0;
            this.lap = 1;
            this.nitro = 100;
            this.isTurbo = false;
            this.particles = [];
            this.bots = [];
            this.remotePlayers = {};
        },

        // --- GERAÇÃO DE PISTA ---
        buildTrack: function() {
            this.segments = [];
            const add = (enter, hold, leave, curve, y) => {
                const startY = this.segments.length > 0 ? this.segments[this.segments.length-1].p2.world.y : 0;
                const endY = startY + (y * CONF.SEGMENT_LENGTH);
                const total = enter + hold + leave;
                for(let i=0; i<total; i++) {
                    const n = this.segments.length;
                    let c = 0;
                    if (i < enter) c = curve * (i/enter);
                    else if (i < enter + hold) c = curve;
                    else c = curve * ((total-i)/leave);

                    let h = startY + (endY - startY) * (i/total);
                    const colorScheme = Math.floor(n/CONF.RUMBLE_LENGTH)%2 ? 'dark' : 'light';

                    this.segments.push({
                        index: n,
                        p1: { world: { z: n*CONF.SEGMENT_LENGTH, y: (n===0?0:this.segments[n-1].p2.world.y), x: 0 }, camera: {}, screen: {} },
                        p2: { world: { z: (n+1)*CONF.SEGMENT_LENGTH, y: h, x: 0 }, camera: {}, screen: {} },
                        curve: c, color: colorScheme
                    });
                }
            };

            // Traçados
            if (this.selTrack === 0) { // Grand Prix
                add(50, 50, 50, 0, 0); add(40, 40, 40, 4, 0);
                add(60, 60, 60, -3, 20); add(40, 40, 40, -3, -20);
                add(30, 30, 30, 6, 0); add(50, 50, 50, 0, 0);
            } else if (this.selTrack === 1) { // Sunset
                add(50, 50, 50, 0, 0); add(30, 80, 30, 5, 0);
                add(30, 30, 30, -5, 0); add(10, 10, 10, 0, 40); add(50, 50, 50, 0, -40);
            } else { // Neon
                add(50, 50, 50, 0, 0); add(20, 20, 20, 8, 0);
                add(20, 20, 20, -8, 0); add(20, 20, 20, 8, 0); add(100, 100, 100, 0, 0);
            }

            this.trackLength = this.segments.length * CONF.SEGMENT_LENGTH;
            this.buildMinimap();
        },

        buildMinimap: function() {
            this.minimap.path = [];
            let x = 0, z = 0, angle = 0;
            let minX=0, maxX=0, minZ=0, maxZ=0;
            // Amostragem para mapa
            for(let i=0; i<this.segments.length; i+=5) {
                const seg = this.segments[i];
                angle += seg.curve * 0.015; 
                x += Math.sin(angle) * 50; z += Math.cos(angle) * 50;
                this.minimap.path.push({x, z});
                if(x < minX) minX = x; if(x > maxX) maxX = x;
                if(z < minZ) minZ = z; if(z > maxZ) maxZ = z;
            }
            this.minimap.minX = minX; this.minimap.maxX = maxX;
            this.minimap.minZ = minZ; this.minimap.maxZ = maxZ;
        },

        // --- LOOP PRINCIPAL ---
        update: function(ctx, w, h, pose, dt) {
            if (this.state === 'MENU') { this.uiMenu(ctx, w, h); return; }
            if (this.state === 'LOBBY') { this.uiLobby(ctx, w, h); return; }
            if (this.state === 'GAMEOVER') { this.uiGameOver(ctx, w, h); return; }

            const safeDt = Math.min(dt, 0.1);
            this.handleInput(pose, w, h, safeDt);
            this.physics(safeDt);
            
            if (this.isOnline) {
                this.syncNetwork();
                this.interpolateRemotes();
            }

            this.render3D(ctx, w, h);
            this.renderHUD(ctx, w, h); // HUD por cima de tudo

            return Math.floor(this.speed * 10);
        },

        handleInput: function(pose, w, h, dt) {
            let steerInput = 0;
            this.wheel.active = false;

            if (pose && pose.keypoints) {
                const lw = pose.keypoints.find(k => k.name === 'left_wrist');
                const rw = pose.keypoints.find(k => k.name === 'right_wrist');
                const nose = pose.keypoints.find(k => k.name === 'nose');

                if (lw && rw && lw.score > 0.3 && rw.score > 0.3) {
                    const lx = (1 - lw.x/640) * w; const ly = (lw.y/480) * h;
                    const rx = (1 - rw.x/640) * w; const ry = (rw.y/480) * h;
                    
                    const angle = Math.atan2(ry - ly, rx - lx);
                    steerInput = angle * 3.0; // Sensibilidade
                    
                    this.wheel.x = (lx+rx)/2; this.wheel.y = (ly+ry)/2; 
                    this.wheel.angle = angle;
                    this.wheel.active = true;

                    // Gesto Turbo
                    if (nose && ly < nose.y && ry < nose.y && this.nitro > 20) {
                        if(!this.isTurbo) {
                            this.isTurbo = true;
                            if(window.Sfx) window.Sfx.play(800, 'square', 0.2, 0.2);
                        }
                    }
                }
            }
            // Suavização da direção
            this.steer += (steerInput - this.steer) * 5 * dt;
        },

        physics: function(dt) {
            const stats = CHARACTERS[this.selChar].stats;
            const segIdx = Math.floor(this.pos / CONF.SEGMENT_LENGTH) % this.segments.length;
            const seg = this.segments[segIdx];

            let max = CONF.MAX_SPEED * stats.speed;
            if(this.isTurbo) {
                max = CONF.TURBO_MAX_SPEED;
                this.nitro -= 35 * dt;
                this.spawnParticle(0, 0, 'fire');
                if(this.nitro <= 0) this.isTurbo = false;
            } else {
                this.nitro = Math.min(100, this.nitro + (8*dt));
            }

            if (Math.abs(this.playerX) > 1.2) { 
                max *= 0.3;
                this.spawnParticle((Math.random()-0.5)*40, 0, 'dust');
                if(window.Gfx) window.Gfx.shakeScreen(2);
            }

            if(this.speed < max) this.speed += CONF.ACCEL * dt * 60;
            else this.speed -= CONF.DECEL * dt * 60;

            const ratio = (this.speed / CONF.MAX_SPEED);
            const dx = dt * 2 * ratio;
            this.playerX -= (dx * seg.curve * 0.3 * ratio); // Centrífuga
            this.playerX += (dx * this.steer * 1.5 * stats.grip); // Direção
            this.playerX = Math.max(-2.5, Math.min(2.5, this.playerX));

            this.pos += this.speed * dt * 20;
            if(this.pos >= this.trackLength) {
                this.pos -= this.trackLength;
                this.lap++;
                if(this.lap > this.totalLaps) this.finishRace();
                else this.msg("VOLTA " + this.lap);
            }

            // Bots
            this.bots.forEach(bot => {
                const botSegIdx = Math.floor(bot.pos / CONF.SEGMENT_LENGTH) % this.segments.length;
                const bSeg = this.segments[botSegIdx];
                let targetSpeed = bot.baseSpeed * (bot.pos > this.pos - 2000 && bot.pos < this.pos + 2000 ? 1.1 : 0.9);
                if(bot.speed < targetSpeed) bot.speed += 2;
                bot.pos += bot.speed * dt * 20;
                bot.x += (-bSeg.curve * 0.6 - bot.x) * 0.05; 
                if(bot.pos >= this.trackLength) { bot.pos -= this.trackLength; bot.lap++; }
            });
        },

        // --- RENDER 3D (PREMIUM) ---
        render3D: function(ctx, w, h) {
            const cx = w/2; const cy = h/2;
            const theme = TRACKS[this.selTrack];

            // 1. Céu e Chão
            const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
            skyGrad.addColorStop(0, theme.sky[0]); skyGrad.addColorStop(0.5, theme.sky[1]);
            ctx.fillStyle = skyGrad; ctx.fillRect(0,0,w,h);
            
            // Horizonte
            ctx.fillStyle = theme.ground[0]; ctx.fillRect(0, h/2, w, h/2);

            let baseIdx = Math.floor(this.pos / CONF.SEGMENT_LENGTH);
            let camH = CONF.CAMERA_HEIGHT + this.segments[baseIdx % this.segments.length].p1.world.y;
            if (this.isTurbo) camH += (Math.random()-0.5)*30;

            let x = 0, dx = 0; 
            let maxY = h; 
            let sprites = [];

            // 2. Estrada (Scanline / Polygon)
            for (let n = 0; n < CONF.DRAW_DISTANCE; n++) {
                const idx = (baseIdx + n) % this.segments.length;
                const seg = this.segments[idx];
                
                let segmentZ = (n * CONF.SEGMENT_LENGTH) + (CONF.SEGMENT_LENGTH - (this.pos % CONF.SEGMENT_LENGTH));
                x += dx; dx += seg.curve;

                // Projeção
                const scale = CONF.CAMERA_DEPTH / (segmentZ/1000); 
                const prevScale = CONF.CAMERA_DEPTH / ((segmentZ + CONF.SEGMENT_LENGTH)/1000); 

                const p1y_rel = (seg.p1.world.y - camH);
                const screenY1 = (h/2) - (scale * p1y_rel * h/2) / 1000;
                const p2y_rel = (seg.p2.world.y - camH);
                const screenY2 = (h/2) - (prevScale * p2y_rel * h/2) / 1000;

                // Otimização
                if (screenY1 >= maxY || screenY2 < 0) continue; 
                if(screenY1 < maxY) maxY = screenY1;

                const objX = this.playerX * CONF.ROAD_WIDTH;
                const screenX1 = cx + (-objX - x) * scale * (w/2) / CONF.ROAD_WIDTH;
                const screenW1 = CONF.ROAD_WIDTH * scale * (w/2) / CONF.ROAD_WIDTH;
                const screenX2 = cx + (-objX - x - dx) * prevScale * (w/2) / CONF.ROAD_WIDTH;
                const screenW2 = CONF.ROAD_WIDTH * prevScale * (w/2) / CONF.ROAD_WIDTH;

                seg.screen = { x: screenX1, y: screenY1, w: screenW1, scale: scale };

                // Cores
                const grass = seg.color === 'light' ? theme.ground[0] : theme.ground[1];
                const road = seg.color === 'light' ? theme.road[0] : theme.road[1];
                const rumble = seg.color === 'light' ? '#fff' : '#c00';

                const y1 = Math.floor(screenY1); const y2 = Math.floor(screenY2);
                if (y1 - y2 > 0) {
                    ctx.fillStyle = grass; ctx.fillRect(0, y2, w, (y1-y2)+1); 
                    this.drawPoly(ctx, road, screenX1-screenW1, y1, screenX1+screenW1, y1, screenX2+screenW2, y2, screenX2-screenW2, y2);
                    const rW1 = screenW1 * 1.2; const rW2 = screenW2 * 1.2;
                    this.drawPoly(ctx, rumble, screenX1-rW1, y1, screenX1-screenW1, y1, screenX2-screenW2, y2, screenX2-rW2, y2);
                    this.drawPoly(ctx, rumble, screenX1+screenW1, y1, screenX1+rW1, y1, screenX2+rW2, y2, screenX2+screenW2, y2);
                    if (seg.color === 'light') {
                        const lW1 = screenW1 * 0.02; const lW2 = screenW2 * 0.02;
                        this.drawPoly(ctx, '#fff', screenX1-lW1, y1, screenX1+lW1, y1, screenX2+lW2, y2, screenX2-lW2, y2);
                    }
                }
            }

            this.collectSprites(baseIdx, sprites);

            // 4. Sprites
            sprites.sort((a,b) => b.dist - a.dist);
            sprites.forEach(s => {
                this.drawKartSprite(ctx, s.x, s.y, s.scale * 3500, 0, false, s.obj.charId, s.isRemote);
                if(s.isRemote || s.obj.id !== undefined) {
                     ctx.fillStyle = '#ff0'; ctx.font="bold 10px Arial"; ctx.textAlign="center";
                     ctx.fillText(s.obj.name || "CPU", s.x, s.y - (s.scale*3500*0.04));
                }
            });

            // Player
            const bounce = Math.abs(Math.sin(Date.now()/50)) * (this.speed/30);
            this.drawKartSprite(ctx, cx, h*0.88 - bounce + this.shake, 2.8, this.steer, this.isTurbo, this.selChar, false);

            this.renderParticles(ctx, w, h);
        },

        collectSprites: function(baseIdx, spritesArr) {
            // Helper para bots e remotos
            const add = (ent, isRemote) => {
                const segIdx = Math.floor(ent.pos / CONF.SEGMENT_LENGTH);
                let rel = segIdx - baseIdx;
                if(rel < 0) rel += this.segments.length;
                if(rel > 0 && rel < CONF.DRAW_DISTANCE) {
                    const idx = (baseIdx + rel) % this.segments.length;
                    const seg = this.segments[idx];
                    if(seg.screen) {
                        const sx = seg.screen.x + (ent.x * seg.screen.w);
                        const mock = isRemote ? {charId: ent.charId, name: ent.name} : ent;
                        spritesArr.push({ type: 'kart', obj: mock, x: sx, y: seg.screen.y, scale: seg.screen.scale, dist: rel, isRemote });
                    }
                }
            };
            this.bots.forEach(b => add(b, false));
            Object.values(this.remotePlayers).forEach(p => add(p, true));
        },

        drawPoly: function(ctx, color, x1, y1, x2, y2, x3, y3, x4, y4) {
            ctx.fillStyle = color;
            ctx.beginPath(); ctx.moveTo(x1|0, y1); ctx.lineTo(x2|0, y1); ctx.lineTo(x3|0, y2); ctx.lineTo(x4|0, y2); ctx.fill();
        },

        drawKartSprite: function(ctx, x, y, size, steer, isTurbo, charId, isRemote) {
            const char = CHARACTERS[charId] || CHARACTERS[0];
            const s = size * 0.001 * (window.innerWidth/2);
            if (s <= 0) return;

            ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.rotate(steer * 0.2);

            // Sombra
            ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.beginPath(); ctx.ellipse(0, 20, 50, 12, 0, 0, Math.PI*2); ctx.fill();
            // Rodas
            ctx.fillStyle = "#111"; ctx.fillRect(-45, -5, 18, 25); ctx.fillRect(27, -5, 18, 25);
            // Chassi
            ctx.fillStyle = isRemote ? '#ccc' : char.color; 
            if(!isRemote) ctx.fillStyle = char.color;
            ctx.beginPath(); ctx.moveTo(-30, -25); ctx.lineTo(30, -25); ctx.lineTo(40, 10); ctx.lineTo(20, 30); ctx.lineTo(-20, 30); ctx.lineTo(-40, 10); ctx.fill();
            // Turbo
            if(isTurbo) { ctx.fillStyle = (Math.random()>0.5)?"#ff0":"#f00"; ctx.beginPath(); ctx.moveTo(-8, 30); ctx.lineTo(8, 30); ctx.lineTo(0, 60+Math.random()*20); ctx.fill(); }
            // Piloto
            ctx.fillStyle = char.skin; ctx.beginPath(); ctx.arc(0, -30, 18, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = char.hat; ctx.beginPath(); ctx.arc(0, -35, 19, Math.PI, 0); ctx.fill(); ctx.fillRect(-20, -35, 40, 6);
            // Volante
            ctx.fillStyle = "#333"; ctx.save(); ctx.translate(0, -10); ctx.rotate(steer); ctx.fillRect(-12, -2, 24, 4); ctx.restore();
            
            ctx.restore();
        },

        spawnParticle: function(x, y, type) {
            // FIX: Limite RÍGIDO de partículas para evitar o crash de memória
            if (this.particles.length > CONF.MAX_PARTICLES) this.particles.shift(); 
            this.particles.push({x, y, vx:(Math.random()-0.5)*10, vy:-Math.random()*15, life:1.0, type});
        },
        
        renderParticles: function(ctx, w, h) {
            this.particles = this.particles.filter(p => p.life > 0);
            this.particles.forEach(p => {
                p.x += p.vx; p.y += p.vy; p.life -= 0.05;
                if (p.life <= 0) return;
                const px = w/2 + p.x; const py = h*0.88 + p.y;
                ctx.globalAlpha = p.life;
                ctx.fillStyle = p.type==='fire' ? '#ff0' : '#888';
                // FIX: Math.max impede raio negativo (causa do crash)
                const r = Math.max(0.1, 8 * p.life);
                ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI*2); ctx.fill();
            });
            ctx.globalAlpha = 1.0;
        },

        // --- HUD BONITO ---
        renderHUD: function(ctx, w, h) {
            // 1. MINIMAPA (MOVIDO PARA BAIXO ESQUERDA PARA NÃO TAPAR SCORE)
            if(this.minimap.path.length > 0) {
                const ms = 120; const mx = 20; const my = h - 140; // Bottom Left
                ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(mx, my, ms, ms);
                ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.strokeRect(mx, my, ms, ms);
                
                ctx.save();
                ctx.translate(mx+ms/2, my+ms/2);
                const sc = 0.5; ctx.scale(sc, sc);
                
                // Desenhar Pista
                ctx.strokeStyle = '#aaa'; ctx.lineWidth = 15; ctx.lineJoin = 'round';
                ctx.beginPath();
                this.minimap.path.forEach((p, i) => { if(i%2===0) { if(i===0) ctx.moveTo(p.x, p.z); else ctx.lineTo(p.x, p.z); } });
                ctx.closePath(); ctx.stroke();

                const getCoord = (d) => {
                    const i = Math.floor(d / (CONF.SEGMENT_LENGTH*5)) % this.minimap.path.length;
                    return this.minimap.path[i] || {x:0, z:0};
                };
                // Players
                this.bots.forEach(b => { const bp = getCoord(b.pos); ctx.fillStyle = "#ff0"; ctx.beginPath(); ctx.arc(bp.x, bp.z, 15, 0, Math.PI*2); ctx.fill(); });
                const me = getCoord(this.pos); ctx.fillStyle = "#f00"; ctx.beginPath(); ctx.arc(me.x, me.z, 20, 0, Math.PI*2); ctx.fill();
                ctx.restore();
            }

            // 2. VOLANTE GT PREMIUM (Bonito)
            if(this.wheel.active) {
                const wx = this.wheel.x; const wy = this.wheel.y;
                const r = 60;
                ctx.save(); ctx.translate(wx, wy); ctx.rotate(this.wheel.angle);
                
                // Sombra
                ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 10;
                
                // Aro Externo (Couro)
                const gradRing = ctx.createLinearGradient(-r, -r, r, r);
                gradRing.addColorStop(0, '#333'); gradRing.addColorStop(0.5, '#555'); gradRing.addColorStop(1, '#222');
                ctx.beginPath(); ctx.arc(0,0, r, 0, Math.PI*2);
                ctx.lineWidth = 15; ctx.strokeStyle = gradRing; ctx.stroke();
                
                // Marca Vermelha Topo
                ctx.beginPath(); ctx.arc(0,0, r, -0.1, 0.1);
                ctx.strokeStyle = '#c00'; ctx.stroke();
                
                // Centro (Metal)
                const gradCenter = ctx.createRadialGradient(0,0, 5, 0,0, 25);
                gradCenter.addColorStop(0, '#ccc'); gradCenter.addColorStop(1, '#555');
                ctx.fillStyle = gradCenter; ctx.beginPath(); ctx.arc(0,0, 25, 0, Math.PI*2); ctx.fill();
                
                // Hastes
                ctx.fillStyle = '#444'; ctx.fillRect(-r+10, -5, r*2-20, 10);
                
                ctx.restore();
            }

            // 3. VELOCÍMETRO (Canto Inferior Direito)
            const hudX = w - 80; const hudY = h - 80;
            ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.beginPath(); ctx.arc(hudX, hudY, 60, 0, Math.PI*2); ctx.fill();
            const angle = Math.PI*0.8 + (this.speed/CONF.TURBO_MAX_SPEED)*(Math.PI*1.4);
            ctx.strokeStyle = this.isTurbo ? '#0ff' : '#f00'; ctx.lineWidth=5;
            ctx.beginPath(); ctx.moveTo(hudX, hudY); ctx.lineTo(hudX + Math.cos(angle)*50, hudY + Math.sin(angle)*50); ctx.stroke();
            ctx.fillStyle="#fff"; ctx.font="bold 24px 'Russo One'"; ctx.textAlign="center";
            ctx.fillText(Math.floor(this.speed), hudX, hudY+40);

            // Mensagens
            this.hudMsgs.forEach(m => {
                m.y--; m.l--; ctx.fillStyle = m.c; ctx.strokeStyle="#000"; ctx.lineWidth=3;
                ctx.font="bold 40px 'Russo One'"; ctx.textAlign="center";
                ctx.strokeText(m.t, w/2, m.y); ctx.fillText(m.t, w/2, m.y);
            });
            this.hudMsgs = this.hudMsgs.filter(m => m.l > 0);
        },

        // --- MENUS ---
        uiMenu: function(ctx, w, h) {
            const grad = ctx.createLinearGradient(0,0,w,h);
            grad.addColorStop(0, '#e74c3c'); grad.addColorStop(1, '#f1c40f');
            ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);
            
            ctx.fillStyle = "#fff"; ctx.font = "italic 60px 'Russo One'"; ctx.textAlign = "center";
            ctx.fillText("KART LEGENDS", w/2, h*0.25);

            this.drawBtn(ctx, w/2, h*0.5, "ARCADE SOLO", "#c0392b");
            this.drawBtn(ctx, w/2, h*0.7, "MULTIPLAYER", "#2980b9");

            if(!window.System.canvas.onclick) {
                window.System.canvas.onclick = (e) => {
                    const r = window.System.canvas.getBoundingClientRect();
                    const y = e.clientY - r.top;
                    if (Math.abs(y - h*0.5) < 40) this.setMode('SOLO');
                    if (Math.abs(y - h*0.7) < 40) this.setMode('MULTI');
                };
            }
        },

        uiLobby: function(ctx, w, h) {
            ctx.fillStyle = "#2c3e50"; ctx.fillRect(0,0,w,h);
            ctx.textAlign = "center"; ctx.fillStyle = "#fff";
            
            ctx.font = "30px sans-serif"; ctx.fillText("PILOTO", w/2, h*0.15);
            const char = CHARACTERS[this.selChar];
            ctx.fillStyle = char.color; ctx.beginPath(); ctx.arc(w/2, h*0.3, 60, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = "#fff"; ctx.font = "bold 40px 'Russo One'"; ctx.fillText(char.name, w/2, h*0.45);
            
            ctx.font = "40px sans-serif"; ctx.fillText("◀", w/2 - 120, h*0.35); ctx.fillText("▶", w/2 + 120, h*0.35);

            const trk = TRACKS[this.selTrack];
            ctx.fillStyle = "#ecf0f1"; ctx.fillRect(w/2 - 150, h*0.55, 300, 50);
            ctx.fillStyle = "#2c3e50"; ctx.font = "20px sans-serif"; ctx.fillText("PISTA: " + trk.name, w/2, h*0.55 + 32);
            ctx.fillStyle = "#f1c40f"; ctx.font = "40px sans-serif";
            ctx.fillText("◀", w/2 - 180, h*0.55 + 35); ctx.fillText("▶", w/2 + 180, h*0.55 + 35);

            this.drawBtn(ctx, w/2, h*0.8, "START RACE", "#27ae60");

            window.System.canvas.onclick = (e) => {
                const r = window.System.canvas.getBoundingClientRect();
                const x = e.clientX - r.left; const y = e.clientY - r.top;
                
                if (y > h*0.25 && y < h*0.45) {
                    if (x < w/2) this.selChar = (this.selChar - 1 + CHARACTERS.length) % CHARACTERS.length;
                    else this.selChar = (this.selChar + 1) % CHARACTERS.length;
                }
                if (y > h*0.5 && y < h*0.65) {
                    if (x < w/2) this.selTrack = (this.selTrack - 1 + TRACKS.length) % TRACKS.length;
                    else this.selTrack = (this.selTrack + 1) % TRACKS.length;
                }
                if (y > h*0.75 && y < h*0.85) {
                    this.startGame();
                    window.System.canvas.onclick = null;
                }
            };
        },

        drawBtn: function(ctx, x, y, txt, col) {
            ctx.fillStyle = col; ctx.fillRect(x-150, y-30, 300, 60);
            ctx.strokeStyle = "#fff"; ctx.lineWidth = 4; ctx.strokeRect(x-150, y-30, 300, 60);
            ctx.fillStyle = "#fff"; ctx.font = "bold 25px sans-serif"; ctx.textAlign="center";
            ctx.fillText(txt, x, y+10);
        },

        setMode: function(mode) {
            this.isOnline = (mode === 'MULTI');
            this.state = 'LOBBY';
            window.System.canvas.onclick = null;
            if(this.isOnline && window.DB) {
                this.dbRef = window.DB.ref('rooms/' + this.roomId);
                this.dbRef.child('players').on('value', snap => {
                    const val = snap.val();
                    if(val) {
                        const others = {};
                        Object.keys(val).forEach(k => { if(k !== this.playerId) others[k] = val[k]; });
                        this.remotePlayers = others;
                    }
                });
            }
        },

        startGame: function() {
            this.reset();
            this.buildTrack();
            // FORÇA BOTS NO SOLO
            if (!this.isOnline) {
                for(let i=0; i<3; i++) {
                    this.bots.push({
                        charId: (this.selChar + 1 + i) % CHARACTERS.length,
                        pos: (i+1) * 300, x: (i%2===0 ? 0.4 : -0.4),
                        baseSpeed: 120 + (Math.random()*20), speed: 0, lap: 1
                    });
                }
            }
            this.state = 'RACE';
            this.nitroEl.style.display = 'flex';
            this.msg("GO!", "#0f0");
        },
        
        finishRace: function() {
            this.state = 'GAMEOVER';
            this.nitroEl.style.display = 'none';
            if(window.System) window.System.gameOver("FINAL!");
        },

        uiGameOver: function(ctx, w, h) {},

        msg: function(t, c='#fff') {
            this.hudMsgs.push({t, c, y: window.innerHeight/2, l: 60});
        },

        syncNetwork: function() {
            if(!this.dbRef) return;
            const now = Date.now();
            if(now - this.lastSync > 100) { 
                this.lastSync = now;
                this.dbRef.child('players/' + this.playerId).set({
                    name: 'P1', charId: this.selChar, pos: Math.floor(this.pos), x: this.playerX, lap: this.lap
                });
            }
        },
        
        interpolateRemotes: function() {}
    };

    if(window.System && window.System.registerGame) {
        window.System.registerGame('kart', 'Kart Legends', '🏎️', Game, { camOpacity: 0.1 });
    }

})();