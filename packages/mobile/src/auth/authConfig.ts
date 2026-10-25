export interface ExpoConfigWithExtra {
  readonly extra?: Record<string, unknown> | undefined;
}

/** Backend URL from Expo config `extra.backendUrl` (app.json); screens never hard-code a URL. */
export function readBackendUrl(expoConfig: ExpoConfigWithExtra | null | undefined): string {
  const backendUrl = expoConfig?.extra?.backendUrl;
  if (typeof backendUrl !== "string" || !/^https?:\/\/[^\s/]+/u.test(backendUrl)) {
    throw new Error("Expo config extra.backendUrl must be an http(s) URL");
  }
  return backendUrl;
}
