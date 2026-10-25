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

1. Start screen: "Sign in to BJJ Roll". **Continue** and **Email me a sign-in link instead** are both greyed out.
2. Type your email. The buttons stay greyed out.
3. Tap **I am 17 or older**. The box shows ✓ and both buttons turn on.
4. Tap **Continue**. Expect the "Enter your code" screen with "We emailed a 6-digit code to <your email>."
5. Open the email and type the 6 digits. **Sign in** turns on only at 6 digits. Tap it.
6. Expect "You are signed in".

### 5. Magic-link path (AC2, development build)

1. On the start screen, tap **I am 17 or older**, type your email, and tap **Email me a sign-in link instead**.
2. Expect "Check your email and open the link on this phone."
3. Open the link on the same device, either from the mail app or with `adb shell am start -a android.intent.action.VIEW -d "<link from the email>"`.
4. The browser hands over to the app (`bjjroll://auth?code=…`). Expect "You are signed in".
5. Open the same link again. Expect "This sign-in link is invalid or has expired. Request a new one." and no sign-in.

### 6. Sign-out and restart (AC5)

1. While signed in, fully close the app and reopen it. Expect "You are signed in" (the session survived in SecureStore).
2. Tap **Sign out**. Expect the "Sign in to BJJ Roll" screen with the box unticked.
3. Fully close the app and reopen it. Expect the "Sign in to BJJ Roll" screen again.
