# Pendientes del frontend administrativo

> Documento histórico de la auditoría del 11 de julio. El estado vigente se controla en `EJECUCION_PLAN_TGR.md`; varios elementos marcados aquí como pendientes ya fueron implementados y probados.

Fecha de revisión: 11 de julio de 2026

Alcance: `CafeteriaAdmin/index.html`, `css/style.css`, `js/app.js` y su integración con la API Laravel.

## Resumen

El panel carga `index.html`, CSS y JavaScript correctamente, pero queda completamente negro porque las dos vistas principales conservan la clase `hidden`. No se detectaron errores de sintaxis JavaScript ni errores en la consola durante la carga inicial.

Además del bloqueo visual, existen riesgos de XSS almacenado, problemas de autenticación, contratos inconsistentes con la API, cálculos incorrectos y varios pendientes de usabilidad y mantenimiento.

## P0 — Bloqueos y seguridad crítica

- [x] **Corregir la pantalla negra del panel.**
  - `index.html` declara `#loginView` y `#dashboardView` con la clase `hidden`.
  - `app.js` alterna la clase `active`, pero nunca elimina `hidden`.
  - `.hidden { display: none !important; }` domina sobre `.auth-view` y `.dashboard-view`.
  - Estado observado sin token: `loginView = "auth-view hidden active"` y `display: none`.
  - Solución recomendada: usar una sola convención de visibilidad. Por ejemplo, quitar `hidden` de la vista que corresponda y agregarlo a la otra, o controlar ambas vistas exclusivamente con una clase `active` cuya regla defina `display`.
  - Criterio de aceptación: sin token se muestra el login; con token válido se muestra el dashboard; con token inválido se vuelve al login.

- [x] **Eliminar XSS almacenado en todos los renderizados con `innerHTML`.**
  - Datos provenientes de la API como nombre del cliente, notas, nombre de producto, SKU, categoría, nombre de reserva e insumos se interpolan directamente en HTML.
  - `safeStr()` no escapa HTML; únicamente reemplaza valores vacíos.
  - Un pedido público puede incluir una nota maliciosa que se ejecutaría en el navegador del empleado.
  - El riesgo aumenta porque el token se almacena en `localStorage`.
  - Usar `textContent`, `createElement`, atributos asignados mediante propiedades y manejadores con `addEventListener`. Si se conserva `innerHTML`, aplicar una sanitización confiable y centralizada.

- [x] **Evitar handlers inline construidos con datos dinámicos.**
  - Hay múltiples `onclick="...${id}..."` generados mediante plantillas.
  - Sustituirlos por `data-id` y listeners registrados desde JavaScript.

- [ ] **Reducir el impacto del robo de sesión.**
  - Evaluar cookies `HttpOnly`, `Secure` y `SameSite` con Sanctum en lugar de guardar el bearer token en `localStorage`.
  - Mientras exista bearer token, aplicar una política CSP estricta y eliminar scripts/handlers inline.
  - Avance: el bearer token se movió de `localStorage` a `sessionStorage`, se elimina cualquier token persistente anterior y ya no existen handlers `onclick`/`onerror` inline. Queda pendiente migrar la autenticación a cookie HttpOnly desde Laravel y definir una CSP compatible con los estilos actuales.

## P1 — Autenticación e integración con la API

- [x] **Implementar cierre de sesión.**
  - No existe botón funcional ni llamada a un endpoint que revoque el token de Sanctum.
  - Limpiar caché local de pedidos al cerrar sesión para evitar mostrar información de otro empleado.

- [x] **Validar el token al iniciar.**
  - La mera existencia de `tgr_auth_token` muestra conceptualmente el dashboard antes de comprobar `/api/user`.
  - Añadir estado inicial de carga y validar la sesión antes de renderizar contenido protegido.

- [x] **Manejar expiración y revocación consistentemente.**
  - `authFetch()` maneja `401`, pero no distingue `403`, `419`, problemas de JSON o respuestas HTML.
  - Centralizar lectura de errores y mostrar el mensaje de validación proporcionado por Laravel.

- [ ] **Agregar roles y permisos visibles.**
  - La interfaz muestra siempre “Barista”.
  - Ocultar o deshabilitar catálogo, precios e inventario según las abilities/rol devueltos por la API.
  - Bloqueado por diseño pendiente: la tabla y el modelo `users` aún no tienen rol ni permisos. El panel ya muestra el nombre real de la sesión en vez de asumir “Barista”.

- [x] **Extraer la URL de la API a configuración.**
  - `http://127.0.0.1:8000/api` está codificado en `app.js`.
  - Crear configuración por ambiente para desarrollo, pruebas y producción.

- [x] **Eliminar URLs de imágenes codificadas.**
  - Las imágenes usan `http://127.0.0.1:8080/` independientemente del ambiente.
  - Existe una variable `imgUrl` calculada pero no utilizada.
  - Definir si `image_url` es absoluta o relativa y resolverla en un único helper.

