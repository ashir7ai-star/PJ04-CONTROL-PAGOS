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
  const cuerpo =
    'Hay una nueva solicitud de pago pendiente de aprobación.\n\n' +
    'Empresa:        ' + fila['EMPRESA'] + '\n' +
    'Tipo:           ' + fila['TIPO DE PAGO'] + '\n' +
    'Nombre del pago:' + fila['NOMBRE DEL PAGO'] + '\n' +
    'Proveedor:      ' + fila['PROVEEDOR'] + '\n' +
    'Valor:          ' + formatoMoneda_(fila['VALOR']) + '\n' +
    'Fecha de pago:  ' + fila['FECHA DE PAGO'] + '\n' +
    'Solicitado por: ' + fila['SOLICITADO POR'] + ' (' + fila['CORREO'] + ')\n' +
    'Notas:          ' + (fila['NOTAS'] || '—') + '\n' +
    'Archivo(s):     ' + (fila['URL ARCHIVO'] || '—') + '\n\n' +
    'Para aprobarla o rechazarla, entra a la app:\n' +
    'https://ashir7ai-star.github.io/PJ04-CONTROL-PAGOS/  →  Aprobaciones  →  Revisar Solicitudes';

  CORREOS_ADMIN.forEach(correo => MailApp.sendEmail(correo, asunto, cuerpo));
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
  });

  // Nota: aprobar NO registra nada en la hoja de Control de Pagos.
  // Es solo un visto bueno visible en el módulo de Aprobaciones (decisión del usuario).
  notificarSolicitante_(solicitud, cambios['ESTADO'], body.comentario);

  return { status: 'success' };
}

function notificarSolicitante_(solicitud, estado, comentario) {
  if (!solicitud['CORREO']) return;

  const aprobado = estado === 'Aprobado';
  const asunto   = (aprobado ? 'Aprobada' : 'Rechazada') + ': ' + solicitud['NOMBRE DEL PAGO'];

  let cuerpo =
    'Tu solicitud de pago fue ' + (aprobado ? 'APROBADA' : 'RECHAZADA') + '.\n\n' +
    'Nombre del pago: ' + solicitud['NOMBRE DEL PAGO'] + '\n' +
    'Proveedor:       ' + solicitud['PROVEEDOR'] + '\n' +
    'Valor:           ' + formatoMoneda_(solicitud['VALOR']) + '\n';

  if (aprobado) {
    cuerpo += '\nYa cuentas con el visto bueno para proceder.';
  } else if (comentario) {
    cuerpo += '\nMotivo del rechazo: ' + comentario;
  }

  MailApp.sendEmail(solicitud['CORREO'], asunto, cuerpo);
}
