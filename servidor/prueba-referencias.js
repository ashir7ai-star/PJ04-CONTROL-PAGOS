// Busca identificadores USADOS pero nunca DECLARADOS en index.html.
// Uso: node prueba-referencias.js
//
// ─── Por qué existe ───────────────────────────────────────────────────────
//
// El 27/09, al reescribir el componente de subida, reemplacé el bloque entero
// desde su comentario de cabecera — y ahí adentro estaban `svgFile`, `svgImage`
// y `svgTrash`. Quedaron cuatro usos y ninguna declaración.
//
// `const` no se eleva: al pintar la lista de archivos saltaba
// "svgImage is not defined", el archivo elegido no aparecía y **nadie pudo
// registrar un pago durante un día entero**.
//
// Las 295 comprobaciones pasaban igual, porque el único control que había era
// `new Function(codigo)`: eso valida **sintaxis**, no que los identificadores
// existan. Un ReferenceError solo aparece al EJECUTAR esa línea — y esa línea
// solo se ejecuta cuando alguien adjunta un archivo.
//
// ─── Qué mira, y por qué solo eso ─────────────────────────────────────────
//
// Revisar todo el archivo sin un analizador de verdad da cientos de falsos
// positivos. Se mira donde el riesgo es real y el ruido, mínimo: los
// identificadores dentro de `${...}` en plantillas. Ahí es donde se arma el
// HTML, donde vivía este error, y donde un nombre inexistente no se nota hasta
// que un usuario toca el botón.

const fs = require('fs');
const path = require('path');

let fallos = 0;
function chk(nombre, cond, detalle) {
  console.log((cond ? '  ok   ' : '  FALLA') + '  ' + nombre +
              (cond ? '' : '  → ' + JSON.stringify(detalle)));
  if (!cond) fallos++;
}

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const bloques = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)];
const codigo = bloques.map(b => b[1]).join('\n');

// Nombres que el propio archivo declara.
const declarados = new Set();
const patrones = [
  /\bfunction\s+([A-Za-z_$][\w$]*)/g,
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  /\bclass\s+([A-Za-z_$][\w$]*)/g,
  /\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g,
  /\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g
];
patrones.forEach(re => { let m; while ((m = re.exec(codigo))) declarados.add(m[1]); });

// Parámetros y desestructuraciones: sueltos, sin analizar de más.
const listas = [
  /\bfunction[^(]*\(([^)]*)\)/g,
  /\(([^()]{0,200}?)\)\s*=>/g,
  /\b(?:const|let|var)\s*\{([^}]*)\}/g,
  /\b(?:const|let|var)\s*\[([^\]]*)\]/g,
  /\.(?:map|forEach|filter|find|some|every|reduce|sort)\s*\(\s*\(([^)]*)\)/g,
  /\.(?:map|forEach|filter|find|some|every)\s*\(\s*([A-Za-z_$][\w$]*)\s*=>/g
];
listas.forEach(re => {
  let m;
  while ((m = re.exec(codigo))) {
    String(m[1]).split(/[,\s:=]+/).forEach(s => {
      const n = s.trim().replace(/^\.\.\./, '');
      if (/^[A-Za-z_$][\w$]*$/.test(n)) declarados.add(n);
    });
  }
});

const GLOBALES = new Set((
  'window document navigator location console JSON Math Date Object Array String Number Boolean ' +
  'RegExp Error TypeError Promise Set Map WeakMap Symbol parseInt parseFloat isNaN isFinite ' +
  'encodeURIComponent decodeURIComponent setTimeout clearTimeout setInterval clearInterval fetch ' +
  'FormData FileReader File Blob URL URLSearchParams AbortController alert confirm localStorage ' +
  'sessionStorage crypto Intl atob btoa requestAnimationFrame getComputedStyle CustomEvent Event ' +
  'this arguments undefined true false null typeof new delete void in of instanceof await async ' +
  'return if else for while do switch case break continue try catch finally throw class extends ' +
  'super yield let const var function flatpickr google gapi caches performance history screen ' +
  'globalThis structuredClone queueMicrotask Infinity NaN'
).split(/\s+/));

