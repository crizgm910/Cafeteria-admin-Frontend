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
    let html = `<div class="print-header"><h1>TGR RECEIPT</h1><p style="font-size:1.3rem; font-weight:bold;">PEDIDO #${safeStr(ticket.ticket_number, ticket.id)}</p></div>`;
    if (ticket.items) {
        ticket.items.forEach(i => {
            const pName = i.product ? safeStr(i.product.name, '') : '';
            html += `<div class="print-item" style="display:flex; justify-content:space-between; margin-bottom:5px;"><strong style="font-size:1.2rem;">${i.quantity} x ${pName}</strong><strong style="font-size:1.2rem;">${formatMoney(i.subtotal)}</strong></div>`;
        });
    }
    html += `<div style="border-top:1px dashed #000; margin-top:10px; padding-top:10px; display:flex; justify-content:space-between; font-weight:bold; font-size:1.4rem;"><span>TOTAL</span><span>${formatMoney(ticket.total)}</span></div>`;
    html += `<p style="text-align:center; margin-top:20px; font-size:1.2rem;">¡Gracias por su preferencia!</p>`;
    
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
    document.getElementById('tab-orders').classList.add('active'); document.getElementById('tab-reservations').classList.remove('active');
    document.getElementById('view-orders').classList.add('active-view'); document.getElementById('view-reservations').classList.remove('active-view');
    fetchOrders(true);
};
document.getElementById('tab-reservations').onclick = () => {
    document.getElementById('tab-reservations').classList.add('active'); document.getElementById('tab-orders').classList.remove('active');
    document.getElementById('view-reservations').classList.add('active-view'); document.getElementById('view-orders').classList.remove('active-view');
    fetchReservations(true);
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
    }
}, 10000);
