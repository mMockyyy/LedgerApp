import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { Budget } from "../models/Budget";
import { BudgetPlan } from "../models/BudgetPlan";
import { Expense } from "../models/Expense";
import { generateBudgetPlanWithAI } from "../services/ocrService";
import { asyncHandler } from "../utils/asyncHandler";

export const budgetRouter = Router();

const budgetSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  category: z.string().min(1),
  limit: z.number().positive()
});

const generatePlanSchema = z.object({
  weeklyBudget: z.number().positive(),
  categoryAllocations: z.record(z.string(), z.number().positive())
});

budgetRouter.post("/", requireAuth, asyncHandler(async (req, res) => {
  const body = budgetSchema.parse(req.body);

  const budget = await Budget.findOneAndUpdate(
    { userId: req.userId, month: body.month, category: body.category },
    { $set: { limit: body.limit } },
    { upsert: true, new: true }
  );

  return res.status(201).json(budget);
}));

// Generate AI-powered weekly budget plan
budgetRouter.post("/generate-plan", requireAuth, asyncHandler(async (req, res) => {
  const body = generatePlanSchema.parse(req.body);

  // Calculate week boundaries (Monday to Sunday)
  const today = new Date();
  const dayOfWeek = today.getDay() || 7; // Sunday = 7
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - (dayOfWeek - 1));
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  // Fetch past 4 weeks of expenses (28 days prior to week start)
  const fourWeeksAgo = new Date(weekStart);
  fourWeeksAgo.setDate(weekStart.getDate() - 28);

  const pastExpenses = await Expense.find({
    userId: req.userId,
    incurredAt: {
      $gte: fourWeeksAgo,
      $lt: weekStart
    }
  });

  // Transform to LLM-friendly format
  const expenseData = pastExpenses.map((exp) => ({
    category: exp.category || "Uncategorized",
    amount: exp.amount
  }));

  // Generate AI warnings/flags based on user's own allocations vs history
  const aiPlan = await generateBudgetPlanWithAI(body.weeklyBudget, body.categoryAllocations, expenseData);

  if (!aiPlan) {
    return res.status(500).json({ error: "Failed to generate budget plan. Please try again." });
  }

  const dailyBudget = Math.round((body.weeklyBudget / 7) * 100) / 100;

  // Save or update plan in database
  const plan = await BudgetPlan.findOneAndUpdate(
    { userId: req.userId, weekStart },
    {
      $set: {
        userId: req.userId,
        weekStart,
        weekEnd,
        weeklyBudget: body.weeklyBudget,
        dailyBudget,
        categoryAllocations: body.categoryAllocations,
        overspendFlags: aiPlan.overspendFlags,
        warnings: aiPlan.warnings
      }
    },
    { upsert: true, new: true }
  );

  return res.status(200).json(plan);
}));

// Get current active budget plan with daily progress
budgetRouter.get("/plan", requireAuth, asyncHandler(async (req, res) => {
  // Calculate current week boundaries (Monday to Sunday)
  const today = new Date();
  const dayOfWeek = today.getDay() || 7;
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - (dayOfWeek - 1));
  weekStart.setHours(0, 0, 0, 0);

  const plan = await BudgetPlan.findOne({
    userId: req.userId,
    weekStart
  });

  if (!plan) {
    return res.status(404).json({ error: "No active budget plan for this week. Generate one first." });
  }

  // Calculate daily progress (today only)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const todayExpenses = await Expense.find({
    userId: req.userId,
    incurredAt: {
      $gte: todayStart,
      $lte: todayEnd
    }
  });

  const daySpent = todayExpenses.reduce((sum, exp) => sum + exp.amount, 0);
  const dayStatus =
    daySpent > plan.dailyBudget * 1.1 ? "over" : daySpent > plan.dailyBudget ? "warning" : "on-track";

  // Calculate category progress for the week
  const weekExpenses = await Expense.find({
    userId: req.userId,
    incurredAt: {
      $gte: weekStart,
      $lt: new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000)
    }
  });

  const categoryProgress = Object.entries(plan.categoryAllocations).map(([category, limit]) => {
    const spent = weekExpenses
      .filter((exp) => (exp.category || "Uncategorized") === category)
      .reduce((sum, exp) => sum + exp.amount, 0);

    const status =
      spent > (limit as number) * 1.1 ? "over" : spent > (limit as number) ? "warning" : "on-track";

    return {
      category,
      spent,
      limit,
      status,
      percentUsed: Math.round((spent / (limit as number)) * 100)
    };
  });

  return res.status(200).json({
    plan,
    dailyProgress: {
      total: daySpent,
      budget: plan.dailyBudget,
      status: dayStatus,
      percentUsed: Math.round((daySpent / plan.dailyBudget) * 100)
    },
    categoryProgress
  });
}));

// Get daily progress alert
budgetRouter.get("/plan/daily-progress", requireAuth, asyncHandler(async (req, res) => {
  const today = new Date();
  const dayOfWeek = today.getDay() || 7;
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - (dayOfWeek - 1));
  weekStart.setHours(0, 0, 0, 0);

  const plan = await BudgetPlan.findOne({
    userId: req.userId,
    weekStart
  });

  if (!plan) {
    return res.status(404).json({ error: "No active budget plan." });
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const todayExpenses = await Expense.find({
    userId: req.userId,
    incurredAt: {
      $gte: todayStart,
      $lte: todayEnd
    }
  });

  const daySpent = todayExpenses.reduce((sum, exp) => sum + exp.amount, 0);
  const status =
    daySpent > plan.dailyBudget * 1.1 ? "over" : daySpent > plan.dailyBudget ? "warning" : "on-track";

  return res.status(200).json({
    date: today.toISOString().split("T")[0],
    dailyBudget: plan.dailyBudget,
    spent: daySpent,
    remaining: Math.max(0, plan.dailyBudget - daySpent),
    status,
    percentUsed: Math.round((daySpent / plan.dailyBudget) * 100)
  });
}));
