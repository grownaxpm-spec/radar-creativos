import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ANGLES, HOOK_TYPES, formatLabel, supabase, type Ad, type Client, type Search } from "../lib.ts";
import { useSelection } from "../App.tsx";
import AdCard, { AdModal } from "./AdCard.tsx";
import PedidoDialog from "./PedidoDialog.tsx";
import GroupDialog from "./GroupDialog.tsx";

const PAGE = 90;
type GroupBy = "" | "angle" | "page_name" | "hook_type" | "format";
const GROUPS: [GroupBy, string][] = [
  ["", "Sin agrupar"],
  ["angle", "Por ángulo publicitario"],
  ["page_name", "Por marca"],
  ["hook_type", "Por tipo de hook"],
  ["format", "Por formato"],
];

/** Biblioteca de anuncios. Con `fixedClientId` (sección del cliente) muestra solo los anuncios de ese cliente. */
export default function Library({ fixedClientId, hooksOnly }: { fixedClientId?: string; hooksOnly?: boolean } = {}) {
  const nav = useNavigate();
  const sel = useSelection();
  const [params, setParams] = useSearchParams();
  const [ads, setAds] = useState<Ad[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [searches, setSearches] = useState<Search[]>([]);
  const [saves, setSaves] = useState<Set<string>>(new Set());
  const [discards, setDiscards] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<Ad | null>(null);
  const [dialog, setDialog] = useState(false);
  const [groupDialog, setGroupDialog] = useState(false);
  const [shared, setShared] = useState<string | null>(null);

  // filtros (la vista y la búsqueda quedan en la URL para poder compartir el link)
  const hookMode = hooksOnly || params.get("vista") === "hooks";
  const searchId = params.get("busqueda") ?? "";
  const [clientIdState, setClientId] = useState(() => {
    try {
      return localStorage.getItem("cliente") ?? "";
    } catch {
      return "";
    }
  });
  const clientId = fixedClientId ?? clientIdState;
  const [used, setUsed] = useState<Set<string>>(new Set());
  const [hideUsed, setHideUsed] = useState(false);
  const [onlySale, setOnlySale] = useState(false);
  const [onlySaved, setOnlySaved] = useState(false);
  const [format, setFormat] = useState("");
  const [angle, setAngle] = useState("");
  const [hookType, setHookType] = useState("");
  const [order, setOrder] = useState<"score" | "days" | "recent">("score");
  const [groupBy, setGroupBy] = useState<GroupBy>("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);

  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };

  useEffect(() => {
    supabase.from("clients").select("*").order("name").then(({ data }) => setClients((data as Client[]) ?? []));
    let sq = supabase.from("searches").select("*").order("created_at", { ascending: false }).limit(50);
    if (fixedClientId) sq = sq.eq("client_id", fixedClientId);
    sq.then(({ data }) => setSearches(data ?? []));
  }, [fixedClientId]);

  // Cliente activo: define favoritos y descartados
  useEffect(() => {
    try {
      if (!fixedClientId) localStorage.setItem("cliente", clientId);
    } catch {
      /* sin almacenamiento */
    }
    // Anuncios que ya se usaron en pedidos de este cliente (como referencia o como hook)
    if (clientId)
      supabase.from("used_ads").select("ad_id").eq("client_id", clientId).then(({ data }) => setUsed(new Set((data ?? []).map((r) => r.ad_id))));
    else setUsed(new Set());
    let sq = supabase.from("saves").select("ad_id");
    sq = clientId ? sq.eq("client_id", clientId) : sq.is("client_id", null);
    sq.then(({ data }) => setSaves(new Set((data ?? []).map((r) => r.ad_id))));
    // Los descartes generales valen para todos; los del cliente, solo para ese cliente
    let dq = supabase.from("discards").select("ad_id, client_id");
    dq = clientId ? dq.or(`client_id.is.null,client_id.eq.${clientId}`) : dq.is("client_id", null);
    dq.then(({ data }) => setDiscards(new Set((data ?? []).map((r) => r.ad_id))));
  }, [clientId]);

  useEffect(() => setPage(0), [searchId, clientId, onlySaved, format, angle, hookType, order, q, hookMode, onlySale]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let query = onlySaved
        ? supabase.from("saved_ads").select("*")
        : searchId
          ? supabase.from("search_ads").select("*").eq("search_id", searchId)
          : fixedClientId
            ? supabase.from("client_ads").select("*").eq("client_id", fixedClientId)
            : supabase.from("ads_view").select("*");
      query = query.or("relevant.is.null,relevant.eq.true");
      if (onlySaved) query = clientId ? query.eq("saved_client_id", clientId) : query.is("saved_client_id", null);
      if (onlySaved && searchId) {
        const { data } = await supabase.from("search_results").select("ad_id").eq("search_id", searchId);
        query = query.in("id", (data ?? []).map((r) => r.ad_id));
      }
      if (hookMode) query = query.eq("format", "video").not("hook", "is", null);
      else if (format) query = query.eq("format", format);
      if (angle) query = query.eq("angle", angle);
      if (onlySale) query = query.eq("direct_sale", true);
      if (hookType) query = query.eq("hook_type", hookType);
      if (q.trim()) query = query.or(`body.ilike.%${q.trim()}%,page_name.ilike.%${q.trim()}%,hook.ilike.%${q.trim()}%`);
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
  }, [searchId, onlySaved, clientId, onlySaved ? saves : null, format, angle, hookType, order, q, page, hookMode, onlySale]);

  const visible = useMemo(
    () => ads.filter((a) => !discards.has(a.id) && !(hideUsed && used.has(a.id))),
    [ads, discards, hideUsed, used],
  );
  const groups = useMemo(() => {
    if (!groupBy || hookMode) return [["", visible]] as [string, Ad[]][];
    const m = new Map<string, Ad[]>();
    for (const a of visible) {
      const raw = (a as Record<string, any>)[groupBy] as string | null;
      const k = groupBy === "format" && raw ? formatLabel(raw) : raw || "Sin clasificar";
      m.set(k, [...(m.get(k) ?? []), a]);
    }
    return [...m.entries()].sort((x, y) => y[1].length - x[1].length);
  }, [visible, groupBy, hookMode]);

  async function toggleSave(ad: Ad) {
    const next = new Set(saves);
    if (saves.has(ad.id)) {
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

  async function discard(ad: Ad) {
    setDiscards(new Set([...discards, ad.id]));
    if (sel.ids.includes(ad.id)) sel.toggle(ad.id);
    if (sel.hookIds.includes(ad.id)) sel.toggleHook(ad.id);
    // Si se descarta desde la vista grande, sigue con el próximo anuncio en vez de cerrar
    if (open?.id === ad.id) {
      const flat = groups.flatMap(([, l]) => l);
      const i = flat.findIndex((a) => a.id === ad.id);
      setOpen(flat[i + 1] ?? flat[i - 1] ?? null);
    }
    await supabase.from("discards").upsert({ ad_id: ad.id, client_id: clientId || null }, { onConflict: "ad_id,client_id" });
  }

  async function shareRefs() {
    const client = clients.find((c) => c.id === clientId);
    const { data, error } = await supabase
      .from("reference_sets")
      .insert({ title: `Referencias${client ? ` para ${client.name}` : ""}`, client_id: clientId || null, ad_ids: sel.ids })
      .select("slug")
      .single();
    if (error || !data) return alert(error?.message ?? "No pude crear el link");
    const url = `${window.location.origin}/r/${data.slug}`;
    setShared(url);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* el link queda visible igual */
    }
  }

  const countriesSeen = useMemo(() => [...new Set(ads.flatMap((a) => a.countries))].sort(), [ads]);
  const clientName = clients.find((c) => c.id === clientId)?.name;

  return (
    <div>
      <div className="view-tabs">
        {!fixedClientId && (
          <>
            <button className={!hookMode ? "" : "ghost"} onClick={() => setParam("vista", "")}>Anuncios</button>
            <button className={hookMode ? "" : "ghost"} onClick={() => setParam("vista", "hooks")}>Solo hooks (5 s)</button>
          </>
        )}
        <span className="muted small">
          {hookMode
            ? "Cada video se reproduce solo en sus primeros 5 segundos. Marcá “Hook” en los mejores para sumarlos al pedido."
            : "Tocá el video para verlo en grande con el análisis. Marcá “Ref” para usarlo de referencia y “Hook” para los hooks sugeridos."}
        </span>
      </div>

      {!hookMode && (
      <div className="filters">
        {!fixedClientId && (
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} title="Cliente activo: define favoritos y descartados">
            <option value="">Sin cliente (general)</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>Trabajando para {c.name}</option>
            ))}
          </select>
        )}
        <select value={searchId} onChange={(e) => setParam("busqueda", e.target.value)}>
          <option value="">Todas las búsquedas</option>
          {searches.map((s) => (
            <option key={s.id} value={s.id}>
              {new Date(s.created_at).toLocaleDateString("es-AR")} · {s.countries.join(", ")} ({s.total_found})
            </option>
          ))}
        </select>
        <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
          {GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={angle} onChange={(e) => setAngle(e.target.value)}>
          <option value="">Todos los ángulos</option>
          {ANGLES.map((a) => <option key={a}>{a}</option>)}
        </select>
        <select value={hookType} onChange={(e) => setHookType(e.target.value)}>
          <option value="">Todos los hooks</option>
          {HOOK_TYPES.map((h) => <option key={h}>{h}</option>)}
        </select>
        {!hookMode && (
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="">Video, imagen y carrusel</option>
            <option value="video">Solo video</option>
            <option value="image">Solo imagen</option>
            <option value="carousel">Solo carrusel</option>
          </select>
        )}
        <select value={order} onChange={(e) => setOrder(e.target.value as "score" | "days" | "recent")}>
          <option value="score">Mejor puntaje primero</option>
          <option value="days">Más días activo primero</option>
          <option value="recent">Más nuevos primero</option>
        </select>
        <label className="check">
          <input type="checkbox" checked={onlySaved} onChange={(e) => setOnlySaved(e.target.checked)} /> Solo favoritos
        </label>
        <label className="check" title="Anuncios con oferta, precio o llamado a comprar">
          <input type="checkbox" checked={onlySale} onChange={(e) => setOnlySale(e.target.checked)} /> Solo venta directa
        </label>
        {clientId && (
          <label className="check" title="Esconde los anuncios que ya usaste como referencia o hook en un pedido de este cliente">
            <input type="checkbox" checked={hideUsed} onChange={(e) => setHideUsed(e.target.checked)} /> Ocultar los ya usados en pedidos
          </label>
        )}
        <input placeholder="Buscar marca, texto o hook…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      )}
      {!hookMode && countriesSeen.length > 1 && <p className="muted small">Países: {countriesSeen.join(", ")}</p>}

      {visible.length > 0 && (
        <div className="row wrap select-row">
          <button
            className="ghost small"
            onClick={() =>
              hookMode
                ? visible.filter((a) => !sel.hookIds.includes(a.id)).forEach((a) => sel.toggleHook(a.id))
                : sel.set([...new Set([...sel.ids, ...visible.map((a) => a.id)])])
            }
          >
            ☑ Seleccionar todos{hookMode ? " como hook" : ""} ({visible.length})
          </button>
          {(sel.ids.length > 0 || sel.hookIds.length > 0) && (
            <button className="ghost small" onClick={() => { sel.clear(); setShared(null); }}>✕ Deseleccionar todos</button>
          )}
        </div>
      )}

      {!loading && visible.length === 0 && (
        <div className="empty-state">
          <p>{hookMode ? "Todavía no hay hooks en video para estos filtros." : "Todavía no hay anuncios acá."}</p>
          <button onClick={() => nav(fixedClientId ? `/buscar?cliente=${fixedClientId}` : "/buscar")}>Empezar una búsqueda</button>
        </div>
      )}

      {groups.map(([name, list]) => (
        <section key={name || "all"} className="lib-group">
          {groupBy && (
            <div className="row between group-head">
              <h3>{name} <span className="muted">({list.length})</span></h3>
              <button className="ghost small" onClick={() => sel.set([...new Set([...sel.ids, ...list.map((a) => a.id)])])}>
                Elegir todos
              </button>
            </div>
          )}
          <div className={`grid ${hookMode ? "hooks" : ""}`}>
            {list.map((ad) => (
              <AdCard
                key={ad.id}
                ad={ad}
                hookMode={hookMode}
                selected={sel.ids.includes(ad.id)}
                hookSelected={sel.hookIds.includes(ad.id)}
                used={used.has(ad.id)}
                saved={saves.has(ad.id)}
                onSelect={() => sel.toggle(ad.id)}
                onSelectHook={() => sel.toggleHook(ad.id)}
                onSave={() => toggleSave(ad)}
                onDiscard={() => discard(ad)}
                onOpen={() => setOpen(ad)}
              />
            ))}
          </div>
        </section>
      ))}
      {loading && <p className="center muted">Cargando…</p>}
      {more && !loading && (
        <div className="center">
          <button className="ghost" onClick={() => setPage(page + 1)}>Cargar más</button>
        </div>
      )}

      {open && (
        <AdModal
          hookMode={hookMode}
          {...(() => {
            // Navegación en el mismo orden en que se ven las tarjetas
            const flat = groups.flatMap(([, l]) => l);
            const i = flat.findIndex((a) => a.id === open.id);
            return {
              position: i >= 0 ? `${i + 1} de ${flat.length}` : undefined,
              onPrev: i > 0 ? () => setOpen(flat[i - 1]) : undefined,
              onNext: i >= 0 && i < flat.length - 1 ? () => setOpen(flat[i + 1]) : undefined,
            };
          })()}
          ad={open}
          selected={sel.ids.includes(open.id)}
          hookSelected={sel.hookIds.includes(open.id)}
          onClose={() => setOpen(null)}
          onSelect={() => sel.toggle(open.id)}
          onSelectHook={() => sel.toggleHook(open.id)}
          onDiscard={() => discard(open)}
        />
      )}

      {(sel.ids.length > 0 || sel.hookIds.length > 0) && (
        <div className={`tray ${open ? "over-modal" : ""}`}>
          <span>
            <b>{sel.ids.length}</b> referencias · <b>{sel.hookIds.length}</b> hooks{clientName ? ` para ${clientName}` : ""}
          </span>
          <button className="ghost small" onClick={() => { sel.clear(); setShared(null); }} title="Saca todas las referencias y hooks elegidos">✕ Deseleccionar todos</button>
          <button className="ghost" onClick={() => { setOpen(null); setGroupDialog(true); }}>Guardar como grupo</button>
          <button className="ghost" onClick={shareRefs} disabled={sel.ids.length === 0}>Compartir referencias</button>
          <button onClick={() => { setOpen(null); setDialog(true); }} disabled={sel.ids.length === 0}>Crear pedido de creativos →</button>
          {shared && (
            <div className="shared">
              Link copiado: <a href={shared} target="_blank" rel="noreferrer">{shared}</a>
            </div>
          )}
        </div>
      )}

      {groupDialog && (
        <GroupDialog
          clientId={clientId || null}
          adIds={sel.ids}
          hookIds={sel.hookIds}
          onClose={() => setGroupDialog(false)}
          onSaved={(name) => {
            setGroupDialog(false);
            setShared(null);
            sel.clear();
            alert(`Listo: quedó guardado el grupo “${name}”. Lo ves en la pestaña Grupos del cliente y se lo podés pedir a Claude por su nombre.`);
          }}
        />
      )}

      {dialog && <PedidoDialog clients={clients} clientId={clientId} adIds={sel.ids} hookIds={sel.hookIds} onClose={() => setDialog(false)} />}
    </div>
  );
}
