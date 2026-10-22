# 图片对比查看 (image-hover-reveal)

手电筒式图片对比查看器:底图铺满,悬停处用光圈透出对比图。支持文件夹批量配对(按"原图标记"前后缀),合成结果可复制/下载/导出为交互式单文件 HTML。视频对(两个视频 / 一段左右拼接视频)走同一套光圈交互。
**纯本地文件处理、不联网**(File System Access API,仅 Chrome/Edge/Opera)。

## 技术栈

- **Vue 3**(`<script setup>`,纯 JS,无 TypeScript)
- **Vite 5** + 双 build:`vite.config.js`(单 HTML)/ `vite.config.pwa.js`(PWA)
- **无 Pinia、无路由**:单页两态(选择页/查看器),跨组件状态只有一份 `settings`(reactive 单例 + localStorage 持久化)
- **质量基建**:`@antfu/eslint-config`(ESLint flat config)
- **mediabunny**:视频离线合成转码(解封装/解码/编码/封装),仅用于 Ctrl+S 合成视频;不支持时退回 MediaRecorder 实时录制([videoRecord.js](src/videoRecord.js))

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
├── idb.js                     # 最小 IndexedDB kv:handles 存目录句柄,pairs 存按对绑定的状态
├── mask.js                    # 光圈渐变单表(STOPS)+ 派生 maskCSS/canvasStops/pinCSS,模式表 MODES,圆环比例 RING_RADIUS
├── media.js                   # 媒体尺寸 + contain 绘制矩形/坐标映射(mediaSize/containRect/fitMapping/toMedia),查看器/合成/转码共用
├── download.js                # saveBlob:触发浏览器下载并延迟回收 objectURL
├── exportHtml.js              # 导出交互式单文件 HTML:内嵌媒体(图片压缩分流 / 视频原样)+ 拼装运行时
├── exportPage/
│   ├── player.js              # 导出页运行时(图片/视频共用;经 ?raw 内联进导出 HTML)
│   └── player.css             # 导出页样式(经 ?raw 内联)
├── App.vue                    # 编排层:composable 接线/键盘路由/合成导出调用/查看器全局 CSS
├── SettingsPanel.vue          # 设置浮层(模式/光圈/匹配标记/导出格式质量),v-model 开合
├── composables/
│   ├── useDirPairing.js       # 文件夹批量配对/单选底图+对比(图文通用)/拼接(图拆半,视频不拆),idb 恢复,翻页;pair.roles/audioRole/halfSides 角色派生
│   ├── usePanZoom.js          # 光圈跟随 + 缩放平移,lens 圆环
│   ├── useVideoSync.js        # 视频对播放同步:主时钟/暂停对齐/播放中软纠偏/归零重播
│   └── useVideoExport.js      # 视频 Ctrl+S:离线转码优先、实时录制兜底,recording 进度与取消
└── components/
    ├── PickerPage.vue         # 选择页(打开文件夹/底图/对比/拼接 四个入口,图文通用 + 恢复按钮)
    └── Toolbar.vue            # 查看器右上角工具栏(竖排,与导出页同款按钮);设置入口在左上角
