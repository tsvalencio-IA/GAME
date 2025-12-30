/**
 * VISION SENSOR v1.0
 * Captura movimento óptico simples para simular Tilt.
 */

const Vision = {
    active: false,
    video: null,
    canvas: null,
    ctx: null,
    lastFrameData: null,
    sensitivity: 25, 

    init: async function() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            console.log("🚫 Vision: Câmera não suportada.");
            return;
        }

        try {
            this.video = document.createElement('video');
            const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
            this.video.srcObject = stream;
            this.video.play();
            
            this.canvas = document.createElement('canvas');
            this.canvas.width = 320;
            this.canvas.height = 240;
            this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
            
            this.active = true;
            this.loop();
        } catch (e) {
            console.log("🚫 Vision: Permissão negada.");
        }
    },

    loop: function() {
        if (!this.active) return;
        this.ctx.drawImage(this.video, 0, 0, 320, 240);
        const frame = this.ctx.getImageData(0, 0, 320, 240);
        const diffX = this.calculateCenterOfMotion(frame.data);

        let outputX = 0;
        if (Math.abs(diffX) > 2) { 
            outputX = Math.max(-1, Math.min(1, diffX / this.sensitivity));
        }

        if (typeof Input !== 'undefined') {
            // Envia para o Input unificado
            Input.setSensorData('vision', -outputX, 0, Math.abs(outputX)); 
        }
        requestAnimationFrame(() => this.loop());
    },

    calculateCenterOfMotion: function(data) {
        if (!this.lastFrameData) {
            this.lastFrameData = new Uint8ClampedArray(data);
            return 0;
        }
        let leftMotion = 0, rightMotion = 0;
        const width = 320, halfWidth = width / 2;

        for (let i = 0; i < data.length; i += 16) { 
            const diff = Math.abs(data[i] - this.lastFrameData[i]); 
            if (diff > 30) { 
                const x = (i / 4) % width;
                if (x < halfWidth) leftMotion += diff; else rightMotion += diff;
            }
            this.lastFrameData[i] = data[i]; 
        }
        const total = leftMotion + rightMotion;
        if (total < 1000) return 0; 
        return (rightMotion - leftMotion) / 1000;
    }
};
