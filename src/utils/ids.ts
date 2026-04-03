import crypto from "node:crypto";

export function createApprovalId(): string {
  return crypto.randomBytes(6).toString("hex");
}
