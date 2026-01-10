// --- Config ---
const API_URL = "https://api.3d7tech.com/v1/chat/completions";
const API_KEY = ""; // Optional
const REQUEST_TIMEOUT = 45000; // 45 seconds for better responses
const MAX_RETRIES = 2;

// --- APIs ---
const WEATHER_API = "https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.12&current_weather=true&daily=sunrise,sunset";
const AQI_API = "https://api.waqi.info/feed/london/?token=demo";

// --- UI ---
function notify(text, className = "notification") {
  const div = document.createElement("div");
  div.className = className;
  div.innerText = text;
  const container = document.getElementById("notifications");
  if (container) {
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }
  return div;
}

function notifyHTML(html) {
  const div = document.createElement("div");
  div.className = "notification";
  div.innerHTML = html;
  const container = document.getElementById("notifications");
  if (container) {
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }
  return div;
}

function updateNotification(element, text) {
  if (element) {
    element.innerText = text;
    const container = document.getElementById("notifications");
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }
}

// --- Streaming text animation ---
async function streamText(element, text, speed = 20) {
  element.innerText = "";
  for (let i = 0; i < text.length; i++) {
    element.innerText += text[i];
    if (i % 5 === 0) { // Update scroll periodically
      const container = document.getElementById("notifications");
      if (container) container.scrollTop = container.scrollHeight;
    }
    await new Promise(resolve => setTimeout(resolve, speed));
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
    const res = await fetchWithTimeout(WEATHER_API, {}, 10000);
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
    notify(`⚠️ Weather fetch failed, using defaults`);
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
    const res = await fetchWithTimeout(AQI_API, {}, 10000);
    if (!res.ok) throw new Error(`AQI API error: ${res.status}`);
    const data = await res.json();
    return data.data?.aqi || null;
  } catch (error) {
    notify(`⚠️ AQI unavailable, assuming safe conditions`);
    return null;
  }
}

