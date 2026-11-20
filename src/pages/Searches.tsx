import { Link } from "react-router-dom";
import SearchList from "./SearchList.tsx";

export default function Searches() {
  return (
    <div className="card">
      <div className="row between wrap" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Historial de búsquedas</h2>
        <Link to="/buscar"><button>+ Empezar nueva búsqueda</button></Link>
      </div>
      <SearchList />
    </div>
  );
}
