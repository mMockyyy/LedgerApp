import bcrypt from "bcryptjs";
import crypto from "crypto";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { validate } from "email-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
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
        username: existingByGoogleId.username ?? null,
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
        username: existingByEmail.username ?? null,
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
      username: null,
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
  const payload = authLoginResponseSchema.parse({ token, userId: user.id, email: user.email, username: user.username ?? null });
  return res.json(payload);
}));

function verifyEmailHtml(success: boolean, message: string): string {
  const color = success ? "#22c55e" : "#ef4444";
  const icon = success ? "✓" : "✗";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${success ? "Email Verified" : "Verification Failed"}</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f9fafb; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 12px; box-shadow: 0 2px 16px rgba(0,0,0,0.08); padding: 40px 32px; max-width: 400px; width: 90%; text-align: center; }
    .icon { font-size: 48px; color: ${color}; margin-bottom: 16px; }
    h1 { font-size: 22px; color: #111; margin: 0 0 12px; }
    p { color: #555; font-size: 15px; line-height: 1.5; margin: 0 0 24px; }
    .hint { font-size: 13px; color: #999; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${success ? "Email Verified!" : "Verification Failed"}</h1>
    <p>${message}</p>
    <p class="hint">You can close this tab and go back to the app.</p>
  </div>
</body>
</html>`;
}

/**
 * Verify email with token from verification link
 */
authRouter.get("/verify-email", asyncHandler(async (req, res) => {
  const { token } = req.query;
  const wantsJson = req.headers.accept?.includes("application/json");

  if (!token || typeof token !== "string") {
    if (wantsJson) return res.status(400).json({ message: "Verification token is required" });
    return res.status(400).send(verifyEmailHtml(false, "Verification token is missing."));
  }

  // Hash the token to find the user
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const user = await User.findOne({
    emailVerificationToken: tokenHash,
    emailVerificationTokenExpires: { $gt: new Date() }
  });

  if (!user) {
    if (wantsJson) {
      return res.status(400).json({
        message: "Invalid or expired verification token. Please register again to get a new verification link."
      });
    }
    return res.status(400).send(verifyEmailHtml(false, "This verification link is invalid or has expired. Please request a new one from the app."));
  }

  // Mark email as verified and clear token
  user.isEmailVerified = true;
  user.emailVerificationToken = undefined;
  user.emailVerificationTokenExpires = undefined;
  await user.save();

  if (wantsJson) {
    const payload = authVerifyEmailResponseSchema.parse({
      message: "Email verified successfully! You can now log in."
    });
    return res.json(payload);
  }
  return res.send(verifyEmailHtml(true, "Your email has been verified. You can now log in to LedgerApp."));
}));

const resendVerificationSchema = z.object({
  email: z.string().email()
});

authRouter.post("/resend-verification", asyncHandler(async (req, res) => {
  const body = resendVerificationSchema.parse(req.body);
  const normalizedEmail = body.email.toLowerCase();

  const user = await User.findOne({ email: normalizedEmail });

  // Return 200 for unknown email or already-verified to prevent enumeration
  if (!user || user.isEmailVerified) {
    return res.status(200).json({ message: "If that email exists and is unverified, a new link has been sent." });
  }

  // Rate-limit: don't allow resend within 60 seconds of last token issuance
  if (user.emailVerificationTokenExpires) {
    const tokenAge = Date.now() - (user.emailVerificationTokenExpires.getTime() - 24 * 60 * 60 * 1000);
    if (tokenAge < 60 * 1000) {
      return res.status(429).json({ message: "Please wait a moment before requesting another verification email." });
    }
  }

  const { token, hash } = generateVerificationToken();
  user.emailVerificationToken = hash;
  user.emailVerificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await user.save();

  try {
    await sendVerificationEmail(user.email, token);
  } catch (error) {
    console.error("Failed to resend verification email:", error);
    return res.status(502).json({ message: "Could not send verification email. Please try again later." });
  }

  return res.status(200).json({ message: "If that email exists and is unverified, a new link has been sent." });
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
  } catch (err) {
    console.error("[google/mobile] Firebase token verification failed:", err);
    return res.status(401).json({ message: "Invalid or expired Firebase ID token." });
  }

  const result = await signInOrCreateGoogleUser(googleIdentity);
  return res.status(result.status).json(result.body);
}));

const updateProfileSchema = z.object({
  username: z.string().min(1).max(30).trim()
});

authRouter.patch("/profile", requireAuth, asyncHandler(async (req, res) => {
  const body = updateProfileSchema.parse(req.body);
  const user = await User.findById(req.userId);
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  user.username = body.username;
  await user.save();

  return res.json({ username: user.username });
}));
