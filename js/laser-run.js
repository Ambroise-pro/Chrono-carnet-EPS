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
    last: "",
    first: "",
    classroom: "",
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
    miss: 0,
    seq: "",                   // tirs de la séance en cours : "h" réussi, "m" raté
    skip: 0,                   // temps de tours non terminés (ms), compté dans la course
    pend: null                 // comment on est entré au tir, pour pouvoir annuler
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

  const displayName = () => s.last.toUpperCase() + " " + s.first;

  function toastMsg(text) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  // Même identifiant élève que les autres activités (nom|prénom|classe).
  function studentId() {
    const k = [s.last, s.first, s.classroom].map(v => String(v).trim().toUpperCase()).join("|");
    let h = 2166136261;
    for (let i = 0; i < k.length; i++) {
      h ^= k.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return "STD-" + (h >>> 0).toString(16).padStart(8, "0");
  }

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
    const done = sum(s.laps) + s.skip + sum(s.shoots.map(x => x.time));
    return done + (isLive() ? now - s.segStart : 0);
  }

  /* ---------- Actions ---------- */

  function start() {
    const last = $("lrLast").value.trim();
    const first = $("lrFirst").value.trim();
    const cls = $("lrClass").value.trim().toUpperCase();
    if (!last || !first) return toastMsg("Nom et prénom sont obligatoires.");
    if (!cls) return toastMsg("La classe est obligatoire.");
    s.last = last;
    s.first = first;
    s.classroom = cls;
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
    s.seq = "";
    s.skip = 0;
    s.pend = null;
    s.phase = "running";
    s.segStart = Date.now();
    save();
    acquireWake();
    render();
    loop();
  }

  function enterShoot(pend) {
    s.phase = "shooting";
    s.hit = 0;
    s.miss = 0;
    s.seq = "";
    s.pend = pend;
  }

  function lap() {
    if (s.phase !== "running") return;
    const now = Date.now();
    const dur = now - s.segStart;
    s.laps.push(dur);
    s.lapsDone++;
    s.segStart = now;

    if (s.lapsDone >= s.lapsPer) {
      if (s.sessionsDone >= s.sessions) {
        s.phase = "done";
        s.pend = { kind: "lap", dur, lapsDone: s.lapsDone - 1 };
        releaseWake();
      } else {
        enterShoot({ kind: "lap", dur, lapsDone: s.lapsDone - 1 });
      }
    }
    save();
    render();
  }

  // Passer au tir sans finir le tour : le temps déjà couru reste dans la course.
  function skipToShoot() {
    if (s.phase !== "running" || s.sessionsDone >= s.sessions) return;
    const now = Date.now();
    const dur = now - s.segStart;
    s.skip += dur;
    s.segStart = now;
    enterShoot({ kind: "skip", dur, lapsDone: s.lapsDone });
    save();
    render();
  }

  function hit() {
    if (s.phase !== "shooting" || s.hit >= TARGET) return;
    s.hit++;
    s.seq += "h";
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
    s.seq += "m";
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
      misses: s.miss,
      seq: s.seq,
      pend: s.pend
    });
    s.sessionsDone++;
    s.hit = 0;
    s.miss = 0;
    s.seq = "";
    s.pend = null;
    s.lapsDone = 0;
    s.phase = "running";
    s.segStart = now;
    save();
    render();
  }

  /* ---------- Annulations : le temps continue de courir ---------- */

  // Revient à l'état d'avant l'entrée au tir (dernier tour ou saut de tour).
  function revertToRunning(pend) {
    if (pend.kind === "lap") s.laps.pop();
    else s.skip = Math.max(0, s.skip - pend.dur);
    s.lapsDone = pend.lapsDone;
    s.phase = "running";
    s.segStart -= pend.dur;
    s.hit = 0;
    s.miss = 0;
    s.seq = "";
    s.pend = null;
  }

  function undoLap() {
    if (s.phase !== "running") return;
    if (s.lapsDone > 0) {
      const dur = s.laps.pop();
      s.lapsDone--;
      s.segStart -= dur;
    } else if (s.sessionsDone > 0) {
      // Rouvre la dernière séance de tir.
      const last = s.shoots.pop();
      s.sessionsDone--;
      s.phase = "shooting";
      s.segStart -= last.time;
      s.hit = last.hits;
      s.miss = last.misses;
      s.seq = last.seq || "h".repeat(last.hits) + "m".repeat(last.misses);
      s.pend = last.pend || null;
      s.lapsDone = s.lapsPer;
    } else {
      return toastMsg("Rien à annuler.");
    }
    save();
    render();
  }

  function undoShot() {
    if (s.phase !== "shooting") return;
    if (s.seq.length) {
      const last = s.seq[s.seq.length - 1];
      s.seq = s.seq.slice(0, -1);
      if (last === "h") s.hit--;
      else s.miss--;
    } else if (s.pend) {
      revertToRunning(s.pend);
    } else {
      return toastMsg("Rien à annuler.");
    }
    save();
    render();
  }

  function undoFinish() {
    if (s.phase !== "done" || !s.pend) return;
    const dur = s.laps.pop();
    s.lapsDone = s.pend.lapsDone;
    s.phase = "running";
    s.segStart = Date.now() - dur;
    s.pend = null;
    save();
    acquireWake();
    render();
    loop();
  }

  function resetNow() {
    s = fresh(s);
    clearTimeout(resetTimer);
    resetTimer = 0;
    $("lrReset").textContent = "Réinitialiser";
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
        btn.textContent = "Réinitialiser";
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
    const total = elapsed(now);
    const shootDone = sum(s.shoots.map(x => x.time));
    const shootNow = s.phase === "shooting" ? now - s.segStart : 0;
    $("lrTotal").textContent = fmt(total);
    $("lrTotal2").textContent = fmt(total);
    $("lrRunTime").textContent = fmt(total - shootDone - shootNow);
    $("lrShootTotal").textContent = fmt(shootDone + shootNow);
    $("lrShootTime").textContent = fmt(shootNow);
  }

  function renderSteps() {
    const wrap = $("lrSteps");
    const html = [];
    for (let b = 0; b <= s.sessions; b++) {
      for (let i = 0; i < s.lapsPer; i++) {
        let st = "todo";
        if (b < s.sessionsDone) st = "done";
        else if (b === s.sessionsDone) {
          if (s.phase === "shooting" || s.phase === "done" || i < s.lapsDone) st = "done";
          else if (i === s.lapsDone) st = "cur";
        }
        html.push('<i class="lrLapPip ' + st + '"></i>');
      }
      if (b < s.sessions) {
        const st = b < s.sessionsDone ? "done" : (b === s.sessionsDone && s.phase === "shooting") ? "cur" : "todo";
        html.push('<i class="lrShotNode ' + st + '"><svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><circle cx="11" cy="11" r="3.5"/></svg></i>');
      }
    }
    html.push('<i class="lrFlagNode"><svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 20V3"/><path d="M5 4h11l-2.5 4L16 12H5"/></svg></i>');
    wrap.innerHTML = html.join("");
    const totalLaps = s.lapsPer * (s.sessions + 1);
    $("lrTrackInfo").textContent =
      totalLaps + " tours · " + s.sessions + " tir" + (s.sessions > 1 ? "s" : "") + " · " + (totalLaps * s.dist) + " m";
  }

  function render() {
    const setup = s.phase === "setup";
    const live = isLive();
    const done = s.phase === "done";

    show("lrSetup", setup);
    show("lrLive", live);
    show("lrResults", done);

    $("lrKicker").textContent = done ? "Laser Run · résultats" : setup ? "Laser Run · observation" : "Laser Run · observation";
    $("lrIdentity").textContent = setup ? "" : "· " + s.classroom + " · " + (s.sex === "M" ? "Garçon" : "Fille");
    $("lrTitle").firstChild.textContent = setup ? "Laser Run " : displayName() + " ";
    show("lrStatus", !setup);
    show("lrReset", live);

    const st = $("lrStatus");
    if (done) {
      st.textContent = "Course terminée";
      st.className = "lrPill lrDone";
    } else if (live) {
      const running = s.phase === "running";
      st.textContent = running ? "En course" : "Au tir · séance " + (s.sessionsDone + 1) + " / " + s.sessions;
      st.className = "lrPill " + (running ? "lrRun" : "lrShoot");
    }

    if (setup) {
      $("lrLast").value = s.last;
      $("lrFirst").value = s.first;
      $("lrClass").value = s.classroom;
      $("lrSex").value = s.sex;
      $("lrLapsPer").value = s.lapsPer;
      $("lrSessions").value = s.sessions;
      $("lrDist").value = s.dist;
      renderPlan();
    }

    if (live) {
      const running = s.phase === "running";
      show("lrRunView", running);
      show("lrShootView", !running);

      if (running) {
        const finalBlock = s.sessionsDone >= s.sessions;
        const lastLap = s.lapsDone + 1 >= s.lapsPer;
        $("lrLapInfo").textContent = finalBlock
          ? "Tours finaux · tour " + (s.lapsDone + 1) + " / " + s.lapsPer
          : "Avant le tir n°" + (s.sessionsDone + 1) + " · tour " + (s.lapsDone + 1) + " / " + s.lapsPer;
        $("lrLapStats").textContent = s.laps.length
          ? "Dernier tour " + fmt(s.laps[s.laps.length - 1]) + " · moyenne " + fmt(sum(s.laps) / s.laps.length)
          : "Pas encore de tour";
        $("lrLapLabel").textContent = lastLap ? (finalBlock ? "Arrivée" : "Aller au tir") : "Tour complété";
        $("lrLapSub").textContent = lastLap
          ? (finalBlock ? "Dernier tour terminé" : "Dernier tour avant le tir")
          : "Appuie à chaque passage devant la ligne";
        $("lrLap").dataset.kind = lastLap ? (finalBlock ? "finish" : "shoot") : "lap";
        show("lrSkip", !finalBlock);
        $("lrUndoLap").disabled = s.lapsDone === 0 && s.sessionsDone === 0;
        renderSteps();
      } else {
        const leds = $("lrLeds");
        if (leds.children.length !== TARGET) {
          leds.innerHTML = ("<i><svg viewBox=\"0 0 22 22\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\"><circle cx=\"11\" cy=\"11\" r=\"8\"/><circle cx=\"11\" cy=\"11\" r=\"3.5\"/></svg></i>").repeat(TARGET);
        }
        [...leds.children].forEach((led, i) => led.classList.toggle("on", i < s.hit));
        $("lrHitCount").textContent = s.hit + " / " + TARGET + " réussis";
        $("lrMissCount").textContent = String(s.miss);
        $("lrMissSub").textContent = s.miss + " raté" + (s.miss > 1 ? "s" : "") + " dans cette séance";
        $("lrUndoShot").textContent = s.seq.length ? "Annuler le dernier tir" : "Revenir à la course";
        $("lrUndoShot").disabled = !s.seq.length && !s.pend;
      }
      renderTimes();
    }

    if (done) renderResults();
  }

  function renderResults() {
    const lapTotal = sum(s.laps);
    const shootTotal = sum(s.shoots.map(x => x.time));
    const total = lapTotal + s.skip + shootTotal;
    const avgLap = s.laps.length ? lapTotal / s.laps.length : 0;
    const speed = lapTotal > 0 ? (s.laps.length * s.dist) / (lapTotal / 1000) : 0;
    const hits = sum(s.shoots.map(x => x.hits));
    const misses = sum(s.shoots.map(x => x.misses));
    const attempts = hits + misses;
    const rate = attempts ? hits / attempts * 100 : 0;

    $("lrFTotal").textContent = fmt(total);
    $("lrFRun").textContent = fmt(lapTotal + s.skip);
    $("lrFShoot").textContent = fmt(shootTotal);
    $("lrFSpeed").textContent = speed.toFixed(2) + " m/s";
    $("lrFSpeedKmh").textContent = (speed * 3.6).toFixed(1) + " km/h";
    $("lrFAvgLap").textContent = fmt(avgLap);
    $("lrFLapsInfo").textContent = s.laps.length + " tour" + (s.laps.length > 1 ? "s" : "") + " de " + s.dist + " m";
    $("lrFRate").textContent = rate.toFixed(0) + " %";
    $("lrFRateInfo").textContent = hits + " réussi" + (hits > 1 ? "s" : "") + " · " + misses + " raté" + (misses > 1 ? "s" : "");

    $("lrLapCount").textContent = String(s.laps.length);
    $("lrShootCount").textContent = String(s.shoots.length);

    $("lrLapList").innerHTML = s.laps.length
      ? s.laps.map((t, i) => "<div><span>Tour " + (i + 1) + "</span><b>" + fmt(t) + "</b></div>").join("")
      : "<p class=\"empty\">Aucun tour.</p>";

    $("lrShootList").innerHTML = s.shoots.length
      ? s.shoots.map(x => {
          const a = x.hits + x.misses;
          const r = a ? Math.round(x.hits / a * 100) : 0;
          let dots = "";
          for (let i = 0; i < TARGET; i++) dots += "<i class=\"" + (i < x.hits ? "on" : "") + "\"></i>";
          return "<div class=\"lrShootRow\"><span class=\"lrShootN\">Tir n°" + x.n + "</span>" +
            "<span class=\"lrDotsRow\">" + dots + "</span>" +
            "<span class=\"lrShootRate\">" + x.hits + " / " + a + " · " + r + " %</span>" +
            "<b>" + fmt(x.time) + "</b></div>";
        }).join("")
      : "<p class=\"empty\">Aucune séance de tir.</p>";

    const box = $("lrQrBox");
    box.innerHTML = "";
    if (window.QRCode) {
      const payload = {
        type: "DF_TRAINING_RESULT",
        v: 1,
        tool: "laserrun",
        studentId: studentId(),
        last: qrSafe(s.last),
        first: qrSafe(s.first),
        classroom: qrSafe(s.classroom),
        sex: s.sex,
        totalMs: Math.round(total),
        runMs: Math.round(lapTotal + s.skip),
        shootMs: Math.round(shootTotal),
        laps: s.laps.length,
        lapM: s.dist,
        lapsMs: s.laps.map(t => Math.round(t / 10) * 10),   // temps de chaque tour
        hits: hits,
        attempts: attempts,
        createdAt: new Date().toISOString()
      };
      // Un QR a une capacité limitée : on essaie d'abord le plus complet,
      // puis on allège (correction d'erreur basse, puis champs secondaires).
      const attempts_ = [
        [QRCode.CorrectLevel.M, payload],
        [QRCode.CorrectLevel.L, payload],
        [QRCode.CorrectLevel.L, Object.assign({}, payload, { createdAt: undefined, runMs: undefined, shootMs: undefined })]
      ];
      let ok = false;
      for (const [level, data] of attempts_) {
        try {
          box.innerHTML = "";
          new QRCode(box, { text: JSON.stringify(data), width: 220, height: 220, correctLevel: level });
          ok = true;
          break;
        } catch (error) {
          console.warn("QR Laser Run : capacité dépassée, version allégée", error);
        }
      }
      if (!ok) {
        box.innerHTML = "<p class=\"empty\">Trop de tours pour un QR code : réduis le nombre de tours.</p>";
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
      ? "Course en cours · " + displayName() + " — appuie pour reprendre."
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
  $("lrUndoLap").onclick = undoLap;
  $("lrSkip").onclick = skipToShoot;
  $("lrUndoShot").onclick = undoShot;
  $("lrUndoFinish").onclick = undoFinish;
  $("lrToggleLaps").onclick = () => {
    const p = $("lrLapPanel");
    const open = p.classList.toggle("hidden") === false;
    $("lrToggleLaps").textContent = open ? "Masquer le détail des tours" : "Voir le détail des tours";
  };
  $("lrReset").onclick = resetClick;
  $("lrNew").onclick = () => { s = fresh(s); save(); render(); };

  ["lrLast", "lrFirst", "lrClass", "lrSex", "lrLapsPer", "lrSessions", "lrDist"].forEach(id => {
    $(id).addEventListener("input", () => {
      if (s.phase !== "setup") return;
      s.last = $("lrLast").value;
      s.first = $("lrFirst").value;
      s.classroom = $("lrClass").value.toUpperCase();
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
