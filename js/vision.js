/**
 * NEO-WII Vision HAL
 * Abstrai o MediaPipe Pose em dados de controle normalizados.
 * Implementa Calibração Invisível (Zero-Point automático).
 */
const Vision = {
    active: false,
    video: null,
    pose: null,
    
    // Configuração da Calibração Invisível
    calibration: {
        framesStable: 0,
        requiredFrames: 15, // ~0.5s de estabilidade
        threshold: 0.05,    // Tolerância de movimento
        lastX: 0,
        offsetX: 0,
        offsetY: 0,
        isCalibrated: false
    },

    data: { 
        x: 0, y: 0, tilt: 0, presence: false 
    },

    raw: { x: 0, y: 0 },

    init: function() {
        this.video = document.getElementById('input-video');
        if (!this.video) return console.error("Vision: Vídeo input não encontrado");

        try {
            this.pose = new Pose({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`});
            this.pose.setOptions({
                modelComplexity: 0,
                smoothLandmarks: true,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5
            });
            this.pose.onResults(this.onResults.bind(this));
            console.log("Vision: Engine Pronta");
        } catch(e) {
            console.error("Vision: Falha ao carregar MediaPipe", e);
        }
    },

    start: async function() {
        if (!this.video || !this.pose) return false;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { 
                    facingMode: 'user', 
                    width: {ideal: 480}, 
                    height: {ideal: 640},
                    frameRate: {ideal: 30} 
                },
                audio: false
            });
            this.video.srcObject = stream;
            await this.video.play();
            
            const feed = document.getElementById('camera-feed');
            if(feed) {
                feed.srcObject = stream;
                feed.play();
                feed.style.opacity = 0.5; // Transparência AR
            }

            this.active = true;
            this.resetCalibration();
            this.loop();
            return true;
        } catch(e) {
            console.warn("Vision: Câmera negada/indisponível", e);
            return false;
        }
    },

    resetCalibration: function() {
        this.calibration.isCalibrated = false;
        this.calibration.framesStable = 0;
        console.log("Vision: Buscando ponto zero...");
    },

    loop: async function() {
        if(!this.active) return;
        if(this.video && this.video.readyState >= 2) {
            await this.pose.send({image: this.video});
        }
        requestAnimationFrame(this.loop.bind(this));
    },

    onResults: function(results) {
        if (!results.poseLandmarks) {
            this.data.presence = false;
            return;
        }
        this.data.presence = true;

        const nose = results.poseLandmarks[0];
        const earL = results.poseLandmarks[7];
        const earR = results.poseLandmarks[8];

        let rawX = (0.5 - nose.x) * 3.0; 
        let rawY = (0.5 - nose.y) * 4.0;
        let rawTilt = (earL.y - earR.y) * 10;

        if (!this.calibration.isCalibrated) {
            const delta = Math.abs(rawX - this.calibration.lastX);
            if (delta < this.calibration.threshold) {
                this.calibration.framesStable++;
            } else {
                this.calibration.framesStable = 0;
            }
            this.calibration.lastX = rawX;

            if (this.calibration.framesStable > this.calibration.requiredFrames) {
                this.calibration.offsetX = rawX;
                this.calibration.offsetY = rawY;
                this.calibration.isCalibrated = true;
                console.log("Vision: Calibrado!");
                Feedback.rumble('ui');
            }
        }

        if (this.calibration.isCalibrated) {
            this.data.x = rawX - this.calibration.offsetX;
            this.data.y = rawY - this.calibration.offsetY;
        } else {
            this.data.x = rawX;
            this.data.y = rawY;
        }

        this.data.tilt = rawTilt;
        this.raw.y = rawY;
    }
};

window.Vision = Vision;
