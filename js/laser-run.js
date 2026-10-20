(function () {
  "use strict";

  /* =========================================================
     LASER RUN — observation
     Enchaînement : tours → séance de tir (5 tirs réussis ou
     temps expiré) → tours … → derniers tours → arrivée.
     L'état est conservé avec des horodatages (Date.now) pour
     survivre à un rechargement de l'iPad.
  ========================================================= */

  const KEY = "chronoCarnetEPS_laserrun_v1";
  const TARGET = 5;
  const $ = id => document.getElementById(id);

  const panel = $("laserRunPanel");
  if (!panel) return;

  const fresh = (prev) => ({
    phase: "setup",            // setup | running | shooting | done
    name: "",
    sex: prev ? prev.sex : "F",
    lapsPer: prev ? prev.lapsPer : 3,
    sessions: prev ? prev.sessions : 3,
    dist: prev ? prev.dist : 200,
    lapsDone: 0,
    sessionsDone: 0,
    segStart: 0,
    laps: [],
    shoots: [],
    hit: 0,
    miss: 0
  });

  let s;
  try {
    s = Object.assign(fresh(), JSON.parse(localStorage.getItem(KEY) || "{}"));
  } catch {
    s = fresh();
  }

  let raf = 0;
  let resetTimer = 0;
  let wakeLock = null;

  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
  };

  const clampInt = (v, min, max, fallback) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };

  // La bibliothèque QR de l'app ne gère pas les caractères non ASCII.
  const qrSafe = v => String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 .,'_\-\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const sum = arr => arr.reduce((a, b) => a + b, 0);
  const isLive = () => s.phase === "running" || s.phase === "shooting";

  function fmt(ms) {
    const t = Math.max(0, Math.floor(ms / 100));
    const tenths = t % 10;
    const total = Math.floor(t / 10);
    const sec = total % 60;
    const min = Math.floor(total / 60);
    return min + ":" + String(sec).padStart(2, "0") + "." + tenths;
  }

  function elapsed(now) {
    const done = sum(s.laps) + sum(s.shoots.map(x => x.time));
    return done + (isLive() ? now - s.segStart : 0);
  }

  /* ---------- Actions ---------- */

  function start() {
    s.name = $("lrName").value.trim() || "Anonyme";
    s.sex = $("lrSex").value === "M" ? "M" : "F";
    s.lapsPer = clampInt($("lrLapsPer").value, 1, 20, 3);
    s.sessions = clampInt($("lrSessions").value, 1, 10, 3);
    s.dist = clampInt($("lrDist").value, 10, 2000, 200);
    s.lapsDone = 0;
    s.sessionsDone = 0;
    s.laps = [];
    s.shoots = [];
    s.hit = 0;
    s.miss = 0;
    s.phase = "running";
    s.segStart = Date.now();
    save();
    acquireWake();
    render();
    loop();
  }

  function lap() {
    if (s.phase !== "running") return;
    const now = Date.now();
    s.laps.push(now - s.segStart);
    s.lapsDone++;
    s.segStart = now;

    if (s.lapsDone >= s.lapsPer) {
      if (s.sessionsDone >= s.sessions) {
        s.phase = "done";
        releaseWake();
      } else {
        s.phase = "shooting";
        s.hit = 0;
        s.miss = 0;
      }
    }
    save();
    render();
  }

  function hit() {
    if (s.phase !== "shooting" || s.hit >= TARGET) return;
    s.hit++;
    if (s.hit >= TARGET) {
      endShoot();
      return;
    }
    save();
    render();
  }

  function miss() {
    if (s.phase !== "shooting") return;
    s.miss++;
    save();
    render();
  }

  function endShoot() {
    if (s.phase !== "shooting") return;
    const now = Date.now();
    s.shoots.push({
      n: s.sessionsDone + 1,
      time: now - s.segStart,
      hits: s.hit,
      misses: s.miss
    });
    s.sessionsDone++;
    s.hit = 0;
    s.miss = 0;
    s.lapsDone = 0;
    s.phase = "running";
    s.segStart = now;
    save();
    render();
  }

  function resetNow() {
    s = fresh(s);
    clearTimeout(resetTimer);
    resetTimer = 0;
    $("lrReset").textContent = "Réinitialiser la course";
    $("lrReset").classList.remove("lrArmed");
    releaseWake();
    save();
    render();
  }

  function resetClick() {
    const btn = $("lrReset");
    if (!resetTimer) {
      btn.textContent = "Confirmer : tout effacer ?";
      btn.classList.add("lrArmed");
      resetTimer = setTimeout(() => {
        resetTimer = 0;
        btn.textContent = "Réinitialiser la course";
        btn.classList.remove("lrArmed");
      }, 4000);
      return;
    }
    resetNow();
  }

  /* ---------- Écran toujours allumé pendant la course ---------- */

  async function acquireWake() {
    try {
      if (navigator.wakeLock && !wakeLock) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => { wakeLock = null; });
      }
    } catch {}
  }

  function releaseWake() {
    try { wakeLock && wakeLock.release(); } catch {}
    wakeLock = null;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && isLive() && isOpen()) acquireWake();
  });

  /* ---------- Rendu ---------- */

  const show = (id, on) => $(id).classList.toggle("hidden", !on);

  function renderPlan() {
    const l = clampInt($("lrLapsPer").value, 1, 20, 3);
    const n = clampInt($("lrSessions").value, 1, 10, 3);
    const d = clampInt($("lrDist").value, 10, 2000, 200);
    const totalLaps = l * (n + 1);
    $("lrPlan").textContent =
      l + " tour" + (l > 1 ? "s" : "") + " · tir ×" + n + " · " + l + " tour" + (l > 1 ? "s" : "") +
      " en fin de course — soit " + totalLaps + " tours (" + (totalLaps * d) + " m) et " + n * TARGET + " tirs.";
  }

  function renderTimes() {
    const now = Date.now();
    $("lrTotal").textContent = fmt(elapsed(now));
    $("lrShootTime").textContent = s.phase === "shooting" ? fmt(now - s.segStart) : "0:00.0";
  }

  function render() {
    const setup = s.phase === "setup";
    const live = isLive();
    const done = s.phase === "done";

    show("lrSetup", setup);
    show("lrLive", live);
    show("lrResults", done);

    if (setup) {
      $("lrName").value = s.name;
      $("lrSex").value = s.sex;
      $("lrLapsPer").value = s.lapsPer;
      $("lrSessions").value = s.sessions;
      $("lrDist").value = s.dist;
      renderPlan();
    }

    if (live) {
      const running = s.phase === "running";
      show("lrRunControls", running);
      show("lrShootControls", !running);

      const st = $("lrStatus");
      st.textContent = running ? "En course" : "Au tir";
      st.className = "statusPill " + (running ? "lrRun" : "lrShoot");
      $("lrBoard").dataset.phase = s.phase;
      $("lrRunnerName").textContent = s.name;
      $("lrSessionCount").textContent = s.sessionsDone + " / " + s.sessions;
      $("lrMissCount").textContent = String(s.miss);

      if (running) {
        const finalBlock = s.sessionsDone >= s.sessions;
        const lastLap = s.lapsDone + 1 >= s.lapsPer;
        $("lrLapInfo").textContent = finalBlock
          ? "Tours finaux · tour " + (s.lapsDone + 1) + " / " + s.lapsPer
          : "Avant le tir n°" + (s.sessionsDone + 1) + " · tour " + (s.lapsDone + 1) + " / " + s.lapsPer;
        $("lrLapLabel").textContent = lastLap ? (finalBlock ? "Arrivée" : "Aller au tir") : "Tour complété";
        $("lrLapSub").textContent = lastLap
          ? (finalBlock ? "Dernier tour terminé" : "Dernier tour avant le tir")
          : "Appuie à chaque passage";
        $("lrLap").dataset.kind = lastLap ? (finalBlock ? "finish" : "shoot") : "lap";

        const dots = $("lrLapDots");
        const count = Math.min(s.lapsPer, 20);
        if (dots.children.length !== count) {
          dots.innerHTML = "<i></i>".repeat(count);
        }
        [...dots.children].forEach((d, i) => {
          d.className = i < s.lapsDone ? "on" : i === s.lapsDone ? "cur" : "";
        });
      } else {
        $("lrShootInfo").textContent =
          "Séance de tir n°" + (s.sessionsDone + 1) + " / " + s.sessions +
          " · " + s.hit + " / " + TARGET + " réussis";
        $("lrHitSub").textContent = s.hit + " / " + TARGET;
        [...$("lrLeds").children].forEach((led, i) => led.classList.toggle("on", i < s.hit));
      }
      renderTimes();
    }

    if (done) renderResults();
  }

  function renderResults() {
    const lapTotal = sum(s.laps);
    const shootTotal = sum(s.shoots.map(x => x.time));
    const total = lapTotal + shootTotal;
    const avgLap = s.laps.length ? lapTotal / s.laps.length : 0;
    const speed = lapTotal > 0 ? (s.laps.length * s.dist) / (lapTotal / 1000) : 0;
    const hits = sum(s.shoots.map(x => x.hits));
    const misses = sum(s.shoots.map(x => x.misses));
    const attempts = hits + misses;
    const rate = attempts ? hits / attempts * 100 : 0;

    $("lrFinalName").textContent = s.name;
    $("lrFSex").textContent = "· " + (s.sex === "M" ? "Garçon" : "Fille");
    $("lrFTotal").textContent = fmt(total);
    $("lrFRun").textContent = fmt(lapTotal);
    $("lrFShoot").textContent = fmt(shootTotal);
    $("lrFSpeed").textContent = speed.toFixed(2) + " m/s · " + (speed * 3.6).toFixed(1) + " km/h";
    $("lrFAvgLap").textContent = fmt(avgLap);
    $("lrFRate").textContent = rate.toFixed(0) + " % (" + hits + "/" + attempts + ")";

    $("lrLapCount").textContent = String(s.laps.length);
    $("lrShootCount").textContent = String(s.shoots.length);

    $("lrLapList").innerHTML = s.laps.length
      ? s.laps.map((t, i) => "<div><span>Tour " + (i + 1) + "</span><b>" + fmt(t) + "</b></div>").join("")
      : "<p class=\"empty\">Aucun tour.</p>";

    $("lrShootList").innerHTML = s.shoots.length
      ? s.shoots.map(x => {
          const a = x.hits + x.misses;
          const r = a ? Math.round(x.hits / a * 100) : 0;
          return "<div><span>Tir n°" + x.n + " · " + x.hits + "/" + a + " (" + r + " %)</span><b>" + fmt(x.time) + "</b></div>";
        }).join("")
      : "<p class=\"empty\">Aucune séance de tir.</p>";

    const box = $("lrQrBox");
    box.innerHTML = "";
    if (window.QRCode) {
      try {
        new QRCode(box, {
          text: JSON.stringify({
            nom: qrSafe(s.name),
            sexe: s.sex,
            tempsTotal: fmt(total),
            tempsTir: fmt(shootTotal),
            efficacite: rate.toFixed(1) + "%"
          }),
          width: 200,
          height: 200,
          correctLevel: QRCode.CorrectLevel.M
        });
      } catch (error) {
        console.error("QR Laser Run", error);
        box.innerHTML = "<p class=\"empty\">Impossible de générer le QR code.</p>";
      }
    } else {
      box.innerHTML = "<p class=\"empty\">Générateur QR indisponible. Ouvre une fois l’application avec Internet.</p>";
    }
  }

  function loop() {
    cancelAnimationFrame(raf);
    const step = () => {
      if (isLive() && isOpen()) {
        renderTimes();
        raf = requestAnimationFrame(step);
      }
    };
    raf = requestAnimationFrame(step);
  }

  /* ---------- Ouverture / fermeture ---------- */

  const isOpen = () => document.body.classList.contains("laser-active");

  function updateCardHint() {
    const hint = $("laserRunCardHint");
    if (!hint) return;
    hint.textContent = isLive()
      ? "Course en cours · " + s.name + " — appuie pour reprendre."
      : "Observation : tours, séances de tir, temps et QR professeur.";
  }

  function open() {
    document.body.classList.add("laser-active");
    panel.classList.remove("hidden");
    render();
    if (isLive()) {
      acquireWake();
      loop();
    }
    window.scrollTo({ top: 0 });
  }

  function close() {
    document.body.classList.remove("laser-active");
    panel.classList.add("hidden");
    cancelAnimationFrame(raf);
    updateCardHint();
    window.scrollTo({ top: 0 });
  }

  /* ---------- Branchements ---------- */

  $("openLaserRun").onclick = open;
  $("lrBack").onclick = close;
  $("lrStart").onclick = start;
  $("lrLap").onclick = lap;
  $("lrHit").onclick = hit;
  $("lrMiss").onclick = miss;
  $("lrExpire").onclick = endShoot;
  $("lrReset").onclick = resetClick;
  $("lrNew").onclick = () => { s = fresh(s); save(); render(); };

  ["lrName", "lrSex", "lrLapsPer", "lrSessions", "lrDist"].forEach(id => {
    $(id).addEventListener("input", () => {
      if (s.phase !== "setup") return;
      s.name = $("lrName").value;
      s.sex = $("lrSex").value === "M" ? "M" : "F";
      s.lapsPer = clampInt($("lrLapsPer").value, 1, 20, s.lapsPer);
      s.sessions = clampInt($("lrSessions").value, 1, 10, s.sessions);
      s.dist = clampInt($("lrDist").value, 10, 2000, s.dist);
      renderPlan();
      save();
    });
  });

  updateCardHint();
})();
