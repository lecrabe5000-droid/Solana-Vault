// set the theme before first paint so the iPhone status bar never flashes the wrong colour
try{var t=localStorage.getItem("ecrin-theme"),w=localStorage.getItem("ecrin-wallet-web")||"";if(!t){t=/"theme":"light"/.test(w)?"light":/"theme":"ecrin"/.test(w)?"ecrin":""}
var c={light:"#f3f2ee",ecrin:"#0b1433"}[t];if(c){var r=document.documentElement;r.dataset.theme=t==="light"?"light":"dark";if(t==="ecrin")r.dataset.skin="ecrin";document.getElementById("boot-bg").textContent="html,body{background:"+c+";height:100%}";document.querySelector('meta[name="theme-color"]').content=c}}catch(e){}
