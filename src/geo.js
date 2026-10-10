// ScanReal — определение местоположения.
// Порядок попыток: нативный плагин Capacitor -> браузерный API -> без координат.
// Приложение НИКОГДА не ломается из-за отсутствия GPS: скан сохранится в любом случае.

/**
 * @typedef {Object} GeoFix
 * @property {number} lat
 * @property {number} lon
 * @property {number|null} accuracy   точность в метрах
 * @property {number} at              время получения (мс)
 * @property {string} source          'native' | 'browser'
 */

const GEO_OPTS = {
  enableHighAccuracy: true,
  timeout: 15000,
  maximumAge: 30000,
};

/**
 * Быстрый режим: низкая точность.
 * Проверено на реальном устройстве: высокоточный запрос в помещении
 * падает по таймауту (код 3), а этот — отвечает за секунды.
 * Координаты грубее (по Wi-Fi), зато приложение получает их сразу.
 */
const GEO_OPTS_FAST = {
  enableHighAccuracy: false,
  timeout: 10000,
  maximumAge: 60000,
};

let cachedFix = null;
let lastError = null;

/**
 * Оборачивает промис в жёсткий таймаут.
 * Нужен потому, что нативный плагин может «зависнуть» навсегда —
 * тогда приложение думает, что запрос идёт, и блокирует кнопку.
 * @returns {Promise<any|null>} результат либо null по таймауту
 */
function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(null);
    }, ms);

    promise
      .then((value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(null);
      });
  });
}

/** Промис-обёртка над браузерным API. */
function browserGet(opts) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, opts);
  });
}

/** Приводит ответ браузера/плагина к нашему формату. */
function toFix(coords, source) {
  return {
    lat: coords.latitude,
    lon: coords.longitude,
    accuracy: coords.accuracy ?? null,
    at: Date.now(),
    source,
  };
}

/** Есть ли вообще шанс получить координаты. */
export function geoAvailable() {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator;
}

/** Последняя ошибка — для диагностики на экране истории. */
export function geoLastError() {
  return lastError;
}

/** Достаёт плагин Capacitor, если приложение собрано как APK. */
async function getNativePlugin() {
  try {
    // В браузере этого модуля нет — импорт упадёт, и мы уйдём на фолбэк.
    const mod = await import('@capacitor/geolocation');
    const Cap = await import('@capacitor/core');
    if (Cap && Cap.Capacitor && Cap.Capacitor.isNativePlatform && Cap.Capacitor.isNativePlatform()) {
      return mod.Geolocation || null;
    }
  } catch {
    /* не APK — это нормально */
  }
  return null;
}

/**
 * Запрашивает координаты.
 *
 * Стратегия:
 *   ЭТАП 1 (параллельно, до 9 сек): нативный GPS и быстрый браузерный запрос.
 *          Берём нативный, если он успел — он точнее. Иначе быстрый.
 *          Параллельно, а не по очереди: иначе ожидание складывается.
 *   ЭТАП 2 (до 12 сек): точный браузерный запрос, если первые не дали ничего.
 *
 * Почему быстрый запрос так важен: проверено на устройстве — высокоточный
 * запрос в помещении падает по таймауту (код 3), а низкоточный отвечает
 * за пару секунд. Лучше грубые координаты сразу, чем точные никогда.
 *
 * @param {boolean} force игнорировать кэш
 * @returns {Promise<GeoFix|null>} null, если получить не удалось
 */
