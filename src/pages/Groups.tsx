// Grupos de anuncios de un cliente: selecciones guardadas con nombre para armar pedidos (desde acá o desde Claude).
import { useEffect, useState } from "react";
import { supabase, type Ad, type AdGroup, type Client } from "../lib.ts";
import { useSelection } from "../App.tsx";
import { MediaView } from "./AdCard.tsx";
import PedidoDialog from "./PedidoDialog.tsx";

export default function Groups({ client }: { client: Client }) {
  const sel = useSelection();
  const [groups, setGroups] = useState<AdGroup[]>([]);
  const [ads, setAds] = useState<Map<string, Ad>>(new Map());
  const [pedidoFor, setPedidoFor] = useState<AdGroup | null>(null);

  async function load() {
    const { data } = await supabase.from("ad_groups").select("*").eq("client_id", client.id).order("updated_at", { ascending: false });
    const gs = (data as AdGroup[]) ?? [];
    setGroups(gs);
    const ids = [...new Set(gs.flatMap((g) => [...g.ad_ids, ...g.hook_ids]))];
    if (ids.length) {
      const { data: a } = await supabase.from("ads_view").select("*").in("id", ids);
      setAds(new Map(((a as Ad[]) ?? []).map((x) => [x.id, x])));
    }
  }
  useEffect(() => {
    load();
  }, [client.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function remove(g: AdGroup) {
    if (!confirm(`¿Borrar el grupo “${g.name}”? Los anuncios quedan en la biblioteca.`)) return;
    await supabase.from("ad_groups").delete().eq("id", g.id);
    load();
  }

  async function rename(g: AdGroup) {
    const name = prompt("Nuevo nombre del grupo", g.name)?.trim();
    if (!name) return;
    await supabase.from("ad_groups").update({ name, updated_at: new Date().toISOString() }).eq("id", g.id);
    load();
  }

  async function dropAd(g: AdGroup, id: string, kind: "ad_ids" | "hook_ids") {
    await supabase.from("ad_groups").update({ [kind]: g[kind].filter((x) => x !== id), updated_at: new Date().toISOString() }).eq("id", g.id);
    load();
  }

  if (groups.length === 0)
    return (
      <div className="card">
        <p className="muted">
          Todavía no hay grupos. En la Biblioteca marcá anuncios (“Ref” y “Hook”) y apretá <b>Guardar como grupo</b>. Después podés armar el pedido desde
          acá o pedírselo a Claude: “haceme un pedido de creativos con el grupo …”.
        </p>
      </div>
    );

  return (
    <div>
      {groups.map((g) => (
        <div className="card" key={g.id}>
          <div className="row between wrap">
            <div>
              <h2 style={{ margin: 0 }}>{g.name}</h2>
              <span className="muted small">
                {g.ad_ids.length} referencias · {g.hook_ids.length} hooks · {new Date(g.updated_at).toLocaleDateString("es-AR")}
              </span>
            </div>
            <div className="row wrap">
              <button onClick={() => setPedidoFor(g)} disabled={g.ad_ids.length === 0}>Crear pedido de creativos →</button>
              <button className="ghost" onClick={() => { sel.clear(); sel.set(g.ad_ids); g.hook_ids.forEach((h) => sel.toggleHook(h)); }}>
                Cargar en la selección
              </button>
              <button className="ghost small" onClick={() => rename(g)}>Renombrar</button>
              <button className="ghost small danger" onClick={() => remove(g)}>Borrar</button>
            </div>
          </div>
          {(["ad_ids", "hook_ids"] as const).map((kind) =>
            g[kind].length ? (
              <div key={kind}>
                <h3 className="small muted" style={{ margin: "14px 0 6px" }}>{kind === "ad_ids" ? "Referencias" : "Hooks"}</h3>
                <div className="group-strip">
                  {g[kind].map((id) => {
                    const a = ads.get(id);
                    return (
                      <div key={id} className="group-item">
                        {a ? <MediaView media={a.media} compact clip={kind === "hook_ids"} /> : <div className="media empty">—</div>}
                        <div className="row between small">
                          <span className="ellipsis">{a?.page_name ?? ""}</span>
                          <button className="ghost small icon" title="Sacar del grupo" onClick={() => dropAd(g, id, kind)}>✕</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null,
          )}
        </div>
      ))}
      {pedidoFor && (
        <PedidoDialog clients={[client]} clientId={client.id} adIds={pedidoFor.ad_ids} hookIds={pedidoFor.hook_ids} onClose={() => setPedidoFor(null)} />
      )}
    </div>
  );
}
