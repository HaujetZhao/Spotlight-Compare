import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 单 HTML 构建:所有 JS/CSS base64 内联进单个 dist/index.html,可 file:// 双击离线运行。
// base:'./' 用相对路径,构建产物可 file:// 直接打开或子路径部署。
export default defineConfig({
  plugins: [vue(), viteSingleFile()],
  base: './',
});
