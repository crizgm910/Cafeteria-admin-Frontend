const API_BASE = 'http://127.0.0.1:8000/api';

// GLOBALS
let allTickets = [];
let allReservations = [];
let currentFilter = 'all';
let searchQuery = '';
let autoRefreshInterval;

// DOM Elements
const tabOrders = document.getElementById('tab-orders');
const tabReservations = document.getElementById('tab-reservations');
const viewOrders = document.getElementById('view-orders');
const viewReservations = document.getElementById('view-reservations');

const colPending = document.getElementById('col-pending');
const colPreparing = document.getElementById('col-preparing');
const colReady = document.getElementById('col-ready');

const badgePending = document.getElementById('badge-pending');
const badgePreparing = document.getElementById('badge-preparing');
const badgeReady = document.getElementById('badge-ready');

const reservationsList = document.getElementById('reservations-list');

// KPIs Elements
const kpiSales = document.getElementById('kpi-sales');
const kpiCompleted = document.getElementById('kpi-completed');
const kpiPending = document.getElementById('kpi-pending');
const kpiCancelled = document.getElementById('kpi-cancelled');
const kpiAverage = document.getElementById('kpi-average');

// Filter & Search
const searchInput = document.getElementById('search-orders');
const filterBtns = document.querySelectorAll('.filter-btn');

// Modals
const detailModal = document.getElementById('order-detail-modal');
const kitchenModal = document.getElementById('kitchen-ticket-modal');
const closeDetail = document.getElementById('close-detail-modal');
const closeKitchen = document.getElementById('close-kitchen-modal');
const modalDetailBody = document.getElementById('modal-detail-body');
const modalDetailActions = document.getElementById('modal-detail-actions');
const kitchenTicketBody = document.getElementById('kitchen-ticket-body');
const toastContainer = document.getElementById('toast-container');


/* ===========================
   NAVIGATION & UI
=========================== */
tabOrders.onclick = () => {
    tabOrders.classList.add('active');
    tabReservations.classList.remove('active');
    viewOrders.classList.add('active-view');
    viewReservations.classList.remove('active-view');
    fetchTickets();
};

tabReservations.onclick = () => {
    tabReservations.classList.add('active');
    tabOrders.classList.remove('active');
    viewReservations.classList.add('active-view');
    viewOrders.classList.remove('active-view');
    fetchReservations();
};

closeDetail.onclick = () => detailModal.classList.remove('active');
closeKitchen.onclick = () => kitchenModal.classList.remove('active');

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Utility: Safe values
const safeNum = (val) => isNaN(parseFloat(val)) ? 0 : parseFloat(val);
const safeStr = (val, fallback) => (val === null || val === undefined || val === '') ? fallback : val;
const formatMoney = (val) => `$${safeNum(val).toFixed(2)}`;

// Time elapsed string
function timeElapsedString(dateString) {
    if (!dateString) return '';
    const start = new Date(dateString);
    const now = new Date();
    const diff = Math.floor((now - start) / 60000); // mins
    if (diff < 1) return 'Hace menos de 1 min';
    if (diff < 60) return `Hace ${diff} min`;
    const hours = Math.floor(diff / 60);
    return `Hace ${hours} h`;
}

/* ===========================
   TICKETS (ORDERS) LOGIC
=========================== */
async function fetchTickets() {
    try {
        const response = await fetch(`${API_BASE}/tickets`);
        allTickets = await response.json();
        
        // Cache to localStorage
        localStorage.setItem('tgr_tickets', JSON.stringify(allTickets));
        
        applyFiltersAndRender();
        calculateKPIs();
    } catch (error) {
        console.error('API Error, trying local storage...', error);
        const local = localStorage.getItem('tgr_tickets');
        if (local) {
            allTickets = JSON.parse(local);
            showToast('Modo sin conexión activo (Datos cacheados)', 'error');
            applyFiltersAndRender();
            calculateKPIs();
        }
    }
}

// Search and Filter Listeners
searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase();
    applyFiltersAndRender();
});

filterBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        filterBtns.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentFilter = e.target.dataset.filter;
        applyFiltersAndRender();
    });
});

