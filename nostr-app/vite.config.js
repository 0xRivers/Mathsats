import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
export default defineConfig({ root: 'web', define: { __APP_VERSION__: JSON.stringify(version) }, publicDir: 'public', build: { outDir: '../dist', emptyOutDir: true }, server: { proxy: { '/api': 'http://127.0.0.1:8787' } } });
