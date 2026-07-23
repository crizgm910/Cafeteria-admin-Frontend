# Prueba de impresión de tickets

## Alcance actual

No existe una impresora térmica disponible. La aceptación se limita a:

1. Abrir el detalle de un pedido.
2. Elegir `Ticket Cocina` o `Ticket Compra`.
3. Pulsar `Imprimir Ticket`.
4. Confirmar que el navegador abre el selector de impresión.
5. Cancelar el selector sin enviar el trabajo a un dispositivo.

El contenido utiliza una página de 80 mm y margen de 4 mm, una base habitual para impresoras térmicas. La Landing genera además un comprobante no fiscal en una ventana separada y solicita la impresión al terminar de cargarlo.

## Pendiente cuando exista impresora

- Instalar el controlador oficial del fabricante.
- Seleccionar el ancho real de papel: 58 mm u 80 mm.
- Comprobar corte, márgenes, densidad, caracteres acentuados y código de página.
- Imprimir ticket de cocina y comprobante de compra con productos, complementos y notas.
- Confirmar que cancelar o reimprimir no modifica pedido, pago ni inventario.
- Registrar modelo, conexión, estación y configuración aprobada.

El comprobante actual no es factura ni CFDI.
