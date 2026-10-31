export interface ExpoConfigWithExtra {
  readonly extra?: Record<string, unknown> | undefined;
}

export function readBackendUrl(expoConfig: ExpoConfigWithExtra | null | undefined): string {
  const backendUrl = expoConfig?.extra?.backendUrl;
  if (typeof backendUrl !== "string" || !/^https?:\/\/[^\s/]+/u.test(backendUrl)) {
    throw new Error("Expo config extra.backendUrl must be an http(s) URL");
  }
  return backendUrl;
}
