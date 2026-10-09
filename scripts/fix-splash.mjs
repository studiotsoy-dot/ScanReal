// ScanReal - правильный сплэш для Android.
// Проблема: если splash.png использовать как android:background,
// система РАСТЯГИВАЕТ его по экрану -> круг превращается в овал.
// Решение: рисуем фон отдельно, а прицел - центрированным слоем.

import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const res = join(root, "android", "app", "src", "main", "res");

if (!existsSync(res)) {
  console.error("Ресурсы Android не найдены: " + res);
  process.exit(1);
}

const Q = String.fromCharCode(34);

// 1. Фон - сплошной тёмный цвет (по просьбе: темнее).
const valuesDir = join(res, "values");
mkdirSync(valuesDir, { recursive: true });

writeFileSync(join(valuesDir, "colors.xml"), [
  "<?xml version=" + Q + "1.0" + Q + " encoding=" + Q + "utf-8" + Q + "?>",
  "<resources>",
  "    <color name=" + Q + "scanreal_background" + Q + ">#03050A</color>",
  "    <color name=" + Q + "scanreal_cyan" + Q + ">#35E0FF</color>",
  "</resources>",
  "",
].join("\n"), "utf8");

// 2. Слой сплэша: тёмный фон + центрированный прицел БЕЗ растяжения.
// android:gravity=center = изображение сохраняет пропорции.
const splashLayer = [
  "<?xml version=" + Q + "1.0" + Q + " encoding=" + Q + "utf-8" + Q + "?>",
  "<layer-list xmlns:android=" + Q + "http://schemas.android.com/apk/res/android" + Q + ">",
  "    <item android:drawable=" + Q + "@color/scanreal_background" + Q + " />",
  "    <item>",
  "        <bitmap",
  "            android:src=" + Q + "@drawable/scanreal_target" + Q,
  "            android:gravity=" + Q + "center" + Q + " />",
  "    </item>",
  "</layer-list>",
  "",
].join("\n");

// 3. Пишем этот слой в КАЖДУЮ папку drawable, где лежит сплэш.
// ВАЖНО: splash.xml конфликтует с splash.png с тем же именем,
// поэтому свою картинку кладём под ДРУГИМ именем: scanreal_target.png
const folders = readdirSync(res).filter(function (d) { return d.indexOf("drawable") === 0; });

let written = 0;

folders.forEach(function (folder) {
  const full = join(res, folder);

  // Картинка прицела уже создана генератором под именем scanreal_target.png.
  if (!existsSync(join(full, 'scanreal_target.png'))) return;

  // Кладём XML-слой: тёмный фон + прицел по центру без растяжения.
  writeFileSync(join(full, 'splash.xml'), splashLayer, 'utf8');
  written++;
});

console.log('Сплэш-слой создан: ' + written + ' папок');
console.log('Фон: #03050A (тёмный), прицел: по центру без растяжения');
