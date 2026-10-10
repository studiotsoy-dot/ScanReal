// ScanReal - сплэш как ЧИСТЫЙ ТЁМНЫЙ ФОН, без картинки.
//
// Android растягивает splash.png под экран. Пропорции телефонов разные
// (9:19.5, 9:20, 9:21), поэтому картинка на части устройств вытягивается.
// Однотонный фон исказить невозможно.
// Прицел остаётся на иконке приложения - там он выглядит правильно.

import { writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const res = join(root, "android", "app", "src", "main", "res");

if (!existsSync(res)) {
  console.error("Ресурсы Android не найдены: " + res);
  process.exit(1);
}

const Q = String.fromCharCode(34);

// 1. Тёмный цвет фона
const valuesDir = join(res, "values");
mkdirSync(valuesDir, { recursive: true });
writeFileSync(join(valuesDir, "colors.xml"), [
  "<?xml version=" + Q + "1.0" + Q + " encoding=" + Q + "utf-8" + Q + "?>",
  "<resources>",
  "    <color name=" + Q + "scanreal_background" + Q + ">#03050A</color>",
  "</resources>",
  "",
].join("\n"), "utf8");

// 2. splash.xml - ссылка на цвет, без картинки
const splashXml = [
  "<?xml version=" + Q + "1.0" + Q + " encoding=" + Q + "utf-8" + Q + "?>",
  "<selector xmlns:android=" + Q + "http://schemas.android.com/apk/res/android" + Q + ">",
  "    <item android:drawable=" + Q + "@color/scanreal_background" + Q + " />",
  "</selector>",
  "",
].join("\n");

// 3. Папки drawable: создаём нужные, кладём splash.xml, убираем картинку.
// Список фиксированный — генератор картинок сплэша больше не создаёт,
// поэтому папки могут отсутствовать.
const drawableDirs = [
  'drawable',
  'drawable-port-mdpi', 'drawable-port-hdpi', 'drawable-port-xhdpi',
  'drawable-port-xxhdpi', 'drawable-port-xxxhdpi',
  'drawable-land-mdpi', 'drawable-land-hdpi', 'drawable-land-xhdpi',
  'drawable-land-xxhdpi', 'drawable-land-xxxhdpi',
];

let xmlWritten = 0;
let pngRemoved = 0;

drawableDirs.forEach(function (folder) {
  const full = join(res, folder);
  mkdirSync(full, { recursive: true });

  writeFileSync(join(full, 'splash.xml'), splashXml, 'utf8');
  xmlWritten++;

  // Картинку убираем: она перекрывала бы фон и растягивалась.
  const png = join(full, 'splash.png');
  if (existsSync(png)) {
    try {
      rmSync(png, { force: true });
      pngRemoved++;
    } catch (err) {
      console.warn('не удалить ' + folder + '/splash.png');
    }
  }
});

console.log('splash.xml записан в ' + xmlWritten + ' папок');
console.log('splash.png удалён: ' + pngRemoved);
console.log('Сплэш: сплошной тёмный фон #03050A, без картинки');
