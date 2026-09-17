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
    // setValue tiene que escribir DE VERDAD en la fila y columna pedidas: es lo
    // único que permite comprobar que una reparación corrige la celda correcta
    // y no toca ninguna otra.
    getRange: (fila, col) => ({
      getValues: () => [d[0]],
      setValues: () => ({ setFontWeight: () => {} }),
      setValue: v => { if (d[fila - 1]) d[fila - 1][col - 1] = v; }
    }),
    appendRow: r => d.push(r),
    setFrozenRows: () => {}
  };
}

const pago = (fecha, empresa, tipo, valor, nombre) =>
  [fecha, empresa, tipo, 'quien', nombre || 'pago', 'proveedor', '2026-01-01', valor];

function backend(hojasExtra) {
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
  // Permite reemplazar hojas por unas a medida: sin esto no se puede probar
  // una funcion que ESCRIBE, que es justo donde mas caro sale un error.
  Object.keys(hojasExtra || {}).forEach(n => { hojas[n] = hojasExtra[n]; });
  const orden = Object.keys(hojas);

  const ctx = {
    console,
    // Date TIENE que ser el mismo del proceso. Sin esto el sandbox se crea uno
    // propio, `valor instanceof Date` da falso para cualquier fecha que le pase
    // la prueba, y la distinción entre "fecha real de Sheets" y "texto" —que es
    // justo donde estaba el error— quedaba sin poder comprobarse.
    Date,
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
    // formatDate tiene que formatear DE VERDAD: con una constante, las pruebas
    // de fechas pasaban sin comprobar nada.
    Utilities: {
      formatDate: (d, z, f) => {
        const p = n => String(n).padStart(2, '0');
        if (f === 'yyyy-MM-dd HH:mm') {
          return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
                 ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
        }
        if (f === 'yyyy-MM-dd') return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
        return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() +
               ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
      },
      base64Encode: String, base64Decode: String, computeDigest: (a, b) => b,
      getUuid: () => 'uuid-' + Math.random().toString(36).slice(2),
      DigestAlgorithm: { SHA_256: 's' }, newBlob: () => ({})
    }
  };

  let codigo = fs.readFileSync('apps-script.gs', 'utf8')
    .replace(/^const MODO_LOGIN = '[a-z]+';$/m, "const MODO_LOGIN = 'estricto';");
  vm.createContext(ctx);
  vm.runInContext(codigo, ctx);
  return ctx;
}

const g = backend();
const backendCon = hojasExtra => backend(hojasExtra);
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

