import "dotenv/config";
import { z } from "zod";

const boolFromEnv = z
  .string()
  .default(`false`)
  .transform((s) => /^(1|true|yes|on)$/i.test(s.trim()));

const schema = z.object({
  NODE_ENV: z.enum([`development`, `production`, `test`]).default(`development`),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, `DATABASE_URL is required`),
  JWT_SECRET: z.string().min(16, `JWT_SECRET must be at least 16 characters`),
  JWT_EXPIRES_IN: z.string().default(`7d`),
  PLUGINS_DIR: z.string().default(`plugins`),
  ALLOW_REGISTER: boolFromEnv,
  POST_PROCESS_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(5),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error(`Invalid environment configuration:`);
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(`.`)}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
