// Borra las columnas "Column N" que dejan las Tablas de Sheets.
//
// Uso:
//   node limpiar-columnas-vacias.js            (simula)
//   node limpiar-columnas-vacias.js --aplicar
//
// ─── El problema que resuelve ─────────────────────────────────────────────
//
// Al convertir las hojas en Tablas, Sheets nombró "Column 1", "Column 2", …
// todas las columnas sin encabezado. Eso no es solo ruido visual:
//
//   · `asegurarColumnas_` las contaba como ocupadas y creaba las columnas
//     nuevas DESPUÉS de ellas. Por eso `FECHA REGISTRO` y `REALIZADO POR`
//     quedaron en las posiciones 27 y 28 de TRASLADOS, detrás de 19 columnas
//     vacías: los datos se escriben bien, pero quedan invisibles para quien
//     mira la hoja. Lo mismo en SALDOS con `SALDO CALCULADO` y `DIFERENCIA`.
//   · Y el 21/09/2026 hizo fallar el registro de un pago: la columna nueva
//     caía en la 27 de una hoja de 26 ("exceeds grid limits").
//
// Al borrarlas, las columnas reales vuelven a quedar juntas y a la vista.
//
// ─── Seguridad ────────────────────────────────────────────────────────────
//
// Solo entra una columna cuyo encabezado sea exactamente "Column <número>" Y
// que no tenga NINGÚN dato en ninguna fila. Se vuelve a comprobar antes de
// borrar; si alguna tiene contenido, se aborta sin escribir nada.

const { google } = require('googleapis');
const { nombresDeHojas, leerHojas } = require('./src/hojas');
const { credenciales, idDocumento } = require('./src/credenciales');

const APLICAR = process.argv.indexOf('--aplicar') !== -1;
const esBasura = h => /^Column \d+$/i.test(String(h || '').trim());

(async () => {
  const auth = new google.auth.GoogleAuth({
    credentials: credenciales(), scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const api = google.sheets({ version: 'v4', auth: await auth.getClient() });

  const meta = await api.spreadsheets.get({
    spreadsheetId: idDocumento(), fields: 'sheets(properties(sheetId,title))'
  });
  const idDe = {};
  (meta.data.sheets || []).forEach(x => { idDe[x.properties.title] = x.properties.sheetId; });

  const nombres = await nombresDeHojas(true);
  const datos   = await leerHojas(nombres, true);

  console.log(APLICAR ? '\nBORRANDO\n' : '\nSIMULACION — agregá --aplicar para borrar.\n');
  console.log('hoja'.padEnd(27) + 'aBorrar'.padStart(8) + '   columnas');
  console.log('-'.repeat(64));

  const requests = [];
  let total = 0;
  nombres.forEach(n => {
    const f = datos[n] || [], enc = f[0] || [];
    const aBorrar = [];
    enc.forEach((h, c) => {
      if (!esBasura(h)) return;
      for (let i = 1; i < f.length; i++) {
        const v = (f[i] || [])[c];
        if (v !== '' && v != null) {
          console.log('\nABORTADO: "' + n + '" columna ' + (c + 1) + ' tiene datos en la fila ' + (i + 1));
          process.exit(1);
        }
      }
      aBorrar.push(c);
    });
    if (!aBorrar.length) return;

    // Bloques contiguos, de derecha a izquierda: borrar por la izquierda
    // primero correría los índices de todo lo que está a la derecha.
    const bloques = [];
    aBorrar.forEach(c => {
      const u = bloques[bloques.length - 1];
      if (u && c === u.desde + u.cuantas) u.cuantas++;
      else bloques.push({ desde: c, cuantas: 1 });
    });
    bloques.reverse().forEach(b => requests.push({ deleteDimension: { range: {
      sheetId: idDe[n], dimension: 'COLUMNS', startIndex: b.desde, endIndex: b.desde + b.cuantas
    } } }));

    total += aBorrar.length;
    console.log(n.padEnd(27) + String(aBorrar.length).padStart(8) + '   ' +
      bloques.map(b => (b.desde + 1) + '-' + (b.desde + b.cuantas)).join(', '));
  });

  console.log('-'.repeat(64));
  console.log('columnas vacias: ' + total + (APLICAR ? '' : '  (simulacion)'));

  if (APLICAR && requests.length) {
    await api.spreadsheets.batchUpdate({ spreadsheetId: idDocumento(), requestBody: { requests: requests } });
    console.log('borradas');
  }
  process.exit(0);
})().catch(err => { console.error('\nFALLO: ' + err.message); process.exit(1); });
