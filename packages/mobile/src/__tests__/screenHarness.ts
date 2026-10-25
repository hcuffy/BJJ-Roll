import type { ReactElement, ReactNode } from "react";
import { vi } from "vitest";
import { attachHostReference } from "./hostReference";

/**
 * Minimal screen renderer for Vitest in Node (no DOM, no extra test dependencies).
 * Function components are called directly; useState/useEffect come from harnessUseState/harnessUseEffect (see nativeModuleMocks.ts);
 * react-native host components are mocked as strings. Queries and events follow Testing Library naming.
 */

export interface HostNode {
  readonly type: string;
  readonly props: Record<string, unknown>;
  readonly children: readonly (HostNode | string)[];
}

type Component = (props: Record<string, unknown>) => ReactNode;

interface HookSlots {
  values: unknown[];
  cleanups: Map<number, () => void>;
}

interface PendingEffect {
  readonly slots: HookSlots;
  readonly index: number;
  readonly effect: () => unknown;
  readonly deps: readonly unknown[] | undefined;
}

/** Deep link the mocked expo-linking useURL() returns. */
export const deepLinkState: { url: string | null } = { url: null };
/** What the mocked useSafeAreaInsets returns; a test can set a bottom nav-bar inset and reset it. */
export const safeAreaInsetsState = { top: 0, bottom: 0, left: 0, right: 0 };

// Checked by shape, not via react's isValidElement: this module must not import react at runtime (react is mocked to use it).
function isReactElement(node: ReactNode): node is ReactElement {
  return typeof node === "object" && node !== null && "type" in node && "props" in node;
}

interface RenderContext {
  readonly pendingEffects: PendingEffect[];
  readonly rerender: () => void;
}

let activeRenderer: RenderContext | null = null;
let currentSlots: HookSlots | null = null;
let hookIndex = 0;

function nextHook(): { slots: HookSlots; index: number } {
  if (!currentSlots) {
    throw new Error("Hook called outside a component rendered by renderScreen");
  }
  const index = hookIndex;
  hookIndex += 1;
  return { slots: currentSlots, index };
}

function sameDeps(previous: readonly unknown[] | undefined, next: readonly unknown[] | undefined): boolean {
  return (
    previous !== undefined && next !== undefined && previous.length === next.length && previous.every((value, index) => Object.is(value, next[index]))
  );
}

export function harnessUseState<Value>(initial: Value | (() => Value)): [Value, (update: Value | ((previous: Value) => Value)) => void] {
  const { slots, index } = nextHook();
  if (!(index in slots.values)) {
    slots.values[index] = typeof initial === "function" ? (initial as () => Value)() : initial;
  }
  const renderer = activeRenderer;
  const setValue = (update: Value | ((previous: Value) => Value)) => {
    const previous = slots.values[index] as Value;
    slots.values[index] = typeof update === "function" ? (update as (previous: Value) => Value)(previous) : update;
    renderer?.rerender();
  };
  return [slots.values[index] as Value, setValue];
}

export function harnessUseReference<Value>(initial: Value): { current: Value } {
  const { slots, index } = nextHook();
  if (!(index in slots.values)) {
    slots.values[index] = { current: initial };
  }
  return slots.values[index] as { current: Value };
}

export function harnessUseEffect(effect: () => unknown, deps?: readonly unknown[]): void {
  const { slots, index } = nextHook();
  const previousDeps = slots.values[index] as readonly unknown[] | undefined;
  if (!sameDeps(previousDeps, deps)) {
    activeRenderer?.pendingEffects.push({ slots, index, effect, deps });
  }
}

function runCleanup(slots: HookSlots, index: number): void {
  const cleanup = slots.cleanups.get(index);
  slots.cleanups.delete(index);
  cleanup?.();
}

function runAllCleanups(slots: HookSlots): void {
  for (const index of [...slots.cleanups.keys()]) {
    runCleanup(slots, index);
  }
}

class ScreenRenderer {
  readonly pendingEffects: PendingEffect[] = [];
  private readonly slotsByPath = new Map<string, HookSlots>();
  private visitedPaths = new Set<string>();
  private rendering = false;
  private rerenderRequested = false;
  root: (HostNode | string)[] = [];

  constructor(private readonly element: ReactNode) {}

  rerender(): void {
    if (this.rendering) {
      this.rerenderRequested = true;
      return;
    }
    do {
      this.rerenderRequested = false;
      this.renderOnce();
    } while (this.rerenderRequested);
  }

  private renderOnce(): void {
    this.rendering = true;
    const previousRenderer = activeRenderer;
    activeRenderer = { pendingEffects: this.pendingEffects, rerender: () => this.rerender() };
    this.visitedPaths = new Set();
    try {
      this.root = this.resolve(this.element, "root");
    } finally {
      activeRenderer = previousRenderer;
      this.rendering = false;
    }
    for (const [path, slots] of this.slotsByPath) {
      if (!this.visitedPaths.has(path)) {
        this.slotsByPath.delete(path);
        runAllCleanups(slots);
      }
    }
    const effects = this.pendingEffects.splice(0);
    for (const { slots, index, effect, deps } of effects) {
      slots.values[index] = deps;
      runCleanup(slots, index);
      const cleanup = effect();
      if (typeof cleanup === "function") {
        slots.cleanups.set(index, cleanup as () => void);
      }
    }
  }

