/* ==========================================================================
   APP.JS - BARBEARIA PREMIUM & GESTÃO (GENTLEMAN'S CLUB)
   ========================================================================== */

let currentUser = null; // Guardará o perfil e dados do usuário logado

// ==========================================================================
// FIREBASE CONFIGURATION E INICIALIZAÇÃO (COMPAT V8)
// ==========================================================================

const firebaseConfig = {
  apiKey: "AIzaSyDieJPR5zEgBzK9Y_LzFUZQBwsVZKKJIsM",
  authDomain: "teste-app-mauri-barber.firebaseapp.com",
  projectId: "teste-app-mauri-barber",
  storageBucket: "teste-app-mauri-barber.firebasestorage.app",
  messagingSenderId: "295258163520",
  appId: "1:295258163520:web:0b8d914217ba5cd5a312a5",
  measurementId: "G-YED9V5N1DP"
};

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();
const auth = firebase.auth();

// ==========================================================================
// CAPA MULTITENANT SAAS E SINCRONIZAÇÃO FIREBASE
// ==========================================================================

const _origGetItem = Storage.prototype.getItem;
const _origSetItem = Storage.prototype.setItem;

function getActiveTenantId() {
    if (currentUser && currentUser.tenantId) {
        return currentUser.tenantId;
    }
    const session = sessionStorage.getItem("currentSession");
    if (session) {
        try {
            const u = JSON.parse(session);
            if (u && u.tenantId) return u.tenantId;
        } catch(e) {}
    }
    return "t_default";
}

Storage.prototype.getItem = function(key) {
    const val = _origGetItem.call(this, key);
    if (!val) return val;

    const multitenantKeys = ["customers", "barbers", "services", "products", "bookings", "sales", "notifications", "visualConfig"];
    if (!multitenantKeys.includes(key)) return val;

    if (currentUser && currentUser.role === "desenvolvedor") {
        return val; // Super Admin sees raw consolidated database
    }

    const tenantId = getActiveTenantId();
    try {
        const data = JSON.parse(val);
        if (Array.isArray(data)) {
            return JSON.stringify(data.filter(item => item.tenantId === tenantId));
        } else if (data && typeof data === "object") {
            if (data.tenantId && data.tenantId !== tenantId) {
                return null;
            }
        }
    } catch(e) {}

    return val;
};

Storage.prototype.setItem = function(key, value) {
    const multitenantKeys = ["customers", "barbers", "services", "products", "bookings", "sales", "notifications", "visualConfig"];
    if (!multitenantKeys.includes(key)) {
        return _origSetItem.call(this, key, value);
    }

    const tenantId = getActiveTenantId();
    try {
        const newData = JSON.parse(value);
        if (Array.isArray(newData)) {
            const rawVal = _origGetItem.call(this, key);
            const allRaw = rawVal ? JSON.parse(rawVal) : [];
            const otherTenantsData = Array.isArray(allRaw) 
                ? allRaw.filter(item => item.tenantId !== tenantId) 
                : [];
                
            const updatedNewData = newData.map(item => {
                if (!item.tenantId) item.tenantId = tenantId;
                return item;
            });
            
            const merged = [...otherTenantsData, ...updatedNewData];
            const strVal = JSON.stringify(merged);
            _origSetItem.call(this, key, strVal);
            sincronizarComFirebase(key, tenantId, updatedNewData);
            return;
        } else if (newData && typeof newData === "object") {
            newData.tenantId = tenantId;
            const strVal = JSON.stringify(newData);
            _origSetItem.call(this, key, strVal);
            sincronizarComFirebase(key, tenantId, newData);
            return;
        }
    } catch(e) {}

    const ret = _origSetItem.call(this, key, value);
    sincronizarComFirebase(key, getActiveTenantId(), value);
    return ret;
};

// ==========================================================================
// FUNÇÕES DE SINCRONIZAÇÃO FIREBASE (UPLOAD E DOWNLOAD)
// ==========================================================================
let firebaseListeners = [];

function sincronizarComFirebase(key, tenantId, data) {
    if (!tenantId || tenantId === "t_default") return;
    
    // Evita upload se o desenvolvedor está acessando a master db
    if (currentUser && currentUser.role === "desenvolvedor") return;

    // Converte para string para salvar genérico no Firestore
    const dataStr = typeof data === "string" ? data : JSON.stringify(data);
    
    // Salva na coleção do Inquilino
    db.collection('barbearias_dados')
      .doc(tenantId)
      .collection('storage')
      .doc(key)
      .set({ payload: dataStr, updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
      .catch(e => console.error("Erro ao sincronizar " + key, e));
}

function iniciarEscutaFirebase() {
    const tenantId = getActiveTenantId();
    if (!tenantId || tenantId === "t_default") return;

    // Limpar listeners antigos
    firebaseListeners.forEach(unsub => unsub());
    firebaseListeners = [];

    const multitenantKeys = ["customers", "barbers", "services", "products", "bookings", "sales", "notifications", "visualConfig"];

    multitenantKeys.forEach(key => {
        const unsub = db.collection('barbearias_dados')
          .doc(tenantId)
          .collection('storage')
          .doc(key)
          .onSnapshot(doc => {
              if (doc.exists) {
                  const dataStr = doc.data().payload;
                  
                  // Atualizar localStorage local silenciosamente
                  const rawVal = _origGetItem.call(localStorage, key);
                  let currentRaw = [];
                  try { currentRaw = JSON.parse(rawVal) || []; } catch(e){}
                  
                  try {
                      const incomingData = JSON.parse(dataStr);
                      // Mesclar com os dados dos outros tenants se for array
                      if (Array.isArray(currentRaw) && Array.isArray(incomingData)) {
                          const otherTenants = currentRaw.filter(i => i.tenantId !== tenantId);
                          _origSetItem.call(localStorage, key, JSON.stringify([...otherTenants, ...incomingData]));
                      } else {
                          // Se for object
                          _origSetItem.call(localStorage, key, dataStr);
                      }
                      
                      // Forçar atualização da UI baseada na role atual (se estiver logado)
                      if (currentUser && currentUser.role === "gerente") {
                          if (document.getElementById("abaGerenteDashboard").classList.contains("active")) atualizarDashboard();
                          if (document.getElementById("abaGerenteAgenda").classList.contains("active")) renderizarAgendaTimeline();
                      } else if (currentUser && currentUser.role === "barbeiro") {
                          if (document.getElementById("abaBarbeiroAgenda").classList.contains("active")) renderizarAgendaBarbeiro();
                      }
                  } catch (e) {
                      _origSetItem.call(localStorage, key, dataStr);
                  }
              }
          });
        firebaseListeners.push(unsub);
    });
}

// Estado da Sessão Ativa

// Estado de agendamento temporário
let tempBooking = {
    barberId: null,
    serviceId: null,
    date: null,
    time: null
};

// ==========================================================================
// BANCO DE DADOS LOCAL INICIAL (LocalStorage Seeds)
// ==========================================================================

// Clientes Iniciais (com senha padrão 1234)
const DEFAULT_CUSTOMERS = [
    { id: "c1", name: "Maurício Koop Junior", phone: "(11) 99999-1234", email: "mauricio.koop@vip.com", password: "1234" },
    { id: "c2", name: "Roberto Silva", phone: "(11) 98888-5678", email: "roberto.silva@outlook.com", password: "1234" },
    { id: "c3", name: "Victor Hugo", phone: "(21) 97777-4321", email: "victor.hugo@literatura.com", password: "1234" },
    { id: "c4", name: "Daniel Alves", phone: "(11) 96666-8765", email: "daniel.alves@esporte.com", password: "1234" }
];

// Barbeiros Padrão com Comissão parametrizada, Login e Senha
const DEFAULT_BARBERS = [
    { id: 1, name: "Seu Augusto", login: "augusto", password: "1234", avatar: "assets/barber_1.png", specialty: "Cortes Clássicos & Navalhados", rating: 4.9, commission: 50, active: true },
    { id: 2, name: "Lucas Fade", login: "lucas", password: "1234", avatar: "assets/barber_2.png", specialty: "Degradês & Cortes Modernos", rating: 4.8, commission: 45, active: true },
    { id: 3, name: "Camila Estética", login: "camila", password: "1234", avatar: "assets/barber_3.png", specialty: "Barba Terapia & Tratamentos", rating: 5.0, commission: 55, active: true }
];

// Serviços Padrão
const DEFAULT_SERVICES = [
    { id: "s1", name: "Corte Clássico", price: 50.00, duration: 30, description: "Corte completo com tesoura e máquina, finalizado com lavagem premium." },
    { id: "s2", name: "Barba de Toalha Quente", price: 40.00, duration: 30, description: "Barbear clássico com toalha quente, navalha e óleo hidratante amadeirado." },
    { id: "s3", name: "Combo Golden Blade (Corte + Barba)", price: 80.00, duration: 60, description: "Corte clássico completo e barba com toalha quente por valor promocional." },
    { id: "s4", name: "Terapia Capilar & Massagem", price: 70.00, duration: 45, description: "Massagem craniana relaxante, lavagem terapêutica e hidratação profunda dos fios." }
];

// Produtos Padrão
const DEFAULT_PRODUCTS = [
    { id: "p1", name: "Pomada Modeladora Matte", price: 45.00, description: "Pomada modeladora com fixação forte e acabamento natural sem brilho (efeito seco)." },
    { id: "p2", name: "Óleo de Barba Golden Blend", price: 35.00, description: "Óleo essencial para hidratar a barba, suavizar os fios e perfume amadeirado sutil." },
    { id: "p3", name: "Shampoo Estimulante Capilar", price: 50.00, description: "Fortalece as raízes do cabelo e estimula o crescimento saudável reduzindo a queda." }
];

// Ganhos históricos dos últimos 7 dias (Associados a Clientes e Barbeiros cadastrados)
// Para o cliente Maurício Koop (c1), semeamos atendimentos para habilitar o cartão de fidelidade!
const HISTORICAL_SALES_MOCK = [
    // Seu Augusto (Barber 1)
    { id: "h1", barberId: 1, type: "service", name: "Corte Clássico", price: 50.00, date: "2026-05-18", clientId: "c2", client: "Roberto Silva" },
    { id: "h2", barberId: 1, type: "service", name: "Combo Golden Blade", price: 80.00, date: "2026-05-18", clientId: "c1", client: "Maurício Koop Junior" },
    { id: "h3", barberId: 1, type: "product", name: "Pomada Modeladora Matte", price: 45.00, date: "2026-05-19", clientId: "c2", client: "Roberto Silva" },
    { id: "h4", barberId: 1, type: "service", name: "Corte Clássico", price: 50.00, date: "2026-05-19", clientId: "c1", client: "Maurício Koop Junior" },
    { id: "h5", barberId: 1, type: "service", name: "Barba de Toalha Quente", price: 40.00, date: "2026-05-20", clientId: "c4", client: "Daniel Alves" },
    
    // Lucas Fade (Barber 2)
    { id: "h7", barberId: 2, type: "service", name: "Corte Clássico", price: 50.00, date: "2026-05-17", clientId: "c3", client: "Victor Hugo" },
    { id: "h8", barberId: 2, type: "service", name: "Combo Golden Blade", price: 80.00, date: "2026-05-18", clientId: "c3", client: "Victor Hugo" },
    { id: "h9", barberId: 2, type: "service", name: "Corte Clássico", price: 50.00, date: "2026-05-19", clientId: "c1", client: "Maurício Koop Junior" },
    { id: "h10", barberId: 2, type: "service", name: "Combo Golden Blade", price: 80.00, date: "2026-05-20", clientId: "c4", client: "Daniel Alves" },

    // Camila Estética (Barber 3)
    { id: "h12", barberId: 3, type: "service", name: "Terapia Capilar & Massagem", price: 70.00, date: "2026-05-17", clientId: "c2", client: "Roberto Silva" },
    { id: "h13", barberId: 3, type: "service", name: "Barba de Toalha Quente", price: 40.00, date: "2026-05-18", clientId: "c4", client: "Daniel Alves" },
    { id: "h14", barberId: 3, type: "service", name: "Terapia Capilar & Massagem", price: 70.00, date: "2026-05-18", clientId: "c1", client: "Maurício Koop Junior" },
    { id: "h15", barberId: 3, type: "service", name: "Combo Golden Blade", price: 80.00, date: "2026-05-19", clientId: "c3", client: "Victor Hugo" }
];

// ==========================================================================
// INICIALIZAÇÃO DE PÁGINA E LOCAL STORAGE
// ==========================================================================

window.onload = function() {
    inicializarLocalStorage();
    
    // Verificar se existe sessão salva
    const sessaoSalva = sessionStorage.getItem("currentSession");
    if (sessaoSalva) {
        currentUser = JSON.parse(sessaoSalva);
        logarNaAplicacao(currentUser);
    } else {
        fazerLogout(); // Garante que a tela de login seja exibida
    }
};

function inicializarLocalStorage() {
    // 1. Inicializar Planos SaaS
    const defaultPlans = [
        { id: "plan_bronze", name: "Plano Classic Bronze", price: 59.90, durationDays: 30 },
        { id: "plan_prata", name: "Plano VIP Silver", price: 99.90, durationDays: 30 },
        { id: "plan_gold", name: "Plano Premium Golden", price: 149.90, durationDays: 30 }
    ];
    const existingPlans = _origGetItem.call(localStorage, "plans");
    if (!existingPlans || existingPlans === "[]" || JSON.parse(existingPlans).length === 0) {
        _origSetItem.call(localStorage, "plans", JSON.stringify(defaultPlans));
    }

    // 2. Inicializar Tenants (Barbearias)
    const defaultTenants = [
        {
            id: "t_default",
            name: "The Golden Blade",
            ownerEmail: "gerente",
            ownerPassword: "1234",
            phone: "(11) 99999-8888",
            planId: "plan_gold",
            status: "active",
            trialExpires: Date.now() + 7 * 24 * 60 * 60 * 1000,
            planExpires: Date.now() + 30 * 24 * 60 * 60 * 1000
        }
    ];
    const existingTenants = _origGetItem.call(localStorage, "tenants");
    if (!existingTenants || existingTenants === "[]" || JSON.parse(existingTenants).length === 0) {
        _origSetItem.call(localStorage, "tenants", JSON.stringify(defaultTenants));
    } else {
        // Garantir que t_default existe na lista de tenants
        try {
            const tenantsList = JSON.parse(existingTenants);
            if (!tenantsList.some(t => t.id === "t_default")) {
                tenantsList.push(defaultTenants[0]);
                _origSetItem.call(localStorage, "tenants", JSON.stringify(tenantsList));
            }
        } catch(e) {}
    }

    // 3. Garantir seeds padrão no t_default
    const sessionMock = { tenantId: "t_default" };
    sessionStorage.setItem("currentSession", JSON.stringify(sessionMock));

    if (!localStorage.getItem("customers")) {
        localStorage.setItem("customers", JSON.stringify(DEFAULT_CUSTOMERS.map(c => ({...c, tenantId: "t_default"}))));
    }
    if (!localStorage.getItem("barbers")) {
        localStorage.setItem("barbers", JSON.stringify(DEFAULT_BARBERS.map(b => ({...b, tenantId: "t_default"}))));
    }
    if (!localStorage.getItem("services")) {
        localStorage.setItem("services", JSON.stringify(DEFAULT_SERVICES.map(s => ({...s, tenantId: "t_default"}))));
    }
    if (!localStorage.getItem("products")) {
        localStorage.setItem("products", JSON.stringify(DEFAULT_PRODUCTS.map(p => ({...p, tenantId: "t_default"}))));
    }
    if (!localStorage.getItem("bookings")) {
        localStorage.setItem("bookings", JSON.stringify([]));
    }
    if (!localStorage.getItem("sales")) {
        localStorage.setItem("sales", JSON.stringify(HISTORICAL_SALES_MOCK.map(s => ({...s, tenantId: "t_default"}))));
    }
    if (!localStorage.getItem("notifications")) {
        localStorage.setItem("notifications", JSON.stringify([
            { id: "n1", text: "O gerente ajustou a comissão inicial da barbearia.", time: "Ontem às 10:00", unread: false, tenantId: "t_default" }
        ]));
    }

    sessionStorage.removeItem("currentSession");

    // MIGRAÇÃO: Garantir campos de autenticação e status em todos os usuários
    _migrarAutenticacao();
}

// Migra usuários antigos (sem senha/login) para o novo sistema de autenticação
function _migrarAutenticacao() {
    const keysToMigrate = ["customers", "barbers", "services", "products", "bookings", "sales", "notifications", "visualConfig"];
    keysToMigrate.forEach(key => {
        const rawVal = _origGetItem.call(localStorage, key);
        if (rawVal) {
            try {
                let data = JSON.parse(rawVal);
                let changed = false;
                if (Array.isArray(data)) {
                    data = data.map(item => {
                        if (item && typeof item === "object" && !item.tenantId) {
                            item.tenantId = "t_default";
                            changed = true;
                        }
                        return item;
                    });
                } else if (data && typeof data === "object") {
                    if (!data.tenantId) {
                        data.tenantId = "t_default";
                        changed = true;
                    }
                }
                if (changed) {
                    _origSetItem.call(localStorage, key, JSON.stringify(data));
                }
            } catch(e) {
                console.error("Migration error for key " + key + ":", e);
            }
        }
    });

    // Migrações adicionais de logins/senhas dos barbeiros
    const rawBarbersVal = _origGetItem.call(localStorage, "barbers");
    if (rawBarbersVal) {
        try {
            const barbers = JSON.parse(rawBarbersVal) || [];
            let mudouB = false;
            barbers.forEach(b => {
                if (!b.password) { b.password = "1234"; mudouB = true; }
                if (!b.login) {
                    b.login = b.name.split(" ")[0].toLowerCase()
                        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                        .replace(/[^a-z0-9]/g, "");
                    mudouB = true;
                }
                if (b.active === undefined) { b.active = true; mudouB = true; }
            });
            if (mudouB) _origSetItem.call(localStorage, "barbers", JSON.stringify(barbers));
        } catch(e) {}
    }

    const rawCustomersVal = _origGetItem.call(localStorage, "customers");
    if (rawCustomersVal) {
        try {
            const customers = JSON.parse(rawCustomersVal) || [];
            let mudouC = false;
            customers.forEach(c => {
                if (!c.password) { c.password = "1234"; mudouC = true; }
            });
            if (mudouC) _origSetItem.call(localStorage, "customers", JSON.stringify(customers));
        } catch(e) {}
    }
}

// ==========================================================================
// SISTEMA DE LOGIN E CONTROLE DE PERFIS (Email + Senha)
// ==========================================================================

// Mantida por compatibilidade com chamadas internas (não exibe selects)
function popularListasLogin() { /* selects removidos — login por email/senha */ }

async function fazerLogin(event) {
    event.preventDefault();
    const btn = document.querySelector(".login-btn");
    const originalBtnHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Entrando...';
    btn.disabled = true;

    try {
        const loginVal = document.getElementById("loginEmail").value.trim().toLowerCase();
        const senhaVal = document.getElementById("loginSenha").value;

        let user = null;

        // 1. Verificar DESENVOLVEDOR MASTER (Mauri)
        if (loginVal === "maurikoopjr" && senhaVal === "99597534") {
            user = { role: "desenvolvedor", id: "dev", name: "Mauri Koop Junior (Master)", tenantId: "system", email: "maurikoopjr@thegoldenblade.com" };
        }

        // 2. Verificar Gerentes de Tenants
        if (!user) {
            const tenants = JSON.parse(_origGetItem.call(localStorage, "tenants")) || [];
            const tenant = tenants.find(t => t.ownerEmail.toLowerCase() === loginVal && t.ownerPassword === senhaVal);
            if (tenant) user = { role: "gerente", id: "admin", name: tenant.name, tenantId: tenant.id, email: tenant.ownerEmail };
        }

        // 3. Verificar Barbeiros ativos (Busca em raw database para cruzar tenants)
        if (!user) {
            const rawBarbers = JSON.parse(_origGetItem.call(localStorage, "barbers")) || [];
            const barber = rawBarbers.find(b =>
                b.active !== false &&
                ((b.login && b.login.toLowerCase() === loginVal) || (b.email && b.email.toLowerCase() === loginVal)) &&
                b.password === senhaVal
            );
            if (barber) user = { role: "barbeiro", id: barber.id, name: barber.name, tenantId: barber.tenantId, email: barber.email || `${barber.login}@thegoldenblade.com` };
        }

        // 4. Verificar Clientes (Busca em raw database)
        if (!user) {
            const rawCustomers = JSON.parse(_origGetItem.call(localStorage, "customers")) || [];
            const customer = rawCustomers.find(c => c.email.toLowerCase() === loginVal && c.password === senhaVal);
            if (customer) user = { role: "cliente", id: customer.id, name: customer.name, tenantId: customer.tenantId, email: customer.email };
        }

        // Credenciais inválidas (Local)
        if (!user) {
            throw new Error("E-mail/login ou senha incorretos.");
        }

        // 5. INTEGRAÇÃO FIREBASE AUTH (O Coração da Segurança)
        let fbEmail = user.email || `${loginVal}@thegoldenblade.com`;
        
        try {
            await firebase.auth().signInWithEmailAndPassword(fbEmail, senhaVal);
        } catch (error) {
            // Se o erro for que o usuário não existe no Firebase, nós o criamos! (Migração Transparente)
            if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential' || error.code === 'auth/invalid-login-credentials') {
                try {
                    await firebase.auth().createUserWithEmailAndPassword(fbEmail, senhaVal);
                    // Salvar o mapeamento de Segurança no Banco de Dados para as Regras do Firestore
                    if (firebase.auth().currentUser) {
                        await db.collection("users").doc(firebase.auth().currentUser.uid).set({
                            tenantId: user.tenantId,
                            role: user.role,
                            email: fbEmail
                        });
                    }
                } catch(e) {
                    console.error("Erro ao migrar usuário pro Auth", e);
                    throw new Error("Falha na migração segura da conta. Contate o suporte.");
                }
            } else {
                console.error("Erro Firebase Auth:", error);
                throw new Error("Erro de autenticação na nuvem.");
            }
        }

        // Login finalizado com sucesso
        currentUser = user;
        sessionStorage.setItem("currentSession", JSON.stringify(currentUser));
        logarNaAplicacao(currentUser);
        exibirToast("Bem-vindo! 👋", `${currentUser.name} acessou o sistema com sucesso.`, "success");

    } catch (err) {
        const card = document.querySelector(".login-card");
        if(card) {
            card.style.animation = "none";
            setTimeout(() => { card.style.animation = "shake 0.45s ease"; }, 10);
        }
        exibirToast("Acesso Negado ⚠️", err.message || "Não foi possível fazer login.", "info");
    } finally {
        btn.innerHTML = originalBtnHtml;
        btn.disabled = false;
    }
}

function fazerLogout() {
    currentUser = null;
    sessionStorage.removeItem("currentSession");

    // Desligar listeners do Firebase
    if (typeof firebaseListeners !== "undefined") {
        firebaseListeners.forEach(unsub => unsub());
        firebaseListeners = [];
    }
    // Deslogar Auth
    if (firebase.auth().currentUser) {
        firebase.auth().signOut();
    }

    // Fechar overlay de checkout caso esteja aberto
    const saasOverlay = document.getElementById("saasLockOverlay");
    if (saasOverlay) saasOverlay.style.display = "none";

    // Exibir Login, Ocultar App
    document.getElementById("loginOverlay").style.display = "flex";
    document.getElementById("appMainContainer").style.display = "none";

    // Resetar campos do login
    const emailEl = document.getElementById("loginEmail");
    const senhaEl = document.getElementById("loginSenha");
    if (emailEl) emailEl.value = "";
    if (senhaEl) senhaEl.value = "";

    // Voltar para painel de login
    mostrarLogin();
}

// Alternância entre painéis de login e cadastro
function mostrarCadastro() {
    document.getElementById("painelLogin").classList.remove("active");
    const painelCadTenant = document.getElementById("painelCadastroTenant");
    if (painelCadTenant) painelCadTenant.classList.remove("active");
    document.getElementById("painelCadastro").classList.add("active");
}

function mostrarCadastroTenant() {
    document.getElementById("painelLogin").classList.remove("active");
    const painelCad = document.getElementById("painelCadastro");
    if (painelCad) painelCad.classList.remove("active");
    document.getElementById("painelCadastroTenant").classList.add("active");
}

function mostrarLogin() {
    const painelCad = document.getElementById("painelCadastro");
    const painelCadTenant = document.getElementById("painelCadastroTenant");
    const painelLog = document.getElementById("painelLogin");
    if (painelCad) painelCad.classList.remove("active");
    if (painelCadTenant) painelCadTenant.classList.remove("active");
    if (painelLog) painelLog.classList.add("active");
    
    // Limpar campos do formulário de cadastro
    ["regNome","regTelefone","regEmail","regSenha","regSenhaConfirm", "tenantNome", "tenantEmail", "tenantSenha", "tenantTelefone"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
}

// Mostrar/ocultar senha
function toggleSenhaVisivel(inputId, iconeId) {
    const input = document.getElementById(inputId);
    const icone = document.getElementById(iconeId);
    if (!input || !icone) return;
    if (input.type === "password") {
        input.type = "text";
        icone.className = "fa-regular fa-eye-slash";
    } else {
        input.type = "password";
        icone.className = "fa-regular fa-eye";
    }
}

// Acordeão de credenciais de demonstração
function toggleHints() {
    const body = document.getElementById("hintsBody");
    const chevron = document.getElementById("iconeHints");
    if (!body) return;
    body.classList.toggle("open");
    if (chevron) chevron.style.transform = body.classList.contains("open") ? "rotate(180deg)" : "rotate(0deg)";
}

// Registro de novo cliente a partir do painel de cadastro do login
function registrarNovoCliente(event) {
    event.preventDefault();
    const nome = document.getElementById("regNome").value.trim();
    const telefone = document.getElementById("regTelefone").value.trim();
    const email = document.getElementById("regEmail").value.trim();
    const senha = document.getElementById("regSenha").value;
    const senhaConfirm = document.getElementById("regSenhaConfirm").value;

    if (senha !== senhaConfirm) {
        exibirToast("Senhas não coincidem ⚠️", "Verifique se as senhas digitadas são iguais.", "info");
        return;
    }

    const customers = JSON.parse(localStorage.getItem("customers")) || [];
    if (customers.some(c => c.email.toLowerCase() === email.toLowerCase())) {
        exibirToast("E-mail já cadastrado", "Este endereço já possui uma conta. Faça login.", "info");
        return;
    }

    const novoId = "c_" + Date.now();
    const urlParams = new URLSearchParams(window.location.search);
    const tenantIdUrl = urlParams.get('b');
    const novoCliente = { id: novoId, name: nome, phone: telefone, email: email, password: senha };
    if (tenantIdUrl) novoCliente.tenantId = tenantIdUrl;
    
    customers.push(novoCliente);
    localStorage.setItem("customers", JSON.stringify(customers));

    criarAlertaSistema(`Cadastro: Novo cliente "${nome}" criou uma conta no sistema.`);

    // Auto-login imediato
    currentUser = { role: "cliente", id: novoId, name: nome, tenantId: tenantIdUrl || null };
    sessionStorage.setItem("currentSession", JSON.stringify(currentUser));
    logarNaAplicacao(currentUser);
    exibirToast("Conta Criada! 🎉", `Bem-vindo(a), ${nome}! Seu acesso está ativo.`, "success");
}

function logarNaAplicacao(user) {
    // Esconder Tela de Login, Exibir App
    document.getElementById("loginOverlay").style.display = "none";
    document.getElementById("appMainContainer").style.display = "flex";

    // Atualizar Cabeçalho
    const roleStr = user.role === "cliente" ? "Cliente Club" : user.role === "barbeiro" ? "Barbeiro" : user.role === "desenvolvedor" ? "Desenvolvedor Master" : "Administrador";
    document.getElementById("sessionUserRole").textContent = roleStr;
    document.getElementById("sessionUserName").textContent = user.name;

    // Fechar modais abertos
    fecharModalClienteForm();
    fecharModalForm();

    // Habilitar Portais
    const portalCliente = document.getElementById("portalCliente");
    const portalBarbeiro = document.getElementById("portalBarbeiro");
    const portalGerente = document.getElementById("portalGerente");
    const portalDev = document.getElementById("portalDesenvolvedor");

    if (portalCliente) portalCliente.style.display = "none";
    if (portalBarbeiro) portalBarbeiro.style.display = "none";
    if (portalGerente) portalGerente.style.display = "none";
    if (portalDev) portalDev.style.display = "none";

    // Ocultar overlays de bloqueio
    const lockOverlay = document.getElementById("saasLockOverlay");
    if (lockOverlay) lockOverlay.style.display = "none";

    if (user.role === "desenvolvedor") {
        if (portalDev) portalDev.style.display = "block";
        const tabsDev = document.querySelectorAll("#portalDesenvolvedor .nav-item");
        trocarAbaDesenvolvedor("abaDevDashboard", tabsDev[0]);
        return;
    }

    // VERIFICAR STATUS DA ASSINATURA DO INQUILINO (TENANT)
    const tenants = JSON.parse(_origGetItem.call(localStorage, "tenants")) || [];
    const tenant = tenants.find(t => t.id === user.tenantId);
    
    if (tenant) {
        // Verificar se expirou por tempo
        const expTime = tenant.status === "trial" ? tenant.trialExpires : tenant.planExpires;
        if (expTime && Date.now() > expTime && tenant.status !== "expired") {
            tenant.status = "expired";
            _origSetItem.call(localStorage, "tenants", JSON.stringify(tenants));
        }

        if (tenant.status === "expired") {
            if (user.role === "gerente") {
                // Gerente entra mas vê o overlay bloqueante de pagamento
                if (lockOverlay) {
                    lockOverlay.style.display = "flex";
                    popularCheckoutPlans();
                    atualizarPrecoCheckout();
                }
                return;
            } else {
                // Outros usuários são impedidos na tela de login
                fazerLogout();
                exibirToast("Acesso Suspendido ⚠️", "A assinatura desta barbearia expirou. Entre em contato com o gerente.", "info");
                return;
            }
        }

        // Mostrar aviso de expiração dourado no painel de Gerente
        const alertBox = document.getElementById("saasExpirationAlert");
        const alertTxt = document.getElementById("saasExpirationText");
        if (alertBox && alertTxt) {
            const diasRestantes = Math.max(0, Math.ceil((expTime - Date.now()) / (24 * 60 * 60 * 1000)));
            alertTxt.innerHTML = `Sua assinatura <strong>(${tenant.status === "trial" ? "Teste Grátis" : "Plano Ativo"})</strong> expira em <strong>${diasRestantes} dias</strong>!`;
            alertBox.style.display = diasRestantes <= 5 ? "flex" : "none"; // Mostrar se faltar 5 dias ou menos
        }
    }

    if (user.role === "cliente") {
        if (portalCliente) portalCliente.style.display = "block";
        const tabsClient = document.querySelectorAll("#clientNav .client-nav-item");
        trocarAbaCliente("abaClienteHome", tabsClient[0]);
    } else if (user.role === "barbeiro") {
        if (portalBarbeiro) portalBarbeiro.style.display = "block";
        const tabsBarber = document.querySelectorAll("#portalBarbeiro .nav-item");
        trocarAbaBarbeiro("abaBarbeiroAgenda", tabsBarber[0]);
        atualizarAvatarPainelBarbeiro();
    } else if (user.role === "gerente") {
        if (portalGerente) portalGerente.style.display = "block";
        const tabsGerente = document.querySelectorAll("#portalGerente .nav-item");
        trocarAbaGerente("abaGerenteDashboard", tabsGerente[0]);
    }

    // Iniciar escuta do Firebase Firestore
    if (typeof iniciarEscutaFirebase === "function") {
        iniciarEscutaFirebase();
    }
}

// ==========================================================================
// ABA BARBEIRO - CONTROLES (SPA DO BARBEIRO)
// ==========================================================================

function trocarAbaBarbeiro(idAbaTarget, elementoBtn) {
    const abas = document.querySelectorAll("#portalBarbeiro .tab-content");
    abas.forEach(aba => aba.classList.remove("active"));

    const abaTarget = document.getElementById(idAbaTarget);
    abaTarget.classList.add("active");

    const botoes = document.querySelectorAll("#portalBarbeiro .nav-item");
    botoes.forEach(btn => btn.classList.remove("active"));
    elementoBtn.classList.add("active");

    if (idAbaTarget === "abaBarbeiroAgenda") {
        renderizarAgendaBarbeiro();
    } else if (idAbaTarget === "abaBarbeiroFinanceiro") {
        atualizarFinanceiroBarbeiro();
    } else if (idAbaTarget === "abaBarbeiroClientes") {
        renderizarClientes();
    } else if (idAbaTarget === "abaBarbeiroAlertas") {
        renderizarAlertasBarbeiro();
    }
}

// ==========================================================================
// PORTAL DO CLIENTE - LOGICAS E FIDELIDADE
// ==========================================================================

function atualizarFidelidadeCliente() {
    if (currentUser.role !== "cliente") return;

    const bookings = JSON.parse(localStorage.getItem("bookings")) || [];
    const sales = JSON.parse(localStorage.getItem("sales")) || [];

    // Calcular quantos atendimentos de serviços o cliente logado realizou
    const servConfirmados = bookings.filter(b => b.status === "confirmed" && b.clientName === currentUser.name).length;
    const servHistoricos = sales.filter(s => s.type === "service" && s.clientId === currentUser.id).length;
    const totalServicos = servConfirmados + servHistoricos;

    document.getElementById("fidelityServicesText").innerHTML = `Você já realizou <strong>${totalServicos} de 10</strong> serviços no Club!`;

    // Medidor visual porcentagem
    const pct = Math.min((totalServicos / 10) * 100, 100);
    const fill = document.getElementById("fidelityProgressBarFill");
    const pctText = document.getElementById("fidelityPercentText");

    pctText.textContent = `${pct.toFixed(0)}%`;
    
    // Delay para animação fluida do CSS
    setTimeout(() => {
        fill.style.width = `${pct}%`;
    }, 150);
}

function trocarAbaCliente(idAbaTarget, elementoBtn) {
    const abas = document.querySelectorAll("#portalCliente .tab-content");
    abas.forEach(aba => aba.classList.remove("active"));

    const abaTarget = document.getElementById(idAbaTarget);
    abaTarget.classList.add("active");

    const botoes = document.querySelectorAll("#clientNav .client-nav-item");
    botoes.forEach(btn => btn.classList.remove("active"));
    elementoBtn.classList.add("active");

    if (idAbaTarget === "abaClienteHome") {
        atualizarFidelidadeCliente();
        renderizarCatalogos();
    } else if (idAbaTarget === "abaClienteServicos") {
        renderizarCatalogos();
    } else if (idAbaTarget === "abaClienteAgendar") {
        renderizarPassosAgendamento();
    } else if (idAbaTarget === "abaClienteMeusAgendamentos") {
        renderizarMeusAgendamentos();
    }
}

function renderizarCatalogos() {
    const services = JSON.parse(localStorage.getItem("services")) || [];
    const products = JSON.parse(localStorage.getItem("products")) || [];

    // Destaques Home
    const destaquesGrid = document.getElementById("destaquesServicosGrid");
    if (destaquesGrid) {
        destaquesGrid.innerHTML = "";
        services.slice(0, 2).forEach(serv => {
            destaquesGrid.innerHTML += `
                <div class="catalog-card">
                    <div class="catalog-card-details">
                        <h3 class="catalog-card-title"><i class="fa-solid fa-scissors" style="color: var(--accent-gold); font-size: 14px;"></i> ${serv.name}</h3>
                        <p class="catalog-card-desc">${serv.description}</p>
                        <div class="catalog-card-meta">
                            <span><i class="fa-regular fa-clock"></i> ${serv.duration} min</span>
                        </div>
                    </div>
                    <div class="catalog-card-action">
                        <span class="catalog-card-price">R$ ${serv.price.toFixed(2).replace('.', ',')}</span>
                        <button class="primary-btn" onclick="iniciarAgendamentoRapido('${serv.id}')">Agendar</button>
                    </div>
                </div>
            `;
        });
    }

    // Catálogo Geral
    const clienteServicosGrid = document.getElementById("clienteServicosGrid");
    if (clienteServicosGrid) {
        clienteServicosGrid.innerHTML = "";
        services.forEach(serv => {
            clienteServicosGrid.innerHTML += `
                <div class="catalog-card">
                    <div class="catalog-card-details">
                        <h3 class="catalog-card-title">${serv.name}</h3>
                        <p class="catalog-card-desc">${serv.description}</p>
                        <div class="catalog-card-meta">
                            <span><i class="fa-regular fa-clock"></i> ${serv.duration} min</span>
                        </div>
                    </div>
                    <div class="catalog-card-action">
                        <span class="catalog-card-price">R$ ${serv.price.toFixed(2).replace('.', ',')}</span>
                        <button class="primary-btn" onclick="iniciarAgendamentoRapido('${serv.id}')">Reservar</button>
                    </div>
                </div>
            `;
        });
    }

    // Produtos
    const clienteProdutosGrid = document.getElementById("clienteProdutosGrid");
    if (clienteProdutosGrid) {
        clienteProdutosGrid.innerHTML = "";
        products.forEach(prod => {
            clienteProdutosGrid.innerHTML += `
                <div class="catalog-card">
                    <div class="catalog-card-details">
                        <h3 class="catalog-card-title"><i class="fa-solid fa-bottle-droplet" style="color: var(--accent-gold); font-size: 14px;"></i> ${prod.name}</h3>
                        <p class="catalog-card-desc">${prod.description}</p>
                    </div>
                    <div class="catalog-card-action">
                        <span class="catalog-card-price">R$ ${prod.price.toFixed(2).replace('.', ',')}</span>
                        <button class="primary-btn" onclick="comprarProduto('${prod.id}')"><i class="fa-solid fa-cart-shopping"></i> Comprar</button>
                    </div>
                </div>
            `;
        });
    }
}

function iniciarAgendamentoRapido(serviceId) {
    tempBooking.serviceId = serviceId;
    tempBooking.barberId = null;
    tempBooking.date = null;
    tempBooking.time = null;

    const btnAgendarTab = document.querySelectorAll("#clientNav .client-nav-item")[2];
    trocarAbaCliente("abaClienteAgendar", btnAgendarTab);
}

function comprarProduto(productId) {
    const products = JSON.parse(localStorage.getItem("products"));
    const product = products.find(p => p.id === productId);
    if (!product) return;

    const sales = JSON.parse(localStorage.getItem("sales")) || [];
    const barbers = JSON.parse(localStorage.getItem("barbers"));
    const randomBarber = barbers[Math.floor(Math.random() * barbers.length)];

    const hoje = new Date().toISOString().split('T')[0];

    const novaVenda = {
        id: "p_sale_" + Date.now(),
        barberId: randomBarber.id,
        type: "product",
        name: product.name,
        price: product.price,
        date: hoje,
        clientId: currentUser ? currentUser.id : "c1",
        client: currentUser ? currentUser.name : "Cliente Maurício"
    };

    sales.push(novaVenda);
    localStorage.setItem("sales", JSON.stringify(sales));

    exibirToast("Compra Efetuada! 🧴", `O produto '${product.name}' foi adquirido. R$ ${product.price.toFixed(2)} registrados!`, "success");
    criarAlertaSistema(`Venda de Produto: ${currentUser.name} comprou '${product.name}' (R$ ${product.price.toFixed(2)}) com comissão parcial ao barbeiro ${randomBarber.name}.`);
}

// ==========================================================================
// TELA DE AGENDAMENTO INTERATIVO (EVITAR CONFLITO)
// ==========================================================================

function renderizarPassosAgendamento() {
    const barbers = JSON.parse(localStorage.getItem("barbers"));
    const services = JSON.parse(localStorage.getItem("services"));

    // 1. Passo 1 - Escolha de Barbeiro
    const barberGrid = document.getElementById("bookingBarberGrid");
    barberGrid.innerHTML = "";
    barbers.forEach(barb => {
        const isSelected = tempBooking.barberId === barb.id ? "selected" : "";
        barberGrid.innerHTML += `
            <div class="barber-card ${isSelected}" onclick="selecionarBarbeiroAgendamento(${barb.id})">
                <div class="barber-avatar-container">
                    <img src="${barb.avatar}" alt="${barb.name}" class="barber-avatar">
                </div>
                <div class="barber-name">${barb.name}</div>
                <div class="barber-specialty">${barb.specialty}</div>
                <div class="barber-rating"><i class="fa-solid fa-star"></i> ${barb.rating.toFixed(1)}</div>
            </div>
        `;
    });

    // 2. Passo 2 - Escolha de Serviço
    const servicesList = document.getElementById("bookingServicesList");
    servicesList.innerHTML = "";
    services.forEach(serv => {
        const isSelected = tempBooking.serviceId === serv.id ? "selected" : "";
        servicesList.innerHTML += `
            <div class="booking-service-item ${isSelected}" onclick="selecionarServicoAgendamento('${serv.id}')">
                <div class="booking-service-info">
                    <div class="checkbox-circle"><i class="fa-solid fa-check"></i></div>
                    <div>
                        <strong style="display:block; font-size:15px; margin-bottom:2px;">${serv.name}</strong>
                        <span style="font-size:12px; color:var(--text-secondary);"><i class="fa-regular fa-clock"></i> ${serv.duration} min</span>
                    </div>
                </div>
                <span class="catalog-card-price" style="font-size:16px;">R$ ${serv.price.toFixed(2).replace('.', ',')}</span>
            </div>
        `;
    });

    renderizarDatasAgendamento();
    atualizarResumoAgendamento();
}

function selecionarBarbeiroAgendamento(barberId) {
    tempBooking.barberId = barberId;
    tempBooking.time = null;
    renderizarPassosAgendamento();
    renderizarHorariosAgendamento();
}

function selecionarServicoAgendamento(serviceId) {
    tempBooking.serviceId = serviceId;
    renderizarPassosAgendamento();
}

function renderizarDatasAgendamento() {
    const datesSlider = document.getElementById("bookingDatesSlider");
    datesSlider.innerHTML = "";

    const diasSemana = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    const hoje = new Date();

    for (let i = 0; i < 7; i++) {
        const dataFutura = new Date(hoje);
        dataFutura.setDate(hoje.getDate() + i);

        if (dataFutura.getDay() === 0) continue; 

        const diaSemanaStr = diasSemana[dataFutura.getDay()];
        const diaNum = dataFutura.getDate();
        const dataISO = dataFutura.toISOString().split('T')[0];

        const isSelected = tempBooking.date === dataISO ? "selected" : "";

        datesSlider.innerHTML += `
            <div class="date-slot ${isSelected}" onclick="selecionarDataAgendamento('${dataISO}')">
                <span class="date-day">${diaSemanaStr}</span>
                <span class="date-num">${diaNum}</span>
            </div>
        `;
    }
}

function selecionarDataAgendamento(dateStr) {
    tempBooking.date = dateStr;
    tempBooking.time = null;
    renderizarDatasAgendamento();
    renderizarHorariosAgendamento();
    atualizarResumoAgendamento();
}

function renderizarHorariosAgendamento() {
    const timeSlotsGrid = document.getElementById("bookingTimeSlotsGrid");
    timeSlotsGrid.innerHTML = "";

    if (!tempBooking.barberId) {
        timeSlotsGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); font-size:13px; padding:15px 0;">Selecione o profissional no Passo 1.</div>`;
        return;
    }

    if (!tempBooking.date) {
        timeSlotsGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); font-size:13px; padding:15px 0;">Selecione a data no Passo 3.</div>`;
        return;
    }

    const slots = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00"];
    const bookings = JSON.parse(localStorage.getItem("bookings")) || [];

    slots.forEach(slot => {
        // PREVENÇÃO DE CONFLITO: Verifica se o barbeiro já tem compromisso confirmado nesse dia e hora
        const isConflict = bookings.some(b => 
            b.barberId === tempBooking.barberId && 
            b.date === tempBooking.date && 
            b.time === slot && 
            b.status === "confirmed"
        );

        if (isConflict) {
            timeSlotsGrid.innerHTML += `<div class="time-slot disabled" title="Horário Ocupado">${slot}</div>`;
        } else {
            const isSelected = tempBooking.time === slot ? "selected" : "";
            timeSlotsGrid.innerHTML += `
                <div class="time-slot ${isSelected}" onclick="selecionarHorarioAgendamento('${slot}')">
                    ${slot}
                </div>
            `;
        }
    });
}

