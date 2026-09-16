// Banco de pruebas de la lógica de permisos de apps-script.gs.
// Carga el script real con las APIs de Google stubbeadas y verifica el
// comportamiento de acceso. No toca nada en producción.

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const RUTA = process.argv[2];
if (!RUTA) { console.error('Uso: node prueba-permisos.js <ruta a apps-script.gs>'); process.exit(2); }

let fallos = 0;
function chk(nombre, cond, detalle) {
  console.log((cond ? '  ok   ' : '  FALLA') + '  ' + nombre + (cond ? '' : '  → ' + detalle));
  if (!cond) fallos++;
}

// ── Sheet falso ───────────────────────────────────────────────────────────
function hojaFalsa(nombre, filas) {
  const datos = filas || [];
  return {
    _nombre: nombre,
    getName: () => nombre,
    getDataRange: () => ({ getValues: () => datos.map(f => f.slice()) }),
    getLastRow: () => datos.length,
    getLastColumn: () => (datos[0] ? datos[0].length : 0),
    getRange: (f, c, nf, nc) => ({
      getValues: () => [datos[f - 1].slice(c - 1, c - 1 + (nc || 1))],
      setValues: (v) => { v.forEach((fila, i) => { datos[f - 1 + i] = fila.slice(); }); return { setFontWeight: () => {} }; },
      setValue: (v) => { datos[f - 1][c - 1] = v; }
    }),
    appendRow: (fila) => datos.push(fila.slice()),
    setFrozenRows: () => {},
    _datos: datos
  };
}

function montar(modoLogin, usuarios) {
  const ENC = ['CORREO','NOMBRE','TELEFONO','ROL','SECCIONES','ESTADO','FECHA REGISTRO','ULTIMO ACCESO'];
  const hojas = {
    'PAGOS REGISTRADOS': hojaFalsa('PAGOS REGISTRADOS', [['TIPO FACTURA'], ['compra']]),
    'Viaticos':          hojaFalsa('Viaticos',          [['TIPO FACTURA'], ['viaticos']]),
    'Caja Menor':        hojaFalsa('Caja Menor',        [['TIPO FACTURA'], ['caja_menor']]),
    'Pago Nomina':       hojaFalsa('Pago Nomina',       [['TIPO FACTURA'], ['nomina']]),
    'USUARIOS':          hojaFalsa('USUARIOS',          [ENC].concat(usuarios || []))
  };
  const orden = ['PAGOS REGISTRADOS','SOLICITUDES DE APROBACION','Viaticos','Caja Menor','Pago Nomina','USUARIOS'];

  const ctx = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheets: () => orden.map(n => hojas[n]).filter(Boolean),
        getSheetByName: (n) => hojas[n] || null,
        getNumSheets: () => orden.length,
        insertSheet: (n) => { hojas[n] = hojaFalsa(n, []); orden.push(n); return hojas[n]; },
        getName: () => 'CONTROL DE PAGOS',
        getId: () => 'id'
      }),
      flush: () => {}
    },
    DriveApp:   { getFoldersByName: () => ({ hasNext: () => false }), createFolder: (n) => ({ _n: n }), getFileById: () => ({ makeCopy: () => {} }) },
    MailApp:    { sendEmail: () => {} },
    Logger:     { log: () => {} },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
    UrlFetchApp:  { fetch: () => ({ getResponseCode: () => 500, getContentText: () => '{}' }) },
    ContentService: { createTextOutput: (t) => ({ setMimeType: () => t }), MimeType: { JSON: 'json' } },
    Utilities: {
      formatDate: () => '01/01/2026 00:00',
      base64Encode: (x) => String(x),
      computeDigest: (a, b) => b,
      DigestAlgorithm: { SHA_256: 'sha256' },
      newBlob: () => ({})
    }
  };

  let codigo = fs.readFileSync(RUTA, 'utf8');
  // Sustituye el valor real que tenga el archivo, sea cual sea: MODO_LOGIN es un
  // interruptor operativo que se mueve seguido, y una búsqueda literal de 'off'
  // dejaba las pruebas corriendo todas en el mismo modo sin avisar.
  // Se comprueba que el patrón COINCIDA, no que el texto cambie: si el modo
  // pedido ya es el del archivo, el resultado es idéntico y eso no es un error.
  const patron = /^const MODO_LOGIN = '[a-z]+';$/m;
  if (!patron.test(codigo)) {
    throw new Error('No se pudo fijar MODO_LOGIN en las pruebas: cambió la forma de la declaración.');
  }
  codigo = codigo.replace(patron, "const MODO_LOGIN = '" + modoLogin + "';");
  vm.createContext(ctx);
  vm.runInContext(codigo, ctx);
  return ctx;
}

