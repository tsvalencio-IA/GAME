/* =================================================================
   PAINEL DE ADMINISTRAÇÃO E GESTÃO DE USUÁRIOS (SISTEMA GLOBAL)
   STATUS: SUPER GESTOR ATIVADO (ONLINE DETECTOR FIX)
   ================================================================= */

window.Admin = {
    init: function() {
        window.Sfx.click();
        document.getElementById('menu-screen').classList.add('hidden');
        document.getElementById('admin-screen').classList.remove('hidden');
        this.loadUsers();
    },

    loadUsers: function() {
        window.DB.ref('users').on('value', snap => {
            const users = snap.val() || {};
            this.renderUsers(users);
        });
    },

    renderUsers: function(users) {
        const grid = document.getElementById('admin-user-list');
        grid.innerHTML = ''; 
        
        if (!document.getElementById('admin-dynamic-styles')) {
            const style = document.createElement('style');
            style.id = 'admin-dynamic-styles';
            style.innerHTML = `
                .admin-stats-row { display: flex; gap: 15px; margin-top: 5px; font-family: 'Chakra Petch'; color: #ccc; font-size: 0.95rem; align-items: center; }
                .admin-badge { background: rgba(0,176,240,0.15); border: 1px solid #00b0f0; border-radius: 5px; padding: 3px 8px; font-size: 0.75rem; color: #fff; font-family: 'Roboto'; }
                .admin-actions { display: flex; gap: 10px; margin-top: 15px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 15px; }
                .admin-btn-action { padding: 8px 15px; border-radius: 8px; font-weight: bold; cursor: pointer; font-family: 'Russo One'; font-size: 0.85rem; transition: 0.2s; border: none; }
                .btn-gift { background: #2ecc71; color: #fff; } .btn-gift:hover { background: #27ae60; transform: scale(1.05); }
                .btn-delete { background: rgba(231, 76, 60, 0.2); color: #e74c3c; border: 1px solid #e74c3c; } .btn-delete:hover { background: #e74c3c; color: white; transform: scale(1.05); }
                .status-dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; margin-right: 10px; }
                .status-online { background: #2ecc71; box-shadow: 0 0 10px #2ecc71; }
                .status-offline { background: #e74c3c; box-shadow: 0 0 10px #e74c3c; opacity: 0.5; }
                .upgrades-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
            `;
            document.head.appendChild(style);
        }

        const availableGames = window.Games || [];
        const now = Date.now();

        for (let uid in users) {
            const u = users[uid];
            const card = document.createElement('div');
            card.className = 'admin-user-card';

            // NOVO DETECTOR ONLINE (Considera Online se interagiu nos últimos 60 segundos)
            let isOnline = u.status === 'online';
            if (!isOnline && u.lastSeen) {
                if (now - u.lastSeen < 60000) isOnline = true;
            }

            const statusClass = isOnline ? 'status-online' : 'status-offline';
            const statusTitle = isOnline ? 'Online Agora' : 'Offline';

            let upgradesHTML = '';
            if (u.arSave && u.arSave.upgrades) {
                const upg = u.arSave.upgrades;
                upgradesHTML += `
                    <div class="admin-badge">Motor AR V${upg.engine || 1}</div>
                    <div class="admin-badge">Bateria V${upg.battery || 1}</div>
                `;
            }
            if (u.kartSave && u.kartSave.upgrades) {
                const kUpg = u.kartSave.upgrades;
                upgradesHTML += `
                    <div class="admin-badge" style="background:rgba(230,126,34,0.2); border-color:#e67e22;">Kart Motor V${kUpg.engine || 1}</div>
                    <div class="admin-badge" style="background:rgba(230,126,34,0.2); border-color:#e67e22;">Pneus V${kUpg.tires || 1}</div>
                `;
            }
            if (upgradesHTML === '') upgradesHTML = `<span style="font-size: 0.8rem; color: #777;">Nenhum item comprado.</span>`;

            let togglesHTML = '';
            availableGames.forEach(game => {
                const hasAccess = u.permissions && u.permissions[game.id] === true;
                const activeClass = hasAccess ? 'active' : '';
                const btnText = hasAccess ? `${game.icon} ${game.title}` : `🚫 ${game.title}`;
                togglesHTML += `<button class="admin-toggle-btn ${activeClass}" onclick="window.Admin.togglePermission('${uid}', '${game.id}', ${hasAccess})">${btnText}</button>`;
            });

            let deleteBtnHTML = '';
            if (u.role === 'admin') {
                deleteBtnHTML = `<button class="admin-btn-action btn-delete" style="opacity: 0.5; cursor: not-allowed;" onclick="alert('Sistema: Você não pode excluir a própria conta de Super Gestor!')">🛡️ ADMINISTRAÇÃO</button>`;
            } else {
                deleteBtnHTML = `<button class="admin-btn-action btn-delete" onclick="window.Admin.deleteUser('${uid}', '${u.username}')">🗑️ EXCLUIR PILOTO</button>`;
            }

            card.innerHTML = `
                <div class="admin-user-header">
                    <div class="admin-user-name" style="display: flex; align-items: center;">
                        <span class="status-dot ${statusClass}" title="${statusTitle}"></span>
                        ${u.username} ${u.role === 'admin' ? '<span style="color:#f1c40f; font-size:12px; margin-left:10px;">(GESTOR)</span>' : ''}
                    </div>
                </div>
                
                <div class="admin-stats-row">
                    <span><strong>NÍVEL:</strong> ${u.level || 1}</span>
                    <span>|</span>
                    <span><strong>XP:</strong> ${u.xp || 0}</span>
                    <span>|</span>
                    <span style="color: #2ecc71; font-family: 'Russo One'; font-size: 1.1rem; text-shadow: 0 0 10px rgba(46, 204, 113, 0.3);">🪙 R$ ${(u.coins || 0).toLocaleString()}</span>
                </div>

                <div style="margin-top: 15px;">
                    <div style="font-size: 0.75rem; color: #aaa; text-transform: uppercase; margin-bottom: 4px;">Inventário:</div>
                    <div class="upgrades-list">${upgradesHTML}</div>
                </div>

                <div class="admin-toggles" style="margin-top: 15px;">
                    <div style="width: 100%; font-size: 0.75rem; color: #aaa; text-transform: uppercase; margin-bottom: 4px;">Permissões de Acesso:</div>
                    ${togglesHTML}
                </div>

                <div class="admin-actions">
                    <button class="admin-btn-action btn-gift" onclick="window.Admin.giftCoins('${uid}', '${u.username}')">🎁 DAR DINHEIRO (R$)</button>
                    ${deleteBtnHTML}
                </div>
            `;
            grid.appendChild(card);
        }
    },

    togglePermission: function(uid, gameId, currentState) {
        window.Sfx.click();
        window.DB.ref(`users/${uid}/permissions/${gameId}`).set(!currentState);
    },

    deleteUser: function(uid, username) {
        window.Sfx.error();
        if(confirm(`ATENÇÃO THIAGO:\nTem certeza absoluta que deseja EXCLUIR o piloto ${username} permanentemente da base de dados?`)) {
            window.DB.ref('users/' + uid).remove();
        }
    },

    giftCoins: function(uid, username) {
        window.Sfx.coin();
        const amountStr = prompt(`Quantos Reais (R$) deseja enviar de presente para a conta de ${username}?\n(Digite apenas números)`);
        if (!amountStr) return;
        const amount = parseInt(amountStr);
        if (isNaN(amount) || amount <= 0) { alert("Valor inválido. A operação foi cancelada."); return; }

        window.DB.ref('users/' + uid + '/coins').once('value').then(snap => {
            const currentCoins = snap.val() || 0;
            const newTotal = currentCoins + amount;
            window.DB.ref('users/' + uid + '/coins').set(newTotal).then(() => {
                alert(`Sucesso! R$ ${amount} foram depositados na conta de ${username}.`);
                window.Sfx.epic();
            });
        });
    }
};