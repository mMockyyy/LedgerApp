import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/auth";
import { Expense } from "../models/Expense";
import { BudgetPlan } from "../models/BudgetPlan";
import { asyncHandler } from "../utils/asyncHandler";

export const insightsRouter = Router();

insightsRouter.get("/monthly", requireAuth, asyncHandler(async (req, res) => {
  const month = typeof req.query.month === "string" ? req.query.month : new Date().toISOString().slice(0, 7);
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const userObjectId = new mongoose.Types.ObjectId(req.userId);

  // Get expenses grouped by category and subcategory
  const summary = await Expense.aggregate([
    {
      $match: {
        userId: userObjectId,
        incurredAt: { $gte: start, $lt: end }
      }
    },
    {
      $group: {
        _id: {
          category: "$category",
          subcategory: "$subcategory"
        },
        total: { $sum: "$amount" }
      }
    },
    {
      $sort: { "_id.category": 1, total: -1 }
    }
  ]);

  // Transform to include subcategory breakdown
  const byCategory: Array<{
    _id: string;
    total: number;
    bySubcategory: Array<{ subcategory: string; total: number }>;
  }> = [];

  const categoryMap = new Map<string, { total: number; subcategories: Map<string, number> }>();

  // Build category map
  for (const item of summary) {
    const category = item._id.category;
    const subcategory = item._id.subcategory;
    const total = item.total;

    if (!categoryMap.has(category)) {
      categoryMap.set(category, { total: 0, subcategories: new Map() });
    }

    const catData = categoryMap.get(category)!;
    catData.total += total;
    catData.subcategories.set(subcategory, (catData.subcategories.get(subcategory) || 0) + total);
  }

  // Convert to response format
  for (const [category, data] of Array.from(categoryMap.entries()).sort()) {
    const bySubcategory = Array.from(data.subcategories.entries())
      .map(([subcategory, total]) => ({ subcategory, total }))
      .sort((a, b) => b.total - a.total);

    byCategory.push({
      _id: category,
      total: data.total,
      bySubcategory
    });
  }

  const total = byCategory.reduce((acc, item) => acc + item.total, 0);

  // Try to get budget plan for the current week (if it exists)
  const today = new Date();
  const dayOfWeek = today.getDay() || 7;
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - (dayOfWeek - 1));
  weekStart.setHours(0, 0, 0, 0);

  const budgetPlan = await BudgetPlan.findOne({
    userId: userObjectId,
    weekStart
  });

  const response: any = { month, total, byCategory };

  // Add budget comparison if plan exists
  if (budgetPlan) {
    let monthlyBudgeted = 0;
    const budgetDetails: { [key: string]: number } = {};

    Object.entries(budgetPlan.categoryAllocations).forEach(([category, dailyLimit]) => {
      const weeksInMonth = Math.ceil(
        (end.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000)
      );
      const monthlyLimit = (dailyLimit as number) * 7 * weeksInMonth;
      budgetDetails[category] = monthlyLimit;
      monthlyBudgeted += monthlyLimit;
    });

    response.budget = {
      weeklyBudget: budgetPlan.weeklyBudget,
      monthlyProjected: budgetPlan.weeklyBudget * 4.33, // Average weeks per month
      categoryLimits: budgetDetails,
      monthlyLimitProjected: monthlyBudgeted * 4.33
    };

    response.progress = {
      spent: total,
      budgeted: monthlyBudgeted * 4.33,
      percentUsed: Math.round(
        (total / (monthlyBudgeted * 4.33)) * 100
      ),
      status:
        total > (monthlyBudgeted * 4.33) * 1.1
          ? "over"
          : total > monthlyBudgeted * 4.33
            ? "warning"
            : "on-track"
    };
  }

  return res.json(response);
}));
