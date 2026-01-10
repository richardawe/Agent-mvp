// --- Config ---
const API_URL = "https://api.3d7tech.com/v1/chat/completions";
const API_KEY = ""; // Optional
const REQUEST_TIMEOUT = 60000; // 60 seconds
const MAX_RETRIES = 2; // Reduced retries
const BATCH_SIZE = 2; // Process 2 blocks at once instead of 6 separate calls

// --- APIs ---
const WEATHER_API = "https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.12&current_weather=true&daily=sunrise,sunset";
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

// --- Timeout wrapper with abort controller ---
function fetchWithTimeout(url, options = {}, timeout = REQUEST_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timeoutId));
}

// --- Fetch weather ---
async function fetchWeather() {
  try {
    const res = await fetchWithTimeout(WEATHER_API, {}, 10000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const w = data.current_weather;
    return {
      temp: w.temperature || 15,
      precip: w.precipitation || 0,
      wind: w.windspeed || 5,
      code: w.weathercode || 0,
      sunrise: data.daily?.sunrise?.[0] || "06:00",
      sunset: data.daily?.sunset?.[0] || "18:00",
      desc: getWeatherDesc(w.weathercode || 0)
    };
  } catch (error) {
    notify(`⚠️ Weather fetch failed, using defaults`);
    return { temp: 15, precip: 0, wind: 5, code: 0, sunrise: "06:00", sunset: "18:00", desc: "Clear" };
  }
}

function getWeatherDesc(code) {
  if (code === 0) return "Clear";
  if (code <= 3) return "Cloudy";
  if (code <= 48) return "Fog";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  return "Storms";
}

// --- Fetch AQI ---
async function fetchAQI() {
  try {
    const res = await fetchWithTimeout(AQI_API, {}, 10000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const aqi = data.data?.aqi || null;
    return { val: aqi, safe: !aqi || aqi < 100 };
  } catch (error) {
    notify(`⚠️ AQI fetch failed, assuming safe`);
    return { val: null, safe: true };
  }
}

// --- Streamlined LLM call ---
async function callLLM(prompt, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      notify(`🤖 LLM request ${attempt}/${retries}...`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
        notify(`⏱️ Request timed out after ${REQUEST_TIMEOUT/1000}s`);
      }, REQUEST_TIMEOUT);

      const res = await fetch(API_URL, {
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
              content: "You are a daily planner. Respond ONLY with valid JSON array. Be concise but helpful." 
            },
            { role: "user", content: prompt }
          ],
          temperature: 0.5,
          max_tokens: 1500
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errorText = await res.text().catch(() => 'Unknown error');
        throw new Error(`HTTP ${res.status}: ${errorText}`);
      }
      
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      
      if (!content) throw new Error("Empty response");

      // Clean response
      let cleanContent = content.trim();
      cleanContent = cleanContent.replace(/```json\s*/g, '').replace(/```\s*/g, '');
      cleanContent = cleanContent.replace(/^[^[\{]*/, '').replace(/[^}\]]*$/, '');
      
      const parsed = JSON.parse(cleanContent);
      notify(`✅ LLM responded successfully`);
      return parsed;
      
    } catch (error) {
      const errorMsg = error.name === 'AbortError' ? 'Request timeout' : error.message;
      notify(`❌ Attempt ${attempt} failed: ${errorMsg}`);
      
      if (attempt === retries) {
        notify(`⚠️ Using fallback plan after ${retries} attempts`);
        return null;
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 3000 * attempt));
    }
  }
  return null;
}

// --- Concise prompt ---
function buildCompactPrompt(weather, aqi, blocks) {
  const outdoorOk = aqi.safe && weather.precip < 3 && weather.wind < 35;
  
  return `Plan activities for these times: ${blocks.map(b => b.start + '-' + b.end).join(', ')}

Weather: ${weather.temp}°C, ${weather.desc}, Wind ${weather.wind}km/h, Rain ${weather.precip}mm
Air Quality: ${aqi.val || 'Good'} (${outdoorOk ? 'outdoor OK' : 'stay indoors'})
Daylight: ${weather.sunrise} to ${weather.sunset}

For EACH time block, suggest 1-2 activities with:
- Specific activity matching time of day
- Practical clothing for ${weather.temp}°C
- Meal if appropriate for that time
- Brief helpful tip
- Why this activity (1 sentence)

Return JSON array:
[{"time":"HH:MM","activity":"...","clothing":"...","meal":"..." or null,"notes":"...","why":"..."}]

Rules:
- ${outdoorOk ? 'Outdoor activities encouraged' : 'Focus indoors'}
- Match energy to time (morning=active, evening=relaxed)
- Be specific and practical
- Each activity should be different
- JSON only, no extra text`;
}

