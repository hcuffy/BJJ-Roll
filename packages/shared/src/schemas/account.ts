import { z } from "zod";
import { identifierSchema, timestampSchema } from "./common.js";
import { handleSchema } from "./handle.js";

/**
 * GET /account/export (HEN-65): everything M2 stores about the signed-in user, and nothing else.
 * Later features add their own keys next to `user` when they ship (ARCHITECTURE.md §5).
 */
export const accountExportSchema = z.strictObject({
  exportedAt: timestampSchema,
  user: z.strictObject({
    id: identifierSchema,
    email: z.email(),
    handle: handleSchema.nullable(),
    createdAt: timestampSchema,
  }),
});

export type AccountExport = z.infer<typeof accountExportSchema>;

/** DELETE /account (HEN-65): the account and every M2 row for it are gone. */
export const accountDeletionResponseSchema = z.strictObject({
  deleted: z.literal(true),
});

export type AccountDeletionResponse = z.infer<typeof accountDeletionResponseSchema>;
