// Corre las búsquedas pendientes: Apify -> normaliza -> guarda medios en R2 -> (IA opcional) -> Supabase.
// Uso:  npx tsx scraper/run.ts [search_id]
//       sin search_id: corre las pendientes y las recurrentes que tienen más de 7 días.
import { createClient } from "@supabase/supabase-js";
import { runActorBatch } from "./apify.ts";
import { daysActive, libraryUrl, normalizeAd, winnerScore, type NormalizedAd } from "./normalize.ts";
import { makeMediaStore } from "./storage.ts";
import { classifyAds, type ClientProfile } from "./classify.ts";

const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "APIFY_TOKEN"].filter((k) => !process.env[k]);
if (missing.includes("SUPABASE_URL") || missing.includes("SUPABASE_SERVICE_ROLE_KEY")) {
  // Sin Supabase no podemos ni avisar en la app: el error queda en el log de GitHub Actions.
  console.error(`::error::Faltan secretos en GitHub: ${missing.join(", ")}. Cargalos en Settings → Secrets and variables → Actions.`);
  process.exit(1);
}

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

if (missing.length) {
  // Avisamos en la app, en la búsqueda, qué falta
  const msg = `Falta el secreto ${missing.join(", ")} en GitHub (Settings → Secrets and variables → Actions).`;
  console.error(`::error::${msg}`);
  await db.from("searches").update({ status: "error", error: msg, progress: null }).in("status", ["pending", "running"]);
  process.exit(1);
}

const APIFY_TOKEN = process.env.APIFY_TOKEN!;
const ACTOR = process.env.APIFY_ACTOR || "apify/facebook-ads-scraper";
const storeMedia = makeMediaStore(db);
if (!storeMedia) console.warn("Sin almacenamiento: se guardan los links originales de Meta (vencen en pocos días).");

type Search = {
  id: string;
  client_id: string | null;
  include_inactive?: boolean;
  rubro: string;
  keywords: string[];
  countries: string[];
  media_type: string;
  max_per_query: number;
};

