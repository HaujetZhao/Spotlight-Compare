// 视频对导出:当前一对视频 → 内嵌 base64 的自包含单文件交互 HTML,点击下载。
// 缩水版查看器:光圈跟随、滚轮缩放、拖拽平移、Ctrl+滚轮调光圈、光圈钉(预置 pins,收件人左键/右键 增删)、
// 空格播放/暂停(两路同步,出声那路当主时钟)、Tab 互换(普通对原地换角色,拼接对翻半边)、
// 拼接视频按半边裁切、Ctrl+S 保存当前帧 / Ctrl+C 复制当前帧。
// 视频原样内嵌、不重编码——这个工具对比的就是画质,压缩两边就把差异抹平了;代价是文件大导出页就大。
// 与 App 保持的行为同步清单见 CLAUDE.md 约定 4。
import { canvasStops, maskCSS, MODES, RING_RADIUS } from './mask';
import { settings } from './settings';

// 读成 data URL,按已读字节上报进度(大文件要几秒,让调用方有反馈)
function readDataURL(blob, onProgress) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onprogress = e => onProgress?.(e.loaded);
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

// urlA / urlB 是当前"底图角色 / 对比角色"的 objectURL(拼接视频两者相同);
// halfSides 是两角色取源哪半边(0 左 1 右),audioRole 是出声的角色;pin 已在底图媒体像素坐标里
export async function exportVideo({ urlA, urlB, stitched, halfSides, audioRole, name, pins = [], onProgress }) {
  const [blobA, blobB] = await Promise.all([
    fetch(urlA).then(r => r.blob()),
    stitched ? null : fetch(urlB).then(r => r.blob()),
  ]);
  const total = stitched ? blobA.size : blobA.size + blobB.size;
  let read = 0;
  const progress = loaded => onProgress?.(Math.min(1, (read + loaded) / total));
  const a = await readDataURL(blobA, progress);
  read += blobA.size;
  const b = stitched ? null : await readDataURL(blobB, progress);

  const mask = maskCSS(settings.mode, `${settings.softness}%`);
  const stops = JSON.stringify(Object.fromEntries(MODES.map(m => [m, canvasStops(m, settings.softness)])));
  const pinsJson = JSON.stringify(pins);
  const cursor = settings.mode === 'lens' ? 'none' : 'crosshair';
  const bURL = stitched ? 'AURL' : `"${b}"`;
  const stageHtml = stitched
    ? '<div class="ugrv-a ugrv-half"><div class="ugrv-crop"><video playsinline preload="auto"></video></div></div>'
    + '<div class="ugrv-b ugrv-half"><div class="ugrv-crop"><video playsinline preload="auto" muted></video></div></div>'
    : '<video class="ugrv-a" playsinline preload="auto"></video><video class="ugrv-b" playsinline preload="auto" muted></video>';
  const pickHtml = stitched
    ? '<button class="ugrv-btn" data-pick="s">换拼接视频</button>'
    : '<button class="ugrv-btn" data-pick="a">换底图</button><button class="ugrv-btn" data-pick="b">换对比</button>';

  const html = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title>
<style>
@property --ugrv-r{syntax:"<length>";inherits:true;initial-value:0px}
body{margin:0;height:100dvh;background:#0b1020;overflow:hidden}
.ugrv{position:relative;width:100vw;height:100dvh;overflow:hidden;user-select:none;cursor:${cursor};--ugrv-size:${settings.size}px;touch-action:none}
.stage{position:absolute;inset:0;transform-origin:0 0}
.ugrv video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block}
.ugrv-a{z-index:1}
.ugrv-b{z-index:2;-webkit-mask-image:${mask};mask-image:${mask};-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat}
.ugrv-half{position:absolute;inset:0}
.ugrv-crop{position:absolute;overflow:hidden}
.ugrv-crop video{inset:auto;object-fit:fill}
.ugrv{--ugrv-r:0px}
.ugrv.ugrv-in{--ugrv-r:var(--ugrv-size)}
.ugrv-ring{position:absolute;z-index:3;border-radius:50%;border:2px solid rgba(255,255,255,0.85);box-shadow:0 0 0 1px rgba(0,0,0,0.35),0 10px 26px rgba(0,0,0,0.4),inset 0 0 22px rgba(255,255,255,0.16);pointer-events:none;opacity:0}
.ugrv-help{position:absolute;left:12px;bottom:12px;z-index:4;width:30px;height:30px;border:1px solid rgba(255,255,255,0.4);border-radius:50%;background:rgba(30,40,66,0.8);box-shadow:0 2px 8px rgba(0,0,0,0.4);color:#fff;font:700 15px system-ui,sans-serif;cursor:pointer}
.ugrv-help:hover{background:rgba(52,64,100,0.9)}
.ugrv-btn{position:absolute;right:12px;top:12px;z-index:4;padding:5px 14px;border:1px solid rgba(255,255,255,0.4);border-radius:999px;background:rgba(30,40,66,0.8);color:#fff;font:600 12px system-ui,sans-serif;cursor:pointer}
.ugrv-btn:hover{background:rgba(52,64,100,0.9)}
.ugrv-btn[data-pick='b']{top:44px}
.ugrv-play{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);z-index:4;padding:5px 22px;border:1px solid rgba(255,255,255,0.4);border-radius:999px;background:rgba(30,40,66,0.8);color:#fff;font:600 12px system-ui,sans-serif;cursor:pointer}
.ugrv-play:hover{background:rgba(52,64,100,0.9)}
.ugrv-help-mask{position:absolute;inset:0;z-index:5;background:rgba(0,0,0,0.5);display:none;align-items:center;justify-content:center}
.ugrv-help-mask.ugrv-on{display:flex}
.ugrv-card{min-width:340px;padding:20px 26px;border:1px solid rgba(255,255,255,0.14);border-radius:14px;background:rgba(16,22,40,0.92);color:#fff}
.ugrv-card h3{margin:0 0 14px;font:600 14px system-ui,sans-serif;opacity:0.9}
.ugrv-card table{border-collapse:collapse;font:13px system-ui,sans-serif}
.ugrv-card td{padding:5px 0}
.ugrv-card tr.grp td{padding:10px 0 4px;color:#9db1ff;font:600 11px system-ui,sans-serif;letter-spacing:2px}
.ugrv-card td:first-child{padding-right:26px;white-space:nowrap}
.ugrv-card td:nth-child(3){padding-left:26px;white-space:nowrap}
.ugrv-card .act{opacity:0.7}
.ugrv-card kbd{display:inline-block;padding:1px 7px;border:1px solid rgba(255,255,255,0.25);border-radius:4px;background:rgba(255,255,255,0.1);font:11px/1.7 system-ui,sans-serif}
</style>
</head>
<body>
<div class="ugrv"><div class="stage">${stageHtml}</div>
<div class="ugrv-ring"></div>
<button class="ugrv-help">?</button>
<button class="ugrv-play">播放</button>
${pickHtml}
<div class="ugrv-help-mask"><div class="ugrv-card"><h3>快捷键</h3><table>
<tr class="grp"><td colspan="4">播放</td></tr>
<tr><td><kbd>空格</kbd></td><td class="act">播放/暂停</td><td></td><td></td></tr>
<tr class="grp"><td colspan="4">光圈</td></tr>
<tr><td><kbd>1</kbd>-<kbd>4</kbd></td><td class="act">切换模式</td><td><kbd>[</kbd> <kbd>]</kbd> <kbd>,</kbd> <kbd>.</kbd></td><td class="act">光圈大小</td></tr>
<tr><td><kbd>左键点击</kbd></td><td class="act">钉住光圈</td><td><kbd>右键</kbd></td><td class="act">去掉光圈钉</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>滚轮</kbd></td><td class="act">光圈大小</td><td></td><td></td></tr>
<tr class="grp"><td colspan="4">视图</td></tr>
<tr><td><kbd>滚轮</kbd></td><td class="act">缩放</td><td><kbd>拖拽</kbd></td><td class="act">平移</td></tr>
<tr><td><kbd>Tab</kbd></td><td class="act">互换底图/对比</td><td></td><td></td></tr>
<tr class="grp"><td colspan="4">导出</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>S</kbd></td><td class="act">保存当前帧</td><td><kbd>Ctrl</kbd>+<kbd>C</kbd></td><td class="act">复制当前帧</td></tr>
</table></div></div>
</div>
<script>
(function(){
var el=document.querySelector('.ugrv'),stage=el.querySelector('.stage'),x=0,y=0,q=false,size=${settings.size},s=1,tx=0,ty=0,pan=false,px=0,py=0,mode='${settings.mode}',fmt='${settings.exportFormat}',quality=${settings.exportQuality},onImg=true;
var stitched=${stitched},audioRole='${audioRole}',halfA=${halfSides.a},halfB=${halfSides.b};
var stops=${stops};
// 钉按方向两份(会话态):pins[0]=导出时预置(底图媒体像素坐标),Tab 互换后的方向 pins[1] 从空开始
var dir=0,pins=[${pinsJson},[]];
var aTop=el.querySelector('.ugrv-a'),bTop=el.querySelector('.ugrv-b');
// stitched:两块裁切框各露同一段视频的一半;普通对:两个 video 各自一幅,只靠角色换遮罩
var av=stitched?aTop.querySelector('video'):aTop,bv=stitched?bTop.querySelector('video'):bTop;
// aV/bV 是"底图角色/对比角色"当前落在哪个元素上,Tab 只换角色不换 src(换 src 会重载)
var aV=av,bV=bv;
var AURL="${a}",BURL=${bURL};
av.src=AURL;bv.src=stitched?AURL:BURL;
// 底图媒体尺寸:看角色 a 当前落在哪个元素上(Tab 互换后不再是 av),拼接视频只算半边。
// 舞台局部坐标 → 底图媒体像素的缩放 fitK 由它推
function baseMW(){return stitched?Math.floor(aV.videoWidth/2):aV.videoWidth}
function fitSize(mw,mh){var w=el.clientWidth,h=el.clientHeight,k=Math.min(w/mw,h/mh);return[(w-mw*k)/2,(h-mh*k)/2,mw*k,mh*k]}
function baseRect(){return fitSize(baseMW(),aV.videoHeight)}
function css(st){return 'radial-gradient(circle var(--ugrv-r) at var(--ugrv-x) var(--ugrv-y),'+st.map(function(p){return p[1]+' '+Math.round(p[0]*100)+'%'}).join(',')+')'}
// 钉层:底图媒体坐标 → 当前视口局部坐标;柔和度/模式直接复用烘焙 stops 表
function pinLayers(){
  var ra=baseRect(),fitK=baseMW()/ra[2];
  return pins[dir].map(function(p){
    var body=stops[p.mode].map(function(q){return q[1]+' '+Math.round(q[0]*100)+'%'}).join(',');
    return 'radial-gradient(circle '+(p.size/fitK)+'px at '+(ra[0]+p.mx/fitK)+'px '+(ra[1]+p.my/fitK)+'px,'+body+')';
  });
}
function applyMask(){
  if(!aV.videoWidth)return;
  av.style.webkitMaskImage=av.style.maskImage='';
  bv.style.webkitMaskImage=bv.style.maskImage='';
  bTop.style.webkitMaskImage=bTop.style.maskImage='';
  var m=pinLayers().concat([css(stops[mode])]).join(',');
  var t=stitched?bTop:bV;
  t.style.webkitMaskImage=m;t.style.maskImage=m;
}
var ring=el.querySelector('.ugrv-ring');
function ringVis(){var on=mode==='lens'&&onImg;ring.style.display=on?'block':'none';ring.style.opacity=on&&el.classList.contains('ugrv-in')?1:0}
function applyRing(){var r=size*s*${RING_RADIUS};ring.style.left=(tx+x*s-r)+'px';ring.style.top=(ty+y*s-r)+'px';ring.style.width=ring.style.height=r*2+'px'}
// 离开镜头模式要把镜头模式的 --ugrv-r 内联覆盖清掉,否则切回 torch 时光圈半径停在 0
function setMode(m){mode=m;if(m!=='lens')el.style.removeProperty('--ugrv-r');applyMask();el.style.cursor=m==='lens'?'none':'crosshair';ringVis();apply()}
function apply(){q=false;el.style.setProperty('--ugrv-x',x+'px');el.style.setProperty('--ugrv-y',y+'px');
  if(!aV.videoWidth)return;
  var ra=baseRect();
  onImg=Math.abs(x-el.clientWidth/2)<=ra[2]/2&&Math.abs(y-el.clientHeight/2)<=ra[3]/2;
  if(mode==='lens'){el.style.cursor=onImg?'none':'crosshair';el.style.setProperty('--ugrv-r',onImg?'':'0px')}
  applyRing();ringVis();
}
function applyT(){stage.style.transform='translate('+tx+'px,'+ty+'px) scale('+s+')';applyRing()}
function move(e){var r=el.getBoundingClientRect();x=(e.clientX-r.left-tx)/s;y=(e.clientY-r.top-ty)/s;if(!q){q=true;requestAnimationFrame(apply)}}
function show(e){move(e);el.classList.add('ugrv-in');ringVis()}
function hide(){el.classList.remove('ugrv-in');ringVis()}
function setSize(d){size=Math.max(50,Math.min(400,size+d));el.style.setProperty('--ugrv-size',size+'px');applyRing()}
// 拼接视频:半边按 contain 算裁切框,视频 2 倍宽铺进去只露一半(与 App 的 halfBox 同几何)
function layout(){
  if(!stitched||!av.videoWidth)return;
  var vw=el.clientWidth,vh=el.clientHeight,hw=av.videoWidth/2,k=Math.min(vw/hw,vh/av.videoHeight),dw=hw*k,dh=av.videoHeight*k,L=(vw-dw)/2,T=(vh-dh)/2;
  [[aTop,halfA],[bTop,halfB]].forEach(function(it){
    var crop=it[0].querySelector('.ugrv-crop'),v=it[0].querySelector('video');
    crop.style.left=L+'px';crop.style.top=T+'px';crop.style.width=dw+'px';crop.style.height=dh+'px';
    v.style.left=(-it[1]*dw)+'px';v.style.top='0';v.style.width=(dw*2)+'px';v.style.height=dh+'px';
  });
}
// 钉:左键点击(位移<5px 且 <300ms,拖拽不放)放,右键去掉指针所在那枚(从末尾往回找最上面那枚)
function addPin(){
  if(!el.classList.contains('ugrv-in'))return;
  var ra=baseRect(),fitK=baseMW()/ra[2];
  pins[dir].push({mx:(x-ra[0])*fitK,my:(y-ra[1])*fitK,mode:mode,size:size*fitK});
  applyMask();
}
function unpin(){
  var ra=baseRect(),fitK=baseMW()/ra[2];
  var i=pins[dir].findLastIndex(function(p){return Math.hypot(ra[0]+p.mx/fitK-x,ra[1]+p.my/fitK-y)<=p.size/fitK});
  if(i>=0){pins[dir].splice(i,1);applyMask()}
}
el.addEventListener('pointerenter',show);
el.addEventListener('pointerleave',function(){if(!pan)hide()});
var dpos=null;
// 按钮/帮助浮层上的按下不进入拖拽与放钉流程(否则点"播放"会在原地钉一枚光圈)
el.addEventListener('pointerdown',function(e){if(e.button!==0||e.target.closest('button,.ugrv-help-mask'))return;pan=true;px=e.clientX-tx;py=e.clientY-ty;show(e);if(e.pointerType==='mouse')dpos={x:e.clientX,y:e.clientY,t:Date.now()}});
el.addEventListener('pointermove',function(e){if(pan){tx=e.clientX-px;ty=e.clientY-py;applyT()}move(e)});
addEventListener('pointerup',function(e){
  if(dpos&&e.button===0&&Math.hypot(e.clientX-dpos.x,e.clientY-dpos.y)<5&&Date.now()-dpos.t<300)addPin();
  dpos=null;
  if(!pan)return;pan=false;if(matchMedia('(hover:none)').matches)hide();
});
el.addEventListener('contextmenu',function(e){e.preventDefault();unpin()});
el.addEventListener('dragstart',function(e){e.preventDefault()});
el.addEventListener('wheel',function(e){
  e.preventDefault();
  if(e.ctrlKey||pan){setSize(-e.deltaY*0.1);return}
  var r=el.getBoundingClientRect(),k=e.deltaY>0?1/1.1:1.1,ns=Math.min(10,Math.max(0.1,s*k)),f=ns/s;
  var cx=e.clientX-r.left,cy=e.clientY-r.top;
  tx=cx-(cx-tx)*f;ty=cy-(cy-ty)*f;s=ns;applyT();move(e);
});
// ===== 播放同步(移植 useVideoSync):主时钟是出声那一路,播放中只软纠偏静音那路 =====
var playBtn=el.querySelector('.ugrv-play'),syncRaf=0,endedGuard=false;
function master(){return audioRole==='a'?aV:bV}
function roleOf(v){return v===aV?'a':'b'}
function updateMuted(){av.muted=roleOf(av)!==audioRole;bv.muted=roleOf(bv)!==audioRole}
function updatePlay(){playBtn.textContent=([av,bv].some(function(v){return !v.paused}))?'暂停':'播放'}
function syncNow(){var m=master();[av,bv].forEach(function(v){v.playbackRate=1;if(v!==m&&Math.abs(v.currentTime-m.currentTime)>0.001)v.currentTime=m.currentTime})}
function startSync(){
  cancelAnimationFrame(syncRaf);
  (function step(){
    var m=master();
    if(m.paused)return;
    if(m.playbackRate!==1)m.playbackRate=1;
    [av,bv].forEach(function(v){
      if(v===m)return;
      var e=m.currentTime-v.currentTime;
      if(Math.abs(e)>0.3){v.playbackRate=1;v.currentTime=m.currentTime}
      else v.playbackRate=Math.abs(e)>0.02?1+Math.max(-0.05,Math.min(0.05,e*0.5)):1;
    });
    syncRaf=requestAnimationFrame(step);
  })();
}
function playAll(){
  syncNow();
  var m=master(),p=m.play();
  [av,bv].forEach(function(v){if(v!==m)v.play().catch(function(){})});
  if(p)p.catch(function(){av.pause();bv.pause();updatePlay()});
  startSync();updatePlay();
}
function togglePlay(){
  if([av,bv].some(function(v){return !v.paused})){[av,bv].forEach(function(v){v.pause()});syncNow()}
  else playAll();
  updatePlay();
}
function onEnded(){
  if(endedGuard)return;endedGuard=true;setTimeout(function(){endedGuard=false},100);
  [av,bv].forEach(function(v){v.pause()});
  av.currentTime=0;bv.currentTime=0;
  playAll();
}
[av,bv].forEach(function(v){
  v.addEventListener('ended',onEnded);
  v.addEventListener('play',updatePlay);
  v.addEventListener('pause',updatePlay);
});
playBtn.addEventListener('click',togglePlay);
// Tab:普通对原地换角色(遮罩跟着换、出声跟着角色走);拼接对只翻两半
function swap(){
  dir=1-dir;
  if(stitched){halfA=1-halfA;halfB=1-halfB;layout()}
  else{
    var t=aV;aV=bV;bV=t;
    aV.className='ugrv-a';bV.className='ugrv-b';
    updateMuted();
  }
  // 互换后底图换了元素,底图尺寸/onImg 都要按新角色重算
  applyMask();apply();
}
// ===== 合成当前帧(底图分辨率,拼接视频为半边宽):底图 + 钉与光圈的并集蒙版抠出的对比帧 =====
function composite(){
  var cw=baseMW(),ch=aV.videoHeight;
  if(!cw||!bV.videoWidth)return null;
  var c=document.createElement('canvas');c.width=cw;c.height=ch;
  var ctx=c.getContext('2d');
  ctx.drawImage(aV,stitched?halfA*cw:0,0,cw,ch,0,0,cw,ch);
  if(el.classList.contains('ugrv-in')||pins[dir].length){
    var ra=baseRect(),fitK=cw/ra[2];
    var bw=stitched?Math.floor(bV.videoWidth/2):bV.videoWidth,bh=bV.videoHeight,rb=fitSize(bw,bh);
    var t=document.createElement('canvas');t.width=cw;t.height=ch;
    var tc=t.getContext('2d');
    tc.drawImage(bV,stitched?halfB*bw:0,0,bw,bh,(rb[0]-ra[0])*fitK,(rb[1]-ra[1])*fitK,rb[2]*fitK,rb[3]*fitK);
    // 蒙版画布:钉(canvas 即底图媒体分辨率,坐标直接用) + 实时光圈,source-over 叠加 = 并集
    var mk=document.createElement('canvas');mk.width=cw;mk.height=ch;
    var mkc=mk.getContext('2d');
    pins[dir].forEach(function(p){
      var g=mkc.createRadialGradient(p.mx,p.my,0,p.mx,p.my,p.size);
      stops[p.mode].forEach(function(q){g.addColorStop(q[0],q[1])});
      mkc.fillStyle=g;mkc.fillRect(0,0,mk.width,mk.height);
    });
    if(el.classList.contains('ugrv-in')&&(mode!=='lens'||onImg)){
      var mx=(x-ra[0])*fitK,my=(y-ra[1])*fitK,g=mkc.createRadialGradient(mx,my,0,mx,my,size*fitK);
      stops[mode].forEach(function(q){g.addColorStop(q[0],q[1])});
      mkc.fillStyle=g;mkc.fillRect(0,0,mk.width,mk.height);
    }
    tc.globalCompositeOperation='destination-in';
    tc.drawImage(mk,0,0);
    ctx.drawImage(t,0,0);
  }
  return c;
}
function download(){
  var c=composite();if(!c)return;
  if(fmt==='jpeg'){var ctx=c.getContext('2d');ctx.globalCompositeOperation='destination-over';ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height)}
  c.toBlob(function(blob){var u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=document.title+'.'+fmt;a.click();setTimeout(function(){URL.revokeObjectURL(u)},1000)},'image/'+fmt,quality);
}
function copy(){
  var c=composite();if(!c)return;
  c.toBlob(function(blob){navigator.clipboard.write([new ClipboardItem({'image/png':blob})])});
}
var helpMask=el.querySelector('.ugrv-help-mask');
function toggleHelp(){helpMask.classList.toggle('ugrv-on')}
el.querySelector('.ugrv-help').addEventListener('click',toggleHelp);
helpMask.addEventListener('click',toggleHelp);
// 换底图/换对比/换拼接视频:原生文件选择;视频不拆,拼接视频两个裁切框共用同一个文件
var fi=document.createElement('input');fi.type='file';fi.accept='video/*';fi.style.display='none';
var pickTarget=null;
fi.addEventListener('change',function(){
  var f=fi.files[0];fi.value='';
  if(!f)return;
  var olds=[av.src,bv.src],u=URL.createObjectURL(f);
  [av,bv].forEach(function(v){v.pause()});
  if(pickTarget==='s'){av.src=u;bv.src=u}
  else (pickTarget==='a'?aV:bV).src=u;
  // 被换掉的旧文件不留 objectURL
  olds.forEach(function(o){if(o.indexOf('blob:')===0&&o!==av.src&&o!==bv.src)URL.revokeObjectURL(o)});
  updatePlay();
});
el.querySelectorAll('.ugrv-btn[data-pick]').forEach(function(b){
  b.addEventListener('click',function(){pickTarget=b.dataset.pick;fi.click()});
});
addEventListener('keydown',function(e){
  if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();download();return}
  if((e.ctrlKey||e.metaKey)&&e.key==='c'){e.preventDefault();copy();return}
  if(e.key===' '){e.preventDefault();togglePlay();return}
  if(e.key==='?'){toggleHelp();return}
  if(e.key==='Escape'&&helpMask.classList.contains('ugrv-on')){toggleHelp();return}
  if(e.key==='Tab'){e.preventDefault();swap();return}
  if(e.key>='1'&&e.key<='4'){setMode(['torch','brush','spotlight','lens'][e.key-1]);return}
  if(e.key==='['||e.key===',')setSize(-10);
  if(e.key===']'||e.key==='.')setSize(10);
});
// 任一路换源/元数据就绪后都要重算:拼接裁切、底图尺寸变化后的钉/光圈、圆环
function onMeta(){layout();applyMask();applyRing();apply()}
av.addEventListener('loadedmetadata',onMeta);
bv.addEventListener('loadedmetadata',onMeta);
addEventListener('resize',function(){layout();applyMask();applyRing()});
applyMask();
ringVis();
updateMuted();
updatePlay();
})();
</${'script'}>
</body>
</html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const el = document.createElement('a');
  el.href = URL.createObjectURL(blob);
  el.download = `${name}.html`;
  el.click();
  setTimeout(() => URL.revokeObjectURL(el.href), 1000);
}
