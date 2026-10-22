// 文件夹批量配对:按"原图标记"(前缀/后缀)把目录文件配成组(一张原图 + 若干产出),
// 维护 groups/gIdx/hIdx 与翻页;目录句柄存 IndexedDB,刷新后一键恢复(重新授权需一次用户点击)。
import { computed, ref, watch } from 'vue';
import { settings } from '../settings';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif']);

function revokeGroup(g) {
  URL.revokeObjectURL(g.base);
  g.hovers.forEach(URL.revokeObjectURL);
}

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

export function useDirPairing() {
  const groups = ref([]); // [{ base, hovers: [url], baseName, hoverNames }]
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
  const needRestore = ref(false);
  const noMatch = ref(false);
  const dirHandle = ref(null);

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

  // ===== 拼接图:单张左右拼接图裁成两半,当作普通一对走全流程 =====
  // 两半都裁成 floor(w/2) 宽保证 1:1 对应(奇数宽丢最右一列);PNG 编码无损
  async function pickStitched() {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: '图片', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'] } }],
    });
    const bmp = await createImageBitmap(await handle.getFile());
    const half = Math.floor(bmp.width / 2);
    const cut = async (sx) => {
      const c = document.createElement('canvas');
      c.width = half;
      c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, sx, 0, half, bmp.height, 0, 0, half, bmp.height);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      return URL.createObjectURL(blob);
    };
    const [left, right] = await Promise.all([cut(0), cut(half)]);
    bmp.close();
    groups.value.forEach(revokeGroup);
    const stem = stemOf(handle.name);
    groups.value = [{ base: left, hovers: [right], baseName: `${stem}(左).png`, hoverNames: [`${stem}(右).png`] }];
    gIdx.value = 0;
    hIdx.value = 0;
  }

  // 互换底图与当前产出(Tab):拼接图原图在右边时用
  function swapPair() {
    const g = group.value;
    if (!g)
      return;
    const i = hIdx.value;
    [g.base, g.hovers[i]] = [g.hovers[i], g.base];
    [g.baseName, g.hoverNames[i]] = [g.hoverNames[i], g.baseName];
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

  function dispose() {
    groups.value.forEach(revokeGroup);
  }

  return { groups, gIdx, hIdx, group, pair, needRestore, noMatch, pick, pickStitched, swapPair, openFolder, restore, grantRestore, navGroup, navHover, dispose };
}
