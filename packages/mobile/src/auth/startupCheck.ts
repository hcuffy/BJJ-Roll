import { appAuthClient, appSecureStore } from "./appAuthClient";
import { finishPendingSignOut, readSignedInUserId } from "./signInActions";
import type { StartupBudget } from "./startupTimeout";

/** Runs the startup check in one budget: an unfinished sign-out first, then the session read (HEN-303, HEN-310). */
export async function checkStartup(budget: StartupBudget): Promise<{ readonly name: "signedIn" } | { readonly name: "email" }> {
  const signOutPending = await budget.run((signal) => finishPendingSignOut(appAuthClient, appSecureStore, signal));
  const userId = signOutPending ? null : await budget.run((signal) => readSignedInUserId(appAuthClient, signal));
  return userId ? { name: "signedIn" } : { name: "email" };
}
