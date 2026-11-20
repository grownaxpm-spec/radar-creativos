// Link del pedido para el cliente: simple, fondo blanco, con el nombre y logo del cliente.
// Arriba: título, descripción, fecha de entrega, dónde entregar (Drive) y adaptaciones.
// Después, un bloque por creativo con la referencia a un costado y el guion al otro. Al final, aclaraciones.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase, type Media } from "../lib.ts";
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
};

const fmtDate = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });

/** Adaptaciones que siempre se piden, según la plataforma */
export function defaultFormats(platform: string | null | undefined): string {
  if (platform === "TikTok") return "Vertical 9:16";
  if (platform === "Google") return "Horizontal 16:9, cuadrada 1:1 y vertical 9:16";
  return "Vertical 9:16 (historias y reels) y feed 4:5";
}

export function RefMedia({ media }: { media: Media[] }) {
  const m = media[0];
  if (!m) return null;
  return m.type === "video" ? (
    <video controls playsInline preload="metadata" poster={m.thumb ?? undefined} src={m.url} />
  ) : (
    <a href={m.url} target="_blank" rel="noreferrer"><img src={m.url} alt="" loading="lazy" /></a>
  );
}

function Text({ text }: { text: string }) {
  return <>{text.split(/\n+/).map((l, i) => <p key={i}>{l}</p>)}</>;
}

const isImage = (it: Item) => (!!(it.scene || it.headline) && !it.hook) || (!it.hook && it.ref != null && it.ref.format !== "video");

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
            const img = isImage(it);
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

                  <h4>Guion sugerido</h4>
                  {img ? (
                    <dl className="script">
                      {it.scene && (<><dt>Imagen</dt><dd><Text text={it.scene} /></dd></>)}
                      {it.headline && (<><dt>Titular</dt><dd><Text text={it.headline} /></dd></>)}
                      {it.subhead && (<><dt>Bajada</dt><dd><Text text={it.subhead} /></dd></>)}
                    </dl>
                  ) : (
                    <dl className="script">
                      {it.hook && (<><dt>Hook</dt><dd><Text text={it.hook} /></dd></>)}
                      {it.development && (<><dt>Desarrollo</dt><dd><Text text={it.development} /></dd></>)}
                      {it.closing && (<><dt>Cierre</dt><dd><Text text={it.closing} /></dd></>)}
                      {it.script && !it.hook && (<><dt>Guion</dt><dd><Text text={it.script} /></dd></>)}
                    </dl>
                  )}
                  {!it.hook && !it.scene && !it.headline && !it.script && <p className="muted">Guion a definir.</p>}

                  {it.recording_tips && (
                    <>
                      <h4>Cómo grabarlo</h4>
                      <Text text={it.recording_tips} />
                    </>
                  )}
                  <p className="fmt"><b>Entregar en:</b> {formats}</p>
                </div>
              </article>
            );
          })}
        </section>

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
