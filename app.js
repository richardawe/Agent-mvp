// --- Config ---
const API_URL = "https://api.3d7tech.com/v1/chat/completions";
const API_KEY = ""; // Optional
const REQUEST_TIMEOUT = 45000; // 45 seconds for better quality responses
const MAX_RETRIES = 3;

// --- APIs ---
const WEATHER_API = "https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.12&current_weather=true&hourly=temperature_2m,precipitation_probability,windspeed_10m&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min";
const AQI_API = "https://api.waqi.info/feed/london/?token=demo";

// --- UI ---
function notify(text, isHtml = false) {
  const div = document.createElement("div");
  div.className = "notification";
  if (isHtml) {
    div.innerHTML = text;
  } else {
    div.innerText = text;
  }
  const container = document.getElementById("notifications");
  if (container) {
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
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

// --- Enhanced weather fetch ---
async function fetchWeather() {
  try {
    const res = await fetchWithTimeout(WEATHER_API);
    if (!res.ok) throw new Error(`Weather API error: ${res.status}`);
    const data = await res.json();
    const w = data.current_weather;
    
    // Get hourly data for better planning
    const hourly = data.hourly;
    const daily = data.daily;
    
    return {
      current: {
        temperature: w.temperature || 0,
        precipitation: w.precipitation || 0,
        windspeed: w.windspeed || 0,
        weathercode: w.weathercode || 0
      },
      hourly: {
        temperature: hourly?.temperature_2m?.slice(0, 24) || [],
        precipitation: hourly?.precipitation_probability?.slice(0, 24) || [],
        windspeed: hourly?.windspeed_10m?.slice(0, 24) || []
      },
      daily: {
        sunrise: daily?.sunrise?.[0] || "06:00",
        sunset: daily?.sunset?.[0] || "18:00",
        temp_max: daily?.temperature_2m_max?.[0] || 20,
        temp_min: daily?.temperature_2m_min?.[0] || 10
      },
      description: getWeatherDescription(w.weathercode || 0)
    };
  } catch (error) {
    notify(`Weather fetch failed: ${error.message}`);
    return {
      current: { temperature: 15, precipitation: 0, windspeed: 5, weathercode: 0 },
      hourly: { temperature: [], precipitation: [], windspeed: [] },
      daily: { sunrise: "06:00", sunset: "18:00", temp_max: 20, temp_min: 10 },
      description: "Clear"
    };
  }
}

// --- Weather code to description ---
function getWeatherDescription(code) {
  const codes = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Foggy", 48: "Foggy", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain", 71: "Light snow", 
    73: "Snow", 75: "Heavy snow", 95: "Thunderstorm"
  };
  return codes[code] || "Unknown";
}

// --- Fetch AQI ---
async function fetchAQI() {
  try {
    const res = await fetchWithTimeout(AQI_API);
    if (!res.ok) throw new Error(`AQI API error: ${res.status}`);
    const data = await res.json();
    const aqi = data.data?.aqi || null;
    return {
      value: aqi,
      quality: getAQIQuality(aqi)
    };
  } catch (error) {
    notify(`AQI fetch failed: ${error.message}`);
    return { value: null, quality: "Unknown" };
  }
}

// --- AQI quality description ---
function getAQIQuality(aqi) {
  if (!aqi) return "Unknown";
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy for sensitive groups";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very unhealthy";
  return "Hazardous";
}

// --- Enhanced LLM call ---
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
            { 
              role: "system", 
              content: "You are an expert daily planning assistant. Provide detailed, practical, and personalized recommendations. Always respond with valid JSON only, no markdown or extra text." 
            },
            { role: "user", content: prompt }
          ],
          temperature: 0.7, // Increased for more creative/detailed responses
          max_tokens: 2000 // Ensure enough tokens for detailed responses
        })
      });

      if (!res.ok) throw new Error(`LLM API error: ${res.status}`);
      
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      
      if (!content) throw new Error("Empty response from LLM");

      // Clean up response
      const cleanContent = content.replace(/```json\n?|\n?```|```\n?/g, '').trim();
      
      return JSON.parse(cleanContent);
    } catch (error) {
      notify(`LLM attempt ${attempt}/${retries} failed: ${error.message}`);
      if (attempt === retries) {
        return [{
          time: "All day",
          activity: "Plan generation unavailable",
          clothing: "Dress appropriately for weather",
          meal: "Regular meals",
          notes: "LLM service unavailable. Please check API configuration.",
          details: "Unable to generate detailed recommendations."
        }];
      }
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
}

// --- Enhanced prompt builder ---
function buildPrompt(weather, aqi, block, previousActivities = [], userContext = {}) {
  const hour = parseInt(block.start.split(':')[0]);
  const isEarlyMorning = hour >= 5 && hour < 9;
  const isMorning = hour >= 9 && hour < 12;
  const isAfternoon = hour >= 12 && hour < 17;
  const isEvening = hour >= 17 && hour < 21;
  const isNight = hour >= 21 || hour < 5;

  const outdoorSafe = (aqi.value === null || aqi.value < 100) && 
                      weather.current.precipitation < 5 && 
                      weather.current.windspeed < 40;

  return `You are planning activities for ${block.start}–${block.end} on a ${new Date().toLocaleDateString('en-US', { weekday: 'long' })}.

CONTEXT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Weather Conditions:
• Current: ${weather.current.temperature}°C, ${weather.description}
• Day Range: ${weather.daily.temp_min}°C to ${weather.daily.temp_max}°C
• Precipitation: ${weather.current.precipitation}mm
• Wind: ${weather.current.windspeed} km/h
• Sunrise: ${weather.daily.sunrise} | Sunset: ${weather.daily.sunset}

Air Quality:
• AQI: ${aqi.value || "Unknown"} (${aqi.quality})
• Outdoor Safety: ${outdoorSafe ? "✓ Safe" : "⚠ Use caution"}

Time Period: ${isEarlyMorning ? "Early Morning" : isMorning ? "Morning" : isAfternoon ? "Afternoon" : isEvening ? "Evening" : "Night"}

Previous Activities Today:
${previousActivities.length > 0 ? previousActivities.map(a => `• ${a.time}: ${a.activity}`).join('\n') : "• None yet (start of day)"}

REQUIREMENTS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generate 2-3 activities for this time block with:

1. SPECIFIC activities with clear purpose and benefits
2. DETAILED clothing recommendations (fabrics, layers, accessories)
3. NUTRITIOUS meal suggestions with reasoning
4. PRACTICAL tips and safety considerations
5. VARIETY - don't repeat similar activities from previous blocks

Guidelines:
• ${outdoorSafe ? "Outdoor activities encouraged" : "Focus on indoor activities"}
• Match energy levels to time of day
• Consider weather comfort (dress for ${weather.current.temperature}°C)
• Include wellness aspects (hydration, breaks, posture)
• Be specific about WHY each recommendation matters

RESPONSE FORMAT (JSON array only):
[
  {
    "time": "HH:MM",
    "activity": "Specific activity name with clear purpose",
    "clothing": "Detailed clothing recommendation with fabrics/layers/accessories",
    "meal": "Specific meal/snack with nutritional reasoning or null",
    "notes": "Practical implementation tips",
    "details": "Why this activity? Health benefits, timing rationale, safety considerations (2-3 sentences)"
  }
]

IMPORTANT: 
- NO markdown formatting, NO code blocks, NO extra text
- Return ONLY the JSON array
- Make it useful and actionable
- Each activity should feel personalized and well-reasoned`;
}

// --- Format output beautifully ---
function formatActivityCard(activity) {
  return `
<div style="border-left: 4px solid #4CAF50; padding: 12px; margin: 10px 0; background: rgba(255,255,255,0.05); border-radius: 4px;">
  <div style="font-size: 1.2em; font-weight: bold; color: #4CAF50;">⏰ ${activity.time}</div>
  <div style="margin: 8px 0;">
    <strong>📌 Activity:</strong> ${activity.activity}
  </div>
  <div style="margin: 8px 0;">
    <strong>👔 Clothing:</strong> ${activity.clothing}
  </div>
  ${activity.meal ? `<div style="margin: 8px 0;"><strong>🍽️ Meal:</strong> ${activity.meal}</div>` : ''}
  <div style="margin: 8px 0;">
    <strong>📝 Tips:</strong> ${activity.notes}
  </div>
  ${activity.details ? `<div style="margin: 8px 0; padding: 8px; background: rgba(0,0,0,0.2); border-radius: 4px; font-style: italic;"><strong>💡 Why:</strong> ${activity.details}</div>` : ''}
</div>`;
}

// --- Main agent loop ---
async function runAgent() {
  const notificationContainer = document.getElementById("notifications");
  const runButton = document.getElementById("runAgent");
  
  if (!notificationContainer || !runButton) {
    console.error("Required DOM elements not found");
    return;
  }

  runButton.disabled = true;
  notificationContainer.innerHTML = "";
  
  try {
    notify("🚀 Starting enhanced daily planner agent...");
    
    notify("📡 Fetching comprehensive weather and air quality data...");
    const [weather, aqi] = await Promise.all([
      fetchWeather(),
      fetchAQI()
    ]);

    notify(`🌤️ Weather: ${weather.current.temperature}°C (${weather.description}), Range: ${weather.daily.temp_min}–${weather.daily.temp_max}°C`);
    notify(`💨 Wind: ${weather.current.windspeed}km/h | ☔ Precip: ${weather.current.precipitation}mm`);
    notify(`🌅 Sunrise: ${weather.daily.sunrise} | 🌇 Sunset: ${weather.daily.sunset}`);
    notify(`🌬️ Air Quality: ${aqi.value || "Unknown"} (${aqi.quality})`);

    const blocks = [
      { start: "06:00", end: "09:00", name: "Early Morning" },
      { start: "09:00", end: "12:00", name: "Morning" },
      { start: "12:00", end: "15:00", name: "Afternoon" },
      { start: "15:00", end: "18:00", name: "Late Afternoon" },
      { start: "18:00", end: "21:00", name: "Evening" },
      { start: "21:00", end: "23:00", name: "Night" }
    ];

    let dayPlan = [];
    let allActivities = [];

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      notify(`\n⏳ Planning ${block.name} (${block.start}–${block.end})...`);
      
      const prompt = buildPrompt(weather, aqi, block, allActivities);
      const blockPlan = await callLLM(prompt);

      if (Array.isArray(blockPlan)) {
        dayPlan.push(...blockPlan);
        allActivities.push(...blockPlan);
      } else if (blockPlan) {
        dayPlan.push(blockPlan);
        allActivities.push(blockPlan);
      }

      // Small delay between requests to avoid rate limiting
      if (i < blocks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    notify("\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    notify("✨ YOUR PERSONALIZED DAILY PLAN ✨");
    notify("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    
    dayPlan.forEach(activity => {
      notify(formatActivityCard(activity), true);
    });

    notify("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    notify(`✅ Complete! Generated ${dayPlan.length} personalized activities for your day.`);
    notify("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  } catch (error) {
    notify(`❌ Fatal error: ${error.message}`);
    console.error("Agent error:", error);
  } finally {
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