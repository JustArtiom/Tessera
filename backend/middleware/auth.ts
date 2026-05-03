import type { RequestHandler } from "express";
import { verifyToken } from "../lib/jwt";
import { AppError } from "./error";

export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith(`Bearer `)) {
    return next(new AppError(401, `Missing or malformed Authorization header`));
  }
  const token = header.slice(`Bearer `.length).trim();
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    next(new AppError(401, `Invalid or expired token`));
  }
};
