// Opcional: si hay ANTHROPIC_API_KEY, Claude filtra el ruido y etiqueta ángulo y gancho de cada anuncio.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const Result = z.object({
  ads: z.array(
    z.object({
      id: z.string(),
      relevant: z.boolean(),
      angle: z.string(),
      hook: z.string(),
      summary: z.string(),
    }),
  ),
});
export type Classification = z.infer<typeof Result>["ads"][number];

const ANGLES = [
  "Precio / promo",
  "Calidad / materiales",
  "Comodidad",
  "Estilo / outfit",
  "Durabilidad",
  "Regalo",
  "Testimonio / UGC",
  "Fabricación / origen",
  "Envío / garantía",
  "Lanzamiento / novedad",
  "Otro",
];

export async function classifyAds(
  rubro: string,
  ads: { id: string; page_name: string | null; body: string | null; title: string | null; format: string }[],
): Promise<Map<string, Classification>> {
  const out = new Map<string, Classification>();
  if (!process.env.ANTHROPIC_API_KEY || ads.length === 0) return out;
  const client = new Anthropic();
  const model = process.env.CLAUDE_MODEL || "claude-haiku-5-5";

  for (let i = 0; i < ads.length; i += 25) {
    const batch = ads.slice(i, i + 25);
    try {
      const response = await client.messages.parse({
        model,
        max_tokens: 8000,
        output_config: { effort: "low", format: zodOutputFormat(Result) },
        system:
          "Sos analista creativo de una agencia de performance. Recibís anuncios de la Biblioteca de Anuncios de Meta encontrados por palabra clave. " +
          "Para cada anuncio decidí si realmente pertenece al rubro pedido (relevant=false si es de otro rubro, por ejemplo una app, una serie o un producto que no tiene nada que ver). " +
          `Elegí el ángulo de comunicación principal entre: ${ANGLES.join(", ")}. ` +
          "En 'hook' describí en pocas palabras el gancho o la promesa principal. En 'summary' resumí en una frase qué muestra o dice el anuncio. Respondé en español rioplatense.",
        messages: [
          {
            role: "user",
            content: `Rubro: ${rubro}\n\nAnuncios (JSON):\n${JSON.stringify(
              batch.map((a) => ({ id: a.id, marca: a.page_name, formato: a.format, titulo: a.title, texto: a.body?.slice(0, 600) })),
            )}`,
          },
        ],
      });
      if (response.stop_reason === "refusal") continue;
      for (const c of response.parsed_output?.ads ?? []) out.set(c.id, c);
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) await new Promise((r) => setTimeout(r, 20000));
      else if (err instanceof Anthropic.APIError) console.warn(`Claude no pudo clasificar un lote (${err.status}): ${err.message}`);
      else throw err;
    }
  }
  return out;
}
