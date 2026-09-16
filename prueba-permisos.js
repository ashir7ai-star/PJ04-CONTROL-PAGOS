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

// El tercer parámetro permite simular sesiones reales: el "token" es
// simplemente el correo, y el stub de UrlFetchApp responde como lo haría
// Google. Sin esto no se puede probar nada en modo 'estricto'.
const ENC_SOL = ['ID SOLICITUD','FECHA SOLICITUD','EMPRESA','TIPO DE PAGO','NOMBRE DEL PAGO',
                 'PROVEEDOR','FECHA DE PAGO','VALOR','SOLICITADO POR','CORREO','NOTAS',
                 'URL ARCHIVO','ESTADO','REVISADO POR','FECHA DECISION','COMENTARIO'];

function montar(modoLogin, usuarios, solicitudes) {
  const ENC = ['CORREO','NOMBRE','TELEFONO','ROL','SECCIONES','ESTADO','FECHA REGISTRO','ULTIMO ACCESO'];
  const hojas = {
    'PAGOS REGISTRADOS': hojaFalsa('PAGOS REGISTRADOS', [['TIPO FACTURA'], ['compra']]),
    'Viaticos':          hojaFalsa('Viaticos',          [['TIPO FACTURA'], ['viaticos']]),
    'Caja Menor':        hojaFalsa('Caja Menor',        [['TIPO FACTURA'], ['caja_menor']]),
    'Pago Nomina':       hojaFalsa('Pago Nomina',       [['TIPO FACTURA'], ['nomina']]),
    'USUARIOS':          hojaFalsa('USUARIOS',          [ENC].concat(usuarios || [])),
    'SOLICITUDES DE APROBACION': hojaFalsa('SOLICITUDES DE APROBACION',
      [ENC_SOL].concat(solicitudes || []))
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
    // El "token" es el correo. Se responde como Google: aud correcto, correo
    // verificado y vigente. Así se pueden probar las rutas con sesión real.
    UrlFetchApp: { fetch: (url) => {
      const correo = decodeURIComponent(String(url).split('id_token=')[1] || '');
      if (!correo || correo === 'invalido') {
        return { getResponseCode: () => 400, getContentText: () => '{}' };
      }
      const aud = (fs.readFileSync(RUTA, 'utf8').match(/const CLIENT_ID_GOOGLE = '([^']+)'/) || [])[1];
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({
          aud: aud, email: correo, email_verified: 'true',
          name: correo.split('@')[0], exp: Math.floor(Date.now() / 1000) + 3600
        })
      };
    } },
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

// SECCIONES se declara con `const`, y los `const` NO quedan expuestos como
// propiedad del contexto: hay que evaluarlos dentro para poder leerlos.
// Se lee del backend en vez de escribir el número a mano, así agregar una
// sección nueva no rompe pruebas que no tienen nada que ver con ella.
function totalSecciones(g) {
  return vm.runInContext('Object.keys(SECCIONES).length', g);
}

console.log('\n=== MODO_LOGIN = off: todo abierto, como antes del login ===');
{
  const g = montar('off', []);
  const ctx = g.contextoDe_(null);
  // El total se lee del backend y no se escribe a mano: agregar una sección
  // nueva no debe romper una prueba que no tiene nada que ver con ella.
  const TOTAL = totalSecciones(g);
  chk('da acceso a todas las secciones', ctx.secciones.length === TOTAL, JSON.stringify(ctx.secciones));
  const hojas = g.hojasPermitidas_(ctx).map(h => h.getName());
  chk('lee las hojas de pagos que existen', hojas.length === 4, JSON.stringify(hojas));
  chk('NUNCA incluye la hoja USUARIOS', hojas.indexOf('USUARIOS') === -1, JSON.stringify(hojas));
  chk('NUNCA incluye SOLICITUDES', hojas.indexOf('SOLICITUDES DE APROBACION') === -1, JSON.stringify(hojas));
}

console.log('\n=== seccionesDeUsuario_: cómo se interpreta la columna SECCIONES ===');
{
  const g = montar('off', []);
  const TOTAL = totalSecciones(g);
  chk('"todas" = todas las secciones', g.seccionesDeUsuario_({ SECCIONES: 'todas' }).length === TOTAL);
  chk('vacío = todas las secciones',   g.seccionesDeUsuario_({ SECCIONES: '' }).length === TOTAL);
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
  try { const c = g.contextoDe_({}); ok = c.secciones.length === totalSecciones(g); } catch (e) { ok = false; }
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
  // El simulador rechaza el token 'invalido' respondiendo 400, como haría
  // Google ante uno falso o vencido.
  chk('si Google no responde 200 = null', g.verificarIdToken_('invalido') === null);
  // Y un token con "aud" de otra aplicación tampoco pasa.
  chk('token legítimo pero de OTRA app = null', (function () {
    const g2 = montar('estricto', []);
    g2.UrlFetchApp.fetch = () => ({
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({
        aud: 'otra-app.apps.googleusercontent.com', email: 'x@y.com',
        email_verified: 'true', exp: Math.floor(Date.now() / 1000) + 3600
      })
    });
    return g2.verificarIdToken_('x@y.com') === null;
  })());
}

console.log('\n=== Privacidad de las solicitudes de aprobación ===');
{
  const sol = (id, quien, correo) =>
    [id, id, 'AMPAC SAS', 'compra', 'pago ' + id, 'prov', '2026-01-01', 1000,
     quien, correo, '', '', 'Pendiente', '', '', ''];

  const g = montar('estricto', [
    ['laura@x.com',  'Laura',  '300', 'usuario', 'viaticos', 'activo', '', ''],
    ['pedro@x.com',  'Pedro',  '300', 'usuario', 'viaticos', 'activo', '', ''],
    ['nathan@y.com', 'Nathan', '',    'admin',   'todas',    'activo', '', '']
  ], [
    sol('1', 'Laura', 'laura@x.com'),
    sol('2', 'Pedro', 'pedro@x.com'),
    sol('3', 'Laura', 'LAURA@X.COM'),   // mismo correo, otra capitalización
    sol('4', 'Nathan', 'nathan@y.com')
  ]);

  const ids = r => r.map(x => String(x['ID SOLICITUD'])).sort();

  const deLaura = g.consultarSolicitudes_({ idToken: 'laura@x.com' });
  chk('un usuario ve SOLO sus solicitudes',
      JSON.stringify(ids(deLaura)) === JSON.stringify(['1', '3']), ids(deLaura));
  chk('no recibe las de otros usuarios ni siquiera en la respuesta',
      JSON.stringify(deLaura).indexOf('pedro@x.com') === -1, 'se filtró el correo de otro');
  chk('el correo se compara sin importar mayúsculas', ids(deLaura).indexOf('3') !== -1);

  const dePedro = g.consultarSolicitudes_({ idToken: 'pedro@x.com' });
  chk('otro usuario ve solo la suya',
      JSON.stringify(ids(dePedro)) === JSON.stringify(['2']), ids(dePedro));

  const delAdmin = g.consultarSolicitudes_({ idToken: 'nathan@y.com' });
  chk('el administrador ve TODAS (es quien aprueba)',
      ids(delAdmin).length === 4, ids(delAdmin));

  // El correo de una solicitud nueva sale de la sesión, no del formulario:
  // si fuera un campo libre, cualquiera podría escribir el de otro y ver lo ajeno.
  g.crearSolicitud_({ idToken: 'pedro@x.com', correo: 'laura@x.com',
                      empresa: 'AMPAC SAS', tipo_factura: 'compra',
                      nombre_pago: 'intento', monto: '1', fecha_envio: '9' });
  const trasIntento = g.consultarSolicitudes_({ idToken: 'laura@x.com' });
  chk('no se puede crear una solicitud a nombre de otro',
      ids(trasIntento).indexOf('9') === -1, ids(trasIntento));
  chk('esa solicitud queda a nombre de quien realmente la creó',
      ids(g.consultarSolicitudes_({ idToken: 'pedro@x.com' })).indexOf('9') !== -1);
}

console.log('\n=== Ningún endpoint del Web App queda sin validar sesión ===');
{
  // Encontrado en producción el 2026-09-16: `decidir_solicitud` dejaba a
  // cualquiera con la URL aprobar pagos sin sesión. Activar el login NO protege
  // por sí solo: MODO_LOGIN solo actúa donde alguien llamó a contextoDe_.
  const codigo = fs.readFileSync(RUTA, 'utf8');
  const lineas = codigo.split(/\r?\n/);

  const cuerpos = {};
  lineas.forEach((l, i) => {
    const m = l.match(/^function\s+(\w+)/);
    if (!m) return;
    let prof = 0, j = i, c = '', visto = false;
    do {
      c += lineas[j] + '\n';
      for (const ch of lineas[j]) { if (ch === '{') { prof++; visto = true; } if (ch === '}') prof--; }
      j++;
    } while (j < lineas.length && (!visto || prof > 0));
    cuerpos[m[1]] = c;
  });

  // Públicas a propósito: validan el token ellas mismas o no revelan datos.
  const PUBLICAS = ['estado_login'];

  const rutas = [...new Set([...codigo.matchAll(/=== '([a-z_]+)'\)\s*return respuestaJson_\((\w+)\(/g)]
    .map(m => m[1] + '|' + m[2]))];

  const abiertas = [];
  rutas.forEach(par => {
    const [accion, f] = par.split('|');
    if (PUBLICAS.indexOf(accion) !== -1) return;
    const c = cuerpos[f] || '';
    if (!/contextoDe_|verificarIdToken_/.test(c)) abiertas.push(accion + ' (' + f + ')');
  });

  chk('toda acción del Web App valida la sesión', abiertas.length === 0, JSON.stringify(abiertas));
  chk('se encontraron rutas para auditar', rutas.length >= 8, 'rutas=' + rutas.length);

  // decidir_solicitud tiene que exigir admin, no solo sesión: aprobar un pago
  // es un acto administrativo.
  chk('aprobar/rechazar exige rol admin',
      /function decidirSolicitud_[\s\S]*?SOLO_ADMIN/.test(codigo),
      'decidirSolicitud_ no exige admin');

  // Quién aprobó no puede venir del cliente: se firmaría con el nombre de otro.
  chk('"REVISADO POR" sale de la sesión verificada',
      /'REVISADO POR':\s*ctx\.autenticado/.test(codigo),
      'REVISADO POR todavía confía en el cliente');
}

console.log('\n' + (fallos ? 'FALLARON ' + fallos + ' comprobaciones' : 'TODAS LAS COMPROBACIONES PASARON'));
process.exit(fallos ? 1 : 0);
