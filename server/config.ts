import "dotenv/config";
import { z } from "zod";

const environmentSchema = z.object({
  SERVER_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  MAX_UPLOAD_MB: z.coerce.number().positive().max(50).default(15),
  ACCOUNTING_API_BASE_URL: z.url().default("http://localhost:8080"),
  ACCOUNTING_API_KEY: z.string().min(1).default("demo-key-1234"),
  LLM_API_KEY: z.string().min(1).optional(),
  LLM_MODEL: z.string().min(1).default("gpt-5.6-luna"),
  LLM_BASE_URL: z.url().default("https://api.openai.com/v1"),
});

const environment = environmentSchema.parse(process.env);

export const config = {
  serverPort: environment.SERVER_PORT,
  maxUploadBytes: environment.MAX_UPLOAD_MB * 1024 * 1024,
  accountingApiBaseUrl: environment.ACCOUNTING_API_BASE_URL.replace(/\/$/, ""),
  accountingApiKey: environment.ACCOUNTING_API_KEY,
  llmApiKey: environment.LLM_API_KEY,
  llmModel: environment.LLM_MODEL,
  llmBaseUrl: environment.LLM_BASE_URL,
} as const;
