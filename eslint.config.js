// Minimal placeholder so `pnpm lint` runs. HEN-35 (M0-06) replaces this with the full CONVENTIONS.v2 config.
import js from "@eslint/js";

export default [
  {
    ignores: ["dist/", "coverage/", ".expo/"],
  },
  js.configs.recommended,
];
