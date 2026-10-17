import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
export default function MenuPage() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const table = params.get("table");
  const navigate = useNavigate();
  const [menu, setMenu] = useState(null);
  const [error, setError] = useState("");
  const [cart, setCart] = useState({}); // itemId -> { item, qty }
  const [showCheckout, setShowCheckout] = useState(false);
  const [phone, setPhone] = useState("");
  const [placing, setPlacing] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [placedOrder, setPlacedOrder] = useState(null);
  const [payStatus, setPayStatus] = useState("idle"); // idle | starting | waiting | paid | failed
  const [payMessage, setPayMessage] = useState("");
  useEffect(() => {
    fetch(`/api/menu/${slug}`)
      .then((r) => {
        if (!r.ok) throw new Error("Menu not found");
        return r.json();
      })
      .then(setMenu)
      .catch((e) => setError(e.message));
  }, [slug]);
  const add = (item) =>
    setCart((c) => ({ ...c, [item.id]: { item, qty: (c[item.id]?.qty || 0) + 1 } }));
  const remove = (item) =>
    setCart((c) => {
      const qty = (c[item.id]?.qty || 0) - 1;
      const next = { ...c };
      if (qty <= 0) delete next[item.id];
      else next[item.id] = { item, qty };
      return next;
    });
  const { count, total } = useMemo(
    () =>
      Object.values(cart).reduce(
        (a, { item, qty }) => ({ count: a.count + qty, total: a.total + qty * item.price }),
        { count: 0, total: 0 }
      ),
    [cart]
  );
  const startPayment = async (token, phoneNumber) => {
    setPayStatus("starting");
    setPayMessage("");
    try {
      const res = await fetch(`/api/track/${token}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneNumber }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start payment");
      setPayStatus("waiting");
    } catch (e) {
      setPayStatus("failed");
      setPayMessage(e.message);
    }
  };
  const orderId = placedOrder ? placedOrder.id : null;
  const orderToken = placedOrder ? placedOrder.publicToken : null;
  useEffect(() => {
    if (payStatus !== "waiting" || !orderId) return;
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      try {
        const r = await fetch(`/api/track/${orderToken}`);
        const o = await r.json();
        const latest = o.paymentStatus;
        if (latest === "SUCCESS") {
          setPayStatus("paid");
          navigate(`/track/${orderToken}`);
        } else if (latest === "FAILED") {
          setPayStatus("failed");
          setPayMessage("Payment was cancelled or failed.");
        } else if (tries >= 40) {
          setPayStatus("failed");
          setPayMessage("No confirmation received. If money was deducted, show your M-Pesa message to staff.");
        }
      } catch {
        // keep polling
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [payStatus, orderId, orderToken]);
  const placeOrder = async () => {
    setOrderError("");
    if (!table) {
      setOrderError("Table number missing. Please scan the QR code on your table again.");
      return;
    }
    if (!/^(?:\+?254|0)[17]\d{8}$/.test(phone.trim())) {
      setOrderError("Enter a valid Safaricom number, e.g. 0712345678");
      return;
    }
    setPlacing(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          table,
          phone: phone.trim(),
          items: Object.values(cart).map(({ item, qty }) => ({ menuItemId: item.id, quantity: qty })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not place order");
      setPlacedOrder(data);
      startPayment(data.publicToken, phone.trim());
      setCart({});
      setShowCheckout(false);
    } catch (e) {
      setOrderError(e.message);
    } finally {
      setPlacing(false);
    }
  };
  if (placedOrder)
    return (
      <div className="page">
        <h1>Order received</h1>
        <p>Order #{placedOrder.id} for Table {table}</p>
        <ul className="summary">
          {placedOrder.items.map((i) => (
            <li key={i.id}>
              <span>{i.quantity} x {i.name}</span>
              <span>KES {i.price * i.quantity}</span>
            </li>
          ))}
        </ul>
        <p><strong>Total: KES {placedOrder.total}</strong></p>
        {payStatus === "starting" && <p className="hint">Sending payment request to your phone...</p>}
        {payStatus === "waiting" && (
          <p className="hint">Check your phone and enter your M-Pesa PIN to pay KES {placedOrder.total}.</p>
        )}
        {payStatus === "paid" && <p className="success">Payment received. Your order is being prepared.</p>}
        {payStatus === "failed" && (
          <>
            <p className="error">{payMessage}</p>
            <button className="primary" onClick={() => startPayment(placedOrder.publicToken, phone.trim())}>
              Try payment again
            </button>
          </>
        )}
        <button
          className="secondary"
          disabled={payStatus === "starting" || payStatus === "waiting"}
          onClick={() => { setPlacedOrder(null); setPayStatus("idle"); }}
        >
          Back to menu
        </button>
      </div>
    );
  if (error) return <p className="notice">{error}</p>;
  if (!menu) return <p className="notice">Loading menu...</p>;
  return (
    <div className="page menu-page">
      <header className="header">
        <h1>{menu.name}</h1>
        {table && <span className="table-badge">Table {table}</span>}
      </header>
      {menu.categories.filter((cat) => cat.items.length > 0).map((cat) => (
        <section key={cat.id}>
          <h2>{cat.name}</h2>
          {cat.items.map((item) => (
            <div className="item" key={item.id}>
              <div className="item-info">
                <div className="item-head">
                  <strong>{item.name}</strong>
                  <span className="leader" />
                  <span className="price">KES {item.price}</span>
                </div>
                {item.description && <p>{item.description}</p>}
              </div>
              <div className="qty">
                {cart[item.id] ? (
                  <>
                    <button onClick={() => remove(item)}>-</button>
                    <span>{cart[item.id].qty}</span>
                    <button onClick={() => add(item)}>+</button>
                  </>
                ) : (
                  <button className="add" onClick={() => add(item)}>Add</button>
                )}
              </div>
            </div>
          ))}
        </section>
      ))}
      {count > 0 && !showCheckout && (
        <button className="cart-bar" onClick={() => setShowCheckout(true)}>
          <span>{count} item{count > 1 ? "s" : ""} - Review order</span>
          <strong>KES {total}</strong>
        </button>
      )}
      {showCheckout && (
        <div className="overlay">
          <div className="sheet">
            <h2>Your order{table ? " - Table " + table : ""}</h2>
            <ul className="summary">
              {Object.values(cart).map(({ item, qty }) => (
                <li key={item.id}>
                  <span>{qty} x {item.name}</span>
                  <span>KES {qty * item.price}</span>
                </li>
              ))}
            </ul>
            <p className="total-line"><span>Total</span><strong>KES {total}</strong></p>
            <label htmlFor="phone">M-Pesa phone number</label>
            <input
              id="phone"
              type="tel"
              inputMode="numeric"
              placeholder="0712345678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            {orderError && <p className="error">{orderError}</p>}
            <button className="primary" onClick={placeOrder} disabled={placing}>
              {placing ? "Placing order..." : "Place order"}
            </button>
            <button className="secondary" onClick={() => setShowCheckout(false)} disabled={placing}>
              Back to menu
            </button>
          </div>
        </div>
      )}
    </div>
  );
}