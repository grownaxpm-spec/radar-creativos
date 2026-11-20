import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { kickSearch } from "./SearchList.tsx";
import { COUNTRIES, DEFAULT_COUNTRIES, EVENTS, supabase, type Client } from "../lib.ts";


export default function SearchPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [clientId, setClientId] = useState(params.get("cliente") ?? "");
  const [purpose, setPurpose] = useState("");
  const [brief, setBrief] = useState("");
  const [rubro, setRubro] = useState("");
  const [keywords, setKeywords] = useState("");
  const [countries, setCountries] = useState<string[]>(DEFAULT_COUNTRIES);
  const [media, setMedia] = useState("all");
  const [total, setTotal] = useState(60);
  const [cost, setCost] = useState<{ price: number; budget: number; used: number } | null>(null);
  const [recurring, setRecurring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("clients").select("*").order("name").then(({ data }) => setClients(data ?? []));
    // Cuánto cuesta cada anuncio que trae Apify y cuánto se usó este mes
    Promise.all([supabase.from("settings").select("key, value"), supabase.from("apify_usage_month").select("ads_this_month").single()]).then(([st, us]) => {
      const m = new Map((st.data ?? []).map((r) => [r.key, r.value]));
      setCost({ price: Number(m.get("apify_price_per_1000") ?? 3.4), budget: Number(m.get("monthly_ads_budget") ?? 1400), used: us.data?.ads_this_month ?? 0 });
    });
  }, []);

  // Al elegir un cliente, se completa con su perfil (rubro, palabras clave y competidores)
  useEffect(() => {
    const c = clients.find((x) => x.id === clientId);
    if (!c) return;
    if (c.rubro) setRubro(c.rubro);
    const kw = [...(c.keywords ?? []), ...(c.competitors ?? [])];
    if (kw.length) setKeywords(kw.join("\n"));
  }, [clientId, clients]); // eslint-disable-line react-hooks/exhaustive-deps

  // Palabras clave sin límite: una por línea o separadas por coma
  // Igual que el buscador: trae como mucho ~1,3 veces lo pedido (mínimo 30)
  const willFetch = Math.max(30, Math.round(total * 1.3));
  const overBudget = !!cost && cost.used + willFetch > cost.budget;
  const usd = (n: number) => `USD ${((n * (cost?.price ?? 3.4)) / 1000).toFixed(2)}`;
  const kw = [...new Set(keywords.split(/[\n,]/).map((s) => s.trim()).filter(Boolean))];
  // Para qué es, en palabras: "Black Friday y Cyber Monday", "Hot Sale"… Vacío o "Always On" = todo el año
  const event = /^\s*(always\s*on|aon|todo el año)?\s*$/i.test(purpose) ? null : purpose.trim();
  const toggleEvent = (ev: string) => {
    const parts = purpose.split(/\s*(?:,|\by\b)\s*/i).map((x) => x.trim()).filter(Boolean);
    const has = parts.some((x) => x.toLowerCase() === ev.toLowerCase());
    const next = has ? parts.filter((x) => x.toLowerCase() !== ev.toLowerCase()) : [...parts, ev];
    setPurpose(next.length > 1 ? `${next.slice(0, -1).join(", ")} y ${next[next.length - 1]}` : next.join(""));
  };

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
        max_per_query: Math.max(10, Math.min(100, Math.ceil((total * 1.5) / Math.max(1, (kw.length || 1) * countries.length)))),
        max_total: total,
        event,
        brief: brief.trim() || null,
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
    else nav(clientId ? `/clientes/${clientId}?tab=busquedas` : "/busquedas");
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
          ¿Para qué es? (escribilo como quieras)
          <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Ej.: Black Friday y Cyber Monday · vacío = Always On" />
          <div className="chips-row">
            {EVENTS.map((ev) => (
              <button type="button" key={ev} className={`chip-btn${purpose.toLowerCase().includes(ev.toLowerCase()) ? " on" : ""}`} onClick={() => toggleEvent(ev)}>
                {ev}
              </button>
            ))}
          </div>
          {event && <small className="muted">Con un evento solo entran anuncios 100% de venta directa del rubro: oferta, precio, cuotas, urgencia, llamado a comprar.</small>}
        </label>
        <label>
          Contale a la IA qué buscás (opcional)
          <textarea
            rows={3}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="Ej.: anuncios con regalo por compra o 2x1, mejor si son videos de producto en mano; nada de modelos posando"
          />
          <small className="muted">La IA usa esto para decidir qué anuncios quedan y cuáles descarta.</small>
        </label>
        <label>
          Rubro
          <input required value={rubro} onChange={(e) => setRubro(e.target.value)} placeholder="Calzado de cuero masculino" />
        </label>
        <label>
          Palabras clave o marcas (sin límite: una por línea o separadas por coma)
          <textarea
            rows={5}
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder={"zapatos de cuero hombre\nbotas de cuero\nmocasines\nzapatillas de cuero\nzapatos de vestir"}
          />
          <small className="muted">Si elegís un cliente se completan solas con las palabras clave y competidores de su perfil. Podés sumar o sacar.</small>
        </label>
        <fieldset>
          <legend>Países (de dónde traer contenido)</legend>
          <small className="muted">No se trae una cantidad fija por país: entra lo mejor de cada uno hasta llegar al total.</small>
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
            Cantidad total de anuncios (aprox.)
            <input type="number" min={20} max={1000} step={10} value={total} onChange={(e) => setTotal(Number(e.target.value))} />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} /> Repetir cada semana (trae anuncios nuevos solo)
        </label>
        <p className={`small ${overBudget ? "note" : "muted"}`}>
          Va a traer como mucho unos {willFetch} anuncios de Apify (≈ {usd(willFetch)}).
          {cost && (
            <>
              {" "}Este mes: {cost.used} de {cost.budget} anuncios (≈ {usd(cost.used)} de {usd(cost.budget)}).
              {overBudget && " Con esta búsqueda se pasa del tope: pedí menos anuncios."}
            </>
          )}
          {" "}No repite consultas de las últimas 2 semanas (traerían anuncios que ya tenés).
        </p>
        <button type="submit" disabled={busy || countries.length === 0 || overBudget}>
          {busy ? "Arrancando…" : "Empezar búsqueda"}
        </button>
        {msg && <p className="note">{msg}</p>}
      </form>

      <div className="card">
        <h2>Cómo funciona</h2>
        <ol className="small" style={{ paddingLeft: 18 }}>
          <li>Elegí el cliente: se completan solas sus palabras clave y competidores.</li>
          <li>Apretá <b>Empezar búsqueda</b>. En el historial vas a ver el % de avance.</li>
          <li>La IA descarta lo que no es del rubro, los marketplaces y los anuncios de catálogo, detecta el hook y propone cómo adaptarlo al cliente.</li>
          <li>Si es para un evento (Black Friday, Cyber, Hot Sale…), solo quedan anuncios de venta directa.</li>
          <li>Cuando diga “Lista”, los anuncios aparecen en la <b>Biblioteca</b> ordenados por puntaje.</li>
        </ol>
      </div>
    </div>
  );
}
