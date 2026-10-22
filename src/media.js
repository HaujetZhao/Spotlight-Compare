// 媒体原始尺寸:图片取 naturalWidth,视频取 videoWidth;拼接视频(.ugrv-half 包裹、只显半边)按半边宽算。
// 查看器 fit 布局、指针 onImg 判定、快照合成、离线转码四处共用,别各写一份。
export function mediaSize(el) {
  const v = el instanceof HTMLVideoElement ? el : el.querySelector('video');
  if (v)
    return { w: v.videoWidth / (el.classList.contains('ugrv-half') ? 2 : 1), h: v.videoHeight };
  return { w: el.naturalWidth, h: el.naturalHeight };
}

// object-fit:contain 的绘制矩形:sw×sh 的媒体放进 w×h 容器,返回 [x, y, w, h]
export function containRect(sw, sh, w, h) {
  const k = Math.min(w / sw, h / sh);
  const iw = sw * k;
  const ih = sh * k;
  return [(w - iw) / 2, (h - ih) / 2, iw, ih];
}

// 媒体元素在容器里的绘制矩形,以及 stage 局部像素 → 媒体像素的缩放
export function fitMapping(el, w, h) {
  const { w: sw, h: sh } = mediaSize(el);
  const rect = containRect(sw, sh, w, h);
  return { rect, k: sw / rect[2] };
}

// stage 局部坐标的圆(光圈/钉)→ 媒体像素坐标
export function toMedia(z, rect, k) {
  return { mx: (z.x - rect[0]) * k, my: (z.y - rect[1]) * k, size: z.size * k };
}

// 圆(局部空间)与绘制矩形是否有重叠:圈整个落在画面外(黑边)时放钉没有意义
export function circleHitsRect(cx, cy, r, [x, y, w, h]) {
  const dx = cx - Math.min(Math.max(cx, x), x + w);
  const dy = cy - Math.min(Math.max(cy, y), y + h);
  return dx * dx + dy * dy <= r * r;
}
