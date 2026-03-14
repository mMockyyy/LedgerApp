import mongoose from "mongoose";

export async function connectDb(uri: string) {
  await mongoose.connect(uri, {
    dbName: "ledgerapp"
  });
  console.log("Connected to MongoDB Atlas");
}
