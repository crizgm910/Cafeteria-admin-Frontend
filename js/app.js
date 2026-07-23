const APP_CONFIG = window.TGR_CONFIG || {};
const API_BASE = String(APP_CONFIG.apiBaseUrl || '').replace(/\/$/, '');
const PUBLIC_ASSET_BASE = String(APP_CONFIG.publicAssetBaseUrl || '').replace(/\/$/, '') + '/';
if (!API_BASE) throw new Error('Falta configurar apiBaseUrl en js/config.js');
// El token solo vive durante la pestaña. Evita que una sesión administrativa
// quede persistida indefinidamente en localStorage.
localStorage.removeItem('tgr_auth_token');
let authToken = sessionStorage.getItem('tgr_auth_token') || null;
let currentPermissions = new Set();

// GLOBALS
let allTickets = [];
let allReservations = [];
let serviceAreas = [];
let diningTables = [];
let reservationSchedules = [];
let reservationBlocks = [];
let currentFilter = 'all';
let searchQuery = '';
let isFetching = false;
let autoRefreshInterval;
let lastUpdateDate = new Date();

let resDateFilter = 'all';
let resStateFilter = 'all';

// DOM Elements
const eTime = document.getElementById('current-time');
const eLastUpdated = document.getElementById('last-updated');
const eConnStatus = document.getElementById('connection-status');
const btnManualRefresh = document.getElementById('btn-manual-refresh');
const toastContainer = document.getElementById('toast-container');
const activityLog = document.getElementById('activity-log');

// Login Elements
const loginView = document.getElementById('loginView');
const dashboardView = document.getElementById('dashboardView');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const currentUserName = document.getElementById('current-user-name');
const btnLogout = document.getElementById('btn-logout');

function showAuthenticatedView(isAuthenticated) {
    loginView.classList.toggle('hidden', isAuthenticated);
    loginView.classList.toggle('active', !isAuthenticated);
    dashboardView.classList.toggle('hidden', !isAuthenticated);
    dashboardView.classList.toggle('active', isAuthenticated);
}

function clearAuthenticatedSession() {
    authToken = null;
    currentPermissions = new Set();
    sessionStorage.removeItem('tgr_auth_token');
    allTickets = [];
    allReservations = [];
    // No conservar credenciales en el DOM después de cerrar o expirar sesión.
    // Es especialmente importante en equipos compartidos de caja y cocina.
    loginForm.reset();
    document.getElementById('login-email').value = '';
    document.getElementById('login-password').value = '';
    showAuthenticatedView(false);
}

async function readErrorMessage(response) {
    try {
        const data = await response.json();
        if (data.message) return data.message;
        if (data.error) return data.error;
        if (data.errors) return Object.values(data.errors).flat().join(' ');
    } catch (_) {
        // La API debería responder JSON; conservamos un mensaje seguro si no lo hace.
    }
    return `Error HTTP ${response.status}`;
}

function renderCurrentUser(user) {
    currentUserName.textContent = user?.name || user?.email || 'Personal';
    currentPermissions = new Set(Array.isArray(user?.permissions) ? user.permissions : []);
    applyPermissionVisibility();
}

function hasPermission(permission) {
    return currentPermissions.has(permission);
}

function applyPermissionVisibility() {
    const visibility = {
        'tab-orders': ['tickets.view'],
        'tab-pos': ['pos.operate'],
        'tab-products': ['catalog.manage', 'inventory.view'],
        'tab-reports': ['reports.view', 'audit.view'],
        'tab-users': ['users.manage'],
        'tab-reservations': ['reservations.manage'],
    };

    Object.entries(visibility).forEach(([id, permissions]) => {
        const element = document.getElementById(id);
        if (element) element.hidden = !permissions.some(hasPermission);
    });

    const activeButton = document.querySelector('.admin-nav-main .nav-btn.active');
    if (activeButton?.hidden) {
        document.querySelector('.admin-nav-main .nav-btn:not([hidden])')?.click();
    }
}

function loadAuthorizedDashboardData() {
    if (hasPermission('tickets.view')) fetchOrders(true);
}

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.style.display = 'none';
    const btn = loginForm.querySelector('button');
    btn.textContent = 'Autenticando...';
    
    try {
        const res = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({
                email: document.getElementById('login-email').value,
                password: document.getElementById('login-password').value
            })
        });
        if (!res.ok) throw new Error(await readErrorMessage(res));
        const data = await res.json();
        
        authToken = data.token;
        sessionStorage.setItem('tgr_auth_token', authToken);
        renderCurrentUser(data.user);
        showAuthenticatedView(true);
        loadAuthorizedDashboardData();
    } catch (err) {
        loginError.textContent = err.message;
        loginError.style.display = 'block';
    } finally {
        btn.textContent = 'Ingresar al Sistema';
    }
});

// Helper for authorized fetch
async function authFetch(url, options = {}) {
    if (!options.headers) options.headers = {};
    options.headers['Accept'] = 'application/json';
    if (authToken) options.headers['Authorization'] = `Bearer ${authToken}`;
    
    const res = await fetch(url, options);
    if ([401, 419].includes(res.status)) {
        clearAuthenticatedSession();
        throw new Error('La sesión expiró. Inicia sesión nuevamente.');
    }
    if (res.status === 403) throw new Error('No tienes permiso para realizar esta acción.');
    if (!res.ok) throw new Error(await readErrorMessage(res));
    return res;
}

async function initializeSession() {
    if (!authToken) {
        showAuthenticatedView(false);
        return;
    }

    try {
        const response = await authFetch(`${API_BASE}/user`);
        renderCurrentUser(await response.json());
        showAuthenticatedView(true);
        loadAuthorizedDashboardData();
    } catch (error) {
        clearAuthenticatedSession();
        loginError.textContent = error.message;
        loginError.style.display = 'block';
    }
}

btnLogout.addEventListener('click', async () => {
    btnLogout.disabled = true;
    try {
        await authFetch(`${API_BASE}/logout`, { method: 'POST' });
    } catch (error) {
        if (authToken) showToast(error.message, 'error');
    } finally {
        clearAuthenticatedSession();
        btnLogout.disabled = false;
    }
});

// Views & Toggles
const btnDensity = document.getElementById('btn-density');
const btnKitchenMode = document.getElementById('btn-kitchen-mode');
const btnCompleted = document.getElementById('btn-completed');
const completedModal = document.getElementById('completed-modal');

// Load preferences
if (localStorage.getItem('tgr_ui_density') === 'compact') {
    document.body.classList.remove('comfort-view');
    document.body.classList.add('compact-view');
}
if (localStorage.getItem('tgr_ui_kitchen') === 'true') {
    document.body.classList.add('kitchen-mode');
}

btnDensity.onclick = () => {
    if (document.body.classList.contains('compact-view')) {
        document.body.classList.remove('compact-view');
        document.body.classList.add('comfort-view');
        localStorage.setItem('tgr_ui_density', 'comfort');
    } else {
        document.body.classList.remove('comfort-view');
        document.body.classList.add('compact-view');
        localStorage.setItem('tgr_ui_density', 'compact');
    }
};

btnKitchenMode.onclick = () => {
    document.body.classList.toggle('kitchen-mode');
    localStorage.setItem('tgr_ui_kitchen', document.body.classList.contains('kitchen-mode'));
};

btnCompleted.onclick = () => {
    renderCompletedModal();
    completedModal.classList.add('active');
};
document.getElementById('close-completed-modal').onclick = () => completedModal.classList.remove('active');
document.getElementById('close-detail-modal').onclick = () => document.getElementById('order-detail-modal').classList.remove('active');
document.getElementById('close-kitchen-modal').onclick = () => document.getElementById('kitchen-ticket-modal').classList.remove('active');
document.getElementById('btn-print-ticket').addEventListener('click', () => window.print());
document.getElementById('btn-scroll-top').addEventListener('click', () => {
    document.querySelector('.admin-view.active-view')?.scrollTo({ top: 0, behavior: 'smooth' });
});

function logActivity(msg, icon = '🔔') {
    const div = document.createElement('div');
    div.className = 'log-item';
    const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = `[${time}]`;
    const iconSpan = document.createElement('span');
    iconSpan.textContent = icon;
    div.append(timeSpan, iconSpan, document.createTextNode(` ${msg}`));
    activityLog.prepend(div);
    if(activityLog.children.length > 30) activityLog.lastChild.remove();
}

/* ==========================================
   UTILITIES
========================================== */
const safeNum = val => isNaN(parseFloat(val)) ? 0 : parseFloat(val);
const escapeHTML = (value) => String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
const safeStr = (val, fallback = '') => escapeHTML(
    (val === null || val === undefined || val === '') ? fallback : val
);
const formatMoney = val => `$${safeNum(val).toFixed(2)}`;

function resolveImageUrl(imageUrl) {
    if (!imageUrl) return '';
    try {
        const url = new URL(imageUrl, PUBLIC_ASSET_BASE);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch (_) {
        return '';
    }
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️';
    const iconSpan = document.createElement('span');
    const messageSpan = document.createElement('span');
    iconSpan.textContent = icon;
    messageSpan.textContent = message;
    toast.append(iconSpan, messageSpan);
    toastContainer.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
}

// Un único listener para las acciones creadas dinámicamente. Evita construir
// JavaScript ejecutable dentro de cadenas HTML con datos recibidos de la API.
document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;

    const { action, id, status, closeModal } = button.dataset;
    if (action === 'order-detail') window.openOrderDetail(id);
    if (action === 'kitchen-ticket') window.openKitchenTicket(id);
    if (action === 'receipt-ticket') window.openReceiptTicket(id);
    if (action === 'order-status') window.updateOrderStatus(id, status, closeModal === 'true');
    if (action === 'reservation-status') window.updateResStatus(id, status);
    if (action === 'reservation-assign') window.assignReservationTable(id);
    if (action === 'edit-service-area') window.editServiceArea(Number(id));
    if (action === 'delete-service-area') window.deleteServiceArea(Number(id));
    if (action === 'edit-dining-table') window.editDiningTable(Number(id));
    if (action === 'delete-dining-table') window.deleteDiningTable(Number(id));
    if (action === 'edit-reservation-schedule') window.editReservationSchedule(Number(id));
    if (action === 'delete-reservation-schedule') window.deleteReservationSchedule(Number(id));
    if (action === 'edit-reservation-block') window.editReservationBlock(Number(id));
    if (action === 'delete-reservation-block') window.deleteReservationBlock(Number(id));
    if (action === 'edit-category') window.editCategory(Number(id));
    if (action === 'delete-category') window.deleteCategory(Number(id));
    if (action === 'edit-product') window.editProduct(Number(id));
    if (action === 'configure-product') window.openProductConfiguration(Number(id));
    if (action === 'inventory-transaction') window.openTransactionModal(Number(id));
    if (action === 'edit-ingredient') window.editIngredient(Number(id));
    if (action === 'pos-add-product') window.addPosProduct(Number(id));
    if (action === 'pos-remove-product') window.removePosProduct(Number(id));
    if (action === 'edit-user') window.editUser(Number(id));
    if (action === 'collect-payment') window.collectTicketPayment(id);
});

setInterval(() => {
    const now = new Date();
    eTime.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (lastUpdateDate) {
        const diffSecs = Math.floor((now - lastUpdateDate) / 1000);
        eLastUpdated.textContent = `Actualizado: hace ${diffSecs}s`;
    }
}, 1000);

function setConnectionStatus(isOnline) {
    if (isOnline && eConnStatus.innerHTML.includes('Desconectada')) {
        eConnStatus.innerHTML = '<span class="dot green"></span> Conectado';
        logActivity('Conexión con API restablecida', '🟢');
    } else if (!isOnline && eConnStatus.innerHTML.includes('Conectado')) {
        eConnStatus.innerHTML = '<span class="dot red"></span> API Desconectada';
        logActivity('Se perdió conexión con servidor', '🔴');
    }
}

/* ==========================================
   ORDERS LOGIC (KDS)
========================================== */
btnManualRefresh.onclick = () => {
    btnManualRefresh.classList.add('spin');
    fetchOrders(true).then(() => {
        setTimeout(() => btnManualRefresh.classList.remove('spin'), 500);
    });
};

document.getElementById('search-orders').addEventListener('input', (e) => { searchQuery = e.target.value.toLowerCase(); renderOrders(); });
document.querySelectorAll('.filter-btn[data-filter]').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-btn[data-filter]').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentFilter = e.target.dataset.filter;
        renderOrders();
    });
});

async function fetchOrders(showLoading = false) {
    if (isFetching) return;
    isFetching = true;

    try {
        const response = await authFetch(`${API_BASE}/tickets`);
        const newData = await response.json();
        
        if (allTickets.length > 0) {
            const newIds = newData.map(t => t.id);
            const oldIds = allTickets.map(t => t.id);
            const freshlyAdded = newIds.filter(id => !oldIds.includes(id));
            if (freshlyAdded.length > 0) {
                showToast(`${freshlyAdded.length} nuevo(s) pedido(s) recibido(s)`, 'success');
                logActivity(`${freshlyAdded.length} nuevo(s) pedido(s) en bandeja`, '🔔');
            }
        }

        allTickets = newData;
        setConnectionStatus(true);
        lastUpdateDate = new Date();
        renderOrders();
        renderKPIs();
    } catch (error) {
        setConnectionStatus(false);
        console.error('No fue posible actualizar pedidos:', error);
    } finally {
        isFetching = false;
    }
}

