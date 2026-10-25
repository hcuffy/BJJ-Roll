import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/client";

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

export function createMobileAuthClient(options: MobileAuthClientOptions) {
  return createAuthClient({
    baseURL: options.backendUrl,
    plugins: [expoClient({ scheme: DEEP_LINK_SCHEME, storagePrefix: SESSION_STORAGE_PREFIX, storage: options.storage })],
    fetchOptions: options.fetchImplementation ? { customFetchImpl: options.fetchImplementation } : {},
  });
}

export type MobileAuthClient = ReturnType<typeof createMobileAuthClient>;
