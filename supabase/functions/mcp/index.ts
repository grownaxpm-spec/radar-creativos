// Conector MCP de "Pedido de Creativos" para Claude (claude.ai → Conectores → Agregar conector personalizado).
// URL: https://<proyecto>.supabase.co/functions/v1/mcp/<token>   (el token está en la tabla app_secrets)
// Protocolo: MCP "streamable HTTP" en modo JSON (POST con JSON-RPC 2.0, respuesta JSON).
import { createClient } from "@supabase/supabase-js";
import { draftPedido } from "./pedido.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const PEDIDO_MODEL = Deno.env.get("CLAUDE_PEDIDO_MODEL") || "claude-opus-5-5";
const APP_URL = Deno.env.get("APP_URL") || "https://radar-creativos.vercel.app";
const WORKER_URL = `${SUPABASE_URL}/functions/v1/search-worker`;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ---------- Herramientas ----------
type Tool = { name: string; description: string; inputSchema: Record<string, unknown>; run: (a: any) => Promise<unknown> };
const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });
const bool = (description: string) => ({ type: "boolean", description });
const arr = (description: string) => ({ type: "array", items: { type: "string" }, description });

async function findClient(name?: string) {
  if (!name) return null;
  const { data } = await db.from("clients").select("*").ilike("name", `%${name}%`).limit(1).maybeSingle();
  if (!data) throw new Error(`No encontré el cliente "${name}". Usá listar_clientes para ver los nombres.`);
  return data;
}

const adSummary = (a: any) => ({
  id: a.id,
  marca: a.page_name,
  fuente: a.source,
  formato: a.format,
  puntaje: a.score,
  dias_activo: a.days_active,
  variaciones: a.variations,
  angulo: a.angle,
  tipo_hook: a.hook_type,
  hook: a.hook,
  por_que_funciona: a.why_it_works,
  como_adaptarlo: a.adaptation,
  texto: a.body?.slice(0, 400),
  video: a.media?.find((m: any) => m.type === "video")?.url ?? null,
  imagen: a.media?.find((m: any) => m.type === "image")?.url ?? a.media?.[0]?.thumb ?? null,
  ficha_meta: a.snapshot_url,
  metricas: a.metrics ?? undefined,
});

async function copyMedia(url: string, key: string): Promise<string> {
  try {
    const res = await fetch(url);
    if (!res.ok) return url;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > 20 * 1024 * 1024) return url;
    const { error } = await db.storage.from("media").upload(key, bytes, { contentType: res.headers.get("content-type") ?? undefined, upsert: true });
    return error ? url : `${SUPABASE_URL}/storage/v1/object/public/media/${key}`;
  } catch {
    return url;
  }
}

