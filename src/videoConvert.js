// 离线合成转码:解码两路视频 → 逐帧合成(钉住的光圈冻成静态 mask,与查看器同画法)
// → 按源帧率、高码率重编码 → MP4(H.264)。音轨从出声那路来:aac/mp3 直接拷贝不重编码,
// 其他编码解码后转 AAC。快于实时、可后台、不占用播放界面;不支持时由调用方退回实时录制。
import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  canEncodeVideo,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  getFirstEncodableVideoCodec,
  Input,
  Mp4OutputFormat,
  Output,
  VideoSample,
  VideoSampleSink,
  VideoSampleSource,
} from 'mediabunny';
import { containRect } from './media';

const open = async blob => new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });

// 探测:两路都能解、目标编码器可用才走离线
export async function offlineSupported(baseBlob, hoverBlob) {
  try {
    for (const blob of [baseBlob, hoverBlob]) {
      const track = await (await open(blob)).getPrimaryVideoTrack();
      if (!track || !(await track.canDecode()))
        return false;
    }
    return await canEncodeVideo('avc', { width: 1920, height: 1080 });
  }
  catch {
    return false;
  }
}

// zones 为输出画布坐标系的光圈 [{ mx, my, size, stops }](调用方按原图分辨率映射好);
// half 时 baseSx/hoverSx 取源半边(0 左 1 右),画布为半边分辨率(拼接视频)。
// canceled() 返回 true 则中止,返回 null;onProgress(0~1) 汇报进度。
export async function convertComposite({
  baseBlob,
  hoverBlob,
  audioBlob,
  half = false,
  baseSx = 0,
  hoverSx = 0,
  zones = [],
  onProgress,
  canceled,
}) {
  const baseInput = await open(baseBlob);
  const hoverInput = await open(hoverBlob);
  const baseTrack = await baseInput.getPrimaryVideoTrack();
  const hoverTrack = await hoverInput.getPrimaryVideoTrack();
  const w = half ? Math.floor(baseTrack.displayWidth / 2) : baseTrack.displayWidth;
  const h = baseTrack.displayHeight;
  const stats = await baseTrack.computePacketStats(100);
  const fps = stats.averagePacketRate;
  const duration = await baseTrack.computeDuration();
  const codec = await getFirstEncodableVideoCodec(['avc'], { width: w, height: h });
  if (!codec)
    throw new Error('no encoder');

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const temp = new OffscreenCanvas(w, h);
  const tctx = temp.getContext('2d');
  const mask = new OffscreenCanvas(w, h);
  const mctx = mask.getContext('2d');
  // 码率按 0.15 bit/px/frame:4K30≈37Mbps,1080p30≈9Mbps,画质优先
  const videoSource = new VideoSampleSource({ codec, bitrate: Math.round(w * h * fps * 0.15), keyFrameInterval: 2 });

  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  output.addVideoTrack(videoSource, { frameRate: fps });

  // 音轨:出声那路;aac/mp3 拷贝,其余转 AAC
  const audioInput = audioBlob && audioBlob !== baseBlob ? await open(audioBlob) : baseInput;
  const audioTrack = await audioInput.getPrimaryAudioTrack();
  let audioDone = Promise.resolve();
  if (audioTrack) {
    if (audioTrack.codec === 'aac' || audioTrack.codec === 'mp3') {
      const packetSource = new EncodedAudioPacketSource(audioTrack.codec);
      output.addAudioTrack(packetSource);
      audioDone = (async () => {
        await output.start();
        const meta = { decoderConfig: await audioTrack.getDecoderConfig() };
        for await (const packet of new EncodedPacketSink(audioTrack).packets()) {
          if (canceled())
            return;
          await packetSource.add(packet, meta);
        }
      })();
    }
    else {
      const bufferSource = new AudioBufferSource({ codec: 'aac', bitrate: 192000 });
      output.addAudioTrack(bufferSource);
      audioDone = (async () => {
        await output.start();
        for await (const { buffer } of new AudioBufferSink(audioTrack).buffers()) {
          if (canceled())
            return;
          await bufferSource.add(buffer);
        }
      })();
    }
  }
  else {
    await output.start();
  }

  // 逐帧:底图时间线为基准,hover 取不晚于当前帧的最近一帧
  const hoverIter = new VideoSampleSink(hoverTrack).samples()[Symbol.asyncIterator]();
  let hoverCur = null;
  let hoverPeek;
  let hoverDone = false;
  let lastPct = -1;
  for await (const s of new VideoSampleSink(baseTrack).samples()) {
    if (canceled()) {
      s.close();
      hoverCur?.close();
      await output.cancel();
      return null;
    }
    while (!hoverDone) {
      if (hoverPeek === undefined)
        hoverPeek = (await hoverIter.next()).value;
      if (hoverPeek === undefined) {
        hoverDone = true;
        break;
      }
      if (hoverPeek.timestamp > s.timestamp)
        break;
      hoverCur?.close();
      hoverCur = hoverPeek;
      hoverPeek = undefined;
    }
    ctx.clearRect(0, 0, w, h);
    // 源半边偏移按半边宽算:sx 是源坐标,不是整幅宽
    const sw = s.displayWidth / (half ? 2 : 1);
    s.draw(ctx, baseSx * sw, 0, sw, s.displayHeight, 0, 0, w, h);
    if (hoverCur && zones.length) {
      const hw = hoverCur.displayWidth / (half ? 2 : 1);
      const hh = hoverCur.displayHeight;
      // hover 按 contain 进画布(与查看器 fitMapping 同映射)
      const [rx, ry, rw, rh] = containRect(hw, hh, w, h);
      tctx.clearRect(0, 0, w, h);
      hoverCur.draw(tctx, hoverSx * hw, 0, hw, hh, rx, ry, rw, rh);
      mctx.clearRect(0, 0, w, h);
      for (const z of zones) {
        const g = mctx.createRadialGradient(z.mx, z.my, 0, z.mx, z.my, z.size);
        z.stops.forEach(([o, c]) => g.addColorStop(o, c));
        mctx.fillStyle = g;
        mctx.fillRect(0, 0, w, h);
      }
      tctx.globalCompositeOperation = 'destination-in';
      tctx.drawImage(mask, 0, 0);
      tctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(temp, 0, 0);
    }
    // transferToImageBitmap:规范保证的原子快照。直接 new VideoSample(canvas) 内部走
    // new VideoFrame(canvas),不等画布 GPU 队列排空,竞态下会截到上一笔绘制前的旧帧
    // (实测症状:合成视频里光圈整段消失,只剩底图,忽现忽不现)
    const out = new VideoSample(canvas.transferToImageBitmap(), { timestamp: s.timestamp, duration: s.duration });
    await videoSource.add(out);
    out.close();
    s.close();
    if (onProgress) {
      const pct = Math.min(1, (s.timestamp + s.duration) / duration);
      if (pct - lastPct > 0.005 || pct === 1) {
        lastPct = pct;
        onProgress(pct);
      }
    }
  }
  hoverCur?.close();
  await audioDone;
  if (canceled()) {
    await output.cancel();
    return null;
  }
  await output.finalize();
  return new Blob([output.target.buffer], { type: 'video/mp4' });
}