// --- Call local LLM with retry ---
async function callLLM(prompt, statusElement, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      updateNotification(statusElement, `🤖 Generating plan (attempt ${attempt}/${retries})...`);
      
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
              content: "You are a practical daily planning assistant. Provide sensible, detailed recommendations in valid JSON format only. No markdown, no extra text." 
            },
            { role: "user", content: prompt }
          ],
          temperature: 0.6,
          max_tokens: 1200
        })
      });

      if (!res.ok) throw new Error(`LLM API error: ${res.status}`);
      
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      
      if (!content) throw new Error("Empty response from LLM");

      // Clean up response
      let cleanContent = content.trim();
      cleanContent = cleanContent.replace(/```json\n?|\n?```|```\n?/g, '');
      cleanContent = cleanContent.replace(/^[^[\{]*/, '').replace(/[^}\]]*$/, '');
      
      updateNotification(statusElement, `✅ Plan generated successfully`);
      return JSON.parse(cleanContent);
    } catch (error) {
      updateNotification(statusElement, `❌ Attempt ${attempt} failed: ${error.message}`);
      if (attempt === retries) {
        return null;
      }
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
}

// --- Enhanced prompt for better results ---
function buildPrompt(weather, aqi, block, previousActivities = []) {
  const hour = parseInt(block.start.split(':')[0]);
  const timeOfDay = hour < 9 ? "early morning" : hour < 12 ? "mid-morning" : hour < 15 ? "afternoon" : hour < 18 ? "late afternoon" : "evening";
  const outdoorSafe = (aqi === null || aqi < 100) && weather.precipitation < 3;
  
  const context = previousActivities.length > 0 
    ? `\nPrevious activities today: ${previousActivities.slice(-2).map(a => a.activity).join(', ')}`
    : '';

  return `Create a realistic ${timeOfDay} plan for ${block.start}–${block.end}.

Current Conditions:
- Weather: ${weather.temperature}°C, ${weather.precipitation}mm rain, ${weather.windspeed}km/h wind
- Air Quality: ${aqi || 'Good'} ${outdoorSafe ? '(outdoor activities OK)' : '(stay indoors recommended)'}
- Daylight: Sunrise ${weather.sunrise}, Sunset ${weather.sunset}${context}

Requirements:
1. Generate 2-3 specific activities for this time block
2. Each activity should be practical and appropriate for ${timeOfDay}
3. Include detailed clothing advice for ${weather.temperature}°C conditions
4. Suggest meals/snacks if relevant to the time
5. Add helpful implementation tips
6. Make recommendations sensible and actionable (not generic one-liners)

Return ONLY a JSON array with this exact structure:
[
  {
    "time": "HH:MM",
    "activity": "Specific activity description (be detailed, 10-15 words)",
    "clothing": "Practical clothing recommendation with layers/fabrics",
    "meal": "Specific meal/snack suggestion" or null,
    "notes": "Helpful tip for this activity (2-3 sentences with practical advice)"
  }
]

${outdoorSafe ? 'Prioritize outdoor activities where appropriate.' : 'Focus on indoor activities due to weather/air quality.'}
Match energy levels to ${timeOfDay} (morning=energetic, evening=relaxing).
Be specific - avoid generic suggestions like "go for a walk" - say WHERE or HOW.`;
}

// --- Fallback plan generator ---
function getFallbackForBlock(block, weather, aqi) {
  const hour = parseInt(block.start.split(':')[0]);
  const outdoorSafe = (aqi === null || aqi < 100) && weather.precipitation < 3;
  
  if (hour >= 6 && hour < 9) {
    return [{
      time: "07:00",
      activity: "Morning wake-up routine with light stretching or yoga",
      clothing: `Light indoor layers suitable for ${weather.temperature}°C`,
      meal: "Balanced breakfast with protein and whole grains",
      notes: "Start the day gently. Hydrate well and consider a 10-minute stretching session to wake up your body."
    }];
  } else if (hour >= 9 && hour < 12) {
    return [{
      time: "10:00",
      activity: outdoorSafe ? "Brisk 30-minute walk in local park or neighborhood" : "Indoor cardio workout or home exercise routine",
      clothing: outdoorSafe ? `Weather-appropriate activewear for ${weather.temperature}°C with windbreaker` : "Comfortable athletic wear",
      meal: "Mid-morning snack like fruit or nuts",
      notes: "Peak productivity hours. If outdoors, take advantage of morning light. If indoors, ensure good ventilation."
    }];
  } else if (hour >= 12 && hour < 15) {
    return [{
      time: "12:30",
      activity: "Nutritious lunch break with proper rest from work",
      clothing: "Comfortable casual wear",
      meal: "Well-balanced lunch with lean protein, vegetables, and complex carbs",
      notes: "Take a full break from screens. Consider a short 15-minute walk after eating to aid digestion."
    }];
  } else if (hour >= 15 && hour < 18) {
    return [{
      time: "15:30",
      activity: outdoorSafe ? "Outdoor errands or light activity" : "Indoor productive tasks or creative work",
      clothing: `Layer appropriately for ${weather.temperature}°C`,
      meal: "Light afternoon snack to maintain energy",
      notes: "Good time for focused work or errands. Stay hydrated and take regular breaks."
    }];
  } else {
    return [{
      time: "18:30",
      activity: "Prepare and enjoy evening meal, followed by relaxation",
      clothing: "Comfortable home clothes",
      meal: "Hearty dinner with balanced nutrition",
      notes: "Wind down from the day. Limit screen time before bed and consider calming activities like reading."
    }];
  }
}

// --- Format activity card ---
function formatActivityCard(activity) {
  return `
<div style="border-left: 4px solid #2196F3; padding: 12px 16px; margin: 12px 0; background: linear-gradient(to right, rgba(33,150,243,0.1), transparent); border-radius: 4px;">
  <div style="font-size: 1.2em; font-weight: bold; color: #2196F3; margin-bottom: 8px;">⏰ ${activity.time}</div>
  <div style="margin: 6px 0; font-size: 1.05em;"><strong>📌 Activity:</strong> ${activity.activity}</div>
  <div style="margin: 6px 0; color: #555;"><strong>👔 Clothing:</strong> ${activity.clothing}</div>
  ${activity.meal ? `<div style="margin: 6px 0; color: #555;"><strong>🍽️ Meal:</strong> ${activity.meal}</div>` : ''}
  <div style="margin: 8px 0; padding: 8px; background: rgba(0,0,0,0.05); border-radius: 4px; font-size: 0.95em;"><strong>💡 Tips:</strong> ${activity.notes}</div>
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
    notify("🚀 Starting your daily planner...\n");
    
    // Fetch data in parallel
    notify("📡 Fetching weather and air quality data...");
    const [weather, aqi] = await Promise.all([
      fetchWeather(),
      fetchAQI()
    ]);

    notify(`🌤️ Weather: ${weather.temperature}°C, ${weather.precipitation}mm rain, ${weather.windspeed}km/h wind`);
    notify(`🌅 Sunrise: ${weather.sunrise} | 🌇 Sunset: ${weather.sunset}`);
    notify(`🌬️ Air Quality: ${aqi ? `${aqi} AQI` : 'Good conditions'}\n`);

    // Define 3-hour blocks
    const blocks = [
      { start: "06:00", end: "09:00", name: "Early Morning" },
      { start: "09:00", end: "12:00", name: "Mid Morning" },
      { start: "12:00", end: "15:00", name: "Afternoon" },
      { start: "15:00", end: "18:00", name: "Late Afternoon" },
      { start: "18:00", end: "21:00", name: "Evening" }
    ];

    let allActivities = [];

    notify("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    // Process each block with instant display
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      
      // Block header
      const headerDiv = notify(`\n🕐 ${block.name.toUpperCase()} (${block.start}–${block.end})`);
      headerDiv.style.fontSize = "1.1em";
      headerDiv.style.fontWeight = "bold";
      headerDiv.style.color = "#2196F3";
      
      const statusDiv = notify("⏳ Preparing to generate plan...");
      
      // Build prompt with context
      const prompt = buildPrompt(weather, aqi, block, allActivities);
      
      // Call LLM
      const blockPlan = await callLLM(prompt, statusDiv);
      
      // Display results immediately
      if (blockPlan && Array.isArray(blockPlan) && blockPlan.length > 0) {
        for (const activity of blockPlan) {
          const activityDiv = notifyHTML(formatActivityCard(activity));
          allActivities.push(activity);
          
          // Small delay for visual effect
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } else {
        notify("⚠️ Using fallback plan for this block");
        const fallback = getFallbackForBlock(block, weather, aqi);
        for (const activity of fallback) {
          notifyHTML(formatActivityCard(activity));
          allActivities.push(activity);
        }
      }
      
      // Pause between blocks
      if (i < blocks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }

    notify("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    const summaryDiv = notify(`✅ Your daily plan is complete! Generated ${allActivities.length} activities.`);
    summaryDiv.style.fontWeight = "bold";
    summaryDiv.style.color = "#4CAF50";
    notify("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

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
