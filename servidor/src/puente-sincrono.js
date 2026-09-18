// Puente para llamar código ASÍNCRONO desde código SÍNCRONO.
//
// ─── Por qué hace falta ───────────────────────────────────────────────────
//
// `apps-script.gs` sube archivos a Drive de forma síncrona: escribe
// `carpeta.createFile(blob).getUrl()` y espera la URL en el acto. En Apps
// Script eso funcionaba; en Node, la API de Drive es asíncrona.
//
// Con las hojas se resolvió trayendo todo por adelantado. Con Drive no se
// puede: los nombres de carpeta y archivo los decide la propia lógica mientras
// corre, y adelantarlos significaría duplicar esas decisiones acá — o sea,
// tener la misma regla escrita en dos lados, que es como empiezan las
// diferencias silenciosas.
//
// ─── Cómo funciona ────────────────────────────────────────────────────────
//
// El trabajo pesado se manda a un hilo aparte y el hilo principal se DUERME
// hasta que ese hilo avisa. `Atomics.wait` es lo único en Node que bloquea de
// verdad sin consumir procesador.
//
// El resultado no puede volver por el evento 'message' de siempre: el hilo
// principal está dormido y no procesa eventos. Por eso se usa un canal y
// `receiveMessageOnPort`, que lee el mensaje sin depender del bucle de
// eventos.
//
// ⚠️ Bloquear el hilo principal significa que el servidor NO atiende otra
// petición mientras dura la subida. Es aceptable porque subir un comprobante
// ya es lento de por sí y ocurre poco; si algún día hay muchas subidas a la
// vez, la salida es correr varias instancias, no quitar el bloqueo.

const path = require('path');
const { Worker, MessageChannel, receiveMessageOnPort } = require('worker_threads');

const SEGUNDOS_LIMITE = Number(process.env.SEGUNDOS_LIMITE_DRIVE || 120);

let estado = null;

function arrancar() {
  if (estado) return estado;

  // 4 bytes compartidos entre los dos hilos: son el timbre. El trabajador
  // escribe 1 y avisa; el principal está dormido esperando justamente eso.
  const compartido = new SharedArrayBuffer(4);
  const senal = new Int32Array(compartido);
  const { port1, port2 } = new MessageChannel();

  const worker = new Worker(path.join(__dirname, 'trabajador.js'), {
    workerData: { puerto: port2, senal: compartido },
    transferList: [port2]
  });

  // unref para que este hilo no impida que el proceso termine cuando debe.
  worker.unref();
  worker.on('error', (err) => { console.error('[puente] el trabajador falló:', err); });

  estado = { worker, senal, puerto: port1 };
  return estado;
}

// Ejecuta una operación en el otro hilo y DEVUELVE EL RESULTADO, bloqueando.
function llamar(operacion, datos) {
  const { worker, senal, puerto } = arrancar();

  Atomics.store(senal, 0, 0);
  worker.postMessage({ operacion, datos });

  // Si el trabajador terminó antes de que llegáramos acá, el valor ya no es 0
  // y `wait` devuelve 'not-equal' sin dormirse. No hay carrera posible.
  const resultado = Atomics.wait(senal, 0, 0, SEGUNDOS_LIMITE * 1000);
  if (resultado === 'timed-out') {
    throw new Error('La operación con Drive tardó más de ' + SEGUNDOS_LIMITE + ' segundos.');
  }

  const mensaje = receiveMessageOnPort(puerto);
  if (!mensaje) throw new Error('El trabajador avisó pero no dejó ningún resultado.');

  const r = mensaje.message;
  if (r && r.error) {
    // Se conserva el mensaje original: un "algo falló" no sirve para nada
    // cuando el problema es un permiso de Drive o una cuota agotada.
    throw new Error(r.error);
  }
  return r ? r.valor : undefined;
}

// Para las pruebas y para cerrar limpio.
function detener() {
  if (!estado) return;
  try { estado.worker.terminate(); } catch (err) {}
  estado = null;
}

module.exports = { llamar, detener };
