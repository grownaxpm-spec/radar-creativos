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
import { daysActive, isBlockedAdvertiser, libraryUrl, matchesRubro, normalizeAd, perQueryLimit, rubroRoots, winnerScore, type MediaItem, type NormalizedAd } from "./normalize.ts";
import { getItems, getRun, sourceUrlOf, startRun } from "./apify.ts";
import { classifyAds, type ClientProfile } from "./classify.ts";
import { draftPedido } from "./pedido.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APIFY_TOKEN = Deno.env.get("APIFY_TOKEN");
const ACTOR = Deno.env.get("APIFY_ACTOR") || "apify/facebook-ads-scraper";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const CLAUDE_MODEL = Deno.env.get("CLAUDE_MODEL") || undefined;
const PEDIDO_MODEL = Deno.env.get("CLAUDE_PEDIDO_MODEL") || "claude-opus-5-5";
const SELF_URL = `${SUPABASE_URL}/functions/v1/search-worker`;
const APP_URL = Deno.env.get("APP_URL") || "https://radar-creativos.vercel.app";
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
  event: string | null;
  brief: string | null;
  max_total: number | null;
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
  const base = s.keywords.length ? s.keywords : [s.rubro];
  // Para eventos (Black Friday, Cyber, Hot Sale…) se suma una búsqueda por cada evento nombrado
  const events = (s.event ?? "").split(/\s*(?:,|\/|\+|;|\by\b|\be\b)\s*/i).map((x) => x.trim()).filter((x) => x.length > 2);
  const keywords = [...new Set([...base, ...events.map((ev) => `${ev} ${base[0]}`)])];
  const queries = s.countries.flatMap((country) =>
    keywords.map((q) => ({ q, country, url: libraryUrl(q, country, s.media_type, s.include_inactive ? "all" : "active") })),
  );
  try {
    // Con un total, no se fuerza un número por país: se pide un poco de más y queda lo que traiga cada uno
    const perQuery = s.max_total ? perQueryLimit(s.max_total, queries.length) : s.max_per_query;
    const { runId, datasetId } = await startRun(
      queries.map((x) => x.url),
      perQuery,
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
    // Anuncios de catálogo (productos dinámicos): no sirven de referencia
    if (ad.is_catalog) continue;
    if (s.media_type === "video" && ad.format !== "video") continue;
    if (s.media_type === "image" && ad.format === "video") continue;
    if (ads.some((x) => x.ad.ad_archive_id === ad.ad_archive_id)) continue;
    // Los anuncios del propio cliente no sirven como referencia de competencia
    if (ctx.client && isBlockedAdvertiser(ad, [ctx.client.name])) continue;
    // Marketplaces (Shein, Temu, Mercado Libre…) no son marcas del rubro
    if (isBlockedAdvertiser(ad)) continue;
    ads.push({ ad, query: src ? `${src.q} (${src.country})` : "búsqueda" });
  }

  // Nunca repetir: afuera lo que ya trajo cualquier búsqueda anterior (mismo anuncio, o la misma pieza
  // de la misma marca con otro número de Meta) y las copias dentro de esta misma tanda
  const sameKey = (page: string | null, body: string | null) =>
    body ? `${(page ?? "").toLowerCase()}|${body.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 200)}` : null;
  const pages = [...new Set(ads.map(({ ad }) => ad.page_name).filter((x): x is string => !!x))];
  const [{ data: byId }, { data: byPage }] = await Promise.all([
    db.from("ads").select("ad_archive_id").in("ad_archive_id", ads.map(({ ad }) => ad.ad_archive_id)),
    pages.length ? db.from("ads").select("page_name, body").in("page_name", pages) : Promise.resolve({ data: [] as { page_name: string; body: string | null }[] }),
  ]);
  const seenIds = new Set((byId ?? []).map((r) => r.ad_archive_id));
  const seenKeys = new Set((byPage ?? []).map((r) => sameKey(r.page_name, r.body)).filter(Boolean));
  const fresh = ads.filter(({ ad }) => {
    const k = sameKey(ad.page_name, ad.body);
    if (seenIds.has(ad.ad_archive_id) || (k && seenKeys.has(k))) return false;
    if (k) seenKeys.add(k);
    return true;
  });
  ads.length = 0;
  ads.push(...fresh);
  if (ads.length === 0) return 0;

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
    { apiKey: ANTHROPIC_KEY, model: CLAUDE_MODEL, event: s.event, brief: s.brief },
  );

  // Se queda si la IA dice que es del rubro; si la IA no lo analizó, tiene que mencionar el rubro o un competidor
  const roots = rubroRoots([s.rubro, ...s.keywords]);
  const isRelevant = (ad: NormalizedAd) => {
    const r = tags.get(ad.ad_archive_id)?.relevant;
    return r === true || (r === undefined && matchesRubro(ad, roots, s.keywords));
  };
  // En búsquedas para un evento solo entran los anuncios de venta directa (los demás no se marcan como basura)
  const isSale = (ad: NormalizedAd) => !s.event || tags.get(ad.ad_archive_id)?.direct_sale !== false;
  const keep = ads.filter(({ ad }) => isRelevant(ad) && isSale(ad));
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
  const { is_catalog: _catalog, ...fields } = ad;
  // Si después de sacar las repetidas queda una sola imagen, no es carrusel
  const format = fields.format === "carousel" && media.length <= 1 ? (media[0]?.type === "video" ? "video" : "image") : fields.format;
  const row = {
    ...fields,
    format,
    media,
    countries: [...new Set([...(existing?.countries ?? []), ...ad.countries])],
    last_seen: new Date().toISOString(),
    score: winnerScore(ad, t?.ai_score),
    ...(t
      ? {
          relevant: t.relevant,
          direct_sale: t.direct_sale,
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
async function copy(url: string, key: string, seen?: Set<string>): Promise<string | "dup" | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_BYTES) return null;
    // Meta repite la misma imagen con distintos links: si el contenido ya está, no se guarda de nuevo
    if (seen) {
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
      if (seen.has(hash)) return "dup";
      seen.add(hash);
    }
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
  const seen = new Set<string>();
  for (const [i, m] of media.slice(0, 6).entries()) {
    const ext = m.type === "video" ? "mp4" : "jpg";
    const copied = await copy(m.url, `meta/${adId}/${i}.${ext}`, seen);
    if (copied === "dup") continue;
    const url = copied ?? m.url;
    const t = m.thumb ? await copy(m.thumb, `meta/${adId}/${i}-thumb.jpg`) : null;
    const thumb = m.thumb ? (t && t !== "dup" ? t : m.thumb) : null;
    out.push({ ...m, url, thumb });
  }
  return out;
}

// ---------- Avanzar todo (pg_cron cada minuto) ----------
// Analiza con IA anuncios ya guardados que quedaron sin análisis (por ejemplo, si la clave de Claude falló)
async function reanalyze(clientId: string | null): Promise<{ analyzed: number; remaining: number }> {
  const { data: rows } = await db
    .from("ads_view")
    .select("id, ad_archive_id, page_name, body, title, format, days_active, variations, media, start_date, end_date, is_active, countries, publisher_platforms")
    .is("hook", null)
    .or("relevant.is.null,relevant.eq.true")
    .limit(CHUNK);
  if (!rows?.length) return { analyzed: 0, remaining: 0 };
  const client = await loadClient(clientId);
  const tags = await classifyAds(
    client?.rubro ?? "calzado",
    client,
    rows.map((r: any) => ({
      id: r.ad_archive_id,
      page_name: r.page_name,
      body: r.body,
      title: r.title,
      format: r.format,
      days_active: r.days_active,
      variations: r.variations,
      image_url: (r.media ?? []).find((m: MediaItem) => m.type === "image")?.url ?? r.media?.[0]?.thumb ?? null,
    })),
    undefined,
    { apiKey: ANTHROPIC_KEY, model: CLAUDE_MODEL },
  );
  let analyzed = 0;
  for (const r of rows as any[]) {
    const t = tags.get(r.ad_archive_id);
    if (!t) continue;
    await db
      .from("ads")
      .update({
        relevant: t.relevant,
        direct_sale: t.direct_sale,
        angle: t.angle,
        hook: t.hook,
        hook_type: t.hook_type,
        why_it_works: t.why_it_works,
        adaptation: t.adaptation,
        ai_score: t.ai_score,
        ai_summary: t.summary,
        score: winnerScore(r, t.ai_score),
      })
      .eq("id", r.id);
    analyzed++;
  }
  const { count } = await db.from("ads").select("id", { count: "exact", head: true }).is("hook", null).or("relevant.is.null,relevant.eq.true");
  return { analyzed, remaining: analyzed === 0 ? 0 : (count ?? 0) };
}

// Escribe el pedido con IA y lo guarda (pieza por pieza, más hooks sugeridos y cómo se entrega)
async function generatePedido(pedidoId: string) {
  const setP = (patch: Record<string, unknown>) => db.from("pedidos").update(patch).eq("id", pedidoId);
  try {
    if (!ANTHROPIC_KEY) throw new Error("Falta el secreto ANTHROPIC_API_KEY en Supabase.");
    const { data: p } = await db.from("pedidos").select("*").eq("id", pedidoId).single();
    if (!p) throw new Error("No existe el pedido");
    const { data: client } = p.client_id ? await db.from("clients").select("*").eq("id", p.client_id).maybeSingle() : { data: null };
    const { data: items } = await db.from("pedido_items").select("id, position, format, angle, ad_id").eq("pedido_id", pedidoId).order("position");
    const adIds = (items ?? []).map((i) => i.ad_id).filter(Boolean);
    const { data: ads } = adIds.length
      ? await db.from("ads_view").select("id, page_name, format, body, hook, why_it_works, adaptation, days_active, video_analysis").in("id", adIds)
      : { data: [] };
    const byId = new Map((ads ?? []).map((a: any) => [a.id, a]));
    const draft = await draftPedido({
      apiKey: ANTHROPIC_KEY,
      model: PEDIDO_MODEL,
      client,
      pedido: p,
      items: (items ?? []).map((i) => ({ position: i.position, format: i.format, angle: i.angle, ref: i.ad_id ? (byId.get(i.ad_id) ?? null) : null })),
    });
    const emptyToNull = (v: string) => (v && v.trim() ? v.trim() : null);
    for (const it of items ?? []) {
      const d = draft.pieces.find((x) => x.position === it.position);
      if (!d) continue;
      await db
        .from("pedido_items")
        .update({
          code: emptyToNull(d.code),
          title: emptyToNull(d.title),
          piece_name: emptyToNull(d.title),
          group_name: emptyToNull(d.group_name),
          angle: emptyToNull(d.angle),
          funnel: d.funnel,
          creative_type: emptyToNull(d.creative_type),
          format: emptyToNull(d.format),
          ref_beats: emptyToNull(d.ref_beats),
          hook: emptyToNull(d.hook),
          development: emptyToNull(d.development),
          closing: emptyToNull(d.closing),
          scene: emptyToNull(d.scene),
          headline: emptyToNull(d.headline),
          subhead: emptyToNull(d.subhead),
          recording_tips: emptyToNull(d.recording_tips),
          duration: emptyToNull(d.duration),
          adaptations: emptyToNull(d.adaptations),
        })
        .eq("id", it.id);
    }
    await setP({
      intro: emptyToNull(draft.intro),
      refs_note: emptyToNull(draft.refs_note),
      hooks: draft.hooks,
      specs: draft.specs.filter((x) => x.items.length),
      before_notes: draft.before_notes,
      ai_status: "done",
      ai_error: null,
    });
  } catch (err) {
    console.error("generatePedido", err);
    await setP({ ai_status: "error", ai_error: (err as Error).message });
  }
}

// ---------- Análisis del video completo (imagen + audio) ----------
// Lo hace Gemini desde una función de Vercel (/api/analyze-video), que tiene acceso al AI Gateway sin claves.
async function analyzeVideo(adId: string) {
  const setA = (patch: Record<string, unknown>) => db.from("ads").update(patch).eq("id", adId);
  try {
    const { data: ad } = await db.from("ads").select("id, page_name, body, media").eq("id", adId).single();
    const video = ((ad?.media ?? []) as MediaItem[]).find((m) => m.type === "video");
    if (!video) throw new Error("El anuncio no tiene video");
    if (!video.url.includes("/storage/v1/")) throw new Error("El video no quedó guardado (pesa más de 20 MB o el link de Meta venció)");
    const { data: sec } = await db.from("app_secrets").select("value").eq("name", "video_secret").single();
    if (!sec) throw new Error("Falta video_secret");
    await setA({ video_status: "processing", video_error: null, video_at: new Date().toISOString() });
    const res = await fetch(`${APP_URL}/api/analyze-video`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-video-secret": sec.value },
      body: JSON.stringify({
        video_url: video.url,
        contexto: `Marca: ${ad!.page_name ?? "?"}\nTexto del anuncio: ${(ad!.body ?? "").slice(0, 600)}`,
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.analysis) throw new Error(out.error ?? `El análisis respondió ${res.status}`);
    const v = out.analysis;
    await setA({
      video_analysis: v,
      video_status: "done",
      video_error: null,
      // El hook real sale del video, no de la miniatura
      hook: v.hook_audio || v.hook_visual || undefined,
      why_it_works: v.por_que_funciona || undefined,
    });
  } catch (err) {
    console.error("analyzeVideo", adId, err);
    const msg = String((err as Error).message ?? err);
    // Si a Vercel le falta la tarjeta para el AI Gateway, el video queda en espera (no en error) y se reintenta solo
    const blocked = /credit card|tarjeta/i.test(msg);
    await setA({
      video_status: blocked ? null : "error",
      video_error: blocked ? "Falta habilitar el AI Gateway en Vercel (cargar tarjeta para los créditos gratis)." : msg.slice(0, 300),
      video_at: new Date().toISOString(),
    });
  }
}

// Cada minuto toma el próximo video sin analizar (los de mejor puntaje primero)
async function videoQueue() {
  // Si hace poco Vercel respondió que falta la tarjeta, no insistimos (se reintenta cada 15 minutos)
  const { count: blocked } = await db
    .from("ads")
    .select("id", { count: "exact", head: true })
    .like("video_error", "Falta habilitar el AI Gateway%")
    .gt("video_at", new Date(Date.now() - 15 * 60_000).toISOString());
  if (blocked) return 0;
  const stale = new Date(Date.now() - 10 * 60_000).toISOString();
  await db.from("ads").update({ video_status: null }).eq("video_status", "processing").lt("video_at", stale);
  const { data } = await db
    .from("ads")
    .select("id, media")
    .eq("format", "video")
    .is("video_status", null)
    .or("relevant.is.null,relevant.eq.true")
    .order("score", { ascending: false, nullsFirst: false })
    .limit(2);
  for (const a of data ?? []) {
    await db.from("ads").update({ video_status: "pending", video_at: new Date().toISOString() }).eq("id", a.id);
    const rt = (globalThis as any).EdgeRuntime;
    if (rt?.waitUntil) rt.waitUntil(analyzeVideo(a.id));
    else await analyzeVideo(a.id);
  }
  return (data ?? []).length;
}

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

  await videoQueue().catch((e) => console.error("videoQueue", e));

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

// Acceso libre: la herramienta se usa sin login, así que cualquiera puede arrancar búsquedas y pedidos
async function isTeam(_authHeader: string | null): Promise<boolean> {
  return true;
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
  if (action === "draft_pedido") {
    if (!(await isTeam(req.headers.get("authorization")))) return json({ error: "No autorizado" }, 403);
    const pedidoId: string | undefined = body.pedido_id;
    if (!pedidoId || !/^[0-9a-f-]{36}$/i.test(pedidoId)) return json({ error: "pedido_id inválido" }, 400);
    await db.from("pedidos").update({ ai_status: "generating", ai_error: null }).eq("id", pedidoId);
    // Corre en segundo plano: la app consulta el estado hasta que termine
    const rt = (globalThis as any).EdgeRuntime;
    if (rt?.waitUntil) rt.waitUntil(generatePedido(pedidoId));
    else await generatePedido(pedidoId);
    return json({ ok: true, status: "generating" });
  }

  if (action === "analyze_video") {
    if (!(await isTeam(req.headers.get("authorization")))) return json({ error: "No autorizado" }, 403);
    const adId: string | undefined = body.ad_id;
    if (!adId || !/^[0-9a-f-]{36}$/i.test(adId)) return json({ error: "ad_id inválido" }, 400);
    await db.from("ads").update({ video_status: "processing", video_error: null, video_at: new Date().toISOString() }).eq("id", adId);
    const rt = (globalThis as any).EdgeRuntime;
    if (rt?.waitUntil) rt.waitUntil(analyzeVideo(adId));
    else await analyzeVideo(adId);
    return json({ ok: true, status: "processing" });
  }

  if (action === "reanalyze") {
    const clientId: string | null = body.client_id ?? url.searchParams.get("client_id");
    const r = await reanalyze(clientId);
    if (r.remaining > 0) {
      const p = fetch(`${SELF_URL}?action=reanalyze${clientId ? `&client_id=${clientId}` : ""}`, { method: "POST" }).catch(() => {});
      // @ts-ignore EdgeRuntime existe en Supabase
      globalThis.EdgeRuntime?.waitUntil?.(p);
    }
    return json({ ok: true, ...r });
  }

  if (searchId) {
    const r = await tick(searchId, t0);
    if (r === "more") continueLater(searchId);
    return json({ ok: true, result: r });
  }
  const results = await tickAll(t0);
  for (const [id, r] of Object.entries(results)) if (r === "more") continueLater(id);
  return json({ ok: true, results });
});
