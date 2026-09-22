// Pone el FORMATO de las columnas de fecha, para que se lean como fechas.
//
// Uso:
//   node formato-fechas.js            (simula)
//   node formato-fechas.js --aplicar
//
// ─── Por qué hace falta aparte del valor ──────────────────────────────────
//
// Guardar una fecha real no alcanza: lo que se VE depende del formato de la
// celda. Una celda sin formato de fecha muestra "22/09/2026 0:00:00" o incluso
// el número de serie, y una que quedó como texto conserva su formato de texto
// aunque después se le escriba una fecha.
//
// Dos formatos, según lo que significa la columna:
//   · `FECHA DE PAGO` es un DÍA. Sin hora — pedido expreso: "no quiero que
//     lleve hora, solo fecha".
//   · El resto (`FECHA REGISTRO`, `ULTIMO ACCESO`, …) son INSTANTES: llevan
//     hora, y se necesita para ordenar los pagos del mismo día.
//
// El formato se aplica a toda la columna por debajo del encabezado, así las
// filas nuevas lo heredan.

const { google } = require('googleapis');
const { nombresDeHojas, leerHojas } = require('./src/hojas');
const { credenciales, idDocumento } = require('./src/credenciales');
const { COLUMNAS_FECHA } = require('./src/fechas-sheets');

const APLICAR = process.argv.indexOf('--aplicar') !== -1;

// Día, sin hora.
const SOLO_DIA = ['FECHA DE PAGO'];

const esFecha = h => COLUMNAS_FECHA.indexOf(String(h || '').trim().toUpperCase()) !== -1;

(async () => {
  const auth = new google.auth.GoogleAuth({
    credentials: credenciales(), scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const api = google.sheets({ version: 'v4', auth: await auth.getClient() });

  const meta = await api.spreadsheets.get({
    spreadsheetId: idDocumento(),
    fields: 'sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))'
  });
  const hojas = {};
  (meta.data.sheets || []).forEach(x => { hojas[x.properties.title] = x.properties; });

  const nombres = await nombresDeHojas(true);
  const datos   = await leerHojas(nombres, true);

  const requests = [];
  console.log(APLICAR ? '\nAPLICANDO FORMATO\n' : '\nSIMULACION — agregá --aplicar para escribir.\n');
  console.log('hoja'.padEnd(27) + 'columna'.padEnd(18) + 'formato');
  console.log('-'.repeat(62));

  nombres.forEach(n => {
    const enc = (datos[n] || [])[0] || [];
    const props = hojas[n];
    if (!props) return;
    enc.forEach((h, c) => {
      if (!esFecha(h)) return;
      const soloDia = SOLO_DIA.indexOf(String(h).trim().toUpperCase()) !== -1;
      const patron  = soloDia ? 'dd/mm/yyyy' : 'dd/mm/yyyy hh:mm:ss';
      console.log(n.padEnd(27) + String(h).padEnd(18) + patron);
      requests.push({ repeatCell: {
        range: { sheetId: props.sheetId, startRowIndex: 1,
                 startColumnIndex: c, endColumnIndex: c + 1 },
        cell: { userEnteredFormat: { numberFormat: {
          type: soloDia ? 'DATE' : 'DATE_TIME', pattern: patron
        } } },
        fields: 'userEnteredFormat.numberFormat'
      } });
    });
  });

  console.log('-'.repeat(62));
  console.log('columnas a formatear: ' + requests.length + (APLICAR ? '' : '  (simulacion)'));

  if (APLICAR && requests.length) {
    await api.spreadsheets.batchUpdate({ spreadsheetId: idDocumento(), requestBody: { requests: requests } });
    console.log('formato aplicado');
  }
  process.exit(0);
})().catch(err => { console.error('\nFALLO: ' + err.message); process.exit(1); });
