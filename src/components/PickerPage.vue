<script setup>
// 选择页:打开文件夹批量配对 / 单选底图+对比(图文通用)/ 拼接 / 恢复上次文件夹
defineProps({ pair: { type: Object, default: null }, needRestore: Boolean, noMatch: Boolean });
defineEmits(['pick', 'pickStitched', 'openFolder', 'grantRestore']);
</script>

<template>
  <div class="picker">
    <h1>聚光对比</h1>
    <p>选「底图」和「对比」，鼠标悬停处用光圈透出对比画面，图片、视频都能对比。</p>
    <p class="hint">
      或打开文件夹批量对比：带 "原-"前缀的是原图，同名的其余文件作对比图；带 "拼-" 前缀识别为拼接图，自动拆两半。
    </p>
    <button v-if="needRestore" class="restore" @click="$emit('grantRestore')">
      恢复上次的文件夹
    </button>
    <p v-if="noMatch" class="warn">
      没配到对:确认设置的"标记位置"和"原图标记"与文件名一致(默认前缀 原-),且每张原图都有不带标记的对比图。
    </p>
    <!-- 图与视频走同一套槽:没有配好一对之前,选中的文件类型决定这对是图还是视频 -->
    <div class="slots">
      <button class="slot big" title="按原图标记批量配对文件夹里的图片和视频" @click="$emit('openFolder')">
        <span>打开文件夹</span>
      </button>
      <button class="slot" @click="$emit('pick', 'base')">
        <video v-if="pair?.kind === 'video' && pair.base" :src="pair.base" muted />
        <img v-else-if="pair?.base" :src="pair.base" alt="底图预览">
        <span v-else>选择底图</span>
      </button>
      <button class="slot" @click="$emit('pick', 'hover')">
        <video v-if="pair?.kind === 'video' && pair.hover" :src="pair.hover" muted />
        <img v-else-if="pair?.hover" :src="pair.hover" alt="对比图预览">
        <span v-else>选对比图</span>
      </button>
      <button class="slot" title="左右拼接的一张图(拆成两半)或一段视频(不拆不重编码,各露半边)" @click="$emit('pickStitched')">
        <span>选拼接图</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  min-height: 100dvh;
  color: #fff;
  font-family: system-ui, sans-serif;
}
.picker h1 {
  margin: 0;
  font-size: 24px;
}
.picker p {
  margin: 0;
  opacity: 0.7;
}
.picker .hint {
  font-size: 13px;
  opacity: 0.5;
}
.picker .warn {
  margin: 0;
  max-width: 560px;
  font-size: 13px;
  color: #ffb84d;
  text-align: center;
}
.slots {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 24px;
  padding: 0 16px;
}
.slot {
  width: 260px;
  height: 180px;
  border: 2px dashed rgba(255, 255, 255, 0.35);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.05);
  color: inherit;
  font: 600 15px system-ui, sans-serif;
  cursor: pointer;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.slot.big {
  border-color: rgba(74, 108, 247, 0.7);
  color: #9db1ff;
}
.slot:hover {
  border-color: rgba(255, 255, 255, 0.7);
}
.slot img,
.slot video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.restore {
  padding: 8px 20px;
  border: none;
  border-radius: 999px;
  background: #4a6cf7;
  color: #fff;
  font: 600 14px system-ui, sans-serif;
  cursor: pointer;
}
</style>
