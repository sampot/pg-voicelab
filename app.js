const synthStatus = document.getElementById("synth-status");
const recStatus = document.getElementById("rec-status");
const supportEl = document.getElementById("support");
const textEl = document.getElementById("text");
const transcriptEl = document.getElementById("transcript");
const interimEl = document.getElementById("interim");
const voiceEl = document.getElementById("voice");
const langEl = document.getElementById("lang");
const rateEl = document.getElementById("rate");
const pitchEl = document.getElementById("pitch");
const rateVal = document.getElementById("rate-val");
const pitchVal = document.getElementById("pitch-val");
const levelFill = document.getElementById("level-fill");
const meter = document.getElementById("meter");

const btnSpeak = document.getElementById("btn-speak");
const btnStop = document.getElementById("btn-stop");
const btnListen = document.getElementById("btn-listen");
const btnRecStop = document.getElementById("btn-rec-stop");
const btnEcho = document.getElementById("btn-echo");
const btnClear = document.getElementById("btn-clear");
const btnToSynth = document.getElementById("btn-to-synth");

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const hasSynth = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
const hasRec = Boolean(SpeechRecognition);

/** @type {SpeechRecognition | null} */
let recognition = null;
let listening = false;
let finalBuf = "";

/** @type {AnalyserNode | null} */
let analyser = null;
/** @type {MediaStream | null} */
let micStream = null;
/** @type {number} */
let meterRaf = 0;

function setSupport() {
  const bits = [];
  bits.push(hasSynth ? "合成 ✓" : "合成 ✗");
  bits.push(hasRec ? "識別 ✓" : "識別 ✗（多需 Chromium + 麥克風權限）");
  supportEl.textContent = bits.join(" · ");
  if (!hasSynth) {
    btnSpeak.disabled = true;
    btnStop.disabled = true;
    btnEcho.disabled = true;
    synthStatus.textContent = "此瀏覽器不支援 speechSynthesis";
  }
  if (!hasRec) {
    btnListen.disabled = true;
    btnRecStop.disabled = true;
    btnEcho.disabled = true;
    recStatus.textContent = "此瀏覽器不支援 SpeechRecognition";
  }
}

function populateVoices() {
  if (!hasSynth) return;
  const voices = speechSynthesis.getVoices();
  const lang = langEl.value;
  const preferred = voices.filter(v => v.lang.toLowerCase().startsWith(lang.slice(0, 2)));
  const list = preferred.length ? preferred : voices;
  const prev = voiceEl.value;
  voiceEl.innerHTML = "";
  if (!list.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "（尚無語音，稍後自動載入）";
    voiceEl.appendChild(opt);
    return;
  }
  for (const v of list) {
    const opt = document.createElement("option");
    opt.value = v.name;
    opt.textContent = `${v.name} (${v.lang})`;
    voiceEl.appendChild(opt);
  }
  if ([...voiceEl.options].some(o => o.value === prev)) voiceEl.value = prev;
}

function speak(text) {
  if (!hasSynth) return;
  const t = (text ?? textEl.value).trim();
  if (!t) {
    synthStatus.textContent = "先輸入要念的文字";
    return;
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(t);
  u.lang = langEl.value;
  u.rate = Number(rateEl.value);
  u.pitch = Number(pitchEl.value);
  const name = voiceEl.value;
  const voice = speechSynthesis.getVoices().find(v => v.name === name);
  if (voice) u.voice = voice;
  u.onstart = () => {
    synthStatus.textContent = "播放中…";
    btnSpeak.classList.add("hot");
  };
  u.onend = () => {
    synthStatus.textContent = "播放結束";
    btnSpeak.classList.remove("hot");
  };
  u.onerror = e => {
    synthStatus.textContent = `合成錯誤：${e.error || "unknown"}`;
    btnSpeak.classList.remove("hot");
  };
  speechSynthesis.speak(u);
}

function stopSpeak() {
  if (!hasSynth) return;
  speechSynthesis.cancel();
  synthStatus.textContent = "已停止";
  btnSpeak.classList.remove("hot");
}

async function ensureMeter() {
  if (analyser) return;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const src = ac.createMediaStreamSource(micStream);
    analyser = ac.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    meter.hidden = false;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (!analyser) return;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      levelFill.style.width = `${Math.min(100, rms * 280)}%`;
      meterRaf = requestAnimationFrame(tick);
    };
    meterRaf = requestAnimationFrame(tick);
  } catch {
    /* mic meter optional; recognition may still prompt */
  }
}

