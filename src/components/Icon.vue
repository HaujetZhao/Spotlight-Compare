<script setup>
// 内联 Font Awesome SVG(见 src/icons.js);继承当前文字颜色,尺寸由 font-size 控制
import { ICONS } from '../icons';

defineProps({ name: { type: String, required: true } });
</script>

<template>
  <span class="fa-icon" aria-hidden="true" v-html="ICONS[name]" />
</template>

<style scoped>
.fa-icon {
  display: inline-flex;
  flex: none;
}
.fa-icon :deep(svg) {
  display: block;
  width: 1em;
  height: 1em;
  fill: currentColor;
}
</style>
