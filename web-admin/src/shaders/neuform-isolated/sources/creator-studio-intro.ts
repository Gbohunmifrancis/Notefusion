export const creatorStudioIntroRaw = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Creator Studio — Keynote Motion Study</title>
<meta name="description" content="Self-contained 30-second keynote-style motion study: twenty-one beats of kinetic type, device mockups and app props on black.">
<style>
  :root{
    --ink:#f5f5f7;
    --font:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Helvetica Neue",Helvetica,Arial,sans-serif;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%;overflow:hidden;background:#000}
  body{display:grid;place-items:center;font-family:var(--font);color:var(--ink)}
  .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  #stage{position:relative;width:min(100vw,177.78vh);aspect-ratio:16/9;overflow:hidden;background:#000}
  #comp{position:absolute;left:50%;top:50%;width:1280px;height:720px;margin:-360px 0 0 -640px;transform-origin:50% 50%}
  .scene{position:absolute;inset:0;display:none}
  .scene.on{display:block}

  /* ---------- type ---------- */
  .line{position:absolute;inset:0;pointer-events:none}
  .tx{position:absolute;left:0;right:0;top:50%;text-align:center;white-space:nowrap;
      font-weight:600;letter-spacing:-.012em;line-height:1;transform:translateY(-50%);
      will-change:transform,opacity,filter}
  .tx span{display:inline-block;will-change:transform,opacity,filter}
  #ruler{position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;
         font-weight:600;letter-spacing:-.012em;line-height:1;font-size:100px}

  .mark{display:inline-block;vertical-align:-.07em;margin-right:.14em}
  .mark svg{display:block;width:.8em;height:.8em}
</style>
</head>
<body>
<p class="sr">A thirty-second keynote-style motion study on black. A chromatic wordmark assembles, a wall of creative app windows drifts past, then twenty short type beats follow — one subscription, endless creativity, a dock of apps, a three-track beat, editing a video, taking your design anywhere, and quick verbs from Prompt it to Share it — closing on a price, a scrolling list of app names, and the Creator Studio wordmark.</p>
<div id="stage">
  <div id="comp"></div>