function renderOrders() {
    let counts = { pending: 0, preparing: 0, ready: 0 };
    
    let filtered = allTickets.filter(t => {
        const matchText = (t.ticket_number && String(t.ticket_number).toLowerCase().includes(searchQuery)) ||
                          (t.id && String(t.id).includes(searchQuery));
        let matchFilter = true;
        if (currentFilter === 'takeout') matchFilter = t.order_type === 'takeout';
        if (currentFilter === 'dine_in') matchFilter = t.order_type === 'dine_in';
        if (currentFilter === 'delivery') matchFilter = t.order_type === 'delivery';
        if (currentFilter === 'overdue') {
            const isOverdue = (new Date() - new Date(t.created_at)) > (15 * 60000);
            matchFilter = isOverdue && !['delivered','cancelled'].includes(t.status);
        }
        return matchText && matchFilter;
    });

    let htmlPending = '', htmlPreparing = '', htmlReady = '';

    filtered.forEach(ticket => {
        const cardHtml = getTicketCardHTML(ticket);
        if (['pending', 'paid'].includes(ticket.status)) { htmlPending += cardHtml; counts.pending++; }
        else if (ticket.status === 'preparing') { htmlPreparing += cardHtml; counts.preparing++; }
        else if (ticket.status === 'ready') { htmlReady += cardHtml; counts.ready++; }
    });

    document.getElementById('col-pending').innerHTML = counts.pending > 0 ? htmlPending : '<div class="empty-state"><div class="empty-icon">📝</div>Sin pedidos nuevos</div>';
    document.getElementById('col-preparing').innerHTML = counts.preparing > 0 ? htmlPreparing : '<div class="empty-state"><div class="empty-icon">🍳</div>Cocina despejada</div>';
    document.getElementById('col-ready').innerHTML = counts.ready > 0 ? htmlReady : '<div class="empty-state"><div class="empty-icon">🛍️</div>Sin entregas pendientes</div>';

    document.getElementById('badge-pending').textContent = counts.pending;
    document.getElementById('badge-preparing').textContent = counts.preparing;
    document.getElementById('badge-ready').textContent = counts.ready;
    document.getElementById('mob-badge-pending').textContent = counts.pending;
    document.getElementById('mob-badge-preparing').textContent = counts.preparing;
    document.getElementById('mob-badge-ready').textContent = counts.ready;
}

function getTicketCardHTML(ticket) {
    const tNum = safeStr(ticket.ticket_number, ticket.id);
    const time = new Date(ticket.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const diffMins = Math.floor((new Date() - new Date(ticket.created_at)) / 60000);
    const isOverdue = diffMins >= 15;
    const timeText = diffMins < 1 ? 'Ahora' : `Hace ${diffMins} min`;

    let sName = 'Local'; let sCol = '#22c55e';
    if(ticket.order_type === 'takeout') { sName = 'Llevar'; sCol = '#3b82f6'; }
    else if(ticket.order_type === 'delivery') { sName = 'Envío'; sCol = '#f59e0b'; }

    let hasNotes = ticket.items && ticket.items.some(i => i.notes && i.notes.trim() !== '');

    let btnPrimary = '';
    const pendingPayment = ticket.payments?.some(payment => payment.status === 'pending');
    if (pendingPayment && hasPermission('pos.operate') && hasPermission('cash.manage')) {
        btnPrimary = `<button class="btn-fill" data-action="collect-payment" data-id="${safeStr(ticket.id)}">Cobrar</button>`;
    } else if (['pending', 'paid'].includes(ticket.status) && hasPermission('tickets.update')) {
        btnPrimary = `<button class="btn-fill" data-action="order-status" data-id="${safeStr(ticket.id)}" data-status="preparing">Cocinar</button>`;
    } else if (ticket.status === 'preparing' && hasPermission('tickets.update')) {
        btnPrimary = `<button class="btn-fill" data-action="order-status" data-id="${safeStr(ticket.id)}" data-status="ready">Terminado</button>`;
    } else if (ticket.status === 'ready' && hasPermission('tickets.update')) {
        btnPrimary = `<button class="btn-fill" data-action="order-status" data-id="${safeStr(ticket.id)}" data-status="delivered">Entregar</button>`;
    }

    return `
        <div class="ticket-card ${isOverdue ? 'is-overdue' : ''}">
            <div class="tc-head">
                <div><span class="badge-service" style="background:${sCol}">${sName}</span> <span class="tc-id">#${tNum}</span></div>
                <div class="tc-time ${isOverdue ? 'overdue' : ''}">${time}<br>${timeText}</div>
            </div>
            <div class="tc-tags">${hasNotes ? `<span class="tag tag-notes">NOTAS</span>` : ''}</div>
            <div class="tc-body">${ticket.items ? ticket.items.length : 0} arts • ${formatMoney(ticket.total)}</div>
            <div class="tc-foot">
                <button class="btn-outline" data-action="order-detail" data-id="${safeStr(ticket.id)}">👁️ Detalle</button>
                ${btnPrimary}
            </div>
        </div>
    `;
}

async function renderKPIs() {
    let completed = 0, pending = 0, cancelled = 0;
    allTickets.forEach(t => {
        if (t.status === 'delivered') completed++;
        else if (t.status === 'cancelled') { cancelled++; }
        else { pending++; }
    });

    document.querySelectorAll('.kpi-value').forEach(el => el.classList.remove('skeleton-text'));
    document.getElementById('kpi-sales').textContent = '—';
    document.getElementById('kpi-completed').textContent = completed;
    document.getElementById('kpi-pending').textContent = pending;
    document.getElementById('kpi-cancelled').textContent = cancelled;
    document.getElementById('kpi-average').textContent = '—';

    if (!hasPermission('reports.view')) return;
    try {
        const response = await authFetch(`${API_BASE}/reports/daily`);
        const report = await response.json();
        document.getElementById('kpi-sales').textContent = formatMoney(report.payments.net_collected);
        document.getElementById('kpi-average').textContent = formatMoney(
            report.payments.captured_transactions > 0 ? report.payments.gross_collected / report.payments.captured_transactions : 0
        );
    } catch (_) {
        // Los conteos operativos permanecen disponibles; no se inventan cifras financieras.
    }
}

function renderCompletedModal() {
    const list = document.getElementById('completed-list');
    const completed = allTickets.filter(t => t.status === 'delivered');
    if (completed.length === 0) {
        list.innerHTML = '<div class="empty-state">No hay pedidos completados hoy.</div>';
        return;
    }
    list.innerHTML = completed.map(t => getTicketCardHTML(t)).join('');
}

window.openOrderDetail = (id) => {
    const ticket = allTickets.find(t => t.id == id || t.ticket_number == id);
    if (!ticket) return;

    document.getElementById('modal-ticket-id').textContent = `#${safeStr(ticket.ticket_number, ticket.id)}`;
    
    let itemsHtml = '';
    if (ticket.items) {
        ticket.items.forEach(item => {
            const pName = item.product ? safeStr(item.product.name, 'Desc.') : 'Desc.';
            const notes = safeStr(item.notes, '');
            itemsHtml += `<div class="detail-product"><div class="detail-product-info"><div class="detail-product-name">${item.quantity}x ${pName}</div>${notes ? `<div class="detail-product-meta">📝 ${notes}</div>` : ''}</div><div>${formatMoney(item.subtotal)}</div></div>`;
        });
    }

    document.getElementById('modal-detail-body').innerHTML = `
        <div class="detail-grid">
            <div class="detail-item"><span class="detail-label">Hora Pedido</span><span class="detail-value">${new Date(ticket.created_at).toLocaleString()}</span></div>
            <div class="detail-item"><span class="detail-label">Total</span><span class="detail-value" style="color:var(--color-gold); font-size:1.2rem">${formatMoney(ticket.total)}</span></div>
        </div>
        <div class="detail-products-list">${itemsHtml || 'Sin artículos'}</div>
    `;

    const safeTicketId = safeStr(ticket.id);
    let actionsHtml = `<div style="display:flex; gap:10px; margin-right:auto;"><button class="btn-outline" data-action="kitchen-ticket" data-id="${safeTicketId}">🖨️ Ticket Cocina</button><button class="btn-outline" data-action="receipt-ticket" data-id="${safeTicketId}">🧾 Ticket Compra</button></div>`;
    if (!['cancelled', 'delivered'].includes(ticket.status) && hasPermission('tickets.cancel')) actionsHtml += `<button class="btn-danger-outline" data-action="order-status" data-id="${safeTicketId}" data-status="cancelled" data-close-modal="true">❌ Cancelar</button>`;
    if (ticket.status === 'preparing' && hasPermission('tickets.update')) actionsHtml += `<button class="btn-outline" data-action="order-status" data-id="${safeTicketId}" data-status="pending" data-close-modal="true">↩️ Revertir a Pendiente</button> <button class="btn-primary" data-action="order-status" data-id="${safeTicketId}" data-status="ready" data-close-modal="true">✅ Marcar Listo</button>`;
    if (ticket.status === 'ready' && hasPermission('tickets.update')) actionsHtml += `<button class="btn-outline" data-action="order-status" data-id="${safeTicketId}" data-status="preparing" data-close-modal="true">↩️ Revertir a Prep.</button> <button class="btn-primary" data-action="order-status" data-id="${safeTicketId}" data-status="delivered" data-close-modal="true">🛍️ Entregar</button>`;
    
    document.getElementById('modal-detail-actions').innerHTML = actionsHtml;
    document.getElementById('order-detail-modal').classList.add('active');
};

window.openKitchenTicket = (id) => {
    const ticket = allTickets.find(t => t.id == id || t.ticket_number == id);
    if (!ticket) return;
    let html = `<div class="print-header"><h1>TGR KITCHEN</h1><p style="font-size:1.3rem; font-weight:bold;">PEDIDO #${safeStr(ticket.ticket_number, ticket.id)}</p></div>`;
    if (ticket.items) ticket.items.forEach(i => {
        const pName = i.product ? safeStr(i.product.name, '') : '';
        const notes = safeStr(i.notes, '');
        html += `<div class="print-item"><strong style="font-size:1.4rem;">${i.quantity} x ${pName}</strong>${notes ? `<br><span class="print-note">NOTA: ${notes}</span>` : ''}</div>`;
    });
    document.getElementById('kitchen-ticket-body').innerHTML = html;
    document.getElementById('kitchen-ticket-modal').classList.add('active');
};

window.openReceiptTicket = (id) => {
    const ticket = allTickets.find(t => t.id == id || t.ticket_number == id);
    if (!ticket) return;
    
    const d = new Date(ticket.created_at);
    const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    let paymentMethodStr = 'Desconocido';
    if (ticket.payments && ticket.payments.length > 0) {
        const provider = ticket.payments[0].gateway_provider;
        paymentMethodStr = provider === 'cash' ? 'Efectivo'
            : provider === 'card_terminal' ? 'Terminal externa'
            : provider === 'pay_at_pickup' ? 'Pendiente al recoger' : 'Otro';
    }
    const customerName = ticket.customer_name ? `<p style="margin:2px 0;"><strong>Cliente:</strong> ${safeStr(ticket.customer_name)}</p>` : '';
    const orderType = ticket.order_type === 'takeout' ? 'Para llevar' : (ticket.order_type === 'dine_in' ? 'Comer aquí' : 'Local');
    
    let html = `
        <div class="print-header">
            <h1 style="margin-bottom:5px;">TGR RECEIPT</h1>
            <p style="margin:0;">COMPROBANTE NO FISCAL</p>
            <p style="font-size:1.3rem; font-weight:bold; margin-bottom:0;">PEDIDO #${safeStr(ticket.ticket_number, ticket.id)}</p>
        </div>
        <div style="font-size:1.1rem; margin-bottom:15px; border-bottom:1px dashed #000; padding-bottom:10px;">
            <p style="margin:2px 0;"><strong>Fecha:</strong> ${dateStr}</p>
            ${customerName}
            <p style="margin:2px 0;"><strong>Tipo:</strong> ${orderType}</p>
            <p style="margin:2px 0;"><strong>Pago:</strong> ${paymentMethodStr}</p>
        </div>
    `;
    
    if (ticket.items) {
        ticket.items.forEach(i => {
            const pName = i.product ? safeStr(i.product.name, '') : '';
            html += `<div class="print-item" style="display:flex; justify-content:space-between; margin-bottom:0;"><strong style="font-size:1.2rem;">${i.quantity} x ${pName}</strong><strong style="font-size:1.2rem;">${formatMoney(i.subtotal)}</strong></div>`;
            
            if (i.add_ons && i.add_ons.length > 0) {
                i.add_ons.forEach(addon => {
                     html += `<div style="display:flex; justify-content:space-between; font-size:1rem; padding-left:15px; color:#555;"><span>+ ${safeStr(addon.name)}</span></div>`;
                });
            }
            if (i.notes) {
                html += `<div style="font-size:1rem; padding-left:15px; font-style:italic;">Nota: ${safeStr(i.notes)}</div>`;
            }
            html += `<div style="margin-bottom:10px;"></div>`;
        });
    }
    
    const subtotal = safeNum(ticket.subtotal);
    const iva = safeNum(ticket.tax);
    
    html += `
        <div style="border-top:1px dashed #000; margin-top:10px; padding-top:10px;">
            <div style="display:flex; justify-content:space-between; font-size:1.1rem;"><span>Subtotal</span><span>${formatMoney(subtotal)}</span></div>
            <div style="display:flex; justify-content:space-between; font-size:1.1rem;"><span>Impuestos</span><span>${formatMoney(iva)}</span></div>
            <div style="display:flex; justify-content:space-between; font-weight:bold; font-size:1.4rem; margin-top:5px;"><span>TOTAL</span><span>${formatMoney(ticket.total)}</span></div>
        </div>
        <p style="text-align:center; margin-top:20px; font-size:1.1rem;">¡Gracias por su preferencia!</p>
    `;
    
    document.getElementById('kitchen-ticket-body').innerHTML = html;
    document.getElementById('kitchen-ticket-modal').classList.add('active');
};

window.updateOrderStatus = async (id, newStatus, closeModals = false) => {
    try {
        const ticket = allTickets.find(item => item.id == id || item.ticket_number == id);
        const payload = { status: newStatus };
        if (newStatus === 'cancelled') {
            if (!window.confirm('¿Confirmas la cancelación? Se restaurará inventario y se conciliará el pago.')) return;
            const reason = window.prompt('Motivo de la cancelación:');
            if (!reason?.trim()) return showToast('El motivo de cancelación es obligatorio.', 'warning');
            payload.cancellation_reason = reason.trim();
            const payment = ticket?.payments?.find(item => item.status === 'approved');
            if (payment?.gateway_provider === 'card_terminal') {
                const reference = window.prompt('Referencia del reembolso emitido por la terminal:');
                if (!reference?.trim()) return showToast('La referencia de reembolso es obligatoria.', 'warning');
                payload.refund_reference = reference.trim();
            }
        }
        await authFetch(`${API_BASE}/tickets/${id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        logActivity(`Pedido #${id} marcado como ${newStatus}`, '✅');
        if (closeModals) document.getElementById('order-detail-modal').classList.remove('active');
        const idx = allTickets.findIndex(t => t.id == id || t.ticket_number == id);
        if(idx > -1) allTickets[idx].status = newStatus;
        renderOrders(); renderKPIs();
        fetchOrders(false);
    } catch (e) {
        showToast(e.message, 'error');
    }
};

/* ==========================================
   RESERVATIONS
========================================== */
document.querySelectorAll('.filter-btn[data-res-filter]').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-btn[data-res-filter]').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        resDateFilter = e.target.dataset.resFilter;
        renderReservations();
    });
});
document.querySelectorAll('.filter-btn[data-res-state]').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-btn[data-res-state]').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        resStateFilter = e.target.dataset.resState;
        renderReservations();
    });
});

