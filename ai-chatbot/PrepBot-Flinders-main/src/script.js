/**
 * PLACEBOT — script.js
 * Contains all business logic, API routing, markdown rendering,
 * conversation history management, and topic-locking.
 */

/* ═══════════════════════════════════════════════════════════
   CONFIG
═══════════════════════════════════════════════════════════ */

/** Paste your Groq (gsk_...), Gemini (AIza...) or OpenAI (sk-...) key here,
 *  or enter it at runtime via the sidebar API key input.
 *  NEVER commit a real key to version control. */
let API_KEY = "";

/* API Endpoints */
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

/**
 * Topic Locking System Prompt
 * Sent as the first "system" message in every request.
 */
const SYSTEM_PROMPT = `You are PlaceBot, a highly professional, concise, and expert placement mentor for engineering undergraduate students.
Your ONLY purpose is to help students with campus placement preparation. This includes:
1. HR Interview questions and answers.
2. Technical interviews (DSA, web dev, core subjects).
3. Aptitude and logical reasoning.
4. Resume building, ATS optimization, and project descriptions.
5. Soft skills, email etiquette, and offer negotiation.
6. Company-specific strategies (TCS, Google, Amazon, etc.).

STRICT RULES:
- If a user asks a question UNRELATED to placements, academics, or careers, you MUST politely refuse to answer and guide them back to placement prep.
- Your answers must be structured, nicely formatted using markdown, and easy to read.
- When giving code examples, always use markdown code blocks.
- Be encouraging but direct. No fluff.`;

/* ═══════════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════════ */

/** Full conversation history — sent on every API call for context. */
const conversationHistory = [];

/**
 * Hard guard: only ONE request can be active at any time.
 * This prevents rate-limit exhaustion even if the UI disable
 * is somehow bypassed (e.g. rapid Enter key presses).
 */
let isRequestPending = false;

/* ═══════════════════════════════════════════════════════════
   DOM REFERENCES
═══════════════════════════════════════════════════════════ */

const chatWindow = document.getElementById("chatWindow");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const clearBtn = document.getElementById("clearBtn");
const welcomeCard = document.getElementById("welcomeCard");
const inputRow = document.getElementById("inputRow");

/* API Config Elements */
const apiKeyInput = document.getElementById("apiKeyInput");
const apiSaveBtn = document.getElementById("apiSaveBtn");
const apiStatusBadge = document.getElementById("apiStatusBadge");

/* ═══════════════════════════════════════════════════════════
   UI & UTILS
═══════════════════════════════════════════════════════════ */

/** Auto-resize textarea */
function autoResizeTextarea() {
  userInput.style.height = "auto";
  userInput.style.height = userInput.scrollHeight + "px";
}

/** Scroll to bottom smoothly */
function scrollToBottom() {
  chatWindow.scrollTo({ top: chatWindow.scrollHeight, behavior: "smooth" });
}

/** Format time (e.g., "14:30") */
function getTimeStr() {
  const now = new Date();
  return now.getHours().toString().padStart(2, "0") + ":" +
    now.getMinutes().toString().padStart(2, "0");
}

/** Safely escape HTML to prevent XSS */
function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* ── DOM Manipulation ───────────────────────────────────── */

/**
 * Creates and appends a chat bubble.
 * @param {string} content - HTML string (already markdown parsed).
 * @param {"user"|"bot"} role
 */
