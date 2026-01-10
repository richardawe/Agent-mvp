// --- Config ---
const API_URL = "https://api.3d7tech.com/v1/chat/completions";
const API_KEY = ""; // Optional
const REQUEST_TIMEOUT = 20000; // 20 seconds for faster responses
const MAX_RETRIES = 1; // Reduced retries for faster failure

// --- APIs ---
const WEATHER_API_BASE = "https://api.open-meteo.com/v1/forecast";
const AQI_API_BASE = "https://api.waqi.info/feed";
const GEOCODING_API = "https://geocoding-api.open-meteo.com/v1/search";
const NEWS_API_BASE = "https://newsapi.org/v2/everything"; // For local events and news
const NEWS_API_KEY = "b174ddb738f748628853476781e9fcb8"; // Get free key from newsapi.org (optional - will use LLM fallback if not set)
// Note: NewsAPI free tier requires registration at https://newsapi.org/
// Without key, the app will use LLM to generate event suggestions based on city
const PLACES_API_BASE = "https://nominatim.openstreetmap.org/search"; // For specific venues

// --- State ---
let userLocation = {
  city: "Unknown",
  latitude: null,
  longitude: null,
  country: ""
};

let currentPlanState = {
  weather: null,
  aqi: null,
  preferences: {
    activityLevel: "moderate", // low, moderate, high
    indoorPreference: "flexible", // indoor, outdoor, flexible
    budget: "flexible", // free, low, flexible
    socialLevel: "moderate", // low, moderate, high
    focus: [], // array of focus areas like ["relaxation", "social", "productivity"]
    customInstructions: ""
  },
  allActivities: [],
  socialActivities: [],
  localEvents: [],
  clothingAdvice: null
};

// --- Generation Control State ---
let generationState = {
  isGenerating: false,
  isStopped: false,
  currentBlock: null,
  completedBlocks: [],
  abortController: null,
  cards: [] // Array to store card elements
};

// --- API Request Queue System ---
const apiQueue = {
  queue: [],
  processing: false,
  delayBetweenRequests: 1200, // 1.2 seconds between requests (respects 1 req/sec limit)
  activeRequests: 0,
  maxConcurrent: 1, // Process one at a time for Nominatim
  
  // Add request to queue
  async enqueue(requestFn, requestType = 'API', priority = false) {
    return new Promise((resolve, reject) => {
      const queueItem = {
        id: Date.now() + Math.random(),
        requestFn,
        requestType,
        priority,
        resolve,
        reject,
        status: 'queued',
        timestamp: Date.now()
      };
      
      if (priority) {
        this.queue.unshift(queueItem); // Add to front if priority
      } else {
        this.queue.push(queueItem); // Add to end
      }
      
      console.log(`📋 Request queued (${requestType}): Position ${this.getQueuePosition(queueItem.id)}`);
      this.updateQueueUI();
      this.processQueue();
      
      // Auto-reject after 60 seconds
      setTimeout(() => {
        if (queueItem.status === 'queued') {
          this.removeFromQueue(queueItem.id);
          reject(new Error('Request timeout: Queue took too long to process'));
        }
      }, 60000);
    });
  },
  
  // Get position in queue
  getQueuePosition(id) {
    const index = this.queue.findIndex(item => item.id === id);
    return index >= 0 ? index + 1 : 0;
  },
  
  // Process queue
  async processQueue() {
    if (this.processing || this.activeRequests >= this.maxConcurrent) {
      return;
    }
    
    if (this.queue.length === 0) {
      this.hideQueueUI();
      return;
    }
    
    this.processing = true;
    this.showQueueUI();
    
    // Process items one at a time
    const processNext = async () => {
      if (this.queue.length === 0) {
        this.processing = false;
        this.hideQueueUI();
        return;
      }
      
      const item = this.queue.shift();
      
      if (item.status !== 'queued') {
        processNext(); // Skip and process next
        return;
      }
      
      this.activeRequests++;
      item.status = 'processing';
      this.updateQueueUI();
      
      try {
        const queuedCount = this.queue.filter(i => i.status === 'queued').length;
        console.log(`⚙️ Processing ${item.requestType} request (${queuedCount} remaining in queue)`);
        
        // Add delay before request to respect rate limits (except for first request)
        if (this.activeRequests > 1 || this.queue.length > 0) {
          await new Promise(resolve => setTimeout(resolve, this.delayBetweenRequests));
        }
        
        const result = await item.requestFn();
        item.status = 'completed';
        item.resolve(result);
        
      } catch (error) {
        item.status = 'failed';
        console.log(`❌ Queue request failed (${item.requestType}):`, error.message);
        item.reject(error);
      } finally {
        this.activeRequests--;
        this.updateQueueUI();
        
        // Process next item after a small delay
        await new Promise(resolve => setTimeout(resolve, 300));
        processNext();
      }
    };
    
    processNext();
  },
  
  // Remove item from queue
  removeFromQueue(id) {
    const index = this.queue.findIndex(item => item.id === id);
    if (index >= 0) {
      this.queue.splice(index, 1);
      this.updateQueueUI();
    }
  },
  
  // Clear queue
  clear() {
    this.queue.forEach(item => {
      if (item.status === 'queued') {
        item.reject(new Error('Queue cleared'));
      }
    });
    this.queue = [];
    this.hideQueueUI();
  },
  
  // Update queue UI
  updateQueueUI() {
    const queueStatus = document.getElementById('queueStatus');
    const queueMessage = document.getElementById('queueMessage');
    const queuePosition = document.getElementById('queuePosition');
    const queueProgressFill = document.getElementById('queueProgressFill');
    
    if (!queueStatus) return;
    
    const queuedCount = this.queue.filter(item => item.status === 'queued').length;
    const processingCount = this.queue.filter(item => item.status === 'processing').length;
    
    if (queuedCount > 0 || processingCount > 0) {
      queueStatus.style.display = 'flex';
      
      if (processingCount > 0) {
        queueMessage.textContent = 'Processing your request... Please wait, we\'re handling high API demand.';
        queuePosition.textContent = `Processing... (${queuedCount} in queue)`;
        if (queueProgressFill) {
          queueProgressFill.style.width = '60%';
        }
      } else if (queuedCount > 0) {
        queueMessage.textContent = `Your request is queued. ${queuedCount} request${queuedCount > 1 ? 's' : ''} ahead of you. Processing will begin shortly.`;
        queuePosition.textContent = `Queue position: ${queuedCount} (estimated wait: ${queuedCount * 2}s)`;
        if (queueProgressFill) {
          queueProgressFill.style.width = '30%';
        }
      }
    }
  },
  
  // Show queue UI
  showQueueUI() {
    const queueStatus = document.getElementById('queueStatus');
    if (queueStatus) {
      queueStatus.style.display = 'flex';
    }
  },
  
  // Hide queue UI
  hideQueueUI() {
    const queueStatus = document.getElementById('queueStatus');
    if (queueStatus) {
      queueStatus.style.display = 'none';
    }
  }
};

// --- Card Management ---
const PLAN_BLOCKS = [
  { start: "06:00", end: "09:00", name: "Early Morning", id: 0 },
  { start: "09:00", end: "12:00", name: "Mid Morning", id: 1 },
  { start: "12:00", end: "15:00", name: "Afternoon", id: 2 },
  { start: "15:00", end: "18:00", name: "Late Afternoon", id: 3 },
  { start: "18:00", end: "21:00", name: "Evening", id: 4 }
];

function createPlanGrid() {
  const grid = document.getElementById("planGrid");
  if (!grid) return;

  grid.innerHTML = "";
  generationState.cards = [];

  PLAN_BLOCKS.forEach(block => {
    const card = document.createElement("div");
    card.className = "plan-card empty";
    card.id = `card-${block.id}`;
    card.dataset.blockId = block.id;

    card.innerHTML = `
      <div class="card-header">
        <div>
          <div class="card-title">${block.name}</div>
          <div class="card-time">${block.start} - ${block.end}</div>
        </div>
        <span class="card-status empty">Ready</span>
      </div>
      <div class="card-content">
        <div class="card-empty-state">Ready to plan...</div>
      </div>
    `;

    grid.appendChild(card);
    generationState.cards.push(card);
  });

  grid.style.display = "grid";
}

function getCardElement(blockId) {
  return document.getElementById(`card-${blockId}`) || generationState.cards[blockId];
}

function updateCardState(card, state) {
  if (!card) return;
  
  card.className = `plan-card ${state}`;
  const statusEl = card.querySelector(".card-status");
  if (statusEl) {
    statusEl.className = `card-status ${state}`;
    statusEl.textContent = state === "empty" ? "Ready" : 
                           state === "loading" ? "Generating..." : 
                           state === "complete" ? "✓ Complete" : 
                           state === "error" ? "⚠ Error" : "";
  }
}

// --- Streaming Text Animation (Optimized - immediate render) ---
async function streamTextToCard(card, text, speed = 5) {
  if (!card || !text) return;

  const contentEl = card.querySelector(".card-content");
  if (!contentEl) return;

  // Fast streaming - render immediately with minimal delay
  contentEl.innerHTML = '<div class="card-streaming">' + text + '</div>';
  
  // Remove streaming cursor quickly
  setTimeout(() => {
    const streamEl = contentEl.querySelector(".card-streaming");
    if (streamEl) {
      streamEl.classList.remove("card-streaming");
    }
  }, 100);
}

function renderActivityCard(card, activities) {
  if (!card || !activities || activities.length === 0) return;

  const contentEl = card.querySelector(".card-content");
  if (!contentEl) return;

  let html = '';
  activities.forEach(activity => {
    html += `
      <div class="card-activity-item">
        <div class="activity-time">⏰ ${activity.time || 'All Day'}</div>
        <div class="activity-name">${activity.activity || 'Activity'}</div>
        ${activity.meal ? `<div class="activity-meal">🍽️ ${activity.meal}</div>` : ''}
        ${activity.notes ? `<div class="activity-notes">💡 ${activity.notes}</div>` : ''}
      </div>
    `;
  });

  contentEl.innerHTML = html;
}