async function fetchReservations() {
    if (!authToken) return;
    try {
        const res = await authFetch(`${API_BASE}/reservations`);
        allReservations = await res.json();
        renderReservations();
    } catch (e) { showToast(e.message, 'error'); }
}

const unwrapList = payload => Array.isArray(payload) ? payload : (Array.isArray(payload?.data) ? payload.data : []);

async function loadReservationWorkspace() {
    if (!authToken) return;
    try {
        const [areasResponse, tablesResponse, schedulesResponse, blocksResponse] = await Promise.all([
            authFetch(`${API_BASE}/service-areas`), authFetch(`${API_BASE}/dining-tables`),
            authFetch(`${API_BASE}/reservation-schedules`), authFetch(`${API_BASE}/reservation-blocks`),
        ]);
        serviceAreas = unwrapList(await areasResponse.json());
        diningTables = unwrapList(await tablesResponse.json());
        reservationSchedules = unwrapList(await schedulesResponse.json());
        reservationBlocks = unwrapList(await blocksResponse.json());
        renderServiceAreas(); renderDiningTables(); renderReservationSchedules(); renderReservationBlocks(); refreshAreaSelect();
        const availabilityDate=document.getElementById('reservation-availability-date');
        if(!availabilityDate.value){const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);availabilityDate.value=tomorrow.toISOString().slice(0,10);}
        await fetchReservations();
    } catch (error) { showToast(error.message, 'error'); }
}

function refreshAreaSelect() {
    const options = serviceAreas.filter(area => area.active).map(area => `<option value="${Number(area.id)}">${safeStr(area.name)}</option>`).join('');
    document.getElementById('dining-table-area').innerHTML = '<option value="">Selecciona un área</option>' + options;
    document.getElementById('reservation-schedule-area').innerHTML = '<option value="">Todo el establecimiento</option>' + options;
    document.getElementById('reservation-block-area').innerHTML = '<option value="">Selecciona un área</option>' + options;
    refreshBlockTableSelect();
}

function refreshBlockTableSelect(selected = '') {
    const areaId = Number(document.getElementById('reservation-block-area').value);
    const options = diningTables.filter(table => !areaId || table.service_area_id === areaId)
        .map(table => `<option value="${Number(table.id)}">${safeStr(table.code)} · ${safeStr(table.name, 'Sin nombre')}</option>`).join('');
    const select = document.getElementById('reservation-block-table');
    select.innerHTML = '<option value="">Toda el área</option>' + options;
    select.value = selected ? String(selected) : '';
}

function renderServiceAreas() {
    const target = document.getElementById('service-areas-list');
    target.innerHTML = serviceAreas.length ? serviceAreas.map(area => `<article class="reservation-entity-card">
        <h4>${safeStr(area.name)}</h4><p>${safeStr(area.description, 'Sin descripción')}</p>
        <small>${area.tables_count ?? 0} mesas · ${area.active ? 'Activa' : 'Inactiva'} · ${area.public_visible ? 'Visible' : 'Oculta'} · ${area.reservable ? 'Reservable' : 'No reservable'}</small>
        <div class="reservation-entity-actions"><button class="btn-outline" data-action="edit-service-area" data-id="${Number(area.id)}">Editar</button><button class="btn-danger-outline" data-action="delete-service-area" data-id="${Number(area.id)}">Desactivar/eliminar</button></div>
    </article>`).join('') : '<div class="empty-state">Todavía no hay áreas. Crea la primera para registrar mesas.</div>';
}

function renderDiningTables() {
    const target = document.getElementById('dining-tables-list');
    target.innerHTML = diningTables.length ? diningTables.map(table => `<article class="reservation-entity-card">
        <h4>${safeStr(table.code)} ${table.name ? `— ${safeStr(table.name)}` : ''}</h4>
        <p>${safeStr(table.area?.name, 'Área')} · ${Number(table.min_capacity)}–${Number(table.max_capacity)} personas</p>
        <small>${safeStr(table.status)} · ${table.active ? 'Activa' : 'Inactiva'} · ${table.reservable ? 'Reservable' : 'No reservable'}</small>
        <div class="reservation-entity-actions"><button class="btn-outline" data-action="edit-dining-table" data-id="${Number(table.id)}">Editar</button><button class="btn-danger-outline" data-action="delete-dining-table" data-id="${Number(table.id)}">Desactivar/eliminar</button></div>
    </article>`).join('') : '<div class="empty-state">No hay mesas registradas.</div>';
}

function resetServiceAreaForm() { document.getElementById('service-area-form').reset(); document.getElementById('service-area-id').value=''; document.getElementById('service-area-order').value='0'; ['service-area-active','service-area-visible','service-area-reservable'].forEach(id=>document.getElementById(id).checked=true); document.getElementById('service-area-cancel').hidden=true; }
function resetDiningTableForm() { document.getElementById('dining-table-form').reset(); document.getElementById('dining-table-id').value=''; document.getElementById('dining-table-min').value='1'; document.getElementById('dining-table-max').value='4'; document.getElementById('dining-table-active').checked=true; document.getElementById('dining-table-reservable').checked=true; document.getElementById('dining-table-cancel').hidden=true; }

