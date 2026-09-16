// Verificación de extremo a extremo de "Consultar Pagos".
// Uso: node prueba-consulta.js
//
// Son datos bancarios: lo que se muestra tiene que ser exactamente lo que
// corresponde, ni de más ni de menos. Se prueban las DOS mitades:
//   1. El servidor: qué hojas lee según los permisos de la persona.
//   2. El navegador: cómo filtra después esos registros.

const fs = require('fs');
const vm = require('vm');

let fallos = 0;
function chk(nombre, cond, detalle) {
  console.log((cond ? '  ok   ' : '  FALLA') + '  ' + nombre + (cond ? '' : '  → ' + JSON.stringify(detalle)));
  if (!cond) fallos++;
}

// ── Mitad 1: el servidor ──────────────────────────────────────────────────
const ENC = ['FECHA REGISTRO', 'EMPRESA', 'TIPO FACTURA', 'REGISTRADO POR',
             'NOMBRE DE PAGO', 'PROVEEDOR', 'FECHA DE PAGO', 'VALOR FACTURA'];

function hojaFalsa(nombre, filas) {
  const d = filas;
  return {
    getName: () => nombre,
    getDataRange: () => ({ getValues: () => d.map(f => f.slice()) }),
    getLastRow: () => d.length,
    getLastColumn: () => (d[0] ? d[0].length : 0),
    getRange: () => ({ getValues: () => [d[0]], setValues: () => ({ setFontWeight: () => {} }) }),
    appendRow: r => d.push(r),
    setFrozenRows: () => {}
  };
}

const pago = (fecha, empresa, tipo, valor, nombre) =>
  [fecha, empresa, tipo, 'quien', nombre || 'pago', 'proveedor', '2026-01-01', valor];

function backend() {
  const hojas = {
    'PAGOS REGISTRADOS': hojaFalsa('PAGOS REGISTRADOS', [ENC,
      pago('01/02/2026 10:00', 'AMPAC SAS',     'compra',          100000, 'compra ampac'),
      pago('02/02/2026 10:00', 'Millennium Co', 'pago_proveedor',  200000, 'prov millennium'),
      pago('03/02/2026 10:00', 'AMPAC SAS',     'venta',           900000, 'venta ampac')]),
    'Viaticos': hojaFalsa('Viaticos', [ENC,
      pago('04/02/2026 10:00', 'AMPAC SAS',     'viaticos',  50000, 'peaje'),
      pago('05/02/2026 10:00', 'Millennium Co', 'viaticos',  70000, 'hotel')]),
    'Caja Menor': hojaFalsa('Caja Menor', [ENC,
      pago('06/02/2026 10:00', 'AMPAC SAS',     'caja_menor', 20000, 'papeleria')]),
    'Pago Nomina': hojaFalsa('Pago Nomina', [ENC,
      pago('07/02/2026 10:00', 'Millennium Co', 'nomina',    800000, 'nomina feb')]),
    'SOLICITUDES DE APROBACION': hojaFalsa('SOLICITUDES DE APROBACION', [['ID SOLICITUD']]),
    'SALDOS':   hojaFalsa('SALDOS',   [['FECHA', 'CUENTA', 'SALDO BASE', 'CONCEPTO', 'REGISTRADO POR']]),
    'USUARIOS': hojaFalsa('USUARIOS', [['CORREO', 'NOMBRE', 'TELEFONO', 'ROL', 'SECCIONES', 'ESTADO', 'FECHA REGISTRO', 'ULTIMO ACCESO']])
  };
  const orden = Object.keys(hojas);

  const ctx = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ({
      getSheets: () => orden.map(n => hojas[n]),
      getSheetByName: n => hojas[n] || null,
      getNumSheets: () => orden.length,
      insertSheet: n => (hojas[n] = hojaFalsa(n, [])),
      getName: () => 'x', getId: () => 'x'
    }), flush: () => {} },
    DriveApp: { getFoldersByName: () => ({ hasNext: () => false }), createFolder: () => ({}), getFileById: () => ({ makeCopy: () => {} }) },
    MailApp: { sendEmail: () => {} },
    Logger: { log: () => {} },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 500, getContentText: () => '{}' }) },
    ContentService: { createTextOutput: t => ({ setMimeType: () => t }), MimeType: { JSON: 'j' } },
    Utilities: { formatDate: () => '01/01/2026 00:00', base64Encode: String, computeDigest: (a, b) => b,
                 DigestAlgorithm: { SHA_256: 's' }, newBlob: () => ({}) }
  };

  let codigo = fs.readFileSync('apps-script.gs', 'utf8')
    .replace(/^const MODO_LOGIN = '[a-z]+';$/m, "const MODO_LOGIN = 'estricto';");
  vm.createContext(ctx);
  vm.runInContext(codigo, ctx);
  return ctx;
}

