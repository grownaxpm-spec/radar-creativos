// Redacta un pedido de creativos con IA siguiendo la metodología Grownax (skill "pedido-creativos"):
// cada pieza con ángulo, etapa del embudo, tipo de creativo y formato; guion HOOK / DESARROLLO / CIERRE;
// referencias de la competencia al lado; hooks sugeridos para el rubro; cómo se entrega.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const Piece = z.object({
  position: z.number().int(),
  code: z.string(),
  title: z.string(),
  group_name: z.string(),
  angle: z.string(),
  funnel: z.enum(["fria", "caliente"]),
  creative_type: z.string(),
  format: z.string(),
  ref_beats: z.string(),
  hook: z.string(),
  development: z.string(),
  closing: z.string(),
  scene: z.string(),
  headline: z.string(),
  subhead: z.string(),
  recording_tips: z.string(),
  duration: z.string(),
  adaptations: z.string(),
});

export const PedidoDraft = z.object({
  intro: z.string(),
  refs_note: z.string(),
  pieces: z.array(Piece),
  hooks: z.array(z.object({ hook: z.string(), tipo: z.string(), por_que: z.string() })),
  specs: z.array(z.object({ titulo: z.string(), items: z.array(z.string()) })),
  before_notes: z.array(z.string()),
});
export type PedidoDraft = z.infer<typeof PedidoDraft>;

const LEVEL: Record<string, string> = {
  guion:
    "NIVEL: SOLO GUION + REFERENCIA. Completá ref_beats y el guion (hook, development, closing para video; scene, headline, subhead para imagen/carrusel). " +
    "Dejá vacíos recording_tips, adaptations y specs. before_notes: como mucho 2 notas, solo si salen de la info del pedido.",
  grabacion:
    "NIVEL: GUION + CÓMO GRABARLO. Todo lo del guion y además recording_tips (planos, lugar, luz, quién habla, ritmo, subtítulos, qué mostrar en primer plano) y duration. " +
    "adaptations breve. specs: solo Videos e Imágenes.",
  completo:
    "NIVEL: COMPLETO (estructura madre). Todos los campos: ángulo, etapa del embudo, tipo de creativo y formato separados; guion; recording_tips; duration; adaptations " +
    "(ej. 9:16 y 4:5); specs con Videos, Imágenes y Nombre de archivo; before_notes con lo que hay que cerrar antes de grabar.",
};

const SYSTEM =
  "Sos el estratega creativo de Grownax, agencia de performance en Argentina. Escribís pedidos de creativos que el cliente o su editor leen en el celular " +
  "y graban sin dudas. Reglas de la casa:\n" +
  "- Cada pieza se clasifica en cuatro ejes que NUNCA se mezclan: ángulo de comunicación (el gatillo: dolor, deseo, prueba social, urgencia, autoridad…), " +
  "etapa del embudo (fria = no conoce la marca; caliente = ya tuvo contacto, apunta a conversión), tipo de creativo (UGC, testimonial, producto en uso, " +
  "founder-led, before/after, estático de producto…) y formato (Reel 9:16, Feed 4:5, carrusel, estático). Más volumen en fría que en caliente.\n" +
  "- Guion de video: HOOK directo, máximo 2 oraciones, que frene el scroll (en fría no asume que conocen la marca). DESARROLLO natural y conversacional, " +
  "mostrar antes que decir, nada de texto corporativo. CIERRE con CTA simple que termina con el nombre de la marca. Si no hay persona definida usá [Presenter].\n" +
  "- Imagen/carrusel: scene (composición visual detallada), headline (texto principal), subhead (texto secundario). Carrusel: 5 a 7 slides descriptos en scene.\n" +
  "- Cada pieza con referencia: ref_beats = qué replicar de esa referencia (estructura, gancho, ritmo, plano), no el texto exacto.\n" +
  "- Respetá el tono del cliente y lo que NO comunica. Precios o promos solo si aparecen en la info; si faltan, usá [PRECIO].\n" +
  "- hooks: 10 hooks listos para usar para el rubro del cliente, variados en tipo (pregunta, dolor, demostración, dato, prueba social, contraste…), " +
  "cada uno con por qué funciona en una frase.\n" +
  "- intro: 1 o 2 frases para la portada (qué se pide y para qué). refs_note: lo que no cambia en ninguna pieza (look, lugar, subtítulos, logo).\n" +
  "- No inventes aclaraciones ni disclaimers. Escribí en español rioplatense, con vos.\n" +
  "Devolvé una pieza por cada posición pedida, con el mismo número de position.";

