const API_BASE = 'http://127.0.0.1:8000/api';

// GLOBALS
let allTickets = [];
let allReservations = [];
let currentFilter = 'all';
let searchQuery = '';
let isFetching = false;
let autoRefreshInterval;
let lastUpdateDate = new Date();

// DOM Elements
const eTime = document.getElementById('current-time');
const eLastUpdated = document.getElementById('last-updated');
const eConnStatus = document.getElementById('connection-status');
const btnManualRefresh = document.getElementById('btn-manual-refresh');
const toastContainer = document.getElementById('toast-container');

// Tabs & Views
const tabOrders = document.getElementById('tab-orders');
const tabReservations = document.getElementById('tab-reservations');
const viewOrders = document.getElementById('view-orders');
const viewReservations = document.getElementById('view-reservations');

// Mobile Tabs
const mobileTabs = document.querySelectorAll('.mobile-tab');
const kanbanCols = {
    pending: document.getElementById('col-wrap-pending'),
    preparing: document.getElementById('col-wrap-preparing'),
    ready: document.getElementById('col-wrap-ready')
};

// Column Bodies
const colPending = document.getElementById('col-pending');
const colPreparing = document.getElementById('col-preparing');
const colReady = document.getElementById('col-ready');

// Modals
const detailModal = document.getElementById('order-detail-modal');
const kitchenModal = document.getElementById('kitchen-ticket-modal');
const modalDetailBody = document.getElementById('modal-detail-body');
const modalDetailActions = document.getElementById('modal-detail-actions');
const kitchenTicketBody = document.getElementById('kitchen-ticket-body');

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
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function updateClocks() {
    const now = new Date();
    eTime.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    if (lastUpdateDate) {
        const diffSecs = Math.floor((now - lastUpdateDate) / 1000);
        eLastUpdated.textContent = `Actualizado: hace ${diffSecs}s`;
    }
}
setInterval(updateClocks, 1000);

function setConnectionStatus(isOnline) {
    if (isOnline) {
        eConnStatus.innerHTML = '<span class="dot green"></span> Conectado';
    } else {
        eConnStatus.innerHTML = '<span class="dot red"></span> API Desconectada';
    }
}

/* ==========================================
   NAVIGATION & MOBILE
========================================== */
tabOrders.onclick = () => switchView('orders');
tabReservations.onclick = () => switchView('reservations');

function switchView(view) {
    tabOrders.classList.remove('active');
    tabReservations.classList.remove('active');
    viewOrders.classList.remove('active-view');
    viewReservations.classList.remove('active-view');
    
    if (view === 'orders') {
        tabOrders.classList.add('active');
        viewOrders.classList.add('active-view');
        fetchOrders(true);
    } else {
        tabReservations.classList.add('active');
        viewReservations.classList.add('active-view');
        fetchReservations(true);
    }
}

mobileTabs.forEach(btn => {
    btn.onclick = (e) => {
        mobileTabs.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        Object.values(kanbanCols).forEach(col => col.classList.remove('active-mobile'));
        const colKey = e.target.dataset.col;
        kanbanCols[colKey].classList.add('active-mobile');
    };
});

document.getElementById('close-detail-modal').onclick = () => detailModal.classList.remove('active');
document.getElementById('close-kitchen-modal').onclick = () => kitchenModal.classList.remove('active');

/* ==========================================
   ORDERS LOGIC (KDS)
========================================== */
btnManualRefresh.onclick = () => fetchOrders(true);

document.getElementById('search-orders').addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase();
    renderOrders();
});

document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentFilter = e.target.dataset.filter;
        renderOrders();
    });
});