// --- Modal Management ---
function openModifyModal() {
  const modal = document.getElementById("modifyModal");
  if (!modal) return;

  // Update modal status info
  const locationEl = document.getElementById("modalLocation");
  const weatherEl = document.getElementById("modalWeather");
  
  if (locationEl && userLocation.city) {
    locationEl.textContent = `${userLocation.city}${userLocation.country ? `, ${userLocation.country}` : ''}`;
  }
  
  if (weatherEl && currentPlanState.weather) {
    const w = currentPlanState.weather;
    weatherEl.textContent = `${w.temperature}°C, ${w.precipitation}mm rain, ${w.windspeed}km/h wind`;
  }

  // Show/hide stop button based on generation state
  const stopBtn = document.getElementById("stopGeneration");
  if (stopBtn) {
    stopBtn.style.display = generationState.isGenerating ? "inline-flex" : "none";
  }

  // Reset modal options
  const modifyAll = document.getElementById("modifyAll");
  if (modifyAll) modifyAll.checked = true;
  
  const blockSelector = document.getElementById("blockSelector");
  const locationInput = document.getElementById("locationInput");
  if (blockSelector) blockSelector.style.display = "none";
  if (locationInput) locationInput.style.display = "none";

  // Enable/disable instruction input
  const inputEl = document.getElementById("instructionInput");
  if (inputEl) {
    inputEl.disabled = generationState.isGenerating;
    if (!generationState.isGenerating) {
      inputEl.focus();
    }
  }

  modal.style.display = "flex";
  document.body.style.overflow = "hidden";
}

function closeModifyModal() {
  const modal = document.getElementById("modifyModal");
  if (modal) {
    modal.style.display = "none";
    document.body.style.overflow = "";
  }
}

// --- Progress Indicator ---
function updateProgress(completed, total = 5) {
  const indicator = document.getElementById("progressIndicator");
  const fill = document.getElementById("progressFill");
  const count = document.getElementById("progressCount");

  if (indicator && fill && count) {
    const percentage = (completed / total) * 100;
    fill.style.width = `${percentage}%`;
    count.textContent = completed;
    
    if (completed > 0 && indicator.style.display === "none") {
      indicator.style.display = "block";
    }
    
    if (completed >= total) {
      setTimeout(() => {
        indicator.style.display = "none";
      }, 2000);
    }
  }
}

// --- Display Clothing Advice ---
function displayClothingAdvice(advice) {
  const card = document.getElementById("clothingCard");
  const content = document.getElementById("clothingContent");
  const container = document.getElementById("infoCards");
  
  if (card && content && container) {
    content.innerHTML = `<p style="line-height: 1.8;">${advice}</p>`;
    container.style.display = "grid";
  }
}

// --- Update Location Display ---
function updateLocationDisplay() {
  const locationDisplay = document.getElementById("locationDisplay");
  const locationText = document.getElementById("locationText");
  
  if (!locationDisplay || !locationText) {
    console.log("Location display elements not found");
    return;
  }
  
  // Always show the location display
  locationDisplay.style.display = "flex";
  
  // Update text based on whether location is available
  let locationStr = "Loading location...";
  
  if (userLocation && userLocation.city) {
    // Show the location - display whatever we have
    if (userLocation.city === "Unknown") {
      // If truly unknown, show default or coordinates
      if (userLocation.latitude && userLocation.longitude) {
        locationStr = `Location: ${userLocation.latitude.toFixed(2)}, ${userLocation.longitude.toFixed(2)}`;
      } else {
        locationStr = "Location: Default (London)";
      }
    } else if (userLocation.city.startsWith("Location (")) {
      // Already formatted with coordinates
      locationStr = userLocation.city;
    } else if (userLocation.city === "Your City") {
      // Show coordinates if available, otherwise show city name
      if (userLocation.latitude && userLocation.longitude) {
        locationStr = `Location: ${userLocation.latitude.toFixed(2)}, ${userLocation.longitude.toFixed(2)}`;
      } else {
        locationStr = userLocation.city;
      }
    } else {
      // Show the actual city name
      locationStr = `${userLocation.city}${userLocation.country ? `, ${userLocation.country}` : ''}`;
      
      // Add indicator if it's a default/fallback location
      if (userLocation.isDefault) {
        locationStr += " (Default)";
      } else if (userLocation.source === "ip") {
        locationStr += " (IP-based)";
      }
    }
    console.log("Location display updated:", locationStr, "from userLocation:", userLocation);
  }
  
  locationText.textContent = locationStr;
}

// --- Display Social Activities ---
function displaySocialActivities(activities) {
  const card = document.getElementById("socialCard");
  const content = document.getElementById("socialContent");
  const cityName = document.getElementById("socialCityName");
  const container = document.getElementById("infoCards");
  
  if (card && content && container) {
    if (cityName) {
      cityName.textContent = userLocation.city;
    }
    
    let html = '<ul>';
    activities.slice(0, 5).forEach((act, index) => {
      html += `
        <li>
          <strong>${index + 1}. ${act.activity}</strong><br>
          <span style="font-size: 0.9em;">📍 ${act.location}</span><br>
          <span style="font-size: 0.9em;">💰 ${act.cost} | ⏰ ${act.time}</span><br>
          <span style="font-size: 0.85em; color: var(--text-secondary);">${act.description}</span>
        </li>
      `;
    });
    html += '</ul>';
    
    content.innerHTML = html;
    container.style.display = "grid";
  }
}

// --- Display Local Events ---
function displayLocalEvents(events) {
  const card = document.getElementById("eventsCard");
  const content = document.getElementById("eventsContent");
  const cityName = document.getElementById("eventsCityName");
  const container = document.getElementById("infoCards");
  
  if (card && content && container) {
    if (cityName) {
      cityName.textContent = userLocation.city;
    }
    
    if (!events || events.length === 0) {
      content.innerHTML = '<p style="color: var(--text-secondary); font-style: italic;">No current events found. Check local event listings for today\'s activities.</p>';
      container.style.display = "grid";
      return;
    }
    
    let html = '<ul>';
    events.slice(0, 5).forEach((event, index) => {
      const date = event.publishedAt ? new Date(event.publishedAt).toLocaleDateString() : 'Today';
      html += `
        <li>
          <strong>${index + 1}. ${event.title}</strong><br>
          <span style="font-size: 0.85em; color: var(--text-secondary);">${event.description || ''}</span><br>
          <span style="font-size: 0.8em; color: var(--text-secondary); margin-top: 4px;">
            📅 ${date} | 📰 ${event.source}
            ${event.url ? ` | <a href="${event.url}" target="_blank" style="color: var(--primary); text-decoration: none;">Read more →</a>` : ''}
          </span>
        </li>
      `;
    });
    html += '</ul>';
    
    content.innerHTML = html;
    container.style.display = "grid";
  }
}

// --- Update blocks with social activities after generation ---
async function updateBlocksWithSocialActivities(socialActivities) {
  if (!socialActivities || socialActivities.length === 0) return;

  // Map social activities to time blocks based on their "time" property
  const activitiesByBlock = {
    0: [], // Early Morning (06:00-09:00)
    1: [], // Mid Morning (09:00-12:00)
    2: [], // Afternoon (12:00-15:00)
    3: [], // Late Afternoon (15:00-18:00)
    4: []  // Evening (18:00-21:00)
  };

  // Categorize social activities by time
  socialActivities.forEach(act => {
    const time = act.time?.toLowerCase() || "";
    if (time.includes("morning") || time.includes("early")) {
      activitiesByBlock[0].push(act);
      activitiesByBlock[1].push(act);
    } else if (time.includes("afternoon")) {
      activitiesByBlock[2].push(act);
      activitiesByBlock[3].push(act);
    } else if (time.includes("evening") || time.includes("night")) {
      activitiesByBlock[4].push(act);
    } else {
      // Default: distribute evenly across blocks
      activitiesByBlock[2].push(act); // Afternoon
      activitiesByBlock[4].push(act); // Evening
    }
  });

  // Update each block card with social activity suggestions
  PLAN_BLOCKS.forEach((block, index) => {
    const card = getCardElement(block.id);
    if (!card) return;

    const relevantSocialActivities = activitiesByBlock[index].slice(0, 2); // Max 2 per block
    if (relevantSocialActivities.length === 0) return;

    const contentEl = card.querySelector(".card-content");
    if (!contentEl) return;

    // Check if social activities section already exists
    if (contentEl.querySelector(".social-activities-section")) {
      // Remove existing social activities section
      const existingSection = contentEl.querySelector(".social-activities-section");
      existingSection.remove();
    }

    // Get existing activities HTML (without any existing social section)
    let existingHTML = contentEl.innerHTML;

    // Add social activities section
    let socialHTML = '<div class="social-activities-section" style="margin-top: 16px; padding-top: 16px; border-top: 2px dashed var(--border);">';
    socialHTML += '<div style="font-weight: 600; color: #9C27B0; margin-bottom: 8px; font-size: 0.9em;">🎭 Social Activity Options:</div>';
    
    relevantSocialActivities.forEach((act, idx) => {
      socialHTML += `
        <div style="margin-bottom: 10px; padding: 8px; background: rgba(156,39,176,0.05); border-radius: 6px; border-left: 3px solid #9C27B0;">
          <div style="font-weight: 500; font-size: 0.9em; color: #9C27B0;">${act.activity}</div>
          <div style="font-size: 0.85em; color: var(--text-secondary); margin-top: 4px;">📍 ${act.location}</div>
          <div style="font-size: 0.85em; color: var(--text-secondary);">💰 ${act.cost} | ⏰ ${act.time}</div>
          ${act.description ? `<div style="font-size: 0.8em; color: var(--text-secondary); margin-top: 4px; font-style: italic;">${act.description}</div>` : ''}
        </div>
      `;
    });
    
    socialHTML += '</div>';

    // Append social activities to existing content
    contentEl.innerHTML = existingHTML + socialHTML;
  });
}

