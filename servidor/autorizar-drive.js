// Pide UNA sola vez permiso para que el servidor suba archivos a Drive
// en nombre tuyo, y guarda esa autorización para siempre.
//
// Uso:
//   cd servidor
//   node autorizar-drive.js
//
// ─── Por qué hace falta ───────────────────────────────────────────────────
//
// Google ya no permite que una cuenta de servicio sea dueña de archivos en un
// Drive personal ("Service Accounts do not have storage quota"). La salida es
// que el servidor actúe EN NOMBRE de una persona: los comprobantes siguen
// quedando en las mismas carpetas, con el mismo dueño que hoy.
//
// Esto NO necesita un administrador: cada quien puede autorizar el acceso a su
// propio Drive.
//
// ─── Qué genera ───────────────────────────────────────────────────────────
//
// Un "refresh token": un permiso duradero que el servidor canjea por accesos
// cortos cuando los necesita. No vence mientras no se revoque, porque la
// aplicación está publicada como "In production" (en modo "Testing" venceria
// a los 7 días — se verificó antes de elegir este camino).
//
// ⚠️ Ese permiso vale tanto como tu contraseña de Drive. Queda en
// `token-drive.json`, que .gitignore ya bloquea, y después va a EasyPanel
// como variable de entorno.

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { google } = require('googleapis');

const RAIZ  = path.join(__dirname, '..');
const CLIENTE = path.join(RAIZ, 'oauth-drive.json');
const DESTINO = path.join(RAIZ, 'token-drive.json');

// Solo lo que el sistema necesita, y nada mas: subir comprobantes a Drive y
// enviar los avisos de aprobacion. `gmail.send` SOLO permite enviar — no da
// acceso a leer la bandeja de entrada. Si algun dia este permiso se filtra,
// que sirva para lo menos posible.
const PERMISOS = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/gmail.send'
];

function config() {
  if (!fs.existsSync(CLIENTE)) {
    throw new Error('Falta ' + CLIENTE + '. Es el archivo que se descarga al crear el cliente OAuth.');
  }
  const d = JSON.parse(fs.readFileSync(CLIENTE, 'utf8'));
  const c = d.installed || d.web;
  if (!c || !c.client_id || !c.client_secret) {
    throw new Error('El archivo del cliente OAuth no tiene client_id y client_secret.');
  }
  return c;
}

async function main() {
  const c = config();

  // Un servidor mínimo y momentáneo: Google devuelve el permiso a esta
  // dirección de tu propia computadora. Se apaga apenas termina.
  const servidor = http.createServer();
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  const puerto = servidor.address().port;
  const retorno = 'http://127.0.0.1:' + puerto;

  const oAuth = new google.auth.OAuth2(c.client_id, c.client_secret, retorno);

  const url = oAuth.generateAuthUrl({
    access_type: 'offline',        // sin esto NO se entrega el permiso duradero
    prompt: 'consent',             // fuerza a que lo entregue aunque ya hubiera autorizado antes
    scope: PERMISOS
  });

  console.log('');
  console.log('─────────────────────────────────────────────────────────────');
  console.log(' ABRÍ ESTA DIRECCIÓN EN TU NAVEGADOR:');
  console.log('');
  console.log(' ' + url);
  console.log('');
  console.log(' Entrá con la cuenta DUEÑA de las carpetas de comprobantes.');
  console.log(' Se van a pedir DOS permisos: Drive y envío de correo.');
  console.log(' Google va a avisar que la app no está verificada: es normal,');
  console.log(' es tuya. Elegí "Configuración avanzada" → "Ir a ... (no seguro)".');
  console.log('─────────────────────────────────────────────────────────────');
  console.log('');
  console.log('Esperando la autorización...');

  const codigo = await new Promise((resolve, reject) => {
    const limite = setTimeout(() => reject(new Error('Pasaron 5 minutos sin autorización.')), 300000);
    servidor.on('request', (req, res) => {
      const u = new URL(req.url, retorno);
      const cod = u.searchParams.get('code');
      const err = u.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body style="font-family:system-ui;padding:40px">' +
              (cod ? '<h2>Listo</h2><p>Ya podés cerrar esta pestaña y volver a la terminal.</p>'
                   : '<h2>No se autorizó</h2><p>' + (err || 'sin detalle') + '</p>') +
              '</body></html>');
      clearTimeout(limite);
      cod ? resolve(cod) : reject(new Error('Google devolvió: ' + (err || 'sin código')));
    });
  });

  servidor.close();

  const { tokens } = await oAuth.getToken(codigo);
  if (!tokens.refresh_token) {
    throw new Error(
      'Google no entregó el permiso duradero. Suele pasar si ya habías autorizado ' +
      'antes: entrá a https://myaccount.google.com/permissions, quitá el acceso de ' +
      'esta app y volvé a correr este programa.'
    );
  }

  fs.writeFileSync(DESTINO, JSON.stringify({
    client_id:     c.client_id,
    client_secret: c.client_secret,
    refresh_token: tokens.refresh_token
  }, null, 2));

  // Se comprueba que el permiso SIRVA, no solo que exista.
  oAuth.setCredentials(tokens);
  const drive = google.drive({ version: 'v3', auth: oAuth });
  const yo = await drive.about.get({ fields: 'user(emailAddress),storageQuota(limit,usage)' });

  console.log('');
  console.log('AUTORIZACIÓN GUARDADA en token-drive.json');
  console.log('  actuará como : ' + yo.data.user.emailAddress);
  console.log('  espacio      : ' + (yo.data.storageQuota && yo.data.storageQuota.limit
    ? Math.round(Number(yo.data.storageQuota.usage) / 1e9 * 10) / 10 + ' GB usados de ' +
      Math.round(Number(yo.data.storageQuota.limit) / 1e9) + ' GB'
    : '(sin límite)'));
  console.log('');
  console.log('Este archivo NO se sube al repositorio. El siguiente paso es');
  console.log('pasarlo a EasyPanel como variable de entorno.');
}

main().catch(err => {
  console.error('');
  console.error('FALLÓ: ' + err.message);
  process.exit(1);
});
