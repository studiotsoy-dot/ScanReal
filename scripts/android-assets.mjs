// ScanReal — генерация ресурсов для Android: сплэш-экраны и иконки лаунчера.
// Рисует прицел-сканер в PNG без внешних библиотек.
// Запускается в CI после `npx cap add android`.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const androidRes = join(root, 'android', 'app', 'src', 'main', 'res');

/* ---------------------------------------------------------- PNG-ЭНКОДЕР */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------------------------------------------- РИСОВАНИЕ ПРИЦЕЛА */
// cx, cy — центр, R — радиус мишени.
// Принимает ШИРИНУ и ВЫСОТУ отдельно: пропорции не искажаются.
// Если высота не задана, картинка квадратная.
function drawTarget(width, height, opts = {}) {
  const size = width;          // для обратной совместимости
  const H = height || width;
  const {
    bg = [5, 7, 13],
    withBg = true,
    scale = 1,
    corner = 0,
    bright = false,     // усиленная яркость для иконок лаунчера
  } = opts;

  // Множитель яркости линий и фона.
  const k = bright ? 1.35 : 1;

  const buf = Buffer.alloc(width * H * 4);
  const cx = width / 2;
  const cy = H / 2;
  // Радиус считаем по МЕНЬШЕЙ стороне — мишень всегда круглая, не овал.
  const R = (Math.min(width, H) / 2) * scale;

  const put = (x, y, r, g, b, a) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= width || yi >= H) return;
    const i = (yi * width + xi) * 4;
    const inv = 1 - a;
    buf[i] = Math.round(buf[i] * inv + r * a);
    buf[i + 1] = Math.round(buf[i + 1] * inv + g * a);
    buf[i + 2] = Math.round(buf[i + 2] * inv + b * a);
    buf[i + 3] = Math.max(buf[i + 3], Math.round(a * 255));
  };

  // Фон со свечением (если нужен)
  if (withBg) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < width; x++) {
        // Скругление углов
        if (corner > 0) {
          const dx = Math.max(corner - x, x - (width - corner), 0);
          const dy = Math.max(corner - y, y - (H - corner), 0);
          if (Math.hypot(dx, dy) > corner) continue;
        }
        const d = Math.hypot(x - cx, y - cy) / (Math.min(width, H) / 2);
        const glow = Math.max(0, 1 - d) ** 2.2 * (bright ? 0.60 : 0.26);
        const t = (x + y) / (width + H);
        put(x, y,
          Math.min(255, (bg[0] + 12 * glow + t * 6) * k),
          Math.min(255, (bg[1] + 90 * glow + t * 10) * k),
          Math.min(255, (bg[2] + 150 * glow + t * 18) * k),
          1);
      }
    }
  }

  // Яркие цвета линий: на иконке лаунчера должны читаться.
  const cyan = bright ? [120, 240, 255] : [53, 224, 255];
  const lime = bright ? [180, 255, 150] : [139, 255, 107];

  // Линии на иконке толще — иначе тонкие кольца «исчезают» при малом размере.
  const ringW = Math.max(1, R * (bright ? 0.085 : 0.055));

  // Два кольца с разрывами — как у прицела
  const rings = [
    { r: R * 0.80, w: ringW, dash: 0.42, off: 0.0 },
    { r: R * 0.50, w: ringW * 0.72, dash: 0.30, off: 0.5 },
  ];

  // Сглаженная точка: закрашиваем с плавным краем, чтобы линии
  // не выглядели «дискретными» (ступеньками из отдельных пикселей).
  const putAA = (x, y, col, alpha) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    // Распределяем яркость по 4 соседним пикселям (билинейная фильтрация).
    put(x0, y0, col[0], col[1], col[2], alpha * (1 - fx) * (1 - fy));
    put(x0 + 1, y0, col[0], col[1], col[2], alpha * fx * (1 - fy));
    put(x0, y0 + 1, col[0], col[1], col[2], alpha * (1 - fx) * fy);
    put(x0 + 1, y0 + 1, col[0], col[1], col[2], alpha * fx * fy);
  };

  rings.forEach((ring) => {
    const steps = Math.round(ring.r * 8 + 500);
    for (let i = 0; i < steps; i++) {
      const ang = (i / steps) * Math.PI * 2;
      const phase = ((i / steps) + ring.off) % 1;
      if (phase > ring.dash) continue;
      // Шаг 0.25 px + сглаживание = сплошная ровная линия.
      for (let t = -ring.w / 2; t <= ring.w / 2; t += 0.25) {
        const rr = ring.r + t;
        putAA(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr, cyan, 0.95);
      }
    }
  });

  // Засечки по четырём сторонам
  const tickLen = R * 0.26;
  const tickW = Math.max(1, R * 0.045);
  const tickR = R * 1.02;
  [[0, -1], [0, 1], [-1, 0], [1, 0]].forEach(([dx, dy]) => {
    for (let l = 0; l < tickLen; l += 0.25) {
      const px = cx + dx * (tickR - l);
      const py = cy + dy * (tickR - l);
      const fade = 0.35 + (l / tickLen) * 0.6;
      for (let w = -tickW / 2; w <= tickW / 2; w += 0.25) {
        if (dx === 0) putAA(px + w, py, cyan, fade);
        else putAA(px, py + w, cyan, fade);
      }
    }
  });

  // Центральная точка — со сглаженным краем
  const coreR = R * 0.13;
  for (let y = -Math.ceil(coreR) - 3; y <= Math.ceil(coreR) + 3; y++) {
    for (let x = -Math.ceil(coreR) - 3; x <= Math.ceil(coreR) + 3; x++) {
      const d = Math.hypot(x, y);
      if (d <= coreR - 0.5) {
        putAA(cx + x, cy + y, lime, 1);
      } else if (d <= coreR + 1.2) {
        // Плавный переход к фону вместо резкой границы.
        const a = Math.max(0, (coreR + 1.2 - d) / 1.7);
        putAA(cx + x, cy + y, lime, a);
      }
    }
  }

  return encodePNG(width, H, buf);
}

