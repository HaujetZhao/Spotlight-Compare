<script setup>
// 查看器右上角工具栏:翻组/翻产出计数 + 竖排操作按钮(与导出页同一套按钮样式)
defineProps({ count: Number, gIdx: Number, hIdx: Number, hoverCount: { type: Number, default: 0 } });
defineEmits(['navGroup', 'navHover', 'pick', 'pickStitched', 'openFolder']);
</script>

<template>
  <div class="toolbar">
    <div v-if="count > 1 || hoverCount > 1" class="nav">
      <template v-if="count > 1">
        <button @click="$emit('navGroup', -1)">
          ‹
        </button>
        <span class="counter">{{ gIdx + 1 }}/{{ count }}</span>
        <button @click="$emit('navGroup', 1)">
          ›
        </button>
      </template>
      <template v-if="hoverCount > 1">
        <button @click="$emit('navHover', -1)">
          ▲
        </button>
        <span class="counter">{{ hIdx + 1 }}/{{ hoverCount }}</span>
        <button @click="$emit('navHover', 1)">
          ▼
        </button>
      </template>
    </div>
    <div class="acts">
      <button @click="$emit('openFolder')">
        文件夹
      </button>
      <button title="换底图 / 换底视频" @click="$emit('pick', 'base')">
        换底图
      </button>
      <button title="换对比图 / 对比视频" @click="$emit('pick', 'hover')">
        换对比
      </button>
      <button title="选一张左右拼接的图(拆半)或一段拼接视频(各露半边)" @click="$emit('pickStitched')">
        拼接图
      </button>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}
.nav {
  display: flex;
  gap: 8px;
  align-items: center;
}
.nav button {
  padding: 4px 10px;
  border: none;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.42);
  color: #fff;
  font: 600 12px system-ui, sans-serif;
  cursor: pointer;
}
.nav .counter {
  padding: 4px;
  color: #fff;
  font: 700 12px system-ui, sans-serif;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
}
.acts {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
/* 与导出页按钮同一套样式;等宽让竖排不参差 */
/* 四个都是三字,按内容定宽就自然等宽,不必写死 */
.acts button {
  padding: 5px 14px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 999px;
  background: rgba(30, 40, 66, 0.8);
  color: #fff;
  font: 600 12px system-ui, sans-serif;
  cursor: pointer;
}
.acts button:hover {
  background: rgba(52, 64, 100, 0.9);
}
</style>
