import os

script_to_inject = '''
<!-- Page Pulse Tracking Script -->
<script>
(function(){
  if(window.self!==window.top)return;
  var pid="de747350-3af4-474a-92d7-985d10d3af14";
  var tk="e1859ec4-1591-4d08-8747-3f983a7ce9ec";
  var ep="https://esnubozrjxrbegatzusu.supabase.co/functions/v1/track";
  var sid=sessionStorage.getItem("_pp_sid")||Math.random().toString(36).slice(2);
  sessionStorage.setItem("_pp_sid",sid);
  var vid=localStorage.getItem("_pp_vid")||Math.random().toString(36).slice(2);
  localStorage.setItem("_pp_vid",vid);
  var lastUrl=location.href;
  function send(t,n){
    fetch(ep,{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({page_id:pid,token:tk,url:location.href,referrer:document.referrer,
        user_agent:navigator.userAgent,screen_width:screen.width,
        session_id:sid,visitor_id:vid,event_type:t,element_name:n||null})});
  }
  send("pageview");
  document.addEventListener("click",function(e){
    var el=e.target.closest("a,button,[role='button'],input[type='submit']");
    if(!el)return;
    var p=el;while(p){var s=getComputedStyle(p);if(s.position==="fixed"||s.position==="sticky"){var r=p.getBoundingClientRect();if(r.width>window.innerWidth*0.4&&r.height>window.innerHeight*0.3)return;}p=p.parentElement;}
    var name=el.getAttribute("data-pp")||el.innerText||el.getAttribute("aria-label")||el.tagName;
    if(name)send("click",name.trim().substring(0,100));
  });
  function checkUrl(){if(location.href!==lastUrl){lastUrl=location.href;send("pageview");}}
  var origPush=history.pushState;history.pushState=function(){origPush.apply(this,arguments);checkUrl();};
  var origReplace=history.replaceState;history.replaceState=function(){origReplace.apply(this,arguments);checkUrl();};
  window.addEventListener("popstate",checkUrl);
  setInterval(function(){if(!document.hidden)send("ping");},15000);
  var _cc={};
  function trackConversion(label){var k=label||"_";if(_cc[k])return;_cc[k]=1;send("conversion",label||null);}
  window.PagePulse=window.PagePulse||{};
  window.PagePulse.trackConversion=trackConversion;
  window.pagePulse=window.PagePulse;
  /* Web Vitals: LCP, CLS, INP, page load time */
  var _v={cls:0,inp:0};
  try{
    if(window.PerformanceObserver){
      try{new PerformanceObserver(function(l){var e=l.getEntries();if(e.length)_v.lcp=Math.round(e[e.length-1].startTime);}).observe({type:"largest-contentful-paint",buffered:true});}catch(e){}
      try{new PerformanceObserver(function(l){l.getEntries().forEach(function(e){if(!e.hadRecentInput)_v.cls+=e.value;});}).observe({type:"layout-shift",buffered:true});}catch(e){}
      try{new PerformanceObserver(function(l){l.getEntries().forEach(function(e){if(e.duration>_v.inp)_v.inp=Math.round(e.duration);});}).observe({type:"event",buffered:true,durationThreshold:40});}catch(e){}
    }
  }catch(e){}
  function flushVitals(){
    if(_v._sent)return;_v._sent=1;
    try{var nt=performance.getEntriesByType&&performance.getEntriesByType("navigation")[0];if(nt&&nt.loadEventEnd)_v.load=Math.round(nt.loadEventEnd);}catch(e){}
    var dt=(screen.width&&screen.width<768)?"mobile":"desktop";
    var payload={page_id:pid,token:tk,url:location.href,session_id:sid,event_type:"vitals",vitals:{lcp:_v.lcp||null,cls:_v.cls?Math.round(_v.cls*1000)/1000:null,inp:_v.inp||null,load_time:_v.load||null,device_type:dt}};
    try{if(navigator.sendBeacon){navigator.sendBeacon(ep,new Blob([JSON.stringify(payload)],{type:"application/json"}));}else{fetch(ep,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),keepalive:true});}}catch(e){}
  }
  addEventListener("visibilitychange",function(){if(document.visibilityState==="hidden")flushVitals();});
  addEventListener("pagehide",flushVitals);
})();
</script>
<!-- End Page Pulse Tracking Script -->
</body>
'''

files = [
    "web-site/delete-account/index.html",
    "web-site/privacy/index.html",
    "web-site/reset-password/index.html",
    "web-site/terms/index.html"
]

for f in files:
    if os.path.exists(f):
        with open(f, 'r', encoding='utf-8') as file:
            content = file.read()
        
        # Only replace if not already injected
        if "Page Pulse Tracking Script" not in content:
            content = content.replace("</body>", script_to_inject)
            with open(f, 'w', encoding='utf-8') as file:
                file.write(content)
            print(f"Updated {f}")
        else:
            print(f"Already updated {f}")