const g = backend();
const tipos = filas => filas.map(f => f['TIPO FACTURA']).sort();

console.log('\n=== El servidor entrega solo las hojas permitidas ===');
{
  const laura = g.consultarPagos_({ secciones: ['viaticos', 'caja_menor'] });
  chk('Viáticos + Caja Menor → 3 registros', laura.length === 3, laura.length);
  chk('y son exactamente los de esas dos hojas',
      JSON.stringify(tipos(laura)) === JSON.stringify(['caja_menor', 'viaticos', 'viaticos']), tipos(laura));
  chk('ninguno de la hoja principal', laura.every(r => ['compra', 'pago_proveedor', 'venta'].indexOf(r['TIPO FACTURA']) === -1));

  const soloViaticos = g.consultarPagos_({ secciones: ['viaticos'] });
  chk('solo Viáticos → 2 registros', soloViaticos.length === 2, soloViaticos.length);

  const conNomina = g.consultarPagos_({ secciones: ['viaticos', 'nomina'] });
  chk('Viáticos + Nómina → llega también la hoja de Nómina',
      JSON.stringify(tipos(conNomina)) === JSON.stringify(['nomina', 'viaticos', 'viaticos']), tipos(conNomina));

  const admin = g.consultarPagos_({ secciones: ['pagos', 'viaticos', 'caja_menor', 'impuestos', 'seguridad_social', 'nomina'] });
  chk('el admin recibe los 7 de todas las hojas', admin.length === 7, admin.length);

  const sinNada = g.consultarPagos_({ secciones: [] });
  chk('sin secciones no recibe nada', sinNada.length === 0, sinNada.length);

  chk('nunca llegan filas de SOLICITUDES ni SALDOS ni USUARIOS',
      admin.every(r => r['TIPO FACTURA'] !== undefined && r['ID SOLICITUD'] === undefined));
}

// ── Mitad 2: el filtrado en el navegador ──────────────────────────────────
// Se extrae filtrarRows de index.html y se ejecuta con un DOM simulado.
console.log('\n=== El filtro del navegador sobre esos registros ===');
{
  const html = fs.readFileSync('index.html', 'utf8');
  const js   = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];

  const trozos = ['function parseFecha', 'function parseFechaHora', 'function filtrarRows'].map(f => {
    const i = js.indexOf(f);
    if (i === -1) throw new Error('No se encontró ' + f + ' en index.html');
    let prof = 0, j = i, visto = false, c = '';
    while (j < js.length) {
      const ch = js[j]; c += ch;
      if (ch === '{') { prof++; visto = true; }
      if (ch === '}') { prof--; if (visto && prof === 0) break; }
      j++;
    }
    return c;
  }).join('\n');

  const campos = {};
  const doc = { getElementById: (id) => ({
    get value() { return campos[id] || ''; },
    _flatpickr: { selectedDates: campos['_' + id] ? [campos['_' + id]] : [] }
  }) };

  const ctx = { document: doc, vistaRestringida: null, TIPOS_GASTOS: ['viaticos', 'caja_menor'], console, Date };
  vm.createContext(ctx);
  vm.runInContext(trozos + '; this.filtrarRows = filtrarRows;', ctx);

  const filas = g.consultarPagos_({ secciones: ['viaticos', 'caja_menor'] });

  // Sin filtros: tiene que devolver TODO lo que el servidor entregó
  Object.keys(campos).forEach(k => delete campos[k]);
  const sinFiltro = ctx.filtrarRows(filas);
  chk('sin filtros muestra los 3 registros del usuario', sinFiltro.length === 3, sinFiltro.length);

  // Filtrando por tipo Viáticos
  campos['fTipo'] = 'viaticos';
  const soloViat = ctx.filtrarRows(filas);
  chk('filtrando "Viáticos" quedan los 2 de viáticos', soloViat.length === 2, soloViat.length);
  chk('y ninguno es de caja menor', soloViat.every(r => r['TIPO FACTURA'] === 'viaticos'));

  // Filtrando por empresa AMPAC + Viáticos (el caso exacto de la captura)
  campos['fEmpresa'] = 'ampac sas';
  const ampacViat = ctx.filtrarRows(filas);
  chk('AMPAC + Viáticos devuelve 1 registro', ampacViat.length === 1, ampacViat.length);
  chk('y es el de AMPAC', ampacViat[0] && ampacViat[0]['EMPRESA'] === 'AMPAC SAS', ampacViat[0]);

  // Filtrar por un tipo que el usuario NO puede ver no debe inventar nada
  Object.keys(campos).forEach(k => delete campos[k]);
  campos['fTipo'] = 'nomina';
  chk('filtrar por un tipo sin permiso devuelve vacío, no error',
      ctx.filtrarRows(filas).length === 0);

  Object.keys(campos).forEach(k => delete campos[k]);
  chk('devuelve ordenado (no rompe con fechas iguales)', ctx.filtrarRows(filas).length === 3);
}

