/**
 * thIAguinho Vision Module v5.0 (Resource Managed)
 * Permite ligar/desligar a câmera dinamicamente.
 */
const Vision = {
    pose: null,
    camera: null,
    active: false,
    results: { x: 0.5, y: 0.5, activity: 0, visible: false },
    videoElement: null,
    canvasElement: null,
    ctx: null,

    // Configura mas não inicia a câmera ainda
    setup: function(vidId, canvasId) {
        this.videoElement = document.getElementById(vidId);
        this.canvasElement = document.getElementById(canvasId);
        if(!this.videoElement || !this.canvasElement) return;

        this.ctx = this.canvasElement.getContext('2d');
        
        // MediaPipe Setup
        this.pose = new Pose({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`});
        this.pose.setOptions({
            modelComplexity: 1,
            smoothLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        this.pose.onResults((res) => this.processResults(res));
        
        // Camera Instance
        this.camera = new Camera(this.videoElement, {
            onFrame: async () => {
                if(this.active) await this.pose.send({image: this.videoElement});
            },
            width: 640, height: 480
        });
    },

    start: async function() {
        if(this.active) return; // Já está rodando
        console.log("Vision: Iniciando Câmera...");
        try {
            await this.camera.start();
            this.active = true;
            
            // Fade In Canvas
            if(this.canvasElement) this.canvasElement.style.opacity = 1;
            
        } catch(e) {
            console.error("Vision Error:", e);
            alert("Erro: Câmera não permitida ou indisponível.");
            this.active = false;
        }
    },

    stop: function() {
        if(!this.active) return;
        console.log("Vision: Pausando Câmera...");
        this.active = false;
        
        // Fade Out Canvas
        if(this.canvasElement) this.canvasElement.style.opacity = 0;
        
        // Nota: CameraUtils não tem 'stop' real fácil, mas paramos de enviar frames para o Pose
        // Isso economiza MUITA CPU.
    },

    processResults: function(results) {
        if(!this.active) return;

        // Desenha o feed da câmera para o usuário se ver
        this.ctx.save();
        this.ctx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
        this.ctx.drawImage(results.image, 0, 0, this.canvasElement.width, this.canvasElement.height);
        
        if(results.poseLandmarks) {
            // Extração de dados
            const nose = results.poseLandmarks[0];
            const leftShoulder = results.poseLandmarks[11];
            const rightShoulder = results.poseLandmarks[12];

            // X Invertido (Espelho)
            this.results.x = 1 - nose.x;
            this.results.y = (leftShoulder.y + rightShoulder.y) / 2;
            this.results.visible = true;
            
            // Desenho simples de debug (pontos no nariz e ombros)
            this.ctx.fillStyle = '#00FF00';
            this.ctx.beginPath(); this.ctx.arc(this.results.x * this.canvasElement.width, nose.y * this.canvasElement.height, 10, 0, 2*Math.PI); this.ctx.fill();
        } else {
            this.results.visible = false;
        }
        this.ctx.restore();
    }
};
