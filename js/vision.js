/**
 * Vision Module v12.0 (Nintendo Standard)
 * Gerencia Câmera e Tracking com Fallback Seguro.
 */
const Vision = {
    active: false,
    video: null,
    pose: null,
    camera: null,
    data: { x: 0, y: 0, visible: false },

    // Setup inicial sem ligar câmera
    setup: function(videoElemId) {
        this.video = document.getElementById(videoElemId);
        
        // Configuração do MediaPipe
        this.pose = new Pose({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`});
        this.pose.setOptions({
            modelComplexity: 1,
            smoothLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        this.pose.onResults((res) => this.process(res));
    },

    // Liga a câmera e o feedback visual
    start: async function() {
        if(this.active) return;
        
        try {
            // Tenta getUserMedia Nativo primeiro (Mais compatível)
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: {ideal: 640}, height: {ideal: 480} },
                audio: false
            });

            this.video.srcObject = stream;
            await this.video.play();

            // Linkar feedback visual
            const feed = document.getElementById('camera-feed');
            if(feed) {
                feed.srcObject = stream;
                feed.play();
                feed.style.opacity = 1;
            }

            // Iniciar Loop de Processamento Manual
            this.active = true;
            this.loop();
            return true;

        } catch(e) {
            console.error("Vision Error:", e);
            throw new Error("Permissão de câmera negada");
        }
    },

    stop: function() {
        this.active = false;
        const feed = document.getElementById('camera-feed');
        if(feed) feed.style.opacity = 0;
        // Não paramos o stream completamente para permitir religamento rápido
    },

    loop: async function() {
        if(!this.active) return;
        if(this.video && this.video.readyState >= 2) {
            await this.pose.send({image: this.video});
        }
        requestAnimationFrame(() => this.loop());
    },

    process: function(results) {
        if(!results.poseLandmarks) {
            this.data.visible = false;
            return;
        }

        const lm = results.poseLandmarks;
        const nose = lm[0];
        const left = lm[11]; // Ombro
        const right = lm[12]; // Ombro

        // Normalização (-1 a 1)
        // Inverter X para efeito espelho
        this.data.x = (0.5 - nose.x) * 3.0; 
        this.data.y = (left.y + right.y) / 2; // Altura média
        this.data.visible = true;
    }
};
