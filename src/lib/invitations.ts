import { z } from "zod";

export const strongPassword = z.string().min(12, "Use at least 12 characters").max(128)
  .regex(/[a-z]/, "Add a lowercase letter").regex(/[A-Z]/, "Add an uppercase letter")
  .regex(/[0-9]/, "Add a number").regex(/[^A-Za-z0-9\s]/, "Add a symbol");
export const usernameSchema = z.string().trim().toLowerCase().min(3).max(40).regex(/^[a-z0-9][a-z0-9._-]*$/, "Use letters, numbers, dots, underscores or hyphens");
export const inviteSchema = z.object({
  username: usernameSchema,
  displayName: z.string().trim().min(1).max(100),
  phone: z.string().trim().regex(/^\+[1-9][0-9]{7,14}$/, "Enter a phone number with country code, e.g. +639171234567"),
  email: z.union([z.string().trim().email().max(254), z.literal("")]),
  password: strongPassword,
});
export function externalLoginEmail(username: string) {
  return `${usernameSchema.parse(username)}@external.field-ops.invalid`;
}
export function loginEmail(identifier: string) {
  return identifier.includes("@") ? identifier.trim() : externalLoginEmail(identifier);
}