(()=>{var s="ecrin-wallet",a=location.origin==="null"?"*":location.origin,i=e=>window.postMessage({ch:s,dir:"out",...e},a);window.addEventListener("message",e=>{let t=e.data;e.source!==window||!t||t.ch!==s||t.dir!=="in"||typeof t.id!="string"||chrome.runtime.sendMessage({type:"dapp",fam:t.fam==="sol"?"sol":"evm",method:String(t.method),params:t.params}).then(o=>i({id:t.id,...o||{error:{code:4900,message:"Ecrin Wallet didn't answer."}}})).catch(()=>i({id:t.id,error:{code:4900,message:"Ecrin Wallet was updated or restarted. Reload this page."}}))});chrome.runtime.onMessage.addListener(e=>{e?.type==="dapp-event"&&(!e.origin||e.origin===location.origin)&&i({event:e.event,fam:e.fam,data:e.data})});window.top===window&&/^https?:$/.test(location.protocol)&&chrome.runtime.sendMessage({type:"check-site"}).then(e=>{e?.phish&&r(e)}).catch(()=>{});function r(e){let t=document.createElement("ecrin-shield"),o=t.attachShadow({mode:"closed"});o.innerHTML=`<style>
    :host { all: initial; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; }
    .w { position: fixed; inset: 0; display: grid; place-items: center; padding: 24px; background: #000; color: #fff; font: 400 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
    .c { max-width: 520px; }
    .k { display: inline-flex; align-items: center; gap: 10px; color: #ff6b6b; font-size: 13px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: 16px 0 12px; font-size: 34px; line-height: 1.1; letter-spacing: -.02em; font-weight: 600; }
    p { margin: 0 0 12px; color: #a0a0a0; } b { color: #fff; font-weight: 600; } code { color: #fff; }
    .row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-top: 28px; }
    button { height: 48px; padding: 0 22px; border: 0; border-radius: 999px; background: #2f5bff; color: #fff; font: 600 15px system-ui, sans-serif; cursor: pointer; }
    .ig { height: auto; padding: 0; background: none; color: #707070; font-weight: 400; font-size: 13px; text-decoration: underline; }
  </style>
  <div class="w"><div class="c">
    <span class="k">\u25CF Ecrin Wallet \xB7 phishing warning</span>
    <h1>This site is on a phishing list.</h1>
    <p><code></code> is listed as a scam site. Sites like this copy real apps to trick you into signing away your money.</p>
    <p>Ecrin blocked it before anything happened. <b>Don't enter your recovery phrase or approve anything here.</b></p>
    <div class="row"><button class="go">Get me out of here</button><button class="ig">I understand the risk, show the site</button></div>
  </div></div>`,o.querySelector("code").textContent=location.hostname,o.querySelector(".go").onclick=()=>{history.length>1&&history.back(),setTimeout(()=>location.replace("https://ecrinprotocol.app/"),300)},o.querySelector(".ig").onclick=()=>{chrome.runtime.sendMessage({type:"allow-site"}).catch(()=>{}),t.remove()};let n=()=>(document.documentElement||document).appendChild(t);document.documentElement?n():document.addEventListener("readystatechange",n,{once:!0})}})();