index.html                     # Vite 入口
public/icon.svg                # PWA/manifest 图标
```

## 关键约定(请遵守)

1. **settings 是唯一共享状态**:[settings.js](src/settings.js) 导出 reactive 单例,改动自动落 localStorage。新增预览参数只加在 `DEFAULTS`,不要另开状态源。
2. **光圈渐变单一事实源**:[mask.js](src/mask.js) 的 `STOPS` 表(`soft` 占位符)派生出查看器 CSS 遮罩(`maskCSS()`)、canvas 合成(`canvasStops()`)与导出页(内嵌同一张表烤入),改光圈形状/羽化只动这一张表。
3. **坐标系**:遮罩渐变与光圈坐标都在 **stage 局部空间**。stage 用 `scale` + `translate`(origin 默认 50% 50%),指针坐标经 `toLocal()` 折算。合成/导出/离线转码再经 [media.js](src/media.js) 的 `fitMapping`/`toMedia`(object-fit:contain 实际绘制矩形)线性映射到**媒体像素**;导出页是零依赖独立运行时,内部另有一份等价 `fitRect`,只共享 `mask.js` 的纯数据。缩放/平移只是观察手段,不参与合成。
4. **导出页图片 / 视频共用一套运行时**:[exportHtml.js](src/exportHtml.js) 只负责内嵌媒体、生成配置、拼 HTML 并下载;页面本体是真实文件 [exportPage/player.js](src/exportPage/player.js) + [player.css](src/exportPage/player.css),经 Vite `?raw` 内联,靠 `__ugrvPlayer(JSON 配置)` 启动——不要再把大段交互脚本写回模板字符串。配置注入用 `JSON.stringify`,再把小于号转义,避免数据里冒出结束标签。两侧各是一个"裁切盒 + 媒体":`kind` 决定 `img`/`video`,`crop` 决定整幅/左半/右半(图片也走 CSS 2 倍宽裁切,不再 canvas 拆半);`Tab` 只换角色不换 src,拼接对换角色即翻半边;几何、合成、钉、onImg 一律由当前底图角色那侧的媒体尺寸推导。右上角三按钮:换底图/换对比替换该角色一侧为整幅,拼接图一个文件两侧共用、按角色各取一半;文件框 `accept="image/*,video/*"`,页内可把任意侧换成图片或视频。两侧都是视频才显示播放按钮、启用空格与两路同步(主时钟 = 出声角色那路);混合对(一图一视频)仍可悬停对比和 Ctrl+S/Ctrl+C,但视频暂停静音。与 App 保持同步的其余行为:光圈跟随、滚轮缩放(以鼠标为中心)、拖拽平移、Ctrl+滚轮调光圈、热键(1-4 切模式 / `[ ] , .` 调光圈 / Tab 互换 / Ctrl+S 下载 / Ctrl+C 复制 / `?` 帮助)、光圈钉(导出时经 `toMedia` 烤成底图媒体像素坐标 `{mx,my,size,mode}`,按方向两份:预置方向一份、互换方向从空开始,收件人左键点/右键 增删,会话态不落盘)、lens 圆环(半径 ×`RING_RADIUS`)。App 独有的 M 键/方向键翻组/Ctrl+E 导出不在导出页;已知的无害分叉:Ctrl+滚轮调光圈步进、滚轮缩放步长、帮助浮层条目。改 App 交互后检查导出页是否要跟。
5. **导出压缩**:内嵌图按扩展名分流——`jpg/jpeg/webp` 源文件原样嵌入不重编码,其余格式画布重编码(面板格式/质量,JPEG 垫白底)。
6. **objectURL 生命周期**:配对扫描/单换图时旧 URL 必须 revoke(`revokeGroup`/`pick` 内),卸载时兜底清全量。
7. **持久化**:[idb.js](src/idb.js) 是手写最小 IndexedDB kv(无依赖)——`handles` store 存 dir handle(不可 JSON 序列化),`pairs` store 按 `pair.key` 存每对的状态记录(`{ pins: [...], ...以后每对的其他数值 }`);刷新后浏览器要求一次用户点击重新授权(`needRestore` 流程)。
8. **配对规则**:`stemOf` 去扩展名 + 去任意位置的括号备注;带标记的进 base 槽(每根至多一张),不带的全部归该根的 hovers;标记改动防抖 300ms 自动重扫。扫描认 `MEDIA_EXTS`(图片 + 视频),组类型按底图扩展名定,同根下另一类的产出丢掉。
9. **拼接图**:`pickStitched()`(单选,图片视频通用:视频走 `kind:'video'` + `stitched`,不拆;哪边是原图看设置 `stitchImageSide`/`stitchVideoSide`,视频侧靠 `flipped`)与文件夹扫描(带拼接图标记的单文件,标记在设置面板,默认 `拼-`)把左右拼接图经 `cutHalves()` 裁成两半(`floor(w/2)` 等宽保证 1:1 对应,PNG 无损编码)后当普通一对走全流程——viewer/合成/导出零特判;`Tab` 互换 base 与当前产出(名字一起换,原图在右边时用)。
10. **光圈钉**:`pair.key`(目录/底图名|产出名,方向性)是按对绑定状态的稳定标识(objectURL 刷新即失效不能用);钉按 key 存 IDB `pairs` store,文件夹恢复后钉跟着恢复,Tab 互换算新的一对。
11. **切图同步**:viewer 是双层 stage(`stages`/`cur`,前层不透明底色挡背层)——新一对 decode 完填背层、画完一帧后翻层,新图与新遮罩严格同帧;钉的加载也压到翻层前一刻。`pair` 是目标态,其他逻辑(钉、导出、合成)都读 `pair`;读 DOM(合成/onImg)要取 `.layer.front`。改 `cur` 之后必须 `await nextTick()` 才能查新前层的 DOM。
12. **视频对**:`pair.kind === 'video'`。每层渲染一对 `<video>`,只有前层播放。角色语义只在 [useDirPairing.js](src/composables/useDirPairing.js) 派生一次:`pair.roles[i]` 是 `vids[i]` 当前担任的角色(`'a'` 底图 / `'b'` 对比),`pair.audioRole` 是出声的那一路(拼接视频恒为 a),`pair.halfSides` 是两角色取源哪半边。模板、主时钟、离线转码、实时收音一律消费这三个字段,别再自行推导。Tab 互换是**原地换角色**(`pair.vids` 固定载入顺序),不重设 src、不翻层——视频元素换 src 会重载,卡一下。播放同步在 [useVideoSync.js](src/composables/useVideoSync.js)。翻层后旧前层必须 `pause()`(被挡住也照样出声、吃解码)。两路选齐才自动播(只有底图时停在第一帧),起播前把对比路 `currentTime` 对齐到底图。两路是各走各的时钟,时间基准取**出声的那一路**(M/Tab 换角色后跟着换):暂停/起播前 `syncSlaves()` 一次对齐;**播放中绝不 seek 出声那路**——seek 打断音频管线就掉帧,且 seek 落地时对方又跑开一截,会变成反复 seek 的死循环(表现:出声那路掉帧、声音卡);播放中 `startSync()` 只给落后那一路微调 `playbackRate`(±5%)去追,差超 300ms 才对静音那一路硬 seek。空格 = 播放/暂停(图片对仍是切组),任一 `ended` → 两路归零重播。出声默认跟 base,`M` 切换出声角色(`settings.audioSide`,落 localStorage;按角色走,Tab 互换后声源跟着角色)。拼接视频不拆不重编码:两槽共用同一个 objectURL,`.ugrv-half`(整屏 wrapper,承载 mask)+ `.ugrv-crop`(按半边比例算出的裁切框)+ 2 倍宽视频,base 露左半、hover 露右半;Tab 互换翻 `group.flipped`(裁切位置与 `data-sx` 一起翻,合成也认 `data-sx`)。视频对 Ctrl+C 取当前帧合成;Ctrl+S 合成视频走 [videoConvert.js](src/videoConvert.js) 离线转码(底图分辨率、底图帧率、码率 0.45bit/px/frame、钉冻成静态 mask、出声那路音轨 aac/mp3 直接拷贝;mediabunny 解不了才退 [videoRecord.js](src/videoRecord.js) MediaRecorder 实时录制),离线期间界面照常用、Esc 取消;Ctrl+E 导出交互页([exportHtml.js](src/exportHtml.js),视频原样内嵌)。

## 快捷键

导出页只有 `1-4` / `[ ] , .` / `Tab` / `Ctrl+S` / `Ctrl+C` / `?`(两侧都是视频时另有 `空格` 播放/暂停);App 另有下列全部。

| 按键 | 作用 |
|---|---|
| `↑/↓` / `退格` | 切组(上/下一组) |
| `空格` | 切组(图片)/ 播放暂停(视频) |
| `M` | 切换视频声音来源(原视频 / 对比视频,持久化) |
| `←/→` | 切组内产出(单组时 ↑/↓ 同效) |
| `Tab` | 互换底图 / 对比图(名字一起换) |
| `左键点击` / `右键` | 钉住 / 去掉指针所在的光圈钉(快照模式/大小/柔和度;App 持久化按对绑定,导出页预置+会话态) |
| `1-4` | 切模式(torch/brush/spotlight/lens) |
| `[` `]` `,` `.` | 调光圈大小(50~400) |
| 滚轮 / 拖拽 | 缩放 / 平移 |
| `Ctrl+滚轮`、拖拽中滚轮 | 调光圈大小 |
| `Ctrl+C` / `Ctrl+S` | 合成复制(PNG) / 合成下载(面板格式) |
| `Ctrl+E` | 导出交互式单文件 HTML(App 内) |
| `?` | 帮助浮层 |

## 重构计划

见 [重构计划.md](重构计划.md)。P1-P4 已完成;视频播放同步与 Ctrl+S 调度已分别收进 `useVideoSync.js` / `useVideoExport.js`,角色语义与坐标映射各收口一处。App.vue 现约 790 行(模板 + 查看器 CSS 占大头),后续改动按职责落在对应模块。
