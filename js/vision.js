/**
 * thIAguinho Vision System v9.0 (GitHub Pages Safe)
 * Correção: Conversão automática de ID para Elemento DOM e Logs de Erro.
 */

const Vision = {
    active: false,
    pose: null,
    camera: null,
    video: null,
    
    data: { x: 0, y: 0, gesture: null, confidence: 0 },

    // CORREÇÃO: Aceita string (ID) ou Elemento direto
    setup: function(videoElem, feedbackElem) {
        // Se veio string, converte para objeto HTML
        if (typeof videoElem === 'string') {
            this.video = document.getElementById(videoElem);
        } else {
            this.video = videoElem;
        }

        if (!this.video) {
            console.error("Vision: Elemento de vídeo não encontrado!");
            alert("Erro Fatal: Elemento de vídeo sumiu.");
            return;
        }

        const feed = typeof feedbackElem === 'string' ? document.getElementById(feedbackElem) : feedbackElem;

        this.pose = new Pose({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`});
        this.pose.setOptions({
            modelComplexity: 1,
            smoothLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        this.pose.onResults((res) => {
            this.processFrame(res);
        });

        // Configuração segura da Câmera
        this.camera = new Camera(this.video, {
            onFrame: async () => { 
                if(this.active) {
                    try {
                        await this.pose.send({image: this.video});
                    } catch(err) {
                        console.error("Vision Loop Error:", err);
                    }
                }
            },
            width: 480, height: 480
        });
        
        console.log("Vision: Setup Completo.");
    },

    start: async function() {
        if(this.active) return;
        console.log("Vision: Tentando iniciar câmera...");
        
        try {
            await this.camera.start();
            this.active = true;
            
            // Conecta feedback visual
            const feed = document.getElementById('camera-feed');
            if(feed && this.video.srcObject) {
                feed.srcObject = this.video.srcObject;
                feed.play();
                feed.style.opacity = 1;
            }
            return true;
        } catch(e) {
            console.error("Vision Start Error:", e);
            alert("Câmera Bloqueada! Verifique as permissões do navegador.");
            throw e;
        }
    },

    stop: function() {
        this.active = false;
        const feed = document.getElementById('camera-feed');
        if(feed) feed.style.opacity = 0;
        // Não paramos totalmente a track para evitar delay ao religar
    },

    processFrame: function(results) {
        if(!results.poseLandmarks) {
            this.data.confidence = 0;
            return;
        }

        const lm = results.poseLandmarks;
        const nose = lm[0];
        const lWrist = lm[15];
        const rWrist = lm[16];

        // Lógica Espelho: (0.5 - x) inverte o eixo
        this.data.x = (0.5 - nose.x) * 3.0; 
        this.data.confidence = nose.visibility;

        // Gesto T-POSE
        const armSpan = Math.abs(lWrist.x - rWrist.x);
        if (armSpan > 0.65) {
            this.data.gesture = 'T-POSE';
        } else {
            this.data.gesture = null;
        }
    }
};
