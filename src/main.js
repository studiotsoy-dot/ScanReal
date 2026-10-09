// ScanReal — главная логика приложения.
// Камера + распознавание объектов + датчики телефона + статистика.

import './styles.css';
import { Detector, ruName } from './detector.js';
import { Sensors } from './sensors.js';
import { Sparkline } from './visual.js';
import { getPosition, geoAvailable, geoLastError, formatCoords, mapLink, mapLinkForSession } from './geo.js';
import { diagnoseGeo } from './geodiag.js';
import { ScanHistory, humanTime, formatTime, describeObjects, accuracyText } from './history.js';

/* ------------------------------------------------------------ ССЫЛКИ DOM */
const $ = (id) => document.getElementById(id);

const video = $('video');
const overlay = $('overlay');
const ctx = overlay.getContext('2d');

const bootEl = $('boot');
const appEl = $('app');
const statsEl = $('stats');

const bootFill = $('bootFill');
const bootStatus = $('bootStatus');

const statusText = $('statusText');
const fpsEl = $('fps');
const liveDot = document.querySelector('.dot-live');

const labelsEl = $('labels');
const detectedStrip = $('detectedStrip');
const toastEl = $('toast');

const btnStart = $('btnStart');
const btnStop = $('btnStop');
const btnStats = $('btnStats');
const btnInstall = $('btnInstall');
const btnReset = $('btnReset');
const statsClose = $('statsClose');
const toggleSensors = $('toggleSensors');
const spBody = $('spBody');

/* ------------------------------------------------------------------ СОСТОЯНИЕ */
const detector = new Detector();
const sensors = new Sensors();
const history = new ScanHistory();
let currentGeo = null;        // последние координаты
let geoPending = false;       // идёт запрос координат

let stream = null;
let running = false;
let lastFrame = 0;
let rafId = null;

// статистика
const stats = {
  total: 0,                       // сколько объектов распознано всего (накопленно)
  classes: {},                    // класс -> сколько раз
  confSum: 0, confCount: 0,
  startedAt: null,
};

// дедупликация: не считать один и тот же объект 20 раз в секунду
const seenCooldown = new Map();   // класс -> timestamp последнего зачёта
const DEDUP_MS = 2500;

const sparkAcc = new Sparkline($('sparkAcc'), '#35e0ff');
const sparkGyro = new Sparkline($('sparkGyro'), '#8bff6b');

const toast = (msg, ms = 3200) => {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove('show'), ms);
};

/* --------------------------------------------------------------- ЗАГРУЗКА */
function setBoot(p, text) {
  bootFill.style.width = `${Math.round(p * 100)}%`;
  if (text) bootStatus.textContent = text;
}

async function boot() {
  try {
    setBoot(0.02, 'проверка возможностей устройства…');
    await detector.load((p, t) => setBoot(p, t));
    setBoot(1, 'готово');
    setTimeout(showApp, 380);
  } catch (err) {
    console.error(err);
    setBoot(1, 'ошибка загрузки модели');
    bootStatus.textContent = 'не удалось загрузить модель — проверьте интернет при первом запуске';
    setTimeout(showApp, 1600);
  }
}

function showApp() {
  bootEl.classList.remove('active');
  appEl.classList.add('active');
  startSensors();
  toast('Нажмите «Включить камеру» и наведите на объект', 4200);
}

function showStats() { statsEl.classList.add('active'); renderStats(); }
function hideStats() { statsEl.classList.remove('active'); }

/* ------------------------------------------------------------------ ДАТЧИКИ */
function startSensors() {
  sensors.start(() => { /* отрисовка идёт в общем кадре */ });
  // Продвигаем кольцевые буферы с постоянной частотой.
  setInterval(() => sensors.advance(), 33);
}

function updateSensorUI() {
  const d = sensors.data;
  $('accX').textContent = d.acc.x.toFixed(2);
  $('accY').textContent = d.acc.y.toFixed(2);
  $('accZ').textContent = d.acc.z.toFixed(2);

  $('gyroA').textContent = d.gyro.a;
  $('gyroB').textContent = d.gyro.b;
  $('gyroG').textContent = d.gyro.g;

  $('heading').textContent = d.heading === null ? '—' : d.heading;
  if (d.heading !== null) $('needle').style.transform = `rotate(${d.heading}deg)`;

  if (d.light === null) {
    $('lightVal').textContent = '—';
    $('lightFill').style.width = '0%';
  } else {
    $('lightVal').textContent = d.light;
    // Шкала логарифмическая: 0..1000+ lux
    const pct = Math.min(100, (Math.log10(Math.max(d.light, 1)) / 3) * 100);
    $('lightFill').style.width = `${pct}%`;
  }

  sparkAcc.draw(sensors.buffers.acc, sensors.bufIndex, sensors.bufFilled);
  sparkGyro.draw(sensors.buffers.gyro, sensors.bufIndex, sensors.bufFilled);
}

