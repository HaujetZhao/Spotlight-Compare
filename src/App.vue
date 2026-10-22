<script setup>
// 手电筒对比:底图铺满,hover 图在上层用 radial-gradient 圆形遮罩跟随指针(延迟 0),
// 圈内透出 hover 图。支持文件夹批対:按"原图标记"(前缀/后缀)配对,←/→ 翻对。
// 目录句柄存 IndexedDB,刷新后可一键恢复(浏览器要求重新授权必须有一次用户点击)。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { settings } from './settings';
import SettingsPanel from './SettingsPanel.vue';

const groups = ref([]); // [{ base, hovers: [url] }]
const gIdx = ref(0);
const hIdx = ref(0);
const group = computed(() => groups.value[gIdx.value]);
// 当前对:产出取组内第 hIdx 张(默认第一张)
const pair = computed(() => {
  const g = group.value;
  if (!g)
    return null;
  return { base: g.base, hover: g.hovers[hIdx.value] ?? g.hovers[0] };
});
const showSettings = ref(false);
const needRestore = ref(false);
const noMatch = ref(false);
const viewer = ref(null);

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif']);

function revokeGroup(g) {
  URL.revokeObjectURL(g.base);
  g.hovers.forEach(URL.revokeObjectURL);
}

// ===== 单独换图:替换当前组的原图 / 当前选中那张产出 =====
async function pick(key) {
  const [handle] = await window.showOpenFilePicker({
    types: [{ description: '图片', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'] } }],
  });
  const url = URL.createObjectURL(await handle.getFile());
  if (!group.value) {
    groups.value = [{ base: '', hovers: [''], baseName: '', hoverNames: [''] }];
    gIdx.value = 0;
    hIdx.value = 0;
  }
  if (key === 'base') {
    if (group.value.base)
      URL.revokeObjectURL(group.value.base);
    group.value.base = url;
    group.value.baseName = handle.name;
  }
  else {
    const old = group.value.hovers[hIdx.value];
    if (old)
      URL.revokeObjectURL(old);
    group.value.hovers[hIdx.value] = url;
    group.value.hoverNames[hIdx.value] = handle.name;
  }
}

// ===== 文件夹批対 =====
const dirHandle = ref(null);

// 文件名主干:去扩展名、去掉任意位置的括号及其内容(备注/批量重命名序号)、末尾空格
function stemOf(name) {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return stem.replace(/\s*\([^)]*\)/g, '').trimEnd();
}

// 按标记分角色分组:带原图标记=原图(每根至多一张),不带=产出;同根全部产出归一组
function pairUp(names) {
  const m = settings.matchStr;
  const byRoot = new Map();
  for (const name of names) {
    const stem = stemOf(name);
    if (/\.\w+$/.test(name) && !IMAGE_EXTS.has(name.slice(name.lastIndexOf('.') + 1).toLowerCase()))
      continue;
    const marked = settings.matchMode === 'prefix' ? stem.startsWith(m) : stem.endsWith(m);
    const root = marked
      ? (settings.matchMode === 'prefix' ? stem.slice(m.length) : stem.slice(0, -m.length))
      : stem;
    if (!root)
      continue;
    const slot = byRoot.get(root) || { baseName: '', hoverNames: [] };
    if (marked)
      slot.baseName = name;
    else slot.hoverNames.push(name);
    byRoot.set(root, slot);
  }
  return [...byRoot.values()].filter(s => s.baseName && s.hoverNames.length).sort((a, b) => a.baseName.localeCompare(b.baseName));
}

async function scanDir(dir) {
  const names = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file')
      names.push(name);
  }
  const list = [];
  for (const { baseName, hoverNames } of pairUp(names)) {
    list.push({
      base: URL.createObjectURL(await dir.getFileHandle(baseName).then(h => h.getFile())),
      hovers: await Promise.all(hoverNames.sort().map(n => dir.getFileHandle(n).then(h => h.getFile()).then(URL.createObjectURL))),
      baseName,
      hoverNames: [...hoverNames].sort(), // 与 hovers 一一对应,导出时取作文件名
    });
  }
  groups.value.forEach(revokeGroup);
  groups.value = list;
  gIdx.value = 0;
  hIdx.value = 0;
  noMatch.value = list.length === 0;
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
  if (!dir)
    return;
  dirHandle.value = dir;
  if (await dir.queryPermission({ mode: 'read' }) !== 'granted') {
    needRestore.value = true;
    return;
  }
  await scanDir(dir);
}
async function grantRestore() {
  const dir = dirHandle.value;
  if (dir && await dir.requestPermission({ mode: 'read' }) === 'granted')
    await scanDir(dir);
  needRestore.value = false;
}

