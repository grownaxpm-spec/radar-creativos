// Robot de búsquedas que corre dentro de Supabase (Edge Function).
//
//  action "start" (desde la app, con el login del usuario): arranca la corrida de Apify.
//  action "tick"  (cada minuto con pg_cron, al terminar Apify por webhook, y desde la app mientras miras):
//     - mientras Apify busca: actualiza el % de avance
//     - cuando Apify terminó: procesa los anuncios de a tandas (IA + guardar videos) hasta terminar
//     - sin search_id: avanza todas las búsquedas en curso, arranca las pendientes y las semanales
//
// Secretos que usa (Supabase → Edge Functions → Secrets): APIFY_TOKEN, ANTHROPIC_API_KEY (opcional),
// APIFY_ACTOR y CLAUDE_MODEL (opcionales). SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los pone Supabase solo.
import { createClient } from "@supabase/supabase-js";
import { daysActive, libraryUrl, matchesRubro, normalizeAd, rubroRoots, winnerScore, type MediaItem, type NormalizedAd } from "./normalize.ts";
import { getItems, getRun, sourceUrlOf, startRun } from "./apify.ts";
import { classifyAds, type ClientProfile } from "./classify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APIFY_TOKEN = Deno.env.get("APIFY_TOKEN");
const ACTOR = Deno.env.get("APIFY_ACTOR") || "apify/facebook-ads-scraper";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const CLAUDE_MODEL = Deno.env.get("CLAUDE_MODEL") || undefined;
const SELF_URL = `${SUPABASE_URL}/functions/v1/search-worker`;
const CHUNK = 8; // anuncios por tanda (chico: el servidor de Supabase tiene poca memoria)
const BUDGET_MS = 60_000; // una tanda por invocación y seguimos en otra

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

type Search = {
  id: string;
  client_id: string | null;
  rubro: string;
  keywords: string[];
  countries: string[];
  media_type: string;
  max_per_query: number;
  include_inactive: boolean;
  status: string;
  apify_run_id: string | null;
  apify_dataset_id: string | null;
  queries: { q: string; country: string; url: string }[] | null;
  processed: number;
  total_items: number | null;
  total_found: number;
};

const setSearch = (id: string, patch: Record<string, unknown>) => db.from("searches").update(patch).eq("id", id);

// ---------- Arrancar ----------
async function start(s: Search) {
  if (!APIFY_TOKEN) {
    await setSearch(s.id, { status: "error", error: "Falta el secreto APIFY_TOKEN en Supabase (Edge Functions → Secrets).", progress: null });
    return { ok: false, error: "Falta APIFY_TOKEN" };
  }
  const keywords = s.keywords.length ? s.keywords : [s.rubro];
  const queries = s.countries.flatMap((country) =>
    keywords.map((q) => ({ q, country, url: libraryUrl(q, country, s.media_type, s.include_inactive ? "all" : "active") })),
  );
  try {
    const { runId, datasetId } = await startRun(
      queries.map((x) => x.url),
      s.max_per_query,
      { token: APIFY_TOKEN, actor: ACTOR, webhookUrl: `${SELF_URL}?action=tick&search_id=${s.id}` },
    );
    await setSearch(s.id, {
      status: "running",
      error: null,
      apify_run_id: runId,
      apify_dataset_id: datasetId,
      queries,
      processed: 0,
      total_items: null,
      total_found: 0,
      progress: `Buscando en la Biblioteca de Meta (${queries.length} consultas)…`,
      progress_pct: 5,
      locked_until: null,
    });
    return { ok: true };
  } catch (err) {
    const msg = (err as Error).message;
    await setSearch(s.id, { status: "error", error: msg, progress: null });
    return { ok: false, error: msg };
  }
}

