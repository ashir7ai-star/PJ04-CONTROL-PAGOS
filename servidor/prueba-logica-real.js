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
  let codigo = fs.readFileSync(RUTA, 'utf8');

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
    require('path').join(__dirname, '..', 'index.html'), 'utf8');
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
  const codigo = require('fs').readFileSync(RUTA, 'utf8')
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
  chk('y dice de donde vino', entra && /AMPAC/.test(entra.texto), entra && entra.texto);
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
  // Lo registrado hoy con fecha de pago de ayer SI cuenta hoy: es lo que la
  // persona ve en la lista, y el panel tiene que coincidir con eso.
  chk('un pago registrado hoy con fecha de ayer cuenta HOY',
      de('cena').gastado === 281000, de('cena').gastado);
  chk('y el total coincide con lo registrado hoy',
      est.totalGastado === 406000, est.totalGastado);

  // Los rubros ya no tienen tope propio: se informa cuanto PESA cada uno.
  chk('cada rubro informa su participacion',
      de('cena').participacion === Math.round(281000 / 406000 * 100), de('cena').participacion);
  chk('un rubro ya NO trae presupuesto propio', de('cena').sugerido === undefined, de('cena'));
  chk('ni marca excedido por su cuenta', de('cena').excedido === undefined, de('cena'));

  chk('lo que no tiene rubro se informa aparte', est.sinRubro === 30000, est.sinRubro);
  chk('Compra Materiales NO entra', est.totalGastado === 406000, est.totalGastado);

  const ayer = e.globales.estadoPresupuesto_(dia(27), dia(27));
  chk('otro dia cuenta lo REGISTRADO ese dia',
      ayer.rubros.filter(r => r.clave === 'cena')[0].gastado === 200000, ayer.totalGastado);

  // Validaciones del monto.
  chk('un monto que no es numero se rechaza',
      e.globales.ajustarPresupuesto_({ monto: 'abc' }).status === 'error');
  chk('y cero tampoco vale: no significa "sin limite"',
      e.globales.ajustarPresupuesto_({ monto: '0' }).status === 'error');
  chk('un monto vacio se rechaza',
      e.globales.ajustarPresupuesto_({ monto: '' }).status === 'error');
  const ok = e.globales.ajustarPresupuesto_({ monto: '700000' });
  chk('un monto valido se guarda',
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
      /Viáticos/.test(String(require('fs').readFileSync(RUTA, 'utf8')
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
  const fuente = require('fs').readFileSync(RUTA, 'utf8');

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
  chk('mide el mismo dia que el panel: el de registro',
      /const dia = new Date\(\);/.test(av), 'sigue mirando la fecha de pago');
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
  const fuente = require('fs').readFileSync(RUTA, 'utf8');
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
    require('path').join(__dirname, '..', 'index.html'), 'utf8');
  const campo = html.split('id="registradoPor"')[1].slice(0, 260);

  chk('el campo es de solo lectura', /readonly/.test(campo), campo.slice(0, 90));
  chk('y no se puede llegar a el con el tabulador', /tabindex="-1"/.test(campo), campo.slice(0, 90));
  chk('ya no se pide como campo a completar',
      !/const required = \[[^\]]*'registradoPor'/.test(html),
      'seguiria pidiendo completar un campo que no se puede tocar');
  // Ojo con como se comprueba esto: buscar solo "campoQuien.value = quienSoy"
  // NO sirve, porque ese texto sigue estando aunque se le ponga un `if` que lo
  // condicione. Se exige la forma incondicional Y la ausencia del guardia.
  chk('se pisa SIEMPRE con la sesion, no solo si esta vacio',
      /if \(campoQuien\) campoQuien\.value = quienSoy;/.test(html) &&
      !/campoQuien[^;]*\.value\.trim\(\)/.test(html),
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

console.log('\n' + (fallos ? 'FALLARON ' + fallos + ' comprobaciones' : 'TODAS LAS COMPROBACIONES PASARON'));
process.exit(fallos ? 1 : 0);