// ── Fechas: el formato se decide con la evidencia de TODA la columna ──
console.log('\n=== Fechas: el formato de la columna se prueba, no se supone ===');
{
  // Lo que enseñó el caso real: el criterio viejo resolvía CADA CELDA por
  // separado con la regla "un registro no puede ser del futuro". Eso le daba
  // dos lecturas distintas a la misma columna y, peor, convertía en silencio
  // cualquier pago de un mes futuro en uno anterior. La hoja resultó ser
  // uniformemente día/mes, así que esa regla corrompía datos buenos.
  //
  // Ahora basta UN valor con el primer número > 12 para probar que la columna
  // es día/mes. Es una prueba, no una suposición.
  const colFR = (...valores) =>
    g.inferirFormatosDeColumna_(['FECHA REGISTRO'], [['FECHA REGISTRO']].concat(valores.map(v => [v])));

  chk('"15/09/2026" prueba que la columna es día/mes', colFR('15/09/2026 18:40')[0] === 'dmy');
  chk('"9/15/2026" prueba que la columna es mes/día',  colFR('9/15/2026')[0] === 'mdy');
  chk('sin números > 12 no hay prueba', colFR('09/12/2026 14:31')[0] === null);
  chk('con pruebas de los dos formatos la columna queda sin regla única',
      colFR('15/09/2026', '9/15/2026')[0] === null);

  const f = (v, fmt) => g.formatearValorDeCelda_('FECHA REGISTRO', v, fmt);

  // El caso que rompía todo: en una columna probadamente día/mes, un
  // "09/12/2026" es 9 de DICIEMBRE. El criterio viejo lo volvía 12 de
  // septiembre solo por ser diciembre una fecha futura.
  chk('columna día/mes: "09/12/2026 14:31" -> 9 de diciembre',
      f('09/12/2026 14:31', 'dmy') === '2026-12-09 14:31', f('09/12/2026 14:31', 'dmy'));
  chk('columna mes/día: "09/12/2026 14:31" -> 12 de septiembre',
      f('09/12/2026 14:31', 'mdy') === '2026-09-12 14:31', f('09/12/2026 14:31', 'mdy'));
  chk('sin prueba se usa día/mes, que es lo que escribe el sistema',
      f('09/12/2026 14:31', null) === '2026-12-09 14:31', f('09/12/2026 14:31', null));

  // Un número > 12 manda sobre el formato de la columna: no puede ser un mes.
  chk('"15/09/2026 18:40" -> 15 de septiembre aunque la columna diga mes/día',
      f('15/09/2026 18:40', 'mdy') === '2026-09-15 18:40', f('15/09/2026 18:40', 'mdy'));

  // FECHA DE PAGO: antes NO se tocaba y el texto mes/día llegaba crudo al
  // navegador, que lo leía como día/mes. "9/15/2026" se volvía el mes 15
  // —marzo del año siguiente— y el registro desaparecía de los filtros.
  const fp = (v, fmt) => g.formatearValorDeCelda_('FECHA DE PAGO', v, fmt);
  chk('FECHA DE PAGO "9/15/2026" -> 2026-09-15', fp('9/15/2026', 'mdy') === '2026-09-15', fp('9/15/2026', 'mdy'));
  chk('FECHA DE PAGO no inventa hora',           fp('15/09/2026', 'dmy') === '2026-09-15', fp('15/09/2026', 'dmy'));
  chk('FECHA DE PAGO ya en año-mes-día pasa igual', fp('2026-09-15', null) === '2026-09-15');

  // No romper lo que ya estaba bien
  chk('lo que ya viene en año-mes-día pasa igual', f('2026-09-15 18:40', null) === '2026-09-15 18:40');
  chk('un texto que no es fecha no se inventa',      f('sin fecha', null) === 'sin fecha');
  chk('un número no se toca', g.formatearValorDeCelda_('VALOR FACTURA', 1000, null) === 1000);

  // Las fechas REALES de Sheets no dependen de ningún formato.
  const real = new Date(2026, 8, 15, 18, 40);
  chk('una fecha real se formatea con hora en FECHA REGISTRO',
      g.formatearValorDeCelda_('FECHA REGISTRO', real, null) === '2026-09-15 18:40');
  chk('una fecha real se formatea sin hora en FECHA DE PAGO',
      g.formatearValorDeCelda_('FECHA DE PAGO', real, null) === '2026-09-15');

  // La causa raíz: guardar fechas como texto. Si el sistema vuelve a escribir
  // cadenas, la columna de la tabla las marca "Invalid" y volvemos a adivinar.
  chk('fecha_pago del navegador se guarda como fecha REAL',
      g.fechaDeTextoISO_('2026-09-15') instanceof Date);
  chk('fecha_pago vacía no inventa una fecha', g.fechaDeTextoISO_('') === '');
  chk('fecha_pago irreconocible se conserva tal cual', g.fechaDeTextoISO_('quince de sept') === 'quince de sept');

  // Y el orden resultante: el último registrado tiene que quedar primero.
  const filas = [
    { 'FECHA REGISTRO': f('09/12/2026 14:31', 'dmy'), 'NOMBRE DE PAGO': 'diciembre',    'FECHA DE PAGO': '2026-12-09', 'PROVEEDOR': 'x', 'VALOR FACTURA': 1 },
    { 'FECHA REGISTRO': f('15/09/2026 18:40', 'dmy'), 'NOMBRE DE PAGO': 'HIDRATACION',  'FECHA DE PAGO': '2026-09-15', 'PROVEEDOR': 'x', 'VALOR FACTURA': 1 },
    { 'FECHA REGISTRO': f('15/09/2026 14:50', 'dmy'), 'NOMBRE DE PAGO': 'DESAYUNO',     'FECHA DE PAGO': '2026-09-15', 'PROVEEDOR': 'x', 'VALOR FACTURA': 1 },
    { 'FECHA REGISTRO': f('11/09/2026 22:58', 'dmy'), 'NOMBRE DE PAGO': 'peaje',        'FECHA DE PAGO': '2026-09-11', 'PROVEEDOR': 'x', 'VALOR FACTURA': 1 }
  ];

  const html2 = fs.readFileSync('index.html', 'utf8');
  const js2   = [...html2.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];
  const trozos2 = ['function parseFecha', 'function parseFechaHora', 'function filtrarRows'].map(fn => {
    const i = js2.indexOf(fn);
    let prof = 0, j = i, visto = false, c = '';
    while (j < js2.length) {
      const ch = js2[j]; c += ch;
      if (ch === '{') { prof++; visto = true; }
      if (ch === '}') { prof--; if (visto && prof === 0) break; }
      j++;
    }
    return c;
  }).join('\n');

  const ctx2 = { document: { getElementById: () => ({ get value() { return ''; }, _flatpickr: { selectedDates: [] } }) },
                 vistaRestringida: null, TIPOS_GASTOS: [], console, Date };
  vm.createContext(ctx2);
  vm.runInContext(trozos2 + '; this.filtrarRows = filtrarRows; this.parseFecha = parseFecha;', ctx2);

  const orden = ctx2.filtrarRows(filas).map(r => r['NOMBRE DE PAGO']);
  chk('el último registrado queda primero, como en el Sheet',
      JSON.stringify(orden) === JSON.stringify(['diciembre', 'HIDRATACION', 'DESAYUNO', 'peaje']), orden);

  // Guarda del navegador: aunque llegara un mes/día crudo, no puede terminar
  // en un mes inexistente. Sin esto, '9/15/2026' daba marzo de 2027.
  const pf = ctx2.parseFecha('9/15/2026');
  chk('el navegador no acepta un mes > 12',
      pf.getFullYear() === 2026 && pf.getMonth() === 8 && pf.getDate() === 15,
      pf && pf.toDateString());
}

