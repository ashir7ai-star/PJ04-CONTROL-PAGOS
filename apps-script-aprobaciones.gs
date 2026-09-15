// ══════════════════════════════════════════════════════════════════════════
// PJ04 CONTROL DE PAGOS — Backend del módulo "Aprobaciones"
// Google Apps Script (NO usa n8n).
//
// CÓMO INSTALARLO:
//   1. Abre el Google Sheet "CONTROL DE PAGOS" → Extensiones → Apps Script.
//   2. PEGA este código AL FINAL del archivo existente (debajo de las funciones
//      de reportes diario/mensual). No borres lo que ya está.
//   3. Guarda (Ctrl+S).
//   4. Deploy → New deployment → tipo "Web app":
//        - Execute as:      Me
//        - Who has access:  Anyone
//      → Deploy → autoriza los permisos que pida.
//   5. Copia la URL que termina en /exec y pégala en index.html, en la
//      constante APPS_SCRIPT_URL.
//
// IMPORTANTE: cada vez que edites este código, los cambios NO llegan solos a
// la app. Hay que ir a Deploy → Manage deployments → ✏️ (editar) →
// Version: "New version" → Deploy. Si no, la app sigue usando la versión vieja.
// ══════════════════════════════════════════════════════════════════════════

const NOMBRE_HOJA_SOLICITUDES = 'SOLICITUDES DE APROBACION';
const NOMBRE_CARPETA_DRIVE    = 'PJ04 FACTURAS';
const CORREOS_ADMIN           = ['nathan@ylevigroup.com', 'joseph@ylevigroup.com'];
const ZONA_HORARIA            = 'America/Bogota';

const ENCABEZADOS_SOLICITUDES = [
  'ID SOLICITUD', 'FECHA SOLICITUD', 'EMPRESA', 'TIPO DE PAGO', 'NOMBRE DEL PAGO',
  'PROVEEDOR', 'FECHA DE PAGO', 'VALOR', 'SOLICITADO POR', 'CORREO', 'NOTAS',
  'URL ARCHIVO', 'ESTADO', 'REVISADO POR', 'FECHA DECISION', 'COMENTARIO'
];

// ─── Puntos de entrada del Web App ────────────────────────────────────────

function doGet(e) {
  const accion = e.parameter.action;
  if (accion === 'consultar_solicitudes') return respuestaJson_(consultarSolicitudes_());
  return respuestaJson_({ status: 'error', message: 'Acción no reconocida: ' + accion });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return respuestaJson_({ status: 'error', message: 'JSON inválido' });
  }

  try {
    if (body.action === 'solicitar_aprobacion') return respuestaJson_(crearSolicitud_(body));
    if (body.action === 'decidir_solicitud')    return respuestaJson_(decidirSolicitud_(body));
    return respuestaJson_({ status: 'error', message: 'Acción no reconocida: ' + body.action });
  } catch (err) {
    return respuestaJson_({ status: 'error', message: String(err) });
  }
}

function respuestaJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── Helpers de hoja y Drive ──────────────────────────────────────────────

// Devuelve la pestaña de solicitudes; la crea con encabezados si no existe.
function hojaSolicitudes_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = ss.getSheetByName(NOMBRE_HOJA_SOLICITUDES);
  if (!hoja) {
    hoja = ss.insertSheet(NOMBRE_HOJA_SOLICITUDES);
    hoja.getRange(1, 1, 1, ENCABEZADOS_SOLICITUDES.length)
        .setValues([ENCABEZADOS_SOLICITUDES])
        .setFontWeight('bold');
    hoja.setFrozenRows(1);
  }
  return hoja;
}

function carpetaFacturas_() {
  const carpetas = DriveApp.getFoldersByName(NOMBRE_CARPETA_DRIVE);
  return carpetas.hasNext() ? carpetas.next() : DriveApp.createFolder(NOMBRE_CARPETA_DRIVE);
}

// Escribe una fila usando los encabezados reales de la hoja, así el orden de
// las columnas puede cambiar sin romper nada.
function agregarFilaPorEncabezados_(hoja, datos) {
  const encabezados = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
  const fila = encabezados.map(h => (datos[h] !== undefined ? datos[h] : ''));
  hoja.appendRow(fila);
}

