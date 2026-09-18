// El hilo que hace el trabajo asíncrono mientras el principal espera dormido.
//
// Recibe { operacion, datos }, lo resuelve, deja el resultado en el canal y
// toca el timbre (Atomics.notify) para despertar al hilo principal.
//
// ⚠️ Todo lo que pase por acá tiene que terminar SIEMPRE, con éxito o con
// error. Si una operación se colgara sin avisar, el hilo principal quedaría
// dormido hasta el límite de tiempo — y el servidor entero con él. Por eso hay
// un try/catch que envuelve absolutamente todo.

const { parentPort, workerData } = require('worker_threads');

const puerto = workerData.puerto;
const senal  = new Int32Array(workerData.senal);

function responder(resultado) {
  puerto.postMessage(resultado);
  Atomics.store(senal, 0, 1);
  Atomics.notify(senal, 0);
}

const operaciones = {
  // Sirve para probar el puente sin depender de Drive ni de la red.
  eco: async (datos) => datos,
  demora: async (datos) => {
    await new Promise(r => setTimeout(r, (datos && datos.ms) || 10));
    return 'listo tras ' + ((datos && datos.ms) || 10) + ' ms';
  },
  falla: async () => { throw new Error('falla a propósito'); }
};

// Las operaciones de Drive se cargan solo si se piden: así el puente se puede
// probar sin credenciales, y un problema de Drive no impide arrancar.
function operacionDeDrive(nombre) {
  let drive;
  try {
    drive = require('./drive-api');
  } catch (err) {
    // Solo se ignora que el modulo NO EXISTA. Cualquier otro fallo al
    // cargarlo (un error de sintaxis, una dependencia rota) tiene que salir
    // a la luz: esconderlo lo disfrazaria de "operacion desconocida" y
    // costaria horas encontrarlo.
    if (err && err.code === 'MODULE_NOT_FOUND' && /drive-api/.test(err.message)) return null;
    throw err;
  }
  return drive[nombre];
}

parentPort.on('message', async (mensaje) => {
  try {
    const nombre = mensaje && mensaje.operacion;
    const fn = operaciones[nombre] || operacionDeDrive(nombre);
    if (typeof fn !== 'function') {
      throw new Error('Operación desconocida en el trabajador: ' + nombre);
    }
    const valor = await fn(mensaje.datos);
    responder({ valor: valor });
  } catch (err) {
    responder({ error: (err && err.message) || String(err) });
  }
});
