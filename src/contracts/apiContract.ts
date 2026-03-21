import { z } from "zod";

export const authRegisterResponseSchema = z.object({
  id: z.string(),
  email: z.string().email()
});

export const authLoginResponseSchema = z.object({
  token: z.string().min(1)
});

export const expenseResponseSchema = z.object({
  id: z.string(),
  amount: z.number(),
  currency: z.string(),
  category: z.string(),
  merchant: z.string().optional(),
  note: z.string().optional(),
  incurredAt: z.string().datetime(),
  source: z.enum(["manual", "ocr"]),
  receiptId: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const expenseListResponseSchema = z.array(expenseResponseSchema);

export const receiptParsedExpenseSchema = z.object({
  amount: z.number().optional(),
  merchant: z.string().optional(),
  category: z.string().optional(),
  incurredAt: z.string().optional()
});

export const receiptParsedMetaSchema = z.object({
  parserSource: z.string().optional(),
  parserConfidence: z.number().optional(),
  llmAttempted: z.boolean().optional(),
  llmSucceeded: z.boolean().optional()
});

export const receiptUploadDisabledResponseSchema = z.object({
  receiptId: z.string(),
  status: z.literal("uploaded"),
  message: z.string()
});

export const receiptUploadResponseSchema = z.object({
  receiptId: z.string(),
  status: z.enum(["uploaded", "processing", "completed", "failed"]),
  parsed: receiptParsedExpenseSchema.optional(),
  parsedMeta: receiptParsedMetaSchema.optional()
});

export const receiptStatusResponseSchema = z.object({
  receiptId: z.string(),
  status: z.enum(["uploaded", "processing", "completed", "failed"]),
  parsedExpense: receiptParsedExpenseSchema.optional(),
  parsedMeta: receiptParsedMetaSchema.optional(),
  error: z.string().optional()
});

type ExpenseLike = {
  id?: string;
  _id?: unknown;
  amount: number;
  currency?: string;
  category: string;
  merchant?: string;
  note?: string;
  incurredAt: Date | string;
  source: "manual" | "ocr";
  receiptId?: unknown;
  createdAt?: Date | string;
  updatedAt?: Date | string;
};

export function serializeExpense(expense: ExpenseLike) {
  const expenseId = expense.id || String(expense._id || "");
  const normalizedReceiptId = expense.receiptId ? String(expense.receiptId) : undefined;
  const createdAt = expense.createdAt ? new Date(expense.createdAt) : new Date();
  const updatedAt = expense.updatedAt ? new Date(expense.updatedAt) : createdAt;

  return expenseResponseSchema.parse({
    id: expenseId,
    amount: expense.amount,
    currency: expense.currency || "PHP",
    category: expense.category,
    merchant: expense.merchant,
    note: expense.note,
    incurredAt: new Date(expense.incurredAt).toISOString(),
    source: expense.source,
    receiptId: normalizedReceiptId,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString()
  });
}
