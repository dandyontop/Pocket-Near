import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { SignJWT, jwtVerify } from "jose";
import { env } from "./env.js";

const scrypt = promisify(scryptCallback);
const sessionKey = new TextEncoder().encode(env.SESSION_SECRET);
const toHex = (b: Buffer) => b.toString("hex");

export function verifyTelegramInitData(initData: string): { userId: number } {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("Telegram bot is not configured.");
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  const authDate = Number(params.get("auth_date"));
  if (!hash || !Number.isInteger(authDate)) throw new Error("Telegram launch data is malformed.");
  if (Math.abs(Date.now() / 1000 - authDate) > env.MAX_INIT_DATA_AGE_SECONDS) throw new Error("Telegram launch data has expired.");
  params.delete("hash");
  const checkString = [...params.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(env.TELEGRAM_BOT_TOKEN).digest();
  const expected = createHmac("sha256", secret).update(checkString).digest("hex");
  const a = Buffer.from(hash, "hex"), b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a,b)) throw new Error("Telegram launch signature is invalid.");
  const rawUser = params.get("user");
  if (!rawUser) throw new Error("Telegram launch is missing its user identity.");
  const user = JSON.parse(rawUser) as { id?: number };
  if (!Number.isSafeInteger(user.id) || !user.id) throw new Error("Telegram user identity is invalid.");
  return { userId: user.id };
}

export async function makeSession(telegramId: number): Promise<string> {
  return new SignJWT({ telegramId }).setProtectedHeader({ alg: "HS256" }).setSubject(String(telegramId)).setIssuedAt().setExpirationTime("12h").sign(sessionKey);
}
export async function readSession(token: string): Promise<number> {
  const { payload } = await jwtVerify(token, sessionKey, { algorithms: ["HS256"] });
  const id = Number(payload.telegramId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid session.");
  return id;
}

export async function makePasswordHash(password: string): Promise<{ salt: string; hash: string }> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64) as Buffer;
  return { salt: toHex(salt), hash: toHex(derived) };
}
export async function verifyPassword(password: string, saltHex: string, expectedHex: string): Promise<boolean> {
  const salt = Buffer.from(saltHex,"hex"), expected = Buffer.from(expectedHex,"hex");
  if (salt.length !== 16 || expected.length !== 64) return false;
  const actual = await scrypt(password,salt,64) as Buffer;
  return timingSafeEqual(actual,expected);
}
export function newNonce(): Uint8Array { return randomBytes(32); }
