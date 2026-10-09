// ScanReal - заменяет дефолтный сплэш Capacitor своим и ставит тёмный фон.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const resDir = join(root, "android", "app", "src", "main", "res");
const valuesDir = join(resDir, "values");
const stylesPath = join(valuesDir, "styles.xml");

if (!existsSync(resDir)) {
  console.error("Ресурсы Android не найдены: " + resDir);
  process.exit(1);
}

let changed = 0;

// 1. Перезаписываем дефолтные картинки Capacitor своим сплэшем.
const folders = readdirSync(resDir).filter(function (d) { return d.indexOf("drawable") === 0; });
const defNames = ["capacitor_splash.png", "splash_capacitor.png"];

folders.forEach(function (folder) {
  const full = join(resDir, folder);
  const own = join(full, "splash.png");
  if (!existsSync(own)) return;
  const ownData = readFileSync(own);
  defNames.forEach(function (name) {
    const p = join(full, name);
    if (existsSync(p)) {
      writeFileSync(p, ownData);
      changed++;
    }
  });
});

console.log("Дефолтных картинок Capacitor заменено: " + changed);

// 2. Прописываем ссылки на свой сплэш в themes.xml / styles.xml.
const themeFiles = ["styles.xml", "themes.xml"];
themeFiles.forEach(function (name) {
  const p = join(valuesDir, name);
  if (!existsSync(p)) return;
  let t = readFileSync(p, "utf8");
  const before = t;
  t = t.replace(/@drawable\/capacitor_splash/g, "@drawable/splash");
  if (t !== before) {
    writeFileSync(p, t, "utf8");
    console.log(name + ": ссылка на сплэш заменена");
  } else {
    console.log(name + ": ссылок на дефолтный сплэш нет");
  }
});

// 3. Тёмный фон в colors.xml.
const colorsPath = join(valuesDir, "colors.xml");
if (existsSync(colorsPath)) {
  let c = readFileSync(colorsPath, "utf8");
  if (c.indexOf("scanreal_background") === -1) {
    c = c.replace("</resources>", "    <color name=\"scanreal_background\">#05070D</color>\n</resources>");
    writeFileSync(colorsPath, c, "utf8");
    console.log("Тёмный фон добавлен в colors.xml");
  }
}

console.log("Темы Android настроены.");
