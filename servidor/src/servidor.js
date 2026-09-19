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

const { nombresDeHojas, leerHojas, olvidarNombres } = require('./hojas');
const { convertirFoto } = require('./fechas-sheets');
const { crearEntorno }  = require('./entorno');
const cupo = require('./cupo-lecturas');
const { crearGestorDeFoto } = require('./foto');
const { traducirError }     = require('./errores');

const PUERTO = Number(process.env.PORT || 8080);
const ZONA   = process.env.ZONA_HORARIA || 'America/Bogota';

// ─── La zona del PROCESO tiene que ser la del negocio ─────────────────────
//
// `apps-script.gs` construye fechas con `new Date(año, mes, día, hora, minuto)`,
// que las interpreta en la hora del proceso. Si el proceso corre en UTC y el
// negocio es Bogotá, toda fecha de texto queda corrida cinco horas.
//
// No falla: devuelve otra hora. Exactamente la clase de error que en este
// proyecto ya costó días — un dato equivocado es peor que una caída, porque
// una caída se ve.
//
// Por eso se comprueba al arrancar y se REHÚSA a servir si no coincide: es
// preferible que el despliegue falle a la vista que servir fechas corridas.
(function verificarZona() {
  const ahora = new Date();
  const enZona = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA, hour: '2-digit', minute: '2-digit', hour12: false
  }).format(ahora);
  const local = new Intl.DateTimeFormat('en-CA', {
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(ahora);

  if (enZona !== local) {
    console.error('');
    console.error('  La zona horaria del proceso NO es ' + ZONA + '.');
    console.error('  proceso: ' + local + '   ' + ZONA + ': ' + enZona);
    console.error('');
    console.error('  Con esta diferencia, las fechas de texto quedarían corridas.');
    console.error('  Definí TZ=' + ZONA + ' en el contenedor. En Alpine hace falta');
    console.error('  además instalar tzdata, o el valor se ignora en silencio.');
    console.error('');
    process.exit(1);
  }
})();

// Orígenes a los que se les permite llamar. El navegador exige que el servidor
// lo autorice explícitamente; un '*' funcionaría igual pero dejaría la API
// abierta a cualquier página que quisiera usarla desde el navegador de un
// usuario que ya tiene sesión.
const ORIGENES = (process.env.ORIGENES_PERMITIDOS ||
  'https://ashir7ai-star.github.io,http://localhost:8000,http://127.0.0.1:8000'
).split(',').map(o => o.trim()).filter(Boolean);

// ─── Qué acciones EXIGEN leer el estado real ──────────────────────────────
//
// No es lo mismo "escribir" que "no poder decidir con datos de hace unos
// segundos". La distinción importa: antes, `arranque` estaba en esta lista
// —escribe ULTIMO ACCESO— y `arranque` es la acción MÁS frecuente del
// sistema: se dispara al abrir la app, incluso antes de que nadie entre. Cada
// una forzaba una lectura completa y además tiraba la foto guardada, así que
// el caché prácticamente nunca se usaba y el consumo de cuota se disparaba.
//
// Acá quedan solo las acciones donde una foto de hace unos segundos podría
// hacer TOMAR UNA DECISIÓN equivocada: el guardia contra pagos duplicados
// compara contra lo ya escrito, y una aprobación no puede decidirse sobre un
// estado viejo.
//
// Las demás —entrar, salir, arranque— pueden trabajar sobre la foto guardada
// sin riesgo, porque después de cada escritura el caché se queda con la foto
// YA ACTUALIZADA (ver más abajo): una sesión recién creada está ahí.
const ACCIONES_QUE_EXIGEN_FRESCO = [
  'registrar_pago',        // el guardia contra duplicados compara con lo ya escrito
  'solicitar_aprobacion',
  'decidir_solicitud',
  'registrar_traslado',
  'ajustar_saldo',
  'guardar_usuario',
  'registrar_usuario'
];

// Se conserva el nombre viejo por compatibilidad con lo que ya lo importaba.
const ACCIONES_QUE_ESCRIBEN = ACCIONES_QUE_EXIGEN_FRESCO;

// ─── La foto de las hojas ─────────────────────────────────────────────────
//
// Traerla cuesta ~600 ms (medido: las 12 hojas en UNA llamada). Guardarla unos
// segundos hace que varias consultas seguidas no la vuelvan a pedir.
//
// Toda la política —cuándo reusar, cuándo esperar, qué hacer sin cuota— vive
// en foto.js, donde se puede probar sin red ni credenciales.
const SEGUNDOS_FOTO  = Number(process.env.SEGUNDOS_FOTO || 15);
const MS_ESPERA_CUPO = Number(process.env.MS_ESPERA_CUPO || 8000);

