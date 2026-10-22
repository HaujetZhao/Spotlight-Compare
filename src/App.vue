<script setup>
// 手电筒对比:底图铺满,hover 图在上层用 radial-gradient 圆形遮罩跟随指针(延迟 0),
// 圈内透出 hover 图。支持文件夹批対:按"原图标记"(前缀/后缀)配对,←/→ 翻对。
// 目录句柄存 IndexedDB,刷新后可一键恢复(浏览器要求重新授权必须有一次用户点击)。
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useDirPairing } from './composables/useDirPairing';
import { usePanZoom } from './composables/usePanZoom';
import { exportPlayer } from './exportPlayer';
import { canvasStops, maskCSS } from './mask';
import { settings } from './settings';
import SettingsPanel from './SettingsPanel.vue';

const { groups, gIdx, hIdx, group, pair, needRestore, noMatch, pick, openFolder, restore, grantRestore, navGroup, navHover, dispose } = useDirPairing();
const showSettings = ref(false);
const viewer = ref(null);
const stage = ref(null);
const { x, y, active, move, show, hide, onUp, onWheel, onDown, onPanMove, onPanUp, onDblClick, ringStyle } = usePanZoom(stage, viewer);

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
  // 1-4 切模式,[ ] 和 , . 调光圈大小
  const MODES = ['torch', 'brush', 'spotlight', 'lens'];
  if (e.key >= '1' && e.key <= '4') {
    settings.mode = MODES[e.key - 1];
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
  if (active.value) {
    // hover 图画到临时画布,用径向渐变 destination-in 抠出光圈,再叠回
    const rb = fitRect(imgB);
    const temp = document.createElement('canvas');
    temp.width = canvas.width;
    temp.height = canvas.height;
    const t = temp.getContext('2d');
    t.drawImage(imgB, (rb[0] - ra[0]) * fitK, (rb[1] - ra[1]) * fitK, rb[2] * fitK, rb[3] * fitK);
    t.globalCompositeOperation = 'destination-in';
    const mx = (x.value - ra[0]) * fitK;
    const my = (y.value - ra[1]) * fitK;
    const g = t.createRadialGradient(mx, my, 0, mx, my, settings.size * fitK);
    canvasStops(settings.mode, settings.softness).forEach(([o, c]) => g.addColorStop(o, c));
    t.fillStyle = g;
    t.fillRect(0, 0, canvas.width, canvas.height);
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
  <div v-if="pair" ref="viewer" class="ugrv" :class="[`ugrv-m-${settings.mode}`, { 'ugrv-in': active }]" :style="{ '--ugrv-x': `${x}px`, '--ugrv-y': `${y}px`, '--ugrv-size': `${settings.size}px`, '--ugrv-soft': `${settings.softness}%` }" @pointerenter="show" @pointerdown="show" @pointermove="move" @pointerleave="hide" @pointercancel="hide" @pointerup="onUp" @wheel.prevent="onWheel" @mousedown="onDown" @dblclick="onDblClick" @dragstart.prevent>
    <div ref="stage" class="stage">
      <img class="ugrv-a" :src="pair.base" alt="底图">
      <img class="ugrv-b" :src="pair.hover" alt="对比图" :style="{ webkitMaskImage: maskCSS(settings.mode), maskImage: maskCSS(settings.mode) }">
    </div>
    <div class="ugrv-ring" :style="ringStyle" />
    <div class="toolbar">
      <button v-if="groups.length > 1" @click.stop="navGroup(-1)">
        ‹
      </button>
      <span v-if="groups.length > 1" class="counter">{{ gIdx + 1 }}/{{ groups.length }}</span>
      <button v-if="groups.length > 1" @click.stop="navGroup(1)">
        ›
      </button>
      <template v-if="group && group.hovers.length > 1">
        <button @click.stop="navHover(-1)">
          ▲
        </button>
        <span class="counter">{{ hIdx + 1 }}/{{ group.hovers.length }}</span>
        <button @click.stop="navHover(1)">
          ▼
        </button>
      </template>
      <button @click.stop="openFolder">
        文件夹
      </button>
      <button @click.stop="pick('base')">
        换底图
      </button>
      <button @click.stop="pick('hover')">
        换对比图
      </button>
      <button @click.stop="showSettings = !showSettings">
        设置
      </button>
    </div>
  </div>

  <div v-else class="picker">
    <h1>图片对比查看</h1>
    <p>选两张图,鼠标悬停处用手电筒光圈透出对比图。</p>
    <p class="hint">
      或打开文件夹批量对比:原图带标记(默认后缀 "_原"),不带标记的自动作为它的 hover 图。
    </p>
    <button v-if="needRestore" class="restore" @click="grantRestore">
      恢复上次的文件夹
    </button>
    <p v-if="noMatch" class="warn">
      这个文件夹里没有配到对:确认设置里的"原图标记"与文件名前缀一致(默认 原-),且每张原图至少有一张不带标记的产出。
    </p>
    <div class="slots">
      <button class="slot" @click="pick('base')">
        <img v-if="pair && pair.base" :src="pair.base" alt="底图预览">
        <span v-else>选择底图</span>
      </button>
      <button class="slot big" @click="openFolder">
        <span>打开文件夹</span>
      </button>
      <button class="slot" @click="pick('hover')">
        <img v-if="pair && pair.hover" :src="pair.hover" alt="对比图预览">
        <span v-else>选择对比图</span>
      </button>
    </div>
  </div>

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
/* 放大镜:藏光标,用可见圆环代替 */
.ugrv-m-lens {
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
.ugrv-m-lens.ugrv-in .ugrv-ring {
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

/* 选择页 */
.picker {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  min-height: 100dvh;
  color: #fff;
  font-family: system-ui, sans-serif;
}
.picker h1 {
  margin: 0;
  font-size: 24px;
}
.picker p {
  margin: 0;
  opacity: 0.7;
}
.picker .hint {
  font-size: 13px;
  opacity: 0.5;
}
.picker .warn {
  margin: 0;
  max-width: 560px;
  font-size: 13px;
  color: #ffb84d;
  text-align: center;
}
.slots {
  display: flex;
  gap: 24px;
}
.slot {
  width: 260px;
  height: 180px;
  border: 2px dashed rgba(255, 255, 255, 0.35);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.05);
  color: inherit;
  font: 600 15px system-ui, sans-serif;
  cursor: pointer;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.slot.big {
  border-color: rgba(74, 108, 247, 0.7);
  color: #9db1ff;
}
.slot:hover {
  border-color: rgba(255, 255, 255, 0.7);
}
.slot img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.restore {
  padding: 8px 20px;
  border: none;
  border-radius: 999px;
  background: #4a6cf7;
  color: #fff;
  font: 600 14px system-ui, sans-serif;
  cursor: pointer;
}

/* 查看器角落的工具栏 */
.toolbar {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 4;
  display: flex;
  gap: 8px;
  align-items: center;
}
.toolbar button {
  padding: 6px 12px;
  border: none;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.42);
  color: #fff;
  font: 600 12px system-ui, sans-serif;
  cursor: pointer;
}
.toolbar .counter {
  padding: 6px 4px;
  color: #fff;
  font: 700 12px system-ui, sans-serif;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
}
</style>
