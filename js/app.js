const API_BASE = 'http://127.0.0.1:8000/api';
let authToken = localStorage.getItem('tgr_auth_token') || null;

// GLOBALS
let allTickets = [];
let allReservations = [];
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

// Auth Logic
if (authToken) {
    loginView.classList.add('hidden');
    dashboardView.classList.remove('hidden');
} else {
    loginView.classList.remove('hidden');
    dashboardView.classList.add('hidden');
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
        const data = await res.json();
        
        if (!res.ok) throw new Error(data.message || 'Error login');
        
        authToken = data.token;
        localStorage.setItem('tgr_auth_token', authToken);
        loginView.classList.add('hidden');
        dashboardView.classList.remove('hidden');
        fetchOrders(true);
        fetchReservations(true);
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
    if (res.status === 401) {
        authToken = null;
        localStorage.removeItem('tgr_auth_token');
        dashboardView.classList.add('hidden');
        loginView.classList.remove('hidden');
        throw new Error('No autorizado');
    }
    return res;
}

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

function logActivity(msg, icon = '🔔') {
    const div = document.createElement('div');
    div.className = 'log-item';
    const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
    div.innerHTML = `<span class="log-time">[${time}]</span> <span>${icon}</span> ${msg}`;
    activityLog.prepend(div);
    if(activityLog.children.length > 30) activityLog.lastChild.remove();
}

/* ==========================================
   UTILITIES
========================================== */
const safeNum = val => isNaN(parseFloat(val)) ? 0 : parseFloat(val);
const safeStr = (val, fallback) => (val === null || val === undefined || val === '') ? fallback : val;
const formatMoney = val => `$${safeNum(val).toFixed(2)}`;

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
}

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
        if (!response.ok) throw new Error('API Error');
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
        localStorage.setItem('tgr_kds_tickets', JSON.stringify(allTickets));
        setConnectionStatus(true);
        lastUpdateDate = new Date();
        renderOrders();
        renderKPIs();
    } catch (error) {
        setConnectionStatus(false);
        const cached = localStorage.getItem('tgr_kds_tickets');
        if (cached && authToken) {
            allTickets = JSON.parse(cached);
            renderOrders();
            renderKPIs();
        }
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
    if (['pending', 'paid'].includes(ticket.status)) btnPrimary = `<button class="btn-fill" onclick="updateOrderStatus('${ticket.id}', 'preparing')">Cocinar</button>`;
    else if (ticket.status === 'preparing') btnPrimary = `<button class="btn-fill" onclick="updateOrderStatus('${ticket.id}', 'ready')">Terminado</button>`;
    else if (ticket.status === 'ready') btnPrimary = `<button class="btn-fill" onclick="updateOrderStatus('${ticket.id}', 'delivered')">Entregar</button>`;

    return `
        <div class="ticket-card ${isOverdue ? 'is-overdue' : ''}">
            <div class="tc-head">
                <div><span class="badge-service" style="background:${sCol}">${sName}</span> <span class="tc-id">#${tNum}</span></div>
                <div class="tc-time ${isOverdue ? 'overdue' : ''}">${time}<br>${timeText}</div>
            </div>
            <div class="tc-tags">${hasNotes ? `<span class="tag tag-notes">NOTAS</span>` : ''}</div>
            <div class="tc-body">${ticket.items ? ticket.items.length : 0} arts • ${formatMoney(ticket.total)}</div>
            <div class="tc-foot">
                <button class="btn-outline" onclick="openOrderDetail('${ticket.id}')">👁️ Detalle</button>
                ${btnPrimary}
            </div>
        </div>
    `;
}

