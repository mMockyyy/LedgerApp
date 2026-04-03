import nodemailer from "nodemailer";
import { lookup } from "node:dns/promises";
import { env } from "../config/env";

type MailError = Error & {
  code?: string;
  command?: string;
  response?: string;
  responseCode?: number;
};

function resolvePublicBaseUrl(): string {
  if (env.APP_URL) {
    return env.APP_URL;
  }

  if (env.RENDER_EXTERNAL_URL) {
    return env.RENDER_EXTERNAL_URL;
  }

  if (env.NODE_ENV !== "production") {
    return "http://localhost:3000";
  }

  throw new Error("Missing APP_URL or RENDER_EXTERNAL_URL in production environment");
}

async function createTransporter() {
  const smtpHost = env.EMAIL_HOST;
  const smtpPort = env.EMAIL_PORT;
  const isSecure = env.EMAIL_SECURE || false;

  // Render commonly has no outbound IPv6 route. Resolve SMTP host to IPv4 first.
  try {
    const resolved = await lookup(smtpHost, { family: 4 });
    return nodemailer.createTransport({
      host: resolved.address,
      port: smtpPort,
      secure: isSecure,
      auth: {
        user: env.EMAIL_USER,
        pass: env.EMAIL_PASSWORD,
      },
      tls: {
        servername: smtpHost
      },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000
    });
  } catch {
    // Fallback to hostname resolution if IPv4 lookup fails.
    return nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: isSecure,
      auth: {
        user: env.EMAIL_USER,
        pass: env.EMAIL_PASSWORD,
      },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000
    });
  }
}

/**
 * Send verification email to user with a token link
 * @param email - Recipient email address
 * @param token - Verification token to include in the link
 */
export async function sendVerificationEmail(
  email: string,
  token: string
): Promise<void> {
  const baseUrl = resolvePublicBaseUrl();
  const verificationUrl = `${baseUrl}/auth/verify-email?token=${token}`;

  const mailOptions = {
    from: env.EMAIL_FROM,
    to: email,
    subject: "Verify Your Email Address",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2>Verify Your Email Address</h2>
        <p>Welcome to LedgerApp! Please verify your email address to activate your account.</p>
        <p>
          <a href="${verificationUrl}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">
            Verify Email
          </a>
        </p>
        <p>Or copy and paste this link in your browser:</p>
        <p><code>${verificationUrl}</code></p>
        <p style="font-size: 12px; color: #666;">This link will expire in 24 hours.</p>
        <p style="font-size: 12px; color: #666;">If you didn't create this account, please ignore this email.</p>
      </div>
    `,
    text: `
      Verify Your Email Address

      Welcome to LedgerApp! Please verify your email address to activate your account.

      Verification link: ${verificationUrl}

      This link will expire in 24 hours.

      If you didn't create this account, please ignore this email.
    `,
  };

  try {
    const transporter = await createTransporter();
    const info = await transporter.sendMail(mailOptions);
    console.log("Verification email sent:", info.messageId);
  } catch (error) {
    const mailError = error as MailError;
    console.error("Failed to send verification email", {
      code: mailError.code,
      command: mailError.command,
      responseCode: mailError.responseCode,
      response: mailError.response,
      message: mailError.message
    });
    throw new Error("Could not send verification email");
  }
}

/**
 * Send password reset email (for future implementation)
 * @param email - Recipient email address
 * @param token - Reset token to include in the link
 */
export async function sendPasswordResetEmail(
  email: string,
  token: string
): Promise<void> {
  const baseUrl = resolvePublicBaseUrl();
  const resetUrl = `${baseUrl}/auth/reset-password?token=${token}`;

  const mailOptions = {
    from: env.EMAIL_FROM,
    to: email,
    subject: "Reset Your Password",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2>Reset Your Password</h2>
        <p>We received a request to reset your password. Click the link below to set a new password:</p>
        <p>
          <a href="${resetUrl}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">
            Reset Password
          </a>
        </p>
        <p>Or copy and paste this link in your browser:</p>
        <p><code>${resetUrl}</code></p>
        <p style="font-size: 12px; color: #666;">This link will expire in 1 hour.</p>
        <p style="font-size: 12px; color: #666;">If you didn't request this, please ignore this email.</p>
      </div>
    `,
    text: `
      Reset Your Password

      We received a request to reset your password. Click the link below to set a new password:

      Reset link: ${resetUrl}

      This link will expire in 1 hour.

      If you didn't request this, please ignore this email.
    `,
  };

  try {
    const transporter = await createTransporter();
    const info = await transporter.sendMail(mailOptions);
    console.log("Password reset email sent:", info.messageId);
  } catch (error) {
    const mailError = error as MailError;
    console.error("Failed to send password reset email", {
      code: mailError.code,
      command: mailError.command,
      responseCode: mailError.responseCode,
      response: mailError.response,
      message: mailError.message
    });
    throw new Error("Could not send password reset email");
  }
}

export default {
  sendVerificationEmail,
  sendPasswordResetEmail,
};
