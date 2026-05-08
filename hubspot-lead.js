// netlify/functions/hubspot-lead.js
// Architecture: Frontend → /.netlify/functions/hubspot-lead → HubSpot CRM Contacts API

const HUBSPOT_API_BASE = "https://api.hubapi.com";

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    console.error("HUBSPOT_PRIVATE_APP_TOKEN is not set");
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server configuration error: missing token" }),
    };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch (err) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid JSON body" }),
    };
  }

  // Build CRM properties payload
  const properties = {
    firstname:                   data.firstname                   || "",
    lastname:                    data.lastname                    || "",
    email:                       data.email                       || "",
    phone:                       data.phone                       || "",
    address:                     data.address                     || "",
    city:                        data.city                        || "",
    hs_lead_status:              data.hs_lead_status              || "NEW",
    lead_source_utm:             data.lead_source_utm             || "",
    conversion_stage:            data.conversion_stage            || "",
    contact_method_preference:   data.contact_method_preference   || "",
    property_type:               data.property_type               || "",
    hvac_system_type:            data.hvac_system_type            || "",
    urgency_level:               data.urgency_level               || "",
    request_type:                data.request_type                || "",
    subsidy_eligible:            data.subsidy_eligible            || "",
    budget_range_hvac:           data.budget_range_hvac           || "",
    lead_temperature:            data.lead_temperature            || "",
    notes_hvac:                  data.notes_hvac                  || "",
  };

  // Remove empty string values to keep the CRM clean
  Object.keys(properties).forEach((key) => {
    if (properties[key] === "") delete properties[key];
  });

  console.log("CRM PAYLOAD:", JSON.stringify(properties, null, 2));

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  try {
    // ── STEP 1: Search for existing contact by email ──────────────────────────
    const searchRes = await fetch(
      `${HUBSPOT_API_BASE}/crm/v3/objects/contacts/search`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          filterGroups: [
            {
              filters: [
                {
                  propertyName: "email",
                  operator: "EQ",
                  value: properties.email,
                },
              ],
            },
          ],
          properties: ["email"],
          limit: 1,
        }),
      }
    );

    const searchData = await searchRes.json();
    console.log("CRM SEARCH RESPONSE:", JSON.stringify(searchData, null, 2));

    let crmResponse;
    let action;

    if (searchData.total > 0) {
      // ── STEP 2a: Contact exists → PATCH (update) ────────────────────────────
      const contactId = searchData.results[0].id;
      action = "updated";

      const patchRes = await fetch(
        `${HUBSPOT_API_BASE}/crm/v3/objects/contacts/${contactId}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ properties }),
        }
      );

      crmResponse = await patchRes.json();
      console.log("CRM RESPONSE (PATCH):", JSON.stringify(crmResponse, null, 2));

      if (!patchRes.ok) {
        return {
          statusCode: patchRes.status,
          body: JSON.stringify({
            error: "HubSpot PATCH failed",
            details: crmResponse,
          }),
        };
      }
    } else {
      // ── STEP 2b: Contact does not exist → POST (create) ─────────────────────
      action = "created";

      const createRes = await fetch(
        `${HUBSPOT_API_BASE}/crm/v3/objects/contacts`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ properties }),
        }
      );

      crmResponse = await createRes.json();
      console.log("CRM RESPONSE (POST):", JSON.stringify(crmResponse, null, 2));

      if (!createRes.ok) {
        return {
          statusCode: createRes.status,
          body: JSON.stringify({
            error: "HubSpot POST failed",
            details: crmResponse,
          }),
        };
      }
    }

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        success: true,
        action,
        contactId: crmResponse.id,
      }),
    };
  } catch (err) {
    console.error("Unexpected error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error", details: err.message }),
    };
  }
};
