// Convierte un anuncio crudo de Apify (Biblioteca de Anuncios de Meta) a nuestro formato.
// Es tolerante: acepta camelCase (apify/facebook-ads-scraper) y snake_case (otros actores).

export type MediaItem = { type: "video" | "image"; url: string; thumb?: string | null };

export type NormalizedAd = {
  platform: "meta";
  ad_archive_id: string;
  page_name: string | null;
  page_url: string | null;
  body: string | null;
  title: string | null;
  cta: string | null;
  link_url: string | null;
  format: "video" | "image" | "carousel";
  media: MediaItem[];
  countries: string[];
  publisher_platforms: string[];
  start_date: string | null;
  end_date: string | null;
  is_active: boolean | null;
  snapshot_url: string;
  variations: number | null;
  /** Anuncio de catálogo (productos dinámicos): no sirve como referencia creativa */
  is_catalog: boolean;
};

type Raw = Record<string, any>;

const pick = (o: Raw | undefined | null, ...keys: string[]): any => {
  if (!o) return undefined;
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};

function toDate(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  let d: Date;
  if (typeof v === "number") d = new Date(v < 1e12 ? v * 1000 : v);
  else if (/^\d+$/.test(String(v))) {
    const n = Number(v);
    d = new Date(n < 1e12 ? n * 1000 : n);
  } else d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function text(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "object" && "text" in (v as Raw)) return text((v as Raw).text);
  return null;
}

function cleanTemplate(s: string | null): string | null {
  // Meta a veces devuelve plantillas tipo "{{product.name}}" en anuncios dinámicos
  if (!s) return s;
  return /^\{\{.*\}\}$/.test(s.trim()) ? null : s;
}

function mediaFrom(src: Raw): MediaItem[] {
  const out: MediaItem[] = [];
  for (const v of pick(src, "videos") ?? []) {
    const url = pick(v, "videoHdUrl", "video_hd_url", "videoSdUrl", "video_sd_url");
    if (url) out.push({ type: "video", url, thumb: pick(v, "videoPreviewImageUrl", "video_preview_image_url") ?? null });
  }
  for (const i of pick(src, "images") ?? []) {
    const url = pick(i, "originalImageUrl", "original_image_url", "resizedImageUrl", "resized_image_url");
    if (url) out.push({ type: "image", url });
  }
  for (const c of pick(src, "cards") ?? []) {
    const v = pick(c, "videoHdUrl", "video_hd_url", "videoSdUrl", "video_sd_url");
    if (v) out.push({ type: "video", url: v, thumb: pick(c, "videoPreviewImageUrl", "video_preview_image_url") ?? null });
    else {
      const i = pick(c, "originalImageUrl", "original_image_url", "resizedImageUrl", "resized_image_url");
      if (i) out.push({ type: "image", url: i });
    }
  }
  // sin duplicados
  const seen = new Set<string>();
  return out.filter((m) => (seen.has(m.url) ? false : (seen.add(m.url), true)));
}

