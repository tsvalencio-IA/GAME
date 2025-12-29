/**
 * thIAguinho Vision v12.0
 */
const Vision = {
    active: false,
    video: null,
    pose: null,
    camera: null,
    data: { x: 0, y: 0, visible: false },

    setup: function(videoElemId) {
        this.video = document.getElementById(videoElemId);
        // MediaPipe Config
        this.pose = new Pose({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`});
        this.pose.setOptions({
            modelComplexity: 1, smoothLandmarks: true,
            minDetectionConfidence: 0.5, minTrackingConfidence: 0.5
        });
        this.pose.onResults((res) => this.process(res));
    },

    start: async function() {
        if(this.active) return;
        try {
            // Solicita câmera nativamente primeiro
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: {ideal: 640}, height: {ideal: 480} },
                audio: false
            });
            this.video.srcObject = stream;
            await this.video.play();

            // Feedback visual
            const feed = document.getElementById('camera-feed');
            if(feed) { feed.srcObject = stream; feed.play(); feed.style.opacity = 1; }

            // Loop manual
            this.active = true;
            this.loop();
            return true;
        } catch(e) {
            console.error(e);
            throw new Error("Permissão negada ou HTTPS ausente.");
        }
    },

    stop: function() {
        this.active = false;
        const feed = document.getElementById('camera-feed');
        if(feed) feed.style.opacity = 0;
    },

    loop: async function() {
        if(!this.active) return;
        if(this.video && this.video.readyState >= 2) {
            await this.pose.send({image: this.video});
        }
        requestAnimationFrame(() => this.loop());
    },

    process: function(results) {
        if(!results.poseLandmarks) { this.data.visible = false; return; }
        const nose = results.poseLandmarks[0];
        const left = results.poseLandmarks[11];
        const right = results.poseLandmarks[12];

        // Mapeamento -1 a 1 (Invertido para espelho)
        this.data.x = (0.5 - nose.x) * 3.0; 
        this.data.y = (left.y + right.y) / 2;
        this.data.visible = true;
    }
};
