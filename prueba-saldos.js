// Pruebas de la lógica de saldos de apps-script.gs.
// Uso: node prueba-saldos.js apps-script.gs
//
// Esto maneja dinero que tiene que cuadrar con el banco, así que se verifica
// el comportamiento real contra hojas simuladas, no solo que compile.

const fs = require('fs');
const vm = require('vm');

const RUTA = process.argv[2] || 'apps-script.gs';

let fallos = 0;
function chk(nombre, cond, detalle) {
  console.log((cond ? '  ok   ' : '  FALLA') + '  ' + nombre + (cond ? '' : '  → ' + detalle));
  if (!cond) fallos++;
}

function hojaFalsa(nombre, filas) {
  const datos = filas || [];
  return {
    getName: () => nombre,
    getDataRange: () => ({ getValues: () => datos.map(f => f.slice()) }),
    getLastRow: () => datos.length,
    getLastColumn: () => (datos[0] ? datos[0].length : 0),
    getRange: (f, c, nf, nc) => ({
      getValues: () => [datos[f - 1].slice(c - 1, c - 1 + (nc || 1))],
      // setValues tiene que escribir A PARTIR de la columna pedida, no pisar la
      // fila entera. Con la versión anterior, agregar una columna al final
      // borraba todas las demás y la prueba daba un resultado inventado.
      setValues: (v) => {
        v.forEach((fila, i) => {
          if (!datos[f - 1 + i]) datos[f - 1 + i] = [];
          fila.forEach((valor, j) => { datos[f - 1 + i][c - 1 + j] = valor; });
        });
        return { setFontWeight: () => {} };
      },
      setValue: (v) => { datos[f - 1][c - 1] = v; }
    }),
    appendRow: (fila) => datos.push(fila.slice()),
    setFrozenRows: () => {},
    _datos: datos
  };
}

const ENC_PAGOS = ['FECHA REGISTRO', 'EMPRESA', 'TIPO FACTURA', 'REGISTRADO POR',
                   'NOMBRE DE PAGO', 'PROVEEDOR', 'FECHA DE PAGO', 'VALOR FACTURA'];
const ENC_SALDOS = ['FECHA', 'CUENTA', 'SALDO BASE', 'CONCEPTO', 'REGISTRADO POR'];

const ENC_TRAS = ['FECHA', 'ORIGEN', 'DESTINO', 'MONTO', 'REGISTRADO POR', 'NOTA', 'URL COMPROBANTE'];

