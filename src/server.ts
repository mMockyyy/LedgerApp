import { app } from "./app";
import { env } from "./config/env";
import { connectDb } from "./config/db";

// Global error handlers
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

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
