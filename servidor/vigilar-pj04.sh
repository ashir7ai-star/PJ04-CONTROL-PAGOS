#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════
# VIGILANTE DE PJ04 — corre en el VPS, avisa por correo si la app no responde
#
# Se instala en /root/vigilar-pj04.sh y lo dispara cron cada 5 minutos.
#
# ─── Por qué existe ───────────────────────────────────────────────────────
#
# El 17/10/2026 Hostinger reinició el VPS por una vulnerabilidad del kernel.
# Al volver, el contenedor de PJ04 quedó corriendo (1/1) pero sin registrarse
# en la red interna de Docker: Traefik tenía la ruta y no encontraba a quién
# mandarle las peticiones. La app estuvo caída TODA LA NOCHE y nos enteramos
# a la mañana siguiente, porque avisaron los usuarios.
#
# ─── Por qué no manda el correo él mismo ──────────────────────────────────
#
# Para enviar haría falta tener acá las credenciales de Google, duplicadas en
# un servidor donde no deben estar. En vez de eso le PIDE el correo al Apps
# Script, que corre en la infraestructura de Google y sigue en pie aunque este
# servidor esté apagado. Acá solo hace falta curl.
#
# ⚠️ LO QUE NO CUBRE: si apagan el VPS entero, esto se apaga también y no
# avisa nada — justo el caso del 17/10. Para eso está el monitoreo externo
# (UptimeRobot). Son complementarios, no redundantes.
#
# ─── Instalación ──────────────────────────────────────────────────────────
#
#   1. Copiar este archivo a /root/vigilar-pj04.sh
#   2. Poner la CLAVE de abajo (sale de correr generarClaveDeVigilancia()
#      en el editor de Apps Script)
#   3. chmod 700 /root/vigilar-pj04.sh     ← lleva un secreto: solo root
#   4. Probarlo a mano:  /root/vigilar-pj04.sh --probar
#   5. Instalar en cron: /root/vigilar-pj04.sh --instalar
# ══════════════════════════════════════════════════════════════════════════

set -uo pipefail

# ─── Configuración ────────────────────────────────────────────────────────

DOMINIO="ashir-pj04-pagos-api.nr6aco.easypanel.host"
IP_SERVIDOR="72.61.104.13"
SERVICIO="ashir_pj04-pagos-api"

# Quien manda el correo. Vive en Google, no acá: es lo que hace que el aviso
# salga aunque este servidor esté en llamas.
URL_AVISO="https://script.google.com/macros/s/AKfycbwngWbZFP9c0Rn5u5efkTNRM1zBlK_wKQ8TaE-kbFCz8FXN85-KahlkkVXab6x5YPoS1A/exec"

# ⚠️ PEGAR ACÁ la clave que imprime generarClaveDeVigilancia().
# NO la subas al repositorio: es público.
CLAVE="PEGAR_LA_CLAVE_ACA"

# Cuántos fallos seguidos antes de avisar. Con 2 y un chequeo cada 5 minutos,
# un reinicio normal del contenedor (que tarda segundos) no dispara el correo.
# Avisar por cada parpadeo es la forma más rápida de que dejen de leerse.
FALLOS_PARA_AVISAR=2

ESTADO="/var/lib/vigilar-pj04.estado"
BITACORA="/var/log/vigilar-pj04.log"

# ─── Utilidades ───────────────────────────────────────────────────────────

anotar() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$BITACORA" 2>/dev/null || true
}

# El aviso. Nunca hace fallar al vigilante: si no se puede avisar, se anota y
# se sigue — un error acá no puede dejar de vigilar.
avisar() {
  local estado="$1" detalle="$2" codigo
  codigo=$(curl -sL -o /dev/null -w '%{http_code}' --max-time 45 \
    -X POST "$URL_AVISO" \
    -H 'Content-Type: application/json' \
    -d "{\"action\":\"avisar_caida\",\"clave\":\"$CLAVE\",\"estado\":\"$estado\",\"detalle\":\"$detalle\"}" \
    2>/dev/null) || codigo="000"
  anotar "aviso[$estado] -> HTTP $codigo"
  [ "$codigo" = "200" ]
}

