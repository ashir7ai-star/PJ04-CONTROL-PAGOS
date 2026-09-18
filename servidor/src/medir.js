// Mide cuánto tarda leer TODAS las hojas del documento real con la API de
// Sheets, para compararlo contra lo que medimos de Apps Script.
//
// Solo LEE. No escribe ni modifica nada.
//
// Referencia medida contra este mismo documento el 2026-09-18, vía Apps Script:
//   arranque sin sesión ......  2 ms de servidor + 2.100 ms de transporte
//   leyendo UNA sola hoja ....  2.085 ms de servidor + 3.054 ms de transporte
//   consultar_saldos .........  33.810 ms de transporte (peor caso observado)
//
// Uso:
//   cd servidor
//   npm install
//   SHEETS_ID=... GOOGLE_CREDENCIALES_ARCHIVO=../credenciales.json npm run medir

const { nombresDeHojas, leerHojas, idDocumento } = require('./hojas');

const ms = (a, b) => (Number(b - a) / 1e6).toFixed(0);

async function main() {
  console.log('Documento: ' + idDocumento());
  console.log('');

  const t0 = process.hrtime.bigint();
  const nombres = await nombresDeHojas(true);
  const t1 = process.hrtime.bigint();
  console.log('Pestañas encontradas (' + nombres.length + ') en ' + ms(t0, t1) + ' ms:');
  console.log('  ' + nombres.join(' · '));
  console.log('');

  // Tres corridas: la primera incluye negociar el token de autenticación, que
  // se paga UNA vez y después queda en memoria. Medir solo la primera daría un
  // número pesimista que no es el que va a ver el usuario.
  const tiempos = [];
  let datos = null;
  for (let i = 1; i <= 3; i++) {
    const a = process.hrtime.bigint();
    datos = await leerHojas(nombres, true);
    const b = process.hrtime.bigint();
    tiempos.push(Number(ms(a, b)));
    console.log('Lectura ' + i + ' de las ' + nombres.length + ' hojas: ' + ms(a, b) + ' ms');
  }

  console.log('');
  let filas = 0, celdas = 0;
  nombres.forEach(n => {
    const f = datos[n] || [];
    filas += f.length;
    f.forEach(fila => { celdas += fila.length; });
  });

  const enCaliente = tiempos.slice(1);
  const promedio = enCaliente.reduce((s, t) => s + t, 0) / enCaliente.length;

  console.log('Datos leídos: ' + filas + ' filas, ' + celdas + ' celdas, en UNA llamada HTTP.');
  console.log('');
  console.log('RESULTADO');
  console.log('  primera lectura (incluye autenticación): ' + tiempos[0] + ' ms');
  console.log('  lecturas siguientes (promedio):          ' + promedio.toFixed(0) + ' ms');
  console.log('');
  console.log('COMPARACIÓN con Apps Script, medida contra este mismo documento:');
  console.log('  Apps Script, UNA sola hoja: 2.085 ms de servidor + 3.054 ms de transporte');
  console.log('  Apps Script, peor caso:     33.810 ms');
  console.log('  Acá: TODAS las hojas en ' + promedio.toFixed(0) + ' ms');
  console.log('');
  console.log('Falta sumar el viaje del navegador al servidor propio (~50-150 ms),');
  console.log('que reemplaza los DOS saltos de Apps Script.');
}

main().catch(err => {
  console.error('');
  console.error('FALLÓ: ' + err.message);
  if (/permission|forbidden|403/i.test(err.message)) {
    console.error('');
    console.error('Suele ser que el documento no está compartido con la cuenta de servicio.');
    console.error('Compartilo con el correo que figura como "client_email" en el archivo');
    console.error('de credenciales, con permiso de Lector para esta prueba.');
  }
  if (/not found|404/i.test(err.message)) {
    console.error('');
    console.error('Revisá SHEETS_ID: es la parte larga de la URL del documento,');
    console.error('entre /d/ y /edit.');
  }
  process.exit(1);
});
