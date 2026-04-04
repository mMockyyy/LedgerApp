import Tesseract from "tesseract.js";
import { z } from "zod";
import { env } from "../config/env";
import { getCategoryForSubcategory } from "../constants/categories";

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
  
  if (/(shopping|clothing|shoes|slippers|sandals|sneakers|footwear|cosmetics|beauty|electronics|Mall|store|shop)/.test(normalized)) {
    if (/(clothing|clothes|dress|shirt|pants|jacket|blouse|shorts|skirt|uniform|slippers|sandals|sneakers|footwear|shoes|boots|heels|flats)/.test(normalized)) {
      return { category: "Shopping & Personal", subcategory: "Clothing" };
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

const amountHintRegex = /(amount\s*due|amount|total|fare|balance\s*due|grand\s*total|subtotal|subtl|net\s*total)/i;
// Lines that represent cash tendered or change given — never the actual amount due
const cashChangeRegex = /\b(cash|change|tendered|paid|payment)\b/i;
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
    .filter(Boolean)
    // Exclude cash-tendered and change lines — they are never the amount due
    .filter((line) => !cashChangeRegex.test(line));

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

  // Second chance: any currency-prefixed amount in the text (excluding cash/change lines).
  const currencyValues = lines
    .flatMap((line) => Array.from(line.matchAll(/[₱P\$€£]\s*\d+(?:[\.,]\d{2})?/gi)))
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

function extractDate(text: string): string | undefined {
  const dateMatch = text.match(/(\d{4}-\d{2}-\d{2}|\d{2}[\/\-]\d{2}[\/\-]\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})/);
  if (!dateMatch) {
    return undefined;
  }

  const parsedDate = new Date(dateMatch[1]);
  return Number.isNaN(parsedDate.getTime()) ? undefined : parsedDate.toISOString();
}

function inferCategory(text: string): { category?: string; subcategory?: string } {
  // Use top 8 lines + category-hint lines + short lines that look like item names
  // (item lines are typically short, mostly alpha, and appear before the totals section).
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const topLines = lines.slice(0, 8);
  const hintLines = lines.filter((l) =>
    /(total|amount|item|order|receipt|invoice|store|shop|restaurant|cafe|pharmacy|fare|ticket)/i.test(l)
  );
  // Short alpha lines are likely product/item names (e.g. "SLIPPERS", "COFFEE LATTE")
  const itemLines = lines.filter((l) => l.length <= 40 && /^[A-Za-z][A-Za-z0-9 &\-\/]+$/.test(l));
  const focused = [...new Set([...topLines, ...hintLines.slice(0, 4), ...itemLines.slice(0, 6)])].join(" ");
  return normalizeCategory(focused);
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

  // Pre-clean OCR text before sending: collapse excessive blank lines and trim noise
  const cleanedText = extractedText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, 120) // cap at 120 lines to avoid token waste
    .join("\n");

  const prompt = [
    "You are a receipt parser from the Philippines. Extract structured expense data from OCR receipts.",
    "",
    "═══ RECEIPT ANATOMY ═══",
    "1. HEADER (top) → Store/merchant name, TIN, address",
    "2. BODY (middle) → Item names & quantities (THIS IS CRITICAL FOR CATEGORIZATION)",
    "3. FOOTER (bottom) → Amounts (subtotal, tax, total), date/time, cashier",
    "",
    "═══ CATEGORIZATION RULES ═══",
    "CRITICAL: Look at item names and product descriptions, NOT just merchant name.",
    "",
    "FOOD & DRINKS → Restaurants, Drinks, Fast Food, Groceries, Bakery, Other Food & Drinks",
    "  Items: Rice, meat, vegetables, coffee, beer, milk, chocolate, junk food, meals, snacks",
    "  Merchants: SM City, Puregold, S&R, Jollibee, McDonald's, Starbucks, Tacos, Catering",
    "",
    "SHOPPING & PERSONAL → Clothing, Shoes, Cosmetics & Beauty, Electronics, Accessories",
    "  Clothing: shirt, pants, jacket, dress, uniform, blouse, shorts, skirt",
    "  Shoes: slippers, sandals, sneakers, boots, heels, footwear, shoes",
    "  Cosmetics: makeup, skincare, shampoo, perfume, lotion, face wash, lipstick",
    "  Electronics: phone, laptop, gadget, charger, headphones, tablet, camera",
    "",
    "TRANSPORT → Public Transit, Ride-Sharing, Taxi, Gas/Fuel, Parking, Car Maintenance, Bike/Motorcycle",
    "  Items: Fare, gas, diesel, petrol, parking fee, bus ticket, MRT/LRT pass, ride booking",
    "  Merchants: Grab, Uber, Shell, Petron, LRT, MRT, Taxi, Parking lot",
    "",
    "HEALTH → Pharmacy, Gym/Fitness, Dental",
    "  Pharmacy: medicine, vitamins, paracetamol, antibiotics, health supplements, cough syrup",
    "  Gym: membership, trainer fee, equipment",
    "  Dental: teeth cleaning, filling, orthodontics",
    "",
    "ENTERTAINMENT → Movies & Streaming, Concerts & Events, Gaming, Books & Audio, Sports, Hobbies",
    "  Movie: ticket, cinema, film",
    "  Gaming: game, PlayStation, Xbox, Steam, mobile game",
    "  Streaming: Netflix, Spotify, Twitch subscription",
    "  Books: novel, textbook, magazine",
    "",
    "UTILITIES & HOME → Electricity, Water, Internet, Phone Bill, Rent/Mortgage, Home Repair, Furniture",
    "  Keywords: Electric bill, MERALCO, water bill, internet, WiFi, phone bill, rent",
    "",
    "EDUCATION → Tuition, Books & Materials, Online Courses, Supplies",
    "  Keywords: Tuition, school fee, books, exam fee, course, enrollment",
    "",
    "TRAVEL & VACATION → Flights, Hotels, Tours & Activities, Travel Insurance",
    "  Keywords: Flight, airfare, booking, hotel, resort, tour, insurance",
    "",
    "SUBSCRIPTIONS & MEMBERSHIPS → App Subscriptions, Club Memberships, Premium Services",
    "  Keywords: App subscription, membership fee, monthly subscription, premium",
    "",
    "═══ JSON TO RETURN ═══",
    "{",
    "  \"amount\": number (ONLY the final total/amount due, NEVER year values like 2024, 2025, 2026),",
    "  \"merchant\": string (store/business name from header, max 120 chars),",
    "  \"category\": string (MUST be one of: Food & Drinks, Transport, Health, Entertainment, Shopping & Personal, Utilities & Home, Education, Travel & Vacation, Subscriptions & Memberships, Other),",
    "  \"subcategory\": string (specific type within category, max 60 chars),",
    "  \"incurredAt\": string (ISO-8601: YYYY-MM-DDTHH:mm:ss.000Z),",
    "  \"confidence\": number (0-1 scale)",
    "}",
    "",
    "═══ EXTRACTION RULES ═══",
    "",
    "AMOUNT:",
    "  1. Look for lines with 'TOTAL', 'AMOUNT DUE', 'GRAND TOTAL', 'BALANCE DUE', 'SUBTL'",
    "  2. Ignore CASH, CHANGE, TENDERED lines (these are payment method, NOT the amount)",
    "  3. Handle commas in numbers: '1,250.50' = 1250.50",
    "  4. Amount range: 0.50 to 99,999 (reject obvious years like 2020-2026)",
    "",
    "MERCHANT:",
    "  1. Extract from first 3 lines (header section)",
    "  2. Clean noise characters (keep letters, numbers, &, -, .)",
    "  3. Skip lines containing: Receipt, Invoice, Total, Date, Time, Tax, Ticket",
    "  4. Examples: 'NEW SPREWELL ENTERPRISES' (NOT 'NEM SUPERMALL ENTERPRISES')",
    "",
    "CATEGORY & SUBCATEGORY:",
    "  1. PRIMARY: Look at ITEM NAMES in the receipt body (lines after header)",
    "  2. SECONDARY: Look at merchant name if no items listed",
    "  3. Match items to category keywords above",
    "  4. For 'SLIPPERS' → Shopping & Personal > Clothing (NOT Gifts!)",
    "  5. For 'COFFEE' → Food & Drinks > Drinks (NOT Other!)",
    "  6. For 'SHIRT' → Shopping & Personal > Clothing",
    "  7. If truly unsure, use 'Other' > 'Uncategorized' but reduce confidence to 0.4",
    "",
    "DATE:",
    "  1. Look for lines containing date keywords: 'Date', 'Issued', 'Time'",
    "  2. Accept formats: YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, 'Jan 04, 2026'",
    "  3. If no date found, omit this field (do NOT guess current date)",
    "",
    "CONFIDENCE SCORING:",
    "  0.95: Amount + merchant + category + subcategory + date all found and clear",
    "  0.85: Amount + merchant + category + subcategory found, no date",
    "  0.75: Amount + merchant + category found, subcategory inferred",
    "  0.65: Amount + category found, merchant unclear",
    "  0.55: Only amount found clearly",
    "  0.40: Guessing - missing key fields",
    "  0.20: Barely readable or wrong category",
    "",
    "═══ OUTPUT ═══",
    "Return ONLY valid JSON object.",
    "Do NOT include markdown, explanation, or extra text.",
    "Omit fields if you cannot determine them with reasonable confidence.",
    "",
    "OCR TEXT:",
    cleanedText.slice(0, 6000)
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

      // Trust the LLM's category/subcategory when it provides exact values.
      // Only fall back to normalizeCategory() when the LLM's category is unrecognized.
      let category = parsed.category;
      let subcategory = parsed.subcategory;

      const knownCategories = new Set([
        "Food & Drinks", "Transport", "Health", "Entertainment",
        "Shopping & Personal", "Utilities & Home", "Education",
        "Travel & Vacation", "Subscriptions & Memberships", "Other"
      ]);

      if (parsed.category && !knownCategories.has(parsed.category)) {
        // LLM returned something non-standard — normalize it
        const categoryInfo = normalizeCategory(parsed.category);
        category = categoryInfo.category;
        // Only override subcategory if LLM didn't supply one
        if (!parsed.subcategory) {
          subcategory = categoryInfo.subcategory;
        }
      }

      // If LLM gave subcategory but no valid category, infer category from subcategory
      if (subcategory && !category) {
        category = getCategoryForSubcategory(subcategory);
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
      logger: () => undefined,
      // PSM 4: assume a single column of text of variable sizes (best for receipts)
      // OEM 1: LSTM neural net mode for better accuracy
      tessedit_pageseg_mode: "4",
      tessedit_ocr_engine_mode: "1",
      // Preserve more characters found on receipts
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,:-/()&@#%₱$€£ \n"
    } as Parameters<typeof Tesseract.recognize>[2]);
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
