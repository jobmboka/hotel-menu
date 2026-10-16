require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { PrismaClient } = require("@prisma/client");
const mpesa = require("./mpesa");
const { randomUUID } = require("crypto");
const prisma = new PrismaClient();
const app = express();
app.use(cors());
app.use(express.json());
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
  res.json(restaurant);
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
    const restaurant = await prisma.restaurant.findUnique({ where: { slug } });
    if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
    const tableRow = await prisma.table.findUnique({
      where: { restaurantId_number: { restaurantId: restaurant.id, number: tableNumber } },
    });
    if (!tableRow) return res.status(404).json({ error: "Table not found" });
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
        customerPhone: phone || null,
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
app.get("/api/orders/:id", requireStaff, async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { id: Number(req.params.id) },
    include: { items: true, payments: { orderBy: { id: "asc" } } },
  });
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(order);
});app.post("/api/orders/:id/pay", async (req, res) => {
  try {
    const order = await prisma.order.findUnique({ where: { id: Number(req.params.id) } });
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status !== "PENDING_PAYMENT") {
      return res.status(400).json({ error: "Order is not awaiting payment" });
    }
    const phone = mpesa.normalizePhone((req.body && req.body.phone) || order.customerPhone);
    if (!phone) return res.status(400).json({ error: "A valid M-Pesa phone number is required" });
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
function requireStaff(req, res, next) {
  const key = process.env.STAFF_KEY;
  if (!key || req.get("x-staff-key") !== key) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}
const NEXT_STATUS = { PAID: "PREPARING", PREPARING: "READY", READY: "SERVED" };
app.get("/api/staff/:slug/tables", requireStaff, async (req, res) => {
  try {
    const restaurant = await prisma.restaurant.findUnique({
      where: { slug: req.params.slug },
      include: { tables: { orderBy: { number: "asc" } } },
    });
    if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
    res.json({ name: restaurant.name, tables: restaurant.tables.map((t) => t.number) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load tables" });
  }
});
app.get("/api/staff/:slug/orders", requireStaff, async (req, res) => {
  try {
    const restaurant = await prisma.restaurant.findUnique({ where: { slug: req.params.slug } });
    if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
    const orders = await prisma.order.findMany({
      where: { restaurantId: restaurant.id, status: { in: ["PAID", "PREPARING", "READY"] } },
      include: { items: true, table: true },
      orderBy: { createdAt: "asc" },
    });
    res.json(orders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load orders" });
  }
});
app.patch("/api/staff/orders/:id/status", requireStaff, async (req, res) => {
  try {
    const order = await prisma.order.findUnique({ where: { id: Number(req.params.id) } });
    if (!order) return res.status(404).json({ error: "Order not found" });
    const next = NEXT_STATUS[order.status];
    if (!next || (req.body && req.body.status) !== next) {
      return res.status(400).json({ error: "Invalid status change" });
    }
    const updated = await prisma.order.update({ where: { id: order.id }, data: { status: next } });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not update order" });
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
    console.error(err);
    res.status(500).json({ error: "Could not load order" });
  }
});
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));