import { appAuthClient, appSecureStore } from "./appAuthClient";
import { type BiometricKind, isBiometricUnlockOn, readBiometricKind } from "./biometricUnlock";
import { finishPendingSignOut, readSignedInUserId } from "./signInActions";
import type { StartupBudget } from "./startupTimeout";

/**
 * Runs the startup check in one budget: an unfinished sign-out first, then the session read (HEN-303, HEN-310).
 * With biometric unlock on, a session lands on the lock, so a startup Try again cannot skip it either (HEN-288).
 * Old sessions left queued by a sign-in are ended in the background by `startLeftoverRevoke` within the budget; a sign-out stops it (HEN-315).
 */
export async function checkStartup(
  budget: StartupBudget,
  startLeftoverRevoke: (deadline: AbortSignal) => void,
): Promise<{ readonly name: "signedIn" } | { readonly name: "email" } | { readonly name: "locked"; readonly kind: BiometricKind }> {
  const signOutPending = await budget.run(async (signal) => {
    const pending = await finishPendingSignOut(appAuthClient, appSecureStore, signal);
    // It stops at the startup deadline too, so a late answer cannot drop a marker (HEN-303, HEN-310).
    if (!pending && !signal.aborted) {
      startLeftoverRevoke(signal);
    }
    return pending;
  });
  const userId = signOutPending ? null : await budget.run((signal) => readSignedInUserId(appAuthClient, signal));
  if (!userId) {
    return { name: "email" };
  }
  return (await readBiometricLock()) ?? { name: "signedIn" };
}

/**
 * The lock screen when biometric unlock is on (HEN-288), else null: nothing signed-in shows until the check passes.
 * A local read, so it runs after the timed steps; startup and a sign-in link both use it.
 */
export async function readBiometricLock(): Promise<{ readonly name: "locked"; readonly kind: BiometricKind } | null> {
  return (await isBiometricUnlockOn(appSecureStore)) ? { name: "locked", kind: await readBiometricKind() } : null;
}