function selecionarHorarioAgendamento(timeStr) {
    tempBooking.time = timeStr;
    const slots = document.querySelectorAll("#bookingTimeSlotsGrid .time-slot");
    slots.forEach(s => {
        if (!s.classList.contains("disabled")) {
            s.classList.remove("selected");
            if (s.textContent.trim() === timeStr) s.classList.add("selected");
        }
    });
    atualizarResumoAgendamento();
}

function atualizarResumoAgendamento() {
    const detailsContainer = document.getElementById("bookingSummaryDetails");
    const totalRow = document.getElementById("bookingSummaryTotalRow");
    const btnConfirmar = document.getElementById("btnConfirmarAgendamento");

    if (!tempBooking.barberId || !tempBooking.serviceId) {
        detailsContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 13px; padding: 20px 0;">Selecione o profissional e o serviço.</div>`;
        totalRow.style.display = "none";
        btnConfirmar.style.display = "none";
        return;
    }

    const barbers = JSON.parse(localStorage.getItem("barbers"));
    const services = JSON.parse(localStorage.getItem("services"));

    const selectedBarber = barbers.find(b => b.id === tempBooking.barberId);
    const selectedService = services.find(s => s.id === tempBooking.serviceId);

    let dataFormatada = "Não definida";
    if (tempBooking.date) {
        const partesData = tempBooking.date.split('-');
        dataFormatada = `${partesData[2]}/${partesData[1]}/${partesData[0]}`;
    }

    detailsContainer.innerHTML = `
        <div class="summary-item">
            <span class="summary-item-label">Barbeiro:</span>
            <span class="summary-item-value">${selectedBarber.name}</span>
        </div>
        <div class="summary-item">
            <span class="summary-item-label">Serviço:</span>
            <span class="summary-item-value">${selectedService.name}</span>
        </div>
        <div class="summary-item">
            <span class="summary-item-label">Duração:</span>
            <span class="summary-item-value">${selectedService.duration} min</span>
        </div>
        <div class="summary-item">
            <span class="summary-item-label">Data:</span>
            <span class="summary-item-value">${dataFormatada}</span>
        </div>
        <div class="summary-item">
            <span class="summary-item-label">Horário:</span>
            <span class="summary-item-value">${tempBooking.time ? tempBooking.time : "Não definido"}</span>
        </div>
    `;

    document.getElementById("bookingTotalPrice").textContent = `R$ ${selectedService.price.toFixed(2).replace('.', ',')}`;
    totalRow.style.display = "flex";

    if (tempBooking.date && tempBooking.time) {
        btnConfirmar.style.display = "flex";
    } else {
        btnConfirmar.style.display = "none";
    }
}

function confirmarAgendamento() {
    if (!tempBooking.barberId || !tempBooking.serviceId || !tempBooking.date || !tempBooking.time) return;

    const barbers = JSON.parse(localStorage.getItem("barbers"));
    const services = JSON.parse(localStorage.getItem("services"));

    const selectedBarber = barbers.find(b => b.id === tempBooking.barberId);
    const selectedService = services.find(s => s.id === tempBooking.serviceId);

    const bookings = JSON.parse(localStorage.getItem("bookings")) || [];

    const novoAgendamento = {
        id: "b_" + Date.now(),
        clientId: currentUser.id,
        clientName: currentUser.name,
        barberId: tempBooking.barberId,
        barberName: selectedBarber.name,
        barberAvatar: selectedBarber.avatar,
        serviceId: tempBooking.serviceId,
        serviceName: selectedService.name,
        date: tempBooking.date,
        time: tempBooking.time,
        price: selectedService.price,
        status: "confirmed"
    };

    bookings.push(novoAgendamento);
    localStorage.setItem("bookings", JSON.stringify(bookings));

    const partesData = tempBooking.date.split('-');
    const dataFormatada = `${partesData[2]}/${partesData[1]}`;

    // Disparar Notificação Real-Time
    exibirToast("Agendado com Sucesso! 🎉", `Seu corte com ${selectedBarber.name} está marcado para ${dataFormatada} às ${tempBooking.time}.`, "success");
    
    // Alerta simulado para o barbeiro da cadeira
    setTimeout(() => {
        exibirToast(`Aviso para ${selectedBarber.name} 💈`, `Novo agendamento recebido! Cliente '${currentUser.name}' marcou '${selectedService.name}' para às ${tempBooking.time}.`, "info");
    }, 1500);

    // Salvar nos alertas administrativos e do barbeiro
    criarAlertaSistema(`Novo Agendamento: Cliente '${currentUser.name}' marcou '${selectedService.name}' com ${selectedBarber.name} em ${dataFormatada} às ${tempBooking.time}. Ganhos: R$ ${selectedService.price.toFixed(2)}`);

    // Limpar temp e ir para listagem
    tempBooking = { barberId: null, serviceId: null, date: null, time: null };

    const btnAgendaTab = document.querySelectorAll("#clientNav .client-nav-item")[3];
    trocarAbaCliente("abaClienteMeusAgendamentos", btnAgendaTab);
}