// --- Stop Generation ---
function stopGeneration() {
  if (!generationState.isGenerating) return;

  generationState.isStopped = true;
  generationState.isGenerating = false;

  // Abort current fetch request
  if (generationState.abortController) {
    generationState.abortController.abort();
    generationState.abortController = null;
  }

  // Update current card if loading
  if (generationState.currentBlock !== null) {
    const card = getCardElement(generationState.currentBlock);
    if (card) {
      const statusEl = card.querySelector(".card-status");
      if (statusEl && statusEl.textContent === "Generating...") {
        updateCardState(card, "empty");
        const contentEl = card.querySelector(".card-content");
        if (contentEl) {
          contentEl.innerHTML = '<div class="card-empty-state">Generation stopped</div>';
        }
      }
    }
  }

  // Update modal
  const stopBtn = document.getElementById("stopGeneration");
  const inputEl = document.getElementById("instructionInput");
  
  if (stopBtn) stopBtn.style.display = "none";
  if (inputEl) inputEl.disabled = false;
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

// --- Get user's location (silent) ---
async function getUserLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      console.log("Geolocation API not supported in this browser. Using default location.");
      resolve({ city: "London", latitude: 51.5074, longitude: -0.1278, country: "UK", isDefault: true });
      return;
    }
    
    console.log("Requesting user location...");
    
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        
        // Reverse geocode to get city name (silent)
        // Retry up to 2 times with delays to handle rate limiting
        let lastError = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            console.log(`🔍 Reverse geocoding coordinates (attempt ${attempt}/2): ${lat}, ${lon}`);
            
            // Add delay to respect Nominatim rate limits (1 request per second)
            if (attempt > 1) {
              await new Promise(resolve => setTimeout(resolve, 2000));
            } else {
              await new Promise(resolve => setTimeout(resolve, 1100));
            }
            
            // Use queue for reverse geocoding to handle rate limits
            const response = await apiQueue.enqueue(async () => {
              return await fetchWithTimeout(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1&zoom=10`,
                {
                  headers: {
                    'User-Agent': 'DailyPlannerApp/1.0',
                    'Accept-Language': 'en'
                  }
                },
                15000
              );
            }, 'Reverse Geocoding', false);
            
            console.log(`📍 Reverse geocoding response status: ${response.status}`);
            
            if (response.ok) {
              const data = await response.json();
              console.log("📍 Reverse geocoding raw data:", data);
              
              // Try multiple fields to get city name with better fallback
              const address = data.address || {};
              let city = address.city || 
                        address.town || 
                        address.village || 
                        address.municipality || 
                        address.county ||
                        address.state_district ||
                        address.state ||
                        address.region ||
                        null;
              
              // If no city found in address fields, try to extract from display_name
              if (!city && data.display_name) {
                const parts = data.display_name.split(',');
                // Usually city/town is in the first few parts (skip road names, etc.)
                city = parts.find(part => {
                  const trimmed = part.trim();
                  return trimmed && 
                         !trimmed.includes('+') && 
                         !trimmed.match(/^\d+$/) && // Not just a number
                         !trimmed.match(/^[A-Z]{1,3}\d+[A-Z]?\s*\d+[A-Z]{2}$/i) && // Not a postcode
                         trimmed.length > 2; // Has meaningful length
                })?.trim() || parts[1]?.trim() || parts[0]?.trim() || null;
              }
              
              // Last resort: use coordinates formatted nicely
              if (!city || city === "Unknown") {
                console.log("⚠️ Could not extract city name, using coordinates");
                city = `Location (${lat.toFixed(2)}, ${lon.toFixed(2)})`;
              }
              
              const country = address.country || address["country_code"]?.toUpperCase() || "";
              
              console.log("✅ Reverse geocoded location:", { city, country, lat, lon, addressKeys: Object.keys(address), fullAddress: address });
              resolve({ city, latitude: lat, longitude: lon, country });
              return; // Success, exit retry loop
            } else {
              const errorText = await response.text().catch(() => 'Unknown error');
              console.log(`❌ Reverse geocoding HTTP error ${response.status}:`, errorText);
              lastError = new Error(`Geocoding HTTP error: ${response.status}`);
              if (attempt === 2) throw lastError; // Only throw on last attempt
            }
          } catch (error) {
            console.log(`❌ Geocoding attempt ${attempt} failed: ${error.message}`);
            lastError = error;
            if (attempt === 2) {
              // Last attempt failed
              console.log(`❌ All geocoding attempts failed: ${error.message}`, error);
              console.log(`📍 Using coordinates as fallback: ${lat.toFixed(2)}, ${lon.toFixed(2)}`);
              // Use coordinates as city identifier so we always have something to display
              resolve({ city: `Location (${lat.toFixed(2)}, ${lon.toFixed(2)})`, latitude: lat, longitude: lon, country: "" });
            }
          }
        }
      },
      async (error) => {
        console.log("Geolocation error:", error.code, error.message);
        
        // Handle different error codes
        let errorMsg = "Location access denied";
        if (error.code === 1) {
          errorMsg = "Location permission denied. Please allow location access in your browser settings.";
        } else if (error.code === 2) {
          errorMsg = "Location unavailable. Trying IP-based location...";
        } else if (error.code === 3) {
          errorMsg = "Location request timeout. Trying IP-based location...";
        }
        
        console.log(errorMsg);
        
        // Try IP-based location as fallback (more reliable than hardcoded default)
        try {
          console.log("Attempting IP-based location detection...");
          const ipResponse = await fetchWithTimeout(
            "https://ipapi.co/json/",
            {
              headers: {
                'User-Agent': 'DailyPlannerApp/1.0'
              }
            },
            8000
          );
          
          if (ipResponse.ok) {
            const ipData = await ipResponse.json();
            
            // Check if we got a valid response
            if (ipData.city || ipData.latitude) {
              const city = ipData.city || ipData.region || "Unknown";
              const country = ipData.country_name || ipData.country || "";
              const lat = ipData.latitude || 51.5074;
              const lon = ipData.longitude || -0.1278;
              
              console.log("✅ IP-based location detected:", { city, country, lat, lon });
              resolve({ city, latitude: lat, longitude: lon, country, isDefault: false, source: "ip" });
              return;
            } else {
              console.log("IP-based location returned invalid data:", ipData);
            }
          } else {
            console.log("IP-based location API returned error:", ipResponse.status);
          }
        } catch (ipError) {
          console.log("❌ IP-based location failed:", ipError.message);
        }
        
        // Last resort: use default
        console.log("Falling back to default location: London, UK");
        resolve({ city: "London", latitude: 51.5074, longitude: -0.1278, country: "UK", isDefault: true, source: "default" });
      },
      {
        enableHighAccuracy: false,
        timeout: 15000, // Increased timeout to 15 seconds
        maximumAge: 0 // Always get fresh location (don't use cached)
      }
    );
  });
}

// --- Fetch weather ---
async function fetchWeather(lat, lon) {
  try {
    const url = `${WEATHER_API_BASE}?latitude=${lat}&longitude=${lon}&current_weather=true&daily=sunrise,sunset`;
    const res = await fetchWithTimeout(url, {}, 10000);
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
    console.log("Weather fetch failed, using defaults");
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
async function fetchAQI(city) {
  try {
    const url = `${AQI_API_BASE}/${encodeURIComponent(city)}/?token=demo`;
    const res = await fetchWithTimeout(url, {}, 10000);
    if (!res.ok) throw new Error(`AQI API error: ${res.status}`);
    const data = await res.json();
    return data.data?.aqi || null;
  } catch (error) {
    console.log("AQI unavailable, assuming safe conditions");
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

// --- Call local LLM with retry and abort support ---
async function callLLM(prompt, cardElement = null, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Check if stopped before making request
      if (generationState.isStopped) {
        throw new Error("Generation stopped by user");
      }

      // Create new abort controller for this request
      const abortController = new AbortController();
      generationState.abortController = abortController;
      
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
        }),
        signal: abortController.signal
      });

      if (!res.ok) throw new Error(`LLM API error: ${res.status}`);
      
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      
      if (!content) throw new Error("Empty response from LLM");

      // Clean up response
      let cleanContent = content.trim();
      cleanContent = cleanContent.replace(/```json\n?|\n?```|```\n?/g, '');
      cleanContent = cleanContent.replace(/^[^[\{]*/, '').replace(/[^}\]]*$/, '');
      
      // Try to parse JSON with better error handling
      let result;
      try {
        result = JSON.parse(cleanContent);
      } catch (parseError) {
        console.log("❌ JSON parse error:", parseError.message);
        console.log("Raw content (first 500 chars):", content.substring(0, 500));
        // Try to extract JSON array more aggressively
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          try {
            result = JSON.parse(jsonMatch[0]);
            console.log("✅ Recovered JSON from content");
          } catch (e2) {
            console.log("❌ Second parse attempt failed:", e2.message);
            throw new Error("Invalid JSON response from LLM: " + parseError.message);
          }
        } else {
          throw new Error("No valid JSON array found in LLM response");
        }
      }
      
      // Clear abort controller on success
      generationState.abortController = null;
      
      return result;
    } catch (error) {
      // Check if it's an abort error
      if (error.name === 'AbortError' || generationState.isStopped) {
        throw new Error("Generation stopped by user");
      }

      if (cardElement && attempt < retries) {
        updateCardState(cardElement, "loading");
        const contentEl = cardElement.querySelector(".card-content");
        if (contentEl) {
          contentEl.innerHTML = `<div class="card-empty-state">Retrying... (attempt ${attempt}/${retries})</div>`;
        }
      }

      if (attempt === retries) {
        if (cardElement) {
          updateCardState(cardElement, "error");
          const contentEl = cardElement.querySelector(".card-content");
          if (contentEl) {
            contentEl.innerHTML = `<div class="card-empty-state" style="color: var(--danger);">Failed to generate: ${error.message}</div>`;
          }
        }
        return null;
      }
      
      // Faster retry delay
      await new Promise(resolve => setTimeout(resolve, 500 * attempt));
    }
  }
}

