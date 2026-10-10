// ScanReal - стартовый экран как СПЛОШНОЙ ТЁМНЫЙ ФОН.
//
// Почему так: Android растягивает любую картинку сплэша под экран.
// Пропорции телефонов разные (9:19.5, 9:20, 9:21), поэтому картинка
// на части устройств вытягивается. Однотонный фон исказить нельзя.
// Прицел остался на иконке приложения - там он выглядит правильно.

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

// 1. Цвет фона
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

// 3. launch_screen.xml - layout стартового экрана.
// Capacitor ищет файл по имени layoutName из capacitor.config.json.
// Без него берётся дефолтный - с картинкой, которую растягивает Android.
const layoutDir = join(res, "layout");
mkdirSync(layoutDir, { recursive: true });
writeFileSync(join(layoutDir, "launch_screen.xml"), [
  "<?xml version=" + Q + "1.0" + Q + " encoding=" + Q + "utf-8" + Q + "?>",
  "<LinearLayout xmlns:android=" + Q + "http://schemas.android.com/apk/res/android" + Q,
  "    android:layout_width=" + Q + "match_parent" + Q,
  "    android:layout_height=" + Q + "match_parent" + Q,
  "    android:orientation=" + Q + "vertical" + Q,
  "    android:background=" + Q + "@color/scanreal_background" + Q + " />",
  "",
].join("\n"), "utf8");

console.log("launch_screen.xml создан: сплошной тёмный фон");

// 4. Папки drawable: splash.xml, без картинок.
const drawableDirs = [
  "drawable",
  "drawable-port-mdpi", "drawable-port-hdpi", "drawable-port-xhdpi",
  "drawable-port-xxhdpi", "drawable-port-xxxhdpi",
  "drawable-land-mdpi", "drawable-land-hdpi", "drawable-land-xhdpi",
  "drawable-land-xxhdpi", "drawable-land-xxxhdpi",
];

let xmlWritten = 0;
let pngRemoved = 0;

drawableDirs.forEach(function (folder) {
  const full = join(res, folder);
  mkdirSync(full, { recursive: true });
  writeFileSync(join(full, "splash.xml"), splashXml, "utf8");
  xmlWritten++;

  const png = join(full, "splash.png");
  if (existsSync(png)) {
    try { rmSync(png, { force: true }); pngRemoved++; }
    catch (err) { /* останется - patch-theme обнулит */ }
  }
});

console.log("splash.xml записан в " + xmlWritten + " папок");
console.log("splash.png удалён: " + pngRemoved);
console.log("Стартовый экран: сплошной тёмный фон #03050A");
