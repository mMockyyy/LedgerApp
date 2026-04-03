import { OAuth2Client } from "google-auth-library";
import { env } from "../config/env";
import { getFirebaseAdmin } from "../config/firebaseAdmin";

type GoogleIdentity = {
  googleId: string;
  email: string;
  emailVerified: boolean;
};

function getGoogleClient() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    throw new Error("Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.");
  }

  return new OAuth2Client({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI
  });
}

export async function exchangeCodeForGoogleIdentity(code: string): Promise<GoogleIdentity> {
  const client = getGoogleClient();
  const tokenResponse = await client.getToken(code);
  const idToken = tokenResponse.tokens.id_token;

  if (!idToken) {
    throw new Error("Google did not return an ID token");
  }

  const ticket = await client.verifyIdToken({
    idToken,
    audience: env.GOOGLE_CLIENT_ID
  });

  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    throw new Error("Google token payload is missing required fields");
  }

  return {
    googleId: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified === true
  };
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  const app = getFirebaseAdmin();
  const decoded = await app.auth().verifyIdToken(idToken);

  if (!decoded.uid || !decoded.email) {
    throw new Error("Firebase token payload is missing required fields");
  }

  return {
    googleId: decoded.uid,
    email: decoded.email,
    emailVerified: decoded.email_verified === true
  };
}