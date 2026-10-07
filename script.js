const workouts = {
  wakeUp: [
    { reps: 10, seconds: 7, repRest: 3 },
    { reps: 10, seconds: 7, repRest: 3 },
    { reps: 10, seconds: 10, repRest: 3 },
    { reps: 20, seconds: 15, repRest: 5, alternating: true },
    { reps: 20, seconds: 15, repRest: 5, alternating: true },
    { reps: 10, seconds: 30, repRest: 10, splitSides: true },
    { reps: 5, seconds: 30, repRest: 5 },
    { reps: 10, seconds: 7, repRest: 3 },
  ],
  bedtime: [
    { reps: 10, seconds: 7, repRest: 3 },
    { reps: 10, seconds: 7, repRest: 3 },
    { reps: 10, seconds: 7, repRest: 3 },
    { reps: 10, seconds: 10, repRest: 3 },
    { reps: 20, seconds: 15, repRest: 5, alternating: true },
    { reps: 20, seconds: 15, repRest: 5, alternating: true },
    { reps: 10, seconds: 30, repRest: 10, splitSides: true },
    { reps: 5, seconds: 30, repRest: 5 },
  ],
};

const exerciseRests = {
  wakeUp: [3, 3, 5, 5, 10, 10, 15],
  bedtime: [15, 3, 3, 5, 5, 10, 10],
};

const phaseLabel = document.getElementById("phase-label");
const timeRemaining = document.getElementById("time-remaining");
const detailLabel = document.getElementById("detail-label");
const exerciseProgress = document.getElementById("exercise-progress");
const repProgress = document.getElementById("rep-progress");
const progressBar = document.getElementById("progress-bar");
const startButton = document.getElementById("start-button");
const resetButton = document.getElementById("reset-button");
const skipButton = document.getElementById("skip-button");
const wakeUpButton = document.getElementById("wake-up-button");
const bedtimeButton = document.getElementById("bedtime-button");
const switchDialog = document.getElementById("switch-dialog");
const confirmSwitchButton = document.getElementById("confirm-switch-button");
const muteButton = document.getElementById("mute-button");
const volumeSlider = document.getElementById("volume-slider");
const volumeValue = document.getElementById("volume-value");
const sideIndicator = document.getElementById("side-indicator");
const overviewList = document.getElementById("overview-list");
const completionSummary = document.getElementById("completion-summary");
const summaryText = document.getElementById("summary-text");
const summaryRestartButton = document.getElementById("summary-restart-button");

const STATE_KEY = "compound-timer-state";
let workoutName = "wakeUp";
let pendingWorkout = null;
let exerciseIndex = 0;
let repIndex = 0;
let phase = "work";
let phaseDuration = workouts[workoutName][0].seconds;
let phaseStartedAt = 0;
let pausedElapsed = 0;
let running = false;
let intervalId = null;
let audioContext = null;
let muted = localStorage.getItem("compound-timer-muted") === "true";
let volume = Number(localStorage.getItem("compound-timer-volume") ?? 0.6);
let lastCountdownSecond = null;
let wakeLock = null;
let startedAt = null;

function saveState() {
  localStorage.setItem(STATE_KEY, JSON.stringify({
    workoutName,
    exerciseIndex,
    repIndex,
    phase,
    phaseDuration,
    pausedElapsed: running ? elapsedSeconds() : pausedElapsed,
  }));
}

function renderOverview() {
  overviewList.innerHTML = workouts[workoutName].map((exercise, index) => {
    const side = exercise.alternating
      ? " · alternating sides"
      : exercise.splitSides
        ? " · left then right"
        : "";
    return `<div class="overview-item"><strong>Exercise ${index + 1}${side}</strong><span>${exercise.reps} × ${exercise.seconds}s</span></div>`;
  }).join("");
}

function requestWakeLock() {
  if ("wakeLock" in navigator && !wakeLock) {
    navigator.wakeLock.request("screen").then((lock) => {
      wakeLock = lock;
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    }).catch((error) => {
      console.warn("Screen wake lock is unavailable.", error);
    });
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
}

function getAudioContext() {
  if (muted) return null;
  if (!audioContext) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    audioContext = new AudioContext();
  }
  if (audioContext.state === "suspended") audioContext.resume();
  return audioContext;
}

function playTone(frequency, duration = 0.12, delay = 0) {
  const context = getAudioContext();
  if (!context) return;

  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const startAt = context.currentTime + delay;
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.001, 0.18 * volume), startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.02);
}

function playCue(cue) {
  const cues = {
    repDone: [[660, 0], [440, 0.14]],
    repStart: [[660, 0]],
    sideChange: [[520, 0]],
    exerciseStart: [[520, 0], [780, 0.14]],
    workoutComplete: [[520, 0], [660, 0.14], [880, 0.28]],
    countdown: [[880, 0]],
  };
  (cues[cue] || []).forEach(([frequency, delay]) => playTone(frequency, 0.11, delay));
}

function currentExercise() {
  return workouts[workoutName][exerciseIndex];
}

