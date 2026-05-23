const fs = require('fs');
const path = 'C:/Users/mauri koop junior/.gemini/antigravity/scratch/barbearia_deploy/app.js';
const content = fs.readFileSync(path, 'utf8');

const startStr = '    // Coluna de horários';
const endStr = 'function adicionarItemComanda(tipo, id, nome, preco) {';

const startIdx = content.indexOf(startStr);
const endIdx = content.indexOf(endStr);

if (startIdx !== -1 && endIdx !== -1) {
    const chunk = `    // Coluna de horários
    html += '<div class="agenda-time-col">';
    slots.forEach(t => {
        const isHora = t.endsWith(':00');
        html += \`<div class="agenda-time-label\${isHora ? ' hora-cheia' : ''}">\${isHora ? t : '<span style="opacity:.4">'+t+'</span>'}</div>\`;
    });
    html += '</div>';

    // Colunas dos barbeiros
    if (barbers.length === 0) {
        html += '<div style="flex:1;display:flex;align-items:center;justify-content:center;padding:40px;color:var(--text-muted);font-size:14px;">' +
                '<i class="fa-solid fa-user-slash" style="margin-right:8px;"></i> Nenhum profissional ativo cadastrado.</div>';
    } else {
        barbers.forEach(barber => {
            const barberBookings = dayBookings.filter(b => b.barberId == barber.id);

            html += \`<div class="agenda-barber-col" style="position:relative;">\`;

            // Header do barbeiro
            let avatarHtml = barber.foto
                ? \`<img class="agenda-barber-avatar-sm" src="\${barber.foto}" alt="\${barber.name || barber.nome}">\`
                : \`<div class="agenda-barber-avatar-icon"><i class="fa-solid fa-user"></i></div>\`;

            html += \`<div class="agenda-barber-header">\${avatarHtml}<span class="agenda-barber-name">\${(barber.name || barber.nome).split(' ')[0]}</span></div>\`;

            // Linha de horário atual
            if (isToday && nowMinutes >= startMin && nowMinutes <= endMin) {
                html += \`<div class="agenda-now-line" style="top:\${nowOffset + 52}px;"></div>\`;
            }

            // Slots
            slots.forEach(slot => {
                const booking = barberBookings.find(b => b.time === slot);
                const isHora  = slot.endsWith(':00');

                if (booking) {
                    const statusClass = booking.status === 'concluido' ? 'concluido' : 'pendente';
                    const clientName  = _getClientNameById(booking.clientId) || booking.clienteNome || 'Cliente';
                    const serviceName = booking.servicos && booking.servicos.length > 0 ? (booking.servicos[0].name || booking.servicos[0].nome) : booking.servico || '—';
                    html += \`<div class="agenda-slot ocupado\${isHora ? ' hora-cheia' : ''}" data-barber="\${barber.id}" data-slot="\${slot}">
                                <div class="agenda-booking-card \${statusClass}" onclick="verDetalhesComanda('\${booking.id}')" title="\${clientName} — \${serviceName}">
                                    <i class="fa-solid fa-circle" style="font-size:6px;"></i>
                                    <span>\${clientName.split(' ')[0]} · \${serviceName}</span>
                                </div>
                             </div>\`;
                } else {
                    html += \`<div class="agenda-slot\${isHora ? ' hora-cheia' : ''}"
                                onclick="abrirComanda('\${barber.id}','\${slot}','\${dateStr}')"
                                data-barber="\${barber.id}" data-slot="\${slot}">
                                <div class="agenda-slot-add"><i class="fa-solid fa-plus"></i> Abrir</div>
                             </div>\`;
                }
            });

            html += '</div>'; // .agenda-barber-col
        });
    }

    container.innerHTML = html;
}

function _getClientNameById(id) {
    if (!id) return null;
    const customers = JSON.parse(localStorage.getItem('customers') || '[]');
    const c = customers.find(c => c.id == id);
    return c ? (c.name || c.nome) : null;
}

// ==========================================================================
// MODAL DE COMANDA — ESTADO E FUNÇÕES
// ==========================================================================

const _cmd = {
    barberId:    null,
    barberName:  '',
    time:        null,
    date:        null,
    clientId:    null,
    clientName:  '',
    items:       [],         // { tipo, id, nome, preco }
    pagamento:   'dinheiro'
};

function _popularHorariosComanda() {
    const sel = document.getElementById('comandaHorario');
    if (!sel) return;
    const slots = _gerarSlots();
    sel.innerHTML = slots.map(s => \`<option value="\${s}">\${s}</option>\`).join('');
}

function _popularBarbeirosComanda() {
    const sel = document.getElementById('comandaBarbeiroSelect');
    if (!sel) return;
    const barbers = JSON.parse(localStorage.getItem('barbers') || '[]').filter(b => b.active !== false);
    sel.innerHTML = '<option value="">— Selecione —</option>' +
        barbers.map(b => \`<option value="\${b.id}">\${b.name || b.nome || 'Barbeiro'}</option>\`).join('');
}

function abrirComanda(barberId, slot, dateStr) {
    // Resetar estado
    _cmd.barberId   = barberId;
    _cmd.barberName = '';
    _cmd.time       = slot;
    _cmd.date       = dateStr;
    _cmd.clientId   = null;
    _cmd.clientName = '';
    _cmd.items      = [];
    _cmd.pagamento  = 'dinheiro';

    // Preencher campos
    _popularBarbeirosComanda();
    _popularHorariosComanda();

    // Data padrão = data da agenda ou hoje
    const dataInput = document.getElementById('comandaData');
    if (dataInput) dataInput.value = dateStr || _dateToISO(new Date());

    // Horário pré-selecionado
    const horaSel = document.getElementById('comandaHorario');
    if (horaSel && slot) horaSel.value = slot;

    // Barbeiro pré-selecionado
    const barberSel = document.getElementById('comandaBarbeiroSelect');
    if (barberSel && barberId) {
        barberSel.value = barberId;
        onComandaBarberChange();
    }

    // Limpar campo de cliente
    limparClienteComanda();

    // Pagamento padrão
    selecionarPagamento('dinheiro', document.getElementById('pgDinheiro'));

    // Renderizar listas de serviços e produtos
    _renderizarListaServicosComanda();
    _renderizarListaProdutosComanda();
    _atualizarResumoComanda();

    // Abrir modal
    document.getElementById('modalComanda').classList.add('active');
}

function fecharComanda() {
    document.getElementById('modalComanda').classList.remove('active');
}

function onComandaBarberChange() {
    const barberSel = document.getElementById('comandaBarbeiroSelect');
    const barbers = JSON.parse(localStorage.getItem('barbers') || '[]');
    const barber  = barbers.find(b => b.id == barberSel?.value);
    _cmd.barberId   = barber ? barber.id : null;
    _cmd.barberName = barber ? (barber.name || barber.nome) : '';

    // Atualizar avatar e sub do header
    const avatarEl = document.getElementById('comandaBarberAvatar');
    const subEl    = document.getElementById('comandaHeaderSub');
    if (barber) {
        if (barber.foto && avatarEl) avatarEl.innerHTML = \`<img src="\${barber.foto}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">\`;
        else if (avatarEl) avatarEl.innerHTML = '<i class="fa-solid fa-scissors"></i>';
        if (subEl) {
            const horaSel = document.getElementById('comandaHorario');
            const dataInput = document.getElementById('comandaData');
            subEl.textContent = \`\${barber.name || barber.nome} · \${dataInput?.value || '—'} às \${horaSel?.value || '—'}\`;
        }
    } else {
        if (avatarEl) avatarEl.innerHTML = '<i class="fa-solid fa-scissors"></i>';
        if (subEl) subEl.textContent = 'Selecione o profissional e horário';
    }
}

// Busca de clientes com typeahead
let _clienteSearchTimer = null;
function buscarClienteComanda(query) {
    clearTimeout(_clienteSearchTimer);
    const resultsEl = document.getElementById('comandaClienteResults');
    if (!resultsEl) return;

    if (!query || query.trim().length < 2) {
        resultsEl.style.display = 'none';
        return;
    }

    _clienteSearchTimer = setTimeout(() => {
        const customers = JSON.parse(localStorage.getItem('customers') || '[]');
        const q = query.toLowerCase();
        const matches = customers.filter(c =>
            ((c.name || c.nome) || '').toLowerCase().includes(q) ||
            ((c.phone || c.telefone) || '').replace(/\D/g,'').includes(q.replace(/\D/g,''))
        ).slice(0, 8);

        if (matches.length === 0) {
            resultsEl.innerHTML = '<div style="padding:12px 14px;font-size:12px;color:var(--text-muted);">Nenhum cliente encontrado</div>';
        } else {
            resultsEl.innerHTML = matches.map(c => \`
                <div class="comanda-cliente-result-item" onclick="selecionarClienteComanda('\${c.id}', '\${((c.name || c.nome)||'').replace(/'/g,"\\\\'")}')">
                    <strong>\${(c.name || c.nome) || 'Sem nome'}</strong>
                    <span>\${(c.phone || c.telefone) || ''} \${c.email ? '· '+c.email : ''}</span>
                </div>
            \`).join('');
        }
        resultsEl.style.display = 'block';
    }, 250);
}

function selecionarClienteComanda(clientId, clientName) {
    _cmd.clientId   = clientId;
    _cmd.clientName = clientName;

    // Esconder campo de busca e mostrar selecionado
    const searchEl = document.getElementById('comandaClienteSearch');
    const resultsEl = document.getElementById('comandaClienteResults');
    const selEl    = document.getElementById('comandaClienteSelecionado');
    const nomeEl   = document.getElementById('comandaClienteNomeSel');

    if (searchEl) searchEl.style.display = 'none';
    if (resultsEl) resultsEl.style.display = 'none';
    if (selEl) selEl.style.display = 'flex';
    if (nomeEl) nomeEl.textContent = clientName;
}

function limparClienteComanda() {
    _cmd.clientId   = null;
    _cmd.clientName = '';

    const searchEl  = document.getElementById('comandaClienteSearch');
    const resultsEl = document.getElementById('comandaClienteResults');
    const selEl     = document.getElementById('comandaClienteSelecionado');

    if (searchEl) { searchEl.style.display = ''; searchEl.value = ''; }
    if (resultsEl) resultsEl.style.display = 'none';
    if (selEl) selEl.style.display = 'none';
}

function _renderizarListaServicosComanda() {
    const services = JSON.parse(localStorage.getItem('services') || '[]').filter(s => s.ativo !== false);
    const listEl = document.getElementById('comandaServicosList');
    if (!listEl) return;

    if (services.length === 0) {
        listEl.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text-muted);">Nenhum serviço cadastrado</div>';
        return;
    }

    listEl.innerHTML = services.map(s => \`
        <div class="comanda-item-row">
            <div class="comanda-item-nome">\${s.name || s.nome}</div>
            <div class="comanda-item-preco">R$ \${parseFloat(s.price || s.preco || 0).toFixed(2).replace('.',',')}</div>
            <button class="comanda-item-add-btn" onclick="adicionarItemComanda('servico','\${s.id}','\${((s.name || s.nome)||'').replace(/'/g,"\\\\'")}',\${parseFloat(s.price || s.preco || 0)})" title="Adicionar">
                <i class="fa-solid fa-plus"></i>
            </button>
        </div>
    \`).join('');
}

function _renderizarListaProdutosComanda() {
    const products = JSON.parse(localStorage.getItem('products') || '[]').filter(p => p.ativo !== false);
    const listEl = document.getElementById('comandaProdutosList');
    if (!listEl) return;

    if (products.length === 0) {
        listEl.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text-muted);">Nenhum produto cadastrado</div>';
        return;
    }

    listEl.innerHTML = products.map(p => \`
        <div class="comanda-item-row">
            <div class="comanda-item-nome">\${p.name || p.nome}</div>
            <div class="comanda-item-preco">R$ \${parseFloat(p.price || p.preco || 0).toFixed(2).replace('.',',')}</div>
            <button class="comanda-item-add-btn" onclick="adicionarItemComanda('produto','\${p.id}','\${((p.name || p.nome)||'').replace(/'/g,"\\\\'")}',\${parseFloat(p.price || p.preco || 0)})" title="Adicionar">
                <i class="fa-solid fa-plus"></i>
            </button>
        </div>
    \`).join('');
}

`;
    const newContent = content.substring(0, startIdx) + chunk + content.substring(endIdx);
    fs.writeFileSync(path, newContent, 'utf8');
    console.log('Fixed app.js successfully!');
} else {
    console.log('Could not find startIdx or endIdx!');
}