async function fetchOrders(showLoading = false) {
    if (isFetching) return;
    isFetching = true;

    if (showLoading && allTickets.length === 0) {
        // Show skeleton only if empty
        const skeletons = '<div class="skeleton-card"></div><div class="skeleton-card"></div>';
        colPending.innerHTML = skeletons;
        colPreparing.innerHTML = skeletons;
        colReady.innerHTML = skeletons;
    }

    try {
        const response = await fetch(`${API_BASE}/tickets`);
        if (!response.ok) throw new Error('API Response not OK');
        const newData = await response.json();
        
        // Check for new orders to toast
        if (allTickets.length > 0) {
            const newIds = newData.map(t => t.id);
            const oldIds = allTickets.map(t => t.id);
            const freshlyAdded = newIds.filter(id => !oldIds.includes(id));
            if (freshlyAdded.length > 0) showToast(`${freshlyAdded.length} nuevo(s) pedido(s) recibido(s)`, 'success');
        }

        allTickets = newData;
        localStorage.setItem('tgr_kds_tickets', JSON.stringify(allTickets));
        setConnectionStatus(true);
        lastUpdateDate = new Date();
        renderOrders();
        renderKPIs();
    } catch (error) {
        console.error('Fetch Orders Error:', error);
        setConnectionStatus(false);
        const cached = localStorage.getItem('tgr_kds_tickets');
        if (cached) {
            allTickets = JSON.parse(cached);
            if (showLoading) showToast('Mostrando datos en caché', 'warning');
            renderOrders();
            renderKPIs();
        } else {
            showToast('Error de conexión a la API', 'error');
        }
    } finally {
        isFetching = false;
    }
}

