// Compara las respuestas de Apps Script y del servidor propio, con DATOS
// REALES, antes de mover a los usuarios.
//
// Uso:
//   cd servidor
//   node comparar-backends.js
//
// ─── Por qué existe ───────────────────────────────────────────────────────
//
// Cada pieza se probó por separado, pero nunca las dos rutas completas contra
// los mismos datos. Y los errores que más caro salieron en este proyecto no
// daban error: daban un número distinto. El problema de día/mes pasó las
// pruebas, funcionó en producción y estuvo mal durante días.
//
// Un comparador lo habría encontrado en minutos: misma pregunta, dos
// respuestas, cualquier diferencia salta.
//
// ─── Sobre la sesión temporal ─────────────────────────────────────────────
//
// Las consultas que importan exigen sesión, y no se puede generar una desde
// afuera. Se crea una en la hoja SESIONES con token aleatorio y vencimiento de
// 10 minutos, y se BORRA al terminar — incluso si algo falla en el medio.

const crypto = require('crypto');
const { google } = require('googleapis');

const APPS_SCRIPT = process.env.URL_APPS_SCRIPT ||
  'https://script.google.com/macros/s/AKfycbwngWbZFP9c0Rn5u5efkTNRM1zBlK_wKQ8TaE-kbFCz8FXN85-KahlkkVXab6x5YPoS1A/exec';
const PROPIO = process.env.URL_PROPIO ||
  'https://ashir-pj04-pagos-api.nr6aco.easypanel.host';

const CORREO_PRUEBA = process.env.CORREO_PRUEBA || 'nathan@ylevigroup.com';
const MINUTOS = 10;

// Lo que cambia legítimamente entre dos llamadas y NO es una diferencia real.
const VOLATILES = ['ms', 'hojasLeidas', 'medicion', 'revision', 'sesionToken', 'foto'];

// ─── Comparación ──────────────────────────────────────────────────────────

function comparar(a, b, ruta, difs) {
  ruta = ruta || '';
  difs = difs || [];

  const clave = ruta.split('.').pop().split('[')[0];
  if (VOLATILES.indexOf(clave) !== -1) return difs;

  const tipo = (x) => Array.isArray(x) ? 'arreglo' : (x === null ? 'nulo' : typeof x);

  if (tipo(a) !== tipo(b)) {
    difs.push({ ruta: ruta || '(raíz)', appsScript: tipo(a), propio: tipo(b), que: 'tipo distinto' });
    return difs;
  }

  if (Array.isArray(a)) {
    if (a.length !== b.length) {
      difs.push({ ruta: ruta + '.length', appsScript: a.length, propio: b.length, que: 'cantidad distinta' });
    }
    for (let i = 0; i < Math.min(a.length, b.length); i++) comparar(a[i], b[i], ruta + '[' + i + ']', difs);
    return difs;
  }

  if (a && typeof a === 'object') {
    const claves = Array.from(new Set(Object.keys(a).concat(Object.keys(b))));
    claves.forEach(k => {
      if (VOLATILES.indexOf(k) !== -1) return;
      if (!(k in a)) { difs.push({ ruta: ruta + '.' + k, appsScript: '(falta)', propio: b[k], que: 'solo en el propio' }); return; }
      if (!(k in b)) { difs.push({ ruta: ruta + '.' + k, appsScript: a[k], propio: '(falta)', que: 'solo en Apps Script' }); return; }
      comparar(a[k], b[k], ruta + '.' + k, difs);
    });
    return difs;
  }

  if (a !== b) difs.push({ ruta: ruta || '(raíz)', appsScript: a, propio: b, que: 'valor distinto' });
  return difs;
}

// ─── Llamadas ─────────────────────────────────────────────────────────────

async function pedir(url, cuerpo) {
  const a = Date.now();
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(cuerpo)
  });
  const texto = await r.text();
  const ms = Date.now() - a;
  try {
    return { datos: JSON.parse(texto), ms };
  } catch (err) {
    return { datos: { _noEsJson: texto.slice(0, 200) }, ms };
  }
}

// ─── Sesión temporal ──────────────────────────────────────────────────────

