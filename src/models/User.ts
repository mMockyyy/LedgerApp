import mongoose, { Schema, model } from "mongoose";

export interface IUser extends mongoose.Document {
  email: string;
  username?: string;
  passwordHash?: string;
  isEmailVerified: boolean;
  provider: "email" | "google";
  googleId?: string;
  emailVerificationToken?: string;
  emailVerificationTokenExpires?: Date;
}

const userSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    username: { type: String, default: null, trim: true, maxlength: 30 },
    passwordHash: { type: String, default: null },
    isEmailVerified: { type: Boolean, default: false },
    provider: { type: String, enum: ["email", "google"], default: "email" },
    googleId: { type: String, trim: true },
    emailVerificationToken: { type: String, default: null },
    emailVerificationTokenExpires: { type: Date, default: null }
  },
  { timestamps: true }
);

userSchema.index(
  { googleId: 1 },
  {
    unique: true,
    partialFilterExpression: { googleId: { $type: "string" } }
  }
);

export const User = model<IUser>("User", userSchema);
