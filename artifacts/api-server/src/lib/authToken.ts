import { createHmac, timingSafeEqual } from "node:crypto";

function getSecret(): string {
  const s = process.env["SESSION_SECRET"];
  if (!s) throw new Error("SESSION_SECRET is not set");
  return s;
}

function getPassword(): string {
  return process.env["DASHBOARD_PASSWORD"] ?? "";
}

export function generateToken(): string {
  const payload = `dashboard:${getPassword()}`;
  return createHmac("sha256", getSecret()).update(payload).digest("hex");
}

export function verifyToken(token: string): boolean {
  if (!token) return false;
  try {
    const expected = generateToken();
    const a = Buffer.from(token.padEnd(64, "0").slice(0, 64), "hex");
    const b = Buffer.from(expected.padEnd(64, "0").slice(0, 64), "hex");
    return timingSafeEqual(a, b) && token === expected;
  } catch {
    return false;
  }
}
