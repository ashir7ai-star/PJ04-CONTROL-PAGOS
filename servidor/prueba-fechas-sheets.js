const { convertirFoto, serieADate, esColumnaDeFecha } = require('./src/fechas-sheets');
const { formatDate } = require('./src/entorno');
let f=0; const chk=(n,c,d)=>{console.log((c?'  ok   ':'  FALLA')+'  '+n+(c?'':'  → '+JSON.stringify(d)));if(!c)f++;};

console.log('\n=== Serie de Sheets -> Date ===');
// 15/09/2026 18:40 en Bogota. Serial calculado como dias desde 30/12/1899.
const dias = (Date.UTC(2026,8,15) - Date.UTC(1899,11,30)) / 86400000;
const serial = dias + (18*60+40)/1440;
const d = serieADate(serial, 'America/Bogota');
chk('reconstruye la hora de pared de Bogota',
    formatDate(d, 'America/Bogota', 'yyyy-MM-dd HH:mm') === '2026-09-15 18:40',
    formatDate(d, 'America/Bogota', 'yyyy-MM-dd HH:mm'));
chk('es un Date de verdad', Object.prototype.toString.call(d) === '[object Date]');

// El redondeo: sin el, 18:40 puede salir 18:39 por coma flotante.
const serial2 = dias + (9*60+5)/1440;
chk('no pierde un minuto por redondeo',
    formatDate(serieADate(serial2,'America/Bogota'),'America/Bogota','yyyy-MM-dd HH:mm') === '2026-09-15 09:05',
    formatDate(serieADate(serial2,'America/Bogota'),'America/Bogota','yyyy-MM-dd HH:mm'));

console.log('\n=== Que columnas se convierten ===');
chk('FECHA REGISTRO si', esColumnaDeFecha('FECHA REGISTRO'));
chk('FECHA DE PAGO si',  esColumnaDeFecha('FECHA DE PAGO'));
chk('FECHA si',          esColumnaDeFecha('FECHA'));
chk('VALOR FACTURA NO',  !esColumnaDeFecha('VALOR FACTURA'));
chk('MONTO NO',          !esColumnaDeFecha('MONTO'));
chk('SALDO BASE NO',     !esColumnaDeFecha('SALDO BASE'));

console.log('\n=== La foto completa ===');
const foto = { 'X': [
  ['FECHA REGISTRO','EMPRESA','VALOR FACTURA','FECHA DE PAGO'],
  [serial, 'AMPAC SAS', 119900, serial],
  ['15/09/2026 18:40', 'AMPAC SAS', 45000, ''],
  [0, 'AMPAC', 46000, 46000]
]};
const c = convertirFoto(foto, 'America/Bogota');
chk('la fecha se vuelve Date', Object.prototype.toString.call(c['X'][1][0])==='[object Date]');
chk('el IMPORTE sigue siendo numero', c['X'][1][2] === 119900, c['X'][1][2]);
chk('un importe que parece serial NO se convierte', c['X'][3][2] === 46000, c['X'][3][2]);
chk('pero en columna de fecha ese mismo numero SI', Object.prototype.toString.call(c['X'][3][3])==='[object Date]');
chk('el texto viejo se deja igual', c['X'][2][0] === '15/09/2026 18:40', c['X'][2][0]);
chk('un 0 en columna de fecha es vacio, no 1899', c['X'][3][0] === '', c['X'][3][0]);
chk('el encabezado no se toca', c['X'][0][0] === 'FECHA REGISTRO');
chk('la foto original no se modifica', foto['X'][1][0] === serial);

console.log('\n' + (f ? 'FALLARON '+f : 'TODAS LAS COMPROBACIONES PASARON'));
process.exit(f?1:0);
