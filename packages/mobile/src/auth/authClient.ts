import { expoClient } from "@better-auth/expo/client";
import { type BetterAuthClientPlugin, createAuthClient } from "better-auth/client";
import * as Linking from "expo-linking";

export const DEEP_LINK_SCHEME = "bjjroll";
export const SESSION_STORAGE_PREFIX = "bjjroll";

export const sessionGoneStatuses: ReadonlySet<number> = new Set([401, 404, 410]);

type ExpoClientOptions = Parameters<typeof expoClient>[0];

export interface MobileAuthClientOptions {
  readonly backendUrl: string;
  readonly storage: ExpoClientOptions["storage"];
  readonly fetchImplementation?: typeof fetch;
}

function sessionCookieSignOut(options: MobileAuthClientOptions) {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const signOutUrl = `${options.backendUrl.replace(/\/+$/u, "")}/api/auth/sign-out`;
  return {
    id: "bjjroll-session-cookie-sign-out",
    getActions: () => ({
      signOutSessionCookie: async (sessionCookie: string, signal?: AbortSignal): Promise<boolean> => {
        const response = await fetchImplementation(signOutUrl, {
          method: "POST",
          credentials: "omit",
          signal,
          headers: {
            "content-type": "application/json",
            cookie: sessionCookie,
            "expo-origin": Linking.createURL("", { scheme: DEEP_LINK_SCHEME }),
          },
          body: "{}",
        });
        return response.ok || sessionGoneStatuses.has(response.status);
      },
    }),
  } satisfies BetterAuthClientPlugin;
}

export function createMobileAuthClient(options: MobileAuthClientOptions) {
  return createAuthClient({
    baseURL: options.backendUrl,
    plugins: [
      expoClient({ scheme: DEEP_LINK_SCHEME, storagePrefix: SESSION_STORAGE_PREFIX, storage: options.storage, disableCache: true }),
      sessionCookieSignOut(options),
    ],
    fetchOptions: options.fetchImplementation ? { customFetchImpl: options.fetchImplementation } : {},
  });
}

export type MobileAuthClient = ReturnType<typeof createMobileAuthClient>;