// pagos:     [[fechaRegistro, empresa, tipo, valor], ...]
// saldos:    [[fecha, cuenta, base], ...]
// traslados: [[fecha, origen, destino, monto], ...]
function montar(pagos, saldos, modoLogin, traslados) {
  const filasPagos = [ENC_PAGOS].concat((pagos || []).map(p =>
    [p[0], p[1], p[2], 'quien', 'nombre', 'prov', '2026-01-01', p[3]]));

  const hojas = {
    'PAGOS REGISTRADOS': hojaFalsa('PAGOS REGISTRADOS', filasPagos),
    'SALDOS':            hojaFalsa('SALDOS', [ENC_SALDOS].concat((saldos || []).map(s =>
                           [s[0], s[1], s[2], 'carga inicial', 'admin']))),
    'USUARIOS':          hojaFalsa('USUARIOS', [['CORREO','NOMBRE','TELEFONO','ROL','SECCIONES','ESTADO','FECHA REGISTRO','ULTIMO ACCESO']]),
    'TRASLADOS':         hojaFalsa('TRASLADOS', [ENC_TRAS].concat((traslados || []).map(t =>
                           [t[0], t[1], t[2], t[3], 'admin', '', 'url'])))
  };
  const orden = ['PAGOS REGISTRADOS', 'SALDOS', 'USUARIOS', 'TRASLADOS'];

  const ctx = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheets: () => orden.map(n => hojas[n]),
        getSheetByName: (n) => hojas[n] || null,
        getNumSheets: () => orden.length,
        insertSheet: (n) => { hojas[n] = hojaFalsa(n, []); orden.push(n); return hojas[n]; },
        getName: () => 'CONTROL DE PAGOS', getId: () => 'id'
      }),
      flush: () => {}
    },
    DriveApp: {
      getFoldersByName: () => ({ hasNext: () => false }),
      createFolder: () => ({ createFile: () => ({ setSharing: () => {}, getUrl: () => 'https://drive/x' }) }),
      getFileById: () => ({ makeCopy: () => {} }),
      Access: { ANYONE_WITH_LINK: 'a' }, Permission: { VIEW: 'v' }
    },
    MailApp: { sendEmail: () => {} },
    Logger: { log: () => {} },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 500, getContentText: () => '{}' }) },
    ContentService: { createTextOutput: (t) => ({ setMimeType: () => t }), MimeType: { JSON: 'json' } },
    Utilities: {
      // Tiene que RESPETAR el formato que se le pide. Un stub que devuelve
      // siempre lo mismo hace que cualquier prueba sobre formatos de fecha pase
      // sin comprobar nada — ya pasó antes en este proyecto.
      formatDate: (d, z, f) => {
        const p = n => String(n).padStart(2, '0');
        const ymd = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
        const hm  = p(d.getHours()) + ':' + p(d.getMinutes());
        if (f === 'yyyy-MM-dd')      return ymd;
        if (f === 'yyyy-MM-dd HH:mm') return ymd + ' ' + hm;
        return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + hm;
      },
      base64Encode: x => String(x), computeDigest: (a, b) => b,
      base64Decode: x => String(x),
      DigestAlgorithm: { SHA_256: 's' }, newBlob: () => ({})
    }
  };

  let codigo = fs.readFileSync(RUTA, 'utf8');
  const patron = /^const MODO_LOGIN = '[a-z]+';$/m;
  if (!patron.test(codigo)) throw new Error('No se pudo fijar MODO_LOGIN en las pruebas.');
  codigo = codigo.replace(patron, "const MODO_LOGIN = '" + (modoLogin || 'off') + "';");

  vm.createContext(ctx);
  vm.runInContext(codigo, ctx);
  return ctx;
}

const saldoDe = (r, clave) => r.cuentas.filter(c => c.clave === clave)[0];

console.log('\n=== A qué bolsa va cada pago ===');
{
  const g = montar([], []);
  chk('proveedor de Millennium → banco Millennium', g.cuentaDePago_('pago_proveedor', 'Millennium Co') === 'banco_millennium');
  chk('compra de AMPAC → banco AMPAC',              g.cuentaDePago_('compra', 'AMPAC SAS') === 'banco_ampac');
  chk('impuestos → banco de la empresa',            g.cuentaDePago_('impuestos', 'AMPAC SAS') === 'banco_ampac');
  chk('nómina → banco de la empresa',               g.cuentaDePago_('nomina', 'Millennium Co') === 'banco_millennium');
  chk('seguridad social → banco de la empresa',     g.cuentaDePago_('seguridad_social', 'AMPAC SAS') === 'banco_ampac');
  chk('viáticos → fondo de viáticos',               g.cuentaDePago_('viaticos', 'AMPAC SAS') === 'viaticos');
  chk('caja menor → fondo de caja menor',           g.cuentaDePago_('caja_menor', 'Millennium Co') === 'caja_menor');
  chk('VENTA no toca ningún saldo',                 g.cuentaDePago_('venta', 'AMPAC SAS') === null);
  chk('empresa desconocida no se adivina',          g.cuentaDePago_('compra', 'Otra SAS') === null);
  chk('empresa vacía no se adivina',                g.cuentaDePago_('compra', '') === null);
}

console.log('\n=== El saldo base sólo cuenta hacia adelante ===');
{
  // Base cargada el 10/09 a las 12:00 con 10.000.000
  const g = montar([
    ['05/09/2026 09:00', 'Millennium Co', 'compra', 1000000],   // ANTES: no debe restar
    ['10/09/2026 11:59', 'Millennium Co', 'compra', 500000],    // ANTES: no debe restar
    ['10/09/2026 12:00', 'Millennium Co', 'compra', 700000],    // MISMO minuto: no resta
    ['10/09/2026 12:01', 'Millennium Co', 'compra', 300000],    // DESPUÉS: resta
    ['12/09/2026 08:00', 'Millennium Co', 'nomina', 200000]     // DESPUÉS: resta
  ], [['10/09/2026 12:00', 'banco_millennium', 10000000]]);

  const r = g.consultarSaldos_({ rol: 'admin', secciones: [] });
  const b = saldoDe(r, 'banco_millennium');
  chk('no descuenta los pagos anteriores a la base', b.gastado === 500000,
      'gastado=' + b.gastado + ' (esperado 500000: solo 300000+200000)');
  chk('el saldo resultante es correcto', b.saldo === 9500000, 'saldo=' + b.saldo);
  chk('cuenta la cantidad de pagos aplicados', b.pagos === 2, 'pagos=' + b.pagos);
}

