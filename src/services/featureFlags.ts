import { env } from "../config/env";
import { FeatureFlag } from "../models/FeatureFlag";

export async function canUseOcr(userId: string) {
  if (env.OCR_ENABLED_GLOBAL) {
    return true;
  }

  const flag = await FeatureFlag.findOne({ key: "ocr" }).lean();
  if (!flag) {
    return false;
  }

  return flag.enabled || flag.userIds.includes(userId);
}