export function normalizeAd(raw: Raw, country?: string): NormalizedAd | null {
  const id = String(pick(raw, "adArchiveID", "adArchiveId", "ad_archive_id", "adid", "id") ?? "");
  if (!id) return null;
  const snap: Raw = pick(raw, "snapshot") ?? raw;
  const cards: Raw[] = pick(snap, "cards") ?? [];
  const media = mediaFrom(snap);

  const display = String(pick(snap, "displayFormat", "display_format") ?? "").toUpperCase();
  let format: NormalizedAd["format"];
  if (display === "CAROUSEL" || cards.length > 1) format = "carousel";
  else if (display === "VIDEO" || media.some((m) => m.type === "video")) format = "video";
  else format = "image";

  const rawBody = text(pick(snap, "body")) ?? text(cards[0]?.body) ?? null;
  const body = cleanTemplate(rawBody);
  const templated = [rawBody, text(pick(snap, "title")), ...cards.map((c) => text(c?.title) ?? text(c?.body))].some((t) => !!t && /\{\{\s*product\./i.test(t));
  const is_catalog = display === "DPA" || templated;
  const platforms = (pick(raw, "publisherPlatform", "publisher_platform", "publisherPlatforms") ?? []) as string[];

  return {
    platform: "meta",
    ad_archive_id: id,
    page_name: pick(raw, "pageName", "page_name") ?? pick(snap, "pageName", "page_name") ?? null,
    page_url: pick(snap, "pageProfileUri", "page_profile_uri") ?? null,
    body,
    title: cleanTemplate(text(pick(snap, "title")) ?? text(cards[0]?.title) ?? null),
    cta: pick(snap, "ctaText", "cta_text") ?? null,
    link_url: pick(snap, "linkUrl", "link_url") ?? cards[0]?.linkUrl ?? null,
    format,
    media,
    countries: country ? [country] : [],
    publisher_platforms: platforms.map((p) => String(p).toLowerCase()),
    start_date: toDate(pick(raw, "startDate", "start_date", "startDateFormatted")),
    end_date: toDate(pick(raw, "endDate", "end_date", "endDateFormatted")),
    is_active: pick(raw, "isActive", "is_active") ?? null,
    snapshot_url: `https://www.facebook.com/ads/library/?id=${id}`,
    variations: Number(pick(raw, "collationCount", "collation_count")) || null,
    is_catalog,
  };
}

export function libraryUrl(q: string, country: string, mediaType: string, status: "active" | "all" = "active"): string {
  const p = new URLSearchParams({
    active_status: status,
    ad_type: "all",
    country,
    q,
    search_type: "keyword_unordered",
    media_type: mediaType === "video" ? "video" : mediaType === "image" ? "image" : "all",
  });
  return `https://www.facebook.com/ads/library/?${p.toString()}`;
}

export function daysActive(ad: Pick<NormalizedAd, "start_date" | "end_date">, today = new Date()): number {
  if (!ad.start_date) return 0;
  const end = ad.end_date ? new Date(ad.end_date) : today;
  return Math.max(0, Math.round((end.getTime() - new Date(ad.start_date).getTime()) / 86400000));
}

/**
 * Puntaje 0-100 de "probable ganador" sin IA, con señales públicas de la Biblioteca:
 * - días activo (una marca no sostiene meses un anuncio que no vende)
 * - variaciones del mismo creativo (si lo duplican, lo están escalando)
 * - sigue activo, en varios países o varias plataformas
 * Si hay puntaje de la IA (1-10) se mezcla: 75% señales + 25% calidad creativa.
 */
export function winnerScore(
  ad: Pick<NormalizedAd, "start_date" | "end_date" | "is_active" | "variations" | "countries" | "publisher_platforms">,
  aiScore?: number | null,
  today = new Date(),
): number {
  const days = daysActive(ad, today);
  let s = (Math.min(days, 90) / 90) * 50;
  s += (Math.min(ad.variations ?? 1, 10) - 1) / 9 * 25;
  if (ad.is_active !== false) s += 10;
  if (ad.countries.length > 1) s += 5;
  if (ad.publisher_platforms.length > 1) s += 10;
  s = Math.min(100, s);
  if (aiScore != null) s = 0.75 * s + 2.5 * Math.max(1, Math.min(10, aiScore));
  return Math.round(s);
}

/**
 * Filtro de rubro sin IA: la Biblioteca de Meta busca las palabras sueltas y trae ruido
 * (apps, novelas, cursos). Nos quedamos con anuncios cuyo texto, título o marca contenga
 * alguna raíz de las palabras clave del cliente, o que sean de un competidor.
 */
const STOP = new Set(["de", "del", "la", "el", "los", "las", "para", "con", "y", "en", "hombre", "mujer", "por", "un", "una"]);
export function rubroRoots(terms: string[]): string[] {
  const roots = new Set<string>();
  for (const t of terms)
    for (const w of t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9ñ]+/))
      if (w.length >= 4 && !STOP.has(w)) roots.add(w.slice(0, Math.max(4, w.length - 2))); // "zapatos" → "zapat"
  return [...roots];
}
/**
 * Marketplaces y tiendas generalistas (Shein, Temu, etc.): no son marcas del rubro, no sirven de referencia.
 * Se compara contra el nombre de la página y el dominio del link.
 */
