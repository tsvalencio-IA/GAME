/**
 * thIAguinho HAL v24.0 (Calibration & Stability)
 */
const Vision = {
    active: false,
    video: null,
    pose: null,
    
    calibration: {
        active: false,
        framesStable: 0,
        requiredFrames: 10,
        lastX: 0, xOffset: 0, yOffset: 0,
        isCalibrated: false
    },

    data: { x: 0, y: 0, tilt: 0, presence: false },
    raw: { x: 0, y: 0, tilt: 0 },

    init: function() {
        this.video = document.getElementById('input-video');
        try {
            this.pose = new Pose({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`});
            this.pose.setOptions({
                modelComplexity: 0,
                smoothLandmarks: true,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5
            });
            this.pose.onResults(this.onResults.bind(this));
        } catch(e) { console.error("Vision Init Error", e); }
    },

    start: async function() {
        if (!this.video || !this.pose) return false;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: {ideal: 640}, height: {ideal: 480}, frameRate: {ideal: 30} },
                audio: false
            });
            this.video.srcObject = stream;
            await this.video.play();
            
            const feed = document.getElementById('camera-feed');
            if(feed) { feed.srcObject = stream; feed.play(); feed.style.opacity = 0.4; }

            this.active = true;
            this.loop();
            return true;
        } catch(e) { return false; }
    },

    calibrate: function() {
        this.calibration.active = true;
        this.calibration.framesStable = 0;
        this.calibration.isCalibrated = false;
    },

    stop: function() {
        this.active = false;
        if(this.video && this.video.srcObject) {
            this.video.srcObject.getTracks().forEach(t => t.stop());
        }
        const feed = document.getElementById('camera-feed');
        if(feed) feed.style.opacity = 0;
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

        let currX = (0.5 - nose.x) * 3.5; 
        let currY = (0.5 - nose.y) * 4.0;
        let currTilt = (earL.y - earR.y) * 10;

        if (this.calibration.active) {
            const delta = Math.abs(currX - this.calibration.lastX);
            if (delta < 0.05) this.calibration.framesStable++;
            else this.calibration.framesStable = 0;
            
            this.calibration.lastX = currX;

            if (this.calibration.framesStable > this.calibration.requiredFrames) {
                this.calibration.xOffset = currX;
                this.calibration.yOffset = currY;
                this.calibration.isCalibrated = true;
                this.calibration.active = false;
                console.log("Calibrado!");
            }
        }

        if (this.calibration.isCalibrated) {
            currX -= this.calibration.xOffset;
            currY -= this.calibration.yOffset;
        }

        this.raw.x = currX;
        this.raw.y = currY;
        
        // Suavização
        this.data.x += (currX - this.data.x) * 0.2;
        this.data.y += (currY - this.data.y) * 0.2;
        this.data.tilt = currTilt;
        
        this.data.x = Math.max(-1.5, Math.min(1.5, this.data.x));
    }
};

window.Vision = Vision;
