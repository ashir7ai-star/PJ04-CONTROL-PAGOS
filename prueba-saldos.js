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
  // Cuenta las lecturas completas: es LA medida de cuantos viajes al servicio
  // de Sheets cuesta una operacion, y sin ella no se puede comprobar que el
  // cache evite trabajo.
  let lecturas = 0;
  return {
    getName: () => nombre,
    _lecturas: () => lecturas,
    getDataRange: () => ({ getValues: () => { lecturas++; return datos.map(f => f.slice()); } }),
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
  // Un cache por montaje: cada backend simulado arranca limpio, como arrancaria
  // el script recien desplegado.
  const _cache = {};
  const filasPagos = [ENC_PAGOS].concat((pagos || []).map(p =>
    [p[0], p[1], p[2], 'quien', 'nombre', 'prov', '2026-01-01', p[3]]));

  const hojas = {
    'PAGOS REGISTRADOS': hojaFalsa('PAGOS REGISTRADOS', filasPagos),
    'SALDOS':            hojaFalsa('SALDOS', [ENC_SALDOS].concat((saldos || []).map(s =>
                           [s[0], s[1], s[2], 'carga inicial', 'admin']))),
    'USUARIOS':          hojaFalsa('USUARIOS', [
                           ['CORREO','NOMBRE','TELEFONO','ROL','SECCIONES','ESTADO','FECHA REGISTRO','ULTIMO ACCESO'],
                           ['nathan@ylevigroup.com','Nathan De Lima','300','admin','todas','activo','',''],
                           ['joseph@ylevigroup.com','Joseph','301','admin','todas','activo','',''],
                           ['laura@x.com','Laura','302','usuario','viaticos','activo','',''],
                           ['viejo@x.com','Admin Inactivo','303','admin','todas','inactivo','','']
                         ]),
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
    // Cache DE VERDAD, en memoria. Con el stub anterior (get siempre null) el
    // cache nunca acertaba, asi que nada de lo que depende de el se podia
    // comprobar: las pruebas pasaban tanto con invalidacion como sin ella.
    CacheService: { getScriptCache: () => ({
      get:    (k) => (Object.prototype.hasOwnProperty.call(_cache, k) ? _cache[k] : null),
      put:    (k, v) => { _cache[k] = v; },
      remove: (k) => { delete _cache[k]; }
    }) },
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
  chk('compra de materiales → fondo de VIÁTICOS (ajuste temporal)',
      g.cuentaDePago_('compra_materiales', 'AMPAC SAS') === 'viaticos',
      g.cuentaDePago_('compra_materiales', 'AMPAC SAS'));
  chk('y NO al banco de la empresa',
      g.cuentaDePago_('compra_materiales', 'Millennium Co') === 'viaticos',
      g.cuentaDePago_('compra_materiales', 'Millennium Co'));
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
    realizado_por: 'nathan@ylevigroup.com',
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
    fecha: '2026-08-03', nota: 'viejo', realizado_por: 'joseph@ylevigroup.com',
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
    fecha: '2026-08-03', realizado_por: 'nathan@ylevigroup.com',
    archivos: [{ nombre: 'c.pdf', datos: 'x' }]
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
    fecha: fecha, realizado_por: 'nathan@ylevigroup.com',
    archivos: [{ nombre: 'c.pdf', datos: 'x' }]
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

console.log('\n=== Quien HIZO el traslado, aparte de quien lo registro ===');
{
  // Son dos personas distintas cuando uno carga el traslado que hizo el otro.
  // Confundirlas seria atribuirle a alguien un movimiento de dinero que no hizo.
  const g = montar([], [], 'off');
  const base = { origen: 'banco_ampac', destino: 'viaticos', monto: '100000',
                 fecha: '2026-09-10', archivos: [{ nombre: 'c.pdf', datos: 'x' }] };
  const con = (cambios) => g.registrarTraslado_(Object.assign({}, base, cambios));

  chk('sin autor se rechaza',                con({}).status === 'error');
  // El mensaje importa: "no es un administrador activo" ante un campo vacío
  // confunde, porque el problema es que no elegiste a nadie.
  chk('y dice que hay que elegir, no que el autor sea invalido',
      con({}).message.indexOf('Elegí qué administrador') !== -1, con({}).message);
  chk('un correo que no es usuario se rechaza',
      con({ realizado_por: 'cualquiera@x.com' }).status === 'error');
  chk('un usuario que NO es admin se rechaza',
      con({ realizado_por: 'laura@x.com' }).status === 'error');
  chk('un admin INACTIVO se rechaza',
      con({ realizado_por: 'viejo@x.com' }).status === 'error');
  chk('un admin activo se acepta',
      con({ realizado_por: 'joseph@ylevigroup.com' }).status === 'success');

  const hoja = g.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('TRASLADOS');
  const enc  = hoja._datos[0].map(String);
  const fila = hoja._datos[hoja._datos.length - 1];
  chk('la hoja tiene columna REALIZADO POR', enc.indexOf('REALIZADO POR') !== -1, enc);
  chk('queda guardado el admin elegido, con su correo',
      String(fila[enc.indexOf('REALIZADO POR')]).indexOf('joseph@ylevigroup.com') !== -1,
      String(fila[enc.indexOf('REALIZADO POR')]));

  // Y lo que NO debe pasar: que el autor elegido pise a quien lo registro.
  chk('REGISTRADO POR sigue saliendo de la sesion, no del formulario',
      String(fila[enc.indexOf('REGISTRADO POR')]).indexOf('joseph@ylevigroup.com') === -1,
      String(fila[enc.indexOf('REGISTRADO POR')]));

  // La lista de autores sale de la hoja, no de una constante.
  const admins = g.administradoresActivos_().map(a => a.correo).sort();
  chk('la lista de autores son los admins ACTIVOS de la hoja',
      JSON.stringify(admins) === JSON.stringify(['joseph@ylevigroup.com', 'nathan@ylevigroup.com']),
      JSON.stringify(admins));
  chk('consultar_traslados devuelve esa lista para el selector',
      (g.consultarTraslados_({ rol: 'admin' }).administradores || []).length === 2);
  chk('y el traslado listado muestra quien lo realizo',
      String(g.consultarTraslados_({ rol: 'admin' }).traslados[0].realizo).indexOf('Joseph') !== -1,
      g.consultarTraslados_({ rol: 'admin' }).traslados[0].realizo);
}

console.log('\n=== Ajuste temporal: Compra Materiales sale de Viaticos ===');
{
  // Contexto real (2026-09-17): la plata que se manda a Viaticos tambien se usa
  // para comprar materiales. Si esos gastos salieran del banco, pasarian las dos
  // cosas malas juntas: Viaticos mostraria mas plata de la que queda, y al banco
  // se le restaria una salida que ya se le habia restado al hacer el traslado.
  const g = montar([
    ['02/02/2026 10:00', 'AMPAC SAS', 'viaticos',          100000],
    ['02/02/2026 10:00', 'AMPAC SAS', 'compra_materiales', 250000],
    ['02/02/2026 10:00', 'AMPAC SAS', 'compra',            400000]
  ], [
    ['01/01/2026 00:00', 'viaticos',    1000000],
    ['01/01/2026 00:00', 'banco_ampac', 5000000]
  ]);

  const r = g.consultarSaldos_({ rol: 'admin', secciones: [] });
  const via   = saldoDe(r, 'viaticos');
  const banco = saldoDe(r, 'banco_ampac');

  chk('Viaticos descuenta el viatico Y los materiales',
      via.gastado === 350000, 'gastado=' + via.gastado + ' (esperado 350000)');
  chk('el saldo de Viaticos queda correcto', via.saldo === 650000, 'saldo=' + via.saldo);
  chk('los materiales NO se le restan tambien al banco',
      banco.gastado === 400000, 'gastado=' + banco.gastado + ' (esperado 400000: solo la compra)');
  chk('la plata no se resta dos veces en total',
      via.saldo + banco.saldo === 6000000 - 750000,
      (via.saldo + banco.saldo));
  chk('ningun pago queda sin bolsa asignada', r.sinCuenta === 0, r.sinCuenta);

  // Quien gasta de un fondo tiene que poder verlo: dejarlo gastar de un saldo
  // que no ve seria pedirle que trabaje a ciegas.
  //
  // OJO: en modo 'off' el contexto da acceso a todo, asi que la visibilidad
  // SOLO se puede probar en 'estricto'. Con 'off' estas comprobaciones pasarian
  // siempre, sin comprobar nada.
  const ge = montar([], [
    ['01/01/2026 00:00', 'viaticos',    1000000],
    ['01/01/2026 00:00', 'banco_ampac', 5000000]
  ], 'estricto');
  const soloMateriales = ge.consultarSaldos_({ rol: 'usuario', secciones: ['compra_materiales'] });
  chk('quien solo tiene Compra Materiales VE el saldo de Viaticos',
      !!saldoDe(soloMateriales, 'viaticos'),
      JSON.stringify(soloMateriales.cuentas.map(c => c.clave)));
  chk('pero sigue sin ver los bancos',
      soloMateriales.cuentas.every(c => c.grupo === 'fondo'),
      JSON.stringify(soloMateriales.cuentas.map(c => c.clave)));

  const soloCaja = ge.consultarSaldos_({ rol: 'usuario', secciones: ['caja_menor'] });
  chk('quien no gasta de Viaticos sigue sin verlo',
      !saldoDe(soloCaja, 'viaticos'),
      JSON.stringify(soloCaja.cuentas.map(c => c.clave)));
}

console.log('\n=== Conciliacion: la diferencia contra el banco queda registrada ===');
{
  // El problema real: el banco cobra 4x1000, comisiones e intereses que el
  // sistema no ve. Al recargar el saldo, esa diferencia se perdia en silencio
  // — la cifra cuadraba y nadie sabia por que se habia descuadrado.
  const col = (g, nombre) => {
    const h = g.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SALDOS');
    return h._datos[0].map(String).indexOf(nombre);
  };
  const ultimaFila = (g) => {
    const h = g.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SALDOS');
    return h._datos[h._datos.length - 1];
  };

  // Base 1.000.000 el 01/01. Gastos registrados por 300.000 -> el sistema
  // calcula 700.000. El banco dice 687.000: faltan 13.000 que nadie registro.
  const g = montar(
    [['02/01/2026 10:00', 'AMPAC SAS', 'compra', 300000]],
    [['01/01/2026 00:00', 'banco_ampac', 1000000]]
  );

  const r = g.ajustarSaldo_({ cuenta: 'banco_ampac', monto: '687000', concepto: 'extracto 17/09' });
  chk('el ajuste se acepta', r.status === 'success', r.message);
  chk('informa la conciliacion', !!r.conciliacion, JSON.stringify(r.conciliacion));
  chk('sabe que el sistema calculaba 700.000',
      r.conciliacion.calculado === 700000, r.conciliacion.calculado);
  chk('la diferencia son los 13.000 que cobro el banco',
      r.conciliacion.diferencia === -13000, r.conciliacion.diferencia);

  const fila = ultimaFila(g);
  chk('la hoja SALDOS tiene columna SALDO CALCULADO', col(g, 'SALDO CALCULADO') !== -1);
  chk('la hoja SALDOS tiene columna DIFERENCIA',      col(g, 'DIFERENCIA') !== -1);
  chk('la diferencia queda GUARDADA, no solo mostrada',
      fila[col(g, 'DIFERENCIA')] === -13000, fila[col(g, 'DIFERENCIA')]);
  chk('y tambien que tenia calculado el sistema',
      fila[col(g, 'SALDO CALCULADO')] === 700000, fila[col(g, 'SALDO CALCULADO')]);
  chk('el saldo base guardado es el REAL del banco',
      fila[col(g, 'SALDO BASE')] === 687000, fila[col(g, 'SALDO BASE')]);

  // Y el saldo queda en el real, no en el calculado.
  chk('despues del ajuste el saldo es el del banco',
      saldoDe(r.saldos, 'banco_ampac').saldo === 687000,
      saldoDe(r.saldos, 'banco_ampac').saldo);

  // Primera carga: no hay contra que comparar. Poner 0 seria AFIRMAR que
  // cuadraba, que es una mentira con forma de dato.
  const g2 = montar([], []);
  const r2 = g2.ajustarSaldo_({ cuenta: 'banco_ampac', monto: '500000' });
  chk('la primera carga no inventa una conciliacion', r2.conciliacion === null, JSON.stringify(r2.conciliacion));
  chk('y no escribe un 0 en DIFERENCIA',
      ultimaFila(g2)[col(g2, 'DIFERENCIA')] === '', JSON.stringify(ultimaFila(g2)[col(g2, 'DIFERENCIA')]));

  // Diferencia a favor: entro plata que no estaba registrada.
  const g3 = montar([], [['01/01/2026 00:00', 'banco_ampac', 1000000]]);
  const r3 = g3.ajustarSaldo_({ cuenta: 'banco_ampac', monto: '1005000' });
  chk('una diferencia a favor se registra en positivo',
      r3.conciliacion.diferencia === 5000, r3.conciliacion.diferencia);

  // Cuadre exacto: se distingue de "no habia con que comparar".
  const g4 = montar([], [['01/01/2026 00:00', 'banco_ampac', 1000000]]);
  const r4 = g4.ajustarSaldo_({ cuenta: 'banco_ampac', monto: '1000000' });
  chk('cuadre exacto informa diferencia 0, no null',
      r4.conciliacion && r4.conciliacion.diferencia === 0, JSON.stringify(r4.conciliacion));

  // El historial no se pisa: cada conciliacion es una fila mas.
  const h = g.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SALDOS');
  const antes = h._datos.length;
  g.ajustarSaldo_({ cuenta: 'banco_ampac', monto: '680000' });
  chk('cada conciliacion agrega una fila al historial',
      h._datos.length === antes + 1, h._datos.length);
}

console.log('\n=== El cache de saldos: rapido, pero NUNCA viejo ===');
{
  // El saldo se calcula leyendo la hoja de saldos, la de traslados y las 7 de
  // pagos. Cada hoja es un viaje al servicio de Sheets, y de ahi salia la
  // lentitud del arranque. El resultado se guarda un rato — pero un saldo
  // viejo en una app de plata es peor que una lenta, asi que lo que importa es
  // que TODO lo que cambia un saldo lo invalide.
  const hojaPagos = (g) => g.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('PAGOS REGISTRADOS');
  const saldoAmpac = (g, forzar) =>
    saldoDe(g.consultarSaldos_({ rol: 'admin', secciones: [] }, forzar), 'banco_ampac').saldo;

  // 1) Sirve del cache: dos consultas seguidas no releen las hojas.
  const g = montar([], [['01/01/2026 00:00', 'banco_ampac', 1000000]]);
  chk('primera consulta calcula', saldoAmpac(g) === 1000000, saldoAmpac(g));
  const lecturas1 = hojaPagos(g)._lecturas();
  chk('la primera consulta SI leyo la hoja de pagos', lecturas1 > 0, lecturas1);
  g.olvidarTodasLasHojas_();   // como si fuera otra peticion
  saldoAmpac(g);
  chk('la segunda consulta no vuelve a leer las hojas de pagos',
      hojaPagos(g)._lecturas() === lecturas1, hojaPagos(g)._lecturas());

  // 2) Registrar un PAGO invalida: si no, el usuario veria su plata sin gastar.
  const g2 = montar([], [['01/01/2026 00:00', 'banco_ampac', 1000000]]);
  chk('saldo inicial', saldoAmpac(g2) === 1000000, saldoAmpac(g2));
  g2.registrarPago_({
    tipo_factura: 'compra', empresa: 'AMPAC SAS', monto: '200000',
    nombre_pago: 'x', proveedor: 'y', fecha_pago: '2026-09-17', archivos: []
  });
  chk('tras registrar un pago el saldo baja (el cache se invalido)',
      saldoAmpac(g2) === 800000, saldoAmpac(g2));

  // 3) Un TRASLADO invalida las dos cuentas que toca.
  const g3 = montar([], [
    ['01/01/2026 00:00', 'banco_ampac', 1000000],
    ['01/01/2026 00:00', 'viaticos',     100000]
  ]);
  saldoAmpac(g3);   // deja algo cacheado
  g3.registrarTraslado_({
    origen: 'banco_ampac', destino: 'viaticos', monto: '300000',
    fecha: '2026-09-17', realizado_por: 'nathan@ylevigroup.com',
    archivos: [{ nombre: 'c.pdf', datos: 'x' }]
  });
  const tras = g3.consultarSaldos_({ rol: 'admin', secciones: [] });
  chk('tras un traslado el banco baja',   saldoDe(tras, 'banco_ampac').saldo === 700000, saldoDe(tras, 'banco_ampac').saldo);
  chk('y el fondo sube',                  saldoDe(tras, 'viaticos').saldo === 400000,    saldoDe(tras, 'viaticos').saldo);

  // 4) Un AJUSTE de saldo invalida, y ademas se compara contra el valor REAL,
  //    no contra una foto guardada en cache: si no, la conciliacion mentiria.
  const g4 = montar(
    [['02/01/2026 10:00', 'AMPAC SAS', 'compra', 300000]],
    [['01/01/2026 00:00', 'banco_ampac', 1000000]]
  );
  saldoAmpac(g4);   // cachea 700000

  // Y ahora el cache queda VIEJO: aparece un pago de 100000 que no paso por la
  // app (lo cargo alguien a mano en la hoja). Es justo el caso que la
  // conciliacion existe para detectar, asi que comparar contra la foto vieja
  // daria una diferencia equivocada y la guardaria como si fuera buena.
  hojaPagos(g4)._datos.push(
    ['03/01/2026 10:00', 'AMPAC SAS', 'compra', 'quien', 'nombre', 'prov', '2026-01-01', 100000]);
  g4.olvidarTodasLasHojas_();

  const r4 = g4.ajustarSaldo_({ cuenta: 'banco_ampac', monto: '687000' });
  chk('la conciliacion compara contra el calculo REAL, no contra el cache viejo',
      r4.conciliacion.calculado === 600000, r4.conciliacion.calculado);
  chk('y por eso la diferencia es la verdadera',
      r4.conciliacion.diferencia === 87000, r4.conciliacion.diferencia);
  chk('tras el ajuste el saldo es el nuevo', saldoAmpac(g4) === 687000, saldoAmpac(g4));

  // 5) La salida para cuando alguien edita la hoja A MANO: forzar.
  const g5 = montar([], [['01/01/2026 00:00', 'banco_ampac', 1000000]]);
  saldoAmpac(g5);   // cachea 1.000.000
  hojaPagos(g5)._datos.push(
    ['02/01/2026 10:00', 'AMPAC SAS', 'compra', 'quien', 'nombre', 'prov', '2026-01-01', 400000]);
  g5.olvidarTodasLasHojas_();
  chk('sin forzar, sigue sirviendo lo calculado antes', saldoAmpac(g5) === 1000000, saldoAmpac(g5));
  chk('el boton Actualizar (forzar) SI ve el cambio hecho a mano',
      saldoAmpac(g5, true) === 600000, saldoAmpac(g5, true));
}

console.log('\n=== Un traslado del MISMO DIA se suma al fondo ===');
{
  // Fallo real reportado (2026-09-17): se hizo un traslado de Millennium a
  // Viaticos por 100.000 y el saldo de Viaticos no subio.
  //
  // Causa: la fecha del traslado es un DIA (00:00). Comparada contra una base
  // cargada a las 08:00 de ese mismo dia, el traslado quedaba "antes" y no se
  // contaba NI en el origen NI en el destino. Se rompio al hacer que el usuario
  // pudiera elegir la fecha: antes esa fecha era el instante del registro.
  const p2 = n => String(n).padStart(2, '0');
  const hoy = new Date();
  const hoyTxt = (h, m) => p2(hoy.getDate()) + '/' + p2(hoy.getMonth() + 1) + '/' +
                           hoy.getFullYear() + ' ' + p2(h) + ':' + p2(m);
  const hoyISO = hoy.getFullYear() + '-' + p2(hoy.getMonth() + 1) + '-' + p2(hoy.getDate());
  const ayer = new Date(hoy.getTime() - 86400000);
  const ayerISO = ayer.getFullYear() + '-' + p2(ayer.getMonth() + 1) + '-' + p2(ayer.getDate());
  const ayerTxt = (h, m) => p2(ayer.getDate()) + '/' + p2(ayer.getMonth() + 1) + '/' +
                            ayer.getFullYear() + ' ' + p2(h) + ':' + p2(m);

  const trasladar = (g, destino, monto, fecha) => g.registrarTraslado_({
    origen: 'banco_millennium', destino: destino, monto: String(monto),
    fecha: fecha, realizado_por: 'nathan@ylevigroup.com',
    archivos: [{ nombre: 'c.pdf', datos: 'x' }]
  });
  const ver = (g) => g.consultarSaldos_({ rol: 'admin', secciones: [] }, true);

  // 1) El caso reportado, tal cual.
  const g = montar([], [
    [hoyTxt(8, 0), 'viaticos',          500000],
    [hoyTxt(8, 0), 'banco_millennium', 9000000]
  ]);
  trasladar(g, 'viaticos', 100000, hoyISO);
  const r = ver(g);
  chk('el traslado SUMA al fondo de Viaticos',
      saldoDe(r, 'viaticos').saldo === 600000, saldoDe(r, 'viaticos').saldo);
  chk('y RESTA del banco de origen',
      saldoDe(r, 'banco_millennium').saldo === 8900000, saldoDe(r, 'banco_millennium').saldo);
  chk('la plata no se crea ni se destruye al moverse',
      saldoDe(r, 'viaticos').saldo + saldoDe(r, 'banco_millennium').saldo === 9500000,
      saldoDe(r, 'viaticos').saldo + saldoDe(r, 'banco_millennium').saldo);

  // 2) Lo mismo para Caja Menor: la regla no puede depender de la cuenta.
  const g2 = montar([], [
    [hoyTxt(8, 0), 'caja_menor',        300000],
    [hoyTxt(8, 0), 'banco_millennium', 9000000]
  ]);
  trasladar(g2, 'caja_menor', 50000, hoyISO);
  const r2 = ver(g2);
  chk('un traslado a Caja Menor tambien suma',
      saldoDe(r2, 'caja_menor').saldo === 350000, saldoDe(r2, 'caja_menor').saldo);

  // 3) Un traslado VIEJO contra una base cargada DESPUES no se suma: esa base
  //    ya lo refleja. Sumarlo seria contar la misma plata dos veces.
  const g3 = montar([], [
    [hoyTxt(8, 0), 'viaticos',          500000],
    [hoyTxt(8, 0), 'banco_millennium', 9000000]
  ]);
  trasladar(g3, 'viaticos', 100000, ayerISO);
  chk('un traslado anterior a la base NO se vuelve a sumar',
      saldoDe(ver(g3), 'viaticos').saldo === 500000, saldoDe(ver(g3), 'viaticos').saldo);

  // 4) Un traslado de ayer contra una base de ayer TEMPRANO si cuenta.
  const g4 = montar([], [
    [ayerTxt(6, 0), 'viaticos',          500000],
    [ayerTxt(6, 0), 'banco_millennium', 9000000]
  ]);
  trasladar(g4, 'viaticos', 100000, ayerISO);
  chk('un traslado del dia de la base, pero posterior, si se suma',
      saldoDe(ver(g4), 'viaticos').saldo === 600000, saldoDe(ver(g4), 'viaticos').saldo);

  // 5) Las filas VIEJAS (antes de que existiera la columna FECHA REGISTRO)
  //    guardaban en FECHA el instante del registro. Tienen que seguir contando.
  const g5 = montar([], [
    [hoyTxt(8, 0), 'viaticos',          500000],
    [hoyTxt(8, 0), 'banco_millennium', 9000000]
  ], 'off', [[hoyTxt(10, 30), 'banco_millennium', 'viaticos', 100000]]);
  chk('los traslados viejos (sin FECHA REGISTRO) siguen contando',
      saldoDe(ver(g5), 'viaticos').saldo === 600000, saldoDe(ver(g5), 'viaticos').saldo);

  // 5b) El orden inverso: primero se registra el traslado, y DESPUES se carga
  //     el saldo real del banco (que ya lo refleja). No puede sumarse otra vez.
  //     Este es el caso donde importa usar el instante del registro y no el
  //     final del dia: con "final del dia" el traslado quedaria despues de la
  //     base y se contaria dos veces.
  const enUnMinuto = new Date(Date.now() + 60000);
  const g5b = montar([], [
    [p2(enUnMinuto.getDate()) + '/' + p2(enUnMinuto.getMonth() + 1) + '/' +
     enUnMinuto.getFullYear() + ' ' + p2(enUnMinuto.getHours()) + ':' + p2(enUnMinuto.getMinutes()),
     'viaticos', 600000],
    [hoyTxt(8, 0), 'banco_millennium', 9000000]
  ]);
  trasladar(g5b, 'viaticos', 100000, hoyISO);
  chk('si el saldo real se carga DESPUES del traslado, no se suma dos veces',
      saldoDe(ver(g5b), 'viaticos').saldo === 600000, saldoDe(ver(g5b), 'viaticos').saldo);

  // 6) Todo junto: Viaticos y Compra Materiales comparten bolsa, y encima
  //    entra un traslado. Es el escenario completo que describio el usuario.
  const g6 = montar([
    [hoyTxt(9, 0),  'AMPAC SAS', 'viaticos',          100000],
    [hoyTxt(9, 30), 'AMPAC SAS', 'compra_materiales',  80000]
  ], [
    [hoyTxt(8, 0), 'viaticos',          500000],
    [hoyTxt(8, 0), 'banco_millennium', 9000000]
  ]);
  trasladar(g6, 'viaticos', 200000, hoyISO);
  const r6 = ver(g6);
  chk('Viaticos: 500.000 + 200.000 traslado - 100.000 viatico - 80.000 materiales',
      saldoDe(r6, 'viaticos').saldo === 520000, saldoDe(r6, 'viaticos').saldo);
  chk('y el banco solo pierde el traslado, no los gastos del fondo',
      saldoDe(r6, 'banco_millennium').saldo === 8800000, saldoDe(r6, 'banco_millennium').saldo);
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
               fecha: hoyISO, realizado_por: 'nathan@ylevigroup.com',
               archivos: [{ nombre: 'c.pdf', datos: 'x' }] };
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
