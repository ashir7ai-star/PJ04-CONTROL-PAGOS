// Borra las filas VACÍAS que dejan las Tablas de Sheets.
//
// Uso:
//   node limpiar-filas-vacias.js            (simula: no toca nada)
//   node limpiar-filas-vacias.js --aplicar  (borra de verdad)
//
// ─── El problema que resuelve ─────────────────────────────────────────────
//
// Las hojas de este documento están convertidas en **Tablas de Sheets**, y
// cada Tabla abarca la hoja entera (1000 filas), no solo las filas con datos.
//
// Eso cambia dónde caen los datos nuevos, y es un cambio que la migración
// destapó sin que nadie lo tocara:
//
//   · `SpreadsheetApp.appendRow()` (Apps Script) agrega después de la última
//     fila CON DATOS.
//   · `values.append` (API de Sheets) agrega después de la TABLA.
//
// Con una Tabla de 1000 filas y 44 de datos, un pago nuevo cae en la fila
// 1041. No se pierde —la app lo lee igual— pero queda invisible para quien
// mira la hoja, con cientos de filas vacías en el medio. Para una hoja de
// contabilidad eso es casi tan grave como perderlo.
//
// Pasó el 19/09/2026 con un pago de prueba de $100.000, y antes con la hoja
// SESIONES, que llegó a tener 884 filas de las que 867 estaban vacías.
//
// ─── Por qué borrar las filas vacías lo arregla ───────────────────────────
//
// Al borrarlas, la Tabla se encoge hasta sus datos. Comprobado con SESIONES:
// quedó en 1-18 y desde entonces las sesiones nuevas caen pegadas. La Tabla
// vuelve a crecer sola a medida que se agregan datos.
//
// ─── Seguridad ────────────────────────────────────────────────────────────
//
// Una fila solo entra si está vacía en TODAS sus columnas. Antes de borrar se
// vuelve a comprobar, y si alguna tiene contenido se aborta sin escribir nada.
// El borrado usa `escribir.js`, el mismo camino que usa la app.

const { google } = require('googleapis');
const { nombresDeHojas, leerHojas } = require('./src/hojas');
const { credenciales, idDocumento } = require('./src/credenciales');
const esc  = require('./src/escribir');
const cupo = require('./src/cupo-lecturas');

const APLICAR = process.argv.indexOf('--aplicar') !== -1;

const vacia = (f) => !f || f.every(c => c === '' || c === null || c === undefined);

function enBloques(filas) {
  const bloques = [];
  filas.forEach(r => {
    const u = bloques[bloques.length - 1];
    if (u && r === u.inicio + u.cantidad) u.cantidad++;
    else bloques.push({ inicio: r, cantidad: 1 });
  });
  return bloques;
}

(async () => {
  const auth = new google.auth.GoogleAuth({
    credentials: credenciales(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const api = google.sheets({ version: 'v4', auth: await auth.getClient() });

  // Cuántas filas tiene la cuadrícula. Hace falta porque `values` recorta las
  // filas vacías del final: sin esto no se verían las que hay debajo del
  // último dato, que son justamente las que corren el próximo pago al fondo.
  const meta = await api.spreadsheets.get({
    spreadsheetId: idDocumento(),
    fields: 'sheets(properties(title,gridProperties(rowCount)))'
  });
  const grid = {};
  (meta.data.sheets || []).forEach(h => { grid[h.properties.title] = h.properties.gridProperties.rowCount; });

  const nombres = await nombresDeHojas(true);
  const datos   = await leerHojas(nombres, true);
  cupo.reiniciar();

  console.log(APLICAR ? '\nBORRANDO\n' : '\nSIMULACION — no se toca nada. Agregá --aplicar para borrar.\n');
  console.log('hoja'.padEnd(27) + 'datos'.padStart(6) + 'grid'.padStart(6) + 'vacias'.padStart(8) + '   rangos');
  console.log('-'.repeat(78));

  let total = 0;
  for (const n of nombres) {
    const f = datos[n] || [];
    if (!f.length) continue;

    let ultima = 1;
    for (let i = 1; i < f.length; i++) if (!vacia(f[i])) ultima = i + 1;

    const aBorrar = [];
    // Las intercaladas (un pago que cayó al fondo deja un hueco arriba)...
    for (let i = 1; i < f.length; i++) if (vacia(f[i]) && (i + 1) < ultima) aBorrar.push(i + 1);
    // ...y todo lo que sobra debajo del último dato.
    for (let r = ultima + 1; r <= (grid[n] || 0); r++) aBorrar.push(r);
    // Sheets no permite borrar TODAS las filas no congeladas: una hoja que
    // solo tiene encabezado (y el encabezado está congelado) tiene que
    // conservar al menos una fila. Se le deja la 2.
    if (ultima <= 1) {
      const i = aBorrar.indexOf(2);
      if (i !== -1) aBorrar.splice(i, 1);
    }
    if (!aBorrar.length) continue;

    // Última comprobación antes de escribir: ninguna puede tener contenido.
    const mala = aBorrar.find(r => f[r - 1] && !vacia(f[r - 1]));
    if (mala) {
      console.log('\nABORTADO en "' + n + '": la fila ' + mala + ' tiene datos.');
      process.exit(1);
    }

    const bloques = enBloques(aBorrar);
    total += aBorrar.length;
    let nota = '';

    if (APLICAR) {
      // De abajo hacia arriba: borrar arriba primero correría los índices.
      const cambios = aBorrar.slice().reverse().map(r => ({ tipo: 'borrar', hoja: n, desde: r, cantidad: 1 }));
      const t = Date.now();
      await esc.aplicar(cambios);
      nota = '   ' + (Date.now() - t) + ' ms';
    }

    console.log(n.padEnd(27) + String(ultima).padStart(6) + String(grid[n]).padStart(6) +
                String(aBorrar.length).padStart(8) + '   ' +
                bloques.map(b => b.inicio + '-' + (b.inicio + b.cantidad - 1)).join(', ').slice(0, 24) + nota);
  }

  console.log('-'.repeat(78));
  console.log('filas vacias: ' + total + (APLICAR ? '  BORRADAS' : '  (simulacion)'));
  if (APLICAR) {
    console.log('costo: ' + cupo.usadas() + ' lecturas + ' + cupo.escriturasUsadas() + ' escrituras de API');
  }
  process.exit(0);
})().catch(err => { console.error('\nFALLO: ' + (err && err.message)); process.exit(1); });