/* --------------------------------------------------------------- ВЫВОД */
if (!existsSync(androidRes)) {
  console.error('Папка ресурсов Android не найдена: ' + androidRes);
  console.error('Сначала выполните: npx cap add android');
  process.exit(1);
}

let count = 0;

function save(dir, name, png) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), png);
  count++;
}

/* 1. ИКОНКИ ЛАУНЧЕРА — квадратные, пропорции не искажаются */
const mipmaps = [
  ['mipmap-mdpi', 48],
  ['mipmap-hdpi', 72],
  ['mipmap-xhdpi', 96],
  ['mipmap-xxhdpi', 144],
  ['mipmap-xxxhdpi', 192],
];

mipmaps.forEach(([folder, size]) => {
  const dir = join(androidRes, folder);
  // ВАЖНО: фон ТЁМНЫЙ во всех вариантах иконки.
  // Прозрачный foreground Android кладёт на белую подложку —
  // светло-зелёный прицел на белом становится невидимым.
  save(dir, 'ic_launcher.png', drawTarget(size, size, { scale: 0.72, withBg: true, bright: true }));
  save(dir, 'ic_launcher_round.png', drawTarget(size, size, { scale: 0.68, withBg: true, corner: size / 2, bright: true }));
  save(dir, 'ic_launcher_foreground.png', drawTarget(size, size, { scale: 0.60, withBg: true, bright: true }));
});

/* 2. СПЛЭШ-ЭКРАНЫ
   ГЛАВНОЕ: пропорции должны совпадать с реальным экраном телефона.
   Современные телефоны — 9:20 (0.45). Если нарисовать 3:5 (0.60),
   Android растянет картинку под экран, и прицел станет овалом.
   Поэтому рисуем строго 9:20. */
const splashes = [
  // Портрет 9:20 — основной вариант для телефона
  ['drawable', 540, 1200],
  ['drawable-port-mdpi', 360, 800],
  ['drawable-port-hdpi', 540, 1200],
  ['drawable-port-xhdpi', 720, 1600],
  ['drawable-port-xxhdpi', 1080, 2400],
  ['drawable-port-xxxhdpi', 1080, 2400],
  // Ландшафт 20:9
  ['drawable-land-mdpi', 800, 360],
  ['drawable-land-hdpi', 1200, 540],
  ['drawable-land-xhdpi', 1600, 720],
  ['drawable-land-xxhdpi', 1600, 720],
  ['drawable-land-xxxhdpi', 1600, 720],
];

// Картинку сплэша НЕ создаём: Android её растягивает под экран,
// и прицел превращается в овал. Сплэш делаем сплошным тёмным фоном
// (см. fix-splash.mjs). Прицел остаётся на иконке приложения.
console.log('Сплэш: картинка не создаётся (используется сплошной фон)');

/* 3. ТЁМНЫЙ ФОН для темы приложения */
const bgDir = join(androidRes, 'values');
if (!existsSync(bgDir)) mkdirSync(bgDir, { recursive: true });
writeFileSync(
  join(bgDir, 'colors.xml'),
  [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<resources>',
    '    <color name="scanreal_background">#05070D</color>',
    '    <color name="scanreal_cyan">#35E0FF</color>',
    '</resources>',
    '',
  ].join('\n'),
  'utf8'
);
count++;

console.log('Ресурсы Android созданы: ' + count + ' файлов');
console.log('  иконки: ' + (mipmaps.length * 3) + ' (5 плотностей x 3 вида)');
console.log('  сплэши: ' + splashes.length + ' (портрет + ландшафт)');
console.log('  цвета:  1');

/* 4. СТРАХОВКА: перезаписываем ВСЕ возможные дефолтные сплэши Capacitor.
   Capacitor может положить свою картинку под другим именем —
   затираем всё, что похоже на его логотип. */
const suspicious = [
  'splash.png',
  'capacitor_splash.png',
  'splash_capacitor.png',
  'ic_capacitor.png',
  'capacitor.png',
];

let overwritten = 0;
const drawableFolders = readdirSync(androidRes).filter((d) => d.startsWith('drawable'));

drawableFolders.forEach((folder) => {
  const full = join(androidRes, folder);
  const ownPath = join(full, 'splash.png');

  if (!existsSync(ownPath)) return;
  const ownData = readFileSync(ownPath);

  suspicious.forEach((name) => {
    if (name === 'splash.png') return;      // свой файл не трогаем
    const p = join(full, name);
    if (existsSync(p)) {
      writeFileSync(p, ownData);
      overwritten++;
    }
  });
});

console.log('  Дефолтных картинок Capacitor перезаписано: ' + overwritten);
console.log('  Папок drawable проверено: ' + drawableFolders.length);
