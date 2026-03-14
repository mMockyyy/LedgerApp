import { app } from "./app";
import { env } from "./config/env";
import { connectDb } from "./config/db";

async function bootstrap() {
  await connectDb(env.MONGODB_URI);
  app.listen(env.PORT, () => {
    console.log(`LedgerApp API running on port ${env.PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
