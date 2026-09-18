process.env.GOOGLE_CREDENCIALES_ARCHIVO = process.env.GOOGLE_CREDENCIALES_ARCHIVO || '../credenciales.json';
const { google } = require('googleapis');
const { credenciales } = require('./src/credenciales');
const ID = process.argv[2];

(async () => {
  const auth = new google.auth.GoogleAuth({ credentials: credenciales(), scopes: ['https://www.googleapis.com/auth/drive'] });
  const drive = google.drive({ version: 'v3', auth: await auth.getClient() });

  const m = await drive.files.get({ fileId: ID, fields: 'id,name,mimeType,capabilities(canAddChildren,canEdit)', supportsAllDrives: true });
  console.log('Carpeta madre:', m.data.name);
  console.log('  es carpeta        :', m.data.mimeType === 'application/vnd.google-apps.folder');
  console.log('  puede crear dentro:', !!(m.data.capabilities && m.data.capabilities.canAddChildren));

  const hijos = await drive.files.list({
    q: "'" + ID + "' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false",
    fields: 'files(id,name)', pageSize: 50, supportsAllDrives: true, includeItemsFromAllDrives: true
  });
  const nombres = (hijos.data.files || []).map(f => f.name);
  console.log('\nSubcarpetas visibles (' + nombres.length + '):');
  nombres.forEach(n => console.log('  · ' + n));

  // Lo que de verdad importa: que las carpetas que busca la logica existan.
  const esperadas = ['PJ04 FACTURAS','PJ04 VIATICOS','PJ04 CAJA MENOR','PJ04 IMPUESTOS',
                     'PJ04 SEGURIDAD SOCIAL','PJ04 NOMINA','PJ04 COMPRA MATERIALES','PJ04 TRASLADOS'];
  console.log('\nCarpetas que la logica va a buscar:');
  esperadas.forEach(e => console.log('  ' + (nombres.indexOf(e) !== -1 ? 'OK  ' : 'NO  ') + e));
})().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
