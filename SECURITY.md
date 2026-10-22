# Security policy

## Reporting a vulnerability

Please report security problems privately through GitHub private vulnerability reporting:

**https://github.com/hcuffy/BJJ-Roll/security/advisories/new** (repo **Security** tab > **Report a vulnerability**)

Do not open a public issue, pull request or discussion for a security problem. Include what you found, where (app screen, API route, URL), the steps to
reproduce it and the impact you expect. Please do not access, change or delete other people's data while testing; use your own accounts and videos only.

## What to expect

| Step                               | Target                                 |
| ---------------------------------- | -------------------------------------- |
| Acknowledge your report            | Within 5 working days                  |
| Share a fix plan (or our decision) | Within 30 days of the acknowledgement  |
| Fix and disclosure                 | Agreed with you once the fix is merged |

We credit reporters in the advisory if you want to be named. There is **no bug bounty**: we cannot pay for reports.

## Scope

In scope:

- The BJJ Roll mobile app (iOS and Android) and the web review UI built from this repo
- The BJJ Roll API (`packages/backend`) and the worker code in this repo (`packages/workers`)
- The BJJ Roll domain and its subdomains, once they are live

Out of scope (report these to the vendor instead):

- Modal, Hetzner, the Apple App Store and Google Play, and any other third-party service we run on
- Denial-of-service and volume testing, social engineering, and physical attacks
- Findings that need a rooted or jailbroken device or a compromised developer machine, unless they expose other users' data

## Supported versions

Only the latest release and the `main` branch get security fixes.

## How we check ourselves

Our own OWASP MASVS/ASVS self-check is in [`docs/security/checklist.md`](docs/security/checklist.md).
