import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase, type Media } from "../lib.ts";
import { RefMedia } from "./PedidoPublic.tsx";
import "./doc.css";

type RefAd = {
  page_name: string | null; body: string | null; format: string; media: Media[]; snapshot_url: string;
  hook: string | null; hook_type: string | null; angle: string | null; why_it_works: string | null; adaptation: string | null; days_active: number;
};
type RefSet = { title: string; note: string | null; created_at: string; client: string | null; ads: RefAd[] };

/** Link para compartir solo las referencias elegidas, sin armar un pedido. */
export default function RefsPublic() {
  const { slug } = useParams();
  const [r, setR] = useState<RefSet | null | undefined>(undefined);

  useEffect(() => {
    supabase.rpc("get_reference_set", { p_slug: slug }).then(({ data }) => setR((data as RefSet) ?? null));
  }, [slug]);
  useEffect(() => {
    if (r) document.title = r.title;
  }, [r]);

  if (r === undefined) return <p className="center muted">Cargando…</p>;
  if (r === null) return <p className="center muted">No encontramos estas referencias.</p>;

  return (
    <div className="doc">
      <header className="hero">
        <div className="wrap">
          <div className="brandline"><span className="tri" /> Grownax · Referencias</div>
          <h1>{r.client ?? r.title}</h1>
          {r.note && <p className="intro">{r.note}</p>}
          <div className="counts">
            <span><b>{r.ads.length}</b> referencias</span>
            <span>{new Date(r.created_at).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })}</span>
          </div>
        </div>
      </header>
      <section>
        <div className="wrap">
          <h2>Referencias elegidas</h2>
          <p className="sec-intro">Tocá play en los videos. Abajo de cada uno está qué lo hace funcionar y cómo lo podemos adaptar.</p>
          <div className="refs">
            {r.ads.map((a, k) => (
              <article className="ref" key={k}>
                <RefMedia media={a.media} />
                <div className="body">
                  <div className="n">REFERENCIA {k + 1} · {a.page_name} · {a.days_active} DÍAS ACTIVO</div>
                  {a.hook && <h3>“{a.hook}”</h3>}
                  <div className="tags">
                    {a.hook_type && <span className="tag fria">{a.hook_type}</span>}
                    {a.angle && <span className="tag cal">{a.angle}</span>}
                  </div>
                  {a.why_it_works && <p><b>Por qué funciona:</b> {a.why_it_works}</p>}
                  {a.adaptation && <p><b>Cómo adaptarlo:</b> {a.adaptation}</p>}
                  <a className="small" href={a.snapshot_url} target="_blank" rel="noreferrer">Ver en la Biblioteca de Meta ↗</a>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
      <footer>
        <div className="wrap">
          <span><b>Grownax</b> · Referencias{r.client ? ` · ${r.client}` : ""}</span>
        </div>
      </footer>
    </div>
  );
}
