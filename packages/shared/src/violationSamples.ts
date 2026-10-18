// Throwaway violation samples for HEN-54. Reverted in the next commit.

export function combineFourValues(first: number, second: number, third: number, fourth: number): number {
  return first + second + third + fourth;
}

export const longLineSample = "This string is deliberately long so that the line exceeds the configured maximum line length of one hundred and fifty chars.";

export function returnWithoutBraces(flag: boolean): number {
  if (flag) return 1;
  return 0;
}

export function acceptAnything(input: any): string {
  return String(input);
}

export function startWithoutAwait(): void {
  Promise.resolve(1);
}

export const btn = "button sample";

export const ab = "id-length sample";
