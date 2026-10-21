<script setup>
// 手电筒对比:底图铺满,hover 图在上层用 radial-gradient 圆形遮罩跟随指针(延迟 0),
// 圈内透出 hover 图。支持文件夹批対:按"原图标记"(前缀/后缀)配对,←/→ 翻对。
// 目录句柄存 IndexedDB,刷新后可一键恢复(浏览器要求重新授权必须有一次用户点击)。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import SettingsPanel from './SettingsPanel.vue';
import { settings } from './settings';

const pairs = ref([]); // [{ base, hover }] objectURL
const current = ref(0);
const pair = computed(() => pairs.value[current.value]);
const showSettings = ref(false);
const needRestore = ref(false);
const viewer = ref(null);

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif']);

function revokePair(p) {
  URL.revokeObjectURL(p.base);
  URL.revokeObjectURL(p.hover);
}

// ===== 单独换图:替换当前对的某一侧 =====
async function pick(key) {
  const [handle] = await window.showOpenFilePicker({
    types: [{ description: '图片', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'] } }],
  });
  const url = URL.createObjectURL(await handle.getFile());
  if (!pair.value) {
    pairs.value = [{ base: '', hover: '' }];
    current.value = 0;
  }
  if (pair.value[key]) URL.revokeObjectURL(pair.value[key]);
  pair.value[key] = url;
}

// ===== 文件夹批対 =====
const dirHandle = ref(null);

// 文件名(去扩展名)按标记分角色:带标记=原图,不带=hover;去掉标记后相同视为一对
function pairUp(names) {
  const m = settings.matchStr;
  const byRoot = new Map();
  for (const name of names) {
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    if (dot > 0 && !IMAGE_EXTS.has(name.slice(dot + 1).toLowerCase())) continue;
    const marked = settings.matchMode === 'prefix' ? stem.startsWith(m) : stem.endsWith(m);
    const root = marked
      ? (settings.matchMode === 'prefix' ? stem.slice(m.length) : stem.slice(0, -m.length))
      : stem;
    if (!root) continue;
    const slot = byRoot.get(root) || {};
    slot[marked ? 'baseName' : 'hoverName'] = name;
    byRoot.set(root, slot);
  }
  return [...byRoot.values()].filter(s => s.baseName && s.hoverName);
}

async function scanDir(dir) {
  const names = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file') names.push(name);
  }
  const list = [];
  for (const { baseName, hoverName } of pairUp(names)) {
    list.push({
      base: URL.createObjectURL(await dir.getFileHandle(baseName).then(h => h.getFile())),
      hover: URL.createObjectURL(await dir.getFileHandle(hoverName).then(h => h.getFile())),
    });
  }
  pairs.value.forEach(revokePair);
  pairs.value = list;
  current.value = 0;
}

async function openFolder() {
  const dir = await window.showDirectoryPicker({ mode: 'read' });
  await idbSet('dir', dir);
  dirHandle.value = dir;
  needRestore.value = false;
  await scanDir(dir);
}

// 刷新后恢复:目录句柄已授权则直接扫描,否则等用户点"恢复"
async function restore() {
  const dir = await idbGet('dir');
  if (!dir) return;
  dirHandle.value = dir;
  if (await dir.queryPermission({ mode: 'read' }) !== 'granted') {
    needRestore.value = true;
    return;
  }
  await scanDir(dir);
}
async function grantRestore() {
  const dir = dirHandle.value;
  if (dir && await dir.requestPermission({ mode: 'read' }) === 'granted') await scanDir(dir);
  needRestore.value = false;
}

// 标记设置变了自动重扫(输入防抖)
let rescanTimer = null;
watch(() => [settings.matchMode, settings.matchStr], () => {
  if (!dirHandle.value) return;
  clearTimeout(rescanTimer);
  rescanTimer = setTimeout(() => scanDir(dirHandle.value), 300);
});

// --- 最小 IndexedDB 存取(只存目录句柄) ---
function idb() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('img-hover-reveal', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function idbSet(key, val) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(val, key);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((res, rej) => {
    const rq = db.transaction('handles').objectStore('handles').get(key);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}

// ===== 翻对 =====
function nav(d) {
  if (pairs.value.length < 2) return;
  current.value = (current.value + d + pairs.value.length) % pairs.value.length;
}
function onKey(e) {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (e.key === 'ArrowLeft') nav(-1);
  if (e.key === 'ArrowRight') nav(1);
}

// ===== 光圈/缩放/平移 =====
const x = ref(0);
const y = ref(0);
const active = ref(false);

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;
const ZOOM_STEP = 0.1;
const scale = ref(1);
const pointX = ref(0);
const pointY = ref(0);
const stage = ref(null);

function applyTransform() {
  const el = stage.value;
  if (!el) return;
  el.style.scale = scale.value;
  el.style.translate = `${pointX.value}px ${pointY.value}px`;
}

// 指针位置 → stage 未变换局部坐标(遮罩渐变在局部空间,transform 后要折算回来)
function toLocal(e) {
  const el = stage.value;
  const r = el.getBoundingClientRect();
  return {
    x: (e.clientX - r.left - r.width / 2) / scale.value + el.clientWidth / 2,
    y: (e.clientY - r.top - r.height / 2) / scale.value + el.clientHeight / 2,
  };
}

let queued = false;
function apply(e) {
  queued = false;
  const p = toLocal(e);
  x.value = p.x;
  y.value = p.y;
}
function move(e) {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => apply(e));
}
function show(e) {
  move(e);
  active.value = true;
}
function hide() {
  active.value = false;
}
function onUp() {
  // 触屏:抬手即收起光圈
  if (window.matchMedia('(hover:none)').matches) hide();
}

function onWheel(e) {
  e.preventDefault();
  const ratio = 1 + (e.deltaY > 0 ? -1 : 1) * ZOOM_STEP;
  const newScale = scale.value * ratio;
  if (newScale < MIN_SCALE || newScale > MAX_SCALE) return;
  const r = stage.value.getBoundingClientRect();
  // 以鼠标为中心:先把该点平移补偿回来再缩放
  pointX.value -= (e.clientX - r.left - r.width / 2) * (ratio - 1);
  pointY.value -= (e.clientY - r.top - r.height / 2) * (ratio - 1);
  scale.value = newScale;
  applyTransform();
}

// 拖拽平移(5px 阈值)
let panning = false;
let panStartX = 0;
let panStartY = 0;
function onDown(e) {
  if (e.button !== 0) return;
  if (e.target.closest('button')) return;
  e.preventDefault();
  panning = true;
  panStartX = e.clientX - pointX.value;
  panStartY = e.clientY - pointY.value;
  viewer.value.style.cursor = 'grabbing';
}
function onPanMove(e) {
  if (!panning) return;
  if (Math.hypot(e.clientX - (panStartX + pointX.value), e.clientY - (panStartY + pointY.value)) < 5) return;
  pointX.value = e.clientX - panStartX;
  pointY.value = e.clientY - panStartY;
  applyTransform();
}
function onPanUp() {
  if (!panning) return;
  panning = false;
  viewer.value.style.cursor = '';
}
function onDblClick() {
  scale.value = 1;
  pointX.value = 0;
  pointY.value = 0;
  applyTransform();
}

// 放大镜圆环:遮罩坐标在 stage 局部空间,圆环挂在外层不吃 transform,
// 位置/大小要按当前 scale/translate 换算回屏幕坐标(toLocal 的逆运算)
const ringStyle = computed(() => {
  const el = viewer.value;
  if (!el) return {};
  const w = el.clientWidth;
  const h = el.clientHeight;
  const cx = w / 2 + pointX.value + (x.value - w / 2) * scale.value;
  const cy = h / 2 + pointY.value + (y.value - h / 2) * scale.value;
  const r = (active.value ? settings.size : 0) * scale.value * 0.78;
  return { left: `${cx - r}px`, top: `${cy - r}px`, width: `${r * 2}px`, height: `${r * 2}px` };
});

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
  pairs.value.forEach(revokePair);
});
</script>