export async function getPosition(force = false) {
  if (!force && cachedFix && Date.now() - cachedFix.at < GEO_OPTS.maximumAge) {
    return cachedFix;
  }

  const plugin = await getNativePlugin();
  const canBrowser = geoAvailable();

  // --- ЭТАП 1: два запроса одновременно ---
  const nativeTask = plugin
    ? withTimeout((async () => {
        const perm = await plugin.checkPermissions();
        if (perm.location !== 'granted') {
          await plugin.requestPermissions();
        }
        const pos = await plugin.getCurrentPosition({ enableHighAccuracy: true, timeout: 7000 });
        if (!pos || !pos.coords) throw new Error('пустой ответ GPS');
        return toFix(pos.coords, 'native');
      })(), 9000)
    : Promise.resolve(null);

  const fastTask = canBrowser
    ? withTimeout(browserGet(GEO_OPTS_FAST).then((pos) => toFix(pos.coords, 'browser')), 9000)
    : Promise.resolve(null);

  const [nativeFix, fastFix] = await Promise.all([nativeTask, fastTask]);

  // Нативный точнее — предпочитаем его, если он ответил.
  const first = nativeFix || fastFix;
  if (first) {
    cachedFix = first;
    lastError = null;
    return cachedFix;
  }

  // --- ЭТАП 2: точный браузерный запрос ---
  if (canBrowser) {
    const preciseFix = await withTimeout(
      browserGet(GEO_OPTS).then((pos) => toFix(pos.coords, 'browser')),
      12000
    );
    if (preciseFix) {
      cachedFix = preciseFix;
      lastError = null;
      return cachedFix;
    }
    lastError = 'GPS не ответил ни разу — нет сигнала или глушилка';
  } else {
    lastError = 'геолокация не поддерживается устройством';
  }

  // --- Итог: координат нет, но это не ошибка приложения ---
  return null;
}

/**
 * Непрерывное слежение за позицией.
 * Решает главную проблему: разовый запрос часто падает по таймауту,
 * а с watchPosition координаты приходят, как только GPS «прогреется».
 * @param {(fix: GeoFix) => void} onFix   вызывается при каждом обновлении
 * @param {(msg: string) => void} onError необязательный обработчик ошибок
 * @returns {() => void} функция остановки слежения
 */
export async function watchPosition(onFix, onError) {
  const plugin = await getNativePlugin();

  // Нативный вариант (APK)
  if (plugin) {
    try {
      const perm = await plugin.checkPermissions();
      if (perm.location !== 'granted') {
        const req = await plugin.requestPermissions();
        if (req.location !== 'granted') {
          if (onError) onError('разрешение на геолокацию не выдано');
          return () => {};
        }
      }

      const id = await plugin.watchPosition(
        { enableHighAccuracy: true, timeout: 20000 },
        (pos, err) => {
          if (err) {
            if (onError) onError(err.message || String(err));
            return;
          }
          if (!pos || !pos.coords) return;
          cachedFix = {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? null,
            at: Date.now(),
            source: 'native',
          };
          lastError = null;
          onFix(cachedFix);
        }
      );

      return () => {
        try { plugin.clearWatch({ id }); } catch { /* уже остановлено */ }
      };
    } catch (err) {
      lastError = 'нативный watch: ' + (err?.message || err);
    }
  }

  // Браузерный вариант
  if (geoAvailable()) {
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        cachedFix = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
          at: Date.now(),
          source: 'browser',
        };
        lastError = null;
        onFix(cachedFix);
      },
      (err) => {
        lastError = 'код ' + err.code + ': ' + err.message;
        if (onError) onError(lastError);
      },
      GEO_OPTS
    );
    return () => navigator.geolocation.clearWatch(id);
  }

  if (onError) onError('геолокация недоступна');
  return () => {};
}

/** Красивая строка координат для интерфейса. */
export function formatCoords(fix) {
  if (!fix) return 'без координат';
  return `${fix.lat.toFixed(5)}, ${fix.lon.toFixed(5)}`;
}

/** Ссылка на карту — открывается во внешнем приложении карт. */
export function mapLink(fix) {
  if (!fix) return null;
  return `https://www.google.com/maps?q=${fix.lat.toFixed(6)},${fix.lon.toFixed(6)}`;
}

/** Ссылка на карту для группы сканов (все точки сессии). */
export function mapLinkForSession(scans) {
  const withGeo = scans.filter((s) => s.geo);
  if (!withGeo.length) return null;
  if (withGeo.length === 1) return mapLink(withGeo[0].geo);
  const last = withGeo[withGeo.length - 1];
  return mapLink(last.geo);
}
