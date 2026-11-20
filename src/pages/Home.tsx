import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, type Client, type Pedido } from "../lib.ts";
import SearchList from "./SearchList.tsx";
import { ClientLogo } from "./ClientPage.tsx";

export default function Home() {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [clients, setClients] = useState<Client[] | null>(null);

  useEffect(() => {
    supabase.from("clients").select("*").order("name").then(({ data }) => setClients((data as Client[]) ?? []));
    supabase.from("pedidos").select("*").order("created_at", { ascending: false }).limit(5).then(({ data }) => setPedidos((data as Pedido[]) ?? []));
  }, []);

  return (
    <div>
      <section className="home-clients">
        <p className="kicker">Grownax · Pedido de creativos</p>
        <h1>¿Para qué cliente trabajamos hoy?</h1>
        <div className="client-grid">
          {(clients ?? []).map((c) => (
            <Link key={c.id} to={`/clientes/${c.id}`} className="client-tile">
              <ClientLogo client={c} size={48} />
              <b>{c.name}</b>
              {c.rubro && <span className="muted small">{c.rubro}</span>}
            </Link>
          ))}
          <Link to="/clientes/nuevo" className="client-tile add">
            <span className="client-initial" style={{ width: 48, height: 48, fontSize: 24 }}>+</span>
            <b>Nuevo cliente</b>
          </Link>
        </div>
      </section>

      <div className="two-col">
        <div className="card">
          <div className="row between">
            <h2 style={{ margin: 0 }}>Últimas búsquedas</h2>
            <Link to="/busquedas" className="small">Ver historial →</Link>
          </div>
          <SearchList limit={5} />
        </div>
        <div className="card">
          <div className="row between">
            <h2 style={{ margin: 0 }}>Últimos pedidos de creativos</h2>
            <Link to="/pedidos" className="small">Ver todos →</Link>
          </div>
          {pedidos.length === 0 && <p className="muted">Elegí anuncios en la Biblioteca y apretá “Crear pedido”.</p>}
          <ul className="list">
            {pedidos.map((p) => (
              <li key={p.id}>
                <div>
                  <Link to={`/pedidos/${p.id}`}><b>{p.title}</b></Link>
                  <div className="muted small">
                    {p.kind === "evento" ? `Evento${p.event_name ? `: ${p.event_name}` : ""}` : `Always On${p.period ? ` · ${p.period}` : ""}`} ·{" "}
                    {new Date(p.created_at).toLocaleDateString("es-AR")}
                  </div>
                </div>
                <a className="small" href={`/p/${p.slug}`} target="_blank" rel="noreferrer">Link cliente ↗</a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
