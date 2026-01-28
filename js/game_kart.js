// =====================================================
// KART DO OTTO – MULTIPLAYER REALTIME LOBBY
// =====================================================

(function() {

    // --- CONFIGURAÇÕES DE DADOS (Personagens e Pistas) ---
    const CHARACTERS = [
        { id: 0, name: 'OTTO', color: '#e74c3c', speedInfo: 0.95, turnInfo: 0.95, desc: 'Equilibrado' },
        { id: 1, name: 'SPEED', color: '#f1c40f', speedInfo: 1.05, turnInfo: 0.85, desc: 'Muito Rápido' },
        { id: 2, name: 'TANK', color: '#3498db', speedInfo: 0.85, turnInfo: 1.10, desc: 'Fácil Controle' }
    ];

    const TRACKS = [
        { id: 0, name: 'GP CIRCUITO', sky: 0, ground: 'grass', curveMult: 1.0 },
        { id: 1, name: 'DESERTO SECO', sky: 1, ground: 'sand', curveMult: 0.6 },
        { id: 2, name: 'PICO NEVADO', sky: 0, ground: 'snow', curveMult: 1.4 }
    ];

    // --- VARIÁVEIS DO JOGO ---
    let segments = [];
    let trackLength = 0;
    let nitroBtn = null;
    let minimapPoints = [];
    
    // Auxiliar para pegar segmentos com segurança
    const DUMMY_SEG = { curve: 0, y: 0, color: 'light', obs: [] };
    function getSegment(index) {
        if (!segments || segments.length === 0) return DUMMY_SEG;
        return segments[((Math.floor(index) % segments.length) + segments.length) % segments.length] || DUMMY_SEG;
    }

    const Logic = {
        // Estado Global
        state: 'LOBBY', // LOBBY, WAITING, RACE, FINISHED
        roomId: 'room_01', // Por padrão, sala única pública para simplicidade
        
        // Seleção no Lobby
        selectedChar: 0,
        selectedTrack: 0,
        isReady: false,
        lobbyTimer: 0,

        // Física
        speed: 0, pos: 0, playerX: 0, steer: 0,
        nitro: 100, turboLock: false, boostTimer: 0,
        lap: 1, totalLaps: 3, rank: 1, score: 0,
        
        // Visual / Input
        visualTilt: 0, bounce: 0, 
        virtualWheel: { x:0, y:0, r:0, opacity:0 },
        
        // Multiplayer
        rivals: [],
        lastSync: 0,
        dbRef: null,

        // --- CONSTRUÇÃO DA PISTA BASEADA NA SELEÇÃO ---
        buildTrack: function(trackId) {
            segments = [];
            const trk = TRACKS[trackId];
            const multiplier = trk.curveMult;
            
            const addRoad = (enter, curve, y) => {
                const startIdx = segments.length;
                for(let i = 0; i < enter; i++) {
                    const isDark = Math.floor(segments.length / 3) % 2;
                    segments.push({ curve: curve * multiplier, y: y, color: isDark ? 'dark' : 'light', obs: [] });
                }
                return startIdx;
            };
            const addProp = (index, type, offset) => { if (segments[index]) segments[index].obs.push({ type: type, x: offset }); };

            // Layout da Pista
            addRoad(50, 0, 0);
            addRoad(40, 1.5, 0);
            addRoad(20, -1.5, 0);
            let s1 = addRoad(60, 0, 0); addProp(s1+20, 'cone', -0.5); addProp(s1+40, 'cone', 0.5);
            addRoad(30, 2.5, 0);
            addRoad(30, -2.5, 0);
            addRoad(100, 0, 0);

            trackLength = segments.length * 200;
            
            // Gerar Minimapa
            minimapPoints = [];
            let x = 0, y = 0, dir = -Math.PI/2;
            segments.forEach(seg => {
                dir += seg.curve * 0.002;
                x += Math.cos(dir) * 4; y += Math.sin(dir) * 4;
                minimapPoints.push({ x, y });
            });
        },

        // --- INICIALIZAÇÃO ---
        init: function() {
            this.state = 'LOBBY';
            this.setupUI();
            this.speed = 0; this.pos = 0; this.playerX = 0;
            this.lap = 1; this.nitro = 100;
            this.isReady = false;
            
            // Multiplayer Init
            if (window.DB) {
                this.dbRef = window.DB.ref('rooms/' + this.roomId);
                
                // Entrar na sala
                this.dbRef.child('players/' + window.System.playerId).set({
                    name: 'Player',
                    charId: 0,
                    ready: false,
                    pos: 0,
                    x: 0,
                    lap: 1,
                    timestamp: firebase.database.ServerValue.TIMESTAMP
                });

                // Ouvir jogadores
                this.dbRef.child('players').on('value', (snap) => {
                    const data = snap.val();
                    if (!data) return;
                    
                    this.rivals = Object.keys(data)
                        .filter(id => id !== window.System.playerId)
                        .map(id => ({
                            id: id,
                            ...data[id],
                            isRemote: true,
                            speed: 0 // Velocidade interpolada visualmente
                        }));

                    // Verificar se todos estão prontos (Simples: se tem >1 jogador e todos ready)
                    const allIds = Object.keys(data);
                    const allReady = allIds.every(id => data[id].ready);
                    if (this.state === 'WAITING' && allReady && allIds.length > 1) {
                        this.startRace(data[allIds[0]].trackId || 0); // O primeiro define a pista
                    }
                });
            } else {
                window.System.msg("MODO OFFLINE");
                // Bots Falsos
                this.rivals = [
                    { id: 'bot1', name: 'Luigi', color: '#2ecc71', pos: 500, x: -0.5, lap: 1, isBot: true },
                    { id: 'bot2', name: 'Bowser', color: '#f39c12', pos: 200, x: 0.5, lap: 1, isBot: true }
                ];
            }
        },

        setupUI: function() {
            // Botão Nitro (Só aparece na corrida, mas criamos agora)
            const oldBtn = document.getElementById('nitro-btn-kart');
            if(oldBtn) oldBtn.remove();
            nitroBtn = document.createElement('div');
            nitroBtn.id = 'nitro-btn-kart';
            nitroBtn.innerHTML = "NITRO";
            Object.assign(nitroBtn.style, {
                position: 'absolute', top: '40%', right: '20px', width: '80px', height: '80px',
                borderRadius: '50%', background: 'radial-gradient(#ffaa00, #cc5500)', border: '4px solid white',
                display: 'none', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold', zIndex: 100
            });
            nitroBtn.onmousedown = () => { if(Logic.nitro > 5) Logic.turboLock = !Logic.turboLock; };
            document.getElementById('game-ui').appendChild(nitroBtn);

            // INPUTS DE MOUSE PARA O LOBBY (Simples e funcional)
            window.System.canvas.onclick = (e) => {
                if (this.state !== 'LOBBY') return;
                const rect = window.System.canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const w = window.System.canvas.width;
                const h = window.System.canvas.height;

                // Áreas de Clique (Hardcoded para layout responsivo)
                if (y > h * 0.7) {
                    // Botão Start/Ready
                    this.toggleReady();
                } else if (y < h * 0.3) {
                    // Clicar no topo troca personagem
                    this.selectedChar = (this.selectedChar + 1) % CHARACTERS.length;
                    window.Sfx.hover();
                    this.syncLobby();
                } else {
                    // Clicar no meio troca pista
                    this.selectedTrack = (this.selectedTrack + 1) % TRACKS.length;
                    window.Sfx.hover();
                }
            };
        },

        toggleReady: function() {
            if (this.state !== 'LOBBY') return;
            this.isReady = !this.isReady;
            window.Sfx.click();
            
            if (this.isReady) {
                this.state = 'WAITING';
                window.System.msg("AGUARDANDO OPONENTES...");
            } else {
                this.state = 'LOBBY';
            }
            this.syncLobby();

            // OFFLINE BYPASS
            if (!window.DB) {
                setTimeout(() => this.startRace(this.selectedTrack), 1000);
            }
        },

        syncLobby: function() {
            if (this.dbRef) {
                this.dbRef.child('players/' + window.System.playerId).update({
                    charId: this.selectedChar,
                    trackId: this.selectedTrack, // Voto de pista
                    ready: this.isReady,
                    color: CHARACTERS[this.selectedChar].color
                });
            }
        },

        startRace: function(trackId) {
            this.state = 'RACE';
            this.buildTrack(trackId);
            nitroBtn.style.display = 'flex';
            window.System.msg("LARGADA!");
            window.Sfx.play(600, 'square', 0.5, 0.2);
        },

        cleanup: function() {
            // Remove o jogador da sala ao sair
            if (this.dbRef) {
                this.dbRef.child('players/' + window.System.playerId).remove();
                this.dbRef.off();
            }
            if (nitroBtn) nitroBtn.remove();
            window.System.canvas.onclick = null;
        },

        // --- LOOP PRINCIPAL ---
        update: function(ctx, w, h, pose) {
            // LOBBY RENDER
            if (this.state === 'LOBBY' || this.state === 'WAITING') {
                this.renderLobby(ctx, w, h);
                return;
            }

            // RACE LOGIC
            const charStats = CHARACTERS[this.selectedChar];
            const MAX_SPEED = 230 * charStats.speedInfo;
            const STEER_POWER = 0.18 * charStats.turnInfo;

            // 1. INPUT (MoveNet)
            let detected = false;
            if (pose && pose.keypoints) {
                const lw = pose.keypoints.find(k => k.name === 'left_wrist');
                const rw = pose.keypoints.find(k => k.name === 'right_wrist');
                if (lw && rw && lw.score > 0.3 && rw.score > 0.3) {
                    const p1 = window.Gfx.map(lw, w, h);
                    const p2 = window.Gfx.map(rw, w, h);
                    
                    // Direção
                    const dx = p2.x - p1.x; const dy = p2.y - p1.y;
                    const angle = Math.atan2(dy, dx);
                    let target = 0;
                    if (Math.abs(angle) > 0.05) target = angle * 2.0;
                    this.steer += (target - this.steer) * 0.2; // Suavização
                    
                    // Visual Volante
                    this.virtualWheel = { x: (p1.x+p2.x)/2, y: (p1.y+p2.y)/2, r: Math.hypot(dx,dy)/2, opacity: 1 };
                    detected = true;
                }
            }
            if (!detected) {
                this.steer *= 0.9;
                this.virtualWheel.opacity *= 0.9;
            }

            // 2. FÍSICA
            // Aceleração automática se detectou mãos ou turbo ligado
            const accel = (detected || this.turboLock) ? 1 : 0;
            
            let topSpeed = MAX_SPEED;
            if (this.turboLock && this.nitro > 0) { topSpeed *= 1.5; this.nitro -= 0.5; }
            else { this.turboLock = false; this.nitro = Math.min(100, this.nitro + 0.1); }

            if (accel) this.speed += (topSpeed - this.speed) * 0.05;
            else this.speed *= 0.98;

            // Curvas e Offroad
            const segIdx = Math.floor(this.pos / 200);
            const seg = getSegment(segIdx);
            
            this.playerX += (this.steer * STEER_POWER * (this.speed/MAX_SPEED));
            this.playerX -= (seg.curve * (this.speed/MAX_SPEED) * 0.05); // Força centrífuga

            if (Math.abs(this.playerX) > 2.0) this.speed *= 0.9; // Offroad
            
            // Limites e Colisões
            if (this.playerX < -3) { this.playerX = -3; this.speed *= 0.8; }
            if (this.playerX > 3) { this.playerX = 3; this.speed *= 0.8; }
            
            // Colisão com Objetos
            seg.obs.forEach(o => {
                if (Math.abs(this.playerX - o.x) < 0.5) {
                    this.speed *= 0.5;
                    window.Sfx.crash();
                    window.Gfx.shake(10);
                    o.x = 999; // Remove obstáculo batido
                }
            });

            // Movimento
            this.pos += this.speed;
            while (this.pos >= trackLength) {
                this.pos -= trackLength;
                this.lap++;
                if (this.lap > this.totalLaps) {
                    this.state = 'FINISHED';
                    window.System.gameOver(Math.floor(this.score));
                }
            }

            // 3. MULTIPLAYER SYNC (Envio)
            if (window.DB && Date.now() - this.lastSync > 100) { // 10 updates por seg
                this.lastSync = Date.now();
                this.dbRef.child('players/' + window.System.playerId).update({
                    pos: Math.floor(this.pos),
                    x: this.playerX,
                    lap: this.lap
                });
            }

            // 4. CÁLCULO DE POSIÇÃO (Rank)
            let myDist = this.pos + (this.lap * trackLength);
            let better = 0;
            this.rivals.forEach(r => {
                // Se for bot, move ele
                if (r.isBot) {
                    r.speed = (r.speed || 0) + (MAX_SPEED*0.9 - (r.speed||0))*0.05;
                    r.pos += r.speed;
                    if (r.pos >= trackLength) { r.pos -= trackLength; r.lap++; }
                }
                
                let rDist = r.pos + (r.lap * trackLength);
                if (rDist > myDist) better++;
            });
            this.rank = 1 + better;
            this.score += this.speed * 0.01;

            // 5. RENDERIZAÇÃO
            this.renderWorld(ctx, w, h);
            this.renderUI(ctx, w, h);

            return Math.floor(this.score);
        },

        renderLobby: function(ctx, w, h) {
            // Fundo
            ctx.fillStyle = "#2c3e50";
            ctx.fillRect(0, 0, w, h);
            
            // Texto Título
            ctx.fillStyle = "white";
            ctx.textAlign = "center";
            ctx.font = "bold 40px 'Russo One'";
            ctx.fillText("LOBBY DA CORRIDA", w/2, 60);

            // Seleção de Personagem
            const c = CHARACTERS[this.selectedChar];
            ctx.fillStyle = c.color;
            ctx.beginPath(); ctx.arc(w/2, h*0.3, 60, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = "white";
            ctx.font = "bold 30px sans-serif";
            ctx.fillText(c.name, w/2, h*0.3 + 100);
            ctx.font = "20px sans-serif";
            ctx.fillText(c.desc, w/2, h*0.3 + 130);
            ctx.fillText("◄ TOQUE PARA MUDAR ►", w/2, h*0.3 - 80);

            // Seleção de Pista
            const t = TRACKS[this.selectedTrack];
            ctx.fillStyle = "#34495e";
            ctx.fillRect(w/2 - 150, h*0.55, 300, 60);
            ctx.fillStyle = "#ecf0f1";
            ctx.fillText("PISTA: " + t.name, w/2, h*0.55 + 40);

            // Botão Start
            const btnColor = this.state === 'WAITING' ? "#e67e22" : "#27ae60";
            const btnText = this.state === 'WAITING' ? "AGUARDANDO..." : "PRONTO PARA CORRER";
            
            ctx.fillStyle = btnColor;
            ctx.fillRect(w/2 - 150, h*0.8, 300, 70);
            ctx.fillStyle = "white";
            ctx.font = "bold 25px 'Russo One'";
            ctx.fillText(btnText, w/2, h*0.8 + 45);

            // Lista de Jogadores na sala
            ctx.textAlign = "left";
            ctx.font = "14px monospace";
            ctx.fillStyle = "#bdc3c7";
            ctx.fillText(`Jogadores na sala: ${this.rivals.length + 1}`, 20, h - 20);
        },

        renderWorld: function(ctx, w, h) {
            const trk = TRACKS[this.selectedTrack];
            const horizon = h * 0.4;
            
            // Céu
            const skyCols = [['#3498db', '#ecf0f1'], ['#e67e22', '#f1c40f']]; // Dia, Tarde
            const g = ctx.createLinearGradient(0,0,0,horizon);
            g.addColorStop(0, skyCols[trk.sky][0]); g.addColorStop(1, skyCols[trk.sky][1]);
            ctx.fillStyle = g; ctx.fillRect(0,0,w,horizon);

            // Chão (Simples)
            const groundCols = { 'grass': '#27ae60', 'sand': '#e67e22', 'snow': '#bdc3c7' };
            ctx.fillStyle = groundCols[trk.ground]; ctx.fillRect(0, horizon, w, h-horizon);

            // Desenhar Pista (Algoritmo Pseudo-3D simplificado)
            let dx = 0, ddx = 0;
            let camX = this.playerX * w * 0.5;
            let startPos = Math.floor(this.pos / 200);

            for (let n = 0; n < 80; n++) {
                const seg = getSegment(startPos + n);
                dx += ddx; ddx += seg.curve;
                
                const scale = 1 / (1 + n * 0.1);
                const screenY = horizon + (h/2 * scale);
                const screenW = w * 2 * scale;
                const screenX = w/2 - (camX * scale) - (dx * scale * w/2);
                
                // Desenhar segmento
                const nextScale = 1 / (1 + (n+1) * 0.1);
                const nextY = horizon + (h/2 * nextScale);
                if (nextY >= screenY) continue;

                const col = seg.color === 'dark' ? '#7f8c8d' : '#95a5a6';
                ctx.fillStyle = col;
                ctx.fillRect(screenX - screenW/2, nextY, screenW, screenY-nextY);

                // Bordas
                ctx.fillStyle = seg.color === 'dark' ? 'red' : 'white';
                ctx.fillRect(screenX - screenW/2 - screenW*0.1, nextY, screenW*0.1, screenY-nextY);
                ctx.fillRect(screenX + screenW/2, nextY, screenW*0.1, screenY-nextY);
            }

            // Desenhar Rivais
            this.rivals.forEach(r => {
                // Lógica simplificada de projeção para rivais
                let relPos = r.pos - this.pos;
                if (relPos < -trackLength/2) relPos += trackLength;
                if (relPos > trackLength/2) relPos -= trackLength;

                if (relPos > 100 && relPos < 4000) { // Só desenha se estiver à frente e perto
                    const scale = 200 / relPos;
                    const rX = w/2 + (r.x * w/2 * scale) - (this.playerX * w/2 * scale); // Parallax simples
                    const rY = horizon + (h/2 * scale);
                    const size = 100 * scale;

                    ctx.fillStyle = r.color || 'red';
                    ctx.fillRect(rX - size/2, rY - size, size, size*0.6);
                    ctx.fillStyle = 'black';
                    ctx.textAlign = 'center';
                    ctx.font = `${Math.floor(size*0.4)}px Arial`;
                    ctx.fillText(r.name || 'P2', rX, rY - size - 5);
                }
            });

            // Desenhar Jogador
            this.drawPlayer(ctx, w, h);
        },

        drawPlayer: function(ctx, w, h) {
            const cx = w/2;
            const cy = h * 0.85;
            const size = w * 0.15;
            const c = CHARACTERS[this.selectedChar];

            // Sombra
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.beginPath(); ctx.ellipse(cx, cy+size*0.4, size, size*0.3, 0, 0, Math.PI*2); ctx.fill();

            // Kart Corpo
            ctx.fillStyle = c.color;
            ctx.beginPath();
            ctx.moveTo(cx - size*0.5, cy - size*0.2);
            ctx.lineTo(cx + size*0.5, cy - size*0.2);
            ctx.lineTo(cx + size*0.4, cy + size*0.4);
            ctx.lineTo(cx - size*0.4, cy + size*0.4);
            ctx.fill();

            // Volante Virtual (Feedback Visual)
            if (this.virtualWheel.opacity > 0.1) {
                ctx.globalAlpha = this.virtualWheel.opacity;
                ctx.strokeStyle = "cyan";
                ctx.lineWidth = 5;
                ctx.beginPath();
                ctx.arc(this.virtualWheel.x, this.virtualWheel.y, this.virtualWheel.r, 0, Math.PI*2);
                ctx.stroke();
                ctx.globalAlpha = 1;
            }
        },

        renderUI: function(ctx, w, h) {
            // HUD
            ctx.fillStyle = "white";
            ctx.font = "bold 30px 'Russo One'";
            ctx.textAlign = "left";
            ctx.fillText(`POS: ${this.rank}/${this.rivals.length+1}`, 20, 50);
            ctx.fillText(`VOLTA: ${this.lap}/${this.totalLaps}`, 20, 90);
            
            // Velocidade
            const speedPerc = this.speed / 250;
            ctx.fillStyle = "black";
            ctx.fillRect(w-120, h-40, 100, 20);
            ctx.fillStyle = this.turboLock ? "cyan" : "lime";
            ctx.fillRect(w-120, h-40, 100 * speedPerc, 20);
        }
    };

    if(window.System) {
        window.System.registerGame('drive', 'Otto Kart GP', '🏎️', Logic, {
            camOpacity: 0.2
        });
    }
})();
