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
  timeout: 8000,
  maximumAge: 60000,   // свежие координаты переиспользуем минуту
};

let cachedFix = null;
let lastError = null;

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
 * @param {boolean} force игнорировать кэш
 * @returns {Promise<GeoFix|null>} null, если получить не удалось
 */
export async function getPosition(force = false) {
  if (!force && cachedFix && Date.now() - cachedFix.at < GEO_OPTS.maximumAge) {
    return cachedFix;
  }

  // --- Попытка 1: нативный GPS (APK) ---
  const plugin = await getNativePlugin();
  if (plugin) {
    try {
      const perm = await plugin.checkPermissions();
      if (perm.location !== 'granted') {
        await plugin.requestPermissions();
      }
      const pos = await plugin.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: GEO_OPTS.timeout,
      });
      cachedFix = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? null,
        at: Date.now(),
        source: 'native',
      };
      lastError = null;
      return cachedFix;
    } catch (err) {
      lastError = 'нативный GPS: ' + (err?.message || err);
    }
  }

  // --- Попытка 2: браузерный API ---
  if (geoAvailable()) {
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, GEO_OPTS);
      });
      cachedFix = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? null,
        at: Date.now(),
        source: 'browser',
      };
      lastError = null;
      return cachedFix;
    } catch (err) {
      lastError = 'браузерный GPS: ' + (err?.message || 'недоступен');
    }
  } else {
    lastError = 'геолокация не поддерживается устройством';
  }

  // --- Итог: координат нет, но это не ошибка приложения ---
  return null;
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
