import bcrypt from "bcryptjs";
import crypto from "crypto";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { validate } from "email-validator";
import { z } from "zod";
import {
  authLoginResponseSchema,
  authRegisterResponseSchema,
  authVerifyEmailResponseSchema,
  googleOAuthCallbackRequestSchema,
  googleOAuthCallbackResponseSchema
} from "../contracts/apiContract";
import { env } from "../config/env";
import { User } from "../models/User";
import { asyncHandler } from "../utils/asyncHandler";
import { sendVerificationEmail } from "../services/emailService";
import { exchangeCodeForGoogleIdentity } from "../services/googleOauthService";

export const authRouter = Router();

const authSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

/**
 * Generate a verification token and return both the plain token and its hash
 */
function generateVerificationToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  return { token, hash };
}

authRouter.post("/register", asyncHandler(async (req, res) => {
  const body = authSchema.parse(req.body);

  // Strict email validation
  if (!validate(body.email)) {
    return res.status(400).json({ message: "Invalid email format" });
  }

  const existing = await User.findOne({ email: body.email.toLowerCase() });
  if (existing) {
    return res.status(409).json({ message: "Email already registered" });
  }

  const passwordHash = await bcrypt.hash(body.password, 10);

  // Generate verification token
  const { token, hash } = generateVerificationToken();
  const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  const user = await User.create({
    email: body.email,
    passwordHash,
    isEmailVerified: false,
    emailVerificationToken: hash,
    emailVerificationTokenExpires: tokenExpires
  });

  // Send verification email
  try {
    await sendVerificationEmail(user.email, token);
  } catch (error) {
    console.error("Failed to send verification email:", error);
    // Don't fail registration if email sending fails, but log it
  }

  const payload = authRegisterResponseSchema.parse({
    id: user.id,
    email: user.email
  });
  return res.status(201).json({
    ...payload,
    message: "Registration successful. Please check your email to verify your account."
  });
}));

authRouter.post("/login", asyncHandler(async (req, res) => {
  const body = authSchema.parse(req.body);
  const user = await User.findOne({ email: body.email.toLowerCase() });
  if (!user) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  // Check if email is verified
  if (!user.isEmailVerified) {
    return res.status(403).json({
      message: "Please verify your email before logging in. Check your inbox for the verification link."
    });
  }

  if (!user.passwordHash) {
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

/**
 * Verify email with token from verification link
 */
authRouter.get("/verify-email", asyncHandler(async (req, res) => {
  const { token } = req.query;

  if (!token || typeof token !== "string") {
    return res.status(400).json({ message: "Verification token is required" });
  }

  // Hash the token to find the user
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const user = await User.findOne({
    emailVerificationToken: tokenHash,
    emailVerificationTokenExpires: { $gt: new Date() }
  });

  if (!user) {
    return res.status(400).json({
      message: "Invalid or expired verification token. Please register again to get a new verification link."
    });
  }

  // Mark email as verified and clear token
  user.isEmailVerified = true;
  user.emailVerificationToken = undefined;
  user.emailVerificationTokenExpires = undefined;
  await user.save();

  const payload = authVerifyEmailResponseSchema.parse({
    message: "Email verified successfully! You can now log in."
  });
  return res.json(payload);
}));

authRouter.post("/google/callback", asyncHandler(async (req, res) => {
  const body = googleOAuthCallbackRequestSchema.parse(req.body);

  const googleIdentity = await exchangeCodeForGoogleIdentity(body.code);
  const normalizedEmail = googleIdentity.email.toLowerCase();

  if (!googleIdentity.emailVerified) {
    return res.status(403).json({ message: "Google account email must be verified." });
  }

  if (!normalizedEmail.endsWith("@gmail.com")) {
    return res.status(403).json({ message: "Only Gmail accounts are allowed." });
  }

  const existingByGoogleId = await User.findOne({ googleId: googleIdentity.googleId });
  if (existingByGoogleId) {
    existingByGoogleId.isEmailVerified = true;
    existingByGoogleId.provider = "google";
    existingByGoogleId.googleId = googleIdentity.googleId;
    await existingByGoogleId.save();

    const token = jwt.sign({ sub: existingByGoogleId.id }, env.JWT_SECRET, { expiresIn: "7d" });
    const payload = googleOAuthCallbackResponseSchema.parse({
      token,
      email: existingByGoogleId.email,
      isNewAccount: false
    });
    return res.json(payload);
  }

  const existingByEmail = await User.findOne({ email: normalizedEmail });
  if (existingByEmail) {
    if (existingByEmail.googleId && existingByEmail.googleId !== googleIdentity.googleId) {
      return res.status(409).json({ message: "This email is already linked to a different Google account." });
    }

    existingByEmail.googleId = googleIdentity.googleId;
    existingByEmail.isEmailVerified = true;
    existingByEmail.emailVerificationToken = undefined;
    existingByEmail.emailVerificationTokenExpires = undefined;
    await existingByEmail.save();

    const token = jwt.sign({ sub: existingByEmail.id }, env.JWT_SECRET, { expiresIn: "7d" });
    const payload = googleOAuthCallbackResponseSchema.parse({
      token,
      email: existingByEmail.email,
      isNewAccount: false
    });
    return res.json(payload);
  }

  const user = await User.create({
    email: normalizedEmail,
    passwordHash: null,
    isEmailVerified: true,
    provider: "google",
    googleId: googleIdentity.googleId
  });

  const token = jwt.sign({ sub: user.id }, env.JWT_SECRET, { expiresIn: "7d" });
  const payload = googleOAuthCallbackResponseSchema.parse({
    token,
    email: user.email,
    isNewAccount: true
  });
  return res.json(payload);
}));
