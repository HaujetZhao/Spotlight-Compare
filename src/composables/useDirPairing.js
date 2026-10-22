// 文件夹批量配对:按"原图标记"(前缀/后缀)把目录文件配成组(一张原图 + 若干产出),
// 维护 groups/gIdx/hIdx 与翻页;目录句柄存 IndexedDB,刷新后一键恢复(重新授权需一次用户点击)。
import { computed, ref, watch } from 'vue';
import { idbGet, idbSet } from '../idb';
import { settings } from '../settings';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif']);
const IMAGE_TYPES = [{ description: '图片', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'] } }];
const VIDEO_TYPES = [{ description: '视频', accept: { 'video/*': ['.mp4', '.webm', '.mov', '.m4v'] } }];
// 图片和视频合成一个筛选项:分成两条会在对话框里出现两个类别
const MEDIA_TYPES = [{
  description: '图片或视频',
  accept: {
    'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'],
    'video/*': ['.mp4', '.webm', '.mov', '.m4v'],
  },
}];
// 文件类型不一定有 MIME(有些系统只给空 type),再看扩展名
const VIDEO_RE = /\.(?:mp4|webm|mov|m4v)$/i;
const isVideo = (file, name) => file.type.startsWith('video/') || VIDEO_RE.test(name);

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

// 拼接图拆半:裁成等宽 floor(w/2) 保证左右 1:1 对应(奇数宽丢最右一列),PNG 无损编码
async function cutHalves(file) {
  const bmp = await createImageBitmap(file);
  const half = Math.floor(bmp.width / 2);
  const cut = async (sx) => {
    const c = document.createElement('canvas');
    c.width = half;
    c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, sx, 0, half, bmp.height, 0, 0, half, bmp.height);
    return URL.createObjectURL(await new Promise(r => c.toBlob(r, 'image/png')));
  };
  const [left, right] = await Promise.all([cut(0), cut(half)]);
  bmp.close();
  return { left, right };
}

// --- 最小 IndexedDB kv 见 src/idb.js(handles 存目录句柄) ---

