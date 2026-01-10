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

// --- Generate daily clothing recommendation ---
function generateClothingRecommendation(weather, aqi) {
  const temp = weather.temperature;
  const hasRain = weather.precipitation > 2;
  const isWindy = weather.windspeed > 25;
  
  let layers = [];
  let accessories = [];
  
  // Base layer
  if (temp < 5) {
    layers.push("thermal underwear and warm base layers");
  } else if (temp < 15) {
    layers.push("long-sleeve shirt or light sweater");
  } else {
    layers.push("breathable cotton or linen shirt");
  }
  
  // Mid layer
  if (temp < 10) {
    layers.push("insulated fleece or wool sweater");
  } else if (temp < 18) {
    layers.push("light cardigan or hoodie for layering");
  }
  
  // Outer layer
  if (hasRain) {
    layers.push("waterproof rain jacket");
    accessories.push("umbrella");
  } else if (isWindy) {
    layers.push("windbreaker or light jacket");
  } else if (temp < 12) {
    layers.push("warm coat or jacket");
  }
  
  // Accessories
  if (temp < 8) {
    accessories.push("scarf", "gloves", "warm hat");
  } else if (temp < 15 && isWindy) {
    accessories.push("light scarf");
  }
  
  if (temp > 20) {
    accessories.push("sunglasses", "sun hat");
  }
  
  // Footwear
  let footwear = hasRain ? "waterproof boots or shoes" : temp < 10 ? "warm closed-toe shoes or boots" : "comfortable walking shoes or sneakers";
  
  const clothingAdvice = `${layers.join(", ")}. Footwear: ${footwear}${accessories.length > 0 ? `. Accessories: ${accessories.join(", ")}` : ""}.`;
  
  return clothingAdvice;
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
              content: "You are a practical daily planning assistant. Provide sensible, detailed, and VARIED recommendations in valid JSON format only. Never repeat the same activity twice. No markdown, no extra text." 
            },
            { role: "user", content: prompt }
          ],
          temperature: 0.7,
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
  
  const usedActivities = previousActivities.map(a => a.activity.toLowerCase());
  
  return `Create a realistic ${timeOfDay} plan for ${block.start}–${block.end}.

Current Conditions:
- Weather: ${weather.temperature}°C, ${weather.precipitation}mm rain, ${weather.windspeed}km/h wind
- Air Quality: ${aqi || 'Good'} ${outdoorSafe ? '(outdoor activities OK)' : '(stay indoors recommended)'}
- Daylight: Sunrise ${weather.sunrise}, Sunset ${weather.sunset}

${previousActivities.length > 0 ? `Activities already planned today:\n${previousActivities.map(a => `• ${a.time}: ${a.activity}`).join('\n')}\n` : ''}

CRITICAL: DO NOT repeat any of these activities. Create completely NEW and DIFFERENT activities.

Requirements:
1. Generate 2-3 UNIQUE activities for this ${timeOfDay} block
2. Each activity must be DIFFERENT from all previous activities today
3. Be specific and practical - appropriate for ${timeOfDay}
4. DO NOT include clothing recommendations (handled separately)
5. Suggest meals/snacks if relevant to the time
6. Add helpful implementation tips (2-3 sentences)
7. Make it actionable - not generic suggestions

Return ONLY a JSON array with this exact structure:
[
  {
    "time": "HH:MM",
    "activity": "Specific NEW activity description (be detailed, 10-20 words)",
    "meal": "Specific meal/snack suggestion" or null,
    "notes": "Helpful practical advice for this activity (2-3 sentences)"
  }
]

${outdoorSafe ? 'Prioritize outdoor activities where appropriate.' : 'Focus on indoor activities due to weather/air quality.'}
Match energy levels to ${timeOfDay} (morning=energetic, evening=relaxing).
IMPORTANT: Ensure VARIETY - no repetition of activity types from earlier in the day.`;
}

