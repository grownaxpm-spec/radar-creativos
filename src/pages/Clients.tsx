import { useEffect, useState } from "react";
import { supabase, type Client } from "../lib.ts";

export default function Clients() {
  const [list, setList] = useState<Client[]>([]);
  const [name, setName] = useState("");
  const [rubro, setRubro] = useState("");
  const [drive, setDrive] = useState("");

  const load = () => supabase.from("clients").select("*").order("name").then(({ data }) => setList(data ?? []));
  useEffect(() => {
    load();
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("clients").insert({ name, rubro: rubro || null, drive_folder_url: drive || null });
    if (error) return alert(error.message);
    setName("");
    setRubro("");
    setDrive("");
    load();
  }

  async function update(c: Client, patch: Partial<Client>) {
    await supabase.from("clients").update(patch).eq("id", c.id);
    load();
  }

  return (
    <div className="two-col">
      <form className="card" onSubmit={add}>
        <h2>Nuevo cliente</h2>
        <label>
          Nombre
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Bowen" />
        </label>
        <label>
          Rubro
          <input value={rubro} onChange={(e) => setRubro(e.target.value)} placeholder="Calzado de cuero masculino" />
        </label>
        <label>
          Carpeta de creativos en Drive (link)
          <input value={drive} onChange={(e) => setDrive(e.target.value)} placeholder="https://drive.google.com/drive/folders/…" />
        </label>
        <button type="submit">Agregar</button>
      </form>
      <div className="card">
        <h2>Clientes</h2>
        <ul className="list">
          {list.map((c) => (
            <li key={c.id}>
              <div>
                <b>{c.name}</b> <span className="muted">· {c.rubro ?? "sin rubro"}</span>
                <div className="small">
                  {c.drive_folder_url ? (
                    <a href={c.drive_folder_url} target="_blank" rel="noreferrer">Carpeta de Drive ↗</a>
                  ) : (
                    <button
                      className="ghost small"
                      onClick={() => {
                        const v = prompt("Link de la carpeta de Drive");
                        if (v) update(c, { drive_folder_url: v });
                      }}
                    >
                      + carpeta de Drive
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
