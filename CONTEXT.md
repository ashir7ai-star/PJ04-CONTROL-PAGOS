# Contexto del Proyecto — Control de Pagos (PJ04)

> Documento vivo. Se actualiza cada vez que se hace un cambio relevante para que cualquier sesión (o persona) pueda retomar el proyecto sin perder contexto.

## Última actualización
**2026-08-18** — Se elimina la columna "N° Pago" de la tabla de resultados en "Consultar Pagos". `sw.js` → `control-pagos-v13`.

## Qué es este proyecto
PWA (app web instalable, sin build ni framework) para **Millennium Energy Co** que permite:
1. Registrar pagos (a proveedores o de impuestos) con adjunto de archivo.
2. Consultar pagos registrados con filtros (empresa, tipo, proveedor, N° factura, rango de fechas).

Todo vive en un único [index.html](index.html) (HTML + CSS + JS inline).

## Arquitectura
| Pieza | Detalle |
|---|---|
| Frontend | `index.html` — una sola página, sin dependencias de build |
| Backup estable | `index.stable.html` — copia de respaldo de la última versión considerada estable |
| PWA | `manifest.json` (scope `/PJ04-CONTROL-PAGOS/`) + `sw.js` (Service Worker, cache-first, versión de caché actual: `control-pagos-v10`) |
| Backend | **n8n** (self-hosted en `ashir-n8n.nr6aco.easypanel.host`), vía dos webhooks: |
| — Registrar pago | `POST /webhook/81926c9e-22aa-4aef-bb4d-fe4ee520748c` (`N8N_WEBHOOK_URL`) — workflow: Webhook → **Upload file** (Google Drive) → **Append row in sheet** (Google Sheets) → Respond to Webhook |
| — Consultar pagos | `GET /webhook/c6d11abd-61bc-439c-9dd9-550ed5008ee3` (`N8N_QUERY_URL`) — probablemente lee del mismo Google Sheet |
| Almacenamiento real | Google Drive (carpeta "PJ04 FACTURAS", credencial n8n "PJ04 DRIVE") + Google Sheet "Control de pagos" (pestaña "Millennium", credencial n8n "PJ04 SHEET") |
| Hosting | GitHub Pages (por el `scope`/`start_url` del manifest) |
| Repo | https://github.com/ashir7ai-star/PJ04-CONTROL-PAGOS |

## ⚠️ Incidente (RESUELTO): cuenta de Google del backend eliminada (2026-07-30 → 2026-08-04)
La cuenta de Google donde vivían el Drive ("PJ04 FACTURAS") y el Sheet ("Control de pagos") que usa n8n para el backend **fue eliminada por error**. Esto rompió el workflow de registrar pagos con errores 404 en cadena:
- Nodo **Upload file** (Google Drive): `File not found: <id de carpeta>` — la carpeta destino ya no existía para la credencial.
- Nodo **Append row in sheet** (Google Sheets): `Requested entity was not found` — el spreadsheet/pestaña destino tampoco existía.
- Después, al recrear el Sheet nuevo con encabezados ligeramente distintos (ej. "TIPO FACTURA" → "TIPO DE FACTURA"), salió un tercer error: `Column names were updated after the node's setup` (schema drift), porque el nodo tenía cacheados los nombres de columna viejos.

**Resolución (2026-08-04):**
- Cuenta de Google nueva creada, credenciales reconfiguradas en Google Cloud Console y en n8n ("PJ04 DRIVE", "PJ04 SHEET").
- Carpeta "PJ04 FACTURAS" y Sheet "Control de pagos" (pestaña "Millennium") recreados bajo la cuenta nueva; nodos re-apuntados.
- Encabezados del Sheet ajustados para volver a coincidir exactamente con lo que espera el nodo/la app (`FECHA REGISTRO`, `TIPO FACTURA`, etc. — el frontend en `index.html` depende del texto exacto `'TIPO FACTURA'` para el filtro y badge de tipo de pago, así que cualquier rename de esa columna en el Sheet rompería esa lógica sin tocar código).
- Usuario confirmó que ya quedó funcionando end-to-end y pidió marcar como versión estable.

**Lecciones aprendidas:**
1. Cuando un nodo de Google Drive/Sheets en n8n da 404 "File/entity not found" pese a que el nombre se ve correcto en el dropdown, es porque el ID cacheado en el parámetro no coincide con el recurso real — hay que reabrir el dropdown "From list" y volver a hacer clic explícito sobre el recurso para refrescar el ID (no basta con que se vea seleccionado).
2. Si se recrea el Google Sheet, los encabezados de columna deben coincidir **exactamente** (mismo texto) con los que ya usa `index.html` (notablemente `'TIPO FACTURA'`, referenciado en `filtrarRows()` y `renderResultados()`) y con los que espera el nodo "Append row in sheet" — de lo contrario hay que refrescar el schema en n8n y/o actualizar el frontend.

## ⚠️ Regla importante: actualizar el Service Worker en cada cambio visible
Cada vez que se modifique `index.html` (o cualquier asset cacheado), **hay que subir el número de versión de `CACHE` en `sw.js`** (ej. `control-pagos-v9` → `v10`). Si no se hace, los navegadores/PWA instalados seguirán mostrando la versión vieja indefinidamente, porque el Service Worker usa estrategia *cache-first* y solo revisa si hay una versión nueva cuando detecta que el archivo `sw.js` cambió de bytes.
El flujo de auto-actualización ya está implementado en `index.html` (registro del SW + `reg.update()` + recarga automática al detectar `controllerchange`), así que con solo subir la versión en `sw.js`, la próxima vez que el usuario abra la app se actualizará sola.