// ---------- Avanzar ----------
async function claim(id: string): Promise<Search | null> {
  // Un solo tick a la vez por búsqueda
  const until = new Date(Date.now() + BUDGET_MS + 20_000).toISOString();
  const now = new Date().toISOString();
  const { data } = await db
    .from("searches")
    .update({ locked_until: until })
    .eq("id", id)
    .eq("status", "running")
    .or(`locked_until.is.null,locked_until.lt."${now}"`)
    .select("*")
    .maybeSingle();
  return data as Search | null;
}

async function tick(id: string, t0: number): Promise<"done" | "more" | "waiting" | "busy"> {
  const s = await claim(id);
  if (!s) return "busy";
  try {
    if (!APIFY_TOKEN) throw new Error("Falta el secreto APIFY_TOKEN en Supabase (Edge Functions → Secrets).");
    if (!s.apify_run_id || !s.apify_dataset_id) {
      await start(s);
      return "waiting";
    }
    const run = await getRun(s.apify_run_id, s.apify_dataset_id, APIFY_TOKEN);
    const finished = ["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"].includes(run.status);
    if (!finished) {
      const expected = Math.max(1, (s.queries?.length ?? 1) * s.max_per_query);
      await setSearch(s.id, {
        progress: `Buscando en la Biblioteca de Meta… ${run.itemCount} anuncios encontrados`,
        progress_pct: Math.round(5 + Math.min(1, run.itemCount / expected) * 45),
        locked_until: null,
      });
      return "waiting";
    }
    if (run.itemCount === 0) {
      throw new Error(
        run.status === "SUCCEEDED"
          ? "Apify no encontró anuncios con esas palabras clave y países."
          : `Apify terminó con estado ${run.status} y sin resultados (revisá el saldo o el token de Apify).`,
      );
    }

    const total = run.itemCount;
    let processed = s.processed ?? 0;
    let found = s.total_found ?? 0;
    const client = await loadClient(s.client_id);
    const byUrl = new Map((s.queries ?? []).map((x) => [x.url, x]));
    const startUrls = (s.queries ?? []).map((x) => x.url);

    if (processed === 0) await setSearch(s.id, { progress: `Procesando ${total} anuncios…`, progress_pct: 50, total_items: total });
    // Una tanda por invocación: si queda más, sigue en otra (cada una tiene su propio límite de memoria y tiempo)
    if (processed < total) {
      const items = await getItems(s.apify_dataset_id, APIFY_TOKEN, processed, CHUNK);
      if (items.length === 0) processed = total;
      else {
        found += await processChunk(s, items, { client, byUrl, startUrls });
        processed += items.length;
      }
      await setSearch(s.id, {
        processed,
        total_items: total,
        total_found: found,
        progress: `${ANTHROPIC_KEY ? "Analizando con IA y guardando" : "Guardando"} anuncios… ${processed}/${total}`,
        progress_pct: Math.round(50 + (processed / total) * 50),
      });
    }

    if (processed >= total) {
      await setSearch(s.id, {
        status: "done",
        progress: null,
        progress_pct: 100,
        total_found: found,
        last_run_at: new Date().toISOString(),
        locked_until: null,
      });
      return "done";
    }
    await setSearch(s.id, { locked_until: null });
    return "more";
  } catch (err) {
    console.error(err);
    await setSearch(s.id, { status: "error", error: (err as Error).message, progress: null, locked_until: null });
    return "done";
  }
}

async function loadClient(clientId: string | null): Promise<ClientProfile | null> {
  if (!clientId) return null;
  const { data } = await db.from("clients").select("name, rubro, usp, target, messages, tone, avoid").eq("id", clientId).maybeSingle();
  return data as ClientProfile | null;
}

