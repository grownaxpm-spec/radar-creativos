import { useState } from "react";
import { supabase } from "../lib.ts";

export default function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <div className="login">
      <form className="card" onSubmit={send}>
        <h1>Pedido de Creativos</h1>
        <p className="muted">Referencias de anuncios del mercado para armar pedidos de piezas.</p>
        {sent ? (
          <p>Te mandamos un link a <b>{email}</b>. Abrilo para entrar.</p>
        ) : (
          <>
            <label>
              Tu email
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vos@agencia.com" />
            </label>
            <button type="submit">Entrar con link por email</button>
            {error && <p className="error">{error}</p>}
          </>
        )}
      </form>
    </div>
  );
}
