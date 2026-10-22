<script setup>
// 手电筒对比:底图铺满,hover 图在上层用 radial-gradient 圆形遮罩跟随指针(延迟 0),
// 圈内透出 hover 图。支持文件夹批対:按"原图标记"(前缀/后缀)配对,←/→ 翻对。
// 目录句柄存 IndexedDB,刷新后可一键恢复(浏览器要求重新授权必须有一次用户点击)。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue';
import PickerPage from './components/PickerPage.vue';
import Toolbar from './components/Toolbar.vue';
import { useDirPairing } from './composables/useDirPairing';
import { usePanZoom } from './composables/usePanZoom';
import { useVideoExport } from './composables/useVideoExport';
import { useVideoSync } from './composables/useVideoSync';
import { saveBlob } from './download';
import { exportPlayer } from './exportPlayer';
import { idbGet, idbSet } from './idb';
import { canvasStops, maskCSS, MODES, pinCSS } from './mask';
import { fitMapping, mediaSize, toMedia } from './media';
import { settings } from './settings';
import SettingsPanel from './SettingsPanel.vue';

const { groups, gIdx, hIdx, group, pair, needRestore, noMatch, pick, pickStitched, swapPair, openFolder, restore, grantRestore, navGroup, navHover, dispose } = useDirPairing();
const showSettings = ref(false);
const showHelp = ref(false);
const viewer = ref(null);
const stage = ref(null);
const { x, y, active, onImg, move, show, hide, onUp, onWheel, onDown, onPanMove, onPanUp, ringStyle } = usePanZoom(stage, viewer);

// 钉住区:左键点击(非拖动)在指针处钉一份光圈效果(快照模式/大小/柔和度),右键去掉指针所在的那枚。
// 按 pair.key(目录/底图名|产出名,方向性)存 IDB pairs store,一条记录 { pins: [...], ...以后每对的其他数值 };
// Tab 互换是新的一对,换回原方向时原来的钉回来;文件夹恢复后钉跟着恢复
const pins = ref([]);
let pinsKey = null;
watch(pins, () => {
  if (pinsKey)
    idbSet('pairs', pinsKey, { pins: toRaw(pins.value) }); // IDB 结构化克隆不认 reactive 代理,写原始数据
}, { deep: true });

// 双层显示缓冲:新一对 decode 完填进背层(前层纹丝不动),浏览器画完一帧后连同新钉的 mask 一起翻到前层——
// 图与遮罩严格同帧出现。钉的加载压到翻层前一刻,避免新对的 mask 提前落在旧图上
const stages = ref([null, null]);
const cur = ref(0);
const raf2 = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

// 视频:每层一对 <video>,只有前层参与播放。角色与出声对应关系由 pair.roles / pair.audioRole 派生
// (见 useDirPairing),这里只按角色 class 找 DOM,不再自行推导谁出声
function layerVideos(front) {
  return [...(viewer.value?.querySelectorAll(`.layer${front ? '.front' : ':not(.front)'} video`) ?? [])];
}
function frontVideos() {
  return layerVideos(true);
}
function waitLoaded(v) {
  return v.readyState >= 2
    ? Promise.resolve()
    : new Promise(r => ['loadeddata', 'error'].forEach(t => v.addEventListener(t, r, { once: true })));
}
const { playAll, togglePlay, restart, syncSlaves } = useVideoSync({ pair, frontVideos });
const { recording, startExport, finishExport, cancelExport, handleEnded } = useVideoExport({
  pair,
  frontVideos,
  syncSlaves,
  playAll,
  drawFrame: (canvas, zones, scratch) => compositeInto(canvas, zones, scratch),
  nameOf: () => baseName('合成'),
});

// 任一播完:录制中则收工保存;否则两路归零重播
function onEnded(e) {
  if (!e.target.closest('.layer')?.classList.contains('front'))
    return;
  if (!handleEnded())
    restart();
}

