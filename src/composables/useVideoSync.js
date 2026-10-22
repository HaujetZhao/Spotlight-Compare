// 视频对播放同步:两路各走各的时钟,时间基准取"出声的那一路"(pair.audioRole 对应的角色 class,
// Tab/M 换角色后自动跟随)。音频必须连续,播放中绝不能为了对齐去 seek 出声那路——seek 一打断
// 音频管线就掉帧,而且 seek 落地时对方已经又跑开一截,于是每帧再 seek,变成死循环,
// 表现就是出声那路卡、声音也卡。播放中只给落后那一路微调 playbackRate(±5%)去追,
// 差超 SYNC_HARD 才对静音那一路硬 seek。拼接视频的对比半边恒静音,主时钟永远在底图那一路。
import { onScopeDispose } from 'vue';

const SYNC_HARD = 0.3; // 秒:软纠偏追不上才硬对齐(只对齐静音那一路)

export function useVideoSync({ pair, frontVideos }) {
  // 按角色 class 找主时钟,不依赖 DOM 顺序
  function clockOf(vs) {
    return vs.find(v => v.closest(`.ugrv-${pair.value?.audioRole ?? 'a'}`)) ?? vs[0];
  }

  // 暂停 / 起播前一次性对齐(这时 seek 不打断播放)
  function syncSlaves() {
    const vs = frontVideos();
    const master = clockOf(vs);
    if (!master)
      return;
    vs.forEach((v) => {
      v.playbackRate = 1;
      if (v !== master && Math.abs(v.currentTime - master.currentTime) > 0.001)
        v.currentTime = master.currentTime;
    });
  }

  let syncRaf = 0;
  function startSync() {
    cancelAnimationFrame(syncRaf);
    const step = () => {
      const vs = frontVideos();
      const master = clockOf(vs);
      if (!master || master.paused)
        return; // 停了就收手,下次 playAll 再开
      // Tab / M 换过角色后,旧的纠偏速率不许留在主时钟上
      if (master.playbackRate !== 1)
        master.playbackRate = 1;
      const t = master.currentTime;
      vs.forEach((v) => {
        if (v === master)
          return;
        const e = t - v.currentTime;
        if (Math.abs(e) > SYNC_HARD) {
          v.playbackRate = 1;
          v.currentTime = t;
        }
        else {
          v.playbackRate = Math.abs(e) > 0.02 ? 1 + Math.max(-0.05, Math.min(0.05, e * 0.5)) : 1;
        }
      });
      syncRaf = requestAnimationFrame(step);
    };
    syncRaf = requestAnimationFrame(step);
  }

  // 先起出声那一路(可能被自动播放策略拦),被拦就两路都不动,等空格
  function playAll() {
    const vs = frontVideos();
    const master = clockOf(vs);
    if (!master)
      return;
    syncSlaves();
    // 两路同一拍起播:串着起会差出一截(第二路等第一路 play() resolve)
    const started = master.play();
    vs.filter(v => v !== master).forEach(v => v.play().catch(() => {}));
    started?.catch(() => vs.forEach(v => v.pause()));
    startSync();
  }

  function togglePlay() {
    if (!pair.value?.base || !pair.value?.hover)
      return; // 还没选齐两路,不播
    const vs = frontVideos();
    if (vs.some(v => !v.paused)) {
      vs.forEach(v => v.pause());
      syncSlaves(); // 暂停后就停在同一个时间点,画面才对得上
    }
    else {
      playAll();
    }
  }

  // 任一播完且没在录制:两路归零重播
  function restart() {
    frontVideos().forEach((v) => {
      v.pause();
      v.currentTime = 0;
    });
    playAll();
  }

  onScopeDispose(() => cancelAnimationFrame(syncRaf));

  return { playAll, togglePlay, restart, syncSlaves };
}
