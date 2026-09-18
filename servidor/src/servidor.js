// El servidor HTTP de pj04-pagos-api.
//
// Mantiene EXACTAMENTE el mismo contrato que el Web App de Apps Script: un
// POST con `{ "action": "...", ... }` y una respuesta JSON. Por eso el
// `index.html` solo cambia una constante — y se puede volver atrás al instante
// si algo sale mal.
//
// ─── Lo que cambia respecto de Apps Script ────────────────────────────────
//
// Apps Script entregaba la respuesta de un POST en DOS saltos (302 a
// googleusercontent). Medido: el segundo salto varió entre 0,6 s y 32 s con la
// misma petición. Acá la respuesta vuelve directa, en un solo salto.

const http = require('http');
const fs   = require('fs');
const vm   = require('vm');
const path = require('path');

const { nombresDeHojas, leerHojas } = require('./hojas');
const { convertirFoto } = require('./fechas-sheets');
const { crearEntorno }  = require('./entorno');

const PUERTO = Number(process.env.PORT || 8080);
const ZONA   = process.env.ZONA_HORARIA || 'America/Bogota';

// Orígenes a los que se les permite llamar. El navegador exige que el servidor
// lo autorice explícitamente; un '*' funcionaría igual pero dejaría la API
// abierta a cualquier página que quisiera usarla desde el navegador de un
// usuario que ya tiene sesión.
const ORIGENES = (process.env.ORIGENES_PERMITIDOS ||
  'https://ashir7ai-star.github.io,http://localhost:8000,http://127.0.0.1:8000'
).split(',').map(o => o.trim()).filter(Boolean);

// Acciones que ESCRIBEN. Se las trata distinto: nunca leen de la foto guardada
// —tienen que decidir sobre el estado real— y la invalidan al terminar.
const ACCIONES_QUE_ESCRIBEN = [
  'registrar_pago', 'solicitar_aprobacion', 'decidir_solicitud', 'registrar_traslado',
  'ajustar_saldo', 'guardar_usuario', 'registrar_usuario', 'iniciar_sesion',
  'cerrar_sesion', 'arranque'   // arranque escribe ULTIMO ACCESO y puede crear la sesión
];

// ─── La foto de las hojas ─────────────────────────────────────────────────
//
// Traerla cuesta ~600 ms (medido: las 12 hojas en UNA llamada). Guardarla unos
// segundos hace que varias consultas seguidas no la vuelvan a pedir.
//
// El riesgo de una foto vieja es real, así que se acota por los dos lados: vive
// muy poco, y cualquier acción que escriba la tira y vuelve a leer. Lo único
// que puede quedar desactualizado unos segundos es una edición hecha a mano
// directamente sobre la hoja.
const SEGUNDOS_FOTO = Number(process.env.SEGUNDOS_FOTO || 15);
let fotoCache = null;

function olvidarFoto() { fotoCache = null; }

async function traerFoto(forzar) {
  if (!forzar && fotoCache && fotoCache.vence > Date.now()) {
    return { foto: fotoCache.foto, deCache: true, ms: 0 };
  }
  const a = Date.now();
  const nombres = await nombresDeHojas(false);
  const crudo   = await leerHojas(nombres, false);
  const foto    = convertirFoto(crudo, ZONA);
  const ms      = Date.now() - a;

  fotoCache = { foto: foto, vence: Date.now() + SEGUNDOS_FOTO * 1000 };
  return { foto, deCache: false, ms };
}

// ─── La lógica de negocio ─────────────────────────────────────────────────
//
// Se lee UNA vez al arrancar. El contexto, en cambio, se crea por petición:
// `apps-script.gs` usa variables globales (el memo de hojas, por ejemplo) y
// compartirlas entre peticiones mezclaría los datos de dos usuarios.
const RUTA_LOGICA = process.env.RUTA_LOGICA || path.join(__dirname, '..', '..', 'apps-script.gs');
const CODIGO_LOGICA = fs.readFileSync(RUTA_LOGICA, 'utf8');

