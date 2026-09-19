// La foto de las hojas: cuándo se lee de verdad y cuándo se reusa.
//
// ─── Por qué vive en su propio archivo ────────────────────────────────────
//
// Esto empezó siendo tres líneas dentro del servidor. Hoy decide: si reusar lo
// guardado, si dos peticiones simultáneas comparten una lectura, si se sirve
// una foto vencida cuando no queda cuota, y si después de escribir se conserva
// la copia ya actualizada o se tira.
//
// Cada una de esas decisiones, mal tomada, NO falla: devuelve un dato viejo. En
// este proyecto esa clase de error ya costó días, y es justo lo que la política
// de veracidad no tolera. Separarlo lo vuelve probable sin red, sin
// credenciales y sin levantar el servidor.
//
// Las dependencias entran por parámetro (igual que `apiInyectada` en
// escribir.js) para poder probar el comportamiento sin tocar Google.

// `op`:
//   leerNombres()        → Promise<[nombres de pestaña]>
//   leerHojas(nombres)   → Promise<{ hoja: filas }>
//   convertir(crudo)     → foto con Date de verdad
//   cupo                 → el módulo cupo-lecturas (o un doble en las pruebas)
//   segundos             → cuánto vive la foto
//   msEsperaCupo         → cuánto se espera un lugar antes de rendirse
//   dormir(ms)           → para que las pruebas no esperen de verdad
function crearGestorDeFoto(op) {
  const segundos     = op.segundos     === undefined ? 15   : op.segundos;
  const msEsperaCupo = op.msEsperaCupo === undefined ? 8000 : op.msEsperaCupo;
  const cupo         = op.cupo;
  const dormir       = op.dormir || ((ms) => new Promise(r => setTimeout(r, ms)));

  let cache   = null;   // { foto, vence }
  let enVuelo = null;   // { desde, promesa }
  let version = 0;      // cuántas escrituras se aplicaron

  function olvidar() { cache = null; }

  async function leerDeVerdad() {
    const a = Date.now();
    const nombres = await op.leerNombres();
    const crudo   = await op.leerHojas(nombres);
    const foto    = op.convertir(crudo);
    cache = { foto: foto, vence: Date.now() + segundos * 1000 };
    return { foto: foto, deCache: false, ms: Date.now() - a };
  }

  // `forzar` = esta acción decide sobre el estado y no puede trabajar sobre
  // datos de hace unos segundos.
  async function traer(forzar) {
    const viva = !!(cache && cache.vence > Date.now());
    if (!forzar && viva) return { foto: cache.foto, deCache: true, ms: 0, version: version };

    // ─── Dos peticiones a la vez no leen dos veces ────────────────────────
    //
    // Sin esto, tres personas abriendo la app en el mismo segundo hacían tres
    // lecturas idénticas — y las tres gastaban cuota.
    //
    // Una acción que exige estado real solo se suma si la lectura en curso
    // empezó DESPUÉS de que ella llegara. Si empezó antes, podría no incluir
    // algo que pasó en el medio, y ahí reusarla sería justamente el error
    // silencioso que queremos evitar.
    const llegada = Date.now();
    if (enVuelo && (!forzar || enVuelo.desde >= llegada)) {
      const r = await enVuelo.promesa;
      return { foto: r.foto, deCache: true, ms: 0, version: version };
    }

    if (cupo && !cupo.hayCupo()) {
      if (cupo.anotarRechazo) cupo.anotarRechazo();

      // Una consulta se sirve con lo último que leímos. Datos de hace un rato
      // son mucho mejores que un error en inglés en la cara del usuario.
      if (!forzar && cache) {
        return { foto: cache.foto, deCache: true, ms: 0, vencida: true, version: version };
      }

      // Una acción que decide NO se sirve con datos viejos: registrar un pago
      // sobre una foto vencida es exactamente cómo se duplica un pago. Se
      // espera un poco; si no se libera, se avisa y no se escribe nada.
      const espera = Math.min(cupo.msHastaCupo(), msEsperaCupo);
      if (espera > 0) await dormir(espera);

      if (!cupo.hayCupo()) throw errorDeCuota();
    }

    const mio = { desde: Date.now(), promesa: null };
    mio.promesa = leerDeVerdad();
    enVuelo = mio;

    try {
      const r = await mio.promesa;
      return { foto: r.foto, deCache: false, ms: r.ms, version: version };
    } catch (err) {
      // Si Google rechazó por cuota y tenemos algo guardado, una consulta se
      // sirve igual. Una acción que decide, no.
      if (err && err.cuota && !forzar && cache) {
        return { foto: cache.foto, deCache: true, ms: 0, vencida: true, version: version };
      }
      throw err;
    } finally {
      if (enVuelo === mio) enVuelo = null;
    }
  }

  // ─── Después de escribir, la foto NO se tira ──────────────────────────────
  //
  // La lógica trabajó sobre una copia y le fue aplicando cada escritura a
  // medida que las hacía, así que esa copia es la hoja tal como quedó.
  //
  // Tirarla costaba una lectura de cuota por cada escritura. Y `arranque`
  // escribe ULTIMO ACCESO en CADA apertura de la app, así que el caché moría
  // todo el tiempo: era como no tenerlo.
  //
  // Solo se adopta si nadie más escribió entre la lectura y la escritura. Si
  // hubo otra escritura en el medio, esta copia no la tiene y quedársela
  // borraría un dato ajeno: ahí se tira y se vuelve a leer.
  function trasEscribir(versionAlLeer, fotoYaEscrita) {
    version++;
    if (version === versionAlLeer + 1 && !enVuelo && fotoYaEscrita) {
      cache = { foto: fotoYaEscrita, vence: Date.now() + segundos * 1000 };
    } else {
      olvidar();
    }
  }

  // Cuando una escritura falla no se sabe cuánto alcanzó a aplicarse: lo
  // guardado ya no es de fiar.
  function escrituraFallida() { version++; olvidar(); }

  function estado() {
    return {
      guardada: !!(cache && cache.vence > Date.now()),
      leyendo:  !!enVuelo,
      version:  version
    };
  }

  return { traer, olvidar, trasEscribir, escrituraFallida, estado };
}

function errorDeCuota() {
  const e = new Error(
    'El sistema está recibiendo muchas consultas en este momento. ' +
    'Esperá unos segundos y volvé a intentar. No se registró nada.'
  );
  e.cuota = true;
  return e;
}

module.exports = { crearGestorDeFoto, errorDeCuota };
