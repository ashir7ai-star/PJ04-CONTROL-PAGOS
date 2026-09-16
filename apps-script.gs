// ══════════════════════════════════════════════════════════════════════════
// PJ04 CONTROL DE PAGOS — Google Apps Script completo
// Copia de referencia de lo que está pegado en: Sheet "CONTROL DE PAGOS"
// → Extensiones → Apps Script.
//
// Contiene dos bloques:
//   A) Reportes automáticos (diario y mensual) — corren por triggers de tiempo.
//   B) Backend del módulo "Aprobaciones" — Web App (doGet/doPost).
//
// ⚠️ Si editas este código en Google, los cambios NO llegan solos a la app web.
//    Hay que ir a: Deploy → Manage deployments → ✏️ → Version: "New version"
//    → Deploy. Si no, la app sigue ejecutando la versión vieja.
// ══════════════════════════════════════════════════════════════════════════


// ══════════════════════════════════════════════════════════════════════════
// A) REPORTES AUTOMÁTICOS (diario / mensual)
// ══════════════════════════════════════════════════════════════════════════

const DESTINATARIOS = ['nathan@ylevigroup.com', 'joseph@ylevigroup.com', 'contabilidad@energy-millennium.com'];
const ZONA = 'America/Bogota';

// Lee TODAS las hojas de pagos y las consolida en un solo listado.
// Los pagos están repartidos por sección (Viáticos, Caja Menor, etc.), así que
// leer solo la primera hoja dejaría los reportes incompletos sin avisar.
function leerDatos_() {
  const hojas = hojasDePagos_();
  const headers = hojas[0].getRange(1, 1, 1, hojas[0].getLastColumn()).getValues()[0];

  const rows = [];
  hojas.forEach(hoja => {
    const values = hoja.getDataRange().getValues();
    if (values.length < 2) return;
    const encHoja = values[0];
    values.slice(1).forEach(fila => {
      if (!fila.some(v => v !== '')) return;
      const obj = {};
      encHoja.forEach((h, i) => obj[h] = fila[i]);
      rows.push(obj);
    });
  });

  return { headers, rows };
}

function parseFechaRegistro_(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  const partes = String(val).split(' ');
  const [d, m, y] = partes[0].split('/').map(Number);
  if (!d || !m || !y) return null;
  return new Date(y, m - 1, d);
}

function mismoDia_(fecha, ref) {
  return !!fecha && fecha.getFullYear() === ref.getFullYear() &&
         fecha.getMonth() === ref.getMonth() && fecha.getDate() === ref.getDate();
}

function mismoMes_(fecha, ref) {
  return !!fecha && fecha.getFullYear() === ref.getFullYear() &&
         fecha.getMonth() === ref.getMonth();
}

// Crea un Sheet temporal con las filas filtradas, lo exporta a PDF+XLSX y lo borra
function generarArchivos_(headers, filas, nombreBase) {
  const temp = SpreadsheetApp.create(nombreBase);
  const hoja = temp.getSheets()[0];
  hoja.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  if (filas.length > 0) hoja.getRange(2, 1, filas.length, headers.length).setValues(filas);
  SpreadsheetApp.flush();

  const tempId = temp.getId();
  const gid = hoja.getSheetId();

  const pdfBlob = UrlFetchApp.fetch(
    `https://docs.google.com/spreadsheets/d/${tempId}/export?format=pdf&gid=${gid}&size=A4&portrait=false&fitw=true&gridlines=true`,
    { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } }
  ).getBlob().setName(`${nombreBase}.pdf`);

  const xlsxBlob = UrlFetchApp.fetch(
    `https://docs.google.com/spreadsheets/d/${tempId}/export?format=xlsx`,
    { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } }
  ).getBlob().setName(`${nombreBase}.xlsx`);

  DriveApp.getFileById(tempId).setTrashed(true);
  return { pdfBlob, xlsxBlob };
}

function totalValor_(headers, filas) {
  const idx = headers.indexOf('VALOR FACTURA');
  if (idx === -1) return 0;
  return filas.reduce((s, f) => s + (parseFloat(f[idx]) || 0), 0);
}