// ── Orden cronológico: del último registrado al primero ───────────────────
console.log('\n=== Orden: del último registrado al primero ===');
{
  // Caso real reportado: varios viáticos con la MISMA fecha de pago. Ordenar
  // por fecha de pago los dejaba en el orden de la hoja —que no es cronológico,
  // porque la migración agregó las filas viejas al final—, así que un registro
  // de prueba viejo aparecía antes que el último cargado del día.
  const html = fs.readFileSync('index.html', 'utf8');
  const js   = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];

  const trozos = ['function parseFecha', 'function parseFechaHora', 'function filtrarRows'].map(f => {
    const i = js.indexOf(f);
    if (i === -1) throw new Error('No se encontró ' + f);
    let prof = 0, j = i, visto = false, c = '';
    while (j < js.length) {
      const ch = js[j]; c += ch;
      if (ch === '{') { prof++; visto = true; }
      if (ch === '}') { prof--; if (visto && prof === 0) break; }
      j++;
    }
    return c;
  }).join('\n');

  const campos = {};
  const doc = { getElementById: () => ({ get value() { return ''; }, _flatpickr: { selectedDates: [] } }) };
  const ctx = { document: doc, vistaRestringida: null, TIPOS_GASTOS: [], console, Date };
  vm.createContext(ctx);
  vm.runInContext(trozos + '; this.filtrarRows = filtrarRows;', ctx);

  // Mismo día de pago, distintas horas de registro, en orden arbitrario de hoja
  const p = (registro, nombre) => ({
    'FECHA REGISTRO': registro, 'FECHA DE PAGO': '2026-09-15',
    'EMPRESA': 'AMPAC SAS', 'TIPO FACTURA': 'viaticos',
    'NOMBRE DE PAGO': nombre, 'PROVEEDOR': 'x', 'VALOR FACTURA': 1
  });

  const filas = [
    p('15/09/2026 19:40', 'TEST viaticos'),     // el más nuevo, pero primero en la hoja
    p('15/09/2026 14:50', 'DESAYUNO'),
    p('15/09/2026 18:40', 'HIDRATACION'),
    p('15/09/2026 15:00', 'MATERIALES')
  ];

  const orden = ctx.filtrarRows(filas).map(r => r['NOMBRE DE PAGO']);
  chk('ordena por hora de registro, del más nuevo al más viejo',
      JSON.stringify(orden) === JSON.stringify(['TEST viaticos', 'HIDRATACION', 'MATERIALES', 'DESAYUNO']),
      orden);

  // La hora importa: sin ella, los cuatro empatarían y quedaría el orden de hoja
  const soloFecha = ctx.filtrarRows([
    p('16/09/2026 09:00', 'de hoy'),
    p('15/09/2026 23:59', 'de ayer tarde')
  ]).map(r => r['NOMBRE DE PAGO']);
  chk('un registro de hoy va antes que uno de ayer',
      JSON.stringify(soloFecha) === JSON.stringify(['de hoy', 'de ayer tarde']), soloFecha);

  // Filas sin fecha de registro (datos viejos) no deben romper el orden
  const conHuecos = ctx.filtrarRows([
    { 'FECHA REGISTRO': '', 'FECHA DE PAGO': '2026-09-10', 'NOMBRE DE PAGO': 'sin registro', 'PROVEEDOR': 'x', 'VALOR FACTURA': 1 },
    p('15/09/2026 10:00', 'con registro')
  ]).map(r => r['NOMBRE DE PAGO']);
  chk('las filas sin fecha de registro no rompen el orden',
      conHuecos.length === 2 && conHuecos[0] === 'con registro', conHuecos);
}

