import mongoose, { Schema, Document } from "mongoose";

export interface IChatMessage extends Document {
  userId: mongoose.Types.ObjectId;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
}

const ChatMessageSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const ChatMessage = mongoose.model<IChatMessage>("ChatMessage", ChatMessageSchema);
