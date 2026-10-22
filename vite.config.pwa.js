import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// PWA 构建:独立外链 SW + manifest(无法内联进单 HTML,故与 vite.config.js 分开)。
// 两套 config 而非参数化,避免 if/else 污染主配置。
export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      // prompt 而非 autoUpdate:新版仅在后台预缓存,彻底关闭应用后下次冷启动才生效,
      // 避免打开时被强制 reload。
      registerType: 'prompt',
      manifest: {
        name: '图片对比查看',
        short_name: '对比查看',
        description: '手电筒光圈对比两张图,文件夹批量配对,支持合成导出。',
        theme_color: '#0b1020',
        background_color: '#0b1020',
        display: 'standalone',
        start_url: './',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
      },
    }),
  ],
  base: './',
});