function subirArchivos_(archivos) {
  if (!archivos || archivos.length === 0) return '';
  const carpeta = carpetaFacturas_();
  const links = archivos.map(a => {
    const blob = Utilities.newBlob(
      Utilities.base64Decode(a.datos),
      a.tipo || 'application/octet-stream',
      a.nombre || 'archivo'
    );
    const archivo = carpeta.createFile(blob);
    archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return archivo.getUrl();
  });
  return links.join('\n');
}

function formatoMoneda_(valor) {
  const n = Number(String(valor).replace(/\./g, '')) || 0;
  return '$' + n.toLocaleString('es-CO');
}

function etiquetaTipo_(tipo) {
  const t = String(tipo || '').toLowerCase();
  if (t.indexOf('impuesto') !== -1) return 'Pago Impuestos';
  if (t.indexOf('viatic')   !== -1) return 'Viáticos';
  if (t.indexOf('caja')     !== -1) return 'Caja Menor';
  if (t.indexOf('pago')     !== -1) return 'Pago a Proveedor';
  if (t === 'compra')               return 'Compra';
  if (t === 'venta')                return 'Venta';
  return tipo || '—';
}

// ─── Plantilla HTML de correo ─────────────────────────────────────────────

const URL_APP = 'https://ashir7ai-star.github.io/PJ04-CONTROL-PAGOS/';

function filaDetalle_(etiqueta, valor) {
  if (!valor) return '';
  return '<tr>' +
    '<td style="padding:9px 0;border-bottom:1px solid #ececed;color:#6e6e73;font-size:13px;width:38%;vertical-align:top;">' + etiqueta + '</td>' +
    '<td style="padding:9px 0;border-bottom:1px solid #ececed;color:#1d1d1f;font-size:13px;font-weight:500;">' + valor + '</td>' +
    '</tr>';
}

function enlacesArchivos_(urlArchivo) {
  if (!urlArchivo) return '';
  const links = String(urlArchivo).split('\n').filter(String);
  return links.map((u, i) =>
    '<a href="' + u + '" style="color:#0071e3;text-decoration:none;">Ver documento' + (links.length > 1 ? ' ' + (i + 1) : '') + '</a>'
  ).join('&nbsp;·&nbsp;');
}

// Arma el correo completo. color = acento del encabezado; etiqueta = texto del estado.
function plantillaCorreo_(opciones) {
  return '' +
  '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Arial,sans-serif;background:#f5f5f7;padding:24px 12px;">' +
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e0e0e8;">' +

      '<div style="background:#0071e3;padding:20px 24px;">' +
        '<div style="color:#ffffff;font-size:17px;font-weight:700;letter-spacing:-0.02em;">Millennium Energy Co</div>' +
        '<div style="color:rgba(255,255,255,0.82);font-size:12px;margin-top:2px;">Control de Pagos</div>' +
      '</div>' +

      '<div style="padding:24px;">' +
        '<div style="display:inline-block;background:' + opciones.colorFondo + ';color:' + opciones.color + ';font-size:11px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;padding:5px 11px;border-radius:20px;">' + opciones.etiquetaEstado + '</div>' +
        '<div style="font-size:20px;font-weight:700;color:#1d1d1f;margin:14px 0 2px;letter-spacing:-0.02em;">' + opciones.titulo + '</div>' +
        '<div style="font-size:27px;font-weight:700;color:#0071e3;margin-bottom:4px;letter-spacing:-0.02em;">' + opciones.valor + '</div>' +
        (opciones.intro ? '<div style="font-size:14px;color:#3d3d3f;margin:14px 0 4px;line-height:1.5;">' + opciones.intro + '</div>' : '') +

        '<table style="width:100%;border-collapse:collapse;margin-top:16px;">' + opciones.detalles + '</table>' +

        (opciones.aviso ? '<div style="margin-top:18px;background:#fafafa;border-left:3px solid ' + opciones.color + ';border-radius:6px;padding:12px 14px;font-size:13px;color:#3d3d3f;line-height:1.5;">' + opciones.aviso + '</div>' : '') +

        (opciones.boton ?
          '<div style="margin-top:22px;">' +
            '<a href="' + URL_APP + '" style="display:inline-block;background:#0071e3;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:9px;font-size:14px;font-weight:600;">' + opciones.boton + '</a>' +
          '</div>' : '') +
      '</div>' +

      '<div style="padding:14px 24px;background:#fafafa;border-top:1px solid #ececed;font-size:11px;color:#8e8e93;line-height:1.5;">' +
        'Correo automático del sistema de Control de Pagos.<br>Desarrollado por JND AI SYSTEMS' +
      '</div>' +

    '</div>' +
  '</div>';
}

