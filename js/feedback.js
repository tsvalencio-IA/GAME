/**
 * FEEDBACK SYSTEM v2.0
 * Gerencia efeitos visuais de UI, vibração e "screen shake".
 * Não afeta a física, apenas a percepção.
 */

const Feedback = {
    trigger: function(type) {
        if (navigator.vibrate) {
            if (type === 'collision') navigator.vibrate([50, 50, 50]);
            if (type === 'coin') navigator.vibrate(20);
            if (type === 'boost') navigator.vibrate(100);
        }

        this.visualEffect(type);
    },

    visualEffect: function(type) {
        const body = document.body;
        
        // Reset
        body.style.transition = 'none';
        body.style.transform = 'translate(0,0)';

        if (type === 'collision') {
            // Screen Shake
            let shake = 0;
            const interval = setInterval(() => {
                const x = (Math.random() - 0.5) * 20;
                const y = (Math.random() - 0.5) * 20;
                body.style.transform = `translate(${x}px, ${y}px)`;
                shake++;
                if (shake > 10) {
                    clearInterval(interval);
                    body.style.transform = 'none';
                }
            }, 16);
            
            // Red Flash
            this.flashScreen('rgba(255,0,0,0.3)');
        } 
        
        if (type === 'boost') {
            // Zoom effect
            body.style.transition = 'transform 0.2s';
            body.style.transform = 'scale(1.05)';
            setTimeout(() => body.style.transform = 'none', 200);
            this.flashScreen('rgba(0,255,255,0.2)');
        }
        
        if (type === 'coin') {
            this.flashScreen('rgba(255,255,0,0.2)');
        }
    },

    flashScreen: function(color) {
        let overlay = document.getElementById('feedback-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'feedback-overlay';
            overlay.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:999; transition: background 0.1s;";
            document.body.appendChild(overlay);
        }
        
        overlay.style.background = color;
        setTimeout(() => overlay.style.background = 'transparent', 100);
    }
};
