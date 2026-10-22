// 预览参数:localStorage 持久化,App 与 SettingsPanel 共享同一份 reactive。
import { reactive, watch } from 'vue';

const DEFAULTS = {
  mode: 'torch',
  size: 130,
  softness: 56,
  matchMode: 'prefix',
  matchStr: '原-',
  stitchPrefix: '拼-',
  // 拼接素材默认哪边是原图 / 原视频(Tab 仍可当场翻)
  stitchImageSide: 'left',
  stitchVideoSide: 'left',
  // 出声的那一路:base = 原视频,hover = 对比视频。快捷键 M 切换,跟着角色走,持久化
  audioSide: 'base',
  exportFormat: 'jpeg',
  exportQuality: 0.9,
};

// localStorage 是跨会话的外部输入:解析失败(旧版本/手改坏了)就用默认值,不让整个应用起不来
function load() {
  try {
    return JSON.parse(localStorage.getItem('ugrv-settings') || '{}');
  }
  catch {
    return {};
  }
}

export const settings = reactive({ ...DEFAULTS, ...load() });

watch(settings, v => localStorage.setItem('ugrv-settings', JSON.stringify(v)));