function sideForExercise(exercise, index) {
  if (exercise.alternating) return index % 2 === 0 ? "Left" : "Right";
  if (exercise.splitSides) return index < exercise.reps / 2 ? "Left" : "Right";
  return "";
}

function formatTime(seconds) {
  return `00:${String(Math.max(0, seconds)).padStart(2, "0")}`;
}

function phaseName() {
  if (phase === "work") return "Work";
  if (phase === "repRest") return "Rest between reps";
  return "Rest between exercises";
}

function phaseDetail() {
  const exercise = currentExercise();
  if (phase === "work") {
    const side = sideForExercise(exercise, repIndex);
    return `Exercise ${exerciseIndex + 1}${side ? ` · ${side}` : ""}`;
  }
  if (phase === "repRest") return `Next rep · Exercise ${exerciseIndex + 1}`;
  return `Next: Exercise ${exerciseIndex + 2}`;
}

function elapsedSeconds() {
  return running ? (Date.now() - phaseStartedAt) / 1000 : pausedElapsed;
}

function updateDisplay() {
  const remaining = Math.max(0, Math.ceil(phaseDuration - elapsedSeconds()));
  const exercise = currentExercise();
  const totalReps = workouts[workoutName].reduce((total, item) => total + item.reps, 0);
  const completedReps = workouts[workoutName]
    .slice(0, exerciseIndex)
    .reduce((total, item) => total + item.reps, 0) + repIndex;

  phaseLabel.textContent = phase === "complete" ? "Complete" : phaseName();
  phaseLabel.classList.toggle("rest", phase !== "work");
  timeRemaining.textContent = phase === "complete" ? "Done" : formatTime(remaining);
  detailLabel.textContent = phase === "complete" ? `${workoutName === "wakeUp" ? "Wake up" : "Bedtime"} workout finished` : phaseDetail();
  const side = phase === "work" ? sideForExercise(exercise, repIndex) : "";
  sideIndicator.hidden = !side;
  sideIndicator.textContent = side;
  exerciseProgress.textContent = `Exercise ${Math.min(exerciseIndex + 1, 8)} of 8`;
  repProgress.textContent = phase === "complete" ? "All reps complete" : `Rep ${Math.min(repIndex + 1, exercise.reps)} of ${exercise.reps}`;
  progressBar.style.width = `${Math.min(100, (completedReps / totalReps) * 100)}%`;
  const workoutButtonsLocked = running;
  wakeUpButton.disabled = workoutButtonsLocked;
  bedtimeButton.disabled = workoutButtonsLocked;
  document.title = phase === "complete" ? "Workout complete" : `${formatTime(remaining)} · Compound timer`;
  saveState();
}

function setPhase(nextPhase, duration, startAt = Date.now()) {
  phase = nextPhase;
  phaseDuration = duration;
  pausedElapsed = 0;
  phaseStartedAt = startAt;
  lastCountdownSecond = null;
  updateDisplay();
}

function advancePhase(startAt = Date.now()) {
  const exercise = currentExercise();

  if (phase === "work") {
    if (repIndex + 1 < exercise.reps) {
      repIndex += 1;
      playCue("repDone");
      setPhase("repRest", exercise.repRest, startAt);
    } else if (exerciseIndex + 1 < workouts[workoutName].length) {
      playCue("repDone");
      setPhase("exerciseRest", exerciseRests[workoutName][exerciseIndex], startAt);
    } else {
      finishWorkout();
    }
  } else if (phase === "repRest") {
    playCue(exercise.alternating || exercise.splitSides ? "sideChange" : "repStart");
    setPhase("work", exercise.seconds, startAt);
  } else {
    exerciseIndex += 1;
    repIndex = 0;
    playCue("exerciseStart");
    setPhase("work", currentExercise().seconds, startAt);
  }
}

function tick() {
  let transitions = 0;
  while (elapsedSeconds() >= phaseDuration && phase !== "complete" && transitions < 100) {
    advancePhase(phaseStartedAt + phaseDuration * 1000);
    transitions += 1;
  }
  const remaining = Math.ceil(phaseDuration - elapsedSeconds());
  if (remaining > 0 && remaining <= 3 && remaining !== lastCountdownSecond) {
    lastCountdownSecond = remaining;
    playCue("countdown");
  }
  updateDisplay();
}

function startTimer() {
  if (phase === "complete") resetTimer();
  running = true;
  if (!startedAt) startedAt = Date.now();
  requestWakeLock();
  phaseStartedAt = Date.now() - pausedElapsed * 1000;
  startButton.textContent = "Pause";
  clearInterval(intervalId);
  intervalId = setInterval(tick, 200);
  updateDisplay();
}

function pauseTimer() {
  pausedElapsed = elapsedSeconds();
  running = false;
  clearInterval(intervalId);
  startButton.textContent = "Resume";
  saveState();
  updateDisplay();
}

