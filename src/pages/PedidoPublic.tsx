import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase, type Media } from "../lib.ts";
import { MediaView } from "./AdCard.tsx";

type PublicPedido = {
  title: string;
  objective: string | null;
  notes: string | null;
  created_at: string;
  client: string | null;
  items: {
    position: number;
    piece_name: string | null;
    format: string | null;
    angle: string | null;
    script: string | null;
    notes: string | null;
    ref: { page_name: string | null; body: string | null; format: string; media: Media[]; snapshot_url: string; days_active: number } | null;
  }[];
};

export default function PedidoPublic() {
  const { slug } = useParams();
  const [p, setP] = useState<PublicPedido | null | undefined>(undefined);

  useEffect(() => {
    supabase.rpc("get_pedido", { p_slug: slug }).then(({ data }) => setP((data as PublicPedido) ?? null));
  }, [slug]);

  if (p === undefined) return <p className="center muted">Cargando…</p>;
  if (p === null) return <p className="center muted">No encontramos este pedido.</p>;

  return (
    <div className="public">
      <header className="public-head">
        <div className="muted small">{p.client ?? ""} · {new Date(p.created_at).toLocaleDateString("es-AR")}</div>
        <h1>{p.title}</h1>
        {p.objective && <p><b>Objetivo:</b> {p.objective}</p>}
        {p.notes && <p className="muted">{p.notes}</p>}
        <p className="small muted">{p.items.length} piezas · cada una con su referencia visual y guion sugerido.</p>
      </header>
      {p.items.map((it) => (
        <section className="card piece" key={it.position}>
          <div className="piece-ref">
            {it.ref ? <MediaView media={it.ref.media} compact /> : <div className="media empty" />}
            {it.ref && <div className="small muted">Referencia: {it.ref.page_name}</div>}
          </div>
          <div className="piece-form">
            <h2>{it.position}. {it.piece_name}</h2>
            <div className="chips">
              {it.format && <span className="chip">{it.format}</span>}
              {it.angle && <span className="chip angle">{it.angle}</span>}
            </div>
            {it.script ? <pre className="script">{it.script}</pre> : <p className="muted">Guion a definir.</p>}
            {it.notes && <p><b>Notas:</b> {it.notes}</p>}
          </div>
        </section>
      ))}
    </div>
  );
}
