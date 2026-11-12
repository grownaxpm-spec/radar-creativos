// Llama a un actor de Apify que lee la Biblioteca de Anuncios de Meta y devuelve los anuncios crudos.

const API = "https://api.apify.com/v2";

export async function runActor(
  startUrl: string,
  limit: number,
  opts: { token: string; actor: string; timeoutSecs?: number },
): Promise<Record<string, any>[]> {
  const actor = opts.actor.replace("/", "~");
  const input = {
    // apify/facebook-ads-scraper
    startUrls: [{ url: startUrl }],
    resultsLimit: limit,
    // otros actores populares usan estos nombres:
    urls: [{ url: startUrl }],
    count: limit,
  };
  const start = await fetch(`${API}/acts/${actor}/runs?token=${opts.token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!start.ok) throw new Error(`Apify no arrancó (${start.status}): ${await start.text()}`);
  const run = (await start.json()).data;

  const deadline = Date.now() + (opts.timeoutSecs ?? 600) * 1000;
  let status = run.status as string;
  while (!["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(status)) {
    if (Date.now() > deadline) throw new Error("Apify tardó demasiado");
    await new Promise((r) => setTimeout(r, 5000));
    const r = await fetch(`${API}/actor-runs/${run.id}?token=${opts.token}`);
    status = (await r.json()).data.status;
  }
  if (status !== "SUCCEEDED") throw new Error(`Apify terminó con estado ${status}`);

  const items = await fetch(`${API}/datasets/${run.defaultDatasetId}/items?clean=true&format=json&token=${opts.token}`);
  if (!items.ok) throw new Error(`No pude leer resultados de Apify (${items.status})`);
  const data = await items.json();
  return Array.isArray(data) ? data : [];
}