export const BLOCKED_ADVERTISERS = [
  "shein", "temu", "aliexpress", "alibaba", "amazon", "mercadolibre", "mercadolivre", "mercadoshops", "shopee", "wish",
  "walmart", "ebay", "dhgate", "joom", "banggood", "lightinthebox", "romwe", "zaful", "cider", "halara", "lazada",
  "tiktokshop", "falabella", "dafiti", "netshoes", "zalando", "linio", "ripley", "coppel", "liverpool", "fravega",
  "garbarino", "carrefour", "elcorteingles", "privalia", "aboutyou", "asos", "fashionnova", "patpat", "yesstyle",
];
const squash = (x: string) => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
export function isBlockedAdvertiser(ad: Pick<NormalizedAd, "page_name" | "link_url">, extra: string[] = []): boolean {
  const list = [...BLOCKED_ADVERTISERS, ...extra.map(squash)].filter(Boolean);
  const page = squash(ad.page_name ?? "");
  let host = "";
  try { host = ad.link_url ? new URL(ad.link_url).hostname.replace(/^www\./, "") : ""; } catch { /* link raro */ }
  const hostParts = host.split(".").map(squash);
  return list.some((b) => page === b || page.startsWith(b) || (b.length >= 5 && page.includes(b)) || hostParts.includes(b) || squash(host).startsWith(b));
}
export function matchesRubro(ad: Pick<NormalizedAd, "body" | "title" | "page_name" | "link_url">, roots: string[], competitors: string[] = []): boolean {
  const hay = [ad.body, ad.title, ad.page_name, ad.link_url]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  if (competitors.some((c) => c && hay.includes(c.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")))) return true;
  return roots.some((r) => hay.includes(r));
}

/**
 * Cantidad a pedirle a cada consulta (palabra × país) para llegar al total buscado sin forzar
 * un número fijo por país: se pide un poco de más y quedan los que traiga cada país.
 */
export function perQueryLimit(total: number, queries: number): number {
  return Math.max(10, Math.min(100, Math.ceil((total * 1.5) / Math.max(1, queries))));
}

/**
 * Arma las consultas (palabra × país) cuidando el costo: Apify cobra por anuncio traído.
 * - Se trae como mucho ~1,3 veces el total pedido (mínimo 30), no 10 por cada palabra × país.
 * - Primero las consultas de evento, después las palabras clave repartidas entre países.
 * - Las consultas que ya se hicieron en los últimos días van al final: traerían anuncios repetidos que se pagan y se tiran.
 */
export function planQueries(opts: { keywords: string[]; events: string[]; countries: string[]; total: number; recent?: Set<string> }) {
  const target = Math.max(30, Math.round(opts.total * 1.3));
  const maxQueries = Math.max(1, Math.floor(target / 10));
  const base = opts.keywords.length ? opts.keywords : [""];
  const pairs: { q: string; country: string }[] = [];
  for (const ev of opts.events) for (const country of opts.countries) pairs.push({ q: `${ev} ${base[0]}`.trim(), country });
  for (const q of base) for (const country of opts.countries) if (q) pairs.push({ q, country });
  const seen = new Set<string>();
  const unique = pairs.filter((p) => {
    const k = queryKey(p.q, p.country);
    return seen.has(k) ? false : (seen.add(k), true);
  });
  const recent = opts.recent ?? new Set<string>();
  const fresh = unique.filter((p) => !recent.has(queryKey(p.q, p.country)));
  const old = unique.filter((p) => recent.has(queryKey(p.q, p.country)));
  const queries = [...fresh, ...old].slice(0, maxQueries);
  const perQuery = Math.max(10, Math.min(100, Math.ceil(target / Math.max(1, queries.length))));
  return { queries, perQuery, planned: perQuery * queries.length, skipped: unique.length - queries.length };
}
export const queryKey = (q: string, country: string) => `${q.trim().toLowerCase()}|${country.toUpperCase()}`;