console.log('\n=== MODO_LOGIN = off: todo abierto, como antes del login ===');
{
  const g = montar('off', []);
  const ctx = g.contextoDe_(null);
  chk('da acceso a todas las secciones', ctx.secciones.length === 6, JSON.stringify(ctx.secciones));
  const hojas = g.hojasPermitidas_(ctx).map(h => h.getName());
  chk('lee las hojas de pagos que existen', hojas.length === 4, JSON.stringify(hojas));
  chk('NUNCA incluye la hoja USUARIOS', hojas.indexOf('USUARIOS') === -1, JSON.stringify(hojas));
  chk('NUNCA incluye SOLICITUDES', hojas.indexOf('SOLICITUDES DE APROBACION') === -1, JSON.stringify(hojas));
}

console.log('\n=== seccionesDeUsuario_: cómo se interpreta la columna SECCIONES ===');
{
  const g = montar('off', []);
  chk('"todas" = las 6',        g.seccionesDeUsuario_({ SECCIONES: 'todas' }).length === 6);
  chk('vacío = las 6',          g.seccionesDeUsuario_({ SECCIONES: '' }).length === 6);
  const dos = g.seccionesDeUsuario_({ SECCIONES: 'viaticos,caja_menor' });
  chk('lista de dos = 2',       dos.length === 2 && dos.indexOf('viaticos') !== -1, JSON.stringify(dos));
  chk('tolera espacios',        g.seccionesDeUsuario_({ SECCIONES: ' viaticos , nomina ' }).length === 2);
  chk('MAYÚSCULAS funcionan',   g.seccionesDeUsuario_({ SECCIONES: 'VIATICOS' }).length === 1);
  const basura = g.seccionesDeUsuario_({ SECCIONES: 'viaticos,inventada,../otra' });
  chk('descarta secciones que no existen', basura.length === 1 && basura[0] === 'viaticos', JSON.stringify(basura));
}

console.log('\n=== estricto: el filtrado real por permisos ===');
{
  const g = montar('estricto', [
    ['laura@x.com', 'Laura', '300', 'usuario', 'viaticos', 'activo', '', ''],
    ['nathan@ylevigroup.com', 'Nathan', '', 'admin', 'todas', 'activo', '', '']
  ]);
  const laura = g.usuarioPorCorreo_('laura@x.com');
  const ctxL  = { secciones: g.seccionesDeUsuario_(laura) };
  const hojasL = g.hojasPermitidas_(ctxL).map(h => h.getName());
  chk('usuario de viáticos ve SOLO su hoja', hojasL.length === 1 && hojasL[0] === 'Viaticos', JSON.stringify(hojasL));

  const filas = g.consultarPagos_(ctxL);
  chk('su consulta trae solo filas de viáticos',
      filas.length === 1 && filas[0]['TIPO FACTURA'] === 'viaticos', JSON.stringify(filas));

  const admin = g.usuarioPorCorreo_('nathan@ylevigroup.com');
  const ctxA  = { secciones: g.seccionesDeUsuario_(admin) };
  chk('el admin ve todas las hojas', g.hojasPermitidas_(ctxA).length === 4);

  chk('correo con otra capitalización resuelve igual',
      !!g.usuarioPorCorreo_('LAURA@X.COM'));
  chk('correo desconocido no resuelve', g.usuarioPorCorreo_('nadie@x.com') === null);
}

