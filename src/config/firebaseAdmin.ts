import * as admin from "firebase-admin";
import path from "path";
import fs from "fs";

let initialized = false;

export function getFirebaseAdmin(): admin.app.App {
  if (!initialized) {
    const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (serviceAccountEnv) {
      const serviceAccount = JSON.parse(serviceAccountEnv);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } else {
      const keyPath = path.resolve(process.cwd(), "serviceAccountKey.json");
      if (!fs.existsSync(keyPath)) {
        throw new Error(
          "Firebase Admin is not configured. Either set FIREBASE_SERVICE_ACCOUNT env var " +
          "or provide a serviceAccountKey.json file in the project root."
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const serviceAccount = require(keyPath);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }

    initialized = true;
  }

  return admin.app();
}
