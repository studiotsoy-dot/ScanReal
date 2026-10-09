// ScanReal — слой датчиков Android.
// Собирает акселерометр, гироскоп, компас и датчик освещённости,
// ведёт кольцевые буферы для графиков и отдаёт данные наружу через колбэк.

export class Sensors {
  constructor() {
    this.data = {
      acc: { x: 0, y: 0, z: 0 },       // м/с²
      gyro: { a: 0, b: 0, g: 0 },      // °/с  (alpha, beta, gamma)
      heading: null,                    // градусы 0..360
      light: null,                      // lux
    };
    this.buffers = {
      acc: new Float32Array(60),
      gyro: new Float32Array(60),
    };
    this.bufIndex = 0;
    this.bufFilled = 0;
    this.onUpdate = null;
    this.active = {};
    this.needsPermission = false;
    this._lastEmit = 0;
  }

  /** iOS 13+ требует явного запроса разрешения на датчики движения. */
  async requestPermission() {
    if (typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        const res = await DeviceMotionEvent.requestPermission();
        if (res !== 'granted') return false;
      } catch {
        return false;
      }
    }
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== 'granted') return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  start(onUpdate) {
    this.onUpdate = onUpdate;

    // --- Акселерометр (включая гравитацию) ---
    if ('ondevicemotion' in window) {
      this._motion = (e) => {
        const a = e.accelerationIncludingGravity || e.acceleration;
        if (!a) return;
        this.data.acc = {
          x: +(a.x || 0).toFixed(2),
          y: +(a.y || 0).toFixed(2),
          z: +(a.z || 0).toFixed(2),
        };
        this.active.acc = true;
        this._push('acc', Math.hypot(a.x || 0, a.y || 0, a.z || 0));
        this._emit();
      };
      window.addEventListener('devicemotion', this._motion, { passive: true });
    }

    // --- Гироскоп + компас (через orientation) ---
    if ('ondeviceorientationabsolute' in window || 'ondeviceorientation' in window) {
      this._orient = (e) => {
        const hasRotation = e.alpha !== null && e.alpha !== undefined;
        if (hasRotation) {
          this.data.gyro = {
            a: Math.round(e.alpha || 0),
            b: Math.round(e.beta || 0),
            g: Math.round(e.gamma || 0),
          };
          this.active.gyro = true;
          this._push('gyro', Math.abs(e.beta || 0) + Math.abs(e.gamma || 0));
        }

        // Компас: absolute > webkitCompassHeading > alpha
        let h = null;
        if (e.webkitCompassHeading !== undefined && e.webkitCompassHeading !== null) {
          h = e.webkitCompassHeading;                 // iOS
          this.active.compass = true;
        } else if (e.absolute === true && hasRotation) {
          h = (360 - e.alpha) % 360;                  // Android
          this.active.compass = true;
        }
        if (h !== null) this.data.heading = Math.round(h);

        this._emit();
      };
      const abs = 'ondeviceorientationabsolute' in window;
      this._orientAbs = abs;
      window.addEventListener(abs ? 'deviceorientationabsolute' : 'deviceorientation',
        this._orient, { passive: true });
      // Слушаем оба события — на Android полезно, на iOS безопасно.
      if (abs) window.addEventListener('deviceorientation', this._orient, { passive: true });
    }

    // --- Датчик освещённости (в основном Android/Chrome) ---
    if ('AmbientLightSensor' in window) {
      try {
        this._light = new AmbientLightSensor({ frequency: 2 });
        this._light.addEventListener('reading', () => {
          this.data.light = Math.round(this._light.illuminance);
          this.active.light = true;
          this._emit();
        });
        this._light.addEventListener('error', () => {});
        this._light.start();
      } catch { /* датчик недоступен — это нормально */ }
    }
  }

  _push(key, value) {
    this.buffers[key][this.bufIndex] = value;
  }

  _emit() {
    const now = performance.now();
    if (now - this._lastEmit < 66) return;   // ~15 Гц, хватает для графиков
    this._lastEmit = now;
    if (this.onUpdate) this.onUpdate(this.data, this.buffers, this.bufFilled);
  }

  /** Вызывать после каждого цикла записи, чтобы продвинуть кольцевой буфер. */
  advance() {
    this.bufIndex = (this.bufIndex + 1) % this.buffers.acc.length;
    this.bufFilled = Math.min(this.bufFilled + 1, this.buffers.acc.length);
  }

  get supported() {
    return Object.keys(this.active).filter((k) => this.active[k]);
  }

  stop() {
    if (this._motion) window.removeEventListener('devicemotion', this._motion);
    if (this._orient) {
      window.removeEventListener('deviceorientation', this._orient);
      window.removeEventListener('deviceorientationabsolute', this._orient);
    }
    this._orient = null;
    this._motion = null;
    if (this._light) {
      try { this._light.stop(); } catch {}
    }
    this.onUpdate = null;
  }
}
