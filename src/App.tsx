import { createContext, useContext, useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib.ts";
import Home from "./pages/Home.tsx";
import Library from "./pages/Library.tsx";
import SearchPage from "./pages/Search.tsx";
import Searches from "./pages/Searches.tsx";
import ClientPage from "./pages/ClientPage.tsx";
import Pedidos from "./pages/Pedidos.tsx";
import PedidoEditor from "./pages/PedidoEditor.tsx";
import PedidoPublic from "./pages/PedidoPublic.tsx";
import RefsPublic from "./pages/RefsPublic.tsx";
import Login from "./pages/Login.tsx";

// ---- Selección para armar un pedido (persiste en el navegador) ----
// ids: referencias (una pieza por cada una) · hookIds: videos cuyo hook de 5 s va en "Hooks sugeridos"
type Sel = {
  ids: string[];
  hookIds: string[];
  toggle: (id: string) => void;
  toggleHook: (id: string) => void;
  clear: () => void;
  set: (ids: string[]) => void;
};
const SelectionCtx = createContext<Sel>({ ids: [], hookIds: [], toggle: () => {}, toggleHook: () => {}, clear: () => {}, set: () => {} });
export const useSelection = () => useContext(SelectionCtx);

function loadSel(key: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]");
  } catch {
    return [];
  }
}
const flip = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

export default function App() {
  const location = useLocation();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [ids, setIds] = useState<string[]>(() => loadSel("seleccion"));
  const [hookIds, setHookIds] = useState<string[]>(() => loadSel("seleccion-hooks"));

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("seleccion", JSON.stringify(ids));
      localStorage.setItem("seleccion-hooks", JSON.stringify(hookIds));
    } catch {
      /* sin almacenamiento local */
    }
  }, [ids, hookIds]);

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
    hookIds,
    toggle: (id) => setIds((s) => flip(s, id)),
    toggleHook: (id) => setHookIds((s) => flip(s, id)),
    clear: () => {
      setIds([]);
      setHookIds([]);
    },
    set: setIds,
  };

  return (
    <SelectionCtx.Provider value={sel}>
      <header className="topbar">
        <NavLink to="/" className="brand" title="Volver al inicio">
          <img src="/grownax-logo.png" alt="Grownax" />
        </NavLink>
        <span className="grow" />
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
          <Route path="/clientes/:id" element={<ClientPage />} />
          <Route path="/pedidos" element={<Pedidos />} />
          <Route path="/pedidos/:id" element={<PedidoEditor />} />
        </Routes>
      </main>
    </SelectionCtx.Provider>
  );
}
