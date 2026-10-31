import { DEEP_LINK_CALLBACK_URL, DEEP_LINK_SCHEME } from "./authLimits.js";

export const MAGIC_LINK_REDIRECT_PARAMETERS = ["callbackURL", "newUserCallbackURL", "errorCallbackURL"] as const;

const DEEP_LINK_HOST = new URL(DEEP_LINK_CALLBACK_URL).host;
const DEEP_LINK_PREFIX = `${DEEP_LINK_SCHEME}://${DEEP_LINK_HOST}`;
const MAX_CALLBACK_URL_LENGTH = 2048;

function isAllowedDeepLinkForm(candidate: string): boolean {
  if (candidate !== candidate.trim() || candidate.includes("@") || candidate.includes("\\")) {
    return false;
  }
  const remainder = candidate.slice(DEEP_LINK_PREFIX.length);
  if (!candidate.startsWith(DEEP_LINK_PREFIX) || !(remainder === "" || /^[/?#]/u.test(remainder))) {
    return false;
  }
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === `${DEEP_LINK_SCHEME}:` && parsed.host === DEEP_LINK_HOST && parsed.username === "" && parsed.password === "";
  } catch {
    return false;
  }
}

export function isAllowedDeepLinkCallbackUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_CALLBACK_URL_LENGTH) {
    return false;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return false;
  }
  return isAllowedDeepLinkForm(value) && isAllowedDeepLinkForm(decoded);
}

export function findInvalidRedirectParameters(source: (name: string) => unknown): string[] {
  return MAGIC_LINK_REDIRECT_PARAMETERS.filter((name) => {
    const value = source(name);
    return value !== undefined && value !== null && !isAllowedDeepLinkCallbackUrl(value);
  });
}
