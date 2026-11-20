// Copia a Supabase Storage los videos e imágenes de un anuncio y reemplaza sus medios.
// Acepta links directos o el link de vista previa de Meta (preview_iframe.php): de ahí saca el mp4.
// Meta no responde la vista previa al fetch de las funciones, así que se pide por la base (pg_net).
// Protegido con el token del conector (app_secrets.mcp_token).
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const MAX = 60 * 1024 * 1024;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const unesc = (s: string) =>
  s.replace(/\\\//g, "/").replace(/\\u0025/g, "%").replace(/\\u0026/g, "&").replace(/&amp;/g, "&").replace(/\\/g, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function previewHtml(url: string): Promise<string> {
  const { data: id, error } = await db.rpc("preview_fetch", { p_url: url.replace(/&amp;/g, "&") });
  if (error || !id) return "";
  for (let i = 0; i < 60; i++) {
    await sleep(1500);
    const { data } = await db.rpc("preview_result", { p_id: id });
    if (data) return (data as { content: string | null }).content ?? "";
  }
  return "";
}

async function fromPreview(previewUrl: string) {
  const html = await previewHtml(previewUrl);
  const vids = [...html.matchAll(/https:\\?\/\\?\/video[^"'\s<>]+?\.mp4[^"'\s<>]*/g)].map((m) => unesc(m[0]));
  // Las pistas "dash" vienen sin audio: se prefiere el mp4 progresivo (sve_hd, después sve_sd).
  const rank = (v: string) => (/tag=sve_hd/.test(v) ? 3 : /tag=sve_sd/.test(v) ? 2 : /dash/i.test(v) ? 0 : 1);
  const video = [...vids].sort((x, y) => rank(y) - rank(x))[0] ?? null;
  const pm = html.match(/https:\\?\/\\?\/scontent[^"'\s<>]+?\.(?:jpg|png)[^"'\s<>]*/);
  return { video, poster: pm ? unesc(pm[0]) : null, debug: { len: html.length, mp4: (html.match(/\.mp4/g) ?? []).length } };
}

async function copy(url: string, key: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA } });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length < 1000 || bytes.length > MAX) return null;
    const { error } = await db.storage.from("media").upload(key, bytes, { contentType: res.headers.get("content-type") ?? undefined, upsert: true, cacheControl: "31536000" });
    return error ? null : `${SUPABASE_URL}/storage/v1/object/public/media/${key}`;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  const { data: sec } = await db.from("app_secrets").select("value").eq("name", "mcp_token").maybeSingle();
  if (!sec || body.token !== sec.value) return new Response("Not found", { status: 404 });
  const { data: ad } = await db.from("ads").select("id, ad_archive_id").eq("id", body.ad_id).maybeSingle();
  if (!ad) return Response.json({ error: "No existe el anuncio" }, { status: 404 });
  const out: { type: string; url: string; thumb: string | null }[] = [];
  const failed: unknown[] = [];
  for (const [i, raw] of (body.items ?? []).entries()) {
    let it = raw;
    if (raw.type === "preview") {
      const p = await fromPreview(raw.url);
      if (!p.video) {
        failed.push({ motivo: "vista previa sin video", ...p.debug });
        continue;
      }
      it = { type: "video", url: p.video, thumb: raw.thumb ?? p.poster };
    }
    const ext = it.type === "video" ? "mp4" : "jpg";
    const stamp = Date.now();
    const url = await copy(it.url, `propio/${ad.ad_archive_id}/${stamp}-${i}.${ext}`);
    if (!url) {
      failed.push({ motivo: "no se pudo copiar", url: it.url.slice(0, 80) });
      continue;
    }
    const thumb = it.thumb ? await copy(it.thumb, `propio/${ad.ad_archive_id}/${stamp}-${i}-thumb.jpg`) : null;
    out.push({ type: it.type, url, thumb });
  }
  if (out.length) {
    const patch: Record<string, unknown> = { media: out };
    if (body.format) patch.format = body.format;
    if (out.some((m) => m.type === "video")) Object.assign(patch, { video_status: null, video_error: null, video_analysis: null });
    await db.from("ads").update(patch).eq("id", ad.id);
  }
  return Response.json({ ok: out.length > 0, guardados: out.length, fallaron: failed });
});
