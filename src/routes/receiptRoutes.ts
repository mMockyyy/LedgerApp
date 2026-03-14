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

receiptRouter.post("/upload", requireAuth, upload.single("receipt"), asyncHandler(async (req, res) => {
  if (!req.file || !req.userId) {
    return res.status(400).json({ message: "Missing receipt file" });
  }

  const receipt = await Receipt.create({
    userId: req.userId,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
    status: "uploaded"
  });

  const ocrAllowed = await canUseOcr(req.userId);
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

  try {
    const parsed = await processReceiptWithAI(req.file.originalname, req.file.mimetype, req.file.buffer);

    receipt.status = "completed";
    receipt.extractedText = parsed.extractedText;
    receipt.parsedExpense = {
      amount: parsed.amount,
      merchant: parsed.merchant,
      category: parsed.category,
      incurredAt: parsed.incurredAt
    };
    receipt.parsedMeta = {
      parserSource: parsed.parserSource,
      parserConfidence: parsed.parserConfidence,
      llmAttempted: parsed.llmAttempted,
      llmSucceeded: parsed.llmSucceeded
    };
    await receipt.save();

    if (typeof parsed.amount === "number") {
      await Expense.create({
        userId: new mongoose.Types.ObjectId(req.userId),
        amount: parsed.amount,
        currency: "USD",
        category: parsed.category || "Uncategorized",
        merchant: parsed.merchant,
        incurredAt: parsed.incurredAt ? new Date(parsed.incurredAt) : new Date(),
        source: "ocr",
        receiptId: receipt._id,
        rawText: parsed.extractedText
      });
    }

    const payload = receiptUploadResponseSchema.parse({
      receiptId: receipt.id,
      status: receipt.status,
      parsed: receipt.parsedExpense,
      parsedMeta: receipt.parsedMeta
    });
    return res.status(202).json(payload);
  } catch (error) {
    receipt.status = "failed";
    receipt.error = error instanceof Error ? error.message : "OCR processing failed";
    await receipt.save();
    return res.status(500).json({ message: receipt.error, receiptId: receipt.id });
  }
}));

receiptRouter.get("/:id/status", requireAuth, asyncHandler(async (req, res) => {
  const receipt = await Receipt.findOne({ _id: req.params.id, userId: req.userId }).lean();
  if (!receipt) {
    return res.status(404).json({ message: "Receipt not found" });
  }

  const payload = receiptStatusResponseSchema.parse({
    receiptId: receipt._id,
    status: receipt.status,
    parsedExpense: receipt.parsedExpense,
    parsedMeta: receipt.parsedMeta,
    error: receipt.error
  });
  return res.json(payload);
}));
