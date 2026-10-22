<script setup>
// 选择页:单选两图 / 打开文件夹批量配对 / 恢复上次文件夹
defineProps({ pair: { type: Object, default: null }, needRestore: Boolean, noMatch: Boolean });
defineEmits(['pick', 'openFolder', 'grantRestore']);
</script>

<template>
  <div class="picker">
    <h1>图片对比查看</h1>
    <p>选两张图,鼠标悬停处用手电筒光圈透出对比图。</p>
    <p class="hint">
      或打开文件夹批量对比:原图带标记(默认后缀 "_原"),不带标记的自动作为它的 hover 图。
    </p>
    <button v-if="needRestore" class="restore" @click="$emit('grantRestore')">
      恢复上次的文件夹
    </button>
    <p v-if="noMatch" class="warn">
      这个文件夹里没有配到对:确认设置里的"原图标记"与文件名前缀一致(默认 原-),且每张原图至少有一张不带标记的产出。
    </p>
    <div class="slots">
      <button class="slot" @click="$emit('pick', 'base')">
        <img v-if="pair && pair.base" :src="pair.base" alt="底图预览">
        <span v-else>选择底图</span>
      </button>
      <button class="slot big" @click="$emit('openFolder')">
        <span>打开文件夹</span>
      </button>
      <button class="slot" @click="$emit('pick', 'hover')">
        <img v-if="pair && pair.hover" :src="pair.hover" alt="对比图预览">
        <span v-else>选择对比图</span>
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
  gap: 24px;
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
.slot img {
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