console.log('\n=== Cada bolsa descuenta solo lo suyo ===');
{
  const g = montar([
    ['02/01/2026 10:00', 'Millennium Co', 'compra',     100000],
    ['02/01/2026 10:00', 'AMPAC SAS',     'compra',     200000],
    ['02/01/2026 10:00', 'AMPAC SAS',     'viaticos',    50000],
    ['02/01/2026 10:00', 'Millennium Co', 'viaticos',    30000],
    ['02/01/2026 10:00', 'Millennium Co', 'caja_menor',  20000],
    ['02/01/2026 10:00', 'AMPAC SAS',     'venta',     9999999]
  ], [
    ['01/01/2026 00:00', 'banco_millennium', 1000000],
    ['01/01/2026 00:00', 'banco_ampac',      1000000],
    ['01/01/2026 00:00', 'viaticos',          500000],
    ['01/01/2026 00:00', 'caja_menor',        300000]
  ]);

  const r = g.consultarSaldos_({ rol: 'admin' });
  chk('banco Millennium: 1.000.000 − 100.000', saldoDe(r, 'banco_millennium').saldo === 900000, saldoDe(r,'banco_millennium').saldo);
  chk('banco AMPAC: 1.000.000 − 200.000',      saldoDe(r, 'banco_ampac').saldo === 800000,      saldoDe(r,'banco_ampac').saldo);
  chk('viáticos junta las dos empresas: 500.000 − 80.000', saldoDe(r, 'viaticos').saldo === 420000, saldoDe(r,'viaticos').saldo);
  chk('caja menor: 300.000 − 20.000',          saldoDe(r, 'caja_menor').saldo === 280000,       saldoDe(r,'caja_menor').saldo);
  chk('la venta no movió ningún saldo',        saldoDe(r, 'banco_ampac').saldo === 800000);
  chk('las ventas se reportan aparte',         r.sinCuenta === 1, 'sinCuenta=' + r.sinCuenta);
}

console.log('\n=== Sin saldo base cargado ===');
{
  const g = montar([['02/01/2026 10:00', 'AMPAC SAS', 'compra', 200000]], []);
  const r = g.consultarSaldos_({ rol: 'admin' });
  const b = saldoDe(r, 'banco_ampac');
  chk('la cuenta se marca como no configurada', b.configurado === false);
  chk('no inventa un saldo negativo',           b.saldo === 0, 'saldo=' + b.saldo);
  chk('no acumula gastos sin base',             b.gastado === 0, 'gastado=' + b.gastado);
}

console.log('\n=== Corregir el saldo: vale el último ajuste ===');
{
  const g = montar([
    ['05/01/2026 10:00', 'AMPAC SAS', 'compra', 100000],
    ['15/01/2026 10:00', 'AMPAC SAS', 'compra', 300000]
  ], [
    ['01/01/2026 00:00', 'banco_ampac', 1000000],
    ['10/01/2026 00:00', 'banco_ampac', 5000000]   // corrección posterior
  ]);
  const r = g.consultarSaldos_({ rol: 'admin' });
  const b = saldoDe(r, 'banco_ampac');
  chk('toma la base más reciente', b.base === 5000000, 'base=' + b.base);
  chk('descuenta solo lo posterior a esa base', b.saldo === 4700000, 'saldo=' + b.saldo);
}

console.log('\n=== Montos escritos de distintas formas ===');
{
  const g = montar([], []);
  chk('número puro',            g.montoANumero_(1234567) === 1234567);
  chk('texto con puntos',       g.montoANumero_('1.234.567') === 1234567);
  chk('texto con $ y espacios', g.montoANumero_(' $ 1.234.567 ') === 1234567);
  chk('con decimales por coma', g.montoANumero_('1.234,50') === 1234.5);
  chk('vacío es cero',          g.montoANumero_('') === 0);
  chk('texto inválido es cero', g.montoANumero_('abc') === 0);
  chk('nulo es cero',           g.montoANumero_(null) === 0);
}

