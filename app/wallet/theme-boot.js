// set the theme before first paint so the iPhone status bar never flashes the wrong colour
try{var t=localStorage.getItem("ecrin-theme"),w=localStorage.getItem("ecrin-wallet-web")||"";if(!t){t=/"theme":"light"/.test(w)?"light":/"theme":"ecrin"/.test(w)?"ecrin":""}
var c={light:"#f3f2ee",ecrin:"#070b1d"}[t];if(c){var r=document.documentElement;r.dataset.theme=t==="light"?"light":"dark";if(t==="ecrin")r.dataset.skin="ecrin";document.getElementById("boot-bg").textContent="html,body{background:"+c+";height:100%}";document.querySelector('meta[name="theme-color"]').content=c}}catch(e){}

// The stylesheet didn't load (a dropped connection): try again, twice, before saying so.
(function ensureCss(n){try{var ok=[].some.call(document.styleSheets,function(x){try{return /\/wallet\/wallet\.css/.test(x.href||"")&&x.cssRules.length>0}catch(e){return false}});var R=document.documentElement;if(ok){R.classList.add("css-ok");return}
var l=document.createElement("link");l.rel="stylesheet";l.href="/wallet/wallet.css?r="+Date.now();l.onload=function(){R.classList.remove("css-fail");R.classList.add("css-ok")};l.onerror=function(){if(n<2)setTimeout(function(){ensureCss(n+1)},1500);else document.documentElement.classList.add("css-fail")};document.head.appendChild(l)}catch(e){}})(0);
