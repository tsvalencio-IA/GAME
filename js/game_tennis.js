// =============================================================================
// LÓGICA DO JOGO: OTTO PING PONG (CALIBRAÇÃO OBRIGATÓRIA + SMART TRACKING)
// =============================================================================

(function() {
    // CONSTANTES DE CALIBRAGEM FÍSICA
    const TABLE_W = 550;        // Largura da mesa virtual
    const SENSITIVITY_BASE = 2.3; // Sensibilidade base
    const REACH_BOOST = 1.5;    // Impulso extra para alcançar cantos
    const CALIBRATION_TIME = 60; // Frames necessários para calibrar (aprox 2 seg)

    const Logic = {
        // Variáveis de Estado
        score: 0,
        state: 'calibrate', // calibrate, serve, play, game_over
        
        // Entidades Físicas
        // Lógica Arcade: Bola começa em Z=1200 (fundo) e vem até Z=0 (tela)
        ball: { x:0, y:0, z:1200, vx:0, vy:0, vz:0 },
        racket: { x:0, y:0 }, // Posição visual da raquete na tela
        
        // Sistema de Rastreamento (Smart Tracking)
        handCenter: { x:null, y:null }, // O "Zero" do jogador
        calibCounter: 0, // Contador para travar a calibração
        
        // Efeitos Visuais
        flash: 0,

        // --- INICIALIZAÇÃO ---
        init: function() { 
            this.score = 0; 
            this.state = 'calibrate';
            this.handCenter = { x:null, y:null };
            this.calibCounter = 0;
            this.resetBall();
            // Mensagem inicial do sistema
            window.System.msg("CALIBRAR POSIÇÃO"); 
        },

        // Reseta a bola para o fundo (Lógica Arcade)
        resetBall: function() {
            this.ball = { 
                x: 0, 
                y: -180, // Altura inicial (acima da mesa)
                z: 1200, // Profundidade (fundo)
                vx: (Math.random() - 0.5) * 14, // Efeito lateral aleatório
                vy: 4,   // Gravidade inicial
                vz: -22 - (this.score * 1.5) // Velocidade aumenta com o placar
            };
        },

        //LOOP PRINCIPAL (60 FPS)
        update: function(ctx, w, h, pose) {
            const cx = w / 2; 
            const cy = h / 2;

            // 1. LIMPEZA E FUNDO (Visual Profissional)
            const grad = ctx.createLinearGradient(0, 0, 0, h);
            grad.addColorStop(0, '#1a1a1a'); grad.addColorStop(1, '#000');
            ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);

            // 2. FEEDBACK DO ESQUELETO (Camada de Debug Visual)
            // Desenhamos isso primeiro para ficar "atrás" da interface, mas visível
            if(window.Gfx && window.Gfx.drawSkeleton && pose) {
                ctx.save();
                ctx.globalAlpha = 0.4; // Translucido
                ctx.strokeStyle = '#00ff00'; // Verde Neon Boxe
                ctx.lineWidth = 4;
                window.Gfx.drawSkeleton(ctx, pose, w, h);
                ctx.restore();
            }

            // 3. DETECÇÃO DE MÃO (Input Bruto)
            let hand = null;
            let rawPos = { x:0, y:0 };
            
            if(pose) {
                const rw = pose.keypoints.find(k => k.name === 'right_wrist');
                const lw = pose.keypoints.find(k => k.name === 'left_wrist');
                // Escolhe a mão com maior confiança (score)
                if(rw && rw.score > 0.4) hand = rw;
                else if(lw && lw.score > 0.4) hand = lw;
            }

            if(hand) {
                // Mapeia coordenadas normalizadas da webcam para a tela (0..W, 0..H)
                rawPos = window.Gfx.map(hand, w, h);
            }

            // =================================================================
            // MÁQUINA DE ESTADOS (A Lógica Principal)
            // =================================================================

            // --- ESTADO 1: CALIBRAÇÃO (Obrigatório) ---
            if(this.state === 'calibrate') {
                
                // Desenha Alvo de Calibração no Centro
                ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
                ctx.setLineDash([10, 5]);
                ctx.beginPath(); ctx.arc(cx, cy, 60, 0, Math.PI*2); ctx.stroke();
                ctx.setLineDash([]);
                
                ctx.fillStyle = '#fff'; ctx.font = "bold 20px Arial"; ctx.textAlign = "center";
                ctx.fillText("COLOQUE A MÃO AQUI", cx, cy - 80);

                if(hand) {
                    // Desenha cursor da mão atual
                    ctx.fillStyle = '#00ff00'; 
                    ctx.beginPath(); ctx.arc(rawPos.x, rawPos.y, 15, 0, Math.PI*2); ctx.fill();

                    // Verifica se a mão está dentro do alvo (Distância < 60px)
                    const dist = Math.hypot(rawPos.x - cx, rawPos.y - cy);
                    
                    if(dist < 60) {
                        this.calibCounter++;
                        
                        // Desenha Barra de Progresso Circular
                        const progress = this.calibCounter / CALIBRATION_TIME;
                        ctx.strokeStyle = '#00ff00'; ctx.lineWidth = 8;
                        ctx.beginPath(); 
                        ctx.arc(cx, cy, 60, -Math.PI/2, (-Math.PI/2) + (Math.PI*2*progress)); 
                        ctx.stroke();

                        // CALIBRAÇÃO CONCLUÍDA
                        if(this.calibCounter >= CALIBRATION_TIME) {
                            this.handCenter = { x: rawPos.x, y: rawPos.y }; // Define o ZERO
                            this.state = 'serve';
                            window.System.msg("CALIBRADO! SAQUE!");
                            window.Sfx.coin(); // Som de sucesso
                        }
                    } else {
                        // Se sair do alvo, reseta o progresso (para evitar calibração acidental)
                        this.calibCounter = Math.max(0, this.calibCounter - 2);
                    }
                }
            }

            // --- ESTADO 2 e 3: JOGO (SERVE / PLAY) ---
            else {
                // SÓ PROCESSA O JOGO SE TIVERMOS MÃO DETECTADA (OU MANTÉM ÚLTIMA POSIÇÃO)
                if(hand) {
                    // SMART TRACKING ENGINE
                    // 1. Calcula a distância da mão em relação ao CENTRO CALIBRADO (não o centro da tela)
                    let dx = rawPos.x - this.handCenter.x;
                    let dy = rawPos.y - this.handCenter.y;

                    // 2. Aplica Curva Exponencial (Reach Boost)
                    // Permite alcançar cantos sem esticar muito o braço
                    // Quanto mais longe do centro, maior o multiplicador
                    const reachFactor = 1 + (Math.abs(dx) / (w * 0.25)) * REACH_BOOST;
                    
                    let targetX = dx * SENSITIVITY_BASE * reachFactor;
                    let targetY = dy * SENSITIVITY_BASE; 

                    // 3. Aplica Suavização Adaptativa (Remove tremedeira, mantém agilidade)
                    const distToTarget = Math.hypot(targetX - this.racket.x, targetY - this.racket.y);
                    const smoothFactor = Math.min(0.9, 0.3 + (distToTarget / 150)); 

                    this.racket.x += (targetX - this.racket.x) * smoothFactor;
                    this.racket.y += (targetY - this.racket.y) * smoothFactor;
                    
                    // 4. Trava a raquete dentro dos limites lógicos da mesa
                    this.racket.x = Math.max(-TABLE_W/2 - 80, Math.min(TABLE_W/2 + 80, this.racket.x));
                }

                // LÓGICA DO JOGO (ARCADE SIMPLIFICADO)
                if(this.state === 'serve') {
                    // Bola se aproxima lentamente para dar tempo de reagir
                    this.ball.z -= 18;
                    if(this.ball.z < 1000) this.state = 'play';
                }
                else if(this.state === 'play') {
                    // Física da Bola
                    this.ball.x += this.ball.vx;
                    this.ball.y += this.ball.vy;
                    this.ball.z += this.ball.vz;

                    // Gravidade (Simula peso "Wii Sports")
                    if(this.ball.y < 250) this.ball.vy += 0.35;

                    // --- COLISÃO COM JOGADOR ---
                    // Acontece quando a bola chega perto da tela (Z entre 180 e -80)
                    if(this.ball.z < 180 && this.ball.z > -80 && this.ball.vz < 0) {
                        
                        // Projeção: Onde a bola está na tela 2D?
                        const scale = 500 / (this.ball.z + 500);
                        const ballScreenX = (this.ball.x * scale); 
                        const ballScreenY = (this.ball.y * scale) + 60; // Offset visual

                        // Hitbox (Distância Euclidiana)
                        const dist = Math.hypot(ballScreenX - this.racket.x, ballScreenY - this.racket.y);
                        
                        // Aim Assist: Hitbox generosa (18% da largura da tela)
                        if(dist < w * 0.18) {
                            window.Sfx.hit();
                            this.score++;
                            this.flash = 4; // Flash branco

                            // Rebate
                            this.ball.vz = Math.abs(this.ball.vz) + 4; // Devolve mais rápido
                            this.ball.vy = -14; // Joga para cima
                            
                            // Spin: O ângulo depende de onde bateu na raquete
                            this.ball.vx = (ballScreenX - this.racket.x) * 0.65;
                            
                            window.System.msg("BATEU! " + this.score);
                        }
                    }

                    // --- IA (CPU) REBATE ---
                    // Quando a bola vai longe (Z > 1500)
                    if(this.ball.z > 1500 && this.ball.vz > 0) {
                        window.Sfx.click(); // Som seco de quique
                        // Devolução da CPU
                        this.ball.vz = -22 - (this.score * 1.0); // Fica mais difícil com o tempo
                        this.ball.vx = (Math.random() - 0.5) * 28; // Mira aleatória
                        this.ball.vy = -8;
                    }

                    // --- GAME OVER ---
                    // Se a bola passar atrás do jogador (Z < -350)
                    if(this.ball.z < -350) {
                        this.state = 'game_over'; // Trava o jogo
                        window.System.gameOver(this.score);
                    }
                }
            }

            // =================================================================
            // RENDERIZAÇÃO (VISUAL 2.5D MESA AZUL)
            // =================================================================
            
            // Função Auxiliar de Perspectiva
            const project = (x, y, z) => {
                const scale = 500 / (500 + z);
                return {
                    x: cx + (x * scale),
                    y: cy + ((y + 120) * scale),
                    s: scale
                };
            };

            // 1. DESENHA A MESA (TRAPÉZIO)
            const pTL = project(-TABLE_W/2, 0, 1500); // Fundo Esquerda
            const pTR = project(TABLE_W/2, 0, 1500);  // Fundo Direita
            const pBL = project(-TABLE_W/2, 0, 0);    // Frente Esquerda
            const pBR = project(TABLE_W/2, 0, 0);     // Frente Direita

            // Tampo Azul (Estilo ITTF)
            ctx.beginPath();
            ctx.fillStyle = '#2980b9'; 
            ctx.moveTo(pTL.x, pTL.y); ctx.lineTo(pTR.x, pTR.y);
            ctx.lineTo(pBR.x, pBR.y); ctx.lineTo(pBL.x, pBL.y);
            ctx.fill();

            // Bordas Brancas
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(pTL.x, pTL.y); ctx.lineTo(pBL.x, pBL.y);
            ctx.moveTo(pTR.x, pTR.y); ctx.lineTo(pBR.x, pBR.y);
            ctx.moveTo(pTL.x, pTL.y); ctx.lineTo(pTR.x, pTR.y);
            ctx.moveTo(pBL.x, pBL.y); ctx.lineTo(pBR.x, pBR.y);
            // Linha Central
            const midTop = project(0,0,1500); const midBot = project(0,0,0);
            ctx.moveTo(midTop.x, midTop.y); ctx.lineTo(midBot.x, midBot.y);
            ctx.stroke();

            // Rede (Meio visual)
            const netY = pTL.y + (pBL.y - pTL.y) * 0.5;
            const netW = (pBR.x - pBL.x) * 0.7;
            ctx.fillStyle='rgba(255,255,255,0.3)';
            ctx.fillRect(cx - netW/2, netY-25, netW, 25);
            ctx.fillStyle='#fff'; ctx.fillRect(cx - netW/2, netY-25, netW, 3);

            // 2. DESENHA A BOLA (SE NÃO ESTIVER EM CALIBRAÇÃO)
            if(this.state !== 'calibrate') {
                const ballPos = project(this.ball.x, this.ball.y, this.ball.z);
                
                if(ballPos.s > 0) {
                    const bSize = 16 * ballPos.s;
                    
                    // Sombra Projetada (Y=150 fixo simulando o plano da mesa)
                    const shadowPos = project(this.ball.x, 150, this.ball.z); 
                    ctx.fillStyle = 'rgba(0,0,0,0.4)';
                    ctx.beginPath(); ctx.ellipse(shadowPos.x, shadowPos.y, bSize, bSize*0.4, 0, 0, Math.PI*2); ctx.fill();

                    // Corpo da Bola
                    ctx.fillStyle = '#fff';
                    ctx.beginPath(); ctx.arc(ballPos.x, ballPos.y, bSize, 0, Math.PI*2); ctx.fill();
                    // Sombreamento 3D
                    ctx.fillStyle = '#eee'; 
                    ctx.beginPath(); ctx.arc(ballPos.x - bSize*0.2, ballPos.y - bSize*0.2, bSize*0.3, 0, Math.PI*2); ctx.fill();
                }
            }

            // 3. DESENHA A RAQUETE (SE JÁ CALIBROU)
            if(this.state !== 'calibrate') {
                const rX = cx + this.racket.x;
                const rY = cy + this.racket.y;
                const rSize = w * 0.10; // Tamanho proporcional da raquete

                // Cabo de Madeira
                ctx.fillStyle = '#d35400';
                ctx.fillRect(rX - 12, rY, 24, rSize * 1.8);
                
                // Borracha Vermelha
                ctx.fillStyle = '#c0392b'; 
                ctx.beginPath(); ctx.arc(rX, rY, rSize, 0, Math.PI*2); ctx.fill();
                
                // Borda de Proteção
                ctx.strokeStyle = '#f39c12'; ctx.lineWidth = 4; ctx.stroke();
                
                // Ponto de Mira (Branco no centro)
                ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(rX, rY, 4, 0, Math.PI*2); ctx.fill();
            }

            // 4. EFEITOS DE HUD
            if(this.flash > 0) {
                ctx.fillStyle = `rgba(255,255,255,${this.flash * 0.2})`; ctx.fillRect(0,0,w,h); this.flash--;
            }

            // Placar Permanente
            if(this.state !== 'calibrate') {
                ctx.fillStyle = "white"; ctx.font = "bold 40px Arial"; ctx.textAlign = "left";
                ctx.fillText(this.score, 30, 60);
            }

            return this.score;
        }
    };

    // REGISTRO AUTOMÁTICO NO SISTEMA CORE
    const regLoop = setInterval(() => {
        if(window.System && window.System.registerGame) {
            window.System.registerGame('tennis', 'Otto PingPong', '🏓', Logic, {camOpacity: 0.5, showWheel: false});
            clearInterval(regLoop);
        }
    }, 100);
})();