console.log('\n=== Ajustar el saldo: permisos y validación ===');
{
  const g = montar([], [], 'estricto');
  let bloqueado = false;
  try { g.ajustarSaldo_({ cuenta: 'banco_ampac', monto: 100 }); } catch (e) { bloqueado = true; }
  chk('sin sesión válida no se puede ajustar', bloqueado);

  const g2 = montar([], [], 'off');
  chk('cuenta inexistente se rechaza', g2.ajustarSaldo_({ cuenta: 'inventada', monto: 100 }).status === 'error');
  chk('monto negativo se rechaza',     g2.ajustarSaldo_({ cuenta: 'banco_ampac', monto: -5 }).status === 'error');
  chk('ajuste válido se acepta',       g2.ajustarSaldo_({ cuenta: 'banco_ampac', monto: 250000 }).status === 'success');

  // El ajuste tiene que quedar registrado como fila nueva, sin pisar nada
  const filas = g2.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SALDOS')._datos;
  chk('el ajuste queda como fila nueva en el historial', filas.length === 2, 'filas=' + filas.length);

  // La respuesta trae los saldos YA recalculados. Sin esto el navegador tiene
  // que hacer una segunda petición completa —validar sesión, leer USUARIOS,
  // releer las hojas de pagos— solo para mostrar algo que el servidor acababa
  // de calcular. Eso era buena parte de la lentitud que se reportó.
  const g3 = montar([], [], 'off');
  const resp = g3.ajustarSaldo_({ cuenta: 'banco_ampac', monto: 250000 });
  chk('la respuesta trae los saldos ya recalculados',
      !!resp.saldos && resp.saldos.status === 'success' && !!resp.saldos.cuentas);
  const ampac = (resp.saldos.cuentas || []).filter(c => c.clave === 'banco_ampac')[0];
  chk('y reflejan el ajuste que se acaba de hacer',
      !!ampac && ampac.configurado && ampac.base === 250000, ampac && ampac.base);

  // Lo mismo al trasladar plata: el saldo cambia en las dos cuentas.
  const g4 = montar([], [['01/01/2026 08:00', 'banco_ampac', 1000000, '', 'admin']], 'off');
  const hoy = new Date();
  const hoyTxt = hoy.getFullYear() + '-' + String(hoy.getMonth() + 1).padStart(2, '0') +
                 '-' + String(hoy.getDate()).padStart(2, '0');
  const tras = g4.registrarTraslado_({
    origen: 'banco_ampac', destino: 'viaticos', monto: 100000, fecha: hoyTxt,
    archivos: [{ nombre: 'c.pdf', contenido: 'x' }]
  });
  chk('el traslado tambien devuelve los saldos', !!tras.saldos && tras.saldos.status === 'success', tras.message);
}