const gestorFoto = crearGestorDeFoto({
  leerNombres: ()        => nombresDeHojas(false),
  leerHojas:   (nombres) => leerHojas(nombres, false),
  convertir:   (crudo)   => convertirFoto(crudo, ZONA),
  cupo:        cupo,
  segundos:     SEGUNDOS_FOTO,
  msEsperaCupo: MS_ESPERA_CUPO
});

const traerFoto   = (forzar) => gestorFoto.traer(forzar);
const olvidarFoto = ()       => gestorFoto.olvidar();

// ─── Los últimos errores, para no quedar a ciegas ─────────────────────────
//
// Cuando una persona reporta "me sale este mensaje", hoy no hay forma de saber
// si su petición siquiera llegó acá. Sin eso, un mensaje viejo pegado en la
// pantalla y un error real se ven EXACTAMENTE IGUAL, y se termina arreglando
// lo que no era.
//
// Se guarda solo qué acción falló, con qué código y cuándo. NADA de correos,
// tokens ni texto del error: esto se sirve sin contraseña.
const ULTIMOS_ERRORES = [];
function recordarError(accion, http, codigo) {
  ULTIMOS_ERRORES.unshift({
    cuando: new Date().toISOString(),
    accion: accion, http: http, codigo: codigo
  });
  ULTIMOS_ERRORES.length = Math.min(ULTIMOS_ERRORES.length, 10);
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
    return responder(res, 200, {
      status: 'success', servicio: 'pj04-pagos-api', zona: ZONA,
      // Cuánta cuota de lectura se está usando. Es el número que hacía falta
      // el día que la app se cayó por cuota y solo se podía especular.
      lecturas: cupo.resumen(),
      foto: gestorFoto.estado(),
      // Si esto está vacío, ninguna petición falló acá: un mensaje de error en
      // la pantalla de alguien es entonces una página vieja sin recargar.
      ultimosErrores: ULTIMOS_ERRORES,
      // Filas que Sheets escribió en un lugar distinto del calculado. Tiene
      // que estar SIEMPRE vacío: si no, hay datos donde nadie los ve.
      filasFueraDeLugar: require('./escribir').filasFueraDeLugar()
    });
  }

  // Comprueba las TRES capacidades contra los servicios reales. Sin esto, una
  // credencial mal pegada se descubre recién cuando alguien intenta registrar
  // un pago — y ahí ya es un problema de la persona, no un aviso nuestro.
  //
  // No devuelve ningún secreto: solo si cada cosa funciona y qué falló.
  if (req.method === 'GET' && req.url.split('?')[0] === '/diagnostico') {
    const r = { status: 'success', hojas: {}, drive: {}, correo: {} };

    try {
      // `true` al final: fuerza la llamada real. Servir la lista guardada acá
      // convertiría el diagnóstico en una mentira — diría que las credenciales
      // funcionan sin haberlas usado.
      const nombres = await nombresDeHojas(false, true);
      r.hojas = { ok: true, pestanas: nombres.length };
    } catch (err) { r.hojas = { ok: false, error: err.message }; }

    try {
      const madre = process.env.DRIVE_CARPETA_MADRE;
      if (!madre) throw new Error('Falta DRIVE_CARPETA_MADRE.');
      const { buscarCarpeta } = require('./drive-api');
      // Se busca una carpeta que sabemos que existe: prueba credenciales Y acceso.
      const id = await buscarCarpeta({ nombre: 'PJ04 VIATICOS' });
      r.drive = { ok: !!id, carpetasVisibles: id ? 'si' : 'no encuentra PJ04 VIATICOS' };
    } catch (err) { r.drive = { ok: false, error: err.message }; }

    try {
      const { permisos } = require('./correo');
      r.correo = await permisos();
    } catch (err) { r.correo = { ok: false, error: err.message }; }

    r.status = (r.hojas.ok && r.drive.ok && r.correo.ok) ? 'success' : 'error';
    return responder(res, 200, r);
  }

  if (req.method !== 'POST') {
    return responder(res, 405, { status: 'error', message: 'Usá POST con { "action": "..." }.' });
  }

  const inicio = Date.now();
  let cuerpoAccion = '?';   // se necesita también si algo falla más abajo
  try {
    const crudo = await leerCuerpo(req);
    let cuerpo;
    try {
      cuerpo = JSON.parse(crudo || '{}');
    } catch (err) {
      return responder(res, 400, { status: 'error', message: 'JSON inválido' });
    }
    cuerpoAccion = String(cuerpo.action || '?').slice(0, 40);

    const exigeFresco = ACCIONES_QUE_EXIGEN_FRESCO.indexOf(cuerpo.action) !== -1;
    const lectura = await traerFoto(exigeFresco);
    const { foto, deCache, ms: msLectura, vencida } = lectura;

    const { texto, entorno } = ejecutar(foto, cuerpo);

    // Las escrituras se aplican DESPUÉS de que la lógica terminó. Si algo falló
    // a mitad de camino, no se escribe nada: la hoja no queda a medias.
    const cambios = entorno.cambios();
    let msEscritura = 0;
    if (cambios.length) {
      const a = Date.now();
      try {
        await require('./escribir').aplicar(cambios);
      } catch (err) {
        // No sabemos cuánto alcanzó a aplicarse: lo guardado ya no es de fiar.
        gestorFoto.escrituraFallida();
        throw err;
      }
      msEscritura = Date.now() - a;

      // Si la lógica creó una pestaña, la lista de pestañas guardada quedó vieja.
      if (cambios.some(c => c.tipo === 'crearHoja')) olvidarNombres();

      // La foto NO se tira: se reemplaza por la copia que la lógica ya dejó
      // con el cambio aplicado. Tirarla costaba una lectura de cuota por cada
      // escritura, y `arranque` escribe ULTIMO ACCESO en CADA apertura de la
      // app — el caché moría todo el tiempo. (La decisión fina, incluida la
      // carrera con otra escritura, está en foto.js.)
      gestorFoto.trasEscribir(lectura.version, entorno.datos());
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
          fotoDeCache: deCache,
          // `fotoVencida` avisa que se sirvió lo último leído porque no había
          // cupo. No es un error, pero conviene que quede registrado.
          fotoVencida: !!vencida,
          lecturasEnElMinuto: cupo.usadas()
        };
        salida = JSON.stringify(datos);
      }
    } catch (err) { /* si no es JSON se manda tal cual */ }

    responder(res, 200, salida);

    // Los correos salen DESPUES de haber respondido. Si el pago se guardo, la
    // persona ve su confirmacion ya; no espera a que conteste el servidor de
    // correo. Y un fallo de envio no puede ensuciar una operacion que ya
    // termino bien — es lo mismo que dicen los try/catch de apps-script.gs:
    // "el alta ya quedo registrada; el correo es un extra".
    const correos = entorno.correos();
    if (correos.length) {
      require('./correo').enviarPendientes(correos)
        .then(r => { if (r.fallidos) console.warn('[correo] ' + r.fallidos + ' de ' + correos.length + ' no salieron'); })
        .catch(err => console.error('[correo] fallo general:', err && err.message));
    }
    return;

  } catch (err) {
    console.error('[pj04-pagos-api]', err && err.stack ? err.stack : err);

    // La cuota agotada no es una falla del servidor: es "ahora no, en un
    // momento". Se devuelve 503 y un mensaje en castellano. El de Google
    // ("Quota exceeded for quota metric 'Read requests'...") llegó tal cual a
    // la pantalla de una usuaria, en inglés y con el número de proyecto
    // adentro; eso no puede volver a pasar.
    // Qué se le muestra al usuario lo decide errores.js, en un solo lugar y
    // sin depender de que el error venga marcado: un texto crudo de Google ya
    // llegó una vez a la pantalla de una usuaria.
    const t = traducirError(err);

    if (t.codigo === 'CUOTA')  console.warn('[cuota] ' + JSON.stringify(cupo.resumen()) + '  crudo: ' + t.registro);
    if (t.codigo === 'GOOGLE') console.error('[google] ' + t.registro);

    recordarError(cuerpoAccion, t.http, t.codigo);
    return responder(res, t.http, { status: 'error', codigo: t.codigo, message: t.message });
  }
});

servidor.listen(PUERTO, () => {
  console.log('pj04-pagos-api escuchando en el puerto ' + PUERTO);
  console.log('  zona horaria: ' + ZONA);
  console.log('  orígenes permitidos: ' + ORIGENES.join(', '));
  console.log('  foto de hojas: ' + SEGUNDOS_FOTO + ' s');
  console.log('  freno de lecturas: ' + cupo.LIMITE + ' por minuto (Google permite 60)');
});

module.exports = {
  servidor, traerFoto, olvidarFoto, ejecutar,
  ACCIONES_QUE_ESCRIBEN, ACCIONES_QUE_EXIGEN_FRESCO
};
