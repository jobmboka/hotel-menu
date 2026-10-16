const BASE =
  process.env.MPESA_ENV === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
function nairobiTimestamp() {
  const d = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) +
    p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds())
  );
}
function normalizePhone(input) {
  const digits = String(input || "").replace(/\D/g, "");
  if (/^0[17]\d{8}$/.test(digits)) return "254" + digits.slice(1);
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  return null;
}
async function getToken() {
  const auth = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
  ).toString("base64");
  const res = await fetch(`${BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) throw new Error(`Token request failed (${res.status})`);
  return (await res.json()).access_token;
}
async function stkPush({ phone, amount, orderId }) {
  const token = await getToken();
  const timestamp = nairobiTimestamp();
  const shortcode = process.env.MPESA_SHORTCODE;
  const password = Buffer.from(shortcode + process.env.MPESA_PASSKEY + timestamp).toString("base64");
  const callbackUrl = `${process.env.MPESA_CALLBACK_BASE}/api/payments/callback/${process.env.MPESA_CALLBACK_SECRET}`;
  const res = await fetch(`${BASE}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: `ORDER${orderId}`,
      TransactionDesc: "Food order",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ResponseCode !== "0") {
    throw new Error(data.errorMessage || data.ResponseDescription || `STK push failed (${res.status})`);
  }
  return data;
}
module.exports = { stkPush, normalizePhone };