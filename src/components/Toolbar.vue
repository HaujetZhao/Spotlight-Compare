<script setup>
// 查看器右上角工具栏:组导航(组名 + 计数 + 上下切换)+ 竖排操作按钮(与导出页同一套按钮样式)。
// 产出导航在底部胶片条(OutputStrip),不在这里。
import Icon from './Icon.vue';

defineProps({
  count: { type: Number, default: 1 },
  gIdx: { type: Number, default: 0 },
  groupName: { type: String, default: '' },
});
defineEmits(['navGroup', 'pick', 'pickStitched', 'openFolder']);
</script>

<template>
  <div class="toolbar">
    <!-- 默认只露图标 + 计数;整块 hover/focus 时向左展开文件名,长名字不撑坏布局 -->
    <div v-if="count > 1" class="group" :title="groupName">
      <Icon name="layerGroup" class="gmark" />
      <span class="gname">{{ groupName }}</span>
      <span class="counter">{{ gIdx + 1 }}/{{ count }}</span>
      <button title="上一组(↑)" @click="$emit('navGroup', -1)">
        <Icon name="chevronUp" />
      </button>
      <button title="下一组(↓)" @click="$emit('navGroup', 1)">
        <Icon name="chevronDown" />
      </button>
    </div>
    <div class="acts">
      <button @click="$emit('openFolder')">
        <Icon name="folderOpen" />文件夹
      </button>
      <button title="换底图 / 换底视频" @click="$emit('pick', 'base')">
        <Icon name="image" />换底图
      </button>
      <button title="换对比图 / 对比视频" @click="$emit('pick', 'hover')">
        <Icon name="images" />换对比
      </button>
      <button title="选一张左右拼接的图(拆半)或一段拼接视频(各露半边)" @click="$emit('pickStitched')">
        <Icon name="tableColumns" />拼接图
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
/* 组:当前组名 + 计数 + 上下切换;外层一块,和底部产出胶片条区分层级 */
.group {
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
.gmark {
  color: #9db1ff;
  font-size: 12px;
}
/* 收起时宽度为 0,悬停/聚焦整块才展开;名字过长仍然省略 */
.gname {
  overflow: hidden;
  max-width: 0;
  color: #fff;
  font: 600 12px system-ui, sans-serif;
  letter-spacing: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0;
  transition: max-width 0.18s ease, opacity 0.15s ease;
}
.group:hover .gname,
.group:focus-within .gname {
  max-width: 220px;
  opacity: 1;
}
.counter {
  min-width: 30px;
  color: #fff;
  font: 700 12px system-ui, sans-serif;
  text-align: center;
}
/* 左右两组按钮同一套形状:26×26 圆角方块,点得到 */
.group button {
  display: grid;
  place-items: center;
  flex: none;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.45);
  border-radius: 8px;
  background: rgba(30, 40, 66, 0.82);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}
.group button:hover {
  border-color: rgba(255, 255, 255, 0.7);
  background: rgba(74, 108, 247, 0.95);
}
.group button:active {
  transform: translateY(1px);
}
.acts {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
/* 四个都是三字,按内容定宽就自然等宽,不必写死 */
.acts button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 14px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 999px;
  background: rgba(30, 40, 66, 0.8);
  color: #fff;
  font: 600 12px system-ui, sans-serif;
  cursor: pointer;
}
.acts button .fa-icon {
  font-size: 11px;
}
.acts button:hover {
  background: rgba(52, 64, 100, 0.9);
}
</style>
