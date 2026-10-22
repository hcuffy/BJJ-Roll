export function formatGreeting(name: string): string {
  return `Hello, ${name}!`;
}

// HEN-62 demo: deliberate type error to prove a failing step fails the workflow; reverted next.
export const deliberateTypeError: number = "not a number";
