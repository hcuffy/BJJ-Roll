import { z } from "zod";
import { handleMaximumLength, handleMinimumLength } from "./limits.js";

export const reservedHandles = [
  "admin",
  "administrator",
  "root",
  "support",
  "help",
  "system",
  "staff",
  "moderator",
  "mod",
  "official",
  "bjjroll",
  "bjj_roll",
  "api",
  "me",
  "settings",
  "account",
  "security",
  "team",
  "null",
  "undefined",
] as const;

export type ReservedHandle = (typeof reservedHandles)[number];

const reservedHandleSet = new Set<string>(reservedHandles);

export const handlePattern = /^[a-z0-9_]+$/;
const asciiHandleCharactersPattern = /^[A-Za-z0-9_]+$/;

export function isReservedHandle(candidate: string): boolean {
  return reservedHandleSet.has(candidate.trim().toLowerCase());
}

export const handleSchema = z
  .string()
  .trim()
  .min(handleMinimumLength)
  .max(handleMaximumLength)
  .regex(asciiHandleCharactersPattern, "Handle may only contain ASCII letters, digits, and underscores")
  .toLowerCase()
  .regex(handlePattern, "Handle may only contain lowercase ASCII letters, digits, and underscores")
  .refine((value) => !reservedHandleSet.has(value), {
    message: "Handle is reserved",
  });

export type Handle = z.infer<typeof handleSchema>;

export const setHandleRequestSchema = z.strictObject({
  handle: handleSchema,
});

export type SetHandleRequest = z.infer<typeof setHandleRequestSchema>;

export const handleAvailabilityResponseSchema = z.strictObject({
  available: z.boolean(),
  handle: handleSchema,
});

export type HandleAvailabilityResponse = z.infer<typeof handleAvailabilityResponseSchema>;