document.getElementById('service-area-form').addEventListener('submit', async event => {
    event.preventDefault(); const id=document.getElementById('service-area-id').value;
    const payload={name:document.getElementById('service-area-name').value.trim(),description:document.getElementById('service-area-description').value.trim()||null,sort_order:Number(document.getElementById('service-area-order').value)||0,active:document.getElementById('service-area-active').checked,public_visible:document.getElementById('service-area-visible').checked,reservable:document.getElementById('service-area-reservable').checked};
    try { await authFetch(`${API_BASE}/service-areas${id?`/${id}`:''}`,{method:id?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); resetServiceAreaForm(); await loadReservationWorkspace(); showToast('Área guardada.','success'); } catch(error){showToast(error.message,'error');}
});
document.getElementById('service-area-cancel').addEventListener('click',resetServiceAreaForm);
window.editServiceArea=id=>{const area=serviceAreas.find(item=>item.id===id);if(!area)return;document.getElementById('service-area-id').value=id;document.getElementById('service-area-name').value=area.name;document.getElementById('service-area-description').value=area.description||'';document.getElementById('service-area-order').value=area.sort_order||0;document.getElementById('service-area-active').checked=area.active;document.getElementById('service-area-visible').checked=area.public_visible;document.getElementById('service-area-reservable').checked=area.reservable;document.getElementById('service-area-cancel').hidden=false;document.getElementById('reservation-areas-admin').scrollIntoView({behavior:'smooth'});};
window.deleteServiceArea=async id=>{if(!confirm('¿Desactivar o eliminar esta área? Su historial se conservará.'))return;try{await authFetch(`${API_BASE}/service-areas/${id}`,{method:'DELETE'});await loadReservationWorkspace();showToast('Área actualizada.','success');}catch(error){showToast(error.message,'error');}};

document.getElementById('dining-table-form').addEventListener('submit', async event => {
    event.preventDefault(); const id=document.getElementById('dining-table-id').value; const existing=diningTables.find(item=>item.id===Number(id));
    const payload={service_area_id:Number(document.getElementById('dining-table-area').value),code:document.getElementById('dining-table-code').value.trim(),name:document.getElementById('dining-table-name').value.trim()||null,min_capacity:Number(document.getElementById('dining-table-min').value),max_capacity:Number(document.getElementById('dining-table-max').value),status:document.getElementById('dining-table-status').value,active:document.getElementById('dining-table-active').checked,reservable:document.getElementById('dining-table-reservable').checked}; if(existing)payload.lock_version=existing.lock_version;
    try{await authFetch(`${API_BASE}/dining-tables${id?`/${id}`:''}`,{method:id?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});resetDiningTableForm();await loadReservationWorkspace();showToast('Mesa guardada.','success');}catch(error){showToast(error.message,'error');}
});
document.getElementById('dining-table-cancel').addEventListener('click',resetDiningTableForm);
window.editDiningTable=id=>{const table=diningTables.find(item=>item.id===id);if(!table)return;document.getElementById('dining-table-id').value=id;document.getElementById('dining-table-area').value=table.service_area_id;document.getElementById('dining-table-code').value=table.code;document.getElementById('dining-table-name').value=table.name||'';document.getElementById('dining-table-min').value=table.min_capacity;document.getElementById('dining-table-max').value=table.max_capacity;document.getElementById('dining-table-status').value=table.status;document.getElementById('dining-table-active').checked=table.active;document.getElementById('dining-table-reservable').checked=table.reservable;document.getElementById('dining-table-cancel').hidden=false;document.getElementById('reservation-tables-admin').scrollIntoView({behavior:'smooth'});};
window.deleteDiningTable=async id=>{if(!confirm('¿Desactivar o eliminar esta mesa?'))return;try{await authFetch(`${API_BASE}/dining-tables/${id}`,{method:'DELETE'});await loadReservationWorkspace();showToast('Mesa actualizada.','success');}catch(error){showToast(error.message,'error');}};

const reservationDayNames=['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const timeValue=value=>String(value||'').slice(0,5);
const localDateTimeValue=value=>{if(!value)return'';const d=new Date(value);const pad=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;};

function renderReservationSchedules(){const target=document.getElementById('reservation-schedules-list');target.innerHTML=reservationSchedules.length?reservationSchedules.map(item=>`<article class="reservation-entity-card"><h4>${safeStr(reservationDayNames[item.day_of_week])} · ${timeValue(item.opens_at)}–${timeValue(item.closes_at)}</h4><p>${safeStr(item.area?.name,'Todo el establecimiento')}</p><small>Cada ${Number(item.slot_interval_minutes)} min · duración ${Number(item.reservation_duration_minutes)} min · limpieza ${Number(item.cleanup_buffer_minutes)} min · ${item.active?'Activo':'Inactivo'}</small><div class="reservation-entity-actions"><button class="btn-outline" data-action="edit-reservation-schedule" data-id="${Number(item.id)}">Editar</button><button class="btn-danger-outline" data-action="delete-reservation-schedule" data-id="${Number(item.id)}">Eliminar</button></div></article>`).join(''):'<div class="empty-state">No hay horarios configurados.</div>';}
function resetReservationScheduleForm(){document.getElementById('reservation-schedule-form').reset();document.getElementById('reservation-schedule-id').value='';document.getElementById('reservation-schedule-open').value='07:00';document.getElementById('reservation-schedule-close').value='22:00';document.getElementById('reservation-schedule-interval').value='30';document.getElementById('reservation-schedule-duration').value='90';document.getElementById('reservation-schedule-cleanup').value='15';document.getElementById('reservation-schedule-active').checked=true;document.getElementById('reservation-schedule-cancel').hidden=true;}
document.getElementById('reservation-schedule-form').addEventListener('submit',async event=>{event.preventDefault();const id=document.getElementById('reservation-schedule-id').value;const area=document.getElementById('reservation-schedule-area').value;const payload={service_area_id:area?Number(area):null,day_of_week:Number(document.getElementById('reservation-schedule-day').value),opens_at:document.getElementById('reservation-schedule-open').value,closes_at:document.getElementById('reservation-schedule-close').value,slot_interval_minutes:Number(document.getElementById('reservation-schedule-interval').value),reservation_duration_minutes:Number(document.getElementById('reservation-schedule-duration').value),cleanup_buffer_minutes:Number(document.getElementById('reservation-schedule-cleanup').value),active:document.getElementById('reservation-schedule-active').checked};try{await authFetch(`${API_BASE}/reservation-schedules${id?`/${id}`:''}`,{method:id?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});resetReservationScheduleForm();await loadReservationWorkspace();showToast('Horario guardado.','success');}catch(error){showToast(error.message,'error');}});
document.getElementById('reservation-schedule-cancel').addEventListener('click',resetReservationScheduleForm);
window.editReservationSchedule=id=>{const item=reservationSchedules.find(row=>row.id===id);if(!item)return;document.getElementById('reservation-schedule-id').value=id;document.getElementById('reservation-schedule-area').value=item.service_area_id??'';document.getElementById('reservation-schedule-day').value=item.day_of_week;document.getElementById('reservation-schedule-open').value=timeValue(item.opens_at);document.getElementById('reservation-schedule-close').value=timeValue(item.closes_at);document.getElementById('reservation-schedule-interval').value=item.slot_interval_minutes;document.getElementById('reservation-schedule-duration').value=item.reservation_duration_minutes;document.getElementById('reservation-schedule-cleanup').value=item.cleanup_buffer_minutes;document.getElementById('reservation-schedule-active').checked=item.active;document.getElementById('reservation-schedule-cancel').hidden=false;document.getElementById('reservation-schedules-admin').scrollIntoView({behavior:'smooth'});};
window.deleteReservationSchedule=async id=>{if(!confirm('¿Eliminar este horario?'))return;try{await authFetch(`${API_BASE}/reservation-schedules/${id}`,{method:'DELETE'});await loadReservationWorkspace();showToast('Horario eliminado.','success');}catch(error){showToast(error.message,'error');}};

function renderReservationBlocks(){const target=document.getElementById('reservation-blocks-list');target.innerHTML=reservationBlocks.length?reservationBlocks.map(item=>`<article class="reservation-entity-card"><h4>${safeStr(item.reason)}</h4><p>${safeStr(item.area?.name)}${item.table?` · ${safeStr(item.table.code)}`:' · Toda el área'}</p><small>${new Date(item.starts_at).toLocaleString('es-MX')} → ${new Date(item.ends_at).toLocaleString('es-MX')} · ${item.active?'Activo':'Inactivo'}</small><div class="reservation-entity-actions"><button class="btn-outline" data-action="edit-reservation-block" data-id="${Number(item.id)}">Editar</button><button class="btn-danger-outline" data-action="delete-reservation-block" data-id="${Number(item.id)}">Desactivar</button></div></article>`).join(''):'<div class="empty-state">No hay bloqueos configurados.</div>';}
function resetReservationBlockForm(){document.getElementById('reservation-block-form').reset();document.getElementById('reservation-block-id').value='';document.getElementById('reservation-block-active').checked=true;document.getElementById('reservation-block-cancel').hidden=true;refreshBlockTableSelect();}
document.getElementById('reservation-block-area').addEventListener('change',()=>refreshBlockTableSelect());
document.getElementById('reservation-block-form').addEventListener('submit',async event=>{event.preventDefault();const id=document.getElementById('reservation-block-id').value;const table=document.getElementById('reservation-block-table').value;const payload={service_area_id:Number(document.getElementById('reservation-block-area').value),dining_table_id:table?Number(table):null,starts_at:new Date(document.getElementById('reservation-block-start').value).toISOString(),ends_at:new Date(document.getElementById('reservation-block-end').value).toISOString(),reason:document.getElementById('reservation-block-reason').value.trim(),active:document.getElementById('reservation-block-active').checked};try{await authFetch(`${API_BASE}/reservation-blocks${id?`/${id}`:''}`,{method:id?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});resetReservationBlockForm();await loadReservationWorkspace();showToast('Bloqueo guardado.','success');}catch(error){showToast(error.message,'error');}});
document.getElementById('reservation-block-cancel').addEventListener('click',resetReservationBlockForm);
window.editReservationBlock=id=>{const item=reservationBlocks.find(row=>row.id===id);if(!item)return;document.getElementById('reservation-block-id').value=id;document.getElementById('reservation-block-area').value=item.service_area_id||item.table?.service_area_id||'';refreshBlockTableSelect(item.dining_table_id);document.getElementById('reservation-block-start').value=localDateTimeValue(item.starts_at);document.getElementById('reservation-block-end').value=localDateTimeValue(item.ends_at);document.getElementById('reservation-block-reason').value=item.reason;document.getElementById('reservation-block-active').checked=item.active;document.getElementById('reservation-block-cancel').hidden=false;document.getElementById('reservation-blocks-admin').scrollIntoView({behavior:'smooth'});};
window.deleteReservationBlock=async id=>{if(!confirm('¿Desactivar este bloqueo?'))return;try{await authFetch(`${API_BASE}/reservation-blocks/${id}`,{method:'DELETE'});await loadReservationWorkspace();showToast('Bloqueo desactivado.','success');}catch(error){showToast(error.message,'error');}};

document.getElementById('reservation-availability-form').addEventListener('submit',async event=>{event.preventDefault();const date=document.getElementById('reservation-availability-date').value;const guests=Number(document.getElementById('reservation-availability-guests').value);const target=document.getElementById('reservation-availability-result');target.innerHTML='<div class="empty-state">Consultando capacidad real…</div>';try{const response=await authFetch(`${API_BASE}/reservation-availability?date=${encodeURIComponent(date)}&guests=${encodeURIComponent(guests)}`);const data=await response.json();const areas=unwrapList(data.areas);target.innerHTML=areas.length?areas.map(area=>`<article class="reservation-entity-card"><h4>${safeStr(area.name)}</h4><p>${area.available_slots.map(slot=>safeStr(slot)).join(' · ')}</p><small>${area.available_slots.length} horario(s) disponible(s) para ${guests} persona(s)</small></article>`).join(''):'<div class="empty-state">No hay áreas con capacidad para esa fecha.</div>';}catch(error){target.innerHTML=`<div class="empty-state">${safeStr(error.message)}</div>`;}});

function renderReservations() {
    const list = document.getElementById('reservations-list');
    const todayObj = new Date();
    todayObj.setHours(0,0,0,0);
    const todayStr = todayObj.getFullYear() + '-' + String(todayObj.getMonth() + 1).padStart(2, '0') + '-' + String(todayObj.getDate()).padStart(2, '0');
    const tomorrowObj = new Date();
    tomorrowObj.setDate(tomorrowObj.getDate() + 1);
    const tomorrowStr = tomorrowObj.getFullYear() + '-' + String(tomorrowObj.getMonth() + 1).padStart(2, '0') + '-' + String(tomorrowObj.getDate()).padStart(2, '0');
    const weekEnd = new Date(todayObj); weekEnd.setDate(weekEnd.getDate()+7);
    let filtered = allReservations.filter(r => {
        let matchDate = true;
        if(resDateFilter === 'today') matchDate = r.date === todayStr;
        if(resDateFilter === 'tomorrow') matchDate = r.date === tomorrowStr;
        if(resDateFilter === 'week') { const value=new Date(`${r.date}T00:00:00`); matchDate=value>=todayObj&&value<=weekEnd; }
        let matchState = true;
        if(resStateFilter === 'pending') matchState = r.status === 'pending';
        if(resStateFilter === 'approved') matchState = r.status === 'approved';
        return matchDate && matchState;
    });
    document.getElementById('kpi-res-today').textContent = allReservations.filter(r => r.date === todayStr).length;
    document.getElementById('kpi-res-confirmed').textContent = allReservations.filter(r => r.status === 'approved').length;
    list.innerHTML = '';
    if (filtered.length === 0) {
        list.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">No hay reservas para estos filtros.</div>';
        return;
    }
    filtered.forEach(r => {
        const div = document.createElement('div');
        div.className = 'res-card';
        let actionBtns = '';
        if (r.status === 'pending') actionBtns = `<button class="btn-primary" data-action="reservation-status" data-id="${safeStr(r.id)}" data-status="approved">Aprobar</button> <button class="btn-danger-outline" data-action="reservation-status" data-id="${safeStr(r.id)}" data-status="cancelled">Rechazar</button>`;
        else if (r.status === 'approved') actionBtns = `<button class="btn-primary" data-action="reservation-status" data-id="${safeStr(r.id)}" data-status="checked_in">Registrar llegada</button> <button class="btn-danger-outline" data-action="reservation-status" data-id="${safeStr(r.id)}" data-status="no_show">No se presentó</button>`;
        else if (r.status === 'checked_in') actionBtns = `<button class="btn-primary" data-action="reservation-status" data-id="${safeStr(r.id)}" data-status="seated">Sentar en mesa</button>`;
        else if (r.status === 'seated' || r.status === 'ready') actionBtns = `<button class="btn-primary" data-action="reservation-status" data-id="${safeStr(r.id)}" data-status="completed">Finalizar</button>`;
        const labels={pending:'Pendiente',approved:'Confirmada',checked_in:'Llegó',seated:'En mesa',ready:'En mesa',cancelled:'Cancelada',completed:'Finalizada',no_show:'No se presentó'};
        const compatibleTables=diningTables.filter(table=>table.active&&table.reservable&&table.min_capacity<=r.guests&&table.max_capacity>=r.guests);
        const assignment=compatibleTables.length?`<div class="reservation-assignment"><select class="search-input" id="reservation-table-${Number(r.id)}">${compatibleTables.map(table=>`<option value="${Number(table.id)}" ${table.id===r.dining_table_id?'selected':''}>${safeStr(table.area?.name)} · ${safeStr(table.code)} (${Number(table.max_capacity)})</option>`).join('')}</select><button class="btn-outline" data-action="reservation-assign" data-id="${Number(r.id)}">Reasignar</button></div>`:'';
        div.innerHTML = `
            <div style="font-size:1.2rem; font-weight:bold; color:var(--color-gold); margin-bottom:8px;">${safeStr(r.name, 'Sin nombre')}</div>
            <div style="font-size:0.9rem; color:var(--color-text-muted); margin-bottom:15px;">
                📅 ${safeStr(r.date)} a las ${safeStr(r.time)} • 👥 ${safeStr(r.guests)} p<br>
                📍 ${safeStr(r.area?.name, 'Sin área')} · Mesa ${safeStr(r.table?.code, 'sin asignar')}<br>
                ✉️ ${safeStr(r.email)} · ☎️ ${safeStr(r.phone)}<br>
                Estado: <strong style="color:var(--color-text); text-transform:uppercase">${safeStr(labels[r.status]||r.status)}</strong>
            </div>
            ${assignment}<div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;">${actionBtns}</div>
        `;
        list.appendChild(div);
    });
}

window.updateResStatus = async (id, status) => {
    if (['cancelled','no_show','completed'].includes(status) && !confirm('¿Confirmas este cambio de estado? La capacidad quedará liberada cuando corresponda.')) return;
    try {
        const reservation=allReservations.find(item=>String(item.id)===String(id));
        await authFetch(`${API_BASE}/reservations/${id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, lock_version: reservation?.lock_version }) });
        logActivity(`Reserva #${id} actualizada`, '🎫');
        fetchReservations();
    } catch (e) { showToast(e.message, 'error'); }
};
window.assignReservationTable=async id=>{const reservation=allReservations.find(item=>String(item.id)===String(id));const tableId=Number(document.getElementById(`reservation-table-${id}`)?.value);if(!reservation||!tableId)return;try{await authFetch(`${API_BASE}/reservations/${id}/assignment`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({dining_table_id:tableId,lock_version:reservation.lock_version})});await fetchReservations();showToast('Mesa reasignada.','success');}catch(error){showToast(error.message,'error');}};

const paymentCollectionKeys = new Map();
window.collectTicketPayment = async id => {
    const ticket = allTickets.find(item => item.id == id || item.ticket_number == id);
    if (!ticket) return;
    const methodInput = window.prompt('Método de cobro: escribe "efectivo" o "terminal".', 'efectivo');
    if (!methodInput) return;
    const method = methodInput.trim().toLowerCase() === 'terminal' ? 'card_terminal'
        : methodInput.trim().toLowerCase() === 'efectivo' ? 'cash' : null;
    if (!method) return showToast('Método inválido.', 'warning');

    const payload = { payment_method: method };
    if (method === 'cash') {
        const received = window.prompt(`Total ${formatMoney(ticket.total)}. Efectivo recibido:`);
        if (received === null || Number(received) < Number(ticket.total)) return showToast('El efectivo recibido es insuficiente.', 'warning');
        payload.amount_received = Number(received);
    } else {
        const reference = window.prompt('Referencia emitida por la terminal:');
        if (!reference?.trim()) return showToast('La referencia de terminal es obligatoria.', 'warning');
        payload.transaction_reference = reference.trim();
    }

    const key = paymentCollectionKeys.get(String(ticket.id))
        || window.crypto?.randomUUID?.()
        || `collection-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    paymentCollectionKeys.set(String(ticket.id), key);
    try {
        const response = await authFetch(`${API_BASE}/tickets/${encodeURIComponent(ticket.id)}/collect-payment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
            body: JSON.stringify(payload),
        });
        const result = await response.json();
        paymentCollectionKeys.delete(String(ticket.id));
        showToast(`Cobro registrado. Cambio: ${formatMoney(result.payment?.change_amount || 0)}`, 'success');
        await Promise.all([fetchOrders(true), initializePos()]);
    } catch (error) {
        showToast(error.message, 'error');
    }
};

/* POS AND CASH REGISTER */
let posProducts = [];
let posCart = [];
let posSaleKey = null;
let currentCashSession = null;
let pendingPosProduct = null;

async function initializePos() {
    if (!hasPermission('pos.operate')) return;

    try {
        const [menuResponse, cashResponse] = await Promise.all([
            fetch(`${API_BASE}/menu`, { headers: { 'Accept': 'application/json' } }),
            authFetch(`${API_BASE}/cash-register/current`),
        ]);
        if (!menuResponse.ok) throw new Error(await readErrorMessage(menuResponse));
        const menu = await menuResponse.json();
        posProducts = menu.flatMap(category => category.products || []);
        currentCashSession = (await cashResponse.json()).data;
        renderPosCashSession();
        renderPosProducts();
        renderPosCart();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function renderPosCashSession() {
    document.getElementById('cash-session-closed').hidden = Boolean(currentCashSession);
    document.getElementById('cash-session-open').hidden = !currentCashSession;
    if (!currentCashSession) return;

    document.getElementById('pos-opening-cash').textContent = formatMoney(currentCashSession.opening_amount);
    document.getElementById('pos-expected-cash').textContent = formatMoney(currentCashSession.calculated_expected_cash);
}

function renderPosProducts() {
    const search = document.getElementById('pos-product-search').value.toLowerCase().trim();
    const container = document.getElementById('pos-products-grid');
    container.replaceChildren();
    posProducts
        .filter(product => product.name.toLowerCase().includes(search))
        .forEach(product => {
            const card = document.createElement('article');
            card.className = 'kpi-card';
            const name = document.createElement('strong');
            name.textContent = product.name;
            const price = document.createElement('span');
            price.textContent = formatMoney(product.price);
            price.style.color = 'var(--color-gold)';
            const add = document.createElement('button');
            add.type = 'button';
            add.className = 'btn-outline';
            add.dataset.action = 'pos-add-product';
            add.dataset.id = product.id;
            add.textContent = 'Agregar';
            card.append(name, price, add);
            container.appendChild(card);
        });
}

window.addPosProduct = (id) => {
    const product = posProducts.find(item => Number(item.id) === id);
    if (!product) return;
    if (Array.isArray(product.add_ons) && product.add_ons.length) {
        pendingPosProduct = product;
        document.getElementById('pos-addon-product-name').textContent = product.name;
        const list = document.getElementById('pos-addon-list');
        list.replaceChildren();
        product.add_ons.forEach(addOn => {
            const label = document.createElement('label'); label.className = 'configuration-row';
            const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'pos-addon-checkbox'; checkbox.value = addOn.id; checkbox.checked = Boolean(addOn.selected_by_default);
            const text = document.createElement('span'); text.textContent = `${addOn.name} (${formatMoney(addOn.effective_price ?? addOn.price_adjustment)})`;
            label.append(checkbox, text); list.appendChild(label);
        });
        document.getElementById('pos-addon-modal').classList.add('active');
        return;
    }
    addPosCartItem(product, []);
};

function addPosCartItem(product, addOns) {
    const signature = addOns.map(item => Number(item.id)).sort((a, b) => a - b).join(',');
    const existing = posCart.find(item => Number(item.product.id) === Number(product.id) && item.signature === signature);
    if (existing) existing.quantity += 1;
    else posCart.push({ product, quantity: 1, addOns, signature });
    posSaleKey = null;
    renderPosCart();
}

window.removePosProduct = (id) => {
    const index = id;
    if (index < 0) return;
    if (posCart[index].quantity > 1) posCart[index].quantity -= 1;
    else posCart.splice(index, 1);
    posSaleKey = null;
    renderPosCart();
};

function renderPosCart() {
    const container = document.getElementById('pos-cart-items');
    container.replaceChildren();
    let total = 0;
    if (posCart.length === 0) {
        const empty = document.createElement('p');
        empty.textContent = 'Sin productos.';
        empty.style.color = 'var(--color-text-muted)';
        container.appendChild(empty);
    }

    posCart.forEach((item, index) => {
        const extras = (item.addOns || []).reduce((sum, addOn) => sum + safeNum(addOn.effective_price ?? addOn.price_adjustment), 0);
        total += (safeNum(item.product.price) + extras) * item.quantity;
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; justify-content:space-between; gap:10px; align-items:center;';
        const text = document.createElement('span');
        const addOnNames = (item.addOns || []).map(addOn => addOn.name).join(', ');
        text.textContent = `${item.quantity} × ${item.product.name}${addOnNames ? ` · ${addOnNames}` : ''}`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn-danger-outline';
        remove.dataset.action = 'pos-remove-product';
        remove.dataset.id = index;
        remove.textContent = '−';
        row.append(text, remove);
        container.appendChild(row);
    });

    document.getElementById('pos-cart-total').textContent = formatMoney(total);
    document.getElementById('btn-complete-pos-sale').disabled = posCart.length === 0 || !currentCashSession;
}

function closePosAddOnModal() {
    document.getElementById('pos-addon-modal').classList.remove('active');
    pendingPosProduct = null;
}
document.getElementById('close-pos-addon-modal').addEventListener('click', closePosAddOnModal);
document.getElementById('cancel-pos-addon').addEventListener('click', closePosAddOnModal);
document.getElementById('confirm-pos-addon').addEventListener('click', () => {
    if (!pendingPosProduct) return;
    const selected = [...document.querySelectorAll('.pos-addon-checkbox:checked')]
        .map(input => pendingPosProduct.add_ons.find(addOn => Number(addOn.id) === Number(input.value))).filter(Boolean);
    const product = pendingPosProduct;
    closePosAddOnModal();
    addPosCartItem(product, selected);
});

document.getElementById('pos-product-search').addEventListener('input', renderPosProducts);
document.getElementById('pos-payment-method').addEventListener('change', event => {
    const cash = event.target.value === 'cash';
    document.getElementById('pos-cash-fields').hidden = !cash;
    document.getElementById('pos-terminal-fields').hidden = cash;
    posSaleKey = null;
});

document.getElementById('cash-open-form').addEventListener('submit', async event => {
    event.preventDefault();
    try {
        const response = await authFetch(`${API_BASE}/cash-register/open`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ opening_amount: Number(document.getElementById('cash-opening-amount').value) }),
        });
        currentCashSession = (await response.json()).data;
        renderPosCashSession();
        renderPosCart();
        showToast('Turno de caja abierto.', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
});

document.getElementById('cash-movement-form').addEventListener('submit', async event => {
    event.preventDefault();
    try {
        const response = await authFetch(`${API_BASE}/cash-register/movements`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: document.getElementById('cash-movement-type').value,
                amount: Number(document.getElementById('cash-movement-amount').value),
                note: document.getElementById('cash-movement-note').value.trim(),
            }),
        });
        currentCashSession = (await response.json()).data;
        event.target.reset();
        renderPosCashSession();
        showToast('Movimiento de caja registrado.', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
});

