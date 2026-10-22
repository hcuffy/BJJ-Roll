import type { Style } from "@bjj-roll/shared";

const supportedStyles: Style[] = ["gi", "no-gi"];

// Placeholder only: the web review UI lands in a later issue (ARCHITECTURE.md §1).
export function PlaceholderPage() {
  return (
    <main>
      <h1>BJJ Roll</h1>
      <p>Review UI coming soon. Styles: {supportedStyles.join(", ")}</p>
    </main>
  );
}
