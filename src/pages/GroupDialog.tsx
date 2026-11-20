// Guarda la selección como un grupo de anuncios con nombre (nuevo o sumando a uno existente).
// Después se le puede pedir a Claude: "haceme un pedido con el grupo X".
import { useEffect, useState } from "react";
import { supabase, type AdGroup } from "../lib.ts";

export default function GroupDialog({
  clientId,
  adIds,
  hookIds,
  onClose,
  onSaved,
}: {
  clientId: string | null;
  adIds: string[];
  hookIds: string[];
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const [groups, setGroups] = useState<AdGroup[]>([]);
  const [target, setTarget] = useState("nuevo");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let q = supabase.from("ad_groups").select("*").order("updated_at", { ascending: false });
    q = clientId ? q.eq("client_id", clientId) : q.is("client_id", null);
    q.then(({ data }) => setGroups((data as AdGroup[]) ?? []));
  }, [clientId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const uniq = (a: string[]) => [...new Set(a)];
    const existing = groups.find((g) => g.id === target);
    const { error } = existing
      ? await supabase
          .from("ad_groups")
          .update({ ad_ids: uniq([...existing.ad_ids, ...adIds]), hook_ids: uniq([...existing.hook_ids, ...hookIds]), updated_at: new Date().toISOString() })
          .eq("id", existing.id)
      : await supabase.from("ad_groups").insert({ client_id: clientId, name: name.trim(), ad_ids: adIds, hook_ids: hookIds });
    setBusy(false);
    if (error) return alert(error.message);
    onSaved(existing ? existing.name : name.trim());
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal narrow" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <button type="button" className="ghost small close" onClick={onClose}>✕</button>
        <h2 style={{ marginTop: 0 }}>Guardar como grupo</h2>
        <p className="muted small">
          {adIds.length} referencias y {hookIds.length} hooks. Después le podés decir a Claude: “haceme un pedido de creativos con el grupo …”.
        </p>
        <label>
          Grupo
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="nuevo">Grupo nuevo</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>Sumar a “{g.name}” ({g.ad_ids.length})</option>
            ))}
          </select>
        </label>
        {target === "nuevo" && (
          <label>
            Nombre del grupo
            <input required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Black Friday · founder-led" />
          </label>
        )}
        <button type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar grupo"}</button>
      </form>
    </div>
  );
}
