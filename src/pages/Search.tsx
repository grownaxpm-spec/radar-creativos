import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { kickSearch } from "./SearchList.tsx";
import { COUNTRIES, supabase, type Client } from "../lib.ts";


export default function SearchPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const nav = useNavigate();
  const [clientId, setClientId] = useState("");
  const [rubro, setRubro] = useState("");
  const [keywords, setKeywords] = useState("");
  const [countries, setCountries] = useState<string[]>(["AR"]);
  const [media, setMedia] = useState("all");
  const [perQuery, setPerQuery] = useState(50);
  const [recurring, setRecurring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("clients").select("*").order("name").then(({ data }) => setClients(data ?? []));
  }, []);

  // Al elegir un cliente, se completa con su perfil (rubro, palabras clave y competidores)
  useEffect(() => {
    const c = clients.find((x) => x.id === clientId);
    if (!c) return;
    if (c.rubro) setRubro(c.rubro);
    const kw = [...(c.keywords ?? []), ...(c.competitors ?? [])];
    if (kw.length) setKeywords(kw.join("\n"));
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const err = await kickSearch(s.id);
    setBusy(false);
    if (err) setMsg(`La búsqueda quedó guardada, pero no pude arrancarla: ${err}`);
    else nav("/busquedas");
  }

  return (
    <div className="two-col">
      <form className="card" onSubmit={start}>
        <h2>Empezar nueva búsqueda</h2>
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
        <h2>Cómo funciona</h2>
        <ol className="small" style={{ paddingLeft: 18 }}>
          <li>Elegí el cliente: se completan solas sus palabras clave y competidores.</li>
          <li>Apretá <b>Empezar búsqueda</b>. En el historial vas a ver el % de avance.</li>
          <li>La IA descarta lo que no es del rubro, detecta el hook y propone cómo adaptarlo al cliente.</li>
          <li>Cuando diga “Lista”, los anuncios aparecen en la <b>Biblioteca</b> ordenados por puntaje.</li>
        </ol>
      </div>
    </div>
  );
}