// Trigger: Time-driven → Day timer
function enviarReporteDiario() {
  const hoy = new Date();
  const { headers, rows } = leerDatos_();
  const filtradas = rows.filter(r => mismoDia_(parseFechaRegistro_(r['FECHA REGISTRO']), hoy));
  const filas = filtradas.map(r => headers.map(h => r[h]));

  const fechaTxt = Utilities.formatDate(hoy, ZONA, 'dd/MM/yyyy');
  const { pdfBlob, xlsxBlob } = generarArchivos_(headers, filas, `Reporte_Diario_Pagos_${Utilities.formatDate(hoy, ZONA, 'yyyy-MM-dd')}`);
  const total = totalValor_(headers, filas);

  MailApp.sendEmail({
    to: DESTINATARIOS.join(','),
    subject: `Reporte diario de pagos — ${fechaTxt}`,
    body: filas.length > 0
      ? `Adjunto el reporte de los pagos registrados hoy (${fechaTxt}).\n\nRegistros de hoy: ${filas.length}\nValor total del día: $${total.toLocaleString('es-CO')}\n\nCorreo generado automáticamente.`
      : `Hoy (${fechaTxt}) no se registraron pagos nuevos.\n\nCorreo generado automáticamente.`,
    attachments: [pdfBlob, xlsxBlob]
  });
}

// Trigger: Time-driven → Month timer (día 1). Reporta el mes que acaba de cerrar.
function enviarReporteMensual() {
  const hoy = new Date();
  const refMes = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  const { headers, rows } = leerDatos_();
  const filtradas = rows.filter(r => mismoMes_(parseFechaRegistro_(r['FECHA REGISTRO']), refMes));
  const filas = filtradas.map(r => headers.map(h => r[h]));

  const mesTxt = Utilities.formatDate(refMes, ZONA, 'MMMM yyyy');
  const { pdfBlob, xlsxBlob } = generarArchivos_(headers, filas, `Reporte_Mensual_Pagos_${Utilities.formatDate(refMes, ZONA, 'yyyy-MM')}`);
  const total = totalValor_(headers, filas);

  MailApp.sendEmail({
    to: DESTINATARIOS.join(','),
    subject: `Reporte mensual de pagos — ${mesTxt}`,
    body: `Adjunto el reporte de todos los pagos registrados durante ${mesTxt}.\n\nTotal de registros del mes: ${filas.length}\nValor total del mes: $${total.toLocaleString('es-CO')}\n\nCorreo generado automáticamente.`,
    attachments: [pdfBlob, xlsxBlob]
  });
}


// ══════════════════════════════════════════════════════════════════════════
// C) SECCIONES: cada tipo de pago tiene su propia hoja y su propia carpeta
//
// Regla: sección = hoja = carpeta = (a futuro) permiso.
// La hoja principal (índice 0) guarda Pago a Proveedor, Compra y Venta.
// Las demás se crean solas la primera vez, copiando los encabezados de la principal.
// ══════════════════════════════════════════════════════════════════════════

const SECCIONES = {
  pagos:            { hoja: null,               carpeta: 'PJ04 FACTURAS',         tipos: ['pago_proveedor', 'compra', 'venta'] },
  viaticos:         { hoja: 'Viaticos',         carpeta: 'PJ04 VIATICOS',         tipos: ['viaticos'] },
  caja_menor:       { hoja: 'Caja Menor',       carpeta: 'PJ04 CAJA MENOR',       tipos: ['caja_menor'] },
  impuestos:        { hoja: 'Pago Impuestos',   carpeta: 'PJ04 IMPUESTOS',        tipos: ['impuestos'] },
  seguridad_social: { hoja: 'Seguridad Social', carpeta: 'PJ04 SEGURIDAD SOCIAL', tipos: ['seguridad_social'] },
  nomina:           { hoja: 'Pago Nomina',      carpeta: 'PJ04 NOMINA',           tipos: ['nomina'] }
};

// Hojas que NO son de pagos (no entran en consultas ni reportes).
// Es función y no constante a propósito: NOMBRE_HOJA_SOLICITUDES se declara más
// abajo (bloque B), y un `const` aquí arriba lo leería antes de inicializarse
// ("Cannot access ... before initialization"). Dentro de una función se evalúa
// recién al llamarla, cuando todo el archivo ya está cargado.
function hojasNoPagos_() {
  return [NOMBRE_HOJA_SOLICITUDES, 'USUARIOS'];
}

function hojaPrincipal_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
}

