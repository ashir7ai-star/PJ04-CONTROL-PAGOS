// Cuánto le estamos pidiendo a la API de Sheets, y un freno antes del límite.
//
// ─── Por qué hace falta ───────────────────────────────────────────────────
//
// Google limita las LECTURAS a 60 por minuto "por usuario". Con una cuenta de
// servicio, ese "usuario" es UNO SOLO para toda la empresa: los nueve usuarios
// comparten el mismo balde de 60. No es un límite por persona.
//
// Cuando se agota, Google responde 429 y la app deja de funcionar para TODOS
// —fue lo que le pasó a Sandra mientras Nathan probaba—, con un mensaje en
// inglés que no le dice nada a nadie.
//
// ─── Por qué un freno y no solo menos llamadas ────────────────────────────
//
// Hacer menos llamadas baja la probabilidad; no la elimina. Un freno propio,
// puesto POR DEBAJO del límite de Google, convierte "la app se rompe" en "la
// app sirve lo último que leyó". Y a diferencia del 429, este freno lo
// controlamos nosotros: sabemos cuántas quedan y podemos decidir.
//
// El límite propio se deja en 40 y no en 60 a propósito: hay que dejar aire
// para lo que no pasa por acá (los reportes que siguen en Apps Script, alguien
// con la hoja abierta) y para el propio /diagnostico.

const VENTANA_MS = 60000;
const LIMITE = Number(process.env.LECTURAS_POR_MINUTO || 40);

// Instantes de las lecturas del último minuto. Ventana deslizante: no se
// reinicia "en el minuto redondo", porque Google tampoco lo hace.
const marcas = [];

// Total desde que arrancó el proceso, para poder mirarlo en /salud. Sin un
// número medido, "está lento" o "se agotó la cuota" no se puede atribuir a
// nada concreto — y se termina arreglando lo que no era.
let totalHistorico = 0;
let vecesSinCupo   = 0;

function purgar() {
  const corte = Date.now() - VENTANA_MS;
  while (marcas.length && marcas[0] < corte) marcas.shift();
}

// Se llama JUSTO ANTES de cada petición a la API, no después: si se contara
// después, dos llamadas simultáneas verían el mismo cupo libre y las dos
// pasarían.
function anotar() {
  purgar();
  marcas.push(Date.now());
  totalHistorico++;
}

function usadas() { purgar(); return marcas.length; }

function hayCupo() { return usadas() < LIMITE; }

// Cuánto falta para que se libere un lugar. La más vieja de la ventana es la
// primera en caerse.
function msHastaCupo() {
  purgar();
  if (marcas.length < LIMITE) return 0;
  return Math.max(0, marcas[0] + VENTANA_MS - Date.now()) + 50;
}

function anotarRechazo() { vecesSinCupo++; }

function resumen() {
  return {
    limitePropio: LIMITE,
    limiteDeGoogle: 60,
    enElUltimoMinuto: usadas(),
    desdeElArranque: totalHistorico,
    vecesSinCupo: vecesSinCupo
  };
}

// Solo para las pruebas: deja el contador como recién arrancado.
function reiniciar() {
  marcas.length = 0;
  totalHistorico = 0;
  vecesSinCupo = 0;
}

module.exports = {
  anotar, usadas, hayCupo, msHastaCupo, anotarRechazo, resumen, reiniciar,
  LIMITE, VENTANA_MS
};