async function processSearch(s: Search) {
  console.log(`\n▶ Búsqueda ${s.id} — ${s.rubro}`);
  const progress = (msg: string) => {
    console.log(`  ${msg}`);
    return db.from("searches").update({ progress: msg }).eq("id", s.id).then(() => {});
  };
  await db.from("searches").update({ status: "running", error: null, progress: "Arrancando…" }).eq("id", s.id);

  const keywords = s.keywords.length ? s.keywords : [s.rubro];
  const found = new Map<string, { ad: NormalizedAd; query: string }>();
  const errors: string[] = [];

  let client: ClientProfile | null = null;
  if (s.client_id) {
    const { data } = await db.from("clients").select("name, rubro, usp, target, messages, tone, avoid").eq("id", s.client_id).maybeSingle();
    client = data as ClientProfile | null;
  }

  // Todas las combinaciones palabra × país en una sola corrida de Apify
  const queries = s.countries.flatMap((country) =>
    keywords.map((q) => ({ q, country, url: libraryUrl(q, country, s.media_type, s.include_inactive ? "all" : "active") })),
  );
  const byUrl = new Map(queries.map((x) => [x.url, x]));
  await progress(`Buscando en la Biblioteca de Meta (${queries.length} consultas)…`);
  let raw: Awaited<ReturnType<typeof runActorBatch>> = [];
  try {
    raw = await runActorBatch(
      queries.map((x) => x.url),
      s.max_per_query,
      { token: APIFY_TOKEN, actor: ACTOR, onStatus: (m) => void progress(m) },
    );
  } catch (err) {
    errors.push((err as Error).message);
  }
  for (const r of raw) {
    const src = r.__sourceUrl ? byUrl.get(r.__sourceUrl) : undefined;
    const country = src?.country ?? (s.countries.length === 1 ? s.countries[0] : undefined);
    const ad = normalizeAd(r, country);
    if (!ad || ad.media.length === 0) continue;
    if (s.media_type === "video" && ad.format !== "video") continue;
    if (s.media_type === "image" && ad.format === "video") continue;
    const prev = found.get(ad.ad_archive_id);
    if (prev) prev.ad.countries = [...new Set([...prev.ad.countries, ...ad.countries])];
    else found.set(ad.ad_archive_id, { ad, query: src ? `${src.q} (${src.country})` : "búsqueda" });
  }
  console.log(`  Apify devolvió ${raw.length} items, ${found.size} anuncios útiles`);

  if (found.size === 0 && errors.length > 0) throw new Error(`Apify falló: ${errors[0]}`);

  // IA opcional: filtra ruido, detecta hook y propone adaptación al cliente
  const entries = [...found.values()];
  if (process.env.ANTHROPIC_API_KEY) await progress(`Analizando ${entries.length} anuncios con IA (hook, por qué funciona, adaptación)…`);
  const tags = await classifyAds(
    s.rubro,
    client,
    entries.map(({ ad }) => ({
      id: ad.ad_archive_id,
      page_name: ad.page_name,
      body: ad.body,
      title: ad.title,
      format: ad.format,
      days_active: daysActive(ad),
      variations: ad.variations,
      image_url: ad.media.find((m) => m.type === "image")?.url ?? ad.media[0]?.thumb ?? null,
    })),
  );
  console.log(`  IA: ${tags.size} anuncios analizados`);

  let saved = 0;
  let done = 0;
  const keep = entries.filter(({ ad }) => tags.get(ad.ad_archive_id)?.relevant !== false); // la IA descarta lo que no es del rubro
  await progress(`Guardando ${keep.length} anuncios (videos e imágenes)…`);

  // De a 6 en paralelo: descargar videos uno por uno es lo más lento
  const queue = [...keep];
  async function worker() {
    for (let item = queue.shift(); item; item = queue.shift()) {
      if (await saveOne(item.ad, item.query)) saved++;
      if (++done % 15 === 0) await progress(`Guardando anuncios… ${done}/${keep.length}`);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));

  await db
    .from("searches")
    .update({ status: "done", total_found: saved, last_run_at: new Date().toISOString(), progress: null })
    .eq("id", s.id);
  console.log(`✔ ${saved} anuncios guardados`);

  async function saveOne(ad: NormalizedAd, query: string): Promise<boolean> {
    const t = tags.get(ad.ad_archive_id);
    const { data: existing } = await db
      .from("ads")
      .select("id, countries, media")
      .eq("platform", "meta")
      .eq("ad_archive_id", ad.ad_archive_id)
      .maybeSingle();

    // Si ya lo teníamos con los medios guardados de nuestro lado, no los volvemos a descargar
    const alreadyStored =
      Array.isArray(existing?.media) && existing.media.length > 0 && existing.media.every((m: { url: string }) => !/fbcdn|facebook\.com/.test(m.url));
    const media = alreadyStored ? existing!.media : storeMedia ? await storeMedia(ad.ad_archive_id, ad.media) : ad.media;

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
      console.warn(`  no pude guardar ${ad.ad_archive_id}: ${error?.message}`);
      return false;
    }
    await db.from("search_results").upsert({ search_id: s.id, ad_id: up.id, query }, { onConflict: "search_id,ad_id" });
    return true;
  }
}

async function main() {
  const onlyId = process.argv[2] || process.env.SEARCH_ID;
  let searches: Search[] = [];
  if (onlyId) {
    const { data, error } = await db.from("searches").select("*").eq("id", onlyId);
    if (error) throw error;
    searches = data ?? [];
  } else {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: pending } = await db.from("searches").select("*").eq("status", "pending");
    const { data: recurring } = await db
      .from("searches")
      .select("*")
      .eq("recurring", true)
      .neq("status", "running")
      .lt("last_run_at", weekAgo);
    const byId = new Map<string, Search>();
    for (const s of [...(pending ?? []), ...(recurring ?? [])]) byId.set(s.id, s);
    searches = [...byId.values()];
  }
  if (searches.length === 0) console.log("No hay búsquedas para correr.");
  for (const s of searches) {
    try {
      await processSearch(s);
    } catch (err) {
      console.error(err);
      await db.from("searches").update({ status: "error", error: String((err as Error).message ?? err), progress: null }).eq("id", s.id);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
