import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { signToken } from "../lib/jwt";
import { AppError } from "../middleware/error";

const BCRYPT_ROUNDS = 10;

export interface AuthResult {
  token: string;
  user: { id: string; email: string };
}

export async function register(email: string, password: string): Promise<AuthResult> {
  const normalized = email.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email: normalized } });
  if (existing) {
    throw new AppError(409, `Email already registered`);
  }
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await prisma.user.create({
    data: { email: normalized, passwordHash },
    select: { id: true, email: true },
  });
  const token = signToken({ sub: user.id, email: user.email });
  return { token, user };
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const normalized = email.toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user) {
    throw new AppError(401, `Invalid email or password`);
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    throw new AppError(401, `Invalid email or password`);
  }
  const token = signToken({ sub: user.id, email: user.email });
  return { token, user: { id: user.id, email: user.email } };
}
