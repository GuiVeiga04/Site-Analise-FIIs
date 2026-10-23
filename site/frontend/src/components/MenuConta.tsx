import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../lib/auth";

/** Canto direito do topo: "Entrar" ou o e-mail de quem está logado. */
export function MenuConta() {
  const auth = useAuth();
  if (auth.carregando) return <span className="menu-conta" aria-hidden="true" />;
  if (!auth.usuario) return <Link to="/entrar" className="btn btn-primario menu-conta">Entrar</Link>;
  const email = auth.usuario.email ?? "";
  const foto = auth.usuario.user_metadata?.avatar_url as string | undefined;
  return (
    <NavLink to="/carteira" className="menu-conta conta-logada" title={`Conectado como ${email}`}>
      {foto
        ? <img src={foto} alt="" width={26} height={26} referrerPolicy="no-referrer" />
        : <span className="avatar-letra" aria-hidden="true">{email.slice(0, 1).toUpperCase()}</span>}
      <span className="conta-email">{email}</span>
    </NavLink>
  );
}