function renderOrders() {
    let counts = { pending: 0, preparing: 0, ready: 0 };
    
    // Filter logic
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

    // To prevent DOM flickering, we will generate HTML strings and then set innerHTML
    // In a real huge app, we'd use virtual DOM (React/Vue), but string building is fast enough for Vanilla
    let htmlPending = '';
    let htmlPreparing = '';
    let htmlReady = '';

    filtered.forEach(ticket => {
        const cardHtml = getTicketCardHTML(ticket);
        if (['pending', 'paid'].includes(ticket.status)) {
            htmlPending += cardHtml;
            counts.pending++;
        } else if (ticket.status === 'preparing') {
            htmlPreparing += cardHtml;
            counts.preparing++;
        } else if (ticket.status === 'ready') {
            htmlReady += cardHtml;
            counts.ready++;
        }
    });

    colPending.innerHTML = counts.pending > 0 ? htmlPending : '<div class="empty-state"><div class="empty-icon">📝</div>No hay pedidos nuevos.<br><small>Los pedidos confirmados aparecerán aquí automáticamente.</small></div>';
    colPreparing.innerHTML = counts.preparing > 0 ? htmlPreparing : '<div class="empty-state"><div class="empty-icon">🍳</div>No hay pedidos en preparación.<br><small>Cuando un pedido sea aceptado, se moverá a esta columna.</small></div>';
    colReady.innerHTML = counts.ready > 0 ? htmlReady : '<div class="empty-state"><div class="empty-icon">🛍️</div>No hay pedidos listos.<br><small>Los pedidos terminados aparecerán aquí para entrega.</small></div>';

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
    const totalMoney = formatMoney(ticket.total);
    const itemCount = ticket.items ? ticket.items.length : 0;
    
    const diffMins = Math.floor((new Date() - new Date(ticket.created_at)) / 60000);
    const isOverdue = diffMins >= 15;
    const timeText = diffMins < 1 ? 'Ahora' : `Hace ${diffMins} min`;

    let serviceName = 'Local'; let serviceColor = '#4caf50';
    if(ticket.order_type === 'takeout') { serviceName = 'Llevar'; serviceColor = '#2196f3'; }
    else if(ticket.order_type === 'delivery') { serviceName = 'Envío'; serviceColor = '#9c27b0'; }

    let hasNotes = false;
    if (ticket.items) hasNotes = ticket.items.some(i => i.notes && i.notes.trim() !== '');

    let btnPrimary = '';
    if (['pending', 'paid'].includes(ticket.status)) btnPrimary = `<button class="btn-fill" onclick="updateOrderStatus('${ticket.id}', 'preparing')">Aceptar (Cocinar)</button>`;
    else if (ticket.status === 'preparing') btnPrimary = `<button class="btn-fill" onclick="updateOrderStatus('${ticket.id}', 'ready')">Marcar Listo</button>`;
    else if (ticket.status === 'ready') btnPrimary = `<button class="btn-fill" onclick="updateOrderStatus('${ticket.id}', 'delivered')">Entregar Cliente</button>`;

    return `
        <div class="ticket-card ${isOverdue ? 'is-overdue' : ''}">
            <div class="tc-head">
                <div>
                    <span class="badge-service" style="background:${serviceColor}">${serviceName}</span>
                    <span class="tc-id">#${tNum}</span>
                </div>
                <div class="tc-time ${isOverdue ? 'overdue' : ''}">
                    ${time}<br>${timeText}
                </div>
            </div>
            <div class="tc-tags">
                ${hasNotes ? `<span class="tag tag-notes">NOTAS ESPECIALES</span>` : ''}
            </div>
            <div class="tc-body">
                ${itemCount} artículos • ${totalMoney}
            </div>
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

    // Remove skeleton class
    document.querySelectorAll('.kpi-value').forEach(el => el.classList.remove('skeleton-text'));
    
    document.getElementById('kpi-sales').textContent = formatMoney(sales);
    document.getElementById('kpi-completed').textContent = completed;
    document.getElementById('kpi-pending').textContent = pending;
    document.getElementById('kpi-cancelled').textContent = cancelled;
    document.getElementById('kpi-average').textContent = formatMoney(avg);
}

/* ==========================================
   ORDER ACTIONS & MODALS
========================================== */
window.openOrderDetail = (id) => {
    const ticket = allTickets.find(t => t.id == id || t.ticket_number == id);
    if (!ticket) return;

    document.getElementById('modal-ticket-id').textContent = `#${safeStr(ticket.ticket_number, ticket.id)}`;
    
    let itemsHtml = '';
    if (ticket.items) {
        ticket.items.forEach(item => {
            const pName = item.product ? safeStr(item.product.name, 'Desconocido') : 'Desconocido';
            const notes = safeStr(item.notes, '');
            itemsHtml += `
                <div class="detail-product">
                    <div class="detail-product-info">
                        <div class="detail-product-name">${item.quantity}x ${pName}</div>
                        ${notes ? `<div class="detail-product-meta">📝 ${notes}</div>` : ''}
                    </div>
                    <div>${formatMoney(item.subtotal)}</div>
                </div>
            `;
        });
    }

    modalDetailBody.innerHTML = `
        <div class="detail-grid">
            <div class="detail-item"><span class="detail-label">Cliente</span><span class="detail-value">Web Cliente</span></div>
            <div class="detail-item"><span class="detail-label">Hora Pedido</span><span class="detail-value">${new Date(ticket.created_at).toLocaleString()}</span></div>
            <div class="detail-item"><span class="detail-label">Servicio</span><span class="detail-value" style="text-transform:uppercase">${safeStr(ticket.order_type, 'Local')}</span></div>
            <div class="detail-item"><span class="detail-label">Pago</span><span class="detail-value">Confirmado</span></div>
            <div class="detail-item"><span class="detail-label">Estado</span><span class="detail-value" style="text-transform:uppercase; color:var(--color-info)">${ticket.status}</span></div>
            <div class="detail-item"><span class="detail-label">Total Neto</span><span class="detail-value" style="color:var(--color-gold); font-size:1.2rem">${formatMoney(ticket.total)}</span></div>
        </div>
        <div class="detail-products-list">
            <h3 style="margin-bottom:10px; font-size:0.9rem; color:var(--color-text-muted); text-transform:uppercase;">Artículos del Pedido</h3>
            ${itemsHtml || '<div class="empty-state">No hay artículos</div>'}
        </div>
    `;

    // Dynamic actions based on status
    let actionsHtml = `<button class="btn-outline" style="margin-right:auto" onclick="openKitchenTicket('${ticket.id}')">🖨️ Ticket Cocina</button>`;
    
    if (ticket.status !== 'cancelled' && ticket.status !== 'delivered') {
        actionsHtml += `<button class="btn-danger-outline" onclick="updateOrderStatus('${ticket.id}', 'cancelled', true)">❌ Cancelar Pedido</button>`;
    }
    if (ticket.status === 'preparing') {
        actionsHtml += `<button class="btn-outline" onclick="updateOrderStatus('${ticket.id}', 'pending', true)">↩️ Revertir a Pendiente</button>`;
        actionsHtml += `<button class="btn-primary" onclick="updateOrderStatus('${ticket.id}', 'ready', true)">✅ Marcar Listo</button>`;
    }
    if (ticket.status === 'ready') {
        actionsHtml += `<button class="btn-outline" onclick="updateOrderStatus('${ticket.id}', 'preparing', true)">↩️ Revertir a Prep.</button>`;
        actionsHtml += `<button class="btn-primary" onclick="updateOrderStatus('${ticket.id}', 'delivered', true)">🛍️ Entregar al Cliente</button>`;
    }
    
    modalDetailActions.innerHTML = actionsHtml;
    detailModal.classList.add('active');
};

