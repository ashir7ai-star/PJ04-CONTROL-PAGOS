// Clasifica por RUBRO los viáticos que se registraron antes de que el campo
// existiera.
//
// Uso:
//   node clasificar-rubros.js            (simula: no toca nada)
//   node clasificar-rubros.js --aplicar
//
// ─── Por qué se puede hacer ───────────────────────────────────────────────
//
// El nombre del pago ya venía diciendo el rubro: de 158 viáticos, 31 textos
// distintos y los más frecuentes son literalmente "CENA", "DESAYUNO",
// "ALMUERZO", "HIDRATACION", "PEAJE", "HOSPEDAJE", "PARQUEADERO".
//
// ⚠️ Solo se clasifica lo que coincide SIN AMBIGÜEDAD. Lo que no coincide se
// deja vacío y se lista: preferimos un dato sin clasificar a uno clasificado
// mal. Adivinar acá sería meter ruido en la contabilidad para que un gráfico
// se vea completo.

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { nombresDeHojas, leerHojas } = require('./src/hojas');
const { convertirFoto } = require('./src/fechas-sheets');
const { crearEntorno } = require('./src/entorno');
const esc  = require('./src/escribir');
const cupo = require('./src/cupo-lecturas');

const APLICAR = process.argv.indexOf('--aplicar') !== -1;

// Cada regla es: si el nombre del pago CONTIENE alguna de estas palabras.
// El orden importa: la primera que coincide gana.
//
// Las erratas que aparecen al final de cada lista salen de mirar los datos
// reales, no de adivinar: "HRITACIÓN" y "HOSTEDAJE" están escritas así en la
// hoja y la intención es inequívoca. Se dejan anotadas para que se vea que son
// correcciones puntuales y no una regla general.
const REGLAS = [
  ['desayuno',    ['DESAYUNO']],
  ['almuerzo',    ['ALMUERZO']],
  ['cena',        ['CENA']],
  ['hidratacion', ['HIDRATACION', 'HIDRATACIÓN', 'AGUA', 'GATORADE', 'HRITACIÓN', 'HRITACION']],
  ['alojamiento', ['HOSPEDAJE', 'HOTEL', 'ALOJAMIENTO', 'HOSTEDAJE']],
  ['combustible', ['GASOLINA', 'COMBUSTIBLE', 'ACPM', 'DIESEL']],
  ['peajes',      ['PEAJE']],
  ['parqueadero', ['PARQUEADERO', 'PARQUEO']],
  ['transporte',  ['TRANSPORTE', 'TAXI', 'PASAJE', 'BUS ']]
];

function rubroDe(nombre) {
  const n = String(nombre || '').trim().toUpperCase();
  if (!n) return '';
  for (const [clave, palabras] of REGLAS) {
    for (const p of palabras) if (n.indexOf(p) !== -1) return clave;
  }
  return '';
}

(async () => {
  const nombres = await nombresDeHojas(true);
  const crudo   = await leerHojas(nombres, true);

  // La lógica real, para usar exactamente los mismos rubros que el sistema.
  const e = crearEntorno(convertirFoto(crudo, 'America/Bogota'), { sinDrive: true });
  vm.createContext(e.globales);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script.gs'), 'utf8'), e.globales);

  const filas = crudo['Viaticos'] || [];
  if (!filas.length) { console.log('La hoja Viaticos está vacía.'); process.exit(0); }

  const enc    = filas[0].map(String);
  const cNom   = enc.indexOf('NOMBRE DE PAGO');
  const cRubro = enc.indexOf('RUBRO');
  const cValor = enc.indexOf('VALOR FACTURA');

  if (cRubro === -1) {
    console.log('\nLa columna RUBRO todavía no existe en Viaticos.');
    console.log('Se crea sola la primera vez que alguien registre un viático con el sistema nuevo,');
    console.log('o desplegando el backend actualizado. Volvé a correr esto después.');
    process.exit(1);
  }

  console.log(APLICAR ? '\nCLASIFICANDO\n' : '\nSIMULACION — no se toca nada. Agregá --aplicar para escribir.\n');

  const cambios = [];
  const porRubro = {};
  const sinClasificar = {};

  for (let i = 1; i < filas.length; i++) {
    const fila = filas[i] || [];
    if (!fila.some(v => v !== '' && v != null)) continue;
    // Lo que ya tiene rubro no se toca: puede haberlo elegido una persona.
    if (String(fila[cRubro] || '').trim()) continue;

    const nombre = fila[cNom];
    const clave  = rubroDe(nombre);
    const valor  = Number(fila[cValor]) || 0;

    if (!clave || !e.globales.rubroValido_(clave)) {
      const k = String(nombre || '(vacío)').trim().toUpperCase().slice(0, 44);
      sinClasificar[k] = (sinClasificar[k] || 0) + 1;
      continue;
    }

    porRubro[clave] = porRubro[clave] || { n: 0, v: 0 };
    porRubro[clave].n++;
    porRubro[clave].v += valor;
    cambios.push({ tipo: 'escribir', hoja: 'Viaticos', fila: i + 1, col: cRubro + 1, valores: [[clave]] });
  }

  console.log('rubro'.padEnd(16) + 'pagos'.padStart(7) + 'valor'.padStart(16));
  console.log('-'.repeat(40));
  Object.keys(porRubro).sort().forEach(k =>
    console.log(k.padEnd(16) + String(porRubro[k].n).padStart(7) +
                ('$' + Math.round(porRubro[k].v).toLocaleString('es-CO')).padStart(16)));
  console.log('-'.repeat(40));
  console.log('a clasificar: ' + cambios.length + ' pagos');

  const sueltos = Object.entries(sinClasificar).sort((a, b) => b[1] - a[1]);
  if (sueltos.length) {
    console.log('');
    console.log('SE DEJAN SIN RUBRO (no coinciden con ninguna regla):');
    sueltos.forEach(([k, n]) => console.log('  ' + String(n).padStart(3) + ' x  ' + k));
  }

  if (APLICAR && cambios.length) {
    cupo.reiniciar();
    await esc.aplicar(cambios);
    console.log('');
    console.log('aplicado: ' + cupo.usadas() + ' lecturas + ' + cupo.escriturasUsadas() + ' escrituras');

    const otra = (await leerHojas(['Viaticos'], true))['Viaticos'] || [];
    let con = 0, sin = 0;
    for (let i = 1; i < otra.length; i++) {
      const f = otra[i] || [];
      if (!f.some(v => v !== '' && v != null)) continue;
      if (String(f[cRubro] || '').trim()) con++; else sin++;
    }
    console.log('verificación: ' + con + ' pagos con rubro, ' + sin + ' sin rubro');
  }
  process.exit(0);
})().catch(err => { console.error('\nFALLO: ' + err.message); process.exit(1); });
