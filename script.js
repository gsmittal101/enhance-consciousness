/* ─── Enhance Consciousness – Breathing Timer ─── */
(function () {
  /* ═══ DOM refs ═══ */
  const cards         = document.querySelectorAll(".mode-card");
  const status        = document.getElementById("selection-status");
  const overlay       = document.getElementById("timer-overlay");
  const backBtn       = document.getElementById("timer-back");
  const modeLabelEl   = document.getElementById("timer-mode-label");
  const breathGlow    = document.getElementById("breath-glow");
  const breathRing    = document.getElementById("breath-ring");
  const instructionEl = document.getElementById("breath-instruction");
  const countdownEl   = document.getElementById("breath-countdown");
  const sessionEl     = document.getElementById("session-timer");

  /* ═══ Config per mode ═══ */
  const modeConfig = {
    basic:        { label: "Basic",        hue: 195, inhale: 5,  hold: 12, exhale: 8,  vacant: 8  },
    intermediate: { label: "Intermediate", hue: 270, inhale: 8,  hold: 15, exhale: 8,  vacant: 8  },
    advance:      { label: "Advance",      hue: 340, inhale: 12, hold: 36, exhale: 12, vacant: 12 },
  };

  let activeMode = null;
  let timerState = null;  // { interval }

  /* ═══ Air flow state (shared with air particle system) ═══ */
  // Phases: "inhale" | "hold" | "exhale" | "vacant_hold" | "stopped"
  let breathDirection = "inhale";
  let activeHue = 270;
  let airAnimId = null;

  /* ═══ Air flow canvas refs ═══ */
  const airCanvas = document.getElementById("air-canvas");
  const airCtx    = airCanvas.getContext("2d");
  let airParticles = [];

  /* ═══ Card selection ═══ */
  const modeLabels = { basic: "Basic", intermediate: "Intermediate", advance: "Advance" };

  cards.forEach((card) => {
    card.addEventListener("click", (e) => {
      // If a badge was clicked, don't toggle the card — start the timer instead
      if (e.target.classList.contains("badge")) return;

      const mode = card.dataset.mode;

      if (activeMode === mode) {
        card.setAttribute("aria-pressed", "false");
        activeMode = null;
        status.classList.remove("visible");
        return;
      }

      cards.forEach((c) => c.setAttribute("aria-pressed", "false"));
      card.setAttribute("aria-pressed", "true");
      activeMode = mode;

      status.innerHTML = `Mode selected: <span class="mode-name">${modeLabels[mode]}</span> — pick a duration`;
      status.classList.add("visible");
    });
  });

  /* ═══ Badge (duration) click ═══ */
  document.querySelectorAll(".badge").forEach((badge) => {
    badge.addEventListener("click", (e) => {
      e.stopPropagation(); // prevent card toggle

      // Find parent card's mode
      const card = badge.closest(".mode-card");
      const mode = card.dataset.mode;

      // Parse duration
      const text = badge.textContent.trim();          // "2 min" or "5 min"
      const minutes = parseInt(text, 10);
      const totalSeconds = minutes * 60;

      startBreathingSession(mode, totalSeconds);
    });
  });

  /* ═══ Back button ═══ */
  backBtn.addEventListener("click", () => {
    stopSession();
    overlay.classList.remove("active");
    overlay.setAttribute("aria-hidden", "true");
  });

  /* ═══ Start a breathing session ═══ */
  function startBreathingSession(mode, totalSeconds) {
    const cfg = modeConfig[mode];
    const hue = cfg.hue;
    activeHue = hue;
    const circumference = 2 * Math.PI * 130;  // ≈ 816.81

    // Phase definitions:  Inhale → Hold → Exhale → Vacant Hold
    const phases = [
      { name: "Inhale",       duration: cfg.inhale },
      { name: "Hold",         duration: cfg.hold },
      { name: "Exhale",       duration: cfg.exhale },
      { name: "Vacant Hold",  duration: cfg.vacant },
    ];
    const phaseKeys = ["inhale", "hold", "exhale", "vacant_hold"];

    // Show overlay
    overlay.classList.add("active");
    overlay.setAttribute("aria-hidden", "false");

    // Set mode label & colour theme
    modeLabelEl.textContent = cfg.label + " Mode";
    breathGlow.style.background = `hsl(${hue}, 70%, 50%)`;
    breathRing.style.stroke = `hsl(${hue}, 75%, 60%)`;
    instructionEl.style.color = `hsl(${hue}, 80%, 75%)`;

    // Clear any old timers
    stopSession();

    // Reset ring to empty
    breathRing.style.transitionDuration = "0s";
    breathRing.style.strokeDashoffset = circumference;
    breathGlow.className = "breath-glow";

    // ─── 3-second "Get Ready" countdown ───
    instructionEl.textContent = "Get Ready";
    countdownEl.textContent = "3";
    sessionEl.textContent = "";

    // Play initial beep
    playBeep(440, 0.15);

    let readyCount = 3;
    const readyInterval = setInterval(() => {
      readyCount--;
      if (readyCount > 0) {
        countdownEl.textContent = readyCount;
        playBeep(440, 0.15);  // tick beep
      } else {
        clearInterval(readyInterval);
        playBeep(660, 0.3);   // higher start tone
        // Now start the actual breathing session
        beginBreathingCycle(phases, phaseKeys, circumference, totalSeconds, hue);
      }
    }, 1000);

    timerState = { breathInterval: readyInterval };
  }

  /* ═══ Beep sound using Web Audio API ═══ */
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  function playBeep(frequency, duration) {
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = "sine";
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + duration);
  }

  /* ═══════════════════════════════════════════════════════════════════
     Natural Breath Sound System (white noise + filters)
     ═══════════════════════════════════════════════════════════════════ */
  // Create a reusable white noise buffer (2 seconds, looped)
  const noiseLength = audioCtx.sampleRate * 2;
  const noiseBuffer = audioCtx.createBuffer(1, noiseLength, audioCtx.sampleRate);
  const noiseData   = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseLength; i++) {
    noiseData[i] = Math.random() * 2 - 1;
  }

  let breathSoundNodes = null;  // holds active sound nodes for cleanup

  function playBreathSound(phase, durationSec) {
    stopBreathSound();  // clean up previous

    const t = audioCtx.currentTime;

    // White noise source
    const noise = audioCtx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;

    // Bandpass filter — shapes noise into wind/breath
    const bandpass = audioCtx.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.Q.value = 0.8;

    // Lowpass for warmth
    const lowpass = audioCtx.createBiquadFilter();
    lowpass.type = "lowpass";

    // Master gain
    const gain = audioCtx.createGain();

    if (phase === "inhale") {
      // Rising wind: frequency sweeps up, volume rises
      bandpass.frequency.setValueAtTime(200, t);
      bandpass.frequency.linearRampToValueAtTime(800, t + durationSec);
      lowpass.frequency.setValueAtTime(600, t);
      lowpass.frequency.linearRampToValueAtTime(2000, t + durationSec);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.18, t + durationSec * 0.7);
      gain.gain.linearRampToValueAtTime(0.05, t + durationSec);

    } else if (phase === "exhale") {
      // Falling breeze: frequency sweeps down, volume fades
      bandpass.frequency.setValueAtTime(700, t);
      bandpass.frequency.linearRampToValueAtTime(150, t + durationSec);
      lowpass.frequency.setValueAtTime(1800, t);
      lowpass.frequency.linearRampToValueAtTime(400, t + durationSec);
      gain.gain.setValueAtTime(0.16, t);
      gain.gain.linearRampToValueAtTime(0.001, t + durationSec);

    } else if (phase === "hold") {
      // Soft sustained ambient hum
      bandpass.frequency.setValueAtTime(300, t);
      lowpass.frequency.setValueAtTime(500, t);
      gain.gain.setValueAtTime(0.04, t);

    } else if (phase === "vacant_hold") {
      // Very faint ambient whisper
      bandpass.frequency.setValueAtTime(200, t);
      lowpass.frequency.setValueAtTime(350, t);
      gain.gain.setValueAtTime(0.02, t);
    }

    // Connect chain: noise → bandpass → lowpass → gain → speakers
    noise.connect(bandpass);
    bandpass.connect(lowpass);
    lowpass.connect(gain);
    gain.connect(audioCtx.destination);

    noise.start(t);
    noise.stop(t + durationSec + 0.1);

    breathSoundNodes = { noise, gain };
  }

  function stopBreathSound() {
    if (breathSoundNodes) {
      try {
        breathSoundNodes.gain.gain.cancelScheduledValues(audioCtx.currentTime);
        breathSoundNodes.gain.gain.setValueAtTime(breathSoundNodes.gain.gain.value, audioCtx.currentTime);
        breathSoundNodes.gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
        breathSoundNodes.noise.stop(audioCtx.currentTime + 0.2);
      } catch (e) { /* already stopped */ }
      breathSoundNodes = null;
    }
  }

  /* ═══ Begin the breathing cycle (after countdown) ═══ */
  function beginBreathingCycle(phases, phaseKeys, circumference, totalSeconds, hue) {
    let remaining = totalSeconds;
    updateSessionDisplay(remaining);

    // Phase tracking
    let phaseIndex     = 0;
    let phaseCountdown = phases[0].duration;

    // Set initial phase
    applyPhase(phaseIndex, phases, phaseKeys, circumference);

    // Start air particles
    startAirFlow();

    // Tick every second
    const breathInterval = setInterval(() => {
      phaseCountdown--;
      remaining--;

      // Update countdown number
      countdownEl.textContent = phaseCountdown;

      // Ring progress for the current phase
      const phaseDuration = phases[phaseIndex].duration;
      const progress = 1 - (phaseCountdown / phaseDuration);
      const key = phaseKeys[phaseIndex];

      if (key === "inhale") {
        // Ring fills up
        const offset = circumference * (1 - progress);
        breathRing.style.transitionDuration = "1s";
        breathRing.style.strokeDashoffset = offset;
      } else if (key === "exhale") {
        // Ring empties
        const offset = circumference * progress;
        breathRing.style.transitionDuration = "1s";
        breathRing.style.strokeDashoffset = offset;
      } else {
        // Hold & Vacant Hold: ring fills to show time progress
        const offset = circumference * (1 - progress);
        breathRing.style.transitionDuration = "1s";
        breathRing.style.strokeDashoffset = offset;
      }

      // Update session display
      updateSessionDisplay(remaining);

      // Phase complete?
      if (phaseCountdown <= 0) {
        phaseIndex = (phaseIndex + 1) % phases.length;
        phaseCountdown = phases[phaseIndex].duration;
        applyPhase(phaseIndex, phases, phaseKeys, circumference);
      }

      // Session over?
      if (remaining <= 0) {
        stopSession();
        instructionEl.textContent = "Session Complete";
        instructionEl.style.color = "#7cf5a8";
        countdownEl.textContent = "✓";
        breathGlow.className = "breath-glow";
      }
    }, 1000);

    timerState = { breathInterval };
  }

  /* ═══ Apply phase visuals ═══ */
  function applyPhase(phaseIndex, phases, phaseKeys, circumference) {
    const key  = phaseKeys[phaseIndex];
    const name = phases[phaseIndex].name;
    const dur  = phases[phaseIndex].duration;

    // Update shared direction for air particles
    breathDirection = key;

    // Play breath sound for this phase
    playBreathSound(key, dur);

    // Fade instruction text
    instructionEl.classList.add("fade");
    setTimeout(() => {
      instructionEl.textContent = name;
      instructionEl.classList.remove("fade");
    }, 300);

    countdownEl.textContent = dur;

    // Glow state
    if (key === "inhale") {
      breathGlow.className = "breath-glow inhale";
    } else if (key === "hold") {
      breathGlow.className = "breath-glow hold";
    } else if (key === "exhale") {
      breathGlow.className = "breath-glow exhale";
    } else {
      breathGlow.className = "breath-glow vacant";
    }

    // Ring starting position — reset to empty for all phases
    breathRing.style.transitionDuration = "0s";
    if (key === "exhale") {
      breathRing.style.strokeDashoffset = 0;               // full → empty
    } else {
      breathRing.style.strokeDashoffset = circumference;   // empty → fill
    }
  }

  /* ═══ Format mm:ss ═══ */
  function updateSessionDisplay(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    sessionEl.textContent = `${m}:${String(s).padStart(2, "0")}`;
  }

  /* ═══ Stop / cleanup ═══ */
  function stopSession() {
    if (timerState) {
      clearInterval(timerState.breathInterval);
      timerState = null;
    }
    breathDirection = "stopped";
    stopBreathSound();
    stopAirFlow();
  }

  /* ═══════════════════════════════════════════════════════════════════
     Air Flow Particle System
     ═══════════════════════════════════════════════════════════════════ */
  class AirParticle {
    constructor(cw, ch) {
      this.cw = cw;
      this.ch = ch;
      this.spawn();
    }

    spawn() {
      const cx = this.cw / 2;
      const cy = this.ch / 2;
      const angle = Math.random() * Math.PI * 2;

      if (breathDirection === "exhale") {
        // Start near center, move outward
        const r = 20 + Math.random() * 30;
        this.x = cx + Math.cos(angle) * r;
        this.y = cy + Math.sin(angle) * r;
      } else if (breathDirection === "hold") {
        // Spawn in a ring around center (orbiting)
        const r = 50 + Math.random() * 40;
        this.x = cx + Math.cos(angle) * r;
        this.y = cy + Math.sin(angle) * r;
      } else if (breathDirection === "vacant_hold") {
        // Sparse, far out, barely visible
        const r = 100 + Math.random() * 60;
        this.x = cx + Math.cos(angle) * r;
        this.y = cy + Math.sin(angle) * r;
      } else {
        // Inhale: start from outer edge, move inward
        const r = 160 + Math.random() * 40;
        this.x = cx + Math.cos(angle) * r;
        this.y = cy + Math.sin(angle) * r;
      }

      this.angle = angle;
      this.speed = 0.4 + Math.random() * 0.8;
      this.size  = 1.5 + Math.random() * 2.5;
      this.life  = 1.0;
      this.decay = 0.005 + Math.random() * 0.008;
      this.opacity = 0.3 + Math.random() * 0.5;

      // Wobble
      this.wobbleSpeed = 0.02 + Math.random() * 0.03;
      this.wobbleAmp   = 0.3 + Math.random() * 0.5;
      this.wobblePhase = Math.random() * Math.PI * 2;

      // For hold: orbital angle velocity
      this.orbitalSpeed = (Math.random() - 0.5) * 0.012;
    }

    update() {
      const cx = this.cw / 2;
      const cy = this.ch / 2;

      const dx = cx - this.x;
      const dy = cy - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = dx / dist;
      const ny = dy / dist;

      this.wobblePhase += this.wobbleSpeed;
      const wobble = Math.sin(this.wobblePhase) * this.wobbleAmp;
      const px = -ny;
      const py = nx;

      if (breathDirection === "inhale") {
        // Move toward center
        this.x += (nx * this.speed) + (px * wobble);
        this.y += (ny * this.speed) + (py * wobble);
        if (dist < 50) this.life -= 0.04;

      } else if (breathDirection === "exhale") {
        // Move away from center
        this.x -= (nx * this.speed) + (px * wobble);
        this.y -= (ny * this.speed) + (py * wobble);
        if (dist > 140) this.life -= 0.04;

      } else if (breathDirection === "hold") {
        // Slow orbit around center (air held inside)
        this.angle += this.orbitalSpeed;
        const targetR = 50 + Math.sin(this.wobblePhase) * 15;
        const targetX = cx + Math.cos(this.angle) * targetR;
        const targetY = cy + Math.sin(this.angle) * targetR;
        this.x += (targetX - this.x) * 0.03;
        this.y += (targetY - this.y) * 0.03;

      } else if (breathDirection === "vacant_hold") {
        // Very slow drift outward, fading (empty lungs)
        this.x -= nx * 0.1;
        this.y -= ny * 0.1;
        this.wobblePhase += 0.005;
        this.x += Math.sin(this.wobblePhase) * 0.15;
        if (dist > 160) this.life -= 0.03;
      }

      this.life -= this.decay;
    }

    draw(ctx) {
      let alpha = this.life * this.opacity;

      // Dimmer during hold phases
      if (breathDirection === "hold") alpha *= 0.7;
      if (breathDirection === "vacant_hold") alpha *= 0.35;

      if (alpha <= 0) return;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${activeHue}, 70%, 75%, ${alpha})`;
      ctx.fill();
    }

    isDead() {
      return this.life <= 0;
    }
  }

  function sizeAirCanvas() {
    const wrap = document.querySelector(".breath-circle-wrap");
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    // Canvas is 120px larger each side
    airCanvas.width  = rect.width + 120;
    airCanvas.height = rect.height + 120;
  }

  function startAirFlow() {
    sizeAirCanvas();
    airParticles = [];
    let spawnAccum = 0;

    function airLoop() {
      const cw = airCanvas.width;
      const ch = airCanvas.height;

      airCtx.clearRect(0, 0, cw, ch);

      if (breathDirection !== "stopped") {
        // Spawn rate depends on phase
        let rate = 1.8;
        if (breathDirection === "hold")         rate = 0.6;
        if (breathDirection === "vacant_hold")   rate = 0.3;

        spawnAccum += rate;
        while (spawnAccum >= 1) {
          airParticles.push(new AirParticle(cw, ch));
          spawnAccum--;
        }
      }

      // Update & draw
      for (let i = airParticles.length - 1; i >= 0; i--) {
        const p = airParticles[i];
        p.update();
        p.draw(airCtx);
        if (p.isDead()) airParticles.splice(i, 1);
      }

      airAnimId = requestAnimationFrame(airLoop);
    }

    airLoop();
  }

  function stopAirFlow() {
    if (airAnimId) {
      cancelAnimationFrame(airAnimId);
      airAnimId = null;
    }
    airParticles = [];
    airCtx.clearRect(0, 0, airCanvas.width, airCanvas.height);
  }

  /* ═══════════════════════════════════════════════════════════════════
     Background Particle Canvas
     ═══════════════════════════════════════════════════════════════════ */
  const canvas = document.getElementById("particle-canvas");
  const ctx = canvas.getContext("2d");
  let particles = [];
  let w, h;

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  window.addEventListener("resize", resize);
  resize();

  class Particle {
    constructor() { this.reset(); }
    reset() {
      this.x  = Math.random() * w;
      this.y  = Math.random() * h;
      this.r  = Math.random() * 1.8 + 0.4;
      this.dx = (Math.random() - 0.5) * 0.3;
      this.dy = (Math.random() - 0.5) * 0.3;
      this.opacity = Math.random() * 0.5 + 0.15;
      this.hue = 250 + Math.random() * 100;
    }
    update() {
      this.x += this.dx;
      this.y += this.dy;
      if (this.x < -10 || this.x > w + 10 || this.y < -10 || this.y > h + 10) this.reset();
    }
    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${this.hue}, 70%, 70%, ${this.opacity})`;
      ctx.fill();
    }
  }

  const count = Math.min(120, Math.floor((w * h) / 12000));
  for (let i = 0; i < count; i++) particles.push(new Particle());

  function animate() {
    ctx.clearRect(0, 0, w, h);
    particles.forEach((p) => { p.update(); p.draw(); });
    requestAnimationFrame(animate);
  }
  animate();
})();
