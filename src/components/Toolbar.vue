<script setup>
// 查看器角落工具栏:翻组/翻产出按钮 + 计数,换图/文件夹/设置入口
defineProps({ count: Number, gIdx: Number, hIdx: Number, hoverCount: { type: Number, default: 0 } });
defineEmits(['navGroup', 'navHover', 'pick', 'pickStitched', 'pickVideos', 'pickStitchedVideo', 'openFolder', 'toggleSettings']);
</script>

<template>
  <div class="toolbar">
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
    <button @click="$emit('openFolder')">
      文件夹
    </button>
    <button @click="$emit('pick', 'base')">
      换底图
    </button>
    <button @click="$emit('pick', 'hover')">
      换对比图
    </button>
    <button title="选一张左右拼接的单图,自动拆成两半对比" @click="$emit('pickStitched')">
      拼接图
    </button>
    <button title="选两个视频:第 1 个当底图(出声),第 2 个当对比图(静音)" @click="$emit('pickVideos')">
      视频
    </button>
    <button title="左右拼接的视频,左右半各作底图/对比图" @click="$emit('pickStitchedVideo')">
      拼接视频
    </button>
    <button @click="$emit('toggleSettings')">
      设置
    </button>
  </div>
</template>

<style scoped>
.toolbar {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 4;
  display: flex;
  gap: 8px;
  align-items: center;
}
.toolbar button {
  padding: 6px 12px;
  border: none;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.42);
  color: #fff;
  font: 600 12px system-ui, sans-serif;
  cursor: pointer;
}
.toolbar .counter {
  padding: 6px 4px;
  color: #fff;
  font: 700 12px system-ui, sans-serif;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
}
</style>
