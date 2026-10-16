import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
const STEPS = [
  { status: "PAID", label: "Order received" },
  { status: "PREPARING", label: "Being prepared" },
  { status: "READY", label: "Ready - on its way to your table" },
  { status: "SERVED", label: "Served. Enjoy your meal!" },
];
export default function TrackPage() {
  const { token } = useParams();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/track/${token}`);
        if (r.status === 404) {
          if (!stop) setError("We could not find this order.");
          return;
        }
        if (!r.ok) throw new Error("Could not load order");
        const data = await r.json();
        if (!stop) {
          setOrder(data);
          setError("");
        }
      } catch {
        if (!stop) setError("Connection problem. Retrying...");
      }
    };
    load();
    const t = setInterval(load, 4000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [token]);
  if (!order) return <p className="notice">{error || "Loading your order..."}</p>;
  const current = STEPS.findIndex((s) => s.status === order.status);
  const awaitingPayment = order.status === "PENDING_PAYMENT";
  return (
    <div className="page">
      <header className="header">
        <h1>Order #{order.id}</h1>
        <span className="table-badge">Table {order.tableNumber}</span>
      </header>
      {awaitingPayment && (
        <p className={order.paymentStatus === "FAILED" ? "error" : "hint"}>
          {order.paymentStatus === "FAILED"
            ? "Payment was not completed. Please ask a member of staff for help."
            : "Waiting for your M-Pesa payment..."}
        </p>
      )}
      {order.status === "CANCELLED" && <p className="error">This order was cancelled.</p>}
      {current >= 0 && (
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s.status} className={i < current ? "done" : i === current ? "current" : ""}>
              {s.label}
            </li>
          ))}
        </ol>
      )}
      <h2>Your items</h2>
      <ul className="summary">
        {order.items.map((i) => (
          <li key={i.id}>
            <span>{i.quantity} x {i.name}</span>
            <span>KES {i.price * i.quantity}</span>
          </li>
        ))}
      </ul>
      <p className="total-line"><span>Total</span><strong>KES {order.total}</strong></p>
      <p className="hint">Keep this page open or save the link. It updates automatically.</p>
    </div>
  );
}