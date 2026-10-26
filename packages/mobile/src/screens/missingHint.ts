/** Screen-reader hint for the dimmed send and sign-in buttons: names only what is still missing. */
export function missingHint(emailValid: boolean, ageConfirmed: boolean): string | undefined {
  if (!emailValid && !ageConfirmed) {
    return "Enter your email and tick the 17 or older box first.";
  }
  if (!emailValid) {
    return "Enter your email first.";
  }
  return ageConfirmed ? undefined : "Tick the 17 or older box first.";
}
