import { randomBytes, randomUUID } from "node:crypto";
import { createAuthEndpoint, createAuthMiddleware, APIError } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { BetterAuthPlugin } from "better-auth/types";
import type { Pool } from "pg";
import { MAGIC_LINK_EXCHANGE_CODE_EXPIRY_SECONDS } from "./authLimits.js";
import { isAllowedDeepLinkCallbackUrl } from "./deepLinkCallback.js";
import type { AuthCryptoCodec } from "./authSecrets.js";
import { currentDate, currentMs, secondsAfter, toMs } from "../dates.js";

const EXCHANGE_IDENTIFIER_PREFIX = "magic-link-exchange:";

export interface CreateMagicLinkExchangePluginOptions {
  readonly pool: Pool;
  readonly codec: AuthCryptoCodec;
}

interface StoredExchangeCodeRow {
  readonly id: string;
  readonly value: string;
  readonly user_id: string | null;
  readonly expires_at: Date | string;
}

function generateRawExchangeCode(): string {
  return randomBytes(32).toString("base64url");
}

function extractRawSessionTokenFromSetCookie(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) {
    return null;
  }
  const match = /session_token=([^;,\s]+)/u.exec(setCookieHeader);
  if (!match?.[1]) {
    return null;
  }
  const decoded = decodeURIComponent(match[1]);
  const dotIndex = decoded.indexOf(".");
  return dotIndex > 0 ? decoded.slice(0, dotIndex) : decoded;
}

async function storeExchangeCodeInDatabase(
  pool: Pool,
  codec: AuthCryptoCodec,
  exchangeParameters: { rawCode: string; userId: string },
): Promise<void> {
  const hashedCode = codec.hashExchangeCode(exchangeParameters.rawCode);
  const identifier = `${EXCHANGE_IDENTIFIER_PREFIX}${hashedCode}`;
  const encryptedValue = codec.encryptVerificationPayload(JSON.stringify({ userId: exchangeParameters.userId }));
  const now = currentDate();
  const expiresAt = secondsAfter(now, MAGIC_LINK_EXCHANGE_CODE_EXPIRY_SECONDS);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE bjj_app");
    await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.verification_identifier', $2, true)", [
      exchangeParameters.userId,
      identifier,
    ]);
    await client.query(
      `INSERT INTO public.verifications (id, user_id, identifier, value, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), exchangeParameters.userId, identifier, encryptedValue, expiresAt, now, now],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function consumeExchangeCodeFromDatabase(pool: Pool, codec: AuthCryptoCodec, rawCode: string): Promise<{ userId: string }> {
  const hashedCode = codec.hashExchangeCode(rawCode);
  const identifier = `${EXCHANGE_IDENTIFIER_PREFIX}${hashedCode}`;

  const client = await pool.connect();
  let consumedRow: StoredExchangeCodeRow | undefined;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE bjj_app");
    await client.query("SELECT set_config('app.verification_identifier', $1, true)", [identifier]);
    const deleted = await client.query<StoredExchangeCodeRow>(
      `DELETE FROM public.verifications
       WHERE identifier = $1
       RETURNING id, value, user_id, expires_at`,
      [identifier],
    );
    await client.query("COMMIT");
    consumedRow = deleted.rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  if (!consumedRow) {
    throw new APIError("UNAUTHORIZED", {
      message: "Invalid or already used magic link exchange code",
    });
  }

  const expiresAtMilliseconds = toMs(consumedRow.expires_at);
  if (currentMs() >= expiresAtMilliseconds) {
    throw new APIError("UNAUTHORIZED", {
      message: "Magic link exchange code has expired",
    });
  }

  const decryptedJson = codec.decryptVerificationPayload(consumedRow.value);
  const parsed = JSON.parse(decryptedJson) as { userId?: unknown };
  let userId: string | null = null;
  if (typeof parsed.userId === "string") {
    userId = parsed.userId;
  } else if (typeof consumedRow.user_id === "string") {
    userId = consumedRow.user_id;
  }

  if (!userId) {
    throw new APIError("UNAUTHORIZED", {
      message: "Invalid exchange code payload",
    });
  }

  return { userId };
}

type AuthEndpointContext = Parameters<typeof setSessionCookie>[0];

export function createMagicLinkExchangePlugin(pluginOptions: CreateMagicLinkExchangePluginOptions): BetterAuthPlugin {
  const { pool, codec } = pluginOptions;

  const executeExchange = async (context: AuthEndpointContext) => {
    let bodyObject = context.body as { code?: unknown } | undefined;
    if (!bodyObject && context.request) {
      try {
        bodyObject = (await context.request.clone().json()) as { code?: unknown };
      } catch {
        bodyObject = undefined;
      }
    }
    const rawCode = typeof bodyObject?.code === "string" ? bodyObject.code.trim() : "";
    if (!rawCode) {
      throw new APIError("BAD_REQUEST", {
        message: "Exchange code is required",
      });
    }

    const { userId } = await consumeExchangeCodeFromDatabase(pool, codec, rawCode);
    const user = await context.context.internalAdapter.findUserById(userId);
    if (!user) {
      throw new APIError("UNAUTHORIZED", {
        message: "User not found for exchange code",
      });
    }

    const session = await context.context.internalAdapter.createSession(user.id, false);
    if (!session) {
      throw new APIError("INTERNAL_SERVER_ERROR", {
        message: "Failed to create session from exchange code",
      });
    }

    await setSessionCookie(context, { session, user });
    return await context.json({
      token: session.token,
      user,
      session,
    });
  };

  return {
    id: "bjj-magic-link-exchange",
    hooks: {
      after: [
        {
          matcher(hookContext) {
            return Boolean(hookContext.path?.startsWith("/magic-link/verify") || hookContext.path?.startsWith("/callback/"));
          },
          handler: createAuthMiddleware(async (middlewareContext) => {
            const responseHeaders = middlewareContext.context.responseHeaders;
            const locationHeader = responseHeaders?.get("location") ?? null;
            if (!locationHeader || !isAllowedDeepLinkCallbackUrl(locationHeader)) {
              return;
            }

            const newSession = middlewareContext.context.newSession;
            let userId = newSession?.user.id ?? null;
            let sessionTokenToRevoke = newSession?.session.token ?? null;

            if (!sessionTokenToRevoke) {
              sessionTokenToRevoke = extractRawSessionTokenFromSetCookie(responseHeaders?.get("set-cookie") ?? null);
            }

            if (sessionTokenToRevoke) {
              if (!userId) {
                const found = await middlewareContext.context.internalAdapter.findSession(sessionTokenToRevoke);
                userId = found?.user.id ?? null;
              }
              await middlewareContext.context.internalAdapter.deleteSession(sessionTokenToRevoke).catch(() => undefined);
            }

            if (!userId) {
              return;
            }

            const rawExchangeCode = generateRawExchangeCode();
            await storeExchangeCodeInDatabase(pool, codec, {
              rawCode: rawExchangeCode,
              userId,
            });

            responseHeaders?.delete("set-cookie");

            const redirectUrl = new URL(locationHeader);
            redirectUrl.searchParams.delete("cookie");
            redirectUrl.searchParams.delete("token");
            redirectUrl.searchParams.delete("session_token");
            redirectUrl.searchParams.set("code", rawExchangeCode);

            middlewareContext.setHeader("location", redirectUrl.toString());
          }),
        },
      ],
    },
    endpoints: {
      exchangeMagicLinkCode: createAuthEndpoint("/magic-link/exchange", { method: "POST" }, executeExchange),
    },
  };
}
