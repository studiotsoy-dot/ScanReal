// Добавляет в AndroidManifest.xml разрешения, нужные ScanReal.
// Запускается в CI после npx cap add android.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');

if (!existsSync(manifestPath)) {
  console.error('Манифест не найден: ' + manifestPath);
  console.error('Сначала выполните: npx cap add android');
  process.exit(1);
}

let xml = readFileSync(manifestPath, 'utf8');

if (xml.includes('android.permission.CAMERA')) {
  console.log('Разрешения уже есть, правка не нужна.');
  process.exit(0);
}

const Q = String.fromCharCode(34);
const perms = ['CAMERA', 'INTERNET', 'ACCESS_FINE_LOCATION'];

const lines = perms.map(function (p) {
  return '    <uses-permission android:name=' + Q + 'android.permission.' + p + Q + ' />';
});

lines.push('    <uses-feature android:name=' + Q + 'android.hardware.camera' + Q + ' android:required=' + Q + 'false' + Q + ' />');

const block = lines.join('\n') + '\n';
const idx = xml.indexOf('<application');

if (idx === -1) {
  console.error('Не найден тег application в манифесте.');
  process.exit(1);
}

xml = xml.slice(0, idx) + block + xml.slice(idx);
writeFileSync(manifestPath, xml, 'utf8');
console.log('Разрешения добавлены в AndroidManifest.xml');