/* ------------------------------------------------------------------- КАМЕРА */
async function startCamera() {
  try {
    statusText.textContent = 'запрос доступа к камере…';
    await sensors.requestPermission();

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });

    video.srcObject = stream;
    await video.play();

    running = true;
    stats.startedAt = stats.startedAt || Date.now();
    history.startSession();
    requestGeo();          // координаты запрашиваем в фоне, не блокируя камеру

    btnStart.classList.add('hidden');
    btnStop.classList.remove('hidden');
    liveDot.classList.add('on');
    statusText.textContent = 'сканирование';
    toast('Сканирование запущено');

    resizeOverlay();
    loop();
  } catch (err) {
    console.error(err);
    statusText.textContent = 'нет доступа к камере';
    if (err && err.name === 'NotAllowedError') {
      toast('Доступ к камере запрещён. Разрешите его в настройках браузера.', 5000);
    } else if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
      toast('Камера работает только по HTTPS. Откройте страницу по защищённому адресу.', 6000);
    } else {
      toast('Не удалось включить камеру: ' + (err?.message || 'неизвестная ошибка'), 5000);
    }
  }
}

function stopCamera() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  video.srcObject = null;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  labelsEl.innerHTML = '';
  detectedStrip.innerHTML = '<span class="detected-empty">наведите камеру на объект</span>';

  btnStart.classList.remove('hidden');
  btnStop.classList.add('hidden');
  liveDot.classList.remove('on');
  statusText.textContent = 'камера не активна';
  fpsEl.textContent = '0';
}

