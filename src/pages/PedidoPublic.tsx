import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase, type Media } from "../lib.ts";
import "./doc.css";

type Ref = { page_name: string | null; body: string | null; format: string; media: Media[]; snapshot_url: string; hook: string | null; why_it_works: string | null; days_active: number };
type Item = {
  position: number; code: string | null; title: string | null; format: string | null; angle: string | null; funnel: string | null;
  creative_type: string | null; group_name: string | null; hook: string | null; development: string | null; closing: string | null;
  script: string | null; scene: string | null; headline: string | null; subhead: string | null; recording_tips: string | null;
  duration: string | null; adaptations: string | null; notes: string | null; ref_beats: string | null; ref: Ref | null;
};
type PublicPedido = {
  title: string; objective: string | null; notes: string | null; created_at: string; client: string | null; kind: string;
  event_name: string | null; event_date: string | null; period: string | null; platform: string; detail_level: string;
  deadline: string | null; intro: string | null; refs_note: string | null;
  hooks: { hook: string; tipo?: string; por_que?: string }[]; specs: { titulo: string; items: string[] }[]; before_notes: string[];
  items: Item[];
};

const isImage = (it: Item) => !!(it.scene || it.headline) && !it.hook;
const fmtDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });

export function RefMedia({ media }: { media: Media[] }) {
  const m = media[0];
  if (!m) return null;
  return m.type === "video" ? (
    <video controls playsInline preload="metadata" poster={m.thumb ?? undefined} src={m.url} />
  ) : (
    <a href={m.url} target="_blank" rel="noreferrer"><img src={m.url} alt="" loading="lazy" /></a>
  );
}

