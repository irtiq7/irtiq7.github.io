// Guestbook intake: verifies a Cloudflare Turnstile token, applies anti-spam checks,
// then files the message as a GitHub issue labelled "pending". Nothing is shown on the
// site until the owner adds the "approved" label.
//
// Secrets (wrangler secret put): GITHUB_TOKEN, TURNSTILE_SECRET
// KV binding: RATE   Vars: REPO, ALLOWED_ORIGIN
const BLOCKED = /\b(casino|viagra|crypto|seo|backlink|loan|betting|escort|porn|forex|telegram)\b/i;
const DAILY_LIMIT = 3;       // messages per IP per day
const MIN_FILL_MS = 4000;    // humans need a few seconds to write

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
    const reply = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return reply(405, { error: "POST only" });
    if (origin !== env.ALLOWED_ORIGIN) return reply(403, { error: "Origin not allowed" });

    let d;
    try { d = await req.json(); } catch { return reply(400, { error: "Bad request" }); }

    // Cheap checks first
    if (d.website) return reply(200, { ok: true });                       // honeypot: pretend success
    const type = d.type === "Ask" ? "Question: " : "";
    const title = String(d.title || "").trim().slice(0, 100);
    const message = String(d.message || "").trim().slice(0, 2000);
    const name = String(d.name || "").trim().slice(0, 60) || "Anonymous";
    if (title.length < 3 || message.length < 10) return reply(400, { error: "Please write a title and a longer message." });
    if (Date.now() - Number(d.t || 0) < MIN_FILL_MS) return reply(400, { error: "That was quick. Please try again." });
    if ((message.match(/https?:\/\//gi) || []).length > 1) return reply(400, { error: "At most one link, please." });
    if (BLOCKED.test(`${title} ${message} ${name}`)) return reply(400, { error: "This looks like spam." });

    // Per-IP daily rate limit
    const ip = req.headers.get("CF-Connecting-IP") || "unknown";
    const key = `rl:${new Date().toISOString().slice(0, 10)}:${ip}`;
    const used = Number(await env.RATE.get(key)) || 0;
    if (used >= DAILY_LIMIT) return reply(429, { error: "Daily limit reached. Please come back tomorrow." });

    // Turnstile (bot challenge)
    const form = new FormData();
    form.append("secret", env.TURNSTILE_SECRET);
    form.append("response", String(d.token || ""));
    form.append("remoteip", ip);
    const v = await (await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form })).json();
    if (!v.success) return reply(400, { error: "Bot check failed. Please reload and try again." });

    await env.RATE.put(key, String(used + 1), { expirationTtl: 90000 });

    // Neutralise @mentions, #refs and HTML so a visitor cannot ping people or inject markup
    const safe = (t) => t.replace(/[<>]/g, "").replace(/@/g, "@​").replace(/#(\d)/g, "#​$1");
    const body = `${safe(message)}\n\n---\nName (unverified): ${safe(name)}\nPosted-by: human via web form`;

    const r = await fetch(`https://api.github.com/repos/${env.REPO}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "guestbook-worker",
      },
      body: JSON.stringify({ title: `[Guestbook] ${type}${safe(title)}`, body, labels: ["pending"] }),
    });
    if (!r.ok) return reply(502, { error: "Could not save the message. Please try again later." });
    return reply(200, { ok: true });
  },
};
