import { AGE_GATE_REFUSAL_MESSAGE, ageConfirmedSchema } from "@bjj-roll/shared";

/**
 * HEN-77: a send that can lead to a new account needs `ageConfirmed: true` unless the email already has a user.
 * Only the email-OTP "sign-in" type and magic-link sign-in create users. Returns the 400 refusal, or null to continue.
 * The refusal is a returned response, not a thrown APIError, so Better Auth's error logger never records it.
 */
export async function ageGateRefusalForNewUser(
  path: string,
  body: unknown,
  findUserByEmail: (email: string) => Promise<unknown>,
): Promise<Response | null> {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const bodyRecord = body as Record<string, unknown>;
  const canCreateUser = path === "/sign-in/magic-link" || (path === "/email-otp/send-verification-otp" && bodyRecord.type === "sign-in");
  if (!canCreateUser || ageConfirmedSchema.safeParse(bodyRecord.ageConfirmed).success || typeof bodyRecord.email !== "string") {
    return null;
  }
  if (await findUserByEmail(bodyRecord.email.toLowerCase())) {
    return null;
  }
  return Response.json({ code: "AGE_CONFIRMATION_REQUIRED", message: AGE_GATE_REFUSAL_MESSAGE }, { status: 400 });
}
