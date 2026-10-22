<script setup>
// 手电筒对比:底图铺满,hover 图在上层用 radial-gradient 圆形遮罩跟随指针(延迟 0),
// 圈内透出 hover 图。支持文件夹批対:按"原图标记"(前缀/后缀)配对,←/→ 翻对。
// 目录句柄存 IndexedDB,刷新后可一键恢复(浏览器要求重新授权必须有一次用户点击)。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import PickerPage from './components/PickerPage.vue';
import Toolbar from './components/Toolbar.vue';
import { useDirPairing } from './composables/useDirPairing';
import { usePanZoom } from './composables/usePanZoom';
import { exportPlayer } from './exportPlayer';
import { canvasStops, maskCSS, pinCSS } from './mask';
import { settings } from './settings';
import SettingsPanel from './SettingsPanel.vue';

const { groups, gIdx, hIdx, group, pair, needRestore, noMatch, pick, pickStitched, swapPair, openFolder, restore, grantRestore, navGroup, navHover, dispose } = useDirPairing();
const showSettings = ref(false);
const viewer = ref(null);
const stage = ref(null);
const { x, y, active, onImg, move, show, hide, onUp, onWheel, onDown, onPanMove, onPanUp, onDblClick, ringStyle } = usePanZoom(stage, viewer);

