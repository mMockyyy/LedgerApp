import Tesseract from "tesseract.js";
import { z } from "zod";
import { env } from "../config/env";

export interface ParsedReceipt {
  extractedText: string;
  amount?: number;
  merchant?: string;
  category?: string;
  incurredAt?: string;
  parserSource?: "rules" | "llm" | "hybrid-llm" | "hybrid-rules" | "llm-fallback-rules";
  parserConfidence?: number;
  llmAttempted?: boolean;
  llmSucceeded?: boolean;
}

type ParseSource = "rules" | "llm";

interface ParserResult extends ParsedReceipt {
  parserSource: ParseSource;
  parserConfidence: number;
  llmAttempted: boolean;
  llmSucceeded: boolean;
}

const llmReceiptSchema = z.object({
  amount: z.union([z.number(), z.string()]).optional(),
  merchant: z.string().min(1).max(120).optional(),
  category: z.string().min(1).max(60).optional(),
  incurredAt: z.string().optional(),
  confidence: z.union([z.number(), z.string()]).optional()
});

function normalizeCategory(value?: string) {
  if (!value) {
    return undefined;
  }

  const normalized = value.toLowerCase().trim();
  if (/(food|restaurant|dining|coffee|cafe)/.test(normalized)) {
    return "Food";
  }
  if (/(transport|travel|transit|fare|ticket|bus|train|taxi|ride)/.test(normalized)) {
    return "Transport";
  }
  if (/(grocery|groceries|market|supermarket)/.test(normalized)) {
    return "Groceries";
  }
  if (/(health|medical|pharmacy|clinic|hospital)/.test(normalized)) {
    return "Health";
  }
  if (/(entertainment|movie|cinema|streaming|subscription)/.test(normalized)) {
    return "Entertainment";
  }
  if (/(uncategorized|other|unknown|misc)/.test(normalized)) {
    return "Uncategorized";
  }

  return value.slice(0, 60);
}

function normalizeIsoDate(value?: string) {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  // Accept YYYY-MM-DD and normalize to UTC midnight.
  const ymd = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) {
    return new Date(`${ymd[1]}-${ymd[2]}-${ymd[3]}T00:00:00.000Z`).toISOString();
  }

  return undefined;
}

function normalizeConfidence(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.min(1, parsed));
    }
  }
  return 0.6;
}

function normalizeText(rawText: string) {
  return rawText.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
}

function parseAmountToken(token: string) {
  const cleaned = token.replace(/,/g, "").replace(/[^\d.]/g, "");
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) && value > 0 && value < 100000 ? value : undefined;
}

function extractAmount(text: string) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  // Highest-priority: explicit amount/total lines on receipts.
  for (const line of lines) {
    if (/(amount\s*due|amount|total|fare|balance\s*due|grand\s*total|subtotal)/i.test(line)) {
      const match = line.match(/[₱P\$€£]?\s*\d+(?:[\.,]\d{2})?/i);
      if (match) {
        const amount = parseAmountToken(match[0]);
        if (amount !== undefined) {
          return amount;
        }
      }
    }
  }

  // Second chance: any currency-prefixed amount in the text.
  const currencyMatch = text.match(/[₱P\$€£]\s*\d+(?:[\.,]\d{2})?/i);
  if (currencyMatch) {
    const amount = parseAmountToken(currencyMatch[0]);
    if (amount !== undefined) {
      return amount;
    }
  }

  // Last fallback: use the largest decimal-looking amount, then largest integer token.
  const decimalValues = Array.from(text.matchAll(/\d+[\.,]\d{2}/g))
    .map((match) => parseAmountToken(match[0]))
    .filter((value): value is number => value !== undefined);
  if (decimalValues.length > 0) {
    return Math.max(...decimalValues);
  }

  const integerValues = Array.from(text.matchAll(/\b\d{1,4}\b/g))
    .map((match) => parseAmountToken(match[0]))
    .filter((value): value is number => value !== undefined);
  return integerValues.length > 0 ? Math.max(...integerValues) : undefined;
}

