import { Schema, model } from "mongoose";

interface IFeatureFlag {
  key: string;
  enabled: boolean;
  userIds: string[];
}

const featureFlagSchema = new Schema<IFeatureFlag>(
  {
    key: { type: String, required: true, unique: true },
    enabled: { type: Boolean, default: false },
    userIds: { type: [String], default: [] }
  },
  { timestamps: true }
);

export const FeatureFlag = model<IFeatureFlag>("FeatureFlag", featureFlagSchema);