function renderizarMeusAgendamentos() {
    const list = document.getElementById("clienteMeusAgendamentosList");
    list.innerHTML = "";

    const bookings = JSON.parse(localStorage.getItem("bookings")) || [];
    // Filtrar agendamentos deste cliente logado
    const meusAtivos = bookings.filter(b => b.status === "confirmed" && b.clientId === currentUser.id).reverse();

    if (meusAtivos.length === 0) {
        list.innerHTML = `<div class="no-bookings-placeholder"><i class="fa-regular fa-calendar-xmark" style="font-size:32px; color:var(--text-muted); display:block; margin-bottom:12px;"></i>Você não tem nenhum agendamento confirmado no momento.</div>`;
        return;
    }

    meusAtivos.forEach(b => {
        const partesData = b.date.split('-');
        const dataFormatada = `${partesData[2]}/${partesData[1]}/${partesData[0]}`;

        list.innerHTML += `
            <div class="booking-card">
                <img src="${b.barberAvatar}" alt="${b.barberName}" class="booking-card-avatar">
                <div class="booking-card-main">
                    <h3 class="booking-card-barber">${b.barberName}</h3>
                    <span class="booking-card-service">${b.serviceName}</span>
                    <div class="booking-card-datetime">
                        <span><i class="fa-regular fa-calendar" style="color:var(--accent-gold);"></i> ${dataFormatada}</span>
                        <span><i class="fa-regular fa-clock" style="color:var(--accent-gold);"></i> ${b.time}</span>
                    </div>
                </div>
                <div class="booking-card-actions">
                    <span class="booking-card-price">R$ ${b.price.toFixed(2).replace('.', ',')}</span>
                    <button class="danger-btn" onclick="cancelarAgendamento('${b.id}')">Cancelar</button>
                </div>
            </div>
        `;
    });
}

function cancelarAgendamento(bookingId) {
    if (!confirm("Confirmar cancelamento deste agendamento?")) return;

    const bookings = JSON.parse(localStorage.getItem("bookings")) || [];
    const idx = bookings.findIndex(b => b.id === bookingId);
    if (idx === -1) return;

    bookings[idx].status = "canceled";
    localStorage.setItem("bookings", JSON.stringify(bookings));

    const item = bookings[idx];
    const partesData = item.date.split('-');
    const dataFormatada = `${partesData[2]}/${partesData[1]}`;

    exibirToast("Agendamento Cancelado", `Seu horário com ${item.barberName} foi desmarcado.`, "info");
    
    setTimeout(() => {
        exibirToast(`Aviso para ${item.barberName} ⚠️`, `O agendamento de '${item.serviceName}' para ${dataFormatada} às ${item.time} foi CANCELADO pelo cliente.`, "info");
    }, 1200);

    criarAlertaSistema(`Cancelamento: Cliente '${currentUser.name}' desmarcou '${item.serviceName}' com ${item.barberName} em ${dataFormatada} às ${item.time}.`);

    renderizarMeusAgendamentos();
    atualizarFidelidadeCliente();
}

// ==========================================================================
// ABA BARBEIRO - ISOLAMENTO DE DADOS (Agenda e Comissão Pessoal)
// ==========================================================================

function renderizarAgendaBarbeiro() {
    const list = document.getElementById("barbeiroAgendaList");
    list.innerHTML = "";

    const bookings = JSON.parse(localStorage.getItem("bookings")) || [];
    // ISOLAMENTO: Filtra apenas os agendamentos pertencentes ao barbeiro logado
    const meusAtendimentos = bookings.filter(b => b.status === "confirmed" && b.barberId === currentUser.id);

    // Ordenação cronológica
    meusAtendimentos.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.time.localeCompare(b.time);
    });

    if (meusAtendimentos.length === 0) {
        list.innerHTML = `
            <div class="no-bookings-placeholder">
                <i class="fa-regular fa-calendar-minus" style="font-size:32px; display:block; margin-bottom:12px; color:var(--text-muted);"></i>
                Você não possui agendamentos marcados na sua agenda pessoal.
            </div>
        `;
        return;
    }

    meusAtendimentos.forEach(b => {
        const partesData = b.date.split('-');
        const dataFormatada = `${partesData[2]}/${partesData[1]}/${partesData[0]}`;

        list.innerHTML += `
            <div class="admin-booking-row">
                <div class="booking-row-time">${b.time}</div>
                <div class="booking-row-details">
                    <span class="booking-row-client"><i class="fa-regular fa-user" style="color:var(--accent-gold); margin-right:5px;"></i> ${b.clientName}</span>
                    <div class="booking-row-meta">
                        <span><strong>Serviço:</strong> ${b.serviceName}</span>
                        <span><strong>Data:</strong> ${dataFormatada}</span>
                    </div>
                </div>
                <div>
                    <span class="booking-status-tag confirmed">Minha Fila</span>
                </div>
            </div>
        `;
    });
}

function atualizarFinanceiroBarbeiro() {
    const bookings = JSON.parse(localStorage.getItem("bookings")) || [];
    const sales = JSON.parse(localStorage.getItem("sales")) || [];
    const barbers = JSON.parse(localStorage.getItem("barbers"));

    const meuCadastro = barbers.find(b => b.id === currentUser.id);
    const minhaTaxa = meuCadastro ? meuCadastro.commission : 50;

    // ISOLAMENTO: Apenas faturamentos relacionados a este barbeiro
    const servConfirmados = bookings.filter(b => b.status === "confirmed" && b.barberId === currentUser.id).reduce((sum, b) => sum + b.price, 0);
    const servHistoricos = sales.filter(s => s.type === "service" && s.barberId === currentUser.id).reduce((sum, s) => sum + s.price, 0);
    const totalServicos = servConfirmados + servHistoricos;

    const totalProdutos = sales.filter(s => s.type === "product" && s.barberId === currentUser.id).reduce((sum, s) => sum + s.price, 0);
    
    // Faturamento bruto individual
    const faturamentoBruto = totalServicos + totalProdutos;

    // Ganhos líquidos baseados no percentual definido pelo gerente!
    const meusGanhosComissao = faturamentoBruto * (minhaTaxa / 100);

    const totalTrabalhos = bookings.filter(b => b.status === "confirmed" && b.barberId === currentUser.id).length + 
                           sales.filter(s => s.type === "service" && s.barberId === currentUser.id).length;

    // Atualizar HTML
    document.getElementById("barbeiroFatBruto").textContent = `R$ ${faturamentoBruto.toFixed(2).replace('.', ',')}`;
    document.getElementById("barbeiroGanhoComissao").textContent = `R$ ${meusGanhosComissao.toFixed(2).replace('.', ',')}`;
    document.getElementById("barbeiroPctComissao").textContent = `${minhaTaxa}%`;
    document.getElementById("barbeiroTotalTrabalhos").textContent = totalTrabalhos;
}

function renderizarAlertasBarbeiro() {
    const list = document.getElementById("barbeiroAlertasList");
    const badge = document.getElementById("badgeBarbeiroAlertas");
    list.innerHTML = "";

    const notifications = JSON.parse(localStorage.getItem("notifications")) || [];
    
    // ISOLAMENTO: Filtrar apenas notificações direcionadas ao barbeiro logado
    const meusAlertas = notifications.filter(n => n.text.includes(currentUser.name));

    const unreadCount = meusAlertas.filter(n => n.unread).length;
    if (badge) {
        if (unreadCount > 0) {
            badge.textContent = unreadCount;
            badge.style.display = "inline-block";
        } else {
            badge.style.display = "none";
        }
    }

    if (meusAlertas.length === 0) {
        list.innerHTML = `<div class="no-bookings-placeholder">Nenhuma notificação pessoal recebida.</div>`;
        return;
    }

    meusAlertas.forEach(n => {
        list.innerHTML += `
            <div class="notification-item">
                <div class="notification-item-icon"><i class="fa-solid fa-bell"></i></div>
                <div class="notification-item-text">
                    <div class="notification-item-body">${n.text}</div>
                    <div class="notification-item-time">${n.time}</div>
                </div>
            </div>
        `;
    });
}

// ==========================================================================
// CADASTRO DE CLIENTES - SEGURANÇA E MÁSCARA DE PRIVACIDADE (GERENTE E BARBEIRO)
// ==========================================================================

function renderizarClientes() {
    const customers = JSON.parse(localStorage.getItem("customers")) || [];
    
    // 1. Tabela do Barbeiro (Com privacidade de contatos e sem exclusão)
    const barbeiroTableBody = document.getElementById("barbeiroClientesTableBody");
    if (barbeiroTableBody) {
        barbeiroTableBody.innerHTML = "";
        customers.forEach(c => {
            // MASCARAR DADOS PARA PRIVACIDADE
            const telefoneMascarado = c.phone.substring(0, 5) + "****-****";
            const partesEmail = c.email.split('@');
            const emailMascarado = partesEmail[0].substring(0, 2) + "*****@" + partesEmail[1];

            barbeiroTableBody.innerHTML += `
                <tr>
                    <td class="customer-name-col">${c.name}</td>
                    <td><span class="masked-data">${telefoneMascarado}</span></td>
                    <td><span class="masked-data">${emailMascarado}</span></td>
                </tr>
            `;
        });
    }

    // 2. Tabela do Gerente (Com dados completos e botão de exclusão)
    const gerenteTableBody = document.getElementById("gerenteClientesTableBody");
    if (gerenteTableBody) {
        gerenteTableBody.innerHTML = "";
        customers.forEach(c => {
            gerenteTableBody.innerHTML += `
                <tr>
                    <td class="customer-name-col">${c.name}</td>
                    <td>${c.phone}</td>
                    <td>${c.email}</td>
                    <td style="text-align: right;">
                        <button class="icon-btn delete" onclick="excluirCliente('${c.id}')" title="Excluir Cliente"><i class="fa-solid fa-trash-can"></i></button>
                    </td>
                </tr>
            `;
        });
    }
}

// Abre formulário de cadastro de Clientes
function abrirModalClienteForm() {
    const modal = document.getElementById("modalClienteOverlay");
    document.getElementById("clienteCadastroForm").reset();
    modal.classList.add("active");
}

function fecharModalClienteForm() {
    const modal = document.getElementById("modalClienteOverlay");
    modal.classList.remove("active");
}

function salvarClienteForm(event) {
    event.preventDefault();

    const nome = document.getElementById("formClienteNome").value;
    const telefone = document.getElementById("formClienteTelefone").value;
    const email = document.getElementById("formClienteEmail").value;

    const customers = JSON.parse(localStorage.getItem("customers")) || [];

    // Validar se email já cadastrado
    if (customers.some(c => c.email.toLowerCase() === email.toLowerCase())) {
        exibirToast("Erro no Cadastro", "Este e-mail já está em uso.", "info");
        return;
    }

    const novoId = "c_" + Date.now();
    const novoCliente = { id: novoId, name: nome, phone: telefone, email: email };

    customers.push(novoCliente);
    localStorage.setItem("customers", JSON.stringify(customers));

    exibirToast("Cliente Cadastrado! 👥", `Conta para '${nome}' criada com sucesso!`, "success");
    criarAlertaSistema(`Cadastro de Clientes: Novo cliente cadastrado: '${nome}' pelo perfil de ${currentUser.name}.`);

    fecharModalClienteForm();
    renderizarClientes();
    popularListasLogin();

    // Se o cliente acabou de se cadastrar no Login, efetua o login automático dele!
    if (!currentUser) {
        currentUser = { role: "cliente", id: novoId, name: nome };
        sessionStorage.setItem("currentSession", JSON.stringify(currentUser));
        logarNaAplicacao(currentUser);
    }
}

// Abre o cadastro dinâmico a partir do botão do Login
function abrirCadastroRapidoCliente() {
    abrirModalClienteForm();
}

function abrirModalEditarCliente(id) {
    const customers = JSON.parse(localStorage.getItem("customers")) || [];
    const c = customers.find(x => x.id === id);
    if (!c) return;
    document.getElementById("editClienteId").value = c.id;
    document.getElementById("editClienteNome").value = c.name;
    document.getElementById("editClienteTelefone").value = c.phone;
    document.getElementById("modalEditarClienteOverlay").classList.add("active");
}

function fecharModalEditarCliente() {
    document.getElementById("modalEditarClienteOverlay").classList.remove("active");
}

function salvarEdicaoCliente(event) {
    event.preventDefault();
    const id = document.getElementById("editClienteId").value;
    const nome = document.getElementById("editClienteNome").value.trim();
    const telefone = document.getElementById("editClienteTelefone").value.trim();

    const customers = JSON.parse(localStorage.getItem("customers")) || [];
    const idx = customers.findIndex(x => x.id === id);
    if (idx !== -1) {
        customers[idx].name = nome;
        customers[idx].phone = telefone;
        localStorage.setItem("customers", JSON.stringify(customers));
        exibirToast("Sucesso", "Dados do cliente atualizados.", "success");
        fecharModalEditarCliente();
        
        // Se a função renderizarClientes existir, chame ela
        if (typeof renderizarClientes === 'function') {
            renderizarClientes();
        }
    }
}

function excluirCliente(customerId) {
    // SEGURANÇA E PREVENÇÃO: Apenas gerente tem direito a exclusão!
    if (currentUser.role !== "gerente") {
        exibirToast("Acesso Negado ⚠️", "Somente o administrador do sistema pode excluir cadastros.", "info");
        return;
    }

    if (!confirm("Tem certeza que deseja EXCLUIR este cliente do banco de dados? Todos os seus dados de contato serão apagados de forma permanente.")) return;

    const customers = JSON.parse(localStorage.getItem("customers")) || [];
    const filtrados = customers.filter(c => c.id !== customerId);
    
    localStorage.setItem("customers", JSON.stringify(filtrados));

    exibirToast("Cliente Removido", "O cadastro do cliente foi apagado com sucesso.", "success");
    criarAlertaSistema(`Cadastro de Clientes: Gerente removeu um cliente da base geral.`);

    renderizarClientes();
    popularListasLogin();
}

// ==========================================================================
// PORTAL DO GERENTE - DASHBOARD E AJUSTE DE COMISSÕES REAL-TIME
// ==========================================================================

function ajustarComissaoBarbeiro(barberId, novaComissaoVal) {
    const novaComissao = parseInt(novaComissaoVal);
    if (isNaN(novaComissao) || novaComissao < 0 || novaComissao > 100) {
        exibirToast("Erro de entrada", "A comissão precisa ser um número entre 0 e 100%.", "info");
        return;
    }

    const barbers = JSON.parse(localStorage.getItem("barbers")) || [];
    const idx = barbers.findIndex(b => b.id === barberId);
    
    if (idx !== -1) {
        barbers[idx].commission = novaComissao;
        localStorage.setItem("barbers", JSON.stringify(barbers));

        exibirToast("Comissão Atualizada! 📊", `A taxa de comissão de ${barbers[idx].name} foi definida em ${novaComissao}%.`, "success");
        criarAlertaSistema(`Configurações: Gerente alterou a comissão de ${barbers[idx].name} para ${novaComissao}%.`);
        
        // Recalcular dashboard financeiro e lucros na hora!
        atualizarDashboard();
    }
}

function atualizarDashboard() {
    if (currentUser.role !== "gerente") return;

    const bookings = JSON.parse(localStorage.getItem("bookings")) || [];
    const sales = JSON.parse(localStorage.getItem("sales")) || [];
    const barbers = JSON.parse(localStorage.getItem("barbers"));

    const agendamentosConfirmados = bookings.filter(b => b.status === "confirmed");

    // CALCULO DO FINANCEIRO CONSOLIDADO
    const totalServicosConfirmados = agendamentosConfirmados.reduce((sum, b) => sum + b.price, 0);
    const totalServicosHistoricos = sales.filter(s => s.type === "service").reduce((sum, s) => sum + s.price, 0);
    const faturamentoServicos = totalServicosConfirmados + totalServicosHistoricos;

    const faturamentoProdutos = sales.filter(s => s.type === "product").reduce((sum, s) => sum + s.price, 0);
    const faturamentoTotal = faturamentoServicos + faturamentoProdutos;

    const totalTrabalhos = agendamentosConfirmados.length + sales.filter(s => s.type === "service").length;

    // Calcular Comissões e Lucro Líquido
    let comissoesPagasTotal = 0;

    const perfListContainer = document.getElementById("dashboardBarbeirosPerformanceList");
    perfListContainer.innerHTML = "";

    // Mapear faturamento de cada barbeiro para exibir na gerência
    let desempenhos = barbers.map(barb => {
        const servConfirmados = agendamentosConfirmados.filter(b => b.barberId === barb.id).reduce((sum, b) => sum + b.price, 0);
        const servHistoricos = sales.filter(s => s.barberId === barb.id && s.type === "service").reduce((sum, s) => sum + s.price, 0);
        
        const totalServicos = servConfirmados + servHistoricos;
        const totalProdutos = sales.filter(s => s.barberId === barb.id && s.type === "product").reduce((sum, s) => sum + s.price, 0);

        const totalGeral = totalServicos + totalProdutos;

        // Comissão líquida paga a este barbeiro (taxa dinâmica definida no LocalStorage!)
        const comissaoPaga = totalGeral * (barb.commission / 100);
        comissoesPagasTotal += comissaoPaga;

        // Lucro líquido retido pela barbearia referente aos trabalhos dele
        const lucroRetido = totalGeral - comissaoPaga;

        const totalTrabalhosBarbeiro = agendamentosConfirmados.filter(b => b.barberId === barb.id).length + 
                                       sales.filter(s => s.barberId === barb.id && s.type === "service").length;

        const mediaTrabalhosDia = (totalTrabalhosBarbeiro / 7).toFixed(1);
        const mediaVendasTrabalho = totalTrabalhosBarbeiro > 0 ? (totalGeral / totalTrabalhosBarbeiro) : 0;

        return {
            id: barb.id,
            name: barb.name,
            avatar: barb.avatar,
            specialty: barb.specialty,
            commission: barb.commission,
            totalGeral: totalGeral,
            comissaoPaga: comissaoPaga,
            lucroRetido: lucroRetido,
            totalTrabalhos: totalTrabalhosBarbeiro,
            mediaTrabalhosDia: mediaTrabalhosDia,
            mediaVendasTrabalho: mediaVendasTrabalho
        };
    });

    // Calcular Lucro Líquido final da Barbearia
    const lucroLiquidoBarbearia = faturamentoTotal - comissoesPagasTotal;

    // Atualizar as quatro métricas no HTML do Gerente
    document.getElementById("dashboardFaturamentoTotal").textContent = `R$ ${faturamentoTotal.toFixed(2).replace('.', ',')}`;
    document.getElementById("dashboardLucroLiquido").textContent = `R$ ${lucroLiquidoBarbearia.toFixed(2).replace('.', ',')}`;
    document.getElementById("dashboardTotalTrabalhos").textContent = totalTrabalhos;
    document.getElementById("dashboardComissoesPagas").textContent = `R$ ${comissoesPagasTotal.toFixed(2).replace('.', ',')}`;

    // Achar maior faturamento para barra de progresso
    const maxFaturamento = Math.max(...desempenhos.map(d => d.totalGeral), 1);

    // Renderizar a lista de desempenho de barbeiros com inputs de comissão (%)
    desempenhos.forEach(d => {
        const pctProgresso = (d.totalGeral / maxFaturamento) * 100;

        perfListContainer.innerHTML += `
            <div class="barber-perf-card">
                <div class="barber-perf-header">
                    <img src="${d.avatar}" alt="${d.name}" class="barber-perf-avatar">
                    <div>
                        <h4 class="barber-perf-name">${d.name}</h4>
                        <span class="barber-perf-info">${d.specialty}</span>
                    </div>
                </div>
                
                <div class="barber-perf-metrics">
                    <div class="perf-metric">
                        <span class="perf-metric-lbl">Total Faturado</span>
                        <strong class="perf-metric-val" style="color:var(--text-primary);">R$ ${d.totalGeral.toFixed(2).replace('.', ',')}</strong>
                    </div>
                    <div class="perf-metric">
                        <span class="perf-metric-lbl">Atendimentos</span>
                        <strong class="perf-metric-val">${d.totalTrabalhos} cortes</strong>
                    </div>
                    <div class="perf-metric" style="margin-top: 5px;">
                        <span class="perf-metric-lbl">Repasse Barbeiro</span>
                        <strong class="perf-metric-val" style="font-size:14px; color: var(--accent-danger);">R$ ${d.comissaoPaga.toFixed(2).replace('.', ',')}</strong>
                    </div>
                    <div class="perf-metric" style="margin-top: 5px;">
                        <span class="perf-metric-lbl">Lucro Barbearia</span>
                        <strong class="perf-metric-val" style="font-size:14px; color: var(--accent-emerald);">R$ ${d.lucroRetido.toFixed(2).replace('.', ',')}</strong>
                    </div>
                </div>

                <!-- Configuração de Comissão Real-Time -->
                <div class="commission-setter">
                    <span class="commission-setter-lbl">Taxa de Comissão:</span>
                    <div class="commission-input-group">
                        <input type="number" 
                               min="0" 
                               max="100" 
                               class="commission-input-field" 
                               value="${d.commission}" 
                               onchange="ajustarComissaoBarbeiro(${d.id}, this.value)">
                        <span class="commission-percent-sign">%</span>
                    </div>
                </div>

                <div class="perf-progress-bar" title="${pctProgresso.toFixed(0)}% da meta de líder">
                    <div class="perf-progress-fill" style="width: ${pctProgresso}%"></div>
                </div>
            </div>
        `;
    });

    if (typeof renderizarPendenciasPosVenda === "function") {
        renderizarPendenciasPosVenda();
    }
}

// ==========================================================================
// TAREFAS DE PÓS-VENDA (WHATSAPP CRM)
// ==========================================================================

function renderizarPendenciasPosVenda() {
    const list = document.getElementById("listaPendenciasPosVenda");
    if (!list) return;

    const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');
    const customers = JSON.parse(localStorage.getItem('customers') || '[]');
    
    // Pegar comandas concluídas que não tiveram feedback enviado
    const pendencias = bookings.filter(b => b.status === "concluido" && b.finalizadoEm && !b.feedbackSent);
    
    const agora = new Date().getTime();
    
    let html = "";
    let count = 0;

    pendencias.forEach(b => {
        const finalizadoEm = new Date(b.finalizadoEm).getTime();
        const horasPassadas = (agora - finalizadoEm) / (1000 * 60 * 60);

        // Se passou mais de 1 hora
        if (horasPassadas >= 1) {
            count++;
            
            // Buscar telefone do cliente
            const cliente = customers.find(c => c.id === b.clientId);
            const telefone = cliente ? cliente.phone : "";
            
            // Qual serviço foi feito
            const servicosRealizados = (b.servicos || []).map(s => s.nome).join(", ") || b.serviceName || "Serviço na barbearia";

            html += `
                <div style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-secondary); padding: 12px 15px; border-radius: 8px; border-left: 3px solid #25D366; flex-wrap: wrap; gap: 10px;">
                    <div>
                        <strong style="display: block; font-size: 14px; margin-bottom: 3px;">${b.clientName || b.clienteNome || "Avulso"}</strong>
                        <span style="font-size: 12px; color: var(--text-secondary);">
                            <i class="fa-regular fa-clock"></i> Há ${Math.floor(horasPassadas)}h | ${servicosRealizados}
                        </span>
                    </div>
                    <button class="primary-btn" style="background: #25D366; color: #fff; border: none; padding: 6px 12px; font-size: 12px;" onclick="enviarMensagemPosVenda('${b.id}', '${telefone}', '${(b.clientName || b.clienteNome || "Avulso").replace(/'/g, "\\'")}', '${servicosRealizados.replace(/'/g, "\\'")}')">
                        <i class="fa-brands fa-whatsapp"></i> Enviar Feedback
                    </button>
                </div>
            `;
        }
    });

    if (count === 0) {
        html = `
            <div style="text-align: center; padding: 20px 0; color: var(--text-muted); font-size: 13px;">
                <i class="fa-solid fa-check-double" style="font-size: 24px; display: block; margin-bottom: 10px; color: var(--glass-border);"></i>
                Nenhuma tarefa de pós-venda pendente no momento.
            </div>
        `;
    }

    list.innerHTML = html;
}

