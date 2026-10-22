// 视频对 Ctrl+S:优先离线转码(原帧率、高码率、快于实时、可后台、不占播放界面)——
// 底图分辨率、底图帧率、钉冻成静态 mask、出声那路音轨 aac/mp3 直接拷贝;
// WebCodecs 解不了或编码器缺才退回实时录制(从头同播,播完/空格停即存)。
// recording 同时是 UI 进度:offline=true 时界面显示"合成中",Esc 置 null 即取消(管线逐帧检查 canceled)。
import { ref } from 'vue';
import { saveBlob } from '../download';
import { convertComposite, offlineSupported } from '../videoConvert';
import { startRecording } from '../videoRecord';

export function useVideoExport({ pair, frontVideos, syncSlaves, playAll, drawFrame, nameOf }) {
  const recording = ref(null); // { pct } 或 { pct, offline: true };null = 没在录/没在合成
  let recorder = null;
  let converting = false;

  // zones:光圈钉转成媒体像素坐标(离线管线用);stageZones:stage 局部坐标(实时录制逐帧合成用)
  async function startExport({ zones, stageZones }) {
    if (recorder || converting)
      return;
    converting = true;
    const p = pair.value;
    try {
      const baseBlob = await fetch(p.base).then(r => r.blob());
      const hoverBlob = await fetch(p.hover).then(r => r.blob());
      if (await offlineSupported(baseBlob, hoverBlob)) {
        recording.value = { pct: 0, offline: true };
        const blob = await convertComposite({
          baseBlob,
          hoverBlob,
          audioBlob: p.audioRole === 'b' ? hoverBlob : baseBlob,
          half: p.stitched,
          baseSx: p.halfSides.a,
          hoverSx: p.halfSides.b,
          zones,
          onProgress: pct => recording.value && (recording.value.pct = pct),
          canceled: () => !recording.value,
        });
        if (blob)
          saveBlob(blob, `${nameOf()}-合成.mp4`);
        return;
      }
    }
    catch (e) {
      console.error('离线合成失败,退回实时录制', e);
    }
    finally {
      converting = false;
      if (recording.value?.offline)
        recording.value = null;
    }
    startRealtime(p, stageZones);
  }

  // 实时录制兜底:逐帧把当前合成画面画进 canvas,录音取出声那一路
  function startRealtime(p, stageZones) {
    const audioEl = frontVideos().find(v => v.closest(`.ugrv-${p.audioRole}`));
    const canvas = document.createElement('canvas');
    const scratch = {};
    if (!drawFrame(canvas, stageZones, scratch))
      return; // 先画一帧:定下画布尺寸、确认媒体就绪
    recorder = startRecording(canvas, audioEl);
    syncSlaves();
    frontVideos().forEach((v) => {
      v.currentTime = 0;
    });
    playAll();
    recording.value = { pct: 0 };
    const dur = frontVideos()[0].duration;
    const draw = () => {
      if (!recorder)
        return;
      const vs = frontVideos();
      if (vs.every(v => v.paused))
        return finishExport(true); // 空格暂停即停录保存
      drawFrame(canvas, stageZones, scratch);
      recording.value.pct = Math.min(1, vs[0].currentTime / dur);
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  }

  // 停止实时录制;save=false 表示取消(不保存)
  async function finishExport(save) {
    const r = recorder;
    recorder = null;
    recording.value = null;
    if (!r)
      return;
    frontVideos().forEach(v => v.pause());
    if (!save)
      return;
    saveBlob(await r.stop(), `${nameOf()}-合成.${r.ext}`);
  }

  // Esc:离线合成取消(管线下一帧收手),实时录制丢弃
  function cancelExport() {
    if (recording.value?.offline)
      recording.value = null;
    else
      finishExport(false);
  }

  // 任一视频播完:录完则收工保存并返回 true,否则由调用方归零重播
  function handleEnded() {
    if (!recorder)
      return false;
    finishExport(true);
    return true;
  }

  return { recording, startExport, finishExport, cancelExport, handleEnded };
}
