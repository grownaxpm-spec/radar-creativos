// Análisis con IA (si hay ANTHROPIC_API_KEY): filtra ruido, detecta el hook, explica por qué funciona
// y propone cómo adaptarlo al cliente. Mira la imagen o la miniatura del video, no solo el texto.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

export const HOOK_TYPES = [
  "Pregunta",
  "Dolor / problema",
  "Demostración de producto",
  "Detalle / calidad",
  "Testimonio / UGC",
  "Antes y después / comparación",
  "Oferta / precio",
  "Lifestyle / aspiracional",
  "Proceso / fabricación",
  "Novedad / lanzamiento",
  "Autoridad / datos",
  "Otro",
] as const;

export const ANGLES = [
  "Precio / promo",
  "Calidad / materiales",
  "Comodidad / calce",
  "Estilo / outfit",
  "Versatilidad",
  "Durabilidad",
  "Regalo",
  "Prueba social",
  "Fabricación / industria nacional",
  "Envío / cambios / garantía",
  "Lanzamiento / novedad",
  "Otro",
] as const;

const Result = z.object({
  ads: z.array(
    z.object({
      id: z.string(),
      relevant: z.boolean(),
      direct_sale: z.boolean(),
      angle: z.enum(ANGLES),
      hook: z.string(),
      hook_type: z.enum(HOOK_TYPES),
      why_it_works: z.string(),
      adaptation: z.string(),
      ai_score: z.number().int().min(1).max(10),
      summary: z.string(),
    }),
  ),
});
export type Classification = z.infer<typeof Result>["ads"][number];

export type ClientProfile = {
  name: string;
  rubro: string | null;
  usp: string | null;
  target: string | null;
  messages: string[];
  tone: string | null;
  avoid: string | null;
};

export type AdForAI = {
  id: string;
  page_name: string | null;
  body: string | null;
  title: string | null;
  format: string;
  days_active: number;
  variations: number | null;
  image_url?: string | null;
};

// Funciona igual en Node y en Deno (servidor de Supabase)
function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function sniffImage(b: Uint8Array): "image/jpeg" | "image/png" | "image/gif" | "image/webp" | null {
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

async function imageBlock(url: string | null | undefined): Promise<Anthropic.ImageBlockParam | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > 1_500_000) return null;
    // El tipo se detecta por los bytes: Meta a veces marca como JPG imágenes que son PNG
    const media_type = sniffImage(bytes);
    if (!media_type) return null;
    return { type: "image", source: { type: "base64", media_type, data: toBase64(bytes) } };
  } catch {
    return null;
  }
}

