import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
function ItemForm({ value, onChange, onSave, onCancel, busy, saveLabel }) {
  return (
    <div className="admin-form">
      <input
        placeholder="Item name"
        value={value.name}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
      />
      <input
        placeholder="Price (KES, whole number)"
        inputMode="numeric"
        value={value.price}
        onChange={(e) => onChange({ ...value, price: e.target.value })}
      />
      <input
        placeholder="Description (optional)"
        value={value.description}
        onChange={(e) => onChange({ ...value, description: e.target.value })}
      />
      <div className="admin-actions">
        <button className="primary" onClick={onSave} disabled={busy}>{saveLabel}</button>
        <button className="secondary" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}
export default function AdminPage() {
  const { slug } = useParams();
  const [key] = useState(() => {
    try { return sessionStorage.getItem("staffToken:" + slug) || ""; } catch { return ""; }
  });
  const [menu, setMenu] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [renamingCat, setRenamingCat] = useState(null); // { id, name }
  const [editing, setEditing] = useState(null); // { id, name, price, description }
  const [adding, setAdding] = useState(null); // { categoryId, name, price, description }
  const api = useCallback(
    async (method, path, body) => {
      const res = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 401) throw new Error("Session expired. Log in again on the dashboard.");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Request failed");
      return data;
    },
    [key]
  );
  const load = useCallback(async () => {
    try {
      setMenu(await api("GET", `/api/staff/${slug}/menu`));
    } catch (e) {
      setError(e.message);
    }
  }, [api, slug]);
  useEffect(() => {
    if (key) load();
  }, [key, load]);
  const run = async (fn) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await fn();
      await load();
      return result;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const addCategory = async (e) => {
    e.preventDefault();
    if (!newCat.trim()) return;
    const ok = await run(() => api("POST", `/api/staff/${slug}/categories`, { name: newCat }));
    if (ok) setNewCat("");
  };
  const saveCategory = async () => {
    const ok = await run(() =>
      api("PATCH", `/api/staff/categories/${renamingCat.id}`, { name: renamingCat.name })
    );
    if (ok) setRenamingCat(null);
  };
  const deleteCategory = async (c) => {
    if (!window.confirm(`Delete category "${c.name}"?`)) return;
    await run(() => api("DELETE", `/api/staff/categories/${c.id}`));
  };
  const addItem = async () => {
    const ok = await run(() =>
      api("POST", `/api/staff/categories/${adding.categoryId}/items`, {
        name: adding.name,
        price: adding.price,
        description: adding.description,
      })
    );
    if (ok) setAdding(null);
  };
  const saveItem = async () => {
    const ok = await run(() =>
      api("PATCH", `/api/staff/items/${editing.id}`, {
        name: editing.name,
        price: editing.price,
        description: editing.description,
      })
    );
    if (ok) setEditing(null);
  };
  const toggleItem = (item) =>
    run(() => api("PATCH", `/api/staff/items/${item.id}`, { available: !item.available }));
  const deleteItem = async (item) => {
    if (!window.confirm(`Delete "${item.name}"?`)) return;
    const r = await run(() => api("DELETE", `/api/staff/items/${item.id}`));
    if (r && r.archived) {
      setNotice(`"${item.name}" has past orders, so it was marked sold out instead of deleted.`);
    }
  };
  if (!key) {
    return (
      <div className="page">
        <p className="notice">
          Log in on the <Link to={`/staff/${slug}`}>staff dashboard</Link> first, then come back here.
        </p>
      </div>
    );
  }
  if (!menu) return <p className="notice">{error || "Loading menu..."}</p>;
  return (
    <div className="admin-wrap">
      <h1>Menu admin - {menu.name}</h1>
      <div className="admin-links">
        <Link to={`/staff/${slug}`}>Orders dashboard</Link>
        <Link to={`/staff/${slug}/qr`}>Table QR codes</Link>
        <a href={`/m/${slug}`} target="_blank" rel="noreferrer">View customer menu</a>
      </div>
      {error && <p className="error">{error}</p>}
      {notice && <p className="hint">{notice}</p>}
      <form className="admin-inline" onSubmit={addCategory}>
        <input
          placeholder="New category name (e.g. Starters)"
          value={newCat}
          onChange={(e) => setNewCat(e.target.value)}
        />
        <button className="primary" type="submit" disabled={busy}>Add category</button>
      </form>
      {menu.categories.length === 0 && <p className="hint">No categories yet. Add one above.</p>}
      {menu.categories.map((c) => (
        <section className="admin-cat" key={c.id}>
          <div className="admin-cat-head">
            {renamingCat && renamingCat.id === c.id ? (
              <>
                <input
                  value={renamingCat.name}
                  onChange={(e) => setRenamingCat({ ...renamingCat, name: e.target.value })}
                />
                <div className="admin-actions">
                  <button className="mini" disabled={busy} onClick={saveCategory}>Save</button>
                  <button className="mini" disabled={busy} onClick={() => setRenamingCat(null)}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                <h2>{c.name}</h2>
                <div className="admin-actions">
                  <button
                    className="mini"
                    disabled={busy}
                    onClick={() => setRenamingCat({ id: c.id, name: c.name })}
                  >
                    Rename
                  </button>
                  <button className="mini danger" disabled={busy} onClick={() => deleteCategory(c)}>Delete</button>
                </div>
              </>
            )}
          </div>
          {c.items.length === 0 && <p className="hint">No items yet</p>}
          {c.items.map((item) => (
            <div className={"admin-item" + (item.available ? "" : " off")} key={item.id}>
              {editing && editing.id === item.id ? (
                <ItemForm
                  value={editing}
                  onChange={setEditing}
                  onSave={saveItem}
                  onCancel={() => setEditing(null)}
                  busy={busy}
                  saveLabel="Save changes"
                />
              ) : (
                <>
                  <div className="admin-item-info">
                    <strong>{item.name}</strong> <span className="price">KES {item.price}</span>
                    {!item.available && <span className="badge">Sold out</span>}
                    {item.description && <p>{item.description}</p>}
                  </div>
                  <div className="admin-actions">
                    <button
                      className="mini"
                      disabled={busy}
                      onClick={() =>
                        setEditing({
                          id: item.id,
                          name: item.name,
                          price: String(item.price),
                          description: item.description || "",
                        })
                      }
                    >
                      Edit
                    </button>
                    <button className="mini" disabled={busy} onClick={() => toggleItem(item)}>
                      {item.available ? "Mark sold out" : "Mark available"}
                    </button>
                    <button className="mini danger" disabled={busy} onClick={() => deleteItem(item)}>Delete</button>
                  </div>
                </>
              )}
            </div>
          ))}
          {adding && adding.categoryId === c.id ? (
            <ItemForm
              value={adding}
              onChange={setAdding}
              onSave={addItem}
              onCancel={() => setAdding(null)}
              busy={busy}
              saveLabel="Add item"
            />
          ) : (
            <button
              className="mini"
              disabled={busy}
              onClick={() => setAdding({ categoryId: c.id, name: "", price: "", description: "" })}
            >
              + Add item
            </button>
          )}
        </section>
      ))}
    </div>
  );
}