function ejecutar(foto, cuerpo) {
  const e = crearEntorno(foto, { zona: ZONA });
  vm.createContext(e.globales);
  vm.runInContext(CODIGO_LOGICA, e.globales);

  const salida = e.globales.doPost({ postData: { contents: JSON.stringify(cuerpo) } });
  const texto  = (salida && (salida._json !== undefined ? salida._json : salida));

  return { texto: typeof texto === 'string' ? texto : JSON.stringify(texto), entorno: e };
}

// ─── HTTP ─────────────────────────────────────────────────────────────────

function cabecerasCors(req, res) {
  const origen = req.headers.origin;
  if (origen && ORIGENES.indexOf(origen) !== -1) {
    res.setHeader('Access-Control-Allow-Origin', origen);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function responder(res, codigo, obj) {
  const cuerpo = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(cuerpo);
}

// Los comprobantes viajan en base64 dentro del cuerpo, así que tiene que ser
// generoso — pero con un techo: sin él, una petición enorme podría tumbar el
// servicio.
const MAX_CUERPO = Number(process.env.MAX_CUERPO_MB || 25) * 1024 * 1024;

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const partes = [];
    req.on('data', d => {
      total += d.length;
      if (total > MAX_CUERPO) { reject(new Error('El envío es demasiado grande.')); req.destroy(); return; }
      partes.push(d);
    });
    req.on('end', () => resolve(Buffer.concat(partes).toString('utf8')));
    req.on('error', reject);
  });
}

const servidor = http.createServer(async (req, res) => {
  cabecerasCors(req, res);

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Para que EasyPanel sepa si el servicio está sano.
  if (req.method === 'GET' && (req.url === '/salud' || req.url === '/health')) {
    return responder(res, 200, { status: 'success', servicio: 'pj04-pagos-api', zona: ZONA });
  }

  if (req.method !== 'POST') {
    return responder(res, 405, { status: 'error', message: 'Usá POST con { "action": "..." }.' });
  }

  const inicio = Date.now();
  try {
    const crudo = await leerCuerpo(req);
    let cuerpo;
    try {
      cuerpo = JSON.parse(crudo || '{}');
    } catch (err) {
      return responder(res, 400, { status: 'error', message: 'JSON inválido' });
    }

    const escribe = ACCIONES_QUE_ESCRIBEN.indexOf(cuerpo.action) !== -1;
    const { foto, deCache, ms: msLectura } = await traerFoto(escribe);

    const { texto, entorno } = ejecutar(foto, cuerpo);

    // Las escrituras se aplican DESPUÉS de que la lógica terminó. Si algo falló
    // a mitad de camino, no se escribe nada: la hoja no queda a medias.
    const cambios = entorno.cambios();
    let msEscritura = 0;
    if (cambios.length) {
      const a = Date.now();
      await require('./escribir').aplicar(cambios);
      msEscritura = Date.now() - a;
      olvidarFoto();   // lo que había guardado ya no refleja la hoja
    }

    // La medición viaja en la respuesta, como ya hacía Apps Script. Sin un
    // número medido, "está lento" no se puede atribuir a servidor, red o
    // navegador — y se termina optimizando lo que no era.
    let salida = texto;
    try {
      const datos = JSON.parse(texto);
      if (datos && typeof datos === 'object' && !Array.isArray(datos)) {
        datos.medicion = {
          ms: Date.now() - inicio,
          msLectura: msLectura,
          msEscritura: msEscritura,
          fotoDeCache: deCache
        };
        salida = JSON.stringify(datos);
      }
    } catch (err) { /* si no es JSON se manda tal cual */ }

    return responder(res, 200, salida);

  } catch (err) {
    console.error('[pj04-pagos-api]', err && err.stack ? err.stack : err);
    return responder(res, 500, {
      status: 'error',
      message: (err && err.message) || 'Error inesperado en el servidor.'
    });
  }
});

servidor.listen(PUERTO, () => {
  console.log('pj04-pagos-api escuchando en el puerto ' + PUERTO);
  console.log('  zona horaria: ' + ZONA);
  console.log('  orígenes permitidos: ' + ORIGENES.join(', '));
  console.log('  foto de hojas: ' + SEGUNDOS_FOTO + ' s');
});

module.exports = { servidor, traerFoto, olvidarFoto, ejecutar, ACCIONES_QUE_ESCRIBEN };
