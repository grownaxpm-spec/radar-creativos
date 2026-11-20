// Llama a un actor de Apify que lee la Biblioteca de Anuncios de Meta y devuelve los anuncios crudos.
// Todas las consultas (palabra clave × país) van en UNA sola corrida del actor: es mucho más rápido
// que correr una por una.

const API = "https://api.apify.com/v2";

export type RawItem = Record<string, any> & { __sourceUrl?: string | null };

/** Busca en el item de Apify cuál de las URLs de búsqueda lo trajo (cada actor lo nombra distinto). */
export function sourceUrlOf(item: Record<string, any>, startUrls: string[]): string | null {
  for (const k of ["inputUrl", "startUrl", "searchUrl", "originalUrl", "requestUrl", "url"]) {
    const v = item[k];
    const s = typeof v === "string" ? v : typeof v?.url === "string" ? v.url : null;
    if (s && startUrls.includes(s)) return s;
  }
  // Algunos actores devuelven la URL con los parámetros en otro orden
  for (const k of ["inputUrl", "startUrl", "searchUrl", "originalUrl", "requestUrl"]) {
    const v = item[k];
    const s = typeof v === "string" ? v : typeof v?.url === "string" ? v.url : null;
    if (!s) continue;
    try {
      const p = new URL(s).searchParams;
      const hit = startUrls.find((u) => {
        const q = new URL(u).searchParams;
        return q.get("q") === p.get("q") && q.get("country") === p.get("country");
      });
      if (hit) return hit;
    } catch {
      /* no es una URL */
    }
  }
  return null;
}

export async function runActorBatch(
  startUrls: string[],
  limitPerUrl: number,
  opts: { token: string; actor: string; timeoutSecs?: number; onStatus?: (msg: string) => void },
): Promise<RawItem[]> {
  const actor = opts.actor.replace("/", "~");
  const input = {
    // apify/facebook-ads-scraper
    startUrls: startUrls.map((url) => ({ url })),
    resultsLimit: limitPerUrl,
    // otros actores populares usan estos nombres:
    urls: startUrls.map((url) => ({ url })),
    count: limitPerUrl,
  };
  const start = await fetch(`${API}/acts/${actor}/runs?token=${opts.token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!start.ok) throw new Error(`Apify no arrancó (${start.status}): ${(await start.text()).slice(0, 300)}`);
  const run = (await start.json()).data;

  const deadline = Date.now() + (opts.timeoutSecs ?? 25 * 60) * 1000;
  let status = run.status as string;
  let lastCount = -1;
  while (!["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(status)) {
    if (Date.now() > deadline) {
      // Cortamos y nos quedamos con lo que ya juntó
      await fetch(`${API}/actor-runs/${run.id}/abort?token=${opts.token}`, { method: "POST" }).catch(() => {});
      status = "TIMED-OUT";
      break;
    }
    await new Promise((r) => setTimeout(r, 10000));
    const r = await fetch(`${API}/actor-runs/${run.id}?token=${opts.token}`);
    const d = (await r.json()).data;
    status = d.status;
    const ds = await fetch(`${API}/datasets/${run.defaultDatasetId}?token=${opts.token}`).then((x) => x.json()).catch(() => null);
    const count = ds?.data?.itemCount ?? 0;
    if (count !== lastCount) {
      lastCount = count;
      opts.onStatus?.(`Buscando en la Biblioteca de Meta… ${count} anuncios encontrados`);
    }
  }

  const items = await fetch(`${API}/datasets/${run.defaultDatasetId}/items?clean=true&format=json&token=${opts.token}`);
  if (!items.ok) throw new Error(`No pude leer resultados de Apify (${items.status})`);
  const data = (await items.json()) as Record<string, any>[];
  const list = Array.isArray(data) ? data : [];
  if (status !== "SUCCEEDED" && list.length === 0) throw new Error(`Apify terminó con estado ${status} y sin resultados`);
  return list.map((it) => ({ ...it, __sourceUrl: sourceUrlOf(it, startUrls) }));
}
