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

  const body = cleanTemplate(text(pick(snap, "body")) ?? text(cards[0]?.body) ?? null);
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
