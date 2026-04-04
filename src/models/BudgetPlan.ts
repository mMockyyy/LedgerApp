import mongoose, { Schema, Document } from "mongoose";

export interface IBudgetPlan extends Document {
  userId: string;
  weekStart: Date;
  weekEnd: Date;
  weeklyBudget: number;
  dailyBudget: number;
  categoryAllocations: {
    [key: string]: number;
  };
  overspendFlags: string[];
  warnings: string[];
  createdAt: Date;
  updatedAt: Date;
}

const BudgetPlanSchema = new Schema(
  {
    userId: {
      type: String,
      required: true,
    },
    weekStart: {
      type: Date,
      required: true,
    },
    weekEnd: {
      type: Date,
      required: true,
    },
    weeklyBudget: {
      type: Number,
      required: true,
      min: 0,
    },
    dailyBudget: {
      type: Number,
      required: true,
      min: 0,
    },
    categoryAllocations: {
      type: Map,
      of: Number,
      required: true,
    },
    overspendFlags: [
      {
        type: String,
      },
    ],
    warnings: [
      {
        type: String,
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Unique index: one plan per user per week
BudgetPlanSchema.index({ userId: 1, weekStart: 1 }, { unique: true });

export const BudgetPlan = mongoose.model<IBudgetPlan>(
  "BudgetPlan",
  BudgetPlanSchema
);
