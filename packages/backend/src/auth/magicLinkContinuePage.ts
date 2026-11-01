const magicLinkContinueCopy = {
  pageTitle: "Continue signing in to BJJ Roll",
  heading: "Continue signing in",
  body: "Tap Continue to finish signing in to BJJ Roll on the phone where you asked for this link.",
  button: "Continue",
  appDidNotOpenNote: "BJJ Roll didn't open? Open this email on the phone with BJJ Roll, or send a new link from the app.",
  ignoreNote: "Didn't ask to sign in? Close this page. Nothing happens unless you tap Continue.",
} as const;

const continuePageHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="robots" content="noindex">
<title>${magicLinkContinueCopy.pageTitle}</title>
<style>
body {
  font-family: system-ui, sans-serif; margin: 0; padding: 48px 24px; max-width: 480px; margin-inline: auto;
  background: #111313; color: #FFFFFF;
}
h1 { font-size: 1.5rem; }
button {
  font: inherit; font-weight: 600; width: 100%; min-height: 48px; padding: 16px; border: 0; border-radius: 999px;
  background: #E0F154; color: #111313;
}
button:focus-visible { outline: 3px solid #FFFFFF; outline-offset: 3px; }
p.note { color: #A0A3A0; font-size: 0.9rem; }
</style>
</head>
<body>
<main>
<h1>${magicLinkContinueCopy.heading}</h1>
<p>${magicLinkContinueCopy.body}</p>
<form method="post">
<button type="submit">${magicLinkContinueCopy.button}</button>
</form>
<p class="note">${magicLinkContinueCopy.appDidNotOpenNote}</p>
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
