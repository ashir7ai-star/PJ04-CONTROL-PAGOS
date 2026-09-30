// Unifica REGISTRADO POR contra las cuentas reales, y llena CORREO REGISTRO.
//
// Uso:
//   node unificar-registrado-por.js            (simula: no toca nada)
//   node unificar-registrado-por.js --aplicar
//
// ─── Por qué hace falta ───────────────────────────────────────────────────
//
// Hasta el 2026-09-30 el servidor escribía en REGISTRADO POR el texto que le
// mandara el navegador, sin contrastarlo con quién estaba autenticado. Medido
// sobre 275 pagos: 11 formas de escribir 6 personas, y 150 pagos (55%) a
// nombre de alguien que no coincide con ninguna cuenta. Uno de los valores
// traía un emoji en el nombre.
//
// El backend ya no permite eso. Esto arregla lo que quedó escrito antes.
//
// ─── Qué NO hace ──────────────────────────────────────────────────────────
//
// No adivina. Solo unifica lo que se puede resolver SIN AMBIGÜEDAD:
//
//   1. el nombre coincide exacto con el de una cuenta;
//   2. coincide exacto después de quitarle emojis y símbolos;
//   3. es UNA SOLA palabra y es el nombre de pila de exactamente una cuenta
//      ("Nathan", "Sandra");
//   4. coincide con la parte local del correo de exactamente una cuenta,
//      sin los dígitos ("yedidiah" -> yedidiah20@gmail.com);
//   5. está en ALIAS, la lista de equivalencias confirmadas a mano.
//
// Un valor de dos o más palabras con un apellido que no coincide NO se
// resuelve por nombre de pila: "Laura Castillo" y "Laura Leyton" comparten el
// nombre pero podrían ser dos personas distintas. Eso se confirma con alguien
// y se anota en ALIAS; no se deduce. Lo que no se resuelve se deja como está
// y se lista al final.

const { nombresDeHojas, leerHojas } = require('./src/hojas');
const esc  = require('./src/escribir');
const cupo = require('./src/cupo-lecturas');

const APLICAR = process.argv.indexOf('--aplicar') !== -1;

// Equivalencias CONFIRMADAS por una persona, no deducidas por el programa.
// Clave: el texto como está en la hoja, normalizado. Valor: el correo.
const ALIAS = {
  // Confirmado por Nathan el 2026-09-30: es la misma persona, se le registró
  // con el apellido equivocado durante meses. Son 75 pagos.
  'laura castillo': 'sst@energy-millennium.com'
};

// Hojas que no son de pagos. Su REGISTRADO POR ya lo escribe el servidor desde
// la sesión, así que no hay nada que unificar.
const NO_PAGOS = ['USUARIOS', 'SALDOS', 'TRASLADOS', 'SESIONES', 'PRESUPUESTO',
                  'SOLICITUDES DE APROBACION'];

const norm = s => String(s || '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');

// Además de acentos, saca todo lo que no sea letra o espacio: así
// "Laura Leyton❤️‍🩹" cae en el mismo cajón que "Laura Leyton".
const limpio = s => norm(s).replace(/[^a-zñ ]/g, '').replace(/\s+/g, ' ').trim();

const esLibre = h => h === '' || /^Column \d+$/i.test(String(h));

