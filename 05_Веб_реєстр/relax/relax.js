/* Relax Service Logic (Web Audio API Synthesizers & Breathing Trainer) */

// Helper to get elements
const $ = (id) => document.getElementById(id);

// ── 1. Horoscope Logic ─────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  const zodiacButtons = document.querySelectorAll(".zodiac-btn");
  const resultContainer = $("horoscopeResult");
  const resultSignIcon = $("selectedSignIcon");
  const resultSignName = $("selectedSignName");
  const resultText = $("horoscopeText");
  const resultLoader = $("horoscopeLoader");

  zodiacButtons.forEach(btn => {
    btn.addEventListener("click", async () => {
      // Toggle active states
      zodiacButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      const signName = btn.getAttribute("data-sign");
      const signIcon = btn.querySelector(".zodiac-icon").textContent;

      // Reset result card view
      resultSignIcon.textContent = signIcon;
      resultSignName.textContent = `Гороскоп для знака ${signName}`;
      resultContainer.style.display = "block";
      resultLoader.style.display = "block";
      resultText.style.display = "none";

      try {
        const isFileProtocol = window.location.protocol === "file:";
        const fetchUrl = isFileProtocol 
          ? "http://127.0.0.1:8042/api/relax-horoscope" 
          : "/api/relax-horoscope";

        const res = await fetch(fetchUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ zodiac_sign: signName })
        });

        if (!res.ok) throw new Error("Помилка сервера");
        const data = await res.json();
        
        resultText.innerHTML = escapeHtml(data.response || data.message || "Не вдалося отримати прогноз.");
      } catch (err) {
        console.error("Horoscope load failed:", err);
        resultText.innerHTML = "<strong>❌ Помилка:</strong> Не вдалося отримати космічний прогноз. Переконайтеся, що бекенд-сервер запущено.";
      } finally {
        resultLoader.style.display = "none";
        resultText.style.display = "block";
      }
    });
  });
});

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/\n/g, "<br>");
}


// ── 2. Breathing Guide (4-7-8 Technique) ───────────────
let breathingInterval = null;
let breathingTimeout = null;
let breathingActive = false;

const circle = $("breathingCircle");
const actionText = $("breathingActionText");
const timerEl = $("breathingTimer");
const startBtn = $("startBreathingBtn");
const stopBtn = $("stopBreathingBtn");

function startBreathing() {
  if (breathingActive) return;
  breathingActive = true;
  startBtn.style.display = "none";
  stopBtn.style.display = "inline-block";
  runBreathingCycle();
}

function stopBreathing() {
  breathingActive = false;
  startBtn.style.display = "inline-block";
  stopBtn.style.display = "none";
  
  if (breathingInterval) clearInterval(breathingInterval);
  if (breathingTimeout) clearTimeout(breathingTimeout);
  
  circle.className = "breathing-circle";
  actionText.textContent = "Вдих";
  timerEl.textContent = "4";
}

function runBreathingCycle() {
  if (!breathingActive) return;

  // Stage 1: Inhale (4s)
  circle.className = "breathing-circle inhale";
  actionText.textContent = "Вдих через ніс";
  let count = 4;
  timerEl.textContent = count;
  
  breathingInterval = setInterval(() => {
    count--;
    if (count > 0) {
      timerEl.textContent = count;
    } else {
      clearInterval(breathingInterval);
      
      // Stage 2: Hold (7s)
      circle.className = "breathing-circle hold";
      actionText.textContent = "Затримка дихання";
      count = 7;
      timerEl.textContent = count;
      
      breathingInterval = setInterval(() => {
        count--;
        if (count > 0) {
          timerEl.textContent = count;
        } else {
          clearInterval(breathingInterval);
          
          // Stage 3: Exhale (8s)
          circle.className = "breathing-circle exhale";
          actionText.textContent = "Видих ротом";
          count = 8;
          timerEl.textContent = count;
          
          breathingInterval = setInterval(() => {
            count--;
            if (count > 0) {
              timerEl.textContent = count;
            } else {
              clearInterval(breathingInterval);
              // Restart cycle
              runBreathingCycle();
            }
          }, 1000);
        }
      }, 1000);
    }
  }, 1000);
}

startBtn.addEventListener("click", startBreathing);
stopBtn.addEventListener("click", stopBreathing);


// ── 3. Ambient Audio Synthesizers (Web Audio API) ──────
let audioCtx = null;
const activeSounds = {};

function initAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
}