// ── Reparación de las fechas de registro que quedaron en el futuro ───
console.log('\n=== Fechas de registro en el futuro: se detectan y se corrigen ===');
{
  // Caso real (2026-09-16): 40 filas migradas tenían FECHA REGISTRO en texto
  // mes/día ("09/12/2026" = 12 de septiembre). Al convertir la columna a fecha
  // real, Sheets las leyó como día/mes y las guardó como 9 de DICIEMBRE.
  // Quedaron en el futuro, se ordenaron primero, y taparon los pagos recientes.
  const hoy = new Date();
  const futura   = new Date(hoy.getFullYear(), hoy.getMonth() + 3, 9, 14, 31);  // dia 9
  const pasadaOk = new Date(hoy.getFullYear(), hoy.getMonth(), 1, 8, 0);
  const imposible = new Date(hoy.getFullYear(), hoy.getMonth() + 3, 25, 9, 0);  // dia 25: no puede ser mes

  const ENC2 = ['FECHA REGISTRO', 'EMPRESA', 'TIPO FACTURA', 'REGISTRADO POR',
                'NOMBRE DE PAGO', 'PROVEEDOR', 'FECHA DE PAGO', 'VALOR'];
  const datos = [ENC2,
    [futura,    'AMPAC SAS', 'viaticos', 'q', 'corregible', 'p', pasadaOk, 100],
    [pasadaOk,  'AMPAC SAS', 'viaticos', 'q', 'ya esta bien', 'p', pasadaOk, 200],
    ['15/09/2026 18:40', 'AMPAC SAS', 'viaticos', 'q', 'texto', 'p', pasadaOk, 300],
    [imposible, 'AMPAC SAS', 'viaticos', 'q', 'irreparable', 'p', pasadaOk, 400]
  ];

  const hoja = hojaFalsa('Viaticos', datos);
  const ctx3 = backendCon({ 'Viaticos': hoja });

  const sim = ctx3.repararFechasFuturas(true);
  chk('el simulacro no modifica la hoja', datos[1][0] === futura);
  chk('el simulacro anuncia la fila corregible', sim.indexOf('corregible') === -1 ? sim.indexOf('fila 2') !== -1 : true, '');
  chk('el simulacro avisa de la irreparable', sim.indexOf('Revisar a mano') !== -1);
  // El motivo TIENE que distinguirse: "el dia no puede ser un mes" y "queda en
  // el futuro con las dos lecturas" son problemas distintos, y quien lo revise
  // a mano necesita saber cual de los dos tiene enfrente.
  chk('dice POR QUE es irreparable (el dia no puede ser un mes)',
      sim.indexOf('NO se arregla intercambiando dia y mes') !== -1);

  ctx3.repararFechasFuturas(false);
  const y = datos[1][0];
  chk('la fecha futura se corrige intercambiando dia y mes',
      y instanceof Date && y.getDate() === futura.getMonth() + 1 && y.getMonth() === futura.getDate() - 1,
      y && y.toString());
  chk('conserva la hora exacta',
      y.getHours() === 14 && y.getMinutes() === 31, y && y.getHours() + ':' + y.getMinutes());
  chk('la fecha corregida ya no esta en el futuro', y.getTime() <= Date.now() + 86400000);
  chk('una fecha pasada no se toca',   datos[2][0] === pasadaOk);
  chk('una celda de TEXTO no se toca', datos[3][0] === '15/09/2026 18:40');
  chk('una futura con dia > 12 no se toca (no puede ser un mes)', datos[4][0] === imposible);
  chk('FECHA DE PAGO no se toca nunca (un pago si puede ser futuro)',
      datos[1][6] === pasadaOk && datos[4][6] === pasadaOk);

  // Las mal convertidas que NO quedaron en el futuro: "08/05/2026" (5 de agosto
  // en mes/dia) se volvio 8 de mayo, que tambien es pasado y no levanta
  // sospecha. Se delatan por estar lejos de su fecha de pago.
  const malPeroPasada = new Date(2026, 4, 8, 9, 0);    // 8 de mayo (era 5 de agosto)
  const pagoReal      = new Date(2026, 7, 5);          // 5 de agosto
  const datos2 = [ENC2,
    [malPeroPasada, 'AMPAC SAS', 'viaticos', 'q', 'sospechosa', 'p', pagoReal, 100],
    [new Date(2026, 7, 5, 9, 0), 'AMPAC SAS', 'viaticos', 'q', 'coherente', 'p', pagoReal, 200]
  ];
  const ctx4 = backendCon({ 'Viaticos': hojaFalsa('Viaticos', datos2) });
  const sim2 = ctx4.repararFechasFuturas(true);

  chk('detecta la mal convertida que quedo en el pasado', sim2.indexOf('sospechosas por su fecha de pago: 1') !== -1, sim2);
  chk('y dice que daria al intercambiar dia y mes',       sim2.indexOf('2026-08-05 09:00') !== -1);
  chk('NO la corrige sola (las dos lecturas son posibles)', datos2[1][0] === malPeroPasada);
  chk('una fila coherente con su pago no se marca',
      sim2.indexOf('sospechosas por su fecha de pago: 2') === -1);
  chk('ofrece la forma de incluirlas', sim2.indexOf('repararFechasFuturas(false, true)') !== -1);

  // Corregir las sospechosas hay que PEDIRLO: es una decisión distinta, porque
  // ahí las dos lecturas caen en el pasado y la regla del futuro no decide.
  const sim3 = ctx4.repararFechasFuturas(true, true);
  chk('pidiéndolo, el simulacro dice que la corregiria', sim3.indexOf('SE CORRIGE') !== -1);
  chk('pero el simulacro sigue sin tocar la hoja', datos2[1][0] === malPeroPasada);

  ctx4.repararFechasFuturas(false, true);
  const z = datos2[1][0];
  chk('pidiéndolo y aplicando, la sospechosa queda sobre su fecha de pago',
      z instanceof Date && z.getMonth() === 7 && z.getDate() === 5, z && z.toString());
  chk('y conserva la hora', z.getHours() === 9 && z.getMinutes() === 0);
  chk('la fila coherente sigue intacta',
      datos2[2][0].getMonth() === 7 && datos2[2][0].getDate() === 5);
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
