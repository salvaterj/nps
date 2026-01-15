require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;
const HELENA_API_URL = "https://api.helena.run/core/v1/contact/filter";
const HELENA_API_TOKEN = process.env.HELENA_API_TOKEN;

if (!HELENA_API_TOKEN) {
  console.warn("Variável de ambiente HELENA_API_TOKEN não definida");
}

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

function isWithinRange(isoString, startDate, endDate) {
  if (!startDate && !endDate) return true;
  const timestamp = Date.parse(isoString);
  if (Number.isNaN(timestamp)) return false;

  if (startDate) {
    const startTs = Date.parse(`${startDate}T00:00:00Z`);
    if (timestamp < startTs) return false;
  }

  if (endDate) {
    const endTs = Date.parse(`${endDate}T23:59:59.999Z`);
    if (timestamp > endTs) return false;
  }

  return true;
}

async function fetchContactsByNps(npsValue, startDate, endDate) {
  if (!HELENA_API_TOKEN) {
    throw new Error("HELENA_API_TOKEN não configurado");
  }

  const allItems = [];
  let pageNumber = 1;
  const pageSize = 100;
  let hasMorePages = true;

  while (hasMorePages) {
    const body = {
      includeDetails: ["CustomFields"],
      customFields: {
        nps: String(npsValue)
      },
      pageNumber,
      pageSize
    };

    try {
      console.log(
        "[Helena] Requisição",
        JSON.stringify({
          npsValue,
          pageNumber,
          pageSize,
          startDate,
          endDate
        })
      );

      const response = await axios.post(HELENA_API_URL, body, {
        headers: {
          Authorization: HELENA_API_TOKEN,
          Accept: "application/json",
          "Content-Type": "application/*+json"
        }
      });

      const data = response.data || {};

      console.log(
        "[Helena] Resposta",
        JSON.stringify({
          npsValue,
          pageNumber,
          itemsCount: Array.isArray(data.items) ? data.items.length : 0,
          totalItems: data.totalItems,
          totalPages: data.totalPages,
          hasMorePages: data.hasMorePages
        })
      );

      if (Array.isArray(data.items)) {
        data.items.forEach((item) => {
          const updatedAt = item.updatedAt || item.updatedat;
          if (updatedAt && isWithinRange(updatedAt, startDate, endDate)) {
            allItems.push(item);
          }
        });
      }

      hasMorePages = Boolean(data.hasMorePages);
      pageNumber += 1;
    } catch (error) {
      console.error(
        "[Helena] Erro na requisição",
        JSON.stringify({
          npsValue,
          pageNumber,
          message: error.message,
          status: error.response ? error.response.status : null,
          data: error.response ? error.response.data : null
        })
      );

      const status = error.response ? error.response.status : null;
      const bodyResponse = error.response ? error.response.data : null;
      throw new Error(
        `Erro ao consultar NPS ${npsValue} página ${pageNumber}: status=${status} resposta=${JSON.stringify(
          bodyResponse
        )}`
      );
    }
  }

  return allItems;
}

async function fetchAllContacts(startDate, endDate) {
  const allContacts = [];

  for (let nps = 1; nps <= 5; nps += 1) {
    const contacts = await fetchContactsByNps(nps, startDate, endDate);

    console.log(
      "[Helena] Total de contatos por NPS",
      JSON.stringify({
        nps,
        count: contacts.length,
        startDate,
        endDate
      })
    );

    contacts.forEach((contact) => {
      let value = null;

      if (
        contact.customFields &&
        Object.prototype.hasOwnProperty.call(contact.customFields, "nps")
      ) {
        const raw = contact.customFields.nps;
        if (typeof raw === "number") {
          value = raw;
        } else {
          const parsed = parseFloat(raw);
          if (Number.isFinite(parsed)) {
            value = parsed;
          }
        }
      }

      const npsValue = value || nps;

      allContacts.push({
        ...contact,
        npsValue
      });
    });
  }

  return allContacts;
}

app.get("/api/dashboard", async (req, res) => {
  const startDate = req.query.startDate || null;
  const endDate = req.query.endDate || null;
  const page = parseInt(req.query.page || "1", 10) || 1;
  const pageSize = 20;

  try {
    console.log(
      "[Dashboard] Início da geração",
      JSON.stringify({
        startDate,
        endDate,
        page
      })
    );

    const contacts = await fetchAllContacts(startDate, endDate);

    const totalContacts = contacts.length;

    let averageNps = null;
    if (totalContacts > 0) {
      const sum = contacts.reduce(
        (acc, contact) => acc + (contact.npsValue || 0),
        0
      );
      averageNps = sum / totalContacts;
    }

    const npsCounts = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0
    };

    contacts.forEach((contact) => {
      const value = contact.npsValue;
      if (value && value >= 1 && value <= 5) {
        npsCounts[value] += 1;
      }
    });

    const npsSummary = Object.keys(npsCounts).map((score) => ({
      score: Number(score),
      count: npsCounts[score]
    }));

    const lowNpsContacts = contacts.filter((contact) => contact.npsValue <= 3);

    const lowNpsItems = lowNpsContacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      phoneNumber: contact.phoneNumber,
      phoneNumberFormatted: contact.phoneNumberFormatted,
      email: contact.email,
      updatedAt: contact.updatedAt,
      nps: contact.npsValue
    }));

    const totalLowNps = lowNpsItems.length;
    const totalPages = totalLowNps === 0 ? 1 : Math.ceil(totalLowNps / pageSize);
    const currentPage = Math.min(Math.max(page, 1), totalPages);
    const startIndex = (currentPage - 1) * pageSize;
    const paginatedItems = lowNpsItems.slice(
      startIndex,
      startIndex + pageSize
    );

    console.log(
      "[Dashboard] Resultado",
      JSON.stringify({
        startDate,
        endDate,
        totalContacts,
        averageNps,
        totalLowNps,
        page: currentPage,
        pageSize,
        pageItems: paginatedItems.length,
        npsSummary
      })
    );

    res.json({
      averageNps,
      totalContacts,
      startDate,
      endDate,
      npsSummary,
      lowNps: {
        page: currentPage,
        pageSize,
        totalItems: totalLowNps,
        totalPages,
        items: paginatedItems
      },
      lowNpsAllItems: lowNpsItems
    });
  } catch (error) {
    console.error(
      "[Dashboard] Erro",
      JSON.stringify({
        startDate,
        endDate,
        page,
        message: error.message
      })
    );

    res.status(500).json({
      error: true,
      message: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor iniciado na porta ${PORT}`);
});