<template>
  <div v-if="pair" ref="viewer" class="ugrv" :class="['ugrv-m-' + settings.mode, { 'ugrv-in': active }]" :style="{ '--ugrv-x': x + 'px', '--ugrv-y': y + 'px', '--ugrv-size': settings.size + 'px', '--ugrv-soft': settings.softness + '%' }" @pointerenter="show" @pointerdown="show" @pointermove="move" @pointerleave="hide" @pointercancel="hide" @pointerup="onUp" @wheel.prevent="onWheel" @mousedown="onDown" @dblclick="onDblClick">
    <div ref="stage" class="stage">
      <img class="ugrv-a" :src="pair.base" alt="底图" />
      <img class="ugrv-b" :src="pair.hover" alt="对比图" />
    </div>
    <span class="ugrv-lab ugrv-lab-a">底图</span>
    <span class="ugrv-lab ugrv-lab-b">对比图</span>
    <div class="ugrv-ring" :style="ringStyle" />
    <div class="toolbar">
      <button v-if="pairs.length > 1" @click.stop="nav(-1)">‹</button>
      <span v-if="pairs.length > 1" class="counter">{{ current + 1 }}/{{ pairs.length }}</span>
      <button v-if="pairs.length > 1" @click.stop="nav(1)">›</button>
      <button @click.stop="openFolder">文件夹</button>
      <button @click.stop="pick('base')">换底图</button>
      <button @click.stop="pick('hover')">换对比图</button>
      <button @click.stop="showSettings = !showSettings">设置</button>
    </div>
  </div>

  <div v-else class="picker">
    <h1>图片对比查看</h1>
    <p>选两张图,鼠标悬停处用手电筒光圈透出对比图。</p>
    <p class="hint">或打开文件夹批量对比:原图带标记(默认后缀 "_原"),不带标记的自动作为它的 hover 图。</p>
    <button v-if="needRestore" class="restore" @click="grantRestore">恢复上次的文件夹</button>
    <div class="slots">
      <button class="slot" @click="pick('base')">
        <img v-if="pair && pair.base" :src="pair.base" alt="底图预览" />
        <span v-else>选择底图</span>
      </button>
      <button class="slot big" @click="openFolder">
        <span>打开文件夹</span>
      </button>
      <button class="slot" @click="pick('hover')">
        <img v-if="pair && pair.hover" :src="pair.hover" alt="对比图预览" />
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
/* 四种模式的光圈形状(跟随延迟均为 0):torch/brush 三站羽化,softness 管中点;spotlight/lens 两站硬边 */
.ugrv-m-torch .ugrv-b {
  -webkit-mask-image: radial-gradient(circle var(--ugrv-r) at var(--ugrv-x) var(--ugrv-y), #000 16%, rgba(0, 0, 0, 0.55) var(--ugrv-soft), transparent 100%);
  mask-image: radial-gradient(circle var(--ugrv-r) at var(--ugrv-x) var(--ugrv-y), #000 16%, rgba(0, 0, 0, 0.55) var(--ugrv-soft), transparent 100%);
}
.ugrv-m-brush .ugrv-b {
  -webkit-mask-image: radial-gradient(circle var(--ugrv-r) at var(--ugrv-x) var(--ugrv-y), #000 40%, rgba(0, 0, 0, 0.6) var(--ugrv-soft), transparent 100%);
  mask-image: radial-gradient(circle var(--ugrv-r) at var(--ugrv-x) var(--ugrv-y), #000 40%, rgba(0, 0, 0, 0.6) var(--ugrv-soft), transparent 100%);
}
.ugrv-m-spotlight .ugrv-b,
.ugrv-m-lens .ugrv-b {
  -webkit-mask-image: radial-gradient(circle var(--ugrv-r) at var(--ugrv-x) var(--ugrv-y), #000 72%, transparent 78%);
  mask-image: radial-gradient(circle var(--ugrv-r) at var(--ugrv-x) var(--ugrv-y), #000 72%, transparent 78%);
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
.ugrv-lab {
  position: absolute;
  left: 50%;
  inset: auto auto 12px;
  transform: translateX(-50%);
  z-index: 4;
  padding: 6px 10px;
  border-radius: 999px;
  font: 700 12px system-ui, sans-serif;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #ffffff;
  background: rgba(0, 0, 0, 0.42);
  pointer-events: none;
}
.ugrv-lab-b {
  opacity: 0;
}
.ugrv:hover .ugrv-lab-a,
.ugrv.ugrv-in .ugrv-lab-a {
  opacity: 0;
}
.ugrv:hover .ugrv-lab-b,
.ugrv.ugrv-in .ugrv-lab-b {
  opacity: 1;
}
@media (hover: none) {
  .ugrv .ugrv-lab {
    opacity: 1;
  }
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
