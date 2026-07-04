const API_BASE = 'http://127.0.0.1:8000/api';

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

// Navigation
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

// Fetch Tickets
async function fetchTickets() {
    try {
        const response = await fetch(`${API_BASE}/tickets`);
        const tickets = await response.json();
        
        // Clear columns
        colPending.innerHTML = '';
        colPreparing.innerHTML = '';
        colReady.innerHTML = '';
        
        let counts = { pending: 0, preparing: 0, ready: 0 };

        tickets.forEach(ticket => {
            if (['pending', 'paid'].includes(ticket.status)) {
                colPending.appendChild(createTicketCard(ticket, 'Preparar', 'preparing'));
                counts.pending++;
            } else if (ticket.status === 'preparing') {
                colPreparing.appendChild(createTicketCard(ticket, 'Listo', 'ready'));
                counts.preparing++;
            } else if (ticket.status === 'ready') {
                colReady.appendChild(createTicketCard(ticket, 'Entregado', 'delivered'));
                counts.ready++;
            }
        });

        badgePending.textContent = counts.pending;
        badgePreparing.textContent = counts.preparing;
        badgeReady.textContent = counts.ready;
    } catch (error) {
        console.error('Error fetching tickets:', error);
    }
}

function createTicketCard(ticket, actionText, nextStatus) {
    const div = document.createElement('div');
    div.className = 'ticket-card';
    
    let itemsHtml = '';
    if (ticket.items) {
        ticket.items.forEach(item => {
            itemsHtml += `<div class="ticket-item">${item.quantity}x ${item.product ? item.product.name : 'Producto'}</div>`;
        });
    }

    const time = new Date(ticket.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

    div.innerHTML = `
        <div class="ticket-header">
            <span class="ticket-id">#${ticket.ticket_number || ticket.id}</span>
            <span class="ticket-time">${time}</span>
        </div>
        <div class="ticket-items">
            ${itemsHtml}
        </div>
        <div class="ticket-actions">
            <button class="btn-action" onclick="updateTicketStatus('${ticket.id}', '${nextStatus}')">${actionText}</button>
        </div>
    `;
    return div;
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
        fetchTickets(); // Refresh
    } catch (error) {
        console.error('Error updating ticket:', error);
    }
}

// Fetch Reservations
async function fetchReservations() {
    try {
        const response = await fetch(`${API_BASE}/reservations`);
        const reservations = await response.json();
        
        reservationsList.innerHTML = '';
        
        reservations.forEach(res => {
            const div = document.createElement('div');
            div.className = 'res-card';
            
            let statusClass = `status-${res.status}`;
            
            let actionBtns = '';
            if (res.status === 'pending') {
                actionBtns = `
                    <button class="btn-action" onclick="updateResStatus(${res.id}, 'approved')">Aprobar</button>
                    <button class="btn-action" onclick="updateResStatus(${res.id}, 'cancelled')">Rechazar</button>
                `;
            } else if (res.status === 'approved') {
                actionBtns = `
                    <button class="btn-action" onclick="updateResStatus(${res.id}, 'ready')">Marcar Llegada</button>
                `;
            }

            div.innerHTML = `
                <div class="res-name">${res.name}</div>
                <div class="res-detail">Fecha: ${res.date}</div>
                <div class="res-detail">Hora: ${res.time}</div>
                <div class="res-detail">Invitados: ${res.guests}</div>
                <div class="res-detail">Contacto: ${res.email}</div>
                <div class="res-status ${statusClass}">${res.status.toUpperCase()}</div>
                <div class="res-actions">
                    ${actionBtns}
                </div>
            `;
            reservationsList.appendChild(div);
        });
    } catch (error) {
        console.error('Error fetching reservations:', error);
    }
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
        fetchReservations(); // Refresh
    } catch (error) {
        console.error('Error updating reservation:', error);
    }
}

// Initial Load
fetchTickets();
// Auto refresh tickets every 10 seconds
setInterval(fetchTickets, 10000);
