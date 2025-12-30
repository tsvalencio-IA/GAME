/**
 * NEO-WII INPUT SYSTEM vFINAL
 * Gerencia inputs de Teclado, Toque, Mouse e Sensores.
 * Normaliza tudo para "Intenções" com curvas de resposta profissionais.
 */

const Input = {
    // Estado Público (Normalizado -1.0 a 1.0)
    intentX: 0, 
    intentY: 0,
    kineticEnergy: 0, // 0.0 a 1.0 (Energia acumulada para Run)
    jitter: 0,        // Medidor de instabilidade (Para Zen)

    // Configurações de Tuning (Nintendo Feel)
    CONFIG: {
        deadzone: 0.08,    // Ignora micro-movimentos involuntários
        sensitivity: 1.2,  // Ganho geral
        exponent: 3        // Curva de resposta (3 = precisão fina no centro)
    },

    // Estado Interno
    _sources: {
        keyboard: { x: 0, y: 0, energy: 0 },
        touch: { x: 0, y: 0, energy: 0 },
        vision: { x: 0, y: 0, energy: 0 },
        tilt: { x: 0, y: 0, energy: 0 }
    },

    // Histórico para análise temporal
    _history: { x: [] },

    init: function() {
        this._setupKeyboard();
        this._setupTouch();
        this._setupTilt();
        console.log("🎮 Input System: Ready & Calibrated.");
    },

    // Chamado por sensores externos (Vision.js)
    setSensorData: function(source, x, y, energy) {
        if (this._sources[source]) {
            // Suavização leve na entrada bruta (Low-pass filter)
            this._sources[source].x += (x - this._sources[source].x) * 0.5;
            this._sources[source].y += (y - this._sources[source].y) * 0.5;
            this._sources[source].energy = energy;
        }
    },

    update: function() {
        // 1. FUSÃO DE SENSORES (Soma ponderada)
        // Permite usar teclado E inclinar o celular ao mesmo tempo sem conflito
        let rawX = this._sources.keyboard.x + this._sources.touch.x + this._sources.vision.x + this._sources.tilt.x;
        let rawY = this._sources.keyboard.y + this._sources.touch.y + this._sources.vision.y + this._sources.tilt.y;
        
        // Energia é o máximo entre as fontes (para não cancelar esforço)
        let rawEnergy = Math.max(this._sources.keyboard.energy, this._sources.touch.energy, this._sources.vision.energy, this._sources.tilt.energy);

        // 2. INPUT SHAPING (A Mágica do Controle)
        this.intentX = this._processAxis(rawX);
        this.intentY = this._processAxis(rawY); // Y geralmente linear para aceleração
        
        // 3. CÁLCULO DE JITTER (Para Zen/Biofeedback)
        this._calculateJitter(this.intentX);

        // 4. KINETIC ENERGY (Decaimento natural)
        // Se houver input forte, a energia sobe. Se parar, cai suavemente.
        if (rawEnergy > 0.1) {
            this.kineticEnergy += (rawEnergy - this.kineticEnergy) * 0.1;
        } else {
            this.kineticEnergy *= 0.95; // Decaimento de inércia
        }
    },

    // Aplica Deadzone e Curva Exponencial
    _processAxis: function(val) {
        val = Math.max(-1, Math.min(1, val)); // Clamp inicial

        if (Math.abs(val) < this.CONFIG.deadzone) return 0;

        // Re-mapear para 0..1 após deadzone
        const sign = Math.sign(val);
        let magnitude = (Math.abs(val) - this.CONFIG.deadzone) / (1 - this.CONFIG.deadzone);

        // Curva de Resposta (Cúbica é o padrão ouro para direção)
        magnitude = Math.pow(magnitude, this.CONFIG.exponent);

        return sign * magnitude * this.CONFIG.sensitivity;
    },

    _calculateJitter: function(val) {
        this._history.x.push(val);
        if(this._history.x.length > 15) this._history.x.shift();
        
        // Jitter é a variância do movimento recente
        let avg = this._history.x.reduce((a,b)=>a+b,0) / this._history.x.length;
        let variance = this._history.x.reduce((a,b)=>a + Math.abs(b-avg), 0) / this._history.x.length;
        this.jitter = variance; 
    },

    // --- Fontes Internas ---
    _setupKeyboard: function() {
        window.addEventListener('keydown', e => {
            if(e.repeat) return;
            switch(e.code) {
                case 'ArrowLeft': case 'KeyA': this._sources.keyboard.x = -1; break;
                case 'ArrowRight': case 'KeyD': this._sources.keyboard.x = 1; break;
                case 'ArrowUp': case 'KeyW': this._sources.keyboard.y = 1; this._sources.keyboard.energy = 1; break;
                case 'ArrowDown': case 'KeyS': this._sources.keyboard.y = -1; break;
            }
        });
        window.addEventListener('keyup', e => {
            switch(e.code) {
                case 'ArrowLeft': case 'KeyA': case 'ArrowRight': case 'KeyD': this._sources.keyboard.x = 0; break;
                case 'ArrowUp': case 'KeyW': case 'ArrowDown': case 'KeyS': 
                    this._sources.keyboard.y = 0; 
                    this._sources.keyboard.energy = 0; 
                    break;
            }
        });
    },

    _setupTouch: function() {
        const el = document.getElementById('touch-controls');
        if(!el) return;
        
        el.addEventListener('touchmove', e => {
            e.preventDefault();
            const t = e.touches[0];
            const cx = window.innerWidth / 2;
            const cy = window.innerHeight / 2;
            
            // X: Direção (-1 a 1)
            this._sources.touch.x = (t.clientX - cx) / (cx * 0.8);
            
            // Y: Toque na parte superior = Acelerar
            if (t.clientY < cy) {
                this._sources.touch.y = 1.0;
                this._sources.touch.energy = 1.0;
            } else {
                this._sources.touch.y = 0;
            }
        }, {passive: false});

        el.addEventListener('touchend', () => {
            this._sources.touch.x = 0; 
            this._sources.touch.y = 0; 
            this._sources.touch.energy = 0;
        });
    },

    _setupTilt: function() {
        if (!window.DeviceOrientationEvent) return;
        
        window.addEventListener('deviceorientation', e => {
            if(e.gamma === null) return;
            
            // Gamma: Esquerda/Direita (Limitado a 45 graus para conforto)
            this._sources.tilt.x = Math.max(-1, Math.min(1, e.gamma / 40));
            
            // Beta: Frente/Trás (Inclinou pra frente > 15 graus = Acelera)
            // Isso cria o pedal de acelerador físico
            const tiltForward = e.beta || 0;
            this._sources.tilt.y = (tiltForward > 10 && tiltForward < 90) ? 1.0 : 0;
            
            // Energia baseada na agitação
            // (Implementação simples, Vision fará melhor)
        });
    }
};

// Inicialização automática segura
if (document.readyState === 'complete') {
    Input.init();
} else {
    window.addEventListener('load', () => Input.init());
}
