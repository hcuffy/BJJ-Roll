const keyboardListeners = new Map<string, Set<() => void>>();
export function harnessKeyboardAddListener(event: string, listener: () => void): { remove: () => void } {
  const listeners = keyboardListeners.get(event) ?? new Set<() => void>();
  keyboardListeners.set(event, listeners);
  listeners.add(listener);
  return { remove: () => listeners.delete(listener) };
}
export function emitKeyboardEvent(event: string): void {
  for (const listener of [...(keyboardListeners.get(event) ?? [])]) {
    listener();
  }
}
export function resetKeyboardListeners(): void {
  keyboardListeners.clear();
}
