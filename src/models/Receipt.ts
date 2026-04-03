import mongoose, { Schema, model } from "mongoose";

export type ReceiptStatus = "uploaded" | "processing" | "completed" | "failed";

export interface IReceipt extends mongoose.Document {
  userId: mongoose.Types.ObjectId;
  fileName: string;
  mimeType: string;
  status: ReceiptStatus;
  extractedText?: string;
  parsedExpense?: {
    amount?: number;
    merchant?: string;
    category?: string;
    subcategory?: string;
    incurredAt?: string;
  };
  parsedMeta?: {
    parserSource?: string;
    parserConfidence?: number;
    llmAttempted?: boolean;
    llmSucceeded?: boolean;
  };
  error?: string;
}

const receiptSchema = new Schema<IReceipt>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    fileName: { type: String, required: true },
    mimeType: { type: String, required: true },
    status: { type: String, enum: ["uploaded", "processing", "completed", "failed"], default: "uploaded" },
    extractedText: { type: String },
    parsedExpense: {
      amount: { type: Number },
      merchant: { type: String },
      category: { type: String },
      subcategory: { type: String },
      incurredAt: { type: String }
    },
    parsedMeta: {
      parserSource: { type: String },
      parserConfidence: { type: Number },
      llmAttempted: { type: Boolean },
      llmSucceeded: { type: Boolean }
    },
    error: { type: String }
  },
  { timestamps: true }
);

export const Receipt = model<IReceipt>("Receipt", receiptSchema);
