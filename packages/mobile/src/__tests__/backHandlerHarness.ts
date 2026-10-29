/** Listeners registered through the mocked BackHandler; a test presses Android's hardware back with pressHardwareBack. */
const backListeners = new Set<() => boolean | null | undefined>();
export const harnessBackHandler = {
  addEventListener(_event: "hardwareBackPress", listener: () => boolean | null | undefined): { remove: () => void } {
    backListeners.add(listener);
    return { remove: () => backListeners.delete(listener) };
  },
};
/** Like React Native: the newest listener runs first and the first one that returns true handles the press. */
export function pressHardwareBack(): boolean {
  return [...backListeners].reverse().some((listener) => listener() === true);
}
/** Screens are never unmounted between tests, so each test starts with no listeners. */
export function resetBackListeners(): void {
  backListeners.clear();
}
