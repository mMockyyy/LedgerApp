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
  googleOAuthMobileRequestSchema,
  googleOAuthCallbackResponseSchema
} from "../contracts/apiContract";
import { env } from "../config/env";
import { User } from "../models/User";
import { asyncHandler } from "../utils/asyncHandler";
import { sendVerificationEmail } from "../services/emailService";
import { exchangeCodeForGoogleIdentity, verifyGoogleIdToken } from "../services/googleOauthService";

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

async function signInOrCreateGoogleUser(googleIdentity: { googleId: string; email: string; emailVerified: boolean }) {
  const normalizedEmail = googleIdentity.email.toLowerCase();

  if (!googleIdentity.emailVerified) {
    return { status: 403 as const, body: { message: "Google account email must be verified." } };
  }

  if (!normalizedEmail.endsWith("@gmail.com")) {
    return { status: 403 as const, body: { message: "Only Gmail accounts are allowed." } };
  }

  const existingByGoogleId = await User.findOne({ googleId: googleIdentity.googleId });
  if (existingByGoogleId) {
    existingByGoogleId.isEmailVerified = true;
    existingByGoogleId.provider = "google";
    existingByGoogleId.googleId = googleIdentity.googleId;
    await existingByGoogleId.save();

    const token = jwt.sign({ sub: existingByGoogleId.id }, env.JWT_SECRET, { expiresIn: "7d" });
    return {
      status: 200 as const,
      body: googleOAuthCallbackResponseSchema.parse({
        token,
        userId: existingByGoogleId.id,
        email: existingByGoogleId.email,
        isNewAccount: false
      })
    };
  }

  const existingByEmail = await User.findOne({ email: normalizedEmail });
  if (existingByEmail) {
    if (existingByEmail.googleId && existingByEmail.googleId !== googleIdentity.googleId) {
      return { status: 409 as const, body: { message: "This email is already linked to a different Google account." } };
    }

    existingByEmail.googleId = googleIdentity.googleId;
    existingByEmail.isEmailVerified = true;
    existingByEmail.emailVerificationToken = undefined;
    existingByEmail.emailVerificationTokenExpires = undefined;
    await existingByEmail.save();

    const token = jwt.sign({ sub: existingByEmail.id }, env.JWT_SECRET, { expiresIn: "7d" });
    return {
      status: 200 as const,
      body: googleOAuthCallbackResponseSchema.parse({
        token,
        userId: existingByEmail.id,
        email: existingByEmail.email,
        isNewAccount: false
      })
    };
  }

  const user = await User.create({
    email: normalizedEmail,
    passwordHash: null,
    isEmailVerified: true,
    provider: "google",
    googleId: googleIdentity.googleId
  });

  const token = jwt.sign({ sub: user.id }, env.JWT_SECRET, { expiresIn: "7d" });
  return {
    status: 200 as const,
    body: googleOAuthCallbackResponseSchema.parse({
      token,
      userId: user.id,
      email: user.email,
      isNewAccount: true
    })
  };
}

authRouter.post("/register", asyncHandler(async (req, res) => {
  const body = authSchema.parse(req.body);
  const disableEmailVerification = env.DISABLE_EMAIL_VERIFICATION === true;

  // Strict email validation
  if (!validate(body.email)) {
    return res.status(400).json({ message: "Invalid email format" });
  }

  const existing = await User.findOne({ email: body.email.toLowerCase() });
  if (existing) {
    return res.status(409).json({ message: "Email already registered" });
  }

  const passwordHash = await bcrypt.hash(body.password, 10);

  let token: string | undefined;
  let tokenHash: string | undefined;
  let tokenExpires: Date | undefined;

  if (!disableEmailVerification) {
    const generated = generateVerificationToken();
    token = generated.token;
    tokenHash = generated.hash;
    tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  }

  const user = await User.create({
    email: body.email,
    passwordHash,
    isEmailVerified: disableEmailVerification,
    emailVerificationToken: tokenHash,
    emailVerificationTokenExpires: tokenExpires
  });

  if (!disableEmailVerification && token) {
    // Send verification email. If it fails, roll back this registration so users
    // don't get stuck with an unverified account they cannot activate.
    try {
      await sendVerificationEmail(user.email, token);
    } catch (error) {
      console.error("Failed to send verification email:", error);
      await User.deleteOne({ _id: user._id });
      return res.status(502).json({
        message: "Could not send verification email. Please check mail settings and try again."
      });
    }
  }

  const payload = authRegisterResponseSchema.parse({
    id: user.id,
    email: user.email
  });
  return res.status(201).json({
    ...payload,
    message: disableEmailVerification
      ? "Registration successful. Email verification is temporarily disabled."
      : "Registration successful. Please check your email to verify your account."
  });
}));

authRouter.post("/login", asyncHandler(async (req, res) => {
  const body = authSchema.parse(req.body);
  const user = await User.findOne({ email: body.email.toLowerCase() });
  if (!user) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  // Check if email is verified
  if (!env.DISABLE_EMAIL_VERIFICATION && !user.isEmailVerified) {
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
  const payload = authLoginResponseSchema.parse({ token, userId: user.id, email: user.email });
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
  const result = await signInOrCreateGoogleUser(googleIdentity);
  return res.status(result.status).json(result.body);
}));

authRouter.post("/google/mobile", asyncHandler(async (req, res) => {
  const body = googleOAuthMobileRequestSchema.parse(req.body);

  let googleIdentity;
  try {
    googleIdentity = await verifyGoogleIdToken(body.idToken);
  } catch {
    return res.status(401).json({ message: "Invalid or expired Firebase ID token." });
  }

  const result = await signInOrCreateGoogleUser(googleIdentity);
  return res.status(result.status).json(result.body);
}));
