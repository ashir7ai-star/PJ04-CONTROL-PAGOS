// Convierte a FECHAS REALES las celdas de fecha que quedaron como texto.
//
// Uso:
//   node reparar-fechas-texto.js            (simula: no toca nada)
//   node reparar-fechas-texto.js --aplicar  (escribe)
//
// ─── De dónde salen esas celdas ───────────────────────────────────────────
//
// El documento está en **en_US**. Hasta el 22/09/2026 el servidor mandaba las
// fechas como "22/09/2026 10:55:57", y en en_US eso NO es una fecha (no hay
// mes 22): Sheets lo guardaba como TEXTO, sin avisar. Alineado a la izquierda,
// imposible de ordenar o filtrar como fecha.
//
// Ya está corregido en `escribir.js` (ahora manda ISO). Esto repara lo que
// quedó escrito mientras tanto.
//
// ─── Por qué se exige ida y vuelta EXACTA ─────────────────────────────────
//
// Adivinar día/mes es exactamente lo que costó una jornada entera: 40 filas
// quedaron en diciembre de 2026 por leer MM/dd como dd/MM.
//
// La primera versión de este script usaba `textoFechaAIso_` y la simulación
// mostró que habría convertido "18/09/2026 23:17:00" en "2026-09-17 19:00:00"
// —un día antes y sin la hora—, porque esa función devuelve solo la fecha y al
// reconstruirla se aplicaba la zona horaria. La simulación lo atajó.
//
// Por eso acá el texto se interpreta con un patrón explícito y, sobre todo,
// **se vuelve a escribir en el formato original y tiene que dar el MISMO
// texto, carácter por carácter**. Si no coincide, la celda no se toca. Así es
// imposible perder la hora o cambiar el día sin que se note.

const { nombresDeHojas, leerHojas } = require('./src/hojas');
const { COLUMNAS_FECHA } = require('./src/fechas-sheets');
const esc  = require('./src/escribir');
const cupo = require('./src/cupo-lecturas');

const APLICAR = process.argv.indexOf('--aplicar') !== -1;
const esFecha = h => COLUMNAS_FECHA.indexOf(String(h || '').trim().toUpperCase()) !== -1;

const p2 = n => String(n).padStart(2, '0');

// dd/MM/yyyy con hora opcional — el formato que escribía el servidor.
function interpretar(texto) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(texto).trim());
  if (!m) return null;
  const [, d, mes, a, h, mi, s] = m;
  if (+mes < 1 || +mes > 12 || +d < 1 || +d > 31) return null;
  const fecha = new Date(+a, +mes - 1, +d, +(h || 0), +(mi || 0), +(s || 0));
  // Que la fecha exista de verdad: 31/02 no.
  if (fecha.getDate() !== +d || fecha.getMonth() !== +mes - 1) return null;
  return { fecha: fecha, teniaSegundos: s !== undefined, teniaHora: h !== undefined };
}

// Se vuelve a armar el texto ORIGINAL a partir de la fecha. Si no sale
// idéntico, algo se perdió por el camino y la celda no se toca.
function comoEstaba(f, forma) {
  const dia = p2(f.getDate()) + '/' + p2(f.getMonth() + 1) + '/' + f.getFullYear();
  if (!forma.teniaHora) return dia;
  const hora = p2(f.getHours()) + ':' + p2(f.getMinutes());
  return dia + ' ' + hora + (forma.teniaSegundos ? ':' + p2(f.getSeconds()) : '');
}

(async () => {
  const nombres = await nombresDeHojas(true);
  const crudo   = await leerHojas(nombres, true);

  console.log(APLICAR ? '\nREPARANDO\n' : '\nSIMULACION — no se toca nada. Agregá --aplicar para escribir.\n');

  const cambios = [];
  const dudosas = [];
  nombres.forEach(n => {
    const f = crudo[n] || [], enc = f[0] || [];
    enc.forEach((h, c) => {
      if (!esFecha(h)) return;
      for (let i = 1; i < f.length; i++) {
        const v = (f[i] || [])[c];
        if (v === '' || v == null || typeof v === 'number') continue;

        const leido = interpretar(v);
        if (!leido) { dudosas.push([n, h, i + 1, v + '  (no se reconoce el formato)']); continue; }

        const d = leido.fecha;
        // La prueba que lo hace seguro: rearmar el texto original.
        const vuelta = comoEstaba(d, leido);
        if (vuelta !== String(v).trim()) {
          dudosas.push([n, h, i + 1, JSON.stringify(v) + ' -> vuelve como ' + JSON.stringify(vuelta)]);
          continue;
        }
        cambios.push({ tipo: 'escribir', hoja: n, fila: i + 1, col: c + 1, valores: [[d]], _antes: v, _despues: esc.aCelda(d) });
      }
    });
  });

  const porHoja = {};
  cambios.forEach(c => { porHoja[c.hoja] = (porHoja[c.hoja] || 0) + 1; });
  Object.keys(porHoja).forEach(h => console.log('  ' + h.padEnd(27) + String(porHoja[h]).padStart(4) + ' celdas'));
  console.log('');
  cambios.slice(0, 8).forEach(c =>
    console.log('    ej. ' + c.hoja + ' fila ' + c.fila + ' col ' + c.col + ': ' + JSON.stringify(c._antes) + ' -> ' + c._despues));
  if (cambios.length > 8) console.log('    ... y ' + (cambios.length - 8) + ' más');

  if (dudosas.length) {
    console.log('');
    console.log('  NO SE TOCAN (la lógica no las interpreta con certeza):');
    dudosas.forEach(d => console.log('    ' + d[0] + ' ' + d[1] + ' fila ' + d[2] + ': ' + JSON.stringify(d[3])));
  }

  console.log('');
  console.log('total a convertir: ' + cambios.length + (APLICAR ? '' : '  (simulacion)'));

  if (APLICAR && cambios.length) {
    cupo.reiniciar();
    await esc.aplicar(cambios.map(c => ({ tipo: c.tipo, hoja: c.hoja, fila: c.fila, col: c.col, valores: c.valores })));
    console.log('aplicado: ' + cupo.usadas() + ' lecturas + ' + cupo.escriturasUsadas() + ' escrituras');

    // Verificación: ya no puede quedar texto en esas celdas.
    const otra = await leerHojas(nombres, true);
    let quedan = 0;
    nombres.forEach(n => {
      const f = otra[n] || [], enc = f[0] || [];
      enc.forEach((h, c) => { if (!esFecha(h)) return;
        for (let i = 1; i < f.length; i++) { const v = (f[i] || [])[c];
          if (v !== '' && v != null && typeof v !== 'number') quedan++; } });
    });
    console.log('celdas de fecha que siguen siendo texto: ' + quedan);
  }
  process.exit(0);
})().catch(err => { console.error('\nFALLO: ' + err.message); process.exit(1); });
