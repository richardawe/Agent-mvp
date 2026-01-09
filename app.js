const API_URL = "https://api.3d7tech.com/v1/chat/completions";
const API_KEY = "YOUR_API_KEY_HERE"; // if required

// Mock invoice data (in reality: pulled from accounting system)
const invoices = [
  {
    id: "INV-001",
    customer: "Acme Ltd",
    amount: 2400,
    due_days_ago: 18,
    prior_reminders: 1,
    customer_tier: "SMB"
  },
  {
    id: "INV-002",
    customer: "Globex Corp",
    amount: 12000,
    due_days_ago: 45,
    prior_reminders: 3,
    customer_tier: "Enterprise"
  }
];

// Core agent prompt
function buildPrompt(invoice) {
  return `
You are an autonomous finance operations agent.

Given this overdue invoice, decide the best action.

Invoice:
${JSON.stringify(invoice, null, 2)}

Rules:
- If due_days_ago < 14 → do nothing
- If due_days_ago between 14–30 → send polite reminder
- If due_days_ago > 30 OR prior_reminders >= 3 → escalate to human
- Be conservative with enterprise customers

Respond ONLY in valid JSON:
{
  "action": "send_reminder" | "escalate" | "ignore",
  "message": "string or null",
  "reason": "short explanation"
}
`;
}

async function callLLM(prompt) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: "local-model",
      messages: [
        { role: "system", content: "You are a careful, rule-following agent." },
        { role: "user", content: prompt }
      ],
      temperature: 0.2
    })
  });

  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}

function notifyHuman(text) {
  const div = document.createElement("div");
  div.className = "notification";
  div.innerText = text;
  document.getElementById("notifications").appendChild(div);
}

async function runAgent() {
  document.getElementById("notifications").innerHTML = "";

  for (const invoice of invoices) {
    const prompt = buildPrompt(invoice);
    const decision = await callLLM(prompt);

    if (decision.action === "send_reminder") {
      notifyHuman(
        `AUTO-SENT reminder for ${invoice.id}\n\nMessage:\n${decision.message}`
      );
    }

    if (decision.action === "escalate") {
      notifyHuman(
        `HUMAN ACTION REQUIRED for ${invoice.id}\nReason: ${decision.reason}`
      );
    }
  }
}

document.getElementById("runAgent").addEventListener("click", runAgent);