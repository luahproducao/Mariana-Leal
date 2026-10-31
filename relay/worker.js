/* Hoje · relé do Notion (sem banco, sem login, não guarda nada).
   1) /oauth/start e /oauth/cb: o "Conectar com Notion" (integração pública).
   2) /v1/*: repassa as chamadas do app ao Notion (o Notion bloqueia navegador direto).
   Variáveis: NOTION_CLIENT_ID, NOTION_CLIENT_SECRET (secret), RETURN_URLS (endereços do app, separados por vírgula). */
const NV = "2022-06-28";
const ID = "[0-9a-fA-F-]{32,36}";
const ALLOW = [
  ["POST", /^search$/], ["GET", /^users\/me$/],
  ["GET", new RegExp("^databases/" + ID + "$")], ["POST", new RegExp("^databases/" + ID + "/query$")],
  ["POST", /^pages$/], ["PATCH", new RegExp("^pages/" + ID + "$")], ["GET", new RegExp("^pages/" + ID + "$")],
];
const cors = (req) => ({
  "access-control-allow-origin": req.headers.get("origin") || "*",
  "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
  "access-control-allow-headers": "content-type,x-nt",
  "access-control-max-age": "86400", vary: "origin",
});
const J = (o, s, h) => new Response(JSON.stringify(o), { status: s || 200, headers: { "content-type": "application/json", ...(h || {}) } });
const okReturn = (env, u) => { try { new URL(u); } catch { return false; } return String(env.RETURN_URLS || "").split(",").map((x) => x.trim()).filter(Boolean).some((p) => u === p || u.startsWith(p.replace(/\/?$/, "/")) || u.startsWith(p + "?")); };
const b64u = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

export default {
  async fetch(req, env) {
    const url = new URL(req.url), p = url.pathname, h = cors(req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    try {
      if (p === "/oauth/start") {
        const ret = url.searchParams.get("ret") || "";
        if (!env.NOTION_CLIENT_ID || !okReturn(env, ret)) return J({ error: "bad_return" }, 400, h);
        const cb = url.origin + "/oauth/cb";
        const a = new URL("https://api.notion.com/v1/oauth/authorize");
        a.search = new URLSearchParams({ client_id: env.NOTION_CLIENT_ID, response_type: "code", owner: "user", redirect_uri: cb, state: b64u(ret) }).toString();
        return Response.redirect(a.toString(), 302);
      }
      if (p === "/oauth/cb") {
        let ret = ""; try { ret = unb64u(url.searchParams.get("state") || ""); } catch {}
        if (!okReturn(env, ret)) return new Response("Endereço de retorno inválido.", { status: 400 });
        const code = url.searchParams.get("code");
        const back = (frag) => Response.redirect(ret.split("#")[0] + "#" + frag, 302);
        if (!code) return back("nterr=negado");
        const r = await fetch("https://api.notion.com/v1/oauth/token", {
          method: "POST",
          headers: { authorization: "Basic " + btoa(env.NOTION_CLIENT_ID + ":" + env.NOTION_CLIENT_SECRET), "content-type": "application/json", "notion-version": NV },
          body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: url.origin + "/oauth/cb" }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.access_token) return back("nterr=falhou");
        return back("nt=" + encodeURIComponent(j.access_token) + "&ntw=" + encodeURIComponent(j.workspace_name || ""));
      }
      if (p.startsWith("/v1/")) {
        const rest = p.slice(4), tok = req.headers.get("x-nt") || "";
        if (!tok) return J({ error: "no_token" }, 401, h);
        if (!ALLOW.some(([m, re]) => m === req.method && re.test(rest))) return J({ error: "not_allowed" }, 403, h);
        if ((+req.headers.get("content-length") || 0) > 1e6) return J({ error: "too_large" }, 413, h);
        const r = await fetch("https://api.notion.com/v1/" + rest, {
          method: req.method,
          headers: { authorization: "Bearer " + tok, "notion-version": NV, "content-type": "application/json" },
          body: req.method === "GET" ? undefined : await req.text(),
        });
        return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json", ...h } });
      }
      if (p === "/" || p === "/health") return J({ ok: true, app: "hoje-notion-relay" }, 200, h);
      return J({ error: "not_found" }, 404, h);
    } catch (e) { return J({ error: "server" }, 500, h); }
  },
};
