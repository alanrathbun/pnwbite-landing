// pnwbite-landing Worker
//
// Handles two responsibilities:
//   1. Serve static files (index.html, robots.txt, sitemap.xml) for the apex.
//   2. Expose POST /send-email — an authenticated relay used by the salmon
//      report on Railway to send admin notifications via Cloudflare's
//      SendEmail binding (since the binding can only be invoked from inside
//      a Worker).

import { EmailMessage } from "cloudflare:email";

const FROM = "noreply@pnwbite.com";
const TO = "arathbun.pdm@gmail.com";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/send-email") {
      return handleSendEmail(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleSendEmail(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const expected = `Bearer ${env.MAILER_SHARED_SECRET || ""}`;
  if (!env.MAILER_SHARED_SECRET || auth !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return new Response("Bad JSON", { status: 400 });
  }

  const subject = (payload.subject || "").toString().trim();
  const body = (payload.body || "").toString();

  if (!subject || !body) {
    return new Response("Missing subject or body", { status: 400 });
  }

  // Construct a minimal RFC 5322 message.
  const headers = [
    `From: pnwbite mailer <${FROM}>`,
    `To: ${TO}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=utf-8`,
    `MIME-Version: 1.0`,
  ];
  const raw = headers.join("\r\n") + "\r\n\r\n" + body;

  const msg = new EmailMessage(FROM, TO, raw);

  try {
    await env.MAILER.send(msg);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send failed:", e);
    return new Response(
      JSON.stringify({ ok: false, error: String(e) }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
}
