import { Router } from "express";
import { z } from "zod";
import * as authService from "../services/auth.service";
import { env } from "../config/env";
import { AppError } from "../middleware/error";

const router = Router();

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, `Password must be at least 8 characters`),
});

router.post(`/register`, async (req, res, next) => {
  try {
    if (!env.ALLOW_REGISTER) {
      throw new AppError(403, `Registration is disabled on this server`);
    }
    const { email, password } = credentialsSchema.parse(req.body);
    const result = await authService.register(email, password);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.post(`/login`, async (req, res, next) => {
  try {
    const { email, password } = credentialsSchema.parse(req.body);
    const result = await authService.login(email, password);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