export function useDirPairing() {
  const groups = ref([]); // [{ base, hovers: [url], baseName, hoverNames }]
  const gIdx = ref(0);
  const hIdx = ref(0);
  const group = computed(() => groups.value[gIdx.value]);
  // 当前对:产出取组内第 hIdx 张(默认第一张);key 是方向性稳定标识(目录/底图名|产出名),
  // objectURL 刷新即失效,光圈钉等按对绑定的状态用它存取
  const dirHandle = ref(null);
  const pair = computed(() => {
    const g = group.value;
    if (!g)
      return null;
    const i = hIdx.value;
    return {
      base: g.base,
      hover: g.hovers[i] ?? g.hovers[0],
      key: `${dirHandle.value?.name ?? ''}/${g.baseName}|${g.hoverNames[i] ?? g.hoverNames[0]}`,
      kind: g.kind ?? 'image',
      stitched: !!g.stitched,
      // 视频对另带一份载入顺序的 srcs:Tab 互换只改角色(.ugrv-a/.ugrv-b 与静音),
      // 不重设 src——视频元素换 src 会重载,卡一下。拼接视频两半同源,靠 flipped 决定谁露左半。
      // 这里必须是快照:直接引用 g.vids 的话,换图后旧 pair 的 vids 也跟着变,
      // watch 里"同一组 src 不变 = Tab 互换"的判断就会误判
      vids: g.vids && [...g.vids],
      swapped: !!g.vids && (g.stitched ? !!g.flipped : g.base !== g.vids[0]),
    };
  });
  const needRestore = ref(false);
  const noMatch = ref(false);

  // ===== 单独换图/换视频:替换当前组的底图 / 当前选中那张对比 =====
  // 没有组时图/视频都能选,由选中的文件决定这对是什么;已有组则沿用组的类型
  async function pick(key) {
    const k = group.value?.kind;
    const [handle] = await window.showOpenFilePicker({ types: k === 'video' ? VIDEO_TYPES : k === 'image' ? IMAGE_TYPES : MEDIA_TYPES });
    const file = await handle.getFile();
    const url = URL.createObjectURL(file);
    if (!group.value) {
      groups.value = [isVideo(file, handle.name)
        ? { kind: 'video', vids: ['', ''], base: '', hovers: [''], baseName: '', hoverNames: [''] }
        : { base: '', hovers: [''], baseName: '', hoverNames: [''] }];
      gIdx.value = 0;
      hIdx.value = 0;
    }
    if (key === 'base') {
      if (group.value.base)
        URL.revokeObjectURL(group.value.base);
      group.value.base = url;
      group.value.baseName = handle.name;
      if (group.value.vids)
        group.value.vids[0] = url;
    }
    else {
      const old = group.value.hovers[hIdx.value];
      if (old)
        URL.revokeObjectURL(old);
      group.value.hovers[hIdx.value] = url;
      group.value.hoverNames[hIdx.value] = handle.name;
      if (group.value.vids)
        group.value.vids[1] = url;
    }
  }

  // ===== 拼接图/拼接视频:一张左右拼接的图,或一段左右拼接的视频 =====
  // 图裁成两半;视频不拆不重编码,两槽共用同一个 objectURL,viewer 渲染时各裁半边
  async function pickStitched() {
    const [handle] = await window.showOpenFilePicker({ types: MEDIA_TYPES });
    const file = await handle.getFile();
    const stem = stemOf(handle.name);
    const root = stem.startsWith(settings.stitchPrefix) ? stem.slice(settings.stitchPrefix.length) : stem;
    let g;
    if (isVideo(file, handle.name)) {
      const url = URL.createObjectURL(file);
      const e = handle.name.slice(handle.name.lastIndexOf('.'));
      g = { kind: 'video', stitched: true, vids: [url], base: url, hovers: [url], baseName: `${root}(左)${e}`, hoverNames: [`${root}(右)${e}`] };
    }
    else {
      const { left, right } = await cutHalves(file);
      g = { base: left, hovers: [right], baseName: `${root}(左).png`, hoverNames: [`${root}(右).png`] };
    }
    groups.value.forEach(revokeGroup);
    groups.value = [g];
    gIdx.value = 0;
    hIdx.value = 0;
  }

  // 互换底图与当前产出(Tab):拼接图/拼接视频原图在右边时用
  function swapPair() {
    const g = group.value;
    if (!g)
      return;
    const i = hIdx.value;
    // 拼接视频两槽同源,换 URL 换不了画面,靠 flipped 决定底图露哪半
    if (g.kind === 'video' && g.stitched)
      g.flipped = !g.flipped;
    [g.base, g.hovers[i]] = [g.hovers[i], g.base];
    [g.baseName, g.hoverNames[i]] = [g.hoverNames[i], g.baseName];
  }

  async function scanDir(dir) {
    const names = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'file')
        names.push(name);
    }
    // 带拼接图标记的单文件各自成组(拆成两半当一对),其余走标记配对
    const sp = settings.stitchPrefix;
    const stitchNames = [];
    const plainNames = [];
    for (const name of names) {
      if (/\.\w+$/.test(name) && !IMAGE_EXTS.has(name.slice(name.lastIndexOf('.') + 1).toLowerCase()))
        continue;
      (sp && stemOf(name).startsWith(sp) ? stitchNames : plainNames).push(name);
    }
    const list = [];
    for (const name of stitchNames) {
      const { left, right } = await cutHalves(await dir.getFileHandle(name).then(h => h.getFile()));
      const root = stemOf(name).slice(sp.length);
      list.push({ base: left, hovers: [right], baseName: `${root}(左).png`, hoverNames: [`${root}(右).png`] });
    }
    for (const { baseName, hoverNames } of pairUp(plainNames)) {
      list.push({
        base: URL.createObjectURL(await dir.getFileHandle(baseName).then(h => h.getFile())),
        hovers: await Promise.all(hoverNames.sort().map(n => dir.getFileHandle(n).then(h => h.getFile()).then(URL.createObjectURL))),
        baseName,
        hoverNames: [...hoverNames].sort(), // 与 hovers 一一对应,导出时取作文件名
      });
    }
    list.sort((a, b) => a.baseName.localeCompare(b.baseName));
    groups.value.forEach(revokeGroup);
    groups.value = list;
    gIdx.value = 0;
    hIdx.value = 0;
    noMatch.value = list.length === 0;
  }

  async function openFolder() {
    const dir = await window.showDirectoryPicker({ mode: 'read' });
    await idbSet('handles', 'dir', dir);
    dirHandle.value = dir;
    needRestore.value = false;
    await scanDir(dir);
  }

  // 刷新后恢复:目录句柄已授权则直接扫描,否则等用户点"恢复"
  async function restore() {
    const dir = await idbGet('handles', 'dir');
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
  watch(() => [settings.matchMode, settings.matchStr, settings.stitchPrefix], () => {
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
