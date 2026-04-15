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
  isReceipt: z.boolean().optional(),
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
  
  if (/(food|restaurant|dining|coffee|cafe|drink|beverage|chop|food stall|foodcourt|grocery|groceries|supermarket|market|puregold|savemore|savemall|s&r|hypermart|landmark|shopwise|robinsons supermarket|alfamart|ministop|7-eleven|711|family mart|lawson|jollibee|mcdonald|burger|kfc|chowking|wendy|popeye|pizza|bakery|bakeshop|rice|viand|lutong|ulam)/.test(normalized)) {
    // Grocery/supermarket check first (before fast food) since keywords are explicit
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
  // ── Local supermarkets & groceries ──────────────────────────────────────
  { pattern: /sav[e3][mn][o0]re/i,                        name: "Savemore" },
  { pattern: /pur[e3]g[o0]ld/i,                           name: "Puregold" },
  { pattern: /rob[i1]n[s5][o0]n[s5]?/i,                  name: "Robinson's" },
  { pattern: /[s5]avemall/i,                              name: "Savemall" },
  { pattern: /waltermart/i,                               name: "Waltermart" },
  { pattern: /[s5]&r(\s*cost\s*club)?/i,                  name: "S&R" },
  { pattern: /hyp[e3]rm[a4]rt/i,                          name: "Hypermart" },
  { pattern: /[a4]lf[a4][\s-]?m[a4]rt/i,                 name: "Alfamart" },
  { pattern: /[a4]ll[\s-]?d[a4]y/i,                       name: "AllDay Supermarket" },
  { pattern: /\bsm\b.*(mall|market|super|hyper|store)/i,  name: "SM" },
  { pattern: /land[\s-]?mark/i,                           name: "Landmark" },
  { pattern: /[s5]u[bp][e3]r[\s-]?[s5]t[o0]re/i,        name: "Super Store" },
  { pattern: /[s5]u[bp][e3]r[\s-]?[s5][a4]n/i,           name: "Supersan" },
  { pattern: /[s5][e3][s5]u[\s-]?mart/i,                  name: "Sesumart" },

  // ── Convenience stores ───────────────────────────────────────────────────
  { pattern: /7[\s-]?[e3]l[e3]v[e3]n/i,                  name: "7-Eleven" },
  { pattern: /mini[\s-]?[s5]t[o0]p/i,                     name: "MiniStop" },
  { pattern: /[f]amily[\s-]?mart/i,                       name: "FamilyMart" },
  { pattern: /[l1][a4]wson/i,                             name: "Lawson" },

  // ── Fast food & restaurants ──────────────────────────────────────────────
  { pattern: /joll[i1]b[e3]{1,2}/i,                       name: "Jollibee" },
  { pattern: /mcd[o0]nald[s']?/i,                         name: "McDonald's" },
  { pattern: /ch[o0]wk[i1]ng/i,                           name: "Chowking" },
  { pattern: /mang[\s-]?[i1]n[a4][s5]al/i,               name: "Mang Inasal" },
  { pattern: /[k]fc/i,                                    name: "KFC" },
  { pattern: /[s5]hackey[s']?|[s5]hacky[s']?/i,           name: "Shakey's" },
  { pattern: /greenwich/i,                                name: "Greenwich" },
  { pattern: /p[i1]zza[\s-]?hut/i,                        name: "Pizza Hut" },
  { pattern: /domino[s']?[\s-]?p[i1]zza/i,               name: "Domino's Pizza" },
  { pattern: /[s5]ubway/i,                                name: "Subway" },
  { pattern: /burger[\s-]?k[i1]ng/i,                      name: "Burger King" },
  { pattern: /wendy[s']?/i,                               name: "Wendy's" },
  { pattern: /p[o0]pey[e3][s']?/i,                        name: "Popeyes" },
  { pattern: /[s5]ugb[o0][\s-]?m[e3]rcant[i1]l[e3]/i,   name: "Sugbo Mercantile" },
  { pattern: /[b8][o0]nchon/i,                            name: "Bonchon" },
  { pattern: /m[e3][s5][s5][a4][\s-]?m[a4]nila/i,        name: "Messa Manila" },
  { pattern: /[b8]arrio[\s-]?f[i1][e3][s5]t[a4]/i,       name: "Barrio Fiesta" },

  // ── Coffee & drinks ───────────────────────────────────────────────────────
  { pattern: /[s5]tarbucks/i,                             name: "Starbucks" },
  { pattern: /[b8][o0]t[i1]nao?/i,                        name: "Botinao" },
  { pattern: /ch[a4]t[i1]m[e3]/i,                         name: "Chatime" },
  { pattern: /t[e3][a4][\s-]?[i1][s5][l1][a4]nd/i,       name: "Tea Island" },
  { pattern: /z[a4]gu/i,                                  name: "Zagu" },
  { pattern: /[s5]er[e3]nd[i1]p[i1]ty/i,                  name: "Serendipity" },
  { pattern: /k[o0]p[i1][\s-]?b[o0]y/i,                   name: "Kopi Boy" },
  { pattern: /b[o0][b8][o0][\s-]?(tea|[t][e3][a4])/i,    name: "Boba Tea" },
  { pattern: /[s5][e3][\s-]?[t][e3][a4]/i,                name: "Se Tea" },

  // ── Pharmacies & health ──────────────────────────────────────────────────
  { pattern: /m[e3]rcury[\s-]?drug/i,                     name: "Mercury Drug" },
  { pattern: /wat[s5][o0]n[s5]/i,                          name: "Watsons" },
  { pattern: /r[o0][s5][e3][\s-]?pharm[a4]cy/i,           name: "Rose Pharmacy" },
  { pattern: /[s5][o0]uth[\s-]?[s5]t[a4]r[\s-]?pharm/i,  name: "Southstar Drug" },
  { pattern: /[g9][e3]n[e3]r[i1]ca/i,                     name: "Generika" },
  { pattern: /med[e3]x[p]?r[e3][s5][s5]/i,               name: "Medexpress" },

  // ── Imported lifestyle & specialty brands in PH ──────────────────────────
  { pattern: /m[i1]n[i1][s5][o0]/i,                       name: "Miniso" },
  { pattern: /[s5][o0][s5][o0]/i,                          name: "Soso" },
  { pattern: /[m][u][j][i]/i,                             name: "Muji" },
  { pattern: /[i1]k[e3][a4]/i,                            name: "IKEA" },
  { pattern: /z[a4]r[a4]/i,                               name: "Zara" },
  { pattern: /h[\s-]?&[\s-]?m/i,                          name: "H&M" },
  { pattern: /uniq[l1][o0]/i,                             name: "Uniqlo" },
  { pattern: /f[o0]r[e3]v[e3]r[\s-]?21/i,                name: "Forever 21" },
  { pattern: /[s5]hein/i,                                 name: "Shein" },
  { pattern: /[l1][o0]cal[\s-]?[s5]t[a4]te/i,            name: "Loca State" },
  { pattern: /[b8][a4]t[a4]/i,                            name: "Bata" },
  { pattern: /[s5]k[e3]ch[e3]r[s5]/i,                    name: "Skechers" },
  { pattern: /n[i1]k[e3]/i,                               name: "Nike" },
  { pattern: /[a4]d[i1]d[a4][s5]/i,                       name: "Adidas" },
  { pattern: /[s5][a4]m[s5][o0]ng/i,                      name: "Samsung" },
  { pattern: /[a4]ppl[e3][\s-]?(authorized|store|ph)/i,   name: "Apple Store" },
  { pattern: /[l1][o0]g[i1]tech/i,                        name: "Logitech" },

  // ── Department stores & malls ─────────────────────────────────────────────
  { pattern: /[s5][e3]a[s5][o0]n[s5]/i,                   name: "Seasons" },
  { pattern: /[s5][a4]n[\s-]?m[i1]gu[e3]l/i,             name: "San Miguel" },
  { pattern: /gre[e3]nh[i1]ll[s5]/i,                      name: "Greenhills" },
  { pattern: /gre[e3]nb[e3]lts?/i,                        name: "Greenbelt" },
  { pattern: /gl[o0]r[i1][e3]tt[a4]/i,                    name: "Glorietta" },
  { pattern: /[a4]y[a4]l[a4]/i,                           name: "Ayala" },
  { pattern: /[s5][o0]l[a4]r[e3]/i,                       name: "Solare" },
  { pattern: /[s5][e3]nt[o0][s5][a4]/i,                   name: "Sentosa" },
  { pattern: /[s5][a4][s5][a4][\s-]?[s5][a4][s5][a4]/i,  name: "Sasa" },

  // ── Fuel & automotive ────────────────────────────────────────────────────
  { pattern: /p[e3]tr[o0]n/i,                             name: "Petron" },
  { pattern: /[s5]h[e3]ll[\s-]?(ph|[s5][e3]rv[i1]c[e3])?/i, name: "Shell" },
  { pattern: /c[a4]lt[e3]x/i,                             name: "Caltex" },
  { pattern: /[s5][e3][a4][\s-]?[o0][i1]l/i,             name: "SeaOil" },
  { pattern: /[t][o0]t[a4]l[\s-]?(ph|[s5][e3]rv[i1]c[e3])?/i, name: "Total" },

  // ── Telecoms & utilities ─────────────────────────────────────────────────
  { pattern: /gl[o0]b[e3]/i,                              name: "Globe" },
  { pattern: /[s5]m[a4]rt[\s-]?(comm|telco|ph)?/i,       name: "Smart" },
  { pattern: /d[i1]t[o0]/i,                               name: "Dito" },
  { pattern: /[s5]un[\s-]?c[e3]llular/i,                  name: "Sun Cellular" },
  { pattern: /pl[\s-]?dt/i,                               name: "PLDT" },
  { pattern: /m[e3]r[a4]lc[o0]/i,                         name: "Meralco" },
  { pattern: /mayn[i1]l[a4]d/i,                           name: "Maynilad" },
  { pattern: /[m][e3][t][r][o0][\s-]?p[a4]c[i1]f[i1]c/i, name: "Metro Pacific" },
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
  const patterns = [
    // YYYY-MM-DD or YYYY/MM/DD (with optional time)
    /\b(\d{4}[\/\-]\d{2}[\/\-]\d{2})(?:\s+\d{2}:\d{2})?/,
    // Full month name: April 04, 2026 or April 4 2026
    /\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})\b/i,
    // Short month name: Apr 04, 2026 or 04 Apr 2026
    /\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4})\b/i,
    /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/i,
    // DD/MM/YYYY or MM/DD/YYYY (4-digit year)
    /\b(\d{2}[\/\-]\d{2}[\/\-]\d{4})\b/,
    // DD/MM/YY or MM/DD/YY (2-digit year)
    /\b(\d{2}[\/\-]\d{2}[\/\-]\d{2})\b/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;

    let raw = match[1].replace(/\//g, "-");

    // Handle DD-MM-YYYY: if first segment > 12 it must be the day
    const numeric = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (numeric) {
      const [, a, b, year] = numeric;
      const aNum = parseInt(a, 10);
      const bNum = parseInt(b, 10);
      if (aNum > 12 && bNum <= 12) {
        // DD-MM-YYYY → reorder to YYYY-MM-DD
        raw = `${year}-${b}-${a}`;
      } else {
        // Assume MM-DD-YYYY (or ambiguous — JS Date handles MM/DD natively)
        raw = `${year}-${a}-${b}`;
      }
    }

    // Expand 2-digit year: DD-MM-YY
    const shortYear = raw.match(/^(\d{2})-(\d{2})-(\d{2})$/);
    if (shortYear) {
      const [, a, b, yy] = shortYear;
      const year = parseInt(yy, 10) < 50 ? `20${yy}` : `19${yy}`;
      const aNum = parseInt(a, 10);
      const bNum = parseInt(b, 10);
      raw = aNum > 12 && bNum <= 12 ? `${year}-${b}-${a}` : `${year}-${a}-${b}`;
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return undefined;
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
    "   PH drug brands: Biogesic, Decolgen, Neozep, Diatabs, Bactidol, Kremil-S, Loperamide,",
    "   Ascorbic Acid, Solmux, Lagundi, Tuseran, Medicol, Alaxan, Flanax, Mefenamic Acid,",
    "   Amoxicillin, Metformin, Losartan, Amlodipine, Omeprazole, Cetirizine, Loratadine",
    "   ⚠️ MERCHANT OVERRIDE: If merchant is Mercury Drug, Watsons, Rose Pharmacy, Generika,",
    "   or Southstar Drug → ALWAYS Health > Pharmacy, regardless of item names",
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
    "       Local supermarkets/groceries:",
    "         SAVENORE/SAV3MORE → 'Savemore', PUREGO1D → 'Puregold'",
    "         ROB1NSONS → 'Robinson's', SM MALL/SM MARKET → 'SM'",
    "         ALFAMART/ALF4MART → 'Alfamart', HYPERMART → 'Hypermart'",
    "         WALTERMART → 'Waltermart', S&R/S&R COST CLUB → 'S&R'",
    "       Convenience stores:",
    "         7-3L3VEN/7-ELEVEN → '7-Eleven', MINISTOP/M1NISTOP → 'MiniStop'",
    "         FAMILYMART → 'FamilyMart', LAWSON → 'Lawson'",
    "       Fast food & restaurants:",
    "         JOLL1B3E → 'Jollibee', MCD0NALDS → 'McDonald's'",
    "         CH0WKING → 'Chowking', MANG INASAI → 'Mang Inasal'",
    "         KFC → 'KFC', SHAKEYS/5HAKEY'S → 'Shakey's'",
    "         PIZZA HUT/P1ZZA HUT → 'Pizza Hut', BURGER KING → 'Burger King'",
    "         B0NCHON → 'Bonchon', SUBWAY → 'Subway'",
    "       Coffee & drinks:",
    "         5TARBUCKS → 'Starbucks', CHATIME/CH4TIME → 'Chatime'",
    "         ZAGU → 'Zagu', TEA ISLAND → 'Tea Island'",
    "       Pharmacies:",
    "         M3RCURY DRUG → 'Mercury Drug', WAT5ONS → 'Watsons'",
    "         ROSE PHARMACY → 'Rose Pharmacy', GENERIKA/G3NERICA → 'Generika'",
    "         SOUTHSTAR DRUG → 'Southstar Drug'",
    "       Imported lifestyle brands (common in PH malls):",
    "         M1NISO/MINLS0 → 'Miniso', MUJI → 'Muji'",
    "         1KEA → 'IKEA', ZARA → 'Zara', H&M → 'H&M'",
    "         UNIQLO/UN1QL0 → 'Uniqlo', FOREVER 21 → 'Forever 21'",
    "         5KECHERS → 'Skechers', N1KE → 'Nike', AD1DAS → 'Adidas'",
    "       Fuel stations:",
    "         PETRON/P3TRON → 'Petron', SHELL → 'Shell'",
    "         CALTEX/C4LTEX → 'Caltex', SEAOIL → 'SeaOil'",
    "       Telecoms & utilities:",
    "         GL0BE → 'Globe', SMART → 'Smart', DITO → 'Dito'",
    "         PLDT/PL-DT → 'PLDT', MERALCO/M3RALCO → 'Meralco'",
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
    "❌ MISTAKE: Mercury Drug receipt with brand-name items → Other > Gifts",
    "✅ CORRECT: Mercury Drug, Watsons, Generika, Rose Pharmacy, Southstar Drug → Health > Pharmacy",
    "",
    "❌ MISTAKE: 'Biogesic', 'Decolgen', 'Neozep' items → Other (unrecognized)",
    "✅ CORRECT: Philippine drug brand names → Health > Pharmacy",
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
    "  \"subcategory\": one of exactly (must match the chosen category):",
    "    Food & Drinks       → 'Restaurants' | 'Drinks' | 'Fast Food' | 'Groceries' | 'Bakery' | 'Other Food & Drinks'",
    "    Transport           → 'Public Transit' | 'Ride-Sharing' | 'Taxi' | 'Gas/Fuel' | 'Parking' | 'Car Maintenance' | 'Bike/Motorcycle'",
    "    Health              → 'Pharmacy' | 'Gym/Fitness' | 'Dental'",
    "    Entertainment       → 'Movies & Streaming' | 'Concerts & Events' | 'Gaming' | 'Books & Audio' | 'Sports' | 'Hobbies'",
    "    Shopping & Personal → 'Clothing' | 'Shoes' | 'Cosmetics & Beauty' | 'Electronics' | 'Accessories'",
    "    Utilities & Home    → 'Electricity' | 'Water' | 'Internet' | 'Phone Bill' | 'Rent/Mortgage' | 'Home Repair' | 'Furniture'",
    "    Education           → 'Tuition' | 'Books & Materials' | 'Online Courses' | 'Supplies'",
    "    Travel & Vacation   → 'Flights' | 'Hotels' | 'Tours & Activities' | 'Travel Insurance'",
    "    Subscriptions & Memberships → 'App Subscriptions' | 'Club Memberships' | 'Premium Services'",
    "    Other               → 'Gifts' | 'Donations' | 'Uncategorized'",
    "  \"incurredAt\": ISO-8601 string (YYYY-MM-DDTHH:mm:ss.000Z),",
    "  \"confidence\": number (0.0 to 1.0)",
    "}",
    "",
    "⚠️ RULES:",
    "  • If the text does NOT appear to be a receipt or invoice (e.g. it is a photo, random text,",
    "    ID card, document, or completely unrelated content), return ONLY: { \"isReceipt\": false }",
    "  • Omit any field if you cannot determine it",
    "  • confidence should match your certainty (0.35 = unsure, 0.95 = very sure)",
    "  • Always pick a valid category (never invent categories)",
    "  • subcategory MUST be one of the exact strings listed above for the chosen category (never invent subcategories)",
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

      const llmController = new AbortController();
      const llmTimeout = setTimeout(() => llmController.abort(), 15_000);
      let response: Response;
      try {
        response = await fetch(`${llmBaseUrl}/chat/completions`, {
          method: "POST",
          headers,
          signal: llmController.signal,
          body: JSON.stringify({
            model: llmModel,
            temperature: 0,
            max_tokens: 200,
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
      } catch {
        clearTimeout(llmTimeout);
        continue;
      } finally {
        clearTimeout(llmTimeout);
      }

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

      if (parsed.isReceipt === false) {
        throw new Error("NOT_A_RECEIPT");
      }

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
    } catch (err) {
      if (err instanceof Error && err.message === "NOT_A_RECEIPT") {
        throw err;
      }
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
    const controller = new AbortController();
    const tesseractTimeout = setTimeout(() => controller.abort(), 60_000);
    let result: Awaited<ReturnType<typeof Tesseract.recognize>>;
    try {
      result = await Promise.race([
        Tesseract.recognize(buffer, "eng", {
          logger: () => undefined,
          // PSM 4: assume a single column of text of variable sizes (best for receipts)
          // OEM 3: auto-select best available engine (faster than LSTM-only on many images)
          tessedit_pageseg_mode: "4",
          tessedit_ocr_engine_mode: "3",
          // Preserve more characters found on receipts
          tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,:-/()&@#%₱$€£ \n"
        } as Parameters<typeof Tesseract.recognize>[2]),
        new Promise<never>((_, reject) =>
          controller.signal.addEventListener("abort", () =>
            reject(new Error("Tesseract OCR timed out after 60s"))
          )
        )
      ]);
    } finally {
      clearTimeout(tesseractTimeout);
    }
    return normalizeText(result.data.text);
  }

  return normalizeText(`Unsupported OCR format for ${fileName}. Upload an image or plain text file.`);
}

export async function processReceiptWithAI(fileName: string, mimeType: string, buffer: Buffer): Promise<ParsedReceipt> {
  const extractedText = await extractTextFromBuffer(fileName, mimeType, buffer);

  // Reject images with too little text to be a receipt (< 20 alphanumeric chars)
  const meaningfulChars = (extractedText.match(/[a-zA-Z0-9₱$]/g) ?? []).length;
  if (meaningfulChars < 20) {
    throw new Error("NOT_A_RECEIPT");
  }

  if (env.PARSER_MODE === "rules") {
    return parseWithRules(extractedText);
  }

  const llmResult = await parseWithLlm(extractedText);
  if (env.PARSER_MODE === "llm") {
    if (llmResult) return llmResult;
    const fallback = parseWithRules(extractedText);
    return {
      ...fallback,
      parserSource: "llm-fallback-rules",
      llmAttempted: true,
      llmSucceeded: false
    };
  }

  // hybrid — both results needed for mergeHybrid
  const ruleResult = parseWithRules(extractedText);
  return mergeHybrid(ruleResult, llmResult);
}

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
  if (llmKeys.length === 0) {
    return null;
  }

  const llmModel = env.LLM_MODEL || env.OPENAI_MODEL;

  // Build category spending summary from past expenses
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
      const weeklyHistAvg = histSpent / 4; // 4 weeks
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
        !Array.isArray(parsed.overspendFlags) ||
        !Array.isArray(parsed.warnings)
      ) {
        return null;
      }

      return {
        overspendFlags: parsed.overspendFlags,
        warnings: parsed.warnings
      };
    } catch {
      continue;
    }
  }

  return null;
}