// Devuelve la hoja de una sección; la crea con los encabezados de la principal si falta.
function hojaDeSeccion_(seccion) {
  const cfg = SECCIONES[seccion];
  if (!cfg || !cfg.hoja) return hojaPrincipal_();

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = ss.getSheetByName(cfg.hoja);
  if (!hoja) {
    // Se inserta al final para que la principal siga siendo el índice 0.
    hoja = ss.insertSheet(cfg.hoja, ss.getNumSheets());
    const principal = hojaPrincipal_();
    const encabezados = principal.getRange(1, 1, 1, principal.getLastColumn()).getValues();
    hoja.getRange(1, 1, 1, encabezados[0].length).setValues(encabezados).setFontWeight('bold');
    hoja.setFrozenRows(1);
  }
  return hoja;
}

// Todas las hojas que contienen pagos (la principal + las de sección que existan).
function hojasDePagos_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets()
    .filter(h => hojasNoPagos_().indexOf(h.getName()) === -1);
}

function seccionDeTipo_(tipo) {
  const t = String(tipo || '').toLowerCase();
  for (const clave in SECCIONES) {
    if (SECCIONES[clave].tipos.indexOf(t) !== -1) return clave;
  }
  return 'pagos';
}

function carpetaDeSeccion_(seccion) {
  const cfg = SECCIONES[seccion] || SECCIONES.pagos;
  const carpetas = DriveApp.getFoldersByName(cfg.carpeta);
  return carpetas.hasNext() ? carpetas.next() : DriveApp.createFolder(cfg.carpeta);
}

// Sube archivos a la carpeta de la sección indicada.
function subirArchivosASeccion_(archivos, seccion) {
  if (!archivos || archivos.length === 0) return '';
  const carpeta = carpetaDeSeccion_(seccion);
  return archivos.map(a => {
    const blob = Utilities.newBlob(
      Utilities.base64Decode(a.datos),
      a.tipo || 'application/octet-stream',
      a.nombre || 'archivo'
    );
    const archivo = carpeta.createFile(blob);
    archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return archivo.getUrl();
  }).join('\n');
}

// ─── Registrar un pago (reemplaza el webhook de n8n) ──────────────────────

function registrarPago_(body) {
  const seccion = seccionDeTipo_(body.tipo_factura);
  const hoja    = hojaDeSeccion_(seccion);

  agregarFilaPorEncabezados_(hoja, {
    'FECHA REGISTRO': Utilities.formatDate(new Date(), ZONA_HORARIA, 'dd/MM/yyyy HH:mm'),
    'EMPRESA':        body.empresa || '',
    'TIPO FACTURA':   body.tipo_factura || '',
    'REGISTRADO POR': body.registrado_por || '',
    'NOMBRE DE PAGO': body.nombre_pago || '',
    'PROVEEDOR':      body.proveedor || '',
    'FECHA DE PAGO':  body.fecha_pago || '',
    'VALOR FACTURA':  body.monto || '',
    'NOTAS':          body.notas || '',
    'URL ARCHIVO':    subirArchivosASeccion_(body.archivos, seccion),
    'ID REGISTRO':    body.fecha_envio || new Date().toISOString()
  });

  return { status: 'success', seccion: seccion };
}

// ─── Consultar pagos (reemplaza el webhook GET de n8n) ────────────────────
// Lee todas las hojas de pagos. Cuando exista el login, aquí se filtrará por
// las secciones que tenga permitidas el usuario.

function consultarPagos_() {
  const resultado = [];
  hojasDePagos_().forEach(hoja => {
    const valores = hoja.getDataRange().getValues();
    if (valores.length < 2) return;
    const encabezados = valores[0];
    valores.slice(1).forEach(fila => {
      if (!fila.some(v => v !== '')) return;
      const obj = {};
      encabezados.forEach((h, i) => {
        const v = fila[i];
        obj[h] = (v instanceof Date) ? Utilities.formatDate(v, ZONA_HORARIA, 'yyyy-MM-dd') : v;
      });
      resultado.push(obj);
    });
  });
  return resultado;
}

// ─── Migración: repartir los pagos de la hoja principal por sección ───────
// Se ejecuta UNA sola vez, a mano, desde el editor de Apps Script.
// Hace un respaldo completo del Sheet antes de tocar nada.
//
// Antes de correr la migración real, correr SIEMPRE simularMigracion(): no
// modifica nada y dice exactamente qué filas se moverían y a dónde.

