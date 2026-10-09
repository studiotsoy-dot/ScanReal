import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    chunkSizeWarningLimit: 4000,
    // esbuild пишет временные файлы рядом с проектом:
    // системный TEMP может быть недоступен для записи.
    minify: 'esbuild',
  },
  esbuild: {
    legalComments: 'none',
  },
  server: {
    host: true,
    port: 5178,
    // Разрешаем доступ через туннели (нужно для камеры на телефоне: HTTPS).
    allowedHosts: true,
  },
  preview: {
    host: true,
    port: 5178,
    // Vite по умолчанию блокирует внешние домены (403).
    // Для демо через cloudflared-туннель это нужно отключить.
    allowedHosts: true,
  },
});