function stopMeter() {
  cancelAnimationFrame(meterRaf);
  meterRaf = 0;
  if (micStream) {
    for (const t of micStream.getTracks()) t.stop();
    micStream = null;
  }
  analyser = null;
  levelFill.style.width = "0%";
  meter.hidden = true;
}

function startListen() {
  if (!hasRec || listening) return;
  recognition = new SpeechRecognition();
  recognition.lang = langEl.value;
  recognition.continuous = true;
  recognition.interimResults = true;
  finalBuf = transcriptEl.value ? transcriptEl.value.replace(/\s*$/, "") : "";
  if (finalBuf) finalBuf += "\n";

  recognition.onstart = () => {
    listening = true;
    recStatus.textContent = "聆聽中…（再按停止結束）";
    btnListen.classList.add("hot");
    void ensureMeter();
  };
  recognition.onresult = event => {
    let interim = "";
    let chunk = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      if (r.isFinal) chunk += r[0].transcript;
      else interim += r[0].transcript;
    }
    if (chunk) {
      finalBuf += chunk;
      transcriptEl.value = finalBuf.trimStart();
    }
    interimEl.textContent = interim ? `… ${interim}` : "";
  };
  recognition.onerror = e => {
    recStatus.textContent = `識別：${e.error || "error"}`;
    if (e.error === "not-allowed") {
      recStatus.textContent = "麥克風被拒——請在瀏覽器允許權限";
    }
  };
  recognition.onend = () => {
    listening = false;
    btnListen.classList.remove("hot");
    interimEl.textContent = "";
    if (recStatus.textContent.startsWith("聆聽")) {
      recStatus.textContent = "已停止聆聽";
    }
    stopMeter();
  };
  try {
    recognition.start();
  } catch (err) {
    recStatus.textContent = String(err?.message || err);
  }
}

function stopListen() {
  if (recognition) {
    try {
      recognition.stop();
    } catch {
      /* ignore */
    }
  }
  listening = false;
  btnListen.classList.remove("hot");
  stopMeter();
}

btnSpeak.addEventListener("click", () => speak());
btnStop.addEventListener("click", stopSpeak);
btnListen.addEventListener("click", () => {
  if (listening) stopListen();
  else startListen();
});
btnRecStop.addEventListener("click", stopListen);
btnClear.addEventListener("click", () => {
  transcriptEl.value = "";
  interimEl.textContent = "";
  finalBuf = "";
});
btnToSynth.addEventListener("click", () => {
  const t = transcriptEl.value.trim();
  if (!t) {
    recStatus.textContent = "轉錄區是空的";
    return;
  }
  textEl.value = t;
  synthStatus.textContent = "已把轉錄貼到合成區";
});
btnEcho.addEventListener("click", async () => {
  // listen once-ish then speak
  if (!hasRec || !hasSynth) return;
  stopSpeak();
  stopListen();
  transcriptEl.value = "";
  finalBuf = "";
  interimEl.textContent = "";
  recStatus.textContent = "回聲模式：請說一句，停頓後會念出來";
  recognition = new SpeechRecognition();
  recognition.lang = langEl.value;
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.onresult = event => {
    let text = "";
    for (let i = 0; i < event.results.length; i++) {
      text += event.results[i][0].transcript;
    }
    transcriptEl.value = text;
    interimEl.textContent = event.results[event.results.length - 1]?.isFinal
      ? ""
      : `… ${text}`;
    if (event.results[event.results.length - 1]?.isFinal) {
      textEl.value = text.trim();
      speak(text.trim());
    }
  };
  recognition.onerror = e => {
    recStatus.textContent = `回聲失敗：${e.error || "error"}`;
  };
  recognition.onend = () => {
    listening = false;
    stopMeter();
    if (!transcriptEl.value.trim()) recStatus.textContent = "沒聽到內容";
    else recStatus.textContent = "回聲完成";
  };
  listening = true;
  void ensureMeter();
  recognition.start();
});

rateEl.addEventListener("input", () => {
  rateVal.textContent = Number(rateEl.value).toFixed(1);
});
pitchEl.addEventListener("input", () => {
  pitchVal.textContent = Number(pitchEl.value).toFixed(1);
});
langEl.addEventListener("change", () => {
  populateVoices();
  if (listening) {
    stopListen();
    recStatus.textContent = "語系已改，請重新聆聽";
  }
});

setSupport();
rateVal.textContent = Number(rateEl.value).toFixed(1);
pitchVal.textContent = Number(pitchEl.value).toFixed(1);
populateVoices();
if (hasSynth) {
  speechSynthesis.addEventListener("voiceschanged", populateVoices);
  // some engines need a kick
  speechSynthesis.getVoices();
}
