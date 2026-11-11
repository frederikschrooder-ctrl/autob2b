'use strict';
const { createApp } = require('../src/app');

async function main() {
  const ctx = createApp({
    dbFile: process.env.DB_FILE,
    uploadDir: process.env.UPLOAD_DIR,
    env: {
      SELLER_LEGAL_NAME: process.env.SELLER_LEGAL_NAME || '',
      SELLER_CVR: process.env.SELLER_CVR || '',
      SELLER_ADDRESS: process.env.SELLER_ADDRESS || '',
    },
    noTimer: true,
    rateLimit: false,
  });
  const server = ctx.app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { 'content-type': 'application/json', 'x-requested-with': 'autob2b' };
    const login = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: process.env.EMAIL, password: process.env.PASSWORD }),
    });
    if (login.status !== 200) throw new Error('login failed with status ' + login.status);
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    const buy = await fetch(base + process.env.BUY_PATH, {
      method: 'POST',
      headers: { ...headers, cookie },
      body: '{}',
    });
    const body = await buy.text();
    process.stdout.write(JSON.stringify({ status: buy.status, body: body.slice(0, 180) }));
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
    ctx.close();
  }
}

main().then(() => process.exit(0)).catch((e) => {
  process.stderr.write(e && e.stack ? e.stack : 'worker failed');
  process.exit(1);
});
