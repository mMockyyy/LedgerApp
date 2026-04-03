import mongoose, { Schema, model } from "mongoose";
import { MAIN_CATEGORIES, ALL_SUBCATEGORIES } from "../constants/categories";

export type ExpenseSource = "manual" | "ocr";

export interface IExpense extends mongoose.Document {
  userId: mongoose.Types.ObjectId;
  amount: number;
  currency: string;
  category: string;
  subcategory: string;
  merchant?: string;
  note?: string;
  incurredAt: Date;
  source: ExpenseSource;
  receiptId?: mongoose.Types.ObjectId;
  rawText?: string;
}

const expenseSchema = new Schema<IExpense>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: "PHP" },
    category: { 
      type: String, 
      enum: MAIN_CATEGORIES,
      required: true 
    },
    subcategory: { 
      type: String, 
      enum: ALL_SUBCATEGORIES,
      required: true 
    },
    merchant: { type: String },
    note: { type: String },
    incurredAt: { type: Date, required: true },
    source: { type: String, enum: ["manual", "ocr"], default: "manual" },
    receiptId: { type: Schema.Types.ObjectId, ref: "Receipt" },
    rawText: { type: String }
  },
  { timestamps: true }
);

export const Expense = model<IExpense>("Expense", expenseSchema);
