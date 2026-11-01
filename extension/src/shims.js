// @solana/web3.js expects Node's Buffer as a global in some paths.
import { Buffer } from "buffer";
if (!globalThis.Buffer) globalThis.Buffer = Buffer;
export { Buffer };
