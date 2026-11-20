import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { COUNTRIES, supabase, type Client, type Search } from "../lib.ts";

const STATUS: Record<string, string> = { pending: "En cola", running: "Buscando…", done: "Lista", error: "Error" };

export default function SearchPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [list, setList] = useState<Search[]>([]);
  const [clientId, setClientId] = useState("");
  const [rubro, setRubro] = useState("");
  const [keywords, setKeywords] = useState("");
  const [countries, setCountries] = useState<string[]>(["AR"]);
  const [media, setMedia] = useState("all");
  const [perQuery, setPerQuery] = useState(50);
  const [recurring, setRecurring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () =>
    supabase.from("searches").select("*").order("created_at", { ascending: false }).limit(30).then(({ data }) => setList(data ?? []));

  useEffect(() => {
    supabase.from("clients").select("*").order("name").then(({ data }) => setClients(data ?? []));
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  // Al elegir un cliente, se completa con su perfil (rubro, palabras clave y competidores)
  useEffect(() => {
    const c = clients.find((x) => x.id === clientId);
    if (!c) return;
    if (c.rubro) setRubro(c.rubro);
    const kw = [...(c.keywords ?? []), ...(c.competitors ?? [])];
    if (kw.length) setKeywords(kw.join("\n"));
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function runNow(id: string) {
    await supabase.from("searches").update({ status: "pending", error: null }).eq("id", id);
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch("/api/start-search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${sess.session?.access_token}` },
      body: JSON.stringify({ search_id: id }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) alert(`No pude arrancarla: ${body.error ?? res.status}`);
    load();
  }

  const kw = keywords.split("\n").map((s) => s.trim()).filter(Boolean);
  const estimate = Math.max(1, kw.length) * countries.length * perQuery;

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { data: s, error } = await supabase
      .from("searches")
      .insert({
        client_id: clientId || null,
        rubro,
        keywords: kw.length ? kw : [rubro],
        countries,
        media_type: media,
        max_per_query: perQuery,
        recurring,
      })
      .select()
      .single();
    if (error || !s) {
      setMsg(error?.message ?? "No pude crear la búsqueda");
      setBusy(false);
      return;
    }
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch("/api/start-search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${sess.session?.access_token}` },
      body: JSON.stringify({ search_id: s.id }),
    });
    const body = await res.json().catch(() => ({}));
    setMsg(
      res.ok
        ? "Búsqueda en marcha. Tarda unos minutos; cuando diga “Lista” la ves en la Biblioteca."
        : `La búsqueda quedó en cola, pero no pude arrancarla ahora (${body.error ?? res.status}). Se corre sola en la próxima pasada diaria.`,
    );
    setBusy(false);
    load();
  }

  return (
    <div className="two-col">
      <form className="card" onSubmit={start}>
        <h2>Nueva búsqueda</h2>
        <label>
          Cliente (opcional)
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">— Sin cliente —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label>
          Rubro
          <input required value={rubro} onChange={(e) => setRubro(e.target.value)} placeholder="Calzado de cuero masculino" />
        </label>
        <label>
          Palabras clave (una por línea)
          <textarea
            rows={5}
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder={"zapatos de cuero hombre\nbotas de cuero\nmocasines\nzapatillas de cuero\nzapatos de vestir"}
          />
          <small className="muted">Si elegís un cliente se completan solas con las palabras clave y competidores de su perfil. Podés sumar o sacar.</small>
        </label>
        <fieldset>
          <legend>Países</legend>
          <div className="country-grid">
            {COUNTRIES.map(([code, name]) => (
              <label key={code} className="check">
                <input
                  type="checkbox"
                  checked={countries.includes(code)}
                  onChange={(e) => setCountries(e.target.checked ? [...countries, code] : countries.filter((c) => c !== code))}
                />
                {name}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="row">
          <label>
            Tipo
            <select value={media} onChange={(e) => setMedia(e.target.value)}>
              <option value="all">Video e imagen</option>
              <option value="video">Solo video</option>
              <option value="image">Solo imagen</option>
            </select>
          </label>
          <label>
            Anuncios por palabra y país
            <input type="number" min={10} max={200} value={perQuery} onChange={(e) => setPerQuery(Number(e.target.value))} />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} /> Repetir cada semana (trae anuncios nuevos solo)
        </label>
        <p className="muted small">
          Hasta ~{estimate} anuncios en total. Con el plan gratis de Apify (USD 5/mes) entran entre 1.000 y 3.000 por mes.
        </p>
        <button type="submit" disabled={busy || countries.length === 0}>
          {busy ? "Arrancando…" : "Empezar búsqueda"}
        </button>
        {msg && <p className="note">{msg}</p>}
      </form>

      <div className="card">
        <h2>Búsquedas</h2>
        {list.length === 0 && <p className="muted">Todavía no hiciste ninguna.</p>}
        <ul className="list">
          {list.map((s) => (
            <li key={s.id}>
              <div>
                <b>{s.rubro}</b> <span className="muted">· {s.countries.join(", ")}</span>
                {s.recurring && <span className="chip light">semanal</span>}
                <div className="muted small">{s.keywords.join(" · ")}</div>
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
                  <div className="small muted">
                    Sigue en cola hace rato. Apretá “Correr ahora” o revisá{" "}
                    <a href="https://github.com/grownaxpm-spec/radar-creativos/actions" target="_blank" rel="noreferrer">GitHub Actions ↗</a>
                  </div>
                )}
                {s.error && <div className="error small">{s.error}</div>}
              </div>
              <div className="right">
                <span className={`status ${s.status}`}>
                  {STATUS[s.status] ?? s.status}
                  {s.status === "running" && s.progress_pct != null ? ` ${s.progress_pct}%` : ""}
                </span>
                {s.status === "done" && <Link to={`/?busqueda=${s.id}`}>{s.total_found} anuncios →</Link>}
                {s.status !== "running" && (
                  <button className="ghost small" onClick={() => runNow(s.id)}>
                    {s.status === "done" ? "Actualizar" : "Correr ahora"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
