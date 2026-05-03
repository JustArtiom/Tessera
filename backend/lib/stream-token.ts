import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env";

const STREAM_TTL_SECONDS = 4 * 60 * 60; // 4h

export function signStreamToken(downloadId: string, userId: string): string {
  const opts: SignOptions = { expiresIn: STREAM_TTL_SECONDS, audience: `stream:${downloadId}` };
  return jwt.sign({ sub: userId }, env.JWT_SECRET, opts);
}

export function verifyStreamToken(token: string, downloadId: string): { sub: string } {
  const decoded = jwt.verify(token, env.JWT_SECRET, {
    audience: `stream:${downloadId}`,
  });
  if (typeof decoded === `string` || !decoded || typeof decoded.sub !== `string`) {
    throw new Error(`Invalid stream token`);
  }
  return { sub: decoded.sub };
}