function finishWorkout() {
  running = false;
  clearInterval(intervalId);
  releaseWakeLock();
  phase = "complete";
  playCue("workoutComplete");
  pausedElapsed = 0;
  startButton.textContent = "Start again";
  exerciseIndex = workouts[workoutName].length - 1;
  repIndex = currentExercise().reps - 1;
  const durationMinutes = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
  summaryText.textContent = `${workoutName === "wakeUp" ? "Wake up" : "Bedtime"} routine completed in about ${durationMinutes} minute${durationMinutes === 1 ? "" : "s"}.`;
  completionSummary.hidden = false;
  updateDisplay();
}

function resetTimer() {
  running = false;
  clearInterval(intervalId);
  releaseWakeLock();
  exerciseIndex = 0;
  repIndex = 0;
  phase = "work";
  phaseDuration = workouts[workoutName][0].seconds;
  pausedElapsed = 0;
  lastCountdownSecond = null;
  startedAt = null;
  completionSummary.hidden = true;
  startButton.textContent = "Start";
  updateDisplay();
}

function hasTimerProgress() {
  return phase !== "work" || exerciseIndex !== 0 || repIndex !== 0 || pausedElapsed > 0;
}

function selectWorkout(nextWorkout) {
  if (nextWorkout === workoutName) return;
  if (running) return;
  if (hasTimerProgress()) {
    pendingWorkout = nextWorkout;
    switchDialog.showModal();
    return;
  }
  changeWorkout(nextWorkout);
}

function updateSoundSettings() {
  muted = muteButton.checked;
  volume = Number(volumeSlider.value) / 100;
  volumeValue.textContent = `${volumeSlider.value}%`;
  localStorage.setItem("compound-timer-muted", String(muted));
  localStorage.setItem("compound-timer-volume", String(volume));
}

function changeWorkout(nextWorkout) {
  workoutName = nextWorkout;
  wakeUpButton.classList.toggle("selected", workoutName === "wakeUp");
  bedtimeButton.classList.toggle("selected", workoutName === "bedtime");
  renderOverview();
  resetTimer();
}

function restoreState() {
  const saved = localStorage.getItem(STATE_KEY);
  if (!saved) return;
  try {
    const state = JSON.parse(saved);
    if (!workouts[state.workoutName]) return;
    workoutName = state.workoutName;
    exerciseIndex = Math.min(Math.max(Number(state.exerciseIndex) || 0, 0), workouts[workoutName].length - 1);
    repIndex = Math.min(Math.max(Number(state.repIndex) || 0, 0), currentExercise().reps - 1);
    phase = ["work", "repRest", "exerciseRest", "complete"].includes(state.phase) ? state.phase : "work";
    phaseDuration = Number(state.phaseDuration) > 0 ? Number(state.phaseDuration) : currentExercise().seconds;
    pausedElapsed = Math.max(0, Number(state.pausedElapsed) || 0);
    wakeUpButton.classList.toggle("selected", workoutName === "wakeUp");
    bedtimeButton.classList.toggle("selected", workoutName === "bedtime");
    if (phase === "complete") {
      completionSummary.hidden = false;
      summaryText.textContent = `${workoutName === "wakeUp" ? "Wake up" : "Bedtime"} routine was already completed.`;
      startButton.textContent = "Start again";
    } else if (pausedElapsed > 0 || exerciseIndex > 0 || repIndex > 0 || phase !== "work") {
      startButton.textContent = "Resume";
    }
  } catch (error) {
    console.warn("Saved timer state could not be restored.", error);
    localStorage.removeItem(STATE_KEY);
  }
}

startButton.addEventListener("click", () => (running ? pauseTimer() : startTimer()));
resetButton.addEventListener("click", resetTimer);
skipButton.addEventListener("click", () => {
  if (phase !== "complete") {
    pausedElapsed = phaseDuration;
    if (running) phaseStartedAt = Date.now() - phaseDuration * 1000;
    else advancePhase();
    if (running) tick();
    updateDisplay();
  }
});
wakeUpButton.addEventListener("click", () => selectWorkout("wakeUp"));
bedtimeButton.addEventListener("click", () => selectWorkout("bedtime"));
muteButton.checked = muted;
volumeSlider.value = String(Math.round(volume * 100));
volumeValue.textContent = `${volumeSlider.value}%`;
muteButton.addEventListener("change", updateSoundSettings);
volumeSlider.addEventListener("input", updateSoundSettings);
confirmSwitchButton.addEventListener("click", () => {
  if (pendingWorkout) changeWorkout(pendingWorkout);
  pendingWorkout = null;
});
summaryRestartButton.addEventListener("click", resetTimer);
switchDialog.addEventListener("close", () => {
  pendingWorkout = null;
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && running) requestWakeLock();
});

document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLButtonElement) return;
  if (event.code === "Space") {
    event.preventDefault();
    running ? pauseTimer() : startTimer();
  } else if (event.key.toLowerCase() === "r") {
    resetTimer();
  } else if (event.key.toLowerCase() === "s") {
    skipButton.click();
  }
});

restoreState();
renderOverview();
updateDisplay();
