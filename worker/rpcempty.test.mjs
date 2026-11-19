import assert from "node:assert/strict";
import { handleRpc } from "./rpc.js";
const r = await handleRpc(new Request("https://x/api/rpc/solm", { method: "POST", body: "[]" }), {}, "solm");
assert.equal(r.status, 200); assert.deepEqual(await r.json(), []);
console.log("rpc empty batch ok");
