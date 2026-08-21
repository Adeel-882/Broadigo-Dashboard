import { randomBytes, scrypt as callback } from "node:crypto";
import { promisify } from "node:util";

const password = process.argv[2];
if (!password) throw new Error("Usage: pnpm auth:hash -- \"your-password\"");
const salt = randomBytes(16);
const hash = await promisify(callback)(password, salt, 64);
console.log(`${salt.toString("hex")}:${hash.toString("hex")}`);