// --- Fallback plan generator ---
function getFallbackForBlock(block, weather, aqi, usedActivities = []) {
  const hour = parseInt(block.start.split(':')[0]);
  const outdoorSafe = (aqi === null || aqi < 100) && weather.precipitation < 3;
  
  const activities = {
    morning: [
      { activity: "Morning wake-up routine with gentle stretching and hydration", meal: "Balanced breakfast with protein, whole grains, and fruit", notes: "Start slowly. Do 10 minutes of light stretching to wake up your muscles. Drink a full glass of water before breakfast." },
      { activity: "Review daily goals and plan your schedule over morning beverage", meal: "Coffee or tea with a light snack", notes: "Take 15 minutes to organize your day. Write down 3 priority tasks to accomplish." }
    ],
    midMorning: [
      { activity: outdoorSafe ? "30-minute brisk walk in local park or scenic neighborhood route" : "Home workout session: bodyweight exercises and yoga flow", meal: "Mid-morning fruit or protein snack", notes: "Peak energy time. If walking, maintain a brisk pace. If indoors, focus on form over speed." },
      { activity: "Focused work session on important tasks requiring concentration", meal: "Herbal tea and healthy snack", notes: "Tackle your most challenging work now. Use 25-minute focused intervals with 5-minute breaks." }
    ],
    afternoon: [
      { activity: "Nutritious lunch preparation and mindful eating break", meal: "Well-balanced lunch with lean protein, vegetables, and complex carbs", notes: "Take a full 30-minute break. Eat slowly and away from screens to aid digestion." },
      { activity: outdoorSafe ? "Afternoon errands or outdoor shopping trip" : "Creative hobby time: reading, writing, or learning something new", meal: "Light afternoon snack", notes: "Good time for less demanding tasks. Stay hydrated and take short breaks every hour." }
    ],
    lateAfternoon: [
      { activity: "Household organization or meal prep for evening", meal: "Healthy afternoon snack to maintain energy", notes: "Prepare for evening. Tidy up and prep ingredients for dinner to reduce evening stress." },
      { activity: outdoorSafe ? "Leisurely outdoor stroll or visit to local shops" : "Indoor relaxation: music, podcasts, or light entertainment", meal: "Tea or light refreshment", notes: "Wind down from productive hours. Engage in low-stress activities." }
    ],
    evening: [
      { activity: "Prepare and enjoy a relaxing evening meal with good company or entertainment", meal: "Hearty dinner with balanced nutrition", notes: "Take time to cook something enjoyable. Eat mindfully and savor your food." },
      { activity: "Evening wind-down routine: light reading, journaling, or calming activities", meal: "Herbal tea if desired", notes: "Avoid screens 30 minutes before bed. Consider meditation or gentle stretching." }
    ]
  };
  
  let timeCategory;
  if (hour >= 6 && hour < 9) timeCategory = 'morning';
  else if (hour >= 9 && hour < 12) timeCategory = 'midMorning';
  else if (hour >= 12 && hour < 15) timeCategory = 'afternoon';
  else if (hour >= 15 && hour < 18) timeCategory = 'lateAfternoon';
  else timeCategory = 'evening';
  
  const options = activities[timeCategory];
  // Pick one that hasn't been used
  for (const option of options) {
    if (!usedActivities.some(used => used.toLowerCase().includes(option.activity.toLowerCase().split(' ').slice(0, 3).join(' ')))) {
      return [{
        time: block.start,
        activity: option.activity,
        meal: option.meal,
        notes: option.notes
      }];
    }
  }
  
  return [options[0]]; // Fallback to first option
}

// --- Format activity card ---
function formatActivityCard(activity, showClothing = false, clothingAdvice = "") {
  return `
<div style="border-left: 4px solid #2196F3; padding: 12px 16px; margin: 12px 0; background: linear-gradient(to right, rgba(33,150,243,0.1), transparent); border-radius: 4px;">
  <div style="font-size: 1.2em; font-weight: bold; color: #2196F3; margin-bottom: 8px;">⏰ ${activity.time}</div>
  <div style="margin: 6px 0; font-size: 1.05em;"><strong>📌 Activity:</strong> ${activity.activity}</div>
  ${showClothing ? `<div style="margin: 6px 0; padding: 8px; background: rgba(33,150,243,0.15); border-radius: 4px; color: #555;"><strong>👔 Today's Clothing:</strong> ${clothingAdvice}</div>` : ''}
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

    // Generate clothing recommendation once
    const clothingAdvice = generateClothingRecommendation(weather, aqi);
    const clothingDiv = notifyHTML(`
<div style="border: 2px solid #FF9800; padding: 14px; margin: 14px 0; background: linear-gradient(to right, rgba(255,152,0,0.15), transparent); border-radius: 6px;">
  <div style="font-size: 1.1em; font-weight: bold; color: #FF9800; margin-bottom: 6px;">👔 TODAY'S CLOTHING RECOMMENDATION</div>
  <div style="color: #555; line-height: 1.6;">${clothingAdvice}</div>
</div>
    `);

    // Define 3-hour blocks
    const blocks = [
      { start: "06:00", end: "09:00", name: "Early Morning" },
      { start: "09:00", end: "12:00", name: "Mid Morning" },
      { start: "12:00", end: "15:00", name: "Afternoon" },
      { start: "15:00", end: "18:00", name: "Late Afternoon" },
      { start: "18:00", end: "21:00", name: "Evening" }
    ];

    let allActivities = [];

    notify("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

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
          notifyHTML(formatActivityCard(activity, false, ""));
          allActivities.push(activity);
          
          // Small delay for visual effect
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } else {
        notify("⚠️ Using fallback plan for this block");
        const usedActivities = allActivities.map(a => a.activity);
        const fallback = getFallbackForBlock(block, weather, aqi, usedActivities);
        for (const activity of fallback) {
          notifyHTML(formatActivityCard(activity, false, ""));
          allActivities.push(activity);
        }
      }
      
      // Pause between blocks
      if (i < blocks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }

    notify("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    const summaryDiv = notify(`✅ Your daily plan is complete! Generated ${allActivities.length} unique activities.`);
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