// 标记设置变了自动重扫(输入防抖)
let rescanTimer = null;
watch(() => [settings.matchMode, settings.matchStr], () => {
  if (!dirHandle.value)
    return;
  clearTimeout(rescanTimer);
  rescanTimer = setTimeout(scanDir, 300, dirHandle.value);
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

// ===== 翻页:↑/↓ 换组(原图),←/→ 换组内产出 =====
function navGroup(d) {
  if (groups.value.length < 2)
    return;
  gIdx.value = (gIdx.value + d + groups.value.length) % groups.value.length;
  hIdx.value = 0; // 切组重置到第一张产出
}
function navHover(d) {
  const n = group.value?.hovers.length ?? 0;
  if (n < 2)
    return;
  hIdx.value = (hIdx.value + d + n) % n;
}
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
  if (!el)
    return;
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
  if (queued)
    return;
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
  if (window.matchMedia('(hover:none)').matches)
    hide();
}

// 拖拽平移(5px 阈值)
let panning = false;
let panStartX = 0;
let panStartY = 0;

function onWheel(e) {
  e.preventDefault();
  if (e.ctrlKey || panning) {
    // Ctrl+滚轮 / 左键按住时滚轮:调光圈大小(替代浏览器页面缩放)
    settings.size = Math.max(50, Math.min(400, settings.size + (e.deltaY > 0 ? -10 : 10)));
    return;
  }
  const ratio = 1 + (e.deltaY > 0 ? -1 : 1) * ZOOM_STEP;
  const newScale = scale.value * ratio;
  if (newScale < MIN_SCALE || newScale > MAX_SCALE)
    return;
  const r = stage.value.getBoundingClientRect();
  // 以鼠标为中心:先把该点平移补偿回来再缩放
  pointX.value -= (e.clientX - r.left - r.width / 2) * (ratio - 1);
  pointY.value -= (e.clientY - r.top - r.height / 2) * (ratio - 1);
  scale.value = newScale;
  applyTransform();
}

function onDown(e) {
  if (e.button !== 0)
    return;
  if (e.target.closest('button'))
    return;
  e.preventDefault();
  panning = true;
  panStartX = e.clientX - pointX.value;
  panStartY = e.clientY - pointY.value;
  viewer.value.style.cursor = 'grabbing';
}
function onPanMove(e) {
  if (!panning)
    return;
  if (Math.hypot(e.clientX - (panStartX + pointX.value), e.clientY - (panStartY + pointY.value)) < 5)
    return;
  pointX.value = e.clientX - panStartX;
  pointY.value = e.clientY - panStartY;
  applyTransform();
}
function onPanUp() {
  if (!panning)
    return;
  panning = false;
  viewer.value.style.cursor = '';
}
function onDblClick() {
  scale.value = 1;
  pointX.value = 0;
  pointY.value = 0;
  applyTransform();
}

// 各模式光圈的渐变站点(与 CSS 遮罩一致;torch/brush 的柔和度实时读)
function maskStops() {
  if (settings.mode === 'torch')
    return [[0, '#000'], [0.16, '#000'], [settings.softness / 100, 'rgba(0,0,0,0.55)'], [1, 'rgba(0,0,0,0)']];
  if (settings.mode === 'brush')
    return [[0, '#000'], [0.4, '#000'], [settings.softness / 100, 'rgba(0,0,0,0.6)'], [1, 'rgba(0,0,0,0)']];
  return [[0, '#000'], [0.72, '#000'], [0.78, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0)']];
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
    maskStops().forEach(([o, c]) => g.addColorStop(o, c));
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

// Ctrl+E:当前一对图导出为内嵌 base64 的单文件 HTML。
// 缩水版效果页:光圈跟随 + 滚轮缩放(以鼠标为中心) + 拖拽平移 + Ctrl+滚轮调光圈 + 双击复位,
// 以及与 App 相同的热键(1-4 切模式、[ ] , . 调光圈、Ctrl+S 下载、Ctrl+C 复制)。
// transform-origin 固定 0 0,光圈坐标按 (屏幕-平移)/缩放 折算回局部空间。
// 四模式渐变站点在导出页里是一张表,canvas 合成与 CSS 遮罩共用,柔和度/格式/质量在导出时烘焙。
// 内嵌图片先按面板格式/质量重编码压缩(JPEG 无 alpha,垫白底),再转 dataURL
async function toDataURL(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (settings.exportFormat === 'jpeg') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0);
  const blob = await new Promise(r => canvas.toBlob(r, `image/${settings.exportFormat}`, settings.exportQuality));
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

// 遮罩渐变与 App 内四种模式的 CSS 一致,当前柔和度/模式烘焙进导出文件
function exportMask() {
  const s = settings.softness;
  if (settings.mode === 'brush')
    return `radial-gradient(circle var(--ugrv-r) at var(--ugrv-x) var(--ugrv-y), #000 40%, rgba(0,0,0,.6) ${s}%, transparent 100%)`;
  if (settings.mode === 'spotlight' || settings.mode === 'lens')
    return 'radial-gradient(circle var(--ugrv-r) at var(--ugrv-x) var(--ugrv-y), #000 72%, transparent 78%)';
  return `radial-gradient(circle var(--ugrv-r) at var(--ugrv-x) var(--ugrv-y), #000 16%, rgba(0,0,0,.55) ${s}%, transparent 100%)`;
}

async function exportHtml() {
  if (!pair.value)
    return;
  const name = (group.value?.hoverNames?.[hIdx.value] || group.value?.baseName || '对比').replace(/\.\w+$/, '');
  const [a, b] = await Promise.all([toDataURL(pair.value.base), toDataURL(pair.value.hover)]);
  const mask = exportMask();
  const cursor = settings.mode === 'lens' ? 'none' : 'crosshair';
  const html = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title>
<style>
@property --ugrv-r{syntax:"<length>";inherits:true;initial-value:0px}
body{margin:0;height:100dvh;background:#0b1020;overflow:hidden}
.ugrv{position:relative;width:100vw;height:100dvh;overflow:hidden;user-select:none;cursor:${cursor};--ugrv-size:${settings.size}px;touch-action:none}
.stage{position:absolute;inset:0;transform-origin:0 0}
.ugrv img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block}
.ugrv-a{z-index:1}
.ugrv-b{z-index:2;-webkit-mask-image:${mask};mask-image:${mask};-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat}
.ugrv{--ugrv-r:0px}
.ugrv.ugrv-in{--ugrv-r:var(--ugrv-size)}
.ugrv-help{position:absolute;left:12px;bottom:12px;z-index:4;width:30px;height:30px;border:1px solid rgba(255,255,255,0.4);border-radius:50%;background:rgba(30,40,66,0.8);box-shadow:0 2px 8px rgba(0,0,0,0.4);color:#fff;font:700 15px system-ui,sans-serif;cursor:pointer}
.ugrv-help:hover{background:rgba(52,64,100,0.9)}
.ugrv-help-mask{position:absolute;inset:0;z-index:5;background:rgba(0,0,0,0.5);display:none;align-items:center;justify-content:center}
.ugrv-help-mask.ugrv-on{display:flex}
.ugrv-card{min-width:340px;padding:20px 26px;border:1px solid rgba(255,255,255,0.14);border-radius:14px;background:rgba(16,22,40,0.92);color:#fff}
.ugrv-card h3{margin:0 0 14px;font:600 14px system-ui,sans-serif;opacity:0.9}
.ugrv-card table{border-collapse:collapse;font:13px system-ui,sans-serif}
.ugrv-card td{padding:5px 0}
.ugrv-card td:first-child{padding-right:26px;white-space:nowrap}
.ugrv-card td:nth-child(3){padding-left:26px;white-space:nowrap}
.ugrv-card .act{opacity:0.7}
.ugrv-card kbd{display:inline-block;padding:1px 7px;border:1px solid rgba(255,255,255,0.25);border-radius:4px;background:rgba(255,255,255,0.1);font:11px/1.7 system-ui,sans-serif}
</style>
</head>
<body>
<div class="ugrv"><div class="stage"><img class="ugrv-a" src="${a}" alt="原图"><img class="ugrv-b" src="${b}" alt="对比图"></div>
<button class="ugrv-help">?</button>
<div class="ugrv-help-mask"><div class="ugrv-card"><h3>快捷键</h3><table>
<tr><td><kbd>滚轮</kbd></td><td class="act">缩放</td><td><kbd>1</kbd>-<kbd>4</kbd></td><td class="act">切换模式</td></tr>
<tr><td><kbd>拖拽</kbd></td><td class="act">平移</td><td><kbd>[</kbd> <kbd>]</kbd> <kbd>,</kbd> <kbd>.</kbd></td><td class="act">光圈大小</td></tr>
<tr><td><kbd>双击</kbd></td><td class="act">复位</td><td><kbd>Ctrl</kbd>+<kbd>S</kbd></td><td class="act">保存图片</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>滚轮</kbd></td><td class="act">光圈大小</td><td><kbd>Ctrl</kbd>+<kbd>C</kbd></td><td class="act">复制图片</td></tr>
</table></div></div>
</div>
<script>
(function(){
var el=document.querySelector('.ugrv'),bi=el.querySelector('.ugrv-b'),x=0,y=0,q=false,size=${settings.size},s=1,tx=0,ty=0,pan=false,px=0,py=0,mode='${settings.mode}',fmt='${settings.exportFormat}',quality=${settings.exportQuality};
var S=${settings.softness},stops={torch:[[0,'#000'],[0.16,'#000'],[S/100,'rgba(0,0,0,0.55)'],[1,'rgba(0,0,0,0)']],brush:[[0,'#000'],[0.4,'#000'],[S/100,'rgba(0,0,0,0.6)'],[1,'rgba(0,0,0,0)']],spotlight:[[0,'#000'],[0.72,'#000'],[0.78,'rgba(0,0,0,0)'],[1,'rgba(0,0,0,0)']]};
stops.lens=stops.spotlight;
function css(st){return 'radial-gradient(circle var(--ugrv-r) at var(--ugrv-x) var(--ugrv-y),'+st.map(function(p){return p[1]+' '+Math.round(p[0]*100)+'%'}).join(',')+')'}
function setMode(m){mode=m;var g=css(stops[m]);bi.style.webkitMaskImage=g;bi.style.maskImage=g;el.style.cursor=m==='lens'?'none':'crosshair'}
function apply(){q=false;el.style.setProperty('--ugrv-x',x+'px');el.style.setProperty('--ugrv-y',y+'px')}
function applyT(){el.querySelector('.stage').style.transform='translate('+tx+'px,'+ty+'px) scale('+s+')'}
function move(e){var r=el.getBoundingClientRect();x=(e.clientX-r.left-tx)/s;y=(e.clientY-r.top-ty)/s;if(!q){q=true;requestAnimationFrame(apply)}}
function show(e){move(e);el.classList.add('ugrv-in')}
function hide(){el.classList.remove('ugrv-in')}
function setSize(d){size=Math.max(50,Math.min(400,size+d));el.style.setProperty('--ugrv-size',size+'px')}
el.addEventListener('pointerenter',show);
el.addEventListener('pointerleave',function(){if(!pan)hide()});
el.addEventListener('pointerdown',function(e){if(e.button!==0)return;pan=true;px=e.clientX-tx;py=e.clientY-ty;show(e)});
el.addEventListener('pointermove',function(e){if(pan){tx=e.clientX-px;ty=e.clientY-py;applyT()}move(e)});
addEventListener('pointerup',function(){if(!pan)return;pan=false;if(matchMedia('(hover:none)').matches)hide()});
el.addEventListener('dblclick',function(){s=1;tx=0;ty=0;applyT()});
el.addEventListener('dragstart',function(e){e.preventDefault()});
el.addEventListener('wheel',function(e){
  e.preventDefault();
  if(e.ctrlKey||pan){setSize(-e.deltaY*0.1);return}
  var r=el.getBoundingClientRect(),k=e.deltaY>0?1/1.1:1.1,ns=Math.min(10,Math.max(0.1,s*k)),f=ns/s;
  var cx=e.clientX-r.left,cy=e.clientY-r.top;
  tx=cx-(cx-tx)*f;ty=cy-(cy-ty)*f;s=ns;applyT();move(e);
});
// 合成整图(原图分辨率):底图 + 光圈内透出的对比图;未 hover 即纯原图
function composite(){
  var a=el.querySelector('.ugrv-a');
  if(!a.naturalWidth)return null;
  var w=el.clientWidth,h=el.clientHeight;
  function fit(im){var k=Math.min(w/im.naturalWidth,h/im.naturalHeight),iw=im.naturalWidth*k,ih=im.naturalHeight*k;return[(w-iw)/2,(h-ih)/2,iw,ih]}
  var ra=fit(a),fitK=a.naturalWidth/ra[2];
  var c=document.createElement('canvas');c.width=a.naturalWidth;c.height=a.naturalHeight;
  var ctx=c.getContext('2d');ctx.drawImage(a,0,0);
  if(el.classList.contains('ugrv-in')){
    var rb=fit(bi),t=document.createElement('canvas');t.width=c.width;t.height=c.height;
    var tc=t.getContext('2d');
    tc.drawImage(bi,(rb[0]-ra[0])*fitK,(rb[1]-ra[1])*fitK,rb[2]*fitK,rb[3]*fitK);
    tc.globalCompositeOperation='destination-in';
    var mx=(x-ra[0])*fitK,my=(y-ra[1])*fitK,g=tc.createRadialGradient(mx,my,0,mx,my,size*fitK);
    stops[mode].forEach(function(p){g.addColorStop(p[0],p[1])});
    tc.fillStyle=g;tc.fillRect(0,0,c.width,c.height);
    ctx.drawImage(t,0,0);
  }
  return c;
}
function download(){
  var c=composite();if(!c)return;
  if(fmt==='jpeg'){var ctx=c.getContext('2d');ctx.globalCompositeOperation='destination-over';ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height)}
  c.toBlob(function(blob){var u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=document.title+'.'+fmt;a.click();setTimeout(function(){URL.revokeObjectURL(u)},1000)},'image/'+fmt,quality);
}
function copy(){
  var c=composite();if(!c)return;
  c.toBlob(function(blob){navigator.clipboard.write([new ClipboardItem({'image/png':blob})])});
}
var helpMask=el.querySelector('.ugrv-help-mask');
function toggleHelp(){helpMask.classList.toggle('ugrv-on')}
el.querySelector('.ugrv-help').addEventListener('click',toggleHelp);
helpMask.addEventListener('click',toggleHelp);
addEventListener('keydown',function(e){
  if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();download();return}
  if((e.ctrlKey||e.metaKey)&&e.key==='c'){e.preventDefault();copy();return}
  if(e.key==='?'){toggleHelp();return}
  if(e.key==='Escape'&&helpMask.classList.contains('ugrv-on')){toggleHelp();return}
  if(e.key>='1'&&e.key<='4'){setMode(['torch','brush','spotlight','lens'][e.key-1]);return}
  if(e.key==='['||e.key===',')setSize(-10);
  if(e.key===']'||e.key==='.')setSize(10);
});
})();
</${'script'}>
</body>
</html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const el = document.createElement('a');
  el.href = URL.createObjectURL(blob);
  el.download = `${name}.html`;
  el.click();
  setTimeout(() => URL.revokeObjectURL(el.href), 1000);
}

// 放大镜圆环:遮罩坐标在 stage 局部空间,圆环挂在外层不吃 transform,
// 位置/大小要按当前 scale/translate 换算回屏幕坐标(toLocal 的逆运算)
const ringStyle = computed(() => {
  const el = viewer.value;
  if (!el)
    return {};
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
  groups.value.forEach(revokeGroup);
});
</script>

<template>
  <div v-if="pair" ref="viewer" class="ugrv" :class="[`ugrv-m-${settings.mode}`, { 'ugrv-in': active }]" :style="{ '--ugrv-x': `${x}px`, '--ugrv-y': `${y}px`, '--ugrv-size': `${settings.size}px`, '--ugrv-soft': `${settings.softness}%` }" @pointerenter="show" @pointerdown="show" @pointermove="move" @pointerleave="hide" @pointercancel="hide" @pointerup="onUp" @wheel.prevent="onWheel" @mousedown="onDown" @dblclick="onDblClick" @dragstart.prevent>
    <div ref="stage" class="stage">
      <img class="ugrv-a" :src="pair.base" alt="底图">
      <img class="ugrv-b" :src="pair.hover" alt="对比图">
    </div>
    <span class="ugrv-lab ugrv-lab-a">底图</span>
    <span class="ugrv-lab ugrv-lab-b">对比图</span>
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
