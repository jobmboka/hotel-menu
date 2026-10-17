import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
const COLUMNS = [
  { status: "PAID", title: "New", next: "PREPARING", label: "Start preparing" },
  { status: "PREPARING", title: "Preparing", next: "READY", label: "Mark ready" },
  { status: "READY", title: "Ready to serve", next: "SERVED", label: "Mark served" },
];
export default function StaffPage() {
  const { slug } = useParams();
  const [token, setToken] = useState(() => {
    try { return sessionStorage.getItem("staffToken:" + slug) || ""; } catch { return ""; }
  });
  const [password, setPassword] = useState("");
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const logout = useCallback(
    (message) => {
      try { sessionStorage.removeItem("staffToken:" + slug); } catch { /* ignore */ }
      setToken("");
      setOrders([]);
      setError(message || "");
    },
    [slug]
  );
  const load = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch(`/api/staff/${slug}/orders`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.status === 401) {
        logout("Session expired. Please log in again.");
        return;
      }
      if (r.status === 404) throw new Error("Restaurant not found");
      if (!r.ok) throw new Error("Could not load orders");
      setOrders(await r.json());
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, [token, slug, logout]);
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);
  const advance = async (order, next) => {
    try {
      const r = await fetch(`/api/staff/orders/${order.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: next }),
      });
      if (r.status === 401) {
        logout("Session expired. Please log in again.");
        return;
      }
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error || "Could not update order");
      }
    } finally {
      load();
    }
  };
  const login = async (e) => {
    e.preventDefault();
    if (!password) return;
    setLoggingIn(true);
    setError("");
    try {
      const r = await fetch(`/api/staff/${slug}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Login failed");
      try { sessionStorage.setItem("staffToken:" + slug, d.token); } catch { /* ignore */ }
      setToken(d.token);
      setPassword("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoggingIn(false);
    }
  };
  if (!token) {
    return (
      <div className="page">
        <h1>Staff login</h1>
        <form onSubmit={login}>
          <label htmlFor="spw">Password for {slug}</label>
          <input
            id="spw"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="error">{error}</p>}
          <button className="primary" type="submit" disabled={loggingIn}>
            {loggingIn ? "Logging in..." : "Log in"}
          </button>
        </form>
      </div>
    );
  }
  return (
    <div className="board-wrap">
      <header className="header">
        <h1>Orders - {slug}</h1>
        <span className="hint">
          <Link to={`/admin/${slug}`}>Edit menu</Link> - <Link to={`/staff/${slug}/qr`}>Table QR codes</Link> - Refreshes every 5s -{" "}
          <button className="mini" onClick={() => logout("")}>Log out</button>
        </span>
      </header>
      {error && <p className="error">{error}</p>}
      <div className="board">
        {COLUMNS.map((col) => {
          const list = orders.filter((o) => o.status === col.status);
          return (
            <section className="column" key={col.status}>
              <h2>{col.title} ({list.length})</h2>
              {list.length === 0 && <p className="hint">Nothing here</p>}
              {list.map((o) => (
                <div className="ticket" key={o.id}>
                  <div className="ticket-head">
                    <strong>Table {o.table.number}</strong>
                    <span>#{o.id} - {new Date(o.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <ul className="summary">
                    {o.items.map((i) => (
                      <li key={i.id}><span>{i.quantity} x {i.name}</span></li>
                    ))}
                  </ul>
                  <button className="primary" onClick={() => advance(o, col.next)}>{col.label}</button>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}