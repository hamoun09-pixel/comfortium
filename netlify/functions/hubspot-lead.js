// netlify/functions/hubspot-lead.js
// Comfortium — Netlify Function → HubSpot CRM Contacts API
// Stores leads directly in HubSpot contact properties using a private app token.

const HUBSPOT_API_BASE = "https://api.hubapi.com";

const RESPONSE_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "OPTIONS, POST",
};

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: RESPONSE_HEADERS,
    body: JSON.stringify(body),
  };
}

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function normalizePhone(value) {
  const digits = clean(value).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits.slice(-10);
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

async function hubspotRequest(path, options, token) {
  const response = await fetch(`${HUBSPOT_API_BASE}${path}`, {
    ...options,
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
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: RESPONSE_HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method Not Allowed" });
  }

  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    console.error("HUBSPOT_PRIVATE_APP_TOKEN is not set");
    return jsonResponse(500, { error: "Server configuration error: missing token" });
  }

  let data;
  try {
    data = JSON.parse(event.body || "{}");
  } catch (_) {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const email = clean(data.email).toLowerCase();
  if (!email || !email.includes("@")) {
    return jsonResponse(400, { error: "Valid email is required" });
  }

  // IMPORTANT: property names must match HubSpot internal names exactly.
  const properties = removeEmptyProperties({
    firstname: clean(data.firstname),
    lastname: clean(data.lastname),
    email,
    phone: normalizePhone(data.phone),
    address: clean(data.address),
    city: clean(data.city),
    hs_lead_status: clean(data.hs_lead_status) || "NEW",
    lead_source_utm: clean(data.lead_source_utm),
    conversion_stage: clean(data.conversion_stage),
    contact_method_preference: clean(data.contact_method_preference),
    property_type: clean(data.property_type),
    hvac_system_type: clean(data.hvac_system_type),
    urgency_level: clean(data.urgency_level),
    request_type: clean(data.request_type),
    subsidy_eligible: clean(data.subsidy_eligible),
    budget_range_hvac: clean(data.budget_range_hvac),
    lead_temperature: clean(data.lead_temperature),
    notes_hvac: clean(data.notes_hvac),
  });

  console.log("CRM PAYLOAD:", JSON.stringify(properties, null, 2));

  try {
    const searchPayload = {
      filterGroups: [
        {
          filters: [
            {
              propertyName: "email",
              operator: "EQ",
              value: email,
            },
          ],
        },
      ],
      properties: ["email"],
      limit: 1,
    };

    const search = await hubspotRequest(
      "/crm/v3/objects/contacts/search",
      { method: "POST", body: JSON.stringify(searchPayload) },
      token
    );

    console.log("CRM SEARCH RESPONSE:", JSON.stringify(search.data, null, 2));

    if (!search.ok) {
      return jsonResponse(search.status, {
        error: "HubSpot search failed",
        details: search.data,
      });
    }

    let crmResponse;
    let action;

    if ((search.data.total || 0) > 0 && search.data.results?.[0]?.id) {
      const contactId = search.data.results[0].id;
      action = "updated";

      crmResponse = await hubspotRequest(
        `/crm/v3/objects/contacts/${contactId}`,
        { method: "PATCH", body: JSON.stringify({ properties }) },
        token
      );
    } else {
      action = "created";

      crmResponse = await hubspotRequest(
        "/crm/v3/objects/contacts",
        { method: "POST", body: JSON.stringify({ properties }) },
        token
      );
    }

    console.log(`CRM RESPONSE (${action}):`, JSON.stringify(crmResponse.data, null, 2));

    if (!crmResponse.ok) {
      return jsonResponse(crmResponse.status, {
        error: `HubSpot ${action} failed`,
        details: crmResponse.data,
      });
    }

    return jsonResponse(200, {
      success: true,
      action,
      contactId: crmResponse.data.id,
    });
  } catch (err) {
    console.error("Unexpected CRM error:", err);
    return jsonResponse(500, {
      error: "Internal server error",
      details: err.message,
    });
  }
};

