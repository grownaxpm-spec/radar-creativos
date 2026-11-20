import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { DETAIL_LEVELS, supabase, type Client, type DetailLevel } from "../lib.ts";
import { useSelection } from "../App.tsx";

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/** Arma un pedido nuevo a partir de las referencias elegidas, con la estructura que pida el cliente. */
export default function PedidoDialog({
  clients,
  clientId: initialClient,
  adIds,
  hookIds = [],
  onClose,
}: {
  clients: Client[];
  clientId: string;
  adIds: string[];
  hookIds?: string[];
  onClose: () => void;
}) {
  const nav = useNavigate();
  const sel = useSelection();
  const now = new Date();
  const [clientId, setClientId] = useState(initialClient);
  const [kind, setKind] = useState<"aon" | "evento">("aon");
  const [eventName, setEventName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [period, setPeriod] = useState(`${MONTHS[now.getMonth()]} ${now.getFullYear()}`);
  const [detail, setDetail] = useState<DetailLevel>("completo");
  const [platform, setPlatform] = useState("Meta");
  const [pieces, setPieces] = useState(adIds.length);
  const [objective, setObjective] = useState("");
  const [notes, setNotes] = useState("");
  const [ai, setAi] = useState(true);
  const [busy, setBusy] = useState(false);

  const client = clients.find((c) => c.id === clientId);
  const title = `${client ? `${client.name} ` : ""}Pedido de creativos - Campaña - ${kind === "evento" ? eventName || "Evento" : `AON - ${period}`}`;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { data: p, error } = await supabase
      .from("pedidos")
      .insert({
        title,
        client_id: clientId || null,
        kind,
        event_name: kind === "evento" ? eventName || null : null,
        event_date: kind === "evento" && eventDate ? eventDate : null,
        period: kind === "aon" ? period : null,
        detail_level: detail,
        platform,
        objective: objective || null,
        notes: notes || null,
        hook_ad_ids: hookIds,
      })
      .select()
      .single();
    if (error || !p) {
      setBusy(false);
      return alert(error?.message ?? "No pude crear el pedido");
    }
    // Una pieza por referencia; si pidió más piezas, quedan sin referencia para que la IA las complete
    const { data: refAds } = await supabase.from("ads").select("id, format, angle").in("id", adIds);
    const byId = new Map((refAds ?? []).map((a) => [a.id, a]));
    const rows = Array.from({ length: Math.max(pieces, 1) }, (_, i) => {
      const id = adIds[i] ?? null;
      const a = id ? byId.get(id) : undefined;
      return {
        pedido_id: p.id,
        ad_id: id,
        position: i + 1,
        code: `${a?.format === "video" || !a ? "V" : "IMG"}${i + 1}`,
        piece_name: `Pieza ${i + 1}`,
        format: a?.format === "video" ? "Reel 9:16" : a ? "Feed 4:5" : null,
        angle: a?.angle ?? null,
      };
    });
    await supabase.from("pedido_items").insert(rows);
    sel.clear();
    nav(`/pedidos/${p.id}${ai ? "?generar=1" : ""}`);
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal narrow" onClick={(e) => e.stopPropagation()} onSubmit={create}>
        <button type="button" className="ghost small close" onClick={onClose}>✕</button>
        <h2>Nuevo pedido de creativos</h2>
        <p className="muted small">{adIds.length} referencias elegidas. Después podés editar todo.</p>

        <div className="profile-grid">
          <label>
            Cliente
            <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">— Sin cliente —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>
            Plataforma
            <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option>Meta</option>
              <option>TikTok</option>
              <option>Google</option>
            </select>
          </label>
        </div>

        <fieldset>
          <legend>¿Para qué es?</legend>
          <div className="row wrap">
            <label className="check"><input type="radio" checked={kind === "aon"} onChange={() => setKind("aon")} /> Always On</label>
            <label className="check"><input type="radio" checked={kind === "evento"} onChange={() => setKind("evento")} /> Evento (Black Friday, Cyber, Hot Sale, lanzamiento…)</label>
          </div>
          {kind === "evento" ? (
            <div className="profile-grid" style={{ marginTop: 8 }}>
              <label>Nombre del evento<input value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="Black Friday" /></label>
              <label>Fecha<input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} /></label>
            </div>
          ) : (
            <label style={{ marginTop: 8 }}>Mes<input value={period} onChange={(e) => setPeriod(e.target.value)} /></label>
          )}
        </fieldset>

        <fieldset>
          <legend>Cómo lo quiere el cliente</legend>
          {DETAIL_LEVELS.map(([v, label, help]) => (
            <label key={v} className="check option">
              <input type="radio" checked={detail === v} onChange={() => setDetail(v)} />
              <span><b>{label}</b><br /><span className="muted small">{help}</span></span>
            </label>
          ))}
        </fieldset>

        <div className="profile-grid">
          <label>
            Cantidad de piezas
            <input type="number" min={1} max={40} value={pieces} onChange={(e) => setPieces(Number(e.target.value))} />
          </label>
          <label>
            Objetivo / foco
            <input value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Ej: zapatillas y panchas, captar público joven" />
          </label>
        </div>
        <label>
          Algo más que tenga que saber (precios, promos, restricciones…)
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} /> Que la IA escriba los guiones, los hooks sugeridos y cómo grabarlo
        </label>
        <p className="muted small">Nombre: <b>{title}</b></p>
        <button type="submit" disabled={busy}>{busy ? "Creando…" : "Crear pedido"}</button>
      </form>
    </div>
  );
}
