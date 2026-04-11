import { Router } from "express";
import multer from "multer";
import mongoose from "mongoose";
import {
  receiptStatusResponseSchema,
  receiptUploadDisabledResponseSchema,
  receiptUploadResponseSchema
} from "../contracts/apiContract";
import { requireAuth } from "../middleware/auth";
import { Expense } from "../models/Expense";
import { Receipt } from "../models/Receipt";
import { canUseOcr } from "../services/featureFlags";
import { processReceiptWithAI } from "../services/ocrService";
import { asyncHandler } from "../utils/asyncHandler";

const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });
export const receiptRouter = Router();

async function processReceiptInBackground(params: {
  receiptId: string;
  userId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}) {
  const receipt = await Receipt.findOne({ _id: params.receiptId, userId: params.userId });
  if (!receipt) {
    return;
  }

  try {
    const parsed = await processReceiptWithAI(params.fileName, params.mimeType, params.buffer);

    receipt.status = "completed";
    receipt.extractedText = parsed.extractedText;
    receipt.parsedExpense = {
      amount: parsed.amount,
      merchant: parsed.merchant,
      category: parsed.category,
      subcategory: parsed.subcategory,
      incurredAt: parsed.incurredAt
    };
    receipt.parsedMeta = {
      parserSource: parsed.parserSource,
      parserConfidence: parsed.parserConfidence,
      llmAttempted: parsed.llmAttempted,
      llmSucceeded: parsed.llmSucceeded
    };
    await Promise.all([
      receipt.save(),
      ...(typeof parsed.amount === "number"
        ? [Expense.create({
            userId: new mongoose.Types.ObjectId(params.userId),
            amount: parsed.amount,
            currency: "PHP",
            category: parsed.category || "Other",
            subcategory: parsed.subcategory || "Uncategorized",
            merchant: parsed.merchant,
            incurredAt: parsed.incurredAt ? new Date(parsed.incurredAt) : new Date(),
            source: "ocr",
            receiptId: receipt._id,
            rawText: parsed.extractedText
          })]
        : [])
    ]);
  } catch (error) {
    receipt.status = "failed";
    if (error instanceof Error && error.message === "NOT_A_RECEIPT") {
      receipt.error = "The uploaded image does not appear to be a receipt. Please upload a photo of a valid receipt or invoice.";
    } else {
      receipt.error = error instanceof Error ? error.message : "OCR processing failed";
    }
    await receipt.save();
  }
}

receiptRouter.post("/upload", requireAuth, upload.single("receipt"), asyncHandler(async (req, res) => {
  if (!req.file || !req.userId) {
    return res.status(400).json({ message: "Missing receipt file" });
  }

  const userId = req.userId;
  const file = req.file;

  const receipt = await Receipt.create({
    userId,
    fileName: file.originalname,
    mimeType: file.mimetype,
    status: "uploaded"
  });

  const ocrAllowed = await canUseOcr(userId);
  if (!ocrAllowed) {
    const payload = receiptUploadDisabledResponseSchema.parse({
      receiptId: receipt.id,
      status: "uploaded",
      message: "OCR is disabled for this user"
    });
    return res.status(202).json(payload);
  }

  receipt.status = "processing";
  await receipt.save();

  // Return immediately so mobile clients can poll status instead of waiting on OCR/LLM latency.
  setImmediate(() => {
    void processReceiptInBackground({
      receiptId: receipt.id,
      userId,
      fileName: file.originalname,
      mimeType: file.mimetype,
      buffer: file.buffer
    });
  });

  const payload = receiptUploadResponseSchema.parse({
    receiptId: receipt.id,
    status: "processing"
  });
  return res.status(202).json(payload);
}));

receiptRouter.get("/:id/status", requireAuth, asyncHandler(async (req, res) => {
  const receipt = await Receipt.findOne({ _id: req.params.id, userId: req.userId }).lean();
  if (!receipt) {
    return res.status(404).json({ message: "Receipt not found" });
  }

  const payload = receiptStatusResponseSchema.parse({
    receiptId: String(receipt._id),
    status: receipt.status,
    parsedExpense: receipt.parsedExpense,
    parsedMeta: receipt.parsedMeta,
    error: receipt.error
  });
  return res.json(payload);
}));

receiptRouter.delete("/:id", requireAuth, asyncHandler(async (req, res) => {
  const receipt = await Receipt.findOne({ _id: req.params.id, userId: req.userId });
  if (!receipt) {
    return res.status(404).json({ message: "Receipt not found" });
  }

  // Also delete the linked expense if one was created from this receipt
  await Expense.deleteOne({ receiptId: receipt._id, userId: req.userId });
  await receipt.deleteOne();

  return res.json({ message: "Receipt deleted." });
}));
