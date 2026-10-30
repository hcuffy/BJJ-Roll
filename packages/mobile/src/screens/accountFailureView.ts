/** What a failed account action shows: the grey offline note alone, or one red message (HEN-305). */
export type AccountFailureView = { readonly offline: true; readonly error: null } | { readonly offline: false; readonly error: string };

/**
 * A network failure shows only the grey "can't reach the server" note, never a red "No connection" (Vera, HEN-305).
 * Any other failure keeps its red message, led by what did not happen (e.g. "Export failed.").
 */
export function accountFailureView(failure: { readonly reason: string; readonly message: string }, leadIn: string): AccountFailureView {
  return failure.reason === "network" ? { offline: true, error: null } : { offline: false, error: `${leadIn} ${failure.message}` };
}