document.getElementById('cash-close-form').addEventListener('submit', async event => {
    event.preventDefault();
    try {
        const response = await authFetch(`${API_BASE}/cash-register/close`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ counted_cash: Number(document.getElementById('cash-counted-amount').value) }),
        });
        const closed = (await response.json()).data;
        currentCashSession = null;
        posCart = [];
        renderPosCashSession();
        renderPosCart();
        showToast(`Caja cerrada. Diferencia: ${formatMoney(closed.difference)}`, Number(closed.difference) === 0 ? 'success' : 'warning');
    } catch (error) {
        showToast(error.message, 'error');
    }
});

document.getElementById('btn-complete-pos-sale').addEventListener('click', async () => {
    if (!currentCashSession || posCart.length === 0) return;
    const paymentMethod = document.getElementById('pos-payment-method').value;
    const payload = {
        items: posCart.map(item => ({
            product_id: item.product.id,
            quantity: item.quantity,
            add_ons: (item.addOns || []).map(addOn => addOn.id),
        })),
        customer_name: 'Venta mostrador',
        order_type: document.getElementById('pos-order-type').value,
        payment_method: paymentMethod,
        amount_received: paymentMethod === 'cash' ? Number(document.getElementById('pos-amount-received').value) : null,
        transaction_reference: paymentMethod === 'card_terminal'
            ? document.getElementById('pos-terminal-reference').value.trim()
            : null,
    };
    posSaleKey ??= window.crypto?.randomUUID?.() || `pos-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const button = document.getElementById('btn-complete-pos-sale');
    button.disabled = true;

    try {
        const response = await authFetch(`${API_BASE}/pos/sales`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': posSaleKey },
            body: JSON.stringify(payload),
        });
        const result = await response.json();
        posSaleKey = null;
        posCart = [];
        document.getElementById('pos-amount-received').value = '';
        document.getElementById('pos-terminal-reference').value = '';
        showToast(`Venta ${result.ticket_number} registrada. Cambio: ${formatMoney(result.payment?.change_amount || 0)}`, 'success');
        await Promise.all([initializePos(), hasPermission('tickets.view') ? fetchOrders(true) : Promise.resolve()]);
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        renderPosCart();
    }
});

async function loadReports() {
    if (!hasPermission('reports.view')) return;
    const dateInput = document.getElementById('report-date');
    if (!dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);

    try {
        const response = await authFetch(`${API_BASE}/reports/daily?date=${encodeURIComponent(dateInput.value)}`);
        const report = await response.json();
        document.getElementById('report-orders').textContent = report.orders.total;
        document.getElementById('report-gross').textContent = formatMoney(report.payments.net_collected);
        document.getElementById('report-payments').textContent = formatMoney(report.payments.refunded_total);
        document.getElementById('report-cash-difference').textContent = formatMoney(report.cash.difference_total);

        const methods = document.getElementById('report-payment-methods');
        methods.replaceChildren();
        report.payments.methods.forEach(method => {
            const row = document.createElement('p');
            row.textContent = `${method.gateway_provider}: ${method.transactions} operaciones — ${formatMoney(method.total)}`;
            methods.appendChild(row);
        });
        if (report.payments.methods.length === 0) methods.textContent = 'Sin pagos confirmados en la fecha.';

        if (hasPermission('audit.view')) await loadAuditEvents();
        else document.getElementById('audit-section').hidden = true;
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function loadAuditEvents() {
    const response = await authFetch(`${API_BASE}/audit-events?per_page=25`);
    const result = await response.json();
    const tbody = document.getElementById('audit-table-body');
    tbody.replaceChildren();
    result.data.forEach(event => {
        const row = document.createElement('tr');
        [
            new Date(event.created_at).toLocaleString(),
            event.user?.name || 'Sistema',
            event.action,
            `${event.resource_type} #${event.resource_id || '-'}`,
        ].forEach(value => {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.appendChild(cell);
        });
        tbody.appendChild(row);
    });
    if (result.data.length === 0) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 4;
        cell.textContent = 'Sin eventos registrados.';
        row.appendChild(cell);
        tbody.appendChild(row);
    }
}

document.getElementById('btn-load-report').addEventListener('click', loadReports);

let managedUsers = [];
let managedRoles = [];

function resetUserForm() {
    document.getElementById('user-form').reset();
    document.getElementById('user-id').value = '';
    document.getElementById('user-active').checked = true;
    document.getElementById('user-form-title').textContent = 'Nuevo usuario';
    document.getElementById('user-password-help').textContent = '(mínimo 10 caracteres)';
    document.getElementById('btn-cancel-user-edit').hidden = true;
    document.querySelectorAll('#user-role-options input').forEach(input => { input.checked = false; });
}

function renderManagedRoleOptions() {
    const container = document.getElementById('user-role-options');
    container.replaceChildren();
    managedRoles.forEach(role => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.name = 'user-role';
        input.value = role.slug;
        label.append(input, ` ${role.name}`);
        container.appendChild(label);
    });
}

function renderManagedUsers() {
    const tbody = document.getElementById('users-table-body');
    tbody.replaceChildren();
    managedUsers.forEach(user => {
        const row = document.createElement('tr');
        const values = [
            user.name,
            user.email,
            (user.roles || []).map(role => role.name).join(', ') || 'Sin rol',
            user.active ? 'Activo' : 'Inactivo',
        ];
        values.forEach(value => {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.appendChild(cell);
        });
        const actions = document.createElement('td');
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'btn-outline';
        edit.textContent = 'Editar';
        edit.dataset.action = 'edit-user';
        edit.dataset.id = user.id;
        actions.appendChild(edit);
        row.appendChild(actions);
        tbody.appendChild(row);
    });
    if (managedUsers.length === 0) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 5;
        cell.textContent = 'No se encontraron usuarios.';
        row.appendChild(cell);
        tbody.appendChild(row);
    }
}

