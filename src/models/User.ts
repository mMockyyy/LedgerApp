import mongoose, { Schema, model } from "mongoose";

export interface IUser extends mongoose.Document {
  email: string;
  passwordHash: string;
}

const userSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true }
  },
  { timestamps: true }
);

export const User = model<IUser>("User", userSchema);
