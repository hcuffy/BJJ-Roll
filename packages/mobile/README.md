# @bjj-roll/mobile

Expo app (SDK 57, React Native 0.86.3). Sign-in is passwordless: a 6-digit email code or a magic link that opens the app at `bjjroll://auth`. The session cookie is kept only in SecureStore (`bjjroll_cookie`) and deleted on sign-out.

```sh
pnpm --filter @bjj-roll/mobile test        # Vitest: auth actions, screens and the sign-in flow against a fake backend
pnpm --filter @bjj-roll/mobile typecheck
pnpm --filter @bjj-roll/mobile bundle      # Android export to dist/
pnpm --filter @bjj-roll/mobile start       # Expo dev server
```

## Device check: sign-in against a local backend

Run from the repo root with Node 24 and pnpm 11.21.0. Set every variable in your shell or a local env file that is never committed. This guide names them only.

### 1. Start the backend

1. Start Postgres 18.6 in Docker. `POSTGRES_PASSWORD` comes from your shell:

   ```sh
   docker run --name bjjroll-dev-db -e POSTGRES_PASSWORD -p 5432:5432 -d postgres:18.6
   ```

2. Export the backend variables:

   | Variable                                   | What it is                                                                                                               |
   | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
   | `DATABASE_URL`                             | Connection URL of the local Postgres above (its superuser is fine for a local check)                                     |
   | `AUTH_BASE_URL`                            | The backend URL as the device sees it: `http://10.0.2.2:3000` on the Android emulator, `http://<LAN-IP>:3000` on a phone |
   | `AUTH_DATA_ENCRYPTION_KEY`                 | 32-byte hex key, for example from `openssl rand -hex 32`                                                                 |
   | `AUTH_EMAIL_HMAC_KEY`                      | A different 32-byte hex key (`openssl rand -hex 32` again)                                                               |
   | `LETTERMINT_API_KEY`, `EMAIL_FROM_ADDRESS` | The email sender. `server.js` always sends real email through Lettermint, so use an inbox you can open                   |
   | `PORT` (optional)                          | Defaults to `3000`                                                                                                       |

   Apple and Google sign-in (HEN-239) also read these. The server refuses to start without the Google pair, and Apple is on only when all five Apple variables are set (a partial set fails at startup with the missing name):

   | Variable                                   | What it is                                                                                          |
   | ------------------------------------------ | --------------------------------------------------------------------------------------------------- |
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth web client; its redirect URI is `<AUTH_BASE_URL>/api/auth/callback/google`             |
   | `APPLE_SERVICE_ID`                         | Apple Services ID for the browser flow; its return URL is `<AUTH_BASE_URL>/api/auth/callback/apple` |
   | `APPLE_APP_BUNDLE_IDENTIFIER`              | The iOS bundle id (`com.bjj.roll`), the audience of native Sign in with Apple tokens                |
   | `APPLE_TEAM_ID`, `APPLE_KEY_ID`            | Apple developer team id and the id of the Sign in with Apple key                                    |
   | `APPLE_PRIVATE_KEY`                        | That key's PKCS#8 PEM; `\n` escapes are accepted for one-line values                                |

   The app shows the buttons from `app.json` → `expo.extra.socialSignIn` (`appleEnabled`, `googleEnabled`). iOS shows Google only next to Apple; Android never shows Apple. Apple is off for now (Android first).
   The buttons need the same **I am 16 or older** tick as email sign-in and send the 18+ answer the same way. The server refuses a new account without the 16+ tick and stores both answers in its consent record.
   The server accepts a provider email only when the provider marks it verified; otherwise it refuses with the same answer for every email. Native Apple sign-in sends Apple SHA-256 of a one-time random nonce, and the server refuses a nonce it has seen.

3. Build, run the migrations once, then start the server:

   ```sh
   pnpm install
   pnpm build
   cd packages/backend
   node --input-type=module -e 'import pg from "pg"; import { createDatabase, runDatabaseMigrations } from "./dist/database/index.js";
     const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL }); await runDatabaseMigrations(createDatabase(pool)); await pool.end();'
   pnpm start
   curl http://localhost:3000/health   # {"status":"ok"}
   ```

### 2. Point the app at the backend

`app.json` → `expo.extra.backendUrl` is the URL the app calls; no screen hard-codes it.