function renderKPIs() {
    let sales = 0, completed = 0, pending = 0, cancelled = 0;
    allTickets.forEach(t => {
        if (t.status === 'delivered') { completed++; sales += safeNum(t.total); }
        else if (t.status === 'cancelled') { cancelled++; }
        else { pending++; }
    });
    const avg = completed > 0 ? (sales / completed) : 0;

    document.querySelectorAll('.kpi-value').forEach(el => el.classList.remove('skeleton-text'));
    document.getElementById('kpi-sales').textContent = formatMoney(sales);
    document.getElementById('kpi-completed').textContent = completed;
    document.getElementById('kpi-pending').textContent = pending;
    document.getElementById('kpi-cancelled').textContent = cancelled;
    document.getElementById('kpi-average').textContent = formatMoney(avg);
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

    let actionsHtml = `<div style="display:flex; gap:10px; margin-right:auto;"><button class="btn-outline" onclick="openKitchenTicket('${ticket.id}')">🖨️ Ticket Cocina</button><button class="btn-outline" onclick="openReceiptTicket('${ticket.id}')">🧾 Ticket Compra</button></div>`;
    if (!['cancelled', 'delivered'].includes(ticket.status)) actionsHtml += `<button class="btn-danger-outline" onclick="updateOrderStatus('${ticket.id}', 'cancelled', true)">❌ Cancelar</button>`;
    if (ticket.status === 'preparing') actionsHtml += `<button class="btn-outline" onclick="updateOrderStatus('${ticket.id}', 'pending', true)">↩️ Revertir a Pendiente</button> <button class="btn-primary" onclick="updateOrderStatus('${ticket.id}', 'ready', true)">✅ Marcar Listo</button>`;
    if (ticket.status === 'ready') actionsHtml += `<button class="btn-outline" onclick="updateOrderStatus('${ticket.id}', 'preparing', true)">↩️ Revertir a Prep.</button> <button class="btn-primary" onclick="updateOrderStatus('${ticket.id}', 'delivered', true)">🛍️ Entregar</button>`;
    
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
        paymentMethodStr = ticket.payments[0].gateway_provider === 'cash' ? 'Efectivo' : 'Tarjeta';
    }
    const customerName = ticket.customer_name ? `<p style="margin:2px 0;"><strong>Cliente:</strong> ${safeStr(ticket.customer_name)}</p>` : '';
    const orderType = ticket.order_type === 'takeaway' ? 'Para llevar' : (ticket.order_type === 'dine_in' ? 'Comer aquí' : 'Local');
    
    let html = `
        <div class="print-header">
            <h1 style="margin-bottom:5px;">TGR RECEIPT</h1>
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
                     html += `<div style="display:flex; justify-content:space-between; font-size:1rem; padding-left:15px; color:#555;"><span>+ ${addon.name}</span></div>`;
                });
            }
            if (i.notes) {
                html += `<div style="font-size:1rem; padding-left:15px; font-style:italic;">Nota: ${safeStr(i.notes)}</div>`;
            }
            html += `<div style="margin-bottom:10px;"></div>`;
        });
    }
    
    const subtotal = ticket.total / 1.16;
    const iva = ticket.total - subtotal;
    
    html += `
        <div style="border-top:1px dashed #000; margin-top:10px; padding-top:10px;">
            <div style="display:flex; justify-content:space-between; font-size:1.1rem;"><span>Subtotal</span><span>${formatMoney(subtotal)}</span></div>
            <div style="display:flex; justify-content:space-between; font-size:1.1rem;"><span>IVA (16%)</span><span>${formatMoney(iva)}</span></div>
            <div style="display:flex; justify-content:space-between; font-weight:bold; font-size:1.4rem; margin-top:5px;"><span>TOTAL</span><span>${formatMoney(ticket.total)}</span></div>
        </div>
        <p style="text-align:center; margin-top:20px; font-size:1.1rem;">¡Gracias por su preferencia!</p>
    `;
    
    document.getElementById('kitchen-ticket-body').innerHTML = html;
    document.getElementById('kitchen-ticket-modal').classList.add('active');
};

window.updateOrderStatus = async (id, newStatus, closeModals = false) => {
    try {
        const res = await authFetch(`${API_BASE}/tickets/${id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        if (!res.ok) throw new Error();
        logActivity(`Pedido #${id} marcado como ${newStatus}`, '✅');
        if (closeModals) document.getElementById('order-detail-modal').classList.remove('active');
        const idx = allTickets.findIndex(t => t.id == id || t.ticket_number == id);
        if(idx > -1) allTickets[idx].status = newStatus;
        renderOrders(); renderKPIs();
        fetchOrders(false);
    } catch (e) {
        showToast('Error de conexión', 'error');
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
        if (!res.ok) throw new Error();
        allReservations = await res.json();
        renderReservations();
    } catch (e) { console.error('Error fetching res'); }
}

