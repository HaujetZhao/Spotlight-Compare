<script setup>
// 手电筒对比:底图铺满,hover 图在上层用 radial-gradient 圆形遮罩跟随指针,
// 圈内透出 hover 图。逻辑与原 image-hover-reveal.html 一致,图片改为本地选择,
// 文件句柄存 IndexedDB,刷新后可一键恢复(浏览器要求恢复授权必须有一次用户点击)。
import { onBeforeUnmount, onMounted, ref } from 'vue';

const KEYS = ['base', 'hover'];
const baseImage = ref('');
const hoverImage = ref('');
const images = { base: baseImage, hover: hoverImage };
const needRestore = ref(false);
const viewer = ref(null);

const x = ref(0);
const y = ref(0);
const active = ref(false);

let queued = false;
function apply(e) {
  queued = false;
  const r = viewer.value.getBoundingClientRect();
  x.value = e.clientX - r.left;
  y.value = e.clientY - r.top;
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

// --- 最小 IndexedDB 存取(只存两个文件句柄) ---
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

function setImage(key, url) {
  if (images[key].value) URL.revokeObjectURL(images[key].value);
  images[key].value = url;
}
async function loadHandle(key, handle) {
  if (await handle.queryPermission({ mode: 'read' }) !== 'granted') return false;
  setImage(key, URL.createObjectURL(await handle.getFile()));
  return true;
}

async function pick(key) {
  if (window.showOpenFilePicker) {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: '图片', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'] } }],
    });
    await idbSet(key, handle);
    await loadHandle(key, handle);
    return;
  }
  // 无 File System Access API 的浏览器退回 <input>,不做持久化
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => {
    const file = input.files[0];
    if (file) setImage(key, URL.createObjectURL(file));
  };
  input.click();
}

// 刷新后恢复:已授权的句柄直接加载;需授权的等待用户点"恢复"
async function restore() {
  let blocked = false;
  for (const key of KEYS) {
    const handle = await idbGet(key);
    if (handle && !(await loadHandle(key, handle))) blocked = true;
  }
  needRestore.value = blocked;
}
async function grantRestore() {
  for (const key of KEYS) {
    const handle = await idbGet(key);
    if (handle && (await handle.requestPermission({ mode: 'read' })) === 'granted') await loadHandle(key, handle);
  }
  needRestore.value = false;
}
onMounted(restore);

onBeforeUnmount(() => {
  for (const key of KEYS) {
    if (images[key].value) URL.revokeObjectURL(images[key].value);
  }
});
</script>

<template>
  <div v-if="baseImage && hoverImage" ref="viewer" class="ugrv" :class="{ 'ugrv-in': active }" :style="{ '--ugrv-x': x + 'px', '--ugrv-y': y + 'px' }" @pointerenter="show" @pointerdown="show" @pointermove="move" @pointerleave="hide" @pointercancel="hide" @pointerup="onUp">
    <img class="ugrv-a" :src="baseImage" alt="底图" />
    <img class="ugrv-b" :src="hoverImage" alt="对比图" />
    <span class="ugrv-lab ugrv-lab-a">底图</span>
    <span class="ugrv-lab ugrv-lab-b">对比图</span>
    <div class="toolbar">
      <button @click.stop="pick('base')">换底图</button>
      <button @click.stop="pick('hover')">换对比图</button>
    </div>
  </div>

  <div v-else class="picker">
    <h1>图片对比查看</h1>
    <p>选两张图,鼠标悬停处用手电筒光圈透出对比图。</p>
    <button v-if="needRestore" class="restore" @click="grantRestore">恢复上次的图片</button>
    <div class="slots">
      <button class="slot" @click="pick('base')">
        <img v-if="baseImage" :src="baseImage" alt="底图预览" />
        <span v-else>选择底图</span>
      </button>
      <button class="slot" @click="pick('hover')">
        <img v-if="hoverImage" :src="hoverImage" alt="对比图预览" />
        <span v-else>选择对比图</span>
      </button>
    </div>
  </div>
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
  position: relative;
  width: 100vw;
  height: 100dvh;
  overflow: hidden;
  cursor: crosshair;
  user-select: none;
  transition: --ugrv-r 0.7s cubic-bezier(0.22, 0.68, 0, 1), --ugrv-x 0.07s linear, --ugrv-y 0.07s linear;
}
.ugrv.ugrv-in {
  --ugrv-r: var(--ugrv-size);
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
  -webkit-mask-image: radial-gradient(circle var(--ugrv-r) at var(--ugrv-x) var(--ugrv-y), #000 16%, rgba(0, 0, 0, 0.55) 56%, transparent 100%);
  mask-image: radial-gradient(circle var(--ugrv-r) at var(--ugrv-x) var(--ugrv-y), #000 16%, rgba(0, 0, 0, 0.55) 56%, transparent 100%);
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
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
  transition: opacity 0.7s ease;
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

/* 查看器角落的换图按钮 */
.toolbar {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 4;
  display: flex;
  gap: 8px;
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
</style>
