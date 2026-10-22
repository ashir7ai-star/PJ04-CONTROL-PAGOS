// La prueba que decide si la estrategia funciona: carga `apps-script.gs` SIN
// MODIFICAR sobre el entorno de Node y verifica que calcule lo mismo.
//
// Uso: node prueba-logica-real.js
//
// Si esto pasa, la migración es viable: la lógica contable probada sigue
// siendo la misma, y solo cambia de dónde salen los datos.

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { crearEntorno, formatDate } = require('./src/entorno');
const { convertirFoto } = require('./src/fechas-sheets');

// Fecha -> numero de serie de Sheets, que es como las devuelve la API.
// Las pruebas tienen que usar la MISMA forma que la realidad: con fechas ya
// convertidas a mano, no se estaria probando la conversion.
function serie(anio, mes, dia, hora, minuto) {
  const dias = (Date.UTC(anio, mes - 1, dia) - Date.UTC(1899, 11, 30)) / 86400000;
  return dias + ((hora || 0) * 60 + (minuto || 0)) / 1440;
}

let fallos = 0;
function chk(nombre, cond, detalle) {
  console.log((cond ? '  ok   ' : '  FALLA') + '  ' + nombre +
              (cond ? '' : '  → ' + JSON.stringify(detalle)));
  if (!cond) fallos++;
}

const RUTA = path.join(__dirname, '..', 'apps-script.gs');

// Monta la lógica real sobre una foto de hojas dada.
// `conDrive` arma el entorno COMPLETO. Por defecto Drive queda fuera, para que
// las pruebas no dependan de credenciales ni de la red; pero la auditoria de
// acciones necesita el entorno real, o estaria comprobando su propia
// configuracion en vez del sistema.
function montar(foto, modoLogin, conDrive) {
  // La foto pasa por la MISMA conversion que en produccion.
  const e = crearEntorno(convertirFoto(foto, 'America/Bogota'), { sinDrive: !conDrive });
  let codigo = fs.readFileSync(RUTA, 'utf8').replace(/\r\n/g, '\n');

  const patron = /^const MODO_LOGIN = '[a-z]+';$/m;
  if (!patron.test(codigo)) throw new Error('No se pudo fijar MODO_LOGIN.');
  codigo = codigo.replace(patron, "const MODO_LOGIN = '" + (modoLogin || 'off') + "';");

  vm.createContext(e.globales);
  vm.runInContext(codigo, e.globales);
  return e;
}

const ENC_PAGOS = ['FECHA REGISTRO', 'EMPRESA', 'TIPO FACTURA', 'REGISTRADO POR',
                   'NOMBRE DE PAGO', 'PROVEEDOR', 'FECHA DE PAGO', 'VALOR FACTURA',
                   'NOTAS', 'URL ARCHIVO', 'ID REGISTRO'];

console.log('\n=== Utilities.formatDate: los siete patrones que usa el codigo ===');
{
  // De aca salio el problema de dia/mes. El servidor de EasyPanel corre en UTC,
  // asi que si formatDate usara la hora del proceso en vez de la zona pedida,
  // TODAS las fechas saldrian corridas cinco horas.
  const d = new Date(Date.UTC(2026, 8, 15, 23, 40));   // 15/09/2026 18:40 en Bogota
  const z = 'America/Bogota';

  chk("'yyyy-MM-dd HH:mm'", formatDate(d, z, 'yyyy-MM-dd HH:mm') === '2026-09-15 18:40', formatDate(d, z, 'yyyy-MM-dd HH:mm'));
  chk("'yyyy-MM-dd'",       formatDate(d, z, 'yyyy-MM-dd')       === '2026-09-15', formatDate(d, z, 'yyyy-MM-dd'));
  chk("'dd/MM/yyyy HH:mm'", formatDate(d, z, 'dd/MM/yyyy HH:mm') === '15/09/2026 18:40', formatDate(d, z, 'dd/MM/yyyy HH:mm'));
  // Solo la hora: lo usa el detalle del Control de Viaticos, donde el dia ya
  // esta en la cabecera.
  chk("'HH:mm'", formatDate(d, z, 'HH:mm') === '18:40', formatDate(d, z, 'HH:mm'));
  chk("'dd/MM/yyyy'",       formatDate(d, z, 'dd/MM/yyyy')       === '15/09/2026', formatDate(d, z, 'dd/MM/yyyy'));
  chk("'yyyy-MM'",          formatDate(d, z, 'yyyy-MM')          === '2026-09', formatDate(d, z, 'yyyy-MM'));
  chk("'yyyy-MM-dd HH.mm'", formatDate(d, z, 'yyyy-MM-dd HH.mm') === '2026-09-15 18.40', formatDate(d, z, 'yyyy-MM-dd HH.mm'));
  chk("'MMMM yyyy' en espanol", formatDate(d, z, 'MMMM yyyy')    === 'septiembre 2026', formatDate(d, z, 'MMMM yyyy'));

  // La zona MANDA sobre la hora del proceso.
  chk('en UTC el mismo instante es otro dia',
      formatDate(d, 'UTC', 'yyyy-MM-dd HH:mm') === '2026-09-15 23:40', formatDate(d, 'UTC', 'yyyy-MM-dd HH:mm'));
  const medianoche = new Date(Date.UTC(2026, 8, 16, 3, 0));   // 22:00 del 15 en Bogota
  chk('un instante que en UTC ya es otro dia, en Bogota todavia no',
      formatDate(medianoche, 'America/Bogota', 'yyyy-MM-dd') === '2026-09-15',
      formatDate(medianoche, 'America/Bogota', 'yyyy-MM-dd'));

  let explotó = false;
  try { formatDate(d, z, 'EEEE dd'); } catch (err) { explotó = true; }
  chk('un patron no contemplado FALLA en voz alta', explotó);
}

console.log('\n=== La logica real calcula saldos sobre el adaptador ===');
{
  const e = montar({
    'PAGOS REGISTRADOS': [ENC_PAGOS,
      [serie(2026, 9, 15, 10, 0), 'AMPAC SAS', 'compra', 'q', 'n', 'p', serie(2026, 9, 15), 300000, '', '', 'id1']],
    'Viaticos': [ENC_PAGOS,
      [serie(2026, 9, 15, 11, 0), 'AMPAC SAS', 'viaticos', 'q', 'n', 'p', serie(2026, 9, 15), 100000, '', '', 'id2'],
      [serie(2026, 9, 15, 12, 0), 'AMPAC SAS', 'compra_materiales', 'q', 'n', 'p', serie(2026, 9, 15), 50000, '', '', 'id3']],
    'SALDOS': [['FECHA', 'CUENTA', 'SALDO BASE', 'CONCEPTO', 'REGISTRADO POR'],
      [serie(2026, 9, 15, 8, 0), 'banco_ampac', 1000000, 'base', 'admin'],
      [serie(2026, 9, 15, 8, 0), 'viaticos',     500000, 'base', 'admin'],
      [serie(2026, 9, 15, 8, 0), 'compra_materiales', 200000, 'base', 'admin']],
    'TRASLADOS': [['FECHA', 'ORIGEN', 'DESTINO', 'MONTO', 'REGISTRADO POR', 'NOTA', 'URL COMPROBANTE', 'FECHA REGISTRO', 'REALIZADO POR']],
    'USUARIOS':  [['CORREO', 'NOMBRE', 'TELEFONO', 'ROL', 'SECCIONES', 'ESTADO', 'FECHA REGISTRO', 'ULTIMO ACCESO']],
    'SESIONES':  [['HASH', 'CORREO', 'CREADA', 'ULTIMO USO', 'VENCE']],
    'SOLICITUDES DE APROBACION': [['ID SOLICITUD']]
  }, 'off');

  const r = e.globales.consultarSaldos_({ rol: 'admin', secciones: [] }, true);
  const de = (c) => r.cuentas.filter(x => x.clave === c)[0];

  chk('responde con exito', r.status === 'success', r.status);
  chk('banco AMPAC: 1.000.000 - 300.000', de('banco_ampac').saldo === 700000, de('banco_ampac').saldo);
  // Desde el 2026-10-01 son DOS bolsas independientes. Antes materiales
  // descontaba de Viaticos y esta misma prueba esperaba 350.000.
  chk('Viaticos descuenta SOLO viaticos: 500.000 - 100.000',
      de('viaticos').saldo === 400000, de('viaticos').saldo);
  chk('Compra Materiales tiene su propia bolsa: 200.000 - 50.000',
      de('compra_materiales').saldo === 150000, de('compra_materiales').saldo);
  chk('y un pago de materiales NO toca el saldo de viaticos',
      de('viaticos').gastado === 100000, de('viaticos').gastado);
  chk('ningun pago queda sin bolsa', r.sinCuenta === 0, r.sinCuenta);

  // A que bolsa va cada tipo. Es la regla entera en una linea cada una.
  const bolsa = t => e.globales.cuentaDePago_(t, 'AMPAC SAS');
  chk('materiales ya NO sale de viaticos', bolsa('compra_materiales') === 'compra_materiales', bolsa('compra_materiales'));
  chk('viaticos sigue saliendo de viaticos', bolsa('viaticos') === 'viaticos', bolsa('viaticos'));
  chk('caja menor sigue en la suya', bolsa('caja_menor') === 'caja_menor', bolsa('caja_menor'));
  chk('y lo demas sigue saliendo del banco', bolsa('proveedor') === 'banco_ampac', bolsa('proveedor'));

  // El fondo nuevo tiene que servir como destino de un traslado desde el
  // banco. Sale solo de `grupo: 'fondo'`, pero si alguien lo cambia a 'banco'
  // se romperia en silencio: no habria forma de mandarle plata.
  // Se comprueba sobre lo que DEVUELVE consultarSaldos_, no leyendo la
  // constante: `const` dentro del contexto no queda como propiedad del global,
  // y ademas el grupo asi comprobado es el mismo que mira registrarTraslado_.
  chk('se le puede trasladar plata desde el banco',
      de('compra_materiales').grupo === 'fondo', de('compra_materiales').grupo);
}

