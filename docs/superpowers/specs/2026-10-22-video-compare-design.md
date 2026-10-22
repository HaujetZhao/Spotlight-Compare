# 视频对比支持 — 设计

日期:2026-10-22

## 目标

在现有手电筒图片对比查看器上支持视频对:两个视频或一段左右拼接的视频,底图铺满,hover 处用光圈透出对比视频。

## 范围(第一期)

做:
- 单选两个视频(第 1 个 = 底图,第 2 个 = 对比图)
- 单选一段左右拼接视频,不拆半、不重编码,渲染时裁半边
- 播放:载入后两路同时播放;只播底图声音;空格播放/暂停;任一播完双双归零重播
- Ctrl+C / Ctrl+S 取当前帧合成快照(含拼接视频)
- 光圈钉、缩放平移、模式切换照常复用(坐标与媒体类型无关)

不做:
- 文件夹批量配对视频
- 进度条 / 时间显示 / 逐帧步进
- 两路视频的帧间时钟校正(各自时钟,漂移可感知再拿底图当时钟拉齐)
- 视频对的 Ctrl+E 交互式 HTML 导出(直接忽略)
- 拼接视频的 Tab 互换(两半同源同一 URL,Tab 无效果)

## 数据模型

`pair` 增加两个字段,其余(key、钉、持久化)不变:

- `kind: 'image' | 'video'`
- `stitched?: true`(仅拼接视频)

拼接视频的 `base` 与 `hover` 是**同一个 objectURL**(不拆、不重编码);`revokeGroup` 重复 revoke 同 URL 无害。

## 渲染

viewer 双层 stage 不变,每层按 `kind` 渲染 `<img>` 或 `<video>`:

- 普通视频:`<video>` 直接套现有 `.ugrv-a/.ugrv-b` 布局(inset:0 + object-fit:contain)
- 拼接视频:每个槽是整屏 wrapper(`.ugrv-half`,承载 mask,保证遮罩坐标仍在 stage 空间)+ 按半边宽高比算出的裁切框(`.ugrv-crop`,overflow:hidden)+ 2 倍宽的视频,base 露左半、hover 露右半
- 裁切框几何由 `videoWidth/videoHeight` + 视口尺寸在 JS 里算(纯 CSS 无法可靠做出"半边比例 contain")

统一媒体尺寸读取放进 `mediaSize(el)`:图片 `naturalWidth`,视频 `videoWidth`,`.ugrv-half` 包裹时取一半。fit 布局、`onImg` 判定、合成导出共用。

## 播放模型

- **声音跟 base**:`.ugrv-a` 不 muted,`.ugrv-b` 永远 muted;Tab 互换后声源自然跟着新 base
- **载入**:背层视频等 `loadeddata` 再翻层(与图片 decode 同思路);翻层后 `play()`。自动播放策略拦下带声底图时静默停在 0 帧,空格开始
- **空格**:视频对 = 播放/暂停(拦截原"切组");图片对不变
- **结束**:监听前层 `ended`,任一播完 → 两路 `pause` + `currentTime = 0` + `play()`
- **Tab 互换**:同一对视频换方向(base/hover URL 互换),保留播放进度与暂停状态

## 导出

- Ctrl+C / Ctrl+S:视频取当前帧,拼接视频按半边取源矩形裁切,**不按扩展名分流**(那是图片的路径)
- Ctrl+E:视频对直接 return

## 验收点

- 选两个视频 → 自动播放(被拦则空格起播),只有底图出声
- 空格暂停/继续;任一播完归零重播
- Tab 互换后声音跟着新底图,进度连续
- 拼接视频左右两半各自填满、光圈位置与画面吻合
- 视频对 Ctrl+C/Ctrl+S 出当前帧快照;Ctrl+E 无反应
- 图片对全部行为不变
