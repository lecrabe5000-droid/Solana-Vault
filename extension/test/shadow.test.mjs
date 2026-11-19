// A local function with the same name as an import silently calls itself instead of the import
// (approve.js did this with evmProvider: every website transaction failed). Check every source file.
import fs from "node:fs";
import assert from "node:assert";
const dir = new URL("../src/", import.meta.url);
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js"))) {
  const s = fs.readFileSync(new URL(f, dir), "utf8");
  const names = [...s.matchAll(/^import\s*\{([^}]*)\}/gm)].flatMap((m) => m[1].split(",").map((x) => x.trim().split(/\s+as\s+/).pop()).filter(Boolean));
  for (const n of names) assert(!new RegExp(`(function\\s+${n}\\s*\\(|(const|let)\\s+${n}\\s*=)`).test(s), `${f}: "${n}" is imported and also defined locally`);
}
console.log("shadow ok");