// ─── 1) Crear solicitud ───────────────────────────────────────────────────

function crearSolicitud_(body) {
  const hoja = hojaSolicitudes_();
  const id   = body.fecha_envio || new Date().toISOString();

  const fila = {
    'ID SOLICITUD':    id,
    'FECHA SOLICITUD': id,
    'EMPRESA':         body.empresa || '',
    'TIPO DE PAGO':    body.tipo_factura || '',
    'NOMBRE DEL PAGO': body.nombre_pago || '',
    'PROVEEDOR':       body.proveedor || '',
    'FECHA DE PAGO':   body.fecha_pago || '',
    'VALOR':           body.monto || '',
    'SOLICITADO POR':  body.solicitado_por || '',
    'CORREO':          body.correo || '',
    'NOTAS':           body.notas || '',
    'URL ARCHIVO':     subirArchivos_(body.archivos),
    'ESTADO':          'Pendiente',
    'REVISADO POR':    '',
    'FECHA DECISION':  '',
    'COMENTARIO':      ''
  };

  agregarFilaPorEncabezados_(hoja, fila);
  notificarAdmins_(fila);

  return { status: 'success' };
}

function notificarAdmins_(fila) {
  const asunto = 'Nueva solicitud de aprobación: ' + fila['NOMBRE DEL PAGO'] + ' — ' + formatoMoneda_(fila['VALOR']);

  const detalles =
    filaDetalle_('Empresa',        fila['EMPRESA']) +
    filaDetalle_('Tipo',           etiquetaTipo_(fila['TIPO DE PAGO'])) +
    filaDetalle_('Proveedor',      fila['PROVEEDOR']) +
    filaDetalle_('Fecha de pago',  fila['FECHA DE PAGO']) +
    filaDetalle_('Solicitado por', fila['SOLICITADO POR'] + (fila['CORREO'] ? ' · ' + fila['CORREO'] : '')) +
    filaDetalle_('Notas',          fila['NOTAS']) +
    filaDetalle_('Documentos',     enlacesArchivos_(fila['URL ARCHIVO']));

  const html = plantillaCorreo_({
    color:          '#ff9f0a',
    colorFondo:     'rgba(255,159,10,0.12)',
    etiquetaEstado: 'Pendiente de aprobación',
    titulo:         fila['NOMBRE DEL PAGO'],
    valor:          formatoMoneda_(fila['VALOR']),
    intro:          'Se registró una nueva solicitud que requiere tu revisión.',
    detalles:       detalles,
    boton:          'Revisar solicitud'
  });

  const textoPlano =
    'Nueva solicitud pendiente de aprobación\n\n' +
    fila['NOMBRE DEL PAGO'] + ' — ' + formatoMoneda_(fila['VALOR']) + '\n' +
    'Empresa: ' + fila['EMPRESA'] + '\n' +
    'Tipo: ' + etiquetaTipo_(fila['TIPO DE PAGO']) + '\n' +
    'Proveedor: ' + fila['PROVEEDOR'] + '\n' +
    'Solicitado por: ' + fila['SOLICITADO POR'] + '\n\n' +
    'Revísala en: ' + URL_APP;

  CORREOS_ADMIN.forEach(correo =>
    MailApp.sendEmail({ to: correo, subject: asunto, body: textoPlano, htmlBody: html })
  );
}

// ─── 2) Consultar solicitudes ─────────────────────────────────────────────

function consultarSolicitudes_() {
  const hoja    = hojaSolicitudes_();
  const valores = hoja.getDataRange().getValues();
  if (valores.length < 2) return [];

  const encabezados = valores[0];
  return valores.slice(1)
    .filter(fila => fila.some(v => v !== ''))
    .map(fila => {
      const obj = {};
      encabezados.forEach((h, i) => {
        const v = fila[i];
        obj[h] = (v instanceof Date) ? Utilities.formatDate(v, ZONA_HORARIA, 'yyyy-MM-dd') : v;
      });
      return obj;
    });
}