async function loadManagedUsers() {
    if (!hasPermission('users.manage')) return;
    try {
        const search = document.getElementById('user-search').value.trim();
        const [usersResponse, rolesResponse] = await Promise.all([
            authFetch(`${API_BASE}/users?per_page=100&search=${encodeURIComponent(search)}`),
            managedRoles.length ? Promise.resolve(null) : authFetch(`${API_BASE}/roles`),
        ]);
        const usersResult = await usersResponse.json();
        managedUsers = usersResult.data || [];
        if (rolesResponse) {
            managedRoles = await rolesResponse.json();
            renderManagedRoleOptions();
        }
        renderManagedUsers();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

window.editUser = id => {
    const user = managedUsers.find(item => Number(item.id) === Number(id));
    if (!user) return;
    document.getElementById('user-id').value = user.id;
    document.getElementById('user-name').value = user.name;
    document.getElementById('user-email').value = user.email;
    document.getElementById('user-active').checked = Boolean(user.active);
    document.getElementById('user-password').value = '';
    document.getElementById('user-password-confirmation').value = '';
    document.getElementById('user-form-title').textContent = `Editar: ${user.name}`;
    document.getElementById('user-password-help').textContent = '(dejar vacía para conservarla)';
    document.getElementById('btn-cancel-user-edit').hidden = false;
    const selected = new Set((user.roles || []).map(role => role.slug));
    document.querySelectorAll('#user-role-options input').forEach(input => { input.checked = selected.has(input.value); });
};

document.getElementById('btn-cancel-user-edit').addEventListener('click', resetUserForm);
document.getElementById('user-search').addEventListener('input', loadManagedUsers);
document.getElementById('user-form').addEventListener('submit', async event => {
    event.preventDefault();
    const id = document.getElementById('user-id').value;
    const password = document.getElementById('user-password').value;
    const confirmation = document.getElementById('user-password-confirmation').value;
    const roleSlugs = [...document.querySelectorAll('#user-role-options input:checked')].map(input => input.value);
    if (!id && password.length < 10) return showToast('La contraseña debe tener al menos 10 caracteres.', 'warning');
    if (password !== confirmation) return showToast('Las contraseñas no coinciden.', 'warning');
    if (roleSlugs.length === 0) return showToast('Selecciona al menos un rol.', 'warning');

    const payload = {
        name: document.getElementById('user-name').value.trim(),
        email: document.getElementById('user-email').value.trim(),
        role_slugs: roleSlugs,
        active: document.getElementById('user-active').checked,
    };
    if (password) {
        payload.password = password;
        payload.password_confirmation = confirmation;
    }

    try {
        const response = await authFetch(`${API_BASE}/users${id ? `/${id}` : ''}`, {
            method: id ? 'PATCH' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error(await readErrorMessage(response));
        showToast(id ? 'Usuario actualizado.' : 'Usuario creado.', 'success');
        resetUserForm();
        await loadManagedUsers();
    } catch (error) {
        showToast(error.message, 'error');
    }
});

/* TAB LOGIC */
const tabs = [
    { btn: 'tab-orders', view: 'view-orders', fetchFn: () => fetchOrders(true) },
    { btn: 'tab-pos', view: 'view-pos', fetchFn: () => initializePos() },
    { btn: 'tab-reservations', view: 'view-reservations', fetchFn: () => loadReservationWorkspace() },
    { btn: 'tab-products', view: 'view-products', fetchFn: () => fetchCatalogBootstrap() },
    { btn: 'tab-reports', view: 'view-reports', fetchFn: () => loadReports() },
    { btn: 'tab-users', view: 'view-users', fetchFn: () => loadManagedUsers() }
];

tabs.forEach(tab => {
    document.getElementById(tab.btn).addEventListener('click', () => {
        // Toggle buttons
        tabs.forEach(t => document.getElementById(t.btn).classList.remove('active'));
        document.getElementById(tab.btn).classList.add('active');
        
        // Toggle views
        tabs.forEach(t => document.getElementById(t.view).classList.remove('active-view'));
        document.getElementById(tab.view).classList.add('active-view');
        
        // Trigger fetch
        tab.fetchFn();
    });
});

/* Mobile Tabs Kanban */
document.querySelectorAll('.mobile-tab').forEach(btn => {
    btn.onclick = (e) => {
        document.querySelectorAll('.mobile-tab').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        document.querySelectorAll('.kanban-col').forEach(c => c.classList.remove('active-mobile'));
        document.getElementById('col-wrap-' + e.target.dataset.col).classList.add('active-mobile');
    };
});

initializeSession();

// Accesibilidad común de modales: foco inicial, Escape y ciclo de Tab.
let modalReturnFocus = null;
const visibleModal = () => [...document.querySelectorAll('.modal-overlay')]
    .find(modal => !modal.hidden && (modal.classList.contains('active') || modal.classList.contains('open')));
document.querySelectorAll('.modal-overlay').forEach(modal => {
    new MutationObserver(() => {
        const opened = !modal.hidden && (modal.classList.contains('active') || modal.classList.contains('open'));
        modal.setAttribute('aria-hidden', opened ? 'false' : 'true');
        if (opened) {
            if (!modal.contains(document.activeElement)) modalReturnFocus = document.activeElement;
            setTimeout(() => modal.querySelector('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')?.focus(), 0);
        }
    }).observe(modal, { attributes: true, attributeFilter: ['class', 'hidden'] });
});

const catalogView = document.getElementById('view-products');
const catalogQuickNavButtons = [...document.querySelectorAll('[data-catalog-target]')];
let catalogScrollFrame = null;

function updateCatalogQuickNav() {
    catalogScrollFrame = null;
    const viewTop = catalogView.getBoundingClientRect().top;
    let current = catalogQuickNavButtons[0]?.dataset.catalogTarget;
    catalogQuickNavButtons.forEach(button => {
        const section = document.getElementById(button.dataset.catalogTarget);
        if (section && section.getBoundingClientRect().top - viewTop <= 115) current = section.id;
    });
    catalogQuickNavButtons.forEach(button => button.classList.toggle('active', button.dataset.catalogTarget === current));
}

catalogQuickNavButtons.forEach(button => button.addEventListener('click', () => {
    const section = document.getElementById(button.dataset.catalogTarget);
    if (!section) return;
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    catalogQuickNavButtons.forEach(item => item.classList.toggle('active', item === button));
}));

catalogView.addEventListener('scroll', () => {
    if (catalogScrollFrame === null) catalogScrollFrame = requestAnimationFrame(updateCatalogQuickNav);
}, { passive: true });
document.addEventListener('keydown', event => {
    const modal = visibleModal();
    if (!modal) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        const closer = modal.querySelector('.close-modal, .close-btn, [id^="btn-cancel"]');
        if (closer) closer.click();
        else {
            modal.classList.remove('active', 'open');
            modal.setAttribute('aria-hidden', 'true');
        }
        modalReturnFocus?.focus?.();
        return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter(element => element.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
});
autoRefreshInterval = setInterval(() => {
    if(authToken) {
        if(document.getElementById('tab-orders').classList.contains('active')) fetchOrders(false);
        if(document.getElementById('tab-reservations').classList.contains('active')) fetchReservations(false);
        // Products rarely change automatically, so we don't strict-poll them unless needed, or we could.
    }
}, 10000);

/* ==========================================
   PRODUCTS CRUD LOGIC
   ========================================== */

let adminProductsList = [];
let adminCategoriesList = [];

async function fetchCatalogBootstrap() {
    try {
        const response = await authFetch(`${API_BASE}/catalog/bootstrap`);
        if (!response.ok) throw new Error(await readErrorMessage(response));

        const payload = await response.json();
        adminCategoriesList = Array.isArray(payload.categories) ? payload.categories : [];
        adminProductsList = Array.isArray(payload.products) ? payload.products : [];
        adminAddOnsList = Array.isArray(payload.add_ons) ? payload.add_ons : [];
        adminIngredientsList = Array.isArray(payload.ingredients) ? payload.ingredients : [];

        renderCategoryOptions();
        renderCategoriesTable();
        filterAndRenderAddOns();
        filterAndRenderProducts();
        filterAndRenderInventory();
    } catch (error) {
        ['categories-table-body', 'addons-table-body', 'products-table-body', 'inventory-table-body'].forEach(id => {
            const tbody = document.getElementById(id);
            const columns = id === 'addons-table-body' ? 6 : 5;
            if (tbody) tbody.innerHTML = `<tr><td colspan="${columns}" class="catalog-empty-state">No se pudieron cargar los datos. Intenta nuevamente.</td></tr>`;
        });
        showToast(error.message, 'error');
    }
}

async function fetchCategories() {
    try {
        const response = await authFetch(`${API_BASE}/categories`);
        adminCategoriesList = await response.json();
        renderCategoryOptions();
        renderCategoriesTable();
    } catch (error) {
        document.getElementById('categories-table-body').innerHTML = `
            <tr><td colspan="5" class="catalog-empty-state">No se pudieron cargar las categorías.</td></tr>
        `;
        showToast(error.message, 'error');
    }
}

function renderCategoryOptions() {
    const filterSelect = document.getElementById('filter-category');
    const productSelect = document.getElementById('prod-category');
    const selectedFilter = filterSelect.value || 'all';
    const selectedProduct = productSelect.value;

    filterSelect.replaceChildren(new Option('Todas las categorías', 'all'));
    productSelect.replaceChildren(new Option('Selecciona una categoría', ''));

    adminCategoriesList.forEach(category => {
        filterSelect.add(new Option(category.name, category.id));
        productSelect.add(new Option(category.name, category.id));
    });

    if ([...filterSelect.options].some(option => option.value === selectedFilter)) {
        filterSelect.value = selectedFilter;
    }
    if ([...productSelect.options].some(option => option.value === selectedProduct)) {
        productSelect.value = selectedProduct;
    }
}

function renderCategoriesTable() {
    const tbody = document.getElementById('categories-table-body');
    tbody.replaceChildren();

    if (adminCategoriesList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="catalog-empty-state">No hay categorías registradas.</td></tr>`;
        return;
    }

    adminCategoriesList.forEach(category => {
        const productsCount = Number(category.products_count || 0);
        const isActive = category.active == 1;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="cell-product" data-label="Categoría">
                <span class="catalog-product-name">${safeStr(category.name)}</span>
            </td>
            <td data-label="Slug"><span class="catalog-product-sku">${safeStr(category.slug)}</span></td>
            <td data-label="Productos">${productsCount}</td>
            <td data-label="Estado"><span class="${isActive ? 'catalog-badge-active' : 'catalog-badge-inactive'}">${isActive ? 'Activa' : 'Inactiva'}</span></td>
            <td data-label="Acciones">
                <div class="catalog-actions">
                    <button class="btn-outline" data-action="edit-category" data-id="${safeStr(category.id)}" title="Editar categoría">✏️</button>
                    <button class="btn-danger-outline" data-action="delete-category" data-id="${safeStr(category.id)}" title="${productsCount > 0 ? 'Primero reasigna sus productos' : 'Eliminar categoría'}" ${productsCount > 0 ? 'disabled' : ''}>🗑️</button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

const categoryModal = document.getElementById('category-modal');
const categoryForm = document.getElementById('category-form');
let categoryAddOnConfiguration = [];

function closeCategoryModal() {
    categoryModal.classList.remove('active');
}

document.getElementById('btn-new-category').addEventListener('click', async () => {
    categoryForm.reset();
    document.getElementById('category-id').value = '';
    document.getElementById('category-active').checked = true;
    document.getElementById('category-modal-title').textContent = 'Nueva Categoría';
    await loadCategoryAddOns(null);
    categoryModal.classList.add('active');
    document.getElementById('category-name').focus();
});

document.getElementById('close-category-modal').addEventListener('click', closeCategoryModal);
document.getElementById('btn-cancel-category').addEventListener('click', closeCategoryModal);

window.editCategory = async (id) => {
    const category = adminCategoriesList.find(item => Number(item.id) === id);
    if (!category) return;

    document.getElementById('category-id').value = category.id;
    document.getElementById('category-name').value = category.name;
    document.getElementById('category-active').checked = category.active == 1;
    document.getElementById('category-modal-title').textContent = 'Editar Categoría';
    await loadCategoryAddOns(id);
    categoryModal.classList.add('active');
    document.getElementById('category-name').focus();
};

async function loadCategoryAddOns(categoryId) {
    try {
        if (adminAddOnsList.length === 0) await fetchAdminAddOns();
        categoryAddOnConfiguration = categoryId
            ? await (await authFetch(`${API_BASE}/categories/${categoryId}/add-ons`)).json()
            : adminAddOnsList.map(addOn => ({
                ...addOn, configured: false, visible: false, selected_by_default: false,
                price_override: null, sort_order: addOn.sort_order || 0, override_recipe: false,
            }));
        renderCategoryAddOns();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function renderCategoryAddOns() {
    const container = document.getElementById('category-addons-list');
    container.replaceChildren();
    const configured = categoryAddOnConfiguration.filter(item => item.configured);
    if (configured.length === 0) {
        container.innerHTML = '<div class="configuration-empty">Esta categoría no tiene complementos predeterminados.</div>';
    }
    configured.forEach(item => {
        const row = document.createElement('div');
        row.className = 'configuration-row category-addon-row';
        row.dataset.id = item.id;
        row.innerHTML = `
            <div class="configuration-row__header">
                <strong>${safeStr(item.name)}${item.active === false ? ' (inactivo)' : ''}</strong>
                <span>${formatMoney(item.price_adjustment)}</span>
                <button type="button" class="btn-outline category-addon-remove">Quitar</button>
            </div>
            <div class="configuration-row__controls">
                <label><input class="category-addon-visible" type="checkbox" ${item.visible ? 'checked' : ''}> Visible</label>
                <label><input class="category-addon-default" type="checkbox" ${item.selected_by_default ? 'checked' : ''}> Seleccionado inicialmente</label>
                <label>Precio especial<input class="search-input category-addon-price" type="number" min="0" step="0.01" value="${item.price_override ?? ''}" placeholder="Heredar ${safeStr(item.price_adjustment)}"></label>
                <label>Orden<input class="search-input category-addon-order" type="number" min="0" value="${item.sort_order || 0}"></label>
            </div>`;
        container.appendChild(row);
    });
    const picker = document.getElementById('category-addon-picker');
    const available = categoryAddOnConfiguration.filter(item => item.active !== false && !item.configured);
    picker.replaceChildren(new Option(available.length ? 'Selecciona un complemento' : 'No hay más complementos disponibles', ''));
    available.forEach(item => picker.add(new Option(`${item.name} (${formatMoney(item.price_adjustment)})`, item.id)));
    picker.disabled = available.length === 0;
    document.getElementById('btn-add-category-addon').disabled = available.length === 0;

    updateCategoryAddOnSummary();
    container.querySelectorAll('input').forEach(input => input.addEventListener('change', updateCategoryAddOnSummary));
    container.querySelectorAll('.category-addon-remove').forEach(button => button.addEventListener('click', () => {
        const item = categoryAddOnConfiguration.find(addOn => Number(addOn.id) === Number(button.closest('.category-addon-row').dataset.id));
        if (item) {
            item.configured = false;
            item.visible = false;
            item.selected_by_default = false;
            renderCategoryAddOns();
        }
    }));
}

document.getElementById('btn-add-category-addon').addEventListener('click', () => {
    const picker = document.getElementById('category-addon-picker');
    const item = categoryAddOnConfiguration.find(addOn => Number(addOn.id) === Number(picker.value));
    if (!item) return;
    item.configured = true;
    item.visible = true;
    item.selected_by_default = false;
    renderCategoryAddOns();
});

function updateCategoryAddOnSummary() {
    const rows = [...document.querySelectorAll('.category-addon-row')];
    const defaults = rows.filter(row => row.querySelector('.category-addon-default').checked).length;
    const hidden = rows.filter(row => !row.querySelector('.category-addon-visible').checked).length;
    document.getElementById('category-addons-summary').textContent = `${rows.length} disponibles · ${defaults} seleccionados · ${hidden} ocultos`;
}

function collectCategoryAddOns() {
    return [...document.querySelectorAll('.category-addon-row')]
        .map(row => ({
            add_on_id: Number(row.dataset.id),
            visible: row.querySelector('.category-addon-visible').checked,
            selected_by_default: row.querySelector('.category-addon-default').checked,
            price_override: row.querySelector('.category-addon-price').value === '' ? null : Number(row.querySelector('.category-addon-price').value),
            sort_order: Number(row.querySelector('.category-addon-order').value || 0),
            override_recipe: false,
        }));
}

window.deleteCategory = async (id) => {
    const category = adminCategoriesList.find(item => Number(item.id) === id);
    if (!category || Number(category.products_count || 0) > 0) return;
    if (!window.confirm(`¿Eliminar la categoría "${category.name}"? Esta acción no se puede deshacer.`)) return;

    try {
        await authFetch(`${API_BASE}/categories/${id}`, { method: 'DELETE' });
        showToast('Categoría eliminada correctamente', 'success');
        await fetchCategories();
    } catch (error) {
        showToast(error.message, 'error');
    }
};

categoryForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = document.getElementById('category-id').value;
    const payload = {
        name: document.getElementById('category-name').value.trim(),
        active: document.getElementById('category-active').checked,
        add_ons: collectCategoryAddOns(),
    };
    const saveButton = document.getElementById('btn-save-category');
    saveButton.disabled = true;
    saveButton.textContent = 'Guardando...';

    try {
        const response = await authFetch(id ? `${API_BASE}/categories/${id}` : `${API_BASE}/categories`, {
            method: id ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const savedCategory = await response.json();
        closeCategoryModal();
        showToast(id ? 'Categoría actualizada correctamente' : 'Categoría creada correctamente', 'success');
        await Promise.all([fetchCategories(), fetchAdminProducts(false)]);
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        saveButton.disabled = false;
        saveButton.textContent = 'Guardar Categoría';
    }
});

async function fetchAdminProducts(showLoader = true) {
    if (showLoader) {
        const tbody = document.getElementById('products-table-body');
        tbody.innerHTML = Array(4).fill(0).map(() => `
            <tr class="skeleton-row">
                <td class="cell-product"><div class="skeleton-box" style="width: 200px;"></div></td>
                <td data-label="Categoría"><div class="skeleton-box" style="width: 100px;"></div></td>
                <td data-label="Precio"><div class="skeleton-box" style="width: 60px;"></div></td>
                <td data-label="Estado"><div class="skeleton-box" style="width: 80px; border-radius: 20px;"></div></td>
                <td data-label="Acciones"><div class="skeleton-box" style="width: 80px; margin: 0 auto;"></div></td>
            </tr>
        `).join('');
    }
    
    try {
        const res = await authFetch(`${API_BASE}/products`);
        adminProductsList = await res.json();
        filterAndRenderProducts();
    } catch (error) {
        document.getElementById('products-table-body').innerHTML = `
            <tr><td colspan="5" class="catalog-empty-state">
                <div style="color: var(--color-danger); margin-bottom: 10px; font-size: 2rem;">⚠️</div>
                No se pudo cargar el catálogo. Intenta recargar la página.
            </td></tr>
        `;
    }
}

function filterAndRenderProducts() {
    const searchTerm = document.getElementById('search-products').value.toLowerCase().trim();
    const catFilter = document.getElementById('filter-category').value;
    const statusFilter = document.getElementById('filter-status').value;
    
    let filtered = adminProductsList.filter(p => {
        const matchSearch = p.name.toLowerCase().includes(searchTerm) || p.sku.toLowerCase().includes(searchTerm);
        const matchCat = catFilter === 'all' || p.category_id == catFilter;
        const matchStatus = statusFilter === 'all' || 
                            (statusFilter === 'active' && p.active == 1) || 
                            (statusFilter === 'inactive' && p.active == 0);
        
        return matchSearch && matchCat && matchStatus;
    });
    
    renderProductsTable(filtered);
}

document.getElementById('search-products').addEventListener('input', filterAndRenderProducts);
document.getElementById('filter-category').addEventListener('change', filterAndRenderProducts);
document.getElementById('filter-status').addEventListener('change', filterAndRenderProducts);

function renderProductsTable(list) {
    const tbody = document.getElementById('products-table-body');
    tbody.innerHTML = '';
    
    if (adminProductsList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="catalog-empty-state">No hay productos registrados en la base de datos.</td></tr>`;
        return;
    }
    
    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="catalog-empty-state">No se encontraron productos con esos filtros.</td></tr>`;
        return;
    }
    
    list.forEach(p => {
        const tr = document.createElement('tr');
        const isAct = p.active == 1;
        const badgeClass = isAct && p.is_sellable ? 'catalog-badge-active' : 'catalog-badge-inactive';
        const statusText = !isAct ? 'Inactivo' : (p.is_sellable ? 'Vendible' : 'Sin receta');
        const imgUrl = safeStr(resolveImageUrl(p.image_url));
        
        tr.innerHTML = `
            <td class="cell-product">
                <div class="catalog-product-cell">
                    <img src="${imgUrl}" class="catalog-product-img" alt="${safeStr(p.name)}">
                    <div class="catalog-product-info">
                        <span class="catalog-product-name">${safeStr(p.name)}</span>
                        <span class="catalog-product-sku">SKU: ${safeStr(p.sku)}</span>
                    </div>
                </div>
            </td>
            <td data-label="Categoría">${p.category ? safeStr(p.category.name) : 'N/A'}</td>
            <td data-label="Precio" style="font-family: monospace; font-size: 1.1rem;">$${parseFloat(p.price).toFixed(2)}</td>
            <td data-label="Estado"><span class="${badgeClass}">${statusText}</span></td>
            <td data-label="Acciones" style="text-align: center;">
                <button class="btn-outline" style="padding:6px 12px; font-size:0.9rem;" data-action="edit-product" data-id="${safeStr(p.id)}">✏️ Editar</button>
                <button class="btn-outline" style="padding:6px 12px; font-size:0.9rem; margin-left:5px;" data-action="configure-product" data-id="${safeStr(p.id)}">🧾 Receta</button>
            </td>
        `;
        const image = tr.querySelector('.catalog-product-img');
        image.addEventListener('error', () => image.remove());
        if (!imgUrl) image.remove();
        tbody.appendChild(tr);
    });
}

const prodModal = document.getElementById('product-modal');
const prodForm = document.getElementById('product-form');

document.getElementById('btn-new-product').onclick = () => {
    prodForm.reset();
    document.getElementById('prod-id').value = '';
    document.getElementById('product-modal-title').textContent = 'Nuevo Producto';
    document.getElementById('prod-active').checked = true;
    prodModal.classList.add('active');
};

document.getElementById('close-product-modal').onclick = () => {
    prodModal.classList.remove('active');
};

window.editProduct = (id) => {
    const p = adminProductsList.find(x => x.id === id);
    if (!p) return;
    
    document.getElementById('prod-id').value = p.id;
    document.getElementById('prod-name').value = p.name;
    document.getElementById('prod-sku').value = p.sku;
    document.getElementById('prod-price').value = p.price;
    document.getElementById('prod-category').value = p.category_id;
    document.getElementById('prod-image').value = p.image_url || '';
    document.getElementById('prod-desc').value = p.description || '';
    document.getElementById('prod-active').checked = p.active == 1;
    
    document.getElementById('product-modal-title').textContent = 'Editar Producto';
    prodModal.classList.add('active');
};

prodForm.onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('prod-id').value;
    const payload = {
        name: document.getElementById('prod-name').value,
        sku: document.getElementById('prod-sku').value,
        price: parseFloat(document.getElementById('prod-price').value),
        category_id: parseInt(document.getElementById('prod-category').value),
        image_url: document.getElementById('prod-image').value,
        description: document.getElementById('prod-desc').value,
        active: document.getElementById('prod-active').checked
    };
    
    try {
        const method = id ? 'PUT' : 'POST';
        const url = id ? `${API_BASE}/products/${id}` : `${API_BASE}/products`;
        
        await authFetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        showToast('Producto guardado correctamente', 'success');
        prodModal.classList.remove('active');
        await Promise.all([fetchAdminProducts(true), fetchCategories()]);
    } catch(err) {
        showToast(err.message, 'error');
    }
};

let adminAddOnsList = [];
const productConfigModal = document.getElementById('product-config-modal');

async function fetchAdminAddOns() {
    const response = await authFetch(`${API_BASE}/add-ons`);
    adminAddOnsList = await response.json();
    filterAndRenderAddOns();
}

function filterAndRenderAddOns() {
    const search = document.getElementById('search-addons').value.toLowerCase().trim();
    const status = document.getElementById('filter-addon-status').value;
    const filtered = adminAddOnsList.filter(addOn => {
        const matchesSearch = addOn.name.toLowerCase().includes(search)
            || String(addOn.description || '').toLowerCase().includes(search);
        const matchesStatus = status === 'all'
            || (status === 'active' && addOn.active !== false)
            || (status === 'inactive' && addOn.active === false);
        return matchesSearch && matchesStatus;
    });
    renderAddOnsTable(filtered);
}

function renderAddOnsTable(list) {
    const tbody = document.getElementById('addons-table-body');
    tbody.replaceChildren();
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="catalog-empty-state">No hay complementos que coincidan con los filtros.</td></tr>';
        return;
    }

    list.forEach(addOn => {
        const row = document.createElement('tr');
        const recipe = Array.isArray(addOn.recipe_items) ? addOn.recipe_items : [];
        const consumption = recipe.length
            ? recipe.map(item => `<span>${safeStr(item.ingredient?.name || 'Insumo')} · ${safeNum(item.quantity_required)} ${safeStr(item.ingredient?.unit_of_measure || '')}</span>`).join('')
            : '<span>Sin consumo configurado</span>';
        const productCount = Number(addOn.products_count || 0);
        const categoryCount = Number(addOn.categories_count || 0);
        const ticketCount = Number(addOn.ticket_items_count || 0);
        const active = addOn.active !== false;
        row.innerHTML = `
            <td><div class="catalog-product-info"><span class="catalog-product-name">${safeStr(addOn.name)}</span><span class="catalog-product-sku">${safeStr(addOn.description || 'Sin descripción')}</span></div></td>
            <td>${formatMoney(addOn.price_adjustment)}</td>
            <td><div class="addon-consumption-summary">${consumption}</div></td>
            <td><span class="addon-usage">${categoryCount} categorías · ${productCount} productos · ${ticketCount} ventas</span></td>
            <td><span class="${active ? 'catalog-badge-active' : 'catalog-badge-inactive'}">${active ? (addOn.public_visible !== false ? 'Activo y visible' : 'Activo oculto') : 'Inactivo'}</span></td>
            <td><div class="catalog-actions"></div></td>`;
        const actions = row.querySelector('.catalog-actions');
        const edit = document.createElement('button');
        edit.type = 'button'; edit.className = 'btn-action btn-edit'; edit.textContent = '✏️ Editar';
        edit.addEventListener('click', () => openAddOnModal(addOn));
        const toggle = document.createElement('button');
        toggle.type = 'button'; toggle.className = active ? 'btn-action btn-delete' : 'btn-action btn-edit';
        toggle.textContent = active ? '⏸ Desactivar' : '▶ Activar';
        toggle.addEventListener('click', () => toggleAddOnStatus(addOn));
        actions.append(edit, toggle);
        tbody.appendChild(row);
    });
}

document.getElementById('search-addons').addEventListener('input', filterAndRenderAddOns);
document.getElementById('filter-addon-status').addEventListener('change', filterAndRenderAddOns);

const addOnModal = document.getElementById('addon-modal');

async function openAddOnModal(addOn = null) {
    try {
        if (adminIngredientsList.length === 0) await fetchAdminIngredients(false);
        resetAddOnEditor(addOn);
        document.getElementById('addon-modal-title').textContent = addOn ? 'Editar Complemento' : 'Nuevo Complemento';
        addOnModal.classList.add('active');
        document.getElementById('addon-name').focus();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function closeAddOnModal() {
    addOnModal.classList.remove('active');
}

document.getElementById('btn-new-addon').addEventListener('click', () => openAddOnModal());
document.getElementById('close-addon-modal').addEventListener('click', closeAddOnModal);
document.getElementById('btn-cancel-addon').addEventListener('click', closeAddOnModal);

async function toggleAddOnStatus(addOn) {
    const activating = addOn.active === false;
    if (!activating && !window.confirm(`¿Desactivar el complemento "${addOn.name}"? Dejará de mostrarse en ventas nuevas.`)) return;
    try {
        if (activating) {
            await authFetch(`${API_BASE}/add-ons/${addOn.id}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: true }),
            });
        } else {
            await authFetch(`${API_BASE}/add-ons/${addOn.id}`, { method: 'DELETE' });
        }
        await fetchAdminAddOns();
        showToast(activating ? 'Complemento activado.' : 'Complemento desactivado.', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function addRecipeRow(item = {}) {
    const row = document.createElement('div');
    row.className = 'recipe-row';
    row.style.cssText = 'display:grid; grid-template-columns:2fr 1fr auto; gap:10px; align-items:center;';

    const select = document.createElement('select');
    select.className = 'search-input recipe-ingredient';
    select.required = true;
    select.add(new Option('Selecciona un insumo', ''));
    adminIngredientsList.forEach(ingredient => {
        select.add(new Option(`${ingredient.name} (${ingredient.unit_of_measure})`, ingredient.id));
    });
    select.value = String(item.id || item.ingredient_id || '');

    const quantity = document.createElement('input');
    quantity.className = 'search-input recipe-quantity';
    quantity.type = 'number';
    quantity.min = '0.01';
    quantity.step = '0.01';
    quantity.required = true;
    quantity.placeholder = 'Cantidad';
    quantity.value = item.pivot?.quantity_required || item.quantity_required || '';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn-danger-outline';
    remove.textContent = 'Eliminar';
    remove.addEventListener('click', () => row.remove());

    row.append(select, quantity, remove);
    document.getElementById('recipe-rows').appendChild(row);
}

function addConsumptionRow(container, item = {}) {
    const row = document.createElement('div');
    row.className = 'addon-consumption-row';
    row.style.cssText = 'display:grid; grid-template-columns:2fr 1fr auto; gap:8px;';
    const select = document.createElement('select');
    select.className = 'search-input consumption-ingredient';
    select.add(new Option('Selecciona un insumo', ''));
    adminIngredientsList.forEach(ingredient => select.add(new Option(`${ingredient.name} (${ingredient.unit_of_measure})`, ingredient.id)));
    select.value = String(item.ingredient_id || '');
    const quantity = document.createElement('input');
    quantity.className = 'search-input consumption-quantity';
    quantity.type = 'number'; quantity.min = '.01'; quantity.step = '.01';
    quantity.value = item.quantity_required || '';
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'btn-danger-outline'; remove.textContent = '×';
    remove.addEventListener('click', () => row.remove());
    row.append(select, quantity, remove); container.appendChild(row);
}

function renderProductAddOns(configuration = []) {
    const configured = new Map(configuration.map(item => [Number(item.id), item]));
    const container = document.getElementById('product-addons-list');
    container.replaceChildren();

    const activeAddOns = adminAddOnsList.filter(addOn => addOn.active !== false);
    if (activeAddOns.length === 0) {
        const empty = document.createElement('p');
        empty.textContent = 'No hay complementos activos. Crea el primero abajo.';
        empty.style.color = 'var(--color-text-muted)';
        container.appendChild(empty);
        return;
    }

    activeAddOns.forEach(addOn => {
        const config = configured.get(Number(addOn.id));
        const row = document.createElement('div');
        row.className = 'configuration-row product-addon-row';
        row.dataset.id = addOn.id;
        const header = document.createElement('div');
        header.className = 'configuration-row__header';
        const title = document.createElement('strong'); title.textContent = addOn.name;
        const source = document.createElement('span'); source.className = 'configuration-source';
        source.textContent = config?.category_configured ? `Heredado de categoría${config?.product_configured ? ' · con excepción' : ''}` : (config?.product_configured ? 'Exclusivo del producto' : 'No configurado');
        header.append(title, source);

        const controls = document.createElement('div'); controls.className = 'configuration-row__controls';
        const modeLabel = document.createElement('label'); modeLabel.textContent = 'Comportamiento';
        const mode = document.createElement('select'); mode.className = 'search-input product-addon-mode';
        mode.add(new Option(config?.category_configured ? 'Heredar categoría' : 'No disponible', 'inherit'));
        mode.add(new Option('Mostrar como excepción', 'show'));
        mode.add(new Option('Ocultar como excepción', 'hide'));
        mode.value = config?.product_configured ? (config.visible ? 'show' : 'hide') : 'inherit';
        modeLabel.append(mode);
        const defaultLabel = document.createElement('label');
        const defaultInput = document.createElement('input'); defaultInput.type = 'checkbox'; defaultInput.className = 'product-addon-default'; defaultInput.checked = Boolean(config?.selected_by_default);
        defaultLabel.append(defaultInput, ' Seleccionado inicialmente');
        const priceLabel = document.createElement('label'); priceLabel.textContent = 'Precio especial';
        const priceInput = document.createElement('input'); priceInput.type = 'number'; priceInput.min = '0'; priceInput.step = '.01'; priceInput.className = 'search-input product-addon-price'; priceInput.placeholder = 'Heredar'; priceInput.value = config?.product_price_override ?? '';
        priceLabel.append(priceInput);
        const orderLabel = document.createElement('label'); orderLabel.textContent = 'Orden';
        const orderInput = document.createElement('input'); orderInput.type = 'number'; orderInput.min = '0'; orderInput.className = 'search-input product-addon-order'; orderInput.value = config?.product_sort_override ?? '';
        orderLabel.append(orderInput);
        controls.append(modeLabel, defaultLabel, priceLabel, orderLabel);

        const recipeToggleLabel = document.createElement('label');
        const recipeToggle = document.createElement('input'); recipeToggle.type = 'checkbox'; recipeToggle.className = 'product-addon-recipe-override'; recipeToggle.checked = Boolean(config?.override_recipe);
        recipeToggleLabel.append(recipeToggle, ' Personalizar consumo para este producto');
        const recipeEditor = document.createElement('div'); recipeEditor.className = 'addon-recipe-editor'; recipeEditor.hidden = !recipeToggle.checked;
        const recipeRows = document.createElement('div'); recipeRows.className = 'product-addon-recipe-rows'; recipeRows.style.display = 'grid'; recipeRows.style.gap = '8px';
        (config?.recipe || []).forEach(item => addConsumptionRow(recipeRows, item));
        const addRecipe = document.createElement('button'); addRecipe.type = 'button'; addRecipe.className = 'btn-outline'; addRecipe.textContent = '➕ Insumo';
        addRecipe.addEventListener('click', () => addConsumptionRow(recipeRows));
        recipeToggle.addEventListener('change', () => { recipeEditor.hidden = !recipeToggle.checked; if (recipeToggle.checked && !recipeRows.children.length) addConsumptionRow(recipeRows); });
        recipeEditor.append(recipeRows, addRecipe);
        row.append(header, controls, recipeToggleLabel, recipeEditor);
        container.appendChild(row);
    });
}

function resetAddOnEditor(addOn = null) {
    document.getElementById('addon-id').value = addOn?.id || '';
    document.getElementById('addon-name').value = addOn?.name || '';
    document.getElementById('addon-price').value = addOn?.price_adjustment ?? '';
    document.getElementById('addon-description').value = addOn?.description || '';
    document.getElementById('addon-public-visible').checked = addOn?.public_visible !== false;
    document.getElementById('addon-active').checked = addOn?.active !== false;
    document.getElementById('addon-sort-order').value = addOn?.sort_order || 0;
    const rows = document.getElementById('addon-recipe-rows');
    rows.replaceChildren();
    (addOn?.recipe_items || []).forEach(item => addConsumptionRow(rows, item));
}

document.getElementById('btn-add-addon-recipe-row').addEventListener('click', () => addConsumptionRow(document.getElementById('addon-recipe-rows')));

window.openProductConfiguration = async (id) => {
    const product = adminProductsList.find(item => Number(item.id) === id);
    if (!product) return;

    try {
        await Promise.all([
            adminIngredientsList.length ? Promise.resolve() : fetchAdminIngredients(false),
            fetchAdminAddOns(),
        ]);
        const response = await authFetch(`${API_BASE}/products/${id}/configuration`);
        const configuration = await response.json();

        document.getElementById('config-product-id').value = id;
        document.getElementById('config-product-name').textContent = product.name;
        document.getElementById('recipe-rows').replaceChildren();
        configuration.ingredients.forEach(addRecipeRow);
        if (configuration.ingredients.length === 0) addRecipeRow();
        renderProductAddOns(configuration.add_ons);
        productConfigModal.classList.add('active');
    } catch (error) {
        showToast(error.message, 'error');
    }
};

document.getElementById('close-product-config-modal').addEventListener('click', () => {
    productConfigModal.classList.remove('active');
});
document.getElementById('btn-add-recipe-row').addEventListener('click', () => addRecipeRow());

document.getElementById('btn-save-recipe').addEventListener('click', async () => {
    const productId = document.getElementById('config-product-id').value;
    const ingredients = [...document.querySelectorAll('.recipe-row')].map(row => ({
        ingredient_id: Number(row.querySelector('.recipe-ingredient').value),
        quantity_required: Number(row.querySelector('.recipe-quantity').value),
    }));

    if (ingredients.length === 0 || ingredients.some(item => !item.ingredient_id || item.quantity_required <= 0)) {
        showToast('Completa al menos un insumo y una cantidad válida.', 'warning');
        return;
    }

    try {
        await authFetch(`${API_BASE}/products/${productId}/recipe`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ingredients }),
        });
        showToast('Receta actualizada correctamente.', 'success');
        await fetchAdminProducts(false);
    } catch (error) {
        showToast(error.message, 'error');
    }
});

