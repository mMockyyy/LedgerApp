import { env } from "../config/env";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ParsedReceipt {
  extractedText: string;
  amount?: number;
  merchant?: string;
  category?: string;
  subcategory?: string;
  incurredAt?: string;
  parserSource?: "rules" | "llm" | "hybrid-llm" | "hybrid-rules" | "llm-fallback-rules" | "tabscanner";
  parserConfidence?: number;
  llmAttempted?: boolean;
  llmSucceeded?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers shared with budget AI
// ---------------------------------------------------------------------------

function resolveAppReferer(): string {
  return env.APP_URL || env.RENDER_EXTERNAL_URL || "http://localhost:3000";
}

function extractFirstJsonObject(payload: string) {
  const firstBrace = payload.indexOf("{");
  const lastBrace = payload.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
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

  return Array.from(new Set(combined));
}

function shouldRetryWithNextKey(statusCode: number) {
  return statusCode === 401 || statusCode === 402 || statusCode === 403 || statusCode === 429 || statusCode >= 500;
}

// ---------------------------------------------------------------------------
// Category inference (rules-based, used as fallback when TabScanner doesn't
// return enough context to categorize)
// ---------------------------------------------------------------------------

function normalizeCategory(value?: string): { category?: string; subcategory?: string } {
  if (!value) return {};
  const normalized = value.toLowerCase().trim();

  if (/(food|restaurant|dining|coffee|cafe|drink|beverage|chop|food stall|foodcourt|grocery|groceries|supermarket|market|puregold|savemore|savemall|s&r|hypermart|landmark|shopwise|robinsons supermarket|alfamart|ministop|7-eleven|711|family mart|lawson|jollibee|mcdonald|burger|kfc|chowking|wendy|popeye|pizza|bakery|bakeshop|rice|viand|lutong|ulam)/.test(normalized)) {
    if (/(grocery|groceries|supermarket|hypermart|market|puregold|savemore|savemall|s&r|landmark|shopwise|alfamart|ministop|7-eleven|711|family mart|lawson)/.test(normalized)) {
      return { category: "Food & Drinks", subcategory: "Groceries" };
    }
    if (/(fast food|fastfood|jollibee|mcdonald|burger|kfc|chowking|wendy|popeye|pizza hut|greenwich|shakeys)/.test(normalized)) {
      return { category: "Food & Drinks", subcategory: "Fast Food" };
    }
    if (/(bakery|bakeshop|pandesal|bread|pastry|cake shop)/.test(normalized)) {
      return { category: "Food & Drinks", subcategory: "Bakery" };
    }
    if (/(coffee|cafe|drink|beverage|smoothie|juice|soda|milk tea|boba)/.test(normalized)) {
      return { category: "Food & Drinks", subcategory: "Drinks" };
    }
    if (/(restaurant|chop|foodcourt|diner|eatery|dining|carinderia|lutong|ulam|rice|viand|pizza)/.test(normalized)) {
      return { category: "Food & Drinks", subcategory: "Restaurants" };
    }
    return { category: "Food & Drinks", subcategory: "Other Food & Drinks" };
  }

  if (/(transport|travel|transit|fare|ticket|bus|train|taxi|ride|uber|grab|jeep|tricycle|gas|fuel|petrol|petron|shell|caltex|phoenix gas|parking|toll|mechanic|car|motorcycle|bike)/.test(normalized)) {
    if (/(uber|grab|ride|rideshare|joyride|angkas)/.test(normalized)) {
      return { category: "Transport", subcategory: "Ride-Sharing" };
    }
    if (/taxi/.test(normalized)) {
      return { category: "Transport", subcategory: "Taxi" };
    }
    if (/(gas|fuel|petrol|diesel|petron|shell|caltex|phoenix)/.test(normalized)) {
      return { category: "Transport", subcategory: "Gas/Fuel" };
    }
    if (/parking/.test(normalized)) {
      return { category: "Transport", subcategory: "Parking" };
    }
    if (/(mechanic|auto shop|car repair|oil change|car maintenance|vulcanizing)/.test(normalized)) {
      return { category: "Transport", subcategory: "Car Maintenance" };
    }
    if (/(public transit|bus|train|mrt|lrt|brt|jeep|tricycle|fare|beep|toll)/.test(normalized)) {
      return { category: "Transport", subcategory: "Public Transit" };
    }
    return { category: "Transport", subcategory: "Other" };
  }

  if (/(mercury[\s-]?drug|watsons?|rose[\s-]?pharmacy|southstar[\s-]?drug|generika|health|medical|pharmacy|clinic|hospital|doctor|dental|gym|fitness|medicine|drugstore|biogesic|decolgen|neozep|diatabs|bactidol|kremil|loperamide|ascorbic|paracetamol|antibiotic|vitamin|supplement)/.test(normalized)) {
    if (/(mercury[\s-]?drug|watsons?|rose[\s-]?pharmacy|southstar[\s-]?drug|generika|pharmacy|drugstore|medicine|biogesic|decolgen|neozep|diatabs|bactidol|kremil|loperamide|ascorbic|paracetamol|antibiotic|vitamin|supplement)/.test(normalized)) {
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

  if (/(clothing|clothes|dress|shirt|pants|jacket|blouse|shorts|skirt|uniform|slippers|sandals|sneakers|footwear|shoes|boots|heels|flats|apparel|garment|fashion|textile|fabric)/.test(normalized)) {
    return { category: "Shopping & Personal", subcategory: "Clothing" };
  }

  if (/(cosmetics|beauty|makeup|lipstick|foundation|skincare|face wash|moisturizer|sunscreen|shampoo|conditioner|lotion|perfume|cologne|deodorant|salon|spa|nail)/.test(normalized)) {
    return { category: "Shopping & Personal", subcategory: "Cosmetics & Beauty" };
  }

  if (/(electronics|phone|laptop|computer|tablet|charger|cable|headphones|earbuds|speaker|gadget|smart device)/.test(normalized)) {
    return { category: "Shopping & Personal", subcategory: "Electronics" };
  }

  if (/(bag|purse|wallet|belt|watch|jewelry|necklace|bracelet|ring|keychain|scarf|hat|sunglasses|eyeglasses|frames)/.test(normalized)) {
    return { category: "Shopping & Personal", subcategory: "Accessories" };
  }

  if (/(meralco|electric|kuryente|electricity|maynilad|manila water|water bill|globe|smart|dito|sun cellular|pldt|internet|broadband|wifi|phone bill|load|rent|condo|apartment|mortgage|lease|home repair|plumbing|hardware|furniture|home depot)/.test(normalized)) {
    if (/(meralco|electric|kuryente|electricity)/.test(normalized)) {
      return { category: "Utilities & Home", subcategory: "Electricity" };
    }
    if (/(maynilad|manila water|water bill)/.test(normalized)) {
      return { category: "Utilities & Home", subcategory: "Water" };
    }
    if (/(internet|broadband|wifi|pldt|globe fiber|converge)/.test(normalized)) {
      return { category: "Utilities & Home", subcategory: "Internet" };
    }
    if (/(globe|smart|dito|sun|phone bill|load|prepaid|postpaid)/.test(normalized)) {
      return { category: "Utilities & Home", subcategory: "Phone Bill" };
    }
    if (/(rent|condo|apartment|mortgage|lease)/.test(normalized)) {
      return { category: "Utilities & Home", subcategory: "Rent/Mortgage" };
    }
    if (/(repair|plumbing|hardware|construction|renovation)/.test(normalized)) {
      return { category: "Utilities & Home", subcategory: "Home Repair" };
    }
    if (/furniture/.test(normalized)) {
      return { category: "Utilities & Home", subcategory: "Furniture" };
    }
    return { category: "Utilities & Home", subcategory: "Electricity" };
  }

  if (/(school|university|college|tuition|enrollment|textbook|school supplies|notebook|pen|pencil|backpack|online course|lesson|training fee)/.test(normalized)) {
    if (/(tuition|enrollment|school fee|registration fee)/.test(normalized)) {
      return { category: "Education", subcategory: "Tuition" };
    }
    if (/(textbook|school supplies|notebook|pen|pencil|backpack|paper)/.test(normalized)) {
      return { category: "Education", subcategory: "Books & Materials" };
    }
    if (/(online course|udemy|coursera|lesson|training)/.test(normalized)) {
      return { category: "Education", subcategory: "Online Courses" };
    }
    return { category: "Education", subcategory: "Supplies" };
  }

  return { category: "Other", subcategory: "Uncategorized" };
}

// ---------------------------------------------------------------------------
// TabScanner API
// ---------------------------------------------------------------------------

const TABSCANNER_BASE = "https://api.tabscanner.com/api";

interface TabScannerSubmitResponse {
  status: string;
  token?: string;
  message?: string;
}

interface TabScannerLineItem {
  description?: string;
  lineType?: string;
  amount?: number | string;
  qty?: number | string;
}

interface TabScannerResult {
  total?: number | string;
  subtotal?: number | string;
  date?: string;
  establishment?: string;
  lineItems?: TabScannerLineItem[];
  currency?: string;
  receiptNumber?: string;
}

interface TabScannerPollResponse {
  status: string;
  result?: TabScannerResult;
  message?: string;
}

async function submitToTabScanner(
  fileName: string,
  mimeType: string,
  buffer: Buffer
): Promise<string> {
  const apiKey = env.TABSCANNER_API_KEY;
  if (!apiKey) throw new Error("TABSCANNER_API_KEY not configured");

  const form = new globalThis.FormData();
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  form.append("file", new Blob([arrayBuffer], { type: mimeType }), fileName);

  const response = await fetch(`${TABSCANNER_BASE}/2/process`, {
    method: "POST",
    headers: { apikey: apiKey },
    body: form,
    signal: AbortSignal.timeout(30_000)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`TabScanner submit error ${response.status}: ${body}`);
  }

  const data = await response.json() as TabScannerSubmitResponse;
  if (!data.token) {
    throw new Error(`TabScanner did not return a token: ${JSON.stringify(data)}`);
  }
  return data.token;
}

async function pollTabScanner(token: string): Promise<TabScannerResult> {
  const apiKey = env.TABSCANNER_API_KEY!;
  const maxAttempts = 20;
  const intervalMs = 2_000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    const response = await fetch(`${TABSCANNER_BASE}/result/${token}`, {
      headers: { apikey: apiKey },
      signal: AbortSignal.timeout(15_000)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`TabScanner poll error ${response.status}: ${body}`);
    }

    const data = await response.json() as TabScannerPollResponse;

    if (data.status === "done" && data.result) {
      return data.result;
    }

    if (data.status === "failed" || data.status === "error") {
      throw new Error(`TabScanner processing failed: ${data.message ?? "unknown error"}`);
    }

    // status is "pending" or "processing" — keep polling
  }

  throw new Error("TabScanner timed out after 40 seconds");
}

function parseTabScannerAmount(value?: number | string): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = typeof value === "string" ? parseFloat(value.replace(/,/g, "")) : value;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseTabScannerDate(value?: string): string | undefined {
  if (!value) return undefined;

  // Try multiple patterns TabScanner may return
  const patterns = [
    /\b(\d{4}[\/\-]\d{2}[\/\-]\d{2})/,
    /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/i,
    /\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4})\b/i,
    /\b(\d{2}[\/\-]\d{2}[\/\-]\d{4})\b/,
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (!match) continue;

    let raw = match[1].replace(/\//g, "-");

    const numeric = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (numeric) {
      const [, a, b, year] = numeric;
      const aNum = parseInt(a, 10);
      const bNum = parseInt(b, 10);
      raw = aNum > 12 && bNum <= 12 ? `${year}-${b}-${a}` : `${year}-${a}-${b}`;
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  return undefined;
}

function buildExtractedText(result: TabScannerResult): string {
  const parts: string[] = [];
  if (result.establishment) parts.push(result.establishment);
  if (result.date) parts.push(`Date: ${result.date}`);
  if (result.total !== undefined) parts.push(`Total: ${result.total}`);
  if (result.lineItems?.length) {
    const items = result.lineItems
      .filter((i) => i.description && i.lineType !== "total")
      .map((i) => i.description!)
      .join(", ");
    if (items) parts.push(items);
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Main export: processReceiptWithAI (TabScanner implementation)
// ---------------------------------------------------------------------------

export async function processReceiptWithAI(
  fileName: string,
  mimeType: string,
  buffer: Buffer
): Promise<ParsedReceipt> {
  if (!env.TABSCANNER_API_KEY) {
    // No TabScanner key — fall back to legacy pipeline
    const { processReceiptWithAI: legacyProcess } = await import("./ocrService.legacy");
    return legacyProcess(fileName, mimeType, buffer);
  }

  const token = await submitToTabScanner(fileName, mimeType, buffer);
  const result = await pollTabScanner(token);

  const amount = parseTabScannerAmount(result.total);
  // Always use today's date — receipt dates are often misprinted or wrong
  const incurredAt = new Date().toISOString();
  const merchant = result.establishment?.trim().slice(0, 80) || undefined;

  // Build a text summary for category inference and rawText storage
  const extractedText = buildExtractedText(result);

  // Infer category from merchant name + line item descriptions
  const categoryContext = [
    merchant,
    ...(result.lineItems?.map((i) => i.description).filter(Boolean) ?? [])
  ].join(" ");
  const { category, subcategory } = normalizeCategory(categoryContext);

  // Sanity check: if TabScanner returned almost nothing, treat as failed
  if (!amount && !merchant) {
    throw new Error("NOT_A_RECEIPT");
  }

  return {
    extractedText,
    amount,
    merchant,
    category,
    subcategory,
    incurredAt,
    parserSource: "tabscanner",
    parserConfidence: amount && merchant ? 0.9 : 0.6,
    llmAttempted: false,
    llmSucceeded: false
  };
}

// ---------------------------------------------------------------------------
// Budget AI — unchanged from legacy
// ---------------------------------------------------------------------------

export interface BudgetPlanAIResult {
  overspendFlags: string[];
  warnings: string[];
}

export async function generateBudgetPlanWithAI(
  weeklyBudget: number,
  categoryAllocations: Record<string, number>,
  expenseData: Array<{ category: string; amount: number }>
): Promise<BudgetPlanAIResult | null> {
  const llmKeys = getLlmApiKeys();
  if (llmKeys.length === 0) return null;

  const llmModel = env.LLM_MODEL || env.OPENAI_MODEL;

  const categoryTotals: { [key: string]: number } = {};
  for (const expense of expenseData) {
    const cat = expense.category || "Uncategorized";
    categoryTotals[cat] = (categoryTotals[cat] || 0) + expense.amount;
  }

  const historySummary = Object.entries(categoryTotals)
    .map(([cat, total]) => `- ${cat}: PHP ${total.toFixed(2)} spent (avg PHP ${(total / 28).toFixed(2)}/day)`)
    .sort()
    .join("\n");

  const allocationSummary = Object.entries(categoryAllocations)
    .map(([cat, limit]) => {
      const histSpent = categoryTotals[cat] ?? 0;
      const weeklyHistAvg = histSpent / 4;
      return `- ${cat}: user set PHP ${limit.toFixed(2)}/week (historical avg PHP ${weeklyHistAvg.toFixed(2)}/week)`;
    })
    .join("\n");

  const prompt = [
    `You are a personal budget advisor. A user has set a weekly budget of PHP ${weeklyBudget} with their own category limits.`,
    ``,
    `User's category allocations vs historical spending:`,
    allocationSummary,
    ``,
    `Full historical spending (past 4 weeks):`,
    historySummary,
    ``,
    `Analyze the user's own allocations against their real spending history and return:`,
    `- overspendFlags: array of category names where the user historically spends MORE than their set limit`,
    `- warnings: array of 2-3 concise, actionable recommendations (flag tight allocations, highlight risky categories, suggest adjustments)`,
    ``,
    `Return ONLY valid JSON with exactly these two fields. No markdown, no explanation.`,
    `{ "overspendFlags": [...], "warnings": [...] }`
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
            { role: "system", content: "You are a strict JSON budget plan generator. Return ONLY valid JSON with no markdown or explanation." },
            { role: "user", content: prompt }
          ]
        })
      });

      if (!response.ok) {
        if (shouldRetryWithNextKey(response.status)) continue;
        return null;
      }

      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content;
      if (!content) return null;

      const jsonCandidate = extractFirstJsonObject(content);
      if (!jsonCandidate) return null;

      const parsed = JSON.parse(jsonCandidate);
      if (!Array.isArray(parsed.overspendFlags) || !Array.isArray(parsed.warnings)) return null;

      return { overspendFlags: parsed.overspendFlags, warnings: parsed.warnings };
    } catch {
      continue;
    }
  }

  return null;
}
