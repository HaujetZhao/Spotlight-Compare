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
  // 默认出声的那一路:base = 原视频,hover = 对比视频(Tab 互换后声音跟着这段视频,不随角色换)
  audioSide: 'base',
  exportFormat: 'jpeg',
  exportQuality: 0.9,
};

export const settings = reactive({ ...DEFAULTS, ...JSON.parse(localStorage.getItem('ugrv-settings') || '{}') });

watch(settings, v => localStorage.setItem('ugrv-settings', JSON.stringify(v)));
