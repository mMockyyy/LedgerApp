import mongoose from "mongoose";
import { Expense } from "../models/Expense";
import { BudgetPlan } from "../models/BudgetPlan";
import { env } from "../config/env";

export interface WeekendPattern {
  trend: string;
  avgWeekendSpend: number;
  avgWeekdaySpend: number;
  weekendTotal: number;
  weekdayTotal: number;
}

export interface BudgetPredictionData {
  remainingBudget: number;
  projectedEndMonth: number;
  status: "on-track" | "at-risk" | "over";
  confidenceScore: number;
  message: string;
}

export interface TopCategoryData {
  category: string;
  subcategory?: string;
  amount: number;
  percentage: number;
  trend?: "up" | "down" | "stable";
}

export interface DashboardInsights {
  weekendPattern: WeekendPattern;
  budgetPrediction: BudgetPredictionData;
  topCategory: TopCategoryData;
  recommendations: Array<{
    id: number;
    title: string;
    description: string;
    savingsPotential?: number;
    category?: string;
  }>;
}

export interface AchievementAlert {
  type: "achievement" | "alert" | "pattern";
  title: string;
  description: string;
  amount?: number;
  savings?: number;
  category?: string;
  tag?: string;
}

export interface DetailedInsights {
  achievements: AchievementAlert[];
  alerts: AchievementAlert[];
  patterns: AchievementAlert[];
  prediction: {
    estimatedMonthEnd: number;
    daysRemaining: number;
    dailyTarget: number;
    confidence: number;
    message: string;
  };
}

