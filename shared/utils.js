window.Utils = {
    limit: (v, min, max) => Math.max(min, Math.min(v, max)),
    percentRemaining: (n, total) => (n % total) / total,
    randomInt: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
    formatTime: (dt) => {
        const m = Math.floor(dt/60000);
        const s = Math.floor((dt%60000)/1000);
        return `${m}:${s.toString().padStart(2,'0')}`;
    }
};