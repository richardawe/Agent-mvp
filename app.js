const API_URL = "https://api.3d7tech.com/v1/chat/completions";
const API_KEY = ""; // Optional if needed

const WEATHER_API = "https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.12&current_weather=true";

// --- Notifications ---
function notify(text) {
  const div = document.createElement("div");
  div.className = "notification";
  div.innerText = text;
  document.getElementById("notifications").appendChild(div);
}

// --- Fetch weather data ---
async function fetchWeather() {
  const res = await fetch(WEATHER_API);
  const data = await res.json();
  return data.current_weather;
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

// --- Build prompt for day planning ---
function buildPrompt(weather, userInputs = {}) {
  return `
You are an autonomous personal assistant agent.
User is at home watching TV and wants you to plan the day.

Weather: ${JSON.stringify(weather)}

User preferences: ${JSON.stringify(userInputs)}

Rules:
- Suggest clothing appropriate for the weather
- Suggest meals for the day
- Ask questions to clarify user preferences where needed
- Return only JSON with schema:
{
  "clothing": string,
  "breakfast": string,
  "lunch": string,
  "dinner": string,
  "questions": [ { "question": string, "key": string } ]
}
`;
}

// --- Ask user questions ---
async function askUser(questions) {
  const answers = {};
  for (const q of questions) {
    const answer = prompt(q.question); // simple browser prompt
    answers[q.key] = answer;
  }
  return answers;
}

// --- Agent loop ---
async function runAgent() {
  document.getElementById("notifications").innerHTML = "";
  notify("Fetching weather...");
  const weather = await fetchWeather();
  notify(`Current temperature: ${weather.temperature}°C, wind: ${weather.windspeed} km/h`);

  // Initial plan
  let prompt = buildPrompt(weather);
  let plan = await callLLM(prompt);

  // If agent asks questions, prompt user
  if (plan.questions && plan.questions.length > 0) {
    const userInputs = await askUser(plan.questions);
    notify("Updating plan based on your input...");
    prompt = buildPrompt(weather, userInputs);
    plan = await callLLM(prompt);
  }

  // Display final plan
  notify("Here is your suggested day plan:");
  notify(`Clothing: ${plan.clothing}`);
  notify(`Breakfast: ${plan.breakfast}`);
  notify(`Lunch: ${plan.lunch}`);
  notify(`Dinner: ${plan.dinner}`);
}

document.getElementById("runAgent").addEventListener("click", runAgent);