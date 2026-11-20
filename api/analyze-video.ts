// Vercel Function: POST /api/analyze-video
// Mira el video completo (imagen + audio) con Gemini por el AI Gateway de Vercel y devuelve
// transcripción, texto en pantalla, hook de los primeros segundos y la estructura escena por escena.
// La llama el robot de Supabase (search-worker) con un secreto compartido; no la llama el navegador.
// Autenticación con Vercel: OIDC automático del deploy (sin claves), o AI_GATEWAY_API_KEY si existe.
import { generateText, Output } from "ai";
import { z } from "zod";

const MODEL = process.env.VIDEO_MODEL || "google/gemini-3-flash";

export const VideoAnalysis = z.object({
  duracion_seg: z.number().describe("Duración aproximada del video en segundos"),
  transcripcion: z.string().describe("Todo lo que se dice en el video, textual, en el idioma original. Vacío si no hay voz."),
  texto_en_pantalla: z.array(z.string()).describe("Textos que aparecen sobreimpresos, en orden"),
  hook_visual: z.string().describe("Qué se ve en los primeros 3 segundos, concreto (plano, acción, producto, persona)"),
  hook_audio: z.string().describe("Primera frase dicha o texto que abre el video. Vacío si no hay."),
  escenas: z
    .array(z.object({ desde_seg: z.number(), hasta_seg: z.number(), descripcion: z.string() }))
    .describe("Estructura del video en tramos: qué se ve y qué pasa en cada uno"),
  tipo_creativo: z.string().describe("UGC, founder-led, testimonial, producto en uso, demostración, lifestyle, estático animado, etc."),
  quien_habla: z.string().describe("Quién aparece o habla (dueño, vendedor, cliente, modelo, voz en off, nadie)"),
  ritmo: z.string().describe("Cantidad aproximada de cortes, ritmo y duración de los planos"),
  audio: z.string().describe("Música, voz en off, sonido ambiente, tendencia"),
  cta: z.string().describe("Cómo cierra y qué pide hacer"),
  por_que_funciona: z.string().describe("1-2 frases concretas sobre por qué este video vende"),
  como_replicarlo: z.string().describe("Cómo lo grabaría el cliente, plano por plano, en 2-4 frases accionables"),
});
export type VideoAnalysis = z.infer<typeof VideoAnalysis>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.VIDEO_SECRET;
  if (!secret || request.headers.get("x-video-secret") !== secret) return json({ error: "No autorizado" }, 401);

  const { video_url, contexto } = (await request.json().catch(() => ({}))) as { video_url?: string; contexto?: string };
  if (!video_url || !/^https:\/\//.test(video_url)) return json({ error: "Falta video_url" }, 400);

  try {
    const { output } = await generateText({
      model: MODEL,
      output: Output.object({ schema: VideoAnalysis }),
      system:
        "Sos director creativo de una agencia de performance en Argentina. Mirás anuncios de video de la competencia " +
        "(imagen y audio completos) y los desarmás para que el equipo los pueda replicar. Sé literal en la transcripción " +
        "y concreto en lo visual: planos, acciones, textos, cortes. Escribí el análisis en español rioplatense, sin relleno.",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `Analizá este anuncio.${contexto ? `\n\nContexto:\n${contexto}` : ""}` },
            { type: "file", mediaType: "video/mp4", data: new URL(video_url) },
          ],
        },
      ],
    });
    return json({ ok: true, model: MODEL, analysis: output });
  } catch (err) {
    return json({ error: (err as Error).message?.slice(0, 500) ?? "Error" }, 502);
  }
}
