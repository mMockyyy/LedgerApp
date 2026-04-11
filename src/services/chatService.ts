import mongoose from "mongoose";
import { env } from "../config/env";
import { BudgetPlan } from "../models/BudgetPlan";
import { ChatMessage } from "../models/ChatMessage";
import { Expense } from "../models/Expense";

const HISTORY_LIMIT = 20; // number of past messages sent to LLM as context

// ---------------------------------------------------------------------------
// Build spending context from the user's real data
// ---------------------------------------------------------------------------

async function buildUserContext(userId: string): Promise<string> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(now.getDate() - 30);

  const uid = new mongoose.Types.ObjectId(userId);

  // Category totals for the last 30 days
  const categoryTotals = await Expense.aggregate([
    { $match: { userId: uid, incurredAt: { $gte: thirtyDaysAgo } } },
    { $group: { _id: "$category", total: { $sum: "$amount" }, count: { $sum: 1 } } },
    { $sort: { total: -1 } }
  ]);

  // Overall total
  const overallTotal = categoryTotals.reduce((sum, c) => sum + c.total, 0);

  // Recent 10 transactions
  const recentExpenses = await Expense.find(
    { userId: uid },
    { amount: 1, category: 1, subcategory: 1, merchant: 1, incurredAt: 1 }
  )
    .sort({ incurredAt: -1 })
    .limit(10)
    .lean();

  // Active budget plan (current week)
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);

  const budgetPlan = await BudgetPlan.findOne({
    userId,
    weekStart: { $lte: now },
    weekEnd: { $gte: now }
  }).lean();

  // Build context string
  const lines: string[] = [
    `Today's date: ${now.toISOString().slice(0, 10)}`,
    ``,
    `=== SPENDING SUMMARY (last 30 days) ===`,
    `Total spent: PHP ${overallTotal.toFixed(2)}`,
  ];

  if (categoryTotals.length > 0) {
    lines.push(``, `By category:`);
    for (const cat of categoryTotals) {
      const pct = overallTotal > 0 ? ((cat.total / overallTotal) * 100).toFixed(1) : "0.0";
      lines.push(`  - ${cat._id}: PHP ${cat.total.toFixed(2)} (${pct}%, ${cat.count} transaction${cat.count !== 1 ? "s" : ""})`);
    }
  } else {
    lines.push(`No expenses recorded in the last 30 days.`);
  }

  if (recentExpenses.length > 0) {
    lines.push(``, `=== RECENT TRANSACTIONS ===`);
    for (const e of recentExpenses) {
      const date = new Date(e.incurredAt).toISOString().slice(0, 10);
      const merchant = e.merchant ? ` at ${e.merchant}` : "";
      lines.push(`  - ${date}: PHP ${e.amount.toFixed(2)}${merchant} [${e.category} > ${e.subcategory}]`);
    }
  }

  if (budgetPlan) {
    lines.push(``, `=== CURRENT WEEK BUDGET PLAN ===`);
    lines.push(`Weekly budget: PHP ${budgetPlan.weeklyBudget.toFixed(2)}`);
    lines.push(`Daily budget: PHP ${budgetPlan.dailyBudget.toFixed(2)}`);

    const allocations = budgetPlan.categoryAllocations as unknown as Record<string, number>;
    const allocationEntries = Object.entries(allocations);
    if (allocationEntries.length > 0) {
      lines.push(`Category allocations (daily):`);
      for (const [cat, limit] of allocationEntries) {
        lines.push(`  - ${cat}: PHP ${Number(limit).toFixed(2)}/day`);
      }
    }

    if (budgetPlan.overspendFlags?.length > 0) {
      lines.push(`Overspend flags: ${budgetPlan.overspendFlags.join(", ")}`);
    }

    if (budgetPlan.warnings?.length > 0) {
      lines.push(`Warnings: ${budgetPlan.warnings.join(" | ")}`);
    }
  } else {
    lines.push(``, `No active budget plan for this week.`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// LLM helpers (same pattern as ocrService)
// ---------------------------------------------------------------------------

function getLlmApiKeys(): string[] {
  const list = (env.LLM_API_KEYS || "").split(",").map((k) => k.trim()).filter(Boolean);
  const combined = [env.LLM_API_KEY, env.OPENAI_API_KEY, ...list]
    .filter((k): k is string => Boolean(k?.trim()))
    .map((k) => k.trim());
  return Array.from(new Set(combined));
}

function resolveAppReferer(): string {
  return env.APP_URL || env.RENDER_EXTERNAL_URL || "http://localhost:3000";
}

// ---------------------------------------------------------------------------
// System prompt — restricts the bot to finance/budget topics only
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are LedgerBot, a personal finance assistant built into LedgerApp — a budget and expense tracking app for Filipino users.

Your ONLY job is to help users understand their spending, manage their budget, and make better financial decisions based on their real expense data provided below.

STRICT RULES:
- Only answer questions about expenses, budgets, spending habits, saving tips, and personal finance.
- If the user asks anything unrelated to money, budgeting, or their LedgerApp data, politely decline and redirect them to ask about their finances.
- Never make up transaction data. Only refer to the data provided in the context.
- Keep answers concise and practical. Use PHP (Philippine Peso) for amounts.
- Be friendly but professional. Address the user directly.

USER'S FINANCIAL DATA:
{context}`;

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function getChatReply(userId: string, message: string): Promise<string> {
  const llmKeys = getLlmApiKeys();
  if (llmKeys.length === 0) {
    return "The chat assistant is not configured yet. Please ask your administrator to set up the LLM API key.";
  }

  const uid = new mongoose.Types.ObjectId(userId);

  // Load recent history and build user context in parallel
  const [history, context] = await Promise.all([
    ChatMessage.find({ userId: uid })
      .sort({ createdAt: -1 })
      .limit(HISTORY_LIMIT)
      .lean(),
    buildUserContext(userId)
  ]);

  // Save the incoming user message immediately
  await ChatMessage.create({ userId: uid, role: "user", content: message });

  const systemPrompt = SYSTEM_PROMPT.replace("{context}", context);
  const llmModel = env.LLM_MODEL || env.OPENAI_MODEL;

  // Build message array: system + history (oldest first) + current message
  const historyMessages = history
    .reverse()
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...historyMessages,
    { role: "user" as const, content: message }
  ];

  for (const llmKey of llmKeys) {
    const isOpenRouter = llmKey.startsWith("sk-or-");
    const baseUrl = env.LLM_BASE_URL || (isOpenRouter ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1");

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${llmKey}`,
        "Content-Type": "application/json"
      };
      if (baseUrl.includes("openrouter.ai")) {
        headers["HTTP-Referer"] = resolveAppReferer();
        headers["X-Title"] = "LedgerApp Chat";
      }

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: llmModel,
          temperature: 0.5,
          max_tokens: 400,
          messages
        }),
        signal: AbortSignal.timeout(20_000)
      });

      if (!response.ok) {
        const shouldRetry = [401, 402, 403, 429].includes(response.status) || response.status >= 500;
        if (shouldRetry) continue;
        return "I'm having trouble connecting right now. Please try again in a moment.";
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const reply = data.choices?.[0]?.message?.content?.trim();
      if (!reply) return "I couldn't generate a response. Please try again.";

      // Save assistant reply to history
      await ChatMessage.create({ userId: uid, role: "assistant", content: reply });

      return reply;
    } catch {
      continue;
    }
  }

  return "I'm unavailable right now. Please try again later.";
}

// ---------------------------------------------------------------------------
// Fetch chat history for a user (for display in the app)
// ---------------------------------------------------------------------------

export async function getChatHistory(userId: string, limit = 50) {
  const uid = new mongoose.Types.ObjectId(userId);
  const messages = await ChatMessage.find({ userId: uid })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  return messages.reverse().map((m) => ({
    role: m.role,
    content: m.content,
    createdAt: m.createdAt
  }));
}

// ---------------------------------------------------------------------------
// Clear chat history for a user
// ---------------------------------------------------------------------------

export async function clearChatHistory(userId: string) {
  const uid = new mongoose.Types.ObjectId(userId);
  await ChatMessage.deleteMany({ userId: uid });
}