async function hojas() {
  const { credenciales, idDocumento } = require('./src/credenciales');
  const auth = new google.auth.GoogleAuth({
    credentials: credenciales(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return { api: google.sheets({ version: 'v4', auth: await auth.getClient() }), id: idDocumento() };
}

async function crearSesion() {
  const { api, id } = await hojas();
  // El mismo hash que calcula la lógica: base64 del SHA-256 del token.
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
  const hash  = crypto.createHash('sha256').update(token, 'utf8').digest('base64');
  const ahora = new Date();
  const vence = new Date(ahora.getTime() + MINUTOS * 60000);

  await api.spreadsheets.values.append({
    spreadsheetId: id,
    range: "'SESIONES'",
    valueInputOption: 'RAW',   // las fechas van como texto ISO, igual que la lógica
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [[hash, CORREO_PRUEBA.toLowerCase(),
                             ahora.toISOString(), ahora.toISOString(), vence.toISOString()]] }
  });

  return { token, hash };
}

async function borrarSesion(hash) {
  const { api, id } = await hojas();
  const meta = await api.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties(sheetId,title)' });
  const h = (meta.data.sheets || []).filter(x => x.properties.title === 'SESIONES')[0];
  if (!h) return false;

  const valores = (await api.spreadsheets.values.get({
    spreadsheetId: id, range: "'SESIONES'"
  })).data.values || [];

  // De abajo hacia arriba: borrar una fila corre las de abajo, y hacerlo al
  // revés borraría la equivocada.
  let borradas = 0;
  for (let i = valores.length - 1; i >= 1; i--) {
    if (String(valores[i][0]) !== hash) continue;
    await api.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: { requests: [{ deleteDimension: { range: {
        sheetId: h.properties.sheetId, dimension: 'ROWS', startIndex: i, endIndex: i + 1
      } } }] }
    });
    borradas++;
  }
  return borradas;
}

// ─── Programa ─────────────────────────────────────────────────────────────

const CONSULTAS = [
  { nombre: 'arranque',              cuerpo: { action: 'arranque' } },
  { nombre: 'consultar_saldos',      cuerpo: { action: 'consultar_saldos' } },
  { nombre: 'consultar_pagos',       cuerpo: { action: 'consultar_pagos' } },
  { nombre: 'consultar_solicitudes', cuerpo: { action: 'consultar_solicitudes' } },
  { nombre: 'listar_usuarios',       cuerpo: { action: 'listar_usuarios' } },
  { nombre: 'consultar_traslados',   cuerpo: { action: 'consultar_traslados' } }
];

async function main() {
  console.log('Comparando:');
  console.log('  Apps Script : ' + APPS_SCRIPT.slice(0, 60) + '...');
  console.log('  Propio      : ' + PROPIO);
  console.log('  Sesión de   : ' + CORREO_PRUEBA + ' (temporal, ' + MINUTOS + ' min)');
  console.log('');

  const sesion = await crearSesion();
  console.log('Sesión temporal creada.\n');

  let totalDifs = 0;
  try {
    for (const c of CONSULTAS) {
      const cuerpo = Object.assign({}, c.cuerpo, { sesionToken: sesion.token });

      // Apps Script primero: si algo escribe, que el propio lea el estado ya
      // actualizado y no al revés.
      const a = await pedir(APPS_SCRIPT, cuerpo);
      const b = await pedir(PROPIO, cuerpo);

      const difs = comparar(a.datos, b.datos);
      totalDifs += difs.length;

      const marca = difs.length === 0 ? 'IGUAL  ' : 'DISTINTO';
      console.log(marca + '  ' + c.nombre.padEnd(22) +
                  'AppsScript ' + String(a.ms).padStart(6) + ' ms' +
                  '   propio ' + String(b.ms).padStart(5) + ' ms' +
                  (a.ms > 0 ? '   (' + (a.ms / Math.max(b.ms, 1)).toFixed(1) + 'x)' : ''));

      difs.slice(0, 8).forEach(d => {
        const corto = (v) => { const s = JSON.stringify(v); return s && s.length > 60 ? s.slice(0, 60) + '…' : s; };
        console.log('          ' + d.ruta + '  [' + d.que + ']');
        console.log('            AppsScript: ' + corto(d.appsScript));
        console.log('            propio    : ' + corto(d.propio));
      });
      if (difs.length > 8) console.log('          ... y ' + (difs.length - 8) + ' diferencias más');
    }
  } finally {
    // Pase lo que pase, la sesión temporal se borra.
    const n = await borrarSesion(sesion.hash);
    console.log('\nSesión temporal borrada (' + n + ' fila).');
  }

  console.log('');
  console.log(totalDifs === 0
    ? 'SIN DIFERENCIAS: los dos sistemas responden exactamente lo mismo.'
    : 'HAY ' + totalDifs + ' DIFERENCIA(S). Revisar antes de conmutar.');
  process.exit(totalDifs === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('\nFALLÓ: ' + (err && err.message));
  process.exit(2);
});
