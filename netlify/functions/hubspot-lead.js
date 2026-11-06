// netlify/functions/hubspot-lead.js
// Comfortium — Netlify Function → HubSpot CRM Contacts API

const HUBSPOT_API_BASE = "https://api.hubapi.com";

// === CORS — origines autorisées ===
const ALLOWED_ORIGINS = [
  "https://comfortium.ca",
  "https://www.comfortium.ca",
  "https://comfortium.netlify.app",
];

function buildCorsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "OPTIONS, POST",
  };
}

// === HELPERS ===

function jsonResponse(statusCode, body, corsHeaders) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(body),
  };
}

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function toBool(value) {
  return value === true || value === "true";
}

// Format E.164 pour numéros nord-américains
function normalizePhone(value) {
  const digits = clean(value).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return "+1" + digits.slice(1);
  if (digits.length === 10) return "+1" + digits;
  return "";
}

function removeEmptyProperties(properties) {
  const cleaned = { ...properties };
  Object.keys(cleaned).forEach((key) => {
    if (cleaned[key] === "" || cleaned[key] === undefined || cleaned[key] === null) {
      delete cleaned[key];
    }
  });
  return cleaned;
}

// Masque les PII dans les logs (loi 25 / RGPD)
function maskForLog(props) {
  const copy = { ...props };
  if (copy.email) copy.email = copy.email.replace(/(.{2}).+(@.+)/, "$1***$2");
  if (copy.phone) copy.phone = copy.phone.replace(/(\+\d{2})\d+(\d{2})/, "$1******$2");
  if (copy.address) copy.address = "[REDACTED]";
  return copy;
}

// === HUBSPOT CRM API ===

