// Link del pedido para el cliente: simple, fondo blanco, con el nombre y logo del cliente.
// Arriba: título, descripción, fecha de entrega, dónde entregar (Drive) y adaptaciones.
// Después, un bloque por creativo con la referencia a un costado y el guion al otro. Al final, aclaraciones.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase, type Media } from "../lib.ts";
import { HookVideo } from "./AdCard.tsx";
import "./pedido.css";

type Ref = { page_name: string | null; body: string | null; format: string; media: Media[]; snapshot_url: string; hook: string | null; why_it_works: string | null; days_active: number };
type Item = {
  position: number; code: string | null; title: string | null; format: string | null; angle: string | null; funnel: string | null;
  creative_type: string | null; group_name: string | null; hook: string | null; development: string | null; closing: string | null;
  script: string | null; scene: string | null; headline: string | null; subhead: string | null; recording_tips: string | null;
  duration: string | null; adaptations: string | null; notes: string | null; ref_beats: string | null; ref: Ref | null;
};
type PublicPedido = {
  title: string; objective: string | null; notes: string | null; created_at: string; client: string | null; client_logo: string | null;
  kind: string; event_name: string | null; event_date: string | null; period: string | null; platform: string; detail_level: string;
  deadline: string | null; delivery_url: string | null; formats: string | null; intro: string | null; refs_note: string | null;
  before_notes: string[] | null; items: Item[];
  hook_ads: { page_name: string | null; media: Media[]; hook: string | null; hook_type: string | null }[] | null;
};

const HOOK_SECONDS = 5;


const fmtDate = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });

/** Adaptaciones que siempre se piden, según la plataforma */
export function defaultFormats(platform: string | null | undefined): string {
  if (platform === "TikTok") return "Vertical 9:16";
  if (platform === "Google") return "Horizontal 16:9, cuadrada 1:1 y vertical 9:16";
  return "Vertical 9:16 (historias y reels) y feed 4:5";
}

/** Referencia: video reproducible o imagen; los carruseles se pasan con flechas. */
export function RefMedia({ media }: { media: Media[] }) {
  const [i, setI] = useState(0);
  const m = media[i];
  if (!m) return null;
  return (
    <div className="refmedia">
      {m.type === "video" ? (
        <video key={m.url} controls playsInline preload="metadata" poster={m.thumb ?? undefined} src={m.url} />
      ) : (
        <a href={m.url} target="_blank" rel="noreferrer"><img src={m.url} alt="" loading="lazy" /></a>
      )}
      {media.length > 1 && (
        <>
          <button type="button" className="car-nav prev" onClick={() => setI((i - 1 + media.length) % media.length)} aria-label="Anterior">‹</button>
          <button type="button" className="car-nav next" onClick={() => setI((i + 1) % media.length)} aria-label="Siguiente">›</button>
          <span className="car-count">{i + 1}/{media.length}</span>
        </>
      )}
    </div>
  );
}

/** Hook en video: solo los primeros 5 segundos, en loop, con su propia barra (no deja adelantar). */
function HookClip({ media }: { media: Media[] }) {
  const v = media.find((x) => x.type === "video");
  if (!v) return <RefMedia media={media} />;
  return (
    <div className="hookclip">
      <HookVideo src={v.url} poster={v.thumb ?? undefined} controls />
    </div>
  );
}

function Text({ text }: { text: string }) {
  return <>{text.split(/\n+/).map((l, i) => <p key={i}>{l}</p>)}</>;
}

/** Qué tipo de pieza es: define si lleva guion (video) o indicaciones para armar la imagen o el carrusel */
type Kind = "video" | "image" | "carousel";
function pieceKind(it: Item): Kind {
  const f = (it.format ?? "").toLowerCase();
  if (/carrusel|carousel/.test(f)) return "carousel";
  if (/reel|video|story|historia/.test(f)) return "video";
  if (/imagen|est[aá]tico|feed|post|placa|flyer/.test(f)) return "image";
  if (it.ref?.format === "carousel") return "carousel";
  if (it.ref?.format === "image") return "image";
  if (it.ref?.format === "video") return "video";
  return (it.scene || it.headline) && !it.hook ? "image" : "video";
}
const LABELS: Record<Kind, { main: string; tips: string; scene: string }> = {
  video: { main: "Guion sugerido", tips: "Cómo grabarlo", scene: "Escena" },
  image: { main: "Cómo armar la imagen", tips: "Cómo producirla", scene: "Imagen" },
  carousel: { main: "Cómo armar el carrusel", tips: "Cómo producirlo", scene: "Slides" },
};

