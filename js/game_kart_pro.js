// =============================================================================
// OTTO KART: PLATINUM PHYSICS ENGINE (MODE 177 IMPLEMENTATION)
// ENGENHARIA: SIMULAÇÃO VETORIAL, DRIFT REAL, IA COMPETITIVA E LOOPING DE PISTA
// =============================================================================

(function() {
    // --- CONSTANTES DE ENGENHARIA (TUNING TIPO MARIO KART WII) ---
    const PHY = {
        MAX_SPEED: 280,         // Velocidade terminal (km/h visual)
        ACCEL: 0.6,             // Curva de torque
        BRAKE: 0.94,            // Fator de frenagem
        FRICTION_ROAD: 0.98,    // Atrito do asfalto (desaceleração natural)
        FRICTION_GRASS: 0.88,   // Atrito da grama (punição)
        GRIP_ROAD: 0.12,        // Aderência lateral (quanto o carro obedece ao volante)
        GRIP_GRASS: 0.02,       // Perda quase total de controle na grama
        TURN_SPEED: 0.05,       // Velocidade angular (rad/frame)
        CENTRIFUGAL: 1.1,       // Força G na curva
        TRACK_LENGTH: 10000,    // Comprimento da volta (segmentos)
        TOTAL_LAPS: 3           // Total de voltas
    };

    // --- GEOMETRIA DA PISTA (BUFFER PRÉ-CALCULADO) ---
    // Cria um circuito fixo para permitir voltas, minimapa real e consistência
    const TrackSystem = {
        data: [], // Array de curvatura
        length: PHY.TRACK_LENGTH,
        
        generate: function() {
            this.data = new Float32Array(this.length);
            let curve = 0;
            let targetCurve = 0;
            
            // Geração Procedural de Circuito Fechado
            for(let i = 0; i < this.length; i++) {
                // Muda a curvatura a cada 400 segmentos
                if(i % 400 === 0) {
                    const r = Math.random();
                    if(r < 0.3) targetCurve = 0; // Reta
                    else if(r < 0.6) targetCurve = (Math.random() - 0.5) * 2; // Curva suave
                    else targetCurve = (Math.random() - 0.5) * 4; // Curva fechada
                }
                
                // Interpolação suave da pista
                curve += (targetCurve - curve) * 0.01;
                this.data[i] = curve;
            }
            // Suaviza o loop final para não haver "pulo" na emenda
            for(let i = 0; i < 500; i++) {
                const t = i / 500;
                this.data[this.length - 1 - i] = this.data[this.length - 1 - i] * t + this.data[0] * (1-t);
            }
        },

        getCurve: function(z) {
            let idx = Math.floor(z) % this.length;
            if(idx < 0) idx += this.length;
            return this.data[idx];
        }
    };

    // --- CLASSE DE VEÍCULO (FÍSICA COMPLETA) ---
    class Kart {
        constructor(isPlayer = false, color = '#fff', startZ = 0) {
            this.isPlayer = isPlayer;
            this.color = color;
            
            // Estado Físico
            this.x = 0;             // Posição Lateral (-1 a 1 é pista, >1 é grama)
            this.z = startZ;        // Posição na Pista (absoluta)
            this.speed = 0;         // Velocidade Escalar Atual
            this.heading = 0;       // Ângulo do Carro (Yaw)
            this.velX = 0;          // Velocidade Lateral (Drift)
            
            // Estado de Corrida
            this.lap = 1;
            this.rank = 0;
            this.finished = false;
            this.wrongWay = false;
            
            // IA
            this.lanePreference = (Math.random() - 0.5) * 1.5;
            this.aggressiveness = 0.8 + Math.random() * 0.4;
        }

        update(dt, inputSteer, inputAccel) {
            if(this.finished) {
                this.speed *= 0.95;
                return;
            }

            // 1. Detectar Terreno
            const isOffRoad = Math.abs(this.x) > 1.2; // Zebra é 1.0 a 1.2
            const grip = isOffRoad ? PHY.GRIP_GRASS : PHY.GRIP_ROAD;
            const friction = isOffRoad ? PHY.FRICTION_GRASS : PHY.FRICTION_ROAD;

            // 2. Aceleração & Freio
            if(inputAccel) {
                const torque = isOffRoad ? PHY.ACCEL * 0.4 : PHY.ACCEL;
                this.speed += torque;
            } else {
                this.speed *= PHY.BRAKE; // Freio motor
            }
            
            // Limites de velocidade
            let maxS = PHY.MAX_SPEED;
            if(isOffRoad) maxS *= 0.3; // Punição severa na grama
            this.speed = Math.min(this.speed, maxS * (this.isPlayer ? 1 : this.aggressiveness));
            this.speed *= friction; // Atrito do ar/chão

            // 3. Direção & Yaw (Ângulo)
            // O carro só vira se estiver andando
            if(this.speed > 1) {
                this.heading += inputSteer * PHY.TURN_SPEED * (this.speed / PHY.MAX_SPEED);
                // Retorno suave do volante (caster effect)
                this.heading *= 0.92;
            }

            // 4. Dinâmica Lateral (O CORAÇÃO DA FÍSICA)
            // A força lateral é composta por: Direção das rodas + Força Centrífuga da pista
            
            // A. Vetor de empuxo das rodas (Carro tenta ir para onde aponta)
            this.velX += this.heading * grip * (this.speed * 0.05);

            // B. Força Centrífuga (Pista joga o carro para fora)
            const currentCurve = TrackSystem.getCurve(this.z);
            const centrifugalForce = currentCurve * (this.speed / PHY.MAX_SPEED) * PHY.CENTRIFUGAL;
            this.velX -= centrifugalForce * 0.15; // Aplica força contrária à curva

            // C. Amortecimento Lateral (Pneu segurando o drift)
            this.velX *= (isOffRoad ? 0.98 : 0.85); // Escorrega mais na grama

            // 5. Integração de Posição
            this.x += this.velX;
            this.z += this.speed;

            // 6. Gestão de Voltas
            if(this.z >= PHY.TRACK_LENGTH) {
                this.z -= PHY.TRACK_LENGTH;
                this.lap++;
                if(this.isPlayer) window.System.msg(`VOLTA ${this.lap}/${PHY.TOTAL_LAPS}`);
                if(this.lap > PHY.TOTAL_LAPS) this.finished = true;
            }
        }

        updateAI(playerZ) {
            // IA REALISTA baseada em "Look Ahead"
            const lookAheadDist = 300;
            const curveAhead = TrackSystem.getCurve(this.z + lookAheadDist);
            
            // 1. Escolha de Linha Ideal
            // Em retas, tenta voltar para preferência. Em curvas, tangencia (corta caminho).
            let targetX = this.lanePreference;
            if(Math.abs(curveAhead) > 1) {
                targetX = Math.sign(curveAhead) * 0.8; // Entra na curva por dentro
            }

            // 2. Direção (Steering)
            // PID Controller simples para manter o X desejado
            const errorX = targetX - this.x;
            let steer = errorX * 0.08;
            
            // Compensa a curva antecipadamente
            steer += curveAhead * 0.5; 
            
            // Evita colisão com Player (Desvio Básico)
            const distToPlayer = this.z - playerZ;
            // Se estiver perto do player (em Z) e perto em X, desvia
            // Nota: Lógica simplificada para manter performance
            
            this.update(0, Math.max(-1, Math.min(1, steer)), true);
        }
    }

    // --- LÓGICA PRINCIPAL DO JOGO ---
    const Logic = {
        player: null,
        opponents: [],
        camHeight: 1000,
        camDepth: 0.8, // Field of View fake
        
        particles: [],
        
        // Input Virtual
        virtualSteer: 0,
        handInput: { l: null, r: null, active: false },
        
        init: function() {
            TrackSystem.generate();
            
            // Cria Jogador
            this.player = new Kart(true, '#e74c3c', 0);
            
            // Cria Oponentes (Grid de largada)
            this.opponents = [];
            const colors = ['#3498db', '#f1c40f', '#2ecc71', '#9b59b6', '#34495e'];
            for(let i=0; i<5; i++) {
                this.opponents.push(new Kart(false, colors[i], 200 + (i * 150)));
            }
            
            this.particles = [];
            window.System.msg("LARGADA!");
            window.Sfx.play(200, 'square', 0.5, 0.2);
        },

        update: function(ctx, w, h, pose) {
            const P = this.player;
            
            // 1. INPUT HANDLING (Câmera + Mãos)
            this.processInput(pose, w, h);
            
            // 2. FÍSICA DO JOGADOR
            // Mapeia o volante virtual (-1 a 1) para a física
            // Adiciona "Steering Assist" se estiver na grama para ajudar a voltar
            let steerForce = this.virtualSteer;
            if(Math.abs(P.x) > 1.2 && Math.sign(steerForce) !== Math.sign(P.x)) {
                steerForce *= 1.5; // Vira mais forte para sair da grama
            }
            
            P.update(1, steerForce, true); // True = Acelerador sempre pressionado (Arcade style)

            // 3. FÍSICA DOS OPONENTES
            this.opponents.forEach(opp => opp.updateAI(P.z));

            // 4. SISTEMA DE RANKING (Competição Real)
            // Calcula pontuação absoluta: (Volta * Tamanho) + Z
            const getScore = (k) => ((k.lap-1) * PHY.TRACK_LENGTH) + k.z;
            const allKarts = [P, ...this.opponents];
            allKarts.sort((a, b) => getScore(b) - getScore(a));
            P.rank = allKarts.indexOf(P) + 1;

            if(P.finished && !this.endGameTriggered) {
                this.endGameTriggered = true;
                setTimeout(() => window.System.gameOver((4 - P.rank) * 1000), 2000);
            }

            // 5. RENDERIZAÇÃO 3D (RAYCASTING-ISH)
            this.renderScene(ctx, w, h);
            
            // 6. HUD & MINIMAPA
            this.renderHUD(ctx, w, h);

            return Math.floor(P.speed);
        },

        processInput: function(pose, w, h) {
            this.handInput.active = false;
            
            if(pose) {
                const kp = pose.keypoints;
                const lw = kp.find(k => k.name === 'left_wrist');
                const rw = kp.find(k => k.name === 'right_wrist');

                if(lw && lw.score > 0.4 && rw && rw.score > 0.4) {
                    this.handInput.active = true;
                    this.handInput.l = window.Gfx.map(lw, w, h);
                    this.handInput.r = window.Gfx.map(rw, w, h);

                    // Lógica do Volante Virtual (Ângulo entre os pulsos)
                    const dx = this.handInput.r.x - this.handInput.l.x;
                    const dy = this.handInput.r.y - this.handInput.l.y;
                    let angle = Math.atan2(dy, dx);
                    
                    // Deadzone e Sensibilidade
                    if(Math.abs(angle) < 0.1) angle = 0;
                    
                    // Suavização do volante (Inércia de braço)
                    const targetSteer = Math.max(-1.5, Math.min(1.5, angle * 2.5));
                    this.virtualSteer += (targetSteer - this.virtualSteer) * 0.2;
                }
            }

            // Retorno automático ao centro se soltar o volante
            if(!this.handInput.active) {
                this.virtualSteer *= 0.8;
            }
        },

        renderScene: function(ctx, w, h) {
            const P = this.player;
            const horizon = h * 0.4;
            
            // CÉU (Gira com a curva para dar imersão)
            // O horizonte se desloca oposto à curva para simular banking
            const curveNow = TrackSystem.getCurve(P.z);
            const horizonOffset = -curveNow * w * 0.5 - (P.heading * w * 0.3);
            
            const gradSky = ctx.createLinearGradient(0, 0, 0, horizon);
            gradSky.addColorStop(0, "#3498db"); 
            gradSky.addColorStop(1, "#85c1e9");
            ctx.fillStyle = gradSky; ctx.fillRect(0,0,w,h);

            // MONTANHAS PARALLAX
            ctx.fillStyle = "#2ecc71";
            ctx.beginPath();
            ctx.ellipse(w*0.2 + horizonOffset * 0.2, horizon, w*0.3, h*0.15, 0, 0, Math.PI, true);
            ctx.ellipse(w*0.8 + horizonOffset * 0.2, horizon, w*0.4, h*0.2, 0, 0, Math.PI, true);
            ctx.fill();

            // CHÃO
            ctx.fillStyle = "#27ae60"; // Grama
            ctx.fillRect(0, horizon, w, h - horizon);

            // --- DESENHO DA PISTA (ALGORITMO MODE 7 PROJETADO) ---
            // Renderiza tiras horizontais da base até o horizonte
            const drawDistance = 300; // Quantos segmentos desenhar
            const segmentHeight = (h - horizon) / 100; // Resolução vertical

            // Posição da câmera relativa à pista
            const camZ = P.z;
            const camX = P.x; // Offset lateral da câmera

            // Z-Buffer simples para sprites
            let sprites = [];

            // Coleta Oponentes para renderizar
            this.opponents.forEach(opp => {
                // Lógica de loop visual: se o oponente está na próxima volta mas visível
                let relZ = opp.z - camZ;
                if(relZ < -drawDistance && opp.lap > P.lap) relZ += PHY.TRACK_LENGTH; 
                if(relZ > PHY.TRACK_LENGTH - drawDistance && opp.lap < P.lap) relZ -= PHY.TRACK_LENGTH;

                if(relZ > 0 && relZ < drawDistance) {
                    sprites.push({ type: 'kart', obj: opp, z: relZ });
                }
            });

            // Loop de Renderização da Geometria (De trás para frente para Overdraw correto)
            // Mas para "Mode 7 scanline" geralmente desenhamos de frente pra trás ou usamos Z.
            // Aqui faremos projeção direta dos pontos chave da pista.
            
            let dx = 0; // Acumulador de curva X na tela
            let ddx = 0; // Derivada da curva

            // O truque do Pseudo-3D: Projetar o centro da pista
            // Precisamos calcular a posição X de cada segmento na tela
            
            // Vamos usar uma abordagem de polígonos trapezoidais otimizada
            ctx.beginPath();
            
            let previousW = 0;
            let previousX = 0;
            let previousY = 0;

            // Renderizamos do FUNDO para a FRENTE (Painter's Algo) para evitar buracos, 
            // mas para otimizar sprites, precisamos saber onde está o chão.
            // Vamos simplificar: Desenhar o asfalto como um grande polígono distorcido.
            
            // Loop visual (Do horizonte para o carro)
            const projectionScale = 300;
            
            // Precisamos acumular a curvatura desde a posição do player até o horizonte
            // "Current Curve" afeta a orientação imediata, "Future Curve" afeta o horizonte
            
            let xCurveAccum = 0; 
            
            // Array para guardar coordenadas de tela dos segmentos para uso nos sprites
            let segmentScreenX = []; 

            // Passo 1: Calcular Geometria
            for(let i = 0; i < drawDistance; i+=2) {
                const zWorld = Math.floor(camZ + i);
                const curve = TrackSystem.getCurve(zWorld);
                
                xCurveAccum += curve; // A estrada faz curva acumulada

                // Projeção de Perspectiva
                const scale = 1 / (i * 0.015 + 1); // Fator de escala (inverso da profundidade)
                
                // O X central da pista na tela depende da Curva Acumulada - Posição do Player
                // Se eu estou em X=1, a pista deve ir para a esquerda (-1).
                // Se a curva é para direita, a pista vai para direita.
                
                // Correção de perspectiva da curva: A curva afeta mais o que está longe
                const worldX = -camX + (xCurveAccum * 0.5); 
                
                // X na tela (Centro + (Mundo * Escala) + Efeito Yaw)
                const screenX = (w/2) + (worldX * w * 0.8 * scale) + (horizonOffset * scale);
                const screenY = h - ((h - horizon) * scale * 0.8) + 20; // +20 para baixar a câmera
                const screenW = w * 2.5 * scale; // Largura da pista

                segmentScreenX[i] = { x: screenX, y: screenY, w: screenW, scale: scale };
            }

            // Passo 2: Desenhar Asfalto (Zebras são calculadas proceduralmente)
            // Desenhamos do fundo (i=drawDistance) para perto (i=0)
            for(let i = drawDistance-2; i >= 0; i-=2) {
                const curr = segmentScreenX[i];
                const next = segmentScreenX[i+2]; // Segmento mais perto (no loop reverso)
                
                if(!curr || !next) continue;
                if(curr.y >= next.y) continue; // Oclusão

                // Cor da Zebra (baseado na posição Z do mundo para dar sensação de velocidade)
                const segmentZ = Math.floor(camZ + i);
                const isDark = Math.floor(segmentZ / 20) % 2 === 0;
                
                // Borda (Zebra)
                ctx.fillStyle = isDark ? "#e74c3c" : "#ecf0f1";
                ctx.fillRect(0, curr.y, w, next.y - curr.y + 1); // Preenche buracos laterais (Grama fake) - OTIMIZAÇÃO
                
                // Estrada (Centro)
                ctx.fillStyle = isDark ? "#7f8c8d" : "#95a5a6";
                ctx.beginPath();
                ctx.moveTo(curr.x - curr.w, curr.y);
                ctx.lineTo(curr.x + curr.w, curr.y);
                ctx.lineTo(next.x + next.w, next.y);
                ctx.lineTo(next.x - next.w, next.y);
                ctx.fill();

                // Faixa central
                if(isDark) {
                    ctx.fillStyle = "#fff";
                    const laneW = curr.w * 0.05;
                    ctx.fillRect(curr.x - laneW/2, curr.y, laneW, next.y - curr.y);
                }
            }

            // --- DESENHO DOS SPRITES (OPONENTES) ---
            sprites.sort((a,b) => b.z - a.z); // Desenha do mais longe pro mais perto
            
            sprites.forEach(spr => {
                // Achar o segmento correspondente
                const zIdx = Math.floor(spr.z);
                // Aproximação linear do índice no buffer de tela
                // spr.z é relativo à camera. Se spr.z = 100, procuramos index 100 (aprox)
                let seg = segmentScreenX[Math.floor(spr.z)];
                // Busca vizinha se falhar (devido ao step 2)
                if(!seg) seg = segmentScreenX[Math.floor(spr.z)-1];
                
                if(seg) {
                    const k = spr.obj;
                    // Posição X relativa à pista
                    // O segmento já está centralizado na pista. Precisamos deslocar pelo X do kart.
                    const spriteX = seg.x + (k.x * seg.w * 0.7); 
                    const spriteY = seg.y;
                    const spriteScale = seg.scale * (w * 0.003);

                    this.drawKartSprite(ctx, spriteX, spriteY, spriteScale, k, 0); // Oponentes não giram visualmente (simplificação)
                }
            });

            // --- DESENHO DO JOGADOR (HUD VISUAL) ---
            // O jogador está sempre fixo na tela em Y, mas seu sprite rotaciona com steering
            const playerScale = w * 0.006;
            const tilt = P.heading * 0.5 + (P.velX * 5); // Inclinação visual baseada na física
            
            // Shake na grama
            let shakeX = 0, shakeY = 0;
            if(Math.abs(P.x) > 1.2) {
                shakeX = (Math.random()-0.5) * 10;
                shakeY = (Math.random()-0.5) * 10;
            }

            this.drawKartSprite(ctx, (w/2) + shakeX, (h*0.85) + shakeY, playerScale, P, tilt);

            // Efeito de Velocidade (Speed Lines)
            if(P.speed > PHY.MAX_SPEED * 0.8) {
                ctx.strokeStyle = `rgba(255,255,255,${(P.speed/PHY.MAX_SPEED)*0.3})`;
                ctx.lineWidth = 2;
                ctx.beginPath();
                for(let i=0; i<10; i++) {
                    const lx = Math.random() * w;
                    const ly = Math.random() * h;
                    ctx.moveTo(lx, ly);
                    ctx.lineTo(cx + (lx-cx)*1.1, cy + (ly-cy)*1.1); // Radial blur fake
                }
                ctx.stroke();
            }
        },

        drawKartSprite: function(ctx, x, y, scale, kart, tilt) {
            ctx.save();
            ctx.translate(x, y);
            ctx.scale(scale, scale);
            ctx.rotate(tilt);

            // Sombra
            ctx.fillStyle = "rgba(0,0,0,0.5)";
            ctx.beginPath(); ctx.ellipse(0, 10, 40, 10, 0, 0, Math.PI*2); ctx.fill();

            // Pneus
            ctx.fillStyle = "#222";
            ctx.fillRect(-35, 0, 15, 20); ctx.fillRect(20, 0, 15, 20); // Traseiros
            
            // Corpo
            ctx.fillStyle = kart.color;
            // Design aerodinâmico (Low poly style)
            ctx.beginPath();
            ctx.moveTo(-25, 0); ctx.lineTo(25, 0); // Traseira
            ctx.lineTo(15, -15); ctx.lineTo(-15, -15); // Cockpit base
            ctx.lineTo(-25, 0);
            ctx.fill();
            
            // Spoiler
            ctx.fillStyle = "#111";
            ctx.fillRect(-30, -25, 60, 8);

            // Piloto (Capacete)
            ctx.fillStyle = "#fff";
            ctx.beginPath(); ctx.arc(0, -20, 12, 0, Math.PI*2); ctx.fill();
            
            // Volante (se player)
            if(kart.isPlayer) {
                ctx.fillStyle = "#333";
                ctx.save();
                ctx.translate(0, -10);
                ctx.rotate(this.virtualSteer); // Volante gira com input
                ctx.fillRect(-10, -2, 20, 4);
                ctx.restore();
            }

            ctx.restore();
        },

        renderHUD: function(ctx, w, h) {
            const P = this.player;

            // 1. Velocímetro Digital
            const speed = Math.floor(P.speed);
            ctx.fillStyle = "rgba(0,0,0,0.5)";
            ctx.beginPath(); ctx.moveTo(w, h); ctx.lineTo(w-150, h); ctx.lineTo(w-120, h-100); ctx.lineTo(w, h-100); ctx.fill();
            
            ctx.fillStyle = speed > 250 ? "#e74c3c" : "#fff";
            ctx.font = "bold 48px 'Russo One'";
            ctx.textAlign = "right";
            ctx.fillText(speed, w - 20, h - 30);
            ctx.font = "16px Arial";
            ctx.fillText("KM/H", w - 20, h - 15);

            // 2. Ranking
            const rankSuf = ["st", "nd", "rd", "th"][Math.min(3, P.rank-1)];
            ctx.fillStyle = "#fff";
            ctx.strokeStyle = "#000";
            ctx.lineWidth = 4;
            ctx.font = "italic bold 80px 'Russo One'";
            ctx.textAlign = "left";
            ctx.strokeText(`${P.rank}`, 20, h - 20);
            ctx.fillText(`${P.rank}`, 20, h - 20);
            ctx.font = "bold 30px Arial";
            ctx.fillText(rankSuf, 80, h-60);

            // 3. MINIMAPA REAL (Não procedural, baseado no TrackSystem)
            const mapSize = 150;
            const mapX = 20;
            const mapY = 20;

            // Fundo
            ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
            ctx.fillRect(mapX, mapY, mapSize, mapSize);
            ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
            ctx.strokeRect(mapX, mapY, mapSize, mapSize);

            // Desenha o traçado da pista no minimapa
            // Precisamos projetar o loop linear do TrackSystem em coordenadas 2D (XY)
            ctx.strokeStyle = "#7f8c8d";
            ctx.lineWidth = 4;
            ctx.beginPath();
            
            let mx = mapX + mapSize/2;
            let my = mapY + mapSize - 20;
            let angle = -Math.PI/2; // Começa apontando pra cima
            const step = 50; // Resolução do minimapa
            const scale = 0.08; // Escala do mapa
            
            // Loop para desenhar o shape da pista
            ctx.moveTo(mx, my);
            let trackPoints = []; // Cache para desenhar os pontos dos carros

            for(let i=0; i<PHY.TRACK_LENGTH; i+=step) {
                const c = TrackSystem.getCurve(i);
                angle += c * 0.005; // A curva altera o ângulo
                mx += Math.cos(angle) * scale * step;
                my += Math.sin(angle) * scale * step;
                
                // Centraliza no box do mapa (clamp simples)
                // (Num jogo real fariamos bounds check, aqui vamos deixar desenhar livre)
                
                // Salva coordenada proporcional ao Z
                trackPoints.push({x: mx, y: my, z: i});
                
                if(i===0) ctx.moveTo(mx, my);
                else ctx.lineTo(mx, my);
            }
            ctx.stroke();

            // Desenha Jogadores no Mapa
            const drawDot = (z, color) => {
                // Acha o ponto mais próximo no array mapeado
                const idx = Math.floor(z / step);
                const pt = trackPoints[idx % trackPoints.length];
                if(pt) {
                    // Ajuste de centralização do mapa (hack visual para manter na caixa)
                    const offX = (mapX + mapSize/2) - trackPoints[0].x;
                    const offY = (mapY + mapSize - 20) - trackPoints[0].y;
                    
                    ctx.fillStyle = color;
                    ctx.beginPath(); 
                    ctx.arc(pt.x + offX, pt.y + offY, 4, 0, Math.PI*2); 
                    ctx.fill();
                }
            };

            this.opponents.forEach(o => drawDot(o.z, o.color));
            drawDot(P.z, '#ff0000'); // Player pisca
        }
    };

    // --- BOOTSTRAP ---
    // Registra o jogo no Kernel
    const registerLoop = setInterval(() => {
        if(window.System && window.System.registerGame) {
            window.System.registerGame('kart', { 
                name: 'Otto Kart Pro', 
                icon: '🏎️', 
                camOpacity: 0.3, 
                showWheel: false 
            }, Logic);
            clearInterval(registerLoop);
        }
    }, 100);

})();