document.getElementById('btn-save-product-addons').addEventListener('click', async () => {
    const productId = document.getElementById('config-product-id').value;
    const add_ons = [...document.querySelectorAll('.product-addon-row')].flatMap(row => {
        const mode = row.querySelector('.product-addon-mode').value;
        if (mode === 'inherit') return [];
        const overrideRecipe = row.querySelector('.product-addon-recipe-override').checked;
        const recipe = [...row.querySelectorAll('.addon-consumption-row')].map(recipeRow => ({
            ingredient_id: Number(recipeRow.querySelector('.consumption-ingredient').value),
            quantity_required: Number(recipeRow.querySelector('.consumption-quantity').value),
        }));
        return [{
            add_on_id: Number(row.dataset.id), visible: mode === 'show',
            selected_by_default: mode === 'show' ? row.querySelector('.product-addon-default').checked : false,
            price_override: row.querySelector('.product-addon-price').value === '' ? null : Number(row.querySelector('.product-addon-price').value),
            sort_order: row.querySelector('.product-addon-order').value === '' ? null : Number(row.querySelector('.product-addon-order').value),
            override_recipe: overrideRecipe, recipe: overrideRecipe ? recipe : [],
        }];
    });

    try {
        await authFetch(`${API_BASE}/products/${productId}/add-ons`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ add_ons }),
        });
        showToast('Complementos actualizados correctamente.', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
});

