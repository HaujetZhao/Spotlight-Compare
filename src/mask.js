// 光圈渐变站点:唯一事实源。查看器 CSS 遮罩、App 内 canvas 合成、导出页遮罩与合成全从这里派生。
// torch/brush 的中间站点由 softness 控制,表里用 'soft' 占位,派生时替换。
const STOPS = {
  torch: [[0, '#000'], [0.16, '#000'], ['soft', 'rgba(0,0,0,0.55)'], [1, 'rgba(0,0,0,0)']],
  brush: [[0, '#000'], [0.4, '#000'], ['soft', 'rgba(0,0,0,0.6)'], [1, 'rgba(0,0,0,0)']],
  spotlight: [[0, '#000'], [0.72, '#000'], [0.78, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0)']],
};
STOPS.lens = STOPS.spotlight;

// 模式集合(顺序即 1-4 热键顺序);导出页 stops 表、键盘切换都从这里取,别再手写列表
export const MODES = ['torch', 'brush', 'spotlight', 'lens'];

// 查看器 lens 圆环半径相对光圈 size 的比例:对齐 spotlight 渐变的可见硬边(见 STOPS.spotlight)
export const RING_RADIUS = 0.78;

// canvas addColorStop 用:'soft' → softness/100
export function canvasStops(mode, softness) {
  return STOPS[mode].map(([o, c]) => [o === 'soft' ? softness / 100 : o, c]);
}

// CSS 遮罩串:'soft' → soft 占位(查看器传 'var(--ugrv-soft)' 实时跟随,导出烘焙具体百分比)
export function maskCSS(mode, soft = 'var(--ugrv-soft)') {
  const body = STOPS[mode].map(([o, c]) => `${c} ${o === 'soft' ? soft : `${Math.round(o * 100)}%`}`).join(', ');
  return `radial-gradient(circle var(--ugrv-r) at var(--ugrv-x) var(--ugrv-y), ${body})`;
}

// CSS 遮罩串(钉住区):圆心/大小/柔和度直接烙进串,与实时层逗号并列成多层 mask(默认 union 叠加)
export function pinCSS(pin) {
  const body = STOPS[pin.mode].map(([o, c]) => `${c} ${o === 'soft' ? `${pin.softness}%` : `${Math.round(o * 100)}%`}`).join(', ');
  return `radial-gradient(circle ${pin.size}px at ${pin.x}px ${pin.y}px, ${body})`;
}
