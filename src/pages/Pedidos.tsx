import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, type Client, type Pedido } from "../lib.ts";

export default function Pedidos({ clientId }: { clientId?: string } = {}) {
  const [list, setList] = useState<Pedido[]>([]);
  const [clients, setClients] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let q = supabase.from("pedidos").select("*").order("created_at", { ascending: false });
    if (clientId) q = q.eq("client_id", clientId);
    q.then(({ data }) => setList(data ?? []));
    supabase.from("clients").select("id,name").then(({ data }) => setClients(new Map((data ?? []).map((c: Pick<Client, "id" | "name">) => [c.id, c.name]))));
  }, [clientId]);

  return (
    <div className="card">
      <h2>Pedidos de creativos</h2>
      {list.length === 0 && <p className="muted">Elegí anuncios en la Biblioteca y apretá “Crear pedido de creativos”.</p>}
      <ul className="list">
        {list.map((p) => (
          <li key={p.id}>
            <div>
              <Link to={`/pedidos/${p.id}`}><b>{p.title}</b></Link>
              <div className="muted small">
                {p.client_id ? clients.get(p.client_id) : "Sin cliente"} ·{" "}
                {p.kind === "evento" ? `Evento${p.event_name ? `: ${p.event_name}` : ""}` : `Always On${p.period ? ` · ${p.period}` : ""}`} ·{" "}
                {new Date(p.created_at).toLocaleDateString("es-AR")}
              </div>
            </div>
            <div className="right small">
              {p.artifact_url && <a href={p.artifact_url} target="_blank" rel="noreferrer">Artefacto ↗</a>}
              {p.drive_url && <a href={p.drive_url} target="_blank" rel="noreferrer">Drive ↗</a>}
              <a href={`/p/${p.slug}`} target="_blank" rel="noreferrer">Link cliente ↗</a>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
