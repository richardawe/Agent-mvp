// --- Config ---
const API_URL = "https://api.3d7tech.com/v1/chat/completions";
const API_KEY = ""; // Optional
const REQUEST_TIMEOUT = 30000; // 30 seconds
const MAX_RETRIES = 3;

// --- APIs ---
const WEATHER_API = "https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.12&current_weather=true&daily=sunrise,sunset";
const AQI_API = "https://api.waqi.info/feed/london/?token=demo";

// --- UI ---
function notify(text) {
  const div = document.createElement("div");
  div.className = "notification";
  div.innerText = text;
  const container = document.getElementById("notifications");
  if (container) {
    container.appendChild(div);
  }
}

// --- Timeout wrapper ---
function fetchWithTimeout(url, options = {}, timeout = REQUEST_TIMEOUT) {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timeout')), timeout)
    )
  ]);
}

// --- Fetch weather ---
async function fetchWeather() {
  try {
    const res = await fetchWithTimeout(WEATHER_API);
    if (!res.ok) throw new Error(`Weather API error: ${res.status}`);
    const data = await res.json();
    const w = data.current_weather;
    return {
      temperature: w.temperature || 0,
      precipitation: w.precipitation || 0,
      windspeed: w.windspeed || 0,
      sunrise: data.daily?.sunrise?.[0] || "N/A",
      sunset: data.daily?.sunset?.[0] || "N/A"
    };
  } catch (error) {
    notify(`Weather fetch failed: ${error.message}`);
    return {
      temperature: 15,
      precipitation: 0,
      windspeed: 5,
      sunrise: "06:00",
      sunset: "18:00"
    };
  }
}

// --- Fetch AQI ---
async function fetchAQI() {
  try {
    const res = await fetchWithTimeout(AQI_API);
    if (!res.ok) throw new Error(`AQI API error: ${res.status}`);
    const data = await res.json();
    return data.data?.aqi || null;
  } catch (error) {
    notify(`AQI fetch failed: ${error.message}`);
    return null;
  }
}

// --- Call local LLM with retry ---
async function callLLM(prompt, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(API_KEY && { "Authorization": `Bearer ${API_KEY}` })
        },
        body: JSON.stringify({
          model: "local-model",
          messages: [
            { role: "system", content: "You are a friendly personal assistant agent. Always respond with valid JSON only." },
            { role: "user", content: prompt }
          ],
          temperature: 0.0
        })
      });

      if (!res.ok) throw new Error(`LLM API error: ${res.status}`);
      
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      
      if (!content) throw new Error("Empty response from LLM");

      // Clean up response if it has markdown code blocks
      const cleanContent = content.replace(/```json\n?|\n?```/g, '').trim();
      
      return JSON.parse(cleanContent);
    } catch (error) {
      notify(`LLM attempt ${attempt} failed: ${error.message}`);
      if (attempt === retries) {
        // Return fallback plan
        return [{
          time: "All day",
          activity: "Unable to generate plan - API unavailable",
          clothing: "Comfortable clothing",
          meal: null,
          notes: "Please try again later"
        }];
      }
      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}

// --- Prompt builder per block ---
function buildPrompt(weather, aqi, block, userInputs = {}) {
  return `Plan the user's activities for ${block.start}–${block.end} based on:
Weather: Temperature ${weather.temperature}°C, Precipitation ${weather.precipitation}mm, Wind ${weather.windspeed}km/h
AQI: ${aqi || "Unknown"}
User preferences: ${JSON.stringify(userInputs)}

Rules:
- Suggest clothing, meals, and activities appropriate for this time block
- Avoid outdoor activities if AQI > 100 or precipitation > 5mm
- Return ONLY a valid JSON array with these exact fields: time, activity, clothing, meal, notes
- Each entry should cover a specific time within the block
- No markdown, no extra text, just the JSON array

Example format:
[{"time":"6:00","activity":"Morning routine","clothing":"Comfortable clothes","meal":"Breakfast","notes":"Start the day"}]`;
}

// --- Main agent loop ---
async function runAgent() {
  const notificationContainer = document.getElementById("notifications");
  const runButton = document.getElementById("runAgent");
  
  if (!notificationContainer || !runButton) {
    console.error("Required DOM elements not found");
    return;
  }

  // Disable button during execution
  runButton.disabled = true;
  notificationContainer.innerHTML = "";
  
  try {
    notify("Starting daily planner agent...");
    
    // Fetch data in parallel
    notify("Fetching weather and AQI data...");
    const [weather, aqi] = await Promise.all([
      fetchWeather(),
      fetchAQI()
    ]);

    notify(`Weather: ${weather.temperature}°C, Precipitation: ${weather.precipitation}mm, Wind: ${weather.windspeed}km/h`);
    notify(`Sunrise: ${weather.sunrise}, Sunset: ${weather.sunset}`);
    notify(aqi ? `AQI: ${aqi}` : "AQI not available");

    const blocks = [
      { start: "6:00", end: "9:00" },
      { start: "9:00", end: "12:00" },
      { start: "12:00", end: "15:00" },
      { start: "15:00", end: "18:00" },
      { start: "18:00", end: "21:00" },
      { start: "21:00", end: "22:00" }
    ];

    let dayPlan = [];
    let userInputs = {};

    for (const block of blocks) {
      notify(`Planning ${block.start}–${block.end}...`);
      const prompt = buildPrompt(weather, aqi, block, userInputs);
      const blockPlan = await callLLM(prompt);

      // Ensure blockPlan is an array
      if (Array.isArray(blockPlan)) {
        dayPlan.push(...blockPlan);
      } else if (blockPlan) {
        dayPlan.push(blockPlan);
      }
    }

    notify("✓ Full day plan ready:");
    notify("─────────────────────");
    dayPlan.forEach(b => {
      notify(`⏰ ${b.time}\n📌 ${b.activity}\n👔 ${b.clothing}\n🍽️ ${b.meal || "N/A"}\n📝 ${b.notes || "None"}\n`);
    });
    notify("─────────────────────");
    notify("✓ Planning complete!");

  } catch (error) {
    notify(`❌ Fatal error: ${error.message}`);
    console.error("Agent error:", error);
  } finally {
    // Re-enable button
    runButton.disabled = false;
  }
}

// --- Bind UI ---
document.addEventListener('DOMContentLoaded', () => {
  const runButton = document.getElementById("runAgent");
  if (runButton) {
    runButton.addEventListener("click", runAgent);
  } else {
    console.error("Run button not found");
  }
});
