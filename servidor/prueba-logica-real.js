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
function montar(foto, modoLogin) {
  // La foto pasa por la MISMA conversion que en produccion.
  const e = crearEntorno(convertirFoto(foto, 'America/Bogota'), { sinDrive: true });
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
      [serie(2026, 9, 15, 8, 0), 'viaticos',     500000, 'base', 'admin']],
    'TRASLADOS': [['FECHA', 'ORIGEN', 'DESTINO', 'MONTO', 'REGISTRADO POR', 'NOTA', 'URL COMPROBANTE', 'FECHA REGISTRO', 'REALIZADO POR']],
    'USUARIOS':  [['CORREO', 'NOMBRE', 'TELEFONO', 'ROL', 'SECCIONES', 'ESTADO', 'FECHA REGISTRO', 'ULTIMO ACCESO']],
    'SESIONES':  [['HASH', 'CORREO', 'CREADA', 'ULTIMO USO', 'VENCE']],
    'SOLICITUDES DE APROBACION': [['ID SOLICITUD']]
  }, 'off');

  const r = e.globales.consultarSaldos_({ rol: 'admin', secciones: [] }, true);
  const de = (c) => r.cuentas.filter(x => x.clave === c)[0];

  chk('responde con exito', r.status === 'success', r.status);
  chk('banco AMPAC: 1.000.000 - 300.000', de('banco_ampac').saldo === 700000, de('banco_ampac').saldo);
  chk('Viaticos descuenta viatico Y materiales: 500.000 - 150.000',
      de('viaticos').saldo === 350000, de('viaticos').saldo);
  chk('ningun pago queda sin bolsa', r.sinCuenta === 0, r.sinCuenta);
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

console.log('\n' + (fallos ? 'FALLARON ' + fallos + ' comprobaciones' : 'TODAS LAS COMPROBACIONES PASARON'));
process.exit(fallos ? 1 : 0);
