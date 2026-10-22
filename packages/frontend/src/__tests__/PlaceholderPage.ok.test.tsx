import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlaceholderPage } from "../PlaceholderPage";

describe("PlaceholderPage", () => {
  it("renders the heading and the shared style values", () => {
    const markup = renderToStaticMarkup(<PlaceholderPage />);

    expect(markup).toContain("<h1>BJJ Roll</h1>");
    expect(markup).toContain("gi, no-gi");
  });
});