type Ref = {
  page_name: string | null;
  format: string | null;
  body: string | null;
  hook: string | null;
  why_it_works: string | null;
  adaptation: string | null;
  days_active: number | null;
  video_analysis?: {
    duracion_seg?: number;
    transcripcion?: string;
    hook_visual?: string;
    texto_en_pantalla?: string[];
    escenas?: { desde_seg: number; hasta_seg: number; descripcion: string }[];
    quien_habla?: string;
    ritmo?: string;
    como_replicarlo?: string;
  } | null;
};

// Lo que la IA vio en el video completo: con esto el guion replica la estructura real, no la miniatura
function videoLines(v: Ref["video_analysis"]): string[] {
  if (!v) return [];
  return [
    `  VIDEO ANALIZADO (${Math.round(v.duracion_seg ?? 0)} s, ${v.quien_habla ?? ""}; ritmo: ${v.ritmo ?? ""})`,
    v.hook_visual && `  Primeros 3 segundos: ${v.hook_visual}`,
    v.escenas?.length && `  Escenas: ${v.escenas.map((e) => `[${e.desde_seg}-${e.hasta_seg}s] ${e.descripcion}`).join(" | ")}`,
    v.texto_en_pantalla?.length && `  Textos en pantalla: ${v.texto_en_pantalla.join(" / ")}`,
    v.transcripcion && `  Transcripción: ${v.transcripcion.replace(/\s+/g, " ").slice(0, 900)}`,
    v.como_replicarlo && `  Cómo replicarlo: ${v.como_replicarlo}`,
  ].filter(Boolean) as string[];
}

export async function draftPedido(input: {
  apiKey: string;
  model?: string;
  client: Record<string, any> | null;
  pedido: Record<string, any>;
  items: { position: number; format: string | null; angle: string | null; ref: Ref | null }[];
}): Promise<PedidoDraft> {
  const anthropic = new Anthropic({ apiKey: input.apiKey });
  const c = input.client;
  const p = input.pedido;
  const clientInfo = c
    ? [
        `Cliente: ${c.name}`,
        c.rubro && `Rubro: ${c.rubro}`,
        c.usp && `Propuesta de valor: ${c.usp}`,
        c.target && `Público: ${c.target}`,
        c.messages?.length && `Mensajes guía: ${c.messages.join(" | ")}`,
        c.tone && `Tono: ${c.tone}`,
        c.avoid && `Qué NO comunicar: ${c.avoid}`,
        c.website && `Web: ${c.website}`,
        c.notes && `Notas del cliente: ${c.notes}`,
      ]
        .filter(Boolean)
        .join("\n")
    : "Cliente sin perfil cargado.";
  const pedidoInfo = [
    `Plataforma: ${p.platform}`,
    p.kind === "evento" ? `Evento: ${p.event_name ?? "evento comercial"}${p.event_date ? ` (${p.event_date})` : ""}` : `Campaña Always On${p.period ? ` · ${p.period}` : ""}`,
    p.objective && `Objetivo / foco: ${p.objective}`,
    p.notes && `Info extra del pedido: ${p.notes}`,
  ]
    .filter(Boolean)
    .join("\n");
  const pieces = input.items
    .map((it) => {
      const r = it.ref;
      if (!r) return `Pieza ${it.position}: sin referencia (proponé vos la idea)${it.format ? `, formato sugerido ${it.format}` : ""}.`;
      return [
        `Pieza ${it.position}: referencia de ${r.page_name ?? "competidor"} (${r.format}, ${r.days_active ?? "?"} días activo)`,
        r.hook && `  Hook de la referencia: ${r.hook}`,
        r.why_it_works && `  Por qué funciona: ${r.why_it_works}`,
        r.adaptation && `  Idea de adaptación: ${r.adaptation}`,
        r.body && `  Texto del anuncio: ${r.body.replace(/\s+/g, " ").slice(0, 500)}`,
        ...videoLines(r.video_analysis),
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const response = await anthropic.messages.parse({
    model: input.model || "claude-opus-5-5",
    max_tokens: 16000,
    output_config: { effort: "low", format: zodOutputFormat(PedidoDraft) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `${clientInfo}\n\n${pedidoInfo}\n\n${LEVEL[p.detail_level] ?? LEVEL.completo}\n\nPIEZAS A ESCRIBIR (${input.items.length}):\n\n${pieces}`,
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("La IA no quiso escribir este pedido. Probá cambiar las notas.");
  if (response.stop_reason === "max_tokens") throw new Error("El pedido quedó demasiado largo. Probá con menos piezas.");
  if (!response.parsed_output) throw new Error("La IA no devolvió el pedido en el formato esperado.");
  return response.parsed_output;
}