# ─── El chequeo ───────────────────────────────────────────────────────────
#
# Por la IP pública con --resolve, NO por 127.0.0.1: los puertos que publica
# Docker Swarm no responden en loopback, y probar ahí daría un falso negativo
# con la app perfectamente sana.
#
# No alcanza con que devuelva 200: una página de error de Traefik también lo
# haría. Se exige que el cuerpo sea la respuesta de la app.
revisar() {
  local cuerpo
  cuerpo=$(curl -sk --max-time 20 \
    --resolve "$DOMINIO:443:$IP_SERVIDOR" \
    "https://$DOMINIO/salud" 2>/dev/null)

  if [ -z "$cuerpo" ]; then
    echo "sin respuesta de /salud"
    return 1
  fi
  if ! echo "$cuerpo" | grep -q '"status":"success"'; then
    echo "/salud respondio algo que no es la app: $(echo "$cuerpo" | head -c 120)"
    return 1
  fi

  # La app puede estar viva y aun asi no servir para nada: sin acceso a la
  # hoja, nadie puede registrar un pago. Un vigilante que solo mira el puerto
  # diria que todo esta bien.
  local diag
  diag=$(curl -sk --max-time 30 \
    --resolve "$DOMINIO:443:$IP_SERVIDOR" \
    "https://$DOMINIO/diagnostico" 2>/dev/null)
  if [ -n "$diag" ] && ! echo "$diag" | grep -q '"hojas":{"ok":true'; then
    echo "la app responde pero NO llega a Google Sheets: $(echo "$diag" | head -c 150)"
    return 1
  fi

  return 0
}

# ─── Modos ────────────────────────────────────────────────────────────────

if [ "${1:-}" = "--instalar" ]; then
  if [ "$CLAVE" = "PEGAR_LA_CLAVE_ACA" ]; then
    echo "Falta la clave. Corré generarClaveDeVigilancia() en el editor de Apps Script"
    echo "y pegá el resultado en la variable CLAVE de este archivo."
    exit 1
  fi
  # Se reescribe la linea en vez de agregarla: instalar dos veces no puede
  # dejar dos tareas haciendo lo mismo.
  ( crontab -l 2>/dev/null | grep -v 'vigilar-pj04.sh' ; \
    echo "*/5 * * * * /root/vigilar-pj04.sh >/dev/null 2>&1" ) | crontab -
  echo "Instalado. Revisa cada 5 minutos."
  crontab -l | grep vigilar-pj04
  exit 0
fi

if [ "${1:-}" = "--quitar" ]; then
  crontab -l 2>/dev/null | grep -v 'vigilar-pj04.sh' | crontab -
  echo "Quitado del cron."
  exit 0
fi

if [ "${1:-}" = "--probar" ]; then
  echo "Revisando $DOMINIO ..."
  if salida=$(revisar); then
    echo "  La app responde bien."
  else
    echo "  FALLA: $salida"
  fi
  echo "Mandando un correo de prueba a los administradores..."
  if avisar "recuperada" "PRUEBA del vigilante. Si recibiste esto, el aviso funciona."; then
    echo "  Enviado. Revisá la bandeja."
  else
    echo "  NO se pudo enviar. Revisá la CLAVE y que el Apps Script esté desplegado"
    echo "  con la version que incluye la accion avisar_caida."
  fi
  exit 0
fi

# ─── Corrida normal (la que dispara cron) ─────────────────────────────────

fallos=$(cat "$ESTADO" 2>/dev/null || echo 0)
case "$fallos" in (''|*[!0-9]*) fallos=0 ;; esac

if salida=$(revisar); then
  # Volvió. Solo se avisa si se había avisado la caída: si no, un fallo
  # aislado que se resolvió solo mandaría un "volvió" sin un "se cayó".
  if [ "$fallos" -ge "$FALLOS_PARA_AVISAR" ]; then
    anotar "RECUPERADA tras $fallos fallos"
    avisar "recuperada" "Volvio a responder tras $fallos chequeos fallidos."
  fi
  echo 0 > "$ESTADO"
  exit 0
fi

fallos=$((fallos + 1))
echo "$fallos" > "$ESTADO"
anotar "FALLO $fallos: $salida"

if [ "$fallos" -eq "$FALLOS_PARA_AVISAR" ]; then
  # El estado del servicio ayuda a saber por dónde empezar sin entrar al
  # servidor: 0/1 es que se cae, 1/1 es que no lo encuentran en la red.
  replicas=$(docker service ls --filter "name=$SERVICIO" --format '{{.Replicas}}' 2>/dev/null | head -1)
  avisar "caida" "$salida | replicas: ${replicas:-desconocido}"
fi

exit 1