function resizeOverlay() {
  const r = video.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  overlay.width = Math.round(r.width * dpr);
  overlay.height = Math.round(r.height * dpr);
  overlay.style.width = `${r.width}px`;
  overlay.style.height = `${r.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/* --------------------------------------------- ПЕРЕСЧЁТ КООРДИНАТ КАДРА */
// Модель отдаёт координаты в пикселях исходного кадра (например 1280x720).
// Видео выводится с object-fit: cover, поэтому нужен пересчёт с обрезкой.
function frameMapper() {
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  const r = video.getBoundingClientRect();
  const cw = r.width;
  const ch = r.height;

  const scale = Math.max(cw / vw, ch / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  const dx = (cw - dw) / 2;
  const dy = (ch - dh) / 2;

  return (box) => {
    const [x, y, w, h] = box;
    return {
      x: x * scale + dx,
      y: y * scale + dy,
      w: w * scale,
      h: h * scale,
    };
  };
}

/* ---------------------------------------------------------- ГЕОЛОКАЦИЯ */
/** Запрашивает координаты в фоне. Не блокирует камеру, ошибки не показываем. */
async function requestGeo(force = false) {
  if (geoPending) return;
  geoPending = true;
  try {
    const fix = await getPosition(force);
    if (fix) {
      currentGeo = fix;
      const acc = fix.accuracy != null ? ` ±${Math.round(fix.accuracy)} м` : '';
      toast(`Координаты получены${acc}`, 2200);
    } else if (force) {
      // Пользователь запросил вручную — тут стоит объяснить, почему пусто.
      toast('Координаты недоступны: ' + (geoLastError() || 'нет сигнала GPS'), 4200);
    }
  } catch {
    /* молча: отсутствие GPS не должно мешать работе */
  } finally {
    geoPending = false;
  }
}

/* ------------------------------------------------------------- ИСТОРИЯ */
function openHistory() {
  historyEl.classList.add('active');
  renderHistory();
}
function closeHistory() { historyEl.classList.remove('active'); }

function renderHistory() {
  const sessions = history.sessions();
  const total = history.count();
  const withGeo = history.geoCount();

  $('hTotal').textContent = total;
  $('hSessions').textContent = sessions.length;
  $('hGeo').textContent = withGeo;

  const today = new Date().toDateString();
  $('hDay').textContent = history.scans.filter(
    (s) => new Date(s.time).toDateString() === today
  ).length;

  // Статус геолокации
  const statusEl = $('geoStatus');
  if (!geoAvailable() && !currentGeo) {
    statusEl.className = 'geo-status warn';
    statusEl.innerHTML = '<span>⚠</span><span>Геолокация недоступна на этом устройстве — записи сохраняются без координат</span>';
  } else if (currentGeo) {
    const src = currentGeo.source === 'native' ? 'GPS' : 'браузер';
    statusEl.className = 'geo-status ok';
    statusEl.innerHTML =
      `<span>📍</span><span>Координаты: <b>${formatCoords(currentGeo)}</b> ` +
      `${accuracyText(currentGeo.accuracy)} · источник: ${src}</span>`;
  } else {
    statusEl.className = 'geo-status warn';
    statusEl.innerHTML =
      '<span>📍</span><span>Координаты ещё не получены. Они запросятся при включении камеры. ' +
      '<b id="geoRetry" style="text-decoration:underline;cursor:pointer">Запросить сейчас</b></span>';
    const retry = $('geoRetry');
    if (retry) retry.addEventListener('click', () => requestGeo(true));
  }

  const listEl = $('historyList');
  if (!sessions.length) {
    listEl.innerHTML = '<p class="muted">пока нет записей — включите камеру и наведите на объект</p>';
    return;
  }

  listEl.innerHTML = sessions.map((s) => {
    const geo = s.lastGeo;
    const geoHtml = geo
      ? `<div class="session-geo">
           <span class="pin">📍</span>
           <span>${formatCoords(geo)} ${accuracyText(geo.accuracy)}</span>
           ${mapLink(geo) ? `<a href="${mapLink(geo)}" target="_blank" rel="noopener">на карте →</a>` : ''}
         </div>`
      : `<div class="session-geo"><span class="pin">📍</span><span>без координат</span></div>`;

    const items = s.items.slice(-6).reverse().map((it) => `
      <div class="scan-row">
        <span class="scan-time">${formatTime(it.time)}</span>
        <span class="scan-objs">${it.objects.map((o) => `${o.ru} ${o.s}%`).join(', ')}</span>
      </div>`).join('');

    return `
      <div class="session-card">
        <div class="session-head">
          <span class="session-when">${humanTime(new Date(s.end).toISOString())}
            <small>${formatTime(new Date(s.start).toISOString())}–${formatTime(new Date(s.end).toISOString())}</small>
          </span>
          <span class="session-count">${s.count} ${plural(s.count, 'скан', 'скана', 'сканов')}</span>
        </div>
        ${geoHtml}
        <div class="session-objects">${describeObjects(s.objects)}</div>
        ${s.items.length > 1 ? `<div class="session-items">${items}</div>` : ''}
      </div>`;
  }).join('');
}

/** Русские формы множественного числа. */
function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

/* ---------------------------------------------------------- ГЛАВНЫЙ ЦИКЛ */
let frameCounter = 0;
let fpsTime = performance.now();

async function loop() {
  if (!running) return;
  rafId = requestAnimationFrame(loop);

  const now = performance.now();
  updateSensorUI();

  // Распознаём примерно 8 раз в секунду — этого достаточно и не греет телефон.
  if (now - lastFrame < 120) return;
  lastFrame = now;

  // FPS
  frameCounter++;
  if (now - fpsTime >= 1000) {
    fpsEl.textContent = frameCounter;
    frameCounter = 0;
    fpsTime = now;
  }

  let preds = [];
  try {
    preds = await detector.detect(video);
  } catch (err) {
    console.error('detect error', err);
    return;
  }
  if (!running) return;

  drawPredictions(preds);
  updateChips(preds);
  accountStats(preds);
  history.record(preds, currentGeo);
}

/* --------------------------------------------------------- ОТРИСОВКА РАМОК */
function drawPredictions(preds) {
  const w = overlay.width / (Math.min(window.devicePixelRatio || 1, 2));
  const h = overlay.height / (Math.min(window.devicePixelRatio || 1, 2));
  ctx.clearRect(0, 0, w, h);

  if (!preds.length) return;

  const map = frameMapper();

  preds.forEach((p, i) => {
    const b = map(p.bbox);
    const strong = p.score > 0.7;
    const color = strong ? '#35e0ff' : p.score > 0.55 ? '#8bff6b' : '#ffc14d';

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;

    // Уголки вместо полной рамки — выглядит как приборный видоискатель
    const c = Math.min(22, b.w * 0.28, b.h * 0.28);
    const x2 = b.x + b.w, y2 = b.y + b.h;

    ctx.beginPath();
    // левый верх
    ctx.moveTo(b.x, b.y + c); ctx.lineTo(b.x, b.y); ctx.lineTo(b.x + c, b.y);
    // правый верх
    ctx.moveTo(x2 - c, b.y); ctx.lineTo(x2, b.y); ctx.lineTo(x2, b.y + c);
    // правый низ
    ctx.moveTo(x2, y2 - c); ctx.lineTo(x2, y2); ctx.lineTo(x2 - c, y2);
    // левый низ
    ctx.moveTo(b.x + c, y2); ctx.lineTo(b.x, y2); ctx.lineTo(b.x, y2 - c);
    ctx.stroke();

    // простая тонкая рамка
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.25;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.globalAlpha = 1;

    // плашка с названием
    const label = `${p.ru} ${Math.round(p.score * 100)}%`;
    ctx.font = '600 13px -apple-system, Segoe UI, Roboto, sans-serif';
    const tw = ctx.measureText(label).width;
    const padX = 8, padY = 5, bh = 22;
    const ly = b.y - bh - 4 < 0 ? b.y + 4 : b.y - bh - 4;

    ctx.fillStyle = 'rgba(5, 10, 20, 0.82)';
    ctx.beginPath();
    ctx.roundRect(b.x, ly, tw + padX * 2, bh, 6);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(label, b.x + padX, ly + bh / 2 + 0.5);

    ctx.restore();
  });
}

/* ------------------------------------------------------- ПЛАШКИ ПОД ВИДЕО */
function updateChips(preds) {
  if (!preds.length) {
    detectedStrip.innerHTML = '<span class="detected-empty">наведите камеру на объект</span>';
    return;
  }
  // уникальные классы, максимум 6 плашек
  const uniq = new Map();
  preds.forEach((p) => {
    if (!uniq.has(p.class) || uniq.get(p.class).score < p.score) uniq.set(p.class, p);
  });
  const list = [...uniq.values()].slice(0, 6);

  detectedStrip.innerHTML = list
    .map((p) => `<span class="chip">${p.ru} <b>${Math.round(p.score * 100)}%</b></span>`)
    .join('');
}

/* ------------------------------------------------------------- СТАТИСТИКА */
function accountStats(preds) {
  const now = Date.now();
  preds.forEach((p) => {
    if (p.score < 0.6) return;
    const last = seenCooldown.get(p.class) || 0;
    if (now - last < DEDUP_MS) return;      // не считаем один объект многократно
    seenCooldown.set(p.class, now);

    stats.total++;
    stats.classes[p.class] = (stats.classes[p.class] || 0) + 1;
    stats.confSum += p.score;
    stats.confCount++;
  });
}

function renderStats() {
  $('stTotal').textContent = stats.total;
  $('stClasses').textContent = Object.keys(stats.classes).length;

  const secs = stats.startedAt ? Math.round((Date.now() - stats.startedAt) / 1000) : 0;
  $('stSession').textContent = secs < 60 ? `${secs}с` : `${Math.floor(secs / 60)}м ${secs % 60}с`;
  $('stConf').textContent = stats.confCount
    ? `${Math.round((stats.confSum / stats.confCount) * 100)}%`
    : '0%';

  const entries = Object.entries(stats.classes).sort((a, b) => b[1] - a[1]);
  const max = entries.length ? entries[0][1] : 1;
  const listEl = $('statsList');

  if (!entries.length) {
    listEl.innerHTML = '<p class="muted">пока ничего не распознано</p>';
    return;
  }

  listEl.innerHTML = entries
    .map(([cls, cnt]) => `
      <div class="stat-row">
        <span class="stat-name">${ruName(cls)}</span>
        <span class="stat-bar"><i style="width:${Math.round((cnt / max) * 100)}%"></i></span>
        <span class="stat-count">${cnt}</span>
      </div>`)
    .join('');
}

/* ------------------------------------------------------ PWA: УСТАНОВКА */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  btnInstall.classList.remove('hidden');
});
btnInstall.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  btnInstall.classList.add('hidden');
});
window.addEventListener('appinstalled', () => {
  btnInstall.classList.add('hidden');
  toast('ScanReal установлен на устройство');
});

/* --------------------------------------------------------------- СОБЫТИЯ */
btnStart.addEventListener('click', startCamera);
btnStop.addEventListener('click', stopCamera);
btnStats.addEventListener('click', showStats);
statsClose.addEventListener('click', hideStats);

// --- История ---
const btnHistory = $('btnHistory');
const historyEl = $('history');
const historyClose = $('historyClose');

btnHistory.addEventListener('click', openHistory);
historyClose.addEventListener('click', closeHistory);
$('btnExportJson').addEventListener('click', () => {
  if (!history.count()) { toast('История пуста'); return; }
  history.exportJSON();
  toast('Файл JSON сохранён');
});
$('btnExportCsv').addEventListener('click', () => {
  if (!history.count()) { toast('История пуста'); return; }
  history.exportCSV();
  toast('Файл CSV сохранён');
});
$('btnClearHistory').addEventListener('click', () => {
  history.clear();
  renderHistory();
  toast('История очищена');
});

// --- Диагностика GPS: показывает точную причину, если координат нет ---
$('btnGeoDiag').addEventListener('click', async () => {
  const box = $('geoDiag');
  box.classList.remove('hidden');
  box.textContent = 'Проверяем…';
  try {
    const r = await diagnoseGeo();
    const lines = [
      'Нативное приложение : ' + (r.isNative ? 'ДА' : 'НЕТ (браузер)'),
      'Платформа          : ' + r.platform,
      'Плагин геолокации  : ' + (r.pluginAvailable ? 'ПОДКЛЮЧЁН' : 'НЕ НАЙДЕН'),
      r.pluginError ? '  ошибка плагина   : ' + r.pluginError : null,
      'Разрешение         : ' + r.perm,
      'Браузерный API     : ' + (r.browserApi ? 'доступен' : 'нет'),
      'Координаты         : ' + (r.result || 'НЕ ПОЛУЧЕНЫ'),
      r.browserError ? '  ошибка GPS       : ' + r.browserError : null,
    ].filter(Boolean);
    box.textContent = lines.join('\n');
  } catch (e) {
    box.textContent = 'Ошибка диагностики: ' + e.message;
  }
});
// Панель датчиков: сворачивается в компактную кнопку, состояние запоминается.
const SENSOR_KEY = 'scanreal.sensors.collapsed';
const sensorPanel = $('sensorPanel');
const sensorReopen = $('sensorReopen');

function setSensorsCollapsed(collapsed) {
  spBody.classList.toggle('collapsed', collapsed);
  toggleSensors.textContent = collapsed ? '+' : '–';
  toggleSensors.setAttribute('aria-label', collapsed ? 'Развернуть датчики' : 'Свернуть датчики');
  sensorPanel.classList.toggle('is-collapsed', collapsed);
  try { localStorage.setItem(SENSOR_KEY, collapsed ? '1' : '0'); } catch {}
}

/** Полностью убирает панель с экрана — для чистого обзора объекта. */
function setSensorsHidden(hidden) {
  sensorPanel.classList.toggle('is-hidden', hidden);
  sensorReopen.classList.toggle('show', hidden);
}

toggleSensors.addEventListener('click', () => {
  const nowCollapsed = !spBody.classList.contains('collapsed');
  // Двойной клик по «–» на развёрнутой панели полностью её убирает.
  if (!nowCollapsed) {
    setSensorsCollapsed(true);
    setSensorsHidden(true);
    return;
  }
  setSensorsCollapsed(false);
});

sensorReopen.addEventListener('click', () => {
  setSensorsHidden(false);
  setSensorsCollapsed(false);
});

// Долгое нажатие на заголовок тоже прячет панель.
let pressTimer = null;
sensorPanel.addEventListener('touchstart', () => {
  pressTimer = setTimeout(() => { setSensorsHidden(true); setSensorsCollapsed(true); }, 600);
}, { passive: true });
sensorPanel.addEventListener('touchend', () => clearTimeout(pressTimer), { passive: true });
sensorPanel.addEventListener('touchmove', () => clearTimeout(pressTimer), { passive: true });

// Восстанавливаем прошлое состояние; по умолчанию панель свёрнута,
// чтобы не закрывать объект на экране.
try {
  setSensorsCollapsed(localStorage.getItem(SENSOR_KEY) !== '0');
} catch {
  setSensorsCollapsed(true);
}
btnReset.addEventListener('click', () => {
  stats.total = 0; stats.classes = {}; stats.confSum = 0; stats.confCount = 0;
  seenCooldown.clear();
  renderStats();
  toast('Статистика сброшена');
});

window.addEventListener('resize', resizeOverlay);
window.addEventListener('orientationchange', () => setTimeout(resizeOverlay, 250));

// Останавливаем камеру, когда приложение уходит в фон — экономия батареи.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running) {
    if (rafId) cancelAnimationFrame(rafId);
  } else if (!document.hidden && running) {
    loop();
  }
});

/* --------------------------------------------------- SERVICE WORKER (PWA) */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW:', e));
  });
}

/* ------------------------------------------------------------------ СТАРТ */
if (!ctx.roundRect) {
  // Полифилл для старых WebView
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + w, y, r);
    this.closePath();
    return this;
  };
}

boot();
