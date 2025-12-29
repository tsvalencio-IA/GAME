const Vision = {
    active: false, pose: null, camera: null, video: null,
    data: { x: 0, y: 0, gesture: null, confidence: 0 },

    setup: function(videoElemId, feedbackElemId) {
        this.video = document.getElementById(videoElemId);
        if(!this.video) return console.error("Vision: Vídeo input não encontrado");

        this.pose = new Pose({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`});
        this.pose.setOptions({
            modelComplexity: 1, smoothLandmarks: true,
            minDetectionConfidence: 0.5, minTrackingConfidence: 0.5
        });
        this.pose.onResults((res) => this.processFrame(res));

        this.camera = new Camera(this.video, {
            onFrame: async () => { if(this.active) await this.pose.send({image: this.video}); },
            width: 480, height: 480
        });
    },

    start: async function() {
        if(this.active) return;
        try {
            await this.camera.start();
            this.active = true;
            const feed = document.getElementById('camera-feed');
            if(feed && this.video.srcObject) {
                feed.srcObject = this.video.srcObject;
                feed.play();
                feed.style.opacity = 1;
            }
        } catch(e) {
            alert("Erro de Câmera: " + e.message);
            throw e;
        }
    },

    stop: function() {
        this.active = false;
        const feed = document.getElementById('camera-feed');
        if(feed) feed.style.opacity = 0;
    },

    processFrame: function(results) {
        if(!results.poseLandmarks) { this.data.confidence = 0; return; }
        const lm = results.poseLandmarks;
        const nose = lm[0];
        const lWrist = lm[15];
        const rWrist = lm[16];

        this.data.x = (0.5 - nose.x) * 3.0; // Espelho
        this.data.confidence = nose.visibility;

        const armSpan = Math.abs(lWrist.x - rWrist.x);
        if (armSpan > 0.65) this.data.gesture = 'T-POSE';
        else this.data.gesture = null;
    }
};
