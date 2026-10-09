// Диагностика геолокации: проверяет плагин, разрешения и браузерный API.

export async function diagnoseGeo() {
  const r = {
    isNative: false, platform: "?",
    pluginAvailable: false, pluginError: null,
    browserApi: false, browserError: null,
    perm: "не проверено", result: null,
  };

  try {
    const core = await import("@capacitor/core");
    r.isNative = core.Capacitor.isNativePlatform();
    r.platform = core.Capacitor.getPlatform();
  } catch (e) { r.platform = "нет @capacitor/core: " + e.message; }

  let plugin = null;
  try {
    const mod = await import("@capacitor/geolocation");
    plugin = mod.Geolocation;
    r.pluginAvailable = !!plugin;
  } catch (e) { r.pluginError = e.message; }

  if (plugin && r.isNative) {
    try {
      const p = await plugin.checkPermissions();
      r.perm = JSON.stringify(p);
    } catch (e) { r.perm = "ошибка: " + e.message; }
  }

  r.browserApi = typeof navigator !== "undefined" && "geolocation" in navigator;

  if (r.browserApi) {
    try {
      const pos = await new Promise((res, rej) => {
        navigator.geolocation.getCurrentPosition(res, rej,
          { enableHighAccuracy: false, timeout: 6000, maximumAge: 0 });
      });
      r.result = pos.coords.latitude.toFixed(5) + ", " + pos.coords.longitude.toFixed(5);
    } catch (e) {
      r.browserError = "код " + (e.code !== undefined ? e.code : "?") + ": " + e.message;
    }
  }

  return r;
}
