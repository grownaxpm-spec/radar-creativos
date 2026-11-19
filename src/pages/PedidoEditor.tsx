import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PIECE_FORMATS, supabase, type Ad, type Client, type Pedido, type PedidoItem } from "../lib.ts";
import { MediaView } from "./AdCard.tsx";

type Item = PedidoItem & { ad?: Ad };

export default function PedidoEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const [p, setP] = useState<Pedido | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: ped } = await supabase.from("pedidos").select("*").eq("id", id).single();
      setP(ped);
      const { data: its } = await supabase.from("pedido_items").select("*").eq("pedido_id", id).order("position");
      const adIds = (its ?? []).map((i) => i.ad_id).filter(Boolean);
      const { data: ads } = await supabase.from("ads_view").select("*").in("id", adIds);
      const byId = new Map((ads ?? []).map((a: Ad) => [a.id, a]));
      setItems((its ?? []).map((i) => ({ ...i, ad: i.ad_id ? byId.get(i.ad_id) : undefined })));
      const { data: cs } = await supabase.from("clients").select("*").order("name");
      setClients(cs ?? []);
    })();
  }, [id]);

  if (!p) return <p className="center muted">Cargando…</p>;
  const client = clients.find((c) => c.id === p.client_id);
  const publicUrl = `${window.location.origin}/p/${p.slug}`;

  const setItem = (k: number, patch: Partial<Item>) => setItems(items.map((it, i) => (i === k ? { ...it, ...patch } : it)));

  async function save() {
    if (!p) return;
    setSaving(true);
    await supabase
      .from("pedidos")
      .update({ title: p.title, client_id: p.client_id, objective: p.objective, notes: p.notes, artifact_url: p.artifact_url, drive_url: p.drive_url })
      .eq("id", p.id);
    for (const [k, it] of items.entries()) {
      await supabase
        .from("pedido_items")
        .update({ position: k + 1, piece_name: it.piece_name, format: it.format, angle: it.angle, script: it.script, notes: it.notes })
        .eq("id", it.id!);
    }
    setSaving(false);
  }

  async function removeItem(k: number) {
    const it = items[k];
    if (it.id) await supabase.from("pedido_items").delete().eq("id", it.id);
    setItems(items.filter((_, i) => i !== k));
  }

  async function removePedido() {
    if (!p || !confirm("¿Borrar este pedido?")) return;
    await supabase.from("pedidos").delete().eq("id", p.id);
    nav("/pedidos");
  }

  function claudePrompt() {
    const refs = items
      .map((it, k) => {
        const a = it.ad;
        const media = (a?.media ?? []).map((m) => `${m.type === "video" ? "video" : "imagen"}: ${m.url}`).join(" | ");
        return [
          `${k + 1}. ${it.piece_name ?? `Pieza ${k + 1}`} — formato pedido: ${it.format ?? "a definir"}${it.angle ? ` — ángulo: ${it.angle}` : ""}`,
          a ? `   Referencia: ${a.page_name ?? "marca"} (${a.format}, ${a.days_active} días activo, ${a.countries.join("/")})` : "",
          a?.hook ? `   Hook: ${a.hook}${a.hook_type ? ` (${a.hook_type})` : ""}` : "",
          a?.why_it_works ? `   Por qué funciona: ${a.why_it_works}` : "",
          a?.adaptation ? `   Idea de adaptación: ${a.adaptation}` : "",
          a?.body ? `   Texto del anuncio: "${a.body.replace(/\s+/g, " ").slice(0, 400)}"` : "",
          media ? `   Medios: ${media}` : "",
          a ? `   Ficha en Meta: ${a.snapshot_url}` : "",
          it.script ? `   Guion que ya tenemos: ${it.script}` : "",
          it.notes ? `   Notas: ${it.notes}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");
    return `Armá un pedido de piezas usando la skill pedido-creativos.

Cliente: ${client?.name ?? "(sin cliente)"}${client?.rubro ? ` — rubro: ${client.rubro}` : ""}
${client?.usp ? `Propuesta de valor: ${client.usp}\n` : ""}${client?.target ? `Público: ${client.target}\n` : ""}${client?.messages?.length ? `Mensajes guía: ${client.messages.join(" | ")}\n` : ""}${client?.tone ? `Tono: ${client.tone}\n` : ""}${client?.avoid ? `No comunicar: ${client.avoid}\n` : ""}${client?.notes ? `Notas: ${client.notes}\n` : ""}
Título: ${p!.title}
${p!.objective ? `Objetivo: ${p!.objective}\n` : ""}${p!.notes ? `Notas generales: ${p!.notes}\n` : ""}
Referencias elegidas (anuncios de la competencia de la Biblioteca de Meta):

${refs}

Para cada pieza:
- Explicá qué replicar de la referencia (gancho, estructura, ritmo, plano, texto en pantalla).
- Escribí un guion sugerido adaptado a ${client?.name ?? "la marca"} (gancho 0-3 s, desarrollo, cierre con CTA), con textos en pantalla y locución si corresponde.
- Indicá formato, duración y qué material necesitamos del cliente.

Entregá el pedido como artefacto de Claude con cada video/imagen de referencia reproducible al lado de su pieza y guion.
${client?.drive_folder_url ? `Guardá una copia en la carpeta del cliente en Drive: ${client.drive_folder_url}` : "Guardá una copia en la carpeta del cliente en Drive."}
Link del pedido en el Radar (si algún video no se reproduce en el artefacto, enlazá acá): ${publicUrl}`;
  }

  async function copyPrompt() {
    await save();
    await navigator.clipboard.writeText(claudePrompt());
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <div>
      <div className="card">
        <div className="row between wrap">
          <input className="title-input" value={p.title} onChange={(e) => setP({ ...p, title: e.target.value })} />
          <div className="row">
            <button className="ghost" onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
            <button onClick={copyPrompt}>{copied ? "✓ Copiado" : "Copiar para Claude"}</button>
          </div>
        </div>
        <div className="row wrap">
          <label>
            Cliente
            <select value={p.client_id ?? ""} onChange={(e) => setP({ ...p, client_id: e.target.value || null })}>
              <option value="">— Sin cliente —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="grow">
            Objetivo
            <input value={p.objective ?? ""} onChange={(e) => setP({ ...p, objective: e.target.value })} placeholder="Ej: campaña de invierno, botas, foco en calidad del cuero" />
          </label>
        </div>
        <label>
          Notas generales
          <textarea rows={2} value={p.notes ?? ""} onChange={(e) => setP({ ...p, notes: e.target.value })} />
        </label>
        <div className="row wrap small">
          <span className="muted">Link para el cliente:</span>
          <a href={publicUrl} target="_blank" rel="noreferrer">{publicUrl}</a>
        </div>
        <div className="row wrap">
          <label className="grow">
            Link del artefacto de Claude
            <input value={p.artifact_url ?? ""} onChange={(e) => setP({ ...p, artifact_url: e.target.value })} placeholder="https://claude.ai/…" />
          </label>
          <label className="grow">
            Link en Drive
            <input value={p.drive_url ?? ""} onChange={(e) => setP({ ...p, drive_url: e.target.value })} placeholder="https://drive.google.com/…" />
          </label>
        </div>
        <p className="muted small">
          “Copiar para Claude” copia las instrucciones con todas las referencias. Pegalas en Claude: escribe los guiones, publica el artefacto y lo guarda en el Drive del cliente.
        </p>
      </div>

      {items.map((it, k) => (
        <div className="card piece" key={it.id ?? k}>
          <div className="piece-ref">
            {it.ad ? <MediaView media={it.ad.media} compact /> : <div className="media empty">Sin referencia</div>}
            {it.ad && (
              <div className="small muted">
                {it.ad.page_name} · {it.ad.days_active} días ·{" "}
                <a href={it.ad.snapshot_url} target="_blank" rel="noreferrer">Meta ↗</a>
              </div>
            )}
          </div>
          <div className="piece-form">
            <div className="row wrap">
              <input className="grow" value={it.piece_name ?? ""} onChange={(e) => setItem(k, { piece_name: e.target.value })} />
              <select value={it.format ?? ""} onChange={(e) => setItem(k, { format: e.target.value })}>
                <option value="">Formato…</option>
                {PIECE_FORMATS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
              <input value={it.angle ?? ""} onChange={(e) => setItem(k, { angle: e.target.value })} placeholder="Ángulo" />
              <button className="ghost small" onClick={() => removeItem(k)} title="Quitar pieza">✕</button>
            </div>
            {it.ad?.body && <p className="copy open small muted">{it.ad.body}</p>}
            <label>
              Guion sugerido
              <textarea rows={6} value={it.script ?? ""} onChange={(e) => setItem(k, { script: e.target.value })} placeholder={"0-3 s: gancho…\n3-10 s: …\nCierre: CTA…"} />
            </label>
            <label>
              Notas para el editor / cliente
              <textarea rows={2} value={it.notes ?? ""} onChange={(e) => setItem(k, { notes: e.target.value })} />
            </label>
          </div>
        </div>
      ))}

      <div className="center">
        <button className="ghost danger small" onClick={removePedido}>Borrar pedido</button>
      </div>
    </div>
  );
}
