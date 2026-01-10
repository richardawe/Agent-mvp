// --- Config ---
const API_URL = "https://api.3d7tech.com/v1/chat/completions";
const API_KEY = ""; // Optional

// --- APIs ---
const WEATHER_API = "https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.12&current_weather=true&daily=sunrise,sunset";
const AQI_API = "https://api.waqi.info/feed/london/?token=demo";

// --- UI ---
function notify(text) {
  const div = document.createElement("div");
  div.className = "notification";
  div.innerText = text;
  document.getElementById("notifications").appendChild(div);
}

// --- Fetch weather ---
async function fetchWeather() {
  const res = await fetch(WEATHER_API);
  const data = await res.json();
  const w = data.current_weather;
  return {
    temperature: w.temperature,
    precipitation: w.precipitation,
    windspeed: w.windspeed,
    sunrise: data.daily.sunrise[0],
    sunset: data.daily.sunset[0]
  };
}

// --- Fetch AQI ---
async function fetchAQI() {
  try {
    const res = await fetch(AQI_API);
    const data = await res.json();
    return data.data.aqi;
  } catch {
    return null;
  }
}

// --- Call local LLM ---
async function callLLM(prompt) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY && { "Authorization": `Bearer ${API_KEY}` })
    },
    body: JSON.stringify({
      model: "local-model",
      messages: [
        { role: "system", content: "You are a friendly personal assistant agent." },
        { role: "user", content: prompt }
      ],
      temperature: 0.0
    })
  });
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

// --- Prompt builder per block ---
function buildPrompt(weather, aqi, block, userInputs = {}) {
  return `
Plan the user's activities for ${block.start}–${block.end} based on:
Weather: ${JSON.stringify(weather)}
AQI: ${aqi}
User preferences so far: ${JSON.stringify(userInputs)}

Rules:
- Suggest clothing, meals, and activities
- Avoid outdoor if AQI > 100 or rain
- Return JSON array with fields: time, activity, clothing, meal, notes
- No extra text
`;
}

// --- Ask user ---
async function askUser(questions) {
  const answers = {};
  for (const q of questions) {
    const answer = prompt(q.question);
    answers[q.key] = answer;
  }
  return answers;
}

// --- Main agent loop ---
async function runAgent() {
  document.getElementById("notifications").innerHTML = "";
  notify("Fetching weather...");
  const weather = await fetchWeather();
  notify(`Temp: ${weather.temperature}°C, Precipitation: ${weather.precipitation}, Wind: ${weather.windspeed}`);
  notify(`Sunrise: ${weather.sunrise}, Sunset: ${weather.sunset}`);

  notify("Fetching AQI...");
  const aqi = await fetchAQI();
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
    let blockPlan = await callLLM(prompt);

    // Ask questions if block has any (optional for future extension)
    // userInputs can be merged here for next block

    dayPlan.push(...blockPlan);
  }

  notify("Full day plan:");
  dayPlan.forEach(b => {
    notify(`${b.time} → ${b.activity}\nClothing: ${b.clothing}\nMeal: ${b.meal || "N/A"}\nNotes: ${b.notes || "None"}`);
  });
}

// --- Bind UI ---
document.getElementById("runAgent").addEventListener("click", runAgent);