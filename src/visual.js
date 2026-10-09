// ScanReal — отрисовка мини-графиков (sparkline) для датчиков.

/** #rrggbb + альфа -> rgba() */
function hexA(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export class Sparkline {
  constructor(canvas, color = '#35e0ff') {
    this.canvas = canvas;
    this.color = color;
    this.ctx = canvas.getContext('2d');
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width || this.canvas.clientWidth || 140;
    this.h = r.height || 26;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * @param {Float32Array} buf   кольцевой буфер
   * @param {number} idx         текущая позиция записи
   * @param {number} filled      сколько элементов уже заполнено
   */
  draw(buf, idx, filled) {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    if (filled < 2) return;

    // Собираем значения в хронологическом порядке.
    const n = filled;
    const pts = new Array(n);
    const start = (idx - n + buf.length) % buf.length;
    let min = Infinity, max = -Infinity;

    for (let i = 0; i < n; i++) {
      const v = buf[(start + i) % buf.length];
      pts[i] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const range = (max - min) || 1;

    // Нормируем в координаты холста с отступом 2px.
    const stepX = w / (n - 1);
    const y = (v) => h - 2 - ((v - min) / range) * (h - 4);

    // Заливка под линией
    ctx.beginPath();
    ctx.moveTo(0, y(pts[0]));
    for (let i = 1; i < n; i++) ctx.lineTo(i * stepX, y(pts[i]));
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, hexA(this.color, 0.27));
    grad.addColorStop(1, hexA(this.color, 0));
    ctx.fillStyle = grad;
    ctx.fill();

    // Линия
    ctx.beginPath();
    ctx.moveTo(0, y(pts[0]));
    for (let i = 1; i < n; i++) ctx.lineTo(i * stepX, y(pts[i]));
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}
