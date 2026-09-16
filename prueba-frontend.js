// Comprobaciones estáticas de index.html.
// Uso: node prueba-frontend.js index.html
//
// Existe por un error real: una función llamada durante el arranque leía una
// variable `let` declarada más abajo. Eso es un ReferenceError que mata el
// script ENTERO y deja la app en blanco, y ni `node --check` ni un `typeof`
// defensivo lo detectan (las funciones se izan; las `let`/`const` no).

const fs = require('fs');

const RUTA = process.argv[2] || 'index.html';
const html = fs.readFileSync(RUTA, 'utf8');

let fallos = 0;
function chk(nombre, cond, detalle) {
  console.log((cond ? '  ok   ' : '  FALLA') + '  ' + nombre + (cond ? '' : '  → ' + detalle));
  if (!cond) fallos++;
}

// El script inline grande es el último bloque <script> sin src.
const bloques = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const js = bloques[bloques.length - 1] || '';

console.log('\n=== Sintaxis ===');
let sintaxisOk = true;
try { new Function(js); } catch (e) { sintaxisOk = false; chk('el script inline compila', false, e.message); }
if (sintaxisOk) chk('el script inline compila', true);

console.log('\n=== Zona muerta temporal en el arranque ===');
// Todo lo que se ejecuta en el nivel superior del script (no dentro de una
// función) corre al cargar. Si esas líneas llaman a una función que lee una
// `let`/`const` declarada DESPUÉS, revienta.
const lineas = js.split('\n');

// El script inline está indentado con 4 espacios, así que "nivel superior" es
// exactamente 4. Con más indentación ya estamos dentro de una función o bloque,
// y esas variables son locales: no pueden causar este problema.
const INDENT = '    ';

const declaradas = new Map();
lineas.forEach((l, i) => {
  const m = l.match(/^ {4}(?:let|const)\s+([A-Za-z_$][\w$]*)\s*=/);
  if (m && !declaradas.has(m[1])) declaradas.set(m[1], i);
});

// Cuerpo y rango de cada función declarada en el nivel superior
const funciones = new Map();
const rangos = [];
lineas.forEach((l, i) => {
  const m = l.match(/^ {4}function\s+([A-Za-z_$][\w$]*)\s*\(/);
  if (!m) return;
  let prof = 0, j = i, cuerpo = '', visto = false;
  do {
    cuerpo += lineas[j] + '\n';
    for (const c of lineas[j]) {
      if (c === '{') { prof++; visto = true; }
      if (c === '}') prof--;
    }
    j++;
  } while (j < lineas.length && (!visto || prof > 0));
  funciones.set(m[1], { inicio: i, fin: j, cuerpo: cuerpo });
  rangos.push([i, j]);
});

const dentroDeAlgunaFuncion = (i) => rangos.some(([a, b]) => i >= a && i < b);

// El problema es TRANSITIVO: A() llama a B(), y B lee una variable declarada
// después. Mirar solo el cuerpo de A no alcanza — así se escapó el error real
// (aplicarTema → redibujarBotonGoogle → googleInicializado). Se acumulan los
// cuerpos de todo lo alcanzable desde la función llamada.
function cuerpoAlcanzable(nombre, vistos) {
  vistos = vistos || new Set();
  if (vistos.has(nombre)) return '';          // corta la recursión mutua
  vistos.add(nombre);
  const fn = funciones.get(nombre);
  if (!fn) return '';
  let todo = fn.cuerpo;
  [...fn.cuerpo.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)].forEach(m => {
    if (funciones.has(m[1]) && !vistos.has(m[1])) todo += cuerpoAlcanzable(m[1], vistos);
  });
  return todo;
}

// Una llamada "de arranque" es la que está en el nivel superior del script:
// se ejecuta apenas carga la página, en el orden en que aparece.
const problemas = [];
lineas.forEach((l, i) => {
  const m = l.match(/^ {4}([A-Za-z_$][\w$]*)\s*\(\s*[^)]*\)\s*;\s*$/);
  if (!m) return;
  if (dentroDeAlgunaFuncion(i)) return;
  if (!funciones.has(m[1])) return;
  const alcanzable = cuerpoAlcanzable(m[1]);

  // ¿algo de lo que se ejecuta lee una variable de nivel superior declarada DESPUÉS?
  declaradas.forEach((posDecl, nombre) => {
    if (posDecl <= i) return;
    if (funciones.has(nombre)) return;
    const usa = new RegExp('(?<![\\w$.])' + nombre.replace(/\$/g, '\\$') + '(?![\\w$])');
    if (usa.test(alcanzable)) {
      problemas.push('  ' + m[1] + '() se llama en la línea ' + (i + 1) +
                     ' y termina leyendo "' + nombre + '", declarada en la ' + (posDecl + 1));
    }
  });
});

chk('ninguna llamada de arranque lee variables declaradas después',
    problemas.length === 0, '\n' + problemas.join('\n'));

console.log('\n=== Integridad del DOM ===');
const ids = [...html.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)].map(m => m[1]);
const setIds = new Set(ids);
const dup = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
chk('sin ids duplicados', dup.length === 0, JSON.stringify(dup));

const usados = [...new Set([...js.matchAll(/getElementById\('([A-Za-z0-9_-]+)'\)/g)].map(m => m[1]))];
const rotos = usados.filter(i => !setIds.has(i));
chk('getElementById siempre apunta a un id existente', rotos.length === 0, JSON.stringify(rotos));

console.log('\n=== Coherencia con el backend ===');
const clienteFront = (html.match(/const CLIENT_ID_GOOGLE = '([^']+)'/) || [])[1];
let clienteBack = null;
try {
  clienteBack = (fs.readFileSync('apps-script.gs', 'utf8').match(/const CLIENT_ID_GOOGLE = '([^']+)'/) || [])[1];
} catch (e) { /* el .gs puede no estar al lado */ }
if (clienteBack) {
  // Si no coinciden, el servidor rechaza TODOS los tokens por el chequeo de "aud"
  // y el login falla entero sin una causa evidente.
  chk('el Client ID coincide entre index.html y apps-script.gs',
      clienteFront === clienteBack, clienteFront + ' vs ' + clienteBack);
}

console.log('\n' + (fallos ? 'FALLARON ' + fallos + ' comprobaciones' : 'TODAS LAS COMPROBACIONES PASARON'));
process.exit(fallos ? 1 : 0);