async function generatePedido(pedidoId: string) {
  const setP = (patch: Record<string, unknown>) => db.from("pedidos").update(patch).eq("id", pedidoId);
  try {
    if (!ANTHROPIC_KEY) throw new Error("Falta el secreto ANTHROPIC_API_KEY en Supabase.");
    const { data: p } = await db.from("pedidos").select("*").eq("id", pedidoId).single();
    const { data: client } = p.client_id ? await db.from("clients").select("*").eq("id", p.client_id).maybeSingle() : { data: null };
    const { data: items } = await db.from("pedido_items").select("id, position, format, angle, ad_id").eq("pedido_id", pedidoId).order("position");
    const adIds = (items ?? []).map((i) => i.ad_id).filter(Boolean);
    const { data: ads } = adIds.length
      ? await db.from("ads_view").select("id, page_name, format, body, hook, why_it_works, adaptation, days_active").in("id", adIds)
      : { data: [] };
    const byId = new Map((ads ?? []).map((a: any) => [a.id, a]));
    const draft = await draftPedido({
      apiKey: ANTHROPIC_KEY,
      model: PEDIDO_MODEL,
      client,
      pedido: p,
      items: (items ?? []).map((i) => ({ position: i.position, format: i.format, angle: i.angle, ref: i.ad_id ? (byId.get(i.ad_id) ?? null) : null })),
    });
    const n = (v: string) => (v && v.trim() ? v.trim() : null);
    for (const it of items ?? []) {
      const d = draft.pieces.find((x) => x.position === it.position);
      if (!d) continue;
      await db.from("pedido_items").update({
        code: n(d.code), title: n(d.title), piece_name: n(d.title), group_name: n(d.group_name), angle: n(d.angle), funnel: d.funnel,
        creative_type: n(d.creative_type), format: n(d.format), ref_beats: n(d.ref_beats), hook: n(d.hook), development: n(d.development),
        closing: n(d.closing), scene: n(d.scene), headline: n(d.headline), subhead: n(d.subhead), recording_tips: n(d.recording_tips),
        duration: n(d.duration), adaptations: n(d.adaptations),
      }).eq("id", it.id);
    }
    await setP({
      intro: n(draft.intro), refs_note: n(draft.refs_note), hooks: draft.hooks, specs: draft.specs.filter((x) => x.items.length),
      before_notes: draft.before_notes, ai_status: "done", ai_error: null,
    });
  } catch (err) {
    console.error("generatePedido", err);
    await setP({ ai_status: "error", ai_error: (err as Error).message });
  }
}