## Flujo de guardado / protección de versiones
- Existe un **hook de `Stop`** configurado en `.claude/settings.local.json` que, al terminar cada turno de Claude, hace automáticamente `git add -A`, `git commit` (mensaje `Auto: YYYY-MM-DD HH:mm`) y `git push origin main` si hay cambios. Esto mantiene el repositorio de GitHub siempre al día como respaldo.
- Cuando se considera que `index.html` está en un punto **estable**, se copia a `index.stable.html` (comando permitido: `copy index.html index.stable.html`). Ese cambio también queda protegido por el mismo hook de auto-commit/push.
- Es decir: **cada cierre de sesión de trabajo = commit + push automático**. No se requiere acción manual de git para mantener el repo actualizado.

## Historial de cambios recientes
- **2026-08-18**: Se elimina la columna "N° Pago" de la tabla de resultados en "Consultar Pagos" (`renderResultados()` en index.html — encabezado `<th>` y celda `r['NUMERO DE FACTURA']` quitados). El filtro "Número de pago" en el formulario de búsqueda se mantiene sin cambios. `sw.js` → `control-pagos-v13`.
- **2026-08-18**: Resultados de "Consultar Pagos" se ordenan de más reciente a más vieja por `FECHA DE PAGO` (`filtrarRows()` en index.html, antes no tenían ningún orden garantizado). `sw.js` → `control-pagos-v12`.
- **2026-08-12**: ✅ Marcada como **versión estable** por el usuario — `index.stable.html` = `index.html` (incluye: fix del calendario de flatpickr y panel ampliado a 880px).
- **2026-08-12**: Fix de bug en el calendario de flatpickr — `.flatpickr-days`/`.flatpickr-innerContainer`/`.flatpickr-rContainer` no tenían `width: 100% !important`, así que flatpickr calculaba internamente un ancho basado en el tamaño de celda por defecto (más grande que nuestro tema de 34px) y eso recortaba visualmente la última columna (domingo). Además, panel principal (`main`) ampliado de `max-width: 736px` a `880px` (+20%, decisión del usuario tras comparar opciones). `sw.js` → `control-pagos-v11`.
- **2026-08-04**: ✅ Incidente de cuenta de Google del backend resuelto por completo (Drive + Sheets recreados, nodos de n8n re-apuntados, encabezados del Sheet corregidos). Marcada como **versión estable** por el usuario. Ver sección de incidente arriba.
- **2026-07-30**: Incidente — cuenta de Google del backend (Drive + Sheets) eliminada por error. Se creó cuenta nueva, credenciales configuradas en Google Console y en n8n. Ver sección de incidente arriba.
- **2026-07-01**: ✅ Marcada como **versión estable** por el usuario — `index.stable.html` = `index.html` (incluye: fix de filtro con `.toLowerCase()`, eliminación de "Número de pago" en Nuevo Pago, ancho ampliado a 736px, `sw.js` v10).
- **2026-07-01**: Contenedor principal `main` ampliado de `max-width: 640px` a `736px` (+15%, index.html línea ~173) para reducir la sensación de vista angosta, especialmente en la tabla de "Consultar Pagos". `sw.js` → `control-pagos-v10`.
- **2026-07-01**: Se elimina el campo "Número de pago" (`numeroFactura` / `numero_factura`) del formulario "Nuevo Pago" en `index.html` — ya no se muestra, no se valida como requerido, y no se envía en el `formData` al webhook de n8n. **Nota:** el filtro "Número de pago" en "Consultar Pagos" (`fNumeroFactura`) se mantiene, ya que sirve para buscar registros antiguos que sí tienen ese dato.
- **2026-07-01**: Fix bug en filtro de "Consultar Pagos" — campos como `NUMERO DE FACTURA`, `EMPRESA`, `TIPO FACTURA` y `PROVEEDOR` pueden llegar como número desde n8n; se envuelven en `String(...)` antes de `.toLowerCase()` en `filtrarRows()` y `renderResultados()` (index.html). Se sincroniza `index.stable.html`.
- **2026-07-01**: Creación de `CONTEXT.md` y `CLAUDE.md` para mantener contexto entre sesiones.
- **2026-05-20**: Varios ajustes iterativos (auto-commits), incluyendo "Trigger redeploy: Pago Impuestos".
- **2026-04-21**: Fix de overflow de tabla en resultados; extracción de URL desde fórmulas `HYPERLINK` de Google Sheets; agregado de log de depuración.
- **2026-04-15**: Commit inicial de la PWA "Control de Pagos".

## Pendientes / próximos pasos
- (Ninguno pendiente por ahora — incidente de la cuenta de Google resuelto y verificado.)

---
### Cómo mantener este documento
Cada vez que se implemente un cambio relevante (nueva funcionalidad, fix importante, cambio de arquitectura, nueva versión estable), agregar una entrada en **Historial de cambios recientes** con fecha y descripción breve, y actualizar **Última actualización** arriba.
