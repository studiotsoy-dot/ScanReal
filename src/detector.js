// ScanReal — детектор объектов на базе TensorFlow.js COCO-SSD.
// Модель работает полностью на устройстве: кадры никуда не отправляются.

import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

// Русские подписи для 80 классов COCO.
export const RU_NAMES = {
  person: 'человек', bicycle: 'велосипед', car: 'машина', motorcycle: 'мотоцикл',
  airplane: 'самолёт', bus: 'автобус', train: 'поезд', truck: 'грузовик', boat: 'лодка',
  'traffic light': 'светофор', 'fire hydrant': 'гидрант', 'stop sign': 'знак стоп',
  'parking meter': 'паркомат', bench: 'скамейка', bird: 'птица', cat: 'кот', dog: 'собака',
  horse: 'лошадь', sheep: 'овца', cow: 'корова', elephant: 'слон', bear: 'медведь',
  zebra: 'зебра', giraffe: 'жираф', backpack: 'рюкзак', umbrella: 'зонт', handbag: 'сумка',
  tie: 'галстук', suitcase: 'чемодан', frisbee: 'фрисби', skis: 'лыжи', snowboard: 'сноуборд',
  'sports ball': 'мяч', kite: 'воздушный змей', 'baseball bat': 'бита', 'baseball glove': 'перчатка',
  skateboard: 'скейтборд', surfboard: 'сёрф', 'tennis racket': 'ракетка', bottle: 'бутылка',
  'wine glass': 'бокал', cup: 'чашка', fork: 'вилка', knife: 'нож', spoon: 'ложка',
  bowl: 'миска', banana: 'банан', apple: 'яблоко', sandwich: 'бутерброд', orange: 'апельсин',
  broccoli: 'брокколи', carrot: 'морковь', 'hot dog': 'хот-дог', pizza: 'пицца', donut: 'пончик',
  cake: 'торт', chair: 'стул', couch: 'диван', 'potted plant': 'растение', bed: 'кровать',
  'dining table': 'стол', toilet: 'унитаз', tv: 'телевизор', laptop: 'ноутбук', mouse: 'мышь',
  remote: 'пульт', keyboard: 'клавиатура', 'cell phone': 'телефон', microwave: 'микроволновка',
  oven: 'печь', toaster: 'тостер', sink: 'раковина', refrigerator: 'холодильник', book: 'книга',
  clock: 'часы', vase: 'ваза', scissors: 'ножницы', 'teddy bear': 'мишка', 'hair drier': 'фен',
  toothbrush: 'зубная щётка',
};

export function ruName(cls) {
  return RU_NAMES[cls] || cls;
}

export class Detector {
  constructor() {
    this.model = null;
    this.ready = false;
    this.backend = 'unknown';
  }

  /** Загружает модель. onProgress(доля 0..1, текст). */
  async load(onProgress = () => {}) {
    onProgress(0.08, 'инициализация TensorFlow…');
    try {
      await tf.setBackend('webgl');
      await tf.ready();
    } catch {
      await tf.setBackend('cpu');
      await tf.ready();
    }
    this.backend = tf.getBackend();

    onProgress(0.3, `загрузка модели COCO-SSD (${this.backend})…`);

    // Прогресс скачивания весов — показываем честно.
    let fake = 0.3;
    const ticker = setInterval(() => {
      fake = Math.min(fake + 0.03, 0.92);
      onProgress(fake, 'загрузка модели COCO-SSD…');
    }, 220);

    try {
      this.model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
    } finally {
      clearInterval(ticker);
    }

    this.ready = true;
    onProgress(1, `модель готова · backend ${this.backend}`);
    return this.backend;
  }

  /**
   * Распознаёт объекты на кадре.
   * Возвращает [{class, ru, score, bbox:[x,y,w,h]}] в системе координат исходного кадра.
   */
  async detect(videoEl, maxBoxes = 20) {
    if (!this.ready || !videoEl || videoEl.readyState < 2) return [];
    const preds = await this.model.detect(videoEl, maxBoxes);
    return preds
      .filter((p) => p.score >= 0.45)
      .map((p) => ({
        class: p.class,
        ru: ruName(p.class),
        score: p.score,
        bbox: p.bbox,
      }))
      .sort((a, b) => b.score - a.score);
  }
}
