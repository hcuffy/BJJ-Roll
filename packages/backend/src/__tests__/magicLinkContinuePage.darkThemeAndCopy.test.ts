import { describe, expect, it } from "vitest";
import { magicLinkContinuePage } from "../auth/magicLinkContinuePage.js";

const pageHtml = async () => await magicLinkContinuePage().text();

describe("the magic link Continue page matches the dark app and names the right phone (Vera fixes 4, 5, 6)", () => {
  it("uses the dark base, the lime pill button, the muted note and a visible focus ring", async () => {
    const html = await pageHtml();

    expect(html).toContain('<meta name="color-scheme" content="dark">');
    expect(html).toMatch(/body \{[^}]*background: #111313;[^}]*color: #FFFFFF;/u);
    expect(html).toMatch(/button \{[^}]*min-height: 48px;[^}]*border-radius: 999px;[^}]*background: #E0F154;[^}]*color: #111313;/u);
    expect(html).toMatch(/p\.note \{[^}]*color: #A0A3A0;/u);
    expect(html).toMatch(/button:focus-visible \{ outline: 3px solid #FFFFFF; outline-offset: 3px; \}/u);
    expect(html).not.toContain("outline: none");
  });

  it("tells the user which phone to use, what to do if the app didn't open, and that nothing happens unless they tap", async () => {
    const html = await pageHtml();
    const body = "Tap Continue to finish signing in to BJJ Roll on the phone where you asked for this link.";
    const didNotOpen = "BJJ Roll didn't open? Open this email on the phone with BJJ Roll, or send a new link from the app.";
    const ignoreNote = "Didn't ask to sign in? Close this page. Nothing happens unless you tap Continue.";

    expect(html).toContain(`<p>${body}</p>`);
    expect(html.indexOf(didNotOpen)).toBeGreaterThan(html.indexOf("</form>"));
    expect(html.indexOf(didNotOpen)).toBeLessThan(html.indexOf(ignoreNote));
    expect(html).not.toContain("on this phone");
    expect(html).not.toContain("until you tap");
  });
});
