/** Listeners registered through the mocked BackHandler.addEventListener; a test presses Android back with pressAndroidBack. */
const backListeners = new Set<() => boolean | null | undefined>();
export function harnessBackHandlerAddEventListener(_event: string, listener: () => boolean | null | undefined): { remove: () => void } {
  backListeners.add(listener);
  return { remove: () => backListeners.delete(listener) };
}
/** Like the OS: the newest listener goes first; true when one handled it (otherwise Android would close the app). */
export function pressAndroidBack(): boolean {
  return [...backListeners].reverse().some((listener) => listener() === true);
}
export function resetBackListeners(): void {
  backListeners.clear();
}
