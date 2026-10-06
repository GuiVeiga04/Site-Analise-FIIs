import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { api } from "./api/client";
import { data } from "./lib/format";
import { useAsync } from "./lib/useAsync";
import Calculadora from "./pages/Calculadora";
import Comparar from "./pages/Comparar";
import DetalheFundo from "./pages/DetalheFundo";
import Metodologia from "./pages/Metodologia";
import VisaoGeral from "./pages/VisaoGeral";

export default function App() {
  const meta = useAsync(api.meta, []);
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">🏢 FIIs</span>
          <nav className="nav">
            <NavLink to="/" end>Visão Geral</NavLink>
            <NavLink to="/fundo">Detalhe por fundo</NavLink>
            <NavLink to="/comparar">Comparar</NavLink>
            <NavLink to="/calculadora">Calculadora</NavLink>
            <NavLink to="/metodologia">Metodologia</NavLink>
          </nav>
          <span className="updated">Último pregão: <b>{data(meta.data?.ultimo_pregao)}</b></span>
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<VisaoGeral />} />
          <Route path="/fundo" element={<DetalheFundo />} />
          <Route path="/fundo/:ticker" element={<DetalheFundo />} />
          <Route path="/comparar" element={<Comparar />} />
          <Route path="/calculadora" element={<Calculadora />} />
          <Route path="/metodologia" element={<Metodologia />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}