(async () => {
  const nombres = await nombresDeHojas(true);
  const crudo   = await leerHojas(nombres, true);

  // ─── Las cuentas que existen de verdad ───
  const filasU = crudo['USUARIOS'] || [];
  const encU   = (filasU[0] || []).map(String);
  const iC = encU.indexOf('CORREO');
  const iN = encU.indexOf('NOMBRE');
  if (iC === -1) {
    console.log('La hoja USUARIOS no tiene columna CORREO.');
    process.exit(1);
  }

  const cuentas = [];
  filasU.slice(1).forEach(f => {
    const correo = String(f[iC] || '').trim();
    if (!correo) return;
    cuentas.push({ correo: correo, nombre: String(f[iN] || '').trim() || correo });
  });

  const porNombre = new Map();   // nombre completo limpio -> [cuentas]
  const porPila   = new Map();   // nombre de pila         -> [cuentas]
  const porCorreo = new Map();   // parte local del correo -> [cuentas]
  cuentas.forEach(c => {
    const n = limpio(c.nombre);
    if (!porNombre.has(n)) porNombre.set(n, []);
    porNombre.get(n).push(c);

    const pila = n.split(' ')[0];
    if (!porPila.has(pila)) porPila.set(pila, []);
    porPila.get(pila).push(c);

    // La parte local del correo, sin dígitos. Es un dato de la cuenta, no una
    // corazonada: si el correo dice "yedidiah20", esa persona se escribe con h
    // aunque en USUARIOS el NOMBRE haya quedado sin ella.
    const local = limpio(String(c.correo).split('@')[0].replace(/[0-9]/g, ''));
    if (local) {
      if (!porCorreo.has(local)) porCorreo.set(local, []);
      porCorreo.get(local).push(c);
    }
  });

  // Resuelve un texto a una cuenta, o null si no es inequívoco.
  function resolver(valor) {
    const n = norm(valor);
    const l = limpio(valor);
    if (!l) return null;

    if (ALIAS[n]) {
      const c = cuentas.filter(x => x.correo.toLowerCase() === ALIAS[n]);
      return c.length === 1 ? { cuenta: c[0], via: 'alias confirmado' } : null;
    }

    const exacto = porNombre.get(l);
    if (exacto && exacto.length === 1) {
      return { cuenta: exacto[0], via: n === l ? 'nombre exacto' : 'exacto sin simbolos' };
    }

    // Una sola palabra: puede ser el nombre de pila, si no se repite.
    if (l.indexOf(' ') === -1) {
      const pila = porPila.get(l);
      if (pila && pila.length === 1) return { cuenta: pila[0], via: 'nombre de pila unico' };

      // Último recurso, y sigue siendo evidencia: coincide con la parte local
      // del correo de UNA sola cuenta. Desempata "yedidiah" (15 pagos), que no
      // coincide con el NOMBRE "Yedidia Bivas" por una letra, pero sí con
      // yedidiah20@gmail.com. Con dos cuentas "joseph@" no resuelve nada, que
      // es lo correcto.
      const local = porCorreo.get(l);
      if (local && local.length === 1) return { cuenta: local[0], via: 'local del correo' };
    }
    return null;
  }

  console.log(APLICAR ? '\nUNIFICANDO\n'
                      : '\nSIMULACION - no se toca nada. Agrega --aplicar para escribir.\n');

  const cambios = [];
  const resumen = new Map();
  const sinResolver = new Map();
  let columnasCreadas = 0;
  let filasTotal = 0;

  for (const hoja of Object.keys(crudo)) {
    if (NO_PAGOS.some(n => hoja.toUpperCase().indexOf(n) !== -1)) continue;
    const filas = crudo[hoja] || [];
    const enc = (filas[0] || []).map(String);
    const cQuien = enc.indexOf('REGISTRADO POR');
    if (cQuien === -1) continue;

    // ─── La columna nueva tiene que existir en TODAS las hojas de pago ───
    // Los reportes mapean cada hoja con los encabezados de la primera; una
    // hoja a la que le falte una columna produce celdas `undefined` que hacen
    // fallar el PDF sin avisar. Ya pasó con ID REGISTRO y con RUBRO.
    let cCorreo = enc.indexOf('CORREO REGISTRO');
    if (cCorreo === -1) {
      // Se reusa un hueco libre antes de agrandar la hoja, igual que
      // asegurarColumnas_ en el backend.
      const hueco = enc.findIndex(esLibre);
      cCorreo = hueco !== -1 ? hueco : enc.length;
      cambios.push({ tipo: 'escribir', hoja: hoja, fila: 1, col: cCorreo + 1,
                     valores: [['CORREO REGISTRO']] });
      columnasCreadas++;
      console.log('  + columna CORREO REGISTRO en "' + hoja + '" (columna ' + (cCorreo + 1) + ')');
    }

    for (let i = 1; i < filas.length; i++) {
      const fila = filas[i] || [];
      if (!fila.some(v => v !== '' && v != null)) continue;
      filasTotal++;

      const actual = String(fila[cQuien] || '').trim();
      const r = resolver(actual);
      if (!r) {
        const k = actual || '(vacio)';
        sinResolver.set(k, (sinResolver.get(k) || 0) + 1);
        continue;
      }

      const correoActual = String(fila[cCorreo] || '').trim();
      const k = actual + ' -> ' + r.cuenta.nombre;
      if (!resumen.has(k)) resumen.set(k, { n: 0, via: r.via });
      resumen.get(k).n++;

      if (actual !== r.cuenta.nombre) {
        cambios.push({ tipo: 'escribir', hoja: hoja, fila: i + 1, col: cQuien + 1,
                       valores: [[r.cuenta.nombre]] });
      }
      if (correoActual.toLowerCase() !== r.cuenta.correo.toLowerCase()) {
        cambios.push({ tipo: 'escribir', hoja: hoja, fila: i + 1, col: cCorreo + 1,
                       valores: [[r.cuenta.correo]] });
      }
    }
  }

  console.log('');
  console.log('como esta'.padEnd(26) + 'queda como'.padEnd(26) + 'pagos'.padStart(6) + '   por que');
  console.log('-'.repeat(88));
  [...resumen.entries()].sort((a, b) => b[1].n - a[1].n).forEach(([k, v]) => {
    const partes = k.split(' -> ');
    console.log(partes[0].padEnd(26) + partes[1].padEnd(26) +
                String(v.n).padStart(6) + '   ' + v.via);
  });

  if (sinResolver.size) {
    console.log('');
    console.log('SE DEJAN COMO ESTAN (no se resuelven sin adivinar):');
    [...sinResolver.entries()].sort((a, b) => b[1] - a[1])
      .forEach(([k, n]) => console.log('  ' + String(n).padStart(4) + ' x  "' + k + '"'));
  }

  console.log('');
  console.log('filas de pago: ' + filasTotal +
              ' | columnas a crear: ' + columnasCreadas +
              ' | celdas a escribir: ' + cambios.length);

  if (!APLICAR) {
    console.log('\nNada fue modificado. Revisa el cuadro de arriba y corre con --aplicar.');
    return;
  }
  if (!cambios.length) {
    console.log('\nNo hay nada que cambiar.');
    return;
  }

  cupo.reiniciar();
  await esc.aplicar(cambios);
  console.log('\naplicado: ' + cupo.usadas() + ' lecturas + ' + cupo.escriturasUsadas() + ' escrituras');
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
