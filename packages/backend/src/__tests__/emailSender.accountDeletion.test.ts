import { describe, expect, it } from "vitest";
import {
  EmailSendError,
  FakeEmailSender,
  LettermintEmailSender,
  type LettermintSendRequestBody,
  renderAccountDeletedEmail,
  renderOneTimeCodeEmail,
} from "../email/index.js";

const to = "leaving.member@example.test";

describe("account deletion emails (HEN-65, Henry 25 Oct)", () => {
  it("renders the delete code in its own plain copy, so it never reads as a sign-in code", () => {
    const rendered = renderOneTimeCodeEmail({ to, code: "482913", expiresInMinutes: 10, purpose: "account_deletion" });
    expect(rendered.subject).toBe("Your BJJ Roll code to delete your account");
    expect(rendered.text).toBe(
      "Your code to delete your BJJ Roll account is 482913. It expires in 10 minutes. " +
        "If you did not ask to delete your account, ignore this email and your account stays as it is.",
    );
    expect(rendered.text).not.toContain(to);
  });

  it("keeps the sign-in code copy unchanged when no purpose is given", () => {
    expect(renderOneTimeCodeEmail({ to, code: "482913", expiresInMinutes: 10 }).subject).toBe("Your BJJ Roll sign-in code");
    expect(renderOneTimeCodeEmail({ to, code: "482913", expiresInMinutes: 10, purpose: "sign_in" }).subject).toBe("Your BJJ Roll sign-in code");
  });

  it("renders the deleted notice: plain, final, and says signing up again makes a new empty account", () => {
    const rendered = renderAccountDeletedEmail({ to });
    expect(rendered.subject).toBe("Your BJJ Roll account was deleted");
    expect(rendered.text).toBe(
      [
        "Your BJJ Roll account has been deleted, along with your handle and sign-in details. This cannot be undone.",
        "",
        "If you sign up again with this email address, you will get a new, empty account.",
      ].join("\n"),
    );
    expect(rendered.text).not.toContain(to);
    expect(() => renderAccountDeletedEmail({ to: "  " })).toThrow(EmailSendError);
  });

  it("FakeEmailSender records the delete code with its purpose and the deleted notice", async () => {
    const sender = new FakeEmailSender();
    await sender.sendOneTimeCode({ to, code: "482913", expiresInMinutes: 10, purpose: "account_deletion" });
    await sender.sendAccountDeletedNotice({ to: ` ${to} ` });
    expect(sender.sentMessages).toEqual([
      expect.objectContaining({
        kind: "one_time_code",
        to,
        code: "482913",
        purpose: "account_deletion",
        subject: "Your BJJ Roll code to delete your account",
      }),
      { kind: "account_deleted", to, subject: "Your BJJ Roll account was deleted", text: renderAccountDeletedEmail({ to }).text },
    ]);
  });

  it("LettermintEmailSender posts the deleted notice as one plain-text message to the captured address", async () => {
    const bodies: LettermintSendRequestBody[] = [];
    const sender = new LettermintEmailSender({
      apiKey: "lm_test_key_for_unit_test",
      fromAddress: "BJJ Roll <no-reply@bjjroll.test>",
      fetchImplementation: (_input, init) => {
        bodies.push(JSON.parse(typeof init?.body === "string" ? init.body : "{}") as LettermintSendRequestBody);
        return Promise.resolve(new Response("{}", { status: 202 }));
      },
    });
    await sender.sendAccountDeletedNotice({ to });
    expect(bodies).toEqual([{ from: "BJJ Roll <no-reply@bjjroll.test>", to: [to], ...renderAccountDeletedEmail({ to }) }]);
  });
});
