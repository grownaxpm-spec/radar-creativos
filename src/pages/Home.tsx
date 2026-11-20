import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, type Client } from "../lib.ts";

/** Inicio: un cuadrito por cliente. Al tocarlo se entra a su sección. */
export default function Home() {
  const [clients, setClients] = useState<Client[] | null>(null);

  useEffect(() => {
    supabase.from("clients").select("*").order("name").then(({ data }) => setClients((data as Client[]) ?? []));
  }, []);

  return (
    <section className="home-clients">
      <p className="kicker">Grownax · Pedido de creativos</p>
      <h1>¿Para qué cliente trabajamos hoy?</h1>
      <div className="client-grid">
        {(clients ?? []).map((c) => (
          <Link key={c.id} to={`/clientes/${c.id}`} className="client-tile">
            <b>{c.name}</b>
          </Link>
        ))}
        <Link to="/clientes/nuevo" className="client-tile add">
          <b>+ Nuevo cliente</b>
        </Link>
      </div>
    </section>
  );
}
