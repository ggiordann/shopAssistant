require("dotenv").config();
const express = require("express");
const path = require("path");
const cors = require("cors");
const fetch = require("node-fetch"); // if needed, Node < 18
const csv = require("csv-parser");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json());

// in-memory inventory store
let inventoryData = [];

// csv parser to load inventory data
function loadInventoryCSV() {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(path.join(__dirname, "inventory.csv"))
      .pipe(csv())
      .on("data", (row) => {
        results.push(row);
      })
      .on("end", () => {
        inventoryData = results;
        console.log("Inventory loaded:", inventoryData);
        resolve();
      })
      .on("error", (err) => {
        reject(err);
      });
  });
}

// endpoint to serve ephemeral keys
app.get("/api/session", async (req, res) => {
  console.log("[server] GET /api/session");
  try {
    // 1) Request ephemeral key from Realtime API
    const openAiResp = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview-2024-12-17"
      }),
    });
    const data = await openAiResp.json();

    // server side monitoring
    console.log("[server] ephemeral key response:", data);

    return res.json(data);
  } catch (error) {
    console.error("Error fetching ephemeral key:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// endpoint to recommend products based on filters
app.post("/api/recommend", (req, res) => {
  console.log("[server] POST /api/recommend body:", req.body);

  // destructure filters from request body // COULD INCORPORATE SKU and gender!!
  const {
    productName,
    subCategory,
    brand,
    priceRange,
    shortDescription = "any"  // <--- SHORT DESCRIPTION HERE to avoid undefined
  } = req.body;

  // THIS ISN'T EVEN WORKING?!?!?!

  // IMPORTANT!! THIS IS FOR FILTERING THE PRODUCTS

  const filtered = inventoryData.filter((item) => {
    // convert price to number for comparison
    const priceNumber = Number((item["Price (AUD)"] || "0").replace(/[^0-9.-]+/g, ""));
    // for each filter, check if it matches the item
    
    if (productName != 'any') {
      const pName = (item["Product Name"] || "").toLowerCase();
      if (!pName.includes(productName.toLowerCase())) return false;
    }
    if (brand != 'any') {
      const b = (item["Brand"] || "").toLowerCase();
      if (!b.includes(brand.toLowerCase())) return false;
    }
    if (shortDescription != 'any') {
      const sd = (item["Short Description"] || "").toLowerCase();
      if (!sd.includes(shortDescription.toLowerCase())) return false;
    }
    if (priceRange && typeof priceRange.min === "number" && typeof priceRange.max === "number") {
      if (priceNumber < priceRange.min || priceNumber > priceRange.max) return false;
    }

    // if all filters pass, we keep the item
    
    return true;
  });
  console.log(filtered);

  if (filtered.length === 0) {
    return res.json({
      success: true,
      recommendations: [],
      message: "No matching products found.",
    });
  }

  // return ALL relevant details for each matched item
  return res.json({
    success: true,
    recommendations: filtered.map((item) => ({
      Category: item["Category"],
      Subcategory: item["Subcategory"],
      Gender: item["Gender"],
      "Product Name": item["Product Name"], // orig if error -> "Product Name" // Product_Name
      Brand: item["Brand"],
      "Price (AUD)": item["Price (AUD)"], // "Price (AUD)" // Price_AUD
      "Short Description": item["Short Description"], // orig if error -> "Short Description" // Short_Description
      SKU: item["SKU"],
    })),
  });
});

// serve static files
app.use(express.static(path.join(__dirname, "public")));

async function startServer() {
  try {
    await loadInventoryCSV(); // load CSV
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`[server] Server listening on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to load inventory:", error);
    process.exit(1);
  }
}

startServer();