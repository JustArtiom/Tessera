import { Router } from "express";
import { env } from "../config/env";

const router = Router();

// Public — no auth. Exposes only flags the frontend needs to render correctly.
router.get(`/`, (_req, res) => {
  res.json({
    allowRegister: env.ALLOW_REGISTER,
  });
});

export default router;
