/**
 * NEO-WII Feedback System
 * Gerencia Áudio Procedural (Web Audio API) e Haptics (Vibration API).
 * Filosofia: Feedback imediato e satisfatório.
 */
const Feedback = {
    ctx: null,
    masterGain: null,
    enabled: false,

    init: function() {
        if (this.ctx) return;
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.3; // Volume geral seguro
        this.masterGain.connect(this.ctx.destination);
        this.enabled = true;
    },

    // Motor de Vibração Híbrido
    rumble: function(type) {
        if (!navigator.vibrate) return;
        
        switch(type) {
            case 'impact': navigator.vibrate([30, 50, 30]); break; // Batida forte
            case 'bump': navigator.vibrate(40); break;             // Colisão leve
            case 'ui': navigator.vibrate(10); break;               // Clique de menu
            case 'boost': navigator.vibrate([10, 10, 10, 10]); break; // Aceleração
        }
    },

    // Sintetizador de Efeitos Sonoros (Nintendo Style)
    sfx: function(type) {
        if (!this.enabled || this.ctx.state === 'suspended') this.ctx?.resume();
        if (!this.ctx) return;

        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.connect(gain);
        gain.connect(this.masterGain);

        switch(type) {
            case 'start': // Som de "Start" otimista (Mario-like)
                osc.type = 'square';
                osc.frequency.setValueAtTime(440, t);
                osc.frequency.exponentialRampToValueAtTime(880, t + 0.1);
                gain.gain.setValueAtTime(0.1, t);
                gain.gain.linearRampToValueAtTime(0, t + 0.5);
                osc.start(); osc.stop(t + 0.5);
                break;

            case 'coin': // Coleta aguda e rápida
                osc.type = 'sine';
                osc.frequency.setValueAtTime(1200, t);
                osc.frequency.linearRampToValueAtTime(1800, t + 0.1);
                gain.gain.setValueAtTime(0.1, t);
                gain.gain.linearRampToValueAtTime(0, t + 0.15);
                osc.start(); osc.stop(t + 0.15);
                break;

            case 'engine': // Drone de fundo (Zen/Kart)
                // Nota: Motores contínuos devem ser gerenciados em loop separado,
                // aqui é apenas um exemplo de "rev".
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(100, t);
                osc.frequency.linearRampToValueAtTime(60, t + 0.3);
                gain.gain.setValueAtTime(0.05, t);
                gain.gain.linearRampToValueAtTime(0, t + 0.3);
                osc.start(); osc.stop(t + 0.3);
                break;

            case 'crash': // Ruído branco/Sawtooth grave
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(100, t);
                osc.frequency.exponentialRampToValueAtTime(10, t + 0.3);
                gain.gain.setValueAtTime(0.2, t);
                gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
                osc.start(); osc.stop(t + 0.3);
                break;
        }
    }
};

window.Feedback = Feedback;
