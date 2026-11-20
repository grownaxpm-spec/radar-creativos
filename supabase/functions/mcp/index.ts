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
  venta_directa: a.direct_sale ?? undefined,
  activo: a.is_active ?? undefined,
  // Lo que la IA vio en el video completo (imagen + audio), si ya se analizó
  video_analizado: a.video_analysis
    ? {
        duracion_seg: a.video_analysis.duracion_seg,
        primeros_3_seg: a.video_analysis.hook_visual,
        primera_frase: a.video_analysis.hook_audio,
        escenas: a.video_analysis.escenas,
        transcripcion: a.video_analysis.transcripcion?.slice(0, 1200),
        textos_en_pantalla: a.video_analysis.texto_en_pantalla,
        como_replicarlo: a.video_analysis.como_replicarlo,
      }
    : undefined,
});

async function findGroup(name: string, clientId?: string) {
  let q = db.from("ad_groups").select("*").ilike("name", `%${name}%`).order("updated_at", { ascending: false }).limit(1);
  if (clientId) q = q.eq("client_id", clientId);
  const { data } = await q.maybeSingle();
  if (!data) throw new Error(`No encontré el grupo "${name}". Usá listar_grupos para ver los nombres.`);
  return data as { id: string; name: string; client_id: string | null; ad_ids: string[]; hook_ids: string[] };
}

async function findPedido(idOrSlug: string) {
  const isId = /^[0-9a-f-]{36}$/i.test(idOrSlug);
  const slug = idOrSlug.split("/p/").pop()!.trim();
  const { data } = await (isId ? db.from("pedidos").select("*").eq("id", idOrSlug) : db.from("pedidos").select("*").eq("slug", slug)).maybeSingle();
  if (!data) throw new Error("No encontré el pedido. Usá listar_pedidos para ver los ids.");
  return data;
}

const now = () => new Date().toISOString();
const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const clientFields = (a: any) =>
  clean({
    name: a.nombre, rubro: a.rubro, usp: a.usp, target: a.publico, messages: a.mensajes, tone: a.tono, avoid: a.no_comunicar,
    competitors: a.competidores, keywords: a.palabras_clave, website: a.web, instagram: a.instagram, logo_url: a.logo_url,
    drive_folder_url: a.drive, creativos_folder_url: a.carpeta_creativos, notes: a.notas,
  });
const kick = () => fetch(WORKER_URL, { method: "POST", headers: { "content-type": "application/json" }, body: '{"action":"tick"}' }).catch(() => {});
const EVENTS = ["Black Friday", "Cyber Monday", "Hot Sale", "Navidad", "Día del Padre", "Día de la Madre", "Día del Niño", "San Valentín", "Rebajas / liquidación"];

