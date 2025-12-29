/**
 * thIAguinho Vision v12 (Robust)
 */
const Vision = {
    active: false,
    video: null,
    pose: null,
    camera: null,
    data: { x: 0, y: 0, visible: false },

    setup: function(videoElemId) {
        this.video = document.getElementById(videoElemId);
        if(!this.video) return console.error("Vision: Vídeo não encontrado");

        this.pose = new Pose({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`});
        this.pose.setOptions({
            modelComplexity: 1,
            smoothLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });
        this.pose.onResults((res) => this.process(res));
    },

    start: async function() {
        if(this.active) return;
        try {
            // Tenta câmera nativa
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: {ideal: 640}, height: {ideal: 480} },
                audio: false
            });
            this.video.srcObject = stream;
            await this.video.play();

            // Linkar feedback
            const feed = document.getElementById('camera-feed');
            if(feed) { feed.srcObject = stream; feed.play(); feed.style.opacity = 1; }

            this.active = true;
            this.loop();
            return true;
        } catch(e) {
            console.error(e);
            throw new Error("Permissão de câmera negada");
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
        // Normalização Espelhada (-1 a 1)
        this.data.x = (0.5 - nose.x) * 3.0; 
        this.data.visible = true;
    }
};
