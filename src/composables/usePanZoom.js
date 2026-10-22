// 光圈指针跟随 + 观察变换(缩放/平移)。坐标都在 stage 局部空间:
// stage 有 transform(缩放/平移),指针位置经 toLocal 折算 ((屏幕 − 容器左上 − 平移) / 缩放)。
// 缩放/平移只是观察手段,光圈中心/大小按局部空间记录。
import { computed, ref } from 'vue';
import { settings } from '../settings';

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;
const ZOOM_STEP = 0.1;

export function usePanZoom(stage, viewer) {
  const x = ref(0);
  const y = ref(0);
  const active = ref(false);
  // 指针是否在底图 contain 绘制矩形内(镜头模式出图时藏镜头、显鼠标)
  const onImg = ref(true);
  const scale = ref(1);
  const pointX = ref(0);
  const pointY = ref(0);

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
    // 底图 object-fit:contain 实际绘制矩形(stage 局部空间)
    const img = stage.value.querySelector('.ugrv-a');
    const w = stage.value.clientWidth;
    const h = stage.value.clientHeight;
    const k = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    onImg.value = Math.abs(x.value - w / 2) <= (img.naturalWidth * k) / 2 && Math.abs(y.value - h / 2) <= (img.naturalHeight * k) / 2;
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

  // 放大镜圆环:遮罩坐标在 stage 局部空间,圆环挂在外层不吃 transform,
  // 位置/大小要按当前 scale/translate 换算回屏幕坐标(toLocal 的逆运算);
  // 半径 ×0.78 对齐光圈渐变的可见硬边
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

  return { x, y, active, onImg, scale, move, show, hide, onUp, onWheel, onDown, onPanMove, onPanUp, onDblClick, ringStyle };
}