async function processChunk(
  s: Search,
  items: Record<string, any>[],
  ctx: { client: ClientProfile | null; byUrl: Map<string, { q: string; country: string }>; startUrls: string[] },
): Promise<number> {
  const ads: { ad: NormalizedAd; query: string }[] = [];
  for (const it of items) {
    const srcUrl = sourceUrlOf(it, ctx.startUrls);
    const src = srcUrl ? ctx.byUrl.get(srcUrl) : undefined;
    const country = src?.country ?? (s.countries.length === 1 ? s.countries[0] : undefined);
    const ad = normalizeAd(it, country);
    if (!ad || ad.media.length === 0) continue;
    if (s.media_type === "video" && ad.format !== "video") continue;
    if (s.media_type === "image" && ad.format === "video") continue;
    if (ads.some((x) => x.ad.ad_archive_id === ad.ad_archive_id)) continue;
    ads.push({ ad, query: src ? `${src.q} (${src.country})` : "búsqueda" });
  }

  const tags = await classifyAds(
    s.rubro,
    ctx.client,
    ads.map(({ ad }) => ({
      id: ad.ad_archive_id,
      page_name: ad.page_name,
      body: ad.body,
      title: ad.title,
      format: ad.format,
      days_active: daysActive(ad),
      variations: ad.variations,
      image_url: ad.media.find((m) => m.type === "image")?.url ?? ad.media[0]?.thumb ?? null,
    })),
    undefined,
    { apiKey: ANTHROPIC_KEY, model: CLAUDE_MODEL },
  );

  // Se queda si la IA dice que es del rubro; si la IA no lo analizó, tiene que mencionar el rubro o un competidor
  const roots = rubroRoots([s.rubro, ...s.keywords]);
  const isRelevant = (ad: NormalizedAd) => {
    const r = tags.get(ad.ad_archive_id)?.relevant;
    return r === true || (r === undefined && matchesRubro(ad, roots, s.keywords));
  };
  const keep = ads.filter(({ ad }) => isRelevant(ad));
  const drop = ads.filter(({ ad }) => !isRelevant(ad)).map(({ ad }) => ad.ad_archive_id);
  if (drop.length) await db.from("ads").update({ relevant: false }).eq("platform", "meta").in("ad_archive_id", drop);
  let saved = 0;
  const queue = [...keep];
  await Promise.all(
    Array.from({ length: 2 }, async () => {
      for (let x = queue.shift(); x; x = queue.shift()) if (await saveAd(s.id, x.ad, x.query, tags.get(x.ad.ad_archive_id))) saved++;
    }),
  );
  return saved;
}

async function saveAd(searchId: string, ad: NormalizedAd, query: string, t: any): Promise<boolean> {
  const { data: existing } = await db
    .from("ads")
    .select("id, countries, media")
    .eq("platform", "meta")
    .eq("ad_archive_id", ad.ad_archive_id)
    .maybeSingle();
  const alreadyStored =
    Array.isArray(existing?.media) && existing.media.length > 0 && existing.media.every((m: MediaItem) => !/fbcdn|facebook\.com/.test(m.url));
  const media = alreadyStored ? existing!.media : await storeMedia(ad.ad_archive_id, ad.media);
  const row = {
    ...ad,
    media,
    countries: [...new Set([...(existing?.countries ?? []), ...ad.countries])],
    last_seen: new Date().toISOString(),
    score: winnerScore(ad, t?.ai_score),
    ...(t
      ? {
          relevant: t.relevant,
          angle: t.angle,
          hook: t.hook,
          hook_type: t.hook_type,
          why_it_works: t.why_it_works,
          adaptation: t.adaptation,
          ai_score: t.ai_score,
          ai_summary: t.summary,
        }
      : {}),
  };
  const { data: up, error } = await db.from("ads").upsert(row, { onConflict: "platform,ad_archive_id" }).select("id").single();
  if (error || !up) {
    console.warn(`no pude guardar ${ad.ad_archive_id}: ${error?.message}`);
    return false;
  }
  await db.from("search_results").upsert({ search_id: searchId, ad_id: up.id, query }, { onConflict: "search_id,ad_id" });
  return true;
}