// ─── 3) Decidir (aprobar / rechazar) ──────────────────────────────────────

function decidirSolicitud_(body) {
  const hoja        = hojaSolicitudes_();
  const valores     = hoja.getDataRange().getValues();
  const encabezados = valores[0];
  const colId       = encabezados.indexOf('ID SOLICITUD');

  let filaIndex = -1;
  for (let i = 1; i < valores.length; i++) {
    if (String(valores[i][colId]) === String(body.id)) { filaIndex = i; break; }
  }
  if (filaIndex === -1) return { status: 'error', message: 'No se encontró la solicitud' };

  const solicitud = {};
  encabezados.forEach((h, i) => solicitud[h] = valores[filaIndex][i]);

  if (String(solicitud['ESTADO']).toLowerCase() !== 'pendiente') {
    return { status: 'error', message: 'Esta solicitud ya fue ' + solicitud['ESTADO'] };
  }

  const aprobado = body.decision === 'aprobado';
  const cambios = {
    'ESTADO':         aprobado ? 'Aprobado' : 'Rechazado',
    'REVISADO POR':   body.revisado_por || '',
    'FECHA DECISION': Utilities.formatDate(new Date(), ZONA_HORARIA, 'dd/MM/yyyy HH:mm'),
    'COMENTARIO':     body.comentario || ''
  };
  Object.keys(cambios).forEach(campo => {
    const col = encabezados.indexOf(campo);
    if (col !== -1) hoja.getRange(filaIndex + 1, col + 1).setValue(cambios[campo]);
    solicitud[campo] = cambios[campo];   // para que el correo salga con los datos ya actualizados
  });

  // Nota: aprobar NO registra nada en la hoja de Control de Pagos.
  // Es solo un visto bueno visible en el módulo de Aprobaciones (decisión del usuario).
  notificarSolicitante_(solicitud, cambios['ESTADO'], body.comentario);

  return { status: 'success' };
}

function notificarSolicitante_(solicitud, estado, comentario) {
  if (!solicitud['CORREO']) return;

  const aprobado = estado === 'Aprobado';
  const asunto   = (aprobado ? 'Solicitud aprobada' : 'Solicitud rechazada') + ': ' + solicitud['NOMBRE DEL PAGO'];

  const detalles =
    filaDetalle_('Empresa',       solicitud['EMPRESA']) +
    filaDetalle_('Tipo',          etiquetaTipo_(solicitud['TIPO DE PAGO'])) +
    filaDetalle_('Proveedor',     solicitud['PROVEEDOR']) +
    filaDetalle_('Fecha de pago', solicitud['FECHA DE PAGO']) +
    filaDetalle_('Revisado por',  solicitud['REVISADO POR']) +
    filaDetalle_('Documentos',    enlacesArchivos_(solicitud['URL ARCHIVO']));

  const html = plantillaCorreo_({
    color:          aprobado ? '#34c759' : '#ff3b30',
    colorFondo:     aprobado ? 'rgba(52,199,89,0.12)' : 'rgba(255,59,48,0.10)',
    etiquetaEstado: aprobado ? 'Aprobada' : 'Rechazada',
    titulo:         solicitud['NOMBRE DEL PAGO'],
    valor:          formatoMoneda_(solicitud['VALOR']),
    intro:          aprobado
      ? 'Tu solicitud fue revisada y cuenta con el visto bueno de la administración.'
      : 'Tu solicitud fue revisada y no fue aprobada.',
    detalles:       detalles,
    aviso:          (!aprobado && comentario) ? '<strong>Motivo:</strong> ' + comentario : ''
  });

  const textoPlano =
    'Tu solicitud "' + solicitud['NOMBRE DEL PAGO'] + '" (' + formatoMoneda_(solicitud['VALOR']) + ') fue ' +
    (aprobado ? 'APROBADA.' : 'RECHAZADA.') +
    (!aprobado && comentario ? '\n\nMotivo: ' + comentario : '');

  MailApp.sendEmail({ to: solicitud['CORREO'], subject: asunto, body: textoPlano, htmlBody: html });
}
