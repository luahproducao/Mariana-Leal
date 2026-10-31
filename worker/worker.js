// Serviço do app "Hoje com a Mari" (Cloudflare Worker): contas, login, sincronização e Notion.
// Variáveis: ADMIN_CODE (secreta), ALLOWED_ORIGIN (ex.: https://luahproducao.github.io)
// KV: SYNC (obrigatório). Notion (opcional): NOTION_TOKEN (secreta) e NOTION_ROOT (id da página "Clientes").
// IA (opcional, desligada por padrão): ANTHROPIC_API_KEY.
const MODELS = ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"];
const NV = "2022-06-28";
const TTL = 60 * 60 * 24 * 60; // sessão de 60 dias
const enc = new TextEncoder();

function corsHeaders(env, req) {
  const origin = req.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGIN || "*").split(",").map((s) => s.trim()).filter(Boolean);
  const any = allowed.includes("*");
  return {
    "access-control-allow-origin": any ? "*" : allowed.includes(origin) ? origin : allowed[0],
    "access-control-allow-headers": "content-type,authorization,x-admin-code",
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
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const rand = (n) => b64(crypto.getRandomValues(new Uint8Array(n)).buffer);
const norm = (e) => String(e || "").trim().toLowerCase();
const okEmail = (e) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e);

async function hashPw(pw, salt, iter = 100000) {
  const k = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, k, 256);
  return b64(bits);
}
async function signKey(env) {
  let k = await env.SYNC.get("cfg:key");
  if (!k) { k = rand(32); await env.SYNC.put("cfg:key", k); }
  return crypto.subtle.importKey("raw", enc.encode(k), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function mkToken(env, uid) {
  const p = b64(enc.encode(JSON.stringify({ u: uid, e: Math.floor(Date.now() / 1000) + TTL })));
  const sig = b64(await crypto.subtle.sign("HMAC", await signKey(env), enc.encode(p)));
  return p + "." + sig;
}
async function readToken(env, tok) {
  const [p, s] = String(tok || "").split(".");
  if (!p || !s) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await signKey(env), unb64(s), enc.encode(p));
    if (!ok) return null;
    const o = JSON.parse(new TextDecoder().decode(unb64(p)));
    return o.e > Date.now() / 1000 ? o : null;
  } catch { return null; }
}
async function authUser(env, req) {
  const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") || "");
  const t = m && (await readToken(env, m[1]));
  if (!t) return null;
  const email = await env.SYNC.get("id:" + t.u);
  if (!email) return null;
  const u = JSON.parse((await env.SYNC.get("u:" + email)) || "null");
  return u && u.active !== false ? u : null;
}
const isAdmin = (env, req) => !!env.ADMIN_CODE && same(req.headers.get("x-admin-code") || "", env.ADMIN_CODE);
async function body(req, max = 6e6) {
  if ((+req.headers.get("content-length") || 0) > max) throw Object.assign(new Error("too_large"), { status: 413 });
  try { return await req.json(); } catch { throw Object.assign(new Error("bad_json"), { status: 400 }); }
}
async function tooMany(env, key) { return (+(await env.SYNC.get("rl:" + key)) || 0) >= 8; }
async function bump(env, key) { await env.SYNC.put("rl:" + key, String((+(await env.SYNC.get("rl:" + key)) || 0) + 1), { expirationTtl: 900 }); }

