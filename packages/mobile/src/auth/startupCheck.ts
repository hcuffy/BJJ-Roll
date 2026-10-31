import { appAuthClient, appSecureStore } from "./appAuthClient";
import { type BiometricKind, isBiometricUnlockOn, readBiometricKind } from "./biometricUnlock";
import { finishPendingSignOut, readSignedInUserId } from "./signInActions";
import type { StartupBudget } from "./startupTimeout";

export async function checkStartup(
  budget: StartupBudget,
  startLeftoverRevoke: (deadline: AbortSignal) => void,
): Promise<{ readonly name: "signedIn" } | { readonly name: "email" } | { readonly name: "locked"; readonly kind: BiometricKind }> {
  const signOutPending = await budget.run(async (signal) => {
    const pending = await finishPendingSignOut(appAuthClient, appSecureStore, signal);
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

export async function readBiometricLock(): Promise<{ readonly name: "locked"; readonly kind: BiometricKind } | null> {
  return (await isBiometricUnlockOn(appSecureStore)) ? { name: "locked", kind: await readBiometricKind() } : null;
}
