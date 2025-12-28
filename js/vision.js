/**
 * thIAguinho Vision Module
 * Responsável por traduzir movimentos do corpo real para dados do jogo.
 */

const Vision = {
    active: false,
    results: {
        x: 0, // Posição lateral (-1 a 1)
        y: 0, // Altura (para pulos)
        activity: 0, // Intensidade de movimento
        hands: { left: {x:0, y:0}, right: {x:0, y:0} } // Para o modo Dance
    },
    
    // Inicializa a câmera e o modelo Pose
    init: function(onReady) {
        const videoElement = document.getElementById('input-video');
        
        const pose = new Pose({locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
        }});

        pose.setOptions({
            modelComplexity: 1, // 0=Lite, 1=Full, 2=Heavy
            smoothLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        pose.onResults(this.onResults.bind(this));

        const camera = new Camera(videoElement, {
            onFrame: async () => {
                await pose.send({image: videoElement});
            },
            width: 640,
            height: 480
        });

        camera.start()
            .then(() => {
                console.log("Vision: Câmera iniciada");
                if(onReady) onReady();
            })
            .catch(err => {
                alert("Erro ao abrir câmera: " + err);
            });
    },

    onResults: function(results) {
        if (!results.poseLandmarks) {
            document.getElementById('tracking-status').className = 'status-badge waiting';
            document.getElementById('tracking-status').innerText = 'ENQUADRE SEU CORPO';
            return;
        }

        document.getElementById('tracking-status').className = 'status-badge tracking';
        document.getElementById('tracking-status').innerText = 'CONECTADO';

        const lm = results.poseLandmarks;

        // 1. Calcular Posição Lateral (Baseado no Nariz)
        // MediaPipe X: 0 (Esq) -> 1 (Dir). Como a câmera é espelhada no CSS, invertemos a lógica lógica aqui ou usamos direto.
        // Vamos normalizar: 0.5 é o centro. < 0.5 Esq, > 0.5 Dir.
        // Mapeando para -1 a 1
        const noseX = lm[0].x;
        this.results.x = (noseX - 0.5) * -2; // Invertido para espelho natural

        // 2. Calcular Altura (Baseado nos Ombros)
        const shouldersY = (lm[11].y + lm[12].y) / 2;
        this.results.y = shouldersY;

        // 3. Calcular Atividade (Corrida no lugar)
        // Compara a posição Y atual com a anterior (simples delta)
        // (Implementação simplificada para performance)
        this.results.activity = Math.abs(shouldersY - (this.lastY || shouldersY)) * 100;
        this.lastY = shouldersY;

        // 4. Mãos (Para Dance Mode)
        this.results.hands.left = { x: (lm[15].x - 0.5) * -2, y: lm[15].y };
        this.results.hands.right = { x: (lm[16].x - 0.5) * -2, y: lm[16].y };
    }
};