/* ---------------- Notion ---------------- */
async function notion(env, path, method, b) {
  const r = await fetch("https://api.notion.com/v1" + path, {
    method,
    headers: { authorization: "Bearer " + env.NOTION_TOKEN, "notion-version": NV, "content-type": "application/json" },
    body: b ? JSON.stringify(b) : undefined,
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = { message: t.slice(0, 200) }; }
  if (!r.ok) throw Object.assign(new Error("notion_" + r.status), { status: 502, detail: j.message || "" });
  return j;
}
const rt = (s) => {
  s = String(s == null ? "" : s);
  const o = [];
  for (let i = 0; i < s.length && o.length < 90; i += 1900) o.push({ type: "text", text: { content: s.slice(i, i + 1900) } });
  return o;
};
const txt = (p) => (p && (p.rich_text || p.title) ? (p.rich_text || p.title).map((x) => x.plain_text || "").join("") : "");
const selv = (p) => (p && p.select ? p.select.name : "");
const datev = (p) => (p && p.date ? String(p.date.start || "").slice(0, 10) : "");
const sel = (v) => ({ select: v ? { name: String(v).replace(/,/g, " ").slice(0, 100) } : null });
const dat = (v) => ({ date: /^\d{4}-\d{2}-\d{2}$/.test(v || "") ? { start: v } : null });
const ST = ["Ideia", "Roteiro", "Gravado", "Editado", "Publicado"];
const opts = (a) => ({ select: { options: a.map((n) => ({ name: n })) } });

const SCHEMAS = {
  cal: {
    title: "Calendário de conteúdos",
    props: { "Título": { title: {} }, Data: { date: {} }, Canal: { select: {} }, Formato: { select: {} }, Etapa: opts(ST), Marca: { rich_text: {} }, Roteiro: { rich_text: {} }, CTA: { rich_text: {} }, Legenda: { rich_text: {} }, Hashtags: { rich_text: {} }, Slides: { rich_text: {} }, ID: { rich_text: {} } },
  },
  base: { title: "Perfil e base", props: { Texto: { title: {} }, Categoria: { select: {} }, ID: { rich_text: {} } } },
  parc: {
    title: "Parcerias e prazos",
    props: { Marca: { title: {} }, Nome: { rich_text: {} }, Status: { select: {} }, Valor: { rich_text: {} }, "Nota fiscal": { rich_text: {} }, "Nota emitida em": { date: {} }, "Pago em": { date: {} }, "Entregáveis": { rich_text: {} }, Regras: { rich_text: {} }, ID: { rich_text: {} } },
  },
};
const toProps = {
  cal: (i) => ({ "Título": { title: rt(i.t) }, Data: dat(i.d), Canal: sel(i.canal), Formato: sel(i.fmt), Etapa: sel(ST.includes(i.st) ? i.st : "Ideia"), Marca: { rich_text: rt(i.marca) }, Roteiro: { rich_text: rt(i.nota) }, CTA: { rich_text: rt(i.cta) }, Legenda: { rich_text: rt(i.leg) }, Hashtags: { rich_text: rt(i.tags) }, Slides: { rich_text: rt(i.slides) }, ID: { rich_text: rt(i.id) } }),
  base: (i) => ({ Texto: { title: rt(i.text) }, Categoria: sel(i.cat), ID: { rich_text: rt(i.id) } }),
  parc: (i) => ({ Marca: { title: rt(i.marca) }, Nome: { rich_text: rt(i.nome) }, Status: sel(i.status), Valor: { rich_text: rt(i.valor) }, "Nota fiscal": { rich_text: rt(i.nf) }, "Nota emitida em": dat(i.nfData), "Pago em": dat(i.pagoEm), "Entregáveis": { rich_text: rt(i.entregaveis) }, Regras: { rich_text: rt(i.regras) }, ID: { rich_text: rt(i.id) } }),
};
const fromPage = {
  cal: (p) => { const q = p.properties; return { id: txt(q.ID), t: txt(q["Título"]), d: datev(q.Data), canal: selv(q.Canal), fmt: selv(q.Formato), st: selv(q.Etapa) || "Ideia", marca: txt(q.Marca), nota: txt(q.Roteiro), cta: txt(q.CTA), leg: txt(q.Legenda), tags: txt(q.Hashtags), slides: txt(q.Slides) }; },
  base: (p) => { const q = p.properties; return { id: txt(q.ID), text: txt(q.Texto), cat: selv(q.Categoria) }; },
  parc: (p) => { const q = p.properties; return { id: txt(q.ID), marca: txt(q.Marca), nome: txt(q.Nome), status: selv(q.Status), valor: txt(q.Valor), nf: txt(q["Nota fiscal"]), nfData: datev(q["Nota emitida em"]), pagoEm: datev(q["Pago em"]), entregaveis: txt(q["Entregáveis"]), regras: txt(q.Regras) }; },
};
const KINDS = ["cal", "base", "parc"];

async function notionSetup(env, u) {
  if (!env.NOTION_TOKEN || !env.NOTION_ROOT) throw Object.assign(new Error("notion_not_configured"), { status: 503 });
  if (u.notion && u.notion.dbs) return u.notion;
  const page = await notion(env, "/pages", "POST", {
    parent: { type: "page_id", page_id: env.NOTION_ROOT },
    properties: { title: { title: rt("Cliente: " + (u.name || u.email)) } },
  });
  const dbs = {};
  for (const k of KINDS) {
    const d = await notion(env, "/databases", "POST", { parent: { type: "page_id", page_id: page.id }, title: rt(SCHEMAS[k].title), properties: SCHEMAS[k].props });
    dbs[k] = d.id;
  }
  u.notion = { page: page.id, dbs, at: Date.now() };
  await env.SYNC.put("u:" + u.email, JSON.stringify(u));
  return u.notion;
}
async function notionPull(env, u) {
  const n = await notionSetup(env, u);
  const map = JSON.parse((await env.SYNC.get("nm:" + u.id)) || "{}");
  const out = {};
  for (const k of KINDS) {
    out[k] = [];
    let cursor;
    for (let g = 0; g < 8; g++) {
      const r = await notion(env, "/databases/" + n.dbs[k] + "/query", "POST", { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
      for (const p of r.results || []) {
        if (p.archived) continue;
        const it = fromPage[k](p);
        if (!it.id) it.id = "nt" + p.id.replace(/-/g, "").slice(0, 12);
        map[k + ":" + it.id] = p.id;
        it.edited = Date.parse(p.last_edited_time) || 0;
        out[k].push(it);
      }
      if (!r.has_more) break;
      cursor = r.next_cursor;
    }
  }
  await env.SYNC.put("nm:" + u.id, JSON.stringify(map));
  return out;
}
async function notionPush(env, u, b) {
  const n = await notionSetup(env, u);
  const map = JSON.parse((await env.SYNC.get("nm:" + u.id)) || "{}");
  let made = 0, upd = 0, gone = 0, left = 38; // limite de chamadas por pedido
  const stamps = {};
  for (const k of KINDS) {
    for (const i of (b[k] || [])) {
      if (!i || !i.id || left <= 0) continue;
      left--;
      const key = k + ":" + i.id;
      try {
        if (map[key]) { const r = await notion(env, "/pages/" + map[key], "PATCH", { properties: toProps[k](i) }); stamps[key] = Date.parse(r.last_edited_time) || Date.now(); upd++; }
        else { const r = await notion(env, "/pages", "POST", { parent: { database_id: n.dbs[k] }, properties: toProps[k](i) }); map[key] = r.id; stamps[key] = Date.parse(r.last_edited_time) || Date.now(); made++; }
      } catch (e) { if (e.detail && /archived/i.test(e.detail)) { delete map[key]; } else throw e; }
    }
    for (const id of (b.del && b.del[k]) || []) {
      const key = k + ":" + id;
      if (!map[key] || left <= 0) continue;
      left--;
      await notion(env, "/pages/" + map[key], "PATCH", { archived: true });
      delete map[key]; gone++;
    }
  }
  await env.SYNC.put("nm:" + u.id, JSON.stringify(map));
  return { ok: true, made, upd, gone, stamps, more: left <= 0 };
}

/* ---------------- rotas ---------------- */
export default {
  async fetch(req, env) {
    const h = corsHeaders(env, req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    if (!env.SYNC) return json({ error: "no_kv" }, 500, h);
    const path = new URL(req.url).pathname;
    try {
      /* administração (quem vende o app) */
      if (path.startsWith("/admin/")) {
        if (!isAdmin(env, req)) return json({ error: "unauthorized" }, 401, h);
        if (path === "/admin/invite" && req.method === "POST") {
          const b = await body(req, 2e3).catch(() => ({}));
          const code = rand(7).replace(/[-_]/g, "x").toLowerCase();
          await env.SYNC.put("inv:" + code, JSON.stringify({ name: String(b.name || "").slice(0, 80), at: Date.now() }), { expirationTtl: 60 * 60 * 24 * 14 });
          return json({ code, expires_days: 14 }, 200, h);
        }
        if (path === "/admin/users" && req.method === "GET") {
          const l = await env.SYNC.list({ prefix: "u:" });
          const out = [];
          for (const k of l.keys) { const u = JSON.parse((await env.SYNC.get(k.name)) || "null"); if (u) out.push({ email: u.email, name: u.name, active: u.active !== false, notion: !!(u.notion && u.notion.dbs), created: u.created }); }
          return json({ users: out }, 200, h);
        }
        if (path === "/admin/disable" && req.method === "POST") {
          const b = await body(req, 2e3);
          const u = JSON.parse((await env.SYNC.get("u:" + norm(b.email))) || "null");
          if (!u) return json({ error: "not_found" }, 404, h);
          u.active = b.active === true;
          await env.SYNC.put("u:" + u.email, JSON.stringify(u));
          return json({ ok: true, active: u.active }, 200, h);
        }
        if (path === "/admin/reset" && req.method === "POST") {
          const b = await body(req, 2e3);
          const u = JSON.parse((await env.SYNC.get("u:" + norm(b.email))) || "null");
          if (!u || String(b.password || "").length < 8) return json({ error: "bad_request" }, 400, h);
          const salt = crypto.getRandomValues(new Uint8Array(16));
          u.salt = b64(salt.buffer); u.hash = await hashPw(b.password, salt, u.iter || 100000);
          await env.SYNC.put("u:" + u.email, JSON.stringify(u));
          return json({ ok: true }, 200, h);
        }
        return json({ error: "not_found" }, 404, h);
      }

      /* cadastro e entrada */
      if (path === "/auth/signup" && req.method === "POST") {
        const b = await body(req, 4e3);
        const email = norm(b.email), pw = String(b.password || "");
        if (!okEmail(email)) return json({ error: "bad_email" }, 400, h);
        if (pw.length < 8) return json({ error: "weak_password" }, 400, h);
        const inv = JSON.parse((await env.SYNC.get("inv:" + String(b.invite || "").trim().toLowerCase())) || "null");
        if (!inv) return json({ error: "bad_invite" }, 403, h);
        if (await env.SYNC.get("u:" + email)) return json({ error: "exists" }, 409, h);
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const u = { id: rand(12), email, name: String(b.name || inv.name || "").slice(0, 80), salt: b64(salt.buffer), iter: 100000, hash: await hashPw(pw, salt), active: true, created: Date.now() };
        await env.SYNC.put("u:" + email, JSON.stringify(u));
        await env.SYNC.put("id:" + u.id, email);
        await env.SYNC.delete("inv:" + String(b.invite).trim().toLowerCase());
        return json({ token: await mkToken(env, u.id), email, name: u.name }, 200, h);
      }
      if (path === "/auth/login" && req.method === "POST") {
        const b = await body(req, 4e3);
        const email = norm(b.email);
        if (await tooMany(env, email)) return json({ error: "too_many" }, 429, h);
        const u = JSON.parse((await env.SYNC.get("u:" + email)) || "null");
        const good = u && u.active !== false && same(await hashPw(String(b.password || ""), unb64(u.salt), u.iter || 100000), u.hash);
        if (!good) { await bump(env, email); return json({ error: "bad_login" }, 401, h); }
        return json({ token: await mkToken(env, u.id), email, name: u.name, notion: !!(u.notion && u.notion.dbs) }, 200, h);
      }

      /* áreas protegidas */
      const u = await authUser(env, req);
      if (!u) return json({ error: "unauthorized" }, 401, h);

      if (path === "/auth/me") return json({ email: u.email, name: u.name, notion: !!(u.notion && u.notion.dbs), notion_available: !!(env.NOTION_TOKEN && env.NOTION_ROOT) }, 200, h);

      if (path === "/sync") {
        const key = "s:" + u.id;
        const cur = JSON.parse((await env.SYNC.get(key)) || "{}");
        cur.meta = cur.meta || {}; cur.data = cur.data || {};
        if (req.method === "GET") return json({ meta: cur.meta, data: cur.data }, 200, h);
        if (req.method === "PUT") {
          const b = await body(req);
          let n = 0;
          for (const k of Object.keys(b.meta || {})) {
            if (!/^hoje-[a-z0-9-]+$/.test(k) || typeof (b.data || {})[k] !== "string") continue;
            if ((+b.meta[k] || 0) > (cur.meta[k] || 0)) { cur.meta[k] = +b.meta[k]; cur.data[k] = b.data[k]; n++; }
          }
          await env.SYNC.put(key, JSON.stringify(cur));
          return json({ ok: true, updated: n }, 200, h);
        }
      }

      if (path === "/notion/setup" && req.method === "POST") { const n = await notionSetup(env, u); return json({ ok: true, page: n.page }, 200, h); }
      if (path === "/notion/pull" && req.method === "POST") return json(await notionPull(env, u), 200, h);
      if (path === "/notion/push" && req.method === "POST") return json(await notionPush(env, u, await body(req)), 200, h);

      if (path === "/ai" && req.method === "POST") {
        if (!env.ANTHROPIC_API_KEY) return json({ error: "ai_off" }, 503, h);
        const b = await body(req, 8e6);
        if (!MODELS.includes(b.model)) return json({ error: "model_not_allowed" }, 400, h);
        if (!Array.isArray(b.messages)) return json({ error: "bad_request" }, 400, h);
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: b.model, max_tokens: Math.min(+b.max_tokens || 4000, 8000), messages: b.messages }),
        });
        return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json", ...h } });
      }
      return json({ error: "not_found" }, 404, h);
    } catch (e) {
      return json({ error: e.message || "error", detail: e.detail || undefined }, e.status || 500, h);
    }
  },
};
