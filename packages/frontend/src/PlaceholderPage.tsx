import type { Style } from "@bjj-roll/shared";

const supportedStyles: Style[] = ["gi", "no-gi"];

export function PlaceholderPage() {
  return (
    <main>
      <h1>BJJ Roll</h1>
      <p>Review UI coming soon. Styles: {supportedStyles.join(", ")}</p>
    </main>
  );
}
