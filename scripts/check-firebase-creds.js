const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '..', '.env.vercel.local');
if (!fs.existsSync(envPath)) {
  console.error('.env.vercel.local not found');
  process.exit(1);
}
const envText = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=("(.*)"|(.*))$/);
  if (m) env[m[1]] = m[3] !== undefined ? m[3] : m[4];
}
console.log('loaded keys:', Object.keys(env));
console.log('project:', env.FIREBASE_PROJECT_ID ? 'ok' : 'missing');
console.log('client:', env.FIREBASE_CLIENT_EMAIL ? 'ok' : 'missing');
console.log('private:', env.FIREBASE_PRIVATE_KEY ? 'ok' : 'missing');
console.log('private starts with -----BEGIN PRIVATE KEY-----:', env.FIREBASE_PRIVATE_KEY ? env.FIREBASE_PRIVATE_KEY.trim().startsWith('-----BEGIN PRIVATE KEY-----') : false);
