/**
 * NEO-WII Input Manager v26.1 (PLATINUM)
 * Fixes: Action Pipeline, Safe Vision Stop, Nintendo Smoothing.
 */
const Input = {
    // Vetores de Saída Suavizados
    x: 0, 
    y: 0, 
    steering: 0, 
    throttle: 0, 
    action: 0, // Agora alimentado corretamente
    
    // Variáveis Internas
    lastY: 0, 
    lastTime: 0, 
    velocityY: 0, 
    source: 'TOUCH',
    
    // Constantes de Suavização (Alpha do EMA)
    SMOOTHING: {
        kart: 0.18, 
        run:  0.22, 
        zen:  0.06  
    },

    init: function() {
        const zone = document.getElementById('touch-controls');
        if(zone) {
            zone.addEventListener('touchmove', (e) => {
                e.preventDefault();
                this.source = 'TOUCH';
                this.x = ((e.touches[0].clientX / window.innerWidth) - 0.5) * 3.0;
                this.throttle = 1.0;
            }, {passive: false});
            
            zone.addEventListener('touchend', () => { 
                if(this.source==='TOUCH') { this.x = 0; } 
            });
        }
        
        window.addEventListener('deviceorientation', (e) => {
            if(this.source === 'TOUCH' || this.source === 'CAM') return;
            this.source = 'TILT';
            const rawTilt = (e.gamma || 0) / 20;
            this.x = rawTilt; 
            this.throttle = 1.0;
        });
        
        this.lastTime = Date.now();
    },

    forceMode: function(mode) {
        this.source = mode;
        console.log("🎮 Input Force:", mode);
        
        if(mode === 'CAM') {
            if(typeof Vision !== 'undefined') Vision.start().catch(console.error);
        } else {
            // FIX 2: Checagem defensiva antes de parar
            if(typeof Vision !== 'undefined' && Vision.stop) Vision.stop();
        }
        
        Game.togglePause(false);
    },

    update: function(mode) {
        let rawSteering = 0;

        // 1. CAPTURA DE SINAL BRUTO
        if (typeof Vision !== 'undefined' && Vision.active && Vision.data.presence) {
            this.source = 'CAM';
            
            rawSteering = Vision.data.x;
            this.y = Vision.data.y; 

            // Física de Corrida (Delta Y)
            const now = Date.now();
            const dt = now - this.lastTime;
            
            if (dt > 60) { 
                const rawDelta = Math.abs(Vision.raw.y - this.lastY);
                const effectiveDelta = (rawDelta > 0.03) ? rawDelta : 0;
                
                const effort = Math.min(1.0, effectiveDelta * 5); 
                const curvedEffort = 1 - Math.pow(1 - effort, 2);
                
                this.velocityY = curvedEffort * 1.5; 
                this.lastY = Vision.raw.y;
                this.lastTime = now;
            }
            
            if(mode === 'run') this.throttle = this.velocityY;
            
        } else {
            // Fallback
            rawSteering = Math.max(-1.5, Math.min(1.5, this.x));
            if(this.source === 'TOUCH' && this.x === 0) this.throttle = 0.5;
            else if(this.source === 'TILT') this.throttle = 1.0;
        }

        // 2. MICRO-LATÊNCIA (EMA FILTER)
        const alpha = this.SMOOTHING[mode] || 0.15;
        this.steering += (rawSteering - this.steering) * alpha;
        
        // Snap-back assistido
        if (Math.abs(rawSteering) < 0.05) {
             this.steering += (0 - this.steering) * 0.1;
        }

        // FIX 3: Alimentar Action (Link Vital para Zen e Feedback)
        // Action segue o throttle com um leve delay para parecer orgânico
        this.action += (this.throttle - this.action) * 0.1;
    }
};

window.Input = Input;
