// Serviço de IA e sincronização do app "Hoje com a Mari" (Cloudflare Worker).
// Variáveis: ANTHROPIC_API_KEY (secreta), APP_CODE (secreta), ALLOWED_ORIGIN (ex.: https://luahproducao.github.io)
// Opcional: KV com o nome SYNC (liga a sincronização entre aparelhos).
const MODELS = ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"];

function corsHeaders(env, req) {
  const origin = req.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGIN || "*").split(",").map((s) => s.trim()).filter(Boolean);
  const any = allowed.includes("*");
  return {
    "access-control-allow-origin": any ? "*" : allowed.includes(origin) ? origin : allowed[0],
    "access-control-allow-headers": "content-type,x-app-code",
    "access-control-allow-methods": "GET,PUT,POST,OPTIONS",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}
const json = (o, status = 200, h = {}) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...h } });
function same(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export default {
  async fetch(req, env) {
    const h = corsHeaders(env, req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    if (!env.APP_CODE || !same(req.headers.get("x-app-code") || "", env.APP_CODE)) return json({ error: "unauthorized" }, 401, h);
    const path = new URL(req.url).pathname;

    if (path === "/ai" && req.method === "POST") {
      if (!env.ANTHROPIC_API_KEY) return json({ error: "no_key" }, 500, h);
      if ((+req.headers.get("content-length") || 0) > 8e6) return json({ error: "too_large" }, 413, h);
      let b;
      try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400, h); }
      if (!MODELS.includes(b.model)) return json({ error: "model_not_allowed" }, 400, h);
      if (!Array.isArray(b.messages)) return json({ error: "bad_request" }, 400, h);
      const body = { model: b.model, max_tokens: Math.min(+b.max_tokens || 4000, 8000), messages: b.messages };
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(body),
      });
      return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json", ...h } });
    }

    if (path === "/sync" && env.SYNC) {
      const cur = JSON.parse((await env.SYNC.get("state")) || "{}");
      cur.meta = cur.meta || {}; cur.data = cur.data || {};
      if (req.method === "GET") return json({ meta: cur.meta, data: cur.data }, 200, h);
      if (req.method === "PUT") {
        if ((+req.headers.get("content-length") || 0) > 6e6) return json({ error: "too_large" }, 413, h);
        let b;
        try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400, h); }
        let n = 0;
        for (const k of Object.keys(b.meta || {})) {
          if (!/^hoje-[a-z0-9-]+$/.test(k) || typeof (b.data || {})[k] !== "string") continue;
          if ((+b.meta[k] || 0) > (cur.meta[k] || 0)) { cur.meta[k] = +b.meta[k]; cur.data[k] = b.data[k]; n++; }
        }
        await env.SYNC.put("state", JSON.stringify(cur));
        return json({ ok: true, updated: n }, 200, h);
      }
    }
    return json({ error: "not_found" }, 404, h);
  },
};
