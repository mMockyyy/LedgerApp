import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/auth";
import { Expense } from "../models/Expense";
import { asyncHandler } from "../utils/asyncHandler";

export const insightsRouter = Router();

insightsRouter.get("/monthly", requireAuth, asyncHandler(async (req, res) => {
  const month = typeof req.query.month === "string" ? req.query.month : new Date().toISOString().slice(0, 7);
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const userObjectId = new mongoose.Types.ObjectId(req.userId);

  const summary = await Expense.aggregate([
    {
      $match: {
        userId: userObjectId,
        incurredAt: { $gte: start, $lt: end }
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
    }
  ]);

  const total = summary.reduce((acc, item) => acc + Number(item.total || 0), 0);
  return res.json({ month, total, byCategory: summary });
}));
