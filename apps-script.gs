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
  compra_materiales:{ hoja: 'Compra Materiales', carpeta: 'PJ04 COMPRA MATERIALES', tipos: ['compra_materiales'] },
  nomina:           { hoja: 'Pago Nomina',      carpeta: 'PJ04 NOMINA',           tipos: ['nomina'] }
};

// Hojas que NO son de pagos (no entran en consultas ni reportes).
// Es función y no constante a propósito: NOMBRE_HOJA_SOLICITUDES se declara más
// abajo (bloque B), y un `const` aquí arriba lo leería antes de inicializarse
// ("Cannot access ... before initialization"). Dentro de una función se evalúa
// recién al llamarla, cuando todo el archivo ya está cargado.
function hojasNoPagos_() {
  // TRASLADOS va acá por una razón contable, no técnica: un traslado NO es un
  // gasto. Si se contara como pago, el reporte sumaría dos veces el mismo
  // dinero — una al enviarlo a viáticos y otra cuando la persona en campo lo
  // gaste y cargue su recibo.
  return [NOMBRE_HOJA_SOLICITUDES, 'USUARIOS', 'SALDOS', 'TRASLADOS', 'SESIONES'];
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

// ¿Este tipo de pago existe en la configuración de secciones?
//
// Importa porque `seccionDeTipo_` devuelve 'pagos' ante cualquier tipo que no
// reconozca. Ese valor por defecto es correcto para Proveedor/Compra/Venta,
// pero si la app ofrece un tipo que este script todavía no conoce (porque no se
// redesplegó), el pago se archiva EN SILENCIO en la hoja y la carpeta
// equivocadas. Ya pasó con "Compra Materiales". Mejor fallar visiblemente.
function tipoConocido_(tipo) {
  const t = String(tipo || '').toLowerCase();
  for (const clave in SECCIONES) {
    if (SECCIONES[clave].tipos.indexOf(t) !== -1) return true;
  }
  return false;
}

function seccionDeTipo_(tipo) {
  const t = String(tipo || '').toLowerCase();
  for (const clave in SECCIONES) {
    if (SECCIONES[clave].tipos.indexOf(t) !== -1) return clave;
  }
  return 'pagos';
}

function carpetaPorNombre_(nombre) {
  const carpetas = DriveApp.getFoldersByName(nombre);
  return carpetas.hasNext() ? carpetas.next() : DriveApp.createFolder(nombre);
}

function carpetaDeSeccion_(seccion) {
  const cfg = SECCIONES[seccion] || SECCIONES.pagos;
  return carpetaPorNombre_(cfg.carpeta);
}

// Sube archivos a la carpeta de la sección indicada.
function subirArchivosASeccion_(archivos, seccion) {
  return subirArchivosACarpeta_(archivos, carpetaDeSeccion_(seccion));
}

function subirArchivosACarpeta_(archivos, carpeta) {
  if (!archivos || archivos.length === 0) return '';
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
  // Se rechaza antes de escribir nada: es preferible que el usuario vea un
  // error claro a que el pago quede archivado donde no corresponde.
  if (!tipoConocido_(body.tipo_factura)) {
    return {
      status: 'error',
      message: 'Este servidor no conoce el tipo de pago "' + body.tipo_factura +
               '". Hay que volver a desplegar el Apps Script (Deploy → Manage ' +
               'deployments → ✏️ → New version). No se registró nada.'
    };
  }

  const seccion = seccionDeTipo_(body.tipo_factura);

  // Un usuario solo puede registrar en las secciones que tiene asignadas.
  // Se valida acá, en el servidor: ocultar el botón en la pantalla no alcanza,
  // porque cualquiera puede llamar a esta URL directamente.
  const ctx = contextoDe_(body);
  if (ctx.secciones.indexOf(seccion) === -1) {
    throw new Error('SIN_PERMISO_SECCION');
  }

  const hoja = hojaDeSeccion_(seccion);

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
// Devuelve SOLO las hojas que el usuario tiene permitidas. El filtrado ocurre
// acá y no en el navegador: el frontend nunca llega a recibir los datos de una
// sección que no le corresponde.
// Con MODO_LOGIN = 'off' el contexto da acceso a todas, así que se comporta
// igual que antes del login.

// Convierte el valor de una celda a texto para enviarlo al navegador.
//
// OJO CON LA HORA: cuando Sheets guarda la celda como fecha real (no como
// texto), formatearla con 'yyyy-MM-dd' DESCARTA LA HORA. En FECHA REGISTRO eso
// arruina el orden cronológico: todos los registros del mismo día llegaban con
// 00:00 y quedaban empatados. Las columnas de fecha+hora se formatean con hora.
function formatearValorDeCelda_(encabezado, valor) {
  if (!(valor instanceof Date)) return valor;
  // Se envía en formato año-mes-día, que NO se puede interpretar de dos
  // maneras. Con dd/MM/yyyy, un "09/12/2026" es 12 de septiembre para unos y
  // 9 de diciembre para otros — y esa confusión ya rompió el orden cronológico.
  // El navegador lo muestra en dd/MM/yyyy, que es como se lee acá.
  const conHora = ['FECHA REGISTRO', 'FECHA SOLICITUD', 'FECHA DECISION', 'ULTIMO ACCESO'];
  return conHora.indexOf(String(encabezado).trim().toUpperCase()) !== -1
    ? Utilities.formatDate(valor, ZONA_HORARIA, 'yyyy-MM-dd HH:mm')
    : Utilities.formatDate(valor, ZONA_HORARIA, 'yyyy-MM-dd');
}

function consultarPagos_(ctx) {
  const contexto  = ctx || contextoDe_(null);
  const resultado = [];
  hojasPermitidas_(contexto).forEach(hoja => {
    const valores = hoja.getDataRange().getValues();
    if (valores.length < 2) return;
    const encabezados = valores[0];
    valores.slice(1).forEach(fila => {
      if (!fila.some(v => v !== '')) return;
      const obj = {};
      encabezados.forEach((h, i) => {
        const v = fila[i];
        obj[h] = formatearValorDeCelda_(h, v);
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

// ─── Diagnóstico: ¿cómo están guardadas las FECHA REGISTRO? ───────────────
//
// SOLO LECTURA. En Sheets una celda puede ser una FECHA REAL o TEXTO, y las dos
// se ven igual. Si es texto, además puede estar en dd/MM/yyyy o en MM/dd/yyyy,
// y "09/12/2026" es 12 de septiembre en uno y 9 de diciembre en el otro.
//
// Mezclar ambos formatos rompe el orden cronológico sin que nada falle: una
// fecha de septiembre leída como diciembre se va al futuro y queda primera.
//
// Esto informa qué hay realmente en cada hoja, para decidir con datos.
function revisarFechasRegistro() {
  const lineas = ['CÓMO ESTÁN GUARDADAS LAS FECHAS DE REGISTRO', ''];
  let textoAmbiguo = 0, textoClaro = 0, fechasReales = 0, vacias = 0, otras = 0;

  hojasDePagos_().forEach(hoja => {
    const valores = hoja.getDataRange().getValues();
    if (valores.length < 2) return;
    const col = valores[0].indexOf('FECHA REGISTRO');
    if (col === -1) return;

    let dReal = 0, dTexto = 0, dAmbiguo = 0, dVacio = 0;
    const ejemplos = [];

    valores.slice(1).forEach(fila => {
      const v = fila[col];
      if (v === '' || v === null) { dVacio++; vacias++; return; }

      if (v instanceof Date) { dReal++; fechasReales++; return; }

      const t = String(v).trim();
      const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (m) {
        dTexto++;
        const a = Number(m[1]), b = Number(m[2]);
        // Si el primer número es > 12, solo puede ser el día: no hay ambigüedad.
        if (a > 12 || b > 12) { textoClaro++; }
        else { dAmbiguo++; textoAmbiguo++; if (ejemplos.length < 3) ejemplos.push(t); }
      } else {
        otras++;
        if (ejemplos.length < 3) ejemplos.push(t);
      }
    });

    lineas.push(hoja.getName() + ':');
    lineas.push('   fechas reales de Sheets: ' + dReal);
    lineas.push('   texto:                   ' + dTexto + '  (de los cuales AMBIGUOS: ' + dAmbiguo + ')');
    if (dVacio) lineas.push('   vacías:                  ' + dVacio);
    if (ejemplos.length) lineas.push('   ejemplos: ' + ejemplos.join(' | '));
    lineas.push('');
  });

  lineas.push('RESUMEN');
  lineas.push('   fechas reales de Sheets: ' + fechasReales + '  (sin ambigüedad posible)');
  lineas.push('   texto sin ambigüedad:    ' + textoClaro + '  (algún número > 12)');
  lineas.push('   texto AMBIGUO:           ' + textoAmbiguo + '  (ambos números <= 12)');
  if (otras)  lineas.push('   formato no reconocido:   ' + otras);
  if (vacias) lineas.push('   vacías:                  ' + vacias);
  lineas.push('');
  lineas.push(textoAmbiguo === 0
    ? '✅ No hay fechas ambiguas: el orden cronológico es confiable.'
    : '⚠️ Hay ' + textoAmbiguo + ' fecha(s) donde no se puede saber si es día/mes o mes/día ' +
      'mirando solo el texto. Corré normalizarFechasRegistro() para convertirlas todas ' +
      'al mismo formato.');

  const resumen = lineas.join('\n');
  Logger.log(resumen);
  return resumen;
}

// Convierte TODAS las FECHA REGISTRO a fechas reales de Sheets, para que no
// quede ninguna ambigüedad de formato. Hace respaldo del Sheet antes de tocar.
//
// `simular` en true solo informa qué haría, sin modificar nada. SIEMPRE correr
// primero con true.
//
// Sobre las ambiguas: el sistema SIEMPRE escribió dd/MM/yyyy, así que se
// interpretan así. Si el resultado diera una fecha futura —imposible para un
// registro— se avisa en vez de convertirla a ciegas.
function normalizarFechasRegistro(simular) {
  const soloSimular = (simular !== false);
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (!soloSimular) {
    const nombre = 'RESPALDO ANTES DE NORMALIZAR FECHAS ' +
      Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd HH.mm');
    DriveApp.getFileById(ss.getId()).makeCopy(nombre);
  }

  const lineas = [soloSimular ? 'SIMULACRO — no se modificó nada.' : 'NORMALIZACIÓN APLICADA', ''];
  const ahora = new Date();
  let convertidas = 0, yaEstaban = 0, sospechosas = 0;

  hojasDePagos_().forEach(hoja => {
    const valores = hoja.getDataRange().getValues();
    if (valores.length < 2) return;
    const col = valores[0].indexOf('FECHA REGISTRO');
    if (col === -1) return;

    let hConv = 0, hOk = 0;
    for (let i = 1; i < valores.length; i++) {
      const v = valores[i][col];
      if (v === '' || v === null) continue;
      if (v instanceof Date) { hOk++; yaEstaban++; continue; }

      const t = String(v).trim();
      const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
      if (!m) continue;

      const a = Number(m[1]), b = Number(m[2]);
      const anio = Number(m[3]), hh = Number(m[4] || 0), mm = Number(m[5] || 0);
      const margen = ahora.getTime() + 86400000;

      // Interpretación normal: día/mes, que es lo que siempre escribió el sistema.
      let fecha = new Date(anio, b - 1, a, hh, mm);
      let nota  = '';

      // Un registro NO puede ser del futuro. Si día/mes da una fecha futura y
      // mes/día da una pasada, entonces esa fila venía en mes/día (son las de
      // la época de n8n). No es una suposición: es la única lectura posible.
      if (fecha.getTime() > margen) {
        const alterna = new Date(anio, a - 1, b, hh, mm);
        if (a <= 12 && b <= 31 && alterna.getTime() <= margen) {
          fecha = alterna;
          nota  = ' (venía en mes/día)';
        } else {
          sospechosas++;
          lineas.push('   ⚠️ ' + hoja.getName() + ' fila ' + (i + 1) + ': "' + t +
                      '" da una fecha futura en cualquiera de las dos lecturas. Revisar a mano.');
          continue;
        }
      }

      hConv++; convertidas++;
      if (nota) {
        lineas.push('   · ' + hoja.getName() + ' fila ' + (i + 1) + ': "' + t + '" → ' +
                    Utilities.formatDate(fecha, ZONA_HORARIA, 'yyyy-MM-dd HH:mm') + nota);
      }
      if (!soloSimular) hoja.getRange(i + 1, col + 1).setValue(fecha);
    }

    if (hConv || hOk) {
      lineas.push(hoja.getName() + ': ' + hConv + ' convertida(s), ' + hOk + ' ya estaban bien.');
    }
  });

  lineas.push('');
  lineas.push('Total a convertir: ' + convertidas + '  ·  ya correctas: ' + yaEstaban +
              (sospechosas ? '  ·  sospechosas: ' + sospechosas : ''));
  if (soloSimular) {
    lineas.push('');
    lineas.push('Para aplicarlo de verdad: normalizarFechasRegistro(false)');
  }

  const resumen = lineas.join('\n');
  Logger.log(resumen);
  return resumen;
}

// ─── Diagnóstico: ¿es seguro borrar una carpeta de Drive? ─────────────────
//
// SOLO LECTURA. Revisa todos los pagos registrados y dice cuántos apuntan a
// archivos que viven dentro de la carpeta indicada.
//
// Sirve antes de borrar una carpeta vieja: los enlaces del Sheet apuntan al
// archivo, no a la carpeta, así que borrarla rompe el acceso a esas facturas
// sin que nada avise.
//
// Editar NOMBRE al gusto y correr desde el editor.
function revisarCarpetaAntesDeBorrar() {
  const NOMBRE = 'FACTURAS';   // ← la carpeta que se quiere borrar

  // Si la carpeta ya no está, igual se revisan los enlaces: lo que de verdad
  // importa es si las facturas siguen alcanzables, no dónde viven.
  const carpetas  = DriveApp.getFoldersByName(NOMBRE);
  const existe    = carpetas.hasNext();
  const carpeta   = existe ? carpetas.next() : null;
  const idCarpeta = existe ? carpeta.getId() : null;

  let archivosDentro = 0;
  if (existe) {
    const it = carpeta.getFiles();
    while (it.hasNext() && archivosDentro < 1000) { it.next(); archivosDentro++; }
  }

  // Todos los enlaces guardados en los pagos
  const ids = [];
  hojasDePagos_().forEach(hoja => {
    const valores = hoja.getDataRange().getValues();
    if (valores.length < 2) return;
    const col = valores[0].indexOf('URL ARCHIVO');
    if (col === -1) return;
    valores.slice(1).forEach(fila => {
      String(fila[col] || '').split('\n').forEach(url => {
        const m = String(url).match(/\/d\/([A-Za-z0-9_-]+)/);
        if (m) ids.push(m[1]);
      });
    });
  });

  let enEsaCarpeta = 0, revisados = 0, inaccesibles = 0;
  const rotos = [];
  ids.forEach(id => {
    revisados++;
    try {
      const archivo = DriveApp.getFileById(id);
      if (idCarpeta) {
        const padres = archivo.getParents();
        while (padres.hasNext()) {
          if (padres.next().getId() === idCarpeta) { enEsaCarpeta++; break; }
        }
      }
    } catch (err) {
      inaccesibles++;
      if (rotos.length < 5) rotos.push(id);
    }
  });

  const lineas = [
    'REVISIÓN DE LA CARPETA "' + NOMBRE + '"',
    '',
    existe
      ? 'La carpeta existe. Archivos dentro: ' + archivosDentro
      : 'La carpeta YA NO EXISTE (borrada o en la papelera).',
    '',
    'Enlaces de pagos revisados: ' + revisados,
    existe ? 'Enlaces que apuntan AHÍ:    ' + enEsaCarpeta : '',
    'Enlaces ROTOS:              ' + inaccesibles,
    ''
  ].filter(l => l !== '' || true);

  if (inaccesibles > 0) {
    lineas.push('⛔ Hay ' + inaccesibles + ' factura(s) que ya no se pueden abrir.');
    if (rotos.length) lineas.push('   Primeros IDs afectados: ' + rotos.join(', '));
    lineas.push('   Revisá la papelera de Drive: si están ahí, restaurarlas arregla los enlaces.');
  } else if (existe && enEsaCarpeta > 0) {
    lineas.push('⛔ NO BORRAR: ' + enEsaCarpeta + ' pago(s) quedarían con el enlace roto. ' +
                'Mové esos archivos a otra carpeta antes.');
  } else {
    lineas.push('✅ TODO EN ORDEN: las ' + revisados + ' facturas registradas siguen accesibles.');
    if (existe) lineas.push('   Y ningún pago apunta a esa carpeta, así que se puede borrar.');
  }
  const resumen = lineas.join('\n');
  Logger.log(resumen);
  return resumen;
}

// ─── Diagnóstico: ¿qué código está realmente guardado? ────────────────────
// Correr desde el editor (selector de función → Run) y mirar el registro.
//
// Sirve para separar dos problemas que se ven idénticos desde afuera:
//   · Si acá aparece la sección pero la app no la ve → el código está bien
//     guardado, lo que falló es el DESPLIEGUE (quedó apuntando a una versión
//     vieja: en "Manage deployments" hay que elegir Version: "New version").
//   · Si acá tampoco aparece → lo que se pegó en el editor es una copia vieja.
function verificarVersion() {
  const lineas = [
    'VERSIÓN DEL CÓDIGO GUARDADO EN EL EDITOR',
    '',
    'Modo de acceso: ' + MODO_LOGIN,
    'Secciones (' + Object.keys(SECCIONES).length + '):'
  ];
  Object.keys(SECCIONES).forEach(clave => {
    const cfg = SECCIONES[clave];
    lineas.push('   · ' + clave + '  →  hoja "' + (cfg.hoja || 'principal') + '"  ·  carpeta "' + cfg.carpeta + '"');
  });
  lineas.push('');
  lineas.push('¿Conoce compra_materiales?  ' + (tipoConocido_('compra_materiales') ? 'SÍ' : 'NO'));
  lineas.push('¿Tiene la validación de tipo desconocido?  ' + (typeof tipoConocido_ === 'function' ? 'SÍ' : 'NO'));

  const resumen = lineas.join('\n');
  Logger.log(resumen);
  return resumen;
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

// Los errores de sesión/permiso se devuelven con un "codigo" estable para que
// el frontend pueda reaccionar (pedir login, mostrar "pendiente de aprobación")
// en vez de tener que adivinar leyendo el texto del mensaje.
const CODIGOS_ACCESO = {
  SESION_INVALIDA:      'Tu sesión venció o no es válida. Volvé a entrar con Google.',
  NO_REGISTRADO:        'Tu cuenta todavía no tiene acceso al sistema.',
  PENDIENTE_APROBACION: 'Tu acceso está esperando la aprobación de un administrador.',
  USUARIO_INACTIVO:     'Tu acceso está desactivado. Hablá con un administrador.',
  SOLO_ADMIN:           'Esta acción es solo para administradores.',
  SIN_PERMISO_SECCION:  'No tenés permiso para registrar en esa sección.'
};

function errorJson_(err) {
  const texto  = String((err && err.message) || err);
  const codigo = Object.keys(CODIGOS_ACCESO).filter(c => texto.indexOf(c) !== -1)[0];
  return respuestaJson_(codigo
    ? { status: 'error', codigo: codigo, message: CODIGOS_ACCESO[codigo] }
    : { status: 'error', message: texto });
}

function doGet(e) {
  const accion = e.parameter.action;
  try {
    // e.parameter sirve como "body" para que un GET también pueda traer idToken.
    // Sin autenticación a propósito: el frontend necesita saber si tiene que
    // pedir login ANTES de tener una sesión. No revela ningún dato.
    if (accion === 'estado_login') {
      return respuestaJson_({
        status: 'success',
        modo: MODO_LOGIN,
        clientId: CLIENT_ID_GOOGLE,
        // Las claves de sección no son un dato sensible (son nombres de
        // categoría que ya se ven en pantalla) y sirven para verificar desde
        // afuera qué versión del script está realmente desplegada.
        secciones: Object.keys(SECCIONES)
      });
    }
    if (accion === 'consultar_solicitudes') return respuestaJson_(consultarSolicitudes_(e.parameter));
    if (accion === 'consultar_pagos')       return respuestaJson_(consultarPagos_(contextoDe_(e.parameter)));
    return respuestaJson_({ status: 'error', message: 'Acción no reconocida: ' + accion });
  } catch (err) {
    return errorJson_(err);
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
    // Consultar por POST para no mandar el ID token en la URL (quedaría en el
    // historial del navegador y en los logs del servidor).
    if (body.action === 'consultar_pagos')      return respuestaJson_(consultarPagos_(contextoDe_(body)));
    if (body.action === 'consultar_solicitudes')return respuestaJson_(consultarSolicitudes_(body));
    if (body.action === 'arranque')             return respuestaJson_(arranque_(body));
    if (body.action === 'cerrar_sesion')        { cerrarSesionPropia_(body.sesionToken); return respuestaJson_({ status: 'success' }); }
    if (body.action === 'iniciar_sesion')       return respuestaJson_(iniciarSesion_(body));
    if (body.action === 'registrar_usuario')    return respuestaJson_(registrarUsuario_(body));
    if (body.action === 'listar_usuarios')      return respuestaJson_(listarUsuarios_(body));
    if (body.action === 'guardar_usuario')      return respuestaJson_(guardarUsuario_(body));
    if (body.action === 'consultar_saldos')     return respuestaJson_(consultarSaldos_(contextoDe_(body)));
    if (body.action === 'ajustar_saldo')        return respuestaJson_(ajustarSaldo_(body));
    if (body.action === 'registrar_traslado')   return respuestaJson_(registrarTraslado_(body));
    if (body.action === 'consultar_traslados')  return respuestaJson_(consultarTraslados_(body));
    return respuestaJson_({ status: 'error', message: 'Acción no reconocida: ' + body.action });
  } catch (err) {
    return errorJson_(err);
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
  // Los exactos van PRIMERO: 'compra_materiales' contiene 'compra', así que si
  // se comprobara antes el genérico, saldría etiquetado como "Compra".
  if (t === 'compra_materiales')    return 'Compra Materiales';
  if (t === 'seguridad_social')     return 'Seguridad Social';
  if (t === 'nomina')               return 'Pago Nómina';
  if (t === 'compra')               return 'Compra';
  if (t === 'venta')                return 'Venta';
  if (t.indexOf('impuesto') !== -1) return 'Pago Impuestos';
  if (t.indexOf('viatic')   !== -1) return 'Viáticos';
  if (t.indexOf('caja')     !== -1) return 'Caja Menor';
  if (t.indexOf('pago')     !== -1) return 'Pago a Proveedor';
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
  const ctx = contextoDe_(body);   // solo con sesión válida se puede solicitar

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
    // El correo sale de la SESIÓN VERIFICADA, no de lo que se escriba en el
    // formulario. Además de evitar errores de tipeo, es lo que hace confiable
    // el filtro de "ver solo mis solicitudes": si el correo fuera un campo
    // libre, cualquiera podría escribir el de otro y ver —o generar— lo ajeno.
    'CORREO':          ctx.correo || body.correo || '',
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

function consultarSolicitudes_(body) {
  // Las solicitudes traen proveedores, montos y correos: no pueden quedar
  // abiertas a cualquiera que conozca la URL.
  const ctx = contextoDe_(body);

  const hoja    = hojaSolicitudes_();
  const valores = hoja.getDataRange().getValues();
  if (valores.length < 2) return [];

  const encabezados = valores[0];
  const todas = valores.slice(1)
    .filter(fila => fila.some(v => v !== ''))
    .map(fila => {
      const obj = {};
      encabezados.forEach((h, i) => {
        const v = fila[i];
        obj[h] = formatearValorDeCelda_(h, v);
      });
      return obj;
    });

  // Los administradores ven todas: son quienes aprueban.
  if (MODO_LOGIN === 'off' || esAdmin_(ctx)) return todas;

  // Un usuario común ve ÚNICAMENTE las suyas. Se filtra acá, en el servidor:
  // ocultarlas en la pantalla no serviría, porque las solicitudes de los demás
  // —con sus proveedores, montos y correos— igual viajarían al navegador.
  const mio = String(ctx.correo || '').trim().toLowerCase();
  if (!mio) return [];
  return todas.filter(s => String(s['CORREO'] || '').trim().toLowerCase() === mio);
}

// ─── 3) Decidir (aprobar / rechazar) ──────────────────────────────────────

function decidirSolicitud_(body) {
  // Aprobar o rechazar un pago es un acto administrativo: solo admins.
  // Sin esto, cualquiera que conociera la URL podía aprobar solicitudes.
  const ctx = contextoDe_(body);
  if (MODO_LOGIN !== 'off' && !esAdmin_(ctx)) throw new Error('SOLO_ADMIN');

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
    // Quién revisó sale de la SESIÓN VERIFICADA, no de lo que diga el cliente:
    // si no, cualquiera podría firmar la aprobación con el nombre de otro.
    'REVISADO POR':   ctx.autenticado ? (ctx.nombre || ctx.correo) : (body.revisado_por || ''),
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

// ══════════════════════════════════════════════════════════════════════════
// D) USUARIOS, LOGIN Y PERMISOS POR SECCIÓN
//
// Un login en el frontend no da NINGUNA seguridad si el servidor le responde a
// cualquiera que sepa la URL. Por eso acá el servidor:
//   1. recibe el ID token de Google que mandó el navegador,
//   2. lo verifica CONTRA GOOGLE (no confía en nada que venga del cliente),
//   3. saca de ahí el correo verificado,
//   4. busca ese correo en la hoja USUARIOS y responde SOLO las hojas que le
//      corresponden a esa persona.
// El correo no se puede falsificar desde el navegador porque la firma del
// token la valida Google, no nosotros.
// ══════════════════════════════════════════════════════════════════════════

// Client ID de OAuth (Google Cloud Console → Credentials → OAuth 2.0 Client ID,
// tipo "Web application"). El mismo valor va en index.html.
const CLIENT_ID_GOOGLE = '165996240052-u1qhq59gag42uvuojlgk54m0ojd1hp2g.apps.googleusercontent.com';

// Interruptor de encendido del control de acceso. Existe para poder desplegar y
// probar SIN riesgo de dejar afuera a todo el mundo de un sistema que está en
// producción con pagos reales:
//   'off'      → no se pide token. El sistema funciona exactamente como hoy.
//   'suave'    → si llega token se respeta y se filtra por permisos; si no
//                llega, se deja pasar con acceso total. Sirve para probar el
//                login en producción sin romperle el trabajo a nadie.
//   'estricto' → sin token válido de un usuario ACTIVO no se responde nada.
// Pasar a 'estricto' recién cuando USUARIOS esté cargada y probada.
//
// 2026-09-16: ACTIVADO EN ESTRICTO a pedido del usuario. Solo se entra con
// cuenta de Google registrada y activa. Verificado antes de activarlo: 6
// usuarios cargados, todos activos, 4 administradores, ninguno sin secciones.
const MODO_LOGIN = 'estricto';

const NOMBRE_HOJA_USUARIOS = 'USUARIOS';
const ENCABEZADOS_USUARIOS = [
  'CORREO', 'NOMBRE', 'TELEFONO', 'ROL', 'SECCIONES', 'ESTADO',
  'FECHA REGISTRO', 'ULTIMO ACCESO'
];

// ─── Hoja USUARIOS ────────────────────────────────────────────────────────

function hojaUsuarios_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = ss.getSheetByName(NOMBRE_HOJA_USUARIOS);
  if (!hoja) {
    hoja = ss.insertSheet(NOMBRE_HOJA_USUARIOS, ss.getNumSheets());
    hoja.getRange(1, 1, 1, ENCABEZADOS_USUARIOS.length)
        .setValues([ENCABEZADOS_USUARIOS]).setFontWeight('bold');
    hoja.setFrozenRows(1);
    // Los dos administradores quedan activos de entrada: si no, nadie podría
    // entrar a Configuración a activar a nadie (el huevo y la gallina).
    CORREOS_ADMIN.forEach(correo => {
      hoja.appendRow([
        correo, '', '', 'admin', 'todas', 'activo',
        Utilities.formatDate(new Date(), ZONA_HORARIA, 'dd/MM/yyyy HH:mm'), ''
      ]);
    });
  }
  return hoja;
}

function usuariosTodos_() {
  const valores = hojaUsuarios_().getDataRange().getValues();
  if (valores.length < 2) return [];
  const encabezados = valores[0];
  return valores.slice(1).map((fila, i) => {
    const obj = { _fila: i + 2 };   // fila real en la hoja, para poder editarla
    encabezados.forEach((h, j) => { obj[h] = fila[j]; });
    return obj;
  }).filter(u => String(u['CORREO']).trim() !== '');
}

function usuarioPorCorreo_(correo) {
  const buscado = String(correo || '').trim().toLowerCase();
  if (!buscado) return null;
  const hallados = usuariosTodos_().filter(
    u => String(u['CORREO']).trim().toLowerCase() === buscado
  );
  return hallados.length ? hallados[0] : null;
}

// ─── Verificación del ID token contra Google ──────────────────────────────

// Guarda por qué falló la última verificación. Sirve para diagnosticar: sin
// esto, cualquier problema (token de otra app, correo sin verificar, Google
// caído) se ve igual desde afuera — "no pudimos validar tu sesión" — y no hay
// forma de saber cuál de todos es sin redesplegar a ciegas.
// Se declara con `var` porque se lee desde funciones definidas más arriba.
var motivoUltimoToken = '';

function verificarIdToken_(idToken) {
  motivoUltimoToken = '';
  if (!idToken) { motivoUltimoToken = 'no llegó ningún token'; return null; }

  // Verificar es una llamada de red por petición. Se cachea unos minutos para
  // que el login no le sume latencia a cada consulta (la lentitud de
  // Aprobaciones ya fue un problema real).
  const cache = CacheService.getScriptCache();
  const clave = 'tok_' + Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken)
  );
  const enCache = cache.get(clave);
  if (enCache) return JSON.parse(enCache);

  const respuesta = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  if (respuesta.getResponseCode() !== 200) {
    motivoUltimoToken = 'Google respondió ' + respuesta.getResponseCode() +
      ' al validar el token: ' + String(respuesta.getContentText()).slice(0, 180);
    return null;
  }

  let datos;
  try { datos = JSON.parse(respuesta.getContentText()); }
  catch (err) { motivoUltimoToken = 'Google devolvió algo que no es JSON'; return null; }

  // Que el token sea válido no alcanza: tiene que ser un token emitido PARA
  // ESTA aplicación. Sin este chequeo, un token sacado de cualquier otra app
  // de Google serviría para entrar acá.
  if (String(datos.aud) !== String(CLIENT_ID_GOOGLE)) {
    motivoUltimoToken = 'el token fue emitido para otro Client ID. Esperado: ' +
      String(CLIENT_ID_GOOGLE).slice(0, 24) + '… / Recibido: ' + String(datos.aud).slice(0, 24) + '…';
    return null;
  }
  if (String(datos.email_verified) !== 'true') {
    motivoUltimoToken = 'Google no da por verificado el correo ' + String(datos.email || '(sin correo)');
    return null;
  }
  if (Number(datos.exp) * 1000 < Date.now()) {
    motivoUltimoToken = 'el token ya había expirado al llegar al servidor';
    return null;
  }

  const perfil = {
    correo: String(datos.email || '').toLowerCase(),
    nombre: String(datos.name || ''),
    foto:   String(datos.picture || '')
  };
  // Se cachea hasta que el token expire, con tope de 5 minutos.
  const vida = Math.max(0, Math.min(300, Math.floor(Number(datos.exp) - Date.now() / 1000)));
  if (vida > 0) cache.put(clave, JSON.stringify(perfil), vida);
  return perfil;
}

// ─── Sesiones propias del sistema ─────────────────────────────────────────
//
// POR QUÉ EXISTEN: el token de Google dura ~1 hora y no se puede alargar.
// Renovarlo en silencio depende de One Tap, que Google restringe cada vez más
// y que falla seguido —sobre todo dentro de una PWA—, así que la gente terminaba
// teniendo que entrar de nuevo todo el tiempo.
//
// Con esto, el token de Google se usa UNA sola vez: para probar quién sos. A
// partir de ahí el sistema emite su propia sesión, con la duración que nosotros
// decidimos. Un dispositivo donde ya se entró sigue adentro.
//
// Además es más rápido: validar una sesión propia es leer una hoja, mientras
// que validar el token de Google era una llamada de red a Google en cada
// petición.
//
// Seguridad: se guarda el HASH del token, no el token. Si alguien viera la
// hoja, no podría usar esas sesiones. Y cada petición vuelve a comprobar que
// el usuario siga activo, así que desactivarlo lo saca de inmediato.

const NOMBRE_HOJA_SESIONES = 'SESIONES';
const ENCABEZADOS_SESIONES = ['HASH', 'CORREO', 'CREADA', 'ULTIMO USO', 'VENCE'];
const DIAS_SESION = 30;

function hojaSesiones_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = ss.getSheetByName(NOMBRE_HOJA_SESIONES);
  if (!hoja) {
    hoja = ss.insertSheet(NOMBRE_HOJA_SESIONES, ss.getNumSheets());
    hoja.getRange(1, 1, 1, ENCABEZADOS_SESIONES.length)
        .setValues([ENCABEZADOS_SESIONES]).setFontWeight('bold');
    hoja.setFrozenRows(1);
  }
  return hoja;
}

function hashDeToken_(token) {
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token))
  );
}

function crearSesionPropia_(correo) {
  // Dos UUID: espacio de búsqueda enorme, imposible de adivinar.
  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  const ahora = new Date();
  const vence = new Date(ahora.getTime() + DIAS_SESION * 86400000);

  const hoja = hojaSesiones_();
  hoja.appendRow([
    hashDeToken_(token),
    String(correo).toLowerCase(),
    ahora.toISOString(),
    ahora.toISOString(),
    vence.toISOString()
  ]);
  limpiarSesionesVencidas_(hoja);
  return token;
}

// Devuelve el correo si la sesión vale, o null.
function correoDeSesion_(token) {
  if (!token) return null;

  const clave = 'ses_' + hashDeToken_(token);
  const cache = CacheService.getScriptCache();
  const enCache = cache.get(clave);
  if (enCache) return enCache === '-' ? null : enCache;

  const hoja    = hojaSesiones_();
  const valores = hoja.getDataRange().getValues();
  const hash    = hashDeToken_(token);
  const ahora   = new Date();

  for (let i = 1; i < valores.length; i++) {
    if (String(valores[i][0]) !== hash) continue;

    const vence = new Date(valores[i][4]);
    if (!(vence.getTime() > ahora.getTime())) {
      cache.put(clave, '-', 60);
      return null;
    }

    const correo = String(valores[i][1]).toLowerCase();

    // Vencimiento deslizante: usar el sistema renueva la sesión. Solo se
    // escribe si pasó más de un día, porque escribir en la hoja cuesta tiempo
    // y hacerlo en cada petición la haría notablemente más lenta.
    const ultimoUso = new Date(valores[i][3]);
    if (ahora.getTime() - ultimoUso.getTime() > 86400000) {
      const nuevoVence = new Date(ahora.getTime() + DIAS_SESION * 86400000);
      hoja.getRange(i + 1, 4, 1, 2).setValues([[ahora.toISOString(), nuevoVence.toISOString()]]);
    }

    cache.put(clave, correo, 300);
    return correo;
  }

  cache.put(clave, '-', 60);
  return null;
}

function cerrarSesionPropia_(token) {
  if (!token) return;
  const hoja    = hojaSesiones_();
  const valores = hoja.getDataRange().getValues();
  const hash    = hashDeToken_(token);
  for (let i = valores.length - 1; i >= 1; i--) {
    if (String(valores[i][0]) === hash) hoja.deleteRow(i + 1);
  }
  try { CacheService.getScriptCache().remove('ses_' + hash); } catch (err) {}
}

// Las sesiones vencidas no sirven para nada y harían crecer la hoja sin fin.
function limpiarSesionesVencidas_(hoja) {
  try {
    const valores = hoja.getDataRange().getValues();
    if (valores.length < 200) return;   // no vale la pena hasta que crezca
    const ahora = Date.now();
    for (let i = valores.length - 1; i >= 1; i--) {
      const vence = new Date(valores[i][4]).getTime();
      if (!vence || vence < ahora) hoja.deleteRow(i + 1);
    }
  } catch (err) { /* la limpieza nunca debe romper un ingreso */ }
}

// ─── Contexto de la petición: quién llama y qué puede ver ─────────────────
// Toda acción del Web App pasa por acá. Devuelve el "contexto" que después
// usan consultarPagos_ y registrarPago_ para decidir qué mostrar y qué dejar
// escribir.

function contextoDe_(body) {
  const sinLogin = {
    autenticado: false, correo: '', nombre: '', rol: 'admin',
    secciones: Object.keys(SECCIONES), estado: 'activo', modo: MODO_LOGIN
  };

  if (MODO_LOGIN === 'off') return sinLogin;

  // Primero la sesión propia del sistema: es la vía normal, dura 30 días y no
  // necesita hablar con Google. El token de Google solo se usa en el ingreso
  // inicial, cuando todavía no hay sesión propia.
  let correo = correoDeSesion_(body && body.sesionToken);
  let nombreGoogle = '';

  if (!correo) {
    const perfil = verificarIdToken_(body && body.idToken);
    if (!perfil) {
      if (MODO_LOGIN === 'suave') return sinLogin;
      throw new Error('SESION_INVALIDA');
    }
    correo = perfil.correo;
    nombreGoogle = perfil.nombre;
  }

  const usuario = usuarioPorCorreo_(correo);
  if (!usuario) {
    if (MODO_LOGIN === 'suave') return sinLogin;
    throw new Error('NO_REGISTRADO');        // el frontend le ofrece registrarse
  }

  const estado = String(usuario['ESTADO'] || '').toLowerCase();
  if (estado !== 'activo') {
    if (MODO_LOGIN === 'suave') return sinLogin;
    throw new Error(estado === 'pendiente' ? 'PENDIENTE_APROBACION' : 'USUARIO_INACTIVO');
  }

  return {
    autenticado: true,
    correo:      correo,
    nombre:      String(usuario['NOMBRE'] || nombreGoogle),
    rol:         String(usuario['ROL'] || 'usuario').toLowerCase(),
    secciones:   seccionesDeUsuario_(usuario),
    estado:      estado,
    modo:        MODO_LOGIN
  };
}

// La columna SECCIONES admite "todas" o una lista separada por comas.
function seccionesDeUsuario_(usuario) {
  const crudo = String(usuario['SECCIONES'] || '').trim().toLowerCase();
  if (!crudo || crudo === 'todas') return Object.keys(SECCIONES);
  const validas = Object.keys(SECCIONES);
  return crudo.split(',').map(s => s.trim()).filter(s => validas.indexOf(s) !== -1);
}

function esAdmin_(ctx) {
  return ctx.rol === 'admin';
}

// Las hojas de pagos que este usuario tiene permitido leer.
function hojasPermitidas_(ctx) {
  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const principal = hojaPrincipal_();
  const hojas     = [];
  ctx.secciones.forEach(seccion => {
    const cfg = SECCIONES[seccion];
    if (!cfg) return;
    if (!cfg.hoja) { hojas.push(principal); return; }   // sección "pagos"
    const h = ss.getSheetByName(cfg.hoja);
    if (h) hojas.push(h);
  });
  return hojas;
}

// ─── Acciones de sesión ───────────────────────────────────────────────────

// El frontend llama a esto apenas el usuario se loguea con Google.
// Devuelve qué puede hacer, o por qué no puede entrar.
function iniciarSesion_(body) {
  if (MODO_LOGIN === 'off') {
    return {
      status: 'success', modo: 'off', acceso: 'total',
      secciones: Object.keys(SECCIONES), rol: 'admin',
      mensaje: 'El control de acceso todavía no está activado.'
    };
  }

  const perfil = verificarIdToken_(body.idToken);
  if (!perfil) {
    return {
      status: 'error', codigo: 'SESION_INVALIDA',
      message: 'No pudimos validar tu sesión de Google.',
      detalle: motivoUltimoToken    // para poder diagnosticar sin adivinar
    };
  }

  const usuario = usuarioPorCorreo_(perfil.correo);
  if (!usuario) {
    return {
      status: 'registro_requerido', codigo: 'NO_REGISTRADO',
      correo: perfil.correo, nombre: perfil.nombre,
      message: 'Todavía no tenés acceso. Completá tus datos para solicitarlo.'
    };
  }

  const estado = String(usuario['ESTADO'] || '').toLowerCase();
  if (estado === 'pendiente') {
    return {
      status: 'pendiente', codigo: 'PENDIENTE_APROBACION', correo: perfil.correo,
      message: 'Tu solicitud de acceso está esperando aprobación de un administrador.'
    };
  }
  if (estado !== 'activo') {
    return {
      status: 'error', codigo: 'USUARIO_INACTIVO', correo: perfil.correo,
      message: 'Tu acceso está desactivado. Hablá con un administrador.'
    };
  }

  // Marca de último acceso, para que los admins vean quién está usando el sistema.
  try {
    const col = ENCABEZADOS_USUARIOS.indexOf('ULTIMO ACCESO') + 1;
    hojaUsuarios_().getRange(usuario._fila, col)
      .setValue(Utilities.formatDate(new Date(), ZONA_HORARIA, 'dd/MM/yyyy HH:mm'));
  } catch (err) { /* no vale la pena fallar el login por esto */ }

  return {
    status:    'success',
    correo:    perfil.correo,
    nombre:    String(usuario['NOMBRE'] || perfil.nombre),
    foto:      perfil.foto,
    rol:       String(usuario['ROL'] || 'usuario').toLowerCase(),
    secciones: seccionesDeUsuario_(usuario),
    modo:      MODO_LOGIN
  };
}

// ─── Arranque: todo lo que la app necesita, en UNA sola petición ─────────
//
// Medición del 2026-09-16 sobre el despliegue real:
//   · POST                        → ~2 s
//   · GET con parámetro anti-caché → 5-33 s  (!)
//   · nuestro código en sí         → ~1,4 s
// Casi todo el tiempo se va en el viaje de ida y vuelta, no en el trabajo.
// Por eso lo que importa es hacer MENOS peticiones, no código más rápido.
//
// Antes el arranque eran tres viajes: estado_login (el lento), iniciar_sesion
// y consultar_saldos. Ahora es uno.
//
// Nunca lanza: si la sesión no sirve, igual devuelve el modo y el Client ID,
// que es lo que la app necesita para poder mostrar la pantalla de acceso.
function arranque_(body) {
  const base = {
    status:    'success',
    modo:      MODO_LOGIN,
    clientId:  CLIENT_ID_GOOGLE,
    secciones: Object.keys(SECCIONES)
  };

  if (MODO_LOGIN === 'off') {
    const ctx = contextoDe_(null);
    base.sesion = { rol: 'admin', secciones: Object.keys(SECCIONES), nombre: '', correo: '' };
    base.saldos = consultarSaldos_(ctx);
    return base;
  }

  // Vía normal: la sesión propia del sistema, que dura 30 días. El token de
  // Google solo aparece en el ingreso inicial.
  let correo = correoDeSesion_(body && body.sesionToken);
  let perfilGoogle = null;
  let tokenNuevo = null;

  if (!correo) {
    perfilGoogle = verificarIdToken_(body && body.idToken);
    if (!perfilGoogle) { base.sesion = null; base.codigo = 'SESION_INVALIDA'; return base; }
    correo = perfilGoogle.correo;
  }

  const usuario = usuarioPorCorreo_(correo);
  if (!usuario) {
    base.sesion = null;
    base.codigo = 'NO_REGISTRADO';
    base.correo = correo;
    base.nombre = perfilGoogle ? perfilGoogle.nombre : '';
    return base;
  }

  const estado = String(usuario['ESTADO'] || '').toLowerCase();
  if (estado !== 'activo') {
    base.sesion = null;
    base.codigo = estado === 'pendiente' ? 'PENDIENTE_APROBACION' : 'USUARIO_INACTIVO';
    base.correo = correo;
    return base;
  }

  // Recién acá, con el usuario confirmado como activo, se emite la sesión
  // propia. Se hace solo en el ingreso inicial: si ya vino con una válida, se
  // sigue usando esa.
  if (perfilGoogle) tokenNuevo = crearSesionPropia_(correo);

  const ctx = {
    autenticado: true,
    correo:      correo,
    nombre:      String(usuario['NOMBRE'] || (perfilGoogle ? perfilGoogle.nombre : '')),
    rol:         String(usuario['ROL'] || 'usuario').toLowerCase(),
    secciones:   seccionesDeUsuario_(usuario),
    estado:      estado,
    modo:        MODO_LOGIN
  };

  base.sesion = {
    correo:    ctx.correo,
    nombre:    ctx.nombre,
    foto:      perfilGoogle ? perfilGoogle.foto : '',
    rol:       ctx.rol,
    secciones: ctx.secciones
  };
  // El token solo viaja una vez, cuando se crea. Después el navegador lo
  // guarda y lo manda en cada petición.
  if (tokenNuevo) base.sesionToken = tokenNuevo;
  base.saldos = consultarSaldos_(ctx);

  // Marca de último acceso. Escribir en la hoja cuesta tiempo, así que se hace
  // al final y sin dejar que un fallo acá arruine un arranque que ya salió bien.
  try {
    const col = ENCABEZADOS_USUARIOS.indexOf('ULTIMO ACCESO') + 1;
    hojaUsuarios_().getRange(usuario._fila, col)
      .setValue(Utilities.formatDate(new Date(), ZONA_HORARIA, 'dd/MM/yyyy HH:mm'));
  } catch (err) { /* no vale la pena fallar el arranque por esto */ }

  return base;
}

// Alta propia: queda PENDIENTE, sin ver nada, hasta que un admin la active.
// Nunca se auto-asigna permisos.
function registrarUsuario_(body) {
  const perfil = verificarIdToken_(body.idToken);
  if (!perfil) return { status: 'error', message: 'No pudimos validar tu sesión de Google.' };

  if (usuarioPorCorreo_(perfil.correo)) {
    return { status: 'error', message: 'Ese correo ya está registrado en el sistema.' };
  }

  const nombre   = String(body.nombre   || perfil.nombre || '').trim();
  const telefono = String(body.telefono || '').trim();
  if (!nombre)   return { status: 'error', message: 'El nombre es obligatorio.' };
  if (!telefono) return { status: 'error', message: 'El teléfono es obligatorio.' };

  hojaUsuarios_().appendRow([
    perfil.correo, nombre, telefono, 'usuario', '', 'pendiente',
    Utilities.formatDate(new Date(), ZONA_HORARIA, 'dd/MM/yyyy HH:mm'), ''
  ]);

  notificarSolicitudDeAcceso_(perfil.correo, nombre, telefono);
  return { status: 'success', message: 'Solicitud enviada. Un administrador tiene que activarte.' };
}

function notificarSolicitudDeAcceso_(correo, nombre, telefono) {
  try {
    const html = plantillaCorreo_({
      color:          '#ff9500',
      colorFondo:     'rgba(255,149,0,0.12)',
      etiquetaEstado: 'Acceso pendiente',
      titulo:         nombre,
      valor:          '',
      intro:          'Una persona pidió acceso al sistema. Actívala desde Configuración y asignale sus secciones.',
      detalles:       filaDetalle_('Nombre', nombre) +
                      filaDetalle_('Correo', correo) +
                      filaDetalle_('Teléfono', telefono),
      aviso:          ''
    });
    MailApp.sendEmail({
      to:       CORREOS_ADMIN.join(','),
      subject:  'Solicitud de acceso: ' + nombre,
      body:     nombre + ' (' + correo + ', tel. ' + telefono + ') pidió acceso al sistema.',
      htmlBody: html
    });
  } catch (err) { /* el alta ya quedó registrada; el correo es un extra */ }
}

// ─── Administración de usuarios (solo admins) ─────────────────────────────

function listarUsuarios_(body) {
  const ctx = contextoDe_(body);
  if (MODO_LOGIN !== 'off' && !esAdmin_(ctx)) throw new Error('SOLO_ADMIN');

  return {
    status: 'success',
    modo: MODO_LOGIN,
    secciones: Object.keys(SECCIONES).map(k => ({ clave: k, hoja: SECCIONES[k].hoja || 'principal' })),
    usuarios: usuariosTodos_().map(u => ({
      correo:    String(u['CORREO']),
      nombre:    String(u['NOMBRE'] || ''),
      telefono:  String(u['TELEFONO'] || ''),
      rol:       String(u['ROL'] || 'usuario').toLowerCase(),
      secciones: String(u['SECCIONES'] || ''),
      estado:    String(u['ESTADO'] || '').toLowerCase(),
      registro:  String(u['FECHA REGISTRO'] || ''),
      acceso:    String(u['ULTIMO ACCESO'] || '')
    }))
  };
}

function guardarUsuario_(body) {
  const ctx = contextoDe_(body);
  if (MODO_LOGIN !== 'off' && !esAdmin_(ctx)) throw new Error('SOLO_ADMIN');

  const correo = String(body.correo || '').trim().toLowerCase();
  if (!correo) return { status: 'error', message: 'Falta el correo.' };

  const rol    = String(body.rol || 'usuario').toLowerCase();
  const estado = String(body.estado || 'activo').toLowerCase();
  if (['admin', 'usuario'].indexOf(rol) === -1)                       return { status: 'error', message: 'Rol inválido.' };
  if (['activo', 'pendiente', 'inactivo'].indexOf(estado) === -1)     return { status: 'error', message: 'Estado inválido.' };

  // Solo se guardan claves de sección que existan de verdad.
  const validas   = Object.keys(SECCIONES);
  const pedidas   = String(body.secciones || '').toLowerCase() === 'todas'
    ? 'todas'
    : String(body.secciones || '').split(',').map(s => s.trim()).filter(s => validas.indexOf(s) !== -1).join(',');

  // Red de seguridad: no dejar el sistema sin ningún admin activo. Si se
  // pudiera, un admin se degradaría a sí mismo y nadie podría volver a entrar
  // a Configuración.
  const usuarios     = usuariosTodos_();
  const adminsActivos = usuarios.filter(u =>
    String(u['ROL']).toLowerCase() === 'admin' && String(u['ESTADO']).toLowerCase() === 'activo'
  );
  const esteEsAdminActivo = adminsActivos.some(u => String(u['CORREO']).toLowerCase() === correo);
  const dejaDeSerlo       = esteEsAdminActivo && (rol !== 'admin' || estado !== 'activo');
  if (dejaDeSerlo && adminsActivos.length <= 1) {
    return { status: 'error', message: 'No se puede: quedaría el sistema sin ningún administrador activo.' };
  }

  const hoja      = hojaUsuarios_();
  const existente = usuarioPorCorreo_(correo);
  const fila      = [
    correo,
    String(body.nombre || (existente ? existente['NOMBRE'] : '')),
    String(body.telefono || (existente ? existente['TELEFONO'] : '')),
    rol, pedidas, estado,
    existente ? existente['FECHA REGISTRO'] : Utilities.formatDate(new Date(), ZONA_HORARIA, 'dd/MM/yyyy HH:mm'),
    existente ? existente['ULTIMO ACCESO'] : ''
  ];

  if (existente) hoja.getRange(existente._fila, 1, 1, fila.length).setValues([fila]);
  else           hoja.appendRow(fila);

  if (existente && String(existente['ESTADO']).toLowerCase() === 'pendiente' && estado === 'activo') {
    notificarAccesoAprobado_(correo, fila[1]);
  }
  return { status: 'success' };
}

function notificarAccesoAprobado_(correo, nombre) {
  try {
    const html = plantillaCorreo_({
      color:          '#34c759',
      colorFondo:     'rgba(52,199,89,0.12)',
      etiquetaEstado: 'Acceso activado',
      titulo:         nombre || correo,
      valor:          '',
      intro:          'Ya tenés acceso al sistema de Control de Pagos. Entrá con tu cuenta de Google.',
      detalles:       filaDetalle_('Correo', correo),
      aviso:          ''
    });
    MailApp.sendEmail({
      to:       correo,
      subject:  'Tu acceso a Control de Pagos fue activado',
      body:     'Ya tenés acceso al sistema de Control de Pagos: ' + URL_APP,
      htmlBody: html
    });
  } catch (err) { /* el alta ya quedó hecha */ }
}

// ─── Utilidad de arranque: precargar los usuarios que ya usan el sistema ──
// Se corre A MANO desde el editor, ANTES de poner MODO_LOGIN en 'estricto',
// para que el día que se encienda el login nadie quede afuera.
// Editar la lista y correr precargarUsuarios().
function precargarUsuarios() {
  const LISTA = [
    // { correo: 'persona@empresa.com', nombre: 'Nombre Apellido', telefono: '300...', rol: 'usuario', secciones: 'viaticos,caja_menor' },
    // secciones válidas: pagos, viaticos, caja_menor, impuestos, seguridad_social,
    // nomina, compra_materiales — o 'todas'
  ];

  if (!LISTA.length) {
    return 'La lista está vacía. Editá el array LISTA dentro de precargarUsuarios() y volvé a correr.';
  }

  const resultados = LISTA.map(u => {
    const r = guardarUsuario_({
      correo: u.correo, nombre: u.nombre, telefono: u.telefono || '',
      rol: u.rol || 'usuario', secciones: u.secciones || '', estado: 'activo'
    });
    return u.correo + ': ' + (r.status === 'success' ? 'ok' : 'ERROR - ' + r.message);
  });

  const resumen = 'Precarga terminada.\n' + resultados.join('\n');
  Logger.log(resumen);
  return resumen;
}

// ══════════════════════════════════════════════════════════════════════════
// E) SALDOS DISPONIBLES
//
// DECISIÓN DE DISEÑO IMPORTANTE: el saldo NO se guarda como un número que se
// va pisando con cada pago. Se CALCULA:
//
//     saldo = saldo base cargado por un admin − pagos registrados después
//
// Guardar un número y restarle cada pago parece más simple, pero se rompe de
// dos formas que en dinero son inaceptables:
//   1. Dos personas registrando un pago a la vez leen el mismo saldo y una
//      pisa a la otra: un pago desaparece del saldo.
//   2. Un reintento de red (exactamente lo que provocaba el Service Worker
//      viejo) descuenta dos veces el mismo pago, sin que nadie se entere.
//
// Calculándolo, el saldo siempre coincide con las filas que están en las hojas:
// no se puede descontar dos veces, no hay condición de carrera, y si alguien
// corrige el valor de un pago viejo el saldo se corrige solo.
//
// El precio es leer las hojas de pagos para responder, que es lo mismo que ya
// hace "Consultar Pagos".
// ══════════════════════════════════════════════════════════════════════════

const NOMBRE_HOJA_SALDOS = 'SALDOS';
const ENCABEZADOS_SALDOS = [
  'FECHA', 'CUENTA', 'SALDO BASE', 'CONCEPTO', 'REGISTRADO POR'
];

// Las cuatro bolsas de dinero. Caja Menor y Viáticos son compartidas entre las
// dos empresas (decisión del usuario).
const CUENTAS = {
  banco_millennium: { etiqueta: 'Millennium Co',  detalle: 'Cuenta bancaria', empresa: 'millennium', grupo: 'banco' },
  banco_ampac:      { etiqueta: 'AMPAC SAS',      detalle: 'Cuenta bancaria', empresa: 'ampac',      grupo: 'banco' },
  caja_menor:       { etiqueta: 'Caja Menor',     detalle: 'Fondo compartido', empresa: null,        grupo: 'fondo' },
  viaticos:         { etiqueta: 'Viáticos',       detalle: 'Fondo compartido', empresa: null,        grupo: 'fondo' }
};

// De qué bolsa sale un pago. Devuelve null si no debe tocar ningún saldo.
function cuentaDePago_(tipoFactura, empresa) {
  const t = String(tipoFactura || '').toLowerCase();

  // Una venta es dinero que ENTRA, no que sale: no mueve estos saldos
  // (decisión del usuario).
  if (t === 'venta') return null;

  if (t === 'viaticos')   return 'viaticos';
  if (t === 'caja_menor') return 'caja_menor';

  // El resto (proveedor, compra, impuestos, seguridad social, nómina) sale del
  // banco de la empresa que figure en el registro.
  const e = String(empresa || '').toLowerCase();
  if (e.indexOf('ampac') !== -1)      return 'banco_ampac';
  if (e.indexOf('millennium') !== -1) return 'banco_millennium';

  // Empresa desconocida: no se adivina. Se reporta aparte para que se vea.
  return null;
}

function hojaSaldos_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = ss.getSheetByName(NOMBRE_HOJA_SALDOS);
  if (!hoja) {
    hoja = ss.insertSheet(NOMBRE_HOJA_SALDOS, ss.getNumSheets());
    hoja.getRange(1, 1, 1, ENCABEZADOS_SALDOS.length)
        .setValues([ENCABEZADOS_SALDOS]).setFontWeight('bold');
    hoja.setFrozenRows(1);
  }
  return hoja;
}

// 'dd/MM/yyyy HH:mm' → Date. Es el formato con el que se escribe FECHA REGISTRO.
function fechaHoraDeRegistro_(valor) {
  if (!valor) return null;
  if (valor instanceof Date) return valor;

  const texto  = String(valor).trim();
  const partes = texto.split(' ');
  const fecha  = partes[0].split('/');
  if (fecha.length !== 3) return null;

  const d = Number(fecha[0]), m = Number(fecha[1]), y = Number(fecha[2]);
  if (!d || !m || !y) return null;

  let hh = 0, mm = 0;
  if (partes[1]) {
    const hora = partes[1].split(':');
    hh = Number(hora[0]) || 0;
    mm = Number(hora[1]) || 0;
  }
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

// Convierte a número lo que haya en VALOR FACTURA, que puede venir como número
// o como texto con separadores de miles.
function montoANumero_(valor) {
  if (typeof valor === 'number') return valor;
  const limpio = String(valor || '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(/,/g, '.');
  const n = parseFloat(limpio);
  return isNaN(n) ? 0 : n;
}

// Último saldo base cargado para cada cuenta.
function basesDeSaldo_() {
  const valores = hojaSaldos_().getDataRange().getValues();
  const bases   = {};
  if (valores.length < 2) return bases;

  const enc     = valores[0];
  const cFecha  = enc.indexOf('FECHA');
  const cCuenta = enc.indexOf('CUENTA');
  const cMonto  = enc.indexOf('SALDO BASE');
  const cConc   = enc.indexOf('CONCEPTO');
  const cQuien  = enc.indexOf('REGISTRADO POR');

  // Se recorre en orden: la última fila de cada cuenta es la que vale.
  valores.slice(1).forEach(fila => {
    const cuenta = String(fila[cCuenta] || '').trim();
    if (!cuenta || !CUENTAS[cuenta]) return;
    const fecha = fechaHoraDeRegistro_(fila[cFecha]);
    if (!fecha) return;
    bases[cuenta] = {
      fecha:    fecha,
      monto:    montoANumero_(fila[cMonto]),
      concepto: String(fila[cConc] || ''),
      quien:    String(fila[cQuien] || '')
    };
  });

  return bases;
}

// Saldo actual de cada cuenta = base − pagos registrados DESPUÉS de esa base.
function consultarSaldos_(ctx) {
  const contexto = ctx || contextoDe_(null);
  const bases    = basesDeSaldo_();

  const acumulado = {};
  Object.keys(CUENTAS).forEach(c => {
    acumulado[c] = { gastado: 0, pagos: 0, enviado: 0, recibido: 0, traslados: 0 };
  });
  let sinCuenta = 0;

  // Traslados: restan del origen y suman al destino. Se aplica la MISMA regla
  // de corte que con los pagos —solo los posteriores al saldo base de cada
  // cuenta— y se evalúa por separado para cada lado, porque cada cuenta tiene
  // su propia fecha de base.
  trasladosTodos_().forEach(t => {
    if (!t.fecha || !t.monto) return;

    const salida = bases[t.origen];
    if (salida && t.fecha.getTime() > salida.fecha.getTime()) {
      acumulado[t.origen].enviado   += t.monto;
      acumulado[t.origen].traslados += 1;
    }

    const entrada = bases[t.destino];
    if (entrada && t.fecha.getTime() > entrada.fecha.getTime()) {
      acumulado[t.destino].recibido  += t.monto;
      acumulado[t.destino].traslados += 1;
    }
  });

  hojasDePagos_().forEach(hoja => {
    const valores = hoja.getDataRange().getValues();
    if (valores.length < 2) return;
    const enc      = valores[0];
    const cFecha   = enc.indexOf('FECHA REGISTRO');
    const cTipo    = enc.indexOf('TIPO FACTURA');
    const cEmpresa = enc.indexOf('EMPRESA');
    const cValor   = enc.indexOf('VALOR FACTURA');
    if (cFecha === -1 || cTipo === -1 || cValor === -1) return;

    valores.slice(1).forEach(fila => {
      if (!fila.some(v => v !== '')) return;

      const cuenta = cuentaDePago_(fila[cTipo], cEmpresa === -1 ? '' : fila[cEmpresa]);
      if (!cuenta) { sinCuenta++; return; }

      const base = bases[cuenta];
      if (!base) return;   // sin saldo base cargado, no hay nada de qué descontar

      const fecha = fechaHoraDeRegistro_(fila[cFecha]);
      // Estrictamente posterior: el saldo base que carga el admin ya refleja
      // todo lo anterior, así que volver a restarlo sería contarlo dos veces.
      if (!fecha || fecha.getTime() <= base.fecha.getTime()) return;

      acumulado[cuenta].gastado += montoANumero_(fila[cValor]);
      acumulado[cuenta].pagos   += 1;
    });
  });

  // Qué cuentas puede VER esta persona. Se filtra acá, en el servidor: si solo
  // se ocultaran en la pantalla, los saldos de las cuentas bancarias igual
  // viajarían al navegador de cualquier usuario.
  //
  // Regla (definida por el usuario): los saldos de los BANCOS son solo para
  // administradores. Un usuario común ve únicamente los fondos (Viáticos y
  // Caja Menor) y solo aquellos cuya sección tenga asignada.
  const esAdministrador = MODO_LOGIN === 'off' || esAdmin_(contexto);
  const visibles = Object.keys(CUENTAS).filter(clave => {
    if (esAdministrador) return true;
    if (CUENTAS[clave].grupo !== 'fondo') return false;
    // La clave de la cuenta coincide con la de la sección ('viaticos', 'caja_menor')
    return contexto.secciones.indexOf(clave) !== -1;
  });

  const cuentas = visibles.map(clave => {
    const cfg  = CUENTAS[clave];
    const base = bases[clave] || null;
    return {
      clave:       clave,
      etiqueta:    cfg.etiqueta,
      detalle:     cfg.detalle,
      grupo:       cfg.grupo,
      configurado: !!base,
      base:        base ? base.monto : 0,
      desde:       base ? Utilities.formatDate(base.fecha, ZONA_HORARIA, 'dd/MM/yyyy HH:mm') : '',
      concepto:    base ? base.concepto : '',
      gastado:     acumulado[clave].gastado,
      pagos:       acumulado[clave].pagos,
      enviado:     acumulado[clave].enviado,
      recibido:    acumulado[clave].recibido,
      traslados:   acumulado[clave].traslados,
      saldo:       base
        ? base.monto - acumulado[clave].gastado - acumulado[clave].enviado + acumulado[clave].recibido
        : 0
    };
  });

  return {
    status:      'success',
    puedeEditar: esAdministrador,
    // Los registros sin cuenta asignada son información de cuadre global:
    // solo le sirve (y solo le corresponde) a un administrador.
    sinCuenta:   esAdministrador ? sinCuenta : 0,
    cuentas:     cuentas
  };
}

// ─── Traslados entre cuentas propias ──────────────────────────────────────
//
// Enviar plata del banco al fondo de viáticos NO es un gasto: el dinero no
// sale de la empresa, cambia de bolsillo. El gasto ocurre después, cuando la
// persona en campo lo usa y carga su recibo. Por eso los traslados viven en su
// propia hoja, quedan fuera de los reportes de pagos, y lo único que hacen es
// mover saldo de una cuenta a otra.
//
// Reglas (definidas por el usuario): solo administradores, siempre de un banco
// hacia un fondo, y con comprobante obligatorio.

const NOMBRE_HOJA_TRASLADOS = 'TRASLADOS';
const CARPETA_TRASLADOS     = 'PJ04 TRASLADOS';
const ENCABEZADOS_TRASLADOS = [
  'FECHA', 'ORIGEN', 'DESTINO', 'MONTO', 'REGISTRADO POR', 'NOTA', 'URL COMPROBANTE'
];

function hojaTraslados_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = ss.getSheetByName(NOMBRE_HOJA_TRASLADOS);
  if (!hoja) {
    hoja = ss.insertSheet(NOMBRE_HOJA_TRASLADOS, ss.getNumSheets());
    hoja.getRange(1, 1, 1, ENCABEZADOS_TRASLADOS.length)
        .setValues([ENCABEZADOS_TRASLADOS]).setFontWeight('bold');
    hoja.setFrozenRows(1);
  }
  return hoja;
}

function trasladosTodos_() {
  const valores = hojaTraslados_().getDataRange().getValues();
  if (valores.length < 2) return [];
  const enc = valores[0];
  const c = {
    fecha:   enc.indexOf('FECHA'),
    origen:  enc.indexOf('ORIGEN'),
    destino: enc.indexOf('DESTINO'),
    monto:   enc.indexOf('MONTO'),
    quien:   enc.indexOf('REGISTRADO POR'),
    nota:    enc.indexOf('NOTA'),
    url:     enc.indexOf('URL COMPROBANTE')
  };
  return valores.slice(1)
    .filter(f => f.some(v => v !== ''))
    .map(f => ({
      fechaTexto: String(f[c.fecha]),
      fecha:      fechaHoraDeRegistro_(f[c.fecha]),
      origen:     String(f[c.origen] || '').trim(),
      destino:    String(f[c.destino] || '').trim(),
      monto:      montoANumero_(f[c.monto]),
      quien:      String(f[c.quien] || ''),
      nota:       String(f[c.nota] || ''),
      url:        String(f[c.url] || '')
    }));
}

function registrarTraslado_(body) {
  const ctx = contextoDe_(body);
  if (MODO_LOGIN !== 'off' && !esAdmin_(ctx)) throw new Error('SOLO_ADMIN');

  const origen  = String(body.origen  || '').trim();
  const destino = String(body.destino || '').trim();

  if (!CUENTAS[origen])  return { status: 'error', message: 'Cuenta de origen desconocida.' };
  if (!CUENTAS[destino]) return { status: 'error', message: 'Cuenta de destino desconocida.' };
  if (origen === destino) return { status: 'error', message: 'El origen y el destino no pueden ser la misma cuenta.' };

  // Banco → fondo, según lo definido. Bloquearlo evita movimientos sin sentido
  // cargados por error, que en saldos serían difíciles de detectar después.
  if (CUENTAS[origen].grupo !== 'banco') {
    return { status: 'error', message: 'El origen tiene que ser una cuenta bancaria.' };
  }
  if (CUENTAS[destino].grupo !== 'fondo') {
    return { status: 'error', message: 'El destino tiene que ser Viáticos o Caja Menor.' };
  }

  const monto = montoANumero_(body.monto);
  if (!monto || monto <= 0) return { status: 'error', message: 'El monto tiene que ser mayor a cero.' };

  if (!body.archivos || !body.archivos.length) {
    return { status: 'error', message: 'Adjuntá el comprobante de la transferencia.' };
  }

  hojaTraslados_().appendRow([
    Utilities.formatDate(new Date(), ZONA_HORARIA, 'dd/MM/yyyy HH:mm'),
    origen,
    destino,
    monto,
    ctx.nombre || ctx.correo || String(body.registrado_por || ''),
    String(body.nota || ''),
    subirArchivosACarpeta_(body.archivos, carpetaPorNombre_(CARPETA_TRASLADOS))
  ]);

  return { status: 'success' };
}

function consultarTraslados_(body) {
  const ctx = contextoDe_(body);
  if (MODO_LOGIN !== 'off' && !esAdmin_(ctx)) throw new Error('SOLO_ADMIN');

  return {
    status: 'success',
    cuentas: Object.keys(CUENTAS).map(c => ({
      clave: c, etiqueta: CUENTAS[c].etiqueta, grupo: CUENTAS[c].grupo
    })),
    // Del más reciente al más viejo: es el orden en que se quiere revisar.
    traslados: trasladosTodos_().reverse().map(t => ({
      fecha:   t.fechaTexto,
      origen:  (CUENTAS[t.origen]  || {}).etiqueta || t.origen,
      destino: (CUENTAS[t.destino] || {}).etiqueta || t.destino,
      monto:   t.monto,
      quien:   t.quien,
      nota:    t.nota,
      url:     t.url
    }))
  };
}

// Cargar / corregir el saldo base de una cuenta. Solo administradores.
function ajustarSaldo_(body) {
  const ctx = contextoDe_(body);
  if (MODO_LOGIN !== 'off' && !esAdmin_(ctx)) throw new Error('SOLO_ADMIN');

  const cuenta = String(body.cuenta || '').trim();
  if (!CUENTAS[cuenta]) return { status: 'error', message: 'Cuenta desconocida: ' + cuenta };

  const monto = montoANumero_(body.monto);
  if (!isFinite(monto)) return { status: 'error', message: 'El monto no es un número válido.' };
  if (monto < 0)        return { status: 'error', message: 'El saldo no puede ser negativo.' };

  // Cada ajuste se agrega como una fila nueva: queda el historial completo de
  // quién puso qué saldo y cuándo. Nunca se pisa una fila anterior.
  hojaSaldos_().appendRow([
    Utilities.formatDate(new Date(), ZONA_HORARIA, 'dd/MM/yyyy HH:mm'),
    cuenta,
    monto,
    String(body.concepto || ''),
    ctx.nombre || ctx.correo || String(body.registrado_por || '')
  ]);

  return { status: 'success' };
}