document.getElementById('add-on-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = document.getElementById('addon-id').value;
    const recipe = [...document.querySelectorAll('#addon-recipe-rows .addon-consumption-row')].map(row => ({
        ingredient_id: Number(row.querySelector('.consumption-ingredient').value),
        quantity_required: Number(row.querySelector('.consumption-quantity').value),
    }));
    if (recipe.some(item => !item.ingredient_id || item.quantity_required <= 0)) {
        showToast('Completa todos los consumos o elimina las filas vacías.', 'warning');
        return;
    }
    const payload = {
        name: document.getElementById('addon-name').value.trim(),
        price_adjustment: Number(document.getElementById('addon-price').value),
        description: document.getElementById('addon-description').value.trim() || null,
        public_visible: document.getElementById('addon-public-visible').checked,
        active: document.getElementById('addon-active').checked,
        sort_order: Number(document.getElementById('addon-sort-order').value || 0),
        recipe,
    };

    const saveButton = document.getElementById('btn-save-addon');
    saveButton.disabled = true;
    saveButton.textContent = 'Guardando...';

    try {
        const response = await authFetch(id ? `${API_BASE}/add-ons/${id}` : `${API_BASE}/add-ons`, {
            method: id ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const saved = await response.json();
        await fetchAdminAddOns();
        closeAddOnModal();
        showToast(id ? 'Complemento actualizado.' : 'Complemento creado.', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        saveButton.disabled = false;
        saveButton.textContent = 'Guardar Complemento';
    }
});

/* ==========================================
   INVENTORY LOGIC
   ========================================== */

let adminIngredientsList = [];



async function fetchAdminIngredients(showLoader = true) {
    if (showLoader) {
        const tbody = document.getElementById('inventory-table-body');
        tbody.innerHTML = Array(4).fill(0).map(() => `
            <tr class="skeleton-row">
                <td class="cell-product"><div class="skeleton-box" style="width: 200px;"></div></td>
                <td data-label="Stock Actual"><div class="skeleton-box" style="width: 80px;"></div></td>
                <td data-label="Stock Mínimo"><div class="skeleton-box" style="width: 80px;"></div></td>
                <td data-label="Medida"><div class="skeleton-box" style="width: 50px;"></div></td>
                <td data-label="Acciones"><div class="skeleton-box" style="width: 120px; margin: 0 auto;"></div></td>
            </tr>
        `).join('');
    }
    
    try {
        const res = await authFetch(API_BASE + '/ingredients');
        adminIngredientsList = await res.json();
        filterAndRenderInventory();
    } catch (error) {
        document.getElementById('inventory-table-body').innerHTML = `
            <tr><td colspan="5" class="catalog-empty-state">
                <div style="color: var(--color-danger); margin-bottom: 10px; font-size: 2rem;">⚠️</div>
                No se pudo cargar el inventario. Intenta recargar la página.
            </td></tr>
        `;
    }
}

function filterAndRenderInventory() {
    const searchTerm = document.getElementById('search-inventory').value.toLowerCase().trim();
    const statusFilter = document.getElementById('filter-stock-status').value;
    
    let filtered = adminIngredientsList.filter(ing => {
        const matchSearch = ing.name.toLowerCase().includes(searchTerm) || ing.sku.toLowerCase().includes(searchTerm);
        
        const isLowStock = parseFloat(ing.current_stock) <= parseFloat(ing.minimum_stock);
        const matchStatus = statusFilter === 'all' || 
                            (statusFilter === 'low' && isLowStock) || 
                            (statusFilter === 'ok' && !isLowStock);
        
        return matchSearch && matchStatus;
    });
    
    renderInventoryTable(filtered);
}

document.getElementById('search-inventory').addEventListener('input', filterAndRenderInventory);
document.getElementById('filter-stock-status').addEventListener('change', filterAndRenderInventory);

function renderInventoryTable(list) {
    const tbody = document.getElementById('inventory-table-body');
    tbody.innerHTML = '';
    
    if (adminIngredientsList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="catalog-empty-state">No hay insumos registrados en el almacén.</td></tr>';
        return;
    }
    
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="catalog-empty-state">No se encontraron insumos con esos filtros.</td></tr>';
        return;
    }
    
    list.forEach(ing => {
        const tr = document.createElement('tr');
        
        const currentStock = parseFloat(ing.current_stock);
        const minStock = parseFloat(ing.minimum_stock);
        let stockClass = '';
        if (currentStock <= minStock) {
            stockClass = 'stock-critical';
        } else if (currentStock <= minStock * 1.2) {
            stockClass = 'stock-warning';
        }
        
        tr.innerHTML = `
            <td class="cell-product">
                <div class="catalog-product-info">
                    <span class="catalog-product-name">${safeStr(ing.name)}</span>
                    <span class="catalog-product-sku">SKU: ${safeStr(ing.sku)}</span>
                </div>
            </td>
            <td data-label="Stock Actual" class="${stockClass}" style="font-size:1.1rem;">${currentStock.toFixed(2)}</td>
            <td data-label="Stock Mínimo">${minStock.toFixed(2)}</td>
            <td data-label="Medida">${safeStr(ing.unit_of_measure)}</td>
            <td data-label="Acciones" style="text-align: center;">
                <button class="btn-outline" style="padding:6px 10px; font-size:0.85rem; margin-right:5px;" data-action="inventory-transaction" data-id="${safeStr(ing.id)}">🔄 Movimiento</button>
                <button class="btn-outline" style="padding:6px 10px; font-size:0.85rem;" data-action="edit-ingredient" data-id="${safeStr(ing.id)}">✏️ Editar</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// INGREDIENT MODAL LOGIC
const modalIng = document.getElementById('ingredient-modal');
document.getElementById('btn-new-ingredient').addEventListener('click', () => {
    document.getElementById('ingredient-form').reset();
    document.getElementById('ing-id').value = '';
    document.getElementById('ingredient-modal-title').innerText = 'Nuevo Insumo';
    modalIng.classList.add('active');
});

document.getElementById('close-ingredient-modal').addEventListener('click', () => modalIng.classList.remove('active'));
document.getElementById('btn-cancel-ing').addEventListener('click', () => modalIng.classList.remove('active'));

document.getElementById('ingredient-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('ing-id').value;
    
    const payload = {
        sku: document.getElementById('ing-sku').value,
        name: document.getElementById('ing-name').value,
        unit_of_measure: document.getElementById('ing-unit').value,
        minimum_stock: document.getElementById('ing-min-stock').value,
        cost_per_unit: document.getElementById('ing-cost').value
    };
    
    const url = id ? API_BASE + '/ingredients/' + id : API_BASE + '/ingredients';
    const method = id ? 'PUT' : 'POST';
    
    try {
        await authFetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        modalIng.classList.remove('active');
        showToast('Insumo guardado correctamente', 'success');
        fetchAdminIngredients(false);
    } catch(err) {
        showToast(err.message, 'error');
    }
});

window.editIngredient = (id) => {
    const ing = adminIngredientsList.find(i => i.id == id);
    if (!ing) return;
    
    document.getElementById('ingredient-modal-title').innerText = 'Editar Insumo';
    document.getElementById('ing-id').value = ing.id;
    document.getElementById('ing-sku').value = ing.sku;
    document.getElementById('ing-name').value = ing.name;
    document.getElementById('ing-unit').value = ing.unit_of_measure;
    document.getElementById('ing-min-stock').value = ing.minimum_stock;
    document.getElementById('ing-cost').value = ing.cost_per_unit;
    
    modalIng.classList.add('active');
};

// TRANSACTION MODAL LOGIC
const modalTrans = document.getElementById('transaction-modal');

window.openTransactionModal = (id) => {
    const ing = adminIngredientsList.find(i => i.id == id);
    if (!ing) return;
    
    document.getElementById('transaction-form').reset();
    document.getElementById('trans-ing-id').value = ing.id;
    document.getElementById('trans-ing-name').innerText = ing.name;
    document.getElementById('trans-ing-stock').innerText = parseFloat(ing.current_stock).toFixed(2);
    document.getElementById('trans-ing-unit').innerText = ing.unit_of_measure;
    
    // Update label based on select
    document.getElementById('trans-type').dispatchEvent(new Event('change'));
    
    modalTrans.classList.add('active');
};

document.getElementById('close-transaction-modal').addEventListener('click', () => modalTrans.classList.remove('active'));
document.getElementById('btn-cancel-trans').addEventListener('click', () => modalTrans.classList.remove('active'));

document.getElementById('trans-type').addEventListener('change', (e) => {
    const val = e.target.value;
    const lbl = document.getElementById('lbl-trans-action');
    if (val === 'restock') lbl.innerText = 'sumar';
    else if (val === 'waste') lbl.innerText = 'restar (merma)';
    else lbl.innerText = 'ajustar';
});

document.getElementById('transaction-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('trans-ing-id').value;
    const type = document.getElementById('trans-type').value;
    const qty = document.getElementById('trans-qty').value;
    const reason = document.getElementById('trans-reason').value.trim();
    const notes = document.getElementById('trans-notes').value.trim();
    
    try {
        await authFetch(API_BASE + '/inventory/transactions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ingredient_id: id,
                transaction_type: type,
                quantity: qty,
                reason,
                notes: notes || null
            })
        });
        
        modalTrans.classList.remove('active');
        showToast('Movimiento registrado con éxito', 'success');
        fetchAdminIngredients(false);
    } catch(err) {
        showToast(err.message || 'Error al registrar el movimiento', 'error');
    }
});

