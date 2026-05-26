const fs = require('fs');
let app = fs.readFileSync('C:\\Users\\mauri koop junior\\.gemini\\antigravity\\scratch\\barbearia_deploy\\app.js', 'utf8');

let onloadCode = 
window.onload = function() {
    inicializarLocalStorage();
    
    const params = new URLSearchParams(window.location.search);
    const tenantParam = params.get('barbearia');
    if (tenantParam) {
        sessionStorage.setItem('conviteTenant', tenantParam);
        const devLoginBtn = document.querySelector('.login-btn-master');
        if (devLoginBtn) devLoginBtn.style.display = 'none';
        
        const loginTitle = document.querySelector('.login-title');
        if (loginTitle) {
            const tenants = JSON.parse(localStorage.getItem('tenants')) || [];
            const t = tenants.find(x => x.id === tenantParam);
            if (t) {
                loginTitle.innerHTML = '<span style=\"font-size:14px; opacity:0.8;\">Agendar em:</span><br>' + t.name;
            }
        }
    }
;
app = app.replace('window.onload = function() {\\n    inicializarLocalStorage();', onloadCode);

app = app.replace('tenantId: tenantId,', 'tenantId: sessionStorage.getItem(\"conviteTenant\") || tenantId,');
app = app.replace('calcularRendimentosModal(barber.id, barber.commission);', 'try { calcularRendimentosModal(barber.id, barber.commission); } catch(e) { console.error(\"Erro rendimentos:\", e); }');
app = app.replace('function calcularRendimentosModal(barberId, commission) {', 'function calcularRendimentosModal(barberId, commission) {\\n    if (!barberId) return;');
app = app.replace(/<div class=\"booking-item (\$\{classeCor\}).*?>/g, '<div class=\"booking-item \\" onclick=\"abrirComandaPorAgendamento(\)\" style=\"cursor:pointer;\">');

let newFunctions = 
function abrirComandaPorAgendamento(bookingId) {
    if (!currentUser || currentUser.role === 'cliente') return;
    const bookings = JSON.parse(localStorage.getItem('bookings')) || [];
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return;
    
    if (booking.pagamento === 'concluido') {
        exibirToast('Comanda Fechada', 'Este agendamento já foi pago.', 'info');
        return;
    }
    
    abrirComanda();
    setTimeout(() => {
        const clienteInput = document.getElementById('comandaBuscaCliente');
        if (clienteInput) {
            clienteInput.value = booking.clientName;
        }
        
        adicionarItemComanda('servico', booking.serviceId || 0, booking.service, booking.price);
        window.currentComandaBookingId = booking.id;
    }, 100);
}

const origFinalizarComanda = finalizarComanda;
window.finalizarComanda = function() {
    origFinalizarComanda();
    if (window.currentComandaBookingId) {
        const bookings = JSON.parse(localStorage.getItem('bookings')) || [];
        const idx = bookings.findIndex(b => b.id === window.currentComandaBookingId);
        if (idx !== -1) {
            bookings[idx].pagamento = 'concluido';
            localStorage.setItem('bookings', JSON.stringify(bookings));
            if (typeof renderAgenda === 'function') renderAgenda();
            window.currentComandaBookingId = null;
        }
    }
};
;

app += '\\n' + newFunctions;
app = app.replace('let classeCor = \"status-\" + b.status;', 'let classeCor = \"status-\" + b.status;\\n        if (b.pagamento === \"concluido\") classeCor += \" pago\";');

fs.writeFileSync('C:\\Users\\mauri koop junior\\.gemini\\antigravity\\scratch\\barbearia_deploy\\app_fixed.js', app);
console.log('Fixed app_fixed.js created');