function renderReservations() {
    const list = document.getElementById('reservations-list');
    
    // Front-end date logic using local timezone to match user input properly
    const todayObj = new Date();
    const todayStr = todayObj.getFullYear() + '-' + String(todayObj.getMonth() + 1).padStart(2, '0') + '-' + String(todayObj.getDate()).padStart(2, '0');
    
    const tomorrowObj = new Date();
    tomorrowObj.setDate(tomorrowObj.getDate() + 1);
    const tomorrowStr = tomorrowObj.getFullYear() + '-' + String(tomorrowObj.getMonth() + 1).padStart(2, '0') + '-' + String(tomorrowObj.getDate()).padStart(2, '0');
    
    let filtered = allReservations.filter(r => {
        let matchDate = true;
        if(resDateFilter === 'today') matchDate = r.date === todayStr;
        if(resDateFilter === 'tomorrow') matchDate = r.date === tomorrowStr;
        // logic for 'week' can be added. 
        
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
        if (r.status === 'pending') actionBtns = `<button class="btn-primary" onclick="updateResStatus(${r.id}, 'approved')">Aprobar</button> <button class="btn-danger-outline" onclick="updateResStatus(${r.id}, 'cancelled')">Rechazar</button>`;
        else if (r.status === 'approved') actionBtns = `<button class="btn-primary" onclick="updateResStatus(${r.id}, 'ready')">Marcar Asistencia</button>`;
        else if (r.status === 'ready') actionBtns = `<button class="btn-primary" style="background-color: var(--color-success);" onclick="updateResStatus(${r.id}, 'completed')">Finalizar</button>`;

        let mappedStatus = r.status;
        if (r.status === 'pending') mappedStatus = 'Pendiente';
        if (r.status === 'approved') mappedStatus = 'Confirmada';
        if (r.status === 'ready') mappedStatus = 'En mesa';
        if (r.status === 'cancelled') mappedStatus = 'Cancelada';
        if (r.status === 'completed') mappedStatus = 'Finalizada';

        div.innerHTML = `
            <div style="font-size:1.2rem; font-weight:bold; color:var(--color-gold); margin-bottom:8px;">${safeStr(r.name, 'Sin nombre')}</div>
            <div style="font-size:0.9rem; color:var(--color-text-muted); margin-bottom:15px;">
                📅 ${r.date} a las ${r.time} • 👥 ${r.guests} p<br>
                Estado: <strong style="color:var(--color-text); text-transform:uppercase">${mappedStatus}</strong>
            </div>
            <div style="display:flex; gap:10px;">${actionBtns}</div>
        `;
        list.appendChild(div);
    });
}