console.log('\n=== estricto: sin token no se pasa ===');
{
  const g = montar('estricto', []);
  let lanzo = false, msg = '';
  try { g.contextoDe_({}); } catch (e) { lanzo = true; msg = String(e.message); }
  chk('contextoDe_ rechaza sin token', lanzo && msg.indexOf('SESION_INVALIDA') !== -1, msg);

  let bloqueo = false;
  try { g.registrarPago_({ tipo_factura: 'viaticos' }); } catch (e) { bloqueo = true; }
  chk('registrarPago_ se bloquea sin sesión', bloqueo);
}

console.log('\n=== suave: si no hay token, se deja pasar (para probar sin romper) ===');
{
  const g = montar('suave', []);
  let ok = true;
  try { const c = g.contextoDe_({}); ok = c.secciones.length === 6; } catch (e) { ok = false; }
  chk('sin token pasa con acceso total', ok);
}

console.log('\n=== permiso de escritura por sección ===');
{
  const g = montar('off', []);
  // en modo off cualquiera escribe; se prueba la ruta de permiso directamente
  const ctxL = { secciones: ['viaticos'] };
  chk('viaticos permitido para quien lo tiene', ctxL.secciones.indexOf(g.seccionDeTipo_('viaticos')) !== -1);
  chk('nomina NO permitido para quien solo tiene viaticos', ctxL.secciones.indexOf(g.seccionDeTipo_('nomina')) === -1);
  chk('compra cae en la sección "pagos"', g.seccionDeTipo_('compra') === 'pagos');
  chk('tipo desconocido cae en "pagos", no explota', g.seccionDeTipo_('zzz') === 'pagos');
}

console.log('\n=== red de seguridad: no quedarse sin administradores ===');
{
  const g = montar('off', [
    ['nathan@ylevigroup.com', 'Nathan', '', 'admin', 'todas', 'activo', '', '']
  ]);
  const r = g.guardarUsuario_({ correo: 'nathan@ylevigroup.com', rol: 'usuario', estado: 'activo', secciones: 'viaticos' });
  chk('rechaza degradar al ÚNICO admin', r.status === 'error', JSON.stringify(r));

  const g2 = montar('off', [
    ['nathan@ylevigroup.com', 'Nathan', '', 'admin', 'todas', 'activo', '', ''],
    ['joseph@ylevigroup.com', 'Joseph', '', 'admin', 'todas', 'activo', '', '']
  ]);
  const r2 = g2.guardarUsuario_({ correo: 'nathan@ylevigroup.com', rol: 'usuario', estado: 'activo', secciones: 'viaticos' });
  chk('permite degradar si queda otro admin', r2.status === 'success', JSON.stringify(r2));

  const r3 = g2.guardarUsuario_({ correo: 'x@x.com', rol: 'inventado', estado: 'activo' });
  chk('rechaza rol inválido', r3.status === 'error');
  const r4 = g2.guardarUsuario_({ correo: 'x@x.com', rol: 'usuario', estado: 'inventado' });
  chk('rechaza estado inválido', r4.status === 'error');
  const r5 = g2.guardarUsuario_({ correo: 'x@x.com', rol: 'usuario', estado: 'activo', secciones: 'viaticos,inventada' });
  chk('guarda solo las secciones válidas', r5.status === 'success' &&
      String(g2.usuarioPorCorreo_('x@x.com')['SECCIONES']) === 'viaticos',
      String(g2.usuarioPorCorreo_('x@x.com')['SECCIONES']));
}

console.log('\n=== verificación del token: qué rechaza ===');
{
  const g = montar('estricto', []);
  chk('token vacío = null', g.verificarIdToken_('') === null);
  chk('token nulo = null',  g.verificarIdToken_(null) === null);
  // respuesta 500 de Google → null (el stub devuelve 500)
  chk('si Google no responde 200 = null', g.verificarIdToken_('loquesea') === null);
}

console.log('\n' + (fallos ? 'FALLARON ' + fallos + ' comprobaciones' : 'TODAS LAS COMPROBACIONES PASARON'));
process.exit(fallos ? 1 : 0);