watch(pair, async (p, old) => {
  if (!p) {
    [...layerVideos(true), ...layerVideos(false)].forEach(v => v.pause());
    stages.value = [null, null];
    pins.value = [];
    pinsKey = null;
    return;
  }
  // Tab 互换视频对:src 一个没变,只是底图/对比图角色对调 —— 原地更新前层,
  // 不重设 src、不翻层、不中断播放
  if (p.kind === 'video' && old?.vids && p.vids?.length === old.vids.length && p.vids.every((u, i) => u === old.vids[i])) {
    stages.value[cur.value] = p;
    pinsKey = p.key;
    const rec = await idbGet('pairs', p.key);
    if (pair.value !== p)
      return;
    pins.value = rec?.pins ?? [];
    return;
  }
  if (p.kind === 'video') {
    // 视频没有离散的 decode:先挂上背层元素,等它们出第一帧再翻层
    stages.value[1 - cur.value] = p;
    await nextTick();
    await Promise.all(layerVideos(false).map(waitLoaded));
  }
  else {
    try {
      await Promise.all([p.base, p.hover].map((u) => {
        const img = new Image();
        img.src = u;
        return img.decode();
      }));
    }
    catch {
      // 坏图不等 decode,直接上(显示为空白,比卡住好)
    }
    if (pair.value !== p)
      return; // decode 期间已切到别的对,丢弃
    stages.value[1 - cur.value] = p;
  }
  await nextTick();
  await raf2(); // 等背层画完一帧
  if (pair.value !== p)
    return;
  pinsKey = p.key;
  const rec = await idbGet('pairs', p.key);
  if (pair.value !== p)
    return;
  pins.value = rec?.pins ?? [];
  const oldFront = frontVideos();
  cur.value = 1 - cur.value; // 翻层:新图 + 新 mask 同帧生效
  oldFront.forEach(v => v.pause()); // 旧前层退到背层:不暂停照样出声、吃解码
  // 两路选齐才自动播:只选了底图时停在第一帧,等用户选对比
  if (p.kind === 'video' && p.base && p.hover) {
    await nextTick(); // cur 刚改,DOM 还没翻层,等刷完再取新的前层
    playAll();
  }
});
function pin() {
  if (!active.value)
    return;
  pins.value.push({ x: x.value, y: y.value, mode: settings.mode, size: settings.size, softness: settings.softness });
}
// 左键抬起时位移 < 5px 且按压时长 < 300ms 才算点击放钉,拖拽/长按不放
let downPos = null;
function onViewDown(e) {
  if (e.button === 0)
    downPos = { x: e.clientX, y: e.clientY, t: performance.now() };
  onDown(e);
}
function onViewUp(e) {
  onUp(e);
  if (e.button !== 0 || e.pointerType !== 'mouse' || !downPos)
    return;
  if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) < 5 && performance.now() - downPos.t < 300)
    pin();
  downPos = null;
}
function unpin() {
  const hit = pins.value.findIndex(p => Math.hypot(p.x - x.value, p.y - y.value) <= p.size);
  if (hit >= 0)
    pins.value.splice(hit, 1);
}
// ugrv-b 的 mask:钉住层 + 实时层,逗号并列成多层(union);只挂前层,背层不随光圈重画
const maskValue = computed(() => [...pins.value.map(pinCSS), maskCSS(settings.mode)].join(', '));
const maskStyle = computed(() => ({ webkitMaskImage: maskValue.value, maskImage: maskValue.value }));