function Lines({ text }: { text: string }) {
  return <>{text.split(/\n+/).map((l, i) => <p key={i}>{l}</p>)}</>;
}

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

  const level = p.detail_level ?? "completo";
  const videos = p.items.filter((i) => !isImage(i));
  const images = p.items.filter((i) => isImage(i));
  const refs = p.items.filter((i) => i.ref);
  const groups = new Map<string, Item[]>();
  for (const it of videos) groups.set(it.group_name ?? "", [...(groups.get(it.group_name ?? "") ?? []), it]);
  let step = 0;

  return (
    <div className="doc">
      <header className="hero">
        <div className="wrap">
          <div className="brandline"><span className="tri" /> Grownax · Pedido de creativos</div>
          <div className="kicker">
            {p.kind === "evento" ? `${p.event_name ?? "Evento"}${p.event_date ? ` · ${fmtDate(p.event_date)}` : ""}` : `Always On${p.period ? ` · ${p.period}` : ""}`}
          </div>
          <h1>{p.client ?? p.title}</h1>
          {p.intro && <p className="intro">{p.intro}</p>}
          <div className="counts">
            {videos.length > 0 && <span><b>{videos.length}</b> videos</span>}
            {images.length > 0 && <span><b>{images.length}</b> imágenes</span>}
            <span>{p.platform}</span>
            {p.deadline && <span>Entrega <b>{fmtDate(p.deadline)}</b></span>}
          </div>
        </div>
      </header>

      {refs.length > 0 && (
        <section>
          <div className="wrap">
            <div className="step"><span className="n">{++step}</span><span className="lbl">Mirá las referencias</span></div>
            <h2>Lo que vamos a tomar como referencia</h2>
            <p className="sec-intro">Tocá play en cada una: lo que hay que replicar es la estructura, no el texto exacto.</p>
            <div className="refs">
              {refs.map((it) => (
                <article className="ref" key={it.position}>
                  <RefMedia media={it.ref!.media} />
                  <div className="body">
                    <div className="n">REFERENCIA {it.code ?? it.position} · {it.ref!.page_name}</div>
                    <h3>{it.title}</h3>
                    {it.ref_beats ? <Lines text={it.ref_beats} /> : it.ref!.why_it_works && <p>{it.ref!.why_it_works}</p>}
                    {it.ref!.hook && <p className="muted small">Hook original: “{it.ref!.hook}”</p>}
                  </div>
                </article>
              ))}
            </div>
            {p.refs_note && <div className="callout"><b>Lo que no cambia en ninguna.</b> {p.refs_note}</div>}
          </div>
        </section>
      )}

      {videos.length > 0 && (
        <section className="alt">
          <div className="wrap">
            <div className="step"><span className="n">{++step}</span><span className="lbl">Grabá</span></div>
            <h2>Los {videos.length} videos</h2>
            <p className="sec-intro">Tocá cualquiera para abrir el guion completo.</p>
            {[...groups.entries()].map(([g, list]) => (
              <div className="group" key={g || "all"}>
                {g && <h3>{g}</h3>}
                <div className="rows">
                  {list.map((it, k) => (
                    <details className="row" key={it.position} open={k === 0 && !g}>
                      <summary>
                        <span className="code">{it.code ?? `V${it.position}`}</span>
                        <span className="t">{it.title}</span>
                        {it.funnel && <span className={`tag ${it.funnel === "caliente" ? "cal" : "fria"}`}>{it.funnel === "caliente" ? "CALIENTE" : "FRÍA"}</span>}
                        <span className="chev"><span className="more">VER GUIÓN</span><span className="less">CERRAR</span></span>
                      </summary>
                      <div className="rowbody">
                        {it.ref && (
                          <div className="inline-ref">
                            <RefMedia media={it.ref.media} />
                            <span className="muted small">Referencia: {it.ref.page_name}</span>
                          </div>
                        )}
                        <dl className="script">
                          {it.hook && <><dt>Hook</dt><dd><Lines text={it.hook} /></dd></>}
                          {it.development && <><dt>Desarrollo</dt><dd><Lines text={it.development} /></dd></>}
                          {it.closing && <><dt>Cierre</dt><dd><Lines text={it.closing} /></dd></>}
                          {!it.hook && it.script && <><dt>Guion</dt><dd><Lines text={it.script} /></dd></>}
                          {level !== "guion" && it.recording_tips && <><dt>Cómo grabar</dt><dd><Lines text={it.recording_tips} /></dd></>}
                          {it.notes && <><dt>Notas</dt><dd><Lines text={it.notes} /></dd></>}
                        </dl>
                        <div className="foot">
                          {it.duration && level !== "guion" && <span><b>Duración</b> {it.duration}</span>}
                          {it.format && <span><b>Formato</b> {it.format}</span>}
                          {level === "completo" && it.angle && <span><b>Ángulo</b> {it.angle}</span>}
                          {level === "completo" && it.creative_type && <span><b>Tipo</b> {it.creative_type}</span>}
                          {level === "completo" && it.adaptations && <span><b>Adaptaciones</b> {it.adaptations}</span>}
                        </div>
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {images.length > 0 && (
        <section>
          <div className="wrap">
            <div className="step"><span className="n">{++step}</span><span className="lbl">Diseñá</span></div>
            <h2>Las {images.length} imágenes</h2>
            <div className="rows" style={{ marginTop: 20 }}>
              {images.map((it) => (
                <details className="row" key={it.position}>
                  <summary>
                    <span className="code">{it.code ?? `IMG${it.position}`}</span>
                    <span className="t">{it.title}</span>
                    {it.funnel && <span className={`tag ${it.funnel === "caliente" ? "cal" : "fria"}`}>{it.funnel === "caliente" ? "CALIENTE" : "FRÍA"}</span>}
                    <span className="chev"><span className="more">VER</span><span className="less">CERRAR</span></span>
                  </summary>
                  <div className="rowbody">
                    {it.ref && (
                      <div className="inline-ref">
                        <RefMedia media={it.ref.media} />
                        <span className="muted small">Referencia: {it.ref.page_name}</span>
                      </div>
                    )}
                    <dl className="script">
                      {it.scene && <><dt>Escena</dt><dd><Lines text={it.scene} /></dd></>}
                      {it.headline && <><dt>Titular</dt><dd><p>{it.headline}</p></dd></>}
                      {it.subhead && <><dt>Bajada</dt><dd><p>{it.subhead}</p></dd></>}
                      {level !== "guion" && it.recording_tips && <><dt>Cómo hacerla</dt><dd><Lines text={it.recording_tips} /></dd></>}
                      {it.notes && <><dt>Notas</dt><dd><Lines text={it.notes} /></dd></>}
                    </dl>
                    <div className="foot">
                      {it.format && <span><b>Formato</b> {it.format}</span>}
                      {level === "completo" && it.angle && <span><b>Ángulo</b> {it.angle}</span>}
                      {level === "completo" && it.adaptations && <span><b>Adaptaciones</b> {it.adaptations}</span>}
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>
      )}

      {p.hooks.length > 0 && (
        <section className="alt">
          <div className="wrap">
            <div className="step"><span className="n">{++step}</span><span className="lbl">Hooks</span></div>
            <h2>Hooks sugeridos para el rubro</h2>
            <p className="sec-intro">Para abrir cualquier video o para probar variantes de las piezas de arriba.</p>
            <ol className="hooks">
              {p.hooks.filter((h) => h.hook).map((h, k) => (
                <li key={k}>
                  <p className="h">“{h.hook}”</p>
                  <p className="muted small">{[h.tipo, h.por_que].filter(Boolean).join(" · ")}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      {level === "completo" && (p.specs.length > 0 || p.before_notes.length > 0) && (
        <section>
          <div className="wrap">
            {p.specs.length > 0 && (
              <>
                <h2>Cómo se entrega</h2>
                <div className="specs">
                  {p.specs.map((s, k) => (
                    <div className="spec" key={k}>
                      <h3>{s.titulo}</h3>
                      <ul>{s.items.map((x, i) => <li key={i}>{x}</li>)}</ul>
                    </div>
                  ))}
                </div>
              </>
            )}
            {p.before_notes.filter(Boolean).length > 0 && (
              <>
                <hr className="rule" />
                <h2>Antes de grabar</h2>
                <ol className="notes">{p.before_notes.filter(Boolean).map((n, k) => <li key={k}>{n}</li>)}</ol>
              </>
            )}
          </div>
        </section>
      )}

      <footer>
        <div className="wrap">
          <span><b>Grownax</b> · Pedido de creativos{p.client ? ` · ${p.client}` : ""}</span>
          <span>{p.title}</span>
        </div>
      </footer>
    </div>
  );
}
