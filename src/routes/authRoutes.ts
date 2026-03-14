import bcrypt from "bcryptjs";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { authLoginResponseSchema, authRegisterResponseSchema } from "../contracts/apiContract";
import { env } from "../config/env";
import { User } from "../models/User";
import { asyncHandler } from "../utils/asyncHandler";

export const authRouter = Router();

const authSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

authRouter.post("/register", asyncHandler(async (req, res) => {
  const body = authSchema.parse(req.body);
  const existing = await User.findOne({ email: body.email.toLowerCase() });
  if (existing) {
    return res.status(409).json({ message: "Email already registered" });
  }

  const passwordHash = await bcrypt.hash(body.password, 10);
  const user = await User.create({ email: body.email, passwordHash });

  const payload = authRegisterResponseSchema.parse({ id: user.id, email: user.email });
  return res.status(201).json(payload);
}));

authRouter.post("/login", asyncHandler(async (req, res) => {
  const body = authSchema.parse(req.body);
  const user = await User.findOne({ email: body.email.toLowerCase() });
  if (!user) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const matches = await bcrypt.compare(body.password, user.passwordHash);
  if (!matches) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const token = jwt.sign({ sub: user.id }, env.JWT_SECRET, { expiresIn: "7d" });
  const payload = authLoginResponseSchema.parse({ token });
  return res.json(payload);
}));
