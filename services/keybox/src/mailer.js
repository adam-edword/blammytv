/**
 * License-key delivery email via Resend's HTTP API — plain fetch, no SDK
 * dependency. Deliberately best-effort: the /success page (see server.js)
 * is the actual delivery guarantee, this is a backup so a closed tab or a
 * missed redirect doesn't cost a buyer their key. Never throws from the
 * no-op path; the throw path (misconfigured/failed send) is left to the
 * caller to catch, since createMailer has no opinion on how a failure
 * should be logged or whether the key row gets marked emailed.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function createMailer({ apiKey, from, replyTo }) {
  if (!apiKey || !from) {
    let warned = false;
    return {
      async sendKeyEmail() {
        // Logged once, not once-per-call: a box with no RESEND_API_KEY set
        // will see this on every purchase otherwise, drowning real logs.
        if (!warned) {
          warned = true;
          console.log("keybox: email not configured, skipping key email");
        }
        return { sent: false, reason: "not_configured" };
      },
    };
  }

  return {
    async sendKeyEmail({ to, key, kind, themeNames }) {
      const { subject, html, text } = renderKeyEmail({ key, kind, themeNames, replyTo });
      const res = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from,
          to,
          reply_to: replyTo || undefined,
          subject,
          html,
          text,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`keybox: Resend send failed with status ${res.status}: ${body}`);
      }

      return { sent: true };
    },
  };
}

function entitlementLine(kind, themeNames) {
  if (kind === "pass") {
    return "Your key unlocks every BlammyTV theme, including future ones.";
  }
  const names = themeNames.length > 0 ? themeNames.join(", ") : "your purchased theme";
  return `Your key unlocks: ${names}.`;
}

function renderKeyEmail({ key, kind, themeNames, replyTo }) {
  const subject = "Your BlammyTV Themes key";
  const entitlement = entitlementLine(kind, themeNames ?? []);
  const supportLine = replyTo
    ? `<p style="margin:0 0 20px;color:#a2a2a2;font-size:14px;line-height:1.5;">Questions? Just reply to this email.</p>`
    : "";
  const supportLineText = replyTo ? "\nQuestions? Just reply to this email.\n" : "";

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#0a0a0c;color:#f2f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#141416;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:32px;">
    <h1 style="font-size:20px;margin:0 0 8px;">Thanks for your purchase</h1>
    <p style="margin:0 0 20px;color:#a2a2a2;font-size:14px;line-height:1.5;">${entitlement}</p>
    <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:20px;letter-spacing:0.05em;background:#0f0f0f;border:1px solid rgba(255,255,255,0.14);border-radius:10px;padding:16px;margin-bottom:20px;word-break:break-all;">${escapeHtml(key)}</div>
    <p style="margin:0 0 8px;color:#a2a2a2;font-size:14px;line-height:1.5;">Open BlammyTV &rarr; Settings &rarr; Customize &rarr; Theme &rarr; Premium Themes, paste your key, and click Activate.</p>
    <p style="margin:0 0 20px;color:#a2a2a2;font-size:14px;line-height:1.5;">Your key activates on up to 3 devices.</p>
    ${supportLine}
  </div>
</body>
</html>`;

  const text = `Thanks for your purchase.
${entitlement}

Your key:
${key}

Open BlammyTV -> Settings -> Customize -> Theme -> Premium Themes, paste your key, and click Activate.
Your key activates on up to 3 devices.
${supportLineText}`;

  return { subject, html, text };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
