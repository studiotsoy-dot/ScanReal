// ScanReal - сплэш максимально надёжным способом.
//
// Почему не layer-list с bitmap: AAPT2 на CI падает на вложенном
// <bitmap> без указания плотности, а диагностировать это вслепую дорого.
//
// Решение проще и надёжнее:
//   splash.png  - готовая картинка НУЖНОГО размера (фон + прицел).
//   Тема задаёт android:windowBackground, а не растягивающий background.
//   Пропорции соблюдены уже в самом файле - растягивать нечего.

import { writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const res = join(root, "android", "app", "src", "main", "res");

if (!existsSync(res)) {
  console.error("Ресурсы Android не найдены: " + res);
  process.exit(1);
}

const Q = String.fromCharCode(34);

// 1. Тёмный цвет фона.
const valuesDir = join(res, "values");
mkdirSync(valuesDir, { recursive: true });
writeFileSync(join(valuesDir, "colors.xml"), [
  "<?xml version=" + Q + "1.0" + Q + " encoding=" + Q + "utf-8" + Q + "?>",
  "<resources>",
  "    <color name=" + Q + "scanreal_background" + Q + ">#03050A</color>",
  "</resources>",
  "",
].join("\n"), "utf8");

// 2. Убираем XML-слой, если он остался от прошлой сборки.
const folders = readdirSync(res).filter(function (d) { return d.indexOf("drawable") === 0; });
let cleaned = 0;
folders.forEach(function (folder) {
  const xml = join(res, folder, "splash.xml");
  if (existsSync(xml)) {
    // Перезаписываем пустым layer-list без bitmap - не ломает сборку.
    writeFileSync(xml, [
      "<?xml version=" + Q + "1.0" + Q + " encoding=" + Q + "utf-8" + Q + "?>",
      "<selector xmlns:android=" + Q + "http://schemas.android.com/apk/res/android" + Q + ">",
      "    <item android:drawable=" + Q + "@color/scanreal_background" + Q + " />",
      "</selector>",
      "",
    ].join("\n"), "utf8");
    cleaned++;
  }
});

console.log("XML-слоёв упрощено: " + cleaned);
console.log("Фон: #03050A");