// --- Get specific venues and places in city ---
async function getSpecificVenues(city, country = "") {
  try {
    // Check if city is coordinates (lat,lon format)
    let useNearbySearch = false;
    let lat = null;
    let lon = null;
    
    if (city.includes(',') && !isNaN(parseFloat(city.split(',')[0]))) {
      const parts = city.split(',');
      lat = parseFloat(parts[0].trim());
      lon = parseFloat(parts[1].trim());
      if (!isNaN(lat) && !isNaN(lon)) {
        useNearbySearch = true;
        console.log(`📍 Using nearby search for coordinates: ${lat}, ${lon}`);
      }
    }
    
    const query = useNearbySearch ? '' : `${city}${country ? `, ${country}` : ''}`;
    const categories = [
      { query: useNearbySearch ? 'museums' : `museums ${query}`, type: 'museum' },
      { query: useNearbySearch ? 'parks' : `parks ${query}`, type: 'park' },
      { query: useNearbySearch ? 'restaurants' : `restaurants ${query}`, type: 'restaurant' },
      { query: useNearbySearch ? 'cafes' : `cafes ${query}`, type: 'cafe' },
      { query: useNearbySearch ? 'theaters' : `theaters ${query}`, type: 'theater' },
      { query: useNearbySearch ? 'galleries' : `galleries ${query}`, type: 'gallery' }
    ];

    const venues = [];
    
    // Fetch venues in parallel (limited to avoid rate limits)
    const venuePromises = categories.slice(0, 4).map(async (cat) => {
      try {
        let apiUrl;
        if (useNearbySearch && lat && lon) {
          // Use nearby search with coordinates - search within 5km radius
          apiUrl = `${PLACES_API_BASE}?q=${encodeURIComponent(cat.query)}&format=json&limit=3&addressdetails=1&lat=${lat}&lon=${lon}&radius=5000`;
        } else {
          // Use regular search with city name
          apiUrl = `${PLACES_API_BASE}?q=${encodeURIComponent(cat.query)}&format=json&limit=2&addressdetails=1`;
        }
        
        // Use queue for venue search to handle rate limits
        const response = await apiQueue.enqueue(async () => {
          return await fetchWithTimeout(
            apiUrl,
            {
              headers: {
                'User-Agent': 'DailyPlannerApp/1.0'
              }
            },
            8000
          );
        }, `Venue Search (${cat.type})`, false);
        
        if (response.ok) {
          const data = await response.json();
          if (data && data.length > 0) {
            console.log(`✅ Found ${data.length} ${cat.type} venues for ${city}`);
            return data.map(place => {
              // Better name extraction - get the actual venue name (usually first part before comma)
              const displayParts = place.display_name.split(',');
              const name = displayParts[0].trim();
              
              return {
                name: name,
                fullName: place.display_name,
                type: cat.type,
                address: place.address || {}
              };
            });
          } else {
            console.log(`⚠️ No ${cat.type} venues found for ${city}`);
          }
        } else {
          console.log(`⚠️ API error for ${cat.type} venues:`, response.status);
        }
      } catch (e) {
        console.log(`Failed to fetch ${cat.type} venues:`, e);
      }
      return [];
    });

    const results = await Promise.all(venuePromises);
    results.forEach(venueList => {
      venues.push(...venueList);
    });

    const uniqueVenues = venues.slice(0, 12); // Limit to 12 venues
    console.log(`✅ Total venues found for ${city}:`, uniqueVenues.length);
    uniqueVenues.forEach(v => console.log(`  - ${v.name} (${v.type})`));
    
    return uniqueVenues;
  } catch (error) {
    console.log("❌ Error fetching venues:", error);
    return [];
  }
}

// --- Get local events and news ---
async function getLocalEvents(city, country = "") {
  try {
    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    // Try multiple query variations for better results
    const queries = [
      `${city} events`,
      `${city} activities`,
      `${city} ${country ? country : ''} events`
    ];
    
    // Try NewsAPI if key is available
    if (NEWS_API_KEY && NEWS_API_KEY.trim() !== "") {
      for (const query of queries) {
        try {
          // NewsAPI uses apiKey as query parameter, not header
          // Use date range (weekAgo to today) for better results
          const response = await fetchWithTimeout(
            `${NEWS_API_BASE}?q=${encodeURIComponent(query)}&language=en&sortBy=relevancy&pageSize=5&from=${weekAgo}&to=${today}&apiKey=${NEWS_API_KEY}`,
            {
              headers: {
                'User-Agent': 'DailyPlannerApp/1.0'
              }
            },
            5000
          );
          
          if (response.ok) {
            const data = await response.json();
            
            // Check for API errors
            if (data.status === 'error') {
              console.log("NewsAPI error:", data.message || data.code);
              continue; // Try next query
            }
            
            if (data.status === 'ok' && data.articles && data.articles.length > 0) {
              console.log(`✅ NewsAPI found ${data.articles.length} articles for ${city}`);
              return data.articles.map(article => ({
                title: article.title,
                description: article.description || article.content?.substring(0, 150) || '',
                url: article.url,
                source: article.source?.name || 'Local News',
                publishedAt: article.publishedAt
              }));
            }
          } else {
            const errorData = await response.json().catch(() => ({}));
            console.log("NewsAPI HTTP error:", response.status, errorData.message || '');
          }
        } catch (e) {
          console.log("NewsAPI request failed:", e.message);
          // Continue to next query or fallback
        }
      }
    }
    
    // Fallback: Use LLM to generate event suggestions based on city
    const prompt = `Find 3-5 current events, activities, or happenings in ${city}${country ? `, ${country}` : ''} today or this week.

Include:
- Local festivals, concerts, or cultural events
- Community gatherings or meetups
- Special exhibitions or shows
- Sports events or competitions
- Markets or fairs

Return ONLY a JSON array:
[
  {
    "title": "Event name",
    "description": "Brief description (1-2 sentences)",
    "source": "Event type (Festival/Concert/Market/etc)",
    "url": null
  }
]`;

    const result = await callLLM(prompt, null, 1);
    return result || [];
  } catch (error) {
    console.log("Error fetching local events:", error);
    return [];
  }
}