// Noise Generator Helper
function createNoiseBuffer(type = "white") {
  const bufferSize = 2 * audioCtx.sampleRate;
  const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const output = noiseBuffer.getChannelData(0);
  
  let lastOut = 0.0;
  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    if (type === "pink") {
      // Pink noise filter approximation
      output[i] = (lastOut * 0.95) + (white * 0.05);
      lastOut = output[i];
    } else {
      output[i] = white;
    }
  }
  return noiseBuffer;
}

// 1. Rain Synthesizer
function startRain() {
  initAudioContext();
  const noiseSource = audioCtx.createBufferSource();
  noiseSource.buffer = createNoiseBuffer("pink");
  noiseSource.loop = true;

  const filter = audioCtx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1000;
  filter.Q.value = 1.0;

  const gain = audioCtx.createGain();
  gain.gain.value = 0.25;

  noiseSource.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);
  noiseSource.start(0);

  return { source: noiseSource, gain: gain };
}

// 2. Forest/Wind Synthesizer
function startForest() {
  initAudioContext();
  const noiseSource = audioCtx.createBufferSource();
  noiseSource.buffer = createNoiseBuffer("pink");
  noiseSource.loop = true;

  const filter = audioCtx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 400;

  const gain = audioCtx.createGain();
  gain.gain.value = 0.15;

  // LFO to modulate filter frequency (simulates gusts of wind)
  const lfo = audioCtx.createOscillator();
  lfo.frequency.value = 0.12; // slow frequency
  const lfoGain = audioCtx.createGain();
  lfoGain.gain.value = 250; // modulate by 250Hz

  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);

  noiseSource.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);

  lfo.start(0);
  noiseSource.start(0);

  return { source: noiseSource, gain: gain, lfo: lfo };
}

// 3. Sea Waves Synthesizer
function startSea() {
  initAudioContext();
  const noiseSource = audioCtx.createBufferSource();
  noiseSource.buffer = createNoiseBuffer("pink");
  noiseSource.loop = true;

  const filter = audioCtx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 350;

  const gain = audioCtx.createGain();
  gain.gain.value = 0.05; // start low

  // LFO to modulate volume gain (wave swells every 6 seconds)
  const lfo = audioCtx.createOscillator();
  lfo.frequency.value = 0.16; // 6s cycle
  const lfoGain = audioCtx.createGain();
  lfoGain.gain.value = 0.1; // swell range

  lfo.connect(lfoGain);
  lfoGain.connect(gain.gain);

  noiseSource.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);

  lfo.start(0);
  noiseSource.start(0);

  return { source: noiseSource, gain: gain, lfo: lfo };
}

// 4. Cosmic Drone Synthesizer
function startSpace() {
  initAudioContext();
  const gainNode = audioCtx.createGain();
  gainNode.gain.value = 0.15;

  const oscs = [];
  const freqs = [65.41, 98.00, 130.81]; // Low C drone chord

  freqs.forEach(freq => {
    const osc = audioCtx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = freq;

    const filter = audioCtx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 180;

    osc.connect(filter);
    filter.connect(gainNode);
    osc.start(0);
    oscs.push(osc);
  });

  // LFO to modulate overall volume slightly
  const lfo = audioCtx.createOscillator();
  lfo.frequency.value = 0.08;
  const lfoGain = audioCtx.createGain();
  lfoGain.gain.value = 0.05;
  
  lfo.connect(lfoGain);
  lfoGain.connect(gainNode.gain);
  lfo.start(0);

  gainNode.connect(audioCtx.destination);

  return { source: oscs, gain: gainNode, lfo: lfo };
}

// Toggle sound handler
const soundToggleButtons = document.querySelectorAll(".sound-toggle-btn");
soundToggleButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    const soundKey = btn.getAttribute("data-sound");
    const isPlaying = btn.classList.contains("playing");

    if (isPlaying) {
      // Stop the sound
      const soundData = activeSounds[soundKey];
      if (soundData) {
        if (Array.isArray(soundData.source)) {
          soundData.source.forEach(s => s.stop());
        } else {
          soundData.source.stop();
        }
        if (soundData.lfo) soundData.lfo.stop();
        delete activeSounds[soundKey];
      }
      btn.classList.remove("playing");
      btn.textContent = "▶️ Грати";
    } else {
      // Start the sound
      let soundData = null;
      if (soundKey === "rain") soundData = startRain();
      else if (soundKey === "forest") soundData = startForest();
      else if (soundKey === "sea") soundData = startSea();
      else if (soundKey === "space") soundData = startSpace();

      if (soundData) {
        activeSounds[soundKey] = soundData;
        btn.classList.add("playing");
        btn.textContent = "⏸️ Зупинити";
      }
    }
  });
});
