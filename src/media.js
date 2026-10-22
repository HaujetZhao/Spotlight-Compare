// 媒体原始尺寸:图片取 naturalWidth,视频取 videoWidth;拼接视频(.ugrv-half 包裹、只显半边)按半边宽算。
// 查看器 fit 布局、指针 onImg 判定、快照合成三处共用,别各写一份。
export function mediaSize(el) {
  const v = el instanceof HTMLVideoElement ? el : el.querySelector('video');
  if (v)
    return { w: v.videoWidth / (el.classList.contains('ugrv-half') ? 2 : 1), h: v.videoHeight };
  return { w: el.naturalWidth, h: el.naturalHeight };
}
