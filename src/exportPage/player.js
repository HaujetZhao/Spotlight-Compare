// 导出页运行时:图片 / 视频共用一套光圈对比交互。
// 由 exportHtml.js 以 ?raw 内联进导出的单文件 HTML,配置经 JSON 注入;
// 不依赖任何模块,单独拿出来也能在浏览器里跑。
// 两侧各是一个"裁切盒":kind 决定 img/video,crop 决定整幅/左半/右半。
// Tab 只换角色、不换 src;两侧都是视频才启用播放与同步,混合对(一图一视频)暂停静音。
(function () {
  window.__ugrvPlayer = function (cfg) {
    const el = document.getElementById('ugrv');
    const MODES = ['torch', 'brush', 'spotlight', 'lens'];
    const I = cfg.icons;

    el.innerHTML = `<div class="ugrv-stage"><div class="ugrv-side ugrv-a"><div class="ugrv-crop"></div></div><div class="ugrv-side ugrv-b"><div class="ugrv-crop"></div></div></div>
<div class="ugrv-ring"></div>
<button class="ugrv-help">${I.circleQuestion}</button>
<button class="ugrv-play" hidden></button>
<button class="ugrv-btn" data-pick="a">${I.image}换底图</button>
<button class="ugrv-btn" data-pick="b">${I.images}换对比</button>
<button class="ugrv-btn" data-pick="s">${I.tableColumns}拼接图</button>
<div class="ugrv-help-mask"><div class="ugrv-card"><h3>快捷键</h3><table>
<tr class="grp ugrv-space-row"><td colspan="4">播放</td></tr>
<tr class="ugrv-space-row"><td><kbd>空格</kbd></td><td class="act">播放/暂停</td><td></td><td></td></tr>
<tr class="grp"><td colspan="4">光圈</td></tr>
<tr><td><kbd>1</kbd>-<kbd>4</kbd></td><td class="act">切换模式</td><td><kbd>[</kbd> <kbd>]</kbd> <kbd>,</kbd> <kbd>.</kbd></td><td class="act">光圈大小</td></tr>
<tr><td><kbd>左键点击</kbd></td><td class="act">钉住光圈</td><td><kbd>右键</kbd></td><td class="act">去掉光圈钉</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>滚轮</kbd></td><td class="act">光圈大小</td><td></td><td></td></tr>
<tr class="grp"><td colspan="4">视图</td></tr>
<tr><td><kbd>滚轮</kbd></td><td class="act">缩放</td><td><kbd>拖拽</kbd></td><td class="act">平移</td></tr>
<tr><td><kbd>Tab</kbd></td><td class="act">互换底图/对比</td><td></td><td></td></tr>
<tr class="grp"><td colspan="4">导出</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>S</kbd></td><td class="act">保存画面</td><td><kbd>Ctrl</kbd>+<kbd>C</kbd></td><td class="act">复制画面</td></tr>
</table></div></div>`;

    const stage = el.querySelector('.ugrv-stage');
    const roots = [...el.querySelectorAll('.ugrv-side')];
    const ring = el.querySelector('.ugrv-ring');
    const playBtn = el.querySelector('.ugrv-play');
    const helpMask = el.querySelector('.ugrv-help-mask');
    const spaceRows = [...el.querySelectorAll('.ugrv-space-row')];

    el.style.setProperty('--ugrv-size', `${cfg.size}px`);
    el.style.cursor = cfg.mode === 'lens' ? 'none' : 'crosshair';

    // 物理槽固定(与 App 的 vids 同序),角色 a/b 通过 base 引用切换
    const sides = cfg.sides.map((s, i) => {
      const source = cfg.sources[s.src];
      return {
        root: roots[i],
        cropEl: roots[i].querySelector('.ugrv-crop'),
        kind: source.kind,
        url: source.data,
        crop: s.crop,
        media: null,
        w: 0,
        h: 0,
      };
    });
    let base = sides[0];
    let dir = 0;
    const pins = [cfg.pins || [], []];
    const owned = new Set();

    let mode = cfg.mode;
    let size = cfg.size;
    let x = 0;
    let y = 0;
    let queued = false;
    let onImg = true;
    let scale = 1;
    let tx = 0;
    let ty = 0;

    function sibling(side) {
      return side === sides[0] ? sides[1] : sides[0];
    }

    function canPlay() {
      return sides.every(s => s.kind === 'video');
    }

    function masterSide() {
      return cfg.audioRole === 'b' ? sibling(base) : base;
    }

    // ===== 媒体与几何:img / video 只用一组尺寸读写 =====
    function mediaSize(media) {
      return media.tagName === 'VIDEO' ? [media.videoWidth, media.videoHeight] : [media.naturalWidth, media.naturalHeight];
    }

    // 这一侧实际展示的媒体宽度:整幅取媒体宽,半边取一半(向下取整,与 App 的 floor(w/2) 一致)
    function mediaW(side) {
      return side.crop === 'full' ? side.w : Math.floor(side.w / 2);
    }

    function fitRect(mw, mh) {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const k = Math.min(w / mw, h / mh);
      return [(w - mw * k) / 2, (h - mh * k) / 2, mw * k, mh * k];
    }

    // 一侧的 contain 绘制矩形(stage 局部空间)
    function sideRect(side) {
      return fitRect(mediaW(side), side.h);
    }

    function baseRect() {
      return sideRect(base);
    }

    // 每一侧按自己的尺寸与取半方式摆裁切盒:整幅铺满盒,半边用 2 倍宽媒体只露左/右半
    function layout() {
      sides.forEach((side) => {
        if (!mediaW(side) || !side.h)
          return;
        const [left, top, w, h] = sideRect(side);
        side.cropEl.style.left = `${left}px`;
        side.cropEl.style.top = `${top}px`;
        side.cropEl.style.width = `${w}px`;
        side.cropEl.style.height = `${h}px`;
        side.media.style.left = side.crop === 'right' ? `${-w}px` : '0px';
        side.media.style.top = '0px';
        side.media.style.width = side.crop === 'full' ? `${w}px` : `${w * 2}px`;
        side.media.style.height = `${h}px`;
      });
    }

    function bindMedia(side, media) {
      const ready = media.tagName === 'VIDEO' ? 'loadedmetadata' : 'load';
      media.addEventListener(ready, () => {
        if (side.media !== media)
          return;
        [side.w, side.h] = mediaSize(media);
        layout();
        applyMask();
        applyRing();
        apply();
      });
      if (media.tagName === 'VIDEO') {
        media.addEventListener('play', updatePlay);
        media.addEventListener('pause', updatePlay);
        media.addEventListener('ended', onEnded);
      }
    }

    function replaceMedia(side, kind, url) {
      const old = side.media;
      if (old) {
        if (old.tagName === 'VIDEO') {
          old.pause();
          old.removeAttribute('src');
          old.load();
        }
        old.remove();
      }
      side.kind = kind;
      side.url = url;
      side.w = 0;
      side.h = 0;
      const media = document.createElement(kind === 'video' ? 'video' : 'img');
      media.className = 'ugrv-media';
      if (kind === 'video') {
        media.playsInline = true;
        media.preload = 'auto';
        media.muted = true;
      }
      side.media = media;
      bindMedia(side, media);
      side.cropEl.appendChild(media);
      media.src = url;
    }

    // ===== 光圈遮罩 =====
    function css(stops) {
      return `radial-gradient(circle var(--ugrv-r) at var(--ugrv-x) var(--ugrv-y),${stops.map(p => `${p[1]} ${Math.round(p[0] * 100)}%`).join(',')})`;
    }

    // 钉层:底图媒体坐标 → 当前视口局部坐标;柔和度/模式直接复用烘焙 stops 表
    function pinLayers() {
      const ra = baseRect();
      const fitK = mediaW(base) / ra[2];
      return pins[dir].map((p) => {
        const body = cfg.stops[p.mode].map(q => `${q[1]} ${Math.round(q[0] * 100)}%`).join(',');
        return `radial-gradient(circle ${p.size / fitK}px at ${ra[0] + p.mx / fitK}px ${ra[1] + p.my / fitK}px,${body})`;
      });
    }

    function applyMask() {
      sides.forEach((s) => {
        s.root.style.webkitMaskImage = '';
        s.root.style.maskImage = '';
      });
      const layers = mediaW(base) && base.h ? pinLayers() : [];
      layers.push(css(cfg.stops[mode]));
      const target = sibling(base).root;
      const m = layers.join(',');
      target.style.webkitMaskImage = m;
      target.style.maskImage = m;
    }

    function ringVis() {
      const on = mode === 'lens' && onImg;
      ring.style.display = on ? 'block' : 'none';
      ring.style.opacity = on && el.classList.contains('ugrv-in') ? 1 : 0;
    }

    function applyRing() {
      const r = size * scale * cfg.ringRadius;
      const cx = tx + x * scale;
      const cy = ty + y * scale;
      ring.style.left = `${cx - r}px`;
      ring.style.top = `${cy - r}px`;
      ring.style.width = `${r * 2}px`;
      ring.style.height = `${r * 2}px`;
    }

    // 离开镜头模式要把镜头模式的 --ugrv-r 内联覆盖清掉,否则切回 torch 时光圈半径停在 0
    function setMode(m) {
      mode = m;
      if (m !== 'lens')
        el.style.removeProperty('--ugrv-r');
      applyMask();
      el.style.cursor = m === 'lens' ? 'none' : 'crosshair';
      ringVis();
      apply();
    }

    function apply() {
      queued = false;
      el.style.setProperty('--ugrv-x', `${x}px`);
      el.style.setProperty('--ugrv-y', `${y}px`);
      if (!mediaW(base) || !base.h)
        return;
      const ra = baseRect();
      onImg = Math.abs(x - el.clientWidth / 2) <= ra[2] / 2 && Math.abs(y - el.clientHeight / 2) <= ra[3] / 2;
      if (mode === 'lens') {
        el.style.cursor = onImg ? 'none' : 'crosshair';
        el.style.setProperty('--ugrv-r', onImg ? '' : '0px');
      }
      applyRing();
      ringVis();
    }

    function applyTransform() {
      stage.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
      applyRing();
    }

    function move(e) {
      const r = el.getBoundingClientRect();
      x = (e.clientX - r.left - tx) / scale;
      y = (e.clientY - r.top - ty) / scale;
      if (!queued) {
        queued = true;
        requestAnimationFrame(apply);
      }
    }

    function show(e) {
      move(e);
      el.classList.add('ugrv-in');
      ringVis();
    }

    function hide() {
      el.classList.remove('ugrv-in');
      ringVis();
    }

    function setSize(d) {
      size = Math.max(50, Math.min(400, size + d));
      el.style.setProperty('--ugrv-size', `${size}px`);
      applyRing();
    }

    // ===== 钉:左键点击(位移<5px 且 <300ms,拖拽不放)放,右键去掉指针所在那枚 =====
    // 圈整个落在底图绘制矩形外(黑边)时钉没有意义,不记(与 App 同规则)
    function circleHitsRect(cx, cy, r, ra) {
      const dx = cx - Math.max(ra[0], Math.min(cx, ra[0] + ra[2]));
      const dy = cy - Math.max(ra[1], Math.min(cy, ra[1] + ra[3]));
      return dx * dx + dy * dy <= r * r;
    }
    function addPin() {
      if (!el.classList.contains('ugrv-in') || !mediaW(base))
        return;
      const ra = baseRect();
      const fitK = mediaW(base) / ra[2];
      if (!circleHitsRect(x, y, size, ra))
        return;
      pins[dir].push({ mx: (x - ra[0]) * fitK, my: (y - ra[1]) * fitK, mode, size: size * fitK });
      applyMask();
    }

    function unpin() {
      if (!mediaW(base))
        return;
      const ra = baseRect();
      const fitK = mediaW(base) / ra[2];
      // 后钉的画在上面,从末尾往回找,先消掉最上面那枚
      for (let i = pins[dir].length - 1; i >= 0; i--) {
        const p = pins[dir][i];
        if (Math.hypot(ra[0] + p.mx / fitK - x, ra[1] + p.my / fitK - y) <= p.size / fitK) {
          pins[dir].splice(i, 1);
          applyMask();
          return;
        }
      }
    }

    // ===== 播放同步:主时钟是出声那一路,播放中只软纠偏静音那路 =====
    let panning = false;
    let panStartX = 0;
    let panStartY = 0;
    let downPos = null;
    let syncRaf = 0;
    let endedGuard = false;

    function pauseAll() {
      sides.forEach((s) => {
        if (s.media.tagName === 'VIDEO')
          s.media.pause();
      });
    }

    function updateMuted() {
      const can = canPlay();
      const audible = can ? masterSide() : null;
      sides.forEach((s) => {
        if (s.media.tagName === 'VIDEO')
          s.media.muted = s !== audible;
      });
      spaceRows.forEach((row) => {
        row.hidden = !can;
      });
    }

    function updatePlay() {
      const can = canPlay();
      playBtn.hidden = !can;
      if (!can)
        return;
      const playing = sides.some(s => !s.media.paused);
      playBtn.innerHTML = `${playing ? I.pause : I.play}<span>${playing ? '暂停' : '播放'}</span>`;
    }

    function syncNow() {
      const m = masterSide().media;
      sides.forEach((s) => {
        s.media.playbackRate = 1;
        if (s.media !== m && Math.abs(s.media.currentTime - m.currentTime) > 0.001)
          s.media.currentTime = m.currentTime;
      });
    }

    function startSync() {
      cancelAnimationFrame(syncRaf);
      const step = () => {
        const m = masterSide().media;
        if (m.paused)
          return;
        if (m.playbackRate !== 1)
          m.playbackRate = 1;
        sides.forEach((s) => {
          const v = s.media;
          if (v === m)
            return;
          const e = m.currentTime - v.currentTime;
          if (Math.abs(e) > 0.3) {
            v.playbackRate = 1;
            v.currentTime = m.currentTime;
          }
          else {
            v.playbackRate = Math.abs(e) > 0.02 ? 1 + Math.max(-0.05, Math.min(0.05, e * 0.5)) : 1;
          }
        });
        syncRaf = requestAnimationFrame(step);
      };
      syncRaf = requestAnimationFrame(step);
    }

    function playAll() {
      if (!canPlay())
        return;
      syncNow();
      const m = masterSide().media;
      const p = m.play();
      sides.forEach((s) => {
        if (s.media !== m)
          s.media.play().catch(() => {});
      });
      if (p) {
        p.catch(() => {
          pauseAll();
          updatePlay();
        });
      }
      startSync();
      updatePlay();
    }

    function togglePlay() {
      if (!canPlay())
        return;
      if (sides.some(s => !s.media.paused)) {
        pauseAll();
        syncNow();
      }
      else {
        playAll();
      }
      updatePlay();
    }

    function onEnded() {
      if (endedGuard)
        return;
      endedGuard = true;
      setTimeout(() => {
        endedGuard = false;
      }, 100);
      pauseAll();
      sides.forEach((s) => {
        s.media.currentTime = 0;
      });
      playAll();
    }

    // ===== Tab:原地换角色,不换 src;拼接对的左右半边各在各自槽上,换角色即翻半边 =====
    function swap() {
      dir = 1 - dir;
      base = sibling(base);
      sides.forEach((s) => {
        s.root.className = `ugrv-side ${s === base ? 'ugrv-a' : 'ugrv-b'}`;
      });
      updateMuted();
      applyMask();
      apply();
    }

    function refresh() {
      layout();
      applyMask();
      applyRing();
      apply();
      updateMuted();
      updatePlay();
    }

    // ===== 合成整幅:底图侧取整幅或对应半边,对比侧按自己的 contain 矩形叠上;img/video 通用 =====
    function composite() {
      const cw = mediaW(base);
      const ch = base.h;
      const other = sibling(base);
      if (!cw || !ch || !mediaW(other) || !other.h)
        return null;
      const c = document.createElement('canvas');
      c.width = cw;
      c.height = ch;
      const ctx = c.getContext('2d');
      ctx.drawImage(base.media, base.crop === 'right' ? cw : 0, 0, cw, ch, 0, 0, cw, ch);
      if (el.classList.contains('ugrv-in') || pins[dir].length) {
        const ra = baseRect();
        const fitK = cw / ra[2];
        const bw = mediaW(other);
        const bh = other.h;
        const rb = sideRect(other);
        const t = document.createElement('canvas');
        t.width = cw;
        t.height = ch;
        const tc = t.getContext('2d');
        tc.drawImage(other.media, other.crop === 'right' ? bw : 0, 0, bw, bh, (rb[0] - ra[0]) * fitK, (rb[1] - ra[1]) * fitK, rb[2] * fitK, rb[3] * fitK);
        // 蒙版画布:钉(canvas 即底图媒体分辨率,坐标直接用) + 实时光圈,source-over 叠加 = 并集
        const mk = document.createElement('canvas');
        mk.width = cw;
        mk.height = ch;
        const mkc = mk.getContext('2d');
        pins[dir].forEach((p) => {
          const g = mkc.createRadialGradient(p.mx, p.my, 0, p.mx, p.my, p.size);
          cfg.stops[p.mode].forEach((q) => {
            g.addColorStop(q[0], q[1]);
          });
          mkc.fillStyle = g;
          mkc.fillRect(0, 0, mk.width, mk.height);
        });
        if (el.classList.contains('ugrv-in') && (mode !== 'lens' || onImg)) {
          const mx = (x - ra[0]) * fitK;
          const my = (y - ra[1]) * fitK;
          const g = mkc.createRadialGradient(mx, my, 0, mx, my, size * fitK);
          cfg.stops[mode].forEach((q) => {
            g.addColorStop(q[0], q[1]);
          });
          mkc.fillStyle = g;
          mkc.fillRect(0, 0, mk.width, mk.height);
        }
        tc.globalCompositeOperation = 'destination-in';
        tc.drawImage(mk, 0, 0);
        ctx.drawImage(t, 0, 0);
      }
      return c;
    }

    function download() {
      const c = composite();
      if (!c)
        return;
      if (cfg.format === 'jpeg') {
        const ctx = c.getContext('2d');
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
      }
      c.toBlob((blob) => {
        const u = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = u;
        a.download = `${cfg.title}.${cfg.format}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(u), 1000);
      }, `image/${cfg.format}`, cfg.quality);
    }

    function copy() {
      const c = composite();
      if (!c)
        return;
      c.toBlob((blob) => {
        navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      });
    }

    function toggleHelp() {
      helpMask.classList.toggle('ugrv-on');
    }

    // ===== 换文件:一个输入框同时接图片和视频 =====
    // 换底图/换对比:该角色那一侧换成整幅;拼接图:一个文件两侧共用,按角色各取一半
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*';
    input.style.display = 'none';
    document.body.appendChild(input);
    let pickTarget = null;

    function prune() {
      const live = new Set(sides.map(s => s.url).filter(u => u.indexOf('blob:') === 0));
      owned.forEach((u) => {
        if (!live.has(u)) {
          URL.revokeObjectURL(u);
          owned.delete(u);
        }
      });
    }

    input.addEventListener('change', () => {
      const file = input.files[0];
      input.value = '';
      if (!file)
        return;
      const kind = file.type.indexOf('video/') === 0 ? 'video' : 'image';
      const url = URL.createObjectURL(file);
      owned.add(url);
      pauseAll();
      if (pickTarget === 's') {
        const other = sibling(base);
        base.crop = 'left';
        replaceMedia(base, kind, url);
        other.crop = 'right';
        replaceMedia(other, kind, url);
      }
      else {
        const side = pickTarget === 'a' ? base : sibling(base);
        side.crop = 'full';
        replaceMedia(side, kind, url);
      }
      prune();
      refresh();
    });

    el.querySelectorAll('.ugrv-btn[data-pick]').forEach((b) => {
      b.addEventListener('click', () => {
        pickTarget = b.dataset.pick;
        input.click();
      });
    });

    // ===== 指针 / 键盘 =====
    el.addEventListener('pointerenter', show);
    el.addEventListener('pointerleave', () => {
      if (!panning)
        hide();
    });
    // 按钮/帮助浮层上的按下不进入拖拽与放钉流程(否则点"播放"会在原地钉一枚光圈)
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button,.ugrv-help-mask'))
        return;
      panning = true;
      panStartX = e.clientX - tx;
      panStartY = e.clientY - ty;
      show(e);
      if (e.pointerType === 'mouse')
        downPos = { x: e.clientX, y: e.clientY, t: Date.now() };
    });
    el.addEventListener('pointermove', (e) => {
      if (panning) {
        tx = e.clientX - panStartX;
        ty = e.clientY - panStartY;
        applyTransform();
      }
      move(e);
    });
    addEventListener('pointerup', (e) => {
      if (downPos && e.button === 0 && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) < 5 && Date.now() - downPos.t < 300)
        addPin();
      downPos = null;
      if (!panning)
        return;
      panning = false;
      if (matchMedia('(hover:none)').matches)
        hide();
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      unpin();
    });
    el.addEventListener('dragstart', (e) => {
      e.preventDefault();
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || panning) {
        setSize(-e.deltaY * 0.1);
        return;
      }
      const r = el.getBoundingClientRect();
      const k = e.deltaY > 0 ? 1 / 1.1 : 1.1;
      const ns = Math.min(10, Math.max(0.1, scale * k));
      const f = ns / scale;
      const cx = e.clientX - r.left;
      const cy = e.clientY - r.top;
      tx = cx - (cx - tx) * f;
      ty = cy - (cy - ty) * f;
      scale = ns;
      applyTransform();
      move(e);
    });

    addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        download();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        copy();
        return;
      }
      if (e.key === ' ') {
        if (canPlay()) {
          e.preventDefault();
          togglePlay();
        }
        return;
      }
      if (e.key === '?') {
        toggleHelp();
        return;
      }
      if (e.key === 'Escape' && helpMask.classList.contains('ugrv-on')) {
        toggleHelp();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        swap();
        return;
      }
      if (e.key >= '1' && e.key <= '4') {
        setMode(MODES[Number(e.key) - 1]);
        return;
      }
      if (e.key === '[' || e.key === ',')
        setSize(-10);
      if (e.key === ']' || e.key === '.')
        setSize(10);
    });

    playBtn.addEventListener('click', togglePlay);
    el.querySelector('.ugrv-help').addEventListener('click', toggleHelp);
    helpMask.addEventListener('click', toggleHelp);
    addEventListener('resize', () => {
      layout();
      applyMask();
      applyRing();
    });

    // ===== 初始化 =====
    sides.forEach(side => replaceMedia(side, side.kind, side.url));
    applyMask();
    ringVis();
    updateMuted();
    updatePlay();
  };
})();
