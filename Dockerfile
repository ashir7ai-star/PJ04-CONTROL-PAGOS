# Imagen de pj04-pagos-api para EasyPanel.
#
# Alpine porque la imagen queda chica y arranca rápido: un contenedor liviano
# significa despliegues de segundos, no de minutos.
FROM node:20-alpine

# ⚠️ La zona horaria NO es un detalle cosmético.
#
# `apps-script.gs` construye fechas con `new Date(año, mes, día, hora, minuto)`,
# que las interpreta en la hora DEL PROCESO. Apps Script corría en Bogotá; un
# contenedor corre en UTC. Sin esto, toda fecha de texto queda corrida CINCO
# HORAS — y no falla, simplemente muestra otra hora.
#
# Alpine no trae la base de zonas horarias: sin `tzdata`, pedir
# "America/Bogota" no da error, se ignora en silencio y queda UTC.
RUN apk add --no-cache tzdata
ENV TZ=America/Bogota

WORKDIR /app

# Las dependencias se instalan ANTES de copiar el código. Así, si solo cambia
# el código, Docker reutiliza esta capa y el despliegue no vuelve a bajar todo.
COPY servidor/package.json servidor/package-lock.json* ./servidor/
RUN cd servidor && npm ci --omit=dev || (cd /app/servidor && npm install --omit=dev)

# El servidor carga la lógica de negocio desde apps-script.gs, que vive en la
# raíz del repositorio. Es el MISMO archivo que corre hoy en Apps Script: esa
# es toda la idea de la migración.
COPY apps-script.gs ./apps-script.gs
COPY servidor ./servidor

ENV NODE_ENV=production
ENV PORT=8080
ENV ZONA_HORARIA=America/Bogota

EXPOSE 8080

# Sin usuario root: si algún día alguien consigue ejecutar algo dentro del
# contenedor, que no lo haga como administrador.
USER node

CMD ["node", "servidor/src/servidor.js"]
