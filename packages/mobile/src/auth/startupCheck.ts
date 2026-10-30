import { appAuthClient, appSecureStore } from "./appAuthClient";
import { finishPendingSignOut, readSignedInUserId } from "./signInActions";
import type { StartupBudget } from "./startupTimeout";

/**
 * Runs the startup check in one budget: an unfinished sign-out first, then the session read (HEN-303, HEN-310).
 * Old sessions left queued by a sign-in are ended in the background by `startLeftoverRevoke` within the budget; a sign-out stops it (HEN-315).
 */
export async function checkStartup(
  budget: StartupBudget,
  startLeftoverRevoke: (deadline: AbortSignal) => void,
): Promise<{ readonly name: "signedIn" } | { readonly name: "email" }> {
  const signOutPending = await budget.run(async (signal) => {
    const pending = await finishPendingSignOut(appAuthClient, appSecureStore, signal);
    // It stops at the startup deadline too, so a late answer cannot drop a marker (HEN-303, HEN-310).
    if (!pending && !signal.aborted) {
      startLeftoverRevoke(signal);
    }
    return pending;
  });
  const userId = signOutPending ? null : await budget.run((signal) => readSignedInUserId(appAuthClient, signal));
  return userId ? { name: "signedIn" } : { name: "email" };
}
