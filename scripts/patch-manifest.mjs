// ScanReal — готовит Android-проект к релизной сборке:
// 1. добавляет разрешения в AndroidManifest.xml
// 2. включает подпись release-сборки самоподписанным ключом
// Запускается в CI после npx cap add android.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = join(root, 'android');
const appDir = join(androidDir, 'app');
const manifestPath = join(appDir, 'src', 'main', 'AndroidManifest.xml');
const gradlePath = join(appDir, 'build.gradle');
const Q = String.fromCharCode(34);

/* ---------------------------------------------- 1. РАЗРЕШЕНИЯ В МАНИФЕСТ */
if (!existsSync(manifestPath)) {
  console.error('Манифест не найден: ' + manifestPath);
  process.exit(1);
}

let xml = readFileSync(manifestPath, 'utf8');

if (!xml.includes('android.permission.CAMERA')) {
  const perms = ['CAMERA', 'INTERNET', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'];
  const lines = perms.map(function (p) {
    return '    <uses-permission android:name=' + Q + 'android.permission.' + p + Q + ' />';
  });
  lines.push('    <uses-feature android:name=' + Q + 'android.hardware.camera' + Q + ' android:required=' + Q + 'false' + Q + ' />');

  const idx = xml.indexOf('<application');
  if (idx === -1) {
    console.error('Не найден тег application в манифесте.');
    process.exit(1);
  }
  xml = xml.slice(0, idx) + lines.join('\n') + '\n' + xml.slice(idx);
  writeFileSync(manifestPath, xml, 'utf8');
  console.log('Разрешения добавлены в AndroidManifest.xml');
} else {
  console.log('Разрешения уже есть в манифесте.');
}

/* --------------------------------------------- 2. РЕЛИЗНАЯ ПОДПИСЬ APK */
if (!existsSync(gradlePath)) {
  console.error('build.gradle не найден: ' + gradlePath);
  process.exit(1);
}

let gradle = readFileSync(gradlePath, 'utf8');

if (gradle.includes('scanrealRelease')) {
  console.log('Релизная подпись уже настроена.');
  process.exit(0);
}

// Ключ генерируется на этапе сборки и не хранится в репозитории.
const signingBlock = [
  '',
  '    signingConfigs {',
  '        scanrealRelease {',
  '            storeFile file(System.getenv(' + Q + 'KEYSTORE_PATH' + Q + '))',
  '            storePassword System.getenv(' + Q + 'KEYSTORE_PASSWORD' + Q + ')',
  '            keyAlias System.getenv(' + Q + 'KEY_ALIAS' + Q + ')',
  '            keyPassword System.getenv(' + Q + 'KEY_PASSWORD' + Q + ')',
  '        }',
  '    }',
  '',
].join('\n');

// Вставляем блок подписи внутрь android { ... } — перед buildTypes.
const buildTypesIdx = gradle.indexOf('buildTypes');

if (buildTypesIdx === -1) {
  console.error('Не найден блок buildTypes в build.gradle.');
  process.exit(1);
}

gradle = gradle.slice(0, buildTypesIdx) + signingBlock + '    ' + gradle.slice(buildTypesIdx);

// Внутри release { ... } указываем нашу подпись.
const releaseIdx = gradle.indexOf('release {');

if (releaseIdx === -1) {
  console.error('Не найден блок release в build.gradle.');
  process.exit(1);
}

const closingBrace = gradle.indexOf('}', releaseIdx);
gradle =
  gradle.slice(0, closingBrace) +
  '            signingConfig signingConfigs.scanrealRelease\n        ' +
  gradle.slice(closingBrace);

writeFileSync(gradlePath, gradle, 'utf8');

console.log('Релизная подпись добавлена в build.gradle');

// Keystore будем создавать в рабочей папке CI.
const ksDir = join(androidDir, 'keystore');
if (!existsSync(ksDir)) mkdirSync(ksDir, { recursive: true });
console.log('Папка для ключа подготовлена: ' + ksDir);
