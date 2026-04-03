import Tesseract from "tesseract.js";
import { z } from "zod";
import { env } from "../config/env";
import { CATEGORIES, getCategoryForSubcategory } from "../constants/categories";

function resolveAppReferer(): string {
  return env.APP_URL || env.RENDER_EXTERNAL_URL || "http://localhost:3000";
}

export interface ParsedReceipt {
  extractedText: string;
  amount?: number;
  merchant?: string;
  category?: string;
  subcategory?: string;
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
  subcategory: z.string().min(1).max(60).optional(),
  incurredAt: z.string().optional(),
  confidence: z.union([z.number(), z.string()]).optional()
});

function normalizeCategory(value?: string): { category?: string; subcategory?: string } {
  if (!value) {
    return {};
  }

  const normalized = value.toLowerCase().trim();
  
  if (/(food|restaurant|dining|coffee|cafe|drink|beverage|cafe|chop|food stall|foodcourt)/.test(normalized)) {
    // Return Food & Drinks category with subcategory
    if (/(restaurant|chop|foodcourt|diner|eatery)/.test(normalized)) {
      return { category: "Food & Drinks", subcategory: "Restaurants" };
    }
    if (/(coffee|cafe|drink|beverage|smoothie|juice|soda)/.test(normalized)) {
      return { category: "Food & Drinks", subcategory: "Drinks" };
    }
    if (/(fast food|fastfood|mcdonald|burger|kfc|jollibee|pizza)/.test(normalized)) {
      return { category: "Food & Drinks", subcategory: "Fast Food" };
    }
    if (/(grocery|groceries|market|supermarket|s&r|puregold|savemall)/.test(normalized)) {
      return { category: "Food & Drinks", subcategory: "Groceries" };
    }
    return { category: "Food & Drinks", subcategory: "Other Food & Drinks" };
  }
  
  if (/(transport|travel|transit|fare|ticket|bus|train|taxi|ride|uber|grab|jeep|tricycle)/.test(normalized)) {
    if (/(public transit|bus|train|mrt|lrt|brt|jeep)/.test(normalized)) {
      return { category: "Transport", subcategory: "Public Transit" };
    }
    if (/(uber|grab|ride|rideshare)/.test(normalized)) {
      return { category: "Transport", subcategory: "Ride-Sharing" };
    }
    if (/taxi/.test(normalized)) {
      return { category: "Transport", subcategory: "Taxi" };
    }
    if (/(gas|fuel|petrol)/.test(normalized)) {
      return { category: "Transport", subcategory: "Gas/Fuel" };
    }
    if (/parking/.test(normalized)) {
      return { category: "Transport", subcategory: "Parking" };
    }
    return { category: "Transport", subcategory: "Other" };
  }
  
  if (/(health|medical|pharmacy|clinic|hospital|doctor|dental|gym|fitness|medicine)/.test(normalized)) {
    if (/(pharmacy|drugstore|medicine)/.test(normalized)) {
      return { category: "Health", subcategory: "Pharmacy" };
    }
    if (/(gym|fitness|workout|sports)/.test(normalized)) {
      return { category: "Health", subcategory: "Gym/Fitness" };
    }
    if (/(dental|dentist|tooth)/.test(normalized)) {
      return { category: "Health", subcategory: "Dental" };
    }
    return { category: "Health", subcategory: "Pharmacy" };
  }
  
  if (/(entertainment|movie|cinema|streaming|subscription|netflix|spotify|game|gaming)/.test(normalized)) {
    if (/(movie|cinema|film)/.test(normalized)) {
      return { category: "Entertainment", subcategory: "Movies & Streaming" };
    }
    if (/(game|gaming|steam)/.test(normalized)) {
      return { category: "Entertainment", subcategory: "Gaming" };
    }
    return { category: "Entertainment", subcategory: "Movies & Streaming" };
  }
  
  if (/(shopping|clothing|shoes|cosmetics|beauty|electronics|Mall|store|shop)/.test(normalized)) {
    if (/(clothing|clothes|dress|shirt|pants)/.test(normalized)) {
      return { category: "Shopping & Personal", subcategory: "Clothing" };
    }
    if (/shoes/.test(normalized)) {
      return { category: "Shopping & Personal", subcategory: "Shoes" };
    }
    if (/(cosmetics|beauty|makeup|skincare)/.test(normalized)) {
      return { category: "Shopping & Personal", subcategory: "Cosmetics & Beauty" };
    }
    if (/(electronics|phone|laptop|computer|gadget)/.test(normalized)) {
      return { category: "Shopping & Personal", subcategory: "Electronics" };
    }
    return { category: "Shopping & Personal", subcategory: "Accessories" };
  }
  
  if (/(uncategorized|other|unknown|misc|miscellaneous)/.test(normalized)) {
    return { category: "Other", subcategory: "Uncategorized" };
  }

  // Default fallback
  return { category: "Other", subcategory: "Uncategorized" };
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

const amountHintRegex = /(amount\s*due|amount|total|fare|balance\s*due|grand\s*total|subtotal|net\s*total)/i;
const dateHintRegex = /(date|issued|time|day|month|year)/i;

function isLikelyYear(value: number) {
  return value >= 1900 && value <= 2099;
}

function isDateLikeLine(line: string) {
  if (dateHintRegex.test(line)) {
    return true;
  }

  return /\b\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\b|\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/.test(line);
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

  const parseCandidates = (line: string, includePlainIntegers: boolean) => {
    const tokens: string[] = [];

    for (const match of line.matchAll(/[₱P\$€£]\s*\d+(?:[\.,]\d{2})?/gi)) {
      tokens.push(match[0]);
    }

    for (const match of line.matchAll(/\b\d{1,3}(?:,\d{3})*(?:[\.,]\d{2})\b/g)) {
      tokens.push(match[0]);
    }

    if (includePlainIntegers) {
      for (const match of line.matchAll(/\b\d{1,4}\b/g)) {
        tokens.push(match[0]);
      }
    }

    return tokens
      .map((token) => parseAmountToken(token))
      .filter((value): value is number => value !== undefined)
      .filter((value) => !isLikelyYear(value));
  };

  // Highest-priority: explicit amount/total lines on receipts.
  for (const line of lines) {
    if (!amountHintRegex.test(line)) {
      continue;
    }

    const values = parseCandidates(line, true);
    if (values.length > 0) {
      return Math.max(...values);
    }
  }

  // Second chance: any currency-prefixed amount in the text.
  const currencyValues = Array.from(text.matchAll(/[₱P\$€£]\s*\d+(?:[\.,]\d{2})?/gi))
    .map((match) => parseAmountToken(match[0]))
    .filter((value): value is number => value !== undefined)
    .filter((value) => !isLikelyYear(value));
  if (currencyValues.length > 0) {
    return Math.max(...currencyValues);
  }

  // Third fallback: decimal amounts from non-date lines.
  const decimalValues: number[] = [];
  for (const line of lines) {
    if (isDateLikeLine(line)) {
      continue;
    }

    for (const match of line.matchAll(/\b\d{1,3}(?:,\d{3})*(?:[\.,]\d{2})\b/g)) {
      const value = parseAmountToken(match[0]);
      if (value !== undefined && !isLikelyYear(value)) {
        decimalValues.push(value);
      }
    }
  }

  if (decimalValues.length > 0) {
    return Math.max(...decimalValues);
  }

  // Final fallback: integers only from amount-hint lines and never year-like values.
  const integerValues: number[] = [];
  for (const line of lines) {
    if (!amountHintRegex.test(line) || isDateLikeLine(line)) {
      continue;
    }

    for (const match of line.matchAll(/\b\d{1,4}\b/g)) {
      const value = parseAmountToken(match[0]);
      if (value !== undefined && !isLikelyYear(value)) {
        integerValues.push(value);
      }
    }
  }

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

function inferCategory(text: string): { category?: string; subcategory?: string } {
  return normalizeCategory(text);
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
  const categoryInfo = inferCategory(extractedText);
  
  const parsed: Omit<ParsedReceipt, "extractedText"> = {
    amount: extractAmount(extractedText),
    merchant: extractMerchant(extractedText),
    category: categoryInfo.category,
    subcategory: categoryInfo.subcategory,
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

function getLlmApiKeys() {
  const configuredList = (env.LLM_API_KEYS || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);

  const combined = [env.LLM_API_KEY, env.OPENAI_API_KEY, ...configuredList]
    .filter((key): key is string => Boolean(key && key.trim()))
    .map((key) => key.trim());

  // Keep order but remove duplicates so we don't retry the same key.
  return Array.from(new Set(combined));
}

function shouldRetryWithNextKey(statusCode: number) {
  return statusCode === 401 || statusCode === 402 || statusCode === 403 || statusCode === 429 || statusCode >= 500;
}

async function parseWithLlm(extractedText: string): Promise<ParserResult | null> {
  const llmKeys = getLlmApiKeys();
  if (llmKeys.length === 0) {
    return null;
  }
  const llmModel = env.LLM_MODEL || env.OPENAI_MODEL;

  const prompt = [
    "You extract structured data from receipt OCR text.",
    "Return JSON only with these keys: amount, merchant, category, subcategory, incurredAt, confidence.",
    "- amount: number",
    "- never use a year/date value (e.g., 2026) as amount",
    "- merchant: string",
    "- category: one of 'Food & Drinks', 'Transport', 'Health', 'Entertainment', 'Shopping & Personal', 'Utilities & Home', 'Education', 'Travel & Vacation', 'Subscriptions & Memberships', 'Other'",
    "- subcategory: specific subcategory under the category",
    "- incurredAt: ISO-8601 datetime",
    "- confidence: number from 0 to 1",
    "If a field is unknown, omit it.",
    "OCR text:",
    extractedText.slice(0, 8000)
  ].join("\n");

  for (const llmKey of llmKeys) {
    const isOpenRouterKey = llmKey.startsWith("sk-or-");
    const llmBaseUrl = env.LLM_BASE_URL || (isOpenRouterKey ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1");

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${llmKey}`,
        "Content-Type": "application/json"
      };

      if (llmBaseUrl.includes("openrouter.ai")) {
        headers["HTTP-Referer"] = resolveAppReferer();
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
        if (shouldRetryWithNextKey(response.status)) {
          continue;
        }
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

      // Normalize category and subcategory if provided by LLM
      let category = parsed.category;
      let subcategory = parsed.subcategory;
      
      if (parsed.category) {
        const categoryInfo = normalizeCategory(parsed.category);
        category = categoryInfo.category;
        subcategory = categoryInfo.subcategory;
      }
      
      // If LLM provided subcategory, validate it
      if (parsed.subcategory && !category) {
        // Try to infer category from subcategory
        category = getCategoryForSubcategory(parsed.subcategory);
        subcategory = parsed.subcategory;
      }

      return {
        extractedText,
        amount: normalizedAmount,
        merchant: parsed.merchant?.trim(),
        category: category ?? "Other",
        subcategory: subcategory ?? "Uncategorized",
        incurredAt: normalizeIsoDate(parsed.incurredAt) ?? extractDate(extractedText),
        parserConfidence: normalizeConfidence(parsed.confidence),
        parserSource: "llm",
        llmAttempted: true,
        llmSucceeded: true
      };
    } catch {
      continue;
    }
  }

  return null;
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
      subcategory: llmResult.subcategory ?? ruleResult.subcategory,
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
    subcategory: ruleResult.subcategory ?? llmResult.subcategory,
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

export interface BudgetPlanAIResult {
  dailyBudget: number;
  categoryAllocations: {
    [key: string]: number;
  };
  overspendFlags: string[];
  warnings: string[];
}

export async function generateBudgetPlanWithAI(
  weeklyBudget: number,
  tone: "Strict" | "Balanced" | "Flexible",
  expenseData: Array<{ category: string; amount: number }>
): Promise<BudgetPlanAIResult | null> {
  const llmKeys = getLlmApiKeys();
  if (llmKeys.length === 0) {
    return null;
  }

  const llmModel = env.LLM_MODEL || env.OPENAI_MODEL;

  // Build category spending summary from past expenses
  const categoryTotals: { [key: string]: number } = {};
  const categoryCount: { [key: string]: number } = {};

  for (const expense of expenseData) {
    const cat = expense.category || "Uncategorized";
    categoryTotals[cat] = (categoryTotals[cat] || 0) + expense.amount;
    categoryCount[cat] = (categoryCount[cat] || 0) + 1;
  }

  const categorySummary = Object.entries(categoryTotals)
    .map(([cat, total]) => ({
      category: cat,
      totalSpent: total,
      averagePerDay: total / 28 // Assume 4 weeks = 28 days
    }))
    .sort((a, b) => b.totalSpent - a.totalSpent);

  const toneInstructions = {
    Strict: "Reduce high-spending categories by 10-15%. Add daily spending limits. Be assertive about overspend warnings.",
    Balanced: "Keep historical spending patterns. Allocate proportionally across categories. Warn on extreme outliers.",
    Flexible: "Allow +10% buffer on high-spending categories. Be lenient with recommendations. Focus on overall budget only."
  };

  const prompt = [
    `You are a personal budget planning AI. A user has set a weekly budget of PHP ${weeklyBudget}.`,
    `Their spending tone preference is: ${tone}`,
    `Their historical spending (past 4 weeks) by category:`,
    categorySummary.map((s) => `- ${s.category}: PHP ${s.totalSpent.toFixed(2)} (avg PHP ${s.averagePerDay.toFixed(2)}/day)`).join("\n"),
    "",
    `Tone guidance: ${toneInstructions[tone]}`,
    "",
    'Generate a JSON budget plan with ONLY these fields:',
    '- dailyBudget: decimal number (weeklyBudget / 7)',
    '- categoryAllocations: object with category names as keys and PHP amounts as values',
    '- overspendFlags: array of category names that user typically overspends on',
    '- warnings: array of 2-3 strategic recommendations to stay within budget',
    '',
    'Return ONLY valid JSON. No markdown, no explanation.'
  ].join("\n");

  for (const llmKey of llmKeys) {
    const isOpenRouterKey = llmKey.startsWith("sk-or-");
    const llmBaseUrl = env.LLM_BASE_URL || (isOpenRouterKey ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1");

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${llmKey}`,
        "Content-Type": "application/json"
      };

      if (llmBaseUrl.includes("openrouter.ai")) {
        headers["HTTP-Referer"] = resolveAppReferer();
        headers["X-Title"] = "LedgerApp Backend";
      }

      const response = await fetch(`${llmBaseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: llmModel,
          temperature: 0.7,
          messages: [
            {
              role: "system",
              content: "You are a strict JSON budget plan generator. Return ONLY valid JSON with no markdown or explanation."
            },
            {
              role: "user",
              content: prompt
            }
          ]
        })
      });

      if (!response.ok) {
        if (shouldRetryWithNextKey(response.status)) {
          continue;
        }
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

      const parsed = JSON.parse(jsonCandidate);

      // Validate structure
      if (
        typeof parsed.dailyBudget !== "number" ||
        typeof parsed.categoryAllocations !== "object" ||
        !Array.isArray(parsed.overspendFlags) ||
        !Array.isArray(parsed.warnings)
      ) {
        return null;
      }

      return {
        dailyBudget: Math.round(parsed.dailyBudget * 100) / 100,
        categoryAllocations: Object.entries(parsed.categoryAllocations).reduce(
          (acc: { [key: string]: number }, [cat, amount]) => {
            acc[cat as string] = Math.round((amount as number) * 100) / 100;
            return acc;
          },
          {}
        ),
        overspendFlags: Array.isArray(parsed.overspendFlags) ? parsed.overspendFlags : [],
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings : []
      };
    } catch {
      continue;
    }
  }

  return null;
}