console.log('\n=== La fecha del traslado se guarda aparte de cuando se registro ===');
{
  // Son dos cosas distintas y las dos importan: la transferencia pudo hacerse
  // el 3 de agosto y cargarse hoy. Para los saldos manda la del banco; la de
  // registro queda como rastro de auditoria.
  const g = montar([], [], 'off');
  g.registrarTraslado_({
    origen: 'banco_ampac', destino: 'viaticos', monto: 100000,
    fecha: '2026-08-03', nota: 'viejo',
    archivos: [{ nombre: 'c.pdf', datos: 'x' }]
  });

  const hoja = g.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('TRASLADOS');
  const enc  = hoja._datos[0].map(String);
  const fila = hoja._datos[hoja._datos.length - 1];

  chk('la hoja tiene columna FECHA REGISTRO', enc.indexOf('FECHA REGISTRO') !== -1, enc);

  const fTraslado = fila[enc.indexOf('FECHA')];
  const fRegistro = fila[enc.indexOf('FECHA REGISTRO')];

  // Guardarla como fecha REAL y no como texto es lo que evita que vuelva el
  // problema de dia/mes que costo todo el trabajo anterior.
  chk('la fecha del traslado se guarda como fecha REAL',
      Object.prototype.toString.call(fTraslado) === '[object Date]', String(fTraslado));
  chk('y es la que eligio el usuario, no la de hoy',
      fTraslado.getFullYear() === 2026 && fTraslado.getMonth() === 7 && fTraslado.getDate() === 3,
      String(fTraslado));
  chk('la fecha de registro es la de hoy',
      Object.prototype.toString.call(fRegistro) === '[object Date]' &&
      Math.abs(fRegistro.getTime() - Date.now()) < 60000, String(fRegistro));

  // Y la consecuencia que importa: un traslado anterior al saldo base NO
  // descuenta, porque ese saldo ya lo refleja. Si descontara, la plata se
  // restaria dos veces y el saldo no cuadraria con el banco.
  const g2 = montar([], [['10/09/2026 08:00', 'banco_ampac', 1000000, 'base', 'admin']], 'off');
  g2.registrarTraslado_({
    origen: 'banco_ampac', destino: 'viaticos', monto: 100000,
    fecha: '2026-08-03', archivos: [{ nombre: 'c.pdf', datos: 'x' }]
  });
  const cuentas = g2.consultarSaldos_({ rol: 'admin', secciones: [] }).cuentas;
  const banco = cuentas.filter(c => c.clave === 'banco_ampac')[0];
  chk('un traslado anterior al saldo base no se descuenta dos veces',
      banco.saldo === 1000000, banco && banco.saldo);
}

console.log('\n=== La lista de traslados: orden y formato ===');
{
  // Antes alcanzaba con invertir la hoja, porque un traslado se registraba
  // siempre en el momento. Ahora se pueden cargar traslados viejos, asi que el
  // orden de la hoja es el de REGISTRO y ya no coincide con el cronologico.
  const g = montar([], [], 'off');
  const alta = (fecha, monto) => g.registrarTraslado_({
    origen: 'banco_ampac', destino: 'viaticos', monto: String(monto),
    fecha: fecha, archivos: [{ nombre: 'c.pdf', datos: 'x' }]
  });

  alta('2026-09-10', 100);   // se registra primero, pero es el del medio
  alta('2026-08-03', 200);   // se registra segundo, y es el mas viejo
  alta('2026-09-15', 300);   // se registra tercero, y es el mas reciente

  const lista = g.consultarTraslados_({ rol: 'admin' }).traslados;
  chk('la lista sale del mas reciente al mas viejo POR FECHA DEL TRASLADO',
      JSON.stringify(lista.map(t => t.monto)) === JSON.stringify([300, 100, 200]),
      JSON.stringify(lista.map(t => t.monto)));

  // String(unaFecha) daria "Mon Aug 03 2026 00:00:00 GMT-0500", ilegible.
  chk('la fecha se muestra en formato legible, no como objeto Date',
      lista[2].fecha === '2026-08-03', lista[2].fecha);
  chk('ninguna fecha sale como texto crudo de Date',
      lista.every(t => String(t.fecha).indexOf('GMT') === -1),
      JSON.stringify(lista.map(t => t.fecha)));
}