// --- Get social activities for the city with specific venues ---
async function getSocialActivities(city, weather, aqi, preferences = null) {
  let outdoorSafe = (aqi === null || aqi < 100) && weather.precipitation < 3;
  if (preferences?.indoorPreference === 'indoor') {
    outdoorSafe = false;
  }
  const temp = weather.temperature;
  
  // If city is in coordinate format, try to get actual city name from coordinates
  let actualCity = city;
  let searchQuery = city;
  
  if (city.startsWith("Location (")) {
    // Extract coordinates from "Location (lat, lon)" format
    const coordMatch = city.match(/Location \(([\d.]+),\s*([\d.-]+)\)/);
    if (coordMatch && userLocation.latitude && userLocation.longitude) {
      const lat = userLocation.latitude;
      const lon = userLocation.longitude;
      
      console.log(`📍 City is coordinates, trying reverse geocoding for ${lat}, ${lon}...`);
      
      // Try reverse geocoding to get city name (use queue)
      try {
        const response = await apiQueue.enqueue(async () => {
          return await fetchWithTimeout(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1&zoom=10`,
            {
              headers: {
                'User-Agent': 'DailyPlannerApp/1.0',
                'Accept-Language': 'en'
              }
            },
            15000
          );
        }, 'Reverse Geocoding (Location Fix)', false);
        
        if (response.ok) {
          const data = await response.json();
          const address = data.address || {};
          actualCity = address.city || address.town || address.village || address.municipality || address.county || city;
          searchQuery = actualCity;
          console.log(`✅ Reverse geocoded to: ${actualCity}`);
        }
      } catch (e) {
        console.log(`⚠️ Reverse geocoding failed, using coordinates for venue search:`, e.message);
        // Use coordinates-based search
        searchQuery = `${lat},${lon}`;
      }
    }
  }
  
  // Fetch specific venues in parallel
  console.log(`🔍 Fetching venues for ${searchQuery}...`);
  const venuesPromise = getSpecificVenues(searchQuery, userLocation.country);
  const eventsPromise = getLocalEvents(actualCity, userLocation.country);
  
  const [venues, events] = await Promise.all([venuesPromise, eventsPromise]);
  
  console.log(`📍 Found ${venues?.length || 0} venues for ${actualCity}:`, venues);
  console.log(`📰 Found ${events?.length || 0} events for ${actualCity}`);
  
  // Build venue context for LLM
  let venueContext = "";
  if (venues && venues.length > 0) {
    venueContext = `\n\n=== SPECIFIC VENUES IN ${actualCity.toUpperCase()} (YOU MUST USE THESE) ===\n`;
    venues.forEach((venue, idx) => {
      const address = venue.address?.road || venue.address?.suburb || venue.address?.city || 'City center';
      venueContext += `${idx + 1}. ${venue.name} (${venue.type}) - ${address}\n`;
    });
    venueContext += `\n⚠️ CRITICAL: You MUST use the EXACT venue names from the list above. Do NOT use generic terms like "local cafes" or "popular restaurants". Use the specific names provided.\n`;
  } else {
    console.log(`⚠️ No venues found for ${actualCity}, will use generic suggestions`);
  }
  
  // Build events context
  let eventsContext = "";
  if (events && events.length > 0) {
    eventsContext = `\n\nCURRENT EVENTS IN ${actualCity.toUpperCase()}:\n`;
    events.slice(0, 3).forEach((event, idx) => {
      eventsContext += `${idx + 1}. ${event.title} - ${event.description?.substring(0, 100) || ''}\n`;
    });
    eventsContext += `\nConsider these events when suggesting activities.\n`;
  }
  
  let preferenceText = "";
  if (preferences) {
    if (preferences.budget === 'free') preferenceText += "\nCRITICAL: Suggest only FREE activities.\n";
    if (preferences.socialLevel === 'high') preferenceText += "\nFocus on highly social activities with interaction opportunities.\n";
  }
  
  // Build a stronger prompt that forces specific venues
  const venueExamples = venues && venues.length > 0 
    ? venues.slice(0, 5).map(v => `- ${v.name} (${v.type})`).join('\n')
    : '';
  
  const prompt = `You are a local activity expert for ${actualCity}. Suggest 5 interesting social activities someone can do in ${actualCity} today.

Current conditions:
- Weather: ${temp}°C, ${weather.precipitation}mm rain
- ${outdoorSafe ? 'Good conditions for outdoor activities' : 'Better suited for indoor activities'}${preferenceText}${venueContext}${eventsContext}

🚫 FORBIDDEN: Do NOT use generic terms like:
- "Popular cafes in ${city} city center"
- "Local museums in ${city}"
- "Community centers or event spaces"
- "Popular dining areas"
- "Gyms or sports centers"

✅ REQUIRED: Use SPECIFIC, REAL venue names${venues && venues.length > 0 ? ' from the list above' : ''}. Examples of good venue names:
${venueExamples || `- Research actual venues in ${city} like "The Herbert Art Gallery", "Coventry Transport Museum", etc.`}

⚠️ MANDATORY REQUIREMENTS:
1. ${venues && venues.length > 0 ? `You MUST use venue names from this list: ${venues.map(v => v.name).join(', ')}. Use the EXACT names provided.` : `Research and use REAL, SPECIFIC venue names in ${city}. Look up actual places.`}
2. Include the EXACT venue name and street address or neighborhood
3. ${events && events.length > 0 ? 'Reference the current events listed above if relevant.' : 'Consider current local events.'}
4. Provide a mix of free and paid activities${preferences?.budget === 'free' ? ' (PREFER FREE)' : ''}
5. Indoor and outdoor options (weather: ${outdoorSafe ? 'outdoor OK' : 'indoor preferred'})
6. Activities for different times of day

EXAMPLE OF CORRECT FORMAT:
{
  "activity": "Visit Herbert Art Gallery & Museum",
  "location": "Herbert Art Gallery & Museum, Jordan Well, CV1 5QP",
  "cost": "Free",
  "time": "Afternoon",
  "description": "Explore the extensive collection of local history and art at this renowned museum."
}

Return ONLY a valid JSON array (no markdown, no code blocks, no extra text):
[
  {
    "activity": "Specific activity with REAL venue name",
    "location": "EXACT venue name and address in ${actualCity}",
    "cost": "Free" or "£X-Y",
    "time": "Morning/Afternoon/Evening",
    "description": "1-2 sentences mentioning the specific venue"
  }
]`;

  console.log("📝 Calling LLM for social activities with prompt length:", prompt.length);
  const result = await callLLM(prompt, null, 2);
  console.log("✅ LLM returned social activities:", result);
  
  // Validate and enhance result
  if (!result || !Array.isArray(result) || result.length === 0) {
    console.log("❌ LLM returned invalid/empty result");
    
    // If we have venues, create activities from them instead of generic fallback
    if (venues && venues.length > 0) {
      console.log("✅ Creating activities from fetched venues...");
      return createActivitiesFromVenues(venues, city, outdoorSafe, preferences);
    }
    
    console.log("⚠️ No venues available, using generic fallback");
    return getFallbackSocialActivities(city, outdoorSafe);
  }
  
  // Enhance result with venue data if available
  if (venues && venues.length > 0) {
    result.forEach((activity, idx) => {
      // Try to match activity with a venue by name or type
      const matchedVenue = venues.find(v => {
        const activityLower = (activity.location || activity.activity || "").toLowerCase();
        const venueNameLower = v.name.toLowerCase();
        const venueTypeLower = v.type.toLowerCase();
        return activityLower.includes(venueNameLower) || 
               activityLower.includes(venueTypeLower) ||
               activity.activity?.toLowerCase().includes(venueTypeLower);
      });
      
      if (matchedVenue) {
        const address = matchedVenue.address?.road || matchedVenue.address?.suburb || matchedVenue.address?.city || city;
        activity.location = `${matchedVenue.name}, ${address}`;
        activity.venueType = matchedVenue.type;
        console.log(`✅ Matched activity "${activity.activity}" with venue "${matchedVenue.name}"`);
      } else {
        console.log(`⚠️ Could not match activity "${activity.activity}" with any venue`);
      }
    });
  }
  
  console.log("✅ Returning social activities:", result);
  return result;
}

// --- Create activities from fetched venues ---
function createActivitiesFromVenues(venues, city, outdoorSafe, preferences = null) {
  const activities = [];
  const timeSlots = ["Morning", "Afternoon", "Evening"];
  const usedTypes = new Set();
  
  // Map venue types to activity descriptions
  const typeDescriptions = {
    'cafe': {
      activity: 'Visit',
      description: 'Enjoy coffee and conversation at this local favorite.',
      cost: '£3-8',
      time: 'Morning/Afternoon'
    },
    'restaurant': {
      activity: 'Dine at',
      description: 'Try local cuisine and enjoy a meal with friends or family.',
      cost: '£15-40',
      time: 'Evening'
    },
    'museum': {
      activity: 'Visit',
      description: 'Explore local history, culture, and art at this museum.',
      cost: 'Free',
      time: 'Afternoon'
    },
    'gallery': {
      activity: 'Explore',
      description: 'Discover local art and exhibitions at this gallery.',
      cost: 'Free',
      time: 'Afternoon'
    },
    'park': {
      activity: 'Walk in',
      description: 'Enjoy nature and fresh air while catching up with friends.',
      cost: 'Free',
      time: outdoorSafe ? 'Afternoon' : 'Morning'
    },
    'theater': {
      activity: 'See a show at',
      description: 'Enjoy live performances and entertainment.',
      cost: '£10-30',
      time: 'Evening'
    }
  };
  
  // Create activities from venues (max 5)
  venues.slice(0, 5).forEach((venue, idx) => {
    const typeInfo = typeDescriptions[venue.type] || {
      activity: 'Visit',
      description: `Explore this ${venue.type} in ${city}.`,
      cost: 'Free-£20',
      time: timeSlots[idx % timeSlots.length]
    };
    
    const address = venue.address?.road || venue.address?.suburb || venue.address?.city || city;
    
    activities.push({
      activity: `${typeInfo.activity} ${venue.name}`,
      location: `${venue.name}, ${address}`,
      cost: typeInfo.cost,
      time: typeInfo.time,
      description: typeInfo.description
    });
    
    usedTypes.add(venue.type);
  });
  
  // Fill remaining slots if we have less than 5
  if (activities.length < 5) {
    const fallback = getFallbackSocialActivities(city, outdoorSafe);
    const needed = 5 - activities.length;
    
    // Add fallback activities that don't duplicate venue types
    fallback.forEach(activity => {
      if (activities.length < 5) {
        // Check if this activity type is already covered
        const activityType = activity.activity.toLowerCase();
        const isDuplicate = Array.from(usedTypes).some(type => 
          activityType.includes(type)
        );
        
        if (!isDuplicate) {
          activities.push(activity);
        }
      }
    });
  }
  
  console.log(`✅ Created ${activities.length} activities from venues`);
  return activities.slice(0, 5);
}

// --- Fallback social activities ---
function getFallbackSocialActivities(city, outdoorSafe) {
  const activities = [
    {
      activity: "Visit Local Coffee Shop",
      location: `Popular cafes in ${city} city center`,
      cost: "£3-8",
      time: "Morning/Afternoon",
      description: "Meet friends for coffee and conversation. Great for casual socializing and people-watching."
    },
    {
      activity: outdoorSafe ? "Walk in City Park" : "Visit Museum or Gallery",
      location: outdoorSafe ? `Main park in ${city}` : `Local museums in ${city}`,
      cost: "Free",
      time: "Afternoon",
      description: outdoorSafe ? "Enjoy nature and fresh air while catching up with friends." : "Explore local culture and art with interesting exhibitions."
    },
    {
      activity: "Join Community Event or Meetup",
      location: `Community centers or event spaces in ${city}`,
      cost: "Free-£10",
      time: "Evening",
      description: "Check Meetup.com or Eventbrite for local gatherings based on your interests."
    },
    {
      activity: "Dine at Local Restaurant",
      location: `Popular dining areas in ${city}`,
      cost: "£15-40",
      time: "Evening",
      description: "Try local cuisine or explore new restaurants with friends or family."
    },
    {
      activity: outdoorSafe ? "Outdoor Sports or Fitness Class" : "Indoor Sports or Gym Session",
      location: outdoorSafe ? `Parks or sports fields in ${city}` : `Gyms or sports centers in ${city}`,
      cost: "Free-£15",
      time: "Morning/Afternoon",
      description: "Stay active while meeting people with similar fitness interests."
    }
  ];
  
  return activities;
}

// --- Format social activities ---
function formatSocialActivities(activities) {
  let html = `
<div style="border: 2px solid #9C27B0; padding: 14px; margin: 20px 0; background: linear-gradient(to right, rgba(156,39,176,0.15), transparent); border-radius: 6px;">
  <div style="font-size: 1.2em; font-weight: bold; color: #9C27B0; margin-bottom: 12px;">🎭 SOCIAL ACTIVITIES IN ${userLocation.city.toUpperCase()}</div>
  <div style="color: #666; margin-bottom: 10px; font-style: italic;">Here are some great ways to socialize and explore your city today:</div>
`;

  activities.forEach((act, index) => {
    html += `
  <div style="margin: 10px 0; padding: 10px; background: rgba(255,255,255,0.7); border-radius: 4px; border-left: 3px solid #9C27B0;">
    <div style="font-weight: bold; color: #9C27B0; margin-bottom: 4px;">${index + 1}. ${act.activity}</div>
    <div style="margin: 3px 0; font-size: 0.95em;"><strong>📍 Location:</strong> ${act.location}</div>
    <div style="margin: 3px 0; font-size: 0.95em;"><strong>💰 Cost:</strong> ${act.cost} | <strong>⏰ Best Time:</strong> ${act.time}</div>
    <div style="margin: 6px 0; font-size: 0.9em; color: #555;">${act.description}</div>
  </div>
`;
  });

  html += `</div>`;
  return html;
}

// --- Parse user instruction to extract parameters ---
async function parseInstruction(instruction) {
  const prompt = `Parse this user instruction about modifying a daily plan and extract parameters.

User Instruction: "${instruction}"

Extract and return ONLY a JSON object with these fields (use null if not specified):
{
  "activityLevel": "low" | "moderate" | "high" | null,
  "indoorPreference": "indoor" | "outdoor" | "flexible" | null,
  "budget": "free" | "low" | "flexible" | null,
  "socialLevel": "low" | "moderate" | "high" | null,
  "focus": ["relaxation" | "social" | "productivity" | "fitness" | "creative" | "learning" | "entertainment"] or null,
  "customInstructions": "Any specific requirements or modifications in the user's words" or null
}

Examples:
- "Make it more active" → {"activityLevel": "high", ...}
- "Focus on indoor activities" → {"indoorPreference": "indoor", ...}
- "Budget-friendly activities" → {"budget": "free", ...}
- "More social evening" → {"socialLevel": "high", "focus": ["social"], ...}
- "Add relaxation time" → {"focus": ["relaxation"], ...}

Return ONLY the JSON object, no markdown, no explanation.`;

  const result = await callLLM(prompt, null, 2);
  
  if (result && typeof result === 'object') {
    // Merge with existing preferences, only updating specified fields
    return {
      activityLevel: result.activityLevel || currentPlanState.preferences.activityLevel,
      indoorPreference: result.indoorPreference || currentPlanState.preferences.indoorPreference,
      budget: result.budget || currentPlanState.preferences.budget,
      socialLevel: result.socialLevel || currentPlanState.preferences.socialLevel,
      focus: result.focus || currentPlanState.preferences.focus,
      customInstructions: result.customInstructions || instruction
    };
  }
  
  // Fallback: try to infer from keywords
  const lower = instruction.toLowerCase();
  const preferences = { ...currentPlanState.preferences };
  
  if (lower.includes('active') || lower.includes('energetic')) {
    preferences.activityLevel = 'high';
  } else if (lower.includes('relax') || lower.includes('calm')) {
    preferences.activityLevel = 'low';
  }
  
  if (lower.includes('indoor')) {
    preferences.indoorPreference = 'indoor';
  } else if (lower.includes('outdoor')) {
    preferences.indoorPreference = 'outdoor';
  }
  
  if (lower.includes('free') || lower.includes('budget') || lower.includes('cheap')) {
    preferences.budget = 'free';
  }
  
  if (lower.includes('social')) {
    preferences.socialLevel = 'high';
  }
  
  if (lower.includes('relax')) {
    preferences.focus = [...(preferences.focus || []), 'relaxation'];
  }
  
  preferences.customInstructions = instruction;
  return preferences;
}

// --- Enhanced prompt for better results with city-specific details ---
function buildPrompt(weather, aqi, block, previousActivities = [], city = "your city", preferences = null, socialActivities = []) {
  const hour = parseInt(block.start.split(':')[0]);
  const timeOfDay = hour < 9 ? "early morning" : hour < 12 ? "mid-morning" : hour < 15 ? "afternoon" : hour < 18 ? "late afternoon" : "evening";
  
  // Determine outdoor preference based on user preference and weather
  let outdoorSafe = (aqi === null || aqi < 100) && weather.precipitation < 3;
  if (preferences?.indoorPreference === 'indoor') {
    outdoorSafe = false;
  } else if (preferences?.indoorPreference === 'outdoor' && outdoorSafe) {
    outdoorSafe = true; // Already safe
  }
  
  // Build preference instructions
  let preferenceText = "";
  if (preferences) {
    const parts = [];
    if (preferences.activityLevel === 'high') parts.push("ENERGETIC and ACTIVE activities");
    else if (preferences.activityLevel === 'low') parts.push("RELAXING and CALM activities");
    
    if (preferences.budget === 'free') parts.push("FREE or very low-cost options only");
    
    if (preferences.socialLevel === 'high') parts.push("SOCIAL activities where interaction is possible");
    else if (preferences.socialLevel === 'low') parts.push("SOLO or introspective activities");
    
    if (preferences.focus && preferences.focus.length > 0) {
      parts.push(`Focus on: ${preferences.focus.join(', ')}`);
    }
    
    if (preferences.customInstructions) {
      parts.push(`SPECIFIC REQUIREMENT: ${preferences.customInstructions}`);
    }
    
    if (parts.length > 0) {
      preferenceText = `\nUSER PREFERENCES:\n${parts.map(p => `- ${p}`).join('\n')}\n`;
    }
  }

  // Include city-specific social activities context
  let cityContext = "";
  if (socialActivities && socialActivities.length > 0) {
    const relevantActivities = socialActivities.filter(act => {
      const actTime = act.time?.toLowerCase() || "";
      return actTime.includes(timeOfDay.split('-')[0]) || actTime.includes("any") || actTime.includes("all");
    });
    
    if (relevantActivities.length > 0) {
      cityContext = `\nLOCAL ACTIVITIES IN ${city.toUpperCase()}:\n${relevantActivities.slice(0, 3).map((act, idx) => `${idx + 1}. ${act.activity} at ${act.location} (${act.cost})`).join('\n')}\n`;
      cityContext += `You can reference or incorporate similar activities, but create NEW unique activities for this time block.\n`;
    }
  }
  
  return `You are creating a detailed ${timeOfDay} itinerary for ${block.start}–${block.end} in ${city}. Use specific local knowledge about ${city} - its neighborhoods, landmarks, culture, cuisine, and popular activities.

CURRENT CONDITIONS:
- Location: ${city}${userLocation.country ? `, ${userLocation.country}` : ''}
- Weather: ${weather.temperature}°C, ${weather.precipitation}mm rain, ${weather.windspeed}km/h wind
- Air Quality: ${aqi || 'Good'} ${outdoorSafe ? '(outdoor activities OK)' : '(stay indoors recommended)'}
- Daylight: Sunrise ${weather.sunrise}, Sunset ${weather.sunset}
${cityContext}${preferenceText}
${previousActivities.length > 0 ? `ACTIVITIES ALREADY PLANNED TODAY (DO NOT REPEAT):\n${previousActivities.map(a => `• ${a.time}: ${a.activity}`).join('\n')}\n` : ''}

CRITICAL REQUIREMENTS:
1. Generate 2-3 UNIQUE, SPECIFIC activities for this ${timeOfDay} block in ${city}
2. Each activity MUST be DIFFERENT from all previous activities today
3. Be CITY-SPECIFIC: Mention actual neighborhoods, venues, or areas in ${city} when possible
4. Include LOCAL CUISINE suggestions - recommend specific dishes or restaurant types popular in ${city}
5. Make activities PRACTICAL and ACTIONABLE - not generic suggestions
6. Consider ${timeOfDay} energy levels and local culture
7. EVERY activity MUST include: time, detailed activity description, meal/food suggestion, and helpful tips

Return ONLY a JSON array with this EXACT structure (all fields required):
[
  {
    "time": "HH:MM (specific time within ${block.start}-${block.end})",
    "activity": "Detailed activity description (15-25 words) mentioning specific locations/venues in ${city} when relevant",
    "meal": "Specific meal, snack, or food recommendation (mention local cuisine if relevant) - REQUIRED for meal times",
    "notes": "Practical tips and advice for this activity (2-3 sentences) including how to get there, what to bring, best practices"
  }
]

${outdoorSafe ? (preferences?.indoorPreference !== 'indoor' ? 'Prioritize outdoor activities where appropriate for ${city}.' : 'Focus on indoor activities as per user preference.') : 'Focus on indoor activities due to weather/air quality.'}
Match energy levels to ${timeOfDay} and user preferences (${preferences?.activityLevel || 'moderate'} activity level).
IMPORTANT: Use ${city}'s unique characteristics - its culture, landmarks, neighborhoods, and local customs.`;
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
  
  return [options[0]];
}

// --- Format activity card ---
function formatActivityCard(activity) {
  return `
<div style="border-left: 4px solid #2196F3; padding: 12px 16px; margin: 12px 0; background: linear-gradient(to right, rgba(33,150,243,0.1), transparent); border-radius: 4px;">
  <div style="font-size: 1.2em; font-weight: bold; color: #2196F3; margin-bottom: 8px;">⏰ ${activity.time}</div>
  <div style="margin: 6px 0; font-size: 1.05em;"><strong>📌 Activity:</strong> ${activity.activity}</div>
  ${activity.meal ? `<div style="margin: 6px 0; color: #555;"><strong>🍽️ Meal:</strong> ${activity.meal}</div>` : ''}
  <div style="margin: 8px 0; padding: 8px; background: rgba(0,0,0,0.05); border-radius: 4px; font-size: 0.95em;"><strong>💡 Tips:</strong> ${activity.notes}</div>
</div>`;
}

// --- Generate plan blocks in parallel for maximum speed ---
async function generatePlanBlocks(weather, aqi) {
  let allActivities = [];
  generationState.completedBlocks = [];
  
  // Show progress indicator
  updateProgress(0);

  // Initialize all cards to loading state
  PLAN_BLOCKS.forEach(block => {
    const card = getCardElement(block.id);
    if (card) {
      updateCardState(card, "loading");
      const contentEl = card.querySelector(".card-content");
      if (contentEl) {
        contentEl.innerHTML = '<div class="card-empty-state">Generating plan...</div>';
      }
    }
  });

  // Generate all blocks in parallel
  const blockPromises = PLAN_BLOCKS.map(async (block) => {
    // Check if stopped before starting
    if (generationState.isStopped) {
      return null;
    }

    const card = getCardElement(block.id);
    if (!card) return null;

    try {
      // Build prompt with context - note: we pass empty array for previousActivities since we're generating in parallel
      // This means activities won't check against each other, but parallel generation is much faster
      const prompt = buildPrompt(weather, aqi, block, [], userLocation.city, currentPlanState.preferences, currentPlanState.socialActivities);
      
      // Call LLM (parallel execution)
      const blockPlan = await callLLM(prompt, card);
      
      // Check if stopped after LLM call
      if (generationState.isStopped) {
        return null;
      }
      
      // Display results immediately (no streaming delay)
      if (blockPlan && Array.isArray(blockPlan) && blockPlan.length > 0) {
        // Render immediately without streaming delays
        renderActivityCard(card, blockPlan);
        
        // Add to activities list
        blockPlan.forEach(activity => {
          allActivities.push(activity);
        });
        
        updateCardState(card, "complete");
        generationState.completedBlocks.push(block.id);
        updateProgress(generationState.completedBlocks.length);
        
        return blockPlan;
        
      } else {
        // Use fallback immediately
        const fallback = getFallbackForBlock(block, weather, aqi, []);
        
        if (fallback && fallback.length > 0) {
          renderActivityCard(card, fallback);
          
          fallback.forEach(activity => {
            allActivities.push(activity);
          });
          
          updateCardState(card, "complete");
          generationState.completedBlocks.push(block.id);
          updateProgress(generationState.completedBlocks.length);
          
          return fallback;
        } else {
          updateCardState(card, "error");
          const contentEl = card.querySelector(".card-content");
          if (contentEl) {
            contentEl.innerHTML = '<div class="card-empty-state" style="color: var(--danger);">Failed to generate plan</div>';
          }
          return null;
        }
      }
      
    } catch (error) {
      if (error.message.includes("stopped")) {
        // User stopped generation - this is expected
        return null;
      } else {
        // Actual error
        updateCardState(card, "error");
        const contentEl = card.querySelector(".card-content");
        if (contentEl) {
          contentEl.innerHTML = `<div class="card-empty-state" style="color: var(--danger);">Error: ${error.message}</div>`;
        }
        return null;
      }
    }
  });

  // Wait for all blocks to complete in parallel
  try {
    await Promise.all(blockPromises);
  } catch (error) {
    console.error("Error in parallel generation:", error);
  }

  // Reset generation state
  generationState.isGenerating = false;
  generationState.currentBlock = null;
  generationState.abortController = null;
  
  // Update all activities in state
  currentPlanState.allActivities = allActivities;
  
  // Show modify button after generation completes
  const modifyBtn = document.getElementById("modifyPlanBtn");
  if (modifyBtn) {
    modifyBtn.style.display = "inline-flex";
  }
}

// --- Function to update blocks with social activities after they're generated ---
async function updateBlocksAfterSocialActivities() {
  if (!currentPlanState.socialActivities || currentPlanState.socialActivities.length === 0) {
    return;
  }

  // Wait a bit to ensure blocks are rendered
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Update blocks with social activities
  updateBlocksWithSocialActivities(currentPlanState.socialActivities);
}

// --- Update plan based on instruction ---
async function updatePlanWithInstruction(instruction) {
  const instructionInput = document.getElementById("instructionInput");
  const applyButton = document.getElementById("applyInstruction");
  const modifyType = document.querySelector('input[name="modifyType"]:checked')?.value || "all";
  const blockSelect = document.getElementById("blockSelect");
  const newLocationInput = document.getElementById("newLocation");
  
  if (applyButton) applyButton.disabled = true;
  
  // Close modal temporarily
  closeModifyModal();
  
  try {
    // Handle location change
    if (modifyType === "location") {
      const newCity = newLocationInput?.value?.trim();
      if (!newCity) {
        if (applyButton) applyButton.disabled = false;
        openModifyModal();
        return;
      }
      
      console.log("Changing location to:", newCity);
      
      // Update location
      userLocation.city = newCity;
      userLocation.country = ""; // Will be updated when geocoded
      
      // Fetch new weather and location data
      try {
        // Try to geocode the new city
        const geocodeResponse = await fetchWithTimeout(
          `${GEOCODING_API}?name=${encodeURIComponent(newCity)}&count=1&language=en&format=json`,
          {},
          10000
        );
        
        if (geocodeResponse.ok) {
          const geoData = await geocodeResponse.json();
          if (geoData.results && geoData.results.length > 0) {
            const result = geoData.results[0];
            userLocation.latitude = result.latitude;
            userLocation.longitude = result.longitude;
            userLocation.country = result.country || "";
          }
        }
      } catch (e) {
        console.log("Geocoding failed, using city name only");
      }
      
      // Fetch new weather and AQI
    const [weather, aqi] = await Promise.all([
        fetchWeather(userLocation.latitude || 51.5074, userLocation.longitude || -0.1278),
      fetchAQI(userLocation.city)
    ]);

      currentPlanState.weather = weather;
      currentPlanState.aqi = aqi;
      
      // Regenerate social activities for new location
      const socialActivities = await getSocialActivities(
        userLocation.city, 
        weather, 
        aqi, 
        currentPlanState.preferences
      );
    if (socialActivities && socialActivities.length > 0) {
        currentPlanState.socialActivities = socialActivities;
        displaySocialActivities(socialActivities);
    }

      // Update location display
      updateLocationDisplay();
      
      // Regenerate clothing advice
    const clothingAdvice = generateClothingRecommendation(weather, aqi);
      currentPlanState.clothingAdvice = clothingAdvice;
      displayClothingAdvice(clothingAdvice);
      
      // Reset all cards and regenerate
      PLAN_BLOCKS.forEach(block => {
        const card = getCardElement(block.id);
        if (card) {
          updateCardState(card, "empty");
          const contentEl = card.querySelector(".card-content");
          if (contentEl) {
            contentEl.innerHTML = '<div class="card-empty-state">Updating plan...</div>';
          }
        }
      });
      
      generationState.isGenerating = true;
      generationState.isStopped = false;
      generationState.completedBlocks = [];
      currentPlanState.allActivities = [];
      
      // Start social activities and events fetch for new location
      const socialActivitiesPromise = getSocialActivities(userLocation.city, weather, aqi, currentPlanState.preferences)
        .then(activities => {
          if (activities && activities.length > 0) {
            currentPlanState.socialActivities = activities;
            displaySocialActivities(activities);
            setTimeout(() => {
              updateBlocksWithSocialActivities(activities);
            }, 1000);
          }
        })
        .catch(err => {
          console.log("Social activities fetch failed:", err);
          currentPlanState.socialActivities = [];
        });

      const eventsPromise = getLocalEvents(userLocation.city, userLocation.country)
        .then(events => {
          if (events && events.length > 0) {
            currentPlanState.localEvents = events;
            displayLocalEvents(events);
          } else {
            displayLocalEvents([]);
          }
        })
        .catch(err => {
          console.log("Local events fetch failed:", err);
          displayLocalEvents([]);
        });
      
      await generatePlanBlocks(weather, aqi);
      
      // Wait for social activities and events to complete
      await Promise.all([socialActivitiesPromise, eventsPromise]);
      
      // Final update of blocks with social activities for new location
      if (currentPlanState.socialActivities && currentPlanState.socialActivities.length > 0) {
        updateBlocksWithSocialActivities(currentPlanState.socialActivities);
      }
      
    } else if (modifyType === "block") {
      // Handle block-specific modification
      const blockId = parseInt(blockSelect?.value || "0");
      const block = PLAN_BLOCKS[blockId];
      
      if (!block) {
        alert("Invalid block selection");
        if (applyButton) applyButton.disabled = false;
        openModifyModal();
        return;
      }
      
      // Parse instruction for this specific block
      const newPreferences = instruction.trim() ? await parseInstruction(instruction.trim()) : currentPlanState.preferences;
      
      // Update the specific block
      const card = getCardElement(blockId);
      if (card) {
        updateCardState(card, "loading");
        const contentEl = card.querySelector(".card-content");
        if (contentEl) {
          contentEl.innerHTML = '<div class="card-empty-state">Regenerating...</div>';
        }
        
        // Remove activities from this block
        currentPlanState.allActivities = currentPlanState.allActivities.filter(
          act => !(act.time >= block.start && act.time < block.end)
        );
        
        // Build prompt for this block
        const prompt = buildPrompt(
          currentPlanState.weather, 
          currentPlanState.aqi, 
          block, 
          currentPlanState.allActivities, 
          userLocation.city, 
          newPreferences,
          currentPlanState.socialActivities
        );
        
        // Generate new plan for this block
        const blockPlan = await callLLM(prompt, card);
        
      if (blockPlan && Array.isArray(blockPlan) && blockPlan.length > 0) {
          const previewText = blockPlan.map((act, idx) => {
            return `${idx + 1}. ${act.time || block.start}: ${act.activity || 'Activity'}${act.meal ? ` | Meal: ${act.meal}` : ''}`;
          }).join('\n\n');
          
          await streamTextToCard(card, previewText, 25);
          await new Promise(resolve => setTimeout(resolve, 300));
          renderActivityCard(card, blockPlan);
          
          blockPlan.forEach(activity => {
            currentPlanState.allActivities.push(activity);
          });
          
          updateCardState(card, "complete");
        } else {
          updateCardState(card, "error");
          const contentEl = card.querySelector(".card-content");
          if (contentEl) {
            contentEl.innerHTML = '<div class="card-empty-state" style="color: var(--danger);">Failed to regenerate</div>';
          }
        }
      }
      
      } else {
      // Handle full plan modification
      if (instruction && instruction.trim()) {
        // Parse instruction to extract parameters
        const newPreferences = await parseInstruction(instruction.trim());
        
        // Update preferences
        currentPlanState.preferences = {
          ...currentPlanState.preferences,
          ...newPreferences
        };
      }
      
      // Update location display if city changed
      updateLocationDisplay();
      
      // Reset all cards to empty state
      PLAN_BLOCKS.forEach(block => {
        const card = getCardElement(block.id);
        if (card) {
          updateCardState(card, "empty");
          const contentEl = card.querySelector(".card-content");
          if (contentEl) {
            contentEl.innerHTML = '<div class="card-empty-state">Updating plan...</div>';
          }
        }
      });
      
      // Reset generation state
      generationState.isGenerating = true;
      generationState.isStopped = false;
      generationState.completedBlocks = [];
      currentPlanState.allActivities = [];
      
      // Start social activities and events fetch in parallel
      const socialActivitiesPromise = getSocialActivities(
        userLocation.city, 
        currentPlanState.weather, 
        currentPlanState.aqi, 
        currentPlanState.preferences
      ).then(activities => {
        if (activities && activities.length > 0) {
          currentPlanState.socialActivities = activities;
          displaySocialActivities(activities);
          setTimeout(() => {
            updateBlocksWithSocialActivities(activities);
          }, 1000);
        }
      }).catch(err => {
        console.log("Social activities fetch failed:", err);
        currentPlanState.socialActivities = [];
      });

      const eventsPromise = getLocalEvents(userLocation.city, userLocation.country)
        .then(events => {
          if (events && events.length > 0) {
            currentPlanState.localEvents = events;
            displayLocalEvents(events);
          } else {
            displayLocalEvents([]);
          }
        })
        .catch(err => {
          console.log("Local events fetch failed:", err);
          displayLocalEvents([]);
        });
      
      // Regenerate plan blocks
      await generatePlanBlocks(currentPlanState.weather, currentPlanState.aqi);
      
      // Wait for social activities and events, then update blocks
      await Promise.all([socialActivitiesPromise, eventsPromise]);
      if (currentPlanState.socialActivities && currentPlanState.socialActivities.length > 0) {
        updateBlocksWithSocialActivities(currentPlanState.socialActivities);
      }
    }
    
    // Clear input and close modal
    if (instructionInput) instructionInput.value = "";
    if (newLocationInput) newLocationInput.value = "";
    closeModifyModal();

  } catch (error) {
    console.error("Update error:", error);
    // Show error
    const firstCard = getCardElement(0);
    if (firstCard) {
      updateCardState(firstCard, "error");
      const contentEl = firstCard.querySelector(".card-content");
      if (contentEl) {
        contentEl.innerHTML = `<div class="card-empty-state" style="color: var(--danger);">Error: ${error.message}</div>`;
      }
    }
    // Re-open modal on error
    openModifyModal();
  } finally {
    if (applyButton) applyButton.disabled = false;
  }
}

// --- Main agent loop ---
async function runAgent() {
  const runButton = document.getElementById("runAgent");
  
  if (!runButton) {
    console.error("Run button not found");
    return;
  }

  // Reset generation state
  generationState.isGenerating = true;
  generationState.isStopped = false;
  generationState.currentBlock = null;
  generationState.completedBlocks = [];
  generationState.abortController = null;

  runButton.disabled = true;
  
  // Reset preferences for new plan
  currentPlanState = {
    weather: null,
    aqi: null,
    preferences: {
      activityLevel: "moderate",
      indoorPreference: "flexible",
      budget: "flexible",
      socialLevel: "moderate",
      focus: [],
      customInstructions: ""
    },
    allActivities: [],
    socialActivities: [],
    localEvents: [],
    clothingAdvice: null
  };
  
  // Create grid
  createPlanGrid();
  
  // Show location display with loading state initially
  updateLocationDisplay();
  
  // Hide modify button initially (will show after generation completes)
  const modifyBtn = document.getElementById("modifyPlanBtn");
  if (modifyBtn) {
    modifyBtn.style.display = "none";
  }
  
  try {
    // Get user location (will try geolocation first, then IP-based, then default)
    console.log("🔍 Starting location detection...");
    userLocation = await getUserLocation();
    console.log("📍 Location fetched:", userLocation);
    console.log("📍 Location source:", userLocation.source || (userLocation.isDefault ? "default" : "geolocation"));
    console.log("📍 City:", userLocation.city, "Country:", userLocation.country);
    
    // Update location display immediately after fetching
    updateLocationDisplay();
    
    // Silently fetch weather and AQI
    const [weather, aqi] = await Promise.all([
      fetchWeather(userLocation.latitude || 51.5074, userLocation.longitude || -0.1278),
      fetchAQI(userLocation.city || "London")
    ]);
    
    // Ensure location display is updated after fetching location
    updateLocationDisplay();

    // Update state
    currentPlanState.weather = weather;
    currentPlanState.aqi = aqi;

    // Generate clothing recommendation (synchronous - fast)
    const clothingAdvice = generateClothingRecommendation(weather, aqi);
    currentPlanState.clothingAdvice = clothingAdvice;
    displayClothingAdvice(clothingAdvice);

    // Update location display again to ensure it's shown
    updateLocationDisplay();

    // Start social activities and events fetch in parallel (don't wait for it to block generation)
    const socialActivitiesPromise = getSocialActivities(userLocation.city, weather, aqi, currentPlanState.preferences)
      .then(activities => {
        if (activities && activities.length > 0) {
          currentPlanState.socialActivities = activities;
          displaySocialActivities(activities);
          // Update blocks with social activities after they're generated
          setTimeout(() => {
            updateBlocksWithSocialActivities(activities);
          }, 1000); // Small delay to ensure blocks are rendered
        }
      })
      .catch(err => {
        console.log("Social activities fetch failed:", err);
        // Use empty array as fallback
        currentPlanState.socialActivities = [];
      });

    // Fetch local events in parallel
    const eventsPromise = getLocalEvents(userLocation.city, userLocation.country)
      .then(events => {
        if (events && events.length > 0) {
          currentPlanState.localEvents = events;
          displayLocalEvents(events);
        } else {
          // Show empty state
          displayLocalEvents([]);
        }
      })
      .catch(err => {
        console.log("Local events fetch failed:", err);
        displayLocalEvents([]);
      });

    // Generate plan blocks in parallel (don't wait for social activities)
    // Social activities will populate as they complete
    await generatePlanBlocks(weather, aqi);
    
    // Wait for social activities and events to complete
    await Promise.all([socialActivitiesPromise, eventsPromise]);
    
    // Final update of blocks with social activities
    if (currentPlanState.socialActivities && currentPlanState.socialActivities.length > 0) {
      updateBlocksWithSocialActivities(currentPlanState.socialActivities);
    }

  } catch (error) {
    if (!error.message.includes("stopped")) {
    console.error("Agent error:", error);
      // Show error in first card
      const firstCard = getCardElement(0);
      if (firstCard) {
        updateCardState(firstCard, "error");
        const contentEl = firstCard.querySelector(".card-content");
        if (contentEl) {
          contentEl.innerHTML = `<div class="card-empty-state" style="color: var(--danger);">Error: ${error.message}</div>`;
        }
      }
    }
  } finally {
    generationState.isGenerating = false;
    runButton.disabled = false;
  }
}

// --- Bind UI ---
document.addEventListener('DOMContentLoaded', () => {
  // Plan My Day button
  const runButton = document.getElementById("runAgent");
  if (runButton) {
    runButton.addEventListener("click", runAgent);
  } else {
    console.error("Run button not found");
  }

  // Modify Plan button (floating)
  const modifyBtn = document.getElementById("modifyPlanBtn");
  if (modifyBtn) {
    modifyBtn.addEventListener("click", openModifyModal);
  }

  // Modal handlers
  const modal = document.getElementById("modifyModal");
  const modalBackdrop = document.getElementById("modalBackdrop");
  const modalClose = document.getElementById("modalClose");
  const modalCancel = document.getElementById("modalCancel");

  if (modalClose) {
    modalClose.addEventListener("click", closeModifyModal);
  }

  if (modalCancel) {
    modalCancel.addEventListener("click", closeModifyModal);
  }

  if (modalBackdrop) {
    modalBackdrop.addEventListener("click", closeModifyModal);
  }

  // ESC key to close modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal && modal.style.display !== "none") {
      closeModifyModal();
    }
  });

  // Handle modal option changes
  const modifyTypeRadios = document.querySelectorAll('input[name="modifyType"]');
  const blockSelector = document.getElementById("blockSelector");
  const locationInput = document.getElementById("locationInput");
  
  modifyTypeRadios.forEach(radio => {
    radio.addEventListener("change", (e) => {
      if (blockSelector && locationInput) {
        if (e.target.value === "block") {
          blockSelector.style.display = "block";
          locationInput.style.display = "none";
        } else if (e.target.value === "location") {
          blockSelector.style.display = "none";
          locationInput.style.display = "block";
        } else {
          blockSelector.style.display = "none";
          locationInput.style.display = "none";
        }
      }
    });
  });

  // Stop Generation button
  const stopBtn = document.getElementById("stopGeneration");
  if (stopBtn) {
    stopBtn.addEventListener("click", () => {
      stopGeneration();
      closeModifyModal();
    });
  }

  // Instruction handling in modal
  const applyButton = document.getElementById("applyInstruction");
  const instructionInput = document.getElementById("instructionInput");
  
  if (applyButton) {
    applyButton.addEventListener("click", () => {
      const modifyType = document.querySelector('input[name="modifyType"]:checked')?.value || "all";
      const instruction = instructionInput?.value || "";
      const newLocationInput = document.getElementById("newLocation");
      const newLocation = newLocationInput?.value?.trim() || "";
      
      // Handle location change (doesn't need instruction)
      if (modifyType === "location") {
        if (!newLocation) {
          alert("Please enter a city name");
          return;
        }
        updatePlanWithInstruction(""); // Empty instruction for location change
      } else {
        // For block or all modifications, need instruction
        if (!instruction.trim() && modifyType !== "block") {
          alert("Please enter an instruction");
          return;
        }
        updatePlanWithInstruction(instruction);
      }
    });
  }
  
  // Allow Enter key (with Shift for new line)
  if (instructionInput) {
    instructionInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const modifyType = document.querySelector('input[name="modifyType"]:checked')?.value || "all";
        const instruction = instructionInput.value || "";
        const newLocationInput = document.getElementById("newLocation");
        const newLocation = newLocationInput?.value?.trim() || "";
        
        if (modifyType === "location") {
          if (newLocation) {
            updatePlanWithInstruction("");
          }
        } else if (instruction.trim()) {
          updatePlanWithInstruction(instruction);
        }
      }
    });
  }
  
  // Example chips
  const exampleChips = document.querySelectorAll(".example-chip");
  exampleChips.forEach(chip => {
    chip.addEventListener("click", () => {
      const example = chip.getAttribute("data-example");
      if (instructionInput && example) {
        instructionInput.value = example;
        instructionInput.focus();
      }
    });
  });
});