function enviarMensagemPosVenda(bookingId, telefone, nomeCliente, servico) {
    if (!telefone || telefone.trim() === "") {
        exibirToast("Atenção", "Este cliente não possui telefone cadastrado. O feedback foi marcado como concluído.", "info");
        // Marca como enviado pra não travar a fila
        marcarFeedbackEnviado(bookingId);
        return;
    }

    // Formatar telefone (remover não-números e adicionar 55)
    let numero = telefone.replace(/\D/g, "");
    if (!numero.startsWith("55")) {
        numero = "55" + numero;
    }

    const nomeBarbearia = document.querySelector(".logo-text") ? document.querySelector(".logo-text").textContent : "The Golden Blade";

    // Mensagem Padrão
    const mensagem = `Olá ${nomeCliente}, aqui é da ${nomeBarbearia}! Tudo bem?\n\nVocê realizou um serviço de *${servico}* com a gente hoje.\n\nGostaríamos de saber o que achou do atendimento e do resultado! Seu feedback é muito importante para nós.`;
    
    const url = `https://api.whatsapp.com/send?phone=${numero}&text=${encodeURIComponent(mensagem)}`;

    // Abrir no WhatsApp
    window.open(url, "_blank");

    // Marcar como feedback enviado no banco local
    marcarFeedbackEnviado(bookingId);
}

function marcarFeedbackEnviado(bookingId) {
    const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');
    const idx = bookings.findIndex(b => b.id === bookingId);
    if (idx !== -1) {
        bookings[idx].feedbackSent = true;
        localStorage.setItem('bookings', JSON.stringify(bookings));
        renderizarPendenciasPosVenda();
        exibirToast("Sucesso! 🚀", "Ação de pós-venda registrada.", "success");
    }
}

// ==========================================================================
// OUTROS RENDERIZADORES GERAIS (SPA GERENTE)
// ==========================================================================

function trocarAbaGerente(idAbaTarget, elementoBtn) {
    const abas = document.querySelectorAll("#portalGerente .tab-content");
    abas.forEach(aba => aba.classList.remove("active"));

    const abaTarget = document.getElementById(idAbaTarget);
    abaTarget.classList.add("active");

    const botoes = document.querySelectorAll("#portalGerente .nav-item");
    botoes.forEach(btn => btn.classList.remove("active"));
    elementoBtn.classList.add("active");

    if (idAbaTarget === "abaGerenteDashboard") {
        atualizarDashboard();
    } else if (idAbaTarget === "abaGerenteGestao") {
        renderizarCRUD();
    } else if (idAbaTarget === "abaGerenteClientes") {
        renderizarClientes();
    } else if (idAbaTarget === "abaGerenteAgenda") {
        atualizarAgendaConsolidada();
        popularFiltroBarbeirosAgenda();
    } else if (idAbaTarget === "abaGerenteAlertas") {
        renderizarAlertas();
    }
}

function popularFiltroBarbeirosAgenda() {
    const select = document.getElementById("agendaFiltroBarbeiro");
    if (!select) return;

    const valorSelecionado = select.value;
    select.innerHTML = '<option value="todos">Todos os Profissionais</option>';

    const barbers = JSON.parse(localStorage.getItem("barbers")) || [];
    barbers.forEach(barb => {
        select.innerHTML += `<option value="${barb.id}">${barb.name}</option>`;
    });

    select.value = valorSelecionado;
}

function atualizarAgendaConsolidada() {
    const listContainer = document.getElementById("adminAgendaList");
    if (!listContainer) return;
    listContainer.innerHTML = "";

    const bookings = JSON.parse(localStorage.getItem("bookings")) || [];
    const filterSelect = document.getElementById("agendaFiltroBarbeiro");
    const filtroBarbeiro = filterSelect ? filterSelect.value : "todos";

    let filtrados = bookings.filter(b => b.status === "confirmed");

    if (filtroBarbeiro !== "todos") {
        filtrados = filtrados.filter(b => b.barberId == filtroBarbeiro);
    }

    filtrados.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.time.localeCompare(b.time);
    });

    if (filtrados.length === 0) {
        listContainer.innerHTML = `
            <div class="no-bookings-placeholder">
                <i class="fa-regular fa-calendar-minus" style="font-size: 32px; color: var(--text-muted); margin-bottom:12px; display:block;"></i>
                Nenhum agendamento futuro agendado para o profissional selecionado.
            </div>
        `;
        return;
    }

    filtrados.forEach(b => {
        const partesData = b.date.split('-');
        const dataFormatada = `${partesData[2]}/${partesData[1]}/${partesData[0]}`;

        listContainer.innerHTML += `
            <div class="admin-booking-row">
                <div class="booking-row-time">${b.time}</div>
                <div class="booking-row-details">
                    <span class="booking-row-client"><i class="fa-regular fa-user" style="font-size: 13px; color: var(--accent-gold); margin-right:6px;"></i> ${b.clientName}</span>
                    <div class="booking-row-meta">
                        <span><strong>Serviço:</strong> ${b.serviceName}</span>
                        <span><strong>Profissional:</strong> ${b.barberName}</span>
                        <span><strong>Data:</strong> ${dataFormatada}</span>
                    </div>
                </div>
                <div>
                    <span class="booking-status-tag confirmed">Confirmado</span>
                </div>
            </div>
        `;
    });
}

function renderizarCRUD() {
    const services = JSON.parse(localStorage.getItem("services")) || [];
    const products = JSON.parse(localStorage.getItem("products")) || [];

    // Serviços CRUD
    const servicesList = document.getElementById("crudServicosList");
    if (servicesList) {
        servicesList.innerHTML = "";
        services.forEach(serv => {
            servicesList.innerHTML += `
                <div class="crud-item">
                    <div>
                        <div class="crud-item-title">${serv.name}</div>
                        <div class="crud-item-price">R$ ${serv.price.toFixed(2).replace('.', ',')} <span style="color:var(--text-muted); font-size:11px; margin-left: 10px;"><i class="fa-regular fa-clock"></i> ${serv.duration} min</span></div>
                    </div>
                    <div class="crud-item-actions">
                        <button class="icon-btn edit" onclick="editarItem('servico', '${serv.id}')" title="Editar"><i class="fa-solid fa-pen-to-square"></i></button>
                        <button class="icon-btn delete" onclick="deletarItem('servico', '${serv.id}')" title="Excluir"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
            `;
        });
    }

    // Produtos CRUD
    const productsList = document.getElementById("crudProdutosList");
    if (productsList) {
        productsList.innerHTML = "";
        products.forEach(prod => {
            productsList.innerHTML += `
                <div class="crud-item">
                    <div>
                        <div class="crud-item-title">${prod.name}</div>
                        <div class="crud-item-price">R$ ${prod.price.toFixed(2).replace('.', ',')}</div>
                    </div>
                    <div class="crud-item-actions">
                        <button class="icon-btn edit" onclick="editarItem('produto', '${prod.id}')" title="Editar"><i class="fa-solid fa-pen-to-square"></i></button>
                        <button class="icon-btn delete" onclick="deletarItem('produto', '${prod.id}')" title="Excluir"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
            `;
        });
    }
}

// FORMULÁRIO CRUD DE ITENS

function abrirModalForm(tipo, id = null) {
    const modalOverlay = document.getElementById("modalFormOverlay");
    const titulo = document.getElementById("modalFormTitulo");
    const inputId = document.getElementById("formItemId");
    const inputTipo = document.getElementById("formItemTipo");
    const groupDuracao = document.getElementById("formGroupDuracao");
    
    document.getElementById("itemCadastroForm").reset();

    inputTipo.value = tipo;
    inputId.value = id ? id : "";

    if (tipo === "servico") {
        titulo.textContent = id ? "Editar Serviço" : "Novo Serviço";
        groupDuracao.style.display = "block";
        document.getElementById("formItemDuracao").setAttribute("required", "required");

        if (id) {
            const services = JSON.parse(localStorage.getItem("services"));
            const item = services.find(s => s.id === id);
            if (item) {
                document.getElementById("formItemNome").value = item.name;
                document.getElementById("formItemPreco").value = item.price;
                document.getElementById("formItemDuracao").value = item.duration;
                document.getElementById("formItemDescricao").value = item.description;
            }
        }
    } else {
        titulo.textContent = id ? "Editar Produto" : "Novo Produto";
        groupDuracao.style.display = "none";
        document.getElementById("formItemDuracao").removeAttribute("required");

        if (id) {
            const products = JSON.parse(localStorage.getItem("products"));
            const item = products.find(p => p.id === id);
            if (item) {
                document.getElementById("formItemNome").value = item.name;
                document.getElementById("formItemPreco").value = item.price;
                document.getElementById("formItemDescricao").value = item.description;
            }
        }
    }

    modalOverlay.classList.add("active");
}

function fecharModalForm() {
    const modalOverlay = document.getElementById("modalFormOverlay");
    modalOverlay.classList.remove("active");
}

function salvarItemForm(event) {
    event.preventDefault();

    const id = document.getElementById("formItemId").value;
    const tipo = document.getElementById("formItemTipo").value;
    const nome = document.getElementById("formItemNome").value;
    const preco = parseFloat(document.getElementById("formItemPreco").value);
    const descricao = document.getElementById("formItemDescricao").value;

    if (tipo === "servico") {
        const duracao = parseInt(document.getElementById("formItemDuracao").value);
        const services = JSON.parse(localStorage.getItem("services")) || [];

        if (id) {
            const idx = services.findIndex(s => s.id === id);
            if (idx !== -1) {
                services[idx] = { id, name: nome, price: preco, duration: duracao, description: descricao };
                exibirToast("Serviço Atualizado 💈", `'${nome}' foi editado com sucesso!`, "success");
                criarAlertaSistema(`Gerenciamento: Serviço '${nome}' foi atualizado no catálogo.`);
            }
        } else {
            const novoId = "s_" + Date.now();
            services.push({ id: novoId, name: nome, price: preco, duration: duracao, description: descricao });
            exibirToast("Serviço Criado! 💈", `Novo serviço '${nome}' adicionado!`, "success");
            criarAlertaSistema(`Gerenciamento: Novo serviço cadastrado: '${nome}' por R$ ${preco.toFixed(2)}.`);
        }
        localStorage.setItem("services", JSON.stringify(services));
    } else {
        const products = JSON.parse(localStorage.getItem("products")) || [];

        if (id) {
            const idx = products.findIndex(p => p.id === id);
            if (idx !== -1) {
                products[idx] = { id, name: nome, price: preco, description: descricao };
                exibirToast("Produto Atualizado 🧴", `'${nome}' foi editado com sucesso!`, "success");
                criarAlertaSistema(`Gerenciamento: Produto '${nome}' foi atualizado no catálogo.`);
            }
        } else {
            const novoId = "p_" + Date.now();
            products.push({ id: novoId, name: nome, price: preco, description: descricao });
            exibirToast("Produto Criado! 🧴", `Novo produto '${nome}' adicionado!`, "success");
            criarAlertaSistema(`Gerenciamento: Novo produto cadastrado: '${nome}' por R$ ${preco.toFixed(2)}.`);
        }
        localStorage.setItem("products", JSON.stringify(products));
    }

    fecharModalForm();
    renderizarCRUD();
    renderizarCatalogos();
}

function editarItem(tipo, id) {
    abrirModalForm(tipo, id);
}

function deletarItem(tipo, id) {
    if (!confirm(`Tem certeza que deseja excluir este ${tipo === "servico" ? "serviço" : "produto"}?`)) return;

    if (tipo === "servico") {
        const services = JSON.parse(localStorage.getItem("services")) || [];
        const filtrados = services.filter(s => s.id !== id);
        localStorage.setItem("services", JSON.stringify(filtrados));
        exibirToast("Serviço Removido", "O item foi removido com sucesso.", "info");
        criarAlertaSistema(`Gerenciamento: Serviço excluído da plataforma.`);
    } else {
        const products = JSON.parse(localStorage.getItem("products")) || [];
        const filtrados = products.filter(p => p.id !== id);
        localStorage.setItem("products", JSON.stringify(filtrados));
        exibirToast("Produto Removido", "O produto foi excluído com sucesso.", "info");
        criarAlertaSistema(`Gerenciamento: Produto excluído da plataforma.`);
    }

    renderizarCRUD();
    renderizarCatalogos();
}

// ==========================================================================
// SISTEMA DE ALERTAS (TOASTS E LOGS DO GERENTE)
// ==========================================================================

function exibirToast(titulo, descricao, tipo = "info") {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast ${tipo}`;

    const icone = tipo === "success" 
        ? '<i class="fa-solid fa-circle-check toast-icon"></i>' 
        : '<i class="fa-solid fa-circle-info toast-icon"></i>';

    toast.innerHTML = `
        ${icone}
        <div class="toast-content">
            <div class="toast-title">${titulo}</div>
            <div class="toast-desc">${descricao}</div>
        </div>
        <button class="toast-close" onclick="this.parentElement.remove()"><i class="fa-solid fa-xmark"></i></button>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        if (toast.parentElement) {
            toast.style.animation = "slideInRight var(--transition-smooth) reverse";
            setTimeout(() => toast.remove(), 350);
        }
    }, 6000);
}

function criarAlertaSistema(mensagem) {
    const notifications = JSON.parse(localStorage.getItem("notifications")) || [];
    const agora = new Date();
    const horaStr = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    notifications.unshift({
        id: "n_" + Date.now(),
        text: mensagem,
        time: `Hoje às ${horaStr}`,
        unread: true
    });

    localStorage.setItem("notifications", JSON.stringify(notifications));

    // Recarregar os contadores de todos os perfis ativos
    renderizarAlertas();
    if (currentUser && currentUser.role === "barbeiro") {
        renderizarAlertasBarbeiro();
    }
}

function renderizarAlertas() {
    const listContainer = document.getElementById("gerenteAlertasList");
    const badge = document.getElementById("badgeGerenteAlertas");
    if (!listContainer) return;

    const notifications = JSON.parse(localStorage.getItem("notifications")) || [];
    listContainer.innerHTML = "";

    const unreadCount = notifications.filter(n => n.unread).length;
    if (badge) {
        if (unreadCount > 0) {
            badge.textContent = unreadCount;
            badge.style.display = "inline-block";
        } else {
            badge.style.display = "none";
        }
    }

    if (notifications.length === 0) {
        listContainer.innerHTML = `<div class="no-bookings-placeholder">Nenhum log de notificação no banco de dados.</div>`;
        return;
    }

    notifications.forEach(n => {
        const unreadClass = n.unread ? "unread" : "";
        listContainer.innerHTML += `
            <div class="notification-item ${unreadClass}">
                <div class="notification-item-icon"><i class="fa-solid fa-bell"></i></div>
                <div class="notification-item-text">
                    <div class="notification-item-body">${n.text}</div>
                    <div class="notification-item-time">${n.time}</div>
                </div>
            </div>
        `;
    });
}

function marcarTodasNotificacoesLidas() {
    const notifications = JSON.parse(localStorage.getItem("notifications")) || [];
    notifications.forEach(n => n.unread = false);
    localStorage.setItem("notifications", JSON.stringify(notifications));
    
    renderizarAlertas();
    exibirToast("Notificações Lidas", "Todos os logs foram marcados como lidos.", "success");
}

// ==========================================================================
// PORTAL DO GERENTE - ABA PROFISSIONAIS (CRUD COMPLETO DE BARBEIROS)
// ==========================================================================

