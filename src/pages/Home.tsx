import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, type Pedido } from "../lib.ts";
import SearchList from "./SearchList.tsx";

export default function Home() {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [stats, setStats] = useState({ ads: 0, hooks: 0 });

  useEffect(() => {
    supabase.from("pedidos").select("*").order("created_at", { ascending: false }).limit(5).then(({ data }) => setPedidos((data as Pedido[]) ?? []));
    Promise.all([
      supabase.from("ads").select("id", { count: "exact", head: true }).or("relevant.is.null,relevant.eq.true"),
      supabase.from("ads").select("id", { count: "exact", head: true }).not("hook", "is", null).eq("format", "video"),
    ]).then(([a, h]) => setStats({ ads: a.count ?? 0, hooks: h.count ?? 0 }));
  }, []);

  return (
    <div>
      <section className="hero-panel">
        <div>
          <h1>Referencias de la competencia, listas para pedir piezas.</h1>
          <p className="muted">
            Buscá anuncios del rubro de tu cliente, quedate con los mejores hooks y armá el pedido de creativos con los videos adentro.
          </p>
        </div>
        <Link to="/buscar">
          <button className="big">Empezar nueva búsqueda</button>
        </Link>
      </section>

      <div className="stats">
        <Link to="/biblioteca" className="stat">
          <b>{stats.ads}</b>
          <span>anuncios en la biblioteca</span>
        </Link>
        <Link to="/biblioteca?vista=hooks" className="stat">
          <b>{stats.hooks}</b>
          <span>hooks en video</span>
        </Link>
        <Link to="/pedidos" className="stat">
          <b>{pedidos.length}</b>
          <span>pedidos recientes</span>
        </Link>
      </div>

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