console.log('\n=== Quién puede VER cada saldo ===');
{
  // Reportado en producción el 2026-09-16: a un usuario no administrador le
  // aparecían los saldos bancarios de las dos empresas. Los bancos son solo
  // para admins; un usuario común ve únicamente los fondos de sus secciones.
  const saldos = [
    ['01/01/2026 00:00', 'banco_millennium', 1000000],
    ['01/01/2026 00:00', 'banco_ampac',      2000000],
    ['01/01/2026 00:00', 'viaticos',          500000],
    ['01/01/2026 00:00', 'caja_menor',        300000]
  ];
  const g = montar([], saldos, 'estricto');
  const claves = r => r.cuentas.map(c => c.clave).sort();

  const admin = g.consultarSaldos_({ rol: 'admin', secciones: ['pagos','viaticos','caja_menor','impuestos','seguridad_social','nomina'] });
  chk('el admin ve las cuatro cuentas', claves(admin).length === 4, JSON.stringify(claves(admin)));
  chk('el admin puede editar', admin.puedeEditar === true);

  const soloViaticos = g.consultarSaldos_({ rol: 'usuario', secciones: ['viaticos'] });
  chk('usuario de viáticos ve SOLO viáticos',
      JSON.stringify(claves(soloViaticos)) === JSON.stringify(['viaticos']), JSON.stringify(claves(soloViaticos)));
  chk('NO recibe los saldos bancarios',
      JSON.stringify(soloViaticos).indexOf('banco_') === -1, 'se filtró un banco en la respuesta');
  chk('un usuario común no puede editar', soloViaticos.puedeEditar === false);

  const gastos = g.consultarSaldos_({ rol: 'usuario', secciones: ['viaticos', 'caja_menor'] });
  chk('usuario de viáticos + caja menor ve esos dos',
      JSON.stringify(claves(gastos)) === JSON.stringify(['caja_menor','viaticos']), JSON.stringify(claves(gastos)));
  chk('sigue sin ver bancos', JSON.stringify(gastos).indexOf('banco_') === -1);

  // Alguien con permiso sobre pagos pero SIN ser admin tampoco ve los bancos
  const dePagos = g.consultarSaldos_({ rol: 'usuario', secciones: ['pagos', 'nomina'] });
  chk('usuario de pagos (no admin) no ve ningún saldo', claves(dePagos).length === 0, JSON.stringify(claves(dePagos)));

  chk('a un usuario común no se le informa el conteo global sin asignar',
      soloViaticos.sinCuenta === 0);

  // Este es el caso que realmente ejercita el filtro por tipo de cuenta.
  // Los otros pasaban igual sin él, porque ninguna sección se llama como una
  // cuenta bancaria y por lo tanto la coincidencia nunca podía darse. Acá se
  // fuerza esa situación (datos malformados, o un cambio futuro que agregue
  // una sección con ese nombre) para comprobar que los bancos siguen siendo
  // exclusivos de administradores.
  const malformado = g.consultarSaldos_({ rol: 'usuario', secciones: ['banco_millennium', 'banco_ampac', 'viaticos'] });
  chk('aunque le asignen un banco como sección, un no-admin NO ve saldos bancarios',
      JSON.stringify(claves(malformado)) === JSON.stringify(['viaticos']),
      JSON.stringify(claves(malformado)));
}

console.log('\n=== Traslados: el dinero se mueve, no se gasta ===');
{
  // Caso real: se manda 1.000.000 del banco Millennium al fondo de Viáticos,
  // y después alguien en campo gasta 300.000 de viáticos.
  const g = montar(
    [['20/01/2026 10:00', 'AMPAC SAS', 'viaticos', 300000]],
    [['01/01/2026 00:00', 'banco_millennium', 5000000],
     ['01/01/2026 00:00', 'banco_ampac',      2000000],
     ['01/01/2026 00:00', 'viaticos',          100000],
     ['01/01/2026 00:00', 'caja_menor',         50000]],
    'off',
    [['15/01/2026 09:00', 'banco_millennium', 'viaticos', 1000000]]
  );
  const r = g.consultarSaldos_({ rol: 'admin' });

  chk('el banco de origen queda con 1.000.000 menos',
      saldoDe(r, 'banco_millennium').saldo === 4000000, saldoDe(r, 'banco_millennium').saldo);
  chk('viáticos suma lo recibido y resta lo gastado (100k + 1M − 300k)',
      saldoDe(r, 'viaticos').saldo === 800000, saldoDe(r, 'viaticos').saldo);
  chk('el otro banco no se toca',
      saldoDe(r, 'banco_ampac').saldo === 2000000, saldoDe(r, 'banco_ampac').saldo);
  chk('el traslado se informa como enviado en el origen',
      saldoDe(r, 'banco_millennium').enviado === 1000000);
  chk('y como recibido en el destino',
      saldoDe(r, 'viaticos').recibido === 1000000);

  // Lo esencial: la plata no se duplica ni se evapora. El total sigue siendo
  // la suma de las bases menos lo realmente gastado.
  const total = r.cuentas.reduce((s, c) => s + c.saldo, 0);
  chk('el total del sistema solo bajó por el gasto real (300.000)',
      total === (5000000 + 2000000 + 100000 + 50000) - 300000, total);
}

