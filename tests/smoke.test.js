const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');

test('no ejecuta handlers inline ni conserva pedidos en localStorage', () => {
    assert.doesNotMatch(html, /\son(?:click|error)=/i);
    assert.doesNotMatch(js, /localStorage\.(?:setItem|getItem)\(['"]tgr_kds_tickets/i);
});

test('sesión temporal y permisos se aplican desde el usuario de Laravel', () => {
    assert.match(js, /sessionStorage\.getItem\('tgr_auth_token'\)/);
    assert.match(js, /currentPermissions = new Set/);
    assert.match(js, /'tab-users': \['users\.manage'\]/);
    assert.match(js, /loginForm\.reset\(\)/);
    assert.match(js, /getElementById\('login-password'\)\.value = ''/);
});

test('controles críticos tienen semántica accesible', () => {
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /role="dialog"/);
    assert.match(css, /\[hidden\]/);
});

test('el frontend no contiene un cliente o credencial de Supabase', () => {
    assert.doesNotMatch(html + js, /supabase-js|service_role|sb_secret_/i);
});

test('el ticket abre el selector de impresión y usa formato térmico', () => {
    assert.match(js, /btn-print-ticket[^\n]*addEventListener\('click',\s*\(\)\s*=>\s*window\.print\(\)\)/);
    assert.match(css, /@page\s*\{[^}]*size:\s*80mm auto;/s);
});

test('categorías y productos administran complementos heredados y consumos', () => {
    assert.match(js, /add_ons:\s*collectCategoryAddOns\(\)/);
    assert.match(js, /btn-add-category-addon/);
    assert.doesNotMatch(js, /category-addon-enabled/);
    assert.match(html, /id="addons-table"/);
    assert.match(html, /id="addon-modal"/);
    assert.match(js, /toggleAddOnStatus/);
    assert.match(js, /filterAndRenderAddOns/);
    assert.match(html, /data-catalog-target="section-categories"/);
    assert.match(html, /data-catalog-target="section-inventory"/);
    assert.match(js, /scrollIntoView\(\{ behavior: 'smooth'/);
    assert.match(js, /product-addon-mode/);
    assert.match(js, /product-addon-recipe-override/);
    assert.match(js, /addon-recipe-rows/);
    assert.match(html, /Complementos predeterminados/);
});

test('inventario registra motivo y no edita existencias desde el CRUD de insumos', () => {
    assert.match(html, /id="trans-reason"[^>]*required/i);
    assert.match(js, /reason,\s*\n\s*notes:/);
    assert.doesNotMatch(js, /payload\.current_stock\s*=/);
});

test('reservaciones administra áreas, mesas, horarios y bloqueos desde Laravel', () => {
    for (const id of ['service-area-form', 'dining-table-form', 'reservation-schedule-form', 'reservation-block-form', 'reservation-availability-form']) {
        assert.match(html, new RegExp(`id="${id}"`));
    }
    for (const resource of ['service-areas', 'dining-tables', 'reservation-schedules', 'reservation-blocks']) {
        assert.match(js, new RegExp(resource));
    }
});

test('POS permite seleccionar complementos efectivos', () => {
    assert.match(js, /pos-addon-checkbox/);
    assert.match(js, /\(item\.addOns \|\| \[\]\)\.map\(addOn => addOn\.id\)/);
    assert.match(html, /id="pos-addon-modal"/);
});