// La migración copia las filas POR POSICIÓN de columna, no por nombre. Si una
// hoja destino tuviera los encabezados en otro orden, los datos caerían en la
// columna equivocada sin dar error. Esto lo impide.
function verificarEncabezados_(destino, encabezadosPrincipal) {
  const ancho = encabezadosPrincipal.length;
  const suyos = destino.getRange(1, 1, 1, ancho).getValues()[0];
  for (let i = 0; i < ancho; i++) {
    if (String(suyos[i]).trim() !== String(encabezadosPrincipal[i]).trim()) {
      throw new Error(
        'La hoja "' + destino.getName() + '" tiene los encabezados en distinto orden que la principal. ' +
        'Columna ' + (i + 1) + ': esperaba "' + encabezadosPrincipal[i] + '" y encontró "' + suyos[i] + '". ' +
        'No se movió nada. Corregí los encabezados y volvé a intentar.'
      );
    }
  }
}

// Simulacro de SOLO LECTURA. No escribe, no borra, no hace respaldo.
// Corrélo primero y revisá el resultado en el registro de ejecución.
function simularMigracion() {
  const principal   = hojaPrincipal_();
  const valores     = principal.getDataRange().getValues();
  const encabezados = valores[0];
  const colTipo     = encabezados.indexOf('TIPO FACTURA');
  if (colTipo === -1) throw new Error('No se encontró la columna "TIPO FACTURA" en la hoja principal.');

  const porSeccion = {};
  let seQuedan = 0;
  for (let i = 1; i < valores.length; i++) {
    const fila = valores[i];
    if (!fila.some(v => v !== '')) continue;
    const seccion = seccionDeTipo_(fila[colTipo]);
    if (seccion === 'pagos') { seQuedan++; continue; }
    porSeccion[seccion] = (porSeccion[seccion] || 0) + 1;
  }

  const lineas = ['SIMULACRO — no se modificó nada.'];
  lineas.push('Hoja principal: "' + principal.getName() + '" (' + (valores.length - 1) + ' filas de datos).');
  lineas.push('Se quedan en la principal: ' + seQuedan + ' (Proveedor, Compra, Venta).');

  const claves = Object.keys(porSeccion);
  if (!claves.length) {
    lineas.push('No hay nada para mover.');
  } else {
    let total = 0;
    claves.forEach(s => {
      const destino = SECCIONES[s].hoja;
      const existe  = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(destino);
      lineas.push('  ' + porSeccion[s] + ' fila(s) → hoja "' + destino + '"' +
        (existe ? ' (ya existe, tiene ' + Math.max(0, existe.getLastRow() - 1) + ' fila(s))' : ' (se creará)'));
      total += porSeccion[s];
    });
    lineas.push('Total a mover: ' + total);
  }

  // Chequeo de encabezados de las hojas destino que ya existan
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const problemas = [];
  claves.forEach(s => {
    const h = ss.getSheetByName(SECCIONES[s].hoja);
    if (!h) return;
    try { verificarEncabezados_(h, encabezados); }
    catch (err) { problemas.push(String(err.message || err)); }
  });
  lineas.push(problemas.length
    ? 'PROBLEMA DE ENCABEZADOS:\n  ' + problemas.join('\n  ')
    : 'Encabezados de las hojas destino: OK.');

  const resumen = lineas.join('\n');
  Logger.log(resumen);
  return resumen;
}

