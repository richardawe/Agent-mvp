// --- Config ---
const API_URL = "https://api.3d7tech.com/v1/chat/completions";
const API_KEY = ""; // Optional if needed for your local LLM

// --- Public APIs ---
const WEATHER_API = "https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.12&current_weather=true&daily=sunrise,sunset";
const AQI_API = "https://api.waqi.info/feed/london/?token=demo"; // Example public AQI token

// --- UI Helpers ---
function notify(text) {
  const div = document.createElement("div");
  div.className = "notification";
  div.innerText = text;
  document.getElementById("notifications").appendChild(div);
}

// --- Fetch weather + sunrise/sunset ---
async function fetchWeather() {
  const res = await fetch(WEATHER_API);
  const data = await res.json();
  const current = data.current_weather;
  const sunrise = data.daily.sunrise[0];
  const sunset = data.daily.sunset[0];
  return { ...current, sunrise, sunset };
}

// --- Fetch AQI ---
async function fetchAQI() {
  try {
    const res = await fetch(AQI_API);
    const data = await res.json();
    return data.data.aqi;
  } catch {
    return null; // fallback
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
        { role: "system", content: "You are a friendly personal assistant agent planning the user's day." },
        { role: "user", content: prompt }
      ],
      temperature: 0.0
    })
  });

  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

// --- Ask user for input ---
async function askUser(questions) {
  const answers = {};
  for (const q of questions) {
    const answer = prompt(q.question);
    answers[q.key] = answer;
  }
  return answers;
}

// --- Build LLM prompt for a single block ---
function buildPromptForBlock(weather, aqi, userInputs = {}, block) {
  return `
You are an autonomous personal assistant.
Plan the user's activities, clothing, meals, and notes for ${block.start} – ${block.end}.
Use this weather + AQI data: ${JSON.stringify(weather)}, AQI: ${aqi}.
User preferences so far: ${JSON.stringify(userInputs)}

Rules:
- Suggest clothing appropriate for weather and AQI
- Suggest meals if they fall in this block
- Suggest leisure, exercise, errands, and indoor/outdoor activities
- Avoid outdoor activities if AQI > 100 or rain
- Ask questions if you need user preferences
- Return ONLY valid JSON array with schema:
[
  {
    "time": string,
    "activity": string,
    "clothing": string,
    "meal": string|null,
    "notes": string|null,
    "questions": [ { "question": string, "key": string } ] // optional
  }
]
`;
}

// --- Main agent loop ---
async function runAgent() {
  document.getElementById("notifications").innerHTML = "";

  notify("Fetching weather and sunrise/sunset...");
  const weather = await fetchWeather();
  notify(`Temperature: ${weather.temperature}°C, Wind: ${weather.windspeed} km/h`);
  notify(`Sunrise: ${weather.sunrise}, Sunset: ${weather.sunset}`);

  notify("Fetching Air Quality Index...");
  const aqi = await fetchAQI();
  if (aqi !== null) notify(`AQI: ${aqi}`);
  else notify("AQI data not available");

  // Define 3-hour blocks
  const blocks = [
    { start: "6:00", end: "9:00" },
    { start: "9:00", end: "12:00" },
    { start: "12:00", end: "15:00" },
    { start: "15:00", end: "18:00" },
    { start: "18:00", end: "21:00" },
    { start: "21:00", end: "22:00" }
  ];

  let dayPlan = [];
  let combinedUserInputs = {};

  for (const block of blocks) {
    notify(`Planning ${block.start} – ${block.end}...`);
    let prompt = buildPromptForBlock(weather, aqi, combinedUserInputs, block);
    let blockPlan = await callLLM(prompt);

    // Ask questions for this block if any
    const questions = blockPlan.flatMap(b => b.questions || []).filter(q => !combinedUserInputs[q.key]);
    if (questions.length > 0) {
      const answers = await askUser(questions);
      combinedUserInputs = { ...combinedUserInputs, ...answers };

      notify(`Updating plan for ${block.start} – ${block.end} based on your input...`);
      prompt = buildPromptForBlock(weather, aqi, combinedUserInputs, block);
      blockPlan = await callLLM(prompt);
    }

    dayPlan.push(...blockPlan);
  }

  notify("Here is your full day plan (6 AM – 10 PM):");
  dayPlan.forEach(block => {
    notify(
      `${block.time} → ${block.activity}\nClothing: ${block.clothing}\nMeal: ${block.meal || "N/A"}\nNotes: ${block.notes || "None"}`
    );
  });
}

// --- Bind UI ---
document.getElementById("runAgent").addEventListener("click", runAgent);