// Los ${...} de las plantillas.
const usados = new Map();
const placeholders = [...codigo.matchAll(/\$\{([^{}]*)\}/g)];
placeholders.forEach(p => {
  // Las cadenas de adentro no tienen identificadores: 'FECHA DE PAGO' no son
  // tres variables. Se vacían antes de mirar.
  const comillaSimple = new RegExp("'[^']*'", 'g');
  const comillaDoble  = new RegExp('"[^"]*"', 'g');
  const expr = String(p[1]).replace(comillaSimple, "''").replace(comillaDoble, '""');
  let m;
  const re = /(^|[^.\w$'"`])([A-Za-z_$][\w$]*)/g;
  while ((m = re.exec(expr))) {
    const n = m[2];
    if (declarados.has(n) || GLOBALES.has(n)) continue;
    // Claves de objeto dentro de la expresión: `{ a: 1 }`
    if (/^\s*:/.test(expr.slice(m.index + m[0].length))) continue;
    if (!usados.has(n)) usados.set(n, expr.trim().slice(0, 60));
  }
});

console.log('\n=== Identificadores usados en plantillas pero NO declarados ===');
console.log('  (declaraciones encontradas en index.html: ' + declarados.size + ')');
console.log('  (expresiones ${...} revisadas: ' + placeholders.length + ')');

const sueltos = [...usados.entries()];
sueltos.forEach(([n, ctx]) => console.log('  >>> ' + n + '   en: ' + ctx));

chk('ningún identificador de plantilla queda sin declarar',
    sueltos.length === 0, sueltos.map(s => s[0]));

// El caso concreto que se escapó, por si alguien vuelve a mover el bloque.
console.log('\n=== El panel de viáticos solo se ve donde corresponde ===');
{
  // Tres condiciones, y las tres tienen que estar: es de administradores, hay
  // datos, y se está registrando un VIÁTICO. En cualquier otro tipo de pago el
  // panel es ruido; en otra pestaña ni siquiera existe, porque vive dentro de
  // la vista de Nuevo Pago.
  const cond = (codigo.split('function actualizarVisibilidadPresupuesto')[1] || '').split('\n    }')[0];

  chk('pide que sea un viático',    /esViatico/.test(cond), cond.slice(0, 140));
  chk('pide que sea administrador', /saldosPuedeEditar/.test(cond), cond.slice(0, 140));
  chk('y pide que haya datos',      /ultimoPresupuesto/.test(cond), cond.slice(0, 140));
  chk('las tres juntas, no alguna',
      /ultimoPresupuesto && saldosPuedeEditar && esViatico/.test(cond), cond.slice(0, 180));

  // Y que se vuelva a evaluar cuando cambia el tipo y cuando se limpia el
  // formulario: si no, el panel queda colgado del tipo anterior.
  const cambioTipo = (codigo.split('function actualizarCampoRubro')[1] || '').split('\n    }')[0];
  chk('se reevalúa al cambiar el tipo de pago',
      /actualizarVisibilidadPresupuesto\(\)/.test(cambioTipo), cambioTipo.slice(0, 200));

  const reset = (codigo.split("campoRubro.style.display = 'none';")[1] || '').slice(0, 220);
  chk('y al limpiar el formulario',
      /actualizarVisibilidadPresupuesto\(\)/.test(reset), reset.slice(0, 160));
}


console.log('\n=== Los iconos de la lista de archivos existen ===');
['svgFile', 'svgImage', 'svgTrash'].forEach(n => {
  const usos = (codigo.match(new RegExp('\\b' + n + '\\b', 'g')) || []).length;
  const decl = new RegExp('(?:const|let|var)\\s+' + n + '\\b').test(codigo);
  chk(n + ' está declarado (' + usos + ' usos)', decl, 'usado pero nunca declarado');
});

console.log('\n' + (fallos ? 'FALLARON ' + fallos + ' comprobaciones' : 'TODAS LAS COMPROBACIONES PASARON'));
process.exit(fallos ? 1 : 0);
