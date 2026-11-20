import { createContext, useContext, useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { APP_NAME, supabase } from "./lib.ts";
import Home from "./pages/Home.tsx";
import Library from "./pages/Library.tsx";
import SearchPage from "./pages/Search.tsx";
import Searches from "./pages/Searches.tsx";
import Clients from "./pages/Clients.tsx";
import Pedidos from "./pages/Pedidos.tsx";
import PedidoEditor from "./pages/PedidoEditor.tsx";
import PedidoPublic from "./pages/PedidoPublic.tsx";
import RefsPublic from "./pages/RefsPublic.tsx";
import Login from "./pages/Login.tsx";

// ---- Selección de anuncios para armar un pedido o compartir referencias (persiste en el navegador) ----
type Sel = { ids: string[]; toggle: (id: string) => void; clear: () => void; set: (ids: string[]) => void };
const SelectionCtx = createContext<Sel>({ ids: [], toggle: () => {}, clear: () => {}, set: () => {} });
export const useSelection = () => useContext(SelectionCtx);

function loadSel(): string[] {
  try {
    return JSON.parse(localStorage.getItem("seleccion") ?? "[]");
  } catch {
    return [];
  }
}

export default function App() {
  const location = useLocation();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [ids, setIds] = useState<string[]>(loadSel);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("seleccion", JSON.stringify(ids));
    } catch {
      /* sin almacenamiento local */
    }
  }, [ids]);

  // Los links para el cliente (pedido y referencias) no piden login
  if (location.pathname.startsWith("/p/") || location.pathname.startsWith("/r/")) {
    return (
      <Routes>
        <Route path="/p/:slug" element={<PedidoPublic />} />
        <Route path="/r/:slug" element={<RefsPublic />} />
      </Routes>
    );
  }

  if (session === undefined) return <div className="center muted">Cargando…</div>;
  if (!session) return <Login />;

  const sel: Sel = {
    ids,
    toggle: (id) => setIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])),
    clear: () => setIds([]),
    set: setIds,
  };

  return (
    <SelectionCtx.Provider value={sel}>
      <header className="topbar">
        <NavLink to="/" className="brand">
          <span className="dot" /> {APP_NAME}
        </NavLink>
        <nav>
          <NavLink to="/" end>Inicio</NavLink>
          <NavLink to="/busquedas">Historial de búsquedas</NavLink>
          <NavLink to="/biblioteca">Biblioteca</NavLink>
          <NavLink to="/pedidos">Pedidos</NavLink>
          <NavLink to="/clientes">Clientes</NavLink>
        </nav>
        <button className="ghost small" onClick={() => supabase.auth.signOut()}>
          Salir
        </button>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/buscar" element={<SearchPage />} />
          <Route path="/busquedas" element={<Searches />} />
          <Route path="/biblioteca" element={<Library />} />
          <Route path="/clientes" element={<Clients />} />
          <Route path="/pedidos" element={<Pedidos />} />
          <Route path="/pedidos/:id" element={<PedidoEditor />} />
        </Routes>
      </main>
    </SelectionCtx.Provider>
  );
}