function system(rubro: string, client: ClientProfile | null, event?: string | null, brief?: string | null) {
  const profile = client
    ? `\n\nCLIENTE PARA EL QUE BUSCAMOS REFERENCIAS: ${client.name}` +
      (client.rubro ? `\nRubro: ${client.rubro}` : "") +
      (client.usp ? `\nPropuesta de valor (USP): ${client.usp}` : "") +
      (client.target ? `\nPúblico: ${client.target}` : "") +
      (client.messages.length ? `\nMensajes guía: ${client.messages.join(" | ")}` : "") +
      (client.tone ? `\nTono: ${client.tone}` : "") +
      (client.avoid ? `\nQué NO comunicar: ${client.avoid}` : "")
    : "";
  return (
    "Sos director creativo de una agencia de performance en Argentina. Analizás anuncios de la competencia sacados de la Biblioteca de Anuncios de Meta " +
    "para encontrar referencias que el cliente pueda replicar. Cada anuncio viene con su texto, la imagen o miniatura del video, los días que lleva activo " +
    "y cuántas variaciones tiene (más días y más variaciones = probablemente vende).\n\n" +
    `Para cada anuncio:\n` +
    `- relevant: false si no es del rubro "${rubro}" (apps, series, otros productos, etc.). ` +
    "También false si el anunciante es un marketplace o tienda generalista (Shein, Temu, AliExpress, Amazon, Mercado Libre, Dafiti, Falabella, etc.) " +
    "o una tienda multimarca o de dropshipping genérico (tiendas tipo shop sin marca propia, productos importados genéricos, venta por WhatsApp de otras marcas): solo sirven marcas reales del rubro con producto propio.\n" +
    "- direct_sale: true si es un anuncio de venta directa: muestra producto con oferta, descuento, precio, cuotas, envío gratis, urgencia o un llamado claro a comprar. " +
    "false si es de marca, institucional, inspiracional o contenido sin intención de venta inmediata.\n" +
    (event
      ? `ESTA BÚSQUEDA ES PARA ${event.toUpperCase()}: buscamos referencias 100% de venta directa del rubro, como las que se usan en eventos de descuento. ` +
        "Sé estricto con direct_sale.\n"
      : "") +
    (brief
      ? `LO QUE PIDIÓ EL EQUIPO, CON SUS PALABRAS: "${brief.replace(/"/g, "'")}". Tomalo como criterio principal: relevant=false si el anuncio no sirve para eso, y subí el ai_score de los que encajan justo.\n`
      : "") +
    "- hook: el gancho de los primeros segundos o la primera línea, escrito tal cual o descripto en pocas palabras (qué se ve/dice para frenar el scroll).\n" +
    "- hook_type y angle: elegí de las listas.\n" +
    "- why_it_works: 1-2 frases concretas (estructura, prueba, emoción, oferta). Nada genérico.\n" +
    "- adaptation: cómo lo haría el cliente con su producto y sus mensajes, en 1-2 frases accionables (qué grabar o diseñar). Respetá lo que el cliente NO comunica.\n" +
    "- ai_score: 1-10, qué tan buena referencia creativa es para este cliente.\n" +
    "- summary: una frase de qué muestra el anuncio.\n" +
    "Escribí en español rioplatense, directo, sin relleno." +
    profile
  );
}

export async function classifyAds(
  rubro: string,
  client: ClientProfile | null,
  ads: AdForAI[],
  onBatch?: (done: number, total: number) => unknown,
  opts: { apiKey?: string; model?: string; event?: string | null; brief?: string | null } = {},
): Promise<Map<string, Classification>> {
  const out = new Map<string, Classification>();
  if (!opts.apiKey || ads.length === 0) return out;
  const anthropic = new Anthropic({ apiKey: opts.apiKey });
  const model = opts.model || "claude-haiku-5-5";
  const sys = system(rubro, client, opts.event, opts.brief);

  for (let i = 0; i < ads.length; i += 8) {
    await onBatch?.(i, ads.length);
    const batch = ads.slice(i, i + 8);
    const content: Anthropic.ContentBlockParam[] = [];
    for (const a of batch) {
      content.push({
        type: "text",
        text: JSON.stringify({
          id: a.id,
          marca: a.page_name,
          formato: a.format,
          dias_activo: a.days_active,
          variaciones: a.variations ?? 1,
          titulo: a.title,
          texto: a.body?.slice(0, 700),
        }),
      });
      const img = await imageBlock(a.image_url);
      if (img) content.push(img);
    }
    content.push({ type: "text", text: `Analizá los ${batch.length} anuncios de arriba (cada imagen va después de su anuncio).` });

    const ask = (blocks: Anthropic.ContentBlockParam[]) =>
      anthropic.messages.parse({
        model,
        max_tokens: 8000,
        output_config: { effort: "low", format: zodOutputFormat(Result) },
        system: sys,
        messages: [{ role: "user", content: blocks }],
      });
    try {
      let response;
      try {
        response = await ask(content);
      } catch (err) {
        // Si una imagen rompe el lote, lo reintentamos solo con texto
        if (err instanceof Anthropic.BadRequestError) response = await ask(content.filter((c) => c.type === "text"));
        else throw err;
      }
      if (response.stop_reason === "refusal") continue;
      for (const c of response.parsed_output?.ads ?? []) out.set(c.id, c);
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) await new Promise((r) => setTimeout(r, 20000));
      else if (err instanceof Anthropic.APIError) console.warn(`Claude no pudo analizar un lote (${err.status}): ${err.message}`);
      else throw err;
    }
  }
  return out;
}
