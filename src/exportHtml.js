// Ctrl+E 导出:当前一对媒体 → 内嵌数据、零依赖的自包含单文件交互 HTML。
// 图片与视频共用同一套导出页运行时(src/exportPage/player.js),页面本身既能加载图片也能加载视频。
// 嵌入规则:视频原样 base64(对比的就是画质,不重编码);图片 jpg/jpeg/webp 原样,其余按面板格式/质量重编码。
// 同一 URL 只嵌一份(拼接视频两侧共用),进度按视频字节统计。
import appIcon from '../public/icon.svg?raw';
import { saveBlob } from './download';
import playerCss from './exportPage/player.css?raw';
import playerJs from './exportPage/player.js?raw';
import { ICONS } from './icons';
import { canvasStops, MODES, RING_RADIUS } from './mask';
import { settings } from './settings';

function blobToDataURL(blob, onProgress) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onprogress = e => onProgress?.(e.loaded);
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

// JPEG 无 alpha,垫白底
async function embedImage(url, name) {
  const ext = name?.match(/\.(\w+)$/)?.[1]?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'webp')
    return blobToDataURL(await (await fetch(url)).blob());
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
  return blobToDataURL(blob);
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ESC[c]);
}

// sides: [{ url, kind: 'image'|'video', name, crop: 'full'|'left'|'right' }],固定两项(底图角色 / 对比角色)
// pins 已在底图媒体像素坐标里;audioRole 是出声的角色
export async function exportHtml({ sides, name, pins = [], audioRole = 'a', onProgress }) {
  // 按 URL 去重:拼接视频两侧是同一个源,只嵌一份
  const unique = new Map();
  sides.forEach((side) => {
    if (!unique.has(side.url))
      unique.set(side.url, side);
  });
  const entries = [...unique.entries()];

  // 视频才值得报进度;先把视频读成 blob 求总字节
  const videoBlobs = new Map();
  await Promise.all(entries
    .filter(([, side]) => side.kind === 'video')
    .map(async ([url]) => videoBlobs.set(url, await (await fetch(url)).blob())));
  const total = [...videoBlobs.values()].reduce((n, blob) => n + blob.size, 0);
  let read = 0;

  const sources = [];
  const index = new Map();
  for (const [url, side] of entries) {
    let data;
    if (side.kind === 'video') {
      const blob = videoBlobs.get(url);
      data = await blobToDataURL(blob, loaded => onProgress?.(Math.min(1, (read + loaded) / total)));
      read += blob.size;
      onProgress?.(Math.min(1, read / total));
    }
    else {
      data = await embedImage(url, side.name);
    }
    index.set(url, sources.length);
    sources.push({ kind: side.kind, data, name: side.name });
  }

  const cfg = {
    title: name,
    mode: settings.mode,
    size: settings.size,
    stops: Object.fromEntries(MODES.map(m => [m, canvasStops(m, settings.softness)])),
    ringRadius: RING_RADIUS,
    format: settings.exportFormat,
    quality: settings.exportQuality,
    audioRole,
    pins,
    sources,
    sides: sides.map(side => ({ src: index.get(side.url), crop: side.crop })),
    // 导出页零依赖,图标随配置内联(与 App 同一份 FA SVG)
    icons: {
      circleQuestion: ICONS.circleQuestion,
      play: ICONS.play,
      pause: ICONS.pause,
      image: ICONS.image,
      images: ICONS.images,
      tableColumns: ICONS.tableColumns,
    },
  };
  // < 转义:数据里不会冒出 </script>
  const configJson = JSON.stringify(cfg).replace(/</g, '\\u003c');
  // favicon 内联成 data URI:导出的 HTML 会离开项目目录,不能引用外部文件
  const favicon = `data:image/svg+xml,${encodeURIComponent(appIcon)}`;

  const html = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(name)}</title>
<link rel="icon" type="image/svg+xml" href="${favicon}">
<style>${playerCss}</style>
</head>
<body>
<div class="ugrv" id="ugrv"></div>
<script>${playerJs}
__ugrvPlayer(${configJson});</${'script'}>
</body>
</html>`;

  saveBlob(new Blob([html], { type: 'text/html' }), `${name}.html`);
}
