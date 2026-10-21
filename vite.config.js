import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// base:'./' 用相对路径,构建产物可 file:// 直接打开或子路径部署。
export default defineConfig({
  plugins: [vue()],
  base: './',
});
