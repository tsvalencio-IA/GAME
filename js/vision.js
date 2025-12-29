/**
 * Vision System - Versão Simplificada e Robusta
 */
const Vision = {
    active: false,
    video: null,
    pose: null,
    data: { x: 0, visible: false }, // x vai de -1 (esquerda) a 1 (direita)

    init: function() {
        this.video = document.getElementById('input-video');
        if(!this.video) return;

        // Configurar MediaPipe Pose
        this.pose = new Pose({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`});
        this.pose.setOptions({
            modelComplexity: 0, // 0 = Lite (Mais rápido no celular)
            smoothLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        this.pose.onResults(this.onResults.bind(this));

        // Tentar iniciar câmera
        this.startCamera();
    },

    startCamera: async function() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: 640, height: 480 },
                audio: false
            });
            this.video.srcObject = stream;
            await this.video.play();
            
            // Loop de detecção manual usando requestVideoFrameCallback se disponível ou rAF
            this.active = true;
            this.loop();
            console.log("Câmera iniciada com sucesso.");
        } catch (e) {
            console.warn("Câmera não disponível ou negada. Usando modo Touch.");
            // Não fazemos nada, o jogo continua rodando sem input de câmera
        }
    },

    loop: async function() {
        if (!this.active) return;
        
        if (this.video && this.video.readyState >= 2) {
            await this.pose.send({image: this.video});
        }
        
        requestAnimationFrame(this.loop.bind(this));
    },

    onResults: function(results) {
        if (!results.poseLandmarks) {
            this.data.visible = false;
            return;
        }

        const nose = results.poseLandmarks[0];
        this.data.visible = true;
        
        // O MediaPipe retorna X entre 0 e 1.
        // Vamos inverter (espelho) e centralizar.
        // 0.5 é o centro.
        // Se nose.x for 0.2 (esquerda na cam), queremos mover para direita (espelho) ou esquerda?
        // Espelho: se eu vou pra esquerda, minha imagem vai pra esquerda da tela.
        
        // Calculo: (0.5 - nose.x) inverte o eixo. Multiplicamos por sensibilidade.
        this.data.x = (0.5 - nose.x) * 3.5; 
        
        // Limites
        if (this.data.x > 1.5) this.data.x = 1.5;
        if (this.data.x < -1.5) this.data.x = -1.5;
    }
};

// Tornar global
window.Vision = Vision;
