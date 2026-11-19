import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { HOOK_TYPES, supabase, type Ad, type Client, type Search } from "../lib.ts";
import { useSelection } from "../App.tsx";
import AdCard from "./AdCard.tsx";

const PAGE = 60;

export default function Library() {
  const nav = useNavigate();
  const sel = useSelection();
  const [ads, setAds] = useState<Ad[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [searches, setSearches] = useState<Search[]>([]);
  const [saves, setSaves] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [creating, setCreating] = useState(false);

  // filtros
  const [searchId, setSearchId] = useState(() => new URLSearchParams(location.search).get("busqueda") ?? "");
  const [clientId, setClientId] = useState("");
  const [onlySaved, setOnlySaved] = useState(false);
  const [format, setFormat] = useState("");
  const [country, setCountry] = useState("");
  const [order, setOrder] = useState<"score" | "days" | "recent">("score");
  const [hookType, setHookType] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    supabase.from("clients").select("*").order("name").then(({ data }) => setClients(data ?? []));
    supabase.from("searches").select("*").order("created_at", { ascending: false }).limit(50).then(({ data }) => setSearches(data ?? []));
  }, []);

  // guardados del cliente elegido (o favoritos generales)
  useEffect(() => {
    let query = supabase.from("saves").select("ad_id");
    query = clientId ? query.eq("client_id", clientId) : query.is("client_id", null);
    query.then(({ data }) => setSaves(new Set((data ?? []).map((r) => r.ad_id))));
  }, [clientId]);

  useEffect(() => setPage(0), [searchId, clientId, onlySaved, format, country, order, q, hookType]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      // "Solo guardados" lee de saved_ads; una búsqueda puntual, de search_ads; si no, de toda la biblioteca.
      let query = onlySaved
        ? supabase.from("saved_ads").select("*")
        : searchId
          ? supabase.from("search_ads").select("*").eq("search_id", searchId)
          : supabase.from("ads_view").select("*");
      query = query.or("relevant.is.null,relevant.eq.true");
      if (onlySaved) query = clientId ? query.eq("saved_client_id", clientId) : query.is("saved_client_id", null);
      if (onlySaved && searchId) {
        const { data } = await supabase.from("search_results").select("ad_id").eq("search_id", searchId);
        query = query.in("id", (data ?? []).map((r) => r.ad_id));
      }
      if (format) query = query.eq("format", format);
      if (hookType) query = query.eq("hook_type", hookType);
      if (country) query = query.contains("countries", [country]);
      if (q.trim()) query = query.or(`body.ilike.%${q.trim()}%,page_name.ilike.%${q.trim()}%`);
      query =
        order === "score"
          ? query.order("score", { ascending: false, nullsFirst: false }).order("days_active", { ascending: false })
          : order === "days"
            ? query.order("days_active", { ascending: false, nullsFirst: false })
            : query.order("first_seen", { ascending: false });
      const { data } = await query.range(page * PAGE, page * PAGE + PAGE);
      if (cancelled) return;
      const rows = (data ?? []) as Ad[];
      setMore(rows.length > PAGE);
      setAds((prev) => (page === 0 ? rows.slice(0, PAGE) : [...prev, ...rows.slice(0, PAGE)]));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [searchId, onlySaved, clientId, onlySaved ? saves : null, format, country, order, q, page, hookType]);

  async function toggleSave(ad: Ad) {
    const has = saves.has(ad.id);
    const next = new Set(saves);
    if (has) {
      next.delete(ad.id);
      let del = supabase.from("saves").delete().eq("ad_id", ad.id);
      del = clientId ? del.eq("client_id", clientId) : del.is("client_id", null);
      await del;
    } else {
      next.add(ad.id);
      await supabase.from("saves").insert({ ad_id: ad.id, client_id: clientId || null });
    }
    setSaves(next);
  }

  async function createPedido() {
    setCreating(true);
    const client = clients.find((c) => c.id === clientId);
    const { data: p, error } = await supabase
      .from("pedidos")
      .insert({ title: `Pedido de piezas${client ? ` — ${client.name}` : ""}`, client_id: clientId || null })
      .select()
      .single();
    if (error || !p) {
      alert(error?.message ?? "No pude crear el pedido");
      setCreating(false);
      return;
    }
    const { data: selAds } = await supabase.from("ads").select("id, format, angle").in("id", sel.ids);
    const byId = new Map((selAds ?? []).map((a) => [a.id, a]));
    await supabase.from("pedido_items").insert(
      sel.ids.map((id, i) => ({
        pedido_id: p.id,
        ad_id: id,
        position: i + 1,
        piece_name: `Pieza ${i + 1}`,
        format: byId.get(id)?.format === "video" ? "Reel 9:16" : "Feed 4:5",
        angle: byId.get(id)?.angle ?? null,
      })),
    );
    sel.clear();
    nav(`/pedidos/${p.id}`);
  }

  const countriesSeen = useMemo(() => [...new Set(ads.flatMap((a) => a.countries))].sort(), [ads]);
  const clientName = clients.find((c) => c.id === clientId)?.name;

  return (
    <div>
      <div className="filters">
        <select value={searchId} onChange={(e) => setSearchId(e.target.value)}>
          <option value="">Todas las búsquedas</option>
          {searches.map((s) => (
            <option key={s.id} value={s.id}>
              {s.rubro} · {s.countries.join(", ")} ({s.total_found})
            </option>
          ))}
        </select>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)} title="Al guardar con ☆ se guarda en la biblioteca de este cliente">
          <option value="">Favoritos generales</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              Biblioteca de {c.name}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={onlySaved} onChange={(e) => setOnlySaved(e.target.checked)} /> Solo guardados
        </label>
        <select value={format} onChange={(e) => setFormat(e.target.value)}>
          <option value="">Video e imagen</option>
          <option value="video">Solo video</option>
          <option value="image">Solo imagen</option>
          <option value="carousel">Solo carrusel</option>
        </select>
        <select value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="">Todos los países</option>
          {countriesSeen.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select value={hookType} onChange={(e) => setHookType(e.target.value)}>
          <option value="">Todos los hooks</option>
          {HOOK_TYPES.map((h) => (
            <option key={h}>{h}</option>
          ))}
        </select>
        <select value={order} onChange={(e) => setOrder(e.target.value as "score" | "days" | "recent")}>
          <option value="score">Mejor puntaje primero</option>
          <option value="days">Más días activo primero</option>
          <option value="recent">Más nuevos primero</option>
        </select>
        <input placeholder="Buscar en el texto o la marca…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {!loading && ads.length === 0 && (
        <div className="empty-state">
          <p>Todavía no hay anuncios acá.</p>
          <button onClick={() => nav("/buscar")}>Empezar una búsqueda</button>
        </div>
      )}

      <div className="grid">
        {ads.map((ad) => (
          <AdCard
            key={ad.id}
            ad={ad}
            selected={sel.ids.includes(ad.id)}
            saved={saves.has(ad.id)}
            onSelect={() => sel.toggle(ad.id)}
            onSave={() => toggleSave(ad)}
          />
        ))}
      </div>
      {loading && <p className="center muted">Cargando…</p>}
      {more && !loading && (
        <div className="center">
          <button className="ghost" onClick={() => setPage(page + 1)}>
            Cargar más
          </button>
        </div>
      )}

      {sel.ids.length > 0 && (
        <div className="tray">
          <span>
            <b>{sel.ids.length}</b> elegidos{clientName ? ` para ${clientName}` : ""}
          </span>
          <button className="ghost small" onClick={sel.clear}>
            Limpiar
          </button>
          <button onClick={createPedido} disabled={creating}>
            {creating ? "Creando…" : "Crear pedido de piezas →"}
          </button>
        </div>
      )}
    </div>
  );
}