// ── Alta completa de cada tipo de pago ────────────────────────────────────
console.log('\n=== Cada tipo de pago está dado de alta en TODOS lados ===');
{
  // Agregar un tipo toca ocho lugares distintos. Olvidar uno da fallos sutiles:
  // ya pasó con el CSS de selección (el botón no se marcaba al tocarlo) y
  // tipoInfo() etiqueta como "Venta" cualquier tipo sin caso propio.
  const gs   = fs.readFileSync('apps-script.gs', 'utf8');
  const html = fs.readFileSync('index.html', 'utf8');
  const js   = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];

  // Fuente de verdad: las secciones declaradas en el backend
  const bloque   = gs.match(/const SECCIONES = \{[\s\S]*?\n\};/)[0];
  const secciones = [...bloque.matchAll(/^\s{2}(\w+)\s*:/gm)].map(m => m[1]);
  chk('se leyeron las secciones del backend', secciones.length >= 7, secciones);

  // Los tipos de pago que tienen botón propio (la sección 'pagos' agrupa varios)
  const tiposConSeccionPropia = secciones.filter(s => s !== 'pagos');

  tiposConSeccionPropia.forEach(tipo => {
    const etiqueta = tipo.replace(/_/g, ' ');

    chk(etiqueta + ': tiene botón en Nuevo Pago y en Solicitudes',
        (html.match(new RegExp('data-value="' + tipo + '"', 'g')) || []).length >= 2,
        (html.match(new RegExp('data-value="' + tipo + '"', 'g')) || []).length);

    chk(etiqueta + ': tiene color de selección (si no, el botón no se marca)',
        html.indexOf('.tipo-btn.active[data-value="' + tipo + '"]') !== -1);

    chk(etiqueta + ': está en el filtro de Consultar Pagos',
        html.indexOf('<option value="' + tipo + '"') !== -1);

    chk(etiqueta + ': seccionDeTipoFront lo reconoce',
        new RegExp("=== '" + tipo + "'\\s*\\)\\s*return '" + tipo + "'").test(js));

    chk(etiqueta + ': tiene etiqueta en Configuración',
        new RegExp('\\b' + tipo + '\\s*:').test(js.match(/const ETIQUETA_SECCION = \{[\s\S]*?\};/)[0]));

    // Se EJECUTA la función real en vez de buscar texto en el código: el código
    // usa prefijos ('impuesto', 'viatic') y una comparación de cadenas daba
    // falsos negativos. Lo que importa es el resultado, no cómo esté escrito.
    const etiquetaCorreo = g.etiquetaTipo_(tipo);
    chk(etiqueta + ': etiquetaTipo_ lo traduce para los correos',
        etiquetaCorreo && etiquetaCorreo !== tipo && etiquetaCorreo !== '—',
        etiquetaCorreo);
  });

  // tipoInfo devuelve "Venta" por defecto: cualquier tipo sin caso propio se
  // etiquetaría MAL en la tabla de resultados y en los reportes exportados,
  // en silencio. También se ejecuta de verdad.
  const cuerpoTipoInfo = js.match(/function tipoInfo[\s\S]*?\n    \}/)[0];
  const ctxInfo = { console };
  vm.createContext(ctxInfo);
  vm.runInContext(cuerpoTipoInfo + '; this.tipoInfo = tipoInfo;', ctxInfo);

  const malEtiquetados = tiposConSeccionPropia
    .map(t => ({ tipo: t, info: ctxInfo.tipoInfo(t) }))
    .filter(x => x.info.label === 'Venta' || x.info.badgeClass === 'badge-venta');
  chk('ningún tipo cae al "Venta" por defecto de tipoInfo',
      malEtiquetados.length === 0, malEtiquetados);

  // Y que la etiqueta mostrada sea coherente entre la app y los correos
  const incoherentes = tiposConSeccionPropia
    .map(t => ({ tipo: t, app: ctxInfo.tipoInfo(t).label, correo: g.etiquetaTipo_(t) }))
    .filter(x => x.app !== x.correo);
  chk('la etiqueta coincide entre la app y los correos',
      incoherentes.length === 0, incoherentes);
}

console.log('\n' + (fallos ? 'FALLARON ' + fallos + ' comprobaciones' : 'TODAS LAS COMPROBACIONES PASARON'));
process.exit(fallos ? 1 : 0);