function applyFiltersAndRender() {
    // 1. Filter
    let filtered = allTickets.filter(t => {
        // Text Search
        const searchMatch = 
            (t.ticket_number && t.ticket_number.toLowerCase().includes(searchQuery)) ||
            (t.id && t.id.toString().includes(searchQuery));
            // Add customer name search if present in data...

        // Button Filter
        let filterMatch = true;
        if (currentFilter === 'pickup') filterMatch = t.order_type === 'takeout'; // Map based on your DB
        if (currentFilter === 'local') filterMatch = t.order_type === 'dine_in';
        if (currentFilter === 'delivery') filterMatch = t.order_type === 'delivery';

        return searchMatch && filterMatch;
    });

    // 2. Clear Columns
    colPending.innerHTML = '';
    colPreparing.innerHTML = '';
    colReady.innerHTML = '';
    
    let counts = { pending: 0, preparing: 0, ready: 0 };

    // 3. Render Cards
    filtered.forEach(ticket => {
        if (['pending', 'paid'].includes(ticket.status)) {
            colPending.appendChild(createTicketCard(ticket));
            counts.pending++;
        } else if (ticket.status === 'preparing') {
            colPreparing.appendChild(createTicketCard(ticket));
            counts.preparing++;
        } else if (ticket.status === 'ready') {
            colReady.appendChild(createTicketCard(ticket));
            counts.ready++;
        }
    });

    // Empty States
    if(counts.pending === 0) colPending.innerHTML = '<div class="empty-state">No hay pedidos nuevos.</div>';
    if(counts.preparing === 0) colPreparing.innerHTML = '<div class="empty-state">No hay pedidos en preparación.</div>';
    if(counts.ready === 0) colReady.innerHTML = '<div class="empty-state">No hay pedidos listos.</div>';

    badgePending.textContent = counts.pending;
    badgePreparing.textContent = counts.preparing;
    badgeReady.textContent = counts.ready;
}

function calculateKPIs() {
    let sales = 0;
    let completed = 0;
    let pending = 0;
    let cancelled = 0;

    allTickets.forEach(t => {
        if (t.status === 'delivered') {
            completed++;
            sales += safeNum(t.total);
        } else if (t.status === 'cancelled') {
            cancelled++;
        } else {
            pending++;
        }
    });

    const avg = completed > 0 ? (sales / completed) : 0;

    kpiSales.textContent = formatMoney(sales);
    kpiCompleted.textContent = completed;
    kpiPending.textContent = pending;
    kpiCancelled.textContent = cancelled;
    kpiAverage.textContent = formatMoney(avg);
}