function extractMerchant(text: string) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  // Prefer the first few lines and clean OCR noise characters.
  const topLines = lines.slice(0, 6);
  for (const line of topLines) {
    const cleaned = line.replace(/[^A-Za-z0-9 &.-]/g, "").trim();
    if (!cleaned) {
      continue;
    }

    if (/receipt|invoice|total|subtotal|tax|date|time|ticket|amount|faretype|fare type|driver|conductor|vehicle|device|from|to/i.test(cleaned)) {
      continue;
    }

    if (/[A-Za-z]{2,}/.test(cleaned) && cleaned.length <= 50) {
      return cleaned.slice(0, 80);
    }
  }

  return undefined;
}

function extractDate(text: string) {
  const dateMatch = text.match(/(\d{4}-\d{2}-\d{2}|\d{2}[\/\-]\d{2}[\/\-]\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})/);
  if (!dateMatch) {
    return new Date().toISOString();
  }

  const parsedDate = new Date(dateMatch[1]);
  return Number.isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString();
}

function inferCategory(text: string) {
  const normalized = text.toLowerCase();
  const alphaOnly = normalized.replace(/[^a-z]/g, "");
  if (/(cafe|coffee|restaurant|food|burger|pizza|kitchen|dining)/.test(normalized)) {
    return "Food";
  }
  if (
    /(uber|lyft|taxi|transit|bus|train|parking|fuel|gas|faretype|fare type|driver|conductor|vehicle|route|ticket|amount due|from|to|terminal|station|avenida|avenue)/.test(normalized) ||
    /faretype|driver|conductor|vehicle|ticket/.test(alphaOnly)
  ) {
    return "Transport";
  }
  if (/(grocery|market|mart|supermarket)/.test(normalized)) {
    return "Groceries";
  }
  if (/(pharmacy|clinic|hospital|medic|drugstore)/.test(normalized)) {
    return "Health";
  }
  if (/(netflix|spotify|cinema|movie|subscription)/.test(normalized)) {
    return "Entertainment";
  }

  return "Uncategorized";
}

function scoreRuleConfidence(parsed: Omit<ParsedReceipt, "extractedText" | "parserSource" | "parserConfidence" | "llmAttempted" | "llmSucceeded">) {
  let score = 0.35;
  if (typeof parsed.amount === "number") {
    score += 0.25;
  }
  if (parsed.merchant) {
    score += 0.15;
  }
  if (parsed.category && parsed.category !== "Uncategorized") {
    score += 0.15;
  }
  if (parsed.incurredAt) {
    score += 0.1;
  }
  return Math.min(0.95, Number(score.toFixed(2)));
}

function parseWithRules(extractedText: string): ParserResult {
  const parsed: Omit<ParsedReceipt, "extractedText"> = {
    amount: extractAmount(extractedText),
    merchant: extractMerchant(extractedText),
    category: inferCategory(extractedText),
    incurredAt: extractDate(extractedText)
  };

  return {
    extractedText,
    ...parsed,
    parserSource: "rules",
    parserConfidence: scoreRuleConfidence(parsed),
    llmAttempted: false,
    llmSucceeded: false
  };
}

function extractFirstJsonObject(payload: string) {
  const firstBrace = payload.indexOf("{");
  const lastBrace = payload.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return null;
  }
  return payload.slice(firstBrace, lastBrace + 1);
}

