import cors from "cors";
import express from "express";
import { ZodError } from "zod";
import { env } from "./config/env";
import { authRouter } from "./routes/authRoutes";
import { budgetRouter } from "./routes/budgetRoutes";
import { chatRouter } from "./routes/chatRoutes";
import { expenseRouter } from "./routes/expenseRoutes";
import { healthRouter } from "./routes/healthRoutes";
import { insightsRouter } from "./routes/insightsRoutes";
import { receiptRouter } from "./routes/receiptRoutes";

export const app = express();

const corsOptions: cors.CorsOptions = env.CORS_ORIGIN
  ? {
      origin: env.CORS_ORIGIN.split(",").map((origin) => origin.trim())
    }
  : { origin: true };

app.use(cors(corsOptions));
app.use(express.json({ limit: "2mb" }));

app.use(healthRouter);
app.use("/auth", authRouter);
app.use("/expenses", expenseRouter);
app.use("/receipts", receiptRouter);
app.use("/budgets", budgetRouter);
app.use("/insights", insightsRouter);
app.use("/chat", chatRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) {
    return res.status(400).json({
      message: "Validation failed",
      issues: error.issues
    });
  }

  // Mongo duplicate-key error (e.g., unique email).
  if (typeof error === "object" && error !== null && "code" in error && (error as { code?: number }).code === 11000) {
    return res.status(409).json({ message: "Duplicate value" });
  }

  const message = error instanceof Error ? error.message : "Unexpected server error";
  res.status(500).json({ message });
});