// Data aggregation functions
async function getWeekendPattern(userId: mongoose.Types.ObjectId, days: number = 30): Promise<WeekendPattern> {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

  const expenses = await Expense.aggregate([
    {
      $match: {
        userId,
        incurredAt: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $addFields: {
        dayOfWeek: { $dayOfWeek: "$incurredAt" }
      }
    },
    {
      $group: {
        _id: "$dayOfWeek",
        total: { $sum: "$amount" },
        count: { $sum: 1 }
      }
    }
  ]);

  let weekendTotal = 0;
  let weekdayTotal = 0;
  let weekendCount = 0;
  let weekdayCount = 0;

  for (const exp of expenses) {
    const dayOfWeek = exp._id; // 1=Sunday, 7=Saturday
    const isWeekend = dayOfWeek === 1 || dayOfWeek === 7;

    if (isWeekend) {
      weekendTotal += exp.total;
      weekendCount += exp.count;
    } else {
      weekdayTotal += exp.total;
      weekdayCount += exp.count;
    }
  }

  const avgWeekend = weekendCount > 0 ? weekendTotal / weekendCount : 0;
  const avgWeekday = weekdayCount > 0 ? weekdayTotal / weekdayCount : 0;

  return {
    trend: avgWeekend > avgWeekday ? "You tend to spend more on weekends." : "You tend to spend more on weekdays.",
    avgWeekendSpend: Math.round(avgWeekend),
    avgWeekdaySpend: Math.round(avgWeekday),
    weekendTotal: Math.round(weekendTotal),
    weekdayTotal: Math.round(weekdayTotal)
  };
}

async function getTopCategory(userId: mongoose.Types.ObjectId, period: "week" | "month" | "all" = "month"): Promise<TopCategoryData> {
  let startDate = new Date();
  const endDate = new Date();

  if (period === "week") {
    startDate.setDate(startDate.getDate() - 7);
  } else if (period === "month") {
    startDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
  }

  const categoryTotals = await Expense.aggregate([
    {
      $match: {
        userId,
        incurredAt: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: "$category",
        total: { $sum: "$amount" }
      }
    },
    {
      $sort: { total: -1 }
    },
    { $limit: 1 }
  ]);

  if (categoryTotals.length === 0) {
    return {
      category: "No expenses",
      amount: 0,
      percentage: 0
    };
  }

  const topCat = categoryTotals[0];
  const totalSpent = await Expense.aggregate([
    {
      $match: {
        userId,
        incurredAt: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$amount" }
      }
    }
  ]);

  const total = totalSpent[0]?.total || 0;
  const percentage = total > 0 ? Math.round((topCat.total / total) * 100) : 0;

  return {
    category: topCat._id,
    amount: Math.round(topCat.total),
    percentage
  };
}

async function getBudgetPrediction(userId: mongoose.Types.ObjectId, monthlyBudget: number): Promise<BudgetPredictionData> {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);

  // Get current month spending
  const currentMonthSpending = await Expense.aggregate([
    {
      $match: {
        userId,
        incurredAt: { $gte: monthStart, $lt: today }
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$amount" }
      }
    }
  ]);

  const spent = currentMonthSpending[0]?.total || 0;
  const daysElapsed = Math.max(1, Math.floor((today.getTime() - monthStart.getTime()) / (1000 * 60 * 60 * 24)));
  const daysRemaining = Math.floor((monthEnd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  // Linear projection
  const dailyAverage = spent / daysElapsed;
  const projectedTotal = spent + dailyAverage * daysRemaining;
  const remaining = monthlyBudget - projectedTotal;

  let status: "on-track" | "at-risk" | "over" = "on-track";
  if (projectedTotal > monthlyBudget * 1.1) {
    status = "over";
  } else if (projectedTotal > monthlyBudget) {
    status = "at-risk";
  }

  return {
    remainingBudget: Math.round(Math.max(0, remaining)),
    projectedEndMonth: Math.round(projectedTotal),
    status,
    confidenceScore: Math.min(1, daysElapsed / 15), // Higher confidence as month progresses
    message:
      status === "over"
        ? `Based on your spending pattern, you'll exceed your budget by ₱${Math.round(projectedTotal - monthlyBudget)}.`
        : status === "at-risk"
          ? `You're at risk of exceeding your budget. Current projection: ₱${Math.round(projectedTotal)}.`
          : `On track! You'll have ₱${Math.round(remaining)} remaining at month end.`
  };
}

async function getCategoryTrend(userId: mongoose.Types.ObjectId, category: string, weeks: number = 4): Promise<"up" | "down" | "stable"> {
  const now = new Date();
  const recentWeekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const olderWeekStart = new Date(now.getTime() - weeks * 7 * 24 * 60 * 60 * 1000);
  const olderWeekEnd = new Date(recentWeekStart);

  const [recentSpend, olderSpend] = await Promise.all([
    Expense.aggregate([
      {
        $match: {
          userId,
          category,
          incurredAt: { $gte: recentWeekStart }
        }
      },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]),
    Expense.aggregate([
      {
        $match: {
          userId,
          category,
          incurredAt: { $gte: olderWeekStart, $lt: olderWeekEnd }
        }
      },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ])
  ]);

  const recent = recentSpend[0]?.total || 0;
  const older = olderSpend[0]?.total || 0;

  if (older === 0) return "stable";
  const percentChange = (recent - older) / older;
  if (percentChange > 0.1) return "up";
  if (percentChange < -0.1) return "down";
  return "stable";
}

async function detectSpendingSpikes(userId: mongoose.Types.ObjectId, threshold: number = 1.5): Promise<AchievementAlert[]> {
  const alerts: AchievementAlert[] = [];
  const today = new Date();
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);

  const categories = await Expense.distinct("category", { userId });

  for (const category of categories) {
    const [thisWeek, lastWeek] = await Promise.all([
      Expense.aggregate([
        {
          $match: {
            userId,
            category,
            incurredAt: { $gte: weekAgo }
          }
        },
        { $group: { _id: null, total: { $sum: "$amount" } } }
      ]),
      Expense.aggregate([
        {
          $match: {
            userId,
            category,
            incurredAt: { $gte: twoWeeksAgo, $lt: weekAgo }
          }
        },
        { $group: { _id: null, total: { $sum: "$amount" } } }
      ])
    ]);

    const thisWeekTotal = thisWeek[0]?.total || 0;
    const lastWeekTotal = lastWeek[0]?.total || 0;

    if (lastWeekTotal > 0) {
      const ratio = thisWeekTotal / lastWeekTotal;
      if (ratio > threshold) {
        alerts.push({
          type: "alert",
          title: `${category} Spending Alert`,
          description: `Your ${category.toLowerCase()} expenses increased by ${Math.round((ratio - 1) * 100)}% this week compared to last week.`,
          amount: thisWeekTotal,
          category
        });
      }
    }
  }

  return alerts;
}

async function detectAchievements(userId: mongoose.Types.ObjectId): Promise<AchievementAlert[]> {
  const achievements: AchievementAlert[] = [];
  const today = new Date();
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);

  const categories = await Expense.distinct("category", { userId });

  for (const category of categories) {
    const [thisWeek, lastWeek] = await Promise.all([
      Expense.aggregate([
        {
          $match: {
            userId,
            category,
            incurredAt: { $gte: weekAgo }
          }
        },
        { $group: { _id: null, total: { $sum: "$amount" } } }
      ]),
      Expense.aggregate([
        {
          $match: {
            userId,
            category,
            incurredAt: { $gte: twoWeeksAgo, $lt: weekAgo }
          }
        },
        { $group: { _id: null, total: { $sum: "$amount" } } }
      ])
    ]);

    const thisWeekTotal = thisWeek[0]?.total || 0;
    const lastWeekTotal = lastWeek[0]?.total || 0;

    if (lastWeekTotal > 0 && thisWeekTotal < lastWeekTotal * 0.85) {
      const savings = Math.round(lastWeekTotal - thisWeekTotal);
      achievements.push({
        type: "achievement",
        title: "Great Job!",
        description: `You spent ${Math.round(((lastWeekTotal - thisWeekTotal) / lastWeekTotal) * 100)}% less on ${category.toLowerCase()} this week compared to last week.`,
        savings,
        category,
        tag: "15% reduction"
      });
    }
  }

  return achievements;
}

