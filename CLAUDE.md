# 图片对比查看 (image-hover-reveal)

手电筒式图片对比查看器:底图铺满,悬停处用光圈透出对比图。支持文件夹批量配对(按"原图标记"前后缀),合成结果可复制/下载/导出为交互式单文件 HTML。
**纯本地文件处理、不联网**(File System Access API,仅 Chrome/Edge/Opera)。

## 技术栈

- **Vue 3**(`<script setup>`,纯 JS,无 TypeScript)
- **Vite 5** + 双 build:`vite.config.js`(单 HTML)/ `vite.config.pwa.js`(PWA)
- **无 Pinia、无路由**:单页两态(选择页/查看器),跨组件状态只有一份 `settings`(reactive 单例 + localStorage 持久化)
- **质量基建**:`@antfu/eslint-config`(ESLint flat config)

## 常用命令

```bash
npm run dev        # 开发(用户跑)
npm run build      # 单 HTML(dist/index.html 自包含,可 file:// 离线)
npm run build:pwa  # PWA(SW + manifest,可安装/离线)
npm run lint       # ESLint 检查(@antfu/eslint-config)
npm run lint:fix   # 自动修格式
```

两套 build 共用 `dist/`,验证时注意先清。

## 目录结构

```
src/
├── main.js                    # createApp 入口
├── settings.js                # 预览参数单例:reactive + localStorage 持久化,App/SettingsPanel/导出逻辑共享
├── mask.js                    # 光圈渐变单表(STOPS)+ 派生 maskCSS/canvasStops,三处共用
├── exportPlayer.js            # 导出交互式单文件 HTML(压缩分流 + 自包含模板)
├── App.vue                    # 编排层:composable 接线/键盘路由/合成导出调用/查看器全局 CSS
├── SettingsPanel.vue          # 设置浮层(模式/光圈/匹配标记/导出格式质量),v-model 开合
├── composables/
│   ├── useDirPairing.js       # 文件夹批量配对/单选两图/拼接图拆半,idb 恢复,翻页
│   └── usePanZoom.js          # 光圈跟随 + 缩放平移,lens 圆环
└── components/
    ├── PickerPage.vue         # 选择页(两图/文件夹/拼接图槽 + 恢复按钮)
    └── Toolbar.vue            # 查看器角落工具栏
index.html                     # Vite 入口
public/icon.svg                # PWA/manifest 图标
```

## 关键约定(请遵守)

1. **settings 是唯一共享状态**:[settings.js](src/settings.js) 导出 reactive 单例,改动自动落 localStorage。新增预览参数只加在 `DEFAULTS`,不要另开状态源。
2. **光圈渐变单一事实源**:[mask.js](src/mask.js) 的 `STOPS` 表(`soft` 占位符)派生出查看器 CSS 遮罩(`maskCSS()`)、canvas 合成(`canvasStops()`)与导出页(内嵌同一张表烤入),改光圈形状/羽化只动这一张表。
3. **坐标系**:遮罩渐变与光圈坐标都在 **stage 局部空间**。stage 有 transform(缩放/平移,origin 0 0),指针坐标经 `toLocal()` 折算:`(屏幕 − 容器左上 − 平移) / 缩放`。合成导出时再经 `fitRect/fitK`(object-fit:contain 实际绘制矩形)线性映射到**原图分辨率**。缩放/平移只是观察手段,不参与合成。
4. **导出页是自包含模板字符串**(`exportPlayer.js`):内嵌 base64 图 + 缩水版交互,与 App 保持的行为同步清单——光圈跟随、滚轮缩放(以鼠标为中心)、拖拽平移、Ctrl+滚轮调光圈、双击复位、热键(1-4 切模式 / `[ ] , .` 调光圈 / Tab 互换底图对比图 / Ctrl+S 下载 / Ctrl+C 复制 / `?` 帮助)、换底图/换对比图/换拼接图按钮(拼接图在导出页内拆半)、lens 圆环(半径 ×0.78 对齐渐变硬边)、镜头模式出底图范围时藏镜头显鼠标(`onImg`)。改 App 交互后检查导出页是否要跟。
5. **导出压缩**:内嵌图按扩展名分流——`jpg/jpeg/webp` 源文件原样嵌入不重编码,其余格式画布重编码(面板格式/质量,JPEG 垫白底)。
6. **objectURL 生命周期**:配对扫描/单换图时旧 URL 必须 revoke(`revokeGroup`/`pick` 内),卸载时兜底清全量。
7. **目录句柄持久化**:只有 dir handle 存 IndexedDB(手写最小 kv,无依赖);刷新后浏览器要求一次用户点击重新授权(`needRestore` 流程)。
8. **配对规则**:`stemOf` 去扩展名 + 去任意位置的括号备注;带标记的进 base 槽(每根至多一张),不带的全部归该根的 hovers;标记改动防抖 300ms 自动重扫。
9. **拼接图**:`pickStitched()`(单选)与文件夹扫描(带拼接图标记的单文件,标记在设置面板,默认 `拼-`)把左右拼接图经 `cutHalves()` 裁成两半(`floor(w/2)` 等宽保证 1:1 对应,PNG 无损编码)后当普通一对走全流程——viewer/合成/导出零特判;`Tab` 互换 base 与当前产出(名字一起换,原图在右边时用)。

## 快捷键(App 与导出页一致)

| 按键 | 作用 |
|---|---|
| `↑/↓` / `空格` / `退格` | 切组(上/下一组) |
| `←/→` | 切组内产出(单组时 ↑/↓ 同效) |
| `Tab` | 互换底图 / 对比图(名字一起换) |
| `1-4` | 切模式(torch/brush/spotlight/lens) |
| `[` `]` `,` `.` | 调光圈大小(50~400) |
| 滚轮 / 拖拽 / 双击 | 缩放 / 平移 / 复位 |
| `Ctrl+滚轮`、拖拽中滚轮 | 调光圈大小 |
| `Ctrl+C` / `Ctrl+S` | 合成复制(PNG) / 合成下载(面板格式) |
| `Ctrl+E` | 导出交互式单文件 HTML(App 内) |
| `?` | 导出页帮助浮层 |

## 重构计划

见 [重构计划.md](重构计划.md)。App.vue 已 900+ 行,按计划分步拆分,每步构建可跑 + 人工验收。