window.updateResStatus = async (id, status) => {
    try {
        await authFetch(`${API_BASE}/reservations/${id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
        logActivity(`Reserva #${id} actualizada`, '🎫');
        fetchReservations();
    } catch (e) { showToast('Error', 'error'); }
};

/* TAB LOGIC */
document.getElementById('tab-orders').onclick = () => {
    document.getElementById('tab-orders').classList.add('active'); 
    document.getElementById('tab-reservations').classList.remove('active');
    document.getElementById('tab-products').classList.remove('active');
    
    document.getElementById('view-orders').classList.add('active-view'); 
    document.getElementById('view-reservations').classList.remove('active-view');
    document.getElementById('view-products').classList.remove('active-view');
    
    fetchOrders(true);
};

document.getElementById('tab-reservations').onclick = () => {
    document.getElementById('tab-reservations').classList.add('active'); 
    document.getElementById('tab-orders').classList.remove('active');
    document.getElementById('tab-products').classList.remove('active');
    
    document.getElementById('view-reservations').classList.add('active-view'); 
    document.getElementById('view-orders').classList.remove('active-view');
    document.getElementById('view-products').classList.remove('active-view');
    
    fetchReservations(true);
};

document.getElementById('tab-products').onclick = () => {
    document.getElementById('tab-products').classList.add('active'); 
    document.getElementById('tab-orders').classList.remove('active');
    document.getElementById('tab-reservations').classList.remove('active');
    
    document.getElementById('view-products').classList.add('active-view'); 
    document.getElementById('view-orders').classList.remove('active-view');
    document.getElementById('view-reservations').classList.remove('active-view');
    
    fetchAdminProducts(true);
};

/* Mobile Tabs Kanban */
document.querySelectorAll('.mobile-tab').forEach(btn => {
    btn.onclick = (e) => {
        document.querySelectorAll('.mobile-tab').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        document.querySelectorAll('.kanban-col').forEach(c => c.classList.remove('active-mobile'));
        document.getElementById('col-wrap-' + e.target.dataset.col).classList.add('active-mobile');
    };
});

if(authToken) {
    fetchOrders(true);
}
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
        if (!res.ok) throw new Error();
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
        const badgeClass = isAct ? 'catalog-badge-active' : 'catalog-badge-inactive';
        const statusText = isAct ? 'Activo' : 'Inactivo';
        const imgUrl = p.image_url ? `http://127.0.0.1:8080/${safeStr(p.image_url)}` : 'http://127.0.0.1:8080/img/placeholder.png'; // Fallback image if needed, though safeStr handles nulls, a placeholder is better but sticking to provided structure.
        
        tr.innerHTML = `
            <td class="cell-product">
                <div class="catalog-product-cell">
                    <img src="http://127.0.0.1:8080/${safeStr(p.image_url)}" class="catalog-product-img" alt="${safeStr(p.name)}" onerror="this.src=''; this.style.display='none';">
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
                <button class="btn-outline" style="padding:6px 12px; font-size:0.9rem;" onclick="editProduct(${p.id})">✏️ Editar</button>
            </td>
        `;
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
        
        const res = await authFetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.message || 'Error guardando');
        }
        
        showToast('Producto guardado correctamente', '✅');
        prodModal.classList.remove('active');
        fetchAdminProducts(true);
    } catch(err) {
        showToast('Error: ' + err.message);
    }
};

/* ==========================================
   INVENTORY LOGIC
   ========================================== */

let adminIngredientsList = [];

// Tab Logic for Inventory
document.getElementById('tab-inventory').addEventListener('click', () => {
    switchTab('view-inventory');
    fetchAdminIngredients(true);
});

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
        if (!res.ok) throw new Error();
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
                <button class="btn-outline" style="padding:6px 10px; font-size:0.85rem; margin-right:5px;" onclick="openTransactionModal(${ing.id})">🔄 Movimiento</button>
                <button class="btn-outline" style="padding:6px 10px; font-size:0.85rem;" onclick="editIngredient(${ing.id})">✏️ Editar</button>
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
    modalIng.classList.remove('hidden');
});

document.getElementById('close-ingredient-modal').addEventListener('click', () => modalIng.classList.add('hidden'));
document.getElementById('btn-cancel-ing').addEventListener('click', () => modalIng.classList.add('hidden'));

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
    
    // If it's a new ingredient, we set initial stock to 0
    if (!id) {
        payload.current_stock = 0;
    }
    
    const url = id ? API_BASE + '/ingredients/' + id : API_BASE + '/ingredients';
    const method = id ? 'PUT' : 'POST';
    
    try {
        const res = await authFetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if(!res.ok) throw new Error();
        modalIng.classList.add('hidden');
        showToast('Insumo guardado correctamente');
        fetchAdminIngredients(false);
    } catch(err) {
        showToast('Error al guardar el insumo');
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
    
    modalIng.classList.remove('hidden');
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
    
    modalTrans.classList.remove('hidden');
};

document.getElementById('close-transaction-modal').addEventListener('click', () => modalTrans.classList.add('hidden'));
document.getElementById('btn-cancel-trans').addEventListener('click', () => modalTrans.classList.add('hidden'));

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
    
    try {
        const res = await authFetch(API_BASE + '/inventory/transactions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ingredient_id: id,
                transaction_type: type,
                quantity: qty
            })
        });
        
        if(!res.ok) {
            const errData = await res.json();
            throw new Error(errData.message || 'Error');
        }
        
        modalTrans.classList.add('hidden');
        showToast('Movimiento registrado con éxito');
        fetchAdminIngredients(false);
    } catch(err) {
        showToast(err.message || 'Error al registrar el movimiento');
    }
});

