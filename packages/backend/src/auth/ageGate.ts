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

/**
 * HEN-239: Apple or Google sign-in may create a user only with the same 17+ answer. Runs in the user-create database hook, so an
 * existing user (found by provider account or linked by verified email) never needs it. The native token path reads the answer from
 * the request body; the browser path reads it from the OAuth state saved when the flow started.
 */
export function isSocialSignUpAgeConfirmed(path: string | undefined, body: unknown, oauthStateAdditionalData: unknown): boolean {
  if (path === "/sign-in/social") {
    return ageConfirmedSchema.safeParse(readAgeConfirmed(readRecordField(body, "additionalData"))).success;
  }
  if (path?.startsWith("/callback/")) {
    return ageConfirmedSchema.safeParse(readAgeConfirmed(oauthStateAdditionalData)).success;
  }
  return true;
}

function readRecordField(source: unknown, field: string): unknown {
  return typeof source === "object" && source !== null ? (source as Record<string, unknown>)[field] : undefined;
}

function readAgeConfirmed(source: unknown): unknown {
  return readRecordField(source, "ageConfirmed");
}