// --- Fallback plan ---
function getFallbackPlan(blocks, weather, aqi) {
  const plans = blocks.map(block => {
    const hour = parseInt(block.start.split(':')[0]);
    
    if (hour >= 6 && hour < 9) {
      return {
        time: "07:00",
        activity: "Morning routine and light breakfast",
        clothing: `Light layers for ${weather.temp}°C indoors`,
        meal: "Oatmeal with fruit and coffee",
        notes: "Start the day gently",
        why: "Morning energy boost"
      };
    } else if (hour >= 9 && hour < 12) {
      return {
        time: "10:00",
        activity: aqi.safe && weather.precip < 2 ? "Morning walk or outdoor exercise" : "Indoor workout or stretching",
        clothing: `${weather.temp > 15 ? 'Light' : 'Warm'} athletic wear`,
        meal: "Hydration break with water",
        notes: "Get moving while fresh",
        why: "Peak alertness time"
      };
    } else if (hour >= 12 && hour < 15) {
      return {
        time: "12:30",
        activity: "Lunch and midday break",
        clothing: "Comfortable casual wear",
        meal: "Balanced lunch with protein and vegetables",
        notes: "Take proper break from work",
        why: "Refuel and recharge"
      };
    } else if (hour >= 15 && hour < 18) {
      return {
        time: "15:30",
        activity: "Afternoon productive time or errands",
        clothing: `Weather-appropriate: ${weather.temp}°C ${weather.desc}`,
        meal: "Light snack if needed",
        notes: "Second wind of the day",
        why: "Good focus period"
      };
    } else if (hour >= 18 && hour < 21) {
      return {
        time: "19:00",
        activity: "Dinner and evening relaxation",
        clothing: "Comfortable home clothes",
        meal: "Hearty dinner",
        notes: "Wind down from day",
        why: "Rest and digest"
      };
    } else {
      return {
        time: "21:30",
        activity: "Evening routine and prepare for bed",
        clothing: "Sleepwear",
        meal: null,
        notes: "Limit screens before sleep",
        why: "Quality rest is crucial"
      };
    }
  });
  
  return plans;
}

// --- Format output ---
function formatActivity(activity) {
  return `
<div style="border-left: 4px solid #4CAF50; padding: 12px; margin: 10px 0; background: rgba(76,175,80,0.1); border-radius: 4px;">
  <div style="font-size: 1.1em; font-weight: bold; color: #4CAF50;">⏰ ${activity.time}</div>
  <div style="margin: 6px 0;"><strong>📌</strong> ${activity.activity}</div>
  <div style="margin: 6px 0;"><strong>👔</strong> ${activity.clothing}</div>
  ${activity.meal ? `<div style="margin: 6px 0;"><strong>🍽️</strong> ${activity.meal}</div>` : ''}
  <div style="margin: 6px 0;"><strong>📝</strong> ${activity.notes}</div>
  <div style="margin: 6px 0; font-style: italic; opacity: 0.9;"><strong>💡</strong> ${activity.why}</div>
</div>`;
}

// --- Main agent ---
async function runAgent() {
  const container = document.getElementById("notifications");
  const button = document.getElementById("runAgent");
  
  if (!container || !button) {
    console.error("Required elements missing");
    return;
  }

  button.disabled = true;
  container.innerHTML = "";
  
  try {
    notify("🚀 Starting daily planner...\n");
    
    // Fetch data in parallel with short timeout
    const [weather, aqi] = await Promise.all([
      fetchWeather(),
      fetchAQI()
    ]);

    notify(`🌤️ ${weather.temp}°C, ${weather.desc} | 💨 ${weather.wind}km/h | ☔ ${weather.precip}mm`);
    notify(`🌬️ AQI: ${aqi.val || 'Unknown'} (${aqi.safe ? 'Safe' : 'Caution'})\n`);

    const blocks = [
      { start: "06:00", end: "09:00" },
      { start: "09:00", end: "12:00" },
      { start: "12:00", end: "15:00" },
      { start: "15:00", end: "18:00" },
      { start: "18:00", end: "21:00" },
      { start: "21:00", end: "23:00" }
    ];

    notify(`🤖 Generating plan (this may take 30-60 seconds)...\n`);

    // Try batched approach first
    let dayPlan = [];
    let usedFallback = false;

    // Process in batches
    for (let i = 0; i < blocks.length; i += BATCH_SIZE) {
      const batch = blocks.slice(i, i + BATCH_SIZE);
      notify(`⏳ Planning ${batch[0].start}-${batch[batch.length-1].end}...`);
      
      const prompt = buildCompactPrompt(weather, aqi, batch);
      const result = await callLLM(prompt);
      
      if (result && Array.isArray(result)) {
        dayPlan.push(...result);
      } else {
        notify(`⚠️ Using fallback for this block`);
        dayPlan.push(...getFallbackPlan(batch, weather, aqi));
        usedFallback = true;
      }
      
      // Brief pause between batches
      if (i + BATCH_SIZE < blocks.length) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    // Display results
    notify("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    notify("✨ YOUR DAILY PLAN ✨");
    notify("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    
    dayPlan.forEach(activity => {
      notify(formatActivity(activity), true);
    });

    notify("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    notify(`✅ Plan complete! ${dayPlan.length} activities generated`);
    if (usedFallback) {
      notify(`ℹ️ Note: Some activities are fallback suggestions due to LLM issues`);
    }
    notify("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  } catch (error) {
    notify(`❌ Error: ${error.message}`);
    console.error("Agent error:", error);
  } finally {
    button.disabled = false;
  }
}

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  const button = document.getElementById("runAgent");
  if (button) {
    button.addEventListener("click", runAgent);
    notify("💡 Tip: First run may take longer as LLM initializes");
  }
});