async function generateLLMInsights(aggregatedData: any, userId: string): Promise<AchievementAlert[]> {
  const keys = [process.env.LLM_API_KEY, process.env.OPENAI_API_KEY].filter(Boolean);
  if (keys.length === 0) {
    return [];
  }

  const prompt = [
    "You are a personal finance AI that generates spending insights and recommendations.",
    "You have the following spending data:",
    JSON.stringify(aggregatedData, null, 2),
    "",
    "Generate 2-3 actionable insights or alerts as a JSON array. Each item should have: type ('alert' | 'pattern' | 'insight'), title (string), description (string), and optionally amount (number) or category (string).",
    "Keep descriptions concise and actionable.",
    "Return ONLY a valid JSON array, no markdown or explanation."
  ].join("\n");

  for (const apiKey of keys) {
    if (!apiKey) continue;

    try {
      const isOpenRouter = apiKey.startsWith("sk-or-");
      const baseUrl = isOpenRouter ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1";

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(isOpenRouter && {
            "HTTP-Referer": env.APP_URL || "http://localhost:3000",
            "X-Title": "LedgerApp Insights"
          })
        },
        body: JSON.stringify({
          model: env.LLM_MODEL || env.OPENAI_MODEL || "gpt-4o-mini",
          temperature: 0.7,
          messages: [
            {
              role: "system",
              content: "You are a personal finance insights generator. Return only valid JSON."
            },
            {
              role: "user",
              content: prompt
            }
          ]
        })
      });

      if (!response.ok) {
        if (response.status >= 500) continue;
        return [];
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const content = data.choices?.[0]?.message?.content;
      if (!content) return [];

      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const insights = JSON.parse(jsonMatch[0]) as AchievementAlert[];
      return insights.filter((i) => i.title && i.description);
    } catch {
      continue;
    }
  }

  return [];
}

