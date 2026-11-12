// Copia videos e imágenes a Cloudflare R2 (los links de Meta vencen a los pocos días).
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import type { MediaItem } from "./normalize.ts";

const MAX_BYTES = 60 * 1024 * 1024; // no guardamos videos de más de 60 MB

export type R2Config = { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string; publicUrl: string };

export function r2FromEnv(): R2Config | null {
  const e = process.env;
  if (!e.R2_ACCOUNT_ID || !e.R2_ACCESS_KEY_ID || !e.R2_SECRET_ACCESS_KEY || !e.R2_BUCKET || !e.R2_PUBLIC_URL) return null;
  return {
    accountId: e.R2_ACCOUNT_ID,
    accessKeyId: e.R2_ACCESS_KEY_ID,
    secretAccessKey: e.R2_SECRET_ACCESS_KEY,
    bucket: e.R2_BUCKET,
    publicUrl: e.R2_PUBLIC_URL.replace(/\/$/, ""),
  };
}

type Store = (adId: string, media: MediaItem[]) => Promise<MediaItem[]>;
type Putter = (key: string, body: Buffer, contentType: string | undefined) => Promise<string>;

/** Arma el guardado de medios: R2 si está configurado; si no, Supabase Storage (bucket público "media"). */
export function makeMediaStore(supabase?: { storage: any; url?: string }): Store | null {
  const r2 = r2FromEnv();
  if (r2) return makeStore(r2);
  if (supabase && process.env.SUPABASE_URL && process.env.MEDIA_STORAGE !== "none") {
    const base = process.env.SUPABASE_URL.replace(/\/$/, "");
    const put: Putter = async (key, body, contentType) => {
      const { error } = await supabase.storage.from("media").upload(key, body, { contentType, upsert: true, cacheControl: "31536000" });
      if (error) throw error;
      return `${base}/storage/v1/object/public/media/${key}`;
    };
    return withPutter(put, async () => false, 45 * 1024 * 1024);
  }
  return null;
}

export function makeStore(cfg: R2Config): Store {
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  const exists = async (key: string) => {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
      return `${cfg.publicUrl}/${key}`;
    } catch {
      return false;
    }
  };
  const put: Putter = async (key, body, contentType) => {
    await s3.send(
      new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType, CacheControl: "public, max-age=31536000, immutable" }),
    );
    return `${cfg.publicUrl}/${key}`;
  };
  return withPutter(put, exists, MAX_BYTES);
}

function withPutter(put: Putter, exists: (key: string) => Promise<string | false>, maxBytes: number): Store {
  async function copy(url: string, key: string): Promise<string | null> {
    const already = await exists(key);
    if (already) return already;
    const res = await fetch(url);
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > maxBytes) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) return null;
    return put(key, buf, res.headers.get("content-type") ?? undefined);
  }

  /** Devuelve la lista de medios con URLs propias (las que fallan quedan con la URL original). */
  return async function storeMedia(adId: string, media: MediaItem[]): Promise<MediaItem[]> {
    const out: MediaItem[] = [];
    for (const [i, m] of media.slice(0, 6).entries()) {
      const ext = m.type === "video" ? "mp4" : "jpg";
      const url = (await copy(m.url, `meta/${adId}/${i}.${ext}`).catch(() => null)) ?? m.url;
      const thumb = m.thumb ? ((await copy(m.thumb, `meta/${adId}/${i}-thumb.jpg`).catch(() => null)) ?? m.thumb) : null;
      out.push({ ...m, url, thumb });
    }
    return out;
  };
}
