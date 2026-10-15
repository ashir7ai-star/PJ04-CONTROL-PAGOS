// Crea la columna EQUIPO y marca como Equipo 1 todos los viáticos que ya
// existen.
//
// Uso:
//   node asignar-equipo-1.js            (simula: no toca nada)
//   node asignar-equipo-1.js --aplicar
//
// ─── Por qué ──────────────────────────────────────────────────────────────
//
// El 15/10/2026 se formó el Equipo 2 y los viáticos pasaron a controlarse por
// equipo, cada uno con su presupuesto diario. Todo lo registrado antes fue del
// Equipo 1, porque era el único que existía.
//
// Decisión del usuario: marcarlos, en vez de dejarlos "sin equipo". Así
// cualquier consulta hacia atrás muestra números completos en lugar de un
// bloque huérfano que el panel tendría que arrastrar para siempre.
//
// ─── Qué NO hace ──────────────────────────────────────────────────────────
//
// No toca filas que YA tengan equipo: si alguien registró con el sistema nuevo
// mientras tanto, ese dato vale más que esta suposición.
//
// Y no toca las otras hojas de pagos. La columna se crea en todas —los
// reportes mapean cada hoja con los encabezados de la principal, y una columna
// que falte produce celdas `undefined` que rompen el PDF— pero solo Viáticos
// lleva equipo.

const fs   = require('fs');
const path = require('path');
const { nombresDeHojas, leerHojas } = require('./src/hojas');
const esc  = require('./src/escribir');
const cupo = require('./src/cupo-lecturas');

const APLICAR = process.argv.indexOf('--aplicar') !== -1;
const EQUIPO_INICIAL = 'equipo_1';

const NO_PAGOS = ['USUARIOS', 'SALDOS', 'TRASLADOS', 'SESIONES', 'PRESUPUESTO',
                  'SOLICITUDES DE APROBACION'];

const esLibre = h => h === '' || /^Column \d+$/i.test(String(h));

(async () => {
  const nombres = await nombresDeHojas(true);
  const crudo   = await leerHojas(nombres, true);

  console.log(APLICAR ? '\nAPLICANDO\n'
                      : '\nSIMULACION - no se toca nada. Agrega --aplicar para escribir.\n');

  const cambios = [];
  let columnasCreadas = 0, marcados = 0, yaTenian = 0;

  for (const hoja of Object.keys(crudo)) {
    if (NO_PAGOS.some(n => hoja.toUpperCase().indexOf(n) !== -1)) continue;
    const filas = crudo[hoja] || [];
    const enc = (filas[0] || []).map(String);
    if (enc.indexOf('VALOR FACTURA') === -1) continue;

    // La columna va en TODAS las hojas de pago, aunque solo Viaticos la use.
    let cEquipo = enc.indexOf('EQUIPO');
    if (cEquipo === -1) {
      // Se reusa un hueco libre antes de agrandar la hoja, igual que
      // asegurarColumnas_ en el backend.
      const hueco = enc.findIndex(esLibre);
      cEquipo = hueco !== -1 ? hueco : enc.length;
      cambios.push({ tipo: 'escribir', hoja: hoja, fila: 1, col: cEquipo + 1,
                     valores: [['EQUIPO']] });
      columnasCreadas++;
      console.log('  + columna EQUIPO en "' + hoja + '" (columna ' + (cEquipo + 1) + ')');
    }

    // Solo Viaticos lleva equipo.
    if (hoja !== 'Viaticos') continue;

    for (let i = 1; i < filas.length; i++) {
      const fila = filas[i] || [];
      if (!fila.some(v => v !== '' && v != null)) continue;

      const actual = String(fila[cEquipo] || '').trim();
      if (actual) { yaTenian++; continue; }   // registrado ya con el sistema nuevo

      marcados++;
      cambios.push({ tipo: 'escribir', hoja: hoja, fila: i + 1, col: cEquipo + 1,
                     valores: [[EQUIPO_INICIAL]] });
    }
  }

  console.log('');
  console.log('viaticos a marcar como ' + EQUIPO_INICIAL + ': ' + marcados);
  if (yaTenian) console.log('viaticos que YA tenian equipo (no se tocan): ' + yaTenian);
  console.log('columnas a crear: ' + columnasCreadas + ' | celdas a escribir: ' + cambios.length);

  if (!APLICAR) {
    console.log('\nNada fue modificado. Revisa el resumen y corre con --aplicar.');
    return;
  }
  if (!cambios.length) { console.log('\nNo hay nada que cambiar.'); return; }

  // ─── Respaldo ANTES de escribir ───
  // Acá se pisa una columna de la contabilidad. Es una columna nueva, así que
  // el respaldo guarda cuáles filas estaban vacías: sin eso no se podria
  // distinguir lo que puso esta migración de lo que cargó una persona.
  const respaldo = { fecha: new Date().toISOString(), equipo: EQUIPO_INICIAL, filas: [] };
  cambios.filter(c => c.fila > 1).forEach(c => {
    respaldo.filas.push({ hoja: c.hoja, fila: c.fila, col: c.col, valorAnterior: '' });
  });
  const destino = path.join(__dirname, 'respaldo-equipo.json');
  fs.writeFileSync(destino, JSON.stringify(respaldo, null, 2), 'utf8');
  console.log('\nrespaldo de ' + respaldo.filas.length + ' celdas en:');
  console.log('  ' + destino);

  cupo.reiniciar();
  await esc.aplicar(cambios);
  console.log('\naplicado: ' + cupo.usadas() + ' lecturas + ' + cupo.escriturasUsadas() + ' escrituras');
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
