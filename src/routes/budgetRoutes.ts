import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { Budget } from "../models/Budget";
import { asyncHandler } from "../utils/asyncHandler";

export const budgetRouter = Router();

const budgetSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  category: z.string().min(1),
  limit: z.number().positive()
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
