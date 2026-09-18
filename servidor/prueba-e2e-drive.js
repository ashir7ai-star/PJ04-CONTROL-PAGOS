process.env.GOOGLE_CREDENCIALES_ARCHIVO = '../credenciales.json';
process.env.DRIVE_CARPETA_MADRE = '1E8M52g8IfEAdzYYpeXqLsMX2nDlw7OCO';
process.env.SHEETS_ID = '1z8qd3qfU0k2y07xddtu-3-kFVe9EnOU8ZT7mDEjf1e8';

const fs = require('fs'), vm = require('vm'), path = require('path');
const { crearEntorno } = require('./src/entorno');
const { convertirFoto } = require('./src/fechas-sheets');
const { detener } = require('./src/puente-sincrono');

const ENC = ['FECHA REGISTRO','EMPRESA','TIPO FACTURA','REGISTRADO POR','NOMBRE DE PAGO',
             'PROVEEDOR','FECHA DE PAGO','VALOR FACTURA','NOTAS','URL ARCHIVO','ID REGISTRO'];

const foto = {
  'PAGOS REGISTRADOS': [ENC], 'Viaticos': [ENC],
  'SALDOS':   [['FECHA','CUENTA','SALDO BASE','CONCEPTO','REGISTRADO POR']],
  'TRASLADOS':[['FECHA','ORIGEN','DESTINO','MONTO','REGISTRADO POR','NOTA','URL COMPROBANTE']],
  'USUARIOS': [['CORREO','NOMBRE','TELEFONO','ROL','SECCIONES','ESTADO','FECHA REGISTRO','ULTIMO ACCESO']],
  'SESIONES': [['HASH','CORREO','CREADA','ULTIMO USO','VENCE']],
  'SOLICITUDES DE APROBACION': [['ID SOLICITUD']]
};

const e = crearEntorno(convertirFoto(foto, 'America/Bogota'), {});
let codigo = fs.readFileSync(path.join(__dirname,'..','apps-script.gs'),'utf8')
  .replace(/^const MODO_LOGIN = '[a-z]+';$/m, "const MODO_LOGIN = 'off';");
vm.createContext(e.globales);
vm.runInContext(codigo, e.globales);

const contenido = Buffer.from('PRUEBA DE MIGRACION - borrar\n' + new Date().toISOString());

console.log('Registrando un pago CON comprobante adjunto...\n');
const r = e.globales.registrarPago_({
  tipo_factura: 'viaticos', empresa: 'AMPAC SAS', monto: '1',
  nombre_pago: 'PRUEBA MIGRACION - BORRAR', proveedor: 'prueba',
  fecha_pago: '2026-09-18', fecha_envio: 'prueba-' + Date.now(),
  archivos: [{ nombre: 'PRUEBA-MIGRACION-BORRAR.txt', tipo: 'text/plain',
               datos: contenido.toString('base64') }]
});

console.log('resultado:', r.status, r.seccion || '');
const fila = e.datos()['Viaticos'][1];
const url = fila[ENC.indexOf('URL ARCHIVO')];
console.log('URL guardada en la hoja:', url);
console.log('(la hoja real NO se toca: esto es una foto en memoria)\n');

// Verificar en Drive donde quedo y si es visible con el enlace.
const { google } = require('googleapis');
const { credenciales } = require('./src/credenciales');
(async () => {
  const auth = new google.auth.GoogleAuth({ credentials: credenciales(), scopes:['https://www.googleapis.com/auth/drive'] });
  const drive = google.drive({ version:'v3', auth: await auth.getClient() });
  const id = (String(url).match(/\/d\/([^\/]+)/) || String(url).match(/id=([^&]+)/) || [])[1];
  if (!id) { console.log('No se pudo extraer el id de la URL'); return; }

  const f = await drive.files.get({ fileId: id, fields:'id,name,parents,size', supportsAllDrives:true });
  const madre = await drive.files.get({ fileId: f.data.parents[0], fields:'name', supportsAllDrives:true });
  const permisos = await drive.permissions.list({ fileId: id, fields:'permissions(type,role)', supportsAllDrives:true });

  console.log('EN DRIVE:');
  console.log('  archivo        :', f.data.name, '(' + f.data.size + ' bytes)');
  console.log('  carpeta destino:', madre.data.name);
  console.log('  visible con el enlace:',
    (permisos.data.permissions||[]).some(p => p.type === 'anyone' && p.role === 'reader'));

  await drive.files.delete({ fileId: id, supportsAllDrives: true });
  console.log('\n  archivo de prueba BORRADO de tu Drive');
  detener();
})().catch(e => { console.error('FALLO:', e.message); detener(); process.exit(1); });
