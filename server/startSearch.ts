// Lógica compartida de "Empezar búsqueda": verifica que quien llama es del equipo
// y dispara el workflow de GitHub que hace la búsqueda. La usan Vercel y Cloudflare.

export type StartEnv = {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  GITHUB_TOKEN?: string; // token fine-grained con permiso "Actions: read and write" sobre el repo
  GITHUB_REPO?: string; // "usuario/radar-creativos"
  GITHUB_REF?: string; // rama, por defecto main
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function startSearch(request: Request, env: StartEnv): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.GITHUB_TOKEN || !env.GITHUB_REPO)
    return json({ error: "Faltan variables de entorno en el servidor (SUPABASE_URL, SUPABASE_ANON_KEY, GITHUB_TOKEN, GITHUB_REPO)" }, 500);

  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Sin sesión" }, 401);

  const { search_id } = (await request.json().catch(() => ({}))) as { search_id?: string };
  if (!search_id || !/^[0-9a-f-]{36}$/i.test(search_id)) return json({ error: "search_id inválido" }, 400);

  // Leer la búsqueda con el token del usuario: si no es del equipo, RLS no devuelve nada.
  const check = await fetch(`${env.SUPABASE_URL}/rest/v1/searches?id=eq.${search_id}&select=id`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, authorization: auth },
  });
  const rows = check.ok ? ((await check.json()) as unknown[]) : [];
  if (rows.length !== 1) return json({ error: "No autorizado" }, 403);

  const gh = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/scrape.yml/dispatches`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "user-agent": "radar-creativos",
      "content-type": "application/json",
    },
    body: JSON.stringify({ ref: env.GITHUB_REF || "main", inputs: { search_id } }),
  });
  if (!gh.ok) return json({ error: `GitHub respondió ${gh.status}: ${await gh.text()}` }, 502);
  return json({ ok: true });
}
