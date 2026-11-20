import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, type Client, type Search } from "../lib.ts";

const STATUS: Record<string, string> = { pending: "En cola", running: "Buscando…", done: "Lista", error: "Error" };

/** Arranca una búsqueda en el robot de Supabase. Devuelve el error (o null si arrancó). */
export async function kickSearch(id: string): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke("search-worker", { body: { action: "start", search_id: id } });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const body = ctx ? await ctx.json().catch(() => null) : null;
    return body?.error ?? error.message;
  }
  return data?.ok === false ? (data.error ?? "No pude arrancarla") : null;
}

/** Lista de búsquedas con su avance en vivo. */
export default function SearchList({ limit = 50, clientId }: { limit?: number; clientId?: string }) {
  const [list, setList] = useState<Search[]>([]);
  const [clients, setClients] = useState<Map<string, string>>(new Map());

  const load = () => {
    let q = supabase.from("searches").select("*").order("created_at", { ascending: false }).limit(limit);
    if (clientId) q = q.eq("client_id", clientId);
    return q.then(({ data }) => {
        setList(data ?? []);
        // Mientras mirás, empujamos al robot para que el avance sea más rápido (igual corre solo cada minuto)
        for (const s of data ?? []) if (s.status === "running") void supabase.functions.invoke("search-worker", { body: { action: "tick", search_id: s.id } });
      });
  };

  useEffect(() => {
    supabase.from("clients").select("id,name").then(({ data }) => setClients(new Map((data ?? []).map((c: Pick<Client, "id" | "name">) => [c.id, c.name]))));
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function runNow(id: string) {
    await supabase.from("searches").update({ status: "pending", error: null, apify_run_id: null, apify_dataset_id: null }).eq("id", id);
    const err = await kickSearch(id);
    if (err) alert(`No pude arrancarla: ${err}`);
    load();
  }

  async function remove(id: string) {
    if (!confirm("¿Borrar esta búsqueda del historial? Los anuncios quedan en la biblioteca.")) return;
    await supabase.from("searches").delete().eq("id", id);
    load();
  }

  if (list.length === 0) return <p className="muted">Todavía no hiciste ninguna búsqueda.</p>;
  return (
    <ul className="list">
      {list.map((s) => (
        <li key={s.id}>
          <div style={{ minWidth: 0 }}>
            <b>{s.client_id ? clients.get(s.client_id) ?? "Cliente" : "Sin cliente"}</b>{" "}
            <span className="muted">· {s.countries.join(", ")} · {new Date(s.created_at).toLocaleDateString("es-AR")}</span>
            {s.event && <span className="chip sale">{s.event}</span>}
            {s.recurring && <span className="chip light">semanal</span>}
            <div className="muted small ellipsis">{s.keywords.join(" · ")}</div>
            {s.status === "running" && (
              <div className="progress-wrap">
                <div className="progress-bar">
                  <div style={{ width: `${s.progress_pct ?? 2}%` }} />
                </div>
                <div className="small muted">
                  <b>{s.progress_pct ?? 0}%</b> · {s.progress ?? "Arrancando…"}
                </div>
              </div>
            )}
            {s.status === "pending" && Date.now() - new Date(s.created_at).getTime() > 10 * 60000 && (
              <div className="small muted">Sigue en cola hace rato. Apretá “Correr ahora”.</div>
            )}
            {s.error && <div className="error small">{s.error}</div>}
          </div>
          <div className="right">
            <span className={`status ${s.status}`}>
              {STATUS[s.status] ?? s.status}
              {s.status === "running" && s.progress_pct != null ? ` ${s.progress_pct}%` : ""}
            </span>
            {s.status === "done" && <Link to={s.client_id ? `/clientes/${s.client_id}?busqueda=${s.id}` : `/biblioteca?busqueda=${s.id}`}>{s.total_found} anuncios →</Link>}
            <div className="row" style={{ gap: 4 }}>
              {s.status !== "running" && (
                <button className="ghost small" onClick={() => runNow(s.id)}>
                  {s.status === "done" ? "Actualizar" : "Correr ahora"}
                </button>
              )}
              <button className="ghost small icon" title="Borrar del historial" onClick={() => remove(s.id)}>✕</button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
