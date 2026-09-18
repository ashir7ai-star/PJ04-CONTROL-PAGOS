// Pruebas del armado de correos.
// Uso: node prueba-correo.js
//
// Un error aca no da error: el correo LLEGA, pero ilegible. Por eso se
// verifica el formato exacto del mensaje, no que la funcion "corra".

const { construirMensaje, asuntoCodificado } = require('./src/correo');

let fallos = 0;
function chk(nombre, cond, detalle) {
  console.log((cond ? '  ok   ' : '  FALLA') + '  ' + nombre +
              (cond ? '' : '  → ' + JSON.stringify(detalle)));
  if (!cond) fallos++;
}

const trozo = (m, patron) => (m.match(patron) || [''])[0];
const cuerpoDe = (m, tipo) => {
  // Extrae y decodifica la parte del tipo pedido.
  const partes = m.split(/--lim_[a-z0-9]+/);
  const p = partes.filter(x => x.indexOf('Content-Type: ' + tipo) !== -1)[0] || '';
  const base64 = p.split('\r\n\r\n')[1] || '';
  return Buffer.from(base64.trim(), 'base64').toString('utf8');
};

console.log('\n=== Asuntos con tildes y enies ===');
{
  // Sin codificar, "Aprobacion" con tilde llega como "AprobaciÃ³n".
  chk('un asunto sin tildes va tal cual', asuntoCodificado('Nueva solicitud') === 'Nueva solicitud');
  const con = asuntoCodificado('Aprobación de pago — $119.900');
  chk('uno con tildes se codifica', con.indexOf('=?UTF-8?B?') === 0, con);
  chk('y se puede decodificar de vuelta',
      Buffer.from(con.replace('=?UTF-8?B?','').replace('?=',''), 'base64').toString('utf8')
        === 'Aprobación de pago — $119.900');
}

console.log('\n=== Mensaje solo de texto ===');
{
  const m = construirMensaje({ to: 'a@b.com', subject: 'Hola', body: 'Cuerpo con ñ y tildes áéí' });
  chk('lleva el destinatario', m.indexOf('To: a@b.com') !== -1);
  chk('lleva el asunto',       m.indexOf('Subject: Hola') !== -1);
  chk('declara UTF-8',         m.indexOf('charset="UTF-8"') !== -1);
  const texto = Buffer.from(m.split('\r\n\r\n')[1], 'base64').toString('utf8');
  chk('el cuerpo conserva las tildes', texto === 'Cuerpo con ñ y tildes áéí', texto);
}

console.log('\n=== Mensaje con HTML: van las DOS versiones ===');
{
  // Apps Script mandaba texto y HTML. Un lector que no soporte HTML tiene que
  // poder leer el mensaje igual.
  const m = construirMensaje({
    to: 'admin@x.com, otro@x.com',
    subject: 'Solicitud de aprobación',
    body: 'Versión en texto plano',
    htmlBody: '<p>Versión en <b>HTML</b></p>'
  });

  chk('es multipart/alternative', m.indexOf('multipart/alternative') !== -1);
  chk('acepta varios destinatarios', m.indexOf('To: admin@x.com, otro@x.com') !== -1);
  chk('incluye la parte de texto', cuerpoDe(m, 'text/plain') === 'Versión en texto plano', cuerpoDe(m, 'text/plain'));
  chk('incluye la parte HTML',     cuerpoDe(m, 'text/html') === '<p>Versión en <b>HTML</b></p>', cuerpoDe(m, 'text/html'));

  // El limite tiene que cerrar con dos guiones al final, o el correo queda
  // "abierto" y algunos clientes muestran basura.
  chk('el mensaje cierra correctamente', /--lim_[a-z0-9]+--$/.test(m.trim()), m.slice(-40));

  // Y el limite no puede aparecer dentro del contenido, o cortaria el mensaje.
  const limite = trozo(m, /lim_[a-z0-9]+/);
  chk('el separador no aparece dentro del contenido',
      cuerpoDe(m, 'text/html').indexOf(limite) === -1);
}

console.log('\n=== Lo que NO se debe aceptar ===');
{
  const { enviar } = require('./src/correo');
  enviar({ subject: 'x', body: 'y' })
    .then(() => { chk('un correo sin destinatario se rechaza', false, 'no fallo'); terminar(); })
    .catch(err => {
      chk('un correo sin destinatario se rechaza', /destinatario/i.test(err.message), err.message);
      terminar();
    });
}

function terminar() {
  console.log('\n' + (fallos ? 'FALLARON ' + fallos + ' comprobaciones' : 'TODAS LAS COMPROBACIONES PASARON'));
  process.exit(fallos ? 1 : 0);
}