- [x] **Cargar categorías desde la API.**
  - Las opciones Bebidas Calientes, Bebidas Frías y Postres están escritas directamente en HTML.
  - El CRUD fallará o quedará incompleto cuando cambien las categorías de la base de datos.

## P1 — Pedidos, pagos y métricas

- [ ] **No permitir transiciones arbitrarias de estado desde la UI.**
  - La interfaz permite revertir estados sin conocer las reglas reales del backend.
  - Consumir las acciones permitidas o aplicar una máquina de estados compartida.

- [ ] **Confirmar operaciones destructivas.**
  - Cancelar un pedido se ejecuta inmediatamente.
  - Solicitar confirmación y mostrar si habrá devolución de inventario o reembolso.

- [ ] **Corregir el filtro y etiqueta de pedidos completados.**
  - “Completados de hoy” filtra por estado `delivered`, pero no restringe la fecha al día actual.

- [ ] **Corregir las métricas “de hoy”.**
  - Ventas, completados, pendientes, cancelados y promedio se calculan con todos los tickets recibidos, no solamente con los del día.
  - Idealmente solicitar KPIs agregados al backend para evitar descargar todo el historial.

- [x] **Usar importes fiscales proporcionados por el backend.**
  - El ticket administrativo divide `total / 1.16` aunque la base contiene `subtotal`, `tax` y `discount`.
  - Esto puede presentar IVA ficticio o duplicado.

- [ ] **Corregir el mapeo del tipo de orden.**
  - El backend utiliza `takeout`, pero el recibo comprueba `takeaway`.
  - Un pedido para llevar puede imprimirse como “Local”.

- [ ] **Mostrar el precio de los complementos en el recibo.**
  - Actualmente se lista el nombre, pero no `pivot.price_charged`.

- [ ] **Implementar manejo de concurrencia en actualizaciones.**
  - La UI actualiza el estado local de forma optimista sin versión del ticket.
  - Dos empleados pueden sobrescribir cambios entre refrescos.

- [ ] **Revisar el bloqueo global `isFetching`.**
  - La bandera solo protege pedidos, pero una actualización manual puede quedar ignorada silenciosamente.
  - Mostrar estado de carga o reutilizar la promesa activa.

## P1 — Inventario y catálogo

- [ ] **Impedir cantidades cero o negativas en movimientos.**
  - `#trans-qty` no tiene `min`.
  - Validar según tipo de movimiento antes de enviar y reflejar exactamente las reglas del backend.

- [ ] **Definir claramente el significado de “Ajuste manual”.**
  - La UI dice “ajustar”, pero no explica si la cantidad es stock absoluto o diferencia positiva/negativa.

- [ ] **No ocultar errores de validación.**
  - Los formularios de productos e insumos muestran mensajes genéricos.
  - Presentar errores por campo (`sku` duplicado, precio inválido, categoría inexistente, etc.).

- [ ] **Añadir límites HTML coherentes con Laravel.**
  - Usar `min`, `max`, `maxlength` y `step` para precio, stock, nombre, SKU y costos.

- [ ] **Corregir el fallback de `safeStr`.**
  - Varias llamadas omiten el segundo argumento; un valor vacío puede terminar mostrando `undefined`.
  - Definir `fallback = ''` por defecto.

- [ ] **Corregir el estado vacío del inventario filtrado.**
  - `renderInventoryTable(list)` decide el estado general con `adminIngredientsList.length`, pero debe distinguir correctamente catálogo vacío de filtro sin resultados en todos los flujos.

- [ ] **Implementar paginación o scroll infinito real.**
  - Productos e ingredientes se descargan completos y se renderizan de una sola vez.
  - Añadir paginación en la API, búsqueda remota y carga incremental.

- [ ] **Añadir alta y administración de categorías, recetas y complementos.**
  - El panel permite productos e insumos, pero no vincular recetas ni administrar complementos; por tanto, un producto nuevo puede venderse sin descontar inventario.

- [ ] **Mejorar carga y previsualización de imágenes.**
  - Validar URL, mostrar preview y usar una imagen fallback real.
  - Evitar `onerror` inline y prevenir esquemas/URLs no permitidos.

## P2 — Reservas

- [ ] **Comprobar `response.ok` al cambiar el estado.**
  - `updateResStatus()` espera el `fetch`, pero no valida que la API haya aceptado la actualización.
  - Puede registrar actividad y refrescar aunque Laravel responda 422 o 500.

- [ ] **Implementar el filtro semanal.**
  - El código contiene el comentario “logic for week can be added”, pero el control ya aparece en la interfaz.

- [ ] **Aplicar filtros en backend o unificar su semántica.**
  - La API acepta filtros de fecha/estado, pero el panel descarga todo y vuelve a filtrar.

