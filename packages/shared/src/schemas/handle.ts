import { z } from "zod";
import { handleMaximumLengthPlaceholder, handleMinimumLengthPlaceholder } from "./limits.js";

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
  "owner",
  "superuser",
  "sysadmin",
  "webmaster",
  "postmaster",
  "abuse",
  "noreply",
  "privacy",
  "legal",
  "billing",
  "helpdesk",
  "moderators",
  "everyone",
  "anonymous",
  "deleted",
  "guest",
] as const;

export type ReservedHandle = (typeof reservedHandles)[number];

const lookalikeCharacters: Readonly<Record<string, string>> = { "0": "o", "1": "i", l: "i", "3": "e", "4": "a", "5": "s", "7": "t" };

function normalizeForReservedCheck(candidate: string): string {
  return [...candidate.trim().toLowerCase().replaceAll("_", "")].map((character) => lookalikeCharacters[character] ?? character).join("");
}

const reservedHandleSet = new Set<string>(reservedHandles.map(normalizeForReservedCheck));

export const handlePattern = /^[a-z0-9_]+$/;
const asciiHandleCharactersPattern = /^[A-Za-z0-9_]+$/;

export function isReservedHandle(candidate: string): boolean {
  return reservedHandleSet.has(normalizeForReservedCheck(candidate));
}

export const handleSchema = z
  .string()
  .trim()
  .min(handleMinimumLengthPlaceholder)
  .max(handleMaximumLengthPlaceholder)
  .regex(asciiHandleCharactersPattern, "Handle may only contain ASCII letters, digits, and underscores")
  .toLowerCase()
  .regex(handlePattern, "Handle may only contain lowercase ASCII letters, digits, and underscores")
  .refine((value) => !isReservedHandle(value), {
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
