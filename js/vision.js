/**
 * thIAguinho Vision Module v4.0 (Robust)
 * Encapsulamento completo do MediaPipe Pose e Gestão de Câmera.
 */

const Vision = {
    pose: null,
    camera: null,
    active: false,
    debugEnabled: false,
    
    // Dados normalizados acessíveis pelo Game.js
    results: {
        x: 0.5,         // 0 (Esq) a 1 (Dir)
        y: 0.5,         // 0 (Topo) a 1 (Base)
        visibility: 0,  // 0 a 1 (Confiança da detecção)
        hands: {        // Posição das mãos (Normalizada)
            left: { x: 0, y: 0 },
            right: { x: 0, y: 0 }
        },
        activityLevel: 0 // Delta de movimento (para modo RUN)
    },

    lastY: 0, // Para calcular atividade

    init: async function(videoElement, canvasElement, onReady, onError) {
        console.log("[Vision] Inicializando...");
        const ctx = canvasElement.getContext('2d');

        // 1. Configurar MediaPipe Pose
        this.pose = new Pose({locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
        }});

        this.pose.setOptions({
            modelComplexity: 1, // 0=Lite, 1=Full (Balanceado), 2=Heavy
            smoothLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        this.pose.onResults((res) => {
            this.processFrame(res, canvasElement, ctx);
        });

        // 2. Tentar Iniciar Câmera
        try {
            this.camera = new Camera(videoElement, {
                onFrame: async () => {
                    await this.pose.send({image: videoElement});
                },
                width: 640,
                height: 480
            });
            
            await this.camera.start();
            this.active = true;
            console.log("[Vision] Câmera Ativa.");
            if(onReady) onReady();
            
        } catch (e) {
            console.warn("[Vision] Erro de Câmera (Provável falta de HTTPS ou permissão):", e);
            // Chama onReady mesmo com erro, para o jogo não travar (fallback para Touch)
            if(onError) onError(e);
            else if(onReady) onReady(); 
        }
    },

    processFrame: function(results, canvas, ctx) {
        // Limpar e desenhar feed da câmera (espelhado via CSS)
        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Desenha vídeo de fundo
        if (results.image) {
            ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
        }

        // Se detectou corpo...
        if (results.poseLandmarks) {
            // Desenhar esqueleto (apenas se debug estiver ativo)
            if (this.debugEnabled) {
                drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, {color: '#00FF00', lineWidth: 4});
                drawLandmarks(ctx, results.poseLandmarks, {color: '#FF0000', lineWidth: 2});
            }

            // Extrair dados críticos
            const nose = results.poseLandmarks[0];
            const leftShoulder = results.poseLandmarks[11];
            const rightShoulder = results.poseLandmarks[12];
            const leftHand = results.poseLandmarks[15]; // Pulso Esq
            const rightHand = results.poseLandmarks[16]; // Pulso Dir

            // --- NORMALIZAÇÃO DE DADOS ---
            
            // X: Invertemos o X do MediaPipe (1 - x) para corrigir o espelhamento natural
            this.results.x = 1 - nose.x;
            
            // Y: Média dos ombros
            const currentY = (leftShoulder.y + rightShoulder.y) / 2;
            this.results.y = currentY;

            // Atividade (Quão rápido está se movendo verticalmente - Corrida Estacionária)
            const delta = Math.abs(currentY - this.lastY);
            this.results.activityLevel = delta * 100; // Fator de amplificação
            this.lastY = currentY;

            // Mãos (Também invertendo X)
            this.results.hands.left = { x: 1 - leftHand.x, y: leftHand.y };
            this.results.hands.right = { x: 1 - rightHand.x, y: rightHand.y };

            this.results.visibility = nose.visibility;
        } else {
            this.results.visibility = 0;
            this.results.activityLevel = 0;
        }
        ctx.restore();
    },

    toggleDebug: function() {
        this.debugEnabled = !this.debugEnabled;
        console.log("[Vision] Debug:", this.debugEnabled);
    }
};
