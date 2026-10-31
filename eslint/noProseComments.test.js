import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import noProseComments from "./noProseComments.js";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({ languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } } });
const error = { messageId: "proseComment" };

ruleTester.run("no-prose-comments", noProseComments, {
  valid: [
    "const total = 1;",
    "// eslint-disable-next-line no-console -- the CLI prints its report\nconsole.log(1);",
    "// @ts-expect-error the fixture passes a wrong type on purpose\nconst value: number = 'a';",
    "/* SPDX-License-Identifier: Apache-2.0 */\nconst total = 1;",
    "#!/usr/bin/env node\nconst total = 1;",
    '/// <reference types="node" />\nconst total = 1;',
  ],
  invalid: [
    { code: "// explains the next line\nconst total = 1;", errors: [error] },
    { code: "const total = 1; // trailing note", errors: [error] },
    { code: "/** Docs for the constant. */\nconst total = 1;", errors: [error] },
    { code: "/* block note */\nconst total = 1;", errors: [error] },
    { code: "const view = <div>{/* jsx note */}</div>;", errors: [error] },
    { code: "// eslint-disable-next-line no-console\nconsole.log(1);", errors: [error] },
    { code: "// @ts-expect-error\nconst value: number = 'a';", errors: [error] },
    { code: "// @ts-ignore because\nconst value: number = 'a';", errors: [error] },
    { code: "/* eslint-disable no-console */\nconsole.log(1);", errors: [error] },
    { code: "/// a triple-slash note\nconst total = 1;", errors: [error] },
    { code: "const total = 1;\n/* SPDX-License-Identifier: Apache-2.0 */", errors: [error] },
  ],
});
