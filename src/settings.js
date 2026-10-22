// 预览参数:localStorage 持久化,App 与 SettingsPanel 共享同一份 reactive。
import { reactive, watch } from 'vue';

const DEFAULTS = { mode: 'torch', size: 130, softness: 56, matchMode: 'prefix', matchStr: '原-', stitchPrefix: '拼-', exportFormat: 'jpeg', exportQuality: 0.9 };

export const settings = reactive({ ...DEFAULTS, ...JSON.parse(localStorage.getItem('ugrv-settings') || '{}') });

watch(settings, v => localStorage.setItem('ugrv-settings', JSON.stringify(v)));