function renderizarProfissionais() {
    const barbers = JSON.parse(localStorage.getItem("barbers")) || [];
    const list = document.getElementById("profissionaisList");
    if (!list) return;

    list.innerHTML = "";

    if (barbers.length === 0) {
        list.innerHTML = `<div class="no-bookings-placeholder"><i class="fa-solid fa-user-slash" style="font-size:28px; display:block; margin-bottom:10px; color:var(--text-muted);"></i>Nenhum profissional cadastrado. Clique em "Novo Profissional" para começar.</div>`;
        return;
    }

    barbers.forEach(barb => {
        const ativo = barb.active !== false; // padrão ativo se não definido
        const inativoClass = ativo ? "" : "inativo";
        const statusBadge = ativo
            ? `<span class="status-badge-text ativo" style="font-size:10px; padding:2px 7px;"><i class="fa-solid fa-circle-check"></i> Ativo</span>`
            : `<span class="status-badge-text inativo" style="font-size:10px; padding:2px 7px;"><i class="fa-solid fa-ban"></i> Inativo</span>`;

        const avatarHtml = barb.avatar
            ? `<img src="${barb.avatar}" alt="${barb.name}" class="profissional-crud-avatar">`
            : `<div class="profissional-crud-avatar placeholder"><i class="fa-solid fa-scissors"></i></div>`;

        list.innerHTML += `
            <div class="profissional-crud-item ${inativoClass}">
                ${avatarHtml}
                <div class="profissional-crud-info">
                    <div class="profissional-crud-nome">
                        ${barb.name}
                        ${statusBadge}
                    </div>
                    <div class="profissional-crud-espec">${barb.specialty}</div>
                    <span class="profissional-crud-comissao"><i class="fa-solid fa-percent" style="font-size:9px;"></i> ${barb.commission}% de comissão</span>
                </div>
                <div class="profissional-crud-actions">
                    <button class="secondary-btn" onclick="abrirConfigBarbeiro(${barb.id})" title="Configurar Profissional">
                        <i class="fa-solid fa-sliders"></i> Configurar
                    </button>
                    <button class="icon-btn delete" onclick="removerProfissional(${barb.id})" title="Remover Profissional">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    });
}

function removerProfissional(barberId) {
    const barbers = JSON.parse(localStorage.getItem("barbers")) || [];
    const barber = barbers.find(b => b.id === barberId);
    if (!barber) return;

    if (!confirm(`⚠️ Tem certeza que deseja REMOVER o profissional "${barber.name}" do sistema?\n\nEsta ação é permanente e ele não poderá mais fazer login.`)) return;

    const novosBarbers = barbers.filter(b => b.id !== barberId);
    localStorage.setItem("barbers", JSON.stringify(novosBarbers));

    exibirToast("Profissional Removido", `${barber.name} foi excluído do sistema.`, "info");
    criarAlertaSistema(`Profissionais: Gerente removeu o barbeiro "${barber.name}" da plataforma.`);

    renderizarProfissionais();
    popularListasLogin();
    atualizarDashboard();
}

// ==========================================================================
// MODAL DE CADASTRO DE NOVO PROFISSIONAL
// ==========================================================================

function abrirModalNovoProfissional() {
    document.getElementById("formNovoProfissional").reset();
    document.getElementById("modalNovoProfissional").classList.add("active");
}

function fecharModalNovoProfissional() {
    document.getElementById("modalNovoProfissional").classList.remove("active");
}

function salvarNovoProfissional(event) {
    event.preventDefault();

    const nome = document.getElementById("novoProfNome").value.trim();
    const espec = document.getElementById("novoProfEspec").value.trim();
    const login = document.getElementById("novoProfLogin").value.trim().toLowerCase();
    const senha = document.getElementById("novoProfSenha").value;
    const comissao = parseInt(document.getElementById("novoProfComissao").value);

    if (!nome || !espec || !login) {
        exibirToast("Dados Incompletos", "Preencha todos os campos antes de salvar.", "info");
        return;
    }

    const barbers = JSON.parse(localStorage.getItem("barbers")) || [];

    // Verificar se o login já está em uso
    if (barbers.some(b => b.login && b.login.toLowerCase() === login)) {
        exibirToast("Login já em uso", `O login "${login}" já existe. Escolha outro.`, "info");
        return;
    }

    // Gerar ID único numérico
    const maxId = barbers.reduce((max, b) => Math.max(max, Number(b.id) || 0), 0);
    const novoId = maxId + 1;

    const novoBarbeiro = {
        id: novoId,
        name: nome,
        login: login,
        password: senha || "1234",
        avatar: null,
        specialty: espec,
        rating: 5.0,
        commission: isNaN(comissao) ? 50 : comissao,
        active: true
    };

    barbers.push(novoBarbeiro);
    localStorage.setItem("barbers", JSON.stringify(barbers));

    exibirToast("Profissional Cadastrado! 💈", `${nome} foi adicionado à equipe. Login: ${login}.`, "success");
    criarAlertaSistema(`Profissionais: Gerente cadastrou novo barbeiro "${nome}" (login: ${login}) com ${novoBarbeiro.commission}% de comissão.`);

    fecharModalNovoProfissional();
    renderizarProfissionais();
    popularListasLogin();
    atualizarDashboard();
}

// ==========================================================================
// MODAL DE CONFIGURAÇÃO DO PROFISSIONAL (CLICÁVEL NO PAINEL E NA LISTA)
// ==========================================================================

function abrirConfigBarbeiro(barberId) {
    const barbers = JSON.parse(localStorage.getItem("barbers")) || [];
    const barber = barbers.find(b => b.id === barberId);
    if (!barber) return;

    const ativo = barber.active !== false;

    // Preencher campos do modal
    document.getElementById("configBarbeiroId").value = barber.id;
    document.getElementById("configBarbeiroNome").value = barber.name;
    document.getElementById("configBarbeiroEspec").value = barber.specialty;
    document.getElementById("configBarbeiroComissao").value = barber.commission;
    document.getElementById("configBarbeiroAtivo").checked = ativo;

    // Header do modal
    document.getElementById("modalBarbeiroNomeHeader").textContent = barber.name;
    document.getElementById("modalBarbeiroEspecHeader").textContent = barber.specialty;

    const avatarEl = document.getElementById("modalBarbeiroAvatar");
    if (barber.avatar) {
        avatarEl.src = barber.avatar;
        avatarEl.style.display = "block";
    } else {
        avatarEl.style.display = "none";
    }

    // Exibir preview de foto para o Gerente
    const imgPreview = document.getElementById("configBarbeiroFotoPreview");
    const iconPreview = document.getElementById("configBarbeiroFotoIcon");
    if (barber.avatar || barber.foto) {
        if (imgPreview) {
            imgPreview.src = barber.avatar || barber.foto;
            imgPreview.style.display = "block";
        }
        if (iconPreview) iconPreview.style.display = "none";
    } else {
        if (imgPreview) {
            imgPreview.src = "";
            imgPreview.style.display = "none";
        }
        if (iconPreview) iconPreview.style.display = "flex";
    }

    // Atualizar texto de status
    atualizarStatusVisual();

    // Calcular e exibir rendimentos deste barbeiro
    calcularRendimentosModal(barber.id, barber.commission);

    document.getElementById("modalBarbeiroConfig").classList.add("active");
}

function fecharModalBarbeiroConfig() {
    document.getElementById("modalBarbeiroConfig").classList.remove("active");
}

function atualizarStatusVisual() {
    const checkbox = document.getElementById("configBarbeiroAtivo");
    const textoEl = document.getElementById("configBarbeiroStatusTexto");
    if (checkbox.checked) {
        textoEl.textContent = "Ativo";
        textoEl.className = "status-badge-text ativo";
    } else {
        textoEl.textContent = "Inativo";
        textoEl.className = "status-badge-text inativo";
    }
}

function calcularRendimentosModal(barberId, commission) {
    const bookings = JSON.parse(localStorage.getItem("bookings")) || [];
    const sales = JSON.parse(localStorage.getItem("sales")) || [];

    const agendConfirmados = bookings.filter(b => b.status === "confirmed" && b.barberId === barberId);
    const servHistoricos = sales.filter(s => s.barberId === barberId && s.type === "service");
    const prodHistoricos = sales.filter(s => s.barberId === barberId && s.type === "product");

    const totalServicos = agendConfirmados.reduce((s, b) => s + b.price, 0)
                        + servHistoricos.reduce((s, i) => s + i.price, 0);
    const totalProdutos = prodHistoricos.reduce((s, i) => s + i.price, 0);
    const faturamentoBruto = totalServicos + totalProdutos;
    const comissaoPaga = faturamentoBruto * (commission / 100);
    const lucroRetido = faturamentoBruto - comissaoPaga;
    const totalTrabalhos = agendConfirmados.length + servHistoricos.length;

    const grid = document.getElementById("modalRendimentosGrid");
    if (!grid) return;

    grid.innerHTML = `
        <div class="rendimento-item">
            <span class="rendimento-item-lbl">Faturamento Bruto</span>
            <span class="rendimento-item-val" style="color:var(--text-primary);">R$ ${faturamentoBruto.toFixed(2).replace('.', ',')}</span>
        </div>
        <div class="rendimento-item">
            <span class="rendimento-item-lbl">Repasse (${commission}%)</span>
            <span class="rendimento-item-val" style="color:var(--accent-danger);">R$ ${comissaoPaga.toFixed(2).replace('.', ',')}</span>
        </div>
        <div class="rendimento-item">
            <span class="rendimento-item-lbl">Lucro Barbearia</span>
            <span class="rendimento-item-val" style="color:var(--accent-emerald);">R$ ${lucroRetido.toFixed(2).replace('.', ',')}</span>
        </div>
        <div class="rendimento-item" style="grid-column: 1 / -1;">
            <span class="rendimento-item-lbl">Atendimentos Realizados</span>
            <span class="rendimento-item-val" style="color:var(--accent-gold);">${totalTrabalhos} atendimentos</span>
        </div>
    `;
}

function salvarBarbeiroConfig(event) {
    event.preventDefault();

    const id = parseInt(document.getElementById("configBarbeiroId").value);
    const nome = document.getElementById("configBarbeiroNome").value.trim();
    const espec = document.getElementById("configBarbeiroEspec").value.trim();
    const comissao = parseInt(document.getElementById("configBarbeiroComissao").value);
    const ativo = document.getElementById("configBarbeiroAtivo").checked;

    if (!nome || !espec) {
        exibirToast("Dados Incompletos", "Preencha Nome e Especialidade.", "info");
        return;
    }

    if (isNaN(comissao) || comissao < 0 || comissao > 100) {
        exibirToast("Comissão Inválida", "A comissão precisa ser entre 0 e 100%.", "info");
        return;
    }

    const barbers = JSON.parse(localStorage.getItem("barbers")) || [];
    const idx = barbers.findIndex(b => b.id === id);
    if (idx === -1) return;

    const nomeAntigo = barbers[idx].name;
    barbers[idx].name = nome;
    barbers[idx].specialty = espec;
    barbers[idx].commission = comissao;
    barbers[idx].active = ativo;

    // Salvar Foto do colaborador caso tenha sido alterada pelo Gerente
    const imgPreview = document.getElementById("configBarbeiroFotoPreview");
    if (imgPreview && imgPreview.src && imgPreview.style.display === "block") {
        barbers[idx].avatar = imgPreview.src;
        barbers[idx].foto = imgPreview.src;
    } else if (imgPreview && imgPreview.style.display === "none") {
        // Foto removida
        barbers[idx].avatar = `assets/barber_${barbers[idx].id}.png`;
        barbers[idx].foto = `assets/barber_${barbers[idx].id}.png`;
    }

    localStorage.setItem("barbers", JSON.stringify(barbers));

    const statusStr = ativo ? "Ativo" : "Inativo";
    exibirToast("Profissional Atualizado! ✅", `${nome} foi salvo com ${comissao}% de comissão — Status: ${statusStr}.`, "success");
    criarAlertaSistema(`Configurações: Gerente editou o perfil de "${nomeAntigo}" → Nome: ${nome}, Comissão: ${comissao}%, Status: ${statusStr}.`);

    fecharModalBarbeiroConfig();

    // Atualizar todas as telas afetadas
    atualizarDashboard();
    renderizarProfissionais();
    popularListasLogin();

    // Re-renderizar agendamento para ocultar/mostrar barbeiro inativo
    if (currentUser && currentUser.role === "cliente") {
        renderizarPassosAgendamento();
    }
}

// ==========================================================================
// OVERRIDE: renderizarPassosAgendamento (filtrar barbeiros inativos)
// ==========================================================================

// Sobrescrever a função de agendamento para filtrar barbeiros com active === false
const _renderizarPassosAgendamentoOriginal = renderizarPassosAgendamento;
renderizarPassosAgendamento = function() {
    const barbers = JSON.parse(localStorage.getItem("barbers")) || [];
    const barbersFiltrados = barbers.filter(b => b.active !== false);

    const services = JSON.parse(localStorage.getItem("services")) || [];

    // Passo 1 - Barbeiros ativos somente
    const barberGrid = document.getElementById("bookingBarberGrid");
    if (!barberGrid) return;
    barberGrid.innerHTML = "";

    if (barbersFiltrados.length === 0) {
        barberGrid.innerHTML = `<div style="grid-column:1/-1; text-align:center; color:var(--text-muted); padding:20px 0; font-size:13px;"><i class="fa-solid fa-user-slash"></i> Nenhum profissional disponível no momento.</div>`;
    } else {
        barbersFiltrados.forEach(barb => {
            const isSelected = tempBooking.barberId === barb.id ? "selected" : "";
            barberGrid.innerHTML += `
                <div class="barber-card ${isSelected}" onclick="selecionarBarbeiroAgendamento(${barb.id})">
                    <div class="barber-avatar-container">
                        ${barb.avatar
                            ? `<img src="${barb.avatar}" alt="${barb.name}" class="barber-avatar">`
                            : `<div class="barber-avatar" style="display:flex;align-items:center;justify-content:center;background:var(--bg-tertiary);font-size:28px;color:var(--accent-gold);"><i class="fa-solid fa-scissors"></i></div>`
                        }
                    </div>
                    <div class="barber-name">${barb.name}</div>
                    <div class="barber-specialty">${barb.specialty}</div>
                    <div class="barber-rating"><i class="fa-solid fa-star"></i> ${barb.rating.toFixed(1)}</div>
                </div>
            `;
        });
    }

    // Passo 2 - Serviços (igual ao original)
    const servicesList = document.getElementById("bookingServicesList");
    if (servicesList) {
        servicesList.innerHTML = "";
        services.forEach(serv => {
            const isSelected = tempBooking.serviceId === serv.id ? "selected" : "";
            servicesList.innerHTML += `
                <div class="booking-service-item ${isSelected}" onclick="selecionarServicoAgendamento('${serv.id}')">
                    <div class="booking-service-info">
                        <div class="checkbox-circle"><i class="fa-solid fa-check"></i></div>
                        <div>
                            <strong style="display:block; font-size:15px; margin-bottom:2px;">${serv.name}</strong>
                            <span style="font-size:12px; color:var(--text-secondary);"><i class="fa-regular fa-clock"></i> ${serv.duration} min</span>
                        </div>
                    </div>
                    <span class="catalog-card-price" style="font-size:16px;">R$ ${serv.price.toFixed(2).replace('.', ',')}</span>
                </div>
            `;
        });
    }

    renderizarDatasAgendamento();
    atualizarResumoAgendamento();
};

// ==========================================================================
// OVERRIDE: atualizarDashboard (cards clicáveis do painel)
// ==========================================================================

const _atualizarDashboardOriginal = atualizarDashboard;
atualizarDashboard = function() {
    if (currentUser && currentUser.role !== "gerente") return;

    const bookings = JSON.parse(localStorage.getItem("bookings")) || [];
    const sales = JSON.parse(localStorage.getItem("sales")) || [];
    const barbers = JSON.parse(localStorage.getItem("barbers")) || [];

    const agendamentosConfirmados = bookings.filter(b => b.status === "confirmed");

    const totalServicosConfirmados = agendamentosConfirmados.reduce((sum, b) => sum + b.price, 0);
    const totalServicosHistoricos = sales.filter(s => s.type === "service").reduce((sum, s) => sum + s.price, 0);
    const faturamentoServicos = totalServicosConfirmados + totalServicosHistoricos;
    const faturamentoProdutos = sales.filter(s => s.type === "product").reduce((sum, s) => sum + s.price, 0);
    const faturamentoTotal = faturamentoServicos + faturamentoProdutos;
    const totalTrabalhos = agendamentosConfirmados.length + sales.filter(s => s.type === "service").length;

    let comissoesPagasTotal = 0;

    const perfListContainer = document.getElementById("dashboardBarbeirosPerformanceList");
    if (perfListContainer) perfListContainer.innerHTML = "";

    let desempenhos = barbers.map(barb => {
        const servConfirmados = agendamentosConfirmados.filter(b => b.barberId === barb.id).reduce((sum, b) => sum + b.price, 0);
        const servHistoricos = sales.filter(s => s.barberId === barb.id && s.type === "service").reduce((sum, s) => sum + s.price, 0);
        const totalServicos = servConfirmados + servHistoricos;
        const totalProdutos = sales.filter(s => s.barberId === barb.id && s.type === "product").reduce((sum, s) => sum + s.price, 0);
        const totalGeral = totalServicos + totalProdutos;
        const comissaoPaga = totalGeral * (barb.commission / 100);
        comissoesPagasTotal += comissaoPaga;
        const lucroRetido = totalGeral - comissaoPaga;
        const totalTrabalhosBarbeiro = agendamentosConfirmados.filter(b => b.barberId === barb.id).length +
                                       sales.filter(s => s.barberId === barb.id && s.type === "service").length;
        const mediaTrabalhosDia = (totalTrabalhosBarbeiro / 7).toFixed(1);
        const mediaVendasTrabalho = totalTrabalhosBarbeiro > 0 ? (totalGeral / totalTrabalhosBarbeiro) : 0;
        const ativo = barb.active !== false;

        return { id: barb.id, name: barb.name, avatar: barb.avatar, specialty: barb.specialty,
                 commission: barb.commission, totalGeral, comissaoPaga, lucroRetido,
                 totalTrabalhos: totalTrabalhosBarbeiro, mediaTrabalhosDia, mediaVendasTrabalho, ativo };
    });

    const lucroLiquidoBarbearia = faturamentoTotal - comissoesPagasTotal;

    const elFat = document.getElementById("dashboardFaturamentoTotal");
    const elLuc = document.getElementById("dashboardLucroLiquido");
    const elTrab = document.getElementById("dashboardTotalTrabalhos");
    const elCom = document.getElementById("dashboardComissoesPagas");
    if (elFat) elFat.textContent = `R$ ${faturamentoTotal.toFixed(2).replace('.', ',')}`;
    if (elLuc) elLuc.textContent = `R$ ${lucroLiquidoBarbearia.toFixed(2).replace('.', ',')}`;
    if (elTrab) elTrab.textContent = totalTrabalhos;
    if (elCom) elCom.textContent = `R$ ${comissoesPagasTotal.toFixed(2).replace('.', ',')}`;

    if (!perfListContainer) return;
    const maxFaturamento = Math.max(...desempenhos.map(d => d.totalGeral), 1);

    desempenhos.forEach(d => {
        const pctProgresso = (d.totalGeral / maxFaturamento) * 100;
        const inativoTag = !d.ativo
            ? `<span class="barber-perf-inativo-badge"><i class="fa-solid fa-ban"></i> Inativo</span>`
            : '';
        const avatarHtml = d.avatar
            ? `<img src="${d.avatar}" alt="${d.name}" class="barber-perf-avatar">`
            : `<div class="barber-perf-avatar" style="display:flex;align-items:center;justify-content:center;background:var(--bg-tertiary);font-size:24px;color:var(--accent-gold);"><i class="fa-solid fa-scissors"></i></div>`;

        perfListContainer.innerHTML += `
            <div class="barber-perf-card" onclick="abrirConfigBarbeiro(${d.id})" title="Clique para configurar ${d.name}">
                <div class="barber-perf-header">
                    ${avatarHtml}
                    <div>
                        <h4 class="barber-perf-name">${d.name} ${inativoTag}</h4>
                        <span class="barber-perf-info">${d.specialty}</span>
                    </div>
                </div>
                
                <div class="barber-perf-metrics">
                    <div class="perf-metric">
                        <span class="perf-metric-lbl">Total Faturado</span>
                        <strong class="perf-metric-val" style="color:var(--text-primary);">R$ ${d.totalGeral.toFixed(2).replace('.', ',')}</strong>
                    </div>
                    <div class="perf-metric">
                        <span class="perf-metric-lbl">Atendimentos</span>
                        <strong class="perf-metric-val">${d.totalTrabalhos} cortes</strong>
                    </div>
                    <div class="perf-metric" style="margin-top: 5px;">
                        <span class="perf-metric-lbl">Repasse Barbeiro</span>
                        <strong class="perf-metric-val" style="font-size:14px; color: var(--accent-danger);">R$ ${d.comissaoPaga.toFixed(2).replace('.', ',')}</strong>
                    </div>
                    <div class="perf-metric" style="margin-top: 5px;">
                        <span class="perf-metric-lbl">Lucro Barbearia</span>
                        <strong class="perf-metric-val" style="font-size:14px; color: var(--accent-emerald);">R$ ${d.lucroRetido.toFixed(2).replace('.', ',')}</strong>
                    </div>
                </div>

                <!-- Configuração de Comissão Real-Time -->
                <div class="commission-setter" onclick="event.stopPropagation()">
                    <span class="commission-setter-lbl">Taxa de Comissão:</span>
                    <div class="commission-input-group">
                        <input type="number" min="0" max="100" class="commission-input-field" value="${d.commission}"
                               onchange="ajustarComissaoBarbeiro(${d.id}, this.value)">
                        <span class="commission-percent-sign">%</span>
                    </div>
                </div>

                <div class="perf-progress-bar" title="${pctProgresso.toFixed(0)}% da meta de líder">
                    <div class="perf-progress-fill" style="width: ${pctProgresso}%"></div>
                </div>
                <div style="font-size:10px; color:var(--text-muted); text-align:right; margin-top:6px;">
                    <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:9px;"></i> Clique no card para configurar
                </div>
            </div>
        `;
    });
};

// ==========================================================================
// ABA GERENTE: FILTROS DE CLIENTES (Por Nome, Telefone, Último Serviço)
// ==========================================================================

function obterUltimoServicoCliente(clientId) {
    const bookings = JSON.parse(localStorage.getItem("bookings")) || [];
    const sales = JSON.parse(localStorage.getItem("sales")) || [];

    const datasBookings = bookings
        .filter(b => b.status === "confirmed" && b.clientId === clientId)
        .map(b => b.date);
    const datasSales = sales
        .filter(s => s.type === "service" && s.clientId === clientId)
        .map(s => s.date);

    const todasDatas = [...datasBookings, ...datasSales].sort().reverse();
    return todasDatas.length > 0 ? todasDatas[0] : null;
}

function formatarUltimoServicoBadge(dataISO) {
    if (!dataISO) return `<span class="ultimo-servico-tag nenhum">Sem serviços</span>`;

    const hoje = new Date();
    const data = new Date(dataISO + "T12:00:00");
    const diffDias = Math.floor((hoje - data) / (1000 * 60 * 60 * 24));

    const [ano, mes, dia] = dataISO.split('-');
    const dataFormatada = `${dia}/${mes}/${ano}`;

    if (diffDias <= 7) {
        return `<span class="ultimo-servico-tag recente"><i class="fa-solid fa-circle-check" style="font-size:9px;"></i> ${dataFormatada}</span>`;
    } else if (diffDias <= 30) {
        return `<span class="ultimo-servico-tag medio"><i class="fa-solid fa-circle" style="font-size:9px;"></i> ${dataFormatada}</span>`;
    } else {
        return `<span class="ultimo-servico-tag antigo"><i class="fa-solid fa-circle-xmark" style="font-size:9px;"></i> ${dataFormatada}</span>`;
    }
}

function filtrarClientes() {
    const filtroNome = (document.getElementById("gerenteFiltroNome")?.value || "").toLowerCase().trim();
    const filtroTel = (document.getElementById("gerenteFiltroTelefone")?.value || "").toLowerCase().trim();
    const filtroData = document.getElementById("gerenteFiltroUltimoServico")?.value || "";

    const customers = JSON.parse(localStorage.getItem("customers")) || [];
    const hoje = new Date();

    let filtrados = customers.filter(c => {
        const nomeOk = !filtroNome || c.name.toLowerCase().includes(filtroNome);
        const telOk = !filtroTel || c.phone.replace(/\D/g, "").includes(filtroTel.replace(/\D/g, "")) || c.phone.toLowerCase().includes(filtroTel);

        let dataOk = true;
        if (filtroData) {
            const ultimaData = obterUltimoServicoCliente(c.id);
            if (filtroData === "sem_servico") {
                dataOk = !ultimaData;
            } else {
                const limite = parseInt(filtroData);
                if (!ultimaData) {
                    dataOk = false;
                } else {
                    const data = new Date(ultimaData + "T12:00:00");
                    const diffDias = Math.floor((hoje - data) / (1000 * 60 * 60 * 24));
                    dataOk = diffDias <= limite;
                }
            }
        }

        return nomeOk && telOk && dataOk;
    });

    // Mostrar resultado
    const resultadoEl = document.getElementById("gerenteFiltroResultado");
    const ativouFiltro = filtroNome || filtroTel || filtroData;
    if (resultadoEl) {
        if (ativouFiltro) {
            resultadoEl.style.display = "flex";
            resultadoEl.innerHTML = `<i class="fa-solid fa-filter"></i> Exibindo <strong style="margin:0 4px;">${filtrados.length}</strong> de <strong style="margin:0 4px;">${customers.length}</strong> clientes`;
        } else {
            resultadoEl.style.display = "none";
        }
    }

    // Renderizar tabela filtrada
    const tbody = document.getElementById("gerenteClientesTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (filtrados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:30px;"><i class="fa-solid fa-magnifying-glass" style="margin-right:8px;"></i>Nenhum cliente encontrado com esses filtros.</td></tr>`;
        return;
    }

    filtrados.forEach(c => {
        const ultimaDataISO = obterUltimoServicoCliente(c.id);
        const ultimoServicoBadge = formatarUltimoServicoBadge(ultimaDataISO);
        const cleanPhone = c.phone ? c.phone.replace(/\D/g, "") : "";
        const whatsappBtn = cleanPhone ? `<a href="https://wa.me/55${cleanPhone}" target="_blank" class="icon-btn" style="color:#25D366; margin-left:8px; display:inline-flex; align-items:center; text-decoration:none;" title="Conversar no WhatsApp"><i class="fa-brands fa-whatsapp" style="font-size:16px;"></i></a>` : "";
        
        tbody.innerHTML += `
            <tr>
                <td class="customer-name-col">${c.name}</td>
                <td style="display:flex; align-items:center;">${c.phone} ${whatsappBtn}</td>
                <td>${c.email}</td>
                <td>${ultimoServicoBadge}</td>
                <td style="text-align: right;">
                    <button class="icon-btn" style="color:var(--accent-gold); margin-right: 8px;" onclick="abrirModalEditarCliente('${c.id}')" title="Editar Cliente"><i class="fa-solid fa-pen"></i></button>
                    <button class="icon-btn delete" onclick="excluirCliente('${c.id}')" title="Excluir Cliente"><i class="fa-solid fa-trash-can"></i></button>
                </td>
            </tr>
        `;
    });
}

function limparFiltrosClientes() {
    const nome = document.getElementById("gerenteFiltroNome");
    const tel = document.getElementById("gerenteFiltroTelefone");
    const data = document.getElementById("gerenteFiltroUltimoServico");
    if (nome) nome.value = "";
    if (tel) tel.value = "";
    if (data) data.value = "";

    const resultadoEl = document.getElementById("gerenteFiltroResultado");
    if (resultadoEl) resultadoEl.style.display = "none";

    renderizarClientes();
}

// ==========================================================================
// OVERRIDE: renderizarClientes (inclui coluna último serviço + filtros integrados)
// ==========================================================================

const _renderizarClientesOriginal = renderizarClientes;
renderizarClientes = function() {
    const customers = JSON.parse(localStorage.getItem("customers")) || [];

    // Tabela do Barbeiro (restrição de privacidade — sem mudanças)
    const barbeiroTableBody = document.getElementById("barbeiroClientesTableBody");
    if (barbeiroTableBody) {
        barbeiroTableBody.innerHTML = "";
        customers.forEach(c => {
            const telefoneMascarado = c.phone.substring(0, 5) + "****-****";
            const partesEmail = c.email.split('@');
            const emailMascarado = partesEmail[0].substring(0, 2) + "*****@" + partesEmail[1];
            barbeiroTableBody.innerHTML += `
                <tr>
                    <td class="customer-name-col">${c.name}</td>
                    <td><span class="masked-data">${telefoneMascarado}</span></td>
                    <td><span class="masked-data">${emailMascarado}</span></td>
                </tr>
            `;
        });
    }

    // Tabela do Gerente — com coluna de último serviço e filtros aplicados se houver valor
    const filtroAtivo = document.getElementById("gerenteFiltroNome")?.value ||
                        document.getElementById("gerenteFiltroTelefone")?.value ||
                        document.getElementById("gerenteFiltroUltimoServico")?.value;

    if (filtroAtivo) {
        filtrarClientes();
        return;
    }

    const gerenteTableBody = document.getElementById("gerenteClientesTableBody");
    if (gerenteTableBody) {
        gerenteTableBody.innerHTML = "";
        customers.forEach(c => {
            const ultimaDataISO = obterUltimoServicoCliente(c.id);
            const ultimoServicoBadge = formatarUltimoServicoBadge(ultimaDataISO);
            const cleanPhone = c.phone ? c.phone.replace(/\D/g, "") : "";
            const whatsappBtn = cleanPhone ? `<a href="https://wa.me/55${cleanPhone}" target="_blank" class="icon-btn" style="color:#25D366; margin-left:8px; display:inline-flex; align-items:center; text-decoration:none;" title="Conversar no WhatsApp"><i class="fa-brands fa-whatsapp" style="font-size:16px;"></i></a>` : "";
            
            gerenteTableBody.innerHTML += `
                <tr>
                    <td class="customer-name-col">${c.name}</td>
                    <td style="display:flex; align-items:center;">${c.phone} ${whatsappBtn}</td>
                    <td>${c.email}</td>
                    <td>${ultimoServicoBadge}</td>
                    <td style="text-align: right;">
                        <button class="icon-btn" style="color:var(--accent-gold); margin-right: 8px;" onclick="abrirModalEditarCliente('${c.id}')" title="Editar Cliente"><i class="fa-solid fa-pen"></i></button>
                        <button class="icon-btn delete" onclick="excluirCliente('${c.id}')" title="Excluir Cliente"><i class="fa-solid fa-trash-can"></i></button>
                    </td>
                </tr>
            `;
        });
    }
};

// ==========================================================================
// OVERRIDE: trocarAbaGerente (inclui nova aba Profissionais)
// ==========================================================================

const _trocarAbaGerenteOriginal = trocarAbaGerente;
trocarAbaGerente = function(idAbaTarget, elementoBtn) {
    const abas = document.querySelectorAll("#portalGerente .tab-content");
    abas.forEach(aba => aba.classList.remove("active"));

    const abaTarget = document.getElementById(idAbaTarget);
    if (abaTarget) abaTarget.classList.add("active");

    const botoes = document.querySelectorAll("#portalGerente .nav-item");
    botoes.forEach(btn => btn.classList.remove("active"));
    elementoBtn.classList.add("active");

    if (idAbaTarget === "abaGerenteDashboard") {
        atualizarDashboard();
    } else if (idAbaTarget === "abaGerenteProfissionais") {
        renderizarProfissionais();
    } else if (idAbaTarget === "abaGerenteGestao") {
        renderizarCRUD();
    } else if (idAbaTarget === "abaGerenteClientes") {
        renderizarClientes();
    } else if (idAbaTarget === "abaGerenteAgenda") {
        renderizarAgendaTimeline();
    } else if (idAbaTarget === "abaGerenteAlertas") {
        renderizarAlertas();
    } else if (idAbaTarget === "abaGerenteSistema") {
        renderizarSistema();
    } else if (idAbaTarget === "abaGerenteConfiguracoes") {
        renderizarConfiguracoes();
    }
};


// ==========================================================================
// SISTEMA DE CONFIGURAÇÃO VISUAL — TEMAS, CORES E IDENTIDADE
// ==========================================================================

const TEMAS_PREDEFINIDOS = [
    {
        id: "dourado",
        nome: "Dourado Clássico",
        emoji: "⭐",
        accentColor: "#c5a028",
        accentLight: "#e5c354",
        bgPrimary: "#0a0a0a",
        bgSecondary: "#121212",
        bgTertiary: "#1a1a1a",
        bgCard: "#181818"
    },
    {
        id: "indigo",
        nome: "Índigo Noite",
        emoji: "🌌",
        accentColor: "#6366f1",
        accentLight: "#818cf8",
        bgPrimary: "#07071a",
        bgSecondary: "#0f0f28",
        bgTertiary: "#181835",
        bgCard: "#141430"
    },
    {
        id: "esmeralda",
        nome: "Esmeralda",
        emoji: "💚",
        accentColor: "#10b981",
        accentLight: "#34d399",
        bgPrimary: "#030f0a",
        bgSecondary: "#071a10",
        bgTertiary: "#0d2418",
        bgCard: "#0a1f14"
    },
    {
        id: "rubi",
        nome: "Rubi Ardente",
        emoji: "🔴",
        accentColor: "#f43f5e",
        accentLight: "#fb7185",
        bgPrimary: "#0f0306",
        bgSecondary: "#1a060b",
        bgTertiary: "#220912",
        bgCard: "#1c0710"
    },
    {
        id: "safira",
        nome: "Safira",
        emoji: "💙",
        accentColor: "#3b82f6",
        accentLight: "#60a5fa",
        bgPrimary: "#03060f",
        bgSecondary: "#060d1f",
        bgTertiary: "#0a1530",
        bgCard: "#080f28"
    },
    {
        id: "ametista",
        nome: "Ametista",
        emoji: "💜",
        accentColor: "#a855f7",
        accentLight: "#c084fc",
        bgPrimary: "#08030f",
        bgSecondary: "#10061a",
        bgTertiary: "#180a26",
        bgCard: "#140820"
    },
    {
        id: "titanio",
        nome: "Titânio",
        emoji: "🩶",
        accentColor: "#94a3b8",
        accentLight: "#cbd5e1",
        bgPrimary: "#080808",
        bgSecondary: "#111111",
        bgTertiary: "#1c1c1c",
        bgCard: "#181818"
    },
    {
        id: "cobre",
        nome: "Cobre",
        emoji: "🟠",
        accentColor: "#d97706",
        accentLight: "#f59e0b",
        bgPrimary: "#0c0700",
        bgSecondary: "#1a0e00",
        bgTertiary: "#261500",
        bgCard: "#201200"
    }
];

const CONFIG_VISUAL_PADRAO = {
    temaId: "dourado",
    accentColor: "#c5a028",
    accentLight: "#e5c354",
    bgPrimary: "#0a0a0a",
    bgSecondary: "#121212",
    bgTertiary: "#1a1a1a",
    bgCard: "#181818",
    nomeBarbearia: "The Golden Blade",
    tagline: "Gentleman's Club",
    logoBase64: null
};

// Aplica um objeto de configuração ao :root e ao DOM
function aplicarCSSVariaveis(cfg) {
    const root = document.documentElement;

    const hex = cfg.accentColor;
    const hexLight = cfg.accentLight;

    // Converter hex para RGBA para as variáveis de glow/dim
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);

    root.style.setProperty("--accent-gold",       hex);
    root.style.setProperty("--accent-gold-light",  hexLight);
    root.style.setProperty("--accent-gold-glow",   `rgba(${r},${g},${b},0.3)`);
    root.style.setProperty("--accent-gold-dim",    `rgba(${r},${g},${b},0.15)`);
    root.style.setProperty("--glass-border",       `rgba(${r},${g},${b},0.18)`);
    root.style.setProperty("--shadow-gold",        `0 0 20px rgba(${r},${g},${b},0.15)`);

    root.style.setProperty("--bg-primary",    cfg.bgPrimary);
    root.style.setProperty("--bg-secondary",  cfg.bgSecondary);
    root.style.setProperty("--bg-tertiary",   cfg.bgTertiary);
    root.style.setProperty("--bg-card",       cfg.bgCard);
    root.style.setProperty("--glass-bg",      `rgba(${parseInt(cfg.bgSecondary.slice(1,3),16)},${parseInt(cfg.bgSecondary.slice(3,5),16)},${parseInt(cfg.bgSecondary.slice(5,7),16)},0.75)`);
}

