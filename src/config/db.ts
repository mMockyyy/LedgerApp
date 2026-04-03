import mongoose from "mongoose";
import { User } from "../models/User";

export async function connectDb(uri: string) {
  await mongoose.connect(uri, {
    dbName: "ledgerapp"
  });

  // Keep MongoDB indexes aligned with schema updates (e.g., googleId partial unique index).
  await User.syncIndexes();
  console.log("Connected to MongoDB Atlas");
}
