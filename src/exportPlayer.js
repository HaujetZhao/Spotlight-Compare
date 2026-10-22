// 导出播放器:当前一对图 → 内嵌 base64 的自包含单文件交互 HTML,点击下载。
// 缩水版效果页:光圈跟随 + 滚轮缩放(以鼠标为中心) + 拖拽平移 + Ctrl+滚轮调光圈 + 双击复位,
// 以及与 App 相同的热键(1-4 切模式、[ ] , . 调光圈、Ctrl+S 下载、Ctrl+C 复制、? 帮助浮层)、
// 换底图/换对比图按钮、lens 圆环。
// transform-origin 固定 0 0,光圈坐标按 (屏幕-平移)/缩放 折算回局部空间。
// 与 App 保持的行为同步清单见 CLAUDE.md 约定 4。
import { canvasStops, maskCSS } from './mask';
import { settings } from './settings';

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

// 内嵌图:jpeg/webp 源文件原样嵌入不再压缩,其余(png/gif/avif 等)按面板格式/质量重编码(JPEG 无 alpha,垫白底)
async function toDataURL(url, name) {
  const ext = name?.match(/\.(\w+)$/)?.[1]?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'webp')
    return blobToDataURL(await (await fetch(url)).blob());
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (settings.exportFormat === 'jpeg') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0);
  const blob = await new Promise(r => canvas.toBlob(r, `image/${settings.exportFormat}`, settings.exportQuality));
  return blobToDataURL(blob);
}