function aplicarIdentidadeVisual(cfg) {
    // Header do app
    const nome = cfg.nomeBarbearia || "The Golden Blade";
    const tag  = cfg.tagline || "Gentleman's Club";

    document.querySelectorAll(".logo-text").forEach(el => el.textContent = nome);
    document.querySelectorAll(".logo-tag").forEach(el  => el.textContent = tag);

    // Login
    const loginH2 = document.querySelector(".login-logo h2");
    const loginSpan = document.querySelector(".login-logo span");
    if (loginH2) loginH2.textContent = nome;
    if (loginSpan) loginSpan.textContent = tag;

    // Logo
    const logoIconHeader = document.querySelector(".logo-icon");
    const loginIconEl   = document.querySelector(".login-logo-icon");

    if (cfg.logoBase64) {
        // Mostrar imagem em vez do ícone
        if (logoIconHeader) {
            logoIconHeader.innerHTML = `<img src="${cfg.logoBase64}" alt="Logo" style="width:36px;height:36px;object-fit:cover;border-radius:50%;">`;
        }
        if (loginIconEl) {
            loginIconEl.innerHTML = `<img src="${cfg.logoBase64}" alt="Logo" style="width:54px;height:54px;object-fit:cover;border-radius:50%;border:2px solid var(--accent-gold);">`;
        }
    } else {
        if (logoIconHeader) logoIconHeader.innerHTML = `<i class="fa-solid fa-scissors"></i>`;
        if (loginIconEl)    loginIconEl.innerHTML    = `<i class="fa-solid fa-scissors"></i>`;
    }
}

function carregarConfiguracaoVisual() {
    const saved = JSON.parse(localStorage.getItem("visualConfig") || "null");
    const cfg = Object.assign({}, CONFIG_VISUAL_PADRAO, saved || {});

    aplicarCSSVariaveis(cfg);
    aplicarIdentidadeVisual(cfg);
}

function renderizarConfiguracoes() {
    const saved = JSON.parse(localStorage.getItem("visualConfig") || "null");
    const cfg = Object.assign({}, CONFIG_VISUAL_PADRAO, saved || {});

    // Preencher campos
    const nomeEl = document.getElementById("configNomeBarbearia");
    const tagEl  = document.getElementById("configTagline");
    if (nomeEl) nomeEl.value = cfg.nomeBarbearia || "";
    if (tagEl)  tagEl.value  = cfg.tagline || "";
    
    // Novos campos
    const endEl = document.getElementById("configEnderecoBarbearia");
    const semEl = document.getElementById("configHorarioSemana");
    const fdsEl = document.getElementById("configHorarioFds");
    if (endEl) endEl.value = cfg.endereco || "";
    if (semEl) semEl.value = cfg.horarioSemana || "";
    if (fdsEl) fdsEl.value = cfg.horarioFds || "";

    const linkEl = document.getElementById("configLinkConvite");
    if (linkEl) {
        let baseUrl = window.location.origin + window.location.pathname;
        linkEl.value = baseUrl + "?b=" + getActiveTenantId();
    }

    // Preview de nome
    previewNomeLogo();

    // Logo preview
    const iconEl = document.getElementById("logoPreviewIcon");
    const imgEl  = document.getElementById("logoPreviewImg");
    if (cfg.logoBase64 && imgEl && iconEl) {
        imgEl.src = cfg.logoBase64;
        imgEl.style.display = "block";
        iconEl.style.display = "none";
    } else if (imgEl && iconEl) {
        imgEl.style.display = "none";
        iconEl.style.display = "flex";
    }

    // Color picker
    const picker = document.getElementById("corPersonalizadaInput");
    const label  = document.getElementById("corHexLabel");
    if (picker) picker.value = cfg.accentColor;
    if (label)  label.textContent = cfg.accentColor;
    previewCorPersonalizada(cfg.accentColor);

    // Temas grid
    const grid = document.getElementById("temasGrid");
    if (!grid) return;
    grid.innerHTML = "";

    TEMAS_PREDEFINIDOS.forEach(tema => {
        const ativo = cfg.temaId === tema.id ? "ativo" : "";
        const bgDark = tema.bgPrimary;
        grid.innerHTML += `
            <div class="tema-card ${ativo}" onclick="aplicarTema('${tema.id}')" title="${tema.nome}">
                <div class="tema-color-swatches">
                    <div class="tema-swatch" style="width:36px;height:36px;background:${tema.bgSecondary};"></div>
                    <div class="tema-swatch" style="width:28px;height:28px;background:${tema.accentColor};"></div>
                    <div class="tema-swatch" style="width:20px;height:20px;background:${tema.accentLight};"></div>
                </div>
                <div class="tema-emoji">${tema.emoji}</div>
                <div class="tema-nome">${tema.nome}</div>
            </div>
        `;
    });
}

function aplicarTema(temaId) {
    const tema = TEMAS_PREDEFINIDOS.find(t => t.id === temaId);
    if (!tema) return;

    const saved = JSON.parse(localStorage.getItem("visualConfig") || "null");
    const cfg = Object.assign({}, CONFIG_VISUAL_PADRAO, saved || {}, {
        temaId:       tema.id,
        accentColor:  tema.accentColor,
        accentLight:  tema.accentLight,
        bgPrimary:    tema.bgPrimary,
        bgSecondary:  tema.bgSecondary,
        bgTertiary:   tema.bgTertiary,
        bgCard:       tema.bgCard
    });

    aplicarCSSVariaveis(cfg);

    // Atualizar picker e label
    const picker = document.getElementById("corPersonalizadaInput");
    const label  = document.getElementById("corHexLabel");
    if (picker) picker.value = tema.accentColor;
    if (label)  label.textContent = tema.accentColor;
    previewCorPersonalizada(tema.accentColor);

    // Marcar ativo na grade
    document.querySelectorAll(".tema-card").forEach(el => el.classList.remove("ativo"));
    const cards = document.querySelectorAll(".tema-card");
    const idx   = TEMAS_PREDEFINIDOS.findIndex(t => t.id === temaId);
    if (cards[idx]) cards[idx].classList.add("ativo");

    // Salvar temporariamente (sem fechar aba)
    localStorage.setItem("visualConfig", JSON.stringify(cfg));

    exibirToast(`Tema Aplicado! ${tema.emoji}`, `${tema.nome} ativo. Clique em Salvar Tudo para confirmar.`, "success");
}

function previewCorPersonalizada(hex) {
    const label = document.getElementById("corHexLabel");
    if (label) label.textContent = hex;

    const swatches = document.getElementById("colorPreviewSwatches");
    if (!swatches) return;

    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);

    swatches.innerHTML = `
        <div class="color-preview-swatch" style="background:${hex};" title="Cor principal"></div>
        <div class="color-preview-swatch" style="background:rgba(${r},${g},${b},0.6);" title="Médio"></div>
        <div class="color-preview-swatch" style="background:rgba(${r},${g},${b},0.25);" title="Dim (fundo)"></div>
        <div class="color-preview-swatch" style="background:rgba(${r},${g},${b},0.1);" title="Extra dim"></div>
    `;
}

function aplicarCorPersonalizada() {
    const picker = document.getElementById("corPersonalizadaInput");
    if (!picker) return;
    const hex = picker.value;

    // Gerar uma versão mais clara (+50 luminosidade aproximada)
    const r = Math.min(255, parseInt(hex.slice(1,3), 16) + 40);
    const g = Math.min(255, parseInt(hex.slice(3,5), 16) + 35);
    const b = Math.min(255, parseInt(hex.slice(5,7), 16) + 20);
    const hexLight = "#" + [r,g,b].map(v => v.toString(16).padStart(2,"0")).join("");

    const saved = JSON.parse(localStorage.getItem("visualConfig") || "null");
    const cfg = Object.assign({}, CONFIG_VISUAL_PADRAO, saved || {}, {
        temaId:      "custom",
        accentColor: hex,
        accentLight: hexLight
    });

    aplicarCSSVariaveis(cfg);
    localStorage.setItem("visualConfig", JSON.stringify(cfg));

    // Desmarcar temas predefinidos
    document.querySelectorAll(".tema-card").forEach(el => el.classList.remove("ativo"));

    exibirToast("Cor Aplicada! 🎨", `Destaque alterado para ${hex}. Clique em Salvar Tudo para confirmar.`, "success");
}

function previewNomeLogo() {
    const nome = document.getElementById("configNomeBarbearia")?.value || "The Golden Blade";
    const tag  = document.getElementById("configTagline")?.value || "Gentleman's Club";
    const nomeEl = document.getElementById("previewNomeText");
    const tagEl  = document.getElementById("previewTaglineText");
    if (nomeEl) nomeEl.textContent = nome;
    if (tagEl)  tagEl.textContent  = tag;
}

function uploadLogoArquivo(input) {
    const file = input.files[0];
    if (!file) return;

    // Aceita até 20MB
    if (file.size > 20 * 1024 * 1024) {
        exibirToast("Arquivo muito grande", "O logo deve ter no máximo 20MB.", "info");
        input.value = "";
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        // Abre o cropper em vez de salvar direto
        abrirCropperLogo(e.target.result);
    };
    reader.readAsDataURL(file);
}

// ==========================================================================
// SISTEMA DE RECORTE DE LOGO (Canvas Cropper)
// ==========================================================================

const _cr = {
    img: null,
    offsetX: 0, offsetY: 0,
    zoom: 1,
    SIZE: 280,       // tamanho do canvas de edição
    OUT: 256,        // tamanho do output final
    dragging: false,
    startX: 0, startY: 0,
    startOX: 0, startOY: 0,
    _listeners: []
};

function abrirCropperLogo(dataUrl) {
    const img = new Image();
    img.onload = function() {
        _cr.img = img;
        _cr.zoom = 1;
        // Centralizar automaticamente
        const scaleBase = Math.max(_cr.SIZE / img.width, _cr.SIZE / img.height);
        _cr.zoom = scaleBase;                            // preencher o círculo
        _cr.offsetX = 0;
        _cr.offsetY = 0;

        // Resetar slider
        const slider = document.getElementById("cropperZoom");
        if (slider) {
            slider.min  = (scaleBase * 0.5).toFixed(2);
            slider.max  = (scaleBase * 4).toFixed(2);
            slider.step = (scaleBase * 0.01).toFixed(4);
            slider.value = _cr.zoom;
        }

        document.getElementById("modalCropperLogo").classList.add("active");
        _inicializarEventosCropper();
        _desenharCropper();
    };
    img.src = dataUrl;
}

function fecharCropperLogo() {
    document.getElementById("modalCropperLogo").classList.remove("active");
    // Remover listeners
    _cr._listeners.forEach(([el, ev, fn]) => el.removeEventListener(ev, fn));
    _cr._listeners = [];
    // Limpar input de arquivo
    const fi = document.getElementById("logoFileInput");
    if (fi) fi.value = "";
}

function _inicializarEventosCropper() {
    // Limpar listeners anteriores
    _cr._listeners.forEach(([el, ev, fn]) => el.removeEventListener(ev, fn));
    _cr._listeners = [];

    const canvas = document.getElementById("cropperCanvas");
    if (!canvas) return;

    const addEv = (el, ev, fn, opts) => {
        el.addEventListener(ev, fn, opts || false);
        _cr._listeners.push([el, ev, fn]);
    };

    // Mouse
    addEv(canvas, "mousedown", e => {
        _cr.dragging = true;
        _cr.startX = e.clientX; _cr.startY = e.clientY;
        _cr.startOX = _cr.offsetX; _cr.startOY = _cr.offsetY;
        canvas.style.cursor = "grabbing";
    });
    addEv(window, "mousemove", e => {
        if (!_cr.dragging) return;
        _cr.offsetX = _cr.startOX + (e.clientX - _cr.startX);
        _cr.offsetY = _cr.startOY + (e.clientY - _cr.startY);
        _desenharCropper();
    });
    addEv(window, "mouseup", () => {
        _cr.dragging = false;
        canvas.style.cursor = "grab";
    });

    // Scroll para zoom
    addEv(canvas, "wheel", e => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.05 : -0.05;
        const slider = document.getElementById("cropperZoom");
        _cr.zoom = Math.max(parseFloat(slider?.min || 0.5), Math.min(parseFloat(slider?.max || 4), _cr.zoom + delta));
        if (slider) slider.value = _cr.zoom;
        _desenharCropper();
    }, { passive: false });

    // Touch (mobile)
    let lastTouch = null;
    addEv(canvas, "touchstart", e => {
        if (e.touches.length === 1) {
            _cr.dragging = true;
            _cr.startX = e.touches[0].clientX;
            _cr.startY = e.touches[0].clientY;
            _cr.startOX = _cr.offsetX;
            _cr.startOY = _cr.offsetY;
        }
        lastTouch = e.touches;
    }, { passive: true });
    addEv(canvas, "touchmove", e => {
        e.preventDefault();
        if (e.touches.length === 1 && _cr.dragging) {
            _cr.offsetX = _cr.startOX + (e.touches[0].clientX - _cr.startX);
            _cr.offsetY = _cr.startOY + (e.touches[0].clientY - _cr.startY);
        } else if (e.touches.length === 2 && lastTouch && lastTouch.length === 2) {
            const prevDist = Math.hypot(lastTouch[0].clientX - lastTouch[1].clientX, lastTouch[0].clientY - lastTouch[1].clientY);
            const currDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            const factor = currDist / prevDist;
            const slider = document.getElementById("cropperZoom");
            _cr.zoom = Math.max(parseFloat(slider?.min || 0.5), Math.min(parseFloat(slider?.max || 4), _cr.zoom * factor));
            if (slider) slider.value = _cr.zoom;
        }
        lastTouch = e.touches;
        _desenharCropper();
    }, { passive: false });
    addEv(canvas, "touchend", () => { _cr.dragging = false; });

    canvas.style.cursor = "grab";
}

function onCropperZoom(val) {
    _cr.zoom = parseFloat(val);
    _desenharCropper();
}

function _desenharCropper() {
    const canvas = document.getElementById("cropperCanvas");
    if (!canvas || !_cr.img) return;
    const ctx = canvas.getContext("2d");
    const S = _cr.SIZE;

    ctx.clearRect(0, 0, S, S);

    // Desenhar imagem deslocada/com zoom
    const img = _cr.img;
    const dW = img.width  * _cr.zoom;
    const dH = img.height * _cr.zoom;
    const dX = (S - dW) / 2 + _cr.offsetX;
    const dY = (S - dH) / 2 + _cr.offsetY;
    ctx.drawImage(img, dX, dY, dW, dH);

    // Máscara escura fora do círculo
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.beginPath();
    ctx.rect(0, 0, S, S);
    ctx.arc(S/2, S/2, S/2 - 4, 0, Math.PI * 2, true); // furar o meio
    ctx.fill("evenodd");
    ctx.restore();

    // Borda dourada do círculo
    ctx.strokeStyle = "var(--accent-gold, #c5a028)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(S/2, S/2, S/2 - 4, 0, Math.PI * 2);
    ctx.stroke();

    // Atualizar mini preview
    _atualizarPreviewCropper(dX, dY, dW, dH);
}

function _atualizarPreviewCropper(dX, dY, dW, dH) {
    const prev = document.getElementById("cropperPreview");
    if (!prev || !_cr.img) return;
    const pCtx = prev.getContext("2d");
    const P = prev.width; // 48
    pCtx.clearRect(0, 0, P, P);
    pCtx.save();
    pCtx.beginPath();
    pCtx.arc(P/2, P/2, P/2, 0, Math.PI * 2);
    pCtx.clip();
    // Escalar coordenadas do canvas grande para o preview
    const scale = P / _cr.SIZE;
    pCtx.drawImage(_cr.img, dX * scale, dY * scale, dW * scale, dH * scale);
    pCtx.restore();
}

function confirmarCropLogo() {
    if (!_cr.img) return;

    const S = _cr.SIZE;
    const O = _cr.OUT; // 256

    // Canvas de saída 256x256
    const out = document.createElement("canvas");
    out.width = O; out.height = O;
    const octx = out.getContext("2d");

    // Clip circular
    octx.beginPath();
    octx.arc(O/2, O/2, O/2, 0, Math.PI * 2);
    octx.clip();

    // Replicar posicionamento do cropper, escalado para 256
    const factor = O / S;
    const img = _cr.img;
    const dW = img.width  * _cr.zoom * factor;
    const dH = img.height * _cr.zoom * factor;
    const dX = ((S - img.width  * _cr.zoom) / 2 + _cr.offsetX) * factor;
    const dY = ((S - img.height * _cr.zoom) / 2 + _cr.offsetY) * factor;

    octx.drawImage(img, dX, dY, dW, dH);

    // Converter para PNG base64 (comprimido)
    const base64 = out.toDataURL("image/png", 0.9);

    // Salvar no localStorage
    const saved = JSON.parse(localStorage.getItem("visualConfig") || "null");
    const cfg = Object.assign({}, CONFIG_VISUAL_PADRAO, saved || {}, { logoBase64: base64 });
    localStorage.setItem("visualConfig", JSON.stringify(cfg));

    // Atualizar preview na aba de configurações
    const iconEl = document.getElementById("logoPreviewIcon");
    const imgEl  = document.getElementById("logoPreviewImg");
    if (imgEl) { imgEl.src = base64; imgEl.style.display = "block"; }
    if (iconEl) iconEl.style.display = "none";

    aplicarIdentidadeVisual(cfg);
    fecharCropperLogo();
    exibirToast("Logo Salvo! ✂️", "Imagem recortada e aplicada. Clique em Salvar Tudo para confirmar.", "success");
}

function removerLogo() {
    const iconEl = document.getElementById("logoPreviewIcon");
    const imgEl  = document.getElementById("logoPreviewImg");
    const fileInput = document.getElementById("logoFileInput");
    if (imgEl)  { imgEl.src = ""; imgEl.style.display = "none"; }
    if (iconEl) iconEl.style.display = "flex";
    if (fileInput) fileInput.value = "";

    const saved = JSON.parse(localStorage.getItem("visualConfig") || "null");
    const cfg = Object.assign({}, CONFIG_VISUAL_PADRAO, saved || {}, { logoBase64: null });
    localStorage.setItem("visualConfig", JSON.stringify(cfg));

    aplicarIdentidadeVisual(cfg);
    exibirToast("Logo Removido", "O ícone padrão foi restaurado.", "info");
}

