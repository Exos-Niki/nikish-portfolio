// Local development server. On Vercel, api/index.js is used directly.
const fs = require('fs');
const path = require('path');

// tiny .env loader so no extra package is needed
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch (e) {
  /* no .env file */
}

const express = require('express');
const app = require('./api/index');

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log('Portfolio:  http://localhost:' + port);
  console.log('Admin:      http://localhost:' + port + '/admin');
});
