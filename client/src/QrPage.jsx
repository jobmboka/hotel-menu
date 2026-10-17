import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
export default function QrPage() {
  const { slug } = useParams();
  const [key] = useState(() => {
    try { return sessionStorage.getItem("staffToken:" + slug) || ""; } catch { return ""; }
  });
  const [base, setBase] = useState(window.location.origin);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!key) return;
    fetch(`/api/staff/${slug}/tables`, { headers: { Authorization: `Bearer ${key}` } })
      .then((r) => {
        if (r.status === 401) throw new Error("Session expired. Log in again on the dashboard.");
        if (!r.ok) throw new Error("Could not load tables");
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [key, slug]);
  if (!key) {
    return (
      <div className="page">
        <p className="notice">Log in on the <Link to={`/staff/${slug}`}>staff dashboard</Link> first, then come back here.</p>
      </div>
    );
  }
  if (error) return <p className="notice">{error}</p>;
  if (!data) return <p className="notice">Loading tables...</p>;
  const cleanBase = base.trim().replace(/\/+$/, "");
  return (
    <div className="board-wrap">
      <div className="no-print">
        <h1>Table QR codes - {data.name}</h1>
        <div className="qr-controls">
          <div>
            <label htmlFor="base">Public site address (what the QR codes point to)</label>
            <input id="base" value={base} onChange={(e) => setBase(e.target.value)} />
          </div>
          <button className="primary" onClick={() => window.print()}>Print</button>
          <Link to={`/staff/${slug}`}>Back to dashboard</Link>
        </div>
        <p className="hint">
          Use your real domain for printed codes. Codes made with a localhost or temporary address will stop working.
        </p>
      </div>
      <div className="qr-grid">
        {data.tables.map((n) => {
          const url = `${cleanBase}/m/${slug}?table=${n}`;
          return (
            <div className="qr-card" key={n}>
              <strong>{data.name}</strong>
              <QRCodeSVG value={url} size={180} marginSize={2} />
              <h3>Table {n}</h3>
              <p className="hint">Scan to view the menu and order</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}