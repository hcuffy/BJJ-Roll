import { expoClient } from "@better-auth/expo/client";
import { type BetterAuthClientPlugin, createAuthClient } from "better-auth/client";
import * as Linking from "expo-linking";

export const DEEP_LINK_SCHEME = "bjjroll";
/** SecureStore key prefix: the session cookie lives under `bjjroll_cookie`. */
export const SESSION_STORAGE_PREFIX = "bjjroll";

type ExpoClientOptions = Parameters<typeof expoClient>[0];

export interface MobileAuthClientOptions {
  readonly backendUrl: string;
  /** expo-secure-store in the app; the session is kept nowhere else. */
  readonly storage: ExpoClientOptions["storage"];
  readonly fetchImplementation?: typeof fetch;
}

/**
 * Ends one server session by presenting that session's own cookie to Better Auth `/sign-out` (HEN-299).
 * The request bypasses the Expo plugin, so the stored session is neither sent nor cleared: holding the old cookie is the authority.
 */
function sessionCookieSignOut(options: MobileAuthClientOptions) {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const signOutUrl = `${options.backendUrl.replace(/\/+$/u, "")}/api/auth/sign-out`;
  return {
    id: "bjjroll-session-cookie-sign-out",
    getActions: () => ({
      /** True on a 2xx: the server deleted that session or no longer had it. False on any other status; rejects when offline or aborted. */
      signOutSessionCookie: async (sessionCookie: string, signal?: AbortSignal): Promise<boolean> => {
        const response = await fetchImplementation(signOutUrl, {
          method: "POST",
          credentials: "omit",
          signal,
          headers: {
            "content-type": "application/json",
            cookie: sessionCookie,
            // Same origin header the Expo plugin sends; the server trusts the app scheme.
            "expo-origin": Linking.createURL("", { scheme: DEEP_LINK_SCHEME }),
          },
          body: "{}",
        });
        return response.ok;
      },
    }),
  } satisfies BetterAuthClientPlugin;
}

export function createMobileAuthClient(options: MobileAuthClientOptions) {
  return createAuthClient({
    baseURL: options.backendUrl,
    // disableCache: no cached session data in SecureStore, only the session cookie (sign-out deletes it).
    plugins: [
      expoClient({ scheme: DEEP_LINK_SCHEME, storagePrefix: SESSION_STORAGE_PREFIX, storage: options.storage, disableCache: true }),
      sessionCookieSignOut(options),
    ],
    fetchOptions: options.fetchImplementation ? { customFetchImpl: options.fetchImplementation } : {},
  });
}

export type MobileAuthClient = ReturnType<typeof createMobileAuthClient>;