function salvarConfiguracaoVisual() {
    try {
        const nome = (document.getElementById("configNomeBarbearia")?.value || "").trim() || "The Golden Blade";
        const tag  = (document.getElementById("configTagline")?.value  || "").trim() || "Gentleman's Club";
        
        const end = (document.getElementById("configEnderecoBarbearia")?.value || "").trim();
        const sem = (document.getElementById("configHorarioSemana")?.value || "").trim();
        const fds = (document.getElementById("configHorarioFds")?.value || "").trim();

        // Capturar cor diretamente do picker (funciona mesmo sem clicar em "Aplicar Cor")
        const picker = document.getElementById("corPersonalizadaInput");
        const hexAtual = picker ? picker.value : null;

        let accentOverride = {};
        if (hexAtual) {
            const r = Math.min(255, parseInt(hexAtual.slice(1,3),16) + 40);
            const g = Math.min(255, parseInt(hexAtual.slice(3,5),16) + 35);
            const b = Math.min(255, parseInt(hexAtual.slice(5,7),16) + 20);
            const light = "#" + [r,g,b].map(v => v.toString(16).padStart(2,"0")).join("");
            accentOverride = { accentColor: hexAtual, accentLight: light };
        }

        const saved = JSON.parse(localStorage.getItem("visualConfig") || "null");
        const cfg = Object.assign({}, CONFIG_VISUAL_PADRAO, saved || {}, accentOverride, {
            nomeBarbearia: nome,
            tagline:       tag,
            endereco:      end,
            horarioSemana: sem,
            horarioFds:    fds
        });

        localStorage.setItem("visualConfig", JSON.stringify(cfg));
        aplicarCSSVariaveis(cfg);
        aplicarIdentidadeVisual(cfg);

        exibirToast("Configurações Salvas! ✅", "Visual, tema e identidade atualizados com sucesso.", "success");
        if (typeof criarAlertaSistema === "function") {
            criarAlertaSistema(`Visual: Gerente atualizou o tema — Nome: "${nome}", Cor: ${cfg.accentColor}.`);
        }
    } catch(err) {
        console.error("salvarConfiguracaoVisual:", err);
function resetarConfiguracaoVisual() {
    if (!confirm("⚠️ Tem certeza que deseja restaurar o visual padrão (Dourado Clássico)?\nTodas as personalizações serão perdidas.")) return;

    localStorage.removeItem("visualConfig");
    carregarConfiguracaoVisual();
    renderizarConfiguracoes();

    exibirToast("Visual Restaurado 🔄", "O tema padrão Dourado Clássico foi aplicado.", "info");
}

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
                ? `<img class="agenda-barber-avatar-sm" src="${barber.foto}" alt="${barber.name || barber.nome}">`
                : `<div class="agenda-barber-avatar-icon"><i class="fa-solid fa-user"></i></div>`;

            html += `<div class="agenda-barber-header">${avatarHtml}<span class="agenda-barber-name">${(barber.name || barber.nome).split(' ')[0]}</span></div>`;

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
                    const serviceName = booking.servicos && booking.servicos.length > 0 ? (booking.servicos[0].name || booking.servicos[0].nome) : booking.servico || '—';
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
    sel.innerHTML = slots.map(s => `<option value="${s}">${s}</option>`).join('');
}

function _popularBarbeirosComanda() {
    const sel = document.getElementById('comandaBarbeiroSelect');
    if (!sel) return;
    const barbers = JSON.parse(localStorage.getItem('barbers') || '[]').filter(b => b.active !== false);
    sel.innerHTML = '<option value="">— Selecione —</option>' +
        barbers.map(b => `<option value="${b.id}">${b.name || b.nome || 'Barbeiro'}</option>`).join('');
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
        if (barber.foto && avatarEl) avatarEl.innerHTML = `<img src="${barber.foto}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
        else if (avatarEl) avatarEl.innerHTML = '<i class="fa-solid fa-scissors"></i>';
        if (subEl) {
            const horaSel = document.getElementById('comandaHorario');
            const dataInput = document.getElementById('comandaData');
            subEl.textContent = `${barber.name || barber.nome} · ${dataInput?.value || '—'} às ${horaSel?.value || '—'}`;
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
            resultsEl.innerHTML = matches.map(c => `
                <div class="comanda-cliente-result-item" onclick="selecionarClienteComanda('${c.id}', '${((c.name || c.nome)||'').replace(/'/g,"\\'")}')">
                    <strong>${(c.name || c.nome) || 'Sem nome'}</strong>
                    <span>${(c.phone || c.telefone) || ''} ${c.email ? '· '+c.email : ''}</span>
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
            <div class="comanda-item-nome">${s.name || s.nome}</div>
            <div class="comanda-item-preco">R$ ${parseFloat(s.price || s.preco || 0).toFixed(2).replace('.',',')}</div>
            <button class="comanda-item-add-btn" onclick="adicionarItemComanda('servico','${s.id}','${((s.name || s.nome)||'').replace(/'/g,"\\'")}',${parseFloat(s.price || s.preco || 0)})" title="Adicionar">
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
            <div class="comanda-item-nome">${p.name || p.nome}</div>
            <div class="comanda-item-preco">R$ ${parseFloat(p.price || p.preco || 0).toFixed(2).replace('.',',')}</div>
            <button class="comanda-item-add-btn" onclick="adicionarItemComanda('produto','${p.id}','${((p.name || p.nome)||'').replace(/'/g,"\\'")}',${parseFloat(p.price || p.preco || 0)})" title="Adicionar">
                <i class="fa-solid fa-plus"></i>
            </button>
        </div>
    `).join('');
}

// Chamar ao iniciar a aplicação
document.addEventListener("DOMContentLoaded", function() {
    const urlParams = new URLSearchParams(window.location.search);
    const b = urlParams.get('b');
    if (b) {
        db.collection('barbearias_dados').doc(b).collection('storage').doc('visualConfig').get().then(doc => {
            if (doc.exists) {
                const cfgStr = doc.data().payload;
                if (cfgStr) {
                    const cfg = JSON.parse(cfgStr);
                    aplicarCSSVariaveis(cfg);
                    aplicarIdentidadeVisual(cfg);
                } else {
                    carregarConfiguracaoVisual();
                }
            } else {
                carregarConfiguracaoVisual();
            }
        }).catch(() => carregarConfiguracaoVisual());
    } else {
        carregarConfiguracaoVisual();
    }
});

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
        barberNome: barber ? (barber.name || barber.nome || '') : '',
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
        barberNome: barber ? (barber.name || barber.nome || '') : '',
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

    const infoContainer = document.getElementById("loginBarbershopInfo");
    const addrEl = document.getElementById("loginBarbershopAddress");
    const hoursEl = document.getElementById("loginBarbershopHours");
    if (infoContainer && addrEl && hoursEl) {
        if (cfg.endereco || cfg.horarioSemana) {
            addrEl.textContent = cfg.endereco || "Endereço não informado";
            hoursEl.innerHTML = (cfg.horarioSemana || "Semana não informada") + " &bull; " + (cfg.horarioFds || "");
            infoContainer.style.display = "block";
        } else {
            infoContainer.style.display = "none";
        }
    }

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

// ==========================================================================
// RECURSOS EXTRAS: FOTO DO BARBEIRO E PLANILHAS INTERATIVAS
// ==========================================================================

function atualizarAvatarPainelBarbeiro() {
    if (!currentUser || currentUser.role !== "barbeiro") return;

    const barbers = JSON.parse(localStorage.getItem("barbers")) || [];
    const currentBarber = barbers.find(b => b.id == currentUser.id);

    const imgEl = document.getElementById("barbeiroPainelAvatar");
    const iconEl = document.getElementById("barbeiroPainelAvatarIcon");

    if (currentBarber && (currentBarber.avatar || currentBarber.foto)) {
        const fotoSrc = currentBarber.avatar || currentBarber.foto;
        if (imgEl) {
            imgEl.src = fotoSrc;
            imgEl.style.display = "block";
        }
        if (iconEl) iconEl.style.display = "none";
    } else {
        if (imgEl) {
            imgEl.src = "";
            imgEl.style.display = "none";
        }
        if (iconEl) iconEl.style.display = "flex";
    }
}

function uploadFotoBarbeiro(input) {
    const file = input.files[0];
    if (!file) return;

    if (file.size > 1024 * 1024) {
        exibirToast("Arquivo muito grande ⚠️", "A foto de perfil deve ter no máximo 1MB.", "info");
        input.value = "";
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        const base64Src = e.target.result;

        const barbers = JSON.parse(localStorage.getItem("barbers")) || [];
        const idx = barbers.findIndex(b => b.id == currentUser.id);

        if (idx !== -1) {
            // Atualizar foto no banco local
            barbers[idx].avatar = base64Src;
            barbers[idx].foto = base64Src;
            localStorage.setItem("barbers", JSON.stringify(barbers));

            // Atualizar sessão e UI
            currentUser.avatar = base64Src;
            sessionStorage.setItem("currentSession", JSON.stringify(currentUser));
            
            atualizarAvatarPainelBarbeiro();
            
            // Re-renderizar a timeline para atualizar a foto da agenda
            if (typeof renderizarAgendaTimeline === "function") {
                renderizarAgendaTimeline();
            }

            exibirToast("Foto Atualizada! 📸", "Sua foto de perfil foi alterada com sucesso.", "success");
            criarAlertaSistema(`Perfil: Barbeiro "${currentUser.name}" atualizou sua foto de perfil.`);
        }
        input.value = "";
    };
    reader.readAsDataURL(file);
}

function removerFotoBarbeiro() {
    if (!currentUser || currentUser.role !== "barbeiro") return;

    if (!confirm("Deseja realmente remover sua foto de perfil?")) return;

    const barbers = JSON.parse(localStorage.getItem("barbers")) || [];
    const idx = barbers.findIndex(b => b.id == currentUser.id);

    if (idx !== -1) {
        // Resetar para as fotos padrão se existirem ou remover
        barbers[idx].avatar = `assets/barber_${currentUser.id}.png`;
        barbers[idx].foto = `assets/barber_${currentUser.id}.png`;
        localStorage.setItem("barbers", JSON.stringify(barbers));

        currentUser.avatar = null;
        sessionStorage.setItem("currentSession", JSON.stringify(currentUser));

        atualizarAvatarPainelBarbeiro();

        if (typeof renderizarAgendaTimeline === "function") {
            renderizarAgendaTimeline();
        }

        exibirToast("Foto Removida 📸", "Sua foto foi redefinida para o padrão.", "info");
        criarAlertaSistema(`Perfil: Barbeiro "${currentUser.name}" removeu sua foto de perfil.`);
    }
}

// LÓGICA DAS PLANILHAS DETALHADAS DO DASHBOARD GERENTE
function abrirPlanilhaDashboard(tipo) {
    const modal = document.getElementById("modalPlanilhaFaturamento");
    const tituloEl = document.getElementById("modalPlanilhaTitulo");
    const descEl = document.getElementById("modalPlanilhaDesc");
    const headEl = document.getElementById("modalPlanilhaHead");
    const bodyEl = document.getElementById("modalPlanilhaBody");

    if (!modal || !tituloEl || !headEl || !bodyEl) return;

    // Obter dados locais
    const bookings = JSON.parse(localStorage.getItem("bookings")) || [];
    const sales = JSON.parse(localStorage.getItem("sales")) || [];
    const barbers = JSON.parse(localStorage.getItem("barbers")) || [];

    let headHtml = "";
    let bodyHtml = "";
    let totalBruto = 0;

    if (tipo === "faturamento") {
        tituloEl.textContent = "Planilha de Faturamento Bruto Geral";
        descEl.textContent = "Exibindo todas as comandas finalizadas (serviços) e vendas avulsas de produtos.";
        
        headHtml = `
            <tr>
                <th style="padding:12px;text-align:left;border-bottom:2px solid rgba(255,255,255,0.1);">Data</th>
                <th style="padding:12px;text-align:left;border-bottom:2px solid rgba(255,255,255,0.1);">Cliente</th>
                <th style="padding:12px;text-align:left;border-bottom:2px solid rgba(255,255,255,0.1);">Profissional</th>
                <th style="padding:12px;text-align:left;border-bottom:2px solid rgba(255,255,255,0.1);">Serviço / Produto</th>
                <th style="padding:12px;text-align:left;border-bottom:2px solid rgba(255,255,255,0.1);">Tipo</th>
                <th style="padding:12px;text-align:left;border-bottom:2px solid rgba(255,255,255,0.1);">Pagamento</th>
                <th style="padding:12px;text-align:right;border-bottom:2px solid rgba(255,255,255,0.1);">Valor</th>
            </tr>
        `;

        // Filtrar vendas de produtos e comandas finalizadas
        const faturamentoItens = [];
        
        sales.forEach(s => {
            const dataFmt = s.date ? s.date.split("-").reverse().join("/") : "—";
            
            if (s.itens && s.itens.length > 0) {
                // Venda via timeline
                s.itens.forEach(item => {
                    faturamentoItens.push({
                        date: dataFmt,
                        client: s.clienteNome || "Avulso",
                        barber: s.barberNome || "—",
                        item: item.nome,
                        tipo: item.tipo === "servico" ? "✂️ Serviço" : "🧴 Produto",
                        pag: s.pagamento || "—",
                        price: parseFloat(item.preco || 0)
                    });
                });
            } else {
                // Venda mock histórica
                faturamentoItens.push({
                    date: dataFmt,
                    client: s.client || "Avulso",
                    barber: barbers.find(b => b.id == s.barberId)?.name || "—",
                    item: s.name,
                    tipo: s.type === "service" ? "✂️ Serviço" : "🧴 Produto",
                    pag: s.pagamento || "Dinheiro",
                    price: parseFloat(s.price || 0)
                });
            }
        });

        // Filtrar comandas da timeline que já constam como concluídas mas não estão listadas nas vendas
        bookings.filter(b => b.status === "concluido" && !sales.some(s => s.bookingId === b.id)).forEach(b => {
            const dataFmt = b.date ? b.date.split("-").reverse().join("/") : "—";
            const servNome = b.servicos && b.servicos.length > 0 ? b.servicos[0].nome : b.serviceName || "Serviço";
            faturamentoItens.push({
                date: dataFmt,
                client: b.clienteNome || "Avulso",
                barber: b.barberNome || "—",
                item: servNome,
                tipo: "✂️ Serviço",
                pag: b.pagamento || "—",
                price: parseFloat(b.price || b.total || 0)
            });
        });

        // Ordenar por data mais recente
        faturamentoItens.sort((a,b) => b.date.localeCompare(a.date));

        faturamentoItens.forEach(item => {
            totalBruto += item.price;
            bodyHtml += `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.03);">
                    <td style="padding:10px 12px;font-size:13px;color:var(--text-muted);">${item.date}</td>
                    <td style="padding:10px 12px;font-size:13px;font-weight:600;">${item.client}</td>
                    <td style="padding:10px 12px;font-size:13px;color:var(--text-secondary);">${item.barber}</td>
                    <td style="padding:10px 12px;font-size:13px;">${item.item}</td>
                    <td style="padding:10px 12px;font-size:12px;color:var(--accent-gold);">${item.tipo}</td>
                    <td style="padding:10px 12px;font-size:12px;text-transform:capitalize;">${item.pag}</td>
                    <td style="padding:10px 12px;font-size:13px;text-align:right;font-weight:700;">R$ ${item.price.toFixed(2).replace('.', ',')}</td>
                </tr>
            `;
        });

        bodyHtml += `
            <tr style="background:rgba(197,160,40,0.06);font-weight:700;border-top:2px solid rgba(255,255,255,0.1);">
                <td colspan="6" style="padding:12px;font-size:14px;color:var(--accent-gold);">TOTAL DE FATURAMENTO</td>
                <td style="padding:12px;font-size:14px;text-align:right;color:var(--accent-gold);">R$ ${totalBruto.toFixed(2).replace('.', ',')}</td>
            </tr>
        `;

    } else if (tipo === "lucro") {
        tituloEl.textContent = "Planilha de Lucratividade Líquida da Barbearia";
        descEl.textContent = "Faturamento Bruto deduzido das comissões operacionais pagas aos barbeiros.";

        headHtml = `
            <tr>
                <th style="padding:12px;text-align:left;border-bottom:2px solid rgba(255,255,255,0.1);">Data</th>
                <th style="padding:12px;text-align:left;border-bottom:2px solid rgba(255,255,255,0.1);">Profissional</th>
                <th style="padding:12px;text-align:left;border-bottom:2px solid rgba(255,255,255,0.1);">Item / Serviço</th>
                <th style="padding:12px;text-align:right;border-bottom:2px solid rgba(255,255,255,0.1);">Faturamento</th>
                <th style="padding:12px;text-align:center;border-bottom:2px solid rgba(255,255,255,0.1);">Comissão (%)</th>
                <th style="padding:12px;text-align:right;border-bottom:2px solid rgba(255,255,255,0.1);">Repasse Pago</th>
                <th style="padding:12px;text-align:right;border-bottom:2px solid rgba(255,255,255,0.1);">Lucro Líquido</th>
            </tr>
        `;

        let totalComissao = 0;
        let totalLucro = 0;

        sales.forEach(s => {
            const dataFmt = s.date ? s.date.split("-").reverse().join("/") : "—";
            const barber = barbers.find(b => b.id == s.barberId) || { name: "Avulso", commission: 0 };
            const commPct = barber.commission || 50;

            if (s.itens && s.itens.length > 0) {
                s.itens.forEach(item => {
                    const price = parseFloat(item.preco || 0);
                    // Comissões pagas apenas em serviços (produtos possuem regras de repasse diferentes, calculamos proporcional)
                    const isServ = item.tipo === "servico";
                    const commPaid = isServ ? (price * (commPct / 100)) : 0;
                    const profit = price - commPaid;

                    totalBruto += price;
                    totalComissao += commPaid;
                    totalLucro += profit;

                    bodyHtml += `
                        <tr style="border-bottom:1px solid rgba(255,255,255,0.03);">
                            <td style="padding:10px 12px;font-size:13px;color:var(--text-muted);">${dataFmt}</td>
                            <td style="padding:10px 12px;font-size:13px;font-weight:600;">${barber.name}</td>
                            <td style="padding:10px 12px;font-size:13px;">${item.nome} ${!isServ ? '<small style="color:var(--text-muted);">(Produto)</small>':''}</td>
                            <td style="padding:10px 12px;font-size:13px;text-align:right;">R$ ${price.toFixed(2).replace('.', ',')}</td>
                            <td style="padding:10px 12px;font-size:13px;text-align:center;color:var(--text-muted);">${isServ ? commPct + '%' : '0%'}</td>
                            <td style="padding:10px 12px;font-size:13px;text-align:right;color:var(--accent-danger);">R$ ${commPaid.toFixed(2).replace('.', ',')}</td>
                            <td style="padding:10px 12px;font-size:13px;text-align:right;color:var(--accent-emerald);font-weight:600;">R$ ${profit.toFixed(2).replace('.', ',')}</td>
                        </tr>
                    `;
                });
            } else {
                const price = parseFloat(s.price || 0);
                const isServ = s.type === "service";
                const commPaid = isServ ? (price * (commPct / 100)) : 0;
                const profit = price - commPaid;

                totalBruto += price;
                totalComissao += commPaid;
                totalLucro += profit;

                bodyHtml += `
                    <tr style="border-bottom:1px solid rgba(255,255,255,0.03);">
                        <td style="padding:10px 12px;font-size:13px;color:var(--text-muted);">${dataFmt}</td>
                        <td style="padding:10px 12px;font-size:13px;font-weight:600;">${barber.name}</td>
                        <td style="padding:10px 12px;font-size:13px;">${s.name} ${!isServ ? '<small style="color:var(--text-muted);">(Produto)</small>':''}</td>
                        <td style="padding:10px 12px;font-size:13px;text-align:right;">R$ ${price.toFixed(2).replace('.', ',')}</td>
                        <td style="padding:10px 12px;font-size:13px;text-align:center;color:var(--text-muted);">${isServ ? commPct + '%' : '0%'}</td>
                        <td style="padding:10px 12px;font-size:13px;text-align:right;color:var(--accent-danger);">R$ ${commPaid.toFixed(2).replace('.', ',')}</td>
                        <td style="padding:10px 12px;font-size:13px;text-align:right;color:var(--accent-emerald);font-weight:600;">R$ ${profit.toFixed(2).replace('.', ',')}</td>
                    </tr>
                `;
            }
        });

        bodyHtml += `
            <tr style="background:rgba(255,255,255,0.02);font-weight:700;border-top:2px solid rgba(255,255,255,0.1);">
                <td colspan="3" style="padding:12px;font-size:13px;color:var(--text-muted);">SOMAS DE COLUNA</td>
                <td style="padding:12px;font-size:13px;text-align:right;">R$ ${totalBruto.toFixed(2).replace('.', ',')}</td>
                <td style="padding:12px;font-size:13px;text-align:center;">—</td>
                <td style="padding:12px;font-size:13px;text-align:right;color:var(--accent-danger);">R$ ${totalComissao.toFixed(2).replace('.', ',')}</td>
                <td style="padding:12px;font-size:13px;text-align:right;color:var(--accent-emerald);">R$ ${totalLucro.toFixed(2).replace('.', ',')}</td>
            </tr>
            <tr style="background:rgba(16,185,129,0.06);font-weight:800;">
                <td colspan="6" style="padding:12px;font-size:14px;color:var(--accent-emerald);">LUCRO LÍQUIDO CONSOLIDADO</td>
                <td style="padding:12px;font-size:14px;text-align:right;color:var(--accent-emerald);">R$ ${totalLucro.toFixed(2).replace('.', ',')}</td>
            </tr>
        `;

    } else if (tipo === "atendimentos") {
        tituloEl.textContent = "Planilha de Agendamentos e Atendimentos";
        descEl.textContent = "Lista detalhada de agendamentos (Timeline) ativos e efetuados.";

        headHtml = `
            <tr>
                <th style="padding:12px;text-align:left;border-bottom:2px solid rgba(255,255,255,0.1);">Data</th>
                <th style="padding:12px;text-align:left;border-bottom:2px solid rgba(255,255,255,0.1);">Horário</th>
                <th style="padding:12px;text-align:left;border-bottom:2px solid rgba(255,255,255,0.1);">Cliente</th>
                <th style="padding:12px;text-align:left;border-bottom:2px solid rgba(255,255,255,0.1);">Profissional</th>
                <th style="padding:12px;text-align:left;border-bottom:2px solid rgba(255,255,255,0.1);">Serviço</th>
                <th style="padding:12px;text-align:center;border-bottom:2px solid rgba(255,255,255,0.1);">Status</th>
                <th style="padding:12px;text-align:right;border-bottom:2px solid rgba(255,255,255,0.1);">Valor</th>
            </tr>
        `;

        bookings.forEach(b => {
            const dataFmt = b.date ? b.date.split("-").reverse().join("/") : "—";
            const servNome = b.servicos && b.servicos.length > 0 ? b.servicos[0].nome : b.serviceName || "Serviço";
            const price = parseFloat(b.price || b.total || 0);
            totalBruto += price;

            const statusLabel = b.status === "concluido" ? "Concluído" : "Agendado";
            const statusColor = b.status === "concluido" ? "var(--accent-emerald)" : "var(--accent-gold)";

            bodyHtml += `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.03);">
                    <td style="padding:10px 12px;font-size:13px;color:var(--text-muted);">${dataFmt}</td>
                    <td style="padding:10px 12px;font-size:13px;">${b.time || "—"}</td>
                    <td style="padding:10px 12px;font-size:13px;font-weight:600;">${b.clienteNome || "Avulso"}</td>
                    <td style="padding:10px 12px;font-size:13px;color:var(--text-secondary);">${b.barberName || "—"}</td>
                    <td style="padding:10px 12px;font-size:13px;">${servNome}</td>
                    <td style="padding:10px 12px;font-size:12px;text-align:center;font-weight:700;color:${statusColor};">${statusLabel}</td>
                    <td style="padding:10px 12px;font-size:13px;text-align:right;font-weight:700;">R$ ${price.toFixed(2).replace('.', ',')}</td>
                </tr>
            `;
        });

        bodyHtml += `
            <tr style="background:rgba(197,160,40,0.06);font-weight:700;border-top:2px solid rgba(255,255,255,0.1);">
                <td colspan="6" style="padding:12px;font-size:14px;color:var(--accent-gold);">VALOR TOTAL EM ATENDIMENTOS</td>
                <td style="padding:12px;font-size:14px;text-align:right;color:var(--accent-gold);">R$ ${totalBruto.toFixed(2).replace('.', ',')}</td>
            </tr>
        `;

    } else if (tipo === "comissoes") {
        tituloEl.textContent = "Planilha de Comissões e Repasses aos Barbeiros";
        descEl.textContent = "Auditoria de todas as taxas e valores repassados aos profissionais por serviço prestado.";

        headHtml = `
            <tr>
                <th style="padding:12px;text-align:left;border-bottom:2px solid rgba(255,255,255,0.1);">Data</th>
                <th style="padding:12px;text-align:left;border-bottom:2px solid rgba(255,255,255,0.1);">Profissional</th>
                <th style="padding:12px;text-align:left;border-bottom:2px solid rgba(255,255,255,0.1);">Cliente</th>
                <th style="padding:12px;text-align:left;border-bottom:2px solid rgba(255,255,255,0.1);">Item / Serviço</th>
                <th style="padding:12px;text-align:right;border-bottom:2px solid rgba(255,255,255,0.1);">Faturamento</th>
                <th style="padding:12px;text-align:center;border-bottom:2px solid rgba(255,255,255,0.1);">Taxa (%)</th>
                <th style="padding:12px;text-align:right;border-bottom:2px solid rgba(255,255,255,0.1);">Comissão Paga</th>
            </tr>
        `;

        let totalComissoesPagas = 0;

        sales.forEach(s => {
            const dataFmt = s.date ? s.date.split("-").reverse().join("/") : "—";
            const barber = barbers.find(b => b.id == s.barberId) || { name: "Avulso", commission: 50 };
            const commPct = barber.commission || 50;

            if (s.itens && s.itens.length > 0) {
                s.itens.forEach(item => {
                    const price = parseFloat(item.preco || 0);
                    const isServ = item.tipo === "servico";
                    const commPaid = isServ ? (price * (commPct / 100)) : 0;

                    if (commPaid > 0) {
                        totalBruto += price;
                        totalComissoesPagas += commPaid;

                        bodyHtml += `
                            <tr style="border-bottom:1px solid rgba(255,255,255,0.03);">
                                <td style="padding:10px 12px;font-size:13px;color:var(--text-muted);">${dataFmt}</td>
                                <td style="padding:10px 12px;font-size:13px;font-weight:600;">${barber.name}</td>
                                <td style="padding:10px 12px;font-size:13px;">${s.clienteNome || "Avulso"}</td>
                                <td style="padding:10px 12px;font-size:13px;">${item.nome}</td>
                                <td style="padding:10px 12px;font-size:13px;text-align:right;">R$ ${price.toFixed(2).replace('.', ',')}</td>
                                <td style="padding:10px 12px;font-size:13px;text-align:center;">${commPct}%</td>
                                <td style="padding:10px 12px;font-size:13px;text-align:right;font-weight:700;color:var(--accent-danger);">R$ ${commPaid.toFixed(2).replace('.', ',')}</td>
                            </tr>
                        `;
                    }
                });
            } else {
                const price = parseFloat(s.price || 0);
                const isServ = s.type === "service";
                const commPaid = isServ ? (price * (commPct / 100)) : 0;

                if (commPaid > 0) {
                    totalBruto += price;
                    totalComissoesPagas += commPaid;

                    bodyHtml += `
                        <tr style="border-bottom:1px solid rgba(255,255,255,0.03);">
                            <td style="padding:10px 12px;font-size:13px;color:var(--text-muted);">${dataFmt}</td>
                            <td style="padding:10px 12px;font-size:13px;font-weight:600;">${barber.name}</td>
                            <td style="padding:10px 12px;font-size:13px;">${s.client || "Avulso"}</td>
                            <td style="padding:10px 12px;font-size:13px;">${s.name}</td>
                            <td style="padding:10px 12px;font-size:13px;text-align:right;">R$ ${price.toFixed(2).replace('.', ',')}</td>
                            <td style="padding:10px 12px;font-size:13px;text-align:center;">${commPct}%</td>
                            <td style="padding:10px 12px;font-size:13px;text-align:right;font-weight:700;color:var(--accent-danger);">R$ ${commPaid.toFixed(2).replace('.', ',')}</td>
                        </tr>
                    `;
                }
            }
        });

        bodyHtml += `
            <tr style="background:rgba(239,68,68,0.06);font-weight:800;border-top:2px solid rgba(255,255,255,0.1);">
                <td colspan="6" style="padding:12px;font-size:14px;color:var(--accent-danger);">TOTAL DE COMISSÕES A REPASSAR</td>
                <td style="padding:12px;font-size:14px;text-align:right;color:var(--accent-danger);">R$ ${totalComissoesPagas.toFixed(2).replace('.', ',')}</td>
            </tr>
        `;
    }

    // Atualizar HTML e abrir modal
    headEl.innerHTML = headHtml;
    bodyEl.innerHTML = bodyHtml;
    modal.classList.add("active");
}

function fecharModalPlanilha() {
    const modal = document.getElementById("modalPlanilhaFaturamento");
    if (modal) modal.classList.remove("active");
}

// ==========================================================================
// SAAS PLATFORM - CONTROLLER FUNCTIONS
// ==========================================================================

function trocarAbaDesenvolvedor(abaId, btn) {
    const abas = document.querySelectorAll("#portalDesenvolvedor .tab-content");
    abas.forEach(aba => aba.classList.remove("active"));
    const target = document.getElementById(abaId);
    if (target) target.classList.add("active");

    const botoes = document.querySelectorAll("#portalDesenvolvedor .nav-item");
    botoes.forEach(b => b.classList.remove("active"));
    if (btn) btn.classList.add("active");

    if (abaId === "abaDevDashboard") {
        renderizarDevDashboard();
    } else if (abaId === "abaDevTenants") {
        renderizarDevTenants();
    } else if (abaId === "abaDevPlans") {
        renderizarDevPlans();
    }
}

function renderizarDevDashboard() {
    const tenants = JSON.parse(_origGetItem.call(localStorage, "tenants")) || [];
    const plans = JSON.parse(_origGetItem.call(localStorage, "plans")) || [];

    let totalTenants = tenants.length;
    let totalTrial = tenants.filter(t => t.status === "trial").length;
    let totalExpirados = tenants.filter(t => t.status === "expired").length;
    let faturamentoSaaS = 0;

    tenants.forEach(t => {
        if (t.status === "active") {
            const plan = plans.find(p => p.id === t.planId);
            if (plan) {
                faturamentoSaaS += parseFloat(plan.price);
            }
        }
    });

    const fatEl = document.getElementById("devFaturamentoSaaS");
    const totEl = document.getElementById("devTotalBarbearias");
    const triEl = document.getElementById("devTotalTrial");
    const expEl = document.getElementById("devTotalExpirados");

    if (fatEl) fatEl.textContent = "R$ " + faturamentoSaaS.toFixed(2).replace(".", ",");
    if (totEl) totEl.textContent = totalTenants;
    if (triEl) triEl.textContent = totalTrial;
    if (expEl) expEl.textContent = totalExpirados;
}

function renderizarDevTenants() {
    const tenants = JSON.parse(_origGetItem.call(localStorage, "tenants")) || [];
    const plans = JSON.parse(_origGetItem.call(localStorage, "plans")) || [];
    const tbody = document.getElementById("devTenantsTableBody");
    if (!tbody) return;

    if (tenants.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-muted);">Nenhuma barbearia cadastrada.</td></tr>`;
        return;
    }

    tbody.innerHTML = tenants.map(t => {
        const plan = plans.find(p => p.id === t.planId) || { name: "Sem Plano" };
        const expTime = t.status === "trial" ? t.trialExpires : t.planExpires;
        const expDate = expTime ? new Date(expTime).toLocaleDateString("pt-BR") : "—";
        
        let statusBadge = "";
        if (t.status === "active") {
            statusBadge = `<span style="background:rgba(16,185,129,0.1); color:var(--accent-emerald); padding:3px 8px; border-radius:12px; font-size:11px; font-weight:700;"><i class="fa-solid fa-check-circle"></i> Ativo</span>`;
        } else if (t.status === "trial") {
            statusBadge = `<span style="background:rgba(245,158,11,0.1); color:var(--accent-gold); padding:3px 8px; border-radius:12px; font-size:11px; font-weight:700;"><i class="fa-solid fa-flask"></i> Trial</span>`;
        } else {
            statusBadge = `<span style="background:rgba(239,68,68,0.1); color:var(--accent-danger); padding:3px 8px; border-radius:12px; font-size:11px; font-weight:700;"><i class="fa-solid fa-ban"></i> Expirado</span>`;
        }

        return `
            <tr style="border-bottom:1px solid rgba(255,255,255,0.03);">
                <td style="padding:12px; font-weight:600; color:var(--text-primary);">${t.name}</td>
                <td style="padding:12px; font-size:13px; color:var(--text-secondary);">${t.ownerEmail}</td>
                <td style="padding:12px; font-size:13px; color:var(--text-secondary);">${t.phone || "—"}</td>
                <td style="padding:12px; font-size:13px; color:var(--accent-gold); font-weight:500;">${plan.name}</td>
                <td style="padding:12px; font-size:13px;">${statusBadge}</td>
                <td style="padding:12px; font-size:13px; color:var(--text-muted);">${expDate}</td>
                <td style="padding:12px; text-align:right;">
                    <div style="display:flex; justify-content:flex-end; gap:6px;">
                        <button class="primary-btn" onclick="alterarStatusTenant('${t.id}', 'active', 30)" style="padding:4px 8px; font-size:11px; background:var(--accent-emerald);" title="Aprovar/Renovar Plano +30 dias"><i class="fa-solid fa-credit-card"></i> Renovar +30d</button>
                        <button class="secondary-btn" onclick="alterarStatusTenant('${t.id}', 'trial', 7)" style="padding:4px 8px; font-size:11px; border-color:var(--accent-gold); color:var(--accent-gold);" title="Liberar Teste Grátis +7 dias"><i class="fa-solid fa-flask"></i> Teste +7d</button>
                        <button class="icon-btn" onclick="excluirTenant('${t.id}')" style="color:var(--accent-danger); font-size:14px; padding:4px;" title="Remover Barbearia"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");
}

function alterarStatusTenant(tenantId, novoStatus, diasExtra) {
    const tenants = JSON.parse(_origGetItem.call(localStorage, "tenants")) || [];
    const idx = tenants.findIndex(t => t.id === tenantId);
    if (idx === -1) return;

    tenants[idx].status = novoStatus;
    const addMs = diasExtra * 24 * 60 * 60 * 1000;
    if (novoStatus === "trial") {
        tenants[idx].trialExpires = Date.now() + addMs;
    } else {
        const baseTime = tenants[idx].planExpires && tenants[idx].planExpires > Date.now() 
            ? tenants[idx].planExpires 
            : Date.now();
        tenants[idx].planExpires = baseTime + addMs;
    }

    _origSetItem.call(localStorage, "tenants", JSON.stringify(tenants));
    exibirToast("Inquilino Atualizado! ⚡", `Barbearia '${tenants[idx].name}' alterada para ${novoStatus} (+${diasExtra} dias).`, "success");
    renderizarDevTenants();
    renderizarDevDashboard();
}

function excluirTenant(tenantId) {
    if (tenantId === "t_default") {
        exibirToast("Ação Impedida ⚠️", "Não é permitido excluir o inquilino principal do sistema.", "info");
        return;
    }
    if (!confirm("⚠️ ATENÇÃO!\n\nVocê vai excluir todos os dados desta barbearia permanentemente do LocalStorage.\n\nDeseja continuar?")) {
        return;
    }

    const tenants = JSON.parse(_origGetItem.call(localStorage, "tenants")) || [];
    const filtered = tenants.filter(t => t.id !== tenantId);
    _origSetItem.call(localStorage, "tenants", JSON.stringify(filtered));

    // Remover todos os dados relacionados deste tenant no LocalStorage
    const multitenantKeys = ["customers", "barbers", "services", "products", "bookings", "sales", "notifications", "visualConfig"];
    multitenantKeys.forEach(key => {
        const val = _origGetItem.call(localStorage, key);
        if (val) {
            try {
                const data = JSON.parse(val);
                if (Array.isArray(data)) {
                    const cleanData = data.filter(item => item.tenantId !== tenantId);
                    _origSetItem.call(localStorage, key, JSON.stringify(cleanData));
                }
            } catch(e) {}
        }
    });

    exibirToast("Barbearia Removida", "Todos os registros do inquilino foram eliminados.", "success");
    renderizarDevTenants();
    renderizarDevDashboard();
}

function renderizarDevPlans() {
    const plans = JSON.parse(_origGetItem.call(localStorage, "plans")) || [];
    const tbody = document.getElementById("devPlansTableBody");
    if (!tbody) return;

    if (plans.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-muted);">Nenhum plano cadastrado.</td></tr>`;
        return;
    }

    tbody.innerHTML = plans.map(p => `
        <tr style="border-bottom:1px solid rgba(255,255,255,0.03);">
            <td style="padding:12px; font-weight:600; color:var(--text-primary);">${p.name}</td>
            <td style="padding:12px; font-size:13px; color:var(--accent-emerald); font-weight:700;">R$ ${parseFloat(p.price).toFixed(2).replace(".", ",")}</td>
            <td style="padding:12px; font-size:13px; color:var(--text-secondary);">${p.durationDays} dias</td>
            <td style="padding:12px; text-align:right;">
                <div style="display:flex; justify-content:flex-end; gap:6px;">
                    <button class="primary-btn" onclick="abrirModalPlanoForm('${p.id}')" style="padding:4px 8px; font-size:11px;"><i class="fa-solid fa-edit"></i> Editar</button>
                    <button class="icon-btn" onclick="excluirPlano('${p.id}')" style="color:var(--accent-danger); font-size:14px; padding:4px;" title="Remover Plano"><i class="fa-solid fa-trash-can"></i></button>
                </div>
            </td>
        </tr>
    `).join("");
}

