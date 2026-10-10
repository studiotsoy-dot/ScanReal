// ScanReal - правильная тема Android: тёмный фон окна, без чужих картинок.
//
// Зачем: пока камера выключена, экран показывает фон ТЕМЫ Android.
// Capacitor прописывает туда свой drawable и он растягивается.
// Мы задаём сплошной тёмный цвет - исказить его невозможно.

import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const resDir = join(root, "android", "app", "src", "main", "res");
const valuesDir = join(resDir, "values");

if (!existsSync(resDir)) {
  console.error("Ресурсы Android не найдены: " + resDir);
  process.exit(1);
}

const Q = String.fromCharCode(34);

// 1. Удаляем ВСЕ дефолтные картинки Capacitor.
// Они и есть источник вытянутого изображения на экране.
// ВАЖНО: rmSync на CI может не сработать (особенности файловой системы),
// поэтому не удаляем, а ПЕРЕЗАПИСЫВАЕМ файл пустым 1x1 PNG.
// Android не сможет показать такую картинку и возьмёт цвет из темы.
const emptyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk' +
  'YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

let killed = 0;
const folders = readdirSync(resDir).filter(function (d) { return d.indexOf("drawable") === 0; });

// Имена, которые Capacitor кладёт по умолчанию и которые растягиваются.
const killNames = [
  'capacitor_splash.png', 'splash_capacitor.png',
  'capacitor.png', 'ic_capacitor.png',
  'splash.png',                      // наш прежний вариант тоже убираем
];

folders.forEach(function (folder) {
  const full = join(resDir, folder);
  killNames.forEach(function (name) {
    const p = join(full, name);
    if (!existsSync(p)) return;

    // Сначала пробуем удалить, при неудаче — обнуляем.
    try {
      rmSync(p, { force: true });
      if (!existsSync(p)) { killed++; return; }
    } catch (e) { /* переходим к обнулению */ }

    try {
      writeFileSync(p, emptyPng);
      killed++;
    } catch (e) {
      console.warn('не удалось обнулить ' + folder + '/' + name);
    }
  });
});

console.log('Дефолтных картинок Capacitor убрано: ' + killed);

// 2. Тёмный фон + цвета.
writeFileSync(join(valuesDir, "colors.xml"), [
  "<?xml version=" + Q + "1.0" + Q + " encoding=" + Q + "utf-8" + Q + "?>",
  "<resources>",
  "    <color name=" + Q + "scanreal_background" + Q + ">#03050A</color>",
  "</resources>",
  "",
].join("\n"), "utf8");

// 3. Правим styles.xml: фон окна = сплошной цвет, а не картинка.
const stylesPath = join(valuesDir, "styles.xml");

if (existsSync(stylesPath)) {
  let t = readFileSync(stylesPath, "utf8");

  // Убираем ссылки на растягивающиеся картинки.
  t = t.replace(/@drawable\/[a-z_]*splash[a-z_]*/g, "@color/scanreal_background");
  t = t.replace(/@drawable\/capacitor_splash/g, "@color/scanreal_background");

  // Добавляем тёмный фон окна в основную тему, если его нет.
  if (t.indexOf("scanreal_background") === -1) {
    t = t.replace(/<style name="AppTheme([^"]*)"([^>]*)>/g, function (m, rest, attrs) {
      return m + "\n        <item name=" + Q + "android:windowBackground" + Q + ">@color/scanreal_background</item>";
    });
  }

  writeFileSync(stylesPath, t, "utf8");
  console.log("styles.xml: фон окна = сплошной цвет");
} else {
  console.log("styles.xml не найден - пропускаем");
}

console.log("Тема Android настроена.");
