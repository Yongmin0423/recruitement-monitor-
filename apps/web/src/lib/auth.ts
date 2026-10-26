import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const COOKIE_NAME = "recruitment_session";
const SECONDS = 60 * 60 * 24 * 7;

function sign(expires: string): string | null {
  const secret = process.env.SESSION_SECRET;
  return secret && secret.length >= 32
    ? createHmac("sha256", secret).update("v1:" + expires).digest("base64url")
    : null;
}

export function verifyPassword(password: string): boolean {
  const [scheme, salt, hex] = (process.env.PERSONAL_PASSWORD_HASH ?? "").split("$");
  if (scheme !== "scrypt" || !salt || !/^[0-9a-f]{128}$/i.test(hex ?? "")) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function newSession(): { value: string; maxAge: number } {
  const expires = String(Date.now() + SECONDS * 1000);
  const mac = sign(expires);
  if (!mac) throw new Error("SESSION_SECRET 설정이 필요합니다.");
  return { value: expires + "." + mac, maxAge: SECONDS };
}

export function validSession(value: string | undefined): boolean {
  if (!value) return false;
  const [expires, given] = value.split(".");
  if (!/^\d{13}$/.test(expires ?? "") || !given || Number(expires) <= Date.now()) return false;
  const expected = sign(expires);
  if (!expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function isAuthenticated(): Promise<boolean> {
  return validSession((await cookies()).get(COOKIE_NAME)?.value);
}
