process.env.GOOGLE_CREDENCIALES_ARCHIVO='../credenciales.json';
process.env.SHEETS_ID='1z8qd3qfU0k2y07xddtu-3-kFVe9EnOU8ZT7mDEjf1e8';
const { leerHojas } = require('./src/hojas');
(async () => {
  const d = await leerHojas(['USUARIOS'], true);
  const filas = d['USUARIOS'] || [];
  const enc = (filas[0]||[]).map(String);
  const iCorreo = enc.indexOf('CORREO'), iEstado = enc.indexOf('ESTADO'), iRol = enc.indexOf('ROL');
  const cuenta = {};
  console.log('Usuarios registrados:\n');
  filas.slice(1).filter(f => f && f[iCorreo]).forEach(f => {
    const correo = String(f[iCorreo]).trim();
    const dom = correo.split('@')[1] || '(sin dominio)';
    cuenta[dom] = (cuenta[dom]||0)+1;
    // Se muestra la inicial y el dominio: alcanza para decidir, sin exponer correos.
    console.log('  ' + correo[0] + '***@' + dom + '   rol=' + String(f[iRol]||'') + '  estado=' + String(f[iEstado]||''));
  });
  console.log('\nPor dominio:');
  Object.keys(cuenta).forEach(k => console.log('  ' + k + ': ' + cuenta[k]));
  const fuera = Object.keys(cuenta).filter(k => k !== 'ylevigroup.com');
  console.log('\n' + (fuera.length
    ? '⚠️  HAY ' + fuera.reduce((s,k)=>s+cuenta[k],0) + ' usuario(s) FUERA de ylevigroup.com: ' + fuera.join(', ')
    : '✅ Todos son de ylevigroup.com'));
})().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