function abrirModalPlanoForm(planoId) {
    const modal = document.getElementById("modalDevPlanoForm");
    const form = document.getElementById("devPlanoForm");
    const titulo = document.getElementById("modalDevPlanoTitulo");

    if (!modal || !form || !titulo) return;

    form.reset();
    document.getElementById("formPlanoId").value = "";

    if (planoId) {
        titulo.textContent = "Editar Plano SaaS";
        const plans = JSON.parse(_origGetItem.call(localStorage, "plans")) || [];
        const plan = plans.find(p => p.id === planoId);
        if (plan) {
            document.getElementById("formPlanoId").value = plan.id;
            document.getElementById("formPlanoNome").value = plan.name;
            document.getElementById("formPlanoPreco").value = plan.price;
            document.getElementById("formPlanoDuracao").value = plan.durationDays;
        }
    } else {
        titulo.textContent = "Adicionar Novo Plano";
        document.getElementById("formPlanoDuracao").value = "30";
    }

    modal.classList.add("active");
}

function fecharModalPlanoForm() {
    const modal = document.getElementById("modalDevPlanoForm");
    if (modal) modal.classList.remove("active");
}

function salvarPlanoForm(event) {
    event.preventDefault();
    const id = document.getElementById("formPlanoId").value;
    const nome = document.getElementById("formPlanoNome").value.trim();
    const preco = parseFloat(document.getElementById("formPlanoPreco").value);
    const duracao = parseInt(document.getElementById("formPlanoDuracao").value);

    const plans = JSON.parse(_origGetItem.call(localStorage, "plans")) || [];

    if (id) {
        const idx = plans.findIndex(p => p.id === id);
        if (idx !== -1) {
            plans[idx].name = nome;
            plans[idx].price = preco;
            plans[idx].durationDays = duracao;
        }
    } else {
        const novoId = "plan_" + Date.now();
        plans.push({ id: novoId, name: nome, price: preco, durationDays: duracao });
    }

    _origSetItem.call(localStorage, "plans", JSON.stringify(plans));
    fecharModalPlanoForm();
    renderizarDevPlans();
    exibirToast("Plano Gravado! 🏷️", `Plano '${nome}' salvo com sucesso.`, "success");
}

function excluirPlano(planoId) {
    if (planoId === "plan_bronze" || planoId === "plan_prata" || planoId === "plan_gold") {
        exibirToast("Ação Impedida ⚠️", "Planos base do sistema não podem ser excluídos.", "info");
        return;
    }
    if (!confirm("Deseja realmente remover este plano do sistema?")) return;

    const plans = JSON.parse(_origGetItem.call(localStorage, "plans")) || [];
    const filtered = plans.filter(p => p.id !== planoId);
    _origSetItem.call(localStorage, "plans", JSON.stringify(filtered));

    exibirToast("Plano Removido", "O plano foi excluído com sucesso.", "success");
    renderizarDevPlans();
}

function mostrarCadastroTenant() {
    document.getElementById("painelLogin").classList.remove("active");
    const painelTenant = document.getElementById("painelCadastroTenant");
    if (painelTenant) painelTenant.classList.add("active");
}

function registrarNovaBarbeariaForm(event) {
    event.preventDefault();
    const nome = document.getElementById("tenantNome").value.trim();
    const email = document.getElementById("tenantEmail").value.trim().toLowerCase();
    const senha = document.getElementById("tenantSenha").value;
    const telefone = document.getElementById("tenantTelefone").value.trim();

    const tenants = JSON.parse(_origGetItem.call(localStorage, "tenants")) || [];
    if (tenants.some(t => t.ownerEmail.toLowerCase() === email)) {
        exibirToast("E-mail já registrado", "Este endereço já é proprietário de uma barbearia cadastrada.", "info");
        return;
    }

    const tenantId = "t_" + Date.now();
    const novoTenant = {
        id: tenantId,
        name: nome,
        ownerEmail: email,
        ownerPassword: senha,
        phone: telefone,
        planId: "plan_gold",
        status: "trial",
        trialExpires: Date.now() + 7 * 24 * 60 * 60 * 1000,
        planExpires: Date.now() + 30 * 24 * 60 * 60 * 1000
    };

    tenants.push(novoTenant);
    _origSetItem.call(localStorage, "tenants", JSON.stringify(tenants));

    // Seeds do novo tenant com isolamento multitenant
    const sessionMock = { tenantId: tenantId };
    sessionStorage.setItem("currentSession", JSON.stringify(sessionMock));

    localStorage.setItem("customers", JSON.stringify([
        { id: "c1_" + tenantId, name: "Cliente VIP Teste", phone: "(11) 90000-0000", email: "cliente@barber.com", password: "1234", tenantId: tenantId }
    ]));

    localStorage.setItem("barbers", JSON.stringify([
        { id: "b1_" + tenantId, name: "Barbeiro Inicial", login: "barbeiro", password: "1234", avatar: "assets/barber_1.png", specialty: "Profissional Geral", rating: 5.0, commission: 50, active: true, tenantId: tenantId }
    ]));

    localStorage.setItem("services", JSON.stringify([
        { id: "s1_" + tenantId, name: "Corte Simples", price: 40.00, duration: 30, description: "Corte clássico padrão.", tenantId: tenantId }
    ]));

    localStorage.setItem("products", JSON.stringify([
        { id: "p1_" + tenantId, name: "Pomada Modeladora", price: 30.00, description: "Fixadora média.", tenantId: tenantId }
    ]));

    localStorage.setItem("bookings", JSON.stringify([]));
    localStorage.setItem("sales", JSON.stringify([]));
    localStorage.setItem("notifications", JSON.stringify([
        { id: "n1_" + tenantId, text: "Sua barbearia foi inicializada! Aproveite os 7 dias grátis.", time: "Agora", unread: true, tenantId: tenantId }
    ]));

    sessionStorage.removeItem("currentSession");

    currentUser = { role: "gerente", id: "admin", name: nome, tenantId: tenantId };
    sessionStorage.setItem("currentSession", JSON.stringify(currentUser));

    logarNaAplicacao(currentUser);
    exibirToast("Sucesso! 🚀", `Sua barbearia '${nome}' foi criada com 7 dias de Teste Grátis.`, "success");
}

// ==========================================================================
// GERADOR DE PIX VÁLIDO (BR CODE) COM CRC16
// ==========================================================================
function generatePixPayload(key, name, city, amount, reference) {
    function formatField(id, value) {
        return id + String(value.length).padStart(2, '0') + value;
    }
    let payload = "";
    payload += formatField("00", "01"); // Payload Format Indicator
    payload += formatField("01", "11"); // Point of Initiation (static)
    let gui = formatField("00", "br.gov.bcb.pix");
    let keyField = formatField("01", key);
    payload += formatField("26", gui + keyField);
    payload += formatField("52", "0000"); // Merchant Category
    payload += formatField("53", "986"); // Currency BRL
    if (amount) payload += formatField("54", amount); // Amount
    payload += formatField("58", "BR"); // Country
    payload += formatField("59", name.substring(0, 25)); // Merchant Name
    payload += formatField("60", city.substring(0, 15)); // Merchant City
    let ref = formatField("05", reference.substring(0, 25));
    payload += formatField("62", ref);
    payload += "6304";
    let crc = 0xFFFF;
    for (let i = 0; i < payload.length; i++) {
        crc ^= payload.charCodeAt(i) << 8;
        for (let j = 0; j < 8; j++) {
            if ((crc & 0x8000) !== 0) {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc = crc << 1;
            }
        }
        crc &= 0xFFFF;
    }
    return payload + crc.toString(16).toUpperCase().padStart(4, '0');
}

function popularCheckoutPlans() {
    const plans = JSON.parse(_origGetItem.call(localStorage, "plans")) || [];
    const select = document.getElementById("checkoutPlanSelect");
    if (!select) return;

    select.innerHTML = plans.map(p => `
        <option value="${p.id}" data-price="${p.price}">${p.name} — R$ ${p.price.toFixed(2).replace(".", ",")}</option>
    `).join("");
}

function atualizarPrecoCheckout() {
    const select = document.getElementById("checkoutPlanSelect");
    const priceEl = document.getElementById("checkoutPlanPrice");
    if (!select || !priceEl) return;

    const option = select.options[select.selectedIndex];
    if (option) {
        const price = parseFloat(option.getAttribute("data-price"));
        priceEl.textContent = "R$ " + price.toFixed(2).replace(".", ",");
        
        // Gerar PIX Dinâmico e Válido para escanear
        const amountStr = price.toFixed(2);
        
        // Tratar a chave PIX enviada (se for telefone sem +55, adiciona, pois a norma do BC exige)
        let chavePix = "47988392282";
        if (chavePix.length === 11 && chavePix.startsWith("479")) {
            chavePix = "+55" + chavePix; // Para chave de telefone
        }
        
        const validPix = generatePixPayload(chavePix, "Mauri Koop Junior", "Sao Paulo", amountStr, "SaaS");
        
        // Atualizar QR Code Imagem
        const qrImg = document.getElementById("pixQrCodeImg");
        if (qrImg) {
            qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(validPix)}`;
        }
        
        // Atualizar Input Oculto para Cópia
        const inputCopia = document.getElementById("pixCopiaColaInput");
        if (inputCopia) {
            inputCopia.value = validPix;
        }
    }
}

function copiarPixCheckout() {
    const input = document.getElementById("pixCopiaColaInput");
    if (input) {
        input.select();
        input.setSelectionRange(0, 99999);
        try {
            navigator.clipboard.writeText(input.value);
            exibirToast("PIX Copiado! ⚡", "Código Copia e Cola copiado para a área de transferência.", "success");
        } catch(err) {
            document.execCommand("copy");
            exibirToast("PIX Copiado! ⚡", "Código Copia e Cola copiado.", "success");
        }
    }
}

function abrirPagamentoSaaS() {
    const lockOverlay = document.getElementById("saasLockOverlay");
    if (lockOverlay) {
        lockOverlay.style.display = "flex";
        popularCheckoutPlans();
        atualizarPrecoCheckout();
    }
}

function fecharPagamentoSaaS() {
    const lockOverlay = document.getElementById("saasLockOverlay");
    if (lockOverlay) {
        lockOverlay.style.display = "none";
    }
}

function simularPagamentoAssinatura() {
    if (!currentUser || currentUser.role !== "gerente") return;

    const select = document.getElementById("checkoutPlanSelect");
    if (!select) return;

    const plans = JSON.parse(_origGetItem.call(localStorage, "plans")) || [];
    const planId = select.value;
    const plan = plans.find(p => p.id === planId) || { durationDays: 30 };

    const tenants = JSON.parse(_origGetItem.call(localStorage, "tenants")) || [];
    const idx = tenants.findIndex(t => t.id === currentUser.tenantId);

    if (idx !== -1) {
        tenants[idx].status = "active";
        tenants[idx].planId = planId;
        
        const baseTime = Date.now();
        tenants[idx].planExpires = baseTime + (plan.durationDays * 24 * 60 * 60 * 1000);

        _origSetItem.call(localStorage, "tenants", JSON.stringify(tenants));

        exibirToast("Pagamento Confirmado! 🎉", "Sua assinatura foi renovada e o acesso foi liberado.", "success");

        setTimeout(() => {
            logarNaAplicacao(currentUser);
        }, 1500);
    }
}

// ==========================================================================
// MANAGER COLLABORATOR PHOTO UPLOAD AND DELETE HANDLERS
// ==========================================================================

function uploadFotoBarbeiroGerente(input) {
    const file = input.files[0];
    if (!file) return;

    if (file.size > 1024 * 1024) {
        exibirToast("Arquivo muito grande ⚠️", "A foto do colaborador deve ter no máximo 1MB.", "info");
        input.value = "";
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        const base64Src = e.target.result;
        const imgPreview = document.getElementById("configBarbeiroFotoPreview");
        const iconPreview = document.getElementById("configBarbeiroFotoIcon");
        if (imgPreview) {
            imgPreview.src = base64Src;
            imgPreview.style.display = "block";
        }
        if (iconPreview) iconPreview.style.display = "none";
        exibirToast("Pré-visualização 📸", "Foto carregada. Clique em 'Salvar' para aplicar.", "success");
    };
    reader.readAsDataURL(file);
}

function removerFotoBarbeiroGerente() {
    if (!confirm("Deseja realmente remover a foto deste colaborador?")) return;
    const imgPreview = document.getElementById("configBarbeiroFotoPreview");
    const iconPreview = document.getElementById("configBarbeiroFotoIcon");
    const fileInput = document.getElementById("gerenteUploadBarbeiroFoto");
    if (imgPreview) {
        imgPreview.src = "";
        imgPreview.style.display = "none";
    }
    if (iconPreview) iconPreview.style.display = "flex";
    if (fileInput) fileInput.value = "";
    exibirToast("Foto Removida 📸", "Clique em 'Salvar' para gravar a remoção.", "info");
}

function abrirModalPlanilha() {
    const modal = document.getElementById("modalPlanilhaFaturamento");
    if (modal) modal.classList.remove("active");
}


}
}


function fecharModalPlanilha() {
    const modal = document.getElementById("modalPlanilhaFaturamento");
    if (modal) modal.classList.remove("active");
}

function copiarPixCheckout() {
    const input = document.getElementById("pixCopiaColaInput");
    if (input) {
        input.select();
        input.setSelectionRange(0, 99999);
        try {
            navigator.clipboard.writeText(input.value);
            exibirToast("PIX Copiado! ??", "C�digo Copia e Cola copiado para a �rea de transfer�ncia.", "success");
        } catch(err) {
            document.execCommand("copy");
            exibirToast("PIX Copiado! ??", "C�digo Copia e Cola copiado.", "success");
        }
    }
}

function fecharPagamentoSaaS() {
    const overlay = document.getElementById("saasLockOverlay");
    if (overlay) overlay.style.display = "none";
}

function abrirPagamentoSaaS() {
    const overlay = document.getElementById("saasLockOverlay");
    if (overlay) overlay.style.display = "flex";
}

function fecharModalPlanoForm() {
    const modal = document.getElementById("modalPlanoForm");
    if (modal) modal.classList.remove("active");
}

function simularPagamentoAssinatura() {
    exibirToast("Pagamento Confirmado!", "Obrigado por assinar o plano! Seu acesso foi liberado.", "success");
    fecharPagamentoSaaS();
}
