const magicLinkContinueCopy = {
  pageTitle: "Continue signing in to BJJ Roll",
  heading: "Continue signing in",
  body: "Tap Continue to finish signing in to BJJ Roll on this phone.",
  button: "Continue",
  ignoreNote: "Didn't ask to sign in? Close this page. Nothing happens until you tap Continue.",
} as const;

const continuePageHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${magicLinkContinueCopy.pageTitle}</title>
<style>
body { font-family: system-ui, sans-serif; margin: 0; padding: 48px 24px; max-width: 480px; margin-inline: auto; color: #111; }
h1 { font-size: 1.5rem; }
button { font: inherit; font-weight: 600; width: 100%; padding: 16px; border: 0; border-radius: 12px; background: #111; color: #fff; }
p.note { color: #555; font-size: 0.9rem; }
</style>
</head>
<body>
<main>
<h1>${magicLinkContinueCopy.heading}</h1>
<p>${magicLinkContinueCopy.body}</p>
<form method="post">
<button type="submit">${magicLinkContinueCopy.button}</button>
</form>
<p class="note">${magicLinkContinueCopy.ignoreNote}</p>
</main>
</body>
</html>
`;

export function magicLinkContinuePage(): Response {
  return new Response(continuePageHtml, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
    },
  });
}
