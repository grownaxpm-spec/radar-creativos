// Sección de un cliente: su biblioteca de anuncios, sus búsquedas, sus pedidos y su perfil.
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase, type Client } from "../lib.ts";
import Library from "./Library.tsx";
import SearchList from "./SearchList.tsx";
import Pedidos from "./Pedidos.tsx";
import { ClientForm } from "./Clients.tsx";
import Groups from "./Groups.tsx";

type Tab = "biblioteca" | "hooks" | "grupos" | "busquedas" | "pedidos" | "perfil";
const TABS: [Tab, string][] = [
  ["biblioteca", "Biblioteca"],
  ["hooks", "Hooks (5 s)"],
  ["grupos", "Grupos"],
  ["busquedas", "Búsquedas"],
  ["pedidos", "Pedidos"],
  ["perfil", "Perfil del cliente"],
];

export function ClientLogo({ client, size = 40 }: { client: Pick<Client, "name" | "logo_url">; size?: number }) {
  return client.logo_url ? (
    <img className="client-logo" src={client.logo_url} alt={client.name} style={{ height: size }} />
  ) : (
    <span className="client-initial" style={{ width: size, height: size, fontSize: size * 0.45 }}>{client.name.slice(0, 1).toUpperCase()}</span>
  );
}

export default function ClientPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [client, setClient] = useState<Client | null | undefined>(undefined);
  const isNew = id === "nuevo";
  const tab = (params.get("tab") as Tab) || (isNew ? "perfil" : "biblioteca");

  const load = () => {
    if (isNew) return setClient(null);
    supabase.from("clients").select("*").eq("id", id).maybeSingle().then(({ data }) => setClient((data as Client) ?? null));
  };
  useEffect(load, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setTab = (t: Tab) => {
    const p = new URLSearchParams(params);
    p.set("tab", t);
    if (t !== "biblioteca") p.delete("busqueda");
    p.delete("vista");
    setParams(p, { replace: true });
  };

  if (isNew)
    return (
      <div className="card">
        <h2>Nuevo cliente</h2>
        <ClientForm initial={null} onSaved={(newId) => nav(`/clientes/${newId}?tab=perfil`)} onCancel={() => nav("/")} />
      </div>
    );
  if (client === undefined) return <p className="center muted">Cargando…</p>;
  if (client === null) return <p className="center muted">No encontramos este cliente. <Link to="/">Volver al inicio</Link></p>;

  return (
    <div>
      <div className="client-head">
        <ClientLogo client={client} size={44} />
        <div className="grow">
          <h1>{client.name}</h1>
          {client.rubro && <p className="muted small">{client.rubro}</p>}
        </div>
        <Link to={`/buscar?cliente=${client.id}`}>
          <button>Nueva búsqueda</button>
        </Link>
      </div>
      <div className="view-tabs client-tabs">
        {TABS.map(([t, label]) => (
          <button key={t} className={tab === t ? "" : "ghost"} onClick={() => setTab(t)}>{label}</button>
        ))}
      </div>
      {tab === "biblioteca" && <Library key={`${client.id}-lib`} fixedClientId={client.id} />}
      {tab === "hooks" && <Library key={`${client.id}-hooks`} fixedClientId={client.id} hooksOnly />}
      {tab === "grupos" && <Groups client={client} />}
      {tab === "busquedas" && (
        <div className="card">
          <SearchList clientId={client.id} />
        </div>
      )}
      {tab === "pedidos" && <Pedidos clientId={client.id} />}
      {tab === "perfil" && (
        <div className="card">
          <ClientForm initial={client} onSaved={() => load()} />
        </div>
      )}
    </div>
  );
}