console.log('\n=== Traslados: la regla de corte por fecha ===');
{
  const g = montar([], [
    ['10/01/2026 12:00', 'banco_millennium', 5000000],
    ['10/01/2026 12:00', 'viaticos',          100000]
  ], 'off', [
    ['05/01/2026 09:00', 'banco_millennium', 'viaticos', 700000],   // ANTES de la base
    ['20/01/2026 09:00', 'banco_millennium', 'viaticos', 400000]    // DESPUÉS
  ]);
  const r = g.consultarSaldos_({ rol: 'admin' });
  chk('un traslado anterior a la base no se vuelve a contar',
      saldoDe(r, 'banco_millennium').saldo === 4600000, saldoDe(r, 'banco_millennium').saldo);
  chk('ni se suma dos veces en el destino',
      saldoDe(r, 'viaticos').saldo === 500000, saldoDe(r, 'viaticos').saldo);
}

console.log('\n=== Traslados: qué se rechaza ===');
{
  const g = montar([], [], 'off');
  const hoyISO = (d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
                       '-' + String(d.getDate()).padStart(2, '0'))(new Date());
  const ok = { origen: 'banco_ampac', destino: 'viaticos', monto: '500000',
               fecha: hoyISO, archivos: [{ nombre: 'c.pdf', datos: 'x' }] };
  const con = (cambios) => g.registrarTraslado_(Object.assign({}, ok, cambios));

  chk('un traslado válido se acepta', g.registrarTraslado_(ok).status === 'success');

  // La fecha del traslado: obligatoria, nunca futura, y puede ser anterior.
  chk('sin fecha se rechaza',    con({ fecha: '' }).status === 'error');
  chk('fecha ilegible se rechaza', con({ fecha: 'ayer' }).status === 'error');

  const manana = new Date(); manana.setDate(manana.getDate() + 5);
  const mananaISO = manana.getFullYear() + '-' + String(manana.getMonth() + 1).padStart(2, '0') +
                    '-' + String(manana.getDate()).padStart(2, '0');
  chk('fecha futura se rechaza', con({ fecha: mananaISO }).status === 'error');
  chk('una fecha anterior SI se acepta (traslado cargado dias despues)',
      con({ fecha: '2026-08-03' }).status === 'success');
  chk('sin comprobante se rechaza',        con({ archivos: [] }).status === 'error');
  chk('monto cero se rechaza',             con({ monto: '0' }).status === 'error');
  chk('monto negativo se rechaza',         con({ monto: '-100' }).status === 'error');
  chk('origen y destino iguales se rechaza', con({ destino: 'banco_ampac' }).status === 'error');
  chk('fondo → banco se rechaza',          con({ origen: 'viaticos', destino: 'banco_ampac' }).status === 'error');
  chk('banco → banco se rechaza',          con({ destino: 'banco_millennium' }).status === 'error');
  chk('cuenta inexistente se rechaza',     con({ destino: 'inventada' }).status === 'error');
}

console.log('\n=== Traslados: solo administradores ===');
{
  const g = montar([], [], 'estricto');
  let bloqueado = false;
  try {
    g.registrarTraslado_({ origen: 'banco_ampac', destino: 'viaticos', monto: '1', archivos: [{}] });
  } catch (e) { bloqueado = true; }
  chk('sin sesión válida no se puede trasladar', bloqueado);
}

console.log('\n=== La hoja SALDOS no se cuenta como pagos ===');
{
  const g = montar([], [['01/01/2026 00:00', 'banco_ampac', 1000000]]);
  const nombres = g.hojasDePagos_().map(h => h.getName());
  chk('SALDOS queda fuera de las hojas de pagos', nombres.indexOf('SALDOS') === -1, JSON.stringify(nombres));
  chk('USUARIOS queda fuera',                     nombres.indexOf('USUARIOS') === -1, JSON.stringify(nombres));
  // Si TRASLADOS entrara acá, sus filas aparecerían en los reportes diario y
  // mensual como si fueran pagos: el mismo dinero contado dos veces.
  chk('TRASLADOS queda fuera (un traslado NO es un gasto)',
      nombres.indexOf('TRASLADOS') === -1, JSON.stringify(nombres));
}

console.log('\n' + (fallos ? 'FALLARON ' + fallos + ' comprobaciones' : 'TODAS LAS COMPROBACIONES PASARON'));
process.exit(fallos ? 1 : 0);