async function hubspotRequest(path, options, token) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(`${HUBSPOT_API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });

    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_) {
      data = { raw: text };
    }

    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timeout);
  }
}

// === UPSERT AVEC REPLI ===
// Si HubSpot refuse une propriété (inexistante ou valeur non reconnue), on réessaie avec les propriétés
// standard seulement et on verse le reste dans les notes : le lead n'est jamais perdu.
const STANDARD_KEYS = ["firstname", "lastname", "email", "phone", "address", "city"];
function describeExtras(properties) {
  return Object.keys(properties)
    .filter((k) => !STANDARD_KEYS.includes(k) && k !== "notes_hvac")
    .map((k) => k + " : " + properties[k])
    .join(" · ");
}
async function upsert(email, properties, createOnly, token) {
  const update = await hubspotRequest(
    `/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email`,
    { method: "PATCH", body: JSON.stringify({ properties }) },
    token
  );
  if (update.status !== 404) return { res: update, action: "updated" };
  const create = await hubspotRequest(
    "/crm/v3/objects/contacts",
    { method: "POST", body: JSON.stringify({ properties: { ...properties, ...createOnly } }) },
    token
  );
  return { res: create, action: "created" };
}
async function upsertWithFallback(email, properties, createOnly, token) {
  let r = await upsert(email, properties, createOnly, token);
  if (r.res.ok || r.res.status !== 400) return { ...r, level: "complet" };
  console.error("HubSpot 400 (propriétés complètes) :", JSON.stringify(r.res.data).slice(0, 600));
  const extras = describeExtras(properties);
  const base = {};
  STANDARD_KEYS.forEach((k) => { if (properties[k]) base[k] = properties[k]; });
  const notes = [properties.notes_hvac, extras].filter(Boolean).join(" · ");
  r = await upsert(email, { ...base, notes_hvac: notes }, {}, token);
  if (r.res.ok || r.res.status !== 400) return { ...r, level: "base+notes" };
  console.error("HubSpot 400 (base + notes_hvac) :", JSON.stringify(r.res.data).slice(0, 600));
  r = await upsert(email, { ...base, message: notes.slice(0, 60000) }, {}, token);
  if (r.res.ok || r.res.status !== 400) return { ...r, level: "base+message" };
  console.error("HubSpot 400 (base + message) :", JSON.stringify(r.res.data).slice(0, 600));
  r = await upsert(email, base, {}, token);
  return { ...r, level: "base" };
}

// === NOTIFICATION PAR COURRIEL (Resend) ===
// Envoyée à chaque lead, même si HubSpot échoue. Destinataire : LEAD_NOTIFY_EMAIL (sinon info@comfortium.ca).
async function notifyLead(properties, hubspot, telegram) {
  const key = process.env.RESEND_API_KEY, from = process.env.VERIFICATION_FROM_EMAIL;
  if (!key || !from) return;
  const to = (process.env.LEAD_NOTIFY_EMAIL || "info@comfortium.ca").split(",").map((x) => x.trim()).filter(Boolean);
  const name = [properties.firstname, properties.lastname].filter(Boolean).join(" ") || properties.email;
  const lines = [
    "Nouveau lead sur comfortium.ca",
    "",
    "Nom : " + name,
    "Courriel : " + (properties.email || "—"),
    "Téléphone : " + (properties.phone || "—"),
    "Ville : " + (properties.city || "—"),
    "Source : " + (properties.lead_source_utm || "—"),
    "Projet : " + [properties.request_type, properties.hvac_system_type, properties.property_type].filter(Boolean).join(" · "),
    "",
    "Détails : " + (properties.notes_hvac || "—"),
    "",
    "HubSpot : " + hubspot,
    "Telegram : " + (telegram || "—"),
  ];
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject: "Nouveau lead — " + name, text: lines.join("\n"), reply_to: properties.email || undefined }),
    });
    if (!r.ok) console.error("Notification Resend", r.status, (await r.text()).slice(0, 300));
  } catch (e) {
    console.error("Notification Resend", e.message);
  }
}

// === NOTIFICATION TELEGRAM (facultative) ===
// Actif seulement si TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID sont définis dans Netlify.
async function notifyTelegram(properties, hubspot) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim(), chat = (process.env.TELEGRAM_CHAT_ID || "").trim();
  if (!token || !chat) return "non configuré (" + (!token ? "TELEGRAM_BOT_TOKEN manquant" : "TELEGRAM_CHAT_ID manquant") + ")";
  const name = [properties.firstname, properties.lastname].filter(Boolean).join(" ") || properties.email || "—";
  const projet = [properties.request_type, properties.hvac_system_type, properties.property_type].filter(Boolean).join(" · ");
  const text = [
    "🔔 Nouveau lead — " + name,
    "📞 " + (properties.phone || "—"),
    "✉️ " + (properties.email || "—"),
    "📍 " + (properties.city || "—"),
    projet ? "🏠 " + projet : "",
    "Source : " + (properties.lead_source_utm || "—"),
    "HubSpot : " + hubspot,
  ].filter(Boolean).join("\n");
  try {
    const r = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    });
    if (r.ok) return "envoyé";
    const body = (await r.text()).slice(0, 200);
    console.error("Telegram", r.status, body);
    let desc = body; try { desc = JSON.parse(body).description || body; } catch (e) {}
    return "erreur " + r.status + " — " + desc;
  } catch (e) {
    console.error("Telegram", e.message);
    return "erreur — " + e.message;
  }
}

// === NETLIFY FUNCTION HANDLER ===

exports.handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || "";
  const corsHeaders = buildCorsHeaders(origin);

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method Not Allowed" }, corsHeaders);
  }

  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    return jsonResponse(500, { error: "Server configuration error: missing token" }, corsHeaders);
  }

  let data;
  try {
    data = JSON.parse(event.body || "{}");
  } catch (_) {
    return jsonResponse(400, { error: "Invalid JSON body" }, corsHeaders);
  }

  const email = clean(data.email).toLowerCase();
  if (!email || !email.includes("@")) {
    return jsonResponse(400, { error: "Valid email is required" }, corsHeaders);
  }

  // Honeypot anti-spam : si rempli, on simule un succès silencieux
  if (clean(data.website)) {
    console.log("Honeypot triggered, ignoring submission");
    return jsonResponse(200, { success: true, action: "ignored" }, corsHeaders);
  }

  // Propriétés à setter UNIQUEMENT à la création
  const createOnlyProperties = removeEmptyProperties({
    hs_lead_status: clean(data.hs_lead_status) || "NEW",
  });

  // Propriétés à setter à chaque soumission (création OU mise à jour)
  const properties = removeEmptyProperties({
    firstname: clean(data.firstname),
    lastname: clean(data.lastname),
    email,
    phone: normalizePhone(data.phone),
    address: clean(data.address),
    city: clean(data.city),

    lead_source_utm: clean(data.lead_source_utm),
    conversion_stage: clean(data.conversion_stage),
    contact_method_preference: clean(data.contact_method_preference),

    property_type: clean(data.property_type),
    hvac_system_type: clean(data.hvac_system_type),
    request_type: clean(data.request_type),

    // Boolean réel — propriété Checkbox HubSpot
    subsidy_eligible:
      data.subsidy_eligible !== undefined && data.subsidy_eligible !== ""
        ? toBool(data.subsidy_eligible)
        : undefined,

    budget_range_hvac: clean(data.budget_range_hvac),

    // HubSpot internal name : temperature_lead (frontend envoie data.lead_temperature)
    temperature_lead: clean(data.lead_temperature),

    notes_hvac: clean(data.notes_hvac),
  });

  console.log("CRM PAYLOAD:", JSON.stringify(maskForLog(properties), null, 2));

  try {
    const r = await upsertWithFallback(email, properties, createOnlyProperties, token);
    const ok = r.res.ok && r.res.data && r.res.data.id;
    console.log("CRM RESPONSE (" + r.action + ", " + r.level + "):", r.res.status, ok ? r.res.data.id : JSON.stringify(r.res.data).slice(0, 600));
    const hsStatus = ok ? (r.action === "created" ? "contact créé" : "contact mis à jour") + (r.level !== "complet" ? " (champs de base seulement : " + r.level + ")" : "") : "ÉCHEC " + r.res.status + " — lead à saisir à la main";
    const tg = await notifyTelegram(properties, hsStatus);
    await notifyLead(properties, hsStatus, tg);
    if (!ok) {
      return jsonResponse(r.res.ok ? 502 : r.res.status, { error: "HubSpot " + r.action + " failed", details: r.res.data }, corsHeaders);
    }
    return jsonResponse(200, { success: true, action: r.action, level: r.level, contactId: r.res.data.id }, corsHeaders);
  } catch (err) {
    console.error("Unexpected CRM error:", err);
    const tg = await notifyTelegram(properties, "ÉCHEC (" + err.message + ")");
    await notifyLead(properties, "ÉCHEC (" + err.message + ") — lead à saisir à la main", tg);
    return jsonResponse(500, {
      error: "Internal server error",
      details: err.message,
    }, corsHeaders);
  }
};