console.log('\n=== Cada fondo lo ve quien tiene su seccion ===');
{
  const foto = {
    'PAGOS REGISTRADOS': [ENC_PAGOS], 'Viaticos': [ENC_PAGOS], 'Compra Materiales': [ENC_PAGOS],
    'SALDOS': [['FECHA', 'CUENTA', 'SALDO BASE', 'CONCEPTO', 'REGISTRADO POR'],
               [serie(2026, 9, 15, 8, 0), 'viaticos', 500000, 'base', 'admin'],
               [serie(2026, 9, 15, 8, 0), 'compra_materiales', 200000, 'base', 'admin'],
               [serie(2026, 9, 15, 8, 0), 'banco_ampac', 1000000, 'base', 'admin']],
    'TRASLADOS': [['FECHA', 'ORIGEN', 'DESTINO', 'MONTO', 'REGISTRADO POR', 'NOTA', 'URL COMPROBANTE', 'FECHA REGISTRO', 'REALIZADO POR']],
    'USUARIOS':  [['CORREO', 'NOMBRE', 'TELEFONO', 'ROL', 'SECCIONES', 'ESTADO', 'FECHA REGISTRO', 'ULTIMO ACCESO']],
    'SESIONES':  [['HASH', 'CORREO', 'CREADA', 'ULTIMO USO', 'VENCE']],
    'SOLICITUDES DE APROBACION': [['ID SOLICITUD']]
  };
  const e = montar(foto, 'estricto');
  const ve = (secciones, clave) => e.globales.puedeVerCuenta_(
    { rol: 'usuario', secciones: secciones }, clave);

  chk('quien tiene materiales ve el fondo de materiales', ve(['compra_materiales'], 'compra_materiales'));
  chk('pero NO ve el de viaticos', !ve(['compra_materiales'], 'viaticos'));
  chk('quien tiene viaticos ve el de viaticos', ve(['viaticos'], 'viaticos'));
  chk('y ya NO ve el de materiales', !ve(['viaticos'], 'compra_materiales'));
  chk('ningun usuario comun ve los bancos', !ve(['viaticos', 'compra_materiales'], 'banco_ampac'));
  chk('un admin ve todo', e.globales.puedeVerCuenta_({ rol: 'admin', secciones: [] }, 'banco_ampac'));

  // El servidor manda la lista de cuentas con su grupo: de ahi salen los dos
  // selectores de la pantalla de Traslados.
  // Sin login: consultarTraslados_ es solo para administradores y aca no
  // interesa el permiso, sino QUE CUENTAS manda.
  const t = montar(foto, 'off').globales.consultarTraslados_({});
  const clv = t.cuentas.map(c => c.clave);
  chk('consultar_traslados incluye el fondo nuevo',
      clv.indexOf('compra_materiales') !== -1, clv);
  chk('y lo manda como fondo, para que sea DESTINO valido',
      t.cuentas.filter(c => c.clave === 'compra_materiales')[0].grupo === 'fondo', t.cuentas);

  // La pantalla ya no puede tener la lista escrita a mano: cuando materiales
  // paso a fondo propio, el backend lo aceptaba como destino pero el <select>
  // seguía con Viaticos y Caja Menor nada mas, y no habia forma de mandarle
  // plata. Nada avisaba.
  const html = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  const selOrigen  = html.split('id="tOrigen"')[1].split('</select>')[0];
  const selDestino = html.split('id="tDestino"')[1].split('</select>')[0];
  chk('el selector de origen no trae cuentas escritas a mano',
      !/value="banco_/.test(selOrigen), selOrigen.slice(0, 120));
  chk('ni el de destino',
      !/value="viaticos"|value="caja_menor"/.test(selDestino), selDestino.slice(0, 120));
  chk('los dos se llenan con lo que manda el servidor',
      /pintarCuentasDeTraslado\(r\.cuentas\)/.test(html),
      'nadie los llena: quedarian vacios');
  chk('origen son los bancos y destino los fondos',
      /\[\['tOrigen', 'banco'\], \['tDestino', 'fondo'\]\]/.test(html),
      'si se invierte, se podria mandar plata de un fondo a un banco');
}

console.log('\n=== La logica real ESCRIBE a traves del adaptador ===');
{
  const e = montar({
    'PAGOS REGISTRADOS': [ENC_PAGOS],
    'Viaticos':          [ENC_PAGOS],
    'SALDOS':   [['FECHA', 'CUENTA', 'SALDO BASE', 'CONCEPTO', 'REGISTRADO POR'],
                 [serie(2026, 9, 18, 8, 0), 'banco_ampac', 1000000, 'base', 'admin']],
    'TRASLADOS':[['FECHA', 'ORIGEN', 'DESTINO', 'MONTO', 'REGISTRADO POR', 'NOTA', 'URL COMPROBANTE']],
    'USUARIOS': [['CORREO', 'NOMBRE', 'TELEFONO', 'ROL', 'SECCIONES', 'ESTADO', 'FECHA REGISTRO', 'ULTIMO ACCESO']],
    'SESIONES': [['HASH', 'CORREO', 'CREADA', 'ULTIMO USO', 'VENCE']],
    'SOLICITUDES DE APROBACION': [['ID SOLICITUD']]
  }, 'off');

  // ajustarSaldo_ es el camino de escritura que NO toca Drive. Sirve para
  // ejercitar el adaptador completo: lee, calcula, escribe y vuelve a leer.
  const r = e.globales.ajustarSaldo_({ cuenta: 'banco_ampac', monto: '987000', concepto: 'extracto' });
  chk('el ajuste se acepta', r.status === 'success', r.message);

  const saldos = e.datos()['SALDOS'];
  chk('queda una fila nueva en SALDOS', saldos.length === 3, saldos.length);
  chk('con el saldo real del banco', saldos[2][2] === 987000, saldos[2]);
  chk('y la fecha como FECHA REAL, no texto',
      Object.prototype.toString.call(saldos[2][0]) === '[object Date]', String(saldos[2][0]));

  chk('la conciliacion viaja en la respuesta', !!r.conciliacion, JSON.stringify(r.conciliacion));
  chk('y detecta los 13.000 que cobro el banco',
      r.conciliacion.diferencia === -13000, r.conciliacion.diferencia);

  // Leer despues de escribir, dentro de la misma peticion.
  const tras = e.globales.consultarSaldos_({ rol: 'admin', secciones: [] }, true);
  chk('el saldo releido es el nuevo',
      tras.cuentas.filter(c => c.clave === 'banco_ampac')[0].saldo === 987000,
      tras.cuentas.filter(c => c.clave === 'banco_ampac')[0].saldo);

  chk('hay escrituras pendientes de aplicar', e.cambios().length > 0, e.cambios().length);
  chk('dirigidas a la hoja SALDOS',
      e.cambios().some(c => c.hoja === 'SALDOS'), e.cambios().map(c => c.hoja));
}

console.log('\n=== Las sesiones tienen que valer en los DOS sistemas ===');
{
  const crypto = require('crypto');
  const e = montar({ 'SESIONES': [['HASH','CORREO','CREADA','ULTIMO USO','VENCE']] }, 'off');

  // hashDeToken_ hace base64Encode(computeDigest(...)), o sea codifica un
  // ARREGLO DE BYTES. Tratarlo como texto daria el base64 de "12,-45,67,..."
  // en vez del de los bytes: no falla, produce un hash DISTINTO. Y con hashes
  // distintos, las sesiones creadas por Apps Script dejan de valer en este
  // servidor — todos los usuarios expulsados al conmutar, sin explicacion.
  const token = 'token-de-prueba-123';
  const esperado = crypto.createHash('sha256').update(token, 'utf8').digest('base64');

  chk('el hash de sesion es IDENTICO al de Apps Script',
      e.globales.hashDeToken_(token) === esperado, e.globales.hashDeToken_(token));

  // Y las dos formas de base64Encode que usa Apps Script.
  chk('base64Encode de un texto', e.globales.Utilities.base64Encode('hola') === 'aG9sYQ==');
  chk('base64Encode de bytes con signo (como los devuelve computeDigest)',
      e.globales.Utilities.base64Encode([104, 111, 108, 97]) === 'aG9sYQ==');
  chk('los bytes negativos se interpretan como Java (-1 es 255)',
      e.globales.Utilities.base64Encode([-1, -2]) === Buffer.from([255, 254]).toString('base64'));
}

console.log('\n=== UrlFetchApp: sin esto NADIE puede entrar ===');
{
  // verificarIdToken_ valida el token de Google contra sus servidores usando
  // UrlFetchApp. Al conmutar quedo sin implementar y el login se rompio para
  // todos: "UrlFetchApp no esta disponible en este entorno" en pantalla.
  const e = crearEntorno({}, {});

  const r = e.globales.UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=token-invalido-de-prueba',
    { muteHttpExceptions: true }
  );

  // Tiene que devolver el resultado YA, no una promesa: la logica lo usa
  // de forma sincrona.
  chk('devuelve el resultado, no una promesa', typeof r.then !== 'function');
  chk('responde como Apps Script: getResponseCode()', r.getResponseCode() === 400, r.getResponseCode());
  chk('y getContentText() trae el detalle',
      /invalid_token/.test(r.getContentText()), String(r.getContentText()).slice(0, 40));

  // Y lo que de verdad importa: que la logica REAL rechace un token invalido
  // en vez de explotar.
  const codigo = require('fs').readFileSync(RUTA, 'utf8').replace(/\r\n/g, '\n')
    .replace(/^const MODO_LOGIN = '[a-z]+';$/m, "const MODO_LOGIN = 'estricto';");
  require('vm').createContext(e.globales);
  require('vm').runInContext(codigo, e.globales);

  chk('la logica real rechaza un token invalido sin romperse',
      e.globales.verificarIdToken_('token-invalido-de-prueba') === null);
  chk('y deja dicho por que fallo',
      /Google respondi/.test(e.globales.motivoUltimoToken), e.globales.motivoUltimoToken);

  // getBlob solo lo usan los reportes, que siguen en Apps Script por
  // temporizador. Tiene que avisar, no devolver algo inservible.
  let aviso = false;
  try { r.getBlob(); } catch (err) { aviso = /Apps Script/.test(err.message); }
  chk('getBlob avisa que los reportes siguen en Apps Script', aviso);

  require('./src/puente-sincrono').detener();
}

console.log('\n=== NINGUNA accion puede topar con algo sin implementar ===');
{
  // De aca salio el login roto: UrlFetchApp quedo sin implementar y nadie lo
  // noto hasta que un usuario no pudo entrar. El comparador no lo detecto
  // porque le daba una sesion ya creada: verificaba que el sistema respondiera
  // igual UNA VEZ ADENTRO, nunca que se pudiera entrar.
  //
  // Esto recorre TODAS las acciones que el servidor expone y comprueba que
  // ninguna choque con una pieza sin implementar. Corre contra una copia en
  // memoria, asi que no toca ningun dato real.
  const ENC_SOL = ['ID SOLICITUD','FECHA SOLICITUD','EMPRESA','TIPO DE PAGO','NOMBRE DEL PAGO',
                   'PROVEEDOR','FECHA DE PAGO','VALOR','SOLICITADO POR','CORREO','NOTAS',
                   'URL ARCHIVO','ESTADO','REVISADO POR','FECHA DECISION','COMENTARIO'];

  const foto = {
    'PAGOS REGISTRADOS': [ENC_PAGOS], 'Viaticos': [ENC_PAGOS], 'Caja Menor': [ENC_PAGOS],
    'SALDOS':   [['FECHA','CUENTA','SALDO BASE','CONCEPTO','REGISTRADO POR']],
    'TRASLADOS':[['FECHA','ORIGEN','DESTINO','MONTO','REGISTRADO POR','NOTA','URL COMPROBANTE','FECHA REGISTRO','REALIZADO POR']],
    'USUARIOS': [['CORREO','NOMBRE','TELEFONO','ROL','SECCIONES','ESTADO','FECHA REGISTRO','ULTIMO ACCESO'],
                 ['nathan@ylevigroup.com','Nathan','300','admin','todas','activo','','']],
    'SESIONES': [['HASH','CORREO','CREADA','ULTIMO USO','VENCE']],
    'SOLICITUDES DE APROBACION': [ENC_SOL]
  };

  // Cada accion con un cuerpo minimo plausible.
  const acciones = [
    ['arranque',              {}],
    ['consultar_pagos',       {}],
    ['consultar_saldos',      {}],
    ['consultar_solicitudes', {}],
    ['listar_usuarios',       {}],
    ['consultar_traslados',   {}],
    ['cerrar_sesion',         { sesionToken: 'x' }],
    ['iniciar_sesion',        { idToken: 'x' }],
    ['registrar_usuario',     { nombre: 'X', telefono: '1' }],
    ['guardar_usuario',       { correo: 'otro@x.com', nombre: 'Otro', telefono: '1', rol: 'usuario', secciones: 'viaticos', estado: 'activo' }],
    ['ajustar_saldo',         { cuenta: 'banco_ampac', monto: '1000' }],
    ['registrar_traslado',    { origen: 'banco_ampac', destino: 'viaticos', monto: '1000',
                                fecha: '2026-09-18', realizado_por: 'nathan@ylevigroup.com',
                                archivos: [] }],
    ['solicitar_aprobacion',  { empresa: 'AMPAC SAS', tipo_pago: 'viaticos', nombre_pago: 'X',
                                proveedor: 'Y', fecha_pago: '2026-09-18', monto: '1000', archivos: [] }],
    ['decidir_solicitud',     { id: 'inexistente', aprobado: true }],
    ['registrar_pago',        { tipo_factura: 'viaticos', empresa: 'AMPAC SAS', monto: '1000',
                                nombre_pago: 'X', proveedor: 'Y', fecha_pago: '2026-09-18',
                                fecha_envio: 'op-x', archivos: [] }]
  ];

  let sinImplementar = [];
  acciones.forEach(function (a) {
    const e = montar(foto, 'off', true);   // entorno COMPLETO
    let mensaje = '';
    try {
      const salida = e.globales.doPost({ postData: { contents: JSON.stringify(
        Object.assign({ action: a[0] }, a[1])) } });
      mensaje = String(salida && (salida._json !== undefined ? salida._json : salida));
    } catch (err) {
      mensaje = String(err && err.message);
    }
    // Lo que se busca NO es que la accion tenga exito —muchas fallan por datos
    // de prueba incompletos, y esta bien— sino que no choque con una pieza
    // ausente del entorno.
    if (/no est[aá] (disponible|implementado)/i.test(mensaje)) {
      sinImplementar.push(a[0] + ': ' + mensaje.slice(0, 90));
    }
  });

  chk('ninguna accion topa con una pieza sin implementar',
      sinImplementar.length === 0, sinImplementar);

  // Y el camino de INGRESAR, que es el que se rompio y el comparador no cubria.
  const e = montar(foto, 'estricto', true);
  let mensajeLogin = '';
  try {
    const s = e.globales.doPost({ postData: { contents: JSON.stringify({ action: 'arranque', idToken: 'token-falso' }) } });
    mensajeLogin = String(s && (s._json !== undefined ? s._json : s));
  } catch (err) { mensajeLogin = String(err && err.message); }

  chk('ingresar con un token invalido responde, no explota',
      !/no est[aá] (disponible|implementado)/i.test(mensajeLogin), mensajeLogin.slice(0, 120));
  chk('y lo rechaza como corresponde',
      /SESION_INVALIDA|NO_REGISTRADO/.test(mensajeLogin), mensajeLogin.slice(0, 120));

  require('./src/puente-sincrono').detener();
}

