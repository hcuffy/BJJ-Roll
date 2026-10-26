import { z } from "zod";
import { identifierSchema, timestampSchema } from "./common.js";
import { handleSchema } from "./handle.js";

/**
 * GET /account/export (HEN-65): everything M2 stores about the signed-in user, and nothing else.
 * Later features add their own keys next to `user` when they ship (ARCHITECTURE.md §5).
 */
/** HEN-239: the sign-in providers an account can link, by name. */
export const socialProviderNames = ["apple", "google"] as const;
export const socialProviderNameSchema = z.enum(socialProviderNames);
export type SocialProviderName = z.infer<typeof socialProviderNameSchema>;

export const accountExportSchema = z.strictObject({
  exportedAt: timestampSchema,
  user: z.strictObject({
    id: identifierSchema,
    email: z.email(),
    handle: handleSchema.nullable(),
    createdAt: timestampSchema,
    /** Linked Apple or Google sign-in, by provider name only. Empty for email-only accounts. */
    linkedProviders: z.array(socialProviderNameSchema),
  }),
});

export type AccountExport = z.infer<typeof accountExportSchema>;

/** DELETE /account (HEN-65): the account and every M2 row for it are gone. */
export const accountDeletionResponseSchema = z.strictObject({
  deleted: z.literal(true),
});

export type AccountDeletionResponse = z.infer<typeof accountDeletionResponseSchema>;

/** DELETE /account body (HEN-65, Henry 25 Oct): the fresh 6-digit code from the delete-code email, and nothing else. */
export const accountDeletionRequestSchema = z.strictObject({
  code: z.string().regex(/^\d{6}$/u),
});

export type AccountDeletionRequest = z.infer<typeof accountDeletionRequestSchema>;

/** POST /account/delete-code: a deletion code was emailed to the signed-in user's own address. */
export const accountDeletionCodeResponseSchema = z.strictObject({
  sent: z.literal(true),
});

export type AccountDeletionCodeResponse = z.infer<typeof accountDeletionCodeResponseSchema>;
