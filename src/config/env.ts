import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  MONGODB_URI: z.string().min(1),
  PORT: z.coerce.number().default(8080),
  JWT_SECRET: z.string().min(16).default("change-me-in-env-please"),
  CORS_ORIGIN: z.string().optional(),
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