</div>
<span id="ruler" aria-hidden="true"></span>
<script>
(function(){
  "use strict";
  var DUR=30.122, W=1280, H=720;
  var comp=document.getElementById('comp'), stage=document.getElementById('stage'), ruler=document.getElementById('ruler');

  /* ---------- math ---------- */
  var clamp=function(v,a,b){return v<a?a:(v>b?b:v)};
  var lerp=function(a,b,t){return a+(b-a)*t};
  var seg=function(t,a,b){return clamp((t-a)/(b-a||1e-6),0,1)};
  var smooth=function(t){return t*t*(3-2*t)};
  var eOut=function(t){return 1-Math.pow(1-t,3)};
  function rng(s){var a=s>>>0;return function(){a+=0x6D2B79F5;var t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}

  /* ---------- dom ---------- */
  function el(tag,cls,parent,html){
    var n=document.createElement(tag);
    if(cls)n.className=cls;
    if(html!=null)n.innerHTML=html;
    (parent||comp).appendChild(n);
    return n;
  }
  function setT(n,v){if(n._t!==v){n._t=v;n.style.transform=v}}
  function setO(n,v){var r=clamp(v,0,1).toFixed(3);if(n._o!==r){n._o=r;n.style.opacity=r}}
  function setF(n,v){if(n._f!==v){n._f=v;n.style.filter=v}}

  function fitPx(str,target,weight){
    ruler.style.fontWeight=weight||600;
    ruler.style.fontSize='100px';
    ruler.textContent=str;
    return 100*target/ruler.getBoundingClientRect().width;
  }

  var APPLE='<svg viewBox="0 0 24 24" aria-hidden="true">'+
    '<path fill="currentColor" d="M17.1 12.7c0-2.6 2.1-3.9 2.2-4-1.2-1.8-3.1-2-3.7-2.1-1.7-.1-3.3 1-4.1 1-.8 0-2.1-1-3.5-1-1.8 0-3.6 1.1-4.5 2.8-1.9 3.4-.5 8.4 1.4 11.2 1 1.3 2.1 2.8 3.6 2.7 1.4 0 1.9-.9 3.6-.9s2.1.9 3.6.9c1.5 0 2.4-1.3 3.3-2.7 1.1-1.5 1.5-3 1.5-3.1-.1 0-3.4-1.3-3.4-4.8z"/>'+
    '<path fill="currentColor" d="M14.6 4.9c.8-.9 1.3-2.2 1.1-3.5-1.1.1-2.5.8-3.3 1.7-.7.9-1.3 2.2-1.1 3.4 1.2.1 2.5-.6 3.3-1.6z"/></svg>';

  /* 1 + 21 · wordmark, chromatic assemble */
  function makeWordmark(){
    var s=el('div','scene');
    var wrap=el('div','line',s);
    var tx=el('div','tx',wrap);
    var fs=fitPx('Creator Studio',678);
    tx.style.fontSize=fs.toFixed(2)+'px';
    var mk=el('span','mark',tx,APPLE);
    var chars=[], str='Creator Studio';
    for(var i=0;i<str.length;i++){
      var sp=document.createElement('span');
      sp.textContent=str[i]===' '?'\\u00a0':str[i];
      tx.appendChild(sp); chars.push(sp);
    }
    var R=rng(7719), jit=chars.map(function(){return [R()*2-1,R()*2-1,R()]});
    return {node:s, update:function(t,p){
      setO(mk,smooth(seg(p,.26,.5)));
      setT(mk,'scale('+lerp(.55,1,eOut(seg(p,.26,.56))).toFixed(3)+')');
      for(var i=0;i<chars.length;i++){
        var j=jit[i];
        var a=eOut(clamp(seg(p,.02,.5)*1.5-j[2]*.5,0,1));
        setT(chars[i],'translate('+(j[0]*62*(1-a)).toFixed(1)+'px,'+(j[1]*34*(1-a)).toFixed(1)+'px) scale('+lerp(1.24,1,a).toFixed(3)+')');
        setO(chars[i],Math.min(1,a*1.6));
        var sep=(1-a)*11;
        chars[i].style.textShadow=sep>.4
          ? (-sep).toFixed(1)+'px 0 rgba(255,64,72,.85),'+sep.toFixed(1)+'px 0 rgba(64,255,190,.8),0 '+(sep*.55).toFixed(1)+'px rgba(96,124,255,.8)'
          : 'none';
        setF(chars[i],sep>.7?'blur('+(sep*.3).toFixed(2)+'px)':'none');
      }
    }};
  }

  var SCENES=[
    {a:0.00,  b:DUR,  s:makeWordmark()}
  ];

  var active=null;
  function render(t){
    var k=Math.min((stage.clientWidth||W)/W,(stage.clientHeight||H)/H);
    comp.style.transform='scale('+k.toFixed(4)+')';
    for(var i=0;i<SCENES.length;i++){
      var sc=SCENES[i];
      if(t>=sc.a && t<sc.b){
        if(active!==sc){
          if(active) active.s.node.classList.remove('on');
          sc.s.node.classList.add('on');
          active=sc;
        }
        sc.s.update(t-sc.a, seg(t,sc.a,sc.b));
        return;
      }
    }
  }

  var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var start=null, raf=0, playing=!reduce, held=false, at=0;
  function seek(t){at=((t%DUR)+DUR)%DUR;render(at);return at}
  function play(){if(playing&&raf)return;playing=true;start=performance.now()-at*1000;if(!raf)raf=requestAnimationFrame(tick)}
  function pause(){playing=false;if(raf){cancelAnimationFrame(raf);raf=0}}
  function tick(now){
    if(!playing){raf=0;return}
    raf=requestAnimationFrame(tick);
    if(start===null)start=now;
    at=((now-start)/1000)%DUR;
    render(at);
  }
  window.addEventListener('resize',function(){render(at)});
  if(reduce){ seek(29.6) } else {
    raf=requestAnimationFrame(tick);
    document.addEventListener('visibilitychange',function(){
      if(document.hidden){ if(playing){held=true;pause()} }
      else if(held){ held=false; play() }
    });
  }
  window.__DUR=DUR;
  window.__seek=function(t){pause();return seek(t)};
  window.__play=play; window.__pause=pause; window.__time=function(){return at};
})();
<` + `/script>
</body>
</html>
`;
