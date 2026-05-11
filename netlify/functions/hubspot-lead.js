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
    // === UPSERT par email ===
    // PATCH /contacts/{email}?idProperty=email
    // - 200 si contact existe → update
    // - 404 si contact n'existe pas → on bascule sur POST create
    const updateResponse = await hubspotRequest(
      `/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email`,
      { method: "PATCH", body: JSON.stringify({ properties }) },
      token
    );

    if (updateResponse.status === 404) {
      const createResponse = await hubspotRequest(
        "/crm/v3/objects/contacts",
        {
          method: "POST",
          body: JSON.stringify({
            properties: { ...properties, ...createOnlyProperties },
          }),
        },
        token
      );

      console.log("CRM RESPONSE (created):", JSON.stringify(createResponse.data, null, 2));

      if (!createResponse.ok) {
        return jsonResponse(createResponse.status, {
          error: "HubSpot create failed",
          details: createResponse.data,
        }, corsHeaders);
      }

      if (!createResponse.data?.id) {
        return jsonResponse(502, {
          error: "HubSpot create returned no contact ID",
        }, corsHeaders);
      }

      return jsonResponse(200, {
        success: true,
        action: "created",
        contactId: createResponse.data.id,
      }, corsHeaders);
    }

    console.log("CRM RESPONSE (updated):", JSON.stringify(updateResponse.data, null, 2));

    if (!updateResponse.ok) {
      return jsonResponse(updateResponse.status, {
        error: "HubSpot update failed",
        details: updateResponse.data,
      }, corsHeaders);
    }

    if (!updateResponse.data?.id) {
      return jsonResponse(502, {
        error: "HubSpot update returned no contact ID",
      }, corsHeaders);
    }

    return jsonResponse(200, {
      success: true,
      action: "updated",
      contactId: updateResponse.data.id,
    }, corsHeaders);

  } catch (err) {
    console.error("Unexpected CRM error:", err);
    return jsonResponse(500, {
      error: "Internal server error",
      details: err.message,
    }, corsHeaders);
  }
};
