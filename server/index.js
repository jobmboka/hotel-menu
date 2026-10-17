require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { PrismaClient } = require("@prisma/client");
const mpesa = require("./mpesa");
const { randomUUID, scryptSync, timingSafeEqual } = require("crypto");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const prisma = new PrismaClient({
  omit: { restaurant: { staffPasswordHash: true } },
});
const app = express();
app.use(cors());
app.use(express.json());
if (!process.env.STAFF_JWT_SECRET) {
  console.error("STAFF_JWT_SECRET is missing in .env. Add it and restart.");
  process.exit(1);
}
// Number of reverse proxies in front of this server (0 locally; set when deploying)
app.set("trust proxy", Number(process.env.TRUST_PROXY || 0));
// Generous per-IP caps: many guests share one hotel Wi-Fi address.
const tenMinutes = 10 * 60 * 1000;
const orderLimiter = rateLimit({
  windowMs: tenMinutes,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many orders from this connection. Please wait a few minutes." },
});
const payLimiter = rateLimit({
  windowMs: tenMinutes,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many payment requests from this connection. Please wait a few minutes." },
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many failed logins. Try again in 15 minutes." },
});
app.post("/api/orders", orderLimiter);
app.post("/api/track/:token/pay", payLimiter);
app.post("/api/staff/:slug/login", loginLimiter);
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.get("/api/menu/:slug", async (req, res) => {
  const restaurant = await prisma.restaurant.findUnique({
    where: { slug: req.params.slug },
    include: {
      categories: {
        orderBy: { sortOrder: "asc" },
        include: { items: { where: { available: true } } },
      },
    },
  });
  if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
  res.json({ name: restaurant.name, slug: restaurant.slug, categories: restaurant.categories });
});
app.post("/api/orders", async (req, res) => {
  try {
    const { slug, table, phone, items } = req.body || {};
    const tableNumber = Number.parseInt(table, 10);
    if (!slug || !Number.isInteger(tableNumber)) {
      return res.status(400).json({ error: "slug and table are required" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Cart is empty" });
    }
    let cleanPhone = null;
    if (phone) {
      cleanPhone = mpesa.normalizePhone(phone);
      if (!cleanPhone) {
        return res.status(400).json({ error: "Enter a valid Safaricom number, e.g. 0712345678" });
      }
    }
    if (typeof slug !== "string" || items.length > 50) {
      return res.status(400).json({ error: "Invalid order" });
    }
    const restaurant = await prisma.restaurant.findUnique({ where: { slug } });
    if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
    const tableRow = await prisma.table.findUnique({
      where: { restaurantId_number: { restaurantId: restaurant.id, number: tableNumber } },
    });
    if (!tableRow) return res.status(404).json({ error: "Table not found" });
    const unpaidAtTable = await prisma.order.count({
      where: {
        tableId: tableRow.id,
        status: "PENDING_PAYMENT",
        createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
      },
    });
    if (unpaidAtTable >= 6) {
      return res.status(429).json({
        error: "This table has too many unpaid orders. Please complete payment or ask staff for help.",
      });
    }
    const ids = items.map((i) => Number(i.menuItemId));
    const menuItems = await prisma.menuItem.findMany({
      where: { id: { in: ids }, available: true, category: { restaurantId: restaurant.id } },
    });
    const byId = new Map(menuItems.map((m) => [m.id, m]));
    const lines = [];
    for (const i of items) {
      const qty = Number(i.quantity);
      const m = byId.get(Number(i.menuItemId));
      if (!m || !Number.isInteger(qty) || qty < 1 || qty > 20) {
        return res.status(400).json({ error: "Invalid item in cart" });
      }
      lines.push({ menuItemId: m.id, name: m.name, price: m.price, quantity: qty });
    }
    const total = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
    const order = await prisma.order.create({
      data: {
        restaurantId: restaurant.id,
        tableId: tableRow.id,
        total,
        customerPhone: cleanPhone,
        publicToken: randomUUID(),
        items: { create: lines },
      },
      include: { items: true },
    });
    res.status(201).json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not create order" });
  }
});
app.post("/api/track/:token/pay", async (req, res) => {
  try {
    const order = await prisma.order.findUnique({ where: { publicToken: req.params.token } });
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status !== "PENDING_PAYMENT") {
      return res.status(400).json({ error: "Order is not awaiting payment" });
    }
    const phone = mpesa.normalizePhone((req.body && req.body.phone) || order.customerPhone);
    if (!phone) return res.status(400).json({ error: "Enter a valid Safaricom number, e.g. 0712345678" });
    const now = Date.now();
    const justSent = await prisma.payment.findFirst({
      where: { orderId: order.id, status: "PENDING", createdAt: { gte: new Date(now - 60 * 1000) } },
    });
    if (justSent) {
      return res.status(429).json({ error: "A payment request was just sent. Check your phone, or wait a minute to try again." });
    }
    const attempts = await prisma.payment.count({ where: { orderId: order.id } });
    if (attempts >= 5) {
      return res.status(429).json({ error: "Too many payment attempts for this order. Please ask staff for help." });
    }
    const toThisPhone = await prisma.payment.count({
      where: { phone, createdAt: { gte: new Date(now - 10 * 60 * 1000) } },
    });
    if (toThisPhone >= 5) {
      return res.status(429).json({ error: "Too many payment requests to this number. Please wait a few minutes." });
    }
    const push = await mpesa.stkPush({ phone, amount: order.total, orderId: order.id });
    const payment = await prisma.payment.create({
      data: { orderId: order.id, phone, amount: order.total, checkoutRequestId: push.CheckoutRequestID },
    });
    res.json({ paymentId: payment.id, message: "Check your phone to complete payment" });
  } catch (err) {
    console.error("STK push error:", err.message);
    res.status(502).json({ error: "Could not start M-Pesa payment. Please try again." });
  }
});

app.post("/api/payments/callback/:secret", async (req, res) => {
  // Always acknowledge quickly so Safaricom does not retry
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  try {
    if (req.params.secret !== process.env.MPESA_CALLBACK_SECRET) {
      console.warn("Callback with wrong secret ignored");
      return;
    }
    const cb = req.body && req.body.Body && req.body.Body.stkCallback;
    if (!cb) return;
    console.log("M-Pesa callback:", JSON.stringify(cb));
    const payment = await prisma.payment.findUnique({
      where: { checkoutRequestId: cb.CheckoutRequestID },
    });
    if (!payment || payment.status !== "PENDING") return; // unknown or already handled
    if (cb.ResultCode === 0) {
      const meta = Object.fromEntries(
        ((cb.CallbackMetadata && cb.CallbackMetadata.Item) || []).map((i) => [i.Name, i.Value])
      );
      if (Number(meta.Amount) !== payment.amount) {
        console.error("Amount mismatch:", meta.Amount, "expected", payment.amount);
        return;
      }
      await prisma.$transaction([
        prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: "SUCCESS",
            mpesaReceipt: meta.MpesaReceiptNumber ? String(meta.MpesaReceiptNumber) : null,
          },
        }),
        prisma.order.update({ where: { id: payment.orderId }, data: { status: "PAID" } }),
      ]);
    } else {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
    }
  } catch (err) {
    console.error("Callback error:", err);
  }
});
function verifyPassword(password, stored) {
  if (typeof password !== "string" || password.length === 0 || password.length > 200 || !stored) return false;
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function requireStaff(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    const payload = jwt.verify(token, process.env.STAFF_JWT_SECRET, { algorithms: ["HS256"] });
    req.staff = { restaurantId: payload.rid };
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}
function cleanText(v, max) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length >= 1 && t.length <= max ? t : null;
}
function validPrice(v) {
  if (typeof v !== "number" && typeof v !== "string") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 100000 ? n : null;
}
function idParam(req) {
  const n = Number(req.params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
}
function fail(res, err) {
  if (err && err.code === "P2025") return res.status(404).json({ error: "Not found" });
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
}
// The restaurant in the URL, but only if it is the logged-in staff member's own.
async function staffRestaurant(req, res, include) {
  const restaurant = await prisma.restaurant.findUnique({ where: { slug: req.params.slug }, include });
  if (!restaurant || restaurant.id !== req.staff.restaurantId) {
    res.status(404).json({ error: "Restaurant not found" });
    return null;
  }
  return restaurant;
}
async function ownedCategory(req, res, id) {
  const category = await prisma.category.findUnique({ where: { id } });
  if (!category || category.restaurantId !== req.staff.restaurantId) {
    res.status(404).json({ error: "Category not found" });
    return null;
  }
  return category;
}
async function ownedItem(req, res, id) {
  const item = await prisma.menuItem.findUnique({ where: { id }, include: { category: true } });
  if (!item || item.category.restaurantId !== req.staff.restaurantId) {
    res.status(404).json({ error: "Item not found" });
    return null;
  }
  return item;
}
app.post("/api/staff/:slug/login", async (req, res) => {
  try {
    const restaurant = await prisma.restaurant.findUnique({
      where: { slug: req.params.slug },
      omit: { staffPasswordHash: false },
    });
    const ok = restaurant && verifyPassword(req.body && req.body.password, restaurant.staffPasswordHash);
    if (!ok) return res.status(401).json({ error: "Invalid password" });
    const token = jwt.sign({ rid: restaurant.id }, process.env.STAFF_JWT_SECRET, {
      algorithm: "HS256",
      expiresIn: "12h",
    });
    res.json({ token, name: restaurant.name });
  } catch (err) {
    fail(res, err);
  }
});
const NEXT_STATUS = { PAID: "PREPARING", PREPARING: "READY", READY: "SERVED" };
app.get("/api/staff/:slug/orders", requireStaff, async (req, res) => {
  try {
    const restaurant = await staffRestaurant(req, res);
    if (!restaurant) return;
    const orders = await prisma.order.findMany({
      where: { restaurantId: restaurant.id, status: { in: ["PAID", "PREPARING", "READY"] } },
      include: { items: true, table: true },
      orderBy: { createdAt: "asc" },
    });
    res.json(orders);
  } catch (err) {
    fail(res, err);
  }
});
app.patch("/api/staff/orders/:id/status", requireStaff, async (req, res) => {
  try {
    const id = idParam(req);
    if (!id) return res.status(400).json({ error: "Invalid order" });
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order || order.restaurantId !== req.staff.restaurantId) {
      return res.status(404).json({ error: "Order not found" });
    }
    const next = NEXT_STATUS[order.status];
    if (!next || (req.body && req.body.status) !== next) {
      return res.status(400).json({ error: "Invalid status change" });
    }
    const result = await prisma.order.updateMany({
      where: { id: order.id, status: order.status },
      data: { status: next },
    });
    if (result.count === 0) return res.status(409).json({ error: "Order was already updated" });
    res.json({ id: order.id, status: next });
  } catch (err) {
    fail(res, err);
  }
});
app.get("/api/staff/:slug/tables", requireStaff, async (req, res) => {
  try {
    const restaurant = await staffRestaurant(req, res, { tables: { orderBy: { number: "asc" } } });
    if (!restaurant) return;
    res.json({ name: restaurant.name, tables: restaurant.tables.map((t) => t.number) });
  } catch (err) {
    fail(res, err);
  }
});
app.get("/api/staff/:slug/menu", requireStaff, async (req, res) => {
  try {
    const restaurant = await staffRestaurant(req, res, {
      categories: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        include: { items: { orderBy: { id: "asc" } } },
      },
    });
    if (!restaurant) return;
    res.json({ id: restaurant.id, name: restaurant.name, categories: restaurant.categories });
  } catch (err) {
    fail(res, err);
  }
});
app.post("/api/staff/:slug/categories", requireStaff, async (req, res) => {
  try {
    const name = cleanText(req.body && req.body.name, 60);
    if (!name) return res.status(400).json({ error: "Category name is required (max 60 characters)" });
    const restaurant = await staffRestaurant(req, res);
    if (!restaurant) return;
    const last = await prisma.category.findFirst({
      where: { restaurantId: restaurant.id },
      orderBy: { sortOrder: "desc" },
    });
    const category = await prisma.category.create({
      data: { name, restaurantId: restaurant.id, sortOrder: (last ? last.sortOrder : 0) + 1 },
    });
    res.status(201).json(category);
  } catch (err) {
    fail(res, err);
  }
});
app.patch("/api/staff/categories/:id", requireStaff, async (req, res) => {
  try {
    const id = idParam(req);
    const name = cleanText(req.body && req.body.name, 60);
    if (!id || !name) {
      return res.status(400).json({ error: "A valid category name is required (max 60 characters)" });
    }
    if (!(await ownedCategory(req, res, id))) return;
    res.json(await prisma.category.update({ where: { id }, data: { name } }));
  } catch (err) {
    fail(res, err);
  }
});
app.delete("/api/staff/categories/:id", requireStaff, async (req, res) => {
  try {
    const id = idParam(req);
    if (!id) return res.status(400).json({ error: "Invalid category" });
    if (!(await ownedCategory(req, res, id))) return;
    const count = await prisma.menuItem.count({ where: { categoryId: id } });
    if (count > 0) {
      return res.status(400).json({ error: "This category still has items. Delete or empty it first." });
    }
    await prisma.category.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});
app.post("/api/staff/categories/:id/items", requireStaff, async (req, res) => {
  try {
    const id = idParam(req);
    if (!id) return res.status(400).json({ error: "Invalid category" });
    if (!(await ownedCategory(req, res, id))) return;
    const b = req.body || {};
    const name = cleanText(b.name, 80);
    const price = validPrice(b.price);
    if (!name || price === null) {
      return res.status(400).json({ error: "Name and a whole-shilling price (1 to 100000) are required" });
    }
    let description = null;
    if (typeof b.description === "string" && b.description.trim() !== "") {
      description = cleanText(b.description, 300);
      if (!description) return res.status(400).json({ error: "Description is too long (max 300 characters)" });
    }
    const item = await prisma.menuItem.create({ data: { name, price, description, categoryId: id } });
    res.status(201).json(item);
  } catch (err) {
    fail(res, err);
  }
});
app.patch("/api/staff/items/:id", requireStaff, async (req, res) => {
  try {
    const id = idParam(req);
    if (!id) return res.status(400).json({ error: "Invalid item" });
    if (!(await ownedItem(req, res, id))) return;
    const b = req.body || {};
    const data = {};
    if (b.name !== undefined) {
      const v = cleanText(b.name, 80);
      if (!v) return res.status(400).json({ error: "Item name is required (max 80 characters)" });
      data.name = v;
    }
    if (b.price !== undefined) {
      const v = validPrice(b.price);
      if (v === null) return res.status(400).json({ error: "Price must be a whole number of shillings (1 to 100000)" });
      data.price = v;
    }
    if (b.description !== undefined) {
      if (typeof b.description !== "string" || b.description.trim().length > 300) {
        return res.status(400).json({ error: "Description is too long (max 300 characters)" });
      }
      data.description = b.description.trim() || null;
    }
    if (b.available !== undefined) {
      if (typeof b.available !== "boolean") return res.status(400).json({ error: "Invalid availability" });
      data.available = b.available;
    }
    if (Object.keys(data).length === 0) return res.status(400).json({ error: "Nothing to update" });
    res.json(await prisma.menuItem.update({ where: { id }, data }));
  } catch (err) {
    fail(res, err);
  }
});
app.delete("/api/staff/items/:id", requireStaff, async (req, res) => {
  try {
    const id = idParam(req);
    if (!id) return res.status(400).json({ error: "Invalid item" });
    if (!(await ownedItem(req, res, id))) return;
    const used = await prisma.orderItem.count({ where: { menuItemId: id } });
    if (used > 0) {
      await prisma.menuItem.update({ where: { id }, data: { available: false } });
      return res.json({ ok: true, archived: true });
    }
    await prisma.menuItem.delete({ where: { id } });
    res.json({ ok: true, archived: false });
  } catch (err) {
    fail(res, err);
  }
});
app.get("/api/track/:token", async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { publicToken: req.params.token },
      include: { items: true, table: true, payments: { orderBy: { id: "asc" } } },
    });
    if (!order) return res.status(404).json({ error: "Order not found" });
    const latest = order.payments[order.payments.length - 1];
    res.json({
      id: order.id,
      status: order.status,
      total: order.total,
      tableNumber: order.table.number,
      createdAt: order.createdAt,
      paymentStatus: latest ? latest.status : null,
      items: order.items.map((i) => ({ id: i.id, name: i.name, price: i.price, quantity: i.quantity })),
    });
  } catch (err) {
    fail(res, err);
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));