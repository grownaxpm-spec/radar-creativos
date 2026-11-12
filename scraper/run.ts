// Corre las búsquedas pendientes: Apify -> normaliza -> guarda medios en R2 -> (IA opcional) -> Supabase.
// Uso:  npx tsx scraper/run.ts [search_id]
//       sin search_id: corre las pendientes y las recurrentes que tienen más de 7 días.
import { createClient } from "@supabase/supabase-js";
import { runActor } from "./apify.ts";
import { libraryUrl, normalizeAd, type NormalizedAd } from "./normalize.ts";
import { makeMediaStore } from "./storage.ts";
import { classifyAds } from "./classify.ts";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable ${name}`);
  return v;
}

const db = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const APIFY_TOKEN = need("APIFY_TOKEN");
const ACTOR = process.env.APIFY_ACTOR || "apify/facebook-ads-scraper";
const storeMedia = makeMediaStore(db);
if (!storeMedia) console.warn("Sin almacenamiento: se guardan los links originales de Meta (vencen en pocos días).");

type Search = {
  id: string;
  rubro: string;
  keywords: string[];
  countries: string[];
  media_type: string;
  max_per_query: number;
};

async function processSearch(s: Search) {
  console.log(`\n▶ Búsqueda ${s.id} — ${s.rubro}`);
  await db.from("searches").update({ status: "running", error: null }).eq("id", s.id);

  const keywords = s.keywords.length ? s.keywords : [s.rubro];
  const found = new Map<string, { ad: NormalizedAd; query: string }>();

  for (const country of s.countries) {
    for (const q of keywords) {
      const url = libraryUrl(q, country, s.media_type);
      try {
        const raw = await runActor(url, s.max_per_query, { token: APIFY_TOKEN, actor: ACTOR });
        let n = 0;
        for (const r of raw) {
          const ad = normalizeAd(r, country);
          if (!ad || ad.media.length === 0) continue;
          if (s.media_type === "video" && ad.format !== "video") continue;
          if (s.media_type === "image" && ad.format === "video") continue;
          const prev = found.get(ad.ad_archive_id);
          if (prev) prev.ad.countries = [...new Set([...prev.ad.countries, ...ad.countries])];
          else found.set(ad.ad_archive_id, { ad, query: `${q} (${country})` });
          n++;
        }
        console.log(`  ${country} · "${q}": ${n} anuncios`);
      } catch (err) {
        console.warn(`  ${country} · "${q}": error — ${(err as Error).message}`);
      }
    }
  }

  // IA opcional: filtra ruido y etiqueta
  const entries = [...found.values()];
  const tags = await classifyAds(
    s.rubro,
    entries.map(({ ad }) => ({ id: ad.ad_archive_id, page_name: ad.page_name, body: ad.body, title: ad.title, format: ad.format })),
  );

  let saved = 0;
  for (const { ad, query } of entries) {
    const t = tags.get(ad.ad_archive_id);
    if (t && !t.relevant) continue; // descartado por la IA
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
      ...(t ? { relevant: t.relevant, angle: t.angle, hook: t.hook, ai_summary: t.summary } : {}),
    };
    const { data: up, error } = await db.from("ads").upsert(row, { onConflict: "platform,ad_archive_id" }).select("id").single();
    if (error || !up) {
      console.warn(`  no pude guardar ${ad.ad_archive_id}: ${error?.message}`);
      continue;
    }
    await db.from("search_results").upsert({ search_id: s.id, ad_id: up.id, query }, { onConflict: "search_id,ad_id" });
    saved++;
  }

  await db
    .from("searches")
    .update({ status: "done", total_found: saved, last_run_at: new Date().toISOString() })
    .eq("id", s.id);
  console.log(`✔ ${saved} anuncios guardados`);
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
      await db.from("searches").update({ status: "error", error: String((err as Error).message ?? err) }).eq("id", s.id);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
