import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  MONGODB_URI: z.string().min(1),
  PORT: z.coerce.number().default(8080),
  JWT_SECRET: z.string().min(16).default("change-me-in-env-please"),
  CORS_ORIGIN: z.string().optional(),
  APP_URL: z.string().url().optional(),
  RENDER_EXTERNAL_URL: z.string().url().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  EMAIL_HOST: z.string().min(1).default("smtp.ethereal.email"),
  EMAIL_PORT: z.coerce.number().int().positive().default(587),
  EMAIL_SECURE: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  EMAIL_USER: z.string().min(1).default("test@ethereal.email"),
  EMAIL_PASSWORD: z.string().min(1).default("test_password"),
  EMAIL_FROM: z.string().email().default("noreply@ledgerapp.com"),
  PARSER_MODE: z.enum(["rules", "llm", "hybrid"]).default("rules"),
  LLM_BASE_URL: z.string().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_API_KEYS: z.string().optional(),
  LLM_MODEL: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  LLM_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.7),
  OCR_ENABLED_GLOBAL: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  OPENAI_API_KEY: z.string().optional(),
  REDIS_URL: z.string().optional()
});

export const env = envSchema.parse(process.env);
