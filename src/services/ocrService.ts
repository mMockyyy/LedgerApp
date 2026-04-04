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

// OCR-tolerant patterns for well-known Philippine stores.
// Handles common Tesseract misreads: M↔N, W↔U, 0↔O, 1↔I/L, 5↔S, 8↔B.
const KNOWN_PH_STORES: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /sav[e3][mn][o0]re/i, name: "Savemore" },
  { pattern: /pur[e3]g[o0]ld/i, name: "Puregold" },
  { pattern: /rob[i1]n[s5][o0]n[s5]?/i, name: "Robinson's" },
  { pattern: /m[e3]rcury[\s-]?drug/i, name: "Mercury Drug" },
  { pattern: /\bsm\b.*(mall|market|super|hyper)/i, name: "SM" },
  { pattern: /land\s*mark/i, name: "Landmark" },
  { pattern: /7[\s-]?[e3]l[e3]v[e3]n/i, name: "7-Eleven" },
  { pattern: /joll[i1]b[e3]{1,2}/i, name: "Jollibee" },
  { pattern: /mcd[o0]nald[s']?/i, name: "McDonald's" },
  { pattern: /[s5]tarbucks/i, name: "Starbucks" },
  { pattern: /[s5]hacky[s']?/i, name: "Shacky's" },
  { pattern: /[\s]?[k][f][c][\s]?/i, name: "KFC" },
  { pattern: /[s5]avemall/i, name: "Savemall" },
  { pattern: /waltermart/i, name: "Waltermart" },
  { pattern: /[s5]&r[\s]?(cost[s]?[\s]?club)?/i, name: "S&R" },
  { pattern: /hyp[e3]rm[a4]rt/i, name: "Hypermart" },
  { pattern: /[s5]u[p]?er[s5]?[\s]?[s5]?t[o0]re/i, name: "Super Store" },
  { pattern: /[a4]lf[a4]mart/i, name: "Alfamart" },
  { pattern: /alf[a4][\s]?m[a4]rt/i, name: "Alfamart" },
  { pattern: /mini[\s]?[s5]t[o0]p/i, name: "MiniStop" },
  { pattern: /[a4]ll[\s]?d[a4]y/i, name: "AllDay" },
  { pattern: /ch[o0]wk[i1]ng/i, name: "Chowking" },
  { pattern: /mang[\s]?[i1]n[a4][s5]al/i, name: "Mang Inasal" },
  { pattern: /gre[e3]nb[e3]lts?/i, name: "Greenbelt" },
  { pattern: /gl[o0]r[i1][e3]tt[a4]/i, name: "Glorietta" },
  { pattern: /[a4]y[a4]l[a4]/i, name: "Ayala" },
];

// Fix common OCR digit-to-letter errors in uppercase words (merchant names are usually ALL CAPS).
// Only corrects words that are predominantly letters (avoids corrupting actual numbers).
function correctOcrCharsInWord(word: string): string {
  const letterCount = (word.match(/[A-Z]/g) ?? []).length;
  if (letterCount < word.length * 0.4) {
    return word; // likely a real number — leave it alone
  }
  return word.replace(/0/g, "O").replace(/1/g, "I").replace(/5/g, "S").replace(/8/g, "B");
}

function applyOcrCorrections(name: string): string {
  return name.replace(/\b[A-Z0-9]+\b/g, correctOcrCharsInWord);
}

function matchKnownStore(name: string): string | undefined {
  for (const { pattern, name: canonical } of KNOWN_PH_STORES) {
    if (pattern.test(name)) {
      return canonical;
    }
  }
  return undefined;
}

function extractMerchant(text: string) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  // Check the top lines for a known store match first (OCR-tolerant).
  const topLines = lines.slice(0, 6);
  for (const line of topLines) {
    const knownStore = matchKnownStore(line);
    if (knownStore) {
      return knownStore;
    }
  }

  // Fall back to the first non-noise line and apply OCR digit corrections.
  for (const line of topLines) {
    const cleaned = line.replace(/[^A-Za-z0-9 &.-]/g, "").trim();
    if (!cleaned) {
      continue;
    }

    if (/receipt|invoice|total|subtotal|tax|date|time|ticket|amount|faretype|fare type|driver|conductor|vehicle|device|from|to/i.test(cleaned)) {
      continue;
    }

    if (/[A-Za-z]{2,}/.test(cleaned) && cleaned.length <= 50) {
      // Apply OCR corrections before returning
      const corrected = applyOcrCorrections(cleaned);
      // Check again if the corrected form matches a known store
      return matchKnownStore(corrected) ?? corrected.slice(0, 80);
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
    "You are a receipt categorization expert. Extract expense data from Philippine business receipts.",
    "",
    "═══════════════════════════════════════════════════════════════════",
    "CRITICAL: Categorization is based on WHAT WAS PURCHASED, not the store.",
    "Example: Buying shoes at a mall → Shopping & Personal > Clothing",
    "Example: Buying food at a mall → Food & Drinks > Groceries",
    "═══════════════════════════════════════════════════════════════════",
    "",
    "RECEIPT STRUCTURE GUIDE:",
    "┌─ HEADER SECTION ─────────────────────────┐",
    "│ Store name, address, TIN, registration  │",
    "│ Usually lines 1-4                       │",
    "└─────────────────────────────────────────┘",
    "┌─ TRANSACTION BODY ──────────────────────┐",
    "│ Item descriptions, quantities, prices   │",
    "│ THIS IS WHERE YOU FIND CATEGORY CLUES  │",
    "└─────────────────────────────────────────┘",
    "┌─ FOOTER SECTION ────────────────────────┐",
    "│ SUBTOTAL, VAT, TOTAL, CASH, CHANGE     │",
    "│ Date/Time, Cashier name, Receipt #     │",
    "└─────────────────────────────────────────┘",
    "",
    "═══════════════════════════════════════════════════════════════════",
    "CATEGORY DECISION TREE",
    "═══════════════════════════════════════════════════════════════════",
    "",
    "1. FOOD & DRINKS",
    "   Subcategories: Restaurants, Drinks, Fast Food, Groceries, Bakery, Other Food & Drinks",
    "   ",
    "   KEYWORDS: rice, meat, fish, chicken, pork, beef, vegetable, fruit, egg, milk, cheese,",
    "   butter, oil, sauce, spice, flour, bread, cake, pastry, cookie, biscuit, candy, chocolate,",
    "   coffee, tea, juice, soda, beer, wine, alcohol, water, soft drink, burger, pizza, fries,",
    "   chicken, noodle, soup, rice meal, viand, breakfast, lunch, dinner, snack, food, eat,",
    "   restaurant, cafe, diner, bakery, bakeshop, supermarket, grocery, market, puregold, s&r,",
    "   savemore, sm grocery, robinsons, landmark, hypermart, carrefour, ministry, barrio fiesta,",
    "   jollibee, mcdonalds, wendy's, kfc, chowking, popeyes, mcdonald's, pizza hut",
    "   ",
    "   ❌ NOT Food: supplements, vitamins, medicine, cosmetics, flowers",
    "",
    "2. SHOPPING & PERSONAL",
    "   Subcategories: Clothing, Shoes, Cosmetics & Beauty, Electronics, Accessories",
    "   A) CLOTHING: shirt, blouse, pants, jeans, shorts, skirt, jacket, coat, dress, uniform,",
    "       underwear, socks, vest, sweater, hoodie, cardigan, polo, t-shirt, longsleeves,",
    "       fabric, textile, garment, apparel, fashion, department store",
    "   B) SHOES: slippers, sandals, shoes, sneakers, boots, heels, flats, loafers, flip-flops,",
    "       footwear, shoe repair, cobbler, shoemaker",
    "   C) COSMETICS & BEAUTY: makeup, lipstick, foundation, blush, eyeshadow, mascara, nail polish,",
    "       skincare, face wash, moisturizer, sunscreen, shampoo, conditioner, soap, lotion,",
    "       perfume, cologne, deodorant, toothpaste, toothbrush, hair treatment, salon, spa,",
    "       beauty shop, cosmetics, beautify",
    "   D) ELECTRONICS: phone, laptop, computer, tablet, charger, cable, headphones, earbuds,",
    "       speaker, monitor, keyboard, mouse, adaptor, gadget, smart device, electronic",
    "   E) ACCESSORIES: bag, purse, wallet, belt, watch, jewelry, necklace, bracelet, ring,",
    "       keychain, scarf, gloves, hat, sunglasses, frames, eyeglasses, glasses store",
    "   ",
    "   ❌ NOT Shopping: groceries (→ Food), medicine (→ Health), equipment (check context)",
    "",
    "3. TRANSPORT",
    "   Subcategories: Public Transit, Ride-Sharing, Taxi, Gas/Fuel, Parking, Car Maintenance, Bike/Motorcycle",
    "   ",
    "   KEYWORDS: fare, ticket, bus, jeepney, tricycle, mrt, lrt, brt, train, uber, grab, taxi,",
    "   gas, gasoline, petrol, diesel, fuel, oil change, maintenance, repair, parking, toll,",
    "   mechanic, auto shop, motor, motorcycle, bike, scooter, vehicle, transportation, commute,",
    "   shell, petron, caltex, mrt pass, beep card, sakay app, petrol station, gas station",
    "   ",
    "   💡 Ride-sharing: 'Grab', 'Uber', 'Joyride', app-based ride",
    "   💡 Taxi: Metered taxi, airport taxi, city taxi",
    "   💡 Public Transit: Train, Bus, Jeepney ticket stub",
    "",
    "4. HEALTH",
    "   Subcategories: Pharmacy, Gym/Fitness, Dental",
    "   KEYWORDS: medicine, paracetamol, antibiotic, cough syrup, vitamin, supplement, drug,",
    "   pharmacy, drugstore, healthcare, clinic, hospital, doctor, dental, dentist, teeth,",
    "   braces, filling, extraction, gym, fitness, workout, training, membership, coach",
    "",
    "5. ENTERTAINMENT",
    "   Subcategories: Movies & Streaming, Concerts & Events, Gaming, Books & Audio, Sports, Hobbies",
    "   ",
    "   A) MOVIES & STREAMING: Cinema, movie ticket, film, Netflix, Spotify, streaming subscription,",
    "       Disney+, HBO, Amazon Prime, cable subscription, TV subscription",
    "   B) GAMING: Video game, game console, Steam, PlayStation, Xbox, Nintendo, mobile game,",
    "       gaming arcade, tournament fee",
    "   C) CONCERTS & EVENTS: Concert ticket, Music festival, Sports ticket, Theater, Play,",
    "       Event ticket, Festival pass",
    "   D) BOOKS & AUDIO: Book, Novel, Textbook, Magazine, Newspaper, Audiobook, Comic,",
    "       Bookstore, Library",
    "   E) SPORTS & HOBBIES: Sports equipment, Fishing gear, Camping gear, Hobby supplies,",
    "       Craft materials, Art supplies, Gymnastics, Swimming lessons",
    "",
    "6. UTILITIES & HOME",
    "   Subcategories: Electricity, Water, Internet, Phone Bill, Rent/Mortgage, Home Repair, Furniture",
    "   KEYWORDS: electric, meralco, kuryente, water bill, maynilad, internet, broadband, wifi,",
    "   phone bill, globe, dito, smart, sun, rent, condo, house, apartment, mortgage, lease,",
    "   repair, maintenance, plumbing, electrical, construction, hardware, furniture, home depot",
    "",
    "7. EDUCATION",
    "   Subcategories: Tuition, Books & Materials, Online Courses, Supplies",
    "   KEYWORDS: school, university, college, tuition, enrollment, exam fee, registration,",
    "   textbook, school supplies, notebook, pen, pencil, backpack, uniform, course, lesson,",
    "   training, seminar, workshop, webinar, online course, udemy, coursera",
    "",
    "8. TRAVEL & VACATION",
    "   Subcategories: Flights, Hotels, Tours & Activities, Travel Insurance",
    "   KEYWORDS: airfare, flight ticket, hotel, resort, booking, airline, airport, tour,",
    "   travel package, guide, activity, attraction, travel insurance, visa, passport",
    "",
    "9. SUBSCRIPTIONS & MEMBERSHIPS",
    "   Subcategories: App Subscriptions, Club Memberships, Premium Services",
    "   KEYWORDS: subscription, monthly, yearly, membership fee, premium, pass, card fee,",
    "   premium membership, vip, exclusive, recurring charge, monthly charge, annual",
    "",
    "10. OTHER",
    "   Use ONLY when:",
    "   • Receipt is completely illegible/no items identifiable",
    "   • Items genuinely don't fit any category (rare)",
    "   • Uncertainty is very high (confidence < 0.45)",
    "   ",
    "   Subcategories: Gifts, Donations, Uncategorized",
    "   Examples: Gift wrapped items marked 'Gift', Charity donations, Religious offerings",
    "",
    "═══════════════════════════════════════════════════════════════════",
    "EXTRACTION RULES",
    "═══════════════════════════════════════════════════════════════════",
    "",
    "AMOUNT EXTRACTION:",
    "  1. Look for lines containing: 'TOTAL', 'AMOUNT', 'BALANCE DUE', 'GRAND TOTAL',",
    "     'SUBTL', 'SUBTOTAL', 'NET TOTAL', 'PAYABLE', 'DUE'",
    "  2. ❌ IGNORE these lines (they are NOT the purchase amount):",
    "     - 'CASH', 'CHANGE', 'TENDERED', 'PAID', 'PAYMENT'",
    "  3. If multiple amounts found, select the LARGEST one from 'TOTAL'/'AMOUNT DUE' lines",
    "  4. Handle formats: '1,250.50' = 1250.50, '₱200', 'PHP 500', '$100'",
    "  5. Range: 0.50 to 99,999 (reject years 1900-2099 as amounts)",
    "  6. If no amount found, omit this field and reduce confidence to 0.3",
    "",
    "MERCHANT EXTRACTION:",
    "  1. Extract ONLY from header (lines 1-5)",
    "  2. Clean: Keep letters, numbers, &, -, ., spaces only",
    "  3. Skip if line contains: 'receipt', 'invoice', 'total', 'date', 'time', 'tax'",
    "  4. Pick FIRST valid business name line (usually 1-3 characters for first word)",
    "  5. Max 120 characters",
    "  6. ⚠️ CORRECT OCR ERRORS IN MERCHANT NAME:",
    "     Tesseract OCR commonly misreads characters. Apply these corrections:",
    "     • '0' (digit zero) → 'O' (letter)  e.g. 'T0WN' → 'TOWN'",
    "     • '1' (digit one)  → 'I' or 'L'   e.g. '1NVOICE' → skip this line",
    "     • '5' → 'S',  '8' → 'B',  'U' → 'W' (in ALL-CAPS store names)",
    "     • Adjacent letter confusion: N↔M, U↔W, I↔T, I↔R, VV↔W",
    "     • If the name resembles a known Philippine store, use correct spelling:",
    "       SAVENORE / SAVEMORE / SAV3MORE → 'Savemore'",
    "       PUREGOILD / PUREGO1D → 'Puregold'",
    "       ROBINSONS / ROB1NSONS → 'Robinson's'",
    "       SM MALL / SM MARKET → 'SM'",
    "       MERCURY DRUG / M3RCURY DRUG → 'Mercury Drug'",
    "       JOLLIBEE / JOLL1B3E → 'Jollibee'",
    "       MCDONALD / MCD0NALDS → 'McDonald's'",
    "       STARBUCKS / 5TARBUCKS → 'Starbucks'",
    "  7. Examples:",
    "     ✅ 'NEW SPREWELL ENTERPRISES'",
    "     ✅ 'ROBINSONS MALLS'",
    "     ❌ 'RECEIPT NO. 001234' (skip this)",
    "",
    "CATEGORY & SUBCATEGORY SELECTION:",
    "  1. PRIMARY METHOD: Search item names in receipt body",
    "     - Scan middle section for product names",
    "     - Match against keywords above",
    "     - If multiple items, use the MOST EXPENSIVE item or use majority category",
    "  2. SECONDARY METHOD: If no items listed, infer from merchant name",
    "  3. RULE: One receipt = ONE category (pick the dominant one)",
    "  4. CONFIDENCE by clarity:",
    "     - Clear items + clear merchant + clear total: 0.90-0.95",
    "     - Items found but fuzzy merchant: 0.80-0.85",
    "     - Only merchant known: 0.70-0.75",
    "     - Guessing from merchant only: 0.55-0.65",
    "     - Barely readable: 0.30-0.45",
    "",
    "DATE EXTRACTION:",
    "  1. Search for: 'Date:', 'Issued:', 'Time:', 'Receipt date'",
    "  2. Accept formats:",
    "     - 2026-04-04 (YYYY-MM-DD) ✅",
    "     - 04-04-2026 (DD-MM-YYYY) ✅",
    "     - Apr 04, 2026 ✅",
    "     - 04/04/2026 ✅",
    "  3. If no date keyword found, look for date pattern in last 5 lines",
    "  4. Convert to ISO-8601: 2026-04-04T00:00:00.000Z",
    "  5. ⚠️ If no date found, OMIT the field (don't guess today's date)",
    "",
    "═══════════════════════════════════════════════════════════════════",
    "COMMON MISTAKES TO AVOID",
    "═══════════════════════════════════════════════════════════════════",
    "",
    "❌ MISTAKE: 'SLIPPERS' → Other > Gifts",
    "✅ CORRECT: 'SLIPPERS' → Shopping & Personal > Clothing",
    "",
    "❌ MISTAKE: 'COFFEE' at SM Mall → Other (merchant name confusion)",
    "✅ CORRECT: 'COFFEE' → Food & Drinks > Drinks (focus on item, not store)",
    "",
    "❌ MISTAKE: 'TAXI FARE' → Other > Uncategorized",
    "✅ CORRECT: 'TAXI FARE' → Transport > Taxi",
    "",
    "❌ MISTAKE: Amount = 2024 (a year in the receipt)",
    "✅ CORRECT: Reject years, find actual transaction amount",
    "",
    "❌ MISTAKE: 'CASH: 500' as the purchase amount",
    "✅ CORRECT: Ignore CASH line, find TOTAL line (usually ≤ 500)",
    "",
    "❌ MISTAKE: Using store names only",
    "✅ CORRECT: ALWAYS prioritize item names/descriptions first",
    "",
    "═══════════════════════════════════════════════════════════════════",
    "JSON OUTPUT FORMAT",
    "═══════════════════════════════════════════════════════════════════",
    "",
    "{",
    "  \"amount\": number,",
    "  \"merchant\": string (max 120 chars),",
    "  \"category\": one of exactly [",
    "    'Food & Drinks', 'Transport', 'Health', 'Entertainment',",
    "    'Shopping & Personal', 'Utilities & Home', 'Education',",
    "    'Travel & Vacation', 'Subscriptions & Memberships', 'Other'",
    "  ],",
    "  \"subcategory\": string (specific type, max 60 chars),",
    "  \"incurredAt\": ISO-8601 string (YYYY-MM-DDTHH:mm:ss.000Z),",
    "  \"confidence\": number (0.0 to 1.0)",
    "}",
    "",
    "⚠️ RULES:",
    "  • Omit any field if you cannot determine it",
    "  • confidence should match your certainty (0.35 = unsure, 0.95 = very sure)",
    "  • Always pick a valid category (never invent categories)",
    "  • subcategory MUST exist under the chosen category",
    "  • Return ONLY JSON, no markdown, no explanation, no extra text",
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
