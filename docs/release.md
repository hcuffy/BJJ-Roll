# Release checks

Checks that keep the mobile app (`packages/mobile`) ready for App Store and Google Play review. Release builds and store
submission come later (HEN-269, HEN-270, HEN-274); this page lists the checks that already run.

## Payment link guard (HEN-278)

The app must not link to an outside payment, tip or donation page (Apple App Review Guideline 3.1.1, Google Play Payments
policy). Paid features use in-app purchase only.

- Runs in CI on every PR and on `main` (step "Payment link guard (mobile)" in `.github/workflows/ci.yml`). The release checks (HEN-274) run it too.
- Run it locally: `pnpm --filter @bjj-roll/mobile run payment-guard`. Tests: `pnpm --filter @bjj-roll/mobile exec vitest run src/__tests__/paymentLinkGuard.denyList.test.ts`.
- What it scans: every file in `packages/mobile` (source, `app.json`, `package.json`, `assets/`), except `node_modules`, `dist`, `.expo`, generated `ios`/`android` folders and `__tests__`.
- Deny-list: [`packages/mobile/release/paymentLinkDenyList.txt`](../packages/mobile/release/paymentLinkDenyList.txt). One JavaScript regular
  expression per line, matched case-insensitively. It covers Buy Me a Coffee (`buymeacoffee.com`, `buymeacoff.ee`), Ko-fi, PayPal.Me and
  PayPal donate, Patreon, Stripe Checkout and payment links, Liberapay, Open Collective, GitHub Sponsors, GoFundMe, Venmo, Cash App,
  and any URL with a `donate`/`tip` subdomain or path segment.
- Allow-list: [`packages/mobile/release/paymentLinkAllowList.txt`](../packages/mobile/release/paymentLinkAllowList.txt). Only for false
  positives, one per line: `<path relative to packages/mobile> | <exact matched text> | <reason>`. An entry without a reason fails the
  guard. A real payment, tip or donation link is never allow-listed.
- A hit prints the file, line, pattern and matched text, and the step fails.
