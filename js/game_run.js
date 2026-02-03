// =============================================================================
// LÓGICA DO JOGO: OLYMPIC TRACK RUN (MARIO ATHLETICS EDITION)
// ARQUITETO: PARCEIRO DE PROGRAMAÇÃO
// =============================================================================

(function() {
    // --- CONFIGURAÇÕES ---
    const CONF = {
        SPEED: 26,               // Velocidade de corrida
        HORIZON_Y: 0.40,         // Altura do horizonte
        GOAL_DISTANCE: 10000,    // Distância da corrida (Metros virtuais)
        LANE_WIDTH: 200,         // Largura da pista
        
        COLORS: {
            SKY: ['#4fc3f7', '#e1f5fe'], // Céu diurno
            GRASS: '#4caf50',            // Gramado central
            TRACK: '#c0392b',            // Pista Vermelha (Tartan)
            LINES: '#ecf0f1',            // Linhas brancas
            CROWD: ['#e74c3c', '#f1c40f', '#3498db', '#ffffff'] // Cores da torcida
        }
    };

    let crowd = []; // Partículas da torcida

    const Logic = {
        // Estado de Jogo
        distance: 0,
        lane: 0,            // -1, 0, 1
        currentLaneX: 0,    // Visual suavizado
        action: 'run',      // Ação atual
        state: 'calibrate', // calibrate -> play -> finished
        rank: 1,
        
        // Calibração
        baseNoseY: 0,
        calibSamples: [],
        
        // Objetos
        obs: [],
        hitTimer: 0,
        
        // Multiplayer
        roomId: 'olympic_run_v1',
        isOnline: false,
        rivals: [],
        dbRef: null,
        lastSync: 0,

        // --- INICIALIZAÇÃO ---
        init: function() { 
            this.distance = 0;
            this.lane = 0;
            this.action = 'run';
            this.obs = [];
            this.hitTimer = 0;
            this.state = 'calibrate';
            this.calibSamples = [];
            this.rank = 1;
            
            // Gerar torcida estática
            crowd = [];
            for(let i=0; i<300; i++) {
                crowd.push({
                    x: Math.random() * 2000,
                    y: Math.random() * 100,
                    c: CONF.COLORS.CROWD[Math.floor(Math.random() * CONF.COLORS.CROWD.length)]
                });
            }

            this.resetNet();
            window.System.msg("CALIBRANDO..."); 
        },

        resetNet: function() {
            this.isOnline = false;
            if(window.DB && window.System.playerId) {
                try { window.DB.ref(`rooms/${this.roomId}/players/${window.System.playerId}`).remove(); } catch(e){}
            }
        },

        enableOnline: function() {
            if(!window.DB) return;
            this.isOnline = true;
            this.dbRef = window.DB.ref(`rooms/${this.roomId}`);
            
            // Entra na sala
            this.dbRef.child(`players/${window.System.playerId}`).set({
                distance: 0, lane: 0, action: 'run', finished: false,
                lastSeen: firebase.database.ServerValue.TIMESTAMP
            });

            // Escuta rivais
            this.dbRef.child('players').on('value', snap => {
                const data = snap.val(); if(!data) return;
                this.rivals = Object.keys(data)
                    .filter(id => id !== window.System.playerId)
                    .map(id => ({ id, ...data[id] }));
            });
        },

        // --- LOOP PRINCIPAL ---
        update: function(ctx, w, h, pose) {
            const cx = w / 2;
            const horizon = h * CONF.HORIZON_Y;

            // 1. INPUT E CALIBRAÇÃO
            if(pose) {
                const n = pose.keypoints.find(k => k.name === 'nose');
                // Mapeamento: (1 - x) para espelhar corretamente
                const mapPoint = (pt) => ({ x: (1 - pt.x/640)*w, y: (pt.y/480)*h });

                if(n && n.score > 0.4) {
                    const np = mapPoint(n);

                    if(this.state === 'calibrate') {
                        this.calibSamples.push(np.y);
                        this.drawCalibration(ctx, w, h, cx);
                        
                        if(this.calibSamples.length > 60) {
                            // Média da altura para definir o "zero"
                            this.baseNoseY = this.calibSamples.reduce((a,b)=>a+b,0)/this.calibSamples.length;
                            this.state = 'play';
                            window.System.msg("LARGADA!");
                            window.Sfx.play(600, 'square', 0.5, 0.2);
                            if(window.DB) this.enableOnline();
                        }
                        return 0;
                    } 
                    else if (this.state === 'play') {
                        // Faixas (Direita na vida real = Direita na tela)
                        if (np.x < w * 0.35) this.lane = -1;
                        else if (np.x > w * 0.65) this.lane = 1;
                        else this.lane = 0;

                        // Pulo / Agachamento (Zona Morta de 40px)
                        const diff = np.y - this.baseNoseY;
                        if (diff < -40) this.action = 'jump';
                        else if (diff > 40) this.action = 'crouch';
                        else this.action = 'run';
                    }
                }
            }

            // Suavização visual da troca de faixa
            const targetX = this.lane * (w * 0.25);
            this.currentLaneX += (targetX - this.currentLaneX) * 0.15;

            // 2. LÓGICA DE JOGO
            if (this.state === 'play') {
                this.distance += CONF.SPEED;
                
                // Spawn Obstáculos
                if (this.distance % 800 < CONF.SPEED * 1.5) { // Aprox a cada intervalo
                    const lane = Math.floor(Math.random() * 3) - 1;
                    const type = Math.random() > 0.5 ? 'hurdle' : 'block';
                    this.obs.push({ z: 2000, lane, type, passed: false });
                }

                // Vitória
                if (this.distance >= CONF.GOAL_DISTANCE) {
                    this.state = 'finished';
                    window.System.gameOver(`CHEGADA! POSIÇÃO: ${this.rank}º`);
                    if(this.isOnline) this.dbRef.child(`players/${window.System.playerId}`).update({finished:true});
                }

                // Ranking
                if (this.isOnline) {
                    let rk = 1;
                    this.rivals.forEach(r => { if(r.distance > this.distance) rk++; });
                    this.rank = rk;
                }
            }

            // 3. RENDERIZAÇÃO
            this.drawStadium(ctx, w, h, horizon);
            this.drawTrack(ctx, w, h, cx, horizon);
            this.drawObstacles(ctx, w, h, cx, horizon);

            // Rivais (Fantasmas)
            this.rivals.forEach(r => {
                const rx = (r.lane||0) * (w * 0.25);
                // Interpolação simples
                if(!r.vx) r.vx = rx;
                r.vx += (rx - r.vx) * 0.1;

                let ry = h * 0.85;
                if(r.action === 'jump') ry -= h * 0.2;
                
                ctx.save(); ctx.globalAlpha = 0.5;
                // Rival em cinza ou cor diferente
                this.drawCharacter(ctx, cx + r.vx, ry, w, r.action, false); 
                // Etiqueta
                ctx.fillStyle = "#fff"; ctx.font = "12px Arial"; ctx.textAlign = "center";
                ctx.fillText(`P${r.id.substr(0,3)}`, cx + r.vx, ry - (w*0.15));
                ctx.restore();
            });

            // Jogador (Mario)
            if (this.state !== 'finished') {
                let py = h * 0.85;
                if(this.action === 'jump') py -= h * 0.2;
                if(this.action === 'crouch') py += h * 0.05;

                // Piscar se atingido
                if (this.hitTimer === 0 || Math.floor(Date.now()/100)%2===0) {
                    this.drawCharacter(ctx, cx + this.currentLaneX, py, w, this.action, true);
                }
            }

            // Dano
            if(this.hitTimer > 0) {
                this.hitTimer--;
                ctx.fillStyle = 'rgba(255,0,0,0.3)'; ctx.fillRect(0,0,w,h);
            }

            // HUD
            this.drawHUD(ctx, w, h);

            // Sync
            if(this.isOnline && this.state === 'play') {
                if(Date.now() - this.lastSync > 100) {
                    this.lastSync = Date.now();
                    this.dbRef.child(`players/${window.System.playerId}`).update({
                        distance: this.distance, lane: this.lane, action: this.action,
                        lastSeen: firebase.database.ServerValue.TIMESTAMP
                    });
                }
            }

            return Math.floor(this.distance/10);
        },

        // --- FUNÇÕES DE DESENHO ---

        drawStadium: function(ctx, w, h, horizon) {
            // Céu
            const grad = ctx.createLinearGradient(0,0,0,horizon);
            grad.addColorStop(0, CONF.COLORS.SKY[0]); grad.addColorStop(1, CONF.COLORS.SKY[1]);
            ctx.fillStyle = grad; ctx.fillRect(0,0,w,horizon);

            // Arquibancada (Fundo)
            ctx.fillStyle = "#555"; 
            ctx.fillRect(0, horizon - 100, w, 100); // Estrutura
            
            // Torcida (Pontos coloridos)
            crowd.forEach(p => {
                // Efeito de movimento lateral da torcida
                const px = (p.x - (this.distance * 0.5)) % w;
                const finalX = px < 0 ? px + w : px;
                
                ctx.fillStyle = p.c;
                const size = 3 + Math.random()*3;
                if(Math.random()>0.5) ctx.fillRect(finalX, horizon - 10 - p.y, size, size);
            });

            // Gramado Central
            ctx.fillStyle = CONF.COLORS.GRASS;
            ctx.fillRect(0, horizon, w, h-horizon);
        },

        drawTrack: function(ctx, w, h, cx, horizon) {
            ctx.save(); ctx.translate(cx, horizon);
            
            const topW = w * 0.05;
            const botW = w * 1.5;
            const H = h - horizon;

            // Pista Vermelha
            ctx.fillStyle = CONF.COLORS.TRACK;
            ctx.beginPath();
            ctx.moveTo(-topW, 0); ctx.lineTo(topW, 0);
            ctx.lineTo(botW, H); ctx.lineTo(-botW, H);
            ctx.fill();

            // Linhas das Raias
            ctx.strokeStyle = CONF.COLORS.LINES; ctx.lineWidth = 4;
            const lanes = [-0.33, 0.33]; // Divide em 3
            lanes.forEach(l => {
                ctx.beginPath();
                ctx.moveTo(l * topW, 0);
                ctx.lineTo(l * botW, H);
                ctx.stroke();
            });

            // Bordas da Pista
            ctx.strokeStyle = "#fff"; ctx.lineWidth = 6;
            ctx.beginPath(); ctx.moveTo(-topW, 0); ctx.lineTo(-botW, H); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(topW, 0); ctx.lineTo(botW, H); ctx.stroke();

            ctx.restore();
        },

        drawObstacles: function(ctx, w, h, cx, horizon) {
            const H = h - horizon;
            const topW = w * 0.05;
            const botW = w * 1.5;

            // Loop Reverso para Z-Index
            for(let i = this.obs.length - 1; i >= 0; i--) {
                let o = this.obs[i];
                o.z -= CONF.SPEED;

                if (o.z < -200) { this.obs.splice(i, 1); continue; }

                const scale = 300 / (300 + o.z);
                if(scale <= 0) continue;

                const screenY = horizon + (H * scale);
                const size = (w * 0.2) * scale;
                const currentW = topW + (botW - topW) * scale;
                const laneSpread = currentW * 0.66;
                const sx = cx + (o.lane * laneSpread);

                // Desenha Obstáculo
                if (o.type === 'hurdle') {
                    // BARREIRA DE ATLETISMO (Pular)
                    const hH = size * 0.6;
                    // Pés
                    ctx.fillStyle = "#ccc";
                    ctx.fillRect(sx - size/2, screenY, 10*scale, -hH);
                    ctx.fillRect(sx + size/2 - 10*scale, screenY, 10*scale, -hH);
                    // Barra superior
                    ctx.fillStyle = "#fff";
                    ctx.fillRect(sx - size/2 - 5*scale, screenY - hH, size + 10*scale, 20*scale);
                    // Faixas vermelhas na barra
                    ctx.fillStyle = "#f00";
                    ctx.fillRect(sx - size/4, screenY - hH, 20*scale, 20*scale);
                    ctx.fillRect(sx + size/4 - 20*scale, screenY - hH, 20*scale, 20*scale);
                } else {
                    // CAIXA ALTA (Agachar)
                    const bY = screenY - (size * 1.8);
                    ctx.fillStyle = "#f39c12";
                    ctx.fillRect(sx - size/2, bY, size, size);
                    ctx.strokeStyle = "#d35400"; ctx.lineWidth = 3;
                    ctx.strokeRect(sx - size/2, bY, size, size);
                    ctx.fillStyle = "#000"; ctx.textAlign="center"; ctx.font=`bold ${size*0.5}px Arial`;
                    ctx.fillText("?", sx, bY + size*0.7);
                    
                    // Sombra
                    ctx.fillStyle = "rgba(0,0,0,0.3)";
                    ctx.beginPath(); ctx.ellipse(sx, screenY, size/2, size/5, 0, 0, Math.PI*2); ctx.fill();
                }

                // COLISÃO
                if (o.z < 60 && o.z > -60 && this.state === 'play' && o.lane === this.lane) {
                    let hit = false;
                    if (o.type === 'hurdle' && this.action !== 'jump') hit = true;
                    if (o.type === 'block' && this.action !== 'crouch') hit = true;

                    if (hit) {
                        this.hitTimer = 20;
                        window.Sfx.play(150, 'sawtooth', 0.2, 0.2);
                        this.distance = Math.max(0, this.distance - 250); // Penalidade: Recua
                        window.System.msg("TROPEÇOU!");
                        o.passed = true;
                    }
                }
            }
        },

        drawCharacter: function(ctx, x, y, w, action, isPlayer) {
            const s = w * 0.004; 
            ctx.save(); ctx.translate(x, y); ctx.scale(s, s);

            const shirt = isPlayer ? '#d32f2f' : '#7f8c8d'; // Vermelho vs Cinza
            const overalls = isPlayer ? '#2980b9' : '#95a5a6'; // Azul vs Cinza
            const skin = '#ffccaa';

            // Animação de corrida (Pernas)
            const cycle = (action === 'run') ? Math.sin(Date.now() * 0.015) * 15 : 0;

            // Pernas
            ctx.fillStyle = overalls;
            if (action === 'jump') {
                ctx.fillRect(-18, -10, 15, 25); ctx.fillRect(3, -5, 15, 20); // Encolhidas
            } else {
                ctx.fillRect(-18 + cycle, 0, 15, 35); 
                ctx.fillRect(3 - cycle, 0, 15, 35);
            }

            // Corpo (Costas)
            const bodyY = (action === 'crouch') ? 15 : -35;
            ctx.fillStyle = shirt;
            ctx.beginPath(); ctx.arc(0, bodyY, 28, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = overalls;
            ctx.fillRect(-18, bodyY, 36, 30);
            ctx.beginPath(); ctx.arc(0, bodyY+30, 18, 0, Math.PI, false); ctx.fill();

            // Botões do Macacão
            ctx.fillStyle = "#f1c40f";
            ctx.beginPath(); ctx.arc(-15, bodyY, 4, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.arc(15, bodyY, 4, 0, Math.PI*2); ctx.fill();

            // Cabeça
            const headY = bodyY - 28;
            ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(0, headY, 22, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = "#5d4037"; // Cabelo
            ctx.beginPath(); ctx.arc(0, headY+5, 22, 0, Math.PI, false); ctx.fill();
            ctx.fillStyle = shirt; // Boné
            ctx.beginPath(); ctx.arc(0, headY-5, 24, Math.PI, 0); ctx.fill();

            ctx.restore();
        },

        drawHUD: function(ctx, w, h) {
            // Barra de Progresso
            const barW = w * 0.8;
            const barX = w * 0.1;
            const barY = 50;

            ctx.fillStyle = "rgba(0,0,0,0.6)";
            ctx.fillRect(barX, barY, barW, 15);
            
            // Minha Posição
            const myPct = Math.min(1, this.distance / CONF.GOAL_DISTANCE);
            ctx.fillStyle = "#d32f2f";
            ctx.beginPath(); ctx.arc(barX + barW*myPct, barY+7, 10, 0, Math.PI*2); ctx.fill();
            ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();

            // Rivais
            this.rivals.forEach(r => {
                const rPct = Math.min(1, (r.distance||0) / CONF.GOAL_DISTANCE);
                ctx.fillStyle = "#3498db";
                ctx.beginPath(); ctx.arc(barX + barW*rPct, barY+7, 8, 0, Math.PI*2); ctx.fill();
            });

            // Bandeira Chegada
            ctx.fillStyle = "#fff"; ctx.fillRect(barX + barW, barY-10, 4, 25);
            ctx.fillStyle = "#f1c40f"; ctx.beginPath(); ctx.moveTo(barX+barW, barY-10); ctx.lineTo(barX+barW+15, barY-2); ctx.lineTo(barX+barW, barY+5); ctx.fill();

            // Texto
            ctx.fillStyle = "#fff"; ctx.font = "bold 24px Arial"; ctx.textAlign="left";
            ctx.fillText(`${Math.floor(this.distance)}m`, barX, barY + 40);
            
            if(this.isOnline) {
                ctx.textAlign="right"; ctx.fillStyle = this.rank === 1 ? "#f1c40f" : "#fff";
                ctx.fillText(`${this.rank}º LUGAR`, barX + barW, barY + 40);
            }
        },

        drawCalibration: function(ctx, w, h, cx) {
            ctx.fillStyle = "rgba(0,0,0,0.9)"; ctx.fillRect(0,0,w,h);
            ctx.fillStyle = "#fff"; ctx.font = "bold 30px Arial"; ctx.textAlign = "center";
            ctx.fillText("FIQUE EM PÉ E PARADO", cx, h*0.4);
            
            const pct = this.calibSamples.length / 60;
            ctx.fillStyle = "#2ecc71";
            ctx.fillRect(cx - 150, h*0.5, 300 * pct, 20);
            ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
            ctx.strokeRect(cx - 150, h*0.5, 300, 20);
        }
    };

    window.System.registerGame('run', 'Olympic Run', '🏃', Logic, {camOpacity: 0.3});
})();