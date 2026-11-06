// Official program and contract addresses, listed on the security pages (a file, because the site's CSP blocks inline scripts).
import { CONFIG } from "/config.js";
import { EVM_NETS } from "/config-evm.js";
const box = document.querySelector("[data-addresses]");
if (box) {
  const fr = document.documentElement.lang === "fr";
  const rows = [["Solana Devnet", fr ? "programme" : "program", CONFIG.programId, `https://explorer.solana.com/address/${CONFIG.programId}?cluster=devnet`],
    ...Object.values(EVM_NETS).filter((n) => n.address).map((n) => [`${n.name} ${n.net}`, fr ? "contrat" : "contract", n.address, `${n.explorer}/address/${n.address}`])];
  box.innerHTML = rows.map(([net, kind, a, url]) => `<a class="addr-item" href="${url}" target="_blank" rel="noopener"><span><b>${net}</b><small>${kind}</small></span><code>${a}</code></a>`).join("");
}
