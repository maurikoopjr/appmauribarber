
// ==========================================================================
// AGENDA TIMELINE — VISUALIZAÇÃO POR COLUNAS COM SLOTS DE 15 MINUTOS
// ==========================================================================

let _agendaDate = new Date(); // Data exibida na timeline

function _gerarSlots() {
    // 08:00 até 19:45 de 15 em 15 minutos = 48 slots
    const slots = [];
    for (let h = 8; h < 20; h++) {
        for (let m = 0; m < 60; m += 15) {
            slots.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
        }
    }
    return slots;
}

function _formatarDataAgenda(date) {
    const dias  = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
    const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const hoje = new Date();
    const amanha = new Date(hoje); amanha.setDate(hoje.getDate() + 1);
    let prefixo = '';
    if (date.toDateString() === hoje.toDateString()) prefixo = 'Hoje — ';
    else if (date.toDateString() === amanha.toDateString()) prefixo = 'Amanhã — ';
    return `${prefixo}${dias[date.getDay()]}, ${date.getDate()} de ${meses[date.getMonth()]}`;
}

function _dateToISO(date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function navegarDiaAgenda(delta) {
    _agendaDate.setDate(_agendaDate.getDate() + delta);
    renderizarAgendaTimeline();
}

function irParaHojeAgenda() {
    _agendaDate = new Date();
    renderizarAgendaTimeline();
}

function renderizarAgendaTimeline() {
    // Atualizar label de data
    const labelEl = document.getElementById('agendaTlDataTexto');
    if (labelEl) labelEl.textContent = _formatarDataAgenda(_agendaDate);

    const barbers  = JSON.parse(localStorage.getItem('barbers')  || '[]').filter(b => b.active !== false);
    const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');
    const dateStr  = _dateToISO(_agendaDate);
    const dayBookings = bookings.filter(b => b.date === dateStr);
    const slots = _gerarSlots();

    const container = document.getElementById('agendaTlContainer');
    if (!container) return;

    // Calcular posição da linha do horário atual
    const now = new Date();
    const isToday = now.toDateString() === _agendaDate.toDateString();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const startMin   = 8 * 60; // 08:00
    const endMin     = 20 * 60; // 20:00
    const nowOffset  = ((nowMinutes - startMin) / (endMin - startMin)) * (slots.length * 40);

    let html = '';

    // Coluna de horários
    html += '<div class="agenda-time-col">';
    slots.forEach(t => {
        const isHora = t.endsWith(':00');
        html += `<div class="agenda-time-label${isHora ? ' hora-cheia' : ''}">${isHora ? t : '<span style="opacity:.4">'+t+'</span>'}</div>`;
    });
    html += '</div>';

    // Colunas dos barbeiros
    if (barbers.length === 0) {
        html += '<div style="flex:1;display:flex;align-items:center;justify-content:center;padding:40px;color:var(--text-muted);font-size:14px;">' +
                '<i class="fa-solid fa-user-slash" style="margin-right:8px;"></i> Nenhum profissional ativo cadastrado.</div>';
    } else {
        barbers.forEach(barber => {
            const barberBookings = dayBookings.filter(b => b.barberId == barber.id);

            html += `<div class="agenda-barber-col" style="position:relative;">`;

            // Header do barbeiro
            let avatarHtml = barber.foto
                ? `<img class="agenda-barber-avatar-sm" src="${barber.foto}" alt="${barber.nome}">`
                : `<div class="agenda-barber-avatar-icon"><i class="fa-solid fa-user"></i></div>`;

            html += `<div class="agenda-barber-header">${avatarHtml}<span class="agenda-barber-name">${barber.nome.split(' ')[0]}</span></div>`;

            // Linha de horário atual
            if (isToday && nowMinutes >= startMin && nowMinutes <= endMin) {
                html += `<div class="agenda-now-line" style="top:${nowOffset + 52}px;"></div>`;
            }

            // Slots
            slots.forEach(slot => {
                const booking = barberBookings.find(b => b.time === slot);
                const isHora  = slot.endsWith(':00');

                if (booking) {
                    const statusClass = booking.status === 'concluido' ? 'concluido' : 'pendente';
                    const clientName  = _getClientNameById(booking.clientId) || booking.clienteNome || 'Cliente';
                    const serviceName = booking.servicos && booking.servicos.length > 0 ? booking.servicos[0].nome : booking.servico || '—';
                    html += `<div class="agenda-slot ocupado${isHora ? ' hora-cheia' : ''}" data-barber="${barber.id}" data-slot="${slot}">
                                <div class="agenda-booking-card ${statusClass}" onclick="verDetalhesComanda('${booking.id}')" title="${clientName} — ${serviceName}">
                                    <i class="fa-solid fa-circle" style="font-size:6px;"></i>
                                    <span>${clientName.split(' ')[0]} · ${serviceName}</span>
                                </div>
                             </div>`;
                } else {
                    html += `<div class="agenda-slot${isHora ? ' hora-cheia' : ''}"
                                onclick="abrirComanda('${barber.id}','${slot}','${dateStr}')"
                                data-barber="${barber.id}" data-slot="${slot}">
                                <div class="agenda-slot-add"><i class="fa-solid fa-plus"></i> Abrir</div>
                             </div>`;
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
    return c ? c.nome : null;
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
    sel.innerHTML = slots.map(s => `<option value="${s}">${s}</option>`).join('');
}

function _popularBarbeirosComanda() {
    const sel = document.getElementById('comandaBarbeiroSelect');
    if (!sel) return;
    const barbers = JSON.parse(localStorage.getItem('barbers') || '[]').filter(b => b.active !== false);
    sel.innerHTML = '<option value="">— Selecione —</option>' +
        barbers.map(b => `<option value="${b.id}">${b.nome}</option>`).join('');
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
    _cmd.barberName = barber ? barber.nome : '';

    // Atualizar avatar e sub do header
    const avatarEl = document.getElementById('comandaBarberAvatar');
    const subEl    = document.getElementById('comandaHeaderSub');
    if (barber) {
        if (barber.foto && avatarEl) avatarEl.innerHTML = `<img src="${barber.foto}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
        else if (avatarEl) avatarEl.innerHTML = '<i class="fa-solid fa-scissors"></i>';
        if (subEl) {
            const horaSel = document.getElementById('comandaHorario');
            const dataInput = document.getElementById('comandaData');
            subEl.textContent = `${barber.nome} · ${dataInput?.value || '—'} às ${horaSel?.value || '—'}`;
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
            (c.nome   || '').toLowerCase().includes(q) ||
            (c.telefone || '').replace(/\D/g,'').includes(q.replace(/\D/g,''))
        ).slice(0, 8);

        if (matches.length === 0) {
            resultsEl.innerHTML = '<div style="padding:12px 14px;font-size:12px;color:var(--text-muted);">Nenhum cliente encontrado</div>';
        } else {
            resultsEl.innerHTML = matches.map(c => `
                <div class="comanda-cliente-result-item" onclick="selecionarClienteComanda(${c.id}, '${(c.nome||'').replace(/'/g,"\\'")}')">
                    <strong>${c.nome || 'Sem nome'}</strong>
                    <span>${c.telefone || ''} ${c.email ? '· '+c.email : ''}</span>
                </div>
            `).join('');
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

    listEl.innerHTML = services.map(s => `
        <div class="comanda-item-row">
            <div class="comanda-item-nome">${s.nome}</div>
            <div class="comanda-item-preco">R$ ${parseFloat(s.preco||0).toFixed(2).replace('.',',')}</div>
            <button class="comanda-item-add-btn" onclick="adicionarItemComanda('servico','${s.id}','${(s.nome||'').replace(/'/g,"\\'")}',${parseFloat(s.preco||0)})" title="Adicionar">
                <i class="fa-solid fa-plus"></i>
            </button>
        </div>
    `).join('');
}

function _renderizarListaProdutosComanda() {
    const products = JSON.parse(localStorage.getItem('products') || '[]').filter(p => p.ativo !== false);
    const listEl = document.getElementById('comandaProdutosList');
    if (!listEl) return;

    if (products.length === 0) {
        listEl.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text-muted);">Nenhum produto cadastrado</div>';
        return;
    }

    listEl.innerHTML = products.map(p => `
        <div class="comanda-item-row">
            <div class="comanda-item-nome">${p.nome}</div>
            <div class="comanda-item-preco">R$ ${parseFloat(p.preco||0).toFixed(2).replace('.',',')}</div>
            <button class="comanda-item-add-btn" onclick="adicionarItemComanda('produto','${p.id}','${(p.nome||'').replace(/'/g,"\\'")}',${parseFloat(p.preco||0)})" title="Adicionar">
                <i class="fa-solid fa-plus"></i>
            </button>
        </div>
    `).join('');
}

function adicionarItemComanda(tipo, id, nome, preco) {
    _cmd.items.push({ tipo, id, nome, preco: parseFloat(preco) });
    _atualizarResumoComanda();
}

function removerItemComanda(index) {
    _cmd.items.splice(index, 1);
    _atualizarResumoComanda();
}

function _atualizarResumoComanda() {
    const listEl  = document.getElementById('comandaResumoList');
    const totalEl = document.getElementById('comandaTotalValor');
    if (!listEl || !totalEl) return;

    const total = _cmd.items.reduce((s, i) => s + i.preco, 0);
    totalEl.textContent = 'R$ ' + total.toFixed(2).replace('.', ',');

    if (_cmd.items.length === 0) {
        listEl.innerHTML = '<div class="comanda-resumo-vazio"><i class="fa-solid fa-basket-shopping" style="font-size:24px;margin-bottom:8px;"></i><span>Nenhum item adicionado</span></div>';
        return;
    }

    listEl.innerHTML = _cmd.items.map((item, idx) => `
        <div class="comanda-resumo-item">
            <span class="comanda-resumo-item-nome">${item.tipo === 'servico' ? '✂️' : '📦'} ${item.nome}</span>
            <span class="comanda-resumo-item-preco">R$ ${item.preco.toFixed(2).replace('.',',')}</span>
            <button class="comanda-resumo-item-remove" onclick="removerItemComanda(${idx})"><i class="fa-solid fa-xmark"></i></button>
        </div>
    `).join('');
}

function selecionarPagamento(tipo, btn) {
    _cmd.pagamento = tipo;
    document.querySelectorAll('.pagamento-btn').forEach(b => b.classList.remove('ativo'));
    if (btn) btn.classList.add('ativo');
}

function _validarComanda() {
    const barberId = document.getElementById('comandaBarbeiroSelect')?.value;
    const data     = document.getElementById('comandaData')?.value;
    const hora     = document.getElementById('comandaHorario')?.value;

    if (!barberId) { exibirToast('Campo obrigatório', 'Selecione um profissional.', 'info'); return null; }
    if (!data)     { exibirToast('Campo obrigatório', 'Informe a data.', 'info'); return null; }
    if (!hora)     { exibirToast('Campo obrigatório', 'Informe o horário.', 'info'); return null; }
    if (_cmd.items.length === 0) { exibirToast('Comanda vazia', 'Adicione pelo menos um serviço ou produto.', 'info'); return null; }

    return { barberId, data, hora };
}

function salvarAgendamentoComanda() {
    const valid = _validarComanda();
    if (!valid) return;
    const { barberId, data, hora } = valid;

    const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');

    // Verificar conflito
    const conflito = bookings.find(b => b.barberId == barberId && b.date === data && b.time === hora);
    if (conflito) {
        exibirToast('Horário Ocupado', `${hora} já possui agendamento para este profissional.`, 'info');
        return;
    }

    const barbers = JSON.parse(localStorage.getItem('barbers') || '[]');
    const barber  = barbers.find(b => b.id == barberId);

    const novoAgendamento = {
        id:         'bk_' + Date.now(),
        barberId,
        barberNome: barber ? barber.nome : '',
        clientId:   _cmd.clientId,
        clienteNome: _cmd.clientName || 'Avulso',
        date:       data,
        time:       hora,
        servicos:   _cmd.items.filter(i => i.tipo === 'servico'),
        produtos:   _cmd.items.filter(i => i.tipo === 'produto'),
        total:      _cmd.items.reduce((s, i) => s + i.preco, 0),
        status:     'pendente',
        obs:        document.getElementById('comandaObs')?.value || '',
        criadoEm:   new Date().toISOString()
    };

    bookings.push(novoAgendamento);
    localStorage.setItem('bookings', JSON.stringify(bookings));

    fecharComanda();
    renderizarAgendaTimeline();
    exibirToast('Agendamento Salvo! 📅', `${barber?.nome || 'Profissional'} — ${data} às ${hora}`, 'success');
    if (typeof criarAlertaSistema === 'function') criarAlertaSistema(`Agendamento criado: ${_cmd.clientName || 'Avulso'} com ${barber?.nome} em ${data} às ${hora}`);
}

function finalizarComanda() {
    const valid = _validarComanda();
    if (!valid) return;
    const { barberId, data, hora } = valid;

    const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');
    const sales    = JSON.parse(localStorage.getItem('sales')    || '[]');
    const barbers  = JSON.parse(localStorage.getItem('barbers')  || '[]');
    const barber   = barbers.find(b => b.id == barberId);

    const total = _cmd.items.reduce((s, i) => s + i.preco, 0);

    const novoAgendamento = {
        id:          'bk_' + Date.now(),
        barberId,
        barberNome:  barber ? barber.nome : '',
        clientId:    _cmd.clientId,
        clienteNome: _cmd.clientName || 'Avulso',
        date:        data,
        time:        hora,
        servicos:    _cmd.items.filter(i => i.tipo === 'servico'),
        produtos:    _cmd.items.filter(i => i.tipo === 'produto'),
        total,
        status:      'concluido',
        pagamento:   _cmd.pagamento,
        obs:         document.getElementById('comandaObs')?.value || '',
        criadoEm:    new Date().toISOString(),
        finalizadoEm: new Date().toISOString()
    };

    const novaVenda = {
        id:         'vd_' + Date.now(),
        data:       data,
        hora:       hora,
        barberId,
        barberNome: barber ? barber.nome : '',
        clienteNome: _cmd.clientName || 'Avulso',
        itens:      _cmd.items,
        total,
        pagamento:  _cmd.pagamento,
        bookingId:  novoAgendamento.id
    };

    bookings.push(novoAgendamento);
    sales.push(novaVenda);
    localStorage.setItem('bookings', JSON.stringify(bookings));
    localStorage.setItem('sales',    JSON.stringify(sales));

    // Atualizar fidelidade do cliente
    if (_cmd.clientId) {
        const customers = JSON.parse(localStorage.getItem('customers') || '[]');
        const idx = customers.findIndex(c => c.id == _cmd.clientId);
        if (idx >= 0) {
            customers[idx].totalVisitas  = (customers[idx].totalVisitas  || 0) + 1;
            customers[idx].totalGasto    = (customers[idx].totalGasto    || 0) + total;
            customers[idx].ultimoServico = new Date().toISOString();
            localStorage.setItem('customers', JSON.stringify(customers));
        }
    }

    fecharComanda();
    renderizarAgendaTimeline();

    const pgLabel = { dinheiro: 'Dinheiro 💵', cartao: 'Cartão 💳', pix: 'PIX ⚡' };
    exibirToast('Comanda Finalizada! ✅',
        `R$ ${total.toFixed(2).replace('.',',')} via ${pgLabel[_cmd.pagamento] || _cmd.pagamento}`, 'success');
    if (typeof criarAlertaSistema === 'function')
        criarAlertaSistema(`Venda finalizada: ${_cmd.clientName || 'Avulso'} · R$ ${total.toFixed(2)} (${_cmd.pagamento})`);
}

function verDetalhesComanda(bookingId) {
    const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');
    const b = bookings.find(bk => bk.id === bookingId);
    if (!b) return;

    const total = (b.total || 0).toFixed(2).replace('.', ',');
    const servicos = (b.servicos || []).map(s => s.nome).join(', ') || '—';
    const produtos  = (b.produtos  || []).map(p => p.nome).join(', ') || '—';

    const msg = `📋 Agendamento\n` +
        `Cliente: ${b.clienteNome || 'Avulso'}\n` +
        `Profissional: ${b.barberNome || '—'}\n` +
        `Data/Hora: ${b.date} às ${b.time}\n` +
        `Serviços: ${servicos}\n` +
        `Produtos: ${produtos}\n` +
        `Total: R$ ${total}\n` +
        `Status: ${b.status || 'pendente'}\n` +
        (b.pagamento ? `Pagamento: ${b.pagamento}` : '');

    alert(msg);
}

// ==========================================================================
// SISTEMA & BACKUP — EXPORTAR / IMPORTAR / RESETAR
// ==========================================================================

const BACKUP_KEYS = ['customers','barbers','services','products','bookings','sales','notifications','visualConfig'];

function renderizarSistema() {
    const lastBackup = localStorage.getItem('lastBackupDate');
    const infoEl = document.getElementById('backupLastInfo');
    if (infoEl) {
        if (lastBackup) {
            const d = new Date(lastBackup);
            const dias = Math.floor((Date.now() - d.getTime()) / 86400000);
            const alerta = dias > 7 ? '⚠️ ' : '✅ ';
            infoEl.innerHTML = `${alerta}Último backup: ${d.toLocaleDateString('pt-BR')} (${dias === 0 ? 'hoje' : dias + ' dia(s) atrás'})`;
        } else {
            infoEl.textContent = '❌ Nenhum backup realizado ainda';
        }
    }
}

function exportarDados() {
    const dados = {};
    BACKUP_KEYS.forEach(key => {
        const val = localStorage.getItem(key);
        if (val) { try { dados[key] = JSON.parse(val); } catch(e) { dados[key] = val; } }
    });

    dados._meta = {
        versao: '1.0',
        exportadoEm: new Date().toISOString(),
        app: 'Barbearia Premium',
        totalClientes: (dados.customers || []).length,
        totalAgendamentos: (dados.bookings || []).length,
        totalVendas: (dados.sales || []).length
    };

    const json = JSON.stringify(dados, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const dataStr = new Date().toISOString().split('T')[0];
    a.href     = url;
    a.download = `barbearia_backup_${dataStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    localStorage.setItem('lastBackupDate', new Date().toISOString());
    renderizarSistema();
    exibirToast('Backup Realizado! 💾', `Arquivo JSON baixado com ${dados._meta.totalClientes} clientes e ${dados._meta.totalAgendamentos} agendamentos.`, 'success');
    if (typeof criarAlertaSistema === 'function') criarAlertaSistema('Gerente realizou backup completo dos dados do sistema.');
}

function importarDados(input) {
    const file = input.files[0];
    if (!file) return;
    if (!file.name.endsWith('.json')) {
        exibirToast('Formato Inválido', 'Selecione um arquivo .json de backup.', 'info');
        input.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const dados = JSON.parse(e.target.result);

            if (!confirm(`⚠️ ATENÇÃO!\n\nEsta ação VAI SUBSTITUIR todos os dados atuais pelos do backup.\n\n` +
                `Backup de: ${dados._meta?.exportadoEm ? new Date(dados._meta.exportadoEm).toLocaleString('pt-BR') : 'data desconhecida'}\n` +
                `Clientes: ${(dados.customers||[]).length}\n` +
                `Agendamentos: ${(dados.bookings||[]).length}\n\nDeseja continuar?`)) {
                input.value = '';
                return;
            }

            BACKUP_KEYS.forEach(key => {
                if (dados[key] !== undefined) {
                    localStorage.setItem(key, JSON.stringify(dados[key]));
                }
            });

            input.value = '';
            exibirToast('Dados Restaurados! 🔄', 'Todos os dados foram importados com sucesso. A página será recarregada.', 'success');
            if (typeof criarAlertaSistema === 'function') criarAlertaSistema('Gerente importou backup de dados. Sistema restaurado.');

            setTimeout(() => location.reload(), 2000);

        } catch(err) {
            console.error('importarDados:', err);
            exibirToast('Arquivo Inválido', 'O arquivo selecionado não é um backup válido.', 'info');
            input.value = '';
        }
    };
    reader.readAsText(file);
}

function resetarTodosDados() {
    if (!confirm('⚠️ ATENÇÃO MÁXIMA!\n\nTodos os dados serão APAGADOS permanentemente:\n• Clientes\n• Agendamentos\n• Vendas\n• Serviços\n• Produtos\n• Profissionais\n\nEsta ação NÃO pode ser desfeita!\n\nTem certeza absoluta?')) return;
    if (!confirm('SEGUNDA CONFIRMAÇÃO\n\nTEM ABSOLUTA CERTEZA?\nTodos os dados serão perdidos.')) return;

    BACKUP_KEYS.forEach(key => localStorage.removeItem(key));
    exibirToast('Dados Apagados', 'Todos os dados foram removidos. A página será recarregada.', 'info');
    setTimeout(() => location.reload(), 1500);
}

// Atualizar aplicarIdentidadeVisual para usar o novo elemento da logo
const _origAplicarIdentidade = typeof aplicarIdentidadeVisual === 'function' ? aplicarIdentidadeVisual : null;
function aplicarIdentidadeVisual(cfg) {
    const nome = cfg.nomeBarbearia || 'The Golden Blade';
    const tag  = cfg.tagline || "Gentleman's Club";

    document.querySelectorAll('.logo-text').forEach(el => el.textContent = nome);
    document.querySelectorAll('.logo-tag').forEach(el  => el.textContent = tag);

    const loginH2   = document.querySelector('.login-logo h2');
    const loginSpan = document.querySelector('.login-logo span');
    if (loginH2)   loginH2.textContent   = nome;
    if (loginSpan) loginSpan.textContent  = tag;

    const logoIconHeader = document.getElementById('appLogoIcon');
    const loginIconEl    = document.querySelector('.login-logo-icon');

    if (cfg.logoBase64) {
        if (logoIconHeader) logoIconHeader.innerHTML = `<img src="${cfg.logoBase64}" alt="Logo" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
        if (loginIconEl)    loginIconEl.innerHTML    = `<img src="${cfg.logoBase64}" alt="Logo" style="width:54px;height:54px;object-fit:cover;border-radius:50%;border:2px solid var(--accent-gold);">`;
    } else {
        if (logoIconHeader) logoIconHeader.innerHTML = `<i class="fa-solid fa-scissors"></i>`;
        if (loginIconEl)    loginIconEl.innerHTML    = `<i class="fa-solid fa-scissors"></i>`;
    }
}
