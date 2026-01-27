// LÓGICA DO JOGO: OTTO BOXING (REMASTERED - NEON IMPACT)
(function() {
    let particles = [];
    let popups = []; // Textos flutuantes de dano

    const Logic = {
        sc:0, tg:[], last:0,
        init: function(){ 
            this.sc=0; this.tg=[]; particles=[]; popups=[];
            window.System.msg("FIGHT!"); 
        },
        
        update: function(ctx, w, h, pose){
            const now=Date.now();
            
            // 1. FUNDO DINÂMICO (Clube de Luta)
            // Escurece o fundo para destacar os alvos neon
            ctx.fillStyle = '#050505'; ctx.fillRect(0,0,w,h);
            
            // Holofotes de fundo
            const spotX = Math.sin(now/1000) * w * 0.5 + w/2;
            const grad = ctx.createRadialGradient(spotX, 0, 50, spotX, h, w);
            grad.addColorStop(0, 'rgba(255, 255, 255, 0.1)');
            grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);

            // 2. DESENHA ESQUELETO (Core Handle)
            if(window.Gfx) window.Gfx.drawSkeleton(ctx, pose, w, h);
            
            // Mapeia punhos
            let hits=[];
            if(pose){
                const kp=pose.keypoints, lw=kp.find(k=>k.name==='left_wrist'), rw=kp.find(k=>k.name==='right_wrist');
                if(lw&&lw.score>0.3) hits.push(window.Gfx.map(lw,w,h));
                if(rw&&rw.score>0.3) hits.push(window.Gfx.map(rw,w,h));
            }

            // 3. GERA ALVOS
            if(now-this.last>800){ // Ritmo
                this.tg.push({
                    x:Math.random()*(w*0.7)+w*0.15, 
                    y:Math.random()*(h*0.5)+h*0.15, 
                    r:w*0.09, 
                    s:now,
                    maxAge: 1500
                });
                this.last=now;
            }

            // 4. PROCESSA ALVOS
            this.tg.forEach((t,i)=>{
                const age = now - t.s;
                const lifePct = 1 - (age / t.maxAge);
                
                if(lifePct <= 0){ this.tg.splice(i,1); return; }
                
                // Desenha Alvo (Energy Orb)
                const pulse = Math.sin(now/100) * 5;
                
                // Anel externo (Timer)
                ctx.beginPath();
                ctx.arc(t.x, t.y, t.r, -Math.PI/2, (-Math.PI/2) + (Math.PI*2*lifePct));
                ctx.strokeStyle = lifePct < 0.3 ? '#ff0000' : '#ffff00';
                ctx.lineWidth = 8; ctx.stroke();
                
                // Centro (Orb)
                const gradOrb = ctx.createRadialGradient(t.x, t.y, t.r*0.2, t.x, t.y, t.r);
                gradOrb.addColorStop(0, 'rgba(255, 255, 0, 0.8)');
                gradOrb.addColorStop(1, 'rgba(255, 100, 0, 0.1)');
                ctx.fillStyle = gradOrb;
                ctx.beginPath(); ctx.arc(t.x, t.y, t.r + pulse, 0, Math.PI*2); ctx.fill();
                
                // Crosshair visual
                ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth=2;
                ctx.beginPath(); 
                ctx.moveTo(t.x-10, t.y); ctx.lineTo(t.x+10, t.y);
                ctx.moveTo(t.x, t.y-10); ctx.lineTo(t.x, t.y+10);
                ctx.stroke();

                // Colisão
                hits.forEach(hPos=>{
                    if(Math.hypot(hPos.x-t.x, hPos.y-t.y) < t.r*1.5){
                        this.tg.splice(i,1); 
                        this.sc+=100; 
                        
                        // EFEITOS DE IMPACTO
                        window.Sfx.hit();
                        window.Gfx.shake(8); // Treme a tela
                        
                        // Partículas
                        for(let p=0; p<12; p++){
                            particles.push({
                                x: t.x, y: t.y,
                                vx: (Math.random()-0.5)*15, vy: (Math.random()-0.5)*15,
                                color: '#ffff00', life: 1.0
                            });
                        }
                        // Popup de texto
                        popups.push({x: t.x, y: t.y, text: "HIT!", life: 1.0, dy: -2});
                    }
                });
            });

            // 5. RENDERIZA EFEITOS (PARTICULAS E POPUPS)
            particles.forEach((p,i)=>{
                p.x+=p.vx; p.y+=p.vy; p.life-=0.05;
                if(p.life<=0) particles.splice(i,1);
                else {
                    ctx.fillStyle = p.color; ctx.globalAlpha = p.life;
                    ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI*2); ctx.fill();
                }
            });
            
            popups.forEach((p,i)=>{
                p.y += p.dy; p.life -= 0.02;
                if(p.life<=0) popups.splice(i,1);
                else {
                    ctx.fillStyle = "#fff"; ctx.globalAlpha = p.life;
                    ctx.font = "bold 40px 'Russo One'"; ctx.strokeStyle="#000"; ctx.lineWidth=3;
                    ctx.strokeText(p.text, p.x, p.y); ctx.fillText(p.text, p.x, p.y);
                }
            });
            ctx.globalAlpha = 1.0;

            return this.sc;
        }
    };

    // REGISTRO
    const regLoop = setInterval(() => {
        if(window.System && window.System.registerGame) {
            window.System.registerGame('fight', 'Otto Boxing', '🥊', Logic, {camOpacity: 0.3, showWheel: false});
            window.System.registerGame('mii', 'Coming Soon', '🚧', {init:()=>{window.System.msg("EM BREVE");setTimeout(()=>window.System.home(),1000)},update:()=>0}, {camOpacity:0,showWheel:false});
            clearInterval(regLoop);
        }
    }, 100);
})();
