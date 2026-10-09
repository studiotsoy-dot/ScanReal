// ScanReal — генерация иконок PWA без внешних зависимостей.
// Рисует логотип (прицел-сканер) прямо в PNG через попиксельную запись.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'public', 'icons');
mkdirSync(OUT, { recursive: true });

/* ---------------------------------------------------------- PNG-энкодер */
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
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;   // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------- РИСОВАНИЕ */
function drawIcon(size, { maskable = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2;
  let seed = 1337;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  const put = (x, y, r, g, b, a = 1) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const inv = 1 - a;
    buf[i]     = Math.round(buf[i]     * inv + r * a);
    buf[i + 1] = Math.round(buf[i + 1] * inv + g * a);
    buf[i + 2] = Math.round(buf[i + 2] * inv + b * a);
    buf[i + 3] = Math.max(buf[i + 3], Math.round(a * 255));
  };

  // Мягкое свечение
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy) / (size / 2);
      const glow = Math.max(0, 1 - d) ** 2.2 * 0.30;
      put(x, y, 20 * glow, 120 * glow, 180 * glow, 1);
    }
  }

  // Фоновый градиент
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (size * 2);
      put(x, y, 5 + t * 8, 8 + t * 14, 14 + t * 22, maskable ? 1 : 0.94);
    }
  }

  const cyan = [53, 224, 255];
  const lime = [139, 255, 107];

  // Кольца прицела
  const rings = [
    { r: size * 0.34, w: size * 0.022, dash: 0.40, col: cyan, off: 0 },
    { r: size * 0.21, w: size * 0.016, dash: 0.30, col: cyan, off: 0.5 },
  ];

  rings.forEach((ring) => {
    const steps = Math.round(ring.r * 8 + 400);
    for (let i = 0; i < steps; i++) {
      const ang = (i / steps) * Math.PI * 2;
      const phase = ((i / steps) + ring.off) % 1;
      if (phase > ring.dash) continue;
      for (let t = -ring.w / 2; t <= ring.w / 2; t += 0.5) {
        const rr = ring.r + t;
        put(
          Math.round(cx + Math.cos(ang) * rr),
          Math.round(cy + Math.sin(ang) * rr),
          ring.col[0], ring.col[1], ring.col[2], 0.95
        );
      }
    }
  });

  // Центральная точка
  const coreR = size * 0.055;
  for (let y = -Math.ceil(coreR) - 2; y <= Math.ceil(coreR) + 2; y++) {
    for (let x = -Math.ceil(coreR) - 2; x <= Math.ceil(coreR) + 2; x++) {
      const d = Math.hypot(x, y);
      if (d <= coreR) {
        put(Math.round(cx + x), Math.round(cy + y), lime[0], lime[1], lime[2], 1);
      } else if (d <= coreR + 1.5) {
        put(Math.round(cx + x), Math.round(cy + y), lime[0], lime[1], lime[2], 0.3);
      }
    }
  }

  // Засечки по четырём сторонам
  const tickLen = size * 0.10;
  const tickW = Math.max(1, size * 0.018);
  const tickR = size * 0.445;
  const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  dirs.forEach(([dx, dy]) => {
    for (let l = 0; l < tickLen; l++) {
      const px = cx + dx * (tickR - l);
      const py = cy + dy * (tickR - l);
      const fade = 0.35 + (l / tickLen) * 0.6;
      for (let w = -tickW / 2; w <= tickW / 2; w += 0.5) {
        if (dx === 0) put(Math.round(px + w), Math.round(py), cyan[0], cyan[1], cyan[2], fade);
        else put(Math.round(px), Math.round(py + w), cyan[0], cyan[1], cyan[2], fade);
      }
    }
  });

  // Лёгкий шум — «цифровой» вид
  for (let i = 0; i < size * 4; i++) {
    const x = Math.floor(rnd() * size);
    const y = Math.floor(rnd() * size);
    const idx = (y * size + x) * 4;
    if (buf[idx + 3] > 0) {
      buf[idx] = Math.min(255, buf[idx] + 22);
      buf[idx + 1] = Math.min(255, buf[idx + 1] + 26);
      buf[idx + 2] = Math.min(255, buf[idx + 2] + 30);
    }
  }

  return encodePNG(size, size, buf);
}

const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
];

for (const [name, size, opts] of targets) {
  const png = drawIcon(size, opts);
  writeFileSync(join(OUT, name), png);
  console.log(`✓ ${name}  ${size}x${size}  ${(png.length / 1024).toFixed(1)} КБ`);
}
console.log('Иконки созданы в public/icons/');