- Android emulator: keep `http://10.0.2.2:3000`. That address is the emulator's alias for your computer.
- Physical phone on the same Wi-Fi: change it locally to `http://<LAN-IP>:3000` (your computer's LAN address), set `AUTH_BASE_URL` to the same value, and do not commit that change.

### 3. Open the app

- **Code path (Expo Go works):** run `pnpm --filter @bjj-roll/mobile start`, then press `a`. Expo installs the Expo Go build for SDK 57 on the emulator. On a phone, install Expo Go for SDK 57 and scan the QR code.
- **Magic-link path (needs a development build):** Expo Go does not register the `bjjroll` scheme, so the link cannot open the app there. Build once with `pnpm --filter @bjj-roll/mobile exec expo run:android`, which needs the Android SDK and JDK 17. This generates `packages/mobile/android/`; do not commit it.

### 4. Code path (AC1)

1. Start screen: dark background, "Sign in to BJJ Roll", "New here? We'll create your account." **Continue with email** looks dimmed but still responds.
2. Tap **Continue with email** with nothing filled in. Expect an inline message saying what is missing; no email is sent.
3. Type your email and tap **I am 16 or older**. The box shows ✓ and **Continue with email** turns lime.
4. Tap **Continue with email** (or the keyboard's Go key). It shows "Sending code…" with a spinner, then the "Enter your code" screen with "We emailed a 6-digit code to <your email>." and "Code expires in 10 minutes."
5. The code field is focused with the number pad. Type the 6 digits. Sign-in starts on its own at the 6th digit ("Signing in…").
6. Expect "You are signed in".
7. Optional: type a wrong code. Expect "That code didn't work. Check the email or send a new code." under the field with a red border. After 30 seconds **Resend code** turns on and sends a new code.
8. Optional (HEN-263): **I am 18 or older** sits indented under the 16+ box, unticked, with "Only needed to buy things later. Already have an account? Confirm in Account." under it. It stays dimmed and can't be ticked until 16+ is ticked, and unticking 16+ unticks it. Signed in without it, the Account section shows "Checking…" briefly, then **Confirm I am 18 or older** with "You can't undo this, except by deleting your account." under it; a tap opens "Confirm you are 18 or older?" with the same warning: **Cancel** records nothing, **Yes, I am 18 or older** records it and the row reads "18 or older: confirmed"; with a screen reader on, focus lands on that row and it is read once.

### 5. Magic-link path (AC2, development build)

1. On the start screen, tap **I am 16 or older**, type your email, and tap **Email me a sign-in link instead**.
2. Expect the "Check your email" card: "We sent a sign-in link to <your email>. Open it on this phone." with **Resend link** and **Use a different email**.
3. Open the link on the same device, either from the mail app or with `adb shell am start -a android.intent.action.VIEW -d "<link from the email>"`.
4. The browser hands over to the app (`bjjroll://auth?code=…`). Expect "You are signed in".
5. Open the same link again. Expect a red card above the title: "This sign-in link has expired or was already used. Send a new one." and no sign-in.

### 6. Sign-out and restart (AC5)

1. While signed in, fully close the app and reopen it. Expect "You are signed in" (the session survived in SecureStore).
2. Tap **Sign out**. Expect the "Sign in to BJJ Roll" screen with the box unticked.
3. Fully close the app and reopen it. Expect the "Sign in to BJJ Roll" screen again.

## M2-close device list

Checks the unit tests cannot cover. Run them on one small and one large phone per platform (for example iPhone SE and a recent iPhone; a small Android and a Pixel-size Android). Keep screenshots private (team box only, not GitHub).

**Keyboard**

- [ ] The keyboard never covers **Continue with email**, the code field or **Resend code**, on a small phone in portrait. Content scrolls up while the keyboard is open (iOS: KeyboardAvoidingView `padding`, with a 24 gap above the keyboard; Android: KeyboardAvoidingView `height`, which shrinks the view by the keyboard height on edge-to-edge). On Android, check the content does not shift twice (once from the view, once from the window resizing).
- [ ] A tap on a button while the keyboard is open works the first time (no tap spent just closing the keyboard).
- [ ] Email field: Go submits. Code field: number pad, Done submits, and iOS/Android offer the emailed code for autofill.

**Safe area insets (react-native-safe-area-context)**

- [ ] Nothing sits under the status bar, notch, Dynamic Island or home indicator on any screen, including Loading and the expired-link error card (Android edge-to-edge and iOS).
- [ ] Rotating the phone or switching gesture/3-button navigation on Android keeps content inside the safe area.

**Screen readers (TalkBack and VoiceOver)**

- [ ] A wrong code, an invalid email, the "tick the box" hint, a network error and the expired-link card are each read out once, without moving focus there by hand (Android live region, iOS announcement).
- [ ] The busy buttons ("Sending code…", "Signing in…") are read as busy/disabled.
- [ ] The 16+ checkbox is read with its label and checked state, and the ✓ glyph is not read separately.
- [ ] Field labels are read once, and the field's error is read as its hint.

**Account deletion (HEN-65 AC7)**

- [ ] Signed in, tap **Delete account**: the "Delete your account?" confirm step shows, says signing up again gives a new, empty account, and nothing is deleted yet. **Cancel** goes back with the account intact.
- [ ] Tap **Delete account** again, then **Email me a code**: the code step shows and an email "Your BJJ Roll code to delete your account" arrives. A wrong code shows "That code didn't work…" and the account stays.
- [ ] Enter the emailed code, then tap **Delete my account**: "Deleting account…" shows, then the "Sign in to BJJ Roll" screen with "Your account was deleted. If you sign up again, you get a new, empty account."
- [ ] An email "Your BJJ Roll account was deleted" arrives at the same address.
- [ ] Fully close the app and reopen it: still the "Sign in to BJJ Roll" screen (signed out).

**Vera's "needs device screenshot" items (HEN-78 design review)**

- [ ] Keyboard does not cover Continue or Sign in on a small phone (iPhone SE size, small Android).
- [ ] Email placeholder colour and its contrast on the dark field (platform default colour).
- [ ] Largest dynamic type (iOS AX5, Android 200%): no clipping in inputs, and every screen scrolls instead of overflowing.
- [ ] VoiceOver and TalkBack reading of the checkbox (label, checked state, ✓ not read twice).
- [ ] The ✓ and ✉ glyphs render and centre correctly (font fallback).
- [ ] The deep-link error card sits below the status bar or notch.
- [ ] iOS and Android offer the emailed code for autofill.
- [ ] Pressed feedback (0.98 scale) and Android ripple on the buttons.
- [ ] The system font compared with the style guide's Courtly geometric sans.
