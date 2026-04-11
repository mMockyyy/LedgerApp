import { Router } from "express";
import { z } from "zod";
import { expenseListResponseSchema, serializeExpense } from "../contracts/apiContract";
import { requireAuth } from "../middleware/auth";
import { Expense } from "../models/Expense";
import { MAIN_CATEGORIES, ALL_SUBCATEGORIES } from "../constants/categories";
import { asyncHandler } from "../utils/asyncHandler";

export const expenseRouter = Router();

const createExpenseSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().default("PHP"),
  category: z.string().refine((val) => MAIN_CATEGORIES.includes(val as any), {
    message: "Invalid category"
  }),
  subcategory: z.string().refine((val) => ALL_SUBCATEGORIES.includes(val as any), {
    message: "Invalid subcategory"
  }),
  merchant: z.string().optional(),
  note: z.string().optional(),
  incurredAt: z.string().datetime(),
  receiptId: z.string().optional()
});

expenseRouter.post("/", requireAuth, asyncHandler(async (req, res) => {
  const body = createExpenseSchema.parse(req.body);

  // If a receiptId is provided, this is a user-confirmed OCR expense.
  // Remove any auto-created expense from the OCR pipeline for this receipt
  // to avoid duplicates, then create the confirmed one with source="ocr".
  if (body.receiptId) {
    await Expense.deleteOne({ receiptId: body.receiptId, userId: req.userId });
  }

  const expense = await Expense.create({
    ...body,
    incurredAt: new Date(body.incurredAt),
    source: body.receiptId ? "ocr" : "manual",
    userId: req.userId
  });

  return res.status(201).json(serializeExpense(expense));
}));

expenseRouter.get("/", requireAuth, asyncHandler(async (req, res) => {
  const month = typeof req.query.month === "string" ? req.query.month : undefined;
  const filter: Record<string, unknown> = { userId: req.userId };

  if (month) {
    const start = new Date(`${month}-01T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    filter.incurredAt = { $gte: start, $lt: end };
  }

  const expenses = await Expense.find(filter).sort({ incurredAt: -1 }).lean();
  const payload = expenseListResponseSchema.parse(expenses.map((expense) => serializeExpense(expense)));
  return res.json(payload);
}));
