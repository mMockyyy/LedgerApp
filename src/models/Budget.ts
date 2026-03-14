import mongoose, { Schema, model } from "mongoose";

export interface IBudget extends mongoose.Document {
  userId: mongoose.Types.ObjectId;
  month: string;
  category: string;
  limit: number;
}

const budgetSchema = new Schema<IBudget>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    month: { type: String, required: true },
    category: { type: String, required: true },
    limit: { type: Number, required: true }
  },
  { timestamps: true }
);

budgetSchema.index({ userId: 1, month: 1, category: 1 }, { unique: true });

export const Budget = model<IBudget>("Budget", budgetSchema);
