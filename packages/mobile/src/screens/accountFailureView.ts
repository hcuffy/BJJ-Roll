export type AccountFailureView = { readonly offline: true; readonly error: null } | { readonly offline: false; readonly error: string };

export function accountFailureView(failure: { readonly reason: string; readonly message: string }, leadIn: string): AccountFailureView {
  return failure.reason === "network" ? { offline: true, error: null } : { offline: false, error: `${leadIn} ${failure.message}` };
}