async function parseWithLlm(extractedText: string): Promise<ParserResult | null> {
  const llmKey = env.LLM_API_KEY || env.OPENAI_API_KEY;
  if (!llmKey) {
    return null;
  }

  const isOpenRouterKey = llmKey.startsWith("sk-or-");
  const llmBaseUrl = env.LLM_BASE_URL || (isOpenRouterKey ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1");
  const llmModel = env.LLM_MODEL || env.OPENAI_MODEL;

  const prompt = [
    "You extract structured data from receipt OCR text.",
    "Return JSON only with these keys: amount, merchant, category, incurredAt, confidence.",
    "- amount: number",
    "- merchant: string",
    "- category: one of Food, Transport, Groceries, Health, Entertainment, Uncategorized",
    "- incurredAt: ISO-8601 datetime",
    "- confidence: number from 0 to 1",
    "If a field is unknown, omit it.",
    "OCR text:",
    extractedText.slice(0, 8000)
  ].join("\n");

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${llmKey}`,
      "Content-Type": "application/json"
    };

    if (llmBaseUrl.includes("openrouter.ai")) {
      headers["HTTP-Referer"] = "http://localhost";
      headers["X-Title"] = "LedgerApp Backend";
    }

    const response = await fetch(`${llmBaseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: llmModel,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: "You are a strict JSON receipt parser. Return JSON only."
          },
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return null;
    }

    const jsonCandidate = extractFirstJsonObject(content);
    if (!jsonCandidate) {
      return null;
    }

    const parsed = llmReceiptSchema.parse(JSON.parse(jsonCandidate));
    const normalizedAmount =
      typeof parsed.amount === "number"
        ? parsed.amount
        : typeof parsed.amount === "string"
          ? parseAmountToken(parsed.amount)
          : undefined;

    return {
      extractedText,
      amount: normalizedAmount,
      merchant: parsed.merchant?.trim(),
      category: normalizeCategory(parsed.category) ?? "Uncategorized",
      incurredAt: normalizeIsoDate(parsed.incurredAt) ?? extractDate(extractedText),
      parserConfidence: normalizeConfidence(parsed.confidence),
      parserSource: "llm",
      llmAttempted: true,
      llmSucceeded: true
    };
  } catch {
    return null;
  }
}

function mergeHybrid(ruleResult: ParserResult, llmResult: ParserResult | null): ParsedReceipt {
  if (!llmResult) {
    return {
      ...ruleResult,
      parserSource: "hybrid-rules",
      llmAttempted: true,
      llmSucceeded: false
    };
  }

  if ((llmResult.parserConfidence ?? 0) >= env.LLM_MIN_CONFIDENCE) {
    return {
      extractedText: ruleResult.extractedText,
      amount: llmResult.amount ?? ruleResult.amount,
      merchant: llmResult.merchant ?? ruleResult.merchant,
      category: llmResult.category ?? ruleResult.category,
      incurredAt: llmResult.incurredAt ?? ruleResult.incurredAt,
      parserSource: "hybrid-llm",
      parserConfidence: llmResult.parserConfidence,
      llmAttempted: true,
      llmSucceeded: true
    };
  }

  return {
    extractedText: ruleResult.extractedText,
    amount: ruleResult.amount ?? llmResult.amount,
    merchant: ruleResult.merchant ?? llmResult.merchant,
    category: ruleResult.category ?? llmResult.category,
    incurredAt: ruleResult.incurredAt ?? llmResult.incurredAt,
    parserSource: "hybrid-rules",
    parserConfidence: ruleResult.parserConfidence,
    llmAttempted: true,
    llmSucceeded: true
  };
}

async function extractTextFromBuffer(fileName: string, mimeType: string, buffer: Buffer) {
  if (mimeType.startsWith("text/")) {
    return normalizeText(buffer.toString("utf-8"));
  }

  if (mimeType.startsWith("image/")) {
    const result = await Tesseract.recognize(buffer, "eng", {
      logger: () => undefined
    });
    return normalizeText(result.data.text);
  }

  return normalizeText(`Unsupported OCR format for ${fileName}. Upload an image or plain text file.`);
}

export async function processReceiptWithAI(fileName: string, mimeType: string, buffer: Buffer): Promise<ParsedReceipt> {
  const extractedText = await extractTextFromBuffer(fileName, mimeType, buffer);
  const ruleResult = parseWithRules(extractedText);

  if (env.PARSER_MODE === "rules") {
    return ruleResult;
  }

  const llmResult = await parseWithLlm(extractedText);
  if (env.PARSER_MODE === "llm") {
    return llmResult ?? {
      ...ruleResult,
      parserSource: "llm-fallback-rules",
      llmAttempted: true,
      llmSucceeded: false
    };
  }

  return mergeHybrid(ruleResult, llmResult);
}
