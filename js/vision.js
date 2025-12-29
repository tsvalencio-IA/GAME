/**
 * thIAguinho Vision System v6.0 (Wii Sensor Bar Logic)
 * Responsável por traduzir o mundo real para dados do jogo.
 */

const Vision = {
    active: false,
    pose: null,
    camera: null,
    video: null,
    
    // Dados Públicos (Normalizados -1 a 1)
    data: {
        x: 0,           // Posição lateral
        y: 0,           // Altura
        gesture: null,  // 'T-POSE', 'JUMP', 'SQUAT'
        confidence: 0
    },

    setup: function(videoElem, feedbackElem) {
        this.video = videoElem;
        const feed = feedbackElem; // Elemento de vídeo visível para feedback

        this.pose = new Pose({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`});
        this.pose.setOptions({
            modelComplexity: 1,
            smoothLandmarks: true,
            minDetectionConfidence: 0.6,
            minTrackingConfidence: 0.6
        });

        this.pose.onResults((res) => {
            this.processFrame(res);
            // Desenha no feedback visual (espelhado via CSS)
            if(feed && res.image) {
                // Truque: O video feed usa o stream direto, mas aqui poderiamos desenhar skeleton no canvas
                // Para performance mobile, deixamos o stream nativo e só calculamos lógica.
            }
        });

        this.camera = new Camera(this.video, {
            onFrame: async () => { if(this.active) await this.pose.send({image: this.video}); },
            width: 480, height: 480 // Baixa resolução para alta performance
        });
    },

    start: async function() {
        if(this.active) return;
        try {
            await this.camera.start();
            this.active = true;
            
            // Conecta o stream ao elemento de feedback visual também
            const feed = document.getElementById('camera-feed');
            if(feed && this.video.srcObject) {
                feed.srcObject = this.video.srcObject;
                feed.play();
                feed.style.opacity = 1;
            }
        } catch(e) {
            console.error("Vision Start Error:", e);
            throw e;
        }
    },

    stop: function() {
        this.active = false;
        const feed = document.getElementById('camera-feed');
        if(feed) feed.style.opacity = 0;
    },

    processFrame: function(results) {
        if(!results.poseLandmarks) {
            this.data.confidence = 0;
            return;
        }

        const lm = results.poseLandmarks;
        const nose = lm[0];
        const lShoulder = lm[11];
        const rShoulder = lm[12];
        const lWrist = lm[15];
        const rWrist = lm[16];

        // 1. Normalização de Posição X (Invertida para espelho)
        // Centro = 0.5. Mapear para -1 a 1.
        this.data.x = (0.5 - nose.x) * 2.5; // Multiplicador de sensibilidade
        this.data.confidence = nose.visibility;

        // 2. Detecção de Gestos
        
        // T-POSE (Pulsos na altura dos ombros e longe do corpo)
        const armSpan = Math.abs(lWrist.x - rWrist.x);
        const shoulderYAvg = (lShoulder.y + rShoulder.y) / 2;
        const wristsYAvg = (lWrist.y + rWrist.y) / 2;
        
        if (armSpan > 0.6 && Math.abs(shoulderYAvg - wristsYAvg) < 0.1) {
            this.data.gesture = 'T-POSE';
        } 
        // JUMP (Ombros sobem muito rápido - lógica no game loop por delta)
        else {
            this.data.gesture = null;
        }

        // Armazena Y bruto para cálculos de delta
        this.data.y = shoulderYAvg;
    }
};
