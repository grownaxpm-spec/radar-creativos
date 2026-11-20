import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { DETAIL_LEVELS, PIECE_FORMATS, supabase, type Ad, type Client, type DetailLevel, type Pedido, type PedidoItem } from "../lib.ts";
import { MediaView } from "./AdCard.tsx";
import { defaultFormats } from "./PedidoPublic.tsx";

type Item = PedidoItem & { ad?: Ad };
type FullPedido = Pedido & { ai_status: string | null; ai_error: string | null };

const isImage = (it: Item) => /imagen|estático|estatico|carrusel|feed|img/i.test(`${it.format ?? ""} ${it.code ?? ""}`) && !/reel|video|story/i.test(it.format ?? "");

export default function PedidoEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [p, setP] = useState<FullPedido | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const started = useRef(false);

  async function load() {
    const { data: ped } = await supabase.from("pedidos").select("*").eq("id", id).single();
    setP(ped as FullPedido);
    const { data: its } = await supabase.from("pedido_items").select("*").eq("pedido_id", id).order("position");
    const adIds = (its ?? []).map((i) => i.ad_id).filter(Boolean);
    const { data: ads } = adIds.length ? await supabase.from("ads_view").select("*").in("id", adIds) : { data: [] };
    const byId = new Map((ads ?? []).map((a: Ad) => [a.id, a]));
    setItems((its ?? []).map((i) => ({ ...i, ad: i.ad_id ? byId.get(i.ad_id) : undefined })));
    return ped as FullPedido;
  }

  useEffect(() => {
    load();
    supabase.from("clients").select("*").order("name").then(({ data }) => setClients((data as Client[]) ?? []));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Arranca la generación con IA si venimos del diálogo con "?generar=1"
  useEffect(() => {
    if (params.get("generar") === "1" && p && !started.current) {
      started.current = true;
      setParams({}, { replace: true });
      void generate();
    }
  }, [p]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mientras la IA escribe, consultamos cada 4 segundos
  useEffect(() => {
    if (p?.ai_status !== "generating") return;
    const t = setInterval(async () => {
      const fresh = await load();
      if (fresh?.ai_status !== "generating") clearInterval(t);
    }, 4000);
    return () => clearInterval(t);
  }, [p?.ai_status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function generate() {
    if (!p) return;
    if (items.some((i) => i.hook || i.development) && !confirm("La IA va a reescribir los guiones de este pedido. ¿Seguimos?")) return;
    await save();
    setP({ ...p, ai_status: "generating", ai_error: null });
    const { error } = await supabase.functions.invoke("search-worker", { body: { action: "draft_pedido", pedido_id: p.id } });
    if (error) setP({ ...p, ai_status: "error", ai_error: error.message });
  }

  if (!p) return <p className="center muted">Cargando…</p>;
  const client = clients.find((c) => c.id === p.client_id);
  const publicUrl = `${window.location.origin}/p/${p.slug}`;
  const level = p.detail_level ?? "completo";
  const showRec = level !== "guion";
  const showFull = level === "completo";
  const setItem = (k: number, patch: Partial<Item>) => setItems(items.map((it, i) => (i === k ? { ...it, ...patch } : it)));

  async function save() {
    if (!p) return;
    setSaving(true);
    const { id: _id, slug: _slug, created_at: _c, ai_status: _s, ai_error: _e, ...rest } = p;
    await supabase.from("pedidos").update(rest).eq("id", p.id);
    for (const [k, it] of items.entries()) {
      const { ad: _ad, id: itemId, pedido_id: _pid, ...fields } = it;
      await supabase.from("pedido_items").update({ ...fields, position: k + 1 }).eq("id", itemId!);
    }
    setSaving(false);
  }

  async function addPiece() {
    const { data } = await supabase
      .from("pedido_items")
      .insert({ pedido_id: p!.id, position: items.length + 1, code: `V${items.length + 1}`, piece_name: `Pieza ${items.length + 1}` })
      .select()
      .single();
    if (data) setItems([...items, data as Item]);
  }

  async function removeItem(k: number) {
    const it = items[k];
    if (it.id) await supabase.from("pedido_items").delete().eq("id", it.id);
    setItems(items.filter((_, i) => i !== k));
  }

  async function removePedido() {
    if (!confirm("¿Borrar este pedido?")) return;
    await supabase.from("pedidos").delete().eq("id", p!.id);
    nav("/pedidos");
  }

  function claudePrompt() {
    return `Armá el pedido de creativos usando la skill pedido-creativos, publicalo como artefacto con los videos de referencia reproducibles (como el de Black Vinson) y guardá el PDF en la carpeta del cliente en Drive.

Pedido: ${p!.title}
Link con todo el contenido, las referencias y los guiones: ${publicUrl}
${client?.drive_folder_url ? `Carpeta de Drive del cliente: ${client.drive_folder_url}` : ""}
Nivel de detalle: ${DETAIL_LEVELS.find(([v]) => v === level)?.[1]}

Leé el link, respetá la estructura y los guiones que ya están, y mejoralos si hace falta.`;
  }

  async function copyPrompt() {
    await save();
    await navigator.clipboard.writeText(claudePrompt());
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  const generating = p.ai_status === "generating";

  return (
    <div>
      <div className="card">
        <div className="row between wrap">
          <input className="title-input" value={p.title} onChange={(e) => setP({ ...p, title: e.target.value })} />
          <div className="row wrap">
            <button className="ghost" onClick={generate} disabled={generating}>{generating ? "La IA está escribiendo…" : "✨ Generar con IA"}</button>
            <button className="ghost" onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
            <a href={publicUrl} target="_blank" rel="noreferrer" onClick={() => void save()}><button>Ver link del cliente ↗</button></a>
          </div>
        </div>
        {generating && (
          <div className="note">
            La IA está escribiendo los guiones, los hooks sugeridos{showRec ? ", cómo grabar cada pieza" : ""} y cómo se entrega. Tarda 1 o 2 minutos; se actualiza sola.
            <div className="progress-bar indeterminate"><div /></div>
          </div>
        )}
        {p.ai_status === "error" && <p className="error">No se pudo generar: {p.ai_error}</p>}

        <div className="profile-grid">
          <label>
            Cliente
            <select value={p.client_id ?? ""} onChange={(e) => setP({ ...p, client_id: e.target.value || null })}>
              <option value="">— Sin cliente —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>
            Nivel de detalle
            <select value={level} onChange={(e) => setP({ ...p, detail_level: e.target.value as DetailLevel })}>
              {DETAIL_LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label>
            Tipo
            <select value={p.kind} onChange={(e) => setP({ ...p, kind: e.target.value as "aon" | "evento" })}>
              <option value="aon">Always On</option>
              <option value="evento">Evento</option>
            </select>
          </label>
          {p.kind === "evento" ? (
            <label>Evento<input value={p.event_name ?? ""} onChange={(e) => setP({ ...p, event_name: e.target.value || null })} placeholder="Black Friday" /></label>
          ) : (
            <label>Mes<input value={p.period ?? ""} onChange={(e) => setP({ ...p, period: e.target.value || null })} /></label>
          )}
          <label>Entrega<input type="date" value={p.deadline ?? ""} onChange={(e) => setP({ ...p, deadline: e.target.value || null })} /></label>
          <label>
            Plataforma
            <select value={p.platform} onChange={(e) => setP({ ...p, platform: e.target.value })}>
              <option>Meta</option><option>TikTok</option><option>Google</option>
            </select>
          </label>
        </div>
        <label>Objetivo / foco<input value={p.objective ?? ""} onChange={(e) => setP({ ...p, objective: e.target.value || null })} /></label>
        <label>Info extra (precios, promos, restricciones)<textarea rows={2} value={p.notes ?? ""} onChange={(e) => setP({ ...p, notes: e.target.value || null })} /></label>
        <label>Descripción<textarea rows={2} value={p.intro ?? ""} onChange={(e) => setP({ ...p, intro: e.target.value || null })} /></label>
        <div className="two-col">
          <label>
            Dónde entregar (link de Drive)
            <input
              value={p.delivery_url ?? ""}
              onChange={(e) => setP({ ...p, delivery_url: e.target.value || null })}
              placeholder={client?.creativos_folder_url ?? client?.drive_folder_url ?? "https://drive.google.com/…"}
            />
            <span className="muted small">Si queda vacío, va la carpeta de creativos del cliente.</span>
          </label>
          <label>
            Adaptaciones
            <input value={p.formats ?? ""} onChange={(e) => setP({ ...p, formats: e.target.value || null })} placeholder={defaultFormats(p.platform)} />
            <span className="muted small">Si queda vacío: {defaultFormats(p.platform)}.</span>
          </label>
        </div>
        <label>Lo que no cambia en ninguna pieza (va en aclaraciones)<textarea rows={2} value={p.refs_note ?? ""} onChange={(e) => setP({ ...p, refs_note: e.target.value || null })} /></label>
        <div className="row wrap small">
          <span className="muted">Link para el cliente:</span>
          <a href={publicUrl} target="_blank" rel="noreferrer">{publicUrl}</a>
          <button className="ghost small" onClick={copyPrompt}>{copied ? "✓ Copiado" : "Copiar para Claude (artefacto + Drive)"}</button>
        </div>
      </div>

      <h2 className="section-title">Piezas ({items.length})</h2>
      {items.map((it, k) => {
        const img = isImage(it);
        return (
          <div className="card piece" key={it.id ?? k}>
            <div className="piece-ref">
              {it.ad ? <MediaView media={it.ad.media} compact /> : <div className="media empty compact">Sin referencia</div>}
              {it.ad && (
                <div className="small muted">
                  {it.ad.page_name} · {it.ad.days_active} días ·{" "}
                  <a href={it.ad.snapshot_url} target="_blank" rel="noreferrer">Meta ↗</a>
                </div>
              )}
            </div>
            <div className="piece-form">
              <div className="row wrap">
                <input style={{ width: 70 }} value={it.code ?? ""} onChange={(e) => setItem(k, { code: e.target.value })} placeholder="V1" />
                <input className="grow" value={it.title ?? it.piece_name ?? ""} onChange={(e) => setItem(k, { title: e.target.value, piece_name: e.target.value })} placeholder="Título de la pieza" />
                <button className="ghost small" onClick={() => removeItem(k)} title="Quitar pieza">✕</button>
              </div>
              <div className="row wrap">
                <select value={it.format ?? ""} onChange={(e) => setItem(k, { format: e.target.value })}>
                  <option value="">Formato…</option>
                  {PIECE_FORMATS.map((f) => <option key={f}>{f}</option>)}
                  {it.format && !PIECE_FORMATS.includes(it.format) && <option>{it.format}</option>}
                </select>
                <select value={it.funnel ?? ""} onChange={(e) => setItem(k, { funnel: (e.target.value || null) as Item["funnel"] })}>
                  <option value="">Embudo…</option>
                  <option value="fria">Fría</option>
                  <option value="caliente">Caliente</option>
                </select>
                <input value={it.angle ?? ""} onChange={(e) => setItem(k, { angle: e.target.value })} placeholder="Ángulo" />
                {showFull && <input value={it.creative_type ?? ""} onChange={(e) => setItem(k, { creative_type: e.target.value })} placeholder="Tipo de creativo (UGC, testimonial…)" />}
                <input value={it.group_name ?? ""} onChange={(e) => setItem(k, { group_name: e.target.value })} placeholder="Grupo (ej. Zapatillas)" />
              </div>
              {it.ad && <label>Qué replicar de la referencia<textarea rows={2} value={it.ref_beats ?? ""} onChange={(e) => setItem(k, { ref_beats: e.target.value })} /></label>}
              {img ? (
                <>
                  <label>Escena / composición<textarea rows={3} value={it.scene ?? ""} onChange={(e) => setItem(k, { scene: e.target.value })} /></label>
                  <div className="profile-grid">
                    <label>Titular<input value={it.headline ?? ""} onChange={(e) => setItem(k, { headline: e.target.value })} /></label>
                    <label>Bajada<input value={it.subhead ?? ""} onChange={(e) => setItem(k, { subhead: e.target.value })} /></label>
                  </div>
                </>
              ) : (
                <>
                  <label>Hook<textarea rows={2} value={it.hook ?? ""} onChange={(e) => setItem(k, { hook: e.target.value })} /></label>
                  <label>Desarrollo<textarea rows={5} value={it.development ?? ""} onChange={(e) => setItem(k, { development: e.target.value })} /></label>
                  <label>Cierre<textarea rows={2} value={it.closing ?? ""} onChange={(e) => setItem(k, { closing: e.target.value })} /></label>
                </>
              )}
              {showRec && (
                <div className="profile-grid">
                  <label>Cómo grabarlo<textarea rows={3} value={it.recording_tips ?? ""} onChange={(e) => setItem(k, { recording_tips: e.target.value })} /></label>
                  <label>Duración<input value={it.duration ?? ""} onChange={(e) => setItem(k, { duration: e.target.value })} placeholder="45-60 s" /></label>
                </div>
              )}
              {showFull && <label>Adaptaciones<input value={it.adaptations ?? ""} onChange={(e) => setItem(k, { adaptations: e.target.value })} placeholder="9:16 y 4:5" /></label>}
              <label>Notas<textarea rows={1} value={it.notes ?? ""} onChange={(e) => setItem(k, { notes: e.target.value })} /></label>
            </div>
          </div>
        );
      })}
      <div className="center">
        <button className="ghost" onClick={addPiece}>+ Agregar pieza</button>
      </div>

      <div className="card">
        <h2>Hooks sugeridos para el rubro</h2>
        {p.hooks.length === 0 && <p className="muted small">Se completan al generar con IA. También podés escribirlos.</p>}
        {p.hooks.map((h, k) => (
          <div className="row" key={k} style={{ marginBottom: 6 }}>
            <input className="grow" value={h.hook} onChange={(e) => setP({ ...p, hooks: p.hooks.map((x, i) => (i === k ? { ...x, hook: e.target.value } : x)) })} />
            <input style={{ width: 170 }} value={h.tipo ?? ""} placeholder="Tipo" onChange={(e) => setP({ ...p, hooks: p.hooks.map((x, i) => (i === k ? { ...x, tipo: e.target.value } : x)) })} />
            <button className="ghost small" onClick={() => setP({ ...p, hooks: p.hooks.filter((_, i) => i !== k) })}>✕</button>
          </div>
        ))}
        <button className="ghost small" onClick={() => setP({ ...p, hooks: [...p.hooks, { hook: "", tipo: "" }] })}>+ Hook</button>
      </div>

      {(
        <div className="card">
          <h2>Aclaraciones</h2>
          {p.before_notes.map((n, k) => (
            <div className="row" key={k} style={{ marginBottom: 6 }}>
              <textarea className="grow" rows={2} value={n} onChange={(e) => setP({ ...p, before_notes: p.before_notes.map((x, i) => (i === k ? e.target.value : x)) })} />
              <button className="ghost small" onClick={() => setP({ ...p, before_notes: p.before_notes.filter((_, i) => i !== k) })}>✕</button>
            </div>
          ))}
          <button className="ghost small" onClick={() => setP({ ...p, before_notes: [...p.before_notes, ""] })}>+ Nota</button>
        </div>
      )}

      <div className="center">
        <button className="ghost danger small" onClick={removePedido}>Borrar pedido</button>
      </div>
    </div>
  );
}
