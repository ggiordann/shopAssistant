window.inventoryAgent = {
    name: "inventoryAgent",
    publicDescription: "Handles queries about store products.",
    
    // the prompt realtime will read

    instructions: `
      You are an agent who answers user questions about store products from a CSV. 
      Then call the "lookupInventory" tool with priceRange, shortDescription, category. 
      Do not call the tool unless the USER explicitly asks to look for a product.
      After the tool returns results, read the 'recommendations' array from /api/recommend 
      to finalize your answer, giving a few options for them and their descriptions. 
      If none match, politely say so.
      Start the conversation with 'Hello, what are you looking for today?'
    `,
    
    // tool calls /api/recommend

    tools: [
      {
        type: "function",
        name: "lookupInventory",
        description: `Look up from CSV by calling /api/recommend. 
          Provide productName, subCategory, priceRange, brand, etc. if known.
          Expects a response with 'recommendations'. 
          Each recommendation has 'product', 'short description', 'price', 'brand', etc.
          Unknown parameters can have value 'any'.
          Do not set values for any categories which are not explicitly mentioned (e.g. input: 'Adidas Hoodie' will have product name 'any').
          Ensure subCategory is a valid, real category, as specified in subCategory description.
          If user is looking for a broad type of product (e.g. input: 'I am looking to get a fitness watch'), request priceRange 
          and then look up from CSV, ensuring only subCategory and priceRange are set, with all other parameters as 'any'.
          `
          , //, and shortDescription should always be 'any' as well.
        parameters: {
          type: "object",
          properties: {
            productName: {
                type: 'string',
                description: 'Name of product'
            },
            subCategory: {
              type: 'string',
              description: '“Running”, “Training”, “Walking”, “Sneakers”, “Shorts”, “Leggings”, “Tops”, “Jackets”, “Hoodies”, “Track Pants”, “Socks”, “Bags”, “Hats”, “Sunglasses”, “Fitness”, “Electronics”, “Balls”, “Rackets”, “Cricket”, “Basketball”, “Rugby”, “Goggles”, “Swimwear”, “Weights”, “Cardio”, “Benches”'
            },
            priceRange: {
              type: "object",
              properties: {
                min: { type: "number", description: "Minimum price" },
                max: { type: "number", description: "Maximum price" }
              },
              required: ["min","max"],
              additionalProperties: false
            }, /*
            shortDescription: {
              type: 'string',
              description: "e.g. 'cotton', 'comfort', 'quick dry'"
            }, */
            brand: {
              type: 'string',
              description: "e.g. 'Nike', 'Adidas', 'Asics', 'Reebok'"
            }
          },
          required: ["productName", "subCategory","priceRange", "brand"]
        }
      }
    ],
    
    // tool logic client code uses
    toolLogic: {
      async lookupInventory(args) {
        console.log("[inventoryAgent] lookupInventory => ", args);
  
        const resp = await fetch("/api/recommend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(args)
        });
        return await resp.json(); 
      }
    },
  
    downstreamAgents: []
  };