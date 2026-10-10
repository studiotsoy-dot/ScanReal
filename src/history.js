// ScanReal — история сканов: что нашли, когда и где.
// Хранится в localStorage, переживает перезапуск приложения.

import { formatCoords, mapLink } from './geo.js';

const STORE_KEY = 'scanreal.history.v1';
const SESSION_GAP_MS = 5 * 60 * 1000;   // разрыв > 5 минут = новая сессия
const MAX_SCANS = 2000;                 // защита от переполнения хранилища

export class ScanHistory {
  constructor() {
    this.scans = this._load();
    this.sessionId = null;
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  _save() {
    try {
      // Держим только последние MAX_SCANS записей.
      if (this.scans.length > MAX_SCANS) {
        this.scans = this.scans.slice(-MAX_SCANS);
      }
      localStorage.setItem(STORE_KEY, JSON.stringify(this.scans));
    } catch (err) {
      console.warn('История: не удалось сохранить', err);
    }
  }

  /** Открывает новую сессию (вызывается при включении камеры). */
  startSession() {
    const last = this.scans[this.scans.length - 1];
    const now = Date.now();
    if (last && now - new Date(last.time).getTime() < SESSION_GAP_MS && this.sessionId) {
      return this.sessionId;   // продолжаем прошлую сессию
    }
    this.sessionId = 's' + now;
    return this.sessionId;
  }

  /**
   * Записывает объекты одного кадра.
   * @param {Array} preds предсказания детектора
   * @param {Object|null} geo координаты
   */
  record(preds, geo) {
    if (!preds || !preds.length) return 0;
    if (!this.sessionId) this.startSession();

    const entry = {
      id: 'sc' + Date.now() + Math.floor(Math.random() * 1000),
      time: new Date().toISOString(),
      session: this.sessionId,
      geo: geo
        ? { lat: geo.lat, lon: geo.lon, accuracy: geo.accuracy, source: geo.source }
        : null,
      objects: preds.map((p) => ({ c: p.class, ru: p.ru, s: Math.round(p.score * 100) })),
    };

    this.scans.push(entry);
    this._save();
    return 1;
  }

  /**
   * Дозаполняет координаты в последних записях без GPS.
   * Нужно потому, что GPS «прогревается» дольше, чем идёт первый скан:
   * объекты уже распознаны, а координат ещё нет. Когда они появляются —
   * подставляем их в свежие записи этой сессии.
   * @param {Object} geo координаты
   * @param {number} maxAgeMs насколько старые записи обновлять
   * @returns {number} сколько записей обновлено
   */
  attachGeo(geo, maxAgeMs = 120000) {
    if (!geo) return 0;
    const now = Date.now();
    let updated = 0;

    // Идём с конца: свежие записи важнее.
    for (let i = this.scans.length - 1; i >= 0; i--) {
      const s = this.scans[i];
      const age = now - new Date(s.time).getTime();
      if (age > maxAgeMs) break;          // старые не трогаем
      if (s.geo) continue;                 // уже есть координаты

      s.geo = {
        lat: geo.lat,
        lon: geo.lon,
        accuracy: geo.accuracy ?? null,
        source: geo.source,
        // Помечаем, что координаты привязаны позже, а не в момент скана.
        attached: true,
      };
      updated++;
    }

    if (updated) this._save();
    return updated;
  }

  /** Все сканы, новые сверху. */
  all() {
    return this.scans.slice().reverse();
  }

  /** Сканы, сгруппированные по сессиям. */
  sessions() {
    const map = new Map();
    this.scans.forEach((s) => {
      if (!map.has(s.session)) map.set(s.session, []);
      map.get(s.session).push(s);
    });

    // Новые сессии сверху.
    return [...map.entries()]
      .map(([id, items]) => {
        const times = items.map((i) => new Date(i.time).getTime());
        const objects = {};
        let hasGeo = false;
        items.forEach((it) => {
          if (it.geo) hasGeo = true;
          it.objects.forEach((o) => {
            objects[o.ru] = (objects[o.ru] || 0) + 1;
          });
        });
        return {
          id,
          items,
          start: Math.min(...times),
          end: Math.max(...times),
          count: items.length,
          hasGeo,
          objects,
          lastGeo: [...items].reverse().find((i) => i.geo)?.geo || null,
        };
      })
      .sort((a, b) => b.end - a.end);
  }

  count() { return this.scans.length; }
  geoCount() { return this.scans.filter((s) => s.geo).length; }

  clear() {
    this.scans = [];
    this.sessionId = null;
    this._save();
  }

  /** Экспорт в JSON-файл. */
  exportJSON() {
    const payload = {
      app: 'ScanReal',
      exported: new Date().toISOString(),
      total: this.scans.length,
      scans: this.scans,
    };
    download(
      JSON.stringify(payload, null, 2),
      `scanreal-history-${stamp()}.json`,
      'application/json'
    );
  }

  /** Экспорт в CSV — открывается в Excel. */
  exportCSV() {
    const rows = [
      ['время', 'сессия', 'широта', 'долгота', 'точность_м', 'объекты'],
    ];
    this.scans.forEach((s) => {
      rows.push([
        s.time,
        s.session,
        s.geo ? s.geo.lat.toFixed(6) : '',
        s.geo ? s.geo.lon.toFixed(6) : '',
        s.geo && s.geo.accuracy != null ? Math.round(s.geo.accuracy) : '',
        s.objects.map((o) => `${o.ru} ${o.s}%`).join('; '),
      ]);
    });
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    // BOM, чтобы Excel правильно понял кириллицу.
    download('\uFEFF' + csv, `scanreal-history-${stamp()}.csv`, 'text/csv');
  }
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function download(content, filename, mime) {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* --------------------------------------------------- ФОРМАТИРОВАНИЕ ДЛЯ UI */

export function formatTime(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** «час назад», «вчера», «14:32» — человеческое время. */
export function humanTime(iso) {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);

  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;

  const hours = Math.floor(min / 60);
  if (hours < 24) {
    const word = hours === 1 ? 'час' : hours < 5 ? 'часа' : 'часов';
    return `${hours} ${word} назад`;
  }

  const days = Math.floor(hours / 24);
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} дн. назад`;
  return new Date(iso).toLocaleDateString('ru-RU');
}

/** Описание сессии: количество и объекты. */
export function describeObjects(objects) {
  const entries = Object.entries(objects).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return 'ничего не распознано';
  return entries
    .slice(0, 4)
    .map(([name, n]) => (n > 1 ? `${name} ×${n}` : name))
    .join(' · ');
}

export function accuracyText(acc) {
  if (acc == null) return '';
  return `±${Math.round(acc)} м`;
}

export { formatCoords, mapLink };