// Saca el mp4 (y una portada) de la vista previa de Meta (preview_iframe.php).
// La de "Feed de Facebook" (MOBILE_FEED_STANDARD) trae el video incrustado; la de Reels a veces no.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const unesc = (x: string) => x.replace(/\\\//g, "/").replace(/\\u0025/g, "%").replace(/\\u0026/g, "&").replace(/&amp;/g, "&").replace(/\\/g, "");
async function fromPreview(previewUrl: string): Promise<{ video: string | null; poster: string | null }> {
  // Meta rechaza el fetch de las funciones; la vista previa se pide desde la base (pg_net).
  try {
    const { data: id } = await db.rpc("preview_fetch", { p_url: previewUrl.replace(/&amp;/g, "&") });
    if (!id) return { video: null, poster: null };
    let html = "";
    for (let i = 0; i < 60 && !html; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const { data } = await db.rpc("preview_result", { p_id: id });
      if (data) html = (data as { content: string | null }).content ?? " ";
    }
    const vids = [...html.matchAll(/https:\\?\/\\?\/video[^"'\s<>]+?\.mp4[^"'\s<>]*/g)].map((m) => unesc(m[0]));
    // Las pistas "dash" vienen sin audio: se prefiere el mp4 progresivo (sve_hd, después sve_sd).
    const rank = (v: string) => (/tag=sve_hd/.test(v) ? 3 : /tag=sve_sd/.test(v) ? 2 : /dash/i.test(v) ? 0 : 1);
    const video = [...vids].sort((x, y) => rank(y) - rank(x))[0] ?? null;
    const pm = html.match(/https:\\?\/\\?\/scontent[^"'\s<>]+?\.(?:jpg|png)[^"'\s<>]*/);
    return { video, poster: pm ? unesc(pm[0]) : null };
  } catch {
    return { video: null, poster: null };
  }
}

// Guarda video o imagen (link directo o vista previa de Meta) y devuelve los medios listos para la biblioteca
async function resolveMedia(key: string, a: { video_url?: string; imagen_url?: string; vista_previa_url?: string; formato?: string }) {
  const saved = (u: string | null) => !!u && u.includes("/storage/v1/");
  let videoSrc = a.video_url ?? null;
  let poster: string | null = null;
  if (!videoSrc && a.vista_previa_url) ({ video: videoSrc, poster } = await fromPreview(a.vista_previa_url));
  const img = a.imagen_url ? await copyMedia(a.imagen_url, `propio/${key}/img-${Date.now()}.jpg`) : null;
  const pst = !saved(img) && poster ? await copyMedia(poster, `propio/${key}/poster-${Date.now()}.jpg`) : null;
  const vid = videoSrc ? await copyMedia(videoSrc, `propio/${key}/${Date.now()}.mp4`) : null;
  const media: any[] = [];
  if (saved(vid)) media.push({ type: "video", url: vid, thumb: saved(img) ? img : saved(pst) ? pst : null });
  else if (saved(img) && a.formato !== "video") media.push({ type: "image", url: img });
  return media;
}

async function copyMedia(url: string, key: string): Promise<string> {
  try {
    const res = await fetch(url);
    if (!res.ok) return url;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > 60 * 1024 * 1024) return url;
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
      ? await db.from("ads_view").select("id, page_name, format, body, hook, why_it_works, adaptation, days_active, video_analysis").in("id", adIds)
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
        solo_venta_directa: bool("Solo anuncios de venta directa (oferta, precio, cuotas, llamado a comprar). Usalo para eventos como Black Friday, Cyber o Hot Sale"),
        solo_del_cliente: bool("Solo los anuncios que trajeron las búsquedas de ese cliente"),
        ocultar_usados: bool("Esconder los anuncios que ya se usaron en pedidos de ese cliente"),
        fuente: { type: "string", enum: ["competencia", "propio"], description: "Solo competencia o solo anuncios propios del cliente" },
        busqueda_id: str("Solo los anuncios que trajo una búsqueda puntual"),
        solo_favoritos: bool("Solo los marcados como favoritos para ese cliente"),
        orden: { type: "string", enum: ["puntaje", "dias", "recientes"], description: "Orden (por defecto, mejor puntaje primero)" },
        limite: num("Cantidad máxima (por defecto 20, hasta 100)"),
      },
    },
    run: async (a) => {
      const client = await findClient(a.cliente);
      let q = (a.solo_del_cliente && client ? db.from("client_ads").select("*").eq("client_id", client.id) : db.from("ads_view").select("*")).or(
        "relevant.is.null,relevant.eq.true",
      );
      if (a.solo_venta_directa) q = q.eq("direct_sale", true);
      if (a.angulo) q = q.ilike("angle", `%${a.angulo}%`);
      if (a.tipo_hook) q = q.ilike("hook_type", `%${a.tipo_hook}%`);
      if (a.solo_hooks) q = q.eq("format", "video").not("hook", "is", null);
      else if (a.formato) q = q.eq("format", a.formato);
      if (a.fuente) q = q.eq("source", a.fuente);
      if (a.fuente === "propio" && client) q = q.eq("owner_client_id", client.id);
      if (a.texto) q = q.or(`body.ilike.%${a.texto}%,page_name.ilike.%${a.texto}%,hook.ilike.%${a.texto}%`);
      if (a.busqueda_id) {
        const { data: sr } = await db.from("search_results").select("ad_id").eq("search_id", a.busqueda_id);
        q = q.in("id", (sr ?? []).map((r) => r.ad_id));
      }
      if (a.solo_favoritos) {
        let sq = db.from("saves").select("ad_id");
        sq = client ? sq.eq("client_id", client.id) : sq.is("client_id", null);
        const { data: sv } = await sq;
        q = q.in("id", (sv ?? []).map((r) => r.ad_id));
      }
      q =
        a.orden === "dias"
          ? q.order("days_active", { ascending: false, nullsFirst: false })
          : a.orden === "recientes"
            ? q.order("first_seen", { ascending: false })
            : q.order("score", { ascending: false, nullsFirst: false });
      const { data } = await q.limit(Math.min(Number(a.limite) || 20, 100));
      let rows = data ?? [];
      if (client) {
        const { data: d } = await db.from("discards").select("ad_id").or(`client_id.is.null,client_id.eq.${client.id}`);
        const out = new Set((d ?? []).map((x) => x.ad_id));
        if (a.ocultar_usados) {
          const { data: u } = await db.from("used_ads").select("ad_id").eq("client_id", client.id);
          for (const x of u ?? []) out.add(x.ad_id);
        }
        rows = rows.filter((r: any) => !out.has(r.id));
      }
      return { total: rows.length, anuncios: rows.map(adSummary), ver_en_la_app: `${APP_URL}/biblioteca` };
    },
  },
  {
    name: "listar_grupos",
    description:
      "Lista los grupos de anuncios que el equipo armó a mano en la biblioteca (referencias elegidas por una persona, con nombre). Usalo cuando te pidan un pedido 'con el grupo …'.",
    inputSchema: { type: "object", properties: { cliente: str("Filtrar por cliente") } },
    run: async (a) => {
      const client = await findClient(a.cliente);
      let q = db.from("ad_groups").select("id, name, client_id, ad_ids, hook_ids, updated_at, clients(name)").order("updated_at", { ascending: false });
      if (client) q = q.eq("client_id", client.id);
      const { data } = await q.limit(50);
      return (data ?? []).map((g: any) => ({ id: g.id, nombre: g.name, cliente: g.clients?.name ?? null, referencias: g.ad_ids.length, hooks: g.hook_ids.length, actualizado: g.updated_at }));
    },
  },
  {
    name: "ver_grupo",
    description: "Muestra los anuncios de un grupo (referencias y hooks) con su análisis, para revisarlos antes de armar el pedido.",
    inputSchema: { type: "object", properties: { grupo: str("Nombre del grupo (alcanza con una parte)"), cliente: str("Cliente (opcional)") }, required: ["grupo"] },
    run: async (a) => {
      const client = await findClient(a.cliente);
      const g = await findGroup(a.grupo, client?.id);
      const ids = [...g.ad_ids, ...g.hook_ids];
      const { data } = ids.length ? await db.from("ads_view").select("*").in("id", ids) : { data: [] };
      const byId = new Map((data ?? []).map((x: any) => [x.id, x]));
      return {
        grupo: g.name,
        referencias: g.ad_ids.map((id) => byId.get(id)).filter(Boolean).map(adSummary),
        hooks: g.hook_ids.map((id) => byId.get(id)).filter(Boolean).map(adSummary),
      };
    },
  },
  {
    name: "empezar_busqueda",
    description:
      "Paso 2: lanza una búsqueda nueva de anuncios de la competencia en la Biblioteca de Meta para un cliente. Antes usar preparar_busqueda y preguntarle al usuario todo junto. No fuerza un número por país: trae un total repartido libremente. Si es para un evento (Black Friday, Cyber Monday, Hot Sale…) solo guarda anuncios de venta directa. Descarta marketplaces, anuncios de catálogo y anuncios que ya trajo otra búsqueda. Tarda unos minutos; consultá el avance con estado_busquedas.",
    inputSchema: {
      type: "object",
      properties: {
        cliente: str("Nombre del cliente"),
        palabras_clave: arr("Palabras clave o marcas a buscar (opcional)"),
        paises: arr("Códigos de país, ej. AR, UY, CL, MX, ES (por defecto AR, ES, MX, US, CO y CL)"),
        total: num("Cantidad total de anuncios aproximada, entre todos los países (por defecto 150)"),
        evento: str("Evento para el que se busca (Black Friday, Cyber Monday, Hot Sale, Navidad…). Vacío = Always On"),
        tipo_medio: { type: "string", enum: ["all", "video", "image"], description: "Video e imagen (all), solo video o solo imagen" },
        semanal: bool("Repetir cada semana"),
        confirmado: bool("true solo después de haberle preguntado al usuario todo junto (con preparar_busqueda) y que haya respondido"),
      },
      required: ["cliente", "confirmado"],
    },
    run: async (a) => {
      if (a.confirmado !== true)
        throw new Error("Antes de lanzar la búsqueda llamá a preparar_busqueda y preguntale al usuario todo junto, en un solo mensaje. Después llamá de nuevo con confirmado=true.");
      const client = await findClient(a.cliente);
      const keywords = a.palabras_clave?.length ? a.palabras_clave : [...(client.keywords ?? []), ...(client.competitors ?? [])];
      const countries = a.paises?.length ? a.paises.map((x: string) => x.toUpperCase()) : ["AR", "ES", "MX", "US", "CO", "CL"];
      const total = Math.min(Math.max(Number(a.total) || 150, 20), 1000);
      const nq = Math.max(1, keywords.length || 1) * countries.length;
      const { data: s, error } = await db
        .from("searches")
        .insert({
          client_id: client.id,
          rubro: client.rubro ?? client.name,
          keywords: keywords.length ? keywords : [client.rubro ?? client.name],
          countries,
          max_total: total,
          max_per_query: Math.max(10, Math.min(100, Math.ceil((total * 1.5) / nq))),
          event: a.evento?.trim() || null,
          media_type: a.tipo_medio ?? "all",
          recurring: !!a.semanal,
          created_by: "claude (conector)",
        })
        .select()
        .single();
      if (error) throw error;
      // El robot toma las pendientes; lo empujamos para que arranque ya
      kick();
      return { busqueda_id: s.id, estado: "en marcha", evento: s.event, total: s.max_total, palabras_clave: s.keywords, paises: s.countries, ver_avance: `${APP_URL}/clientes/${client.id}?tab=busquedas` };
    },
  },
  {
    name: "estado_busquedas",
    description: "Muestra las últimas búsquedas con su estado y porcentaje de avance.",
    inputSchema: { type: "object", properties: { limite: num("Cantidad (por defecto 5)") } },
    run: async (a) => {
      const { data } = await db
        .from("searches")
        .select("id, status, progress, progress_pct, total_found, error, countries, event, created_at, clients(name)")
        .order("created_at", { ascending: false })
        .limit(Math.min(Number(a.limite) || 5, 20));
      return data;
    },
  },
  {
    name: "agregar_anuncio_propio",
    description:
      "Suma a la biblioteca un anuncio de la cuenta publicitaria del propio cliente (por ejemplo, un ganador sacado con el conector de Meta Ads), con su video o imagen y sus métricas, para usarlo de referencia en un pedido. Guarda una copia del archivo para que no venza. " +
      "IMPORTANTE, para que se vea el archivo: con el conector de Meta Ads sacá el creative_id (ads_get_ad_entities, level=ad) y ads_get_creatives (video_id, image_hash, asset_feed_spec, object_story_spec). " +
      "Video: pasá en video_url el download_hd_url de ads_get_ad_videos (video_ids + fields=[download_hd_url]); si viene vacío (pasa seguido), pasá en vista_previa_url el preview_url de ads_get_ad_preview con ad_format=MOBILE_FEED_STANDARD y el servidor saca el mp4 solo. " +
      "Imagen: pasá en imagen_url el download_url de ads_get_ad_images (hashes + fields=[download_url]). No uses thumbnail_url ni picture (miniaturas que vencen). " +
      "Si el creativo se llama {{product.name}} o la vista previa trae product_set, es de catálogo: pasá es_catalogo=true.",
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
        cuenta_id: str("ID de la cuenta publicitaria (sin act_), para el link al Administrador de anuncios"),
        vista_previa_url: str("preview_url de ads_get_ad_preview con ad_format=MOBILE_FEED_STANDARD: de ahí se saca el video si Meta no da download_hd_url"),
        es_catalogo: bool("true si es un anuncio de catálogo (creativo llamado {{product.name}} o la vista previa trae product_set): se guarda como dato pero no como referencia creativa"),
      },
      required: ["cliente", "meta_ad_id", "formato"],
    },
    run: async (a) => {
      const client = await findClient(a.cliente);
      // Solo se guarda lo que se pudo copiar: un link directo de Meta se ve roto en el navegador y vence
      const media = await resolveMedia(String(a.meta_ad_id), a);
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
            relevant: !a.es_catalogo,
            angle: null,
            score: roas ? Math.min(100, Math.round(40 + roas * 10)) : 60,
            snapshot_url: a.cuenta_id
              ? `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${a.cuenta_id}&selected_ad_ids=${a.meta_ad_id}`
              : `https://adsmanager.facebook.com/adsmanager/manage/ads?selected_ad_ids=${a.meta_ad_id}`,
          },
          { onConflict: "platform,ad_archive_id" },
        )
        .select("id")
        .single();
      if (error) throw error;
      return {
        anuncio_id: data.id,
        guardado: true,
        archivo_guardado: media.length > 0,
        aviso: a.es_catalogo
          ? "Es de catálogo: quedó guardado como dato pero oculto en la biblioteca (no es referencia creativa)."
          : media.length
            ? undefined
            : "No se pudo descargar el archivo. Probá con vista_previa_url (ads_get_ad_preview, ad_format=MOBILE_FEED_STANDARD) o con actualizar_archivo_anuncio.",
      };
    },
  },
  {
    name: "actualizar_archivo_anuncio",
    description:
      "Reemplaza el video o la imagen de un anuncio que ya está en la biblioteca (por ejemplo, uno propio que quedó sin archivo). " +
      "Pasá video_url (download_hd_url de Meta), imagen_url (download_url) o vista_previa_url (preview_url de ads_get_ad_preview con ad_format=MOBILE_FEED_STANDARD).",
    inputSchema: {
      type: "object",
      properties: {
        anuncio_id: str("ID del anuncio en la biblioteca"),
        video_url: str("Link de descarga del video"),
        imagen_url: str("Link de descarga de la imagen"),
        vista_previa_url: str("Vista previa de Meta (Feed de Facebook) de donde sacar el video"),
      },
      required: ["anuncio_id"],
    },
    run: async (a) => {
      const { data: ad } = await db.from("ads").select("id, ad_archive_id, format").eq("id", a.anuncio_id).maybeSingle();
      if (!ad) throw new Error("No encontré el anuncio");
      const media = await resolveMedia(String(ad.ad_archive_id), { ...a, formato: ad.format });
      if (!media.length) throw new Error("No pude descargar nada. Si usaste una vista previa de Reels, probá con la de Feed de Facebook (MOBILE_FEED_STANDARD).");
      await db
        .from("ads")
        .update({ media, ...(media[0].type === "video" ? { format: "video", video_status: null, video_error: null, video_analysis: null } : {}) })
        .eq("id", ad.id);
      return { ok: true, guardado: media[0].type };
    },
  },
  {
    name: "crear_pedido",
    description:
      "Crea un pedido de creativos con las referencias elegidas: un grupo armado por el equipo (grupo) o ids de buscar_en_biblioteca / agregar_anuncio_propio. La IA escribe guiones, cómo grabar y aclaraciones según el nivel de detalle. Los hook_ids se muestran como videos de 5 s en la sección Hooks sugeridos. Devuelve el link para el cliente y el link para editarlo.",
    inputSchema: {
      type: "object",
      properties: {
        cliente: str("Nombre del cliente"),
        grupo: str("Nombre de un grupo de anuncios armado por el equipo: usa sus referencias y sus hooks"),
        anuncio_ids: arr("IDs de los anuncios de referencia, en el orden de las piezas (si no se usa grupo)"),
        hook_ids: arr("IDs de videos cuyo hook (primeros 5 s) va en la sección Hooks sugeridos del link"),
        entrega_drive: str("Link de Drive donde entregar los creativos (por defecto, la carpeta de creativos del cliente)"),
        adaptaciones: str("Adaptaciones que se piden, ej. 'Vertical 9:16 y feed 4:5' (por defecto según la plataforma)"),
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
      required: ["cliente"],
    },
    run: async (a) => {
      const client = await findClient(a.cliente);
      if (a.grupo) {
        const g = await findGroup(a.grupo, client.id);
        a.anuncio_ids = [...g.ad_ids, ...(a.anuncio_ids ?? []).filter((x: string) => !g.ad_ids.includes(x))];
        a.hook_ids = [...new Set([...(g.hook_ids ?? []), ...(a.hook_ids ?? [])])];
      }
      if (!a.anuncio_ids?.length && !Number(a.piezas)) throw new Error("Pasá un grupo o anuncio_ids con las referencias.");
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
          hook_ad_ids: a.hook_ids ?? [], delivery_url: a.entrega_drive ?? null, formats: a.adaptaciones ?? null,
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
      properties: { cliente: str("Cliente"), grupo: str("O el nombre de un grupo"), anuncio_ids: arr("IDs de los anuncios"), titulo: str("Título"), nota: str("Nota para el cliente") },
    },
    run: async (a) => {
      const client = await findClient(a.cliente);
      if (a.grupo) a.anuncio_ids = [...new Set([...(await findGroup(a.grupo, client?.id)).ad_ids, ...(a.anuncio_ids ?? [])])];
      if (!a.anuncio_ids?.length) throw new Error("Pasá anuncio_ids o un grupo.");
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
  // ---------- Búsquedas ----------
  {
    name: "preparar_busqueda",
    description:
      "Paso 1 para lanzar una búsqueda: devuelve las opciones y los valores por defecto del cliente (palabras clave, competidores, países, total). " +
      "Con eso preguntale al usuario TODO JUNTO en un solo mensaje (para qué es: Always On o qué evento; países; cantidad total; video, imagen o ambos; palabras clave a sumar o sacar; si se repite cada semana). " +
      "Cuando responda, llamá a empezar_busqueda con confirmado=true.",
    inputSchema: { type: "object", properties: { cliente: str("Nombre del cliente") }, required: ["cliente"] },
    run: async (a) => {
      const client = await findClient(a.cliente);
      return {
        cliente: client.name,
        rubro: client.rubro,
        preguntas: [
          { campo: "evento", pregunta: "¿Para qué es? Always On o un evento", opciones: ["Always On", ...EVENTS, "Otro (decime cuál)"], nota: "En eventos solo entran anuncios de venta directa" },
          { campo: "paises", pregunta: "¿De qué países traemos contenido?", por_defecto: ["AR", "ES", "MX", "US", "CO", "CL"], otros: ["UY", "PY", "BO", "PE", "EC", "BR"] },
          { campo: "total", pregunta: "¿Cuántos anuncios en total (aprox.)?", por_defecto: 150 },
          { campo: "tipo_medio", pregunta: "¿Video, imagen o ambos?", por_defecto: "ambos" },
          { campo: "palabras_clave", pregunta: "¿Sumamos o sacamos palabras clave?", por_defecto: [...(client.keywords ?? []), ...(client.competitors ?? [])] },
          { campo: "semanal", pregunta: "¿La repetimos cada semana?", por_defecto: false },
        ],
      };
    },
  },
  {
    name: "actualizar_busqueda",
    description: "Vuelve a correr una búsqueda existente (solo suma anuncios nuevos, nunca repetidos).",
    inputSchema: { type: "object", properties: { busqueda_id: str("ID de la búsqueda (estado_busquedas)") }, required: ["busqueda_id"] },
    run: async (a) => {
      const { error } = await db.from("searches").update({ status: "pending", error: null, apify_run_id: null, apify_dataset_id: null, progress: null }).eq("id", a.busqueda_id);
      if (error) throw error;
      kick();
      return { ok: true, estado: "en cola, arranca en menos de un minuto" };
    },
  },
  {
    name: "borrar_busqueda",
    description: "Borra una búsqueda del historial. Los anuncios que trajo quedan en la biblioteca.",
    inputSchema: { type: "object", properties: { busqueda_id: str("ID de la búsqueda") }, required: ["busqueda_id"] },
    run: async (a) => {
      await db.from("searches").delete().eq("id", a.busqueda_id);
      return { borrada: true };
    },
  },

  // ---------- Anuncios ----------
  {
    name: "ver_anuncio",
    description: "Detalle completo de un anuncio: análisis de la IA, texto, link al video o imagen y, si existe, el análisis del video completo (transcripción y escenas).",
    inputSchema: { type: "object", properties: { anuncio_id: str("ID del anuncio") }, required: ["anuncio_id"] },
    run: async (a) => {
      const { data } = await db.from("ads_view").select("*").eq("id", a.anuncio_id).maybeSingle();
      if (!data) throw new Error("No encontré el anuncio");
      return {
        ...adSummary(data),
        texto: data.body,
        resumen: data.ai_summary,
        paises: data.countries,
        desde: data.start_date,
        hasta: data.end_date,
        video_completo: data.video_analysis ?? undefined,
        estado_video: data.video_status,
      };
    },
  },
  {
    name: "analizar_video",
    description: "Pone un video en la cola para que la IA lo mire completo (imagen y audio): transcripción, textos en pantalla, hook y escenas. Tarda 1 o 2 minutos; después consultá ver_anuncio.",
    inputSchema: { type: "object", properties: { anuncio_id: str("ID del anuncio de video") }, required: ["anuncio_id"] },
    run: async (a) => {
      // Queda primero en la cola (la cola toma los de video_at más viejo dentro de los sin analizar, por puntaje)
      const { error } = await db.from("ads").update({ video_status: null, video_error: null, video_analysis: null }).eq("id", a.anuncio_id).eq("format", "video");
      if (error) throw error;
      kick();
      return { ok: true, estado: "en cola: se analiza en los próximos minutos" };
    },
  },
  {
    name: "favorito",
    description: "Marca o desmarca un anuncio como favorito para un cliente.",
    inputSchema: { type: "object", properties: { anuncio_id: str("ID del anuncio"), cliente: str("Cliente"), quitar: bool("true para sacarlo de favoritos") }, required: ["anuncio_id"] },
    run: async (a) => {
      const client = await findClient(a.cliente);
      let del = db.from("saves").delete().eq("ad_id", a.anuncio_id);
      del = client ? del.eq("client_id", client.id) : del.is("client_id", null);
      await del;
      if (!a.quitar) await db.from("saves").insert({ ad_id: a.anuncio_id, client_id: client?.id ?? null });
      return { favorito: !a.quitar };
    },
  },
  {
    name: "restaurar_anuncio",
    description: "Vuelve a mostrar un anuncio descartado (para un cliente o para todos).",
    inputSchema: { type: "object", properties: { anuncio_id: str("ID del anuncio"), cliente: str("Cliente") }, required: ["anuncio_id"] },
    run: async (a) => {
      const client = await findClient(a.cliente);
      let del = db.from("discards").delete().eq("ad_id", a.anuncio_id);
      del = client ? del.eq("client_id", client.id) : del.is("client_id", null);
      await del;
      return { restaurado: true };
    },
  },

  // ---------- Grupos ----------
  {
    name: "crear_grupo",
    description: "Crea un grupo de anuncios con nombre (referencias y hooks) para un cliente.",
    inputSchema: {
      type: "object",
      properties: { cliente: str("Cliente"), nombre: str("Nombre del grupo"), anuncio_ids: arr("Referencias"), hook_ids: arr("Hooks (videos)") },
      required: ["cliente", "nombre"],
    },
    run: async (a) => {
      const client = await findClient(a.cliente);
      const { data, error } = await db
        .from("ad_groups")
        .insert({ client_id: client.id, name: a.nombre, ad_ids: a.anuncio_ids ?? [], hook_ids: a.hook_ids ?? [], created_by: "claude (conector)" })
        .select("id")
        .single();
      if (error) throw error;
      return { grupo_id: data.id, nombre: a.nombre, ver: `${APP_URL}/clientes/${client.id}?tab=grupos` };
    },
  },
  {
    name: "editar_grupo",
    description: "Suma o saca anuncios de un grupo, o lo renombra.",
    inputSchema: {
      type: "object",
      properties: {
        grupo: str("Nombre del grupo"),
        cliente: str("Cliente"),
        sumar_anuncio_ids: arr("Referencias a sumar"),
        sumar_hook_ids: arr("Hooks a sumar"),
        quitar_ids: arr("Anuncios a sacar (de referencias y de hooks)"),
        nuevo_nombre: str("Nuevo nombre"),
      },
      required: ["grupo"],
    },
    run: async (a) => {
      const client = await findClient(a.cliente);
      const g = await findGroup(a.grupo, client?.id);
      const out = new Set<string>(a.quitar_ids ?? []);
      const ad_ids = [...new Set([...g.ad_ids, ...(a.sumar_anuncio_ids ?? [])])].filter((x) => !out.has(x));
      const hook_ids = [...new Set([...g.hook_ids, ...(a.sumar_hook_ids ?? [])])].filter((x) => !out.has(x));
      await db.from("ad_groups").update(clean({ ad_ids, hook_ids, name: a.nuevo_nombre || undefined, updated_at: now() })).eq("id", g.id);
      return { grupo: a.nuevo_nombre || g.name, referencias: ad_ids.length, hooks: hook_ids.length };
    },
  },
  {
    name: "borrar_grupo",
    description: "Borra un grupo (los anuncios quedan en la biblioteca).",
    inputSchema: { type: "object", properties: { grupo: str("Nombre del grupo"), cliente: str("Cliente") }, required: ["grupo"] },
    run: async (a) => {
      const client = await findClient(a.cliente);
      const g = await findGroup(a.grupo, client?.id);
      await db.from("ad_groups").delete().eq("id", g.id);
      return { borrado: g.name };
    },
  },

  // ---------- Clientes ----------
  {
    name: "crear_cliente",
    description:
      "Crea un cliente nuevo con su perfil (rubro, propuesta de valor, público, mensajes, tono, qué no comunicar, competidores, palabras clave, web, Instagram, logo y carpetas de Drive).",
    inputSchema: {
      type: "object",
      properties: {
        nombre: str("Nombre"), rubro: str("Rubro"), usp: str("Propuesta de valor"), publico: str("Público"), mensajes: arr("Mensajes guía"),
        tono: str("Tono"), no_comunicar: str("Qué NO comunicar"), competidores: arr("Marcas competidoras"), palabras_clave: arr("Palabras clave para buscar"),
        web: str("Web"), instagram: str("Instagram"), logo_url: str("Link a la imagen del logo"), drive: str("Carpeta del cliente en Drive"),
        carpeta_creativos: str("Carpeta donde se entregan los creativos"), notas: str("Notas"),
      },
      required: ["nombre"],
    },
    run: async (a) => {
      const { data, error } = await db.from("clients").insert(clientFields(a)).select("id, name").single();
      if (error) throw error;
      return { cliente_id: data.id, nombre: data.name, ver: `${APP_URL}/clientes/${data.id}` };
    },
  },
  {
    name: "editar_cliente",
    description: "Edita el perfil de un cliente (solo los campos que pases).",
    inputSchema: {
      type: "object",
      properties: {
        cliente: str("Cliente a editar"), nombre: str("Nuevo nombre"), rubro: str("Rubro"), usp: str("Propuesta de valor"), publico: str("Público"),
        mensajes: arr("Mensajes guía (reemplaza)"), tono: str("Tono"), no_comunicar: str("Qué NO comunicar"), competidores: arr("Competidores (reemplaza)"),
        palabras_clave: arr("Palabras clave (reemplaza)"), web: str("Web"), instagram: str("Instagram"), logo_url: str("Logo"), drive: str("Carpeta en Drive"),
        carpeta_creativos: str("Carpeta de entrega de creativos"), notas: str("Notas"),
      },
      required: ["cliente"],
    },
    run: async (a) => {
      const client = await findClient(a.cliente);
      const { error } = await db.from("clients").update(clientFields(a)).eq("id", client.id);
      if (error) throw error;
      return { actualizado: a.nombre ?? client.name };
    },
  },

  // ---------- Pedidos ----------
  {
    name: "editar_pedido",
    description:
      "Edita los datos generales de un pedido: título, descripción, fecha de entrega, link de entrega, adaptaciones, plataforma, nivel de detalle, objetivo, notas, aclaraciones y hooks en video.",
    inputSchema: {
      type: "object",
      properties: {
        pedido: str("ID del pedido o link del cliente"),
        titulo: str("Título"), descripcion: str("Descripción de la portada"), fecha_entrega: str("YYYY-MM-DD"), entrega_drive: str("Link de Drive para entregar"),
        adaptaciones: str("Adaptaciones"), plataforma: { type: "string", enum: ["Meta", "TikTok", "Google"] },
        nivel_detalle: { type: "string", enum: ["guion", "grabacion", "completo"] }, objetivo: str("Objetivo"), notas: str("Notas"),
        lo_que_no_cambia: str("Lo que no cambia en ninguna pieza (va en aclaraciones)"), aclaraciones: arr("Aclaraciones (reemplaza la lista)"),
        hook_ids: arr("Hooks en video (reemplaza la lista)"), sumar_hook_ids: arr("Hooks a sumar"), quitar_hook_ids: arr("Hooks a sacar"),
        evento: str("Evento"), fecha_evento: str("YYYY-MM-DD"), mes: str("Mes (Always On)"),
      },
      required: ["pedido"],
    },
    run: async (a) => {
      const p = await findPedido(a.pedido);
      let hooks: string[] | undefined = a.hook_ids;
      if (a.sumar_hook_ids || a.quitar_hook_ids) {
        const out = new Set<string>(a.quitar_hook_ids ?? []);
        hooks = [...new Set([...(hooks ?? p.hook_ad_ids ?? []), ...(a.sumar_hook_ids ?? [])])].filter((x) => !out.has(x));
      }
      const { error } = await db
        .from("pedidos")
        .update(
          clean({
            title: a.titulo, intro: a.descripcion, deadline: a.fecha_entrega, delivery_url: a.entrega_drive, formats: a.adaptaciones, platform: a.plataforma,
            detail_level: a.nivel_detalle, objective: a.objetivo, notes: a.notas, refs_note: a.lo_que_no_cambia, before_notes: a.aclaraciones, hook_ad_ids: hooks,
            event_name: a.evento, event_date: a.fecha_evento, period: a.mes,
          }),
        )
        .eq("id", p.id);
      if (error) throw error;
      return { ok: true, link_cliente: `${APP_URL}/p/${p.slug}` };
    },
  },
  {
    name: "editar_pieza",
    description:
      "Edita una pieza (creativo) de un pedido por su número: título, formato, guion (hook, desarrollo, cierre), imagen (escena, titular, bajada), cómo grabarlo, duración, qué replicar de la referencia o la referencia misma.",
    inputSchema: {
      type: "object",
      properties: {
        pedido: str("ID del pedido o link del cliente"), numero: num("Número de creativo (1, 2, 3…)"),
        titulo: str("Título"), formato: str("Formato, ej. Reel 9:16"), hook: str("Hook"), desarrollo: str("Desarrollo"), cierre: str("Cierre"),
        escena: str("Imagen / escena"), titular: str("Titular"), bajada: str("Bajada"), como_grabar: str("Cómo grabarlo"), duracion: str("Duración"),
        que_replicar: str("Qué replicar de la referencia"), anuncio_id: str("Cambiar la referencia por este anuncio"),
      },
      required: ["pedido", "numero"],
    },
    run: async (a) => {
      const p = await findPedido(a.pedido);
      const { data: it } = await db.from("pedido_items").select("id").eq("pedido_id", p.id).eq("position", Number(a.numero)).maybeSingle();
      if (!it) throw new Error(`El pedido no tiene creativo ${a.numero}`);
      const { error } = await db
        .from("pedido_items")
        .update(
          clean({
            title: a.titulo, piece_name: a.titulo, format: a.formato, hook: a.hook, development: a.desarrollo, closing: a.cierre, scene: a.escena,
            headline: a.titular, subhead: a.bajada, recording_tips: a.como_grabar, duration: a.duracion, ref_beats: a.que_replicar, ad_id: a.anuncio_id,
          }),
        )
        .eq("id", it.id);
      if (error) throw error;
      return { ok: true, link_cliente: `${APP_URL}/p/${p.slug}` };
    },
  },
  {
    name: "agregar_pieza",
    description: "Agrega un creativo al final de un pedido, con o sin referencia. Para que la IA lo escriba, después usá regenerar_pedido o completalo con editar_pieza.",
    inputSchema: { type: "object", properties: { pedido: str("ID del pedido o link"), anuncio_id: str("Referencia (opcional)"), formato: str("Formato") }, required: ["pedido"] },
    run: async (a) => {
      const p = await findPedido(a.pedido);
      const { count } = await db.from("pedido_items").select("id", { count: "exact", head: true }).eq("pedido_id", p.id);
      const n = (count ?? 0) + 1;
      await db.from("pedido_items").insert({ pedido_id: p.id, position: n, ad_id: a.anuncio_id ?? null, piece_name: `Pieza ${n}`, code: `V${n}`, format: a.formato ?? null });
      return { numero: n };
    },
  },
  {
    name: "borrar_pieza",
    description: "Saca un creativo de un pedido por su número y renumera los demás.",
    inputSchema: { type: "object", properties: { pedido: str("ID del pedido o link"), numero: num("Número de creativo") }, required: ["pedido", "numero"] },
    run: async (a) => {
      const p = await findPedido(a.pedido);
      await db.from("pedido_items").delete().eq("pedido_id", p.id).eq("position", Number(a.numero));
      const { data: rest } = await db.from("pedido_items").select("id").eq("pedido_id", p.id).order("position");
      for (const [i, r] of (rest ?? []).entries()) await db.from("pedido_items").update({ position: i + 1 }).eq("id", r.id);
      return { quedan: rest?.length ?? 0 };
    },
  },
  {
    name: "regenerar_pedido",
    description: "Vuelve a escribir con IA todo el pedido (guiones, cómo grabar, aclaraciones) con sus referencias actuales. Tarda 1 o 2 minutos.",
    inputSchema: { type: "object", properties: { pedido: str("ID del pedido o link") }, required: ["pedido"] },
    run: async (a) => {
      const p = await findPedido(a.pedido);
      await db.from("pedidos").update({ ai_status: "generating", ai_error: null }).eq("id", p.id);
      const rt = (globalThis as any).EdgeRuntime;
      if (rt?.waitUntil) rt.waitUntil(generatePedido(p.id));
      else await generatePedido(p.id);
      return { estado: "La IA lo está escribiendo. Consultá ver_pedido en 1 o 2 minutos.", link_cliente: `${APP_URL}/p/${p.slug}` };
    },
  },
  {
    name: "borrar_pedido",
    description: "Borra un pedido de creativos (el link del cliente deja de funcionar). Confirmá con el usuario antes.",
    inputSchema: { type: "object", properties: { pedido: str("ID del pedido o link"), confirmado: bool("true si el usuario confirmó") }, required: ["pedido", "confirmado"] },
    run: async (a) => {
      if (a.confirmado !== true) throw new Error("Preguntale al usuario si está seguro antes de borrar.");
      const p = await findPedido(a.pedido);
      await db.from("pedido_items").delete().eq("pedido_id", p.id);
      await db.from("pedidos").delete().eq("id", p.id);
      return { borrado: p.title };
    },
  },
];

const SERVER_INFO = { name: "pedido-de-creativos", title: "Pedido de Creativos (Grownax)", version: "2.2.0" };
const INSTRUCTIONS =
  "Herramienta de la agencia para encontrar referencias de anuncios de la competencia y armar pedidos de creativos. " +
  "Podés hacer todo lo que hace la herramienta: buscar, ver y filtrar anuncios, favoritos, descartes, grupos, clientes y pedidos (crear, editar piezas, regenerar, borrar). " +
  "Para lanzar una búsqueda: primero preparar_busqueda y preguntale al usuario TODO JUNTO en un solo mensaje; recién con sus respuestas, empezar_busqueda con confirmado=true. " +
  "Si el usuario nombra un grupo, usá listar_grupos / ver_grupo y crear_pedido con grupo: esas referencias las eligió una persona, no las cambies. " +
  "Flujo típico: listar_clientes → buscar_en_biblioteca (o empezar_busqueda si faltan referencias) → crear_pedido con los ids elegidos como referencia y los mejores hooks en hook_ids → ver_pedido. " +
  "Para eventos (Black Friday, Cyber, Hot Sale) usá solo_venta_directa y buscá con evento. Para no repetir referencias, usá ocultar_usados. " +
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