// Main public functions
export async function getDashboardInsights(userId: mongoose.Types.ObjectId, monthlyBudget: number = 10000): Promise<DashboardInsights> {
  const [weekendPattern, budgetPrediction, topCategory] = await Promise.all([
    getWeekendPattern(userId),
    getBudgetPrediction(userId, monthlyBudget),
    getTopCategory(userId, "month")
  ]);

  // Generate LLM recommendations (run in background, but await for now)
  const aggregatedData = {
    weekendPattern,
    budgetPrediction,
    topCategory,
    period: "current month"
  };

  const llmRecommendations = await generateLLMInsights(aggregatedData, userId.toString());

  const recommendations = llmRecommendations.map((rec, idx) => ({
    id: idx + 1,
    title: rec.title,
    description: rec.description,
    savingsPotential: rec.amount || undefined,
    category: rec.category || undefined
  }));

  return {
    weekendPattern,
    budgetPrediction,
    topCategory,
    recommendations
  };
}

export async function getDetailedInsights(userId: mongoose.Types.ObjectId, monthlyBudget: number = 10000): Promise<DetailedInsights> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const daysRemaining = Math.ceil((monthEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  const [achievements, alerts, weekendPattern, totalSpent] = await Promise.all([
    detectAchievements(userId),
    detectSpendingSpikes(userId),
    getWeekendPattern(userId),
    Expense.aggregate([
      {
        $match: {
          userId,
          incurredAt: { $gte: monthStart, $lt: now }
        }
      },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ])
  ]);

  const spent = totalSpent[0]?.total || 0;
  const dailyTarget = (monthlyBudget - spent) / daysRemaining;

  const patterns: AchievementAlert[] = [];
  if (weekendPattern.avgWeekendSpend > weekendPattern.avgWeekdaySpend) {
    patterns.push({
      type: "pattern",
      title: "Weekly Pattern",
      description: `You tend to spend more on weekends. Average weekend spending: ₱${weekendPattern.avgWeekendSpend}, weekdays: ₱${weekendPattern.avgWeekdaySpend}.`,
      tag: "Fridays & Saturdays"
    });
  }

  const prediction = {
    estimatedMonthEnd: spent + dailyTarget * daysRemaining,
    daysRemaining,
    dailyTarget: Math.round(dailyTarget),
    confidence: Math.min(1, (now.getDate() - 1) / 15),
    message:
      spent + dailyTarget * daysRemaining > monthlyBudget
        ? `Based on current pace, you'll exceed budget by ₱${Math.round(spent + dailyTarget * daysRemaining - monthlyBudget)}.`
        : `On track! You can spend ₱${Math.round(dailyTarget)} daily to stay within budget.`
  };

  return {
    achievements,
    alerts,
    patterns,
    prediction
  };
}

export async function getMonthlyCategoryTrends(userId: mongoose.Types.ObjectId): Promise<Array<TopCategoryData>> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const totalSpent = await Expense.aggregate([
    {
      $match: {
        userId,
        incurredAt: { $gte: monthStart }
      }
    },
    { $group: { _id: null, total: { $sum: "$amount" } } }
  ]);

  const total = totalSpent[0]?.total || 0;

  const trends = await Expense.aggregate([
    {
      $match: {
        userId,
        incurredAt: { $gte: monthStart }
      }
    },
    {
      $group: {
        _id: "$category",
        amount: { $sum: "$amount" }
      }
    },
    { $sort: { amount: -1 } }
  ]);

  const results: TopCategoryData[] = [];
  for (const trend of trends) {
    const percentage = total > 0 ? Math.round((trend.amount / total) * 100) : 0;
    const trend_dir = await getCategoryTrend(userId, trend._id);

    results.push({
      category: trend._id,
      amount: Math.round(trend.amount),
      percentage,
      trend: trend_dir
    });
  }

  return results;
}
