const directivePatterns = [
  /^\/\s*<reference\s+(types|path|lib)="[^"]+"\s*\/>\s*$/u,
  /^\s*eslint-disable-next-line\s+\S.*?\s--\s+\S/u,
  /^\s*@ts-expect-error\s+\S/u,
];
const licencePattern = /SPDX-License-Identifier|Copyright|Licensed under/u;

function isLicenceHeader(comment, sourceCode) {
  const before = sourceCode.text.slice(0, comment.range[0]).replace(/^#!.*/u, "");
  return comment.type === "Block" && before.trim() === "" && licencePattern.test(comment.value);
}

function isAllowedComment(comment, sourceCode) {
  if (comment.type === "Shebang" || isLicenceHeader(comment, sourceCode)) {
    return true;
  }
  return comment.type === "Line" && directivePatterns.some((pattern) => pattern.test(comment.value));
}

export default {
  meta: {
    type: "suggestion",
    docs: { description: "Allow only directives with a reason, a licence header and a shebang as comments." },
    messages: {
      proseComment:
        "No prose comments. Allowed: `/// <reference types=... />`, `// eslint-disable-next-line <rule> -- <reason>`, `// @ts-expect-error <reason>`, a licence header, a shebang.",
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode;
    return {
      Program() {
        for (const comment of sourceCode.getAllComments()) {
          if (!isAllowedComment(comment, sourceCode)) {
            context.report({ loc: comment.loc, messageId: "proseComment" });
          }
        }
      },
    };
  },
};
