import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { getChatHistory, getChatReply, clearChatHistory } from "../services/chatService";
import { asyncHandler } from "../utils/asyncHandler";

export const chatRouter = Router();

const chatRequestSchema = z.object({
  message: z.string().min(1).max(1000).trim()
});

// Send a message and get a reply
chatRouter.post("/", requireAuth, asyncHandler(async (req, res) => {
  const { message } = chatRequestSchema.parse(req.body);
  const reply = await getChatReply(req.userId!, message);
  return res.json({ reply });
}));

// Get chat history
chatRouter.get("/history", requireAuth, asyncHandler(async (req, res) => {
  const limit = req.query.limit ? Math.min(parseInt(req.query.limit as string, 10), 100) : 50;
  const messages = await getChatHistory(req.userId!, limit);
  return res.json({ messages });
}));

// Clear chat history
chatRouter.delete("/history", requireAuth, asyncHandler(async (req, res) => {
  await clearChatHistory(req.userId!);
  return res.json({ message: "Chat history cleared." });
}));