  private resolve(node: ReactNode, path: string): (HostNode | string)[] {
    if (node === null || node === undefined || typeof node === "boolean") {
      return [];
    }
    if (typeof node === "string" || typeof node === "number") {
      return [String(node)];
    }
    if (Array.isArray(node)) {
      return node.flatMap((child: ReactNode, index) => this.resolve(child, `${path}.${index}`));
    }
    if (!isReactElement(node)) {
      return [];
    }
    const props = node.props as Record<string, unknown>;
    if (typeof node.type === "function") {
      const component = node.type as Component;
      const componentPath = `${path}:${component.name}`;
      this.visitedPaths.add(componentPath);
      const slots = this.slotsByPath.get(componentPath) ?? { values: [], cleanups: new Map() };
      this.slotsByPath.set(componentPath, slots);
      const [outerSlots, outerIndex] = [currentSlots, hookIndex];
      currentSlots = slots;
      hookIndex = 0;
      let output: ReactNode;
      try {
        output = component(props);
      } finally {
        [currentSlots, hookIndex] = [outerSlots, outerIndex];
      }
      return this.resolve(output, componentPath);
    }
    const children = this.resolve(props.children as ReactNode, `${path}>`);
    if (typeof node.type !== "string") {
      return children;
    }
    return [attachHostReference({ type: node.type, props, children })];
  }
}

export function textOf(node: HostNode | string): string {
  return typeof node === "string" ? node : node.children.map(textOf).join("");
}

function allNodes(nodes: readonly (HostNode | string)[]): HostNode[] {
  return nodes.flatMap((node) => (typeof node === "string" ? [] : [node, ...allNodes(node.children)]));
}

/** Lets pending promises (fake fetch, SecureStore, state updates) settle. Works with real and with Vitest fake timers. */
export async function settle(): Promise<void> {
  for (let round = 0; round < 20; round += 1) {
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(0);
    } else {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}

type StyleValue = Record<string, unknown> | readonly StyleValue[] | false | null | undefined | ((state: { pressed: boolean }) => StyleValue);

/** Flattens a React Native style prop like StyleSheet.flatten; a Pressable style function gets { pressed }. */
export function flattenStyle(style: unknown, pressed = false): Record<string, unknown> {
  const value = style as StyleValue;
  if (typeof value === "function") {
    return flattenStyle(value({ pressed }), pressed);
  }
  if (Array.isArray(value)) {
    return Object.assign({}, ...value.map((item) => flattenStyle(item, pressed))) as Record<string, unknown>;
  }
  return value ? { ...(value as Record<string, unknown>) } : {};
}

export async function renderScreen(element: ReactNode) {
  const renderer = new ScreenRenderer(element);
  renderer.rerender();
  await settle();

  const nodes = () => allNodes(renderer.root);
  const pressableWithText = (text: string): HostNode => {
    const matches = nodes().filter((node) => typeof node.props.onPress === "function" && textOf(node).includes(text));
    const deepest = matches.at(-1);
    if (!deepest) {
      throw new Error(`No pressable with text "${text}" in: ${screen.text()}`);
    }
    return deepest;
  };

  const screen = {
    text: () => renderer.root.map(textOf).join(" "),
    queryByText: (text: string) => nodes().find((node) => node.type === "Text" && textOf(node).includes(text)) ?? null,
    getByLabelText: (label: string): HostNode => {
      const match = nodes().find((node) => node.props.accessibilityLabel === label);
      if (!match) {
        throw new Error(`No element labelled "${label}"`);
      }
      return match;
    },
    getByRole: (role: string): HostNode => {
      const match = nodes().find((node) => node.props.accessibilityRole === role);
      if (!match) {
        throw new Error(`No element with role "${role}"`);
      }
      return match;
    },
    findAllByType: (type: string) => nodes().filter((node) => node.type === type),
    pressables: () => nodes().filter((node) => typeof node.props.onPress === "function"),
    getPressable: (text: string) => pressableWithText(text),
    isDisabled: (text: string) => pressableWithText(text).props.disabled === true,
    /** Presses like a user: a disabled Pressable ignores the press. */
    press: async (text: string) => {
      const target = pressableWithText(text);
      if (target.props.disabled !== true) {
        (target.props.onPress as () => void)();
      }
      await settle();
    },
    pressRole: async (role: string) => {
      (screen.getByRole(role).props.onPress as () => void)();
      await settle();
    },
    changeText: async (label: string, value: string) => {
      (screen.getByLabelText(label).props.onChangeText as (text: string) => void)(value);
      await settle();
    },
    /** Calls a prop handler on the element with this accessibility label (onBlur, onFocus, onSubmitEditing). */
    fire: async (label: string, handler: string) => {
      (screen.getByLabelText(label).props[handler] as () => void)();
      await settle();
    },
    rerender: async () => {
      renderer.rerender();
      await settle();
    },
  };
  return screen;
}