const TOOLS: Tool[] = [
  {
    name: "listar_clientes",
    description: "Lista los clientes de la agencia cargados en Pedido de Creativos, con su rubro y competidores.",
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      const { data } = await db.from("clients").select("id, name, rubro, competitors, keywords, website, instagram").order("name");
      return data;
    },
  },
  {
    name: "ver_cliente",
    description: "Perfil completo de un cliente: propuesta de valor, público, mensajes guía, tono, qué no comunicar, competidores, palabras clave y notas.",
    inputSchema: { type: "object", properties: { cliente: str("Nombre del cliente (alcanza con una parte)") }, required: ["cliente"] },
    run: async (a) => findClient(a.cliente),
  },
  {
    name: "buscar_en_biblioteca",
    description:
      "Busca anuncios en la biblioteca (competencia y anuncios propios), ordenados por puntaje de probable ganador. Cada anuncio trae hook, por qué funciona, cómo adaptarlo y links al video o la imagen. Usalo para elegir referencias antes de crear un pedido.",
    inputSchema: {
      type: "object",
      properties: {
        cliente: str("Cliente para el que se trabaja: excluye los anuncios que ese cliente descartó"),
        angulo: str("Ángulo publicitario, ej. 'Calidad / materiales', 'Precio / promo', 'Comodidad / calce'"),
        tipo_hook: str("Tipo de hook, ej. 'Pregunta', 'Demostración de producto', 'Testimonio / UGC'"),
        formato: { type: "string", enum: ["video", "image", "carousel"], description: "Formato" },
        texto: str("Buscar en marca, texto o hook"),
        solo_hooks: bool("Solo videos que tienen hook analizado"),
        fuente: { type: "string", enum: ["competencia", "propio"], description: "Solo competencia o solo anuncios propios del cliente" },
        limite: num("Cantidad máxima (por defecto 20)"),
      },
    },
    run: async (a) => {
      const client = await findClient(a.cliente);
      let q = db.from("ads_view").select("*").or("relevant.is.null,relevant.eq.true");
      if (a.angulo) q = q.ilike("angle", `%${a.angulo}%`);
      if (a.tipo_hook) q = q.ilike("hook_type", `%${a.tipo_hook}%`);
      if (a.solo_hooks) q = q.eq("format", "video").not("hook", "is", null);
      else if (a.formato) q = q.eq("format", a.formato);
      if (a.fuente) q = q.eq("source", a.fuente);
      if (a.fuente === "propio" && client) q = q.eq("owner_client_id", client.id);
      if (a.texto) q = q.or(`body.ilike.%${a.texto}%,page_name.ilike.%${a.texto}%,hook.ilike.%${a.texto}%`);
      const { data } = await q.order("score", { ascending: false, nullsFirst: false }).limit(Math.min(Number(a.limite) || 20, 60));
      let rows = data ?? [];
      if (client) {
        const { data: d } = await db.from("discards").select("ad_id").or(`client_id.is.null,client_id.eq.${client.id}`);
        const out = new Set((d ?? []).map((x) => x.ad_id));
        rows = rows.filter((r: any) => !out.has(r.id));
      }
      return { total: rows.length, anuncios: rows.map(adSummary), ver_en_la_app: `${APP_URL}/biblioteca` };
    },
  },
  {
    name: "empezar_busqueda",
    description:
      "Empieza una búsqueda nueva de anuncios de la competencia en la Biblioteca de Meta para un cliente. Usa sus palabras clave y competidores si no se pasan otras. Tarda unos minutos; consultá el avance con estado_busquedas.",
    inputSchema: {
      type: "object",
      properties: {
        cliente: str("Nombre del cliente"),
        palabras_clave: arr("Palabras clave o marcas a buscar (opcional)"),
        paises: arr("Códigos de país, ej. AR, UY, CL, MX, ES (por defecto AR)"),
        anuncios_por_palabra: num("Anuncios por palabra y país (por defecto 15)"),
        semanal: bool("Repetir cada semana"),
      },
      required: ["cliente"],
    },
    run: async (a) => {
      const client = await findClient(a.cliente);
      const keywords = a.palabras_clave?.length ? a.palabras_clave : [...(client.keywords ?? []), ...(client.competitors ?? [])];
      const { data: s, error } = await db
        .from("searches")
        .insert({
          client_id: client.id,
          rubro: client.rubro ?? client.name,
          keywords: keywords.length ? keywords : [client.rubro ?? client.name],
          countries: a.paises?.length ? a.paises.map((x: string) => x.toUpperCase()) : ["AR"],
          max_per_query: Math.min(Number(a.anuncios_por_palabra) || 15, 100),
          recurring: !!a.semanal,
          created_by: "claude (conector)",
        })
        .select()
        .single();
      if (error) throw error;
      // El robot toma las pendientes; lo empujamos para que arranque ya
      fetch(WORKER_URL, { method: "POST", headers: { "content-type": "application/json" }, body: '{"action":"tick"}' }).catch(() => {});
      return { busqueda_id: s.id, estado: "en marcha", palabras_clave: s.keywords, paises: s.countries, ver_avance: `${APP_URL}/busquedas` };
    },
  },
  {
    name: "estado_busquedas",
    description: "Muestra las últimas búsquedas con su estado y porcentaje de avance.",
    inputSchema: { type: "object", properties: { limite: num("Cantidad (por defecto 5)") } },
    run: async (a) => {
      const { data } = await db
        .from("searches")
        .select("id, status, progress, progress_pct, total_found, error, countries, created_at, clients(name)")
        .order("created_at", { ascending: false })
        .limit(Math.min(Number(a.limite) || 5, 20));
      return data;
    },
  },
  {
    name: "agregar_anuncio_propio",
    description:
      "Suma a la biblioteca un anuncio de la cuenta publicitaria del propio cliente (por ejemplo, un ganador sacado con el conector de Meta Ads), con su video o imagen y sus métricas, para usarlo de referencia en un pedido. Guarda una copia del video para que no venza.",
    inputSchema: {
      type: "object",
      properties: {
        cliente: str("Nombre del cliente dueño del anuncio"),
        meta_ad_id: str("ID del anuncio en Meta"),
        nombre: str("Nombre del anuncio"),
        formato: { type: "string", enum: ["video", "image", "carousel"] },
        video_url: str("URL del video (fuente del creativo)"),
        imagen_url: str("URL de la imagen o miniatura"),
        texto: str("Texto principal del anuncio"),
        hook: str("Hook o primera línea, si ya lo sabés"),
        por_que_funciona: str("Por qué funciona según las métricas"),
        metricas: { type: "object", description: "Métricas del anuncio: gasto, roas, ctr, compras, cpa, hook_rate, periodo…" },
        fecha_inicio: str("Fecha de inicio YYYY-MM-DD"),
      },
      required: ["cliente", "meta_ad_id", "formato"],
    },
    run: async (a) => {
      const client = await findClient(a.cliente);
      const media: any[] = [];
      const thumb = a.imagen_url ? await copyMedia(a.imagen_url, `propio/${a.meta_ad_id}/thumb.jpg`) : null;
      if (a.video_url) media.push({ type: "video", url: await copyMedia(a.video_url, `propio/${a.meta_ad_id}/0.mp4`), thumb });
      else if (thumb) media.push({ type: "image", url: thumb });
      const m = a.metricas ?? {};
      const roas = Number(m.roas) || 0;
      const { data, error } = await db
        .from("ads")
        .upsert(
          {
            platform: "meta_propio",
            ad_archive_id: String(a.meta_ad_id),
            source: "propio",
            owner_client_id: client.id,
            page_name: `${client.name} (propio)${a.nombre ? ` · ${a.nombre}` : ""}`,
            body: a.texto ?? null,
            format: a.formato,
            media,
            hook: a.hook ?? null,
            why_it_works: a.por_que_funciona ?? null,
            metrics: a.metricas ?? null,
            start_date: a.fecha_inicio ?? null,
            relevant: true,
            angle: null,
            score: roas ? Math.min(100, Math.round(40 + roas * 10)) : 60,
            snapshot_url: `https://www.facebook.com/ads/library/?id=${a.meta_ad_id}`,
          },
          { onConflict: "platform,ad_archive_id" },
        )
        .select("id")
        .single();
      if (error) throw error;
      return { anuncio_id: data.id, guardado: true, video_guardado: media[0]?.url?.includes("/storage/") ?? false };
    },
  },
  {
    name: "crear_pedido",
    description:
      "Crea un pedido de creativos con las referencias elegidas (ids de buscar_en_biblioteca o agregar_anuncio_propio). La IA escribe guiones, cómo grabar, hooks sugeridos y cómo se entrega según el nivel de detalle. Devuelve el link para el cliente (página con los videos reproducibles) y el link para editarlo.",
    inputSchema: {
      type: "object",
      properties: {
        cliente: str("Nombre del cliente"),
        anuncio_ids: arr("IDs de los anuncios de referencia, en el orden de las piezas"),
        tipo: { type: "string", enum: ["aon", "evento"], description: "Always On o evento" },
        evento: str("Nombre del evento (Black Friday, Cyber Monday, Hot Sale…)"),
        fecha_evento: str("YYYY-MM-DD"),
        mes: str("Para Always On, ej. 'Diciembre 2026'"),
        nivel_detalle: { type: "string", enum: ["guion", "grabacion", "completo"], description: "guion = solo guion + referencia; grabacion = + cómo grabarlo; completo = estructura madre" },
        plataforma: { type: "string", enum: ["Meta", "TikTok", "Google"] },
        objetivo: str("Objetivo o foco (productos, público)"),
        notas: str("Precios, promos, restricciones"),
        piezas: num("Cantidad de piezas (por defecto, una por referencia)"),
        entrega: str("Fecha de entrega YYYY-MM-DD"),
        generar_con_ia: bool("Que la IA escriba el pedido (por defecto sí)"),
      },
      required: ["cliente", "anuncio_ids"],
    },
    run: async (a) => {
      const client = await findClient(a.cliente);
      const kind = a.tipo === "evento" ? "evento" : "aon";
      const now = new Date();
      const period = a.mes ?? now.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
      const title = `${client.name} Pedido de creativos - Campaña - ${kind === "evento" ? a.evento ?? "Evento" : `AON - ${period}`}`;
      const { data: p, error } = await db
        .from("pedidos")
        .insert({
          title, client_id: client.id, kind, event_name: kind === "evento" ? a.evento ?? null : null, event_date: a.fecha_evento ?? null,
          period: kind === "aon" ? period : null, detail_level: a.nivel_detalle ?? "completo", platform: a.plataforma ?? "Meta",
          objective: a.objetivo ?? null, notes: a.notas ?? null, deadline: a.entrega ?? null, created_by: "claude (conector)",
        })
        .select()
        .single();
      if (error) throw error;
      const ids: string[] = a.anuncio_ids ?? [];
      const { data: refAds } = ids.length ? await db.from("ads").select("id, format, angle").in("id", ids) : { data: [] };
      const byId = new Map((refAds ?? []).map((x: any) => [x.id, x]));
      const count = Math.max(Number(a.piezas) || ids.length, 1);
      await db.from("pedido_items").insert(
        Array.from({ length: count }, (_, i) => {
          const r = ids[i] ? byId.get(ids[i]) : undefined;
          return {
            pedido_id: p.id, ad_id: r ? ids[i] : null, position: i + 1, code: `${r?.format === "video" || !r ? "V" : "IMG"}${i + 1}`,
            piece_name: `Pieza ${i + 1}`, format: r?.format === "video" ? "Reel 9:16" : r ? "Feed 4:5" : null, angle: r?.angle ?? null,
          };
        }),
      );
      const ai = a.generar_con_ia !== false;
      if (ai) {
        await db.from("pedidos").update({ ai_status: "generating" }).eq("id", p.id);
        const rt = (globalThis as any).EdgeRuntime;
        if (rt?.waitUntil) rt.waitUntil(generatePedido(p.id));
        else await generatePedido(p.id);
      }
      return {
        pedido_id: p.id,
        titulo: title,
        link_cliente: `${APP_URL}/p/${p.slug}`,
        editar: `${APP_URL}/pedidos/${p.id}`,
        estado: ai ? "La IA lo está escribiendo (1-2 minutos). Consultá ver_pedido para ver el resultado." : "Creado sin IA.",
      };
    },
  },
  {
    name: "ver_pedido",
    description: "Muestra un pedido de creativos completo (piezas, guiones, hooks sugeridos, referencias) y su estado de generación.",
    inputSchema: { type: "object", properties: { pedido_id: str("ID del pedido"), slug: str("O el código del link del cliente (/p/xxxx)") } },
    run: async (a) => {
      let q = db.from("pedidos").select("id, slug, ai_status, ai_error");
      q = a.pedido_id ? q.eq("id", a.pedido_id) : q.eq("slug", a.slug);
      const { data: p } = await q.maybeSingle();
      if (!p) throw new Error("No encontré el pedido");
      const { data } = await db.rpc("get_pedido", { p_slug: p.slug });
      return { estado_ia: p.ai_status, error_ia: p.ai_error, link_cliente: `${APP_URL}/p/${p.slug}`, editar: `${APP_URL}/pedidos/${p.id}`, pedido: data };
    },
  },
  {
    name: "listar_pedidos",
    description: "Lista los últimos pedidos de creativos con sus links.",
    inputSchema: { type: "object", properties: { cliente: str("Filtrar por cliente"), limite: num("Cantidad (por defecto 10)") } },
    run: async (a) => {
      const client = await findClient(a.cliente);
      let q = db.from("pedidos").select("id, slug, title, kind, event_name, period, detail_level, ai_status, created_at").order("created_at", { ascending: false });
      if (client) q = q.eq("client_id", client.id);
      const { data } = await q.limit(Math.min(Number(a.limite) || 10, 50));
      return (data ?? []).map((p) => ({ ...p, link_cliente: `${APP_URL}/p/${p.slug}`, editar: `${APP_URL}/pedidos/${p.id}` }));
    },
  },
  {
    name: "compartir_referencias",
    description: "Arma un link para compartir solo referencias (sin pedido), con los videos reproducibles y el análisis de cada una.",
    inputSchema: {
      type: "object",
      properties: { cliente: str("Cliente"), anuncio_ids: arr("IDs de los anuncios"), titulo: str("Título"), nota: str("Nota para el cliente") },
      required: ["anuncio_ids"],
    },
    run: async (a) => {
      const client = await findClient(a.cliente);
      const { data, error } = await db
        .from("reference_sets")
        .insert({ title: a.titulo ?? `Referencias${client ? ` para ${client.name}` : ""}`, note: a.nota ?? null, client_id: client?.id ?? null, ad_ids: a.anuncio_ids, created_by: "claude (conector)" })
        .select("slug")
        .single();
      if (error) throw error;
      return { link: `${APP_URL}/r/${data.slug}` };
    },
  },
  {
    name: "descartar_anuncio",
    description: "Descarta un anuncio para un cliente (deja de aparecer en su biblioteca). Sin cliente, lo descarta para todos.",
    inputSchema: { type: "object", properties: { anuncio_id: str("ID del anuncio"), cliente: str("Cliente") }, required: ["anuncio_id"] },
    run: async (a) => {
      const client = await findClient(a.cliente);
      await db.from("discards").upsert({ ad_id: a.anuncio_id, client_id: client?.id ?? null, created_by: "claude (conector)" }, { onConflict: "ad_id,client_id" });
      return { descartado: true };
    },
  },
];

