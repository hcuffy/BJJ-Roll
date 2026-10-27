import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findPaymentLinks, parseAllowList, parseDenyList, scanMobilePackage } from "../../scripts/paymentLinkGuard";

const mobileRoot = fileURLToPath(new URL("../..", import.meta.url));
const denyPatterns = parseDenyList(readFileSync(`${mobileRoot}/release/paymentLinkDenyList.txt`, "utf8"));

function hitsIn(text: string, allowListText = ""): string[] {
  return findPaymentLinks([{ path: "src/screens/Example.tsx", text }], denyPatterns, parseAllowList(allowListText)).map((hit) => hit.matchedText);
}

describe("payment link guard deny-list", () => {
  it.each([
    ["Buy Me a Coffee", 'const supportUrl = "https://buymeacoffee.com/henry";', "buymeacoffee.com"],
    ["Buy Me a Coffee short link", 'const supportUrl = "https://buymeacoff.ee/henry";', "buymeacoff.ee"],
    ["Ko-fi", 'const supportUrl = "https://ko-fi.com/henry";', "ko-fi.com"],
    ["Stripe Checkout", 'Linking.openURL("https://checkout.stripe.com/c/pay/cs_test_example");', "checkout.stripe.com"],
    ["Stripe payment link", 'Linking.openURL("https://buy.stripe.com/test_example");', "buy.stripe.com"],
    ["PayPal.Me", "Tip me at https://www.paypal.me/henry", "paypal.me"],
    ["PayPal donate", "https://www.paypal.com/donate/?hosted_button_id=EXAMPLE", "https://www.paypal.com/donate"],
    ["Patreon", "Support on https://patreon.com/henry", "patreon.com"],
    ["donate URL", 'href="https://example.org/donate"', "https://example.org/donate"],
    ["tip URL", 'href="https://example.org/tip/henry"', "https://example.org/tip"],
  ])("fails on a %s link", (_label, sourceText, expectedMatch) => {
    expect(hitsIn(sourceText).map((matchedText) => matchedText.toLowerCase())).toContain(expectedMatch);
  });

  it("matches regardless of letter case", () => {
    expect(hitsIn('const supportUrl = "https://BuyMeACoffee.com/henry";')).toHaveLength(1);
  });

  it("passes on ordinary app text and links", () => {
    expect(hitsIn('const tooltip = "Tap to start"; const docsUrl = "https://docs.expo.dev/tips-and-tricks";')).toEqual([]);
  });

  it("passes when the hit is allow-listed for that file with a reason", () => {
    const allowListText = "src/screens/Example.tsx | ko-fi.com | Example only, never shown in the app";

    expect(hitsIn('const supportUrl = "https://ko-fi.com/henry";', allowListText)).toEqual([]);
  });

  it("still fails when the allow-list entry is for another file", () => {
    const allowListText = "src/screens/Other.tsx | ko-fi.com | Example only, never shown in the app";

    expect(hitsIn('const supportUrl = "https://ko-fi.com/henry";', allowListText)).toEqual(["ko-fi.com"]);
  });

  it("rejects an allow-list entry without a reason", () => {
    expect(() => parseAllowList("src/screens/Example.tsx | ko-fi.com |")).toThrow(/reason/u);
  });

  it("passes on the current mobile package", () => {
    expect(scanMobilePackage(mobileRoot)).toEqual([]);
  });
});