console.log('\n=== Una columna nueva reusa los "Column N" que deja la Tabla ===');
{
  // El 21/09/2026 una usuaria no pudo registrar un pago. Viaticos tenia 11
  // encabezados reales y 15 "Column N" (los pone la Tabla de Sheets en las
  // columnas sin nombre). La logica los contaba como ocupados y quiso crear
  // ID REGISTRO en la columna 27 de una hoja de 26: "exceeds grid limits".
  const encViaticos = ['FECHA REGISTRO','EMPRESA','TIPO FACTURA','REGISTRADO POR','NOMBRE DE PAGO',
                       'PROVEEDOR','FECHA DE PAGO','VALOR FACTURA','NOTAS','URL ARCHIVO','NOMBRE DEL ARCHIVO'];
  for (let i = 1; i <= 15; i++) encViaticos.push('Column ' + i);

  const e = montar({ 'Viaticos': [encViaticos] }, 'off');
  const hoja = e.globales.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Viaticos');
  e.globales.asegurarColumnas_(hoja, ['ID REGISTRO']);

  const escrituras = e.cambios().filter(c => c.tipo === 'escribir');
  chk('escribe UN encabezado', escrituras.length === 1, escrituras);
  chk('en la fila 1', escrituras[0] && escrituras[0].fila === 1, escrituras[0]);
  chk('en la columna 12 —el primer "Column N"—, NO en la 27',
      escrituras[0] && escrituras[0].col === 12, escrituras[0] && escrituras[0].col);
  chk('con el nombre correcto',
      escrituras[0] && escrituras[0].valores[0][0] === 'ID REGISTRO', escrituras[0]);

  // La copia en memoria ya lo ve ahi.
  chk('la copia en memoria tiene ID REGISTRO en la columna 12',
      e.datos()['Viaticos'][0][11] === 'ID REGISTRO', e.datos()['Viaticos'][0].slice(10, 13));

  // Sin lugares libres, se agranda como siempre.
  const e2 = montar({ 'X': [['A', 'B', 'C']] }, 'off');
  e2.globales.asegurarColumnas_(e2.globales.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('X'), ['D']);
  const w = e2.cambios().filter(c => c.tipo === 'escribir')[0];
  chk('sin lugares libres va al final, como antes', w && w.col === 4, w);

  // Dos faltantes con un solo lugar libre: uno lo reusa, el otro va al final.
  const e3 = montar({ 'Y': [['A', 'Column 1', 'C']] }, 'off');
  e3.globales.asegurarColumnas_(e3.globales.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Y'), ['P', 'Q']);
  const cols = e3.cambios().filter(c => c.tipo === 'escribir').map(c => c.col);
  chk('dos faltantes: el primero reusa la 2, el segundo va a la 4',
      cols.join(',') === '2,4', cols);
}


console.log('\n=== Historial de movimientos: tiene que CUADRAR con el saldo ===');
{
  // Nace de "aparecio en rojo Viaticos y no se por que". Un historial que no
  // suma el saldo es peor que no tenerlo: parece una explicacion y no lo es.
  const ENC_SALDOS = [['FECHA','CUENTA','SALDO BASE','CONCEPTO','REGISTRADO POR']];
  const ENC_TRAS   = [['FECHA','ORIGEN','DESTINO','MONTO','REGISTRADO POR','NOTA','URL COMPROBANTE','FECHA REGISTRO','REALIZADO POR']];
  const base = new Date(2026, 8, 17, 10, 0, 0);
  const pago = (d, nombre, valor) =>
    [d, 'AMPAC SAS', 'viaticos', 'Laura', nombre, 'Proveedor', d, valor, '', '', ''];

  const foto = {
    'PAGOS REGISTRADOS': [ENC_PAGOS],
    'Viaticos': [ENC_PAGOS,
      pago(new Date(2026, 8, 18, 9, 0, 0), 'ALMUERZO', 300000),
      pago(new Date(2026, 8, 19, 9, 0, 0), 'HOSPEDAJE', 900000),
      // Anterior al saldo base: NO cuenta, ya esta incluido en la base.
      pago(new Date(2026, 8, 16, 9, 0, 0), 'VIEJO', 500000)],
    'Caja Menor': [ENC_PAGOS],
    'SALDOS':   [ENC_SALDOS[0], [base, 'viaticos', 1000000, 'inicial', 'Nathan']],
    'TRASLADOS':[ENC_TRAS[0],
      [new Date(2026, 8, 20), 'banco_ampac', 'viaticos', 400000, 'Nathan', 'refuerzo', '',
       new Date(2026, 8, 20, 15, 0, 0), 'Nathan <n@x.com>']],
    'USUARIOS': [['CORREO','NOMBRE','TELEFONO','ROL','SECCIONES','ESTADO','FECHA REGISTRO','ULTIMO ACCESO'],
                 ['nathan@ylevigroup.com','Nathan','300','admin','todas','activo','',''],
                 ['laura@energy-millennium.com','Laura','300','usuario','viaticos','activo','','']],
    'SESIONES': [['HASH','CORREO','CREADA','ULTIMO USO','VENCE']],
    'SOLICITUDES DE APROBACION': [['ID SOLICITUD','FECHA SOLICITUD','EMPRESA','TIPO DE PAGO','NOMBRE DEL PAGO',
      'PROVEEDOR','FECHA DE PAGO','VALOR','SOLICITADO POR','CORREO','NOTAS','URL ARCHIVO','ESTADO',
      'REVISADO POR','FECHA DECISION','COMENTARIO']]
  };

  const e = montar(foto, 'off');
  const pedir = a => JSON.parse(e.globales.doPost({ postData:{ contents: JSON.stringify(a) } })._json);

  const r = pedir({ action: 'consultar_movimientos', cuenta: 'viaticos', forzar: true });
  chk('responde bien', r.status === 'success', r);
  chk('trae la base', r.base === 1000000, r.base);

  // 1.000.000 − 300.000 − 900.000 + 400.000 = 200.000
  chk('el saldo es el esperado', r.saldo === 200000, r.saldo);
  chk('tres movimientos: dos pagos y un traslado', r.movimientos.length === 3, r.movimientos.length);
  chk('el pago anterior al saldo base NO aparece',
      !r.movimientos.some(m => m.texto === 'VIEJO'), r.movimientos.map(m => m.texto));

  // LO QUE IMPORTA: base + movimientos = saldo. Si un dia alguien toca el
  // calculo y el historial deja de sumar, esto lo agarra.
  const suma = r.movimientos.reduce((a, m) => a + m.monto, 0);
  chk('base + movimientos = saldo', r.base + suma === r.saldo, [r.base, suma, r.saldo]);
  chk('y el servidor lo comprueba solo', r.cuadra === true && r.descuadre === 0, r);

  chk('del mas nuevo al mas viejo',
      r.movimientos[0].orden > r.movimientos[r.movimientos.length-1].orden,
      r.movimientos.map(m => m.fecha));

  // El saldo corriente es lo que deja ver EN QUE momento se puso en rojo.
  const viejoANuevo = r.movimientos.slice().reverse();
  chk('cada movimiento lleva su saldo corriente',
      viejoANuevo[0].saldo === 700000, viejoANuevo.map(m => m.saldo));
  chk('y el ultimo coincide con el saldo de la cuenta',
      r.movimientos[0].saldo === r.saldo, r.movimientos[0].saldo);

  const entra = r.movimientos.filter(m => m.tipo === 'entra')[0];
  chk('un traslado que ENTRA suma', entra && entra.monto === 400000, entra);
  chk('y dice de donde vino, con el nombre ACTUAL de la empresa',
      entra && /BLAZAR/.test(entra.texto), entra && entra.texto);
  chk('un pago RESTA', r.movimientos.filter(m => m.tipo === 'pago').every(m => m.monto < 0));

  // Permisos: un banco no es para cualquiera.
  // Se llama la funcion directo, como en prueba-permisos.js: lo que se prueba
  // es la regla de permisos, no el camino de la sesion.
  const g = montar(foto, 'estricto');
  // Google no participa de esto: se prueba la REGLA de permisos, no el
  // ingreso. El token se cambia por el correo que representa.
  require('vm').runInContext(
    'verificarIdToken_ = function (t) { return t ? { correo: String(t), nombre: String(t) } : null; };',
    g.globales);
  const laura = { idToken: 'laura@energy-millennium.com' };

  let malo = null;
  try { g.globales.consultarMovimientos_(Object.assign({ cuenta: 'banco_ampac' }, laura)); }
  catch (err) { malo = err.message; }
  chk('un usuario comun NO ve los movimientos de un banco',
      /SIN_PERMISO/.test(String(malo)), malo);

  const suyo = g.globales.consultarMovimientos_(Object.assign({ cuenta: 'viaticos' }, laura));
  chk('pero SI los de su propio fondo', suyo.status === 'success', suyo);

  // Y un fondo que NO es suyo tampoco.
  let ajeno = null;
  try { g.globales.consultarMovimientos_(Object.assign({ cuenta: 'caja_menor' }, laura)); }
  catch (err) { ajeno = err.message; }
  chk('ni los de un fondo que no tiene asignado', /SIN_PERMISO/.test(String(ajeno)), ajeno);

  const inexistente = pedir({ action:'consultar_movimientos', cuenta:'no_existe' });
  chk('una cuenta que no existe se rechaza', inexistente.status === 'error', inexistente);

  // Y LO MAS IMPORTANTE: que la comprobacion de cuadre sirva de verdad.
  // Se mete en el cache un calculo adulterado —el saldo dice una cosa y los
  // movimientos otra— y tiene que avisarlo en vez de mostrarlo como si nada.
  {
    const e2 = montar(foto, 'off');
    const crudos = {
      porCuenta: {
        viaticos: { configurado: true, base: 1000000, desde: '17/09/2026 10:00', concepto: '',
                    gastado: 0, pagos: 0, enviado: 0, recibido: 0, traslados: 0,
                    // 1.000.000 - 300.000 = 700.000, pero el saldo dice otra cosa.
                    saldo: 999999,
                    movimientos: [{ orden: 1, fecha: '18/09/2026 09:00', tipo: 'pago',
                                    monto: -300000, texto: 'ALMUERZO', detalle: '' }] }
      },
      sinCuenta: 0
    };
    e2.globales.CacheService.getScriptCache().put('saldos_calculados_v1', JSON.stringify(crudos), 600);
    const r2 = e2.globales.consultarMovimientos_({ cuenta: 'viaticos' });
    chk('si el historial no suma el saldo, lo DICE', r2.cuadra === false, r2.cuadra);
    chk('y dice cuanto falta', r2.descuadre === 299999, r2.descuadre);
  }
}


console.log('\n=== Presupuesto diario unico, y rubros por participacion ===');
{
  // UN monto para todo el dia, no uno por rubro. Los rubros se siguen
  // mostrando para ver EN QUE se fue la plata, pero el tope es uno solo.
  const HOY = new Date(2026, 8, 28, 10, 0, 0);
  const dia = (d, h) => new Date(2026, 8, d, h || 9, 0, 0);
  const ENC = ENC_PAGOS.concat(['RUBRO']);
  // (diaRegistro, valor, rubro, tipo, diaPago) — el panel agrupa por FECHA
  // REGISTRO, no por fecha de pago.
  const pago = (d, valor, rubro, tipo, diaPago) =>
    [dia(d, 12), 'AMPAC SAS', tipo || 'viaticos', 'Laura', 'X', 'Prov',
     dia(diaPago === undefined ? d : diaPago), valor, '', '', '', rubro || ''];

  const foto = {
    'PAGOS REGISTRADOS': [ENC],
    'Viaticos': [ENC,
      pago(28,  40000, 'desayuno'),
      pago(28,  55000, 'almuerzo'),
      pago(28, 120000, 'cena'),
      pago(28,  30000, ''),                        // sin rubro: un pago viejo
      pago(28, 161000, 'cena', 'viaticos', 27),    // registrado hoy, gasto de ayer
      pago(27, 200000, 'cena')],
    'Compra Materiales': [ENC, pago(28, 999999, '', 'compra_materiales')],
    'Caja Menor': [ENC],
    'SALDOS':   [['FECHA','CUENTA','SALDO BASE','CONCEPTO','REGISTRADO POR']],
    'TRASLADOS':[['FECHA','ORIGEN','DESTINO','MONTO','REGISTRADO POR','NOTA','URL COMPROBANTE','FECHA REGISTRO','REALIZADO POR']],
    // UN presupuesto diario. Vale la ultima fila cargada.
    'PRESUPUESTO': [['FECHA','MONTO DIARIO','REGISTRADO POR','NOTA'],
                    [new Date(2026, 8, 1, 8, 0, 0),  500000, 'Nathan', 'inicial'],
                    [new Date(2026, 8, 20, 8, 0, 0), 650000, 'Nathan', 'ajuste']],
    'USUARIOS': [['CORREO','NOMBRE','TELEFONO','ROL','SECCIONES','ESTADO','FECHA REGISTRO','ULTIMO ACCESO'],
                 ['nathan@ylevigroup.com','Nathan','300','admin','todas','activo','',''],
                 ['laura@energy-millennium.com','Laura','300','usuario','viaticos','activo','','']],
    'SESIONES': [['HASH','CORREO','CREADA','ULTIMO USO','VENCE']],
    'SOLICITUDES DE APROBACION': [['ID SOLICITUD','FECHA SOLICITUD','EMPRESA','TIPO DE PAGO','NOMBRE DEL PAGO',
      'PROVEEDOR','FECHA DE PAGO','VALOR','SOLICITADO POR','CORREO','NOTAS','URL ARCHIVO','ESTADO',
      'REVISADO POR','FECHA DECISION','COMENTARIO']]
  };

  const e = montar(foto, 'off');
  const est = e.globales.estadoPresupuesto_(HOY, HOY);
  const de = c => est.rubros.filter(r => r.clave === c)[0];

  chk('hay 10 rubros', est.rubros.length === 10, est.rubros.length);
  chk('vale el presupuesto diario mas reciente', est.montoDiario === 650000, est.montoDiario);
  chk('el tope del dia es ese monto', est.totalSugerido === 650000, est.totalSugerido);

  chk('cada rubro suma lo suyo',
      de('desayuno').gastado === 40000 && de('almuerzo').gastado === 55000,
      est.rubros.map(r => r.clave + ':' + r.gastado));
  // EL DIA DEL GASTO, NO EL DE LA CARGA (cambiado el 01/10, pedido del
  // usuario). La foto tiene una cena de 161.000 cargada el 28 con fecha de
  // pago del 27: esa plata es del 27. Hasta el 01/10 contaba el 28, que
  // inflaba un dia y vaciaba el otro.
  chk('un pago cargado hoy con fecha de AYER no cuenta hoy',
      de('cena').gastado === 120000, de('cena').gastado);
  chk('y el total del dia es solo lo GASTADO ese dia',
      est.totalGastado === 245000, est.totalGastado);

  // Los rubros ya no tienen tope propio: se informa cuanto PESA cada uno.
  chk('cada rubro informa su participacion',
      de('cena').participacion === Math.round(120000 / 245000 * 100), de('cena').participacion);
  chk('un rubro ya NO trae presupuesto propio', de('cena').sugerido === undefined, de('cena'));
  chk('ni marca excedido por su cuenta', de('cena').excedido === undefined, de('cena'));

  chk('lo que no tiene rubro se informa aparte', est.sinRubro === 30000, est.sinRubro);
  chk('Compra Materiales NO entra', est.totalGastado === 245000, est.totalGastado);

  // Y el 27 recibe las dos cenas: la que se cargo ese dia (200.000) y la que
  // se cargo el 28 pero se gasto el 27 (161.000). Es el reverso exacto de la
  // comprobacion de arriba: lo que salio de un dia tiene que aparecer en el otro.
  const ayer = e.globales.estadoPresupuesto_(dia(27), dia(27));
  chk('y ese gasto aparece en el dia que SI le corresponde',
      ayer.rubros.filter(r => r.clave === 'cena')[0].gastado === 361000,
      ayer.rubros.filter(r => r.clave === 'cena')[0].gastado);
  chk('sin perder ni duplicar plata entre los dos dias',
      est.totalGastado + ayer.totalGastado === 606000,
      [est.totalGastado, ayer.totalGastado]);

  // El detalle dice cuando se CARGO, para que se entienda por que un gasto de
  // ayer aparece en la lista de ayer habiendose cargado hoy.
  const tarde = (ayer.detalle || []).filter(d => d.registrado && d.registrado !== d.dia);
  chk('el detalle marca lo que se cargo otro dia', tarde.length === 1, ayer.detalle);
  chk('y dice de que dia es el gasto, no el de la carga',
      tarde.length === 1 && tarde[0].valor === 161000, tarde);

  // Validaciones del monto.
  chk('un monto que no es numero se rechaza',
      e.globales.ajustarPresupuesto_({ monto: 'abc' }).status === 'error');
  chk('y cero tampoco vale: no significa "sin limite"',
      e.globales.ajustarPresupuesto_({ monto: '0' }).status === 'error');
  chk('un monto vacio se rechaza',
      e.globales.ajustarPresupuesto_({ monto: '' }).status === 'error');
  // El equipo es obligatorio desde el 15/10: un presupuesto sin dueno no se
  // puede comparar contra nada, y caer en un valor por defecto seria cargarle
  // el tope al equipo equivocado sin avisar.
  const sinEquipo = e.globales.ajustarPresupuesto_({ monto: '700000' });
  chk('un presupuesto SIN equipo se rechaza', sinEquipo.status === 'error', sinEquipo);
  chk('y un equipo que no existe tampoco vale',
      e.globales.ajustarPresupuesto_({ monto: '700000', equipo: 'equipo_9' }).status === 'error');

  const ok = e.globales.ajustarPresupuesto_({ monto: '700000', equipo: 'equipo_1' });
  chk('un monto valido se guarda, con su equipo',
      ok.status === 'success' && ok.presupuesto.montoDiario === 700000, ok.presupuesto);

  // Permisos.
  const g = montar(foto, 'estricto');
  require('vm').runInContext(
    'verificarIdToken_ = function (t) { return t ? { correo: String(t), nombre: String(t) } : null; };',
    g.globales);
  let malo = null;
  try { g.globales.ajustarPresupuesto_({ idToken: 'laura@energy-millennium.com', monto: '1' }); }
  catch (err) { malo = err.message; }
  chk('un usuario comun NO puede definir el presupuesto', /SOLO_ADMIN/.test(String(malo)), malo);

  // Pero SÍ puede MIRARLO: desde el 2026-09-30 el panel lo ve quien tenga la
  // sección Viáticos habilitada, no solo los administradores. Laura la tiene.
  let mira = null, miroBien = false;
  try {
    mira = g.globales.consultarPresupuesto_({ idToken: 'laura@energy-millennium.com' });
    miroBien = mira.status === 'success';
  } catch (err) { mira = err.message; }
  chk('pero un usuario CON la seccion Viaticos si puede mirarlo', miroBien, mira);

  // Y ve lo mismo que un admin, no una version recortada: el presupuesto es
  // uno solo para todo el equipo, asi que mostrarle nada mas lo suyo contra el
  // tope de todos daría verde siempre y no querría decir nada.
  const comoAdmin = g.globales.consultarPresupuesto_({ idToken: 'nathan@ylevigroup.com' });
  chk('y ve EXACTAMENTE lo mismo que un administrador',
      miroBien && mira.presupuesto.totalGastado === comoAdmin.presupuesto.totalGastado &&
      mira.presupuesto.detalle.length === comoAdmin.presupuesto.detalle.length,
      [mira && mira.presupuesto && mira.presupuesto.totalGastado,
       comoAdmin.presupuesto.totalGastado]);

  // Quien NO tiene la seccion sigue afuera.
  const sinViaticos = JSON.parse(JSON.stringify(foto));
  sinViaticos['USUARIOS'].push(
    ['otro@energy-millennium.com', 'Otro', '300', 'usuario', 'caja_menor', 'activo', '', '']);
  const g2 = montar(sinViaticos, 'estricto');
  require('vm').runInContext(
    'verificarIdToken_ = function (t) { return t ? { correo: String(t), nombre: String(t) } : null; };',
    g2.globales);
  let vedado = null;
  try { g2.globales.consultarPresupuesto_({ idToken: 'otro@energy-millennium.com' }); }
  catch (err) { vedado = err.message; }
  chk('quien NO tiene la seccion Viaticos no lo puede mirar',
      /SIN_PERMISO_VIATICOS/.test(String(vedado)), vedado);
  chk('y el mensaje dice el motivo real, no uno prestado',
      /Viáticos/.test(String(require('fs').readFileSync(RUTA, 'utf8').replace(/\r\n/g, '\n')
        .split('SIN_PERMISO_VIATICOS:')[1] || '').slice(0, 80)),
      'sin mensaje propio, el usuario ve un codigo en ingles');

  // El panel ya no viaja con los saldos: tiene su pestana.
  const saldos = JSON.parse(e.globales.doPost({ postData: { contents:
    JSON.stringify({ action: 'consultar_saldos', forzar: true }) } })._json);
  chk('los saldos ya no cargan el panel', saldos.presupuesto === undefined, Object.keys(saldos));

  // Con fecha explicita: sin ella pide el dia de HOY de verdad, y los datos de
  // esta prueba son del 28/09.
  const conDetalle = JSON.parse(e.globales.doPost({ postData: { contents:
    JSON.stringify({ action: 'consultar_presupuesto', desde: '2026-09-28', hasta: '2026-09-28' }) } })._json).presupuesto;
  chk('consultar_presupuesto trae el detalle pago por pago',
      Array.isArray(conDetalle.detalle) && conDetalle.detalle.length > 0, conDetalle.detalle.length);
  chk('y el detalle suma exactamente el total',
      conDetalle.detalle.reduce(function (a, d) { return a + d.valor; }, 0) === conDetalle.totalGastado,
      [conDetalle.detalle.length, conDetalle.totalGastado]);

  // Un RANGO: el presupuesto diario se multiplica por los dias.
  const rango = JSON.parse(e.globales.doPost({ postData: { contents:
    JSON.stringify({ action: 'consultar_presupuesto', desde: '2026-09-27', hasta: '2026-09-28' }) } })._json).presupuesto;
  chk('un rango abarca los dos extremos', rango.dias === 2, rango.dias);
  chk('y suma lo de todos los dias',
      rango.totalGastado === est.totalGastado + ayer.totalGastado,
      [rango.totalGastado, est.totalGastado, ayer.totalGastado]);
  chk('el presupuesto del rango es el diario x los dias',
      rango.totalSugerido === rango.montoDiario * 2, [rango.totalSugerido, rango.montoDiario]);
  chk('y cada fila del detalle dice de que dia es',
      rango.detalle.every(function (d) { return !!d.dia; }), rango.detalle[0]);
}

console.log('\n=== El rubro se guarda solo si es de la lista ===');
{
  const fuente = require('fs').readFileSync(RUTA, 'utf8').replace(/\r\n/g, '\n');

  chk('RUBRO es columna de TODAS las hojas de pago',
      /'ID REGISTRO',\s*\n[\s\S]{0,400}?'RUBRO'/.test(fuente),
      'si solo la tuviera Viaticos, los reportes darian celdas undefined');

  const reg = fuente.split('function registrarPago_')[1].split('\n}\n')[0];
  chk('solo se guarda en viaticos', /seccion === 'viaticos' && rubroValido_/.test(reg), 'se guardaria en cualquier seccion');
  chk('un rubro invalido se guarda VACIO, no se inventa',
      /: ''/.test(reg.split("'RUBRO'")[1].slice(0, 160)), 'se estaria inventando');

  const av = fuente.split('function avisarSiCruzaPresupuesto_')[1].split('\n}\n')[0];
  chk('el aviso es del DIA entero, no por rubro',
      /presupuestoDiarioVigente_/.test(av) && !/rubroValido_/.test(av), av.slice(0, 90));
  chk('mide el mismo dia que el panel: el del GASTO',
      /fechaDelGasto instanceof Date/.test(av), 'volvio a avisar del dia de la carga');
  chk('y si el gasto es de otro dia, el correo lo aclara',
      /mismoDia_\(dia, new Date\(\)\)/.test(av) && /no de hoy/.test(av),
      'llegaria un correo del 30/09 el 01/10 sin explicacion');

  // No alcanza con que la funcion SEPA recibir la fecha: hay que comprobar que
  // quien la llama se la manda. Sin este chequeo, borrar el argumento deja el
  // aviso mirando "hoy" otra vez y ninguna prueba se entera — comprobado con
  // una mutacion, que pasaba limpia.
  const llamada = fuente.split('avisarSiCruzaPresupuesto_(')[1].split(')')[0];
  chk('y quien lo llama le pasa la fecha del pago',
      /fecha_pago/.test(llamada), llamada);
  chk('y solo al CRUZAR la linea',
      /antes <= vigente\.monto && despues > vigente\.monto/.test(av), 'avisaria en cada pago');
  chk('el correo aclara que no es un limite',
      /no un límite|no es un límite/.test(av), 'falta aclararlo');
  chk('y que el pago se registro igual', /se registró con normalidad/.test(av), 'falta aclararlo');

  // El aviso tiene su propia lista de destinatarios, que NO es la de los
  // reportes. Los reportes llevan adjunto el PDF con todos los pagos de la
  // empresa (Pago Nomina incluida); el aviso lleva tres cifras de viaticos.
  // Mezclarlas seria darle la contabilidad entera a quien solo tiene que
  // enterarse de que los viaticos se pasaron.
  chk('el aviso usa su propia lista, no la de los reportes',
      /to: AVISO_PRESUPUESTO/.test(av) && !/to: DESTINATARIOS/.test(av),
      'le mandaria a los de los reportes, o al reves');

  const listas = fuente.split('const AVISO_PRESUPUESTO')[1].split(';')[0];
  chk('la lista del aviso incluye a los administradores',
      /DESTINATARIOS\.concat/.test(listas), listas);
  chk('y suma a quien no es administrador',
      /yedidiah20@gmail\.com/.test(listas), listas);

  const reportes = fuente.split('const DESTINATARIOS')[1].split(';')[0];
  chk('pero los REPORTES no le llegan a quien no es administrador',
      !/yedidiah20@gmail\.com/.test(reportes),
      'recibiria el PDF con todos los pagos de la empresa, Nomina incluida');
}


console.log('\n=== Lo que todavia NO esta, falla en voz alta ===');
{
  const e = montar({ 'PAGOS REGISTRADOS': [ENC_PAGOS] }, 'off');
  let explotó = false, mensaje = '';
  try { e.globales.DriveApp.createFolder('x'); } catch (err) { explotó = true; mensaje = err.message; }
  chk('DriveApp avisa cuando no esta disponible', explotó && /DriveApp/.test(mensaje), mensaje);
  chk('y dice que hay que seguir usando Apps Script', /Apps Script/.test(mensaje), mensaje);

  // Registrar un pago toca Drive SIEMPRE, aunque no haya archivos adjuntos,
  // porque resuelve la carpeta de la seccion antes de mirar si hay algo que
  // subir. Con `sinDrive` se comprueba que esa dependencia sigue existiendo:
  // el dia que alguien la cambie, esta prueba lo va a avisar.
  let pagoFalla = false;
  try {
    e.globales.registrarPago_({ tipo_factura: 'viaticos', empresa: 'AMPAC SAS',
      monto: '1000', nombre_pago: 'x', proveedor: 'y', fecha_pago: '2026-09-18',
      fecha_envio: 'op-1', archivos: [] });
  } catch (err) { pagoFalla = /DriveApp/.test(err.message); }
  chk('registrar un pago depende de Drive AUNQUE no haya adjuntos', pagoFalla);
}

console.log('\n=== Quien registra sale de la SESION, no del navegador ===');
{
  // El agujero que esto cierra: hasta el 2026-09-30 registrarPago_ escribia
  // `body.registrado_por` tal cual. Precargar el campo en el formulario no
  // alcanzaba, porque el formulario no es una barrera: cualquiera puede
  // mandar otro nombre por fuera de la app. Resultado medido sobre 275 pagos:
  // 11 formas de escribir 6 personas y 150 a nombre de alguien sin cuenta.
  const ENC = ENC_PAGOS.concat(['RUBRO', 'CORREO REGISTRO']);
  const foto = {
    'PAGOS REGISTRADOS': [ENC],
    'Viaticos': [ENC],
    'Compra Materiales': [ENC],
    'Caja Menor': [ENC],
    'SALDOS':    [['FECHA', 'CUENTA', 'SALDO BASE', 'CONCEPTO', 'REGISTRADO POR']],
    'TRASLADOS': [['FECHA', 'ORIGEN', 'DESTINO', 'MONTO', 'REGISTRADO POR', 'NOTA',
                   'URL COMPROBANTE', 'FECHA REGISTRO', 'REALIZADO POR']],
    'PRESUPUESTO': [['FECHA', 'MONTO DIARIO', 'REGISTRADO POR', 'NOTA']],
    'USUARIOS': [['CORREO', 'NOMBRE', 'TELEFONO', 'ROL', 'SECCIONES', 'ESTADO',
                  'FECHA REGISTRO', 'ULTIMO ACCESO'],
                 ['sst@energy-millennium.com', 'Laura Leyton', '300', 'usuario',
                  'viaticos', 'activo', '', '']],
    'SESIONES': [['HASH', 'CORREO', 'CREADA', 'ULTIMO USO', 'VENCE']],
    'SOLICITUDES DE APROBACION': [['ID SOLICITUD', 'FECHA SOLICITUD', 'EMPRESA',
      'TIPO DE PAGO', 'NOMBRE DEL PAGO', 'PROVEEDOR', 'FECHA DE PAGO', 'VALOR',
      'SOLICITADO POR', 'CORREO', 'NOTAS', 'URL ARCHIVO', 'ESTADO',
      'REVISADO POR', 'FECHA DECISION', 'COMENTARIO']]
  };

  const e = montar(foto, 'estricto');
  // El token dice un nombre DISTINTO al de la hoja USUARIOS a proposito: el
  // nombre bueno es el de la cuenta, no el que venga de afuera.
  require('vm').runInContext(
    "verificarIdToken_ = function (t) { return t ? { correo: String(t), nombre: 'NOMBRE DEL TOKEN' } : null; };" +
    "subirArchivosASeccion_ = function () { return ''; };",
    e.globales);

  const hoja = () => e.globales.SpreadsheetApp.getActiveSpreadsheet()
                      .getSheetByName('Viaticos').getDataRange().getValues();
  const col = n => ENC.indexOf(n);

  const r = e.globales.registrarPago_({
    idToken: 'sst@energy-millennium.com',
    tipo_factura: 'viaticos', empresa: 'AMPAC SAS', monto: '50000',
    nombre_pago: 'Almuerzo', proveedor: 'Restaurante', fecha_pago: '2026-09-30',
    fecha_envio: 'op-identidad-1', rubro: 'almuerzo', archivos: [],
    // Lo que el navegador manda, y que el servidor tiene que IGNORAR.
    registrado_por: 'Laura Castillo'
  });
  chk('el pago se registra', r.status === 'success', r);

  const fila = hoja()[1] || [];
  chk('NO se guarda el nombre que mando el navegador',
      fila[col('REGISTRADO POR')] !== 'Laura Castillo', fila[col('REGISTRADO POR')]);
  chk('se guarda el nombre de la CUENTA',
      fila[col('REGISTRADO POR')] === 'Laura Leyton', fila[col('REGISTRADO POR')]);
  chk('tampoco se usa el nombre que venga en el token de Google',
      fila[col('REGISTRADO POR')] !== 'NOMBRE DEL TOKEN', fila[col('REGISTRADO POR')]);
  chk('y queda el correo, que es la identidad que no se repite',
      fila[col('CORREO REGISTRO')] === 'sst@energy-millennium.com',
      fila[col('CORREO REGISTRO')]);

  // Sin nombre en USUARIOS se cae al correo: nunca queda vacio, porque esta
  // columna es la unica trazabilidad que tiene la contabilidad.
  const foto2 = JSON.parse(JSON.stringify(foto));
  foto2['USUARIOS'][1][1] = '';
  const e2 = montar(foto2, 'estricto');
  require('vm').runInContext(
    "verificarIdToken_ = function (t) { return t ? { correo: String(t), nombre: '' } : null; };" +
    "subirArchivosASeccion_ = function () { return ''; };",
    e2.globales);
  e2.globales.registrarPago_({
    idToken: 'sst@energy-millennium.com', tipo_factura: 'viaticos',
    empresa: 'AMPAC SAS', monto: '1000', nombre_pago: 'x', proveedor: 'y',
    fecha_pago: '2026-09-30', fecha_envio: 'op-identidad-2', archivos: [],
    registrado_por: 'Quien Sea'
  });
  const fila2 = e2.globales.SpreadsheetApp.getActiveSpreadsheet()
                  .getSheetByName('Viaticos').getDataRange().getValues()[1] || [];
  chk('sin nombre en la cuenta, cae al correo y NO al texto del navegador',
      fila2[col('REGISTRADO POR')] === 'sst@energy-millennium.com',
      fila2[col('REGISTRADO POR')]);

  // La columna tiene que existir en TODAS las hojas de pago, no solo donde se
  // escribio. Los reportes mapean cada hoja con los encabezados de la primera
  // y una columna faltante produce celdas `undefined` que rompen el PDF sin
  // avisar. Ya paso con ID REGISTRO y con RUBRO.
  const fuente = require('fs').readFileSync(RUTA, 'utf8').replace(/\r\n/g, '\n');
  const enc = fuente.split('const ENCABEZADOS_PAGOS = [')[1].split('];')[0];
  chk('CORREO REGISTRO es columna de todas las hojas de pago',
      /'CORREO REGISTRO'/.test(enc), enc);

  const reg = fuente.split('function registrarPago_')[1].split('\n}\n')[0];
  chk('registrarPago_ ya no confia en body.registrado_por a secas',
      !/'REGISTRADO POR':\s*body\.registrado_por/.test(reg),
      'volvio a escribir lo que manda el navegador');
  chk('y lo toma del contexto autenticado',
      /'REGISTRADO POR':\s*ctx\.autenticado/.test(reg), reg.slice(0, 120));
}

console.log('\n=== El formulario no deja escribir ese campo ===');
{
  const html = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  const campo = html.split('id="registradoPor"')[1].slice(0, 260);

  chk('el campo es de solo lectura', /readonly/.test(campo), campo.slice(0, 90));
  chk('y no se puede llegar a el con el tabulador', /tabindex="-1"/.test(campo), campo.slice(0, 90));
  chk('ya no se pide como campo a completar',
      !/const required = \[[^\]]*'registradoPor'/.test(html),
      'seguiria pidiendo completar un campo que no se puede tocar');
  // Ojo con como se comprueba esto: buscar solo "campo.value = quienSoy" NO
  // sirve, porque ese texto sigue estando aunque se le ponga un `if` que lo
  // condicione. Se exige la forma incondicional Y la ausencia del guardia.
  //
  // El 19/10 esto se movio a su propia funcion, porque hacia falta llamarlo
  // tambien desde resetForm(): estaba solo en aplicarPermisos() y el nombre
  // desaparecia a partir del segundo pago de cada sesion.
  const pintaQuien = html.split('function pintarQuienRegistra()')[1].split('\n    }')[0];
  chk('se pisa SIEMPRE con la sesion, no solo si esta vacio',
      /campo\.value = quienSoy;/.test(pintaQuien) &&
      !/campo[^;]*\.value\.trim\(\)/.test(pintaQuien),
      'si solo se precarga cuando esta vacio, entra el autocompletado del navegador');

  // La pestana de Control de Viaticos: visible para quien tenga la seccion,
  // pero el boton que DEFINE el presupuesto solo para administradores.
  chk('la pestana se muestra por seccion, no por ser admin',
      /navVt\.style\.display = puede\('viaticos'\)/.test(html),
      'volvio a ser solo para administradores');
  chk('el boton de presupuesto sigue siendo solo de administradores',
      /btnPresu\.style\.display = esAdministrador/.test(html),
      'un control que el controlado puede subir no es un control');
}

console.log('\n=== Los traslados salen en Consultar Pagos, pero NO suman ===');
{
  const ENC = ENC_PAGOS.concat(['RUBRO', 'CORREO REGISTRO']);
  const foto = {
    'PAGOS REGISTRADOS': [ENC,
      [serie(2026, 9, 15, 10, 0), 'AMPAC SAS', 'compra', 'Nathan', 'n', 'p',
       serie(2026, 9, 15), 300000, '', '', 'id1', '', '']],
    'Viaticos': [ENC], 'Compra Materiales': [ENC], 'Caja Menor': [ENC],
    'SALDOS': [['FECHA', 'CUENTA', 'SALDO BASE', 'CONCEPTO', 'REGISTRADO POR']],
    'TRASLADOS': [['FECHA', 'ORIGEN', 'DESTINO', 'MONTO', 'REGISTRADO POR', 'NOTA',
                   'URL COMPROBANTE', 'FECHA REGISTRO', 'REALIZADO POR'],
      [serie(2026, 9, 16), 'banco_ampac', 'viaticos', 500000, 'Nathan De Lima',
       'Envio para viaticos', 'https://drive/comp1', serie(2026, 9, 16, 9, 30),
       'nathan@ylevigroup.com']],
    'USUARIOS': [['CORREO', 'NOMBRE', 'TELEFONO', 'ROL', 'SECCIONES', 'ESTADO',
                  'FECHA REGISTRO', 'ULTIMO ACCESO'],
                 ['nathan@ylevigroup.com', 'Nathan De Lima', '300', 'admin', 'todas', 'activo', '', ''],
                 ['laura@energy-millennium.com', 'Laura', '300', 'usuario', 'pagos', 'activo', '', '']],
    'SESIONES': [['HASH', 'CORREO', 'CREADA', 'ULTIMO USO', 'VENCE']],
    'SOLICITUDES DE APROBACION': [['ID SOLICITUD']]
  };

  const e = montar(foto, 'off');
  const filas = e.globales.consultarPagos_();
  const tras  = filas.filter(f => String(f['TIPO FACTURA']).toLowerCase() === 'traslado');

  chk('el traslado aparece en la lista de pagos', tras.length === 1, filas.length);
  chk('y va marcado como traslado, no como un pago cualquiera',
      tras.length === 1 && tras[0]['TIPO FACTURA'] === 'traslado', tras[0]);

  // El mapeo: lo que se ve en la tabla tiene que decir algo, no claves
  // internas como "banco_ampac".
  const t = tras[0] || {};
  chk('la empresa es la cuenta de donde SALE, con su nombre actual',
      t['EMPRESA'] === 'BLAZAR ENERGY', t['EMPRESA']);
  chk('el proveedor es la cuenta a donde ENTRA',
      t['PROVEEDOR'] === 'Viáticos', t['PROVEEDOR']);
  chk('el concepto dice a donde fue', /Traslado a Vi/.test(String(t['NOMBRE DE PAGO'])), t['NOMBRE DE PAGO']);
  chk('el valor es el monto trasladado', Number(t['VALOR FACTURA']) === 500000, t['VALOR FACTURA']);
  chk('el comprobante viaja como archivo del pago',
      String(t['URL ARCHIVO']).indexOf('comp1') !== -1, t['URL ARCHIVO']);
  chk('y queda quien lo registro', t['REGISTRADO POR'] === 'Nathan De Lima', t['REGISTRADO POR']);
  chk('trae una clave estable para identificarlo',
      /^traslado-/.test(String(t['ID REGISTRO'])), t['ID REGISTRO']);

  // Las columnas tienen que ser LAS MISMAS que las de un pago: si faltara
  // alguna, el Excel y el PDF saldrian con huecos.
  const unPago = filas.filter(f => f['ID REGISTRO'] === 'id1')[0];
  const faltan = Object.keys(unPago).filter(k => !(k in t));
  chk('no le falta ninguna columna de las que tiene un pago', faltan.length === 0, faltan);

  // Permisos: mover dinero entre cuentas es un acto administrativo.
  const g = montar(foto, 'estricto');
  require('vm').runInContext(
    'verificarIdToken_ = function (t) { return t ? { correo: String(t), nombre: String(t) } : null; };',
    g.globales);

  const comoAdmin = g.globales.consultarPagos_(
    g.globales.contextoDe_({ idToken: 'nathan@ylevigroup.com' }));
  chk('un administrador los ve',
      comoAdmin.some(f => String(f['TIPO FACTURA']).toLowerCase() === 'traslado'), comoAdmin.length);

  const comoUsuario = g.globales.consultarPagos_(
    g.globales.contextoDe_({ idToken: 'laura@energy-millennium.com' }));
  chk('un usuario comun NO los ve por esta puerta',
      !comoUsuario.some(f => String(f['TIPO FACTURA']).toLowerCase() === 'traslado'),
      comoUsuario.filter(f => String(f['TIPO FACTURA']).toLowerCase() === 'traslado'));
}

console.log('\n=== Un traslado no es un gasto: no puede sumar al total ===');
{
  const html = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');

  // tipoInfo cae en "Venta" por defecto, asi que el caso del traslado tiene
  // que estar ANTES de ese fallback o un traslado se etiquetaria como venta.
  const ti = html.split('function tipoInfo')[1].split('\n    }')[0];
  chk('el traslado tiene su propia etiqueta', /tipo === 'traslado'/.test(ti), ti.slice(0, 120));
  chk('y esta antes del "Venta" por defecto',
      ti.indexOf("tipo === 'traslado'") < ti.indexOf("label: 'Venta'"),
      'un traslado saldria etiquetado como Venta');

  // El 22/10 el filtro de tipo paso de un <select> a casillas, para poder
  // pedir varios tipos a la vez. La capacidad es la misma; cambio el control.
  chk('se puede filtrar por traslado',
      /<input type="checkbox" value="traslado">/.test(html), 'falta la casilla');

  // Lo importante: el total.
  chk('los traslados se separan de los pagos para el total',
      /const pagos\s*=\s*rows\.filter\(r => !esTraslado\(r\)\)/.test(html),
      'entrarian al total');
  chk('el total se calcula SOLO sobre los pagos',
      /const total\s*=\s*pagos\.reduce/.test(html),
      'contaria dos veces la misma plata');
  chk('y se informa aparte cuanto suman los traslados',
      /no suman/.test(html), 'el numero enganaria sin decirlo');
}

console.log('\n=== El reporte por correo: columnas para una persona, valores para Excel ===');
{
  // Hasta el 08/10 esto volcaba la hoja tal cual: trece columnas con el UUID
  // del registro, la URL entera del comprobante, el correo de quien lo cargo
  // y "pago_proveedor" escrito como lo guarda la maquina.
  const e = montar({ 'PAGOS REGISTRADOS': [ENC_PAGOS] }, 'off');
  const g = e.globales;
  const COLS = require('vm').runInContext('COLUMNAS_REPORTE', g);
  const campos = COLS.map(c => c.campo);

  // Lo que NO tiene que estar. Son datos internos: no le dicen nada a quien
  // lee el reporte y se comen el ancho de las columnas que si importan.
  ['ID REGISTRO', 'CORREO REGISTRO', 'NOMBRE DEL ARCHIVO'].forEach(c =>
    chk('el reporte no muestra "' + c + '"', campos.indexOf(c) === -1, campos));

  chk('pero si muestra las dos fechas',
      campos.indexOf('FECHA REGISTRO') !== -1 && campos.indexOf('FECHA DE PAGO') !== -1, campos);

  const cuando = new Date(2026, 9, 8, 14, 30, 0);
  const fila = g.filasDelReporte_([{
    'FECHA REGISTRO': cuando,
    'FECHA DE PAGO':  new Date(2026, 9, 7),
    'EMPRESA':        'AMPAC SAS',
    'TIPO FACTURA':   'compra_materiales',
    'NOMBRE DE PAGO': 'Materiales',
    'PROVEEDOR':      'ELECTRI TORNILLOS',
    'REGISTRADO POR': 'Laura Leyton',
    'RUBRO':          '',
    'NOTAS':          'urgente',
    'VALOR FACTURA':  22000,
    'URL ARCHIVO':    'https://drive.google.com/file/d/abc/view',
    'ID REGISTRO':    'no-deberia-salir',
    'CORREO REGISTRO': 'sst@energy-millennium.com'
  }])[0];

  chk('una fila trae exactamente una celda por columna', fila.length === COLS.length,
      [fila.length, COLS.length]);

  const de = t => fila[COLS.findIndex(c => c.titulo === t)];

  chk('el tipo se escribe como lo dice una persona',
      de('Tipo') === 'Compra Materiales', de('Tipo'));

  // Estas dos son la razon de que el Excel sirva: si las fechas llegan como
  // texto no se pueden ordenar, y si el monto llega como texto no se puede
  // sumar. El formato se aplica despues, sobre la columna.
  chk('la fecha sigue siendo una FECHA, no texto',
      de('Registrado') instanceof Date, typeof de('Registrado'));
  chk('y el monto sigue siendo un NUMERO', typeof de('Valor') === 'number', typeof de('Valor'));

  chk('el comprobante es un enlace que dice "Ver"',
      /^=HYPERLINK\(/.test(String(de('Comprobante'))) && /Ver/.test(String(de('Comprobante'))),
      de('Comprobante'));
  chk('y no la URL entera a la vista',
      String(de('Comprobante')).indexOf('drive.google.com/file/d/abc') !== -1 &&
      String(de('Comprobante')).length < 90, de('Comprobante'));

  chk('nada del registro interno se cuela en la fila',
      fila.indexOf('no-deberia-salir') === -1 &&
      fila.indexOf('sst@energy-millennium.com') === -1, fila);

  // Sin comprobante: celda vacia, no una formula rota.
  const sinUrl = g.filasDelReporte_([{ 'URL ARCHIVO': '', 'VALOR FACTURA': 100 }])[0];
  chk('sin comprobante la celda queda vacia',
      sinUrl[COLS.findIndex(c => c.enlace)] === '', sinUrl);

  // Un rubro se etiqueta; uno vacio no inventa nada.
  const conRubro = g.filasDelReporte_([{ 'RUBRO': 'hidratacion', 'VALOR FACTURA': 1 }])[0];
  chk('el rubro se escribe con su nombre',
      conRubro[COLS.findIndex(c => c.rubro)] === 'Hidratación', conRubro);

  // Un tipo desconocido se deja como vino, no se le inventa una etiqueta: es
  // preferible que se vea raro a que el reporte afirme algo que no es.
  chk('un tipo que no esta en la lista se deja tal cual',
      g.etiquetaDeTipo_('algo_nuevo') === 'algo_nuevo', g.etiquetaDeTipo_('algo_nuevo'));

  // El total sale de los registros, no de la tabla ya formateada.
  chk('el total suma los montos',
      g.totalDeRegistros_([{ 'VALOR FACTURA': 1000 }, { 'VALOR FACTURA': '2.500' }]) === 3500,
      g.totalDeRegistros_([{ 'VALOR FACTURA': 1000 }, { 'VALOR FACTURA': '2.500' }]));

  // Un dia sin pagos no manda dos adjuntos vacios.
  const fuente = require('fs').readFileSync(RUTA, 'utf8').replace(/\r\n/g, '\n');
  const diario = fuente.split('function enviarReporteDiario')[1].split('\n}\n')[0];
  chk('un dia sin pagos no manda adjuntos',
      /if \(!registros\.length\)/.test(diario) && /return;/.test(diario),
      'mandaria un PDF y un Excel en blanco');

  // La hoja temporal se recorta antes de exportar.
  const gen = fuente.split('function generarArchivos_')[1].split('\n}\n')[0];
  // Ojo: NO alcanza con que la llamada exista. Envolverla en `if (false)` la
  // deja escrita y sin efecto, y una prueba que solo busca "deleteColumns"
  // pasa igual — comprobado con una mutacion. Se exige la condicion real.
  chk('la hoja temporal se recorta antes del PDF',
      /if \(sobranCols > 0\) hoja\.deleteColumns/.test(gen) &&
      /if \(sobranFilas > 0\) hoja\.deleteRows/.test(gen),
      'el PDF saldria con columnas y paginas en blanco');
  chk('y el PDF no lleva las lineas de cuadricula encima de los bordes',
      /gridlines=false/.test(gen), 'saldria rayado');
}

console.log('\n=== UNA sola regla para decir de que dia es un pago ===');
{
  // El 08/10 el correo decia 18 pagos y $27.074.260, y la app 15 y
  // $26.996.260. La diferencia eran tres gastos del 07/10 cargados el 08: el
  // reporte filtraba por fecha de REGISTRO y la app por fecha de PAGO.
  //
  // Es la TERCERA vez que este criterio se desalinea (panel de viaticos el
  // 28/09, Consultar Pagos el 01/10, el correo el 08/10). Por eso ahora hay
  // una sola funcion y todos la llaman.
  const g = montar({ 'PAGOS REGISTRADOS': [ENC_PAGOS] }, 'off').globales;

  const cargadoHoyGastadoAyer = {
    'FECHA REGISTRO': new Date(2026, 9, 8, 16, 30),
    'FECHA DE PAGO':  new Date(2026, 9, 7)
  };
  const cuando = g.fechaDelGasto_(cargadoHoyGastadoAyer);
  chk('manda la fecha del GASTO, no la de la carga',
      cuando.getDate() === 7 && cuando.getMonth() === 9,
      cuando && cuando.toISOString());

  // Un pago sin fecha de pago no puede desaparecer de todos lados a la vez.
  const sinFecha = g.fechaDelGasto_({
    'FECHA REGISTRO': new Date(2026, 9, 8, 9, 0), 'FECHA DE PAGO': ''
  });
  chk('sin fecha de pago se cae a la de registro',
      sinFecha && sinFecha.getDate() === 8, sinFecha && sinFecha.toISOString());

  chk('y sin ninguna de las dos, no inventa un dia',
      g.fechaDelGasto_({ 'FECHA REGISTRO': '', 'FECHA DE PAGO': '' }) === null,
      g.fechaDelGasto_({}));

  // Lo que de verdad importa: que los TRES lugares llamen a la misma funcion.
  // Si alguno vuelve a escribir la regla por su cuenta, se desalinean otra vez
  // y el sintoma vuelve a ser dos pantallas con totales distintos.
  const fuente = require('fs').readFileSync(RUTA, 'utf8').replace(/\r\n/g, '\n');
  const trozo = function (nombre) {
    return fuente.split('function ' + nombre)[1].split('\n}\n')[0];
  };

  ['enviarReporteDiario', 'enviarReporteMensual', 'gastoViaticosPorRubro_'].forEach(function (f) {
    chk(f + ' usa la regla compartida', /fechaDelGasto_\(/.test(trozo(f)),
        'escribio su propia version del criterio');
  });

  chk('el reporte diario ya NO filtra por fecha de registro',
      !/mismoDia_\(parseFechaRegistro_/.test(trozo('enviarReporteDiario')),
      'volveria a contar distinto que la app');
  chk('ni el mensual',
      !/mismoMes_\(parseFechaRegistro_/.test(trozo('enviarReporteMensual')),
      'volveria a contar distinto que la app');

  // El diagnostico tiene que medir lo MISMO que el envio, o diria que hay 18
  // pagos cuando el correo manda 15.
  chk('el diagnostico mide lo mismo que el envio',
      /fechaDelGasto_\(/.test(trozo('diagnosticarReporte')),
      'el diagnostico contaria una cosa y el correo otra');

  // Y el caso completo: una tabla con un pago de cada clase.
  const filas = [
    { 'FECHA REGISTRO': new Date(2026, 9, 8, 10, 0), 'FECHA DE PAGO': new Date(2026, 9, 8), 'VALOR FACTURA': 100 },
    { 'FECHA REGISTRO': new Date(2026, 9, 8, 16, 0), 'FECHA DE PAGO': new Date(2026, 9, 7), 'VALOR FACTURA': 50 },
    { 'FECHA REGISTRO': new Date(2026, 9, 8, 17, 0), 'FECHA DE PAGO': '',                   'VALOR FACTURA': 7 }
  ];
  const delDia = filas.filter(function (r) {
    return g.mismoDia_(g.fechaDelGasto_(r), new Date(2026, 9, 8));
  });
  chk('el dia trae el gasto de hoy y el que no tiene fecha, no el de ayer',
      delDia.length === 2 && g.totalDeRegistros_(delDia) === 107,
      [delDia.length, g.totalDeRegistros_(delDia)]);
}

console.log('\n=== AMPAC SAS paso a llamarse BLAZAR ENERGY ===');
{
  // El 13/10/2026 la empresa cambio de nombre. Decision del usuario: los 389
  // pagos anteriores se dejan con el nombre con el que se emitieron las
  // facturas, porque cambiarlos haria que el registro discrepe del papel.
  //
  // O sea que el sistema tiene que entender LOS DOS nombres, para siempre.
  const g = montar({ 'PAGOS REGISTRADOS': [ENC_PAGOS] }, 'off').globales;
  const bolsa = n => g.cuentaDePago_('pago_proveedor', n);

  chk('el nombre NUEVO va al banco de esa empresa',
      bolsa('BLAZAR ENERGY') === 'banco_ampac', bolsa('BLAZAR ENERGY'));
  chk('y el VIEJO tambien, porque son 389 pagos historicos',
      bolsa('AMPAC SAS') === 'banco_ampac', bolsa('AMPAC SAS'));
  chk('escrito de cualquier forma', bolsa('Blazar Energy S.A.S.') === 'banco_ampac',
      bolsa('Blazar Energy S.A.S.'));
  chk('la otra empresa no se mezcla',
      bolsa('Millennium Co') === 'banco_millennium', bolsa('Millennium Co'));

  // Esto es lo que pasaria si se reconociera un solo nombre: null, el pago no
  // descuenta de ningun saldo, y lo unico que lo delata es un contador que
  // casi nadie mira.
  chk('un nombre desconocido NO se adivina', bolsa('Empresa Inventada SA') === null,
      bolsa('Empresa Inventada SA'));

  // La clave interna NO cambia aunque el nombre si. Esta escrita en 18 filas
  // de SALDOS y 8 de TRASLADOS; migrarla a medias descuadra los saldos.
  const fuente = require('fs').readFileSync(RUTA, 'utf8').replace(/\r\n/g, '\n');
  const cuentas = fuente.split('const CUENTAS = {')[1].split('\n};')[0];
  chk('la clave sigue siendo banco_ampac', /banco_ampac:/.test(cuentas), cuentas.slice(0, 80));
  chk('pero lo que se MUESTRA es BLAZAR ENERGY',
      /etiqueta: 'BLAZAR ENERGY'/.test(cuentas), cuentas);
  chk('y no quedo ninguna etiqueta con el nombre viejo',
      !/etiqueta: 'AMPAC/.test(cuentas), cuentas);
}

console.log('\n=== La pantalla: se registra con el nombre nuevo, se busca con los dos ===');
{
  const html = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');

  // Registrar: solo el nombre nuevo. Si siguiera la opcion vieja, se seguirian
  // cargando pagos a nombre de una empresa que ya no existe.
  const nuevoPago = html.split('id="empresa"')[1].split('</select>')[0];
  chk('en Nuevo Pago solo se ofrece BLAZAR ENERGY',
      /value="BLAZAR ENERGY"/.test(nuevoPago) && !/value="AMPAC/.test(nuevoPago), nuevoPago);

  const solicitud = html.split('id="empresaSolicitud"')[1].split('</select>')[0];
  chk('y en la solicitud de aprobacion tambien',
      /value="BLAZAR ENERGY"/.test(solicitud) && !/value="AMPAC/.test(solicitud), solicitud);

  // Buscar: una sola opcion, que trae las dos epocas. Con dos opciones
  // separadas habria que saber la fecha del cambio para encontrar algo.
  const filtro = html.split('id="fEmpresa"')[1].split('</select>')[0];
  chk('el filtro tiene UNA opcion para esa empresa',
      (filtro.match(/value="BLAZAR ENERGY"/g) || []).length === 1 &&
      !/value="AMPAC/.test(filtro), filtro);
  chk('y avisa que incluye el nombre anterior',
      /antes AMPAC/.test(filtro), filtro);

  chk('el filtro busca por TODOS los nombres de la empresa',
      /nombresDe\(empresa\)\.some/.test(html),
      'escondria 389 pagos y se veria como "no hay resultados"');
  chk('y la tabla de nombres incluye los dos',
      /'blazar energy':\s*\['blazar',\s*'ampac'\]/.test(html),
      'falta alguno de los dos nombres');

  chk('la marca de la pantalla de ingreso esta actualizada',
      /BLAZAR ENERGY<\/div>/.test(html) && !/AMPAC SAS<\/div>/.test(html),
      'seguiria diciendo el nombre viejo al entrar');
}

console.log('\n=== "Hoy" sigue siendo hoy aunque la app quede abierta ===');
{
  // Lo que paso el 14/10/2026: la app estaba abierta desde el dia anterior y
  // el calendario de Traslados marcaba el 13 como hoy, con el 14 DESHABILITADO.
  // flatpickr resuelve 'today' una sola vez, al inicializar.
  //
  // Lo que no se veia y es peor: Nuevo Pago arranca con la fecha de hoy ya
  // puesta. El primer pago despues de medianoche se habria guardado con la
  // fecha de AYER, y esa fecha es la que manda en los saldos, el panel de
  // viaticos y los reportes.
  const html = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');

  const sinComentarios = html.split('\n')
    .filter(l => l.trim().indexOf('//') !== 0)
    .map(l => l.replace(/\s\/\/.*$/, ''))
    .join('\n');

  chk('el tope del calendario de traslados se recalcula al abrirlo',
      /onOpen: function \(sel, texto, inst\) \{ inst\.set\('maxDate', new Date\(\)\); \}/.test(sinComentarios),
      'hoy quedaria deshabilitado si la app lleva un dia abierta');

  chk('existe el refresco de calendarios',
      /function refrescarCalendarios\(\)/.test(sinComentarios), 'falta la funcion');

  const fn = sinComentarios.split('function refrescarCalendarios()')[1].split('\n    }')[0];

  chk('no hace nada si sigue siendo el mismo dia',
      /if \(diaISO\(hoy\) === diaDeLosCalendarios\) return;/.test(fn), fn.slice(0, 120));
  chk('corrige el tope de traslados',
      /fechaPickerTraslado\.set\('maxDate', hoy\)/.test(fn), fn);
  chk('revisa los TRES calendarios, no solo el de traslados',
      /\[fechaPicker, fechaPickerSolicitud, fechaPickerTraslado\]/.test(fn), fn);

  // Esta es la parte delicada: pisar la fecha que la persona eligio a
  // proposito seria peor que el bug original.
  chk('solo pisa la fecha si es la que puso el sistema',
      /if \(elegida && diaISO\(elegida\) === diaDeLosCalendarios\)/.test(fn),
      'pisaria una fecha elegida a mano');
  chk('y al reemplazarla no dispara el onChange',
      /p\.setDate\(hoy, false\)/.test(fn), 'un refresco no es una eleccion del usuario');

  // Sin esto el refresco existe pero nunca corre.
  chk('se revisa al volver a la pestana del navegador',
      /visibilityState === 'visible'\) refrescarCalendarios\(\)/.test(sinComentarios),
      'nadie llamaria al refresco');
  chk('y al cambiar de seccion dentro de la app',
      /navTabs\.forEach\(function \(t\) \{ t\.addEventListener\('click', refrescarCalendarios\); \}\)/.test(sinComentarios),
      'no se refrescaria sin salir del navegador');
}

console.log('\n=== La logica del refresco, simulando el cambio de dia ===');
{
  // Se reimplementa la decision tal como esta en la pantalla, para poder
  // correrla con fechas inventadas. Lo que se prueba es la REGLA: cuando se
  // pisa el valor y cuando no.
  const diaISO = d => {
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  };
  const sePisa = (diaCalendarios, elegida, hoy) =>
    diaISO(hoy) !== diaCalendarios && !!elegida && diaISO(elegida) === diaCalendarios;

  const ayer = new Date(2026, 9, 13);
  const hoy  = new Date(2026, 9, 14);

  chk('la fecha vieja del sistema se reemplaza por hoy',
      sePisa('2026-10-13', ayer, hoy) === true);
  chk('una fecha elegida a mano NO se toca',
      sePisa('2026-10-13', new Date(2026, 9, 2), hoy) === false);
  chk('si no cambio el dia, no se toca nada',
      sePisa('2026-10-14', hoy, hoy) === false);
  chk('un campo vacio no se rellena solo',
      sePisa('2026-10-13', null, hoy) === false);
}

console.log('\n=== Filtro por persona, en Consultar Pagos y en Control de Viaticos ===');
{
  const html = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  const sinComentarios = html.split('\n')
    .filter(l => l.trim().indexOf('//') !== 0)
    .map(l => l.replace(/\s\/\/.*$/, ''))
    .join('\n');

  chk('Consultar Pagos tiene el campo', /id="fRegistradoPor"/.test(html), 'falta el campo');
  chk('Control de Viaticos tambien', /id="vtQuien"/.test(html), 'falta el campo');

  // Desplegable y NO texto libre. Con texto libre volverian los 11 nombres
  // para 6 personas que hubo hasta el 30/09: "Nathan", "nathan" y "Nathan De
  // Lima" serian tres busquedas distintas.
  const campoPagos = html.split('id="fRegistradoPor"')[1].split('>')[0] +
                     html.split('id="fRegistradoPor"')[1].split('</select>')[0];
  chk('en Consultar Pagos es un desplegable, no un campo de texto',
      html.indexOf('<select id="fRegistradoPor"') !== -1, campoPagos.slice(0, 80));
  chk('y en Viaticos tambien',
      html.indexOf('<select id="vtQuien"') !== -1, 'seria texto libre');

  // Las opciones salen de los DATOS, no de la hoja USUARIOS: si salieran de
  // ahi, elegir a alguien que no registro nada daria cero resultados sin
  // explicar por que, y faltaria quien ya no tiene cuenta activa.
  chk('las opciones de Consultar Pagos salen de las filas traidas',
      /rows\.forEach\(function \(r\) \{\s*const n = String\(r\['REGISTRADO POR'\]/.test(sinComentarios),
      'saldrian de una lista escrita a mano');
  chk('y las de Viaticos, del detalle del periodo',
      /vtDatos && vtDatos\.detalle\)\s*\|\|\s*\[\]\)\.forEach/.test(sinComentarios),
      'no reflejarian el rango que se esta mirando');

  // Coincidencia exacta: el valor viene de un desplegable, no es una busqueda.
  chk('Consultar Pagos compara exacto',
      /String\(r\['REGISTRADO POR'\] \|\| ''\)\.trim\(\) !== quien/.test(sinComentarios),
      'con "contiene" un nombre arrastraria a otro');
  chk('y Viaticos tambien',
      /String\(d\.quien \|\| ''\)\.trim\(\) !== quien/.test(sinComentarios),
      'con "contiene" un nombre arrastraria a otro');

  // Si la persona elegida no esta en lo que se trajo, el filtro se suelta.
  // Dejarlo puesto mostraria una lista vacia sin decir por que.
  chk('el filtro se suelta si esa persona no esta en los datos (pagos)',
      (sinComentarios.match(/if \(elegido && nombres\.indexOf\(elegido\) === -1\) sel\.value = '';/g) || []).length === 2,
      'quedaria filtrando por alguien que no aparece');

  chk('Limpiar tambien limpia el filtro nuevo',
      /getElementById\('fRegistradoPor'\)\.value  = '';/.test(sinComentarios),
      'quedaria puesto despues de limpiar');

  // Cambiar un filtro no puede costar otra consulta completa al servidor.
  chk('cambiar el filtro re-filtra lo ya traido, sin pedir de nuevo',
      /renderResultados\(filtrarRows\(todasLasFilas\)\)/.test(sinComentarios),
      'cada cambio costaria una consulta de hasta 90 segundos');
  chk('y el desplegable se rellena con cada consulta',
      /pintarQuienRegistro\(rows\)/.test(sinComentarios), 'quedaria vacio');
  // Por ORDEN, no por adyacencia: entre esas dos lineas entro despues el
  // selector de equipos, y exigirlas pegadas hacia fallar la prueba por un
  // cambio que no tenia nada de malo.
  const iDatos  = sinComentarios.indexOf('vtDatos = r.presupuesto;');
  const iQuien  = sinComentarios.indexOf('pintarQuienViaticos();', iDatos);
  const iPintar = sinComentarios.indexOf('pintarControlViaticos();', iDatos);
  chk('el de viaticos se rellena al consultar, antes de pintar',
      iDatos !== -1 && iQuien > iDatos && iPintar > iQuien,
      [iDatos, iQuien, iPintar]);
}

console.log('\n=== La pantalla se bloquea mientras el pago viaja ===');
{
  // Por que existe: el aviso vivia en un toast chico, abajo a la derecha.
  // Alguien que apretaba "Enviar Pago" y no lo veia podia creer que ya estaba,
  // irse, o cargar el pago de nuevo. El servidor no lo duplica (ID REGISTRO),
  // pero eso no resuelve lo importante: la persona no sabia si su pago habia
  // quedado registrado.
  const html = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  const sinComentarios = html.split('\n')
    .filter(l => l.trim().indexOf('//') !== 0)
    .map(l => l.replace(/\s\/\/.*$/, ''))
    .join('\n');

  chk('existe el bloqueo de pantalla', /id="envioOverlay"/.test(html), 'falta el elemento');
  chk('tapa toda la pantalla', /\.envio-overlay \{[\s\S]{0,200}?position: fixed;[\s\S]{0,120}?inset: 0;/.test(html),
      'no cubriria todo');

  // Por encima de todo, incluido el login (10000). Un aviso de dinero no
  // puede quedar tapado por otra capa.
  const capa = (html.split('.envio-overlay {')[1] || '').split('}')[0];
  const z = (capa.match(/z-index:\s*(\d+)/) || [])[1];
  chk('queda por encima de cualquier otra capa de la app',
      Number(z) > 10000, 'z-index ' + z);

  // El momento exacto importa: entre apretar Enviar y la respuesta del
  // servidor es cuando alguien vuelve a apretar o se va.
  chk('se bloquea al apretar Enviar, no cuando contesta el servidor',
      /if \(on\) mostrarEnvio\('espera'/.test(sinComentarios),
      'quedaria un hueco con la pantalla libre');

  const setL = sinComentarios.split('function setLoading(on)')[1].split('\n    }')[0];
  chk('y el boton de enviar queda deshabilitado', /btnSubmit\.disabled\s*=\s*on;/.test(setL), setL);

  // Mientras se envia no puede haber forma de salir: no hay nada que
  // cancelar, y cerrarlo daria la impresion de que se detuvo algo.
  const mostrar = sinComentarios.split('function mostrarEnvio(')[1].split('\n    }')[0];
  chk('mientras se envia NO aparece el boton de cerrar',
      /envioBtn\.style\.display = \(estado === 'espera'\) \? 'none' : '';/.test(mostrar), mostrar);
  chk('y Escape no cierra el "enviando"',
      /envioBtn\.style\.display !== 'none'\) cerrarEnvio\(\);/.test(sinComentarios),
      'se podria cerrar el bloqueo a mitad del envio');

  chk('el fondo no se desplaza mientras hay bloqueo',
      /document\.body\.style\.overflow = 'hidden';/.test(mostrar), mostrar);
  chk('y se devuelve al cerrarlo',
      /document\.body\.style\.overflow = '';/.test(sinComentarios), 'la pagina quedaria trabada');

  // El resultado ocupa el centro y hay que cerrarlo a mano: es lo que
  // garantiza que se lea.
  chk('el exito se muestra en el centro, no en un toast',
      /mostrarEnvio\('ok',/.test(sinComentarios), 'volvio al aviso chico de la esquina');
  chk('y el error tambien',
      /mostrarEnvio\('error', 'No pudimos confirmar el envío'/.test(sinComentarios),
      'el aviso que mas importa quedaria en una esquina');
  chk('ya no quedan avisos de pago en un toast',
      !/showToast\('success',[\s\S]{0,60}Pago registrado/.test(sinComentarios),
      'habria dos avisos a la vez');

  // El aviso dice QUE quedo registrado, no solo que algo paso.
  chk('la confirmacion incluye el monto',
      /const montoTxt = '\$'/.test(sinComentarios), 'no se sabria que pago se registro');
  chk('y el proveedor',
      /const provTxt  = document\.getElementById\('proveedor'\)\.value\.trim\(\);/.test(sinComentarios),
      'faltaria a quien se le pago');

  // Se leen ANTES de vaciar el formulario, o saldrian vacios.
  const exito = sinComentarios.split("if (result.status === 'success')")[1].split('} else {')[0];
  chk('el monto se lee ANTES de vaciar el formulario',
      exito.indexOf('const montoTxt') < exito.indexOf('resetForm()'),
      'el aviso mostraria $0 y sin proveedor');
  // El equipo corre el mismo riesgo: tambien sale del formulario.
  chk('y el equipo tambien',
      exito.indexOf('const equipoTxt') < exito.indexOf('resetForm()'),
      'el aviso no diria a que equipo quedo cargado');
}

console.log('\n=== Viaticos por equipo, cada uno con su presupuesto ===');
{
  // El 15/10/2026 se formo el Equipo 2. Cada equipo controla sus viaticos por
  // separado: sumarlos seria perder justo lo que se quiere ver.
  //
  // El equipo lo ELIGE quien registra, con el suyo preseleccionado, y se
  // GUARDA en la fila. Cambio el 15/10: los equipos rotan, y el reparto en
  // USUARIOS lo mantiene un administrador, asi que puede quedar viejo. Quien
  // esta registrando no.
  //
  // Guardarlo en la fila es lo que permite mover a alguien manana sin
  // reescribir su historial.
  const ENC = ENC_PAGOS.concat(['RUBRO', 'CORREO REGISTRO', 'EQUIPO']);
  const dia = (d, h) => new Date(2026, 9, d, h || 12, 0, 0);
  // (diaPago, valor, rubro, equipo, quien)
  const vi = (d, valor, rubro, equipo, quien) =>
    [dia(d, 10), 'BLAZAR ENERGY', 'viaticos', quien || 'Laura Leyton', 'X', 'Prov',
     dia(d), valor, '', '', 'id-' + d + '-' + valor, rubro || 'almuerzo', '', equipo === undefined ? 'equipo_1' : equipo];

  const foto = {
    'PAGOS REGISTRADOS': [ENC],
    'Viaticos': [ENC,
      vi(15, 100000, 'almuerzo', 'equipo_1'),
      vi(15,  50000, 'cena',     'equipo_1'),
      vi(15, 300000, 'almuerzo', 'equipo_2', 'Didier Vivas'),
      // Un viatico VIEJO, de antes de la division: sin equipo guardado.
      vi(15,  70000, 'desayuno', '')],
    'Compra Materiales': [ENC], 'Caja Menor': [ENC],
    'SALDOS':    [['FECHA', 'CUENTA', 'SALDO BASE', 'CONCEPTO', 'REGISTRADO POR']],
    'TRASLADOS': [['FECHA', 'ORIGEN', 'DESTINO', 'MONTO', 'REGISTRADO POR', 'NOTA',
                   'URL COMPROBANTE', 'FECHA REGISTRO', 'REALIZADO POR']],
    'PRESUPUESTO': [['FECHA', 'MONTO DIARIO', 'REGISTRADO POR', 'NOTA', 'EQUIPO'],
                    [dia(1, 8), 200000, 'Nathan', 'equipo 1', 'equipo_1'],
                    [dia(1, 8), 500000, 'Nathan', 'equipo 2', 'equipo_2']],
    'USUARIOS': [['CORREO', 'NOMBRE', 'TELEFONO', 'ROL', 'SECCIONES', 'ESTADO',
                  'FECHA REGISTRO', 'ULTIMO ACCESO', 'EQUIPO'],
                 ['nathan@ylevigroup.com', 'Nathan', '300', 'admin', 'todas', 'activo', '', '', ''],
                 ['laura@energy-millennium.com', 'Laura Leyton', '300', 'usuario', 'viaticos', 'activo', '', '', 'equipo_1'],
                 ['didier@energy-millennium.com', 'Didier Vivas', '300', 'usuario', 'viaticos', 'activo', '', '', 'equipo_2']],
    'SESIONES': [['HASH', 'CORREO', 'CREADA', 'ULTIMO USO', 'VENCE']],
    'SOLICITUDES DE APROBACION': [['ID SOLICITUD']]
  };

  const e = montar(foto, 'off');
  const g = e.globales;
  const HOY = dia(15);

  // ─── Cada equipo cuenta lo suyo ───
  const uno = g.estadoPresupuesto_(HOY, HOY, 'equipo_1');
  const dos = g.estadoPresupuesto_(HOY, HOY, 'equipo_2');

  // El viatico sin equipo cuenta como Equipo 1: era el unico que existia
  // antes de la division. 100.000 + 50.000 + 70.000.
  chk('el Equipo 1 suma lo suyo, y lo anterior a la division',
      uno.totalGastado === 220000, uno.totalGastado);
  chk('el Equipo 2 suma solo lo suyo', dos.totalGastado === 300000, dos.totalGastado);

  chk('cada equipo usa SU presupuesto', uno.montoDiario === 200000 && dos.montoDiario === 500000,
      [uno.montoDiario, dos.montoDiario]);
  chk('el Equipo 1 se paso de su tope', uno.totalSugerido - uno.totalGastado < 0,
      uno.totalSugerido - uno.totalGastado);
  chk('y el Equipo 2 no', dos.totalSugerido - dos.totalGastado > 0,
      dos.totalSugerido - dos.totalGastado);

  // Lo que este cambio vino a evitar.
  chk('un equipo NO ve los gastos del otro',
      (uno.detalle || []).every(d => d.equipo !== 'equipo_2'), uno.detalle);

  // ─── La vista "todos" ───
  const todos = g.estadoPresupuesto_(HOY, HOY, '');
  chk('todos los equipos suman el gasto completo',
      todos.totalGastado === 520000, todos.totalGastado);
  // Comparar el gasto de dos equipos contra el tope de uno daria rojo siempre.
  chk('y el tope es la SUMA de los topes, no el de uno',
      todos.totalSugerido === 700000, todos.totalSugerido);
  chk('el desglose dice cuanto gasto cada equipo',
      todos.porEquipo.length === 2 &&
      todos.porEquipo[0].gastado === 220000 && todos.porEquipo[1].gastado === 300000,
      todos.porEquipo);

  // ─── Quien puede MIRAR que equipo ───
  //
  // Cualquiera que tenga Viaticos, no solo los administradores. Es
  // consecuencia de que el equipo se elija al registrar: quien acaba de cargar
  // un gasto al Equipo 2 tiene que poder ver el presupuesto del Equipo 2.
  const gE = montar(foto, 'estricto');
  require('vm').runInContext(
    'verificarIdToken_ = function (t) { return t ? { correo: String(t), nombre: String(t) } : null; };' +
    'subirArchivosASeccion_ = function () { return \'\'; };',
    gE.globales);

  const comoLaura = gE.globales.consultarPresupuesto_({ idToken: 'laura@energy-millennium.com' });
  chk('se le ofrece el selector de equipos', comoLaura.puedeElegirEquipo === true,
      comoLaura.puedeElegirEquipo);
  chk('SI puede mirar el del otro equipo',
      gE.globales.consultarPresupuesto_({ idToken: 'laura@energy-millennium.com', equipo: 'equipo_2' })
        .presupuesto.equipo === 'equipo_2',
      'no podria revisar el equipo al que le acaba de cargar un gasto');
  // Sin pedir nada se ve TODO, y la pantalla decide con que arrancar.
  chk('sin pedir equipo se ven todos', comoLaura.presupuesto.equipo === '',
      comoLaura.presupuesto.equipo);
  chk('y viene su equipo para preseleccionarlo', comoLaura.miEquipo === 'equipo_1',
      comoLaura.miEquipo);

  const comoAdmin = gE.globales.consultarPresupuesto_({ idToken: 'nathan@ylevigroup.com', equipo: 'equipo_2' });
  chk('un administrador tambien elige cualquiera',
      comoAdmin.presupuesto.equipo === 'equipo_2', comoAdmin.presupuesto.equipo);

  // El reparto de personas lleva los correos de todo el equipo: solo admins.
  chk('el reparto de personas solo le llega a un administrador',
      comoAdmin.personas.length === 3 && comoLaura.personas.length === 0,
      [comoAdmin.personas.length, comoLaura.personas.length]);
  chk('y dice en que equipo esta cada uno',
      comoAdmin.personas.filter(p => p.correo === 'didier@energy-millennium.com')[0].equipo === 'equipo_2',
      comoAdmin.personas);

  // ─── Mover a alguien de equipo: SOLO administradores ───
  let laura = () => gE.globales.usuarioPorCorreo_('laura@energy-millennium.com')['EQUIPO'];

  let negado = false;
  try {
    gE.globales.asignarEquipo_({ idToken: 'laura@energy-millennium.com',
                                 correo: 'laura@energy-millennium.com', equipo: 'equipo_2' });
  } catch (err) { negado = /SOLO_ADMIN/.test(err.message); }
  chk('un usuario NO se puede cambiar de equipo a si mismo', negado);
  chk('y su equipo quedo intacto', laura() === 'equipo_1', laura());

  const movida = gE.globales.asignarEquipo_({ idToken: 'nathan@ylevigroup.com',
                                              correo: 'laura@energy-millennium.com',
                                              equipo: 'equipo_2' });
  chk('un administrador SI la mueve', movida.status === 'success' && laura() === 'equipo_2',
      [movida.status, laura()]);
  chk('y el reparto actualizado vuelve en la misma respuesta',
      movida.personas.filter(p => p.correo === 'laura@energy-millennium.com')[0].equipo === 'equipo_2',
      movida.personas);

  // Lo que ya registro NO se reescribe: lo de ayer lo gasto con el equipo de
  // ayer, y reescribirlo haria que un reporte ya enviado deje de cuadrar.
  chk('mover a alguien NO le cambia el historial',
      gE.globales.estadoPresupuesto_(HOY, HOY, 'equipo_1').totalGastado === 220000,
      gE.globales.estadoPresupuesto_(HOY, HOY, 'equipo_1').totalGastado);

  chk('un equipo que no existe se rechaza',
      gE.globales.asignarEquipo_({ idToken: 'nathan@ylevigroup.com',
                                   correo: 'laura@energy-millennium.com',
                                   equipo: 'equipo_9' }).status === 'error');
  chk('vacio es valido: no todos pertenecen a un equipo',
      gE.globales.asignarEquipo_({ idToken: 'nathan@ylevigroup.com',
                                   correo: 'laura@energy-millennium.com',
                                   equipo: '' }).status === 'success' && laura() === '');

  // ─── El equipo del viatico: lo elige quien registra ───
  const ENC2 = ENC;
  const colE = ENC2.indexOf('EQUIPO');
  const ultima = g2 => {
    const v = g2.SpreadsheetApp.getActiveSpreadsheet()
               .getSheetByName('Viaticos').getDataRange().getValues();
    return v[v.length - 1];
  };
  const registrar = (g2, id, equipo) => {
    const cuerpo = {
      idToken: 'laura@energy-millennium.com', tipo_factura: 'viaticos',
      empresa: 'BLAZAR ENERGY', monto: '1000', nombre_pago: 'x', proveedor: 'y',
      fecha_pago: '2026-10-15', fecha_envio: id, rubro: 'almuerzo', archivos: []
    };
    if (equipo !== undefined) cuerpo.equipo = equipo;
    g2.registrarPago_(cuerpo);
    return ultima(g2);
  };

  const gR = montar(JSON.parse(JSON.stringify(foto)), 'estricto');
  require('vm').runInContext(
    'verificarIdToken_ = function (t) { return t ? { correo: String(t), nombre: String(t) } : null; };' +
    'subirArchivosASeccion_ = function () { return \'\'; };' +
    'avisarSiCruzaPresupuesto_ = function () {};',
    gR.globales);

  // 19/10: el equipo volvio a salir de la SESION. El navegador no lo decide,
  // igual que con "Registrado por". Aunque el formulario ya no lo mande,
  // cualquiera puede llamar a esta URL directamente.
  chk('se guarda el equipo de la CUENTA, no el que mande el navegador',
      registrar(gR.globales, 'op-eq-1', 'equipo_2')[colE] === 'equipo_1',
      registrar(gR.globales, 'op-eq-1', 'equipo_2')[colE]);
  chk('sin que el navegador mande nada, igual sale el de su cuenta',
      registrar(gR.globales, 'op-eq-2')[colE] === 'equipo_1',
      registrar(gR.globales, 'op-eq-2')[colE]);
  chk('un equipo inventado tampoco lo cambia',
      registrar(gR.globales, 'op-eq-3', 'equipo_9')[colE] === 'equipo_1',
      registrar(gR.globales, 'op-eq-3', 'equipo_9')[colE]);

  // Un pago que no es viatico nunca lleva equipo, aunque lo manden.
  gR.globales.registrarPago_({
    idToken: 'nathan@ylevigroup.com', tipo_factura: 'caja_menor',
    empresa: 'BLAZAR ENERGY', monto: '1000', nombre_pago: 'x', proveedor: 'y',
    fecha_pago: '2026-10-15', fecha_envio: 'op-eq-4', archivos: [], equipo: 'equipo_2'
  });
  const cajaV = gR.globales.SpreadsheetApp.getActiveSpreadsheet()
                  .getSheetByName('Caja Menor').getDataRange().getValues();
  chk('un pago que no es viatico no lleva equipo',
      (cajaV[cajaV.length - 1] || [])[colE] === '',
      (cajaV[cajaV.length - 1] || [])[colE]);

  // ─── El aviso y el panel tienen que contar LO MISMO ───
  const fuente = require('fs').readFileSync(RUTA, 'utf8').replace(/\r\n/g, '\n');
  chk('EQUIPO es columna de todas las hojas de pago',
      /'EQUIPO'\s*\n\];/.test(fuente.split('const ENCABEZADOS_PAGOS = [')[1].split('];')[0] + "'EQUIPO'\n];"),
      'faltaria en alguna hoja y el PDF saldria con celdas undefined');

  const reg = fuente.split('function registrarPago_')[1].split('\n}\n')[0];
  chk('el equipo de la fila y el del aviso salen del MISMO calculo',
      /const equipoDelViatico = /.test(reg) &&
      /'EQUIPO':\s*equipoDelViatico/.test(reg) &&
      /avisarSiCruzaPresupuesto_\([\s\S]*?equipoDelViatico\)/.test(reg),
      'el aviso compararia contra un equipo distinto del que quedo guardado');

  const av = fuente.split('function avisarSiCruzaPresupuesto_')[1].split('\n}\n')[0];
  chk('el aviso por correo es de UN equipo',
      /presupuestoDiarioVigente_\(eq\)/.test(av) && /gastoViaticosPorRubro_\(dia, dia, eq\)/.test(av),
      'compararia contra el tope equivocado');
  chk('y el asunto dice cual',
      /etiquetaDeEquipo_\(eq\) \+ ' · viáticos del '/.test(av),
      'llegaria un aviso sin decir de que equipo');
  // Antes se devolvia temprano sin equipo: el panel mostraba el gasto en el
  // Equipo 1 y el aviso no salia nunca.
  chk('un viatico sin equipo se resuelve igual que en el panel',
      /const eq = equipoDeLaFila_\(equipo\);/.test(av) && !/equipoValido_\(eq\)\) return;/.test(av),
      av.slice(0, 200));

  // ─── Un solo armador de contexto ───
  //
  // Existia dos veces y se desincronizaron: arranque_ no copio `equipo`
  // cuando se agrego, asi que la app recibia undefined y no podia
  // preseleccionar el equipo de la persona. Sin fallar ni avisar.
  const arr = fuente.split('function arranque_')[1].split('\n}\n')[0];
  chk('arranque_ no arma su propio contexto',
      /contextoDeUsuario_\(/.test(arr) && !/autenticado: true,/.test(arr),
      'volveria a desincronizarse en el proximo campo que se agregue');
  chk('y manda el equipo de la persona a la pantalla',
      gE.globales.arranque_({ idToken: 'didier@energy-millennium.com' })
        .sesion.equipo === 'equipo_2',
      gE.globales.arranque_({ idToken: 'didier@energy-millennium.com' }).sesion.equipo);
  chk('junto con la lista de equipos, para armar el desplegable',
      (gE.globales.arranque_({ idToken: 'didier@energy-millennium.com' }).equipos || [])
        .map(x => x.clave).join(',') === 'equipo_1,equipo_2',
      gE.globales.arranque_({ idToken: 'didier@energy-millennium.com' }).equipos);
}

console.log('\n=== El aviso de que la app no responde ===');
{
  // El 17/10 Hostinger reinicio el VPS y la app quedo caida toda la noche.
  // Nadie se entero hasta que avisaron los usuarios.
  //
  // El correo lo manda ESTO, que corre en Google, porque el vigilante vive en
  // el servidor y ahi no hay —ni debe haber— credenciales de Google.
  const foto = {
    'PAGOS REGISTRADOS': [ENC_PAGOS],
    'SALDOS':    [['FECHA', 'CUENTA', 'SALDO BASE', 'CONCEPTO', 'REGISTRADO POR']],
    'TRASLADOS': [['FECHA', 'ORIGEN', 'DESTINO', 'MONTO', 'REGISTRADO POR', 'NOTA',
                   'URL COMPROBANTE', 'FECHA REGISTRO', 'REALIZADO POR']],
    'PRESUPUESTO': [['FECHA', 'MONTO DIARIO', 'REGISTRADO POR', 'NOTA', 'EQUIPO']],
    'USUARIOS': [['CORREO', 'NOMBRE', 'TELEFONO', 'ROL', 'SECCIONES', 'ESTADO',
                  'FECHA REGISTRO', 'ULTIMO ACCESO', 'EQUIPO']],
    'SESIONES': [['HASH', 'CORREO', 'CREADA', 'ULTIMO USO', 'VENCE']],
    'SOLICITUDES DE APROBACION': [['ID SOLICITUD']]
  };
  const e = montar(foto, 'estricto');
  const g = e.globales;

  // Sin clave configurada no manda nada, y lo DICE: un vigilante que falla en
  // silencio es peor que no tenerlo, porque se cree que esta cuidando.
  const sinClave = g.avisarCaida_({ clave: 'lo-que-sea' });
  chk('sin clave configurada no manda correo', sinClave.status === 'error', sinClave);
  chk('y explica que hay que generarla', /generarClaveDeVigilancia/.test(sinClave.message), sinClave.message);
  chk('no se envio nada', e.correos().length === 0, e.correos().length);

  // La clave se GENERA, no se escribe en el codigo: el repositorio es publico.
  const texto = g.generarClaveDeVigilancia();
  const clave = g.PropertiesService.getScriptProperties().getProperty('CLAVE_VIGILANCIA');
  chk('la clave se genera y se guarda', !!clave && clave.length >= 32, clave && clave.length);
  chk('y no queda escrita en el codigo fuente',
      require('fs').readFileSync(RUTA, 'utf8').indexOf(clave) === -1,
      'la clave quedaria en el repositorio, que es publico');
  chk('se muestra una vez para copiarla al servidor', texto.indexOf(clave) !== -1);

  // Esta URL es publica: sin la clave correcta, nada.
  let negado = false;
  try { g.avisarCaida_({ clave: 'incorrecta' }); } catch (err) { negado = /SOLO_ADMIN/.test(err.message); }
  chk('con la clave equivocada se rechaza', negado);
  chk('sigue sin enviarse nada', e.correos().length === 0, e.correos().length);

  // El aviso real.
  const r1 = g.avisarCaida_({ clave: clave, detalle: 'HTTP 502 en /salud' });
  chk('con la clave correcta avisa', r1.status === 'success' && e.correos().length === 1, r1);
  const c1 = e.correos()[0];
  chk('el asunto dice que NO responde', /NO responde/.test(c1.subject), c1.subject);
  chk('y el detalle del vigilante viaja en el cuerpo', /HTTP 502 en \/salud/.test(c1.body), c1.body);

  // JAMAS a una direccion que mande quien llama: seria un rele de spam con la
  // reputacion de esta cuenta de Google.
  const r2 = g.avisarCaida_({ clave: clave, estado: 'recuperada', to: 'atacante@ejemplo.com' });
  // DESTINATARIOS es un `const` del archivo: no queda como propiedad del
  // contexto, hay que evaluarlo adentro.
  const DEST = require('vm').runInContext("DESTINATARIOS.join(',')", g);
  chk('el correo va SIEMPRE a los administradores',
      e.correos().length > 0 && e.correos().every(function (m) { return m.to === DEST; }),
      e.correos().map(function (m) { return m.to; }));
  chk('nunca a la direccion que mande quien llama',
      e.correos().every(function (m) { return m.to.indexOf('atacante') === -1; }));

  // El aviso de que volvio cierra la historia: nunca se frena.
  chk('el aviso de recuperada si sale', r2.status === 'success' && e.correos().length === 2, r2);
  chk('y lo dice en el asunto', /volvió a funcionar/.test(e.correos()[1].subject), e.correos()[1].subject);

  // 288 correos por dia no se leen: se filtran.
  g.avisarCaida_({ clave: clave, detalle: 'otra vez' });
  const antes = e.correos().length;
  const frenado = g.avisarCaida_({ clave: clave, detalle: 'y otra' });
  chk('dos caidas seguidas no mandan dos correos',
      frenado.omitido === true && e.correos().length === antes, e.correos().length);

  // Lo que viene de afuera se recorta y va sin HTML: si la clave se filtrara,
  // lo peor posible es un texto corto y feo, no una pagina falsa.
  const cache = g.CacheService.getScriptCache();
  cache.remove('aviso_caida');
  g.avisarCaida_({ clave: clave, detalle: '<b>ojo</b>' + 'x'.repeat(900) });
  const ultimo = e.correos()[e.correos().length - 1];
  chk('el detalle de afuera va sin etiquetas HTML', ultimo.body.indexOf('<b>') === -1);
  chk('y recortado', ultimo.body.indexOf('x'.repeat(400)) === -1, 'entraria texto sin limite');
  chk('el correo es TEXTO PLANO, sin htmlBody', ultimo.htmlBody === undefined, Object.keys(ultimo));
}

console.log('\n' + (fallos ? 'FALLARON ' + fallos + ' comprobaciones' : 'TODAS LAS COMPROBACIONES PASARON'));
process.exit(fallos ? 1 : 0);