export default function PedidoPublic() {
  const { slug } = useParams();
  const [p, setP] = useState<PublicPedido | null | undefined>(undefined);

  useEffect(() => {
    supabase.rpc("get_pedido", { p_slug: slug }).then(({ data }) => setP((data as PublicPedido) ?? null));
  }, [slug]);
  useEffect(() => {
    if (p) document.title = p.title;
  }, [p]);

  if (p === undefined) return <p className="center muted">Cargando…</p>;
  if (p === null) return <p className="center muted">No encontramos este pedido.</p>;

  const formats = p.formats?.trim() || defaultFormats(p.platform);
  const context = p.kind === "evento" ? [p.event_name ?? "Evento", p.event_date && fmtDate(p.event_date)].filter(Boolean).join(" · ") : `Always On${p.period ? ` · ${p.period}` : ""}`;
  const notes = [p.refs_note, ...(p.before_notes ?? [])].filter((x): x is string => !!x && !!x.trim());

  return (
    <div className="ped">
      <div className="band" />
      <div className="wrap">
        <header className="cover">
          <div className="client">
            {p.client_logo && <img src={p.client_logo} alt={p.client ?? ""} />}
            {p.client && <span>{p.client}</span>}
          </div>
          <p className="kick">Pedido de creativos · {context}</p>
          <h1>{p.title}</h1>
          {p.intro && <p className="lead">{p.intro}</p>}

          <div className="facts">
            <div>
              <b>Fecha de entrega</b>
              <span>{p.deadline ? fmtDate(p.deadline) : "A coordinar"}</span>
            </div>
            <div>
              <b>Dónde entregar</b>
              {p.delivery_url ? (
                <a href={p.delivery_url} target="_blank" rel="noreferrer">Carpeta de creativos en Drive ↗</a>
              ) : (
                <span>Carpeta de creativos en Drive</span>
              )}
            </div>
            <div>
              <b>Adaptaciones · {p.platform}</b>
              <span>{formats}</span>
            </div>
            <div>
              <b>Creativos</b>
              <span>{p.items.length}</span>
            </div>
          </div>
        </header>

        <section>
          {p.items.map((it, i) => {
            const kind = pieceKind(it);
            const img = kind !== "video";
            const L = LABELS[kind];
            return (
              <article className="item" key={it.position}>
                <div className="ref">
                  {it.ref ? (
                    <>
                      <RefMedia media={it.ref.media} />
                      <p className="cap">Referencia{it.ref.page_name ? ` · ${it.ref.page_name}` : ""}</p>
                    </>
                  ) : (
                    <div className="noref">Sin referencia</div>
                  )}
                </div>
                <div className="body">
                  <p className="id">
                    Creativo {i + 1}
                    {it.format ? ` · ${it.format}` : ""}
                    {it.duration ? ` · ${it.duration}` : ""}
                  </p>
                  {it.title && <h3>{it.title}</h3>}
                  {it.ref_beats && <p className="beats">{it.ref_beats}</p>}

                  <h4>{L.main}</h4>
                  {img ? (
                    <dl className="script">
                      {it.scene && (<><dt>{L.scene}</dt><dd><Text text={it.scene} /></dd></>)}
                      {it.headline && (<><dt>Titular</dt><dd><Text text={it.headline} /></dd></>)}
                      {it.subhead && (<><dt>Bajada</dt><dd><Text text={it.subhead} /></dd></>)}
                      {!it.scene && !it.headline && it.hook && (<><dt>Idea</dt><dd><Text text={it.hook} /></dd></>)}
                    </dl>
                  ) : (
                    <dl className="script">
                      {it.hook && (<><dt>Hook</dt><dd><Text text={it.hook} /></dd></>)}
                      {it.development && (<><dt>Desarrollo</dt><dd><Text text={it.development} /></dd></>)}
                      {it.closing && (<><dt>Cierre</dt><dd><Text text={it.closing} /></dd></>)}
                      {it.script && !it.hook && (<><dt>Guion</dt><dd><Text text={it.script} /></dd></>)}
                    </dl>
                  )}
                  {!it.hook && !it.scene && !it.headline && !it.script && <p className="muted">{img ? "A definir." : "Guion a definir."}</p>}

                  {it.recording_tips && (
                    <>
                      <h4>{L.tips}</h4>
                      <Text text={it.recording_tips} />
                    </>
                  )}
                  <p className="fmt"><b>Entregar en:</b> {formats}</p>
                </div>
              </article>
            );
          })}
        </section>

        {(p.hook_ads?.length ?? 0) > 0 && (
          <section className="hooks-sec">
            <h2>Hooks sugeridos</h2>
            <p className="muted">Los primeros {HOOK_SECONDS} segundos de cada video: ideas para arrancar cualquiera de los creativos.</p>
            <div className="hook-grid">
              {p.hook_ads!.map((h, k) => (
                <figure key={k}>
                  <HookClip media={h.media} />
                  <figcaption>
                    <span className="id">Hook {k + 1}{h.hook_type ? ` · ${h.hook_type}` : ""}</span>
                    {h.hook && <span>“{h.hook}”</span>}
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        {notes.length > 0 && (
          <section className="notes">
            <h2>Aclaraciones</h2>
            <ul>{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          </section>
        )}

        <footer className="foot">
          <img src="/grownax-logo.png" alt="Grownax" />
          <span>Pedido de creativos{p.client ? ` para ${p.client}` : ""}</span>
        </footer>
      </div>
    </div>
  );
}
