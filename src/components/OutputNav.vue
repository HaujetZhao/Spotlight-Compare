<script setup>
// 右下角产出导航:当前组内第几份产出 + 左右切换。
// 只有多个产出时才渲染(App 里判断);不放缩略图,只是一个次级计数控件。
import Icon from './Icon.vue';

defineProps({
  count: { type: Number, required: true },
  index: { type: Number, required: true },
});
defineEmits(['navHover']);
</script>

<template>
  <div class="output-nav">
    <span class="label">产出</span>
    <span class="counter">{{ index + 1 }}/{{ count }}</span>
    <button title="上一个产出(←)" @click="$emit('navHover', -1)">
      <Icon name="chevronLeft" />
    </button>
    <button title="下一个产出(→)" @click="$emit('navHover', 1)">
      <Icon name="chevronRight" />
    </button>
  </div>
</template>

<style scoped>
.output-nav {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px 4px 10px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 12px;
  background: rgba(12, 18, 34, 0.62);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28);
  color: #fff;
}
.label {
  color: #fff;
  font: 600 10px system-ui, sans-serif;
  letter-spacing: 1px;
  opacity: 0.6;
  white-space: nowrap;
}
.counter {
  min-width: 26px;
  color: #fff;
  font: 700 11px system-ui, sans-serif;
  text-align: center;
}
button {
  display: grid;
  place-items: center;
  flex: none;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.45);
  border-radius: 7px;
  background: rgba(30, 40, 66, 0.82);
  color: #fff;
  font-size: 10px;
  cursor: pointer;
}
button:hover {
  border-color: rgba(255, 255, 255, 0.7);
  background: rgba(74, 108, 247, 0.95);
}
button:active {
  transform: translateY(1px);
}
</style>
