import { useEffect, useState } from "react";
import { supabase, type Client } from "../lib.ts";

const EMPTY: Omit<Client, "id"> = {
  name: "",
  rubro: null,
  drive_folder_url: null,
  website: null,
  instagram: null,
  usp: null,
  target: null,
  messages: [],
  tone: null,
  avoid: null,
  competitors: [],
  keywords: [],
  notes: null,
};

const lines = (v: string) => v.split("\n").map((s) => s.trim()).filter(Boolean);

function ClientForm({ initial, onSaved, onCancel }: { initial: Client | null; onSaved: () => void; onCancel?: () => void }) {
  const [c, setC] = useState<Omit<Client, "id">>(initial ?? EMPTY);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<Client>) => setC({ ...c, ...patch });
  const txt = (v: string) => (v.trim() ? v : null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { error } = initial
      ? await supabase.from("clients").update(c).eq("id", initial.id)
      : await supabase.from("clients").insert(c);
    setSaving(false);
    if (error) return alert(error.message);
    if (!initial) setC(EMPTY);
    onSaved();
  }

  return (
    <form onSubmit={save}>
      <div className="profile-grid">
        <label>
          Nombre
          <input required value={c.name} onChange={(e) => set({ name: e.target.value })} placeholder="Puerto Blue" />
        </label>
        <label>
          Rubro
          <input value={c.rubro ?? ""} onChange={(e) => set({ rubro: txt(e.target.value) })} placeholder="Calzado y marroquinería de cuero para hombre" />
        </label>
        <label>
          Web
          <input value={c.website ?? ""} onChange={(e) => set({ website: txt(e.target.value) })} placeholder="https://…" />
        </label>
        <label>
          Instagram
          <input value={c.instagram ?? ""} onChange={(e) => set({ instagram: txt(e.target.value) })} placeholder="@…" />
        </label>
      </div>
      <label>
        Propuesta de valor (USP)
        <textarea rows={3} value={c.usp ?? ""} onChange={(e) => set({ usp: txt(e.target.value) })} />
      </label>
      <label>
        Público
        <textarea rows={2} value={c.target ?? ""} onChange={(e) => set({ target: txt(e.target.value) })} />
      </label>
      <label>
        Mensajes guía (uno por línea)
        <textarea rows={3} value={c.messages.join("\n")} onChange={(e) => set({ messages: lines(e.target.value) })} />
      </label>
      <div className="profile-grid">
        <label>
          Tono
          <textarea rows={2} value={c.tone ?? ""} onChange={(e) => set({ tone: txt(e.target.value) })} />
        </label>
        <label>
          Qué NO comunicar
          <textarea rows={2} value={c.avoid ?? ""} onChange={(e) => set({ avoid: txt(e.target.value) })} />
        </label>
        <label>
          Competidores (uno por línea, nombre de marca)
          <textarea rows={4} value={c.competitors.join("\n")} onChange={(e) => set({ competitors: lines(e.target.value) })} />
        </label>
        <label>
          Palabras clave para buscar (una por línea)
          <textarea rows={4} value={c.keywords.join("\n")} onChange={(e) => set({ keywords: lines(e.target.value) })} />
        </label>
      </div>
      <label>
        Carpeta de creativos en Drive (link)
        <input value={c.drive_folder_url ?? ""} onChange={(e) => set({ drive_folder_url: txt(e.target.value) })} placeholder="https://drive.google.com/drive/folders/…" />
      </label>
      <label>
        Notas (ofertas, fechas, productos foco…)
        <textarea rows={3} value={c.notes ?? ""} onChange={(e) => set({ notes: txt(e.target.value) })} />
      </label>
      <div className="row">
        <button type="submit" disabled={saving}>{saving ? "Guardando…" : initial ? "Guardar cambios" : "Agregar cliente"}</button>
        {onCancel && (
          <button type="button" className="ghost" onClick={onCancel}>
            Cancelar
          </button>
        )}
      </div>
      <p className="muted small">La IA usa este perfil en cada búsqueda del cliente: descarta lo que no es del rubro, detecta el hook y propone cómo adaptar cada anuncio.</p>
    </form>
  );
}

export default function Clients() {
  const [list, setList] = useState<Client[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = () => supabase.from("clients").select("*").order("name").then(({ data }) => setList((data as Client[]) ?? []));
  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <div className="row between wrap" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Clientes</h2>
        {!adding && <button onClick={() => setAdding(true)}>+ Nuevo cliente</button>}
      </div>
      {adding && (
        <div className="card">
          <h2>Nuevo cliente</h2>
          <ClientForm initial={null} onSaved={() => { setAdding(false); load(); }} onCancel={() => setAdding(false)} />
        </div>
      )}
      {list.length === 0 && !adding && <p className="muted">Todavía no hay clientes.</p>}
      {list.map((c) =>
        editing === c.id ? (
          <div className="card" key={c.id}>
            <h2>{c.name}</h2>
            <ClientForm initial={c} onSaved={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />
          </div>
        ) : (
          <div className="card" key={c.id}>
            <div className="row between wrap">
              <div>
                <h2 style={{ marginBottom: 4 }}>{c.name}</h2>
                <div className="muted small">{c.rubro ?? "Sin rubro"}</div>
              </div>
              <div className="row">
                {c.website && <a href={c.website} target="_blank" rel="noreferrer">Web ↗</a>}
                {c.drive_folder_url && <a href={c.drive_folder_url} target="_blank" rel="noreferrer">Drive ↗</a>}
                <button className="ghost small" onClick={() => setEditing(c.id)}>Editar perfil</button>
              </div>
            </div>
            {c.usp && <p className="small"><b>USP:</b> {c.usp}</p>}
            {c.messages.length > 0 && (
              <ul className="small">
                {c.messages.map((m) => <li key={m}>{m}</li>)}
              </ul>
            )}
            <div className="chips">
              {c.competitors.map((x) => <span key={x} className="chip light">{x}</span>)}
            </div>
          </div>
        ),
      )}
    </div>
  );
}