function appendMessage(content, role) {
  if (welcomeCard) welcomeCard.style.display = "none";

  const row = document.createElement("div");
  row.className = `msg-row ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.textContent = role === "bot" ? "🤖" : "👤";

  const body = document.createElement("div");
  body.className = "msg-body";

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  bubble.innerHTML = content; // content is trusted here (parsed MD)

  const time = document.createElement("div");
  time.className = "msg-time";
  time.textContent = getTimeStr();

  body.appendChild(bubble);
  body.appendChild(time);
  row.appendChild(avatar);
  row.appendChild(body);
  chatWindow.appendChild(row);

  scrollToBottom();
}

/** Show the animated typing dot indicator */
function showTyping() {
  const row = document.createElement("div");
  row.className = "msg-row bot";
  row.id = "typingIndicator";

  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.textContent = "🤖";

  const body = document.createElement("div");
  body.className = "msg-body";

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble typing-indicator";

  for (let i = 0; i < 3; i++) {
    const dot = document.createElement("div");
    dot.className = "typing-dot";
    bubble.appendChild(dot);
  }

  body.appendChild(bubble);
  row.appendChild(avatar);
  row.appendChild(body);
  chatWindow.appendChild(row);

  scrollToBottom();
}

/** Remove the typing indicator */
function hideTyping() {
  const el = document.getElementById("typingIndicator");
  if (el) el.remove();
}

/** Lock/Unlock UI during API calls */
function setInputLocked(locked) {
  userInput.disabled = locked;
  sendBtn.disabled = locked;

  // Visual dimming on the send button wrapper
  if (locked) inputRow.style.opacity = "0.7";
  else inputRow.style.opacity = "1";
}

/* ═══════════════════════════════════════════════════════════
   MARKDOWN PARSER
═══════════════════════════════════════════════════════════ */

/**
 * Lightweight, zero-dependency Markdown renderer.
 * Handles: Code blocks, inline code, bold, italic, unordered lists.
 */
function renderMarkdown(md) {
  // 1) Escape raw HTML first (XSS protection)
  let html = escapeHtml(md);

  // 2) Code blocks: ```lang ... ```
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, function (match, lang, code) {
    return `<pre><code>${code}</code></pre>`;
  });

  // 3) Inline formatting
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>"); // Bold
  html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");             // Italic
  html = html.replace(/`(.*?)`/g, "<code>$1</code>");           // Inline code
  html = html.replace(/### (.*?)\n/g, "<h3>$1</h3>\n");         // H3

  // 4) Unordered lists: lines starting with * or -
  // We wrap consecutive list items in <ul>
  const lines = html.split("\n");
  let inList = false;
  for (let i = 0; i < lines.length; i++) {
    const isListItem = lines[i].trim().match(/^[-*]\s+(.*)$/);
    if (isListItem) {
      if (!inList) {
        lines[i] = "<ul><li>" + isListItem[1] + "</li>";
        inList = true;
      } else {
        lines[i] = "<li>" + isListItem[1] + "</li>";
      }
    } else {
      if (inList) {
        lines[i - 1] += "</ul>";
        inList = false;
      }
    }
  }
  if (inList) lines[lines.length - 1] += "</ul>";

  // 5) Paragraphs: replace standard double newlines or single newlines
  const textWithoutLists = lines.join("\n");
  const paragraphs = textWithoutLists
    .split(/\n\n+/)
    .map(p => {
      // Don't wrap <pre> or <ul> arrays in <p> tag if it solely contains block elements
      if (p.startsWith("<pre>") || p.startsWith("<ul>") || p.startsWith("<h3>")) {
        return p;
      }
      return `<p>${p.replace(/\n/g, "<br/>")}</p>`; // Single newlines to <br/>
    })
    .join("");

  return paragraphs;
}

/* -----------------------------------------------------------
   API INTEGRATION
----------------------------------------------------------- */

/**
 * Routes the request based on the API key prefix.
 * AIza... -> Gemini
 * gsk_... -> Groq
 * sk-...  -> OpenAI
 */
async function fetchBotReply(userText) {
  if (API_KEY.startsWith("AIza")) {
    return fetchGeminiReply(userText);
  }
  return fetchOpenAICompatReply(userText);
}

/** Groq & OpenAI (they share the same request/response schema) */
async function fetchOpenAICompatReply(userText) {
  const isGroq = API_KEY.startsWith("gsk_");
  const endpoint = isGroq ? GROQ_URL : OPENAI_URL;
  const model = isGroq ? "llama-3.3-70b-versatile" : "gpt-3.5-turbo";

  // Build messages array
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...conversationHistory,
    { role: "user", content: userText }
  ];

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      temperature: 0.7,
      max_tokens: 1024
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || `API Error: ${response.status}`);
  }

  const data = await response.json();
  const reply = data.choices[0].message.content;

  // Add to context
  conversationHistory.push({ role: "user", content: userText });
  conversationHistory.push({ role: "assistant", content: reply });

  return reply;
}

/** Gemini REST API (different schema) */
async function fetchGeminiReply(userText) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;

  // Build history format for Gemini
  // Gemini expects: { role: "user" | "model", parts: [{ text: "..." }] }
  const geminiHistory = [
    { role: "user", parts: [{ text: SYSTEM_PROMPT }] },
    { role: "model", parts: [{ text: "Understood. I am PlaceBot, your strict topic-locked placement mentor. I will format answers in markdown and refuse off-topic questions. How can I help?" }] }
  ];

  for (const msg of conversationHistory) {
    geminiHistory.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }]
    });
  }

  // Add new user message
  geminiHistory.push({ role: "user", parts: [{ text: userText }] });

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: geminiHistory })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || `Gemini Error: ${response.status}`);
  }

  const data = await response.json();
  if (!data.candidates || data.candidates.length === 0) {
    throw new Error("No response generated by Gemini.");
  }

  const reply = data.candidates[0].content.parts[0].text;

  // Sync back to internal history
  conversationHistory.push({ role: "user", content: userText });
  conversationHistory.push({ role: "assistant", content: reply });

  return reply;
}

/* -----------------------------------------------------------
   MAIN HANDLERS & EVENTS
----------------------------------------------------------- */

/** Core function to handle sending a message */
async function handleSend(forcedPrompt = null) {
  // If a request is already in flight, outright reject to prevent double calls.
  if (isRequestPending) {
    console.warn("PlaceBot: Request already pending. Ignoring duplicate click.");
    return;
  }

  const text = (forcedPrompt || userInput.value).trim();
  if (!text) return;

  if (!API_KEY) {
    appendMessage(
      "**Error:** No API key found. Please enter your Groq, Gemini, or OpenAI key in the left sidebar.",
      "bot"
    );
    return;
  }

  // 1. Lock the system
  isRequestPending = true;
  setInputLocked(true);

  // 2. Clear input & show user text
  userInput.value = "";
  userInput.style.height = "auto";
  appendMessage(escapeHtml(text), "user");
  showTyping();

  // 3. Fetch from API
  try {
    const reply = await fetchBotReply(text);
    hideTyping();
    const parsedReply = renderMarkdown(reply);
    appendMessage(parsedReply, "bot");
  } catch (err) {
    hideTyping();
    appendMessage(`**Error:** ${err.message}`, "bot");
    // On error, remove the last user message from context so they can retry
    if (conversationHistory.length > 0 && conversationHistory[conversationHistory.length - 1].role === "user") {
      conversationHistory.pop();
    }
  } finally {
    // 4. Unlock the system
    setInputLocked(false);
    isRequestPending = false;
    userInput.focus();
  }
}

/* -- EVENT LISTENERS -------------------------------------- */

sendBtn.addEventListener("click", () => handleSend());

userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!isRequestPending) {
      handleSend();
    }
  }
});

userInput.addEventListener("input", autoResizeTextarea);

clearBtn.addEventListener("click", () => {
  if (isRequestPending) return; // Prevent clearing mid-request
  conversationHistory.length = 0;
  chatWindow.innerHTML = "";
  if (welcomeCard) chatWindow.appendChild(welcomeCard);
  welcomeCard.style.display = "block";
});

/* Quick actions */
document.querySelectorAll(".qa-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (isRequestPending) return;
    const prompt = btn.getAttribute("data-prompt");
    handleSend(prompt);
  });
});

/* API Key Logic */
apiSaveBtn.addEventListener("click", () => {
  const val = apiKeyInput.value.trim();
  if (val) {
    API_KEY = val;
    localStorage.setItem("placebot_api_key", val);
    apiStatusBadge.textContent = "Saved";
    apiStatusBadge.classList.add("saved");
    apiKeyInput.value = "";
  }
});

/* -- INIT ------------------------------------------------- */
function initChatBase() {
  const savedKey = localStorage.getItem("placebot_api_key");
  if (savedKey) {
    API_KEY = savedKey;
    apiStatusBadge.textContent = "Saved";
    apiStatusBadge.classList.add("saved");
  }
}

initChatBase();