// 钉住区:左键点击(非拖动)在指针处钉一份光圈效果(快照模式/大小/柔和度),右键去掉指针所在的那枚。
// 钉按 pair.key(目录/底图名|产出名,方向性)各存一份:Tab 互换是新的一对,换回原方向时原来的钉回来;
// 钉表落 localStorage,文件夹恢复后钉跟着恢复
const pins = ref([]);
const pinsByPair = new Map(JSON.parse(localStorage.getItem('ugrv-pins') || '[]'));
watch(pins, () => localStorage.setItem('ugrv-pins', JSON.stringify([...pinsByPair])), { deep: true });
watch(pair, (p) => {
  if (!p) {
    pins.value = [];
    return;
  }
  if (!pinsByPair.has(p.key))
    pinsByPair.set(p.key, []);
  pins.value = pinsByPair.get(p.key);
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
// ugrv-b 的 mask:钉住层 + 实时层,逗号并列成多层(union)
const maskValue = computed(() => [...pins.value.map(pinCSS), maskCSS(settings.mode)].join(', '));

function onKey(e) {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA')
    return;
  if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
    e.preventDefault();
    copyComposite();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    downloadComposite();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'e' || e.key === 'E')) {
    e.preventDefault();
    exportHtml();
    return;
  }
  // 1-4 切模式,[ ] 和 , . 调光圈大小,Tab 互换底图/产出
  const MODES = ['torch', 'brush', 'spotlight', 'lens'];
  if (e.key >= '1' && e.key <= '4') {
    settings.mode = MODES[e.key - 1];
    return;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    swapPair();
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

// 合成当前叠加效果(底图 + 光圈内透出的 hover 图)到原图分辨率画布。
// 方案 A:缩放/平移只是观察手段不参与合成,输出整张图;
// 光圈中心/大小按 stage 局部坐标线性映射(fitK = 原图宽 / 屏幕显示宽),相对大小与屏幕一致。
// 未 hover 时即纯原图。图片未就绪返回 null。
function compositeCanvas() {
  const el = viewer.value;
  const imgA = el?.querySelector('.ugrv-a');
  const imgB = el?.querySelector('.ugrv-b');
  if (!imgA || !imgB || !imgA.naturalWidth || !imgB.naturalWidth)
    return null;
  const w = el.clientWidth;
  const h = el.clientHeight;
  // object-fit: contain 的实际绘制矩形(stage 局部空间)
  const fitRect = (img) => {
    const k = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const iw = img.naturalWidth * k;
    const ih = img.naturalHeight * k;
    return [(w - iw) / 2, (h - ih) / 2, iw, ih];
  };
  const ra = fitRect(imgA);
  const fitK = imgA.naturalWidth / ra[2];
  const canvas = document.createElement('canvas');
  canvas.width = imgA.naturalWidth;
  canvas.height = imgA.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imgA, 0, 0);
  if (active.value || pins.value.length) {
    // hover 图画到临时画布;各透明区(钉住 + 当前光圈)先画到蒙版画布(source-over 叠加 = 并集),
    // 再一次 destination-in 抠出,叠回底图
    const rb = fitRect(imgB);
    const temp = document.createElement('canvas');
    temp.width = canvas.width;
    temp.height = canvas.height;
    const t = temp.getContext('2d');
    t.drawImage(imgB, (rb[0] - ra[0]) * fitK, (rb[1] - ra[1]) * fitK, rb[2] * fitK, rb[3] * fitK);
    const mask = document.createElement('canvas');
    mask.width = canvas.width;
    mask.height = canvas.height;
    const mc = mask.getContext('2d');
    const zones = pins.value.map(p => ({ x: p.x, y: p.y, size: p.size, stops: canvasStops(p.mode, p.softness) }));
    if (active.value)
      zones.push({ x: x.value, y: y.value, size: settings.size, stops: canvasStops(settings.mode, settings.softness) });
    for (const z of zones) {
      const mx = (z.x - ra[0]) * fitK;
      const my = (z.y - ra[1]) * fitK;
      const g = mc.createRadialGradient(mx, my, 0, mx, my, z.size * fitK);
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
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const name = (group.value?.hoverNames?.[hIdx.value] || group.value?.baseName || '合成').replace(/\.\w+$/, '');
  a.download = `${name}.${fmt}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Ctrl+E:压缩内嵌 + 拼装导出页都在 exportPlayer.js
async function exportHtml() {
  if (!pair.value)
    return;
  await exportPlayer({
    urlA: pair.value.base,
    urlB: pair.value.hover,
    nameA: group.value?.baseName,
    nameB: group.value?.hoverNames?.[hIdx.value],
    name: (group.value?.hoverNames?.[hIdx.value] || group.value?.baseName || '对比').replace(/\.\w+$/, ''),
  });
}

onMounted(() => {
  window.addEventListener('keydown', onKey);
  window.addEventListener('mousemove', onPanMove);
  window.addEventListener('mouseup', onPanUp);
  restore();
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('mousemove', onPanMove);
  window.removeEventListener('mouseup', onPanUp);
  dispose();
});
</script>

<template>
  <div v-if="pair" ref="viewer" class="ugrv" :class="[`ugrv-m-${settings.mode}`, { 'ugrv-in': active, 'ugrv-on-img': onImg }]" :style="{ '--ugrv-x': `${x}px`, '--ugrv-y': `${y}px`, '--ugrv-size': `${settings.size}px`, '--ugrv-soft': `${settings.softness}%` }" @pointerenter="show" @pointerdown="show" @pointermove="move" @pointerleave="hide" @pointercancel="hide" @pointerup="onViewUp" @wheel.prevent="onWheel" @mousedown="onViewDown" @dblclick="onDblClick" @contextmenu.prevent="unpin" @dragstart.prevent>
    <div ref="stage" class="stage">
      <img class="ugrv-a" :src="pair.base" alt="底图">
      <img class="ugrv-b" :src="pair.hover" alt="对比图" :style="{ webkitMaskImage: maskValue, maskImage: maskValue }">
    </div>
    <div class="ugrv-ring" :style="ringStyle" />
    <Toolbar :count="groups.length" :g-idx="gIdx" :h-idx="hIdx" :hover-count="group?.hovers.length ?? 0" @nav-group="navGroup" @nav-hover="navHover" @pick="pick" @pick-stitched="pickStitched" @open-folder="openFolder" @toggle-settings="showSettings = !showSettings" />
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
.stage {
  position: absolute;
  inset: 0;
  z-index: 1;
}
.ugrv img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
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
/* 放大镜:在底图内藏光标用圆环代替,出图恢复鼠标并藏光圈遮罩 */
.ugrv-m-lens.ugrv-on-img {
  cursor: none;
}
.ugrv-m-lens:not(.ugrv-on-img) .ugrv-b {
  visibility: hidden;
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