// ---------- Protocolo MCP (JSON-RPC) ----------
const SERVER_INFO = { name: "pedido-de-creativos", title: "Pedido de Creativos (Grownax)", version: "1.0.0" };
const INSTRUCTIONS =
  "Herramienta de la agencia para encontrar referencias de anuncios de la competencia y armar pedidos de creativos. " +
  "Flujo típico: listar_clientes → buscar_en_biblioteca (o empezar_busqueda si faltan referencias) → crear_pedido con los ids elegidos → ver_pedido. " +
  "Para pedidos basados en los anuncios ganadores del cliente: traé sus mejores anuncios con el conector de Meta Ads, sumalos con agregar_anuncio_propio y usalos en crear_pedido. " +
  "Siempre devolvé al usuario el link_cliente del pedido.";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, mcp-session-id, mcp-protocol-version",
  "access-control-allow-methods": "POST, GET, OPTIONS, DELETE",
  "access-control-expose-headers": "mcp-session-id",
};
const rpcResult = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

let cachedToken: string | null = null;
async function validToken(t: string | undefined) {
  if (!t) return false;
  if (!cachedToken) {
    const { data } = await db.from("app_secrets").select("value").eq("name", "mcp_token").maybeSingle();
    cachedToken = data?.value ?? null;
  }
  return !!cachedToken && t === cachedToken;
}

async function handle(msg: any) {
  const { id, method, params } = msg ?? {};
  if (id === undefined || id === null) return null; // notificación: no lleva respuesta
  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return rpcError(id, -32602, `Herramienta desconocida: ${params?.name}`);
      try {
        const out = await tool.run(params?.arguments ?? {});
        return rpcResult(id, { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] });
      } catch (err) {
        return rpcResult(id, { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true });
      }
    }
    default:
      return rpcError(id, -32601, `Método no soportado: ${method}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const token = new URL(req.url).pathname.split("/").filter(Boolean).pop();
  if (!(await validToken(token))) return new Response("Not found", { status: 404, headers: cors });
  if (req.method === "GET") return new Response("Method Not Allowed", { status: 405, headers: cors });
  if (req.method === "DELETE") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: cors });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json(rpcError(null, -32700, "JSON inválido"), { status: 400, headers: cors });
  }
  const messages = Array.isArray(body) ? body : [body];
  const responses = (await Promise.all(messages.map(handle))).filter(Boolean);
  if (responses.length === 0) return new Response(null, { status: 202, headers: cors });
  return Response.json(Array.isArray(body) ? responses : responses[0], { headers: { ...cors, "content-type": "application/json" } });
});
