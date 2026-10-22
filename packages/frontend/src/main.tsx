import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PlaceholderPage } from "./PlaceholderPage";

const rootElement = document.querySelector("#root");

if (!rootElement) {
  throw new Error("Missing #root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <PlaceholderPage />
  </StrictMode>,
);
