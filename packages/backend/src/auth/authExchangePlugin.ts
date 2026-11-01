import { randomBytes } from "node:crypto";
import { createAuthEndpoint, createAuthMiddleware, APIError, getOAuthState } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { BetterAuthPlugin } from "better-auth/types";
import type { Pool } from "pg";
import { MAGIC_LINK_EXCHANGE_CODE_EXPIRY_SECONDS } from "./authLimits.js";
import { isAllowedDeepLinkCallbackUrl } from "./deepLinkCallback.js";
import type { AuthCryptoCodec } from "./authSecrets.js";
import { currentMs, toMs } from "../dates.js";
import { insertVerification, readVerifierHash, takeMagicLinkVerifierHash, verifierMatches, withVerificationScope } from "./signInVerifier.js";

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
  exchangeParameters: { rawCode: string; userId: string; verifierHash: string | null },
): Promise<void> {
  const identifier = `${EXCHANGE_IDENTIFIER_PREFIX}${codec.hashExchangeCode(exchangeParameters.rawCode)}`;
  const payload = { userId: exchangeParameters.userId, verifierHash: exchangeParameters.verifierHash };
  await withVerificationScope(pool, { identifier, userId: exchangeParameters.userId }, async (client) => {
    await insertVerification(client, {
      identifier,
      userId: exchangeParameters.userId,
      value: codec.encryptVerificationPayload(JSON.stringify(payload)),
      lifetimeSeconds: MAGIC_LINK_EXCHANGE_CODE_EXPIRY_SECONDS,
    });
  });
}

function invalidExchangeCode(): APIError {
  return new APIError("UNAUTHORIZED", { message: "Invalid or already used magic link exchange code" });
}

async function consumeExchangeCodeFromDatabase(
  pool: Pool,
  codec: AuthCryptoCodec,
  exchange: { rawCode: string; verifier: unknown },
): Promise<{ userId: string }> {
  const identifier = `${EXCHANGE_IDENTIFIER_PREFIX}${codec.hashExchangeCode(exchange.rawCode)}`;
  const userId = await withVerificationScope(pool, { identifier }, async (client) => {
    const selected = await client.query<StoredExchangeCodeRow>(
      "SELECT id, value, user_id, expires_at FROM public.verifications WHERE identifier = $1 FOR UPDATE",
      [identifier],
    );
    const row = selected.rows[0];
    if (!row || currentMs() >= toMs(row.expires_at)) {
      return null;
    }
    const parsed = JSON.parse(codec.decryptVerificationPayload(row.value)) as { userId?: unknown; verifierHash?: unknown };
    if (!verifierMatches(readVerifierHash(parsed), exchange.verifier)) {
      return null;
    }
    await client.query("DELETE FROM public.verifications WHERE id = $1", [row.id]);
    return typeof parsed.userId === "string" ? parsed.userId : row.user_id;
  });
  if (!userId) {
    throw invalidExchangeCode();
  }
  return { userId };
}

type AuthEndpointContext = Parameters<typeof setSessionCookie>[0];

export function createMagicLinkExchangePlugin(pluginOptions: CreateMagicLinkExchangePluginOptions): BetterAuthPlugin {
  const { pool, codec } = pluginOptions;

  const executeExchange = async (context: AuthEndpointContext) => {
    let bodyObject = context.body as { code?: unknown; verifier?: unknown } | undefined;
    if (!bodyObject && context.request) {
      try {
        bodyObject = (await context.request.clone().json()) as { code?: unknown; verifier?: unknown };
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

    const { userId } = await consumeExchangeCodeFromDatabase(pool, codec, { rawCode, verifier: bodyObject?.verifier });
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

            const verifierHash = middlewareContext.path.startsWith("/callback/")
              ? readVerifierHash(await getOAuthState())
              : await takeMagicLinkVerifierHash(pool, codec, (middlewareContext.query as Record<string, unknown> | undefined)?.token);
            const rawExchangeCode = generateRawExchangeCode();
            await storeExchangeCodeInDatabase(pool, codec, {
              rawCode: rawExchangeCode,
              userId,
              verifierHash,
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
