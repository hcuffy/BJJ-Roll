const backListeners = new Set<() => boolean | null | undefined>();
export const harnessBackHandler = {
  addEventListener(_event: "hardwareBackPress", listener: () => boolean | null | undefined): { remove: () => void } {
    backListeners.add(listener);
    return { remove: () => backListeners.delete(listener) };
  },
};
export function pressHardwareBack(): boolean {
  return [...backListeners].reverse().some((listener) => listener() === true);
}
export function resetBackListeners(): void {
  backListeners.clear();
}