// 初始遮罩渐变与导出页 stops 表都从 mask.js 派生,柔和度/模式在导出时烘焙
export async function exportPlayer({ urlA, urlB, nameA, nameB, name }) {
  const [a, b] = await Promise.all([toDataURL(urlA, nameA), toDataURL(urlB, nameB)]);
  const mask = maskCSS(settings.mode, `${settings.softness}%`);
  const stops = JSON.stringify(Object.fromEntries(['torch', 'brush', 'spotlight', 'lens'].map(m => [m, canvasStops(m, settings.softness)])));
  const cursor = settings.mode === 'lens' ? 'none' : 'crosshair';
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
.ugrv img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block}
.ugrv-a{z-index:1}
.ugrv-b{z-index:2;-webkit-mask-image:${mask};mask-image:${mask};-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat}
.ugrv{--ugrv-r:0px}
.ugrv.ugrv-in{--ugrv-r:var(--ugrv-size)}
.ugrv-ring{position:absolute;z-index:3;border-radius:50%;border:2px solid rgba(255,255,255,0.85);box-shadow:0 0 0 1px rgba(0,0,0,0.35),0 10px 26px rgba(0,0,0,0.4),inset 0 0 22px rgba(255,255,255,0.16);pointer-events:none;opacity:0}
.ugrv-help{position:absolute;left:12px;bottom:12px;z-index:4;width:30px;height:30px;border:1px solid rgba(255,255,255,0.4);border-radius:50%;background:rgba(30,40,66,0.8);box-shadow:0 2px 8px rgba(0,0,0,0.4);color:#fff;font:700 15px system-ui,sans-serif;cursor:pointer}
.ugrv-help:hover{background:rgba(52,64,100,0.9)}
.ugrv-btn{position:absolute;right:12px;top:12px;z-index:4;padding:5px 14px;border:1px solid rgba(255,255,255,0.4);border-radius:999px;background:rgba(30,40,66,0.8);color:#fff;font:600 12px system-ui,sans-serif;cursor:pointer}
.ugrv-btn:hover{background:rgba(52,64,100,0.9)}
.ugrv-btn[data-pick='b']{top:44px}
.ugrv-help-mask{position:absolute;inset:0;z-index:5;background:rgba(0,0,0,0.5);display:none;align-items:center;justify-content:center}
.ugrv-help-mask.ugrv-on{display:flex}
.ugrv-card{min-width:340px;padding:20px 26px;border:1px solid rgba(255,255,255,0.14);border-radius:14px;background:rgba(16,22,40,0.92);color:#fff}
.ugrv-card h3{margin:0 0 14px;font:600 14px system-ui,sans-serif;opacity:0.9}
.ugrv-card table{border-collapse:collapse;font:13px system-ui,sans-serif}
.ugrv-card td{padding:5px 0}
.ugrv-card td:first-child{padding-right:26px;white-space:nowrap}
.ugrv-card td:nth-child(3){padding-left:26px;white-space:nowrap}
.ugrv-card .act{opacity:0.7}
.ugrv-card kbd{display:inline-block;padding:1px 7px;border:1px solid rgba(255,255,255,0.25);border-radius:4px;background:rgba(255,255,255,0.1);font:11px/1.7 system-ui,sans-serif}
</style>
</head>
<body>
<div class="ugrv"><div class="stage"><img class="ugrv-a" src="${a}" alt="原图"><img class="ugrv-b" src="${b}" alt="对比图"></div>
<div class="ugrv-ring"></div>
<button class="ugrv-help">?</button>
<button class="ugrv-btn" data-pick="a">换底图</button>
<button class="ugrv-btn" data-pick="b">换对比图</button>
<div class="ugrv-help-mask"><div class="ugrv-card"><h3>快捷键</h3><table>
<tr><td><kbd>滚轮</kbd></td><td class="act">缩放</td><td><kbd>1</kbd>-<kbd>4</kbd></td><td class="act">切换模式</td></tr>
<tr><td><kbd>拖拽</kbd></td><td class="act">平移</td><td><kbd>[</kbd> <kbd>]</kbd> <kbd>,</kbd> <kbd>.</kbd></td><td class="act">光圈大小</td></tr>
<tr><td><kbd>双击</kbd></td><td class="act">复位</td><td><kbd>Ctrl</kbd>+<kbd>S</kbd></td><td class="act">保存图片</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>滚轮</kbd></td><td class="act">光圈大小</td><td><kbd>Ctrl</kbd>+<kbd>C</kbd></td><td class="act">复制图片</td></tr>
<tr><td><kbd>Tab</kbd></td><td class="act">互换底图/对比图</td><td></td><td></td></tr>
</table></div></div>
</div>
<script>
(function(){
var el=document.querySelector('.ugrv'),bi=el.querySelector('.ugrv-b'),x=0,y=0,q=false,size=${settings.size},s=1,tx=0,ty=0,pan=false,px=0,py=0,mode='${settings.mode}',fmt='${settings.exportFormat}',quality=${settings.exportQuality};
var stops=${stops};
function css(st){return 'radial-gradient(circle var(--ugrv-r) at var(--ugrv-x) var(--ugrv-y),'+st.map(function(p){return p[1]+' '+Math.round(p[0]*100)+'%'}).join(',')+')'}
var ring=el.querySelector('.ugrv-ring');
function ringVis(){var on=mode==='lens';ring.style.display=on?'block':'none';ring.style.opacity=on&&el.classList.contains('ugrv-in')?1:0}
function applyRing(){var r=size*s*0.78;ring.style.left=(tx+x*s-r)+'px';ring.style.top=(ty+y*s-r)+'px';ring.style.width=ring.style.height=r*2+'px'}
function setMode(m){mode=m;var g=css(stops[m]);bi.style.webkitMaskImage=g;bi.style.maskImage=g;el.style.cursor=m==='lens'?'none':'crosshair';ringVis()}
function apply(){q=false;el.style.setProperty('--ugrv-x',x+'px');el.style.setProperty('--ugrv-y',y+'px');applyRing()}
function applyT(){el.querySelector('.stage').style.transform='translate('+tx+'px,'+ty+'px) scale('+s+')';applyRing()}
function move(e){var r=el.getBoundingClientRect();x=(e.clientX-r.left-tx)/s;y=(e.clientY-r.top-ty)/s;if(!q){q=true;requestAnimationFrame(apply)}}
function show(e){move(e);el.classList.add('ugrv-in');ringVis()}
function hide(){el.classList.remove('ugrv-in');ringVis()}
function setSize(d){size=Math.max(50,Math.min(400,size+d));el.style.setProperty('--ugrv-size',size+'px');applyRing()}
el.addEventListener('pointerenter',show);
el.addEventListener('pointerleave',function(){if(!pan)hide()});
el.addEventListener('pointerdown',function(e){if(e.button!==0)return;pan=true;px=e.clientX-tx;py=e.clientY-ty;show(e)});
el.addEventListener('pointermove',function(e){if(pan){tx=e.clientX-px;ty=e.clientY-py;applyT()}move(e)});
addEventListener('pointerup',function(){if(!pan)return;pan=false;if(matchMedia('(hover:none)').matches)hide()});
el.addEventListener('dblclick',function(){s=1;tx=0;ty=0;applyT()});
el.addEventListener('dragstart',function(e){e.preventDefault()});
el.addEventListener('wheel',function(e){
  e.preventDefault();
  if(e.ctrlKey||pan){setSize(-e.deltaY*0.1);return}
  var r=el.getBoundingClientRect(),k=e.deltaY>0?1/1.1:1.1,ns=Math.min(10,Math.max(0.1,s*k)),f=ns/s;
  var cx=e.clientX-r.left,cy=e.clientY-r.top;
  tx=cx-(cx-tx)*f;ty=cy-(cy-ty)*f;s=ns;applyT();move(e);
});
// 合成整图(原图分辨率):底图 + 光圈内透出的对比图;未 hover 即纯原图
function composite(){
  var a=el.querySelector('.ugrv-a');
  if(!a.naturalWidth)return null;
  var w=el.clientWidth,h=el.clientHeight;
  function fit(im){var k=Math.min(w/im.naturalWidth,h/im.naturalHeight),iw=im.naturalWidth*k,ih=im.naturalHeight*k;return[(w-iw)/2,(h-ih)/2,iw,ih]}
  var ra=fit(a),fitK=a.naturalWidth/ra[2];
  var c=document.createElement('canvas');c.width=a.naturalWidth;c.height=a.naturalHeight;
  var ctx=c.getContext('2d');ctx.drawImage(a,0,0);
  if(el.classList.contains('ugrv-in')){
    var rb=fit(bi),t=document.createElement('canvas');t.width=c.width;t.height=c.height;
    var tc=t.getContext('2d');
    tc.drawImage(bi,(rb[0]-ra[0])*fitK,(rb[1]-ra[1])*fitK,rb[2]*fitK,rb[3]*fitK);
    tc.globalCompositeOperation='destination-in';
    var mx=(x-ra[0])*fitK,my=(y-ra[1])*fitK,g=tc.createRadialGradient(mx,my,0,mx,my,size*fitK);
    stops[mode].forEach(function(p){g.addColorStop(p[0],p[1])});
    tc.fillStyle=g;tc.fillRect(0,0,c.width,c.height);
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
// 换底图/换对比图:原生文件选择,选中后 objectURL 直接换 img.src
var fi=document.createElement('input');fi.type='file';fi.accept='image/*';fi.style.display='none';
var pickTarget=null;
fi.addEventListener('change',function(){if(fi.files[0]){pickTarget.src=URL.createObjectURL(fi.files[0])}fi.value=''});
el.querySelectorAll('.ugrv-btn[data-pick]').forEach(function(b){
  b.addEventListener('click',function(){pickTarget=el.querySelector('.ugrv-'+b.dataset.pick);fi.click()});
});
helpMask.addEventListener('click',toggleHelp);
addEventListener('keydown',function(e){
  if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();download();return}
  if((e.ctrlKey||e.metaKey)&&e.key==='c'){e.preventDefault();copy();return}
  if(e.key==='?'){toggleHelp();return}
  if(e.key==='Escape'&&helpMask.classList.contains('ugrv-on')){toggleHelp();return}
  if(e.key==='Tab'){e.preventDefault();var ai=el.querySelector('.ugrv-a'),t=ai.src;ai.src=bi.src;bi.src=t;return}
  if(e.key>='1'&&e.key<='4'){setMode(['torch','brush','spotlight','lens'][e.key-1]);return}
  if(e.key==='['||e.key===',')setSize(-10);
  if(e.key===']'||e.key==='.')setSize(10);
});
ringVis();
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
