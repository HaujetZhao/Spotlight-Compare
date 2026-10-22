// 视频合成录制:canvas.captureStream + MediaRecorder 实时录(浏览器原生,零依赖)。
// MP4(H.264+AAC)优先,不支持退 WebM(VP9+Opus)。
// 音频经 Web Audio 从出声的 <video> 引出进录制流;同一元素只能建一次 source,
// 缓存在 WeakMap 常驻,同时接回扬声器,录制时用户照样听得到。
const audioGraph = new WeakMap();
function routeAudio(el) {
  let g = audioGraph.get(el);
  if (!g) {
    const ctx = new AudioContext();
    const src = ctx.createMediaElementSource(el);
    const dest = ctx.createMediaStreamDestination();
    src.connect(ctx.destination);
    src.connect(dest);
    g = { ctx, stream: dest.stream };
    audioGraph.set(el, g);
  }
  g.ctx.resume();
  return g.stream;
}

export function startRecording(canvas, audioEl) {
  const mime = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
    .find(m => MediaRecorder.isTypeSupported(m));
  const stream = canvas.captureStream(30);
  if (audioEl)
    routeAudio(audioEl).getAudioTracks().forEach(t => stream.addTrack(t));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12e6 });
  const chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise(r => (rec.onstop = () => r(new Blob(chunks, { type: mime }))));
  rec.start(200);
  return {
    ext: mime.includes('mp4') ? 'mp4' : 'webm',
    stop: () => {
      rec.stop();
      return done;
    },
  };
}
