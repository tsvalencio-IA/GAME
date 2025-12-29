/**
 * NEO-WII Input Manager
 * O "Controller Driver" virtual.
 * Responsável por traduzir dados brutos em intenção de jogo.
 */
const Input = {
    // Vetores de Saída (O que o jogo lê)
    steering: 0, // -1 a 1
    throttle: 0, // 0 a 1
    action: 0,   // Genérico (Pulo/Drift)
    
    // Estado Interno
    source: 'TOUCH', // 'TOUCH', 'TILT', 'CAM'
    lastTime: 0,
    lastY: 0,
    
    // Configuração de Tilt
    tiltPermission: false,

    init: function() {
        this.bindTouch();
        this.bindTilt();
        this.lastTime = Date.now();
    },

    bindTouch: function() {
        const zone = document.getElementById('touch-controls');
        if(!zone) return;

        zone.addEventListener('touchmove', (e) => {
            e.preventDefault(); // Prevenir scroll
            this.source = 'TOUCH';
            // Mapeia toque: Centro = 0. Esquerda = -1, Direita = 1
            const touchX = e.touches[0].clientX / window.innerWidth;
            this.steering = (touchX - 0.5) * 2.5;
            this.throttle = 1.0; // Toque sempre acelera
        }, {passive: false});

        zone.addEventListener('touchend', () => {
            if(this.source === 'TOUCH') {
                this.steering = 0;
                this.throttle = 0; // Soltou, parou
            }
        });
    },

    bindTilt: function() {
        window.addEventListener('deviceorientation', (e) => {
            if (this.source === 'TOUCH' || this.source === 'CAM') return;
            this.source = 'TILT';
            
            // Gamma é a inclinação lateral (-90 a 90)
            const rawTilt = e.gamma || 0;
            
            // Assistência de Centro (Deadzone inteligente)
            if (Math.abs(rawTilt) < 5) {
                this.steering = 0;
            } else {
                this.steering = rawTilt / 20; // Sensibilidade
            }
            this.throttle = 1.0; // Tilt assume aceleração automática
        });
    },

    requestTiltPermission: function() {
        if (typeof DeviceOrientationEvent !== 'undefined' && 
            typeof DeviceOrientationEvent.requestPermission === 'function') {
            return DeviceOrientationEvent.requestPermission()
                .then(response => {
                    this.tiltPermission = (response === 'granted');
                    return this.tiltPermission;
                })
                .catch(console.error);
        }
        return Promise.resolve(true);
    },

    // --- CORREÇÃO CRÍTICA: Função exigida pelo HTML do Pause ---
    forceMode: function(mode) {
        this.source = mode;
        // Reseta vetores para evitar inputs "presos" ao trocar de modo
        this.steering = 0;
        this.throttle = 0;
        this.action = 0;
        console.log("Input: Modo forçado para", mode);
    },

    // GAME LOOP DE INPUT
    update: function(mode) {
        // Se a câmera detectar alguém, ela assume prioridade
        if (Vision.active && Vision.data.presence) {
            this.source = 'CAM';
            this.processCameraInput(mode);
        }

        // Clamp final para segurança
        this.steering = Math.max(-1.5, Math.min(1.5, this.steering));
        this.throttle = Math.max(0, Math.min(1.2, this.throttle));
    },

    processCameraInput: function(mode) {
        const vData = Vision.data;

        switch(mode) {
            case 'kart':
                this.steering += (vData.x - this.steering) * 0.15;
                this.throttle = 1.0; 
                break;

            case 'run':
                const now = Date.now();
                const dt = now - this.lastTime;
                
                if (dt > 60) {
                    const deltaY = Math.abs(Vision.raw.y - this.lastY);
                    const movement = (deltaY > 0.03) ? deltaY : 0;
                    
                    const effort = Math.min(1.0, movement * 6.0);
                    const speedTarget = 1 - Math.pow(1 - effort, 2);
                    
                    this.throttle = speedTarget * 1.5;
                    this.lastY = Vision.raw.y;
                    this.lastTime = now;
                }
                this.steering += (vData.x - this.steering) * 0.1;
                break;

            case 'zen':
                this.steering += (vData.x - this.steering) * 0.03;
                const breathe = Math.sin(Date.now() / 1000) * 0.1;
                const targetY = vData.y + breathe;
                this.action += (targetY - this.action) * 0.03;
                this.throttle = 0.5;
                break;
        }
    }
};

window.Input = Input;
