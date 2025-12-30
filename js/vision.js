/**
 * VISION SENSOR v1.0
 * Captura movimento óptico simples para simular Tilt.
 * Não interfere se não houver câmera.
 */

const Vision = {
    active: false,
    video: null,
    canvas: null,
    ctx: null,
    lastFrameData: null,
    sensitivity: 25, // Ajuste de sensibilidade

    init: async function() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            console.log("🚫 Vision: Câmera não suportada. Modo legado ativo.");
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
            console.log("👁️ Vision: Sensor Óptico Ativo.");
            this.loop();
        } catch (e) {
            console.log("🚫 Vision: Permissão negada ou erro. Jogando sem corpo.");
        }
    },

    loop: function() {
        if (!this.active) return;

        // Desenha frame atual
        this.ctx.drawImage(this.video, 0, 0, 320, 240);
        
        // Processamento leve (Optical Flow simplificado)
        // Detecta onde há mais mudança de pixel (esquerda ou direita)
        const frame = this.ctx.getImageData(0, 0, 320, 240);
        const diffX = this.calculateCenterOfMotion(frame.data);

        // Converte movimento em INTENÇÃO para o Input.js
        // Se diffX for positivo (movimento à direita), outputX vai para 1
        let outputX = 0;
        if (Math.abs(diffX) > 2) { // Deadzone visual
            outputX = Math.max(-1, Math.min(1, diffX / this.sensitivity));
        }

        // Injeta a intenção no sistema central
        // Inverte-se outputX pois no espelho, mover-se à direita (tela) é esquerda (usuário) ou vice-versa, ajuste conforme necessário
        if (typeof Input !== 'undefined') {
            Input.setSensorData(-outputX, 0, 0); // Apenas eixo X por enquanto (tilt)
        }

        requestAnimationFrame(() => this.loop());
    },

    calculateCenterOfMotion: function(data) {
        if (!this.lastFrameData) {
            this.lastFrameData = new Uint8ClampedArray(data);
            return 0;
        }

        let leftMotion = 0;
        let rightMotion = 0;
        const width = 320;
        const halfWidth = width / 2;

        // Amostragem rápida (pula pixels para performance)
        for (let i = 0; i < data.length; i += 16) { 
            const diff = Math.abs(data[i] - this.lastFrameData[i]); // Diferença de brilho (Canal R)
            if (diff > 30) { // Threshold de ruído
                const x = (i / 4) % width;
                if (x < halfWidth) leftMotion += diff;
                else rightMotion += diff;
            }
            this.lastFrameData[i] = data[i]; // Atualiza histórico
        }

        // Se houver muito mais movimento de um lado, assume inclinação
        const total = leftMotion + rightMotion;
        if (total < 1000) return 0; // Movimento insuficiente

        // Retorna balanço (-sensibilidade a +sensibilidade)
        return (rightMotion - leftMotion) / 1000;
    }
};

// Inicia se o usuário permitir (pode ser ligado por um botão na UI também)
// Por padrão, tenta iniciar silenciosamente ou aguarda interação do usuário
// Vision.init(); 
