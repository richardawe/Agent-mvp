// --- Config ---
const API_URL = "https://api.3d7tech.com/v1/chat/completions";
const API_KEY = ""; // Optional if your local LLM needs it

// --- Public Data Endpoints ---
const WEATHER_API = "https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.12&current_weather=true&daily=sunrise,sunset";
const AQI_API = "https://api.waqi.info/feed/london/?token=demo"; // Example public AQI token

// --- UI ---
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

// --- Ask user questions for preferences ---
async function askUser(questions) {
  const answers = {};
  for (const q of questions) {
    const answer = prompt(q.question);
    answers[q.key] = answer;
  }
  return answers;
}

// --- Build LLM prompt ---
function buildPrompt(weather, aqi, userInputs = {}) {
  return `
You are an autonomous personal assistant agent.
Plan the user's day from 6:00 AM to 10:00 PM in hourly or block intervals.

Weather: ${JSON.stringify(weather)}
Air Quality (AQI): ${aqi}
User preferences: ${JSON.stringify(userInputs)}

Rules:
- Suggest clothing appropriate for weather and AQI
- Suggest breakfast, lunch, dinner
- Suggest leisure, exercise, errands, and indoor/outdoor activities
- Avoid outdoor activities if AQI > 100 or rain
- Ask questions to clarify preferences if needed
- Return ONLY valid JSON array with this schema:
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

// --- Agent loop ---
async function runAgent() {
  document.getElementById("notifications").innerHTML = "";

  notify("Fetching weather and sunrise/sunset...");
  const weather = await fetchWeather();

  notify(`Current temperature: ${weather.temperature}°C, wind: ${weather.windspeed} km/h`);
  notify(`Sunrise: ${weather.sunrise}, Sunset: ${weather.sunset}`);

  notify("Fetching Air Quality Index...");
  const aqi = await fetchAQI();
  if (aqi !== null) notify(`Current AQI: ${aqi}`);
  else notify("AQI data not available");

  notify("Generating initial day plan...");
  let prompt = buildPrompt(weather, aqi);
  let dayPlan = await callLLM(prompt);

  // Check for questions from LLM
  let combinedUserInputs = {};
  let hasQuestions = true;

  while (hasQuestions) {
    const allQuestions = dayPlan
      .flatMap(block => block.questions || [])
      .filter(q => q.key && !combinedUserInputs[q.key]);

    if (allQuestions.length === 0) {
      hasQuestions = false;
      break;
    }

    const answers = await askUser(allQuestions);
    combinedUserInputs = { ...combinedUserInputs, ...answers };

    notify("Updating plan based on your input...");
    prompt = buildPrompt(weather, aqi, combinedUserInputs);
    dayPlan = await callLLM(prompt);
  }

  notify("Here is your full day plan (6 AM - 10 PM):");
  dayPlan.forEach(block => {
    notify(
      `${block.time} → ${block.activity}\nClothing: ${block.clothing}\nMeal: ${block.meal || "N/A"}\nNotes: ${block.notes || "None"}`
    );
  });
}

// --- Bind UI ---
document.getElementById("runAgent").addEventListener("click", runAgent);