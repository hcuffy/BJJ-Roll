/** Listeners registered through the mocked AppState.addEventListener; a test moves the app with emitAppState. */
const appStateListeners = new Set<(state: string) => void>();
export function harnessAppStateAddEventListener(_event: string, listener: (state: string) => void): { remove: () => void } {
  appStateListeners.add(listener);
  return { remove: () => appStateListeners.delete(listener) };
}
export function emitAppState(state: "active" | "background"): void {
  for (const listener of [...appStateListeners]) {
    listener(state);
  }
}