// 拼接视频裁半:半边比例 contain 进视口,CSS 做不到(宽高都受 max 约束时 aspect-ratio 不会反推),
// 这里按视口尺寸算裁切框,视频按 2 倍宽铺进去,只露一半
const viewSize = ref({ w: window.innerWidth, h: window.innerHeight });
const mediaDims = ref(null);
function onResize() {
  viewSize.value = { w: window.innerWidth, h: window.innerHeight };
}
const halfBox = computed(() => {
  const d = mediaDims.value;
  if (!d?.w)
    return null;
  const { w: vw, h: vh } = viewSize.value;
  const k = Math.min(vw / (d.w / 2), vh / d.h);
  const w = (d.w / 2) * k;
  const h = d.h * k;
  return { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
});
const cropStyle = computed(() => {
  const b = halfBox.value;
  return b && { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` };
});
const cropVideoStyle = computed(() => {
  const b = halfBox.value;
  return b && { left: '0', top: '0', width: `${b.w * 2}px`, height: `${b.h}px` };
});
// 右半:视频左移一个裁切框宽,hover 槽露右半
const cropVideoRightStyle = computed(() => {
  const b = halfBox.value;
  return b && { left: `${-b.w}px`, top: '0', width: `${b.w * 2}px`, height: `${b.h}px` };
});
function onMeta(e) {
  mediaDims.value = { w: e.target.videoWidth, h: e.target.videoHeight };
}

function onKey(e) {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA')
    return;
  // 合成/录制中只认 Esc(取消);实时录制再加空格(停下保存)。其余一律忽略:
  // 翻组/换声/放钉都会毁掉录制,离线合成期间也会让保存的文件名对不上内容
  if (recording.value) {
    if (!recording.value.offline && e.key === ' ') {
      e.preventDefault();
      finishExport(true);
    }
    else if (e.key === 'Escape') {
      cancelExport();
    }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
    e.preventDefault();
    copyComposite();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    if (pair.value?.kind === 'video')
      recordVideo();
    else
      downloadComposite();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'e' || e.key === 'E')) {
    e.preventDefault();
    exportHtml();
    return;
  }
  // 1-4 切模式,[ ] 和 , . 调光圈大小,Tab 互换底图/产出
  if (e.key >= '1' && e.key <= '4') {
    settings.mode = MODES[e.key - 1];
    return;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    swapPair();
    return;
  }
  // 视频对:空格播放/暂停;图片对仍是切组(见下方)
  if (e.key === ' ' && pair.value?.kind === 'video') {
    e.preventDefault();
    togglePlay();
    return;
  }
  // M 切换哪一路出声(原视频 / 对比视频),选择落 localStorage
  if ((e.key === 'm' || e.key === 'M') && pair.value?.kind === 'video') {
    settings.audioSide = settings.audioSide === 'base' ? 'hover' : 'base';
    return;
  }
  if (e.key === '?') {
    showHelp.value = !showHelp.value;
    return;
  }
  if (e.key === 'Escape' && showHelp.value) {
    showHelp.value = false;
    return;
  }
  if (e.key === '[' || e.key === ',')
    settings.size = Math.max(50, settings.size - 10);
  if (e.key === ']' || e.key === '.')
    settings.size = Math.min(400, settings.size + 10);
  // 只有一组时,↑/↓ 退化为切换组内产出
  const single = groups.value.length < 2;
  if (e.key === 'ArrowUp')
    single ? navHover(-1) : navGroup(-1);
  if (e.key === 'ArrowDown')
    single ? navHover(1) : navGroup(1);
  if (e.key === 'ArrowLeft')
    navHover(-1);
  if (e.key === 'ArrowRight')
    navHover(1);
  if (e.key === ' ') {
    e.preventDefault();
    navGroup(1);
  }
  if (e.key === 'Backspace') {
    e.preventDefault();
    navGroup(-1);
  }
}

// 合成绘制:图片直绘;视频取当前帧;拼接视频按 data-sx 取半边(模板里跟着 halfSides 换)
function drawMedia(ctx, el, dx, dy, dw, dh) {
  const v = el instanceof HTMLVideoElement ? el : el.querySelector('video');
  if (!v)
    return ctx.drawImage(el, dx, dy, dw, dh);
  const sw = v.videoWidth / (el.classList.contains('ugrv-half') ? 2 : 1);
  const sx = (Number(v.dataset.sx) || 0) * sw;
  ctx.drawImage(v, sx, 0, sw, v.videoHeight, dx, dy, dw, dh);
}

// 合成当前叠加效果(底图 + 光圈内透出的 hover 图 + 钉)到原图分辨率画布。
// 方案 A:缩放/平移只是观察手段不参与合成,输出整张图;
// 光圈中心/大小按 stage 局部坐标线性映射(fitK = 原图宽 / 屏幕显示宽),相对大小与屏幕一致。
// 未 hover 且无钉时即纯原图。zones 为 stage 局部坐标光圈;媒体未就绪返回 null。
// 截帧(Ctrl+C/S)与视频录制共用。录制逐帧调用时传入 scratch 复用临时画布:
// 4K 下每帧新建三张全尺寸画布会被分配/GC 压垮(表现:录制中原视频卡住),复用后只剩绘制开销。
function compositeInto(canvas, zones, scratch = {}) {
  const el = viewer.value;
  const mediaA = el?.querySelector('.layer.front .ugrv-a');
  const mediaB = el?.querySelector('.layer.front .ugrv-b');
  const sa = mediaA && mediaSize(mediaA);
  const sb = mediaB && mediaSize(mediaB);
  if (!sa?.w || !sb?.w)
    return null;
  const { rect: ra, k: fitK } = fitMapping(mediaA, el.clientWidth, el.clientHeight);
  if (canvas.width !== sa.w || canvas.height !== sa.h) {
    canvas.width = sa.w;
    canvas.height = sa.h;
  }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawMedia(ctx, mediaA, 0, 0, sa.w, sa.h);
  if (zones.length) {
    // hover 图画到临时画布;各透明区先画到蒙版画布(source-over 叠加 = 并集),
    // 再一次 destination-in 抠出,叠回底图
    const { rect: rb } = fitMapping(mediaB, el.clientWidth, el.clientHeight);
    if (!scratch.temp || !scratch.mask) {
      scratch.temp = document.createElement('canvas');
      scratch.mask = document.createElement('canvas');
    }
    const temp = scratch.temp;
    const mask = scratch.mask;
    if (temp.width !== canvas.width || temp.height !== canvas.height) {
      temp.width = canvas.width;
      temp.height = canvas.height;
      mask.width = canvas.width;
      mask.height = canvas.height;
    }
    const t = temp.getContext('2d');
    t.globalCompositeOperation = 'source-over';
    t.clearRect(0, 0, temp.width, temp.height); // hover 矩形未必铺满画布,先清掉上一帧残迹
    drawMedia(t, mediaB, (rb[0] - ra[0]) * fitK, (rb[1] - ra[1]) * fitK, rb[2] * fitK, rb[3] * fitK);
    const mc = mask.getContext('2d');
    for (const z of zones) {
      const { mx, my, size } = toMedia(z, ra, fitK);
      const g = mc.createRadialGradient(mx, my, 0, mx, my, size);
      z.stops.forEach(([o, c]) => g.addColorStop(o, c));
      mc.fillStyle = g;
      mc.fillRect(0, 0, mask.width, mask.height);
    }
    t.globalCompositeOperation = 'destination-in';
    t.drawImage(mask, 0, 0);
    ctx.drawImage(temp, 0, 0);
  }
  return canvas;
}

function compositeCanvas() {
  const zones = pins.value.map(p => ({ x: p.x, y: p.y, size: p.size, stops: canvasStops(p.mode, p.softness) }));
  // 镜头模式出图时屏上不显实时光圈,合成同样不画
  if (active.value && (settings.mode !== 'lens' || onImg.value))
    zones.push({ x: x.value, y: y.value, size: settings.size, stops: canvasStops(settings.mode, settings.softness) });
  return compositeInto(document.createElement('canvas'), zones);
}

// Ctrl+C:合成结果写入剪贴板(PNG,浏览器剪贴板只保证这一种)
async function copyComposite() {
  const canvas = compositeCanvas();
  if (!canvas)
    return;
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

// Ctrl+S:按面板选的格式/质量下载到默认下载文件夹(JPEG 无 alpha,垫白底)
async function downloadComposite() {
  const canvas = compositeCanvas();
  if (!canvas)
    return;
  const fmt = settings.exportFormat;
  if (fmt === 'jpeg') {
    const ctx = canvas.getContext('2d');
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const blob = await new Promise(r => canvas.toBlob(r, `image/${fmt}`, settings.exportQuality));
  saveBlob(blob, `${baseName('合成')}.${fmt}`);
}

// Ctrl+S(视频对):准备光圈坐标与合成回调,离线/实时两条路径的调度见 useVideoExport
async function recordVideo() {
  if (!pair.value?.base || !pair.value?.hover)
    return; // 没选齐两路
  const stageZones = pins.value.map(p => ({ x: p.x, y: p.y, size: p.size, stops: canvasStops(p.mode, p.softness) }));
  // 光圈坐标按媒体像素映射(与 compositeInto 同一线性映射),离线管线直接用
  const frontA = viewer.value?.querySelector('.layer.front .ugrv-a');
  if (!frontA)
    return;
  const { rect, k } = fitMapping(frontA, viewer.value.clientWidth, viewer.value.clientHeight);
  const zones = stageZones.map(z => ({ ...toMedia(z, rect, k), stops: z.stops }));
  await startExport({ zones, stageZones });
}
// 当前产出名(去扩展名);没有产出名退回底图名,再退回 fallback
function baseName(fallback) {
  return (group.value?.hoverNames?.[hIdx.value] || group.value?.baseName || fallback).replace(/\.\w+$/, '');
}

// Ctrl+E:压缩内嵌 + 拼装导出页都在 exportPlayer.js
async function exportHtml() {
  if (!pair.value || pair.value.kind === 'video')
    return; // 视频对不出交互页:内嵌 base64 视频体积和交互适配都不划算
  // 钉转成原图分辨率坐标导出(与合成同映射),收件人页按其视口换算回屏幕层
  const imgA = viewer.value.querySelector('.layer.front .ugrv-a');
  const { rect, k } = fitMapping(imgA, viewer.value.clientWidth, viewer.value.clientHeight);
  await exportPlayer({
    urlA: pair.value.base,
    urlB: pair.value.hover,
    nameA: group.value?.baseName,
    nameB: group.value?.hoverNames?.[hIdx.value],
    name: baseName('对比'),
    pins: pins.value.map(p => ({ ...toMedia(p, rect, k), mode: p.mode })),
  });
}

onMounted(() => {
  window.addEventListener('keydown', onKey);
  window.addEventListener('mousemove', onPanMove);
  window.addEventListener('mouseup', onPanUp);
  window.addEventListener('resize', onResize);
  restore();
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('mousemove', onPanMove);
  window.removeEventListener('mouseup', onPanUp);
  window.removeEventListener('resize', onResize);
  dispose();
});
</script>

<template>
  <div v-if="stages[cur]" ref="viewer" class="ugrv" :class="[`ugrv-m-${settings.mode}`, { 'ugrv-in': active, 'ugrv-on-img': onImg }]" :style="{ '--ugrv-x': `${x}px`, '--ugrv-y': `${y}px`, '--ugrv-size': `${settings.size}px`, '--ugrv-soft': `${settings.softness}%` }" @pointerenter="show" @pointerdown="show" @pointermove="move" @pointerleave="hide" @pointercancel="hide" @pointerup="onViewUp" @wheel.prevent="onWheel" @mousedown="onViewDown" @contextmenu.prevent="unpin" @dragstart.prevent>
    <div ref="stage" class="stage">
      <div v-for="(s, i) in stages" :key="i" class="layer" :class="{ front: i === cur }">
        <!-- 拼接视频:同一段视频左右各露一半;wrapper 占满 stage 承载 mask,裁切框按视口算 -->
        <template v-if="s?.kind === 'video' && s.stitched">
          <div class="ugrv-a ugrv-half">
            <div class="ugrv-crop" :style="cropStyle">
              <video :src="s.vids[0]" :style="s.halfSides.a ? cropVideoRightStyle : cropVideoStyle" :data-sx="s.halfSides.a" preload="auto" playsinline @loadedmetadata="onMeta" @ended="onEnded" />
            </div>
          </div>
          <div class="ugrv-b ugrv-half" :style="i === cur ? maskStyle : undefined">
            <div class="ugrv-crop" :style="cropStyle">
              <video :src="s.vids[0]" :style="s.halfSides.b ? cropVideoRightStyle : cropVideoStyle" :data-sx="s.halfSides.b" preload="auto" playsinline muted @loadedmetadata="onMeta" @ended="onEnded" />
            </div>
          </div>
        </template>
        <!-- 两路 src 固定按载入顺序,角色(class .ugrv-a 底图 / .ugrv-b 对比)与出声由 pair.roles/audioRole 派生:Tab 互换不重载 -->
        <template v-else-if="s?.kind === 'video'">
          <video v-if="s.vids[0]" :class="`ugrv-${s.roles[0]}`" :src="s.vids[0]" :muted="s.roles[0] !== s.audioRole" :style="s.roles[0] === 'b' && i === cur ? maskStyle : undefined" preload="auto" playsinline @loadedmetadata="onMeta" @ended="onEnded" />
          <video v-if="s.vids[1]" :class="`ugrv-${s.roles[1]}`" :src="s.vids[1]" :muted="s.roles[1] !== s.audioRole" :style="s.roles[1] === 'b' && i === cur ? maskStyle : undefined" preload="auto" playsinline @loadedmetadata="onMeta" @ended="onEnded" />
        </template>
        <template v-else-if="s">
          <img class="ugrv-a" :src="s.base" alt="底图">
          <img class="ugrv-b" :src="s.hover" alt="对比图" :style="i === cur ? maskStyle : undefined">
        </template>
      </div>
    </div>
    <div class="ugrv-ring" :style="ringStyle" />
    <Toolbar :count="groups.length" :g-idx="gIdx" :h-idx="hIdx" :hover-count="group?.hovers.length ?? 0" @nav-group="navGroup" @nav-hover="navHover" @pick="pick" @pick-stitched="pickStitched" @open-folder="openFolder" />
    <!-- 左上角设置入口;mousedown 拦住,否则面板的"点外关闭"会先关掉、click 又打开 -->
    <button class="ugrv-set" title="设置" @mousedown.stop @click="showSettings = !showSettings">
      设置
    </button>
    <button class="ugrv-help" title="快捷键" @click="showHelp = !showHelp">
      ?
    </button>
    <div v-if="recording" class="ugrv-rec">
      {{ recording.offline ? '合成中' : '录制中' }} {{ Math.round(recording.pct * 100) }}% · {{ recording.offline ? 'Esc 取消' : '空格停止并保存 · Esc 取消' }}
    </div>
    <div v-if="showHelp" class="ugrv-help-mask" @click="showHelp = false">
      <div class="ugrv-card">
        <h3>快捷键</h3>
        <table>
          <tr class="grp">
            <td colspan="4">
              切换
            </td>
          </tr>
          <tr>
            <td><kbd>↑/↓</kbd> <kbd>退格</kbd></td><td class="act">
              切组
            </td>
            <td><kbd>←/→</kbd></td><td class="act">
              切换产出
            </td>
          </tr>
          <tr>
            <td><kbd>空格</kbd></td><td class="act">
              视频播放/暂停(图片为切组)
            </td>
            <td><kbd>Tab</kbd></td><td class="act">
              互换底图/对比图
            </td>
          </tr>
          <tr>
            <td><kbd>M</kbd></td><td class="act">
              切换声音来源(原视频/对比视频)
            </td>
            <td />
            <td />
          </tr>
          <tr class="grp">
            <td colspan="4">
              光圈
            </td>
          </tr>
          <tr>
            <td><kbd>1</kbd>-<kbd>4</kbd></td><td class="act">
              切换模式
            </td>
            <td><kbd>[</kbd> <kbd>]</kbd> <kbd>,</kbd> <kbd>.</kbd></td><td class="act">
              光圈大小
            </td>
          </tr>
          <tr>
            <td><kbd>左键点击</kbd></td><td class="act">
              钉住光圈
            </td>
            <td><kbd>右键</kbd></td><td class="act">
              去掉光圈钉
            </td>
          </tr>
          <tr>
            <td><kbd>Ctrl</kbd>+<kbd>滚轮</kbd></td><td class="act">
              光圈大小
            </td>
            <td />
            <td />
          </tr>
          <tr class="grp">
            <td colspan="4">
              视图
            </td>
          </tr>
          <tr>
            <td><kbd>滚轮</kbd></td><td class="act">
              缩放
            </td>
            <td><kbd>拖拽</kbd></td><td class="act">
              平移
            </td>
          </tr>
          <tr class="grp">
            <td colspan="4">
              导出
            </td>
          </tr>
          <tr>
            <td><kbd>Ctrl</kbd>+<kbd>C</kbd></td><td class="act">
              复制图片
            </td>
            <td><kbd>Ctrl</kbd>+<kbd>S</kbd></td><td class="act">
              保存图片 / 录制合成视频
            </td>
          </tr>
          <tr>
            <td><kbd>Ctrl</kbd>+<kbd>E</kbd></td><td class="act">
              导出交互 HTML
            </td>
            <td />
            <td />
          </tr>
        </table>
      </div>
    </div>
  </div>

  <PickerPage v-else :pair="pair" :need-restore="needRestore" :no-match="noMatch" @pick="pick" @pick-stitched="pickStitched" @open-folder="openFolder" @grant-restore="grantRestore" />

  <SettingsPanel v-model="showSettings" />
</template>

<style>
@property --ugrv-r {
  syntax: "<length>";
  inherits: true;
  initial-value: 0px;
}
@property --ugrv-x {
  syntax: "<length>";
  inherits: true;
  initial-value: 0px;
}
@property --ugrv-y {
  syntax: "<length>";
  inherits: true;
  initial-value: 0px;
}

body {
  margin: 0;
  min-height: 100dvh;
  background: #0b1020;
  overflow: hidden;
}

/* 手电筒查看器 */
.ugrv {
  --ugrv-r: 0px;
  --ugrv-size: 130px;
  --ugrv-soft: 56%;
  position: relative;
  width: 100vw;
  height: 100dvh;
  overflow: hidden;
  cursor: crosshair;
  user-select: none;
}
.ugrv.ugrv-in {
  --ugrv-r: var(--ugrv-size);
}
/* 放大镜出图:只藏实时光圈(半径归零),钉不受影响 */
.ugrv-m-lens:not(.ugrv-on-img) {
  --ugrv-r: 0px;
}
.stage {
  position: absolute;
  inset: 0;
  z-index: 1;
}
/* 双层显示缓冲:前层不透明底色挡住背层(含 letterbox 区),翻层即整帧切换 */
.layer {
  position: absolute;
  inset: 0;
  z-index: 1;
}
.layer.front {
  z-index: 2;
  background: #0b1020;
}
.ugrv img,
.ugrv video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.ugrv-half {
  position: absolute;
  inset: 0;
}
.ugrv-crop {
  position: absolute;
  overflow: hidden;
}
/* 拼接视频:视频按 2 倍宽铺进裁切框(框比例与视频一致,不拉伸),只露一半 */
.ugrv-crop video {
  inset: auto;
  object-fit: fill;
}
.ugrv-a {
  z-index: 1;
}
.ugrv-b {
  z-index: 2;
  opacity: 1;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}
/* 放大镜:在底图内藏光标用圆环代替,出图恢复鼠标 */
.ugrv-m-lens.ugrv-on-img {
  cursor: none;
}
.ugrv-ring {
  position: absolute;
  z-index: 3;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.85);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35), 0 10px 26px rgba(0, 0, 0, 0.4), inset 0 0 22px rgba(255, 255, 255, 0.16);
  pointer-events: none;
  opacity: 0;
}
.ugrv-m-lens.ugrv-on-img.ugrv-in .ugrv-ring {
  opacity: 1;
}
/* 帮助浮层(与导出页同款) */
/* 左上角设置入口,与导出页按钮同款 */
.ugrv-set {
  position: absolute;
  left: 12px;
  top: 12px;
  z-index: 4;
  padding: 5px 16px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 999px;
  background: rgba(30, 40, 66, 0.8);
  color: #fff;
  font: 600 12px system-ui, sans-serif;
  cursor: pointer;
}
.ugrv-set:hover {
  background: rgba(52, 64, 100, 0.9);
}
.ugrv-help {
  position: absolute;
  left: 12px;
  bottom: 12px;
  z-index: 4;
  width: 30px;
  height: 30px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 50%;
  background: rgba(30, 40, 66, 0.8);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  color: #fff;
  font: 700 15px system-ui, sans-serif;
  cursor: pointer;
}
.ugrv-help:hover {
  background: rgba(52, 64, 100, 0.9);
}
/* 录制中进度条 */
.ugrv-rec {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 6;
  padding: 6px 16px;
  border-radius: 999px;
  background: rgba(178, 44, 44, 0.88);
  color: #fff;
  font: 600 13px system-ui, sans-serif;
  user-select: none;
}
.ugrv-help-mask {
  position: absolute;
  inset: 0;
  z-index: 5;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}
.ugrv-card {
  min-width: 420px;
  padding: 20px 26px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 14px;
  background: rgba(16, 22, 40, 0.92);
  color: #fff;
}
.ugrv-card h3 {
  margin: 0 0 14px;
  font: 600 14px system-ui, sans-serif;
  opacity: 0.9;
}
.ugrv-card table {
  border-collapse: collapse;
  font: 13px system-ui, sans-serif;
}
.ugrv-card td {
  padding: 5px 0;
}
.ugrv-card tr.grp td {
  padding: 10px 0 4px;
  color: #9db1ff;
  font: 600 11px system-ui, sans-serif;
  letter-spacing: 2px;
}
.ugrv-card td:nth-child(odd) {
  padding-right: 22px;
  white-space: nowrap;
}
.ugrv-card td:nth-child(even) {
  padding-right: 26px;
  opacity: 0.7;
}
.ugrv-card kbd {
  display: inline-block;
  padding: 1px 7px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  font: 11px/1.7 system-ui, sans-serif;
}
@media (hover: none) {
  .ugrv {
    cursor: pointer;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ugrv {
    transition: none;
  }
}
</style>
