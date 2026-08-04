# Contexto del Proyecto — Control de Pagos (PJ04)

> Documento vivo. Se actualiza cada vez que se hace un cambio relevante para que cualquier sesión (o persona) pueda retomar el proyecto sin perder contexto.

## Última actualización
**2026-07-30** — Incidente resuelto: la cuenta de Google que usaba n8n para Drive/Sheets fue eliminada por error; se está migrando a una cuenta nueva. Ver sección "⚠️ Incidente: cuenta de Google del backend" abajo.

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

## ⚠️ Incidente: cuenta de Google del backend eliminada (2026-07-30)
La cuenta de Google donde vivían el Drive ("PJ04 FACTURAS") y el Sheet ("Control de pagos") que usa n8n para el backend **fue eliminada por error**. Esto rompió el workflow de registrar pagos con errores 404 en cadena:
- Nodo **Upload file** (Google Drive): `File not found: <id de carpeta>` — la carpeta destino ya no existía para la credencial.
- Nodo **Append row in sheet** (Google Sheets): `Requested entity was not found` — el spreadsheet/pestaña destino tampoco existía.

**Estado de la resolución:**
- Se creó una cuenta de Google nueva.
- Ya se configuró el proyecto/credenciales en Google Cloud Console.
- Ya se reconfiguró la credencial nueva en el flujo de n8n.
- **Pendiente:** recrear (o migrar) la carpeta de Drive y el Google Sheet bajo la cuenta nueva, y re-apuntar cada nodo (Upload file → Parent Drive/Parent Folder; Append row in sheet → Document/Sheet) seleccionándolos de nuevo desde el dropdown "From list" para que tomen los IDs correctos. Ver también si el workflow de **Consultar Pagos** (lectura) usa el mismo Sheet y necesita el mismo ajuste.
- **Lección aprendida:** cuando un nodo de Google Drive/Sheets en n8n da 404 "File/entity not found" pese a que el nombre se ve correcto en el dropdown, es porque el ID cacheado en el parámetro no coincide con el recurso real — hay que reabrir el dropdown "From list" y volver a hacer clic explícito sobre el recurso para refrescar el ID (no basta con que se vea seleccionado).

## ⚠️ Regla importante: actualizar el Service Worker en cada cambio visible
Cada vez que se modifique `index.html` (o cualquier asset cacheado), **hay que subir el número de versión de `CACHE` en `sw.js`** (ej. `control-pagos-v9` → `v10`). Si no se hace, los navegadores/PWA instalados seguirán mostrando la versión vieja indefinidamente, porque el Service Worker usa estrategia *cache-first* y solo revisa si hay una versión nueva cuando detecta que el archivo `sw.js` cambió de bytes.
El flujo de auto-actualización ya está implementado en `index.html` (registro del SW + `reg.update()` + recarga automática al detectar `controllerchange`), así que con solo subir la versión en `sw.js`, la próxima vez que el usuario abra la app se actualizará sola.

## Flujo de guardado / protección de versiones
- Existe un **hook de `Stop`** configurado en `.claude/settings.local.json` que, al terminar cada turno de Claude, hace automáticamente `git add -A`, `git commit` (mensaje `Auto: YYYY-MM-DD HH:mm`) y `git push origin main` si hay cambios. Esto mantiene el repositorio de GitHub siempre al día como respaldo.
- Cuando se considera que `index.html` está en un punto **estable**, se copia a `index.stable.html` (comando permitido: `copy index.html index.stable.html`). Ese cambio también queda protegido por el mismo hook de auto-commit/push.
- Es decir: **cada cierre de sesión de trabajo = commit + push automático**. No se requiere acción manual de git para mantener el repo actualizado.

## Historial de cambios recientes
- **2026-07-30**: Incidente — cuenta de Google del backend (Drive + Sheets) eliminada por error. Se creó cuenta nueva, credenciales configuradas en Google Console y en n8n. Pendiente re-apuntar carpeta Drive y Sheet a los recursos nuevos. Ver sección de incidente arriba.
- **2026-07-01**: ✅ Marcada como **versión estable** por el usuario — `index.stable.html` = `index.html` (incluye: fix de filtro con `.toLowerCase()`, eliminación de "Número de pago" en Nuevo Pago, ancho ampliado a 736px, `sw.js` v10).
- **2026-07-01**: Contenedor principal `main` ampliado de `max-width: 640px` a `736px` (+15%, index.html línea ~173) para reducir la sensación de vista angosta, especialmente en la tabla de "Consultar Pagos". `sw.js` → `control-pagos-v10`.
- **2026-07-01**: Se elimina el campo "Número de pago" (`numeroFactura` / `numero_factura`) del formulario "Nuevo Pago" en `index.html` — ya no se muestra, no se valida como requerido, y no se envía en el `formData` al webhook de n8n. **Nota:** el filtro "Número de pago" en "Consultar Pagos" (`fNumeroFactura`) se mantiene, ya que sirve para buscar registros antiguos que sí tienen ese dato.
- **2026-07-01**: Fix bug en filtro de "Consultar Pagos" — campos como `NUMERO DE FACTURA`, `EMPRESA`, `TIPO FACTURA` y `PROVEEDOR` pueden llegar como número desde n8n; se envuelven en `String(...)` antes de `.toLowerCase()` en `filtrarRows()` y `renderResultados()` (index.html). Se sincroniza `index.stable.html`.
- **2026-07-01**: Creación de `CONTEXT.md` y `CLAUDE.md` para mantener contexto entre sesiones.
- **2026-05-20**: Varios ajustes iterativos (auto-commits), incluyendo "Trigger redeploy: Pago Impuestos".
- **2026-04-21**: Fix de overflow de tabla en resultados; extracción de URL desde fórmulas `HYPERLINK` de Google Sheets; agregado de log de depuración.
- **2026-04-15**: Commit inicial de la PWA "Control de Pagos".

## Pendientes / próximos pasos
- Recrear/migrar la carpeta de Drive ("PJ04 FACTURAS") y el Google Sheet ("Control de pagos") bajo la cuenta de Google nueva, y re-apuntar los nodos de n8n (Upload file, Append row in sheet, y el workflow de Consultar Pagos si aplica).
- Probar de extremo a extremo: registrar un pago de prueba desde la PWA y confirmar que aparece el archivo en Drive, la fila en Sheets, y que se puede encontrar en "Consultar Pagos".

---
### Cómo mantener este documento
Cada vez que se implemente un cambio relevante (nueva funcionalidad, fix importante, cambio de arquitectura, nueva versión estable), agregar una entrada en **Historial de cambios recientes** con fecha y descripción breve, y actualizar **Última actualización** arriba.
