// =============================================================================
// KART LEGENDS: TITANIUM MASTER FINAL V22 (COMBATE REALISTA, ECONOMIA E FÍSICA)
// ARQUITETO: SENIOR GAME ENGINE ARCHITECT
// STATUS: 100% COMPLETO. MÍSSEIS INTELIGENTES, RECUPERAÇÃO DE VOO, 1000 REAIS/MOEDA.
// =============================================================================

(function() {

    // -----------------------------------------------------------------
    // 1. DADOS E CONFIGURAÇÕES
    // -----------------------------------------------------------------
    const AI_DIFFICULTY_SETTINGS = {
        'EASY':   { speedMult: 0.90, accelMult: 0.9,  reaction: 0.05, lookAhead: 15, errorRate: 0.08, rubberBand: 0.0 },
        'MEDIUM': { speedMult: 1.05, accelMult: 1.1,  reaction: 0.10, lookAhead: 25, errorRate: 0.05, rubberBand: 0.2 },
        'HARD':   { speedMult: 1.25, accelMult: 1.4,  reaction: 0.25, lookAhead: 40, errorRate: 0.02, rubberBand: 0.4 } 
    };
    
    const CURRENT_DIFFICULTY = 'HARD'; 

    const CHARACTERS = [
        { id: 0, name: 'MARIO',  color: '#e74c3c', hat: '#d32f2f', speedInfo: 1.00, turnInfo: 1.00, weight: 1.0, accel: 0.040, aggression: 0.6 },
        { id: 1, name: 'LUIGI',  color: '#2ecc71', hat: '#27ae60', speedInfo: 1.05, turnInfo: 0.90, weight: 1.0, accel: 0.038, aggression: 0.5 },
        { id: 2, name: 'PEACH',  color: '#ff9ff3', hat: '#fd79a8', speedInfo: 0.98, turnInfo: 1.15, weight: 0.8, accel: 0.055, aggression: 0.3 },
        { id: 3, name: 'BOWSER', color: '#f1c40f', hat: '#e67e22', speedInfo: 1.15, turnInfo: 0.70, weight: 1.6, accel: 0.025, aggression: 0.95 },
        { id: 4, name: 'TOAD',   color: '#3498db', hat: '#ecf0f1', speedInfo: 0.92, turnInfo: 1.25, weight: 0.6, accel: 0.070, aggression: 0.4 },
        { id: 5, name: 'YOSHI',  color: '#76ff03', hat: '#64dd17', speedInfo: 1.02, turnInfo: 1.10, weight: 0.9, accel: 0.045, aggression: 0.5 },
        { id: 6, name: 'DK',     color: '#795548', hat: '#5d4037', speedInfo: 1.12, turnInfo: 0.80, weight: 1.5, accel: 0.030, aggression: 0.9 },
        { id: 7, name: 'WARIO',  color: '#ffeb3b', hat: '#fbc02d', speedInfo: 1.08, turnInfo: 0.85, weight: 1.5, accel: 0.032, aggression: 0.95 }
    ];

    const KART_MODELS = [
        { id: 0, name: 'KART PADRÃO', type: 'standard', price: 0, speedBonus: 0.0, turnBonus: 0.0, weightBonus: 0.0, color: '#bdc3c7', desc: 'Kart equilibrado de fábrica.' },
        { id: 1, name: 'FÓRMULA 1', type: 'f1', price: 2000, speedBonus: 0.25, turnBonus: -0.05, weightBonus: 0.1, color: '#e74c3c', desc: 'Velocidade extrema no asfalto.' },
        { id: 2, name: 'CARRO DE LUXO', type: 'luxury', price: 3000, speedBonus: 0.10, turnBonus: 0.05, weightBonus: 0.3, color: '#2c3e50', desc: 'Elegância, Peso e Estabilidade.' },
        { id: 3, name: 'MOTO SUPER', type: 'moto', price: 1500, speedBonus: 0.15, turnBonus: 0.30, weightBonus: -0.4, color: '#2ecc71', desc: 'Curvas fechadas, muito leve.' },
        { id: 4, name: 'TRATOR', type: 'tractor', price: 3500, speedBonus: -0.10, turnBonus: 0.15, weightBonus: 0.8, color: '#f1c40f', desc: 'Ignora offroad, amassa os rivais.' },
        { id: 5, name: 'TANQUE MILITAR', type: 'tank', price: 6000, speedBonus: -0.15, turnBonus: -0.10, weightBonus: 1.5, color: '#4b6584', desc: 'Blindado. Cascos não fazem cócegas.' },
        { id: 6, name: 'AVIÃO JATO', type: 'plane', price: 8000, speedBonus: 0.40, turnBonus: 0.05, weightBonus: -0.2, color: '#ffffff', desc: 'Praticamente voa sobre a pista!' }
    ];

    const TRACKS = [
        { id: 0, name: 'COGUMELO CUP', theme: 'grass', sky: 0, curveMult: 1.0 },
        { id: 1, name: 'DESERTO KALIMARI', theme: 'sand', sky: 1, curveMult: 0.8 },
        { id: 2, name: 'MONTANHA GELADA', theme: 'snow', sky: 2, curveMult: 1.3 }
    ];

    const CONF = {
        MAX_SPEED: 235, TURBO_MAX_SPEED: 350, FRICTION: 0.98, OFFROAD_DECEL: 0.92, ROAD_WIDTH: 2000,
        SEGMENT_LENGTH: 200, DRAW_DISTANCE: 300, RUMBLE_LENGTH: 3, TOTAL_LAPS: 3,
        CAMERA_LERP: 0.08, CAMERA_DEPTH: 1.0 
    };

    const SAFETY = { ZOMBIE_TIMEOUT: 15000, MAX_RACE_TIME: 300000, MAINTENANCE_RATE: 2000 };
    const PHYSICS = { gripAsphalt: 0.98, gripZebra: 0.85, gripOffroad: 0.35, centrifugalForce: 0.16, momentumTransfer: 1.6, steerSensitivity: 0.0555, lateralInertiaDecay: 0.95 };

    const KartAudio = {
        ctx: null, masterGain: null, osc1: null, osc2: null, engineGain: null, noiseBuffer: null, noiseSource: null, noiseFilter: null, noiseGain: null, initialized: false, isPlaying: false,
        init: function() {
            if (this.initialized) return;
            try {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                this.ctx = new AudioContext(); this.masterGain = this.ctx.createGain(); this.masterGain.gain.value = 0.3; this.masterGain.connect(this.ctx.destination);
                const bufferSize = this.ctx.sampleRate; this.noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
                const data = this.noiseBuffer.getChannelData(0); for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
                this.initialized = true;
            } catch (e) { }
        },
        start: function() {
            if (!this.initialized || this.isPlaying) return;
            this.ctx.resume(); const t = this.ctx.currentTime;
            this.osc1 = this.ctx.createOscillator(); this.osc1.type = 'sawtooth'; this.osc2 = this.ctx.createOscillator(); this.osc2.type = 'triangle'; 
            this.engineGain = this.ctx.createGain(); this.engineGain.gain.value = 0;
            this.osc1.connect(this.engineGain); this.osc2.connect(this.engineGain); this.engineGain.connect(this.masterGain); this.osc1.start(t); this.osc2.start(t);
            this.noiseSource = this.ctx.createBufferSource(); this.noiseSource.buffer = this.noiseBuffer; this.noiseSource.loop = true;
            this.noiseFilter = this.ctx.createBiquadFilter(); this.noiseFilter.type = 'bandpass'; this.noiseGain = this.ctx.createGain(); this.noiseGain.gain.value = 0;
            this.noiseSource.connect(this.noiseFilter); this.noiseFilter.connect(this.noiseGain); this.noiseGain.connect(this.masterGain); this.noiseSource.start(t); this.isPlaying = true;
        },
        stop: function() {
            if (!this.isPlaying) return;
            try { const t = this.ctx.currentTime + 0.1; this.osc1.stop(t); this.osc2.stop(t); this.noiseSource.stop(t); setTimeout(() => { this.osc1.disconnect(); this.osc2.disconnect(); this.engineGain.disconnect(); this.noiseSource.disconnect(); this.noiseFilter.disconnect(); this.noiseGain.disconnect(); }, 200); } catch(e){}
            this.isPlaying = false;
        },
        update: function(speed, maxSpeed, driftIntensity, isOffroad, isTurbo) {
            if (!this.isPlaying) return;
            const ratio = Math.abs(speed) / maxSpeed; const now = this.ctx.currentTime;
            const baseFreq = 60 + (ratio * 240); this.osc1.frequency.setTargetAtTime(baseFreq, now, 0.1); this.osc2.frequency.setTargetAtTime(baseFreq * 0.5, now, 0.1);
            const idleWobble = (speed < 5) ? (Math.sin(now * 20) * 0.05) : 0; this.engineGain.gain.setTargetAtTime(0.1 + (ratio * 0.1) + idleWobble, now, 0.1);
            if (isTurbo) { this.osc1.frequency.setTargetAtTime(baseFreq * 1.5, now, 0.2); this.engineGain.gain.setTargetAtTime(0.3, now, 0.1); }
            let targetNoiseVol = 0; let targetFilterFreq = 800; let targetQ = 1;
            if (isOffroad) { targetNoiseVol = Math.min(0.4, ratio * 0.5); targetFilterFreq = 400; targetQ = 0.5; } else if (Math.abs(driftIntensity) > 0.15 && speed > 50) { targetNoiseVol = Math.min(0.3, (Math.abs(driftIntensity) - 0.15) * 2.0); targetFilterFreq = 1200 + (ratio * 500); targetQ = 5; }
            this.noiseGain.gain.setTargetAtTime(targetNoiseVol, now, 0.1); this.noiseFilter.frequency.setTargetAtTime(targetFilterFreq, now, 0.1); this.noiseFilter.Q.setTargetAtTime(targetQ, now, 0.1);
        },
        crash: function() {
            if(!this.initialized) return;
            const t = this.ctx.currentTime; const osc = this.ctx.createOscillator(); const g = this.ctx.createGain();
            osc.frequency.setValueAtTime(100, t); osc.frequency.exponentialRampToValueAtTime(10, t + 0.3); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
            osc.type = 'square'; osc.connect(g); g.connect(this.masterGain); osc.start(t); osc.stop(t + 0.3);
        }
    };

    let segments = []; let trackLength = 0; let minimapPath = []; let minimapBounds = {minX:0, maxX:0, minZ:0, maxZ:0, w:1, h:1};
    let hudMessages = []; let particles = []; let nitroBtn = null; let resetBtn = null; 
    const DUMMY_SEG = { curve: 0, y: 0, color: 'light', obs: [], theme: 'grass' };

    function getSegment(index) { if (!segments || segments.length === 0) return DUMMY_SEG; const len = segments.length; const i = ((Math.floor(index) % len) + len) % len; return segments[i] || DUMMY_SEG; }

    function buildMiniMap(segments) {
        minimapPath = []; let x = 0, z = 0, angle = 0;
        segments.forEach(seg => { angle -= seg.curve * 0.04; x += Math.sin(angle) * 8; z -= Math.cos(angle) * 8; minimapPath.push({ x, z }); });
        let minX=Infinity, maxX=-Infinity, minZ=Infinity, maxZ=-Infinity;
        minimapPath.forEach(p => { if(p.x < minX) minX = p.x; if(p.x > maxX) maxX = p.x; if(p.z < minZ) minZ = p.z; if(p.z > maxZ) maxZ = p.z; });
        minimapBounds = { minX, maxX, minZ, maxZ, w: maxX-minX || 1, h: maxZ-minZ || 1 };
    }

    function drawCharacterHead(ctx, charId, steer) {
        const stats = CHARACTERS[charId] || CHARACTERS[0]; const n = stats.name;
        ctx.save(); ctx.rotate(steer * 0.3);
        
        if (n === 'DK') {
            ctx.translate(0, -15);
            ctx.fillStyle = '#4e342e'; ctx.beginPath(); ctx.ellipse(0, -20, 28, 30, 0, 0, Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.moveTo(-15, -45); ctx.lineTo(0, -65); ctx.lineTo(15, -45); ctx.fill();
            ctx.fillStyle = '#e74c3c'; ctx.beginPath(); ctx.moveTo(-8, -10); ctx.lineTo(8, -10); ctx.lineTo(0, 15); ctx.fill();
        } 
        else if (n === 'BOWSER') {
            ctx.translate(0, -5);
            ctx.fillStyle = '#27ae60'; ctx.beginPath(); ctx.ellipse(0, -25, 45, 50, 0, 0, Math.PI*2); ctx.fill(); ctx.strokeStyle = '#ecf0f1'; ctx.lineWidth = 8; ctx.stroke(); 
            ctx.fillStyle = '#ecf0f1'; const drawSpike = (sx, sy) => { ctx.beginPath(); ctx.arc(sx, sy, 10, 0, Math.PI*2); ctx.fill(); }; drawSpike(0, -55); drawSpike(-25, -30); drawSpike(25, -30); drawSpike(0, -10);
            ctx.fillStyle = '#e67e22'; ctx.beginPath(); ctx.ellipse(0, -75, 20, 15, 0, 0, Math.PI*2); ctx.fill();
        }
        else if (n === 'YOSHI') {
            ctx.translate(0, -10);
            ctx.fillStyle = '#76ff03'; ctx.beginPath(); ctx.ellipse(0, -20, 20, 30, 0, 0, Math.PI*2); ctx.fill(); ctx.fillStyle = '#e74c3c'; ctx.beginPath(); ctx.ellipse(0, -10, 14, 10, 0, 0, Math.PI*2); ctx.fill(); ctx.fillStyle = '#e74c3c'; ctx.beginPath(); ctx.moveTo(-6, -45); ctx.lineTo(0, -55); ctx.lineTo(6, -45); ctx.fill(); ctx.beginPath(); ctx.moveTo(-5, -30); ctx.lineTo(0, -40); ctx.lineTo(5, -30); ctx.fill();
        }
        else if (n === 'PEACH') {
            ctx.translate(0, -10);
            ctx.fillStyle = '#ff9ff3'; ctx.beginPath(); ctx.ellipse(0, -15, 22, 25, 0, 0, Math.PI*2); ctx.fill(); ctx.fillStyle = '#f1c40f'; ctx.beginPath(); ctx.moveTo(-18, -45); ctx.lineTo(18, -45); ctx.lineTo(22, -10); ctx.lineTo(-22, -10); ctx.fill(); ctx.fillStyle = '#f39c12'; ctx.beginPath(); ctx.moveTo(-12, -45); ctx.lineTo(-18, -60); ctx.lineTo(-5, -50); ctx.lineTo(0, -65); ctx.lineTo(5, -50); ctx.lineTo(18, -60); ctx.lineTo(12, -45); ctx.fill(); ctx.fillStyle = '#3498db'; ctx.beginPath(); ctx.arc(0, -55, 3, 0, Math.PI*2); ctx.fill();
        }
        else if (n === 'WARIO') {
            ctx.translate(0, -10);
            ctx.fillStyle = '#f1c40f'; ctx.beginPath(); ctx.ellipse(0, -15, 32, 25, 0, 0, Math.PI*2); ctx.fill(); ctx.fillStyle = '#8e44ad'; ctx.fillRect(-22, -25, 8, 25); ctx.fillRect(14, -25, 8, 25); ctx.strokeStyle = '#000'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-25, -35); ctx.lineTo(-35, -32); ctx.lineTo(-40, -38); ctx.stroke(); ctx.beginPath(); ctx.moveTo(25, -35); ctx.lineTo(35, -32); ctx.lineTo(40, -38); ctx.stroke(); ctx.fillStyle = '#f1c40f'; ctx.beginPath(); ctx.ellipse(0, -42, 20, 15, 0, 0, Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.ellipse(0, -37, 28, 6, 0, 0, Math.PI*2); ctx.fill();
        }
        else if (n === 'TOAD') {
            ctx.translate(0, -10);
            ctx.fillStyle = '#3498db'; ctx.fillRect(-12, -15, 24, 15); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(0, -35, 32, 22, 0, 0, Math.PI*2); ctx.fill(); ctx.fillStyle = '#e74c3c'; ctx.beginPath(); ctx.ellipse(0, -40, 12, 8, 0, 0, Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.ellipse(-22, -30, 8, 12, 0, 0, Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.ellipse(22, -30, 8, 12, 0, 0, Math.PI*2); ctx.fill();
        }
        else {
            ctx.translate(0, -10);
            ctx.fillStyle = stats.color; ctx.beginPath(); ctx.ellipse(0, -15, 18, 20, 0, 0, Math.PI*2); ctx.fill(); ctx.fillStyle = '#2980b9'; ctx.fillRect(-12, -25, 6, 25); ctx.fillRect(6, -25, 6, 25); ctx.fillRect(-15, -5, 30, 10); ctx.fillStyle = stats.hat; ctx.beginPath(); ctx.ellipse(0, -35, 18, 15, 0, 0, Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.ellipse(0, -30, 22, 6, 0, 0, Math.PI*2); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center'; ctx.fillText(n[0], 0, -10);
        }
        ctx.restore();
    }

    const Logic = {
        state: 'MODE_SELECT', raceState: 'LOBBY', roomId: 'mario_arena_titanium_v8', selectedChar: 0, selectedTrack: 0, isReady: false, isOnline: false, isHost: false,
        dbRef: null, roomRef: null, lastSync: 0, totalRacers: 0, remotePlayersData: {}, localBots: [], maintenanceInterval: null,
        speed: 0, pos: 0, playerX: 0, steer: 0, targetSteer: 0, cameraX: 0, nitro: 100, turboLock: false, gestureTimer: 0, spinAngle: 0, spinTimer: 0, lateralInertia: 0, vibration: 0, engineTimer: 0,
        driftSparks: 0, slipstreamTimer: 0, lap: 1, maxLapPos: 0, status: 'RACING', finishTime: 0, finalRank: 0, score: 0, visualTilt: 0, bounce: 0, skyColor: 0, inputActive: false, virtualWheel: { x:0, y:0, r:60, opacity:0, isHigh: false }, rivals: [], 
        
        currentFase: null, matchCoins: 0,
        item: null, itemCooldown: 0, projectiles: [],

        useCustomKart: false, kartUpgrades: {}, shopHitboxes: [], lobbyHitboxes: [], 
        garage: [{ modelId: 0 }], activeKartIdx: 0, shopTab: 'SHOP', shopCarouselIdx: 0,

        init: function(faseData) { 
            this.cleanup(); this.state = 'MODE_SELECT'; this.setupUI(); this.resetPhysics(); KartAudio.init(); 
            this.currentFase = faseData || { id: 'arcade', mode: 'RACE', targetRank: 3, trackId: 0, diff: 'MEDIUM' }; 

            if (window.Profile) {
                if (!window.Profile.kartSave) window.Profile.kartSave = { garage: [{ modelId: 0 }], activeKartIdx: 0, upgrades: { engine: 1, tires: 1, suspension: 1 } };
                this.garage = window.Profile.kartSave.garage || [{ modelId: 0 }];
                this.activeKartIdx = window.Profile.kartSave.activeKartIdx || 0;
                this.kartUpgrades = window.Profile.kartSave.upgrades || { engine: 1, tires: 1, suspension: 1 };
            } else {
                this.garage = [{ modelId: 0 }];
                this.activeKartIdx = 0;
                this.kartUpgrades = { engine: 1, tires: 1, suspension: 1 };
            }
            this.useCustomKart = false;
        },

        cleanup: function() {
            if (this.dbRef) try { this.dbRef.child('players').off(); } catch(e){}
            if (this.roomRef) try { this.roomRef.off(); } catch(e){}
            if (this.maintenanceInterval) clearInterval(this.maintenanceInterval);
            if(nitroBtn) nitroBtn.remove(); if(resetBtn) resetBtn.remove();
            KartAudio.stop(); window.System.canvas.onpointerdown = null;
        },

        resetPhysics: function() {
            this.speed = 0; this.pos = 0; this.playerX = 0; this.steer = 0; this.cameraX = 0; this.driftSparks = 0; this.slipstreamTimer = 0; 
            this.lap = 1; this.maxLapPos = 0; this.status = 'RACING'; this.finishTime = 0; this.finalRank = 0; this.score = 0; this.nitro = 100; this.spinAngle = 0; this.spinTimer = 0; this.lateralInertia = 0; this.vibration = 0; this.engineTimer = 0; this.inputActive = false; this.rivals = []; this.localBots = []; particles = []; hudMessages = []; this.remotePlayersData = {};
            this.matchCoins = 0; this.item = null; this.itemCooldown = 0; this.projectiles = [];
        },

        pushMsg: function(text, color='#fff', size=40) { hudMessages.push({ text, color, size, life: 90, scale: 0.1 }); },

        setupUI: function() {
            if(nitroBtn) nitroBtn.remove();
            nitroBtn = document.createElement('div'); nitroBtn.id = 'nitro-btn-kart'; nitroBtn.innerHTML = "NITRO";
            Object.assign(nitroBtn.style, { position: 'absolute', bottom: '15%', right: '30px', width: '85px', height: '85px', borderRadius: '50%', background: 'radial-gradient(#ffcc00, #ff6600)', border: '4px solid #fff', color: '#fff', display: 'none', alignItems: 'center', justifyContent: 'center', fontFamily: "'Russo One', sans-serif", fontWeight: "bold", fontSize: '14px', zIndex: '100', cursor: 'pointer', userSelect: 'none', boxShadow: '0 4px 15px rgba(0,0,0,0.3)' });
            
            if(resetBtn) resetBtn.remove();
            resetBtn = document.createElement('div'); resetBtn.id = 'reset-btn-kart'; resetBtn.innerHTML = "RESET SALA";
            Object.assign(resetBtn.style, { position: 'absolute', top: '10px', left: '10px', width: '100px', height: '40px', borderRadius: '5px', background: '#c0392b', border: '2px solid #fff', color: '#fff', display: 'none', alignItems: 'center', justifyContent: 'center', fontFamily: "'Russo One', sans-serif", fontSize: '12px', zIndex: '101', cursor: 'pointer', userSelect: 'none' });

            nitroBtn.addEventListener('mousedown', (e)=>{ e.preventDefault(); if((this.state === 'RACE') && this.nitro >= 20 && !this.turboLock) { this.turboLock = true; window.Sfx.play(600, 'square', 0.1, 0.1); this.pushMsg("TURBO MAX!", "#0ff"); } else if (this.nitro < 20) { this.pushMsg("CARREGANDO...", "#f00", 30); }});
            nitroBtn.addEventListener('touchstart', (e)=>{ e.preventDefault(); if((this.state === 'RACE') && this.nitro >= 20 && !this.turboLock) { this.turboLock = true; window.Sfx.play(600, 'square', 0.1, 0.1); this.pushMsg("TURBO MAX!", "#0ff"); } else if (this.nitro < 20) { this.pushMsg("CARREGANDO...", "#f00", 30); }});
            
            resetBtn.addEventListener('mousedown', (e)=>{ 
                e.preventDefault(); 
                if(this.state === 'LOBBY' && this.isOnline && this.roomRef) { 
                    this.roomRef.update({ raceState: 'LOBBY', totalRacers: 0, raceStartTime: 0 }); 
                    window.System.msg("SALA RESETADA COM SUCESSO!"); 
                    this.pushMsg("SALA RESETADA!", "#0f0", 50);
                }
            });
            resetBtn.addEventListener('touchstart', (e)=>{ 
                e.preventDefault(); 
                if(this.state === 'LOBBY' && this.isOnline && this.roomRef) { 
                    this.roomRef.update({ raceState: 'LOBBY', totalRacers: 0, raceStartTime: 0 }); 
                    window.System.msg("SALA RESETADA COM SUCESSO!"); 
                    this.pushMsg("SALA RESETADA!", "#0f0", 50);
                }
            });
            
            document.getElementById('game-ui').appendChild(nitroBtn); document.getElementById('game-ui').appendChild(resetBtn);

            window.System.canvas.onpointerdown = (e) => {
                const rect = window.System.canvas.getBoundingClientRect(); 
                const cw = window.System.canvas.width; 
                const ch = window.System.canvas.height;
                const scaleX = cw / rect.width;
                const scaleY = ch / rect.height;
                const clickX = (e.clientX - rect.left) * scaleX;
                const clickY = (e.clientY - rect.top) * scaleY;
                const yPct = (e.clientY - rect.top) / rect.height;

                KartAudio.init(); if(KartAudio.ctx && KartAudio.ctx.state === 'suspended') KartAudio.ctx.resume();

                if (this.state === 'MODE_SELECT') { 
                    if (this.currentFase.id === 'arcade') {
                        if (yPct < 0.5) this.selectMode('OFFLINE'); else this.selectMode('ONLINE'); 
                    } else { this.selectMode('OFFLINE'); }
                    window.Sfx.click(); 
                } 
                else if (this.state === 'LOBBY') {
                    if (yPct > 0.8) { 
                        if (this.isOnline) {
                            if (this.isHost) {
                                const activePlayers = Object.values(this.remotePlayersData || {}).filter(p => (Date.now() - p.lastSeen < SAFETY.ZOMBIE_TIMEOUT));
                                if (activePlayers.length >= 2) { this.roomRef.update({ raceState: 'RACING', totalRacers: activePlayers.length, raceStartTime: firebase.database.ServerValue.TIMESTAMP }); } else { window.System.msg("PRECISA DE 2 JOGADORES!"); window.Sfx.play(150, 'sawtooth', 0.3, 0.1); }
                            } else { this.toggleReady(); }
                        } else { this.startRace(this.currentFase.trackId !== undefined ? this.currentFase.trackId : this.selectedTrack); }
                    } else {
                        if (this.lobbyHitboxes) {
                            let clicked = this.lobbyHitboxes.find(b => clickX >= b.x && clickX <= b.x + b.w && clickY >= b.y && clickY <= b.y + b.h);
                            if (clicked) {
                                if (clicked.action === 'change_char') {
                                    this.selectedChar = (this.selectedChar + 1) % CHARACTERS.length; window.Sfx.hover(); if(this.isOnline) this.syncLobby(); 
                                } else if (clicked.action === 'change_track') {
                                    if (this.currentFase.id === 'arcade') {
                                        if(!this.isOnline || this.isHost) { 
                                            this.selectedTrack = (this.selectedTrack + 1) % TRACKS.length; window.Sfx.hover(); if(this.isOnline && this.isHost) this.roomRef.update({ trackId: this.selectedTrack }); 
                                        }
                                    } else { window.Sfx.error(); this.pushMsg("PISTA FIXA NA MISSÃO!", "#f00", 25); }
                                } else if (clicked.action === 'toggle_kart') {
                                    this.useCustomKart = !this.useCustomKart; window.Sfx.hover();
                                } else if (clicked.action === 'open_shop') {
                                    this.state = 'KART_SHOP'; this.shopTab = 'SHOP'; this.shopCarouselIdx = 1; window.Sfx.click();
                                }
                            }
                        }
                    }
                }
                else if (this.state === 'KART_SHOP') {
                    if (this.shopHitboxes) {
                        let clicked = this.shopHitboxes.find(b => clickX >= b.x && clickX <= b.x + b.w && clickY >= b.y && clickY <= b.y + b.h);
                        if (clicked) {
                            if (clicked.action === 'back') { this.state = 'LOBBY'; window.Sfx.click(); } 
                            else if (clicked.action === 'tab_shop') { this.shopTab = 'SHOP'; this.shopCarouselIdx = 1; window.Sfx.hover(); }
                            else if (clicked.action === 'tab_garage') { this.shopTab = 'GARAGE'; this.shopCarouselIdx = 0; window.Sfx.hover(); }
                            else if (clicked.action === 'tab_parts') { this.shopTab = 'PARTS'; window.Sfx.hover(); }
                            else if (clicked.action === 'prev') { 
                                this.shopCarouselIdx--; 
                                let max = this.shopTab === 'SHOP' ? KART_MODELS.length - 1 : this.garage.length - 1;
                                if(this.shopCarouselIdx < 0) this.shopCarouselIdx = max; 
                                window.Sfx.hover(); 
                            }
                            else if (clicked.action === 'next') { 
                                this.shopCarouselIdx++; 
                                let max = this.shopTab === 'SHOP' ? KART_MODELS.length - 1 : this.garage.length - 1;
                                if(this.shopCarouselIdx > max) this.shopCarouselIdx = 0; 
                                window.Sfx.hover(); 
                            }
                            else if (clicked.action === 'equip') { this.activeKartIdx = this.shopCarouselIdx; this.saveGarage(); window.Sfx.click(); }
                            else if (clicked.action === 'sell') {
                                if (this.garage.length > 1) {
                                    const model = KART_MODELS[this.garage[this.shopCarouselIdx].modelId];
                                    let refund = Math.floor(model.price * 0.5);
                                    if (window.Profile) window.Profile.coins = (window.Profile.coins || 0) + refund;
                                    this.garage.splice(this.shopCarouselIdx, 1);
                                    this.shopCarouselIdx = 0; this.activeKartIdx = 0;
                                    this.saveGarage(); window.Sfx.coin(); window.System.msg(`VENDIDO POR R$${refund}`);
                                } else { window.Sfx.error(); window.System.msg("NÃO PODE VENDER SEU ÚLTIMO KART!"); }
                            }
                            else if (clicked.action === 'buy_kart') {
                                let model = KART_MODELS[clicked.modelId]; let wallet = window.Profile ? (window.Profile.coins || 0) : 0;
                                if (this.garage.length >= 3) { window.Sfx.error(); window.System.msg("GARAGEM CHEIA! (MÁX 3)"); } 
                                else if (wallet >= model.price) {
                                    if (window.Profile) window.Profile.coins -= model.price;
                                    this.garage.push({ modelId: model.id }); this.saveGarage(); window.Sfx.coin(); window.System.msg("KART COMPRADO!");
                                } else { window.Sfx.error(); window.System.msg("SEM SALDO SUFICIENTE!"); }
                            }
                            else if (clicked.action === 'buy_upgrade') {
                                let type = clicked.type; let cost = clicked.cost; let targetLvl = clicked.targetLvl;
                                let wallet = window.Profile ? (window.Profile.coins || 0) : 0;
                                if (wallet >= cost) {
                                    if (window.Profile) { window.Profile.coins -= cost; }
                                    this.kartUpgrades[type] = targetLvl; this.saveGarage(); window.Sfx.coin(); window.System.msg("UPGRADE ADQUIRIDO!");
                                } else { window.Sfx.error(); window.System.msg("SEM SALDO SUFICIENTE!"); }
                            }
                        }
                    }
                } 
            };
        },

        saveGarage: function() {
            if (window.Profile) {
                if (!window.Profile.kartSave) window.Profile.kartSave = {};
                window.Profile.kartSave.garage = this.garage;
                window.Profile.kartSave.activeKartIdx = this.activeKartIdx;
                window.Profile.kartSave.upgrades = this.kartUpgrades;
                if (window.Profile.save) window.Profile.save();
            }
        },

        buildTrack: function(trackId) {
            segments = []; const trk = TRACKS[trackId]; this.skyColor = trk.sky; const mult = trk.curveMult;
            const addRoad = (len, curve) => { 
                for(let i=0; i<len; i++) {
                    let obsList = [];
                    let globalIdx = segments.length; 
                    
                    let coinChance = (this.currentFase.mode === 'COIN_HUNT') ? 0.8 : 0.3;
                    if (globalIdx % 8 === 0 && Math.random() < coinChance) { obsList.push({ type: 'coin', x: (Math.random() - 0.5) * 1.6, collected: false }); }
                    
                    if (globalIdx > 50 && globalIdx % 35 === 0) {
                        obsList.push({ type: 'item_box', x: (Math.random() - 0.5) * 1.4, collected: false });
                        if(Math.random() < 0.4) { obsList.push({ type: 'item_box', x: (Math.random() - 0.5) * 1.4, collected: false }); }
                    }
                    
                    segments.push({ curve: curve * mult, color: Math.floor(segments.length / CONF.RUMBLE_LENGTH) % 2 ? 'dark' : 'light', theme: trk.theme, obs: obsList }); 
                }
            };
            if (trackId === 0) { addRoad(50, 0); addRoad(40, 2); addRoad(40, 0); addRoad(60, -3); addRoad(40, 0); addRoad(60, 4); addRoad(50, -2); addRoad(80, 0); } 
            else if (trackId === 1) { addRoad(80, 0); addRoad(60, -1); addRoad(40, -4); addRoad(100, 0); addRoad(60, 2); addRoad(40, 0); addRoad(30, 5); addRoad(100, 0); } 
            else { addRoad(40, 0); addRoad(30, 3); addRoad(30, -3); addRoad(30, 3); addRoad(20, -5); addRoad(100, 0); addRoad(50, 2); addRoad(50, 0); }
            trackLength = segments.length * CONF.SEGMENT_LENGTH; buildMiniMap(segments);
        },

        selectMode: function(mode) { this.resetPhysics(); this.isOnline = (mode === 'ONLINE' && !!window.DB); if (!this.isOnline) { this.rivals = []; } else { this.connectMultiplayer(); } this.state = 'LOBBY'; },

        performHostMaintenance: function() {
            if (!this.isHost || !this.remotePlayersData || !this.roomRef) return;
            const now = Date.now();
            Object.keys(this.remotePlayersData).forEach(pid => {
                if (pid.startsWith('bot_') || pid === window.System.playerId) return;
                const p = this.remotePlayersData[pid];
                if (now - (p.lastSeen || 0) > SAFETY.ZOMBIE_TIMEOUT) { this.dbRef.child('players/' + pid).remove(); this.pushMsg("PLAYER CAIU", "#f00", 30); }
            });
            if (this.raceState === 'RACING') { this.roomRef.child('raceStartTime').once('value', snap => { const startT = snap.val(); if (startT && (now - startT > SAFETY.MAX_RACE_TIME)) { this.roomRef.update({ raceState: 'GAMEOVER' }); } }); }
        },

        connectMultiplayer: function() {
            this.roomRef = window.DB.ref('rooms/' + this.roomId); this.dbRef = this.roomRef;
            const myRef = this.dbRef.child('players/' + window.System.playerId);
            myRef.set({ name: 'Player', charId: this.selectedChar, ready: false, lastSeen: firebase.database.ServerValue.TIMESTAMP, status: 'LOBBY', pos: 0, lap: 1, finishTime: 0 });
            myRef.onDisconnect().remove();
            this.maintenanceInterval = setInterval(() => this.performHostMaintenance(), SAFETY.MAINTENANCE_RATE);

            this.roomRef.child('raceState').on('value', (snap) => {
                const globalState = snap.val(); this.raceState = globalState; 
                if(globalState === 'RACING' && (this.state === 'LOBBY' || this.state === 'WAITING' || this.state === 'KART_SHOP')) { this.roomRef.child('trackId').once('value').then(tSnap => { this.startRace(tSnap.val() || 0); }); }
                if(globalState === 'GAMEOVER' && (this.state === 'RACE' || this.state === 'SPECTATE')) { this.state = 'GAMEOVER'; window.Sfx.play(1000, 'sine', 1, 0.5); }
                if(globalState === 'LOBBY' && (this.state === 'GAMEOVER' || this.state === 'RACE')) { this.state = 'LOBBY'; this.resetPhysics(); window.System.msg("SALA REINICIADA"); }
            });
            this.roomRef.child('trackId').on('value', (snap) => { if(snap.exists() && !this.isHost) this.selectedTrack = snap.val(); });
            this.dbRef.child('players').on('value', (snap) => {
                const data = snap.val(); if (!data) return;
                this.remotePlayersData = data; const now = Date.now(); const ids = Object.keys(data).sort();
                if (ids[0] === window.System.playerId) {
                    this.isHost = true;
                    if (this.state === 'LOBBY') { this.roomRef.child('raceState').once('value', s => { if (s.val() === 'RACING' && ids.length < 2) { this.roomRef.update({ raceState: 'LOBBY', trackId: this.selectedTrack }); } }); }
                } else { this.isHost = false; }
                
                const humanRivals = ids.filter(id => id !== window.System.playerId && !id.includes('bot_')).filter(id => (now - data[id].lastSeen < SAFETY.ZOMBIE_TIMEOUT + 5000)).map(id => ({ id, ...data[id], isRemote: true, color: CHARACTERS[data[id].charId || 0].color || '#fff' }));
                if (this.isHost) { this.rivals = [...humanRivals, ...this.localBots]; } 
                else { const serverBots = Object.keys(data).filter(k => k.startsWith('bot_')).map(k => ({ id: k, ...data[k], isRemote: true, color: CHARACTERS[data[k].charId !== undefined ? data[k].charId : 0].color || '#fff' })); this.rivals = [...humanRivals, ...serverBots]; }
            });
            this.roomRef.child('totalRacers').on('value', (snap) => { if(snap.exists()) this.totalRacers = snap.val(); });
        },

        toggleReady: function() { this.isReady = !this.isReady; window.Sfx.click(); if(!this.isOnline) { let trk = this.currentFase.id === 'arcade' ? this.selectedTrack : this.currentFase.trackId; this.startRace(trk); return; } this.state = this.isReady ? 'WAITING' : 'LOBBY'; this.syncLobby(); },
        syncLobby: function() { if(this.dbRef) { this.dbRef.child('players/' + window.System.playerId).update({ charId: this.selectedChar, ready: this.isReady, lastSeen: firebase.database.ServerValue.TIMESTAMP }); } },

        startRace: function(trackId) {
            this.state = 'RACE'; this.status = 'RACING'; this.buildTrack(trackId); 
            nitroBtn.style.display = 'flex'; resetBtn.style.display = 'none'; 
            this.pushMsg("LARGADA!", "#0f0", 60); window.Sfx.play(600, 'square', 0.5, 0.2); KartAudio.start();
            this.pos = 0; this.lap = 1; this.maxLapPos = 0; this.speed = 0; this.finishTime = 0; this.localBots = [];
            
            const diff = AI_DIFFICULTY_SETTINGS[this.currentFase.diff || CURRENT_DIFFICULTY];
            if (!this.isOnline || (this.isOnline && this.isHost)) {
                let availableChars = [0, 1, 2, 3, 4, 5, 6, 7].filter(c => c !== this.selectedChar);
                const botConfigs = [];
                for(let i=0; i<4; i++) {
                    let rIdx = Math.floor(Math.random() * availableChars.length);
                    let cId = availableChars.splice(rIdx, 1)[0];
                    botConfigs.push({ char: cId, name: CHARACTERS[cId].name });
                }

                botConfigs.forEach((cfg, i) => {
                    this.localBots.push({
                        id: 'cpu' + i, charId: cfg.char, pos: 0, x: (i % 2 === 0 ? -0.5 : 0.5) * (1 + i*0.2), speed: 0, lap: 1, status: 'RACING', finishTime: 0, name: cfg.name, color: CHARACTERS[cfg.char].color,
                        ai_speedMult: diff.speedMult + (Math.random() * 0.1), ai_accelMult: diff.accelMult, ai_reaction: diff.reaction, ai_lookAhead: diff.lookAhead, ai_targetLane: (i % 2 === 0 ? -0.5 : 0.5), ai_laneTimer: 0,
                        item: null, useItemTimer: 0, kartId: 0 
                    });
                });
                if(!this.isOnline) { this.rivals = this.localBots; } 
                else if (this.isHost) { this.localBots.forEach((b, i) => { this.dbRef.child('players/bot_' + i).set({ pos: 0, x: b.x, speed: 0, lap: 1, status: 'RACING', finishTime: 0, charId: b.charId, name: b.name, kartId: 0, lastSeen: firebase.database.ServerValue.TIMESTAMP }); }); }
            }
        },

        update: function(ctx, w, h, pose) {
            if (this.state === 'MODE_SELECT') { this.renderModeSelect(ctx, w, h); return; }
            if (this.state === 'LOBBY' || this.state === 'WAITING') { this.renderLobby(ctx, w, h); return; }
            if (this.state === 'KART_SHOP') { this.renderShop(ctx, w, h); return; }
            if (this.state === 'GAMEOVER') { return Math.floor(this.score); }
            
            this.updatePhysics(w, h, pose);
            this.checkRaceStatus();
            this.renderWorld(ctx, w, h);
            this.renderUI(ctx, w, h);
            
            if (this.isOnline) this.syncMultiplayer();
            return Math.floor(this.score);
        },

        syncMultiplayer: function() {
            if (Date.now() - this.lastSync > 100) {
                this.lastSync = Date.now();
                let myKartId = (this.useCustomKart && this.garage[this.activeKartIdx]) ? this.garage[this.activeKartIdx].modelId : 0;
                
                this.dbRef.child('players/' + window.System.playerId).update({ 
                    pos: Math.floor(this.pos), x: this.playerX, speed: this.speed, steer: this.steer, lap: this.lap, status: this.status, finishTime: this.finishTime, charId: this.selectedChar, kartId: myKartId, lastSeen: firebase.database.ServerValue.TIMESTAMP 
                });
                
                if (this.isHost && this.localBots.length > 0) {
                    this.localBots.forEach((b, i) => { this.dbRef.child('players/bot_' + i).update({ pos: Math.floor(b.pos), x: b.x, speed: b.speed, lap: b.lap, status: b.status, finishTime: b.finishTime, charId: b.charId, name: b.name, kartId: b.kartId, lastSeen: firebase.database.ServerValue.TIMESTAMP }); });
                }
            }
        },

        // --- SISTEMA INTELIGENTE DE RANKING (P/ MÍSSEIS TELEGUIADOS) ---
        getRankings: function() {
            let allR = [
                { id: 'player', lap: this.lap, pos: this.pos, x: this.playerX },
                ...this.localBots.map(b => ({ id: b.id, lap: b.lap, pos: b.pos, x: b.x })),
                ...this.rivals.filter(r => r.isRemote).map(r => ({ id: r.id, lap: r.lap, pos: r.pos, x: r.x }))
            ];
            allR.forEach(r => { r.totalDist = (r.lap * trackLength) + r.pos; });
            allR.sort((a, b) => b.totalDist - a.totalDist); // 1º lugar no index 0
            return allR;
        },

        checkRaceStatus: function() {
            const ranks = this.getRankings();
            this.finalRank = ranks.findIndex(r => r.id === 'player') + 1;
            
            if (this.status === 'FINISHED' && this.state !== 'GAMEOVER' && this.state !== 'SPECTATE_WAIT') {
                this.state = 'SPECTATE_WAIT'; 
                let isWin = false;
                if (this.currentFase.mode === 'RACE' && this.finalRank <= this.currentFase.targetRank) isWin = true;
                if (this.currentFase.mode === 'COIN_HUNT' && this.matchCoins >= this.currentFase.targetCoins) isWin = true;

                setTimeout(() => {
                    this.state = 'GAMEOVER'; KartAudio.stop();
                    if(window.System.gameOver) { window.System.gameOver(this.score, isWin, this.matchCoins); } 
                    else { window.System.home(); }
                }, 3000); 
            }
        },

        updatePhysics: function(w, h, pose) {
            const d = Logic; 
            
            let char = { ...CHARACTERS[this.selectedChar] }; 
            let activeKart = KART_MODELS[0];
            
            if (this.useCustomKart && this.garage && this.garage[this.activeKartIdx]) {
                let kId = this.garage[this.activeKartIdx].modelId;
                activeKart = KART_MODELS.find(k => k.id === kId) || KART_MODELS[0];
                const upg = this.kartUpgrades || { engine: 1, tires: 1, suspension: 1 };
                
                char.speedInfo += activeKart.speedBonus + (upg.engine - 1) * 0.08;
                char.accel += (upg.engine - 1) * 0.005; 
                char.turnInfo += activeKart.turnBonus + (upg.tires - 1) * 0.10;
                char.weight += activeKart.weightBonus;
                
                char.tireLevel = upg.tires || 1;
                char.suspensionLevel = upg.suspension || 1;
            } else {
                char.tireLevel = 1;
                char.suspensionLevel = 1;
            }

            const canControl = (d.status === 'RACING');
            let detected = false; let itemTriggered = false;

            if (d.status === 'FINISHED') {
                let futureSeg = getSegment((d.pos + 300) / CONF.SEGMENT_LENGTH);
                d.targetSteer = 0;
                d.steer += (-futureSeg.curve * 0.05 - d.steer) * 0.1; 
                d.speed = MathCore.lerp(d.speed, 130, 0.05); d.playerX *= 0.95; 
            } else {
                if(pose && pose.keypoints) {
                    const map = (pt) => ({ x: (1 - pt.x/640)*w, y: (pt.y/480)*h });
                    const lw = pose.keypoints.find(k => k.name === 'left_wrist'); const rw = pose.keypoints.find(k => k.name === 'right_wrist'); const nose = pose.keypoints.find(k => k.name === 'nose');
                    if (lw?.score > 0.2 && rw?.score > 0.2) {
                        const pl = map(lw); const pr = map(rw);
                        d.targetSteer = Math.atan2(pr.y - pl.y, pr.x - pl.x) * 1.8;
                        d.virtualWheel = { x: (pl.x+pr.x)/2, y: (pl.y+pr.y)/2, r: Math.hypot(pr.x-pl.x, pr.y-pl.y)/2, opacity: 1 };
                        detected = true;
                        
                        if (nose && lw.y < nose.y && rw.y < nose.y) {
                            d.gestureTimer++; d.virtualWheel.isHigh = true;
                            if (d.gestureTimer > 25 && d.nitro >= 20 && !d.turboLock) { d.turboLock = true; d.pushMsg("TURBO ON!", "#0ff"); window.Sfx.play(800, 'square', 0.1, 0.1); }
                        } else { d.gestureTimer = 0; d.virtualWheel.isHigh = false; }

                        if (nose) {
                            const dl = Math.hypot(lw.x - nose.x, lw.y - nose.y);
                            const dr = Math.hypot(rw.x - nose.x, rw.y - nose.y);
                            if ((dl < 70 && lw.y < nose.y + 40) || (dr < 70 && rw.y < nose.y + 40)) { itemTriggered = true; }
                        }
                    }
                }
                d.inputActive = detected; if (!detected) { d.targetSteer = 0; d.virtualWheel.opacity *= 0.9; } 
                d.steer += (d.targetSteer - d.steer) * (PHYSICS.steerSensitivity / Math.sqrt(Math.max(0.5, char.weight)));
            }

            const absX = Math.abs(d.playerX); let currentGrip = PHYSICS.gripAsphalt; let currentDrag = CONF.FRICTION; d.vibration = 0;
            const carScaleGlobal = w * 0.0022;
            const partY = (h * 0.80) + (15 * carScaleGlobal) + 5; 
            
            let offroadDrag = CONF.OFFROAD_DECEL;
            if (activeKart.type === 'monster') offroadDrag = 0.95;
            if (activeKart.type === 'tractor') offroadDrag = 0.96;
            if (activeKart.type === 'tank') offroadDrag = 0.97; 

            if (char.tireLevel > 1) { offroadDrag += (char.tireLevel - 1) * 0.015; }
            if (offroadDrag > CONF.FRICTION) offroadDrag = CONF.FRICTION;

            if (absX > 1.45) { 
                currentGrip = PHYSICS.gripOffroad; currentDrag = offroadDrag; d.vibration = 5; 
                if (char.suspensionLevel > 1) d.vibration -= (char.suspensionLevel - 1) * 1.5; 
                if(d.speed > 50) d.speed *= 0.98; if(d.speed > 10) this.spawnParticle(w/2 + (Math.random()-0.5)*40, partY, 'dust'); 
            } else if (absX > 1.0) { currentGrip = PHYSICS.gripZebra; d.vibration = 2; }

            let max = CONF.MAX_SPEED * char.speedInfo;
            if (d.turboLock) {
                max = CONF.TURBO_MAX_SPEED; d.nitro -= 0.5; this.spawnParticle(w/2 - 15, partY, 'turbo'); this.spawnParticle(w/2 + 15, partY, 'turbo');
                if (d.nitro <= 0) { d.nitro = 0; d.turboLock = false; window.Sfx.play(200, 'sawtooth', 0.5, 0.2); } 
            } else { d.nitro = Math.min(100, d.nitro + 0.15); }

            const isAccelerating = (d.inputActive || d.turboLock);
            if(d.status === 'RACING' && d.spinTimer <= 0 && isAccelerating) { d.speed += (max - d.speed) * char.accel; } else if (d.status !== 'FINISHED') { d.speed *= 0.96; }
            d.speed *= currentDrag;

            // FIX ABSOLUTO: GIRO NO AR (KART NÃO FICA MAIS PRESO DE CABEÇA PARA BAIXO)
            if (d.spinTimer > 0) { 
                d.spinTimer--; 
                d.spinAngle += (Math.PI * 2) / 40; // 360 perfeito em 40 frames
                d.speed *= 0.95; 
                d.bounce *= 0.85; 
            } else {
                d.spinAngle = 0; 
                d.bounce = (Math.random() - 0.5) * d.vibration; 
            }

            if (Math.abs(d.targetSteer) > 0.5 && d.speed > 100 && absX < 1.3 && d.spinTimer <= 0) {
                d.driftSparks = Math.min((d.driftSparks || 0) + 1, 100);
                if (Math.random() > 0.3) this.spawnParticle(w/2 + (d.targetSteer > 0 ? -30 : 30), partY, d.driftSparks > 70 ? 'drift_blue' : 'drift_yellow');
            } else if (d.driftSparks > 0) {
                if (d.driftSparks > 70) { d.speed = Math.min(CONF.TURBO_MAX_SPEED, d.speed + 60); window.Sfx.play(600, 'square', 0.2, 0.2); d.vibration = 8; this.pushMsg("DRIFT BOOST!", "#0ff", 30); }
                d.driftSparks = 0;
            }

            let inVacuo = false;
            d.rivals.forEach(r => {
                const distZ = ((Number(r.lap) * trackLength) + Number(r.pos)) - ((d.lap * trackLength) + d.pos);
                if (distZ > 80 && distZ < 600 && Math.abs(r.x - d.playerX) < 0.3 && r.status === 'RACING') inVacuo = true;
            });
            if (inVacuo && d.speed > 90) {
                d.slipstreamTimer = (d.slipstreamTimer || 0) + 1;
                if (d.slipstreamTimer > 20) { d.speed += 3.5; if (Math.random() > 0.4) this.spawnParticle(w/2 + (Math.random()-0.5)*200, h/2 + Math.random()*150, 'wind'); }
            } else { d.slipstreamTimer = 0; }

            const pickupHitbox = 1.8; 
            const segInfo = getSegment(d.pos / CONF.SEGMENT_LENGTH);
            if (segInfo.obs) {
                segInfo.obs.forEach(o => {
                    if (!o.collected && Math.abs(d.playerX - o.x) < pickupHitbox) {
                        if (o.type === 'coin') {
                            o.collected = true; d.matchCoins++; d.score += 50; window.Sfx.coin(); 
                            this.pushMsg("+ R$1.000", "#f1c40f", 25);
                            if (window.Profile) { window.Profile.coins = (window.Profile.coins || 0) + 1000; if(window.Profile.save) window.Profile.save(); }
                        } else if (o.type === 'item_box' && !d.item) {
                            o.collected = true; window.Sfx.play(1000, 'sine', 0.1);
                            const possibleItems = ['mushroom', 'banana', 'shell'];
                            d.item = possibleItems[Math.floor(Math.random() * possibleItems.length)];
                            this.pushMsg("CAIXA PEGA!", "#fff", 30);
                        } else if (o.type === 'banana') {
                            o.collected = true; d.spinTimer = 40; d.speed *= 0.2; window.Sfx.error(); window.Gfx.shakeScreen(20);
                            this.pushMsg("ESCORREGOU!", "#f00", 40);
                        }
                    }
                });
            }

            if (itemTriggered && d.item && d.itemCooldown <= 0 && d.status === 'RACING') {
                if (d.item === 'mushroom') {
                    d.speed = Math.min(CONF.TURBO_MAX_SPEED + 50, d.speed + 150);
                    window.Gfx.shakeScreen(15); window.Sfx.play(800, 'square', 0.3, 0.2);
                    this.pushMsg("COGUMELO BOOST!", "#f1c40f");
                } 
                else if (d.item === 'banana') {
                    if (!segInfo.obs) segInfo.obs = [];
                    segInfo.obs.push({ type: 'banana', x: d.playerX, collected: false });
                    window.Sfx.play(300, 'sine', 0.2, 0.2);
                    this.pushMsg("BANANA DROPADA!", "#f1c40f");
                } 
                else if (d.item === 'shell') {
                    let ranks = this.getRankings();
                    let myIdx = ranks.findIndex(r => r.id === 'player');
                    let targetIdx = myIdx - 1; 
                    if (myIdx === 0) targetIdx = ranks.length - 1; 
                    let targetId = ranks[targetIdx] ? ranks[targetIdx].id : null;

                    d.projectiles.push({ pos: d.pos + 200, x: d.playerX, speed: Math.max(d.speed, 200) + 150, active: true, life: 400, owner: 'player', targetId: targetId });
                    window.Sfx.play(600, 'sawtooth', 0.2, 0.2);
                    this.pushMsg("MÍSSIL LANÇADO!", "#2ecc71");
                }
                d.item = null; d.itemCooldown = 60; 
            }
            if (d.itemCooldown > 0) d.itemCooldown--;

            d.projectiles.forEach(p => {
                if (!p.active) return;
                p.pos += p.speed; p.life--;
                if (p.pos >= trackLength) p.pos -= trackLength; 
                if (p.life <= 0) p.active = false;

                let targetObj = null;
                if (p.targetId === 'player') {
                    targetObj = { x: d.playerX, pos: d.pos, kartType: activeKart.type, isMe: true };
                } else {
                    let bot = this.localBots.find(b => b.id === p.targetId);
                    if (bot) { targetObj = { x: bot.x, pos: bot.pos, kartType: KART_MODELS[bot.kartId || 0].type, isBot: true, ref: bot }; } 
                    else {
                        let remote = this.rivals.find(rv => rv.id === p.targetId);
                        if (remote) targetObj = { x: remote.x, pos: remote.pos, kartType: KART_MODELS[remote.kartId || 0].type, isRemote: true };
                    }
                }

                if (targetObj) {
                    p.x += (targetObj.x - p.x) * 0.08; 
                    
                    let distZ = Math.abs(p.pos - targetObj.pos);
                    if (distZ > trackLength / 2) distZ = trackLength - distZ; 
                    
                    if (distZ < 250 && Math.abs(p.x - targetObj.x) < 1.0) { 
                        p.active = false; 
                        
                        if (targetObj.kartType === 'tank' || targetObj.kartType === 'plane') {
                            if (targetObj.isMe) { window.Sfx.play(400, 'square', 0.1, 0.1); this.pushMsg("DEFESA BLINDADA!", "#3498db", 40); }
                        } else {
                            if (targetObj.isMe) {
                                d.speed *= 0.2; d.spinTimer = 40; 
                                let baseBounce = char.weight > 1.4 ? -40 : -80; 
                                if (char.suspensionLevel > 1) baseBounce *= (1 - (char.suspensionLevel - 1) * 0.25);
                                d.bounce = baseBounce; 
                                window.Sfx.error(); window.Gfx.shakeScreen(30); this.pushMsg("ATINGIDO!", "#f00", 50);
                                this.spawnParticle(w/2, h*0.8, 'explosion'); 
                            } else if (targetObj.isBot) {
                                targetObj.ref.speed *= 0.2; targetObj.ref.spinTimer = 40; window.Sfx.play(200, 'square', 0.2, 0.2); 
                                this.spawnParticle(w/2 + (targetObj.x - d.playerX)*w/2, h*0.6, 'explosion');
                            }
                        }
                    }
                }
            });

            KartAudio.update(d.speed, CONF.MAX_SPEED, d.lateralInertia, absX > 1.45, d.turboLock);

            d.cameraX += (d.playerX - d.cameraX) * CONF.CAMERA_LERP;
            const ratio = d.speed / CONF.MAX_SPEED;
            const turnForce = d.steer * char.turnInfo * currentGrip * ratio;
            d.lateralInertia = (d.lateralInertia * PHYSICS.lateralInertiaDecay) + (turnForce) * 0.08;
            d.playerX += d.lateralInertia;
            if(Math.abs(d.lateralInertia) > 0.12 && d.speed > 60 && absX < 1.4) { this.spawnParticle(w/2 - 30, partY, 'smoke'); this.spawnParticle(w/2 + 30, partY, 'smoke'); }

            if (this.localBots.length > 0 && d.state !== 'GAMEOVER') {
                const diff = AI_DIFFICULTY_SETTINGS[this.currentFase.diff || CURRENT_DIFFICULTY];
                let playerTotalDist = (d.lap * trackLength) + d.pos;

                this.localBots.forEach(r => {
                    if (r.status === 'FINISHED') return;
                    const rChar = CHARACTERS[r.charId || 0]; 
                    let botTotalDist = (r.lap * trackLength) + r.pos;
                    let distBehind = playerTotalDist - botTotalDist;
                    
                    let dynamicRubberBand = 1.0;
                    if (distBehind > 300 && diff.rubberBand > 0) { dynamicRubberBand = 1.0 + (Math.min(distBehind, 4000) / 4000) * diff.rubberBand; }

                    const futureSeg = getSegment((r.pos + (r.ai_lookAhead * CONF.SEGMENT_LENGTH)) / CONF.SEGMENT_LENGTH);
                    let targetSpeed = CONF.MAX_SPEED * rChar.speedInfo * r.ai_speedMult * dynamicRubberBand;
                    if (Math.abs(futureSeg.curve) > 2) targetSpeed *= 0.85; else if (Math.abs(futureSeg.curve) > 1) targetSpeed *= 0.95;
                    
                    const botSeg = getSegment(r.pos / CONF.SEGMENT_LENGTH);
                    if (botSeg.obs) {
                        botSeg.obs.forEach(o => {
                            if (!o.collected && Math.abs(r.x - o.x) < pickupHitbox) {
                                if (o.type === 'coin') { o.collected = true; } 
                                else if (o.type === 'item_box' && !r.item) {
                                    o.collected = true;
                                    r.item = ['mushroom', 'banana', 'shell'][Math.floor(Math.random() * 3)];
                                    r.useItemTimer = 60 + Math.floor(Math.random() * 120); 
                                } else if (o.type === 'banana') { o.collected = true; r.speed *= 0.2; r.spinTimer = 40; }
                            }
                        });
                    }

                    if (r.item === 'shell') {
                        let botTarget = d.rivals.concat([{pos: d.pos, x: d.playerX}]).find(x => x.pos > r.pos && x.pos - r.pos < 1000);
                        if (botTarget) { r.ai_targetLane = botTarget.x; if (Math.abs(r.x - botTarget.x) < 0.5) r.useItemTimer = 1; }
                    }

                    if (r.item && r.useItemTimer > 0) {
                        r.useItemTimer--;
                        if (r.useItemTimer <= 0) {
                            if (r.item === 'mushroom') { r.speed = Math.min(CONF.TURBO_MAX_SPEED + 50, r.speed + 150); } 
                            else if (r.item === 'banana') { botSeg.obs.push({ type: 'banana', x: r.x, collected: false }); } 
                            else if (r.item === 'shell') {
                                let ranks = this.getRankings();
                                let myIdx = ranks.findIndex(rx => rx.id === r.id);
                                let targetIdx = myIdx - 1;
                                if (myIdx === 0) targetIdx = ranks.length - 1;
                                let targetId = ranks[targetIdx] ? ranks[targetIdx].id : null;
                                d.projectiles.push({ pos: r.pos + 200, x: r.x, speed: Math.max(r.speed, 200) + 150, active: true, life: 400, owner: r.id, targetId: targetId });
                            }
                            r.item = null;
                        }
                    }

                    r.ai_laneTimer++;
                    if (r.ai_laneTimer > 80) { 
                        r.ai_laneTimer = 0; 
                        if (distBehind < 0 && distBehind > -500 && Math.random() < 0.8) { r.ai_targetLane = d.playerX; } 
                        else if (Math.random() < 0.4) { r.ai_targetLane = [-0.7, 0, 0.7][Math.floor(Math.random() * 3)]; }
                    }
                    if (futureSeg.curve > 2) r.ai_targetLane = -0.8; else if (futureSeg.curve < -2) r.ai_targetLane = 0.8; 

                    if (Math.random() < diff.errorRate * 0.15) { r.ai_targetLane = (Math.random() > 0.5 ? 1.6 : -1.6); }

                    let moveX = (r.ai_targetLane - r.x) * r.ai_reaction; moveX -= (getSegment(r.pos / CONF.SEGMENT_LENGTH).curve * 0.04); 
                    r.x += moveX; if (Math.abs(r.x) > 1.8) { r.x = Math.sign(r.x)*1.8; r.speed *= 0.95; } 

                    if (r.speed < targetSpeed) r.speed += rChar.accel * r.ai_accelMult * (dynamicRubberBand > 1 ? 1.5 : 1); else r.speed *= 0.995; 
                    
                    if (r.spinTimer > 0) { r.spinTimer--; r.spinAngle += (Math.PI * 2) / 40; r.speed *= 0.95; } else { r.spinAngle = 0; }
                    r.pos += r.speed;

                    if (r.pos >= trackLength) { r.pos -= trackLength; r.lap++; if (r.lap > CONF.TOTAL_LAPS) { r.status = 'FINISHED'; if (r.finishTime === 0) r.finishTime = Date.now(); r.speed = 0; r.lap = CONF.TOTAL_LAPS; } }
                });
            }

            d.rivals.forEach(r => {
                const distZ = Math.abs(((d.lap * trackLength) + d.pos) - ((Number(r.lap) * trackLength) + Number(r.pos)));
                if (distZ < 250 && Math.abs(r.x - d.playerX) < 0.8 && r.status === 'RACING' && d.status === 'RACING') {
                    const pushForce = 0.2 * ((CHARACTERS[r.charId] || CHARACTERS[0]).weight / char.weight);
                    d.lateralInertia += (d.playerX > r.x ? pushForce : -pushForce); d.speed *= 0.95; 
                    if (!r.isRemote && this.localBots.includes(r)) r.x += (d.playerX > r.x ? -0.1 : 0.1);
                    KartAudio.crash();
                }
            });

            d.playerX = Math.max(-3.5, Math.min(3.5, d.playerX)); d.pos += d.speed;

            if (d.pos > trackLength * 0.60 && d.pos < trackLength * 0.95) { d.maxLapPos = Math.max(d.maxLapPos, d.pos); }
            if (d.pos >= trackLength) { 
                if (d.maxLapPos > trackLength * 0.70) {
                    d.pos -= trackLength; d.lap++; d.maxLapPos = 0;
                    if (d.lap > CONF.TOTAL_LAPS) {
                        d.lap = CONF.TOTAL_LAPS; d.status = 'FINISHED'; if (d.finishTime === 0) d.finishTime = Date.now(); 
                        nitroBtn.style.display = 'none';
                        this.pushMsg("CRUZOU A LINHA!", "#ff0", 60);
                    } else { window.Sfx.play(700, 'square', 0.3, 0.1); this.pushMsg(`VOLTA ${d.lap}/${CONF.TOTAL_LAPS}`, "#fff", 60); }
                } else { d.pos = trackLength - 1; d.speed = 0; this.pushMsg("SENTIDO ERRADO!", "#f00"); }
            }
            
            d.visualTilt += ((d.steer * 8) - d.visualTilt) * 0.15; d.visualTilt = Math.max(-12, Math.min(12, d.visualTilt)); 
            
            d.score += d.speed * 0.01;
            particles.forEach((p, i) => { p.x += p.vx; p.y += p.vy; p.l--; if(p.l <= 0) particles.splice(i, 1); });
        },

        spawnParticle: function(x, y, type) {
            if (type === 'drift_yellow') { particles.push({ x, y, vx: (Math.random()-0.5)*8, vy: -Math.random()*5, l: 15, maxL: 15, c: '#f1c40f', isDrift: true }); return; }
            if (type === 'drift_blue') { particles.push({ x, y, vx: (Math.random()-0.5)*12, vy: -Math.random()*8, l: 20, maxL: 20, c: '#00d2d3', isDrift: true }); return; }
            if (type === 'wind') { particles.push({ x, y, vx: 0, vy: 15 + Math.random()*15, l: 10, maxL: 10, c: 'rgba(255,255,255,0.6)', isLine: true }); return; }
            if (type === 'explosion') {
                for(let i=0; i<15; i++) { particles.push({ x, y, vx: (Math.random()-0.5)*25, vy: (Math.random()-0.5)*25, l: 40, maxL: 40, c: ['#ff0000', '#ff9900', '#ffff00'][Math.floor(Math.random()*3)], isExplosion: true }); }
                return;
            }
            if(Math.random() > 0.5) return;
            particles.push({ x, y, vx: (Math.random()-0.5)*4, vy: (Math.random())*4, l: 20, maxL: 20, c: type==='turbo'?'#ffaa00':(type==='dust'?'#95a5a6':'#ecf0f1') });
        },

        renderWorld: function(ctx, w, h) {
            const d = Logic; const cx = w / 2; 
            const horizon = (h * 0.35) + d.bounce - (d.visualTilt * 2);
            
            const currentSegIndex = Math.floor(d.pos / CONF.SEGMENT_LENGTH); const isOffRoad = Math.abs(d.playerX) > 1.2;
            const skyGrads = [['#3388ff', '#88ccff'], ['#e67e22', '#f1c40f'], ['#0984e3', '#74b9ff']];
            const currentSky = skyGrads[this.skyColor] || skyGrads[0];
            const gradSky = ctx.createLinearGradient(0, 0, 0, horizon);
            gradSky.addColorStop(0, currentSky[0]); gradSky.addColorStop(1, currentSky[1]);
            ctx.fillStyle = gradSky; ctx.fillRect(0, 0, w, horizon);

            const bgOffset = (getSegment(currentSegIndex).curve * 30) + (d.cameraX * 20); 
            ctx.fillStyle = this.skyColor === 0 ? '#44aa44' : (this.skyColor===1 ? '#d35400' : '#fff'); 
            ctx.beginPath(); ctx.moveTo(0, horizon);
            for(let i=0; i<=12; i++) { ctx.lineTo((w/12 * i) - (bgOffset * 0.5), horizon - 50 - Math.abs(Math.sin(i + d.pos*0.0001))*40); }
            ctx.lineTo(w, horizon); ctx.fill();

            const themes = { 'grass': ['#55aa44', '#448833'], 'sand':  ['#f1c40f', '#e67e22'], 'snow':  ['#ffffff', '#dfe6e9'] };
            const theme = themes[TRACKS[d.selectedTrack].theme] || themes['grass']; 
            ctx.fillStyle = isOffRoad ? '#336622' : theme[1]; ctx.fillRect(0, horizon, w, h-horizon);

            let dx = 0; let camX = d.cameraX * (w * 0.45); let segmentCoords = [];

            for(let n = 0; n < CONF.DRAW_DISTANCE; n++) {
                const seg = getSegment(currentSegIndex + n); dx += (seg.curve * CONF.CAMERA_DEPTH); 
                const scale = 1 / (1 + (n * 20 * 0.020)); 
                const nextScale = 1 / (1 + ((n+1) * 20 * 0.020));
                const sy = horizon + ((h - horizon) * scale); const nsy = horizon + ((h - horizon) * nextScale);
                const sx = cx - (camX * scale) - (dx * n * 20 * scale * 2); const nsx = cx - (camX * nextScale) - ((dx + seg.curve*CONF.CAMERA_DEPTH) * (n+1) * 20 * nextScale * 2);
                segmentCoords.push({ x: sx, y: sy, scale });
                ctx.fillStyle = (seg.color === 'dark') ? (isOffRoad?'#336622':theme[1]) : (isOffRoad?'#336622':theme[0]); ctx.fillRect(0, nsy, w, sy - nsy);
                ctx.fillStyle = (seg.color === 'dark') ? '#f33' : '#fff'; 
                ctx.beginPath(); ctx.moveTo(sx - (w*3*scale)*0.6, sy); ctx.lineTo(sx + (w*3*scale)*0.6, sy); ctx.lineTo(nsx + (w*3*nextScale)*0.6, nsy); ctx.lineTo(nsx - (w*3*nextScale)*0.6, nsy); ctx.fill();
                ctx.fillStyle = (seg.color === 'dark') ? '#444' : '#494949'; 
                ctx.beginPath(); ctx.moveTo(sx - (w*3*scale)*0.5, sy); ctx.lineTo(sx + (w*3*scale)*0.5, sy); ctx.lineTo(nsx + (w*3*nextScale)*0.5, nsy); ctx.lineTo(nsx - (w*3*nextScale)*0.5, nsy); ctx.fill();
            }

            for(let n = CONF.DRAW_DISTANCE - 1; n >= 0; n--) {
                const coord = segmentCoords[n]; if(!coord) continue;
                
                const seg = getSegment(currentSegIndex + n);
                if (seg.obs) {
                    seg.obs.forEach(o => {
                        if (o.collected) return;
                        let ox = coord.x + (o.x * (w*1.5) * coord.scale);
                        let oy = coord.y - (30 * coord.scale);
                        let sc = coord.scale;
                        
                        if (o.type === 'coin') {
                            oy += Math.sin(Date.now()*0.005)*10*sc;
                            let r = 50 * sc; 
                            let w_spin = r * Math.abs(Math.cos(Date.now()*0.005));
                            ctx.fillStyle = '#f1c40f'; ctx.beginPath(); ctx.ellipse(ox, oy, Math.max(1, w_spin), r, 0, 0, Math.PI*2); ctx.fill();
                            ctx.strokeStyle = '#f39c12'; ctx.lineWidth = 5*sc; ctx.stroke();
                        } 
                        else if (o.type === 'item_box') {
                            oy += Math.sin(Date.now()*0.005)*10*sc;
                            let hue = (Date.now() / 5) % 360; 
                            ctx.fillStyle = `hsl(${hue}, 80%, 50%)`;
                            ctx.fillRect(ox - 65*sc, oy - 65*sc, 130*sc, 130*sc); 
                            ctx.fillStyle = '#fff'; ctx.font = `bold ${80*sc}px Arial`; ctx.textAlign='center';
                            ctx.fillText("?", ox, oy + 30*sc);
                        }
                        else if (o.type === 'banana') {
                            ctx.fillStyle = '#f1c40f'; 
                            ctx.beginPath(); ctx.ellipse(ox, oy + 25*sc, 50*sc, 18*sc, 0, 0, Math.PI*2); ctx.fill(); 
                            ctx.beginPath(); ctx.ellipse(ox, oy + 10*sc, 18*sc, 50*sc, 0, 0, Math.PI*2); ctx.fill();
                        }
                    });
                }

                d.rivals.forEach(r => {
                    let relPos = r.pos - d.pos; if(relPos < -trackLength/2) relPos += trackLength;
                    if (Math.abs(Math.floor(relPos / CONF.SEGMENT_LENGTH) - n) < 2.0 && n > 0) {
                        this.drawKartSprite(ctx, coord.x + (r.x * (w*1.5) * coord.scale), coord.y, w*0.0022*coord.scale, 0, 0, r.spinAngle || 0, r.color, r.charId, r.kartId);
                        if (r.status === 'FINISHED') { ctx.fillStyle = "#ff0"; ctx.font = `bold ${20*coord.scale}px Arial`; ctx.fillText("🏁", coord.x + (r.x * (w*1.5) * coord.scale), coord.y - 80*coord.scale); }
                    }
                });
            }

            d.projectiles.forEach(p => {
                if (!p.active) return;
                let relPos = p.pos - d.pos; if (relPos < 0) relPos += trackLength;
                let n = Math.floor(relPos / CONF.SEGMENT_LENGTH);
                if (n > 0 && n < CONF.DRAW_DISTANCE) {
                    let coord = segmentCoords[n];
                    if (coord) {
                        let px = coord.x + (p.x * (w*1.5) * coord.scale);
                        let py = coord.y - (15 * coord.scale);
                        ctx.fillStyle = '#2ecc71'; 
                        ctx.beginPath(); ctx.ellipse(px, py, 45*coord.scale, 35*coord.scale, 0, 0, Math.PI*2); ctx.fill();
                        ctx.strokeStyle = '#ecf0f1'; ctx.lineWidth = 6*coord.scale; ctx.stroke();
                    }
                }
            });

            particles.forEach(p => {
                ctx.fillStyle = p.c; ctx.globalAlpha = p.l / p.maxL;
                if (p.isLine) { ctx.strokeStyle = p.c; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - 60); ctx.stroke(); } 
                else if (p.isDrift) { ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI*2); ctx.fill(); } 
                else if (p.isExplosion) { ctx.beginPath(); ctx.arc(p.x, p.y, (p.maxL - p.l)*3, 0, Math.PI*2); ctx.fill(); }
                else { ctx.beginPath(); ctx.arc(p.x, p.y, 4 + (p.maxL - p.l)*0.5, 0, Math.PI*2); ctx.fill(); }
            }); ctx.globalAlpha = 1;

            if (d.status !== 'FINISHED' && d.state !== 'GAMEOVER') {
                let myKartId = (this.useCustomKart && this.garage[this.activeKartIdx]) ? this.garage[this.activeKartIdx].modelId : 0;
                this.drawKartSprite(ctx, cx, h * 0.80 + d.bounce, w * 0.0022, d.steer, d.visualTilt, d.spinAngle, CHARACTERS[d.selectedChar].color, d.selectedChar, myKartId);
            }
        },

        drawKartSprite: function(ctx, cx, y, carScale, steer, tilt, spinAngle, color, charId, kartModelId = 0) {
            ctx.save(); ctx.translate(cx, y); ctx.scale(carScale, carScale); 
            ctx.rotate(tilt * 0.03 + spinAngle); 
            
            const w = (CHARACTERS[charId] || CHARACTERS[0]).weight;
            const kartModel = KART_MODELS[kartModelId] || KART_MODELS[0];

            ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.ellipse(0, 35, w > 1.2 ? 75 : (w < 0.9 ? 55 : 65), 15, 0, 0, Math.PI*2); ctx.fill();

            const drawWheels = (wWidth, wHeight, colorObj, offset = 0) => {
                const dw = (wx, wy, isFront) => { ctx.save(); ctx.translate(wx, wy); if(isFront) ctx.rotate(steer * 0.8); ctx.fillStyle = colorObj || '#111'; ctx.fillRect(-wWidth/2, -wHeight/2, wWidth, wHeight); ctx.fillStyle = '#555'; ctx.fillRect(-wWidth/2 + 3, -wHeight/2 + 3, wWidth - 6, wHeight - 6); ctx.restore(); };
                dw(-45 - offset, 15, false); dw(45 + offset, 15, false); dw(-40 - offset, -15, true); dw(40 + offset, -15, true);
            };

            if (kartModel.type !== 'standard') {
                if (kartModel.type === 'f1') {
                    drawWheels(22, 35, '#111', 15);
                    ctx.fillStyle = kartModel.color;
                    ctx.beginPath(); ctx.moveTo(-10, -55); ctx.lineTo(10, -55); ctx.lineTo(25, 20); ctx.lineTo(-25, 20); ctx.fill();
                    ctx.fillStyle = '#111'; ctx.fillRect(-45, 10, 90, 15); 
                    ctx.fillStyle = '#f1c40f'; ctx.fillRect(-25, -55, 50, 8); 
                } 
                else if (kartModel.type === 'luxury') {
                    drawWheels(25, 35, '#222', 10);
                    let grad = ctx.createLinearGradient(0, -40, 0, 25); grad.addColorStop(0, kartModel.color); grad.addColorStop(1, '#000');
                    ctx.fillStyle = grad;
                    if(ctx.roundRect) { ctx.beginPath(); ctx.roundRect(-28, -40, 56, 75, 15); ctx.fill(); } else { ctx.fillRect(-28, -40, 56, 75); }
                    ctx.fillStyle = '#111'; if(ctx.roundRect) { ctx.beginPath(); ctx.roundRect(-22, -15, 44, 30, 5); ctx.fill(); } else { ctx.fillRect(-22, -15, 44, 30); } 
                    ctx.fillStyle = '#f1c40f'; ctx.beginPath(); ctx.arc(-18, -35, 4, 0, Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.arc(18, -35, 4, 0, Math.PI*2); ctx.fill(); 
                    ctx.fillStyle = '#e74c3c'; ctx.fillRect(-22, 32, 12, 3); ctx.fillRect(10, 32, 12, 3); 
                }
                else if (kartModel.type === 'moto') {
                    const dwMoto = (wx, wy, isFront) => { ctx.save(); ctx.translate(wx, wy); if(isFront) ctx.rotate(steer * 0.8); ctx.fillStyle = '#111'; ctx.fillRect(-10, -20, 20, 40); ctx.restore(); };
                    dwMoto(0, 30, false); dwMoto(0, -40, true);
                    ctx.fillStyle = kartModel.color;
                    ctx.beginPath(); ctx.moveTo(0, -30); ctx.lineTo(-12, 10); ctx.lineTo(12, 10); ctx.fill(); 
                    ctx.fillStyle = '#bdc3c7'; ctx.fillRect(-20, -25, 40, 4); 
                }
                else if (kartModel.type === 'tractor') {
                    const dwTrac = (wx, wy, isFront, wW, wH) => { ctx.save(); ctx.translate(wx, wy); if(isFront) ctx.rotate(steer * 0.8); ctx.fillStyle = '#111'; ctx.fillRect(-wW/2, -wH/2, wW, wH); ctx.fillStyle='#555'; ctx.fillRect(-wW/2+4, -wH/2+4, wW-8, wH-8); ctx.restore(); };
                    dwTrac(-40, 15, false, 30, 50); dwTrac(40, 15, false, 30, 50); 
                    dwTrac(-30, -35, true, 20, 30); dwTrac(30, -35, true, 20, 30); 
                    ctx.fillStyle = kartModel.color; ctx.fillRect(-15, -40, 30, 50); 
                    ctx.fillStyle = '#333'; ctx.fillRect(-20, 0, 40, 30); 
                    ctx.fillStyle = '#7f8c8d'; ctx.fillRect(10, -35, 4, 15); 
                }
                else if (kartModel.type === 'tank') {
                    ctx.fillStyle = '#2d3436'; 
                    if(ctx.roundRect) { ctx.beginPath(); ctx.roundRect(-45, -35, 20, 70, 5); ctx.fill(); ctx.beginPath(); ctx.roundRect(25, -35, 20, 70, 5); ctx.fill(); } else { ctx.fillRect(-45, -35, 20, 70); ctx.fillRect(25, -35, 20, 70); }
                    ctx.fillStyle = '#000'; for(let i=-30; i<35; i+=8) { ctx.fillRect(-45, i, 20, 3); ctx.fillRect(25, i, 20, 3); } 
                    
                    ctx.fillStyle = kartModel.color; ctx.fillRect(-25, -30, 50, 60); 
                    ctx.fillStyle = '#111'; ctx.fillRect(-4, -60, 8, 40); 
                    ctx.fillStyle = '#34495e'; ctx.beginPath(); ctx.arc(0, -10, 18, 0, Math.PI*2); ctx.fill(); 
                }
                else if (kartModel.type === 'plane') {
                    ctx.fillStyle = '#111'; ctx.fillRect(-12, 10, 6, 12); ctx.fillRect(6, 10, 6, 12); ctx.fillRect(-3, -40, 6, 12); 
                    ctx.fillStyle = kartModel.color; ctx.beginPath(); ctx.ellipse(0, -10, 18, 50, 0, 0, Math.PI*2); ctx.fill(); 
                    ctx.fillStyle = '#e74c3c'; ctx.beginPath(); ctx.moveTo(-60, 5); ctx.lineTo(60, 5); ctx.lineTo(0, -15); ctx.fill(); 
                    ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.moveTo(-25, 35); ctx.lineTo(25, 35); ctx.lineTo(0, 20); ctx.fill(); 
                    ctx.save(); ctx.translate(0, -60); ctx.rotate(Date.now() * 0.05); ctx.fillStyle = '#bdc3c7'; ctx.fillRect(-20, -2, 40, 4); ctx.restore(); 
                }
                else if (kartModel.type === 'sport') {
                    drawWheels(18, 28, '#2c3e50', 5);
                    ctx.fillStyle = kartModel.color; ctx.beginPath(); ctx.ellipse(0, 0, 35, 45, 0, 0, Math.PI*2); ctx.fill();
                    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(-10, -40); ctx.lineTo(10, -40); ctx.lineTo(0, 20); ctx.fill(); 
                }

                ctx.save(); 
                let headY = -10;
                if (kartModel.type === 'moto') { headY = 10; ctx.translate(steer * -15, 0); } 
                else if (kartModel.type === 'f1') headY = 0;
                else if (kartModel.type === 'tank') headY = 5;
                else if (kartModel.type === 'tractor') headY = 15; 
                else if (kartModel.type === 'plane') headY = -5;
                else if (kartModel.type === 'luxury') headY = -10; 

                ctx.translate(0, headY);
                drawCharacterHead(ctx, charId, steer);
                ctx.restore();
                ctx.restore();
                return;
            }

            if ((CHARACTERS[charId] || CHARACTERS[0]).name === 'DK') {
                drawWheels(28, 38, '#2c3e50');
            } else if ((CHARACTERS[charId] || CHARACTERS[0]).name === 'BOWSER') {
                drawWheels(34, 44);
            } else if ((CHARACTERS[charId] || CHARACTERS[0]).name === 'YOSHI') {
                drawWheels(18, 28, '#27ae60');
            } else if ((CHARACTERS[charId] || CHARACTERS[0]).name === 'PEACH') {
                drawWheels(16, 26, '#ecf0f1');
            } else if ((CHARACTERS[charId] || CHARACTERS[0]).name === 'WARIO') {
                drawWheels(26, 32); 
            } else if ((CHARACTERS[charId] || CHARACTERS[0]).name === 'TOAD') {
                drawWheels(14, 22);
            } else {
                drawWheels(20, 30);
                ctx.fillStyle = '#95a5a6'; ctx.fillRect(-15, 15, 30, 18); ctx.strokeStyle = (CHARACTERS[charId] || CHARACTERS[0]).color; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-25, -20); ctx.lineTo(25, -20); ctx.lineTo(35, 10); ctx.lineTo(-35, 10); ctx.closePath(); ctx.stroke();
            }

            drawCharacterHead(ctx, charId, steer);
            ctx.restore(); 
        },

        renderUI: function(ctx, w, h) {
            const d = Logic;
            hudMessages = hudMessages.filter(m => m.life > 0);
            hudMessages.forEach((m, i) => { ctx.save(); ctx.translate(w/2, h/2 - i*45); if(m.scale < 1) m.scale += 0.1; ctx.scale(m.scale, m.scale); ctx.fillStyle = m.color; ctx.font = `bold ${m.size}px 'Russo One'`; ctx.textAlign = 'center'; ctx.shadowColor = 'black'; ctx.shadowBlur = 10; ctx.fillText(m.text, 0, 0); ctx.restore(); m.life--; });

            if (d.state === 'GAMEOVER') return; 

            if (ctx.roundRect) {
                ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.beginPath(); ctx.roundRect(20, 100, 70, 70, 15); ctx.fill();
                ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = 3; ctx.stroke();
            } else {
                ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(20, 100, 70, 70);
            }

            if (d.item) {
                ctx.font = "40px Arial"; ctx.textAlign = "center";
                let emoji = d.item === 'mushroom' ? '🍄' : (d.item === 'banana' ? '🍌' : '🐢');
                ctx.fillText(emoji, 55, 150);
            } else {
                ctx.fillStyle = "#aaa"; ctx.font = "bold 14px Arial"; ctx.textAlign = "center";
                ctx.fillText("VAZIO", 55, 140);
            }

            const hudX = w - 80; const hudY = h - 60; 
            ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.arc(hudX, hudY, 55, 0, Math.PI * 2); ctx.fill();
            const rpm = Math.min(1, d.speed / CONF.TURBO_MAX_SPEED); 
            ctx.beginPath(); ctx.arc(hudX, hudY, 50, Math.PI, Math.PI + Math.PI * rpm); ctx.lineWidth = 6; ctx.strokeStyle = d.turboLock ? '#0ff' : '#f33'; ctx.stroke();
            ctx.fillStyle = '#fff'; ctx.font = "bold 36px 'Russo One'"; ctx.textAlign = 'center'; ctx.fillText(Math.floor(d.speed), hudX, hudY + 10);
            ctx.font = "bold 24px 'Russo One'"; ctx.fillStyle = '#ff0'; ctx.fillText(`${d.finalRank}º`, hudX, hudY - 35);
            ctx.fillStyle = '#fff'; ctx.font = "bold 14px 'Russo One'"; ctx.fillText(`VOLTA ${d.lap}/${CONF.TOTAL_LAPS}`, hudX, hudY - 20);

            ctx.fillStyle = '#111'; ctx.fillRect(w/2 - 110, 20, 220, 20); ctx.fillStyle = d.turboLock ? '#0ff' : (d.nitro > 25 ? '#f90' : '#f33'); ctx.fillRect(w/2 - 108, 22, (216) * (d.nitro/100), 16);

            if (ctx.roundRect) {
                ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.beginPath(); ctx.roundRect(20, h - 80, 150, 50, 25); ctx.fill();
            } else {
                ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(20, h - 80, 150, 50);
            }
            let coins = window.Profile ? (window.Profile.coins || 0) : 0;
            ctx.fillStyle = "#f1c40f"; ctx.font = "bold 20px 'Russo One'"; ctx.textAlign = "left";
            ctx.fillText(`🪙 R$ ${(coins/1000).toFixed(1)}k`, 35, h - 48);

            if (minimapPath.length > 0) {
                const mapX = 25, mapY = 190, mapSize = 130; ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'; ctx.fillRect(mapX, mapY, mapSize, mapSize); ctx.save(); ctx.translate(mapX + mapSize/2, mapY + mapSize/2);
                const scale = Math.min((mapSize-20)/minimapBounds.w, (mapSize-20)/minimapBounds.h); ctx.scale(scale, scale); ctx.translate(-(minimapBounds.minX+minimapBounds.maxX)/2, -(minimapBounds.minZ+minimapBounds.maxZ)/2);
                ctx.strokeStyle = '#fff'; ctx.lineWidth = 10; ctx.beginPath(); minimapPath.forEach((p, i) => { if(i===0) ctx.moveTo(p.x, p.z); else ctx.lineTo(p.x, p.z); }); ctx.closePath(); ctx.stroke();
                const drawDot = (pos, c, r) => { const idx = Math.floor((pos/trackLength) * minimapPath.length) % minimapPath.length; const pt = minimapPath[idx]; if(pt){ ctx.fillStyle=c; ctx.beginPath(); ctx.arc(pt.x, pt.z, r, 0, Math.PI*2); ctx.fill(); ctx.strokeStyle="#fff"; ctx.lineWidth=2; ctx.stroke(); } };
                d.rivals.forEach(r => drawDot(r.pos, r.status==='FINISHED' ? '#0f0' : '#ffee00', 22)); drawDot(d.pos, '#ff0000', 26); ctx.restore();
            }

            if (d.virtualWheel.opacity > 0.01) {
                ctx.save(); ctx.globalAlpha = d.virtualWheel.opacity; ctx.translate(d.virtualWheel.x, d.virtualWheel.y);
                if (d.virtualWheel.isHigh) { ctx.shadowBlur = 25; ctx.shadowColor = '#0ff'; }
                ctx.rotate(d.steer * 0.6); ctx.beginPath(); ctx.arc(0, 0, d.virtualWheel.r, 0, Math.PI * 2); ctx.lineWidth = 18; ctx.strokeStyle = '#2d3436'; ctx.stroke();
                ctx.beginPath(); ctx.arc(0, 0, d.virtualWheel.r, -Math.PI * 0.25, -Math.PI * 0.75, true); ctx.lineWidth = 18; ctx.strokeStyle = '#d63031'; ctx.stroke();
                ctx.beginPath(); ctx.arc(0, 0, d.virtualWheel.r, Math.PI * 0.25, Math.PI * 0.75, false); ctx.strokeStyle = '#d63031'; ctx.stroke();
                ctx.beginPath(); ctx.moveTo(-d.virtualWheel.r + 10, 0); ctx.lineTo(d.virtualWheel.r - 10, 0); ctx.moveTo(0, 0); ctx.lineTo(0, d.virtualWheel.r - 10); ctx.lineWidth = 12; ctx.strokeStyle = '#bdc3c7'; ctx.lineCap = 'round'; ctx.stroke();
                ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fillStyle = '#2d3436'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#bdc3c7'; ctx.stroke();
                ctx.fillStyle = '#d63031'; ctx.font = 'bold 10px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText("GT", 0, 1); ctx.restore();
            }
        },

        renderShop: function(ctx, w, h) {
            ctx.fillStyle = "#1e272e"; ctx.fillRect(0, 0, w, h);
            
            ctx.fillStyle = "#f1c40f"; ctx.textAlign = "center"; ctx.font = "bold clamp(26px, 6vw, 45px) 'Russo One'";
            ctx.fillText("OFICINA DE KARTS", w/2, h * 0.1);

            let coins = window.Profile ? (window.Profile.coins || 0) : 0;
            ctx.fillStyle = "#2ecc71"; ctx.font = "bold clamp(18px, 4vw, 24px) 'Chakra Petch'";
            ctx.fillText(`MEU DINHEIRO: R$ ${coins.toLocaleString()}`, w/2, h * 0.16);

            this.shopHitboxes = [];
            
            let tabW = Math.min(w * 0.28, 180); let tabH = 40;
            let tab1X = w/2 - tabW*1.5 - 10; let tab2X = w/2 - tabW/2; let tab3X = w/2 + tabW/2 + 10;
            
            const drawTab = (x, text, isActive, actionId) => {
                ctx.fillStyle = isActive ? "#3498db" : "#7f8c8d";
                if(ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, h*0.2, tabW, tabH, 10); ctx.fill(); } else { ctx.fillRect(x, h*0.2, tabW, tabH); }
                ctx.fillStyle = "#fff"; ctx.font = "bold 14px 'Russo One'"; ctx.fillText(text, x + tabW/2, h*0.2 + 25);
                this.shopHitboxes.push({ x: x, y: h*0.2, w: tabW, h: tabH, action: actionId });
            };

            drawTab(tab1X, "LOJA", this.shopTab === 'SHOP', 'tab_shop');
            drawTab(tab2X, "GARAGEM", this.shopTab === 'GARAGE', 'tab_garage');
            drawTab(tab3X, "PEÇAS", this.shopTab === 'PARTS', 'tab_parts');

            const cx = w/2; const cy = h*0.55;

            if (this.shopTab === 'SHOP' || this.shopTab === 'GARAGE') {
                let maxIdx = this.shopTab === 'SHOP' ? KART_MODELS.length - 1 : this.garage.length - 1;
                if (this.shopCarouselIdx > maxIdx) this.shopCarouselIdx = 0;
                
                let currentItem = this.shopTab === 'SHOP' ? KART_MODELS[this.shopCarouselIdx] : KART_MODELS[this.garage[this.shopCarouselIdx].modelId];

                let carW = Math.min(600, w * 0.9);
                ctx.fillStyle = "rgba(0,0,0,0.5)";
                if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(cx - carW/2, cy - 130, carW, 260, 20); ctx.fill(); } else { ctx.fillRect(cx - carW/2, cy - 130, carW, 260); }

                ctx.fillStyle = "#fff"; ctx.font = "bold 50px Arial";
                ctx.fillText("<", cx - carW/2 + 40, cy); 
                this.shopHitboxes.push({ x: cx - carW/2, y: cy - 60, w: 100, h: 120, action: 'prev' });
                ctx.fillText(">", cx + carW/2 - 40, cy); 
                this.shopHitboxes.push({ x: cx + carW/2 - 100, y: cy - 60, w: 100, h: 120, action: 'next' });

                let charColor = CHARACTERS[this.selectedChar].color;
                this.drawKartSprite(ctx, cx, cy - 20, w * 0.0035, 0, 0, 0, charColor, this.selectedChar, currentItem.id);

                ctx.fillStyle = "#fff"; ctx.font = "bold 26px 'Russo One'"; ctx.fillText(currentItem.name, cx, cy + 60);
                ctx.fillStyle = "#aaa"; ctx.font = "14px Arial"; ctx.fillText(currentItem.desc, cx, cy + 85);

                let btnW = 180; let btnH = 45; let btnY = cy + 105;
                
                if (this.shopTab === 'SHOP') {
                    if (currentItem.id === 0) {
                        ctx.fillStyle = "#2ecc71"; ctx.fillText("JÁ VEM DE FÁBRICA", cx, btnY + 25);
                    } else {
                        let canBuy = coins >= currentItem.price;
                        ctx.fillStyle = canBuy ? "#9b59b6" : "#7f8c8d";
                        if(ctx.roundRect) { ctx.beginPath(); ctx.roundRect(cx - btnW/2, btnY, btnW, btnH, 8); ctx.fill(); } else { ctx.fillRect(cx - btnW/2, btnY, btnW, btnH); }
                        ctx.fillStyle = "#fff"; ctx.font = "bold 18px 'Russo One'"; ctx.fillText(`COMPRAR R$${currentItem.price}`, cx, btnY + 28);
                        this.shopHitboxes.push({ x: cx - btnW/2, y: btnY, w: btnW, h: btnH, action: 'buy_kart', modelId: currentItem.id });
                    }
                } 
                else if (this.shopTab === 'GARAGE') {
                    let isEquipped = (this.activeKartIdx === this.shopCarouselIdx);
                    ctx.fillStyle = isEquipped ? "#27ae60" : "#34495e";
                    if(ctx.roundRect) { ctx.beginPath(); ctx.roundRect(cx - btnW - 5, btnY, btnW, btnH, 8); ctx.fill(); } else { ctx.fillRect(cx - btnW - 5, btnY, btnW, btnH); }
                    ctx.fillStyle = "#fff"; ctx.font = "bold 16px 'Russo One'"; ctx.fillText(isEquipped ? "EQUIPADO" : "EQUIPAR", cx - btnW/2 - 5, btnY + 28);
                    if (!isEquipped) this.shopHitboxes.push({ x: cx - btnW - 5, y: btnY, w: btnW, h: btnH, action: 'equip' });

                    if (this.garage.length > 1) {
                        ctx.fillStyle = "#e74c3c";
                        if(ctx.roundRect) { ctx.beginPath(); ctx.roundRect(cx + 5, btnY, btnW, btnH, 8); ctx.fill(); } else { ctx.fillRect(cx + 5, btnY, btnW, btnH); }
                        let refund = Math.floor(currentItem.price * 0.5);
                        ctx.fillStyle = "#fff"; ctx.fillText(`VENDER (+R$${refund})`, cx + btnW/2 + 5, btnY + 28);
                        this.shopHitboxes.push({ x: cx + 5, y: btnY, w: btnW, h: btnH, action: 'sell' });
                    }
                }
            }
            else if (this.shopTab === 'PARTS') {
                const upgradesList = [
                    { id: 'engine', name: '⚙️ MOTOR DE CORRIDA', desc: 'Aceleração e Velocidade Extra', levels: [0, 1500, 4000] },
                    { id: 'tires', name: '🛞 PNEUS ESPECIAIS', desc: 'Curvas / Menos Lento na Terra', levels: [0, 1200, 3000] },
                    { id: 'suspension', name: '🏎️ SUSPENSÃO PESADA', desc: 'Amortece saltos de explosões', levels: [0, 2000, 5000] }
                ];

                const rowH = Math.min(80, h * 0.15); const gap = Math.min(15, h * 0.02); 
                const boxW = Math.min(600, w * 0.9); const boxX = w/2 - boxW/2;
                const partStartY = h * 0.28;
                
                upgradesList.forEach((upg, i) => {
                    let currentLvl = this.kartUpgrades[upg.id] || 1;
                    let nextCost = upg.levels[currentLvl]; 
                    
                    let y = partStartY + i * (rowH + gap);
                    ctx.fillStyle = "rgba(0,0,0,0.5)"; 
                    if(ctx.roundRect) { ctx.beginPath(); ctx.roundRect(boxX, y, boxW, rowH, 10); ctx.fill(); } else { ctx.fillRect(boxX, y, boxW, rowH); }
                    
                    ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.font = "bold 18px 'Russo One'";
                    ctx.fillText(`${upg.name} (LVL ${currentLvl})`, boxX + 15, y + rowH * 0.4);
                    ctx.fillStyle = "#aaa"; ctx.font = "14px Arial"; ctx.fillText(upg.desc, boxX + 15, y + rowH * 0.7);

                    if (currentLvl < 3) {
                        let btnW = boxW * 0.28; let btnH = rowH * 0.7;
                        let btnX = boxX + boxW - btnW - 10; let btnY = y + rowH/2 - btnH/2;
                        let canBuy = coins >= nextCost;
                        
                        ctx.fillStyle = canBuy ? "#f39c12" : "#7f8c8d";
                        if(ctx.roundRect) { ctx.beginPath(); ctx.roundRect(btnX, btnY, btnW, btnH, 8); ctx.fill(); } else { ctx.fillRect(btnX, btnY, btnW, btnH); }
                        ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = "bold 16px 'Russo One'";
                        ctx.fillText(`R$ ${nextCost}`, btnX + btnW/2, btnY + btnH/2 + 5);
                        this.shopHitboxes.push({ x: btnX, y: btnY, w: btnW, h: btnH, action: 'buy_upgrade', type: upg.id, targetLvl: currentLvl + 1, cost: nextCost });
                    } else {
                        ctx.fillStyle = "#2ecc71"; ctx.textAlign = "right"; ctx.font = "bold 18px 'Russo One'"; ctx.fillText("MÁXIMO", boxX + boxW - 15, y + rowH/2 + 6);
                    }
                });
            }

            let backW = 200; let backH = 45;
            let backX = w/2 - backW/2; let backY = h * 0.88;
            ctx.fillStyle = "#c0392b"; 
            if(ctx.roundRect) { ctx.beginPath(); ctx.roundRect(backX, backY, backW, backH, 20); ctx.fill(); } else { ctx.fillRect(backX, backY, backW, backH); }
            ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = "bold 16px 'Russo One'";
            ctx.fillText("VOLTAR AO LOBBY", w/2, backY + 28);
            this.shopHitboxes.push({ x: backX, y: backY, w: backW, h: backH, action: 'back' });
        },

        renderModeSelect: function(ctx, w, h) {
            ctx.fillStyle = "#2c3e50"; ctx.fillRect(0, 0, w, h); ctx.fillStyle = "white"; ctx.textAlign = "center"; ctx.font = "bold 40px 'Russo One'"; ctx.fillText("KART LEGENDS", w/2, h * 0.3);
            ctx.fillStyle = "#e67e22"; ctx.fillRect(w/2 - 160, h * 0.45, 320, 65); ctx.fillStyle = "#27ae60"; ctx.fillRect(w/2 - 160, h * 0.6, 320, 65);
            ctx.fillStyle = "white"; ctx.font = "bold 20px 'Russo One'"; ctx.fillText("ARCADE (SOLO)", w/2, h * 0.45 + 40); ctx.fillText("ONLINE (P2P)", w/2, h * 0.6 + 40);
        },

        renderLobby: function(ctx, w, h) {
            ctx.fillStyle = "#2c3e50"; ctx.fillRect(0, 0, w, h); const char = CHARACTERS[this.selectedChar];
            this.lobbyHitboxes = []; 

            ctx.fillStyle = char.color; ctx.beginPath(); ctx.arc(w/2, h*0.2, 45, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = "white"; ctx.textAlign = "center"; ctx.font = "bold 28px 'Russo One'"; ctx.fillText(char.name, w/2, h*0.2 + 70);
            this.lobbyHitboxes.push({ x: w/2 - 60, y: h*0.2 - 50, w: 120, h: 130, action: 'change_char' });
            
            ctx.fillStyle = "#f1c40f"; ctx.font = "20px 'Russo One'"; 
            if (this.currentFase.mode === 'COIN_HUNT') ctx.fillText(`MISSÃO: COLETE ${this.currentFase.targetCoins} MOEDAS`, w/2, h*0.35);
            else ctx.fillText(`MISSÃO: CHEGUE NO TOP ${this.currentFase.targetRank}`, w/2, h*0.35);
            
            let displayTrack = this.currentFase.id === 'arcade' ? this.selectedTrack : this.currentFase.trackId;
            ctx.fillStyle = "#fff"; ctx.font = "16px 'Russo One'"; ctx.fillText("PISTA: " + TRACKS[displayTrack].name, w/2, h*0.42);
            if (this.currentFase.id === 'arcade') {
                ctx.fillStyle = "#aaa"; ctx.font = "12px Arial"; ctx.fillText("(Clique nesta área para mudar a pista)", w/2, h*0.45);
                this.lobbyHitboxes.push({ x: w/2 - 150, y: h*0.38, w: 300, h: 80, action: 'change_track' });
            }

            let btnWidth = Math.min(320, w * 0.85);
            
            let btnKartY = h*0.52;
            ctx.fillStyle = this.useCustomKart ? "#2ecc71" : "#7f8c8d";
            if(ctx.roundRect) { ctx.beginPath(); ctx.roundRect(w/2 - btnWidth/2, btnKartY, btnWidth, 45, 15); ctx.fill(); }
            else { ctx.fillRect(w/2 - btnWidth/2, btnKartY, btnWidth, 45); }
            ctx.fillStyle = "#fff"; ctx.font = "bold 15px 'Russo One'";
            let currentKartName = this.garage[this.activeKartIdx] ? KART_MODELS[this.garage[this.activeKartIdx].modelId].name : "PADRÃO";
            ctx.fillText(this.useCustomKart ? `USANDO: ${currentKartName}` : "KART: PADRÃO DO PERSONAGEM", w/2, btnKartY + 28);
            this.lobbyHitboxes.push({ x: w/2 - btnWidth/2, y: btnKartY, w: btnWidth, h: 45, action: 'toggle_kart' });

            let btnShopY = h*0.62;
            ctx.fillStyle = "#8e44ad";
            if(ctx.roundRect) { ctx.beginPath(); ctx.roundRect(w/2 - btnWidth/2, btnShopY, btnWidth, 50, 15); ctx.fill(); }
            else { ctx.fillRect(w/2 - btnWidth/2, btnShopY, btnWidth, 50); }
            ctx.fillStyle = "#fff"; ctx.font = "bold 18px 'Russo One'";
            ctx.fillText("⚙️ OFICINA DE KARTS", w/2, btnShopY + 32);
            this.lobbyHitboxes.push({ x: w/2 - btnWidth/2, y: btnShopY, w: btnWidth, h: 50, action: 'open_shop' });

            if (resetBtn) resetBtn.style.display = (this.isOnline && this.isHost) ? 'flex' : 'none';

            if (this.isOnline) {
                const pids = Object.keys(this.remotePlayersData || {}); let startY = h * 0.75; ctx.font = "12px Arial"; ctx.fillStyle = "#ccc"; ctx.fillText("JOGADORES NA SALA:", w/2, startY - 15);
                pids.forEach((pid, i) => {
                    const p = this.remotePlayersData[pid]; 
                    if (Date.now() - (p.lastSeen || 0) > 30000) return; 
                    const isMe = pid === window.System.playerId; const color = CHARACTERS[p.charId || 0].color;
                    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(w/2 - 100, startY + (i*20), 6, 0, Math.PI*2); ctx.fill();
                    ctx.fillStyle = isMe ? "#fff" : "#aaa"; ctx.textAlign = "left"; ctx.fillText(`${CHARACTERS[p.charId||0].name} ${isMe ? '(VOCÊ)' : ''}`, w/2 - 80, startY + (i*20) + 4);
                    if (i === 0) { ctx.fillStyle = "#f1c40f"; ctx.fillText("👑 HOST", w/2 + 50, startY + (i*20) + 4); } else if (p.ready) { ctx.fillStyle = "#2ecc71"; ctx.fillText("✔ PRONTO", w/2 + 50, startY + (i*20) + 4); }
                }); ctx.textAlign = "center";
            }

            if (this.isOnline && this.isHost) {
                const canStart = Object.keys(this.remotePlayersData || {}).length >= 2;
                ctx.fillStyle = canStart ? "#c0392b" : "#7f8c8d"; ctx.fillRect(w/2 - 160, h*0.85, 320, 60); ctx.fillStyle = "white"; ctx.font = "bold 22px 'Russo One'"; ctx.fillText(canStart ? "INICIAR CORRIDA" : "AGUARDANDO PLAYERS...", w/2, h*0.85 + 38);
            } else {
                ctx.fillStyle = this.isReady ? "#e67e22" : "#27ae60"; ctx.fillRect(w/2 - 160, h*0.85, 320, 60); ctx.fillStyle = "white"; ctx.font = "bold 22px 'Russo One'"; ctx.fillText(this.isReady ? "AGUARDANDO HOST..." : "PRONTO!", w/2, h*0.85 + 38);
            }
        }
    };

    if(window.System) {
        window.System.registerGame('drive', 'Kart Legends', '🏎️', Logic, { 
            camOpacity: 0.1,
            phases: [
                { id: 'f1', name: 'COPA COGUMELO', desc: 'Chegue no Pódio (Top 3).', mode: 'RACE', targetRank: 3, trackId: 0, diff: 'EASY', reqLvl: 1 },
                { id: 'f2', name: 'CAÇA ÀS MOEDAS', desc: 'Colete 20 moedas na areia.', mode: 'COIN_HUNT', targetCoins: 20, trackId: 1, diff: 'EASY', reqLvl: 2 },
                { id: 'f3', name: 'GRANDE PRÊMIO', desc: 'Vença a IA Implacável em 1º.', mode: 'RACE', targetRank: 1, trackId: 2, diff: 'HARD', reqLvl: 3 },
                { id: 'arcade', name: 'MODO LIVRE', desc: 'Jogue online ou offline sem regras.', mode: 'RACE', targetRank: 1, trackId: 0, diff: 'MEDIUM', reqLvl: 1 }
            ]
        });
    }

})();