function createTicketCard(ticket) {
    const div = document.createElement('div');
    div.className = 'ticket-card';
    
    // Fallbacks
    const tNum = safeStr(ticket.ticket_number, ticket.id);
    const time = new Date(ticket.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const elapsed = timeElapsedString(ticket.created_at);
    const isOverdue = (new Date() - new Date(ticket.created_at)) > (15 * 60000); // 15 mins
    const totalMoney = formatMoney(ticket.total);
    const itemCount = ticket.items ? ticket.items.length : 0;

    // Service badge
    let serviceBadge = '<span class="badge-service">Local</span>';
    if(ticket.order_type === 'takeout') serviceBadge = '<span class="badge-service" style="background:#2196f3">Llevar</span>';
    
    // Status Logic
    let nextStatus = '';
    let actionText = '';
    if (['pending', 'paid'].includes(ticket.status)) { nextStatus = 'preparing'; actionText = 'Empezar Prep.'; }
    else if (ticket.status === 'preparing') { nextStatus = 'ready'; actionText = 'Marcar Listo'; }
    else if (ticket.status === 'ready') { nextStatus = 'delivered'; actionText = 'Entregar'; }

    div.innerHTML = `
        <div class="ticket-header">
            <div>
                ${serviceBadge} <span class="ticket-id">#${tNum}</span>
            </div>
            <span class="ticket-time">${time}</span>
        </div>
        <div class="ticket-items">
            <div>${itemCount} artículos • ${totalMoney}</div>
            <span class="time-elapsed" style="${isOverdue ? 'color:#ff5252' : 'color:#9e9e9e'}">${elapsed}</span>
        </div>
        <div class="ticket-actions" style="gap:10px;">
            <button class="btn-action" style="background:transparent;border:1px solid var(--color-border);" onclick="openDetailModal('${ticket.id}')">Ver Detalle</button>
            ${actionText ? `<button class="btn-primary" onclick="updateTicketStatus('${ticket.id}', '${nextStatus}')">${actionText}</button>` : ''}
        </div>
    `;
    return div;
}

// Modals Logic
function openDetailModal(id) {
    const ticket = allTickets.find(t => t.id == id || t.ticket_number == id);
    if (!ticket) return;

    document.getElementById('modal-ticket-id').textContent = `#${safeStr(ticket.ticket_number, ticket.id)}`;
    
    let itemsHtml = '';
    if (ticket.items) {
        ticket.items.forEach(item => {
            const prodName = item.product ? item.product.name : 'Producto Desconocido';
            const price = formatMoney(item.subtotal);
            const notes = safeStr(item.notes, '');
            itemsHtml += `
                <div class="detail-product">
                    <div class="detail-product-info">
                        <div class="detail-product-name">${item.quantity}x ${prodName}</div>
                        ${notes ? `<div class="detail-product-meta">Notas: ${notes}</div>` : ''}
                    </div>
                    <div>${price}</div>
                </div>
            `;
        });
    }

    modalDetailBody.innerHTML = `
        <div class="detail-grid">
            <div class="detail-item">
                <span class="detail-label">Cliente</span>
                <span class="detail-value">Cliente Web (Anon)</span> <!-- Requires user integration in DB -->
            </div>
            <div class="detail-item">
                <span class="detail-label">Hora del Pedido</span>
                <span class="detail-value">${new Date(ticket.created_at).toLocaleString()}</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">Método de Pago</span>
                <span class="detail-value">Tarjeta (Pagado)</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">Total</span>
                <span class="detail-value" style="color:var(--color-gold); font-size:1.2rem">${formatMoney(ticket.total)}</span>
            </div>
        </div>
        <div class="detail-products-list">
            <h3 style="margin-bottom:10px; font-size:1rem; color:var(--color-text-muted)">Artículos</h3>
            ${itemsHtml || '<div class="empty-state">Sin artículos registrados.</div>'}
        </div>
    `;

    // Dynamic Actions
    modalDetailActions.innerHTML = `
        <button class="btn-action" style="margin-right:auto" onclick="printKitchenTicket('${ticket.id}')">Imprimir Cocina</button>
        ${ticket.status !== 'cancelled' ? `<button class="btn-danger" onclick="updateTicketStatus('${ticket.id}', 'cancelled')">Cancelar</button>` : ''}
        ${ticket.status === 'preparing' ? `<button class="btn-action" onclick="updateTicketStatus('${ticket.id}', 'pending')">Revertir a Nuevo</button>` : ''}
        ${ticket.status === 'ready' ? `<button class="btn-action" onclick="updateTicketStatus('${ticket.id}', 'preparing')">Revertir a Prep.</button>` : ''}
    `;

    detailModal.classList.add('active');
}

function printKitchenTicket(id) {
    const ticket = allTickets.find(t => t.id == id || t.ticket_number == id);
    if (!ticket) return;

    document.getElementById('kitchen-ticket-id').textContent = `#${safeStr(ticket.ticket_number, ticket.id)}`;
    
    let html = `
        <div style="text-align:center; margin-bottom:20px;">
            <h3>TGR KITCHEN</h3>
            <p>Servicio: ${ticket.order_type === 'takeout' ? 'LLEVAR' : 'LOCAL'}</p>
            <p>${new Date(ticket.created_at).toLocaleTimeString()}</p>
        </div>
        <hr style="margin-bottom:20px;">
    `;

    if (ticket.items) {
        ticket.items.forEach(item => {
            const prodName = item.product ? item.product.name : 'Unknown';
            const notes = safeStr(item.notes, '');
            html += `
                <div style="margin-bottom:15px; border-bottom:1px dashed #ccc; padding-bottom:10px;">
                    <strong style="font-size:1.2rem;">${item.quantity}x ${prodName}</strong>
                    ${notes ? `<br><strong style="background:#000; color:#fff; padding:2px 5px;">NOTA: ${notes}</strong>` : ''}
                </div>
            `;
        });
    }
    
    kitchenTicketBody.innerHTML = html;
    detailModal.classList.remove('active'); // close detail
    kitchenModal.classList.add('active');   // open kitchen print
}

async function updateTicketStatus(id, newStatus) {
    try {
        await fetch(`${API_BASE}/tickets/${id}/status`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ status: newStatus })
        });
        
        detailModal.classList.remove('active');
        showToast(`Pedido #${id} marcado como: ${newStatus}`, 'success');
        
        // Optimistic UI update
        const idx = allTickets.findIndex(t => t.id == id || t.ticket_number == id);
        if(idx > -1) allTickets[idx].status = newStatus;
        applyFiltersAndRender();
        calculateKPIs();
        
        // Sync with backend
        fetchTickets(); 
    } catch (error) {
        console.error('Error updating ticket:', error);
        showToast('Error al actualizar estado', 'error');
    }
}


/* ===========================
   RESERVATIONS LOGIC
=========================== */
async function fetchReservations() {
    try {
        const response = await fetch(`${API_BASE}/reservations`);
        allReservations = await response.json();
        localStorage.setItem('tgr_reservations', JSON.stringify(allReservations));
        renderReservations();
    } catch (error) {
        console.error('Error fetching reservations:', error);
        const local = localStorage.getItem('tgr_reservations');
        if (local) {
            allReservations = JSON.parse(local);
            renderReservations();
        }
    }
}

function renderReservations() {
    reservationsList.innerHTML = '';
    if(allReservations.length === 0) {
        reservationsList.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">No hay reservas registradas.</div>';
        return;
    }

    allReservations.forEach(res => {
        const div = document.createElement('div');
        div.className = 'res-card';
        
        let statusClass = `status-${res.status}`;
        let statusName = res.status;
        if(res.status === 'ready') statusName = 'asistió';
        
        let actionBtns = '';
        if (res.status === 'pending') {
            actionBtns = `
                <button class="btn-primary" onclick="updateResStatus(${res.id}, 'approved')">Aprobar</button>
                <button class="btn-danger" onclick="updateResStatus(${res.id}, 'cancelled')">Rechazar</button>
            `;
        } else if (res.status === 'approved') {
            actionBtns = `
                <button class="btn-primary" onclick="updateResStatus(${res.id}, 'ready')">Marcar Asistencia</button>
            `;
        }

        div.innerHTML = `
            <div class="res-name">${safeStr(res.name, 'Sin Nombre')}</div>
            <div class="res-detail">Fecha: ${res.date}</div>
            <div class="res-detail">Hora: ${res.time}</div>
            <div class="res-detail">Invitados: ${res.guests} personas</div>
            <div class="res-detail">Contacto: ${res.email}</div>
            <div class="res-status ${statusClass}">${statusName.toUpperCase()}</div>
            <div class="res-actions">
                ${actionBtns}
            </div>
        `;
        reservationsList.appendChild(div);
    });
}

async function updateResStatus(id, newStatus) {
    try {
        await fetch(`${API_BASE}/reservations/${id}/status`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ status: newStatus })
        });
        showToast('Reserva actualizada', 'success');
        
        const idx = allReservations.findIndex(r => r.id == id);
        if(idx > -1) allReservations[idx].status = newStatus;
        renderReservations();

        fetchReservations(); // Refresh bg
    } catch (error) {
        console.error('Error updating reservation:', error);
        showToast('Error al actualizar reserva', 'error');
    }
}

// Initialization
fetchTickets();
fetchReservations();

// Auto refresh every 10 seconds
autoRefreshInterval = setInterval(() => {
    fetchTickets();
    if(tabReservations.classList.contains('active')) fetchReservations();
}, 10000);