function migrarPagosAHojasPorSeccion() {
  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const principal = hojaPrincipal_();

  // 1) Respaldo completo antes de mover nada
  const nombreRespaldo = 'RESPALDO ' + ss.getName() + ' ' +
    Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd HH.mm');
  DriveApp.getFileById(ss.getId()).makeCopy(nombreRespaldo);

  // 2) Leer la hoja principal
  const valores     = principal.getDataRange().getValues();
  const encabezados = valores[0];
  const colTipo     = encabezados.indexOf('TIPO FACTURA');
  if (colTipo === -1) throw new Error('No se encontró la columna "TIPO FACTURA" en la hoja principal.');

  // 3) Separar las filas que deben mudarse
  const porSeccion = {};
  const filasAEliminar = [];   // índices de fila reales (1-based)

  for (let i = 1; i < valores.length; i++) {
    const fila = valores[i];
    if (!fila.some(v => v !== '')) continue;

    const seccion = seccionDeTipo_(fila[colTipo]);
    if (seccion === 'pagos') continue;         // Proveedor/Compra/Venta se quedan

    if (!porSeccion[seccion]) porSeccion[seccion] = [];
    porSeccion[seccion].push(fila);
    filasAEliminar.push(i + 1);
  }

  // 4) Escribir en las hojas destino (en bloque, mucho más rápido que fila por fila).
  //    Se verifican TODOS los encabezados antes de escribir nada: si una hoja no
  //    coincide, verificarEncabezados_ lanza y no se movió ni se borró nada.
  const destinos = Object.keys(porSeccion).map(seccion => {
    const hoja = hojaDeSeccion_(seccion);
    verificarEncabezados_(hoja, encabezados);
    return { seccion: seccion, hoja: hoja };
  });

  let movidas = 0;
  destinos.forEach(d => {
    const filas = porSeccion[d.seccion];
    d.hoja.getRange(d.hoja.getLastRow() + 1, 1, filas.length, filas[0].length).setValues(filas);
    movidas += filas.length;
  });
  SpreadsheetApp.flush();   // asegura que las copias quedaron guardadas antes de borrar

  // 5) Borrar de la principal, de abajo hacia arriba para no descuadrar los índices.
  //    Se agrupan las filas contiguas en un solo deleteRows() — con ~56 filas
  //    sueltas, borrar una por una son 56 llamadas y puede acercarse al límite
  //    de 6 minutos de Apps Script.
  filasAEliminar.sort((a, b) => a - b);
  const bloques = [];
  filasAEliminar.forEach(n => {
    const ultimo = bloques[bloques.length - 1];
    if (ultimo && n === ultimo.inicio + ultimo.cantidad) ultimo.cantidad++;
    else bloques.push({ inicio: n, cantidad: 1 });
  });
  bloques.reverse().forEach(b => principal.deleteRows(b.inicio, b.cantidad));

  const resumen = 'Respaldo: "' + nombreRespaldo + '". Filas movidas: ' + movidas +
    '. Detalle: ' + Object.keys(porSeccion).map(s => s + '=' + porSeccion[s].length).join(', ');
  Logger.log(resumen);
  return resumen;
}

// ══════════════════════════════════════════════════════════════════════════
// B) MÓDULO DE APROBACIONES (Web App)
//
// Despliegue: Deploy → New deployment → Web app
//   Execute as: Me · Who has access: Anyone
// La URL /exec va en la constante APPS_SCRIPT_URL de index.html.
// ══════════════════════════════════════════════════════════════════════════

const NOMBRE_HOJA_SOLICITUDES = 'SOLICITUDES DE APROBACION';
const CORREOS_ADMIN           = ['nathan@ylevigroup.com', 'joseph@ylevigroup.com'];
const ZONA_HORARIA            = 'America/Bogota';
const URL_APP                 = 'https://ashir7ai-star.github.io/PJ04-CONTROL-PAGOS/';

const ENCABEZADOS_SOLICITUDES = [
  'ID SOLICITUD', 'FECHA SOLICITUD', 'EMPRESA', 'TIPO DE PAGO', 'NOMBRE DEL PAGO',
  'PROVEEDOR', 'FECHA DE PAGO', 'VALOR', 'SOLICITADO POR', 'CORREO', 'NOTAS',
  'URL ARCHIVO', 'ESTADO', 'REVISADO POR', 'FECHA DECISION', 'COMENTARIO'
];

// ─── Puntos de entrada del Web App ────────────────────────────────────────

function doGet(e) {
  const accion = e.parameter.action;
  try {
    if (accion === 'consultar_solicitudes') return respuestaJson_(consultarSolicitudes_());
    if (accion === 'consultar_pagos')       return respuestaJson_(consultarPagos_());
    return respuestaJson_({ status: 'error', message: 'Acción no reconocida: ' + accion });
  } catch (err) {
    return respuestaJson_({ status: 'error', message: String(err) });
  }
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
    if (body.action === 'registrar_pago')       return respuestaJson_(registrarPago_(body));
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

// Escribe una fila usando los encabezados reales de la hoja, así el orden de
// las columnas puede cambiar sin romper nada.
function agregarFilaPorEncabezados_(hoja, datos) {
  const encabezados = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
  const fila = encabezados.map(h => (datos[h] !== undefined ? datos[h] : ''));
  hoja.appendRow(fila);
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

// Arma el correo completo. color = acento del estado; etiquetaEstado = texto del badge.
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
    // Las solicitudes no tienen carpeta propia (son temporales): van a PJ04 FACTURAS.
    'URL ARCHIVO':     subirArchivosASeccion_(body.archivos, 'pagos'),
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

  // Un solo envío con ambos destinatarios: cada sendEmail cuesta 1-2s y el
  // usuario está esperando esta respuesta, así que no se hace uno por correo.
  MailApp.sendEmail({
    to: CORREOS_ADMIN.join(','),
    subject: asunto,
    body: textoPlano,
    htmlBody: html
  });
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