- [ ] **Mostrar correo y datos de contacto de la reserva.**
  - La tarjeta omite el email necesario para gestionar la solicitud.

- [ ] **Mostrar estados de carga y errores visibles.**
  - Un fallo al cargar reservas solo escribe un mensaje genérico en consola.

## P2 — UX, accesibilidad y responsive

- [x] **Añadir etiquetas `<label>` asociadas a todos los campos críticos.**
  - Login, búsqueda y formularios de catálogo/inventario ya exponen un nombre accesible asociado.

- [x] **Añadir nombres accesibles a botones de cierre.**
  - Los botones “×” tienen `aria-label` contextual.

- [x] **Gestionar foco en modales.**
  - Al abrir se mueve el foco al primer control; Escape cierra, Tab queda contenido y el foco vuelve al disparador.

- [ ] **Evitar depender únicamente de color para estados.**
  - Stock, conexión y estados deben incluir texto/iconografía accesible.

- [ ] **Revisar contraste de textos secundarios y microtexto.**
  - Algunos textos utilizan `--color-border` sobre fondos oscuros y tienen contraste muy bajo.

- [ ] **Hacer visible el estado real de conexión.**
  - El HTML inicia mostrando “Conectado” antes de haber consultado la API.

- [ ] **Corregir navegación móvil.**
  - Verificar header, filtros, tablas, botones flotantes y modales en 320, 375, 768 y 1024 px.
  - El botón “volver arriba” usa un selector que puede devolver `null` y depende de JavaScript inline.

- [ ] **Añadir estados de carga consistentes.**
  - Pedidos, reservas, productos e inventario usan estrategias distintas.
  - Evitar skeletons que permanecen activos cuando no hay sesión o la solicitud falla.

- [ ] **Mejorar mensajes y toasts.**
  - `showToast()` recibe en ocasiones un emoji donde espera un tipo (`success`, `error`, etc.).
  - Los toasts deben usar `role="status"` o `aria-live` y mensajes de error accionables.

- [ ] **Evitar caché administrativo sensible en `localStorage`.**
  - `tgr_kds_tickets` conserva pedidos completos después de cerrar la pestaña.
  - Como mínimo, limpiar al cerrar sesión y marcar claramente cuando se muestran datos sin conexión.

## P2 — Calidad y mantenimiento

- [ ] **Dividir `js/app.js` por módulos.**
  - Separar autenticación, cliente API, pedidos, reservas, catálogo, inventario, render seguro y utilidades.

- [ ] **Eliminar estilos y eventos inline de `index.html`.**
  - Mover presentación a CSS y comportamiento a JavaScript para facilitar CSP, pruebas y mantenimiento.

- [ ] **Normalizar nombres y contratos.**
  - Unificar `takeout/takeaway`, tipos de toast, nombres de campos y estados.

- [ ] **Incorporar lint y formato sin convertir el proyecto en un framework.**
  - Puede mantenerse Vanilla JS usando ESLint/Prettier como herramientas de desarrollo opcionales.

- [ ] **Añadir pruebas automatizadas del frontend.**
  - Login sin token/con token inválido.
  - Carga y error de cada pestaña.
  - Render seguro de datos con HTML malicioso.
  - Transiciones de pedidos.
  - Validación de movimientos de inventario.
  - Filtros de reservas y catálogo.

- [x] **Añadir pruebas end-to-end contra una base de datos de prueba.**
  - Se validaron login, pedido público real, Kitchen, POS, catálogo/categorías, inventario, reportes y usuarios contra un esquema temporal de Supabase.
  - Cancelación y reservas permanecen como recorridos E2E adicionales; su lógica backend sí está cubierta por la suite automatizada.

- [ ] **Documentar ejecución local.**
  - Crear README con puertos, credenciales de desarrollo, configuración de API, dependencias y orden para iniciar servicios.

## Verificación realizada

- `http://127.0.0.1:8081/` responde HTTP 200.
- `css/style.css?v=3` carga y contiene reglas CSS.
- `js/app.js?v=2` carga correctamente.
- `node --check js/app.js` termina sin errores.
- La consola no registra errores durante la carga inicial.
- Vista comprobada a 1280 × 720: fondo `rgb(10, 10, 10)` sin login ni dashboard visibles.
- Causa reproducida tanto para sesión sin token como por inspección de las clases iniciales.

## Orden sugerido de ejecución

1. Corregir visibilidad de login/dashboard y agregar pruebas de sesión.
2. Eliminar XSS y eventos inline; introducir CSP.
3. Implementar logout, validación inicial de token y roles.
4. Corregir contratos de pedidos, impuestos, tipos de orden y reservas.
5. Endurecer formularios de inventario/catálogo y mostrar errores del backend.
6. Implementar paginación, categorías, recetas y complementos.
7. Completar accesibilidad, responsive y pruebas end-to-end.