// Copia videos e imágenes a Supabase Storage (los links de Meta vencen en pocos días)
const MAX_BYTES = 20 * 1024 * 1024; // videos más pesados quedan con el link de Meta
async function copy(url: string, key: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_BYTES) return null;
    const { error } = await db.storage
      .from("media")
      .upload(key, bytes, { contentType: res.headers.get("content-type") ?? undefined, upsert: true, cacheControl: "31536000" });
    if (error) return null;
    return `${SUPABASE_URL}/storage/v1/object/public/media/${key}`;
  } catch {
    return null;
  }
}
async function storeMedia(adId: string, media: MediaItem[]): Promise<MediaItem[]> {
  const out: MediaItem[] = [];
  for (const [i, m] of media.slice(0, 4).entries()) {
    const ext = m.type === "video" ? "mp4" : "jpg";
    const url = (await copy(m.url, `meta/${adId}/${i}.${ext}`)) ?? m.url;
    const thumb = m.thumb ? ((await copy(m.thumb, `meta/${adId}/${i}-thumb.jpg`)) ?? m.thumb) : null;
    out.push({ ...m, url, thumb });
  }
  return out;
}

// ---------- Avanzar todo (pg_cron cada minuto) ----------
async function tickAll(t0: number) {
  // Arrancar pendientes y semanales vencidas
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: pending, error: e1 } = await db.from("searches").select("*").eq("status", "pending").limit(5);
  const { data: weekly, error: e2 } = await db
    .from("searches")
    .select("*")
    .eq("recurring", true)
    .eq("status", "done")
    .lt("last_run_at", weekAgo)
    .limit(5);
  if (e1 || e2) console.error("tickAll", e1?.message, e2?.message);
  for (const s of [...(pending ?? []), ...(weekly ?? [])] as Search[]) await start(s);

  const { data: running } = await db.from("searches").select("id").eq("status", "running");
  const results: Record<string, string> = {};
  for (const r of running ?? []) {
    if (Date.now() - t0 > BUDGET_MS) break;
    results[r.id] = await tick(r.id, t0);
  }
  return results;
}

function continueLater(searchId: string) {
  // Sigue con la próxima tanda en otra invocación (cada una tiene su propio límite de tiempo)
  const p = fetch(`${SELF_URL}?action=tick&search_id=${searchId}`, {
    method: "POST",
    headers: { authorization: `Bearer ${SERVICE_KEY}` },
  }).catch(() => {});
  // @ts-ignore EdgeRuntime existe en Supabase
  globalThis.EdgeRuntime?.waitUntil?.(p);
}

async function isTeam(authHeader: string | null): Promise<boolean> {
  const jwt = authHeader?.replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  const { data } = await db.auth.getUser(jwt);
  const email = data.user?.email?.toLowerCase();
  if (!email) return false;
  const { data: member } = await db.from("team_members").select("email").ilike("email", email).maybeSingle();
  return !!member;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const t0 = Date.now();
  const url = new URL(req.url);
  const body = await req.json().catch(() => ({}));
  const action = body.action ?? url.searchParams.get("action") ?? "tick";
  const searchId: string | undefined = body.search_id ?? url.searchParams.get("search_id") ?? undefined;
  if (searchId && !/^[0-9a-f-]{36}$/i.test(searchId)) return json({ error: "search_id inválido" }, 400);

  if (action === "start") {
    if (!(await isTeam(req.headers.get("authorization")))) return json({ error: "No autorizado" }, 403);
    if (!searchId) return json({ error: "Falta search_id" }, 400);
    const { data: s } = await db.from("searches").select("*").eq("id", searchId).maybeSingle();
    if (!s) return json({ error: "No existe la búsqueda" }, 404);
    if (s.status === "running" && s.apify_run_id) return json({ ok: true, already: true });
    const r = await start(s as Search);
    return json(r, r.ok ? 200 : 500);
  }

  // tick: no cambia nada que no esté ya pedido, así que puede llamarlo el cron, el webhook de Apify o la app
  if (searchId) {
    const r = await tick(searchId, t0);
    if (r === "more") continueLater(searchId);
    return json({ ok: true, result: r });
  }
  const results = await tickAll(t0);
  for (const [id, r] of Object.entries(results)) if (r === "more") continueLater(id);
  return json({ ok: true, results });
});
