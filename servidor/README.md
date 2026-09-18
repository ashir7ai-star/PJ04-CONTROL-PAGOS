# pj04-pagos-api

Backend propio de **PJ04 Control de Pagos**. Reemplaza a Google Apps Script como
capa de API. **Las hojas de cálculo siguen siendo la fuente de datos**, así que
contabilidad no cambia su forma de trabajar.

## Dónde vive

EasyPanel, proyecto **`ashir`**, servicio **`pj04-pagos-api`**.

Conviven ahí `conciliacion-app`, `n8n`, `pgadmin-ashir`, `postgres` y `redis`.

> ⚠️ **No confundir con `conciliacion-app`.** Son cosas distintas: esta app tiene
> *adentro* una función llamada "conciliación" (comparar el saldo real del banco
> contra el calculado), que no tiene relación con ese otro servicio.

El **frontend no se mueve**: la PWA sigue publicada en GitHub Pages. Lo único que
cambia es a qué dirección le habla.

### Infraestructura ya disponible en el proyecto

- **`redis`** — destino natural del caché de saldos y de las sesiones. Hoy el
  caché vive en el proceso; con Redis sobrevive a un reinicio y sirve igual si
  algún día corre más de una instancia. Se evalúa en el paso 3.
- **`postgres`** — deja abierta la opción B (mover los datos a una base real)
  sin tener que levantar infraestructura nueva.

## Por qué

Medido el 2026-09-18 contra el documento real, vía Apps Script:

| Petición | Servidor | Transporte | Total |
|---|---|---|---|
| `arranque` sin sesión | 2 ms | 2.100 ms | 2,1 s |
| `arranque` leyendo **1 hoja** | **2.085 ms** | 3.054 ms | 5,1 s |
| `consultar_saldos` | 2 ms | **33.810 ms** | 33,8 s |

Dos problemas, ninguno de nuestro código (que tarda 2 ms cuando no toca hojas):

1. **Leer una hoja cuesta ~2 segundos** en Apps Script. El arranque lee once.
2. **El transporte es errático.** Apps Script entrega la respuesta de un POST en
   dos saltos (302 a `googleusercontent`); el segundo varió entre 0,6 s y 32 s
   con la misma petición. Ningún caché nuestro toca eso.

Acá se resuelven los dos: `values.batchGet` trae **todas** las hojas en una sola
llamada HTTP, y la respuesta vuelve directa, sin redirección.

---

## Paso 1 — Cuenta de servicio (una vez)

Una cuenta de servicio es un "usuario" que no es una persona: sirve para que el
servidor entre a las hojas sin usar tu cuenta personal. Si mañana te vas de la
empresa o cambiás tu contraseña, el sistema sigue funcionando.

1. Entrá a <https://console.cloud.google.com/> con la cuenta dueña del documento.
2. Arriba a la izquierda, creá un proyecto nuevo: **`PJ04 Control de Pagos`**.
3. Buscá **"Google Sheets API"** y dale **Habilitar**.
4. Andá a **IAM y administración → Cuentas de servicio → Crear cuenta de servicio**.
   - Nombre: `pj04-backend`
   - No hace falta asignarle ningún rol del proyecto: los permisos se dan
     compartiendo el documento, en el paso siguiente.
5. Entrá a la cuenta creada → pestaña **Claves** → **Agregar clave → Crear clave
   nueva → JSON**. Se descarga un archivo.
6. Guardá ese archivo como **`credenciales.json`** en la carpeta raíz del
   proyecto (al lado de `index.html`).

> ⚠️ **Ese archivo es una llave de la contabilidad.** No se sube al repositorio
> —`.gitignore` ya lo bloquea—, no se manda por WhatsApp y no se pega en un
> chat. Si alguna vez se filtra: Consola → Claves → borrar esa clave y crear otra.

## Paso 2 — Compartir el documento

Abrí `credenciales.json` y copiá el valor de **`client_email`** (termina en
`.iam.gserviceaccount.com`).

Compartí el documento "CONTROL DE PAGOS" con ese correo:

- **Por ahora: Lector.** El primer paso solo mide velocidad, no escribe nada.
- Más adelante, cuando el backend empiece a registrar pagos: **Editor**.

## Paso 3 — Medir

```bash
cd servidor
npm install

# Windows (PowerShell)
$env:SHEETS_ID="EL_ID_DEL_DOCUMENTO"
$env:GOOGLE_CREDENCIALES_ARCHIVO="../credenciales.json"
npm run medir
```

`SHEETS_ID` es la parte larga de la URL del documento, entre `/d/` y `/edit`.

El comando imprime cuánto tarda leer **todas** las hojas y lo compara contra los
números de Apps Script de arriba. Es lo que decide si seguimos: si la mejora no
es grande, no tiene sentido migrar.

---

## Variables de entorno

| Variable | Para qué |
|---|---|
| `SHEETS_ID` | Identificador del documento de Google Sheets. |
| `GOOGLE_CREDENCIALES_ARCHIVO` | Ruta al `credenciales.json` (cómodo en local). |
| `GOOGLE_CREDENCIALES_JSON` | El contenido del archivo, en una variable (cómodo en EasyPanel). |

Se usa una **o** la otra, no las dos.