window.openKitchenTicket = (id) => {
    const ticket = allTickets.find(t => t.id == id || t.ticket_number == id);
    if (!ticket) return;

    let html = `
        <div class="print-header">
            <h1 style="margin-bottom:5px;">TGR KITCHEN</h1>
            <p style="font-size:1.3rem; font-weight:bold;">PEDIDO #${safeStr(ticket.ticket_number, ticket.id)}</p>
            <p>Servicio: ${String(ticket.order_type).toUpperCase()}</p>
            <p>Hora: ${new Date(ticket.created_at).toLocaleTimeString()}</p>
        </div>
    `;

    if (ticket.items) {
        ticket.items.forEach(item => {
            const pName = item.product ? safeStr(item.product.name, 'Unknown') : 'Unknown';
            const notes = safeStr(item.notes, '');
            html += `
                <div class="print-item">
                    <strong style="font-size:1.4rem;">${item.quantity} x ${pName}</strong>
                    ${notes ? `<br><span class="print-note">ATENCIÓN: ${notes}</span>` : ''}
                </div>
            `;
        });
    }

    kitchenTicketBody.innerHTML = html;
    detailModal.classList.remove('active');
    kitchenModal.classList.add('active');
};

window.updateOrderStatus = async (id, newStatus, closeModals = false) => {
    try {
        const res = await fetch(`${API_BASE}/tickets/${id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        if (!res.ok) throw new Error('Failed API call');

        showToast(`Pedido actualizado: ${newStatus.toUpperCase()}`, 'success');
        if (closeModals) detailModal.classList.remove('active');

        // Optimistic UI update
        const idx = allTickets.findIndex(t => t.id == id || t.ticket_number == id);
        if(idx > -1) allTickets[idx].status = newStatus;
        renderOrders();
        renderKPIs();

        // Background sync
        fetchOrders(false);
    } catch (e) {
        console.error(e);
        showToast('Error al actualizar pedido. Verifica la red.', 'error');
    }
};

/* ==========================================
   RESERVATIONS
========================================== */
async function fetchReservations(showLoading = false) {
    if (isFetching) return;
    try {
        const res = await fetch(`${API_BASE}/reservations`);
        if (!res.ok) throw new Error();
        allReservations = await res.json();
        renderReservations();
    } catch (e) {
        showToast('Error conectando a API Reservas', 'error');
    }
}

function renderReservations() {
    const list = document.getElementById('reservations-list');
    list.innerHTML = '';
    
    if (allReservations.length === 0) {
        list.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><div class="empty-icon">📅</div>No hay reservas registradas.</div>';
        return;
    }

    allReservations.forEach(r => {
        const div = document.createElement('div');
        div.className = 'res-card';
        
        let actionBtns = '';
        if (r.status === 'pending') {
            actionBtns = `
                <button class="btn-primary" onclick="updateResStatus(${r.id}, 'approved')">Aprobar</button>
                <button class="btn-danger-outline" onclick="updateResStatus(${r.id}, 'cancelled')">Rechazar</button>
            `;
        } else if (r.status === 'approved') {
            actionBtns = `<button class="btn-primary" onclick="updateResStatus(${r.id}, 'ready')">Marcar Asistencia</button>`;
        }

        div.innerHTML = `
            <div style="font-size:1.2rem; font-weight:bold; color:var(--color-gold); margin-bottom:8px;">${safeStr(r.name, 'Sin nombre')}</div>
            <div style="font-size:0.9rem; color:var(--color-text-muted); margin-bottom:15px;">
                📅 ${r.date} a las ${r.time}<br>
                👥 ${r.guests} personas<br>
                ✉️ ${r.email}<br>
                Estado: <strong style="color:var(--color-text); text-transform:uppercase">${r.status}</strong>
            </div>
            <div style="display:flex; gap:10px; margin-top:auto;">${actionBtns}</div>
        `;
        list.appendChild(div);
    });
}

window.updateResStatus = async (id, status) => {
    try {
        await fetch(`${API_BASE}/reservations/${id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        showToast('Reserva actualizada', 'success');
        fetchReservations();
    } catch (e) {
        showToast('Error al actualizar reserva', 'error');
    }
};

/* ==========================================
   INIT & INTERVALS
========================================== */
fetchOrders(true);

// Auto-refresh every 10 seconds without blocking UI or showing loader
autoRefreshInterval = setInterval(() => {
    if (tabOrders.classList.contains('active')) fetchOrders(false);
    if (tabReservations.classList.contains('active')) fetchReservations(false);
}, 10000);
