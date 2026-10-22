<script setup>
// 预览设置面板:仿相册浏览器 SettingsPanel(可拖标题栏、点外/Esc 关闭),精简为三个滑杆。
import { onBeforeUnmount, ref, watch } from 'vue';
import { settings } from './settings';

const props = defineProps({ modelValue: Boolean });
const emit = defineEmits(['update:modelValue']);

// 四种光圈风格(与参考 zip 导出对齐;跟随延迟统一为 0)
const MODES = [
  { value: 'torch', label: '手电筒' },
  { value: 'brush', label: '笔刷' },
  { value: 'spotlight', label: '聚光灯' },
  { value: 'lens', label: '放大镜' },
];

const panelEl = ref(null);
const left = ref(80);
const top = ref(80);

// 拖拽(仅标题栏)
let dragOffset = null;
function onDragStart(e) {
  if (!e.target.closest('.panel-header'))
    return;
  e.preventDefault();
  const rect = panelEl.value.getBoundingClientRect();
  dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);
}
function onDragMove(e) {
  if (!dragOffset)
    return;
  left.value = Math.max(0, Math.min(e.clientX - dragOffset.x, window.innerWidth - panelEl.value.offsetWidth));
  top.value = Math.max(0, Math.min(e.clientY - dragOffset.y, window.innerHeight - panelEl.value.offsetHeight));
}
function onDragEnd() {
  dragOffset = null;
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
}

// Esc / 点外关闭
function onKey(e) {
  if (e.key === 'Escape')
    emit('update:modelValue', false);
}
function onDocDown(e) {
  if (!panelEl.value.contains(e.target))
    emit('update:modelValue', false);
}
watch(() => props.modelValue, (open) => {
  if (open) {
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDocDown);
  }
  else {
    window.removeEventListener('keydown', onKey);
    document.removeEventListener('mousedown', onDocDown);
  }
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  document.removeEventListener('mousedown', onDocDown);
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" ref="panelEl" class="panel" :style="{ left: `${left}px`, top: `${top}px` }" @mousedown="onDragStart">
      <div class="panel-header">
        预览设置
      </div>
      <div class="panel-body">
        <div class="item">
          <label>光圈大小</label>
          <input v-model.number="settings.size" type="range" min="50" max="400" step="10">
          <span>{{ settings.size }}px</span>
        </div>
        <div class="item">
          <label>模式</label>
          <div class="seg-group">
            <button
              v-for="m in MODES"
              :key="m.value"
              class="seg-btn"
              :class="{ active: settings.mode === m.value }"
              @click="settings.mode = m.value"
            >
              {{ m.label }}
            </button>
          </div>
        </div>
        <div class="item">
          <label>边缘柔和</label>
          <input v-model.number="settings.softness" type="range" min="30" max="85" step="1" :disabled="settings.mode === 'spotlight' || settings.mode === 'lens'">
          <span>{{ settings.softness }}%</span>
        </div>

        <div class="separator" />

        <div class="item">
          <label>标记位置</label>
          <div class="seg-group">
            <button class="seg-btn" :class="{ active: settings.matchMode === 'prefix' }" @click="settings.matchMode = 'prefix'">
              前缀
            </button>
            <button class="seg-btn" :class="{ active: settings.matchMode === 'suffix' }" @click="settings.matchMode = 'suffix'">
              后缀
            </button>
          </div>
        </div>
        <div class="item">
          <label>原图标记</label>
          <input v-model="settings.matchStr" class="text-input" type="text" placeholder="如 _原">
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.panel {
  position: fixed;
  width: 320px;
  background: rgba(15, 20, 40, 0.95);
  border-radius: 10px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4);
  z-index: 1001;
  color: #fff;
  font-family: system-ui, sans-serif;
  user-select: none;
}
.panel-header {
  padding: 12px 15px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.15);
  font-size: 15px;
  font-weight: 700;
  cursor: move;
}
.panel-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.item {
  display: flex;
  align-items: center;
  gap: 12px;
}
.item label {
  font-size: 13px;
  font-weight: 600;
  min-width: 64px;
}
.item input[type="range"] {
  flex: 1;
  height: 5px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.25);
  border-radius: 3px;
  outline: none;
}
.item input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #4a6cf7;
  cursor: pointer;
}
.item span {
  min-width: 52px;
  text-align: right;
  font-size: 12px;
  font-weight: 700;
}
.seg-group {
  flex: 1;
  display: flex;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 6px;
  overflow: hidden;
}
.seg-btn {
  flex: 1;
  padding: 7px 4px;
  border: none;
  border-right: 1px solid rgba(255, 255, 255, 0.3);
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}
.seg-btn:last-child {
  border-right: none;
}
.seg-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}
.seg-btn.active {
  background: #4a6cf7;
  color: #fff;
}
input:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.text-input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  font-size: 13px;
  outline: none;
}
.text-input:focus {
  border-color: #4a6cf7;
}
.separator {
  height: 1px;
  background: rgba(255, 255, 255, 0.15);
  margin: 4px 0;
}
</style>
