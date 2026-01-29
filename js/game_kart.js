// =============================================================================
// THIAGUINHO KART GP - A LÓGICA COMPLETA
// =============================================================================

(function() {
    
    // --- 1. DADOS DE CONTEÚDO (PERSONAGENS E PISTAS) ---
    const CHARACTERS = [
        { id: 0, name: 'OTTO',  color: '#e74c3c', speed: 1.0,  turn: 1.0,  accel: 1.0,  desc: 'Equilibrado' },
        { id: 1, name: 'SPEED', color: '#f1c40f', speed: 1.15, turn: 0.7,  accel: 0.9,  desc: 'Velocidade Max' },
        { id: 2, name: 'TANK',  color: '#3498db', speed: 0.9,  turn: 1.3,  accel: 0.8,  desc: 'Controle Total' },
        { id: 3, name: 'TOAD',  color: '#2ecc71', speed: 0.95, turn: 1.1,  accel: 1.2,  desc: 'Aceleração' }
    ];

    const TRACKS = [
        { id: 0, name: 'GP CIRCUITO', theme: 'grass', sky: 0, grip: 1.0,  msg: 'Dia Lindo!' },
        { id: 1, name: 'DESERTO SECO', theme: 'sand',  sky: 1, grip: 0.9,  msg: 'Cuidado na Areia' },
        { id: 2, name: 'PICO NEVADO', theme: 'snow',  sky: 2, grip: 0.75, msg: 'Pista Escorregadia' }
    ];

    const COLORS = {
        SKY:  ['#72D7EE', '#FF9F43', '#bdc3c7'], // Azul, Laranja (Pôr do sol), Cinza (Neve)
        ROAD: { 
            grass: { light: '#6B6B6B', dark: '#636363', off: '#10AA10' },
            sand:  { light: '#E0C388', dark: '#D4B475', off: '#E67E22' },
            snow:  { light: '#bdc3c7', dark: '#b2bec3', off: '#dfe6e9' }
        },
        RUMBLE: { light: '#cc0000', dark: '#eeeeee' } // Zebra clássica
    };

    // --- 2. CONFIGURAÇÃO DE FÍSICA (TUNING) ---
    const TUNING = {
        BASE_MAX_SPEED: 12000,
        BASE_ACCEL: 4000,
        BASE_TURN: 0.045,
        FRICTION: 0.96,
        OFFROAD_LIMIT: 3000, 
        CENTRIFUGAL: 0.3,
        SEGMENT_LENGTH: 200,
        DRAW_DISTANCE: 300,
        LANES: 3
    };

    // --- 3. MOTOR DO JOGO ---
    const Game = {
        state: 'MENU', // MENU, CHAR_SELECT, TRACK_SELECT, LOBBY, RACE, FINISH
        mode: 'SOLO',  // SOLO ou ONLINE
        
        // Seleções
        selCharIdx: 0,
        selTrackIdx: 0,
        
        // Jogador Local
        local: {
            x: 0, z: 0, speed: 0, steer: 0, 
            lap: 1, maxLaps: 3, rank: 1, finishTime: 0,
            stats: { maxSpeed: 0, accel: 0, turn: 0 } // Calculado ao iniciar
        },

        // Multijogador
        roomId: 'sala_principal',
        remotePlayers: {}, 
        lastNetworkUpdate: 0,

        // Pista
        segments: [],
        trackLength: 0,
        trackTheme: null, // Objeto da pista selecionada

        // Input
        keys: { ArrowLeft: false, ArrowRight: false, ArrowUp: false, ArrowDown: false, Enter: false },
        virtualWheel: { angle: 0, visible: false },

        // --- INICIALIZAÇÃO ---
        init: function() {
            console.log("🏁 Kart Engine Start - Full Logic");
            this.bindInput();
            this.reset();
        },

        reset: function() {
            this.local.x = 0;
            this.local.z = 0;
            this.local.speed = 0;
            this.local.lap = 1;
            this.local.finishTime = 0;
            this.state = 'MENU';
            document.getElementById('webcam').style.opacity = '0';
        },

        cleanup: function() {
            if(this.dbRef) this.dbRef.off();
        },

        // --- SISTEMA DE PISTA ---
        buildTrack: function(trackId) {
            this.segments = [];
            const trackInfo = TRACKS[trackId];
            this.trackTheme = trackInfo;
            
            // Gerador Procedural Baseado na Pista
            const length = 3000;
            for(let i=0; i<length; i++) {
                let curve = 0;
                let y = 0;

                // Layout varia levemente por pista
                if (trackId === 0) { // Circuito
                    if (i > 200 && i < 500) curve = 2;
                    if (i > 800 && i < 1200) curve = -2;
                } else if (trackId === 1) { // Deserto (Mais curvas)
                    if (i > 100 && i < 600) curve = 1.5;
                    if (i > 700 && i < 1400) curve = -1.5;
                    if (i > 1500 && i < 2000) y = Math.sin(i*0.02) * 30; // Dunas
                } else { // Neve (Curvas fechadas)
                    if (i > 300 && i < 500) curve = 4;
                    if (i > 600 && i < 800) curve = -4;
                    if (i > 1000 && i < 2000) y = Math.cos(i*0.01) * 50; // Montanhas
                }

                this.segments.push({
                    index: i,
                    p1: { world: { y: y * TUNING.SEGMENT_LENGTH, z: i * TUNING.SEGMENT_LENGTH }, camera: {}, screen: {} },
                    p2: { world: { y: y * TUNING.SEGMENT_LENGTH, z: (i + 1) * TUNING.SEGMENT_LENGTH }, camera: {}, screen: {} },
                    curve: curve,
                    sprites: [],
                    color: Math.floor(i / 3) % 2 ? 'dark' : 'light'
                });
            }
            this.trackLength = this.segments.length * TUNING.SEGMENT_LENGTH;
        },

        // --- INPUT HANDLING ---
        bindInput: function() {
            const handleKey = (code, down) => {
                this.keys[code] = down;
                if (down) this.handleMenuInput(code);
            };

            window.addEventListener('keydown', e => handleKey(e.code, true));
            window.addEventListener('keyup', e => handleKey(e.code, false));
            
            // Touch Controls para Menus
            const canvas = window.System.canvas;
            canvas.addEventListener('mousedown', (e) => {
                const w = canvas.width;
                if (e.clientX < w * 0.3) this.handleMenuInput('ArrowLeft');
                else if (e.clientX > w * 0.7) this.handleMenuInput('ArrowRight');
                else this.handleMenuInput('Enter');
                
                // Acelerar na corrida
                if (this.state === 'RACE') this.keys.ArrowUp = true;
            });
            canvas.addEventListener('mouseup', () => this.keys.ArrowUp = false);
            
            // Touch Mobile
            canvas.addEventListener('touchstart', (e) => {
                e.preventDefault();
                const t = e.touches[0];
                const w = canvas.width;
                if (t.clientX < w * 0.3) this.handleMenuInput('ArrowLeft');
                else if (t.clientX > w * 0.7) this.handleMenuInput('ArrowRight');
                else this.handleMenuInput('Enter');
                
                if (this.state === 'RACE') this.keys.ArrowUp = true;
            }, {passive: false});
            canvas.addEventListener('touchend', () => this.keys.ArrowUp = false);
        },

        handleMenuInput: function(code) {
            // Navegação de Menus
            if (this.state === 'MENU') {
                if (code === 'Enter') { 
                    this.state = 'CHAR_SELECT'; 
                    window.Sfx.click();
                }
            }
            else if (this.state === 'CHAR_SELECT') {
                if (code === 'ArrowLeft') this.selCharIdx = (this.selCharIdx - 1 + CHARACTERS.length) % CHARACTERS.length;
                if (code === 'ArrowRight') this.selCharIdx = (this.selCharIdx + 1) % CHARACTERS.length;
                if (code === 'Enter') {
                    this.state = 'TRACK_SELECT';
                    window.Sfx.click();
                }
                if (code === 'ArrowLeft' || code === 'ArrowRight') window.Sfx.hover();
            }
            else if (this.state === 'TRACK_SELECT') {
                if (code === 'ArrowLeft') this.selTrackIdx = (this.selTrackIdx - 1 + TRACKS.length) % TRACKS.length;
                if (code === 'ArrowRight') this.selTrackIdx = (this.selTrackIdx + 1) % TRACKS.length;
                if (code === 'Enter') {
                    this.startRaceConfig();
                    window.Sfx.click();
                }
                if (code === 'ArrowLeft' || code === 'ArrowRight') window.Sfx.hover();
            }
        },

        startRaceConfig: function() {
            // Aplica atributos do personagem
            const char = CHARACTERS[this.selCharIdx];
            this.local.stats.maxSpeed = TUNING.BASE_MAX_SPEED * char.speed;
            this.local.stats.accel = TUNING.BASE_ACCEL * char.accel;
            this.local.stats.turn = TUNING.BASE_TURN * char.turn;

            // Constroi pista
            this.buildTrack(this.selTrackIdx);

            // Verifica modo
            if (this.mode === 'ONLINE') {
                this.joinLobby();
            } else {
                this.state = 'RACE';
                // Adiciona Bots simples no modo Solo
                this.remotePlayers = {
                    'bot1': { x: -0.5, z: 200, color: '#f0f', charId: 1, isBot: true, speed: 10000 },
                    'bot2': { x: 0.5, z: 400, color: '#0ff', charId: 2, isBot: true, speed: 9000 }
                };
            }
        },

        getSteeringInput: function(pose) {
            let steer = 0;
            let wheelVisible = false;
            if (this.keys.ArrowLeft) steer = -1;
            if (this.keys.ArrowRight) steer = 1;

            if (pose && pose.keypoints) {
                const lw = pose.keypoints.find(k => k.name === 'left_wrist');
                const rw = pose.keypoints.find(k => k.name === 'right_wrist');
                if (lw && rw && lw.score > 0.3 && rw.score > 0.3) {
                    wheelVisible = true;
                    const dx = rw.x - lw.x;
                    const dy = rw.y - lw.y;
                    steer = Math.atan2(dy, dx) * 2.0; 
                    if (steer > 1) steer = 1; if (steer < -1) steer = -1;
                    if (Math.abs(steer) < 0.1) steer = 0;
                }
            }
            this.virtualWheel.visible = wheelVisible;
            this.virtualWheel.angle += (steer - this.virtualWheel.angle) * 0.2;
            return steer;
        },

        // --- UPDATE LOOP ---
        update: function(dt, pose) {
            if (this.state !== 'RACE' && this.state !== 'FINISH') return;

            const player = this.local;
            const steerInput = this.getSteeringInput(pose);
            
            // Física baseada nos Stats do Personagem
            const maxSpeed = player.stats.maxSpeed;
            const accel = player.stats.accel;
            const turnSpeed = player.stats.turn;

            // Aceleração/Freio
            if (this.keys.ArrowUp) player.speed += accel * dt;
            else if (this.keys.ArrowDown) player.speed -= accel * dt; // Freio
            else player.speed *= TUNING.FRICTION; // Inércia

            // Direção
            if (player.speed !== 0) {
                // Pista de Gelo/Areia afeta Grip
                const grip = this.trackTheme ? this.trackTheme.grip : 1.0;
                const turnFactor = (player.speed / maxSpeed);
                player.x += steerInput * turnSpeed * turnFactor * grip; 
            }

            // Grama (Offroad)
            if ((player.x < -2.2 || player.x > 2.2) && player.speed > TUNING.OFFROAD_LIMIT) {
                player.speed += (TUNING.OFFROAD_LIMIT - player.speed) * 0.1;
            }

            // Centrifuga
            const playerSegment = this.segments[Math.floor(player.z / TUNING.SEGMENT_LENGTH) % this.segments.length];
            player.x -= playerSegment.curve * TUNING.CENTRIFUGAL * (player.speed / maxSpeed) * dt;

            // Limites e Loop
            player.speed = Math.max(0, Math.min(player.speed, maxSpeed));
            player.x = Math.max(-4, Math.min(player.x, 4));
            player.z += player.speed * dt;

            if (player.z >= this.trackLength) {
                player.z -= this.trackLength;
                player.lap++;
                if (player.lap > player.maxLaps) {
                    this.state = 'FINISH';
                    player.finishTime = Date.now();
                    this.finishRace();
                }
            }

            // Update Bots (Modo Solo)
            if (this.mode === 'SOLO') {
                Object.values(this.remotePlayers).forEach(bot => {
                    bot.z += bot.speed * dt;
                    if(bot.z >= this.trackLength) bot.z -= this.trackLength;
                    // IA simples de desviar
                    const botSeg = this.segments[Math.floor(bot.z / TUNING.SEGMENT_LENGTH) % this.segments.length];
                    bot.x -= botSeg.curve * 0.005; // Segue curva
                    if(bot.x > 1.5) bot.x -= 0.05; if(bot.x < -1.5) bot.x += 0.05;
                });
            }

            this.updateRanking();
            this.networkUpdate();
        },

        // --- RENDER LOOP ---
        draw: function(ctx, w, h) {
            ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);

            if (this.state === 'MENU') { this.drawTitleScreen(ctx, w, h); return; }
            if (this.state === 'CHAR_SELECT') { this.drawCharSelect(ctx, w, h); return; }
            if (this.state === 'TRACK_SELECT') { this.drawTrackSelect(ctx, w, h); return; }
            if (this.state === 'LOBBY') { this.drawLobby(ctx, w, h); return; }

            // GAMEPLAY
            this.drawBackground(ctx, w, h);
            this.renderTrack(ctx, w, h);
            this.drawPlayer(ctx, w, h);
            this.drawHUD(ctx, w, h);
        },

        // --- TELAS DE MENU ---
        drawTitleScreen: function(ctx, w, h) {
            this.drawBackground(ctx, w, h); // Fundo da pista
            ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0,0,w,h);
            
            ctx.textAlign = 'center';
            ctx.fillStyle = '#f1c40f'; ctx.font = "bold 80px 'Russo One'"; 
            ctx.shadowColor="black"; ctx.shadowBlur=10;
            ctx.fillText("THIAGUINHO", w/2, h*0.3);
            ctx.fillStyle = '#fff'; ctx.fillText("KART GP", w/2, h*0.42);
            
            ctx.shadowBlur=0;
            ctx.font = "30px 'Chakra Petch'";
            // Simulação de botões
            ctx.fillStyle = this.mode === 'SOLO' ? '#2ecc71' : '#555';
            ctx.fillRect(w/2 - 250, h*0.6, 240, 60);
            ctx.fillStyle = '#fff'; ctx.fillText("SOLO", w/2 - 130, h*0.6 + 40);

            ctx.fillStyle = this.mode === 'ONLINE' ? '#3498db' : '#555';
            ctx.fillRect(w/2 + 10, h*0.6, 240, 60);
            ctx.fillStyle = '#fff'; ctx.fillText("ONLINE", w/2 + 130, h*0.6 + 40);

            ctx.font = "20px sans-serif";
            ctx.fillText("Clique nos botões ou aperte ENTER", w/2, h - 50);

            // Logica simples de clique pra trocar modo
            if(!this.hasMenuClick) {
                this.hasMenuClick = true;
                window.System.canvas.onclick = (e) => {
                    if (this.state !== 'MENU') return;
                    if (e.clientX < w/2) this.mode = 'SOLO'; else this.mode = 'ONLINE';
                    window.Sfx.hover();
                };
            }
        },

        drawCharSelect: function(ctx, w, h) {
            const char = CHARACTERS[this.selCharIdx];
            ctx.fillStyle = '#2c3e50'; ctx.fillRect(0,0,w,h);
            
            ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
            ctx.font = "40px 'Russo One'"; ctx.fillText("SELECIONE SEU PILOTO", w/2, 60);

            // Desenha Avatar Grande
            ctx.fillStyle = char.color; 
            ctx.beginPath(); ctx.arc(w/2, h/2 - 50, 80, 0, Math.PI*2); ctx.fill();
            
            ctx.font = "bold 50px 'Russo One'"; ctx.fillText(char.name, w/2, h/2 + 80);
            ctx.font = "24px 'Chakra Petch'"; ctx.fillStyle = '#bdc3c7'; ctx.fillText(char.desc, w/2, h/2 + 120);

            // Stats Bars
            const drawBar = (label, val, y) => {
                ctx.textAlign = 'right'; ctx.font = "20px sans-serif"; ctx.fillText(label, w/2 - 120, y);
                ctx.fillStyle = '#555'; ctx.fillRect(w/2 - 100, y - 15, 200, 20);
                ctx.fillStyle = val > 1.0 ? '#2ecc71' : '#e74c3c'; 
                ctx.fillRect(w/2 - 100, y - 15, 200 * (val/1.5), 20);
            };
            drawBar("Velocidade", char.speed, h*0.75);
            drawBar("Curva", char.turn, h*0.75 + 40);
            drawBar("Aceleração", char.accel, h*0.75 + 80);

            ctx.fillStyle = '#fff'; ctx.textAlign='center'; ctx.fillText("< Setas para Trocar >", w/2, h-40);
        },

        drawTrackSelect: function(ctx, w, h) {
            const track = TRACKS[this.selTrackIdx];
            
            // Preview de Fundo
            const oldSky = this.trackTheme ? this.trackTheme.sky : 0; // Hack visual
            this.trackTheme = track; // Seta temporariamente pra desenhar fundo
            this.drawBackground(ctx, w, h);
            this.trackTheme = null; // Reseta

            ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0,0,w,h);
            
            ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
            ctx.font = "40px 'Russo One'"; ctx.fillText("ESCOLHA A PISTA", w/2, 60);

            ctx.font = "bold 60px 'Russo One'"; ctx.fillStyle = '#f1c40f';
            ctx.fillText(track.name, w/2, h/2);
            
            ctx.font = "30px 'Chakra Petch'"; ctx.fillStyle = '#fff';
            ctx.fillText(track.msg, w/2, h/2 + 60);

            ctx.font = "20px sans-serif";
            ctx.fillText("ENTER para Iniciar", w/2, h-80);
        },

        drawLobby: function(ctx, w, h) {
            ctx.fillStyle = '#222'; ctx.fillRect(0,0,w,h);
            ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
            ctx.font = "30px 'Russo One'"; ctx.fillText("AGUARDANDO JOGADORES...", w/2, 100);
            
            let y = 180;
            ctx.font = "20px monospace";
            ctx.fillText(`Você: ${CHARACTERS[this.selCharIdx].name}`, w/2, y);
            y += 40;
            
            Object.values(this.remotePlayers).forEach(p => {
                const cName = CHARACTERS[p.charId] ? CHARACTERS[p.charId].name : 'Desconhecido';
                ctx.fillStyle = p.color;
                ctx.fillText(`Oponente: ${cName}`, w/2, y);
                y += 30;
            });

            ctx.fillStyle = '#f1c40f';
            ctx.fillText("A Corrida começará em breve...", w/2, h - 50);
        },

        // --- RENDER DO JOGO (PISTA) ---
        renderTrack: function(ctx, w, h) {
            const player = this.local;
            const baseSegment = this.segments[Math.floor(player.z / TUNING.SEGMENT_LENGTH) % this.segments.length];
            const basePercent = (player.z % TUNING.SEGMENT_LENGTH) / TUNING.SEGMENT_LENGTH;
            
            let dx = -(baseSegment.curve * basePercent);
            let x = 0;
            let maxY = h;

            // Insere Oponentes na lista de sprites para renderização
            Object.values(this.remotePlayers).forEach(p => {
                let pZ = p.z;
                if (pZ < player.z - (this.trackLength/2)) pZ += this.trackLength;
                
                if (pZ > player.z && pZ < player.z + (TUNING.SEGMENT_LENGTH * TUNING.DRAW_DISTANCE)) {
                     const segIdx = Math.floor(pZ / TUNING.SEGMENT_LENGTH) % this.segments.length;
                     if (!this.segments[segIdx].tempSprites) this.segments[segIdx].tempSprites = [];
                     
                     // Usa cor do personagem remoto
                     const pChar = CHARACTERS[p.charId] || CHARACTERS[0];
                     this.segments[segIdx].tempSprites.push({ x: p.x, color: pChar.color });
                }
            });

            // Draw Track
            for(let n = 0; n < TUNING.DRAW_DISTANCE; n++) {
                const segment = this.segments[(baseSegment.index + n) % this.segments.length];
                const looped = segment.index < baseSegment.index;
                
                // Camera Y baseada na ondulação da pista
                const camH = 1000 + (player.y || 0); // Altura fixa por enquanto

                this.project(segment.p1, (player.x * TUNING.LANES) - x, camH, player.z - (looped ? this.trackLength : 0), w, h);
                this.project(segment.p2, (player.x * TUNING.LANES) - x - dx, camH, player.z - (looped ? this.trackLength : 0), w, h);

                x += dx; dx += segment.curve;

                if ((segment.p1.camera.z <= 100) || (segment.p2.screen.y >= maxY) || (segment.p2.screen.y >= segment.p1.screen.y)) {
                    segment.tempSprites = [];
                    continue;
                }

                this.drawSegment(ctx, w, h, segment);
                maxY = segment.p1.screen.y;
            }

            // Draw Sprites (Back to Front)
            for(let n = TUNING.DRAW_DISTANCE - 1; n > 0; n--) {
                const segment = this.segments[(baseSegment.index + n) % this.segments.length];
                if (segment.tempSprites) {
                    segment.tempSprites.forEach(s => this.drawKartSprite(ctx, w, h, segment, s));
                    segment.tempSprites = [];
                }
            }
        },

        project: function(p, cx, cy, cz, w, h) {
            p.camera.x = (p.world.x || 0) - cx;
            p.camera.y = (p.world.y || 0) - cy;
            p.camera.z = (p.world.z || 0) - cz;
            p.screen.scale = 800 / p.camera.z; // FOV
            p.screen.x = Math.round((w/2) + (p.screen.scale * p.camera.x * w/2));
            p.screen.y = Math.round((h/2) - (p.screen.scale * p.camera.y * h/2));
            p.screen.w = Math.round((p.screen.scale * TUNING.LANES * w/2));
        },

        drawSegment: function(ctx, w, h, seg) {
            const theme = this.trackTheme ? COLORS.ROAD[this.trackTheme.theme] : COLORS.ROAD.grass;
            const rColor = COLORS.RUMBLE;
            
            const x1 = seg.p1.screen.x, y1 = seg.p1.screen.y, w1 = seg.p1.screen.w;
            const x2 = seg.p2.screen.x, y2 = seg.p2.screen.y, w2 = seg.p2.screen.w;

            ctx.fillStyle = seg.color === 'dark' ? theme.off : theme.light; // Grama lateral
            ctx.fillRect(0, y2, w, y1-y2);

            // Zebra e Pista
            this.poly(ctx, x1-w1*1.2, y1, x1+w1*1.2, y1, x2+w2*1.2, y2, x2-w2*1.2, y2, seg.color==='dark'?rColor.dark:rColor.light);
            this.poly(ctx, x1-w1, y1, x1+w1, y1, x2+w2, y2, x2-w2, y2, seg.color==='dark'?theme.dark:theme.light);
        },

        poly: function(ctx, x1, y1, x2, y2, x3, y3, x4, y4, c) {
            ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.lineTo(x3,y3); ctx.lineTo(x4,y4); ctx.fill();
        },

        drawKartSprite: function(ctx, w, h, seg, sprite) {
            const scale = seg.p1.screen.scale;
            const destX = seg.p1.screen.x + (scale * sprite.x * w/2) * w;
            const destY = seg.p1.screen.y;
            const size = w * 2 * scale;
            
            // Corpo do Kart Oponente
            ctx.fillStyle = sprite.color;
            ctx.fillRect(destX - size/2, destY - size, size, size*0.6);
            
            // Rodas
            ctx.fillStyle = '#222';
            ctx.fillRect(destX - size/2 - size*0.1, destY - size*0.4, size*0.2, size*0.4);
            ctx.fillRect(destX + size/2 - size*0.1, destY - size*0.4, size*0.2, size*0.4);
        },

        drawPlayer: function(ctx, w, h) {
            const char = CHARACTERS[this.selCharIdx];
            const kartW = w * 0.18;
            const kartH = kartW * 0.6;
            const bounce = Math.sin(Date.now()*0.02) * (this.local.speed/TUNING.BASE_MAX_SPEED) * 5;
            
            ctx.save();
            ctx.translate(w/2, h - 50 + bounce);
            
            // Inclinação nas curvas
            ctx.rotate(this.local.steer * 0.3);

            // Kart Body
            ctx.fillStyle = char.color;
            ctx.beginPath();
            ctx.moveTo(-kartW/2, 0); ctx.lineTo(kartW/2, 0);
            ctx.lineTo(kartW/2 - 20, -kartH); ctx.lineTo(-kartW/2 + 20, -kartH);
            ctx.fill();

            // Cabeça
            ctx.fillStyle = '#ecf0f1'; ctx.beginPath(); 
            ctx.arc(0, -kartH*0.8, kartW*0.25, 0, Math.PI*2); ctx.fill();
            
            // Rodas
            ctx.fillStyle = '#333';
            ctx.fillRect(-kartW/2 - 10, -20, 20, 40);
            ctx.fillRect(kartW/2 - 10, -20, 20, 40);

            ctx.restore();
        },

        drawBackground: function(ctx, w, h) {
            const skyIdx = this.trackTheme ? this.trackTheme.sky : 0;
            const skyColor = COLORS.SKY[skyIdx] || COLORS.SKY[0];
            
            // Gradiente Céu
            const grad = ctx.createLinearGradient(0,0,0,h);
            grad.addColorStop(0, skyColor);
            grad.addColorStop(1, '#fff');
            ctx.fillStyle = grad;
            ctx.fillRect(0,0,w,h);
        },

        drawHUD: function(ctx, w, h) {
            if (this.virtualWheel.visible) {
                ctx.save(); ctx.translate(w-80, h-80); ctx.strokeStyle='white'; ctx.lineWidth=4;
                ctx.beginPath(); ctx.arc(0,0,40,0,Math.PI*2); ctx.stroke();
                ctx.rotate(this.virtualWheel.angle); ctx.fillStyle='red'; ctx.fillRect(-5,-40,10,20);
                ctx.restore();
            }

            ctx.font = "bold 40px 'Russo One'"; ctx.fillStyle = 'white'; ctx.textAlign='left';
            const kmh = Math.floor(this.local.speed / 60);
            ctx.fillText(kmh + " KM/H", 20, 50);
            
            ctx.textAlign='right';
            ctx.fillText(`VOLTA ${this.local.lap}/3`, w-20, 50);
            ctx.font = "20px sans-serif";
            ctx.fillText(CHARACTERS[this.selCharIdx].name, w-20, 80);
        },

        // --- MULTIPLAYER ---
        joinLobby: function() {
            if (!window.DB) { this.state='RACE'; return; }
            this.state = 'LOBBY';
            document.getElementById('webcam').style.opacity = '1';

            this.dbRef = window.DB.ref(`rooms/${this.roomId}/players`);
            const myRef = this.dbRef.child(window.System.playerId);
            
            myRef.set({
                x: 0, z: 0, speed: 0, 
                charId: this.selCharIdx, // Importante: Envia o personagem escolhido
                color: CHARACTERS[this.selCharIdx].color,
                lastActive: firebase.database.ServerValue.TIMESTAMP
            });
            myRef.onDisconnect().remove();

            this.dbRef.on('value', snap => {
                const data = snap.val();
                if(!data) return;
                
                Object.keys(data).forEach(k => {
                    if(k === window.System.playerId) return;
                    if(!this.remotePlayers[k]) {
                        this.remotePlayers[k] = data[k];
                    } else {
                        // Update
                        const p = this.remotePlayers[k];
                        p.targetX = data[k].x;
                        p.targetZ = data[k].z;
                        p.charId = data[k].charId;
                        p.color = data[k].color;
                    }
                });

                // Start Automático se tiver 2+ (simples)
                if(this.state === 'LOBBY' && Object.keys(data).length >= 2) {
                    setTimeout(() => {
                        this.state = 'RACE';
                        window.System.video.style.opacity = '0.3';
                    }, 3000);
                }
            });
        },

        networkUpdate: function() {
            if (this.mode !== 'ONLINE') return;
            
            // Interpolação
            Object.values(this.remotePlayers).forEach(p => {
                if(p.isBot) return; // Bots são locais no modo solo
                if(p.targetX !== undefined) p.x += (p.targetX - p.x) * 0.1;
                if(p.targetZ !== undefined) {
                    let d = p.targetZ - p.z;
                    if(d < -1500) d += 3000; if(d > 1500) d -= 3000;
                    p.z += d * 0.1;
                    if(p.z >= this.trackLength) p.z -= this.trackLength;
                }
            });

            // Envio
            const now = Date.now();
            if (now - this.lastNetworkUpdate > 100) {
                this.lastNetworkUpdate = now;
                this.dbRef.child(window.System.playerId).update({
                    x: Number(this.local.x.toFixed(2)),
                    z: Math.floor(this.local.z),
                    charId: this.selCharIdx,
                    color: CHARACTERS[this.selCharIdx].color
                });
            }
        },

        updateRanking: function() {
            // Logica simples de rank baseada em Z
            // Em produção real, precisaria contar voltas via rede também
        },

        finishRace: function() {
            if(this.dbRef) this.dbRef.child(window.System.playerId).remove();
            alert("FIM DE JOGO! Tempo: " + ((Date.now()-this.local.finishTime)/1000) + "s");
            this.reset();
        }
    };

    window.KartGame = Game;
})();
