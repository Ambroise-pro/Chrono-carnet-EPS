"use strict";

(() => {

  const KEY = "chronoCarnetEPS_v4";
  const CARNET_URL = "https://carnetentrainementv2.vercel.app/";
  const $ = id => document.getElementById(id);


  /* =========================================================
     BAREMES CCF EXISTANTS — NE PAS MODIFIER
  ========================================================= */

  const PERF_F = [
    [306,.25],[299,.5],[292,.75],[285,1],
    [278,1.25],[272,1.5],[266,1.75],[260,2],
    [254,2.25],[248,2.5],[242,2.75],[236,3],
    [230,3.25],[225,3.5],[220,3.75],[215,4],
    [210,4.25],[205,4.5],[200,4.75],[195,5],
    [190,5.25],[185,5.5],[180,5.75],[175,6]
  ];

  const PERF_M = [
    [242,.25],[237,.5],[232,.75],[227,1],
    [222,1.25],[217,1.5],[212,1.75],[207,2],
    [202,2.25],[197,2.5],[192,2.75],[188,3],
    [184,3.25],[180,3.5],[176,3.75],[172,4],
    [168,4.25],[165,4.5],[162,4.75],[159,5],
    [156,5.25],[153,5.5],[150,5.75],[147,6]
  ];


  /* =========================================================
     ETAT
  ========================================================= */

  const base = () => ({
    mode: "training",
    trainingTool: "simple",
    view: "setup",

    totalDistance: 1000,
    splitDistance: 100,
    displayMode: "both",
    targetMs: null,

    chronoPlanMode: "single",
    chronoSeriesText: "100 200 300 200 100",
    chronoSeriesDistances: [100,200,300,200,100],
    chronoSeriesWithSplits: false,
    chronoSingleWithSplits: true,
    projectionTarget: "off",
    projectionCustomDistance: 1000,

    timerDurationChoice: "360",
    timerDurationMs: 360000,

    trackDistanceChoice: "300",
    trackDistance: 300,

    vmaProtocol: "6",
    vmaDurationMs: 360000,

    vmaTrackDistanceChoice: "300",
    vmaTrackDistance: 300,

    runners: [],
    results: [],
    timedRuns: [],

    activeRace: 1,
    activeRunnerId: null,

    recoveryStartedAt: null
  });


  let state;

  try {

    state = {
      ...base(),
      ...JSON.parse(
        localStorage.getItem(KEY) || "{}"
      )
    };

  } catch {

    state = base();

  }


  /* Compatibilité avec les anciennes données */

  if (!["training","ccf","exam500"].includes(state.mode)) {
    state.mode = "training";
  }

  if (!["simple","chrono","timer","vma"].includes(state.trainingTool)) {
    state.trainingTool = "simple";
  }

  if (!["single","series"].includes(state.chronoPlanMode)) {
    state.chronoPlanMode = "single";
  }

  if (!Array.isArray(state.chronoSeriesDistances)) {
    state.chronoSeriesDistances = [100,200,300,200,100];
  }

  if (!state.chronoSeriesText) {
    state.chronoSeriesText =
      state.chronoSeriesDistances.join(" ");
  }

  state.chronoSeriesWithSplits =
    !!state.chronoSeriesWithSplits;

  state.chronoSingleWithSplits = state.chronoSingleWithSplits !== false;
  if (!["off", "800", "500", "custom"].includes(state.projectionTarget)) state.projectionTarget = "off";
  state.projectionCustomDistance = Math.min(10000, Math.max(50, Number(state.projectionCustomDistance) || 1000));

  if (!Array.isArray(state.timedRuns)) {
    state.timedRuns = [];
  }

  state.runners = Array.isArray(state.runners)
    ? state.runners.map(runner => ({
        ...runner,
        stopped: !!runner.stopped,
        stoppedReason: runner.stoppedReason || "",
        stoppedAt: runner.stoppedAt || null,
        stoppedRace: runner.stoppedRace || null
      }))
    : [];

  if (!state.timerDurationChoice) {
    state.timerDurationChoice =
      [180000,360000,540000,720000,900000,1200000]
        .includes(state.timerDurationMs)
        ? String(state.timerDurationMs / 1000)
        : "custom";
  }

  if (!state.trackDistanceChoice) {
    state.trackDistanceChoice =
      [100,200,250,300,400].includes(state.trackDistance)
        ? String(state.trackDistance)
        : "custom";
  }

  if (!state.vmaProtocol) {
    state.vmaProtocol =
      state.vmaDurationMs === 720000
        ? "12"
        : state.vmaDurationMs === 360000
          ? "6"
          : "custom";
  }

  if (!state.vmaTrackDistanceChoice) {
    state.vmaTrackDistanceChoice =
      [100,200,250,300,400].includes(state.vmaTrackDistance)
        ? String(state.vmaTrackDistance)
        : "custom";
  }


  let running = false;
  let startedAt = 0;
  let elapsedMs = 0;

  let recoveryTimer = null;
  let exportRunnerId = null;

  let timedLapCount = 0;
  let timedFinished = false;
  let timedActualDurationMs = 0;

  let lapLockedUntil = 0;


  /* =========================================================
     UTILITAIRES
  ========================================================= */

  const save = () =>
    localStorage.setItem(
      KEY,
      JSON.stringify(state)
    );


  const uid = () =>
    Date.now().toString(36) +
    Math.random()
      .toString(36)
      .slice(2,7);


  const esc = v =>
    String(v ?? "")
      .replace(
        /[&<>"']/g,
        c => ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;"
        }[c])
      );


  const fmt = ms => {

    ms = Math.max(
      0,
      Math.round(ms || 0)
    );

    const cs =
      Math.floor(ms % 1000 / 10);

    const s =
      Math.floor(ms / 1000) % 60;

    const m =
      Math.floor(ms / 60000);

    return (
      `${String(m).padStart(2,"0")}:` +
      `${String(s).padStart(2,"0")}.` +
      `${String(cs).padStart(2,"0")}`
    );

  };


  const fmtClock = ms => {

    ms = Math.max(
      0,
      Math.ceil(ms || 0)
    );

    const s =
      Math.floor(ms / 1000) % 60;

    const m =
      Math.floor(ms / 60000);

    return (
      `${String(m).padStart(2,"0")}:` +
      `${String(s).padStart(2,"0")}`
    );

  };


  const short = ms =>
    `${(
      Math.abs(ms || 0) / 1000
    ).toFixed(2)} s`;


  const now = () =>
    elapsedMs +
    (
      running
        ? performance.now() - startedAt
        : 0
    );


  const spd = (distanceM, timeMs) =>
    timeMs
      ? distanceM / (timeMs / 1000) * 3.6
      : 0;


  const signed = v =>
    v == null
      ? "—"
      : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${short(v)}`;


  const isExam500 = () =>
    state.mode === "exam500";

  const isExamMode = () =>
    state.mode === "ccf" ||
    isExam500();

  const isChronoSeries = () =>
    isChrono() &&
    state.chronoPlanMode === "series";

  function parseSeriesDistances(value) {
    return String(value || "")
      .split(/[\s,;\-→>]+/)
      .map(Number)
      .filter(
        distance =>
          Number.isFinite(distance) &&
          distance > 0 &&
          distance <= 10000
      )
      .slice(0,20);
  }

  const raceDistance = (
    race = state.activeRace
  ) => {
    if (isExam500()) {
      return 500;
    }

    if (isChronoSeries()) {
      return (
        Number(
          state.chronoSeriesDistances[
            Math.max(0, race - 1)
          ]
        ) ||
        state.totalDistance
      );
    }

    return state.totalDistance;
  };

  const raceSplitDistance = (
    race = state.activeRace
  ) => {
    if (isExam500()) {
      return 250;
    }

    const distance =
      raceDistance(race);

    if (
      isChrono() &&
      !(isChronoSeries() ? state.chronoSeriesWithSplits : state.chronoSingleWithSplits)
    ) {
      return distance;
    }

    const split =
      Number(state.splitDistance);

    if (
      isChronoSeries() &&
      (
        !split ||
        split >= distance ||
        distance % split !== 0
      )
    ) {
      return distance;
    }

    return split;
  };

  const raceCount = () =>
    isExam500()
      ? 3
      : state.mode === "ccf"
        ? 2
        : isChronoSeries()
          ? state.chronoSeriesDistances.length
          : 1;


  const isSimple = () =>
    state.mode === "training" &&
    state.trainingTool === "simple";


  const isChrono = () =>
    state.mode === "training" &&
    state.trainingTool === "chrono";


  const isTimed = () =>
    state.mode === "training" &&
    ["timer","vma"].includes(
      state.trainingTool
    );


  function setVisible(id, visible) {

    const el = $(id);

    if (el) {
      el.classList.toggle(
        "hidden",
        !visible
      );
    }

  }


  function parseTime(v) {

    if (!v) {
      return null;
    }

    v =
      String(v)
        .trim()
        .replace(/,/g,".");

    let m =
      v.match(
        /^(\d+)\s*:\s*(\d+(?:\.\d+)?)$/
      );

    if (m) {

      return (
        +m[1] * 60 +
        +m[2]
      ) * 1000;

    }

    m =
      v.match(
        /^(\d+(?:\.\d+)?)$/
      );

    if (!m) {
      return null;
    }

    if (
      /^\d{3,4}$/.test(v)
    ) {
      const digits =
        v.replace(/\D/g,"");

      const sec =
        Number(
          digits.slice(-2)
        );

      const min =
        Number(
          digits.slice(0,-2)
        );

      if (sec < 60) {
        return (
          min * 60 +
          sec
        ) * 1000;
      }
    }

    return +m[1] * 1000;

  }


  function safeQrText(value) {

    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g,"")
      .replace(/[’‘‛]/g,"'")
      .replace(/[‐‑‒–—―]/g,"-")
      .replace(/[\u0000-\u001F\u007F]/g," ")
      .replace(/[^A-Za-z0-9 .,'_\-\/]/g," ")
      .replace(/\s+/g," ")
      .trim();

  }


  function stableStudentId(last,first,cls) {

    const s =
      `${String(last).trim().toUpperCase()}|` +
      `${String(first).trim().toUpperCase()}|` +
      `${String(cls).trim().toUpperCase()}`;

    let h = 2166136261;

    for (
      let i = 0;
      i < s.length;
      i++
    ) {

      h ^= s.charCodeAt(i);

      h =
        Math.imul(
          h,
          16777619
        );

    }

    return (
      `STD-${
        (h >>> 0)
          .toString(16)
          .padStart(8,"0")
      }`
    );

  }


  function toast(t) {

    $("toast").textContent = t;
    $("toast").hidden = false;

    clearTimeout(toast.t);

    toast.t =
      setTimeout(
        () =>
          $("toast").hidden = true,
        2200
      );

  }


  function showLapValidatedPopup() {

    let popup =
      $("lapValidatedPopup");

    if (!popup) {

      popup =
        document.createElement(
          "div"
        );

      popup.id =
        "lapValidatedPopup";

      Object.assign(
        popup.style,
        {
          position: "fixed",
          left: "50%",
          top: "46%",
          transform: "translate(-50%,-50%) scale(.72) rotate(-4deg)",
          zIndex: "9999",
          width: "min(300px,72vw)",
          height: "min(300px,72vw)",
          borderRadius: "50%",
          background: "linear-gradient(145deg,#faff00,#39ff88 55%,#00e5ff)",
          color: "#052e16",
          border: "6px solid rgba(255,255,255,.95)",
          fontWeight: "900",
          fontSize: "clamp(24px,6vw,34px)",
          lineHeight: "1.05",
          textAlign: "center",
          boxShadow: "0 0 0 8px rgba(57,255,136,.28),0 18px 55px rgba(0,229,255,.35)",
          opacity: "0",
          pointerEvents: "none",
          transition: "opacity .16s ease, transform .22s cubic-bezier(.2,1.45,.4,1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column"
        }
      );

      popup.innerHTML =
        '<span style="font-size:64px;line-height:.9">✓</span>' +
        '<span>TOUR<br>VALIDÉ !</span>' +
        '<span style="font-size:22px;margin-top:10px">⚡</span>';

      document.body.appendChild(
        popup
      );

    }

    clearTimeout(
      showLapValidatedPopup.t
    );

    popup.style.opacity =
      "0";

    popup.style.transform =
      "translate(-50%,-50%) scale(.72) rotate(-4deg)";

    requestAnimationFrame(
      () =>
        requestAnimationFrame(
          () => {
            popup.style.opacity =
              "1";
            popup.style.transform =
              "translate(-50%,-50%) scale(1) rotate(0deg)";
          }
        )
    );

    showLapValidatedPopup.t =
      setTimeout(
        () => {
          popup.style.opacity =
            "0";
          popup.style.transform =
            "translate(-50%,-50%) scale(1.12) rotate(3deg)";
        },
        3000
      );

  }


  function confirmLapRecorded() {

    lapLockedUntil =
      performance.now() +
      3000;

    const button =
      $("lapBtn");

    if (button) {

      button.textContent =
        "✓ TOUR VALIDÉ";

      button.disabled =
        true;

      setTimeout(
        () => {

          if ($("lapBtn")) {
            $("lapBtn").textContent =
              lapActionLabel();
          }

        },
        3000
      );

    }

    showLapValidatedPopup();

    navigator.vibrate?.(35);

  }


  /* =========================================================
     RESULTATS CLASSIQUES / CCF
  ========================================================= */

  const rr = (
    id,
    race = state.activeRace
  ) =>
    state.results.filter(
      x =>
        x.runnerId === id &&
        x.race === race
    );


  const requiredSplits = (
    race = state.activeRace
  ) =>
    Math.max(
      1,
      Math.floor(
        raceDistance(race) /
        raceSplitDistance(race)
      )
    );


  const activeRunner = () =>
    state.runners.find(
      r =>
        r.id === state.activeRunnerId
    ) || null;


  const runnerStopped = id =>
    !!state.runners.find(
      runner =>
        runner.id === id &&
        runner.stopped
    );


  const done = (
    id,
    race = state.activeRace
  ) =>
    runnerStopped(id) ||
    rr(id,race).length >=
    requiredSplits(race);


  const allDone = race =>
    state.runners.length > 0 &&
    state.runners.every(
      r =>
        done(r.id,race)
    );


  const timedRunFor = (
    id,
    tool = state.trainingTool
  ) =>
    state.timedRuns.find(
      x =>
        x.runnerId === id &&
        x.tool === tool
    ) || null;


  /* =========================================================
     CCF
  ========================================================= */

  function perfPoints(sex,ms) {

    if (!ms) {
      return 0;
    }

    let p = 0;

    for (
      const [limit,pts]
      of
      (
        sex === "F"
          ? PERF_F
          : PERF_M
      )
    ) {

      if (
        ms / 1000 <= limit
      ) {
        p = pts;
      }

    }

    return p;

  }


  function regularityPoints(ms) {

    if (ms == null) return 0;

    const s = ms / 1000;

    if (s > 21) return 0;
    if (s >= 20) return .5;
    if (s >= 18) return 1;
    if (s >= 16) return 1.5;
    if (s >= 14) return 2;
    if (s >= 12) return 2.5;
    if (s >= 10) return 3;
    if (s >= 9) return 3.5;
    if (s >= 8) return 4;
    if (s >= 7) return 4.5;
    if (s >= 6) return 5;
    if (s >= 5) return 5.5;
    if (s < 4) return 6;

    return 5.5;

  }


  function ccfSummary(r) {

    const a1 = rr(r.id,1);
    const a2 = rr(r.id,2);

    const t1 =
      a1.length === 4
        ? a1.at(-1).cumulativeMs
        : null;

    const t2 =
      a2.length === 4
        ? a2.at(-1).cumulativeMs
        : null;

    const laps = [
      ...a1,
      ...a2
    ].map(
      x => x.lapMs
    );

    const best =
      [t1,t2]
        .filter(Boolean)
        .sort((a,b) => a-b)[0] ||
      null;

    const spread =
      laps.length === 8
        ? Math.max(...laps) -
          Math.min(...laps)
        : null;

    const perf =
      perfPoints(
        r.sex,
        best
      );

    const reg =
      regularityPoints(
        spread
      );

    return {
      t1,
      t2,
      best,
      spread,
      perf,
      reg,
      total: perf + reg,
      complete:
        !!(
          t1 &&
          t2 &&
          laps.length === 8
        )
    };

  }


  /* =========================================================
     CONFIGURATION
  ========================================================= */

  function readConfig() {

    if (
      state.mode === "ccf"
    ) {

      state.totalDistance = 800;
      state.splitDistance = 200;
      state.displayMode = "cumulative";

      return;

    }

    if (isExam500()) {

      state.totalDistance = 500;
      state.splitDistance = 250;
      state.displayMode = "cumulative";

      return;

    }


    if (
      state.trainingTool === "chrono"
    ) {

      state.chronoPlanMode =
        $("chronoPlanMode")?.value === "series"
          ? "series"
          : "single";

      state.chronoSeriesText =
        $("chronoSeriesText")?.value?.trim() ||
        state.chronoSeriesText;

      const parsedSeries =
        parseSeriesDistances(
          state.chronoSeriesText
        );

      if (parsedSeries.length) {
        state.chronoSeriesDistances =
          parsedSeries;
      }

      if (state.chronoPlanMode === "series") {
        state.chronoSeriesWithSplits = $("chronoSeriesWithSplits")?.value === "yes";
      } else {
        state.chronoSingleWithSplits = $("chronoSeriesWithSplits")?.value === "yes";
      }

      state.totalDistance =
        $("totalDistance").value === "custom"
          ? Math.max(
              1,
              +$("customDistance").value || 1
            )
          : +$("totalDistance").value;


      state.splitDistance =
        $("splitDistance").value === "custom"
          ? Math.max(
              1,
              +$("customSplit").value || 1
            )
          : +$("splitDistance").value;


      state.displayMode =
        $("displayMode").value;


      state.targetMs =
        state.chronoPlanMode === "series"
          ? null
          : parseTime(
              $("targetTime").value
            );

    }


    if (
      state.trainingTool === "timer"
    ) {

      state.timerDurationChoice =
        $("timerDuration").value;


      if (
        state.timerDurationChoice ===
        "custom"
      ) {

        state.timerDurationMs =
          Math.max(
            .5,
            +$("customTimerDuration").value ||
            6
          ) * 60000;

      } else {

        state.timerDurationMs =
          +state.timerDurationChoice *
          1000;

      }


      state.trackDistanceChoice =
        $("trackDistance").value;


      if (
        state.trackDistanceChoice ===
        "custom"
      ) {

        state.trackDistance =
          Math.max(
            10,
            +$("customTrackDistance").value ||
            300
          );

      } else {

        state.trackDistance =
          +state.trackDistanceChoice;

      }

    }


    if (
      state.trainingTool === "vma"
    ) {

      state.vmaProtocol =
        $("vmaProtocol").value;


      if (
        state.vmaProtocol === "6"
      ) {

        state.vmaDurationMs =
          360000;

      } else if (
        state.vmaProtocol === "12"
      ) {

        state.vmaDurationMs =
          720000;

      } else {

        state.vmaDurationMs =
          Math.max(
            .5,
            +$("vmaCustomDuration").value ||
            6
          ) * 60000;

      }


      state.vmaTrackDistanceChoice =
        $("vmaTrackDistance").value;


      if (
        state.vmaTrackDistanceChoice ===
        "custom"
      ) {

        state.vmaTrackDistance =
          Math.max(
            10,
            +$("vmaCustomTrackDistance").value ||
            300
          );

      } else {

        state.vmaTrackDistance =
          +state.vmaTrackDistanceChoice;

      }

    }

  }


  /* =========================================================
     PAGE PARAMETRAGE
  ========================================================= */

  let setupStep = "cover";

  function renderSetupWizard() {
    const cover = setupStep === "cover";
    document.body.classList.toggle("setup-cover", cover && state.view === "setup");
    const tools = setupStep === "tools";
    document.body.classList.toggle("setup-tools", tools && state.view === "setup");
    const settings = setupStep === "settings";
    const runners = setupStep === "runners";
    const exam = isExamMode();
    const titles = { cover: "Chrono Carnet EPS", tools: "Quel outil veux-tu utiliser ?",
      settings: "Préparer la séance", runners: "Qui va courir ?" };
    const hints = { cover: "Choisis ton mode pour préparer ta séance.",
      tools: "Choisis un outil pour afficher ses réglages.",
      settings: "Règle uniquement ce dont tu as besoin pour cette séance.",
      runners: exam ? "Ajoute un ou deux élèves. Leurs estimations seront demandées avant chaque course concernée."
        : "Ajoute un ou deux coureurs pour leur associer les résultats." };
    $("setupTitle").textContent = titles[setupStep];
    $("setupHint").textContent = hints[setupStep];
    $("setupProgress").textContent = cover ? "Bienvenue" : exam ? "Examen · Identité"
      : "Entraînement · " + ({ tools: "1 / 3", settings: "2 / 3", runners: "3 / 3" }[setupStep]);
    $("setupPanel").dataset.step = setupStep;
    setVisible("setupModes", cover);
    setVisible("trainingConfig", !exam && (tools || settings));
    setVisible("trainingToolSelector", tools);
    document.querySelectorAll(".trainingSubConfig").forEach(el => {
      el.classList.toggle("hidden", !settings || el.id !== ({ simple: "trainingSimpleConfig",
        chrono: "trainingChronoConfig", timer: "trainingTimerConfig", vma: "trainingVmaConfig" }[state.trainingTool]));
    });
    setVisible("ccfConfig", runners && state.mode === "ccf");
    setVisible("exam500Config", runners && state.mode === "exam500");
    setVisible("runnerSetupBlock", runners);
    setVisible("configRecap", settings || runners);
    setVisible("configMessage", settings);
    setVisible("setupBackBtn", !cover);
    setVisible("setupNextBtn", settings && !isSimple());
    setVisible("launchPerformanceBtn", runners || (settings && isSimple()));
    if (exam) $("launchPerformanceBtn").textContent = "Continuer : annoncer les temps →";
  }

  function goSetupStep(step) {
    if (setupStep === "settings") { readConfig(); save(); }
    setupStep = step;
    renderSetup();
    $("setupTitle").focus({ preventScroll: true });
    $("setupPanel").scrollIntoView?.({ block: "start", behavior: "smooth" });
  }

  function renderSetup() {

    document
      .querySelectorAll(
        '[name="mode"]'
      )
      .forEach(
        x =>
          x.checked =
            x.value === state.mode
      );


    document
      .querySelectorAll(
        '[name="trainingTool"]'
      )
      .forEach(
        x =>
          x.checked =
            x.value === state.trainingTool
      );


    const ccf =
      state.mode === "ccf";

    const exam500 =
      isExam500();

    const examMode =
      ccf || exam500;


    setVisible(
      "trainingConfig",
      !examMode
    );


    setVisible(
      "ccfConfig",
      ccf
    );

    setVisible(
      "exam500Config",
      exam500
    );


    document
      .querySelectorAll(
        ".ccfRunnerField"
      )
      .forEach(
        x =>
          x.classList.toggle(
            "hidden",
            true
          )
      );


    setVisible(
      "trainingSimpleConfig",
      !ccf &&
      state.trainingTool === "simple"
    );


    setVisible(
      "trainingChronoConfig",
      !ccf &&
      state.trainingTool === "chrono"
    );


    setVisible(
      "trainingTimerConfig",
      !ccf &&
      state.trainingTool === "timer"
    );


    setVisible(
      "trainingVmaConfig",
      !ccf &&
      state.trainingTool === "vma"
    );


    setVisible(
      "runnerSetupBlock",
      true
    );


    const p1Label =
      $("project1Min")?.closest(".estimateBox")?.querySelector("span");
    const p2Label =
      $("project2Min")?.closest(".estimateBox")?.querySelector("span");

    if (p1Label) {
      p1Label.textContent =
        exam500 ? "Annonce 500 n°1" : "Estimation 800 n°1";
    }

    if (p2Label) {
      p2Label.textContent =
        exam500 ? "Annonce 500 n°2" : "Estimation 800 n°2";
    }


    /* Chrono performance */

    $("chronoPlanMode").value =
      state.chronoPlanMode;

    $("chronoSeriesText").value =
      state.chronoSeriesText;

    $("chronoSeriesWithSplits").value =
      (state.chronoPlanMode === "series" ? state.chronoSeriesWithSplits : state.chronoSingleWithSplits)
        ? "yes"
        : "no";

    const chronoSeries =
      state.chronoPlanMode === "series";

    setVisible(
      "chronoSeriesField",
      chronoSeries
    );

    setVisible(
      "chronoSeriesSplitToggleField",
      true
    );

    setVisible(
      "singleDistanceField",
      !chronoSeries
    );

    setVisible(
      "targetTimeField",
      !chronoSeries
    );

    setVisible(
      "splitDistanceField",
      chronoSeries ? state.chronoSeriesWithSplits : state.chronoSingleWithSplits
    );

    $("totalDistance").value =
      [
        100,200,400,500,600,800,
        1000,1200,1500,2000,3000
      ].includes(state.totalDistance)
        ? String(state.totalDistance)
        : "custom";


    $("customDistance").value =
      state.totalDistance;


    $("splitDistance").value =
      [50,100,150,200,250,400]
        .includes(state.splitDistance)
        ? String(state.splitDistance)
        : "custom";


    $("customSplit").value =
      state.splitDistance;


    $("displayMode").value =
      state.displayMode;


    $("targetTime").value =
      state.targetMs
        ? fmt(state.targetMs)
        : "";


    setVisible(
      "customDistanceWrap",
      !chronoSeries &&
      $("totalDistance").value === "custom"
    );


    setVisible(
      "customSplitWrap",
      (
        chronoSeries ? state.chronoSeriesWithSplits : state.chronoSingleWithSplits
      ) &&
      $("splitDistance").value === "custom"
    );


    /* Minuteur */

    $("timerDuration").value =
      state.timerDurationChoice;


    $("customTimerDuration").value =
      Math.max(
        .5,
        state.timerDurationMs /
        60000
      );


    $("trackDistance").value =
      state.trackDistanceChoice;


    $("customTrackDistance").value =
      state.trackDistance;


    setVisible(
      "customTimerDurationWrap",
      state.timerDurationChoice ===
      "custom"
    );


    setVisible(
      "customTrackDistanceWrap",
      state.trackDistanceChoice ===
      "custom"
    );


    $("timerPreviewDuration")
      .textContent =
        fmtClock(
          state.timerDurationMs
        );


    $("timerPreviewTrack")
      .textContent =
        `${state.trackDistance} m`;


    /* VMA */

    $("vmaProtocol").value =
      state.vmaProtocol;


    $("vmaCustomDuration").value =
      Math.max(
        .5,
        state.vmaDurationMs /
        60000
      );


    $("vmaTrackDistance").value =
      state.vmaTrackDistanceChoice;


    $("vmaCustomTrackDistance").value =
      state.vmaTrackDistance;


    setVisible(
      "vmaCustomDurationWrap",
      state.vmaProtocol ===
      "custom"
    );


    setVisible(
      "vmaCustomTrackDistanceWrap",
      state.vmaTrackDistanceChoice ===
      "custom"
    );


    /* Résumé */

    const recap = [];


    if (ccf) {

      recap.push(
        "CCF demi-fond",
        "800 m",
        "200 m / passage"
      );

    } else if (exam500) {

      recap.push(
        "Examen demi-fond",
        "3 × 500 m",
        "250 / 500 m"
      );

    } else if (
      state.trainingTool === "simple"
    ) {

      recap.push(
        "Chrono simple",
        "Sans paramétrage"
      );

    } else if (
      state.trainingTool === "chrono"
    ) {

      recap.push(
        "Chrono performance",
        isChronoSeries() ? state.chronoSeriesDistances.map(distance => `${distance} m`).join(" → ") : `${state.totalDistance} m`,
        (isChronoSeries() ? state.chronoSeriesWithSplits : state.chronoSingleWithSplits)
          ? `${state.splitDistance} m / passage` : "Sans intermédiaire"
      );

    } else if (
      state.trainingTool === "timer"
    ) {

      recap.push(
        "Minuteur / Tours",
        fmtClock(
          state.timerDurationMs
        ),
        `Piste ${state.trackDistance} m`
      );

    } else {

      const protocolName =
        state.vmaProtocol === "6"
          ? "Demi-Cooper"
          : state.vmaProtocol === "12"
            ? "Cooper"
            : "Test personnalisé";


      recap.push(
        protocolName,
        fmtClock(
          state.vmaDurationMs
        ),
        `Piste ${state.vmaTrackDistance} m`
      );

    }


    $("configRecap").innerHTML =
      recap
        .map(
          x =>
            `<span>${x}</span>`
        )
        .join("");


    $("launchPerformanceBtn")
      .textContent =

      examMode
        ? "Passer à la prise de performance"

        : state.trainingTool === "simple"
          ? "Ouvrir le chrono"

        : state.trainingTool === "chrono"
          ? "Démarrer la prise de performance"

        : state.trainingTool === "timer"
          ? "Démarrer le minuteur"

        : state.vmaProtocol === "6"
          ? "Démarrer le Demi-Cooper"

        : state.vmaProtocol === "12"
          ? "Démarrer le Cooper"

        : "Démarrer le test VMA";


    renderRunnerSetup();
    renderSetupWizard();

  }


  /* =========================================================
     COUREURS
  ========================================================= */

  function renderRunnerSetup() {

    const b =
      $("runnerSetupList");

    if (!b) {
      return;
    }


    b.innerHTML =
      state.runners.length

        ? state.runners
          .map(
            r =>

              `<span class="runnerChip">` +

              `<strong>${
                esc(
                  r.last
                    ? r.last.toUpperCase() +
                      " " +
                      r.first
                    : r.name
                )
              }</strong>` +

              `${
                r.classroom
                  ? ` · ${esc(r.classroom)}`
                  : ""
              }` +

              `${
                isExamMode()
                  ? ` · ${r.sex}` +
                    ` · P1 ${
                      r.project1Ms
                        ? fmt(r.project1Ms)
                        : "—"
                    }` +
                    ` · P2 ${
                      r.project2Ms
                        ? fmt(r.project2Ms)
                        : "—"
                    }`
                  : ""
              }` +

              `<button data-del="${r.id}">×</button>` +

              `</span>`

          )
          .join("")

        : "Aucun coureur ajouté.";


    b.querySelectorAll(
      "[data-del]"
    )
    .forEach(
      x => {

        x.onclick =
          () => {

            if (running) {
              return;
            }


            if (
              state.results.some(
                y =>
                  y.runnerId ===
                  x.dataset.del
              ) ||
              state.timedRuns.some(
                y =>
                  y.runnerId ===
                  x.dataset.del
              )
            ) {

              return toast(
                "Impossible de supprimer un coureur qui a déjà des résultats."
              );

            }


            state.runners =
              state.runners.filter(
                r =>
                  r.id !==
                  x.dataset.del
              );


            if (
              state.activeRunnerId ===
              x.dataset.del
            ) {

              state.activeRunnerId =
                state.runners[0]?.id ||
                null;

            }


            save();

            renderRunnerSetup();

          };

      }
    );

  }


  function estimateMs(prefix) {

    const m =
      $(`${prefix}Min`)?.value;

    const s =
      $(`${prefix}Sec`)?.value;


    if (
      m === "" ||
      s === ""
    ) {

      return null;

    }


    const sec =
      Number(s);


    if (
      !Number.isInteger(sec) ||
      sec < 0 ||
      sec > 59
    ) {

      return null;

    }


    return (
      Number(m) * 60 +
      sec
    ) * 1000;

  }


  function addRunner() {

    const last =
      $("runnerLast")
        ?.value
        .trim() ||
      "";


    const first =
      $("runnerFirst")
        ?.value
        .trim() ||
      "";


    const cls =
      $("runnerClass")
        ?.value
        .trim()
        .toUpperCase() ||
      "";


    const name =
      $("runnerName")
        ?.value
        .trim() ||

      [
        last.toUpperCase(),
        first
      ]
        .filter(Boolean)
        .join(" ");


    if (
      !last ||
      !first
    ) {

      return toast(
        "Nom et prénom sont obligatoires."
      );

    }


    if (
      isExamMode() &&
      state.runners.length >= 2
    ) {

      return toast(
        "Deux coureurs maximum dans ce mode examen."
      );

    }


    if (
      state.mode === "training" &&
      state.runners.length >= 2
    ) {

      return toast(
        "Deux coureurs maximum par séance."
      );

    }


    const p1 =
      null;


    const p2 =
      null;


    if (
      !cls
    ) {

      return toast(
        "La classe est obligatoire."
      );

    }


    const r = {

      id:
        uid(),

      externalId:
        stableStudentId(
          last,
          first,
          cls
        ),

      last,

      first,

      classroom:
        cls,

      name,

      sex:
        $("runnerSex").value,

      project1Ms:
        p1,

      project2Ms:
        p2,

      tone:
        state.runners.length % 2
          ? "blue"
          : "green",

      lockedIdentity:
        isExamMode(),

      stopped:
        false,

      stoppedReason:
        "",

      stoppedAt:
        null,

      stoppedRace:
        null

    };


    state.runners.push(r);


    if (
      !state.activeRunnerId
    ) {

      state.activeRunnerId =
        r.id;

    }


    [
      "runnerLast",
      "runnerFirst",
      "runnerClass",
      "runnerName",
      "project1Min",
      "project1Sec",
      "project2Min",
      "project2Sec"
    ]
    .forEach(
      id => {

        if ($(id)) {
          $(id).value = "";
        }

      }
    );


    save();

    renderRunnerSetup();

  }


  /* =========================================================
     LANCEMENT
  ========================================================= */

  function openRaceEstimates(
    race,
    onValid
  ) {

    if (
      !isExamMode() ||
      ![1,2].includes(race)
    ) {
      onValid?.();
      return;
    }

    const key =
      race === 1
        ? "project1Ms"
        : "project2Ms";

    let dialog =
      $("exam500EstimateDialog");

    if (!dialog) {

      dialog =
        document.createElement(
          "dialog"
        );

      dialog.id =
        "exam500EstimateDialog";

      document.body.appendChild(
        dialog
      );

    }

    dialog.innerHTML =
      '<div class="dialogPanel" style="min-width:min(520px,92vw)">' +
      '<h3>Annonce · ' +
      (isExam500() ? "500" : "800") +
      ' m n°' +
      race +
      '</h3>' +
      '<p style="margin-top:0">Chaque coureur annonce le temps qu’il pense réaliser avant la course.</p>' +
      '<div id="exam500EstimateFields" style="display:grid;gap:12px;margin:18px 0"></div>' +
      '<div id="exam500EstimateError" style="min-height:20px;color:#b91c1c;font-weight:700"></div>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:12px">' +
      '<button type="button" id="exam500EstimateCancel" class="btn soft">Annuler</button>' +
      '<button type="button" id="exam500EstimateValidate" class="btn primary">Valider les annonces</button>' +
      '</div>' +
      '</div>';

    const fields =
      $("exam500EstimateFields");

    fields.innerHTML =
      state.runners
        .map(
          r =>
            '<label class="field">' +
            '<span><strong>' +
            esc(
              r.last
                ? r.last.toUpperCase() +
                  " " +
                  r.first
                : r.name
            ) +
            '</strong>' +
            (
              r.classroom
                ? " · " +
                  esc(r.classroom)
                : ""
            ) +
            '</span>' +
            '<input class="exam500EstimateInput" data-runner="' +
            r.id +
            '" inputmode="numeric" placeholder="Ex. 145 = 1:45" value="' +
            (
              r[key]
                ? fmt(r[key])
                    .replace(
                      /^00:/,
                      ""
                    )
                    .replace(
                      /\.00$/,
                      ""
                    )
                : ""
            ) +
            '">' +
            '</label>'
        )
        .join("");

    $("exam500EstimateCancel").onclick =
      () =>
        dialog.close();

    $("exam500EstimateValidate").onclick =
      () => {

        const inputs =
          [
            ...dialog.querySelectorAll(
              ".exam500EstimateInput"
            )
          ];

        const values = [];

        for (
          const input
          of inputs
        ) {

          const value =
            parseTime(
              input.value
            );

          if (
            !value ||
            value < 20000 ||
            value > 600000
          ) {

            $("exam500EstimateError")
              .textContent =
                "Saisis un temps valide, par exemple 145 pour 1:45 ou 1:45.";

            input.focus();

            return;

          }

          values.push({
            id:
              input.dataset.runner,
            value
          });

        }

        values.forEach(
          item => {

            const runner =
              state.runners.find(
                r =>
                  r.id === item.id
              );

            if (runner) {
              runner[key] =
                item.value;
            }

          }
        );

        save();

        dialog.close();

        onValid?.();

      };

    dialog.showModal();

    const firstEmpty =
      dialog.querySelector(
        ".exam500EstimateInput"
      );

    firstEmpty?.focus();

  }


  function launch() {

    readConfig();


    if (
      !state.runners.length && !isSimple()
    ) {

      return toast(
        "Ajoute au moins un élève."
      );

    }


    if (
      isChronoSeries()
    ) {

      if (
        !state.chronoSeriesDistances.length
      ) {
        return toast(
          "Ajoute au moins une distance dans la série."
        );
      }

      if (
        state.chronoSeriesWithSplits &&
        state.splitDistance <= 0
      ) {
        return toast(
          "Distance intermédiaire invalide."
        );
      }

    } else if (
      (
        isExamMode() ||
        isChrono()
      ) &&
      (
        state.totalDistance <= 0 ||
        raceSplitDistance() <= 0 ||
        state.totalDistance %
        raceSplitDistance()
      )
    ) {

      return toast(
        "Configuration incohérente."
      );

    }


    if (
      isTimed()
    ) {

      const duration =
        currentTimedDuration();

      const track =
        currentTrackDistance();


      if (
        duration <= 0 ||
        track <= 0
      ) {

        return toast(
          "Durée ou longueur de piste invalide."
        );

      }

    }


    if (
      isExamMode() &&
      state.runners.some(
        r =>
          !r.last ||
          !r.first ||
          !r.classroom
      )
    ) {

      return toast(
        "Identité élève incomplète."
      );

    }


    if (
      isExamMode() &&
      state.runners.some(
        r =>
          !r.project1Ms
      )
    ) {

      openRaceEstimates(
        1,
        launch
      );

      return;

    }


    state.view =
      "performance";


    state.activeRace =
      1;


    if (
      !isSimple()
    ) {

      if (
        isTimed()
      ) {

        state.activeRunnerId =
          state.runners.find(
            r =>
              !timedRunFor(r.id)
          )?.id ||
          state.runners[0]?.id ||
          null;

      } else {

        state.activeRunnerId =
          state.runners.find(
            r =>
              !done(r.id,1)
          )?.id ||
          state.runners[0]?.id ||
          null;

      }

    }


    resetClock();

    resetTimedRuntime();

    save();

    render();

  }


  /* =========================================================
     CHRONO
  ========================================================= */

  function resetClock() {

    running = false;
    startedAt = 0;
    elapsedMs = 0;
    lapLockedUntil = 0;

    if ($("lapBtn")) {
      $("lapBtn").textContent =
        lapActionLabel();
    }

  }


  function resetTimedRuntime() {

    timedLapCount = 0;
    timedFinished = false;
    timedActualDurationMs = 0;


    if (
  $("partialDistance")
) {

  $("partialDistance").value = 0;
  $("partialDistance").min = 0;
  $("partialDistance").max =
    Math.max(
      0,
      currentTrackDistance() - 1
    );

}

  }


  function currentTimedDuration() {

    return (
      state.trainingTool === "vma"
        ? state.vmaDurationMs
        : state.timerDurationMs
    );

  }


  function currentTrackDistance() {

    return (
      state.trainingTool === "vma"
        ? state.vmaTrackDistance
        : state.trackDistance
    );

  }


  function start() {

    if (running) {
      return;
    }


    if (
      isSimple()
    ) {

      startedAt = performance.now();
      running = true;

      renderTimer();

      return;

    }


    const r =
      activeRunner();


    if (!r) {

      return toast(
        "Choisis un coureur."
      );

    }


    if (
      isTimed()
    ) {

      if (
        timedRunFor(r.id)
      ) {

        return toast(
          "Un résultat existe déjà pour ce coureur. Réinitialise-le pour recommencer."
        );

      }


      resetTimedRuntime();

      elapsedMs = 0;

      startedAt =
        performance.now();

      running = true;

      renderTimer();

      return;

    }


    if (
      done(r.id)
    ) {

      return toast(
        "Cette course est déjà terminée pour ce coureur."
      );

    }


    elapsedMs = 0;

    startedAt =
      performance.now();

    running = true;

    renderTimer();

  }


  function stopClock() {

    if (running) {

      elapsedMs =
        now();

      running =
        false;

      startedAt =
        0;

    }


    renderTimer();

  }


  function stopAction() {

  if (!running) {
    return;
  }


  if (
    isSimple()
  ) {

    stopClock();

    save();

    renderPerf();

    return;

  }


  if (
    isTimed()
  ) {

    if (
      state.trainingTool === "vma" &&
      (
        state.vmaProtocol === "6" ||
        state.vmaProtocol === "12"
      )
    ) {

      const ok =
        confirm(
          "Interrompre le test ? Aucun résultat VMA ne sera enregistré."
        );

      if (!ok) {
        return;
      }

      resetClock();

      resetTimedRuntime();

      renderPerf();

      toast(
        "Test interrompu · aucun résultat VMA enregistré."
      );

      return;

    }


    finishTimedRun(false);

  }

}
  /* =========================================================
     CHRONO PERFORMANCE / CCF
  ========================================================= */

  function nextRunnerSameRace(
    currentId
  ) {

    return (
      state.runners.find(
        r =>
          r.id !== currentId &&
          !done(
            r.id,
            state.activeRace
          )
      ) ||
      null
    );

  }


  function recordLap() {

    const r =
      activeRunner();


    if (!r) {

      return toast(
        "Choisis un coureur."
      );

    }


    if (!running) {

      return toast(
        "Appuie d’abord sur DÉPART."
      );

    }


    const a =
      rr(r.id);


    const cum =
      now();


    const prev =
      a.length
        ? a.at(-1).cumulativeMs
        : 0;


    const lap =
      cum - prev;


    const pass =
      a.length + 1;


    const dist =
      pass *
      raceSplitDistance();


    const delta =
      a.length
        ? lap -
          a.at(-1).lapMs
        : null;


    const target =
      state.mode === "training"
        ? state.targetMs
        : (
            state.activeRace === 1
              ? r.project1Ms
              : state.activeRace === 2
                ? r.project2Ms
                : null
          );


    state.results.push({

      id:
        uid(),

      runnerId:
        r.id,

      runnerName:
        r.name,

      race:
        state.activeRace,

      passage:
        pass,

      distance:
        dist,

      cumulativeMs:
        cum,

      lapMs:
        lap,

      speed:
        spd(
          raceSplitDistance(),
          lap
        ),

      deltaMs:
        delta,

      targetDelta:
        target
          ? cum -
            target *
            (
              dist /
              raceDistance()
            )
          : null

    });


    confirmLapRecorded();


    if (
      pass >=
      requiredSplits()
    ) {

      stopClock();


      if (
        isExamMode()
      ) {

        const next =
          nextRunnerSameRace(
            r.id
          );


        if (next) {

          state.activeRunnerId =
            next.id;

          resetClock();

          toast(
            `${r.name} terminé · au tour de ${next.name}`
          );

        } else if (
          state.activeRace < raceCount()
        ) {

          toast(
            isExam500()
              ? "500 m terminé · passe à la course suivante"
              : "800 m n°1 terminés · lance la récupération puis passe au n°2"
          );

        } else {

          toast(
            isExam500()
              ? "Les trois 500 m sont terminés · QR professeur disponible"
              : "Les deux 800 m sont terminés · bilan et QR disponibles"
          );

        }

      } else if (
        isChronoSeries()
      ) {

        const next =
          nextRunnerSameRace(
            r.id
          );

        if (next) {

          state.activeRunnerId =
            next.id;

          resetClock();

          toast(
            `${r.name} terminé · au tour de ${next.name}`
          );

        } else if (
          state.activeRace <
          raceCount()
        ) {

          state.activeRace += 1;

          state.activeRunnerId =
            state.runners.find(
              runner =>
                !done(
                  runner.id,
                  state.activeRace
                )
            )?.id ||
            state.runners[0]?.id ||
            null;

          resetClock();

          toast(
            `Course suivante · ${raceDistance()} m`
          );

        } else {

          resetClock();

          toast(
            "Série terminée · QR professeur disponible pour chaque élève"
          );

        }

      } else {

        toast(
          `${r.name} · course terminée`
        );

      }

    }


    save();

    renderPerf();

  }


  /* =========================================================
     MINUTEUR / VMA
  ========================================================= */

  function addTimedLap() {

    if (
      !isTimed()
    ) {
      return;
    }


    if (
      !running
    ) {

      return toast(
        "Appuie d’abord sur DÉPART."
      );

    }


    timedLapCount += 1;

    navigator.vibrate?.(25);

    renderTimer();

  }


  function undoTimedLap() {

    if (
      !isTimed() ||
      timedLapCount <= 0 ||
      timedFinished
    ) {

      return;

    }


    timedLapCount -= 1;

    renderTimer();

  }


  function finishTimedRun(
    auto = true
  ) {

    if (
      !isTimed() ||
      timedFinished
    ) {

      return;

    }


    const duration =
      currentTimedDuration();


    timedActualDurationMs =
      auto
        ? duration
        : Math.min(
            now(),
            duration
          );


    elapsedMs =
      timedActualDurationMs;

    running =
      false;

    startedAt =
      0;

    timedFinished =
      true;


    setVisible(
      "timerFinishPanel",
      true
    );


    renderTimer();

    renderPerf();


    toast(
      auto
        ? "Temps terminé · ajoute la distance partielle"
        : "Test arrêté · ajoute la distance partielle"
    );

  }


  /* =========================================================
     CALCUL VMA
  ========================================================= */

  function calculateVma(
    distanceM,
    durationMs,
    protocol
  ) {

    const averageSpeed =
      spd(
        distanceM,
        durationMs
      );


    /*
      Demi-Cooper :
      sur 6 minutes, la vitesse moyenne
      correspond directement à distance / 100.
    */

    if (
      protocol === "6"
    ) {

      return averageSpeed;

    }


    /*
      Cooper 12 minutes :
      estimation VO2max classique de Cooper,
      puis conversion indicative en VMA
      avec VMA ≈ VO2max / 3,5.
    */

    if (
      protocol === "12"
    ) {

      const vo2max =
        (
          distanceM -
          504.9
        ) /
        44.73;


      if (
        !Number.isFinite(vo2max) ||
        vo2max <= 0
      ) {

        return averageSpeed;

      }


      return (
        vo2max /
        3.5
      );

    }


    /*
  Durée personnalisée :
  pas de protocole VMA standard.
  On ne calcule donc pas de VMA.
*/

return null;
  }


  function validateTimedResult() {

    if (
      !isTimed() ||
      !timedFinished
    ) {

      return;

    }


    const r =
      activeRunner();


    if (!r) {

      return toast(
        "Aucun coureur sélectionné."
      );

    }


    const track =
      currentTrackDistance();


    const partial =
      Math.max(
        0,
        +$("partialDistance").value ||
        0
      );


    if (
      partial >= track
    ) {

      return toast(
        `La distance partielle doit être inférieure à ${track} m.`
      );

    }


    const durationMs =
      timedActualDurationMs ||
      currentTimedDuration();


    const totalDistance =
      timedLapCount *
      track +
      partial;


    if (
      totalDistance <= 0
    ) {

      return toast(
        "Aucune distance enregistrée."
      );

    }


    const speed =
      spd(
        totalDistance,
        durationMs
      );


    const vma =
      state.trainingTool === "vma"
        ? calculateVma(
            totalDistance,
            durationMs,
            state.vmaProtocol
          )
        : null;


    const protocolName =
      state.vmaProtocol === "6"
        ? "Demi-Cooper"
        : state.vmaProtocol === "12"
          ? "Cooper"
          : "Test personnalisé";


    state.timedRuns =
      state.timedRuns.filter(
        x =>
          !(
            x.runnerId === r.id &&
            x.tool ===
            state.trainingTool
          )
      );


    state.timedRuns.push({

      id:
        uid(),

      runnerId:
        r.id,

      runnerName:
        r.name,

      tool:
        state.trainingTool,

      protocol:
        state.trainingTool === "vma"
          ? state.vmaProtocol
          : null,

      protocolName:
        state.trainingTool === "vma"
          ? protocolName
          : null,

      durationMs,

      trackDistance:
        track,

      laps:
        timedLapCount,

      partialDistance:
        partial,

      totalDistance,

      speed,

      vma,

      createdAt:
        new Date().toISOString()

    });


    save();


    setVisible(
      "timerFinishPanel",
      false
    );


    showTimedResult(
      r.id
    );


    const next =
      state.runners.find(
        x =>
          x.id !== r.id &&
          !timedRunFor(x.id)
      );


    if (next) {

      state.activeRunnerId =
        next.id;

      resetClock();

      resetTimedRuntime();

      save();


      toast(
        `${r.name} enregistré · au tour de ${next.name}`
      );

    } else {

      toast(
        "Résultat enregistré."
      );

    }


    renderPerf();

  }


  /* =========================================================
     RESET / SELECTION
  ========================================================= */

  let resetArmedUntil = 0;
  let resetArmedScope = null;
  let resetConfirmTimer = null;

  function cancelResetConfirmation() {
    resetArmedUntil = 0;
    resetArmedScope = null;
    clearTimeout(resetConfirmTimer);
    setVisible("resetConfirmMessage", false);
    $("resetBtn").textContent = "RESET";
    $("resetBtn").classList.remove("reset-armed");
  }

  function resetCurrent() {
    const scope = `${state.mode}:${state.trainingTool}:${state.activeRunnerId}:${state.activeRace}`;
    if (Date.now() < resetArmedUntil && scope === resetArmedScope) {
      cancelResetConfirmation();
      performResetCurrent();
      return;
    }
    cancelResetConfirmation();
    resetArmedScope = scope;
    resetArmedUntil = Date.now() + 8000;
    const r = activeRunner();
    $("resetConfirmText").textContent = isSimple()
      ? "Voulez-vous réellement remettre le chrono à zéro ?"
      : `Voulez-vous réellement remettre à zéro la course actuelle de ${r?.name || "ce coureur"} ?`;
    $("resetConfirmHint").textContent = "Appuyez une deuxième fois sur RESET dans les 8 secondes pour confirmer. " +
      (running ? "Le chrono continue." : "Aucun temps n’est effacé avant confirmation.");
    setVisible("resetConfirmMessage", true);
    $("resetBtn").textContent = "CONFIRMER RESET";
    $("resetBtn").classList.add("reset-armed");
    resetConfirmTimer = setTimeout(cancelResetConfirmation, 8000);
  }

  function performResetCurrent() {

    if (
      isSimple()
    ) {

      resetClock();

      renderPerf();

      return;

    }


    const r =
      activeRunner();


    if (!r) {
      return;
    }


    if (
      isTimed()
    ) {

      state.timedRuns =
        state.timedRuns.filter(
          x =>
            !(
              x.runnerId === r.id &&
              x.tool === state.trainingTool
            )
        );


      resetClock();
      resetTimedRuntime();

      save();

      renderPerf();

      return;

    }


    state.results =
      state.results.filter(
        x =>
          !(
            x.runnerId === r.id &&
            x.race === state.activeRace
          )
      );


    resetClock();

    save();

    renderPerf();

  }


  function setActive(id) {

    if (
      running
    ) {

      return toast(
        "Termine la course avant de changer de coureur."
      );

    }


    state.activeRunnerId =
      id;


    resetClock();


    if (
      isTimed()
    ) {

      resetTimedRuntime();

    }


    save();

    renderPerf();

  }


  function setRace(race) {

    if (
      running
    ) {

      return toast(
        "Termine la course en cours."
      );

    }


    if (
      (
        isExamMode() ||
        isChronoSeries()
      ) &&
      race > 1 &&
      !allDone(race - 1)
    ) {

      return toast(
        isChronoSeries()
          ? "Termine d’abord la course précédente des deux coureurs."
          : isExam500()
            ? "Termine d’abord la course précédente des deux coureurs."
            : "Termine d’abord le 800 m n°1 des deux coureurs."
      );

    }


    if (
      isExamMode() &&
      race === 2 &&
      state.runners.some(
        r =>
          !r.project2Ms
      )
    ) {

      openRaceEstimates(
        2,
        () =>
          setRace(2)
      );

      return;

    }


    state.activeRace =
      race;


    state.activeRunnerId =
      state.runners.find(
        r =>
          !done(
            r.id,
            race
          )
      )?.id ||
      state.runners[0]?.id ||
      null;


    resetClock();

    save();

    renderPerf();

  }


  /* =========================================================
     AFFICHAGE CHRONO
  ========================================================= */

  function lapActionLabel() {
    if (isSimple() || isTimed()) {
      return "TOUR";
    }

    const runner =
      activeRunner();

    const recorded =
      runner
        ? rr(
            runner.id,
            state.activeRace
          ).length
        : 0;

    const required =
      requiredSplits(
        state.activeRace
      );

    return recorded >=
      Math.max(
        0,
        required - 1
      )
        ? "ARRIVÉE"
        : "TOUR";
  }


  function startReminderText() {
    if (isSimple()) {
      return "Chrono libre : DÉPART puis STOP à la fin.";
    }

    if (isTimed()) {
      return `À chaque tour de ${currentTrackDistance()} m : appuie sur +1 TOUR. À la fin, ajoute la distance supplémentaire.`;
    }

    const distance =
      raceDistance();

    const split =
      raceSplitDistance();

    const runner =
      activeRunner();

    const recorded =
      runner
        ? rr(
            runner.id,
            state.activeRace
          ).length
        : 0;

    const nextPass =
      recorded + 1;

    const nextDistance =
      Math.min(
        distance,
        nextPass * split
      );

    if (split >= distance) {
      return `Aucun intermédiaire · à ${distance} m, appuie sur ARRIVÉE pour valider la course.`;
    }

    if (
      nextDistance >=
      distance
    ) {
      return `Dernier passage · à ${distance} m, appuie sur ARRIVÉE pour valider la course.`;
    }

    return `Temps intermédiaires tous les ${split} m · prochain passage : ${nextDistance} m → appuie sur TOUR.`;
  }

  function projectionSource(runnerId) {
    if (isTimed()) {
      const result = timedRunFor(runnerId);
      return result && result.totalDistance > 0 && result.durationMs > 0
        ? { distance: result.totalDistance, time: result.durationMs, courses: 1 }
        : null;
    }
    if (!isChrono()) return null;
    let distance = 0, time = 0, courses = 0;
    for (let race = 1; race <= raceCount(); race++) {
      if (!done(runnerId, race)) continue;
      const last = rr(runnerId, race).at(-1);
      if (!last || last.distance <= 0 || last.cumulativeMs <= 0) continue;
      distance += last.distance;
      time += last.cumulativeMs;
      courses++;
    }
    return courses ? { distance, time, courses } : null;
  }

  function projectedTime(source, distance) {
    return source && source.distance > 0 && source.time > 0 && distance > 0
      ? source.time * distance / source.distance : null;
  }

  function renderProjection() {
    const available = state.mode === "training" && !isSimple();
    setVisible("projectionPanel", available);
    if (!available) return;
    $("projectionTarget").value = state.projectionTarget;
    $("projectionCustomDistance").value = state.projectionCustomDistance;
    setVisible("projectionDistanceField", state.projectionTarget === "custom");
    if (state.projectionTarget === "off") {
      $("projectionResults").innerHTML = "";
      return;
    }
    const distance = state.projectionTarget === "custom"
      ? state.projectionCustomDistance : Number(state.projectionTarget);
    $("projectionResults").innerHTML = state.runners.map(r => {
      const source = projectionSource(r.id);
      const time = projectedTime(source, distance);
      const label = state.projectionTarget === "800" ? "2 × 800 m"
        : state.projectionTarget === "500" ? "3 × 500 m" : `${distance} m`;
      return `<article class="projectionCard ${r.tone === "blue" ? "blue" : "green"}">
        <h3>${esc(r.name)}</h3><span>${label}</span>
        ${time === null ? '<p>Terminez et validez une course pour obtenir une estimation.</p>'
          : `<strong class="projectionTime">≈ ${fmtClock(Math.round(time / 1000) * 1000)}</strong>
             <b>pour une course de ${distance} m</b>
             <p>Base : ${source.distance} m en ${fmtClock(source.time)}, sur ${source.courses} course${source.courses > 1 ? "s" : ""} terminée${source.courses > 1 ? "s" : ""}, hors récupération.</p>`}
        </article>`;
    }).join("") + '<p class="projectionDisclaimer">Estimation à l’allure moyenne du travail réalisé. Ce repère ne garantit pas le temps sur une autre distance ni la capacité à répéter ce chrono sur toutes les courses. Ce n’est pas une note.</p>';
  }

  function renderTimer() {

    const r =
      activeRunner();

    const timerCard = document.querySelector(".timerCard");
    const tone = !isSimple() && r ? (r.tone === "blue" ? "blue" : "green") : null;
    timerCard.classList.toggle("runner-green", tone === "green");
    timerCard.classList.toggle("runner-blue", tone === "blue");

    setVisible(
      "startReminder",
      !isSimple() ||
      !running
    );

    $("startReminder").textContent =
      startReminderText();


    if (
      isTimed()
    ) {

      const duration =
        currentTimedDuration();


      const left =
        Math.max(
          0,
          duration -
          now()
        );


      $("mainTime").textContent =
        fmtClock(left);


      if (
        running &&
        left <= 0 &&
        !timedFinished
      ) {

        finishTimedRun(true);

        return;

      }

    } else {

      $("mainTime").textContent =
        fmt(
          now()
        );

    }


    if (
      isSimple()
    ) {

      $("timerLabel").textContent =
        "Chrono simple";


      setVisible(
        "activeRunnerBanner",
        false
      );


      setVisible(
        "timerRunInfo",
        false
      );


      setVisible(
        "startBtn",
        !running
      );


      setVisible(
        "stopBtn",
        running
      );


      setVisible(
        "lapBtn",
        false
      );


      setVisible(
        "timerLapBtn",
        false
      );


      setVisible(
        "undoTimerLapBtn",
        false
      );


      $("startBtn").disabled =
        running;


    } else if (
      isTimed()
    ) {

      $("timerLabel").textContent =

        state.trainingTool === "vma"

          ? state.vmaProtocol === "6"
            ? "Demi-Cooper · 6 min"

            : state.vmaProtocol === "12"
              ? "Cooper · 12 min"

              : "Test VMA personnalisé"

          : "Minuteur";


      setVisible(
        "activeRunnerBanner",
        true
      );


      setVisible(
        "timerRunInfo",
        true
      );


      setVisible(
        "startBtn",
        !running &&
        !timedFinished
      );


      setVisible(
        "stopBtn",
        running
      );


      setVisible(
        "lapBtn",
        false
      );


      setVisible(
        "timerLapBtn",
        true
      );


      $("timerLapBtn").disabled =
        !running;


      $("undoTimerLapBtn").disabled =
        timedLapCount <= 0 ||
        timedFinished;


      setVisible(
        "undoTimerLapBtn",
        true
      );


      $("timerLapCount").textContent =
        String(
          timedLapCount
        );


      const distance =
        timedLapCount *
        currentTrackDistance();


      $("timerDistanceCount").textContent =
        `${distance} m`;


      $("timerSpeedDisplay").textContent =
  running
    ? "Calcul à la fin"
    : "—";

    } else {

      $("timerLabel").textContent =
        "Chronomètre";


      setVisible(
        "activeRunnerBanner",
        true
      );


      setVisible(
        "timerRunInfo",
        false
      );


      setVisible(
        "startBtn",
        true
      );


      setVisible(
        "stopBtn",
        false
      );


      setVisible(
        "lapBtn",
        true
      );


      setVisible(
        "timerLapBtn",
        false
      );


      setVisible(
        "undoTimerLapBtn",
        false
      );


      $("startBtn").textContent =
        running
          ? "EN COURS"
          : "DÉPART";


      $("startBtn").disabled =
        running ||
        !r ||
        done(r.id);


      if (
        performance.now() >=
        lapLockedUntil
      ) {
        $("lapBtn").textContent =
          lapActionLabel();
      }

      $("lapBtn").disabled =
        !running ||
        !r ||
        performance.now() <
          lapLockedUntil;

    }


    const p =
      $("statusPill");


    p.className =
      `statusPill ${
        running
          ? "running"
          : "idle"
      }`;


    p.textContent =
      running
        ? "En cours"
        : timedFinished
          ? "Terminé"
          : "Prêt";


    if (
      !isSimple() &&
      r
    ) {

      let proj =
        null;


      let activity =
        "Course";


      if (
        isExamMode()
      ) {

        proj =
          state.activeRace === 1
            ? r.project1Ms
            : state.activeRace === 2
              ? r.project2Ms
              : null;


        activity =
          isExam500()
            ? `500 n°${state.activeRace}`
            : `800 n°${state.activeRace}`;


      } else if (
        isChrono()
      ) {

        proj =
          state.targetMs;


      } else if (
        state.trainingTool === "timer"
      ) {

        activity =
          `Minuteur · piste ${state.trackDistance} m`;


      } else if (
        state.trainingTool === "vma"
      ) {

        activity =
          `${
            state.vmaProtocol === "6"
              ? "Demi-Cooper"
              : state.vmaProtocol === "12"
                ? "Cooper"
                : "Test VMA"
          } · piste ${state.vmaTrackDistance} m`;

      }


      $("activeRunnerBanner").className =
        `activeRunnerBanner ${
          r.tone ||
          "green"
        }`;


      $("activeRunnerBanner").innerHTML =

        `<strong>${
          esc(
            r.last
              ? r.last.toUpperCase() +
                " " +
                r.first
              : r.name
          )
        }</strong>` +

        `<span>` +

        `${
          r.classroom
            ? esc(r.classroom) +
              " · "
            : ""
        }` +

        `${activity}` +

        `${
          proj
            ? ` · estimation ${fmt(proj)}`
            : ""
        }` +

        `</span>`;

    }

  }


  /* =========================================================
     CARTES COUREURS
  ========================================================= */

  function renderRunners() {

    const g =
      $("runnersGrid");


    if (!g) {
      return;
    }


    g.innerHTML =
      state.runners
        .map(
          (r,i) => {

            const isActive =
              r.id === state.activeRunnerId;


            let metric =
              "Prêt";


            let sub =
              "";


            let meta =
              "Course";


            let isDone =
              false;


            if (
              isTimed()
            ) {

              const tr =
                timedRunFor(r.id);


              isDone =
                !!tr;


              meta =
                state.trainingTool === "vma"

                  ? state.vmaProtocol === "6"
                    ? "Demi-Cooper"

                    : state.vmaProtocol === "12"
                      ? "Cooper"

                      : "Test VMA"

                  : "Minuteur / Tours";


              if (tr) {

                metric =
                  `${tr.totalDistance} m`;


                sub =
                  `${tr.speed.toFixed(1)} km/h` +

                  `${
                    tr.vma != null
                      ? ` · VMA ${tr.vma.toFixed(1)}`
                      : ""
                  }`;

              } else {

                sub =
                  isActive &&
                  timedLapCount

                    ? `${timedLapCount} tour(s) en cours`

                    : "Prêt à démarrer";

              }


            } else {

              const a =
                rr(r.id);


              const last =
                a.at(-1);


              isDone =
                done(r.id);


              const proj =
                state.mode === "training"
                  ? state.targetMs
                  : (
                      state.activeRace === 1
                        ? r.project1Ms
                        : state.activeRace === 2
                          ? r.project2Ms
                          : null
                    );


              meta =
                isExamMode()
                  ? isExam500()
                    ? `500 n°${state.activeRace}`
                    : `800 n°${state.activeRace}`
                  : "Course";


              if (proj) {

                meta +=
                  ` · estimation ${fmt(proj)}`;

              }


              metric =
                last
                  ? fmt(last.cumulativeMs)
                  : "Prêt";


              sub =
                isDone
                  ? "Course terminée"
                  : `${a.length}/${requiredSplits()} passages enregistrés`;

            }


            return (

              `<button ` +

              `class="runnerCard runnerSelect ${
                r.tone ||
                (
                  i % 2
                    ? "blue"
                    : "green"
                )
              } ${
                isActive
                  ? "active"
                  : ""
              }" ` +

              `data-runner="${r.id}" ` +

              `${
                running &&
                !isActive
                  ? "disabled"
                  : ""
              }>` +

              `<span class="runnerName">${
                esc(
                  r.last
                    ? r.last.toUpperCase() +
                      " " +
                      r.first
                    : r.name
                )
              }</span>` +

              `<span class="runnerMeta">` +

              `${
                r.classroom
                  ? esc(r.classroom) +
                    " · "
                  : ""
              }` +

              `${meta}` +

              `</span>` +

              `<span class="runnerMainMetric">${metric}</span>` +

              `<span class="runnerSubMetric">${sub}</span>` +

              `</button>`

            );

          }
        )
        .join("");


    g.querySelectorAll(
      "[data-runner]"
    )
    .forEach(
      x =>
        x.onclick =
          () =>
            setActive(
              x.dataset.runner
            )
    );

  }


  /* =========================================================
     RESULTATS CHRONO CLASSIQUE
  ========================================================= */

  function renderResults() {

    const a =
      state.results;


    $("resultsEmpty").hidden =
      !!a.length;


    $("resultsTable")
      .classList
      .toggle(
        "hidden",
        !a.length
      );


    $("resultsBody").innerHTML =

      a
        .map(
          x =>

            `<tr>` +

            `<td><strong>${esc(x.runnerName)}</strong></td>` +

            `<td>${
              state.mode === "training"
                ? "—"
                : x.race
            }</td>` +

            `<td>${x.distance} m</td>` +

            `<td>${fmt(x.lapMs)}</td>` +

            `<td>${fmt(x.cumulativeMs)}</td>` +

            `<td>${x.speed.toFixed(1)} km/h</td>` +

            `<td class="${
              x.deltaMs < 0
                ? "deltaGood"
                : x.deltaMs > 0
                  ? "deltaBad"
                  : ""
            }">${signed(x.deltaMs)}</td>` +

            `</tr>`

        )
        .join("");

  }


  function renderStats() {

    const h =
      state.runners
        .map(
          r => {

            const a =
              state.results.filter(
                x =>
                  x.runnerId ===
                  r.id
              );


            if (!a.length) {
              return "";
            }


            const laps =
              a.map(
                x => x.lapMs
              );


            const last =
              a.at(-1);


            return (

              `<div class="statCard">` +

              `<h3>${esc(r.name)}</h3>` +

              `<div class="statRow">` +
              `<span>Dernier temps</span>` +
              `<strong>${fmt(last.cumulativeMs)}</strong>` +
              `</div>` +

              `<div class="statRow">` +
              `<span>Vitesse moy.</span>` +
              `<strong>${spd(last.distance,last.cumulativeMs).toFixed(1)} km/h</strong>` +
              `</div>` +

              `<div class="statRow">` +
              `<span>Meilleur passage</span>` +
              `<strong>${fmt(Math.min(...laps))}</strong>` +
              `</div>` +

              `<div class="statRow">` +
              `<span>Plus lent</span>` +
              `<strong>${fmt(Math.max(...laps))}</strong>` +
              `</div>` +

              `<div class="statRow">` +
              `<span>Écart</span>` +
              `<strong>${short(Math.max(...laps)-Math.min(...laps))}</strong>` +
              `</div>` +

              `</div>`

            );

          }
        )
        .join("");


    $("statsGrid").innerHTML =
      h;

  }


  /* =========================================================
     RESULTAT VMA / MINUTEUR
  ========================================================= */

  function showTimedResult(
    runnerId =
      state.activeRunnerId
  ) {

    if (
      !isTimed()
    ) {

      setVisible(
        "vmaResultPanel",
        false
      );

      return;

    }


    const tr =
      timedRunFor(
        runnerId
      );


    if (!tr) {

      setVisible(
        "vmaResultPanel",
        false
      );

      return;

    }


    setVisible(
      "vmaResultPanel",
      true
    );


    $("vmaResultDistance").textContent =
      `${tr.totalDistance} m`;


    $("vmaResultDuration").textContent =
      fmtClock(
        tr.durationMs
      );


    $("vmaResultSpeed").textContent =
      `${tr.speed.toFixed(1)} km/h`;


    const main =
      $("vmaResultValue")
        ?.closest(
          ".vmaMainResult"
        );


    if (
  state.trainingTool === "vma"
) {

  if (main) {
    main.classList.remove("hidden");
  }


  const v =
    tr.vma;


  if (
    v == null
  ) {

    $("vmaResultValue").textContent =
      "VMA non calculée";


    $("vmaTrainingSpeeds").innerHTML =

      `<div class="statRow">` +
      `<span>Protocole</span>` +
      `<strong>${esc(tr.protocolName || "Test personnalisé")}</strong>` +
      `</div>` +

      `<div class="statRow">` +
      `<span>Information</span>` +
      `<strong>Aucun calcul VMA standard pour ce protocole</strong>` +
      `</div>`;

  } else {

    $("vmaResultValue").textContent =
      tr.protocol === "12"
        ? `VMA estimée · ${v.toFixed(1)} km/h`
        : `${v.toFixed(1)} km/h`;


    $("vmaTrainingSpeeds").innerHTML =

      `<div class="statRow">` +
      `<span>Protocole</span>` +
      `<strong>${esc(tr.protocolName || "Test VMA")}</strong>` +
      `</div>` +

      `<div class="statRow">` +
      `<span>80 % VMA</span>` +
      `<strong>${(v * .80).toFixed(1)} km/h</strong>` +
      `</div>` +

      `<div class="statRow">` +
      `<span>90 % VMA</span>` +
      `<strong>${(v * .90).toFixed(1)} km/h</strong>` +
      `</div>` +

      `<div class="statRow">` +
      `<span>100 % VMA</span>` +
      `<strong>${v.toFixed(1)} km/h</strong>` +
      `</div>` +

      `<div class="statRow">` +
      `<span>105 % VMA</span>` +
      `<strong>${(v * 1.05).toFixed(1)} km/h</strong>` +
      `</div>`;

  }


    } else {

      if (main) {
        main.classList.add("hidden");
      }


      $("vmaTrainingSpeeds").innerHTML =

        `<div class="statRow">` +
        `<span>Tours complets</span>` +
        `<strong>${tr.laps}</strong>` +
        `</div>` +

        `<div class="statRow">` +
        `<span>Distance partielle</span>` +
        `<strong>${tr.partialDistance} m</strong>` +
        `</div>`;

    }

  }


  /* =========================================================
     QR CCF
  ========================================================= */

  function trainingQrPayload(r) {

    if (!r) {
      return null;
    }

    if (
      isSimple() &&
      elapsedMs > 0
    ) {
      return {
        type:
          "DF_TRAINING_RESULT",
        v: 1,
        tool:
          "simple",
        resultId:
          r.externalId +
          "-simple-" +
          Date.now(),
        studentId:
          r.externalId,
        last:
          safeQrText(r.last),
        first:
          safeQrText(r.first),
        classroom:
          safeQrText(
            r.classroom
          ),
        sex:
          safeQrText(r.sex),
        totalMs:
          Math.round(
            elapsedMs
          ),
        createdAt:
          new Date()
            .toISOString()
      };
    }

    if (isChrono()) {

      const races =
        Array.from(
          { length: raceCount() },
          (_, index) => {
            const race =
              index + 1;

            const rows =
              rr(r.id, race)
                .slice()
                .sort(
                  (a, b) =>
                    a.distance -
                    b.distance
                );

            if (
              rows.length <
              requiredSplits(race) &&
              !r.stopped
            ) {
              return null;
            }

            if (
              !rows.length
            ) {
              return r.stopped
                ? {
                    d:
                      raceDistance(race),
                    s:
                      raceSplitDistance(race),
                    c: [],
                    stopped: true
                  }
                : null;
            }

            return {
              d:
                raceDistance(race),
              s:
                raceSplitDistance(race),
              c:
                rows.map(
                  item =>
                    Math.round(
                      Number(
                        item.cumulativeMs
                      )
                    )
                ),
              stopped:
                !!r.stopped &&
                rows.length <
                  requiredSplits(race)
            };
          }
        );

      if (
        races.some(
          race => !race
        )
      ) {
        return null;
      }

      /*
       * QR compact : on n'encode que les données non redondantes.
       * Les temps de segment et vitesses peuvent être recalculés à
       * partir des cumuls. Cela garde le QR lisible par la caméra iPad.
       */
      return {
        type:
          "DF_TRAINING_RESULT",
        v: 3,
        tool:
          "chrono",
        id:
          r.externalId +
          "-" +
          Date.now(),
        sid:
          r.externalId,
        l:
          safeQrText(r.last),
        f:
          safeQrText(r.first),
        c:
          safeQrText(
            r.classroom
          ),
        x:
          safeQrText(r.sex),
        m:
          isChronoSeries()
            ? "series"
            : "single",
        r:
          races,
        status:
          r.stopped
            ? "medical_stop"
            : "complete",
        statusLabel:
          r.stopped
            ? "INAPTE_MEDICAL"
            : null,
        stoppedAt:
          r.stoppedAt ||
          null
      };
    }


    if (isTimed()) {

      const tr =
        timedRunFor(
          r.id
        );

      if (!tr) {
        if (!r.stopped) {
          return null;
        }

        return {
          type:
            "DF_TRAINING_RESULT",
          v: 2,
          tool:
            state.trainingTool,
          resultId:
            r.externalId +
            "-medical-stop-" +
            Date.now(),
          studentId:
            r.externalId,
          last:
            safeQrText(r.last),
          first:
            safeQrText(r.first),
          classroom:
            safeQrText(r.classroom),
          sex:
            safeQrText(r.sex),
          status:
            "medical_stop",
          statusLabel:
            "INAPTE_MEDICAL",
          stoppedAt:
            r.stoppedAt ||
            new Date().toISOString(),
          createdAt:
            new Date().toISOString()
        };
      }

      return {
        type:
          "DF_TRAINING_RESULT",
        v: 1,
        tool:
          tr.tool ||
          state.trainingTool,
        resultId:
          r.externalId +
          "-" +
          (tr.tool || state.trainingTool) +
          "-" +
          (tr.id || Date.now()),
        studentId:
          r.externalId,
        last:
          safeQrText(r.last),
        first:
          safeQrText(r.first),
        classroom:
          safeQrText(
            r.classroom
          ),
        sex:
          safeQrText(r.sex),
        durationMs:
          Math.round(
            tr.durationMs || 0
          ),
        trackDistance:
          Math.round(
            tr.track || 0
          ),
        laps:
          Math.round(
            tr.laps || 0
          ),
        partialDistance:
          Math.round(
            tr.partialDistance || 0
          ),
        totalDistance:
          Math.round(
            tr.totalDistance || 0
          ),
        speed:
          Number(
            tr.speed || 0
          ),
        vma:
          tr.vma == null
            ? null
            : Number(
                tr.vma
              ),
        protocol:
          tr.protocol ||
          null,
        createdAt:
          tr.createdAt ||
          new Date()
            .toISOString(),
        status:
          r.stopped
            ? "medical_stop"
            : "complete",
        statusLabel:
          r.stopped
            ? "INAPTE_MEDICAL"
            : null,
        stoppedAt:
          r.stoppedAt ||
          null
      };
    }

    return null;
  }


  function qrPayload(r,race) {

    if (isExam500()) {

      const races =
        [1,2,3].map(
          n => rr(r.id,n)
        );

      if (
        races.some(
          a => a.length < 2
        ) &&
        !r.stopped
      ) {
        return null;
      }

      return {
        type: "DF_3X500_RESULT",
        v: 1,
        resultId:
          r.externalId + "-3x500-" + Date.now(),
        studentId: r.externalId,
        last: safeQrText(r.last),
        first: safeQrText(r.first),
        classroom:
          safeQrText(r.classroom),
        sex: safeQrText(r.sex),
        projects: [
          fmt(r.project1Ms),
          fmt(r.project2Ms)
        ],
        races:
          races.map(
            (a,index) => ({
              race: index + 1,
              project:
                index === 0
                  ? fmt(r.project1Ms)
                  : index === 1
                    ? fmt(r.project2Ms)
                    : null,
              split250Ms:
                a[0]
                  ? Math.round(
                      a[0].cumulativeMs
                    )
                  : null,
              total500Ms:
                a[1]
                  ? Math.round(
                      a[1].cumulativeMs
                    )
                  : null,
              stopped:
                !!r.stopped &&
                a.length < 2
            })
          ),
        status:
          r.stopped
            ? "medical_stop"
            : "complete",
        statusLabel:
          r.stopped
            ? "INAPTE_MEDICAL"
            : null,
        stoppedAt:
          r.stoppedAt ||
          null,
        createdAt:
          new Date().toISOString()
      };

    }



    const a =
      rr(
        r.id,
        race
      );


    if (
      a.length < 4 &&
      !r.stopped
    ) {

      return null;

    }


    return {

      type:
        "DF_CCF_RESULT",

      v:
        1,

      resultId:
        `${r.externalId}-${race}-${Date.now()}`,

      studentId:
        r.externalId,

      last:
        safeQrText(r.last),

      first:
        safeQrText(r.first),

      classroom:
        safeQrText(r.classroom),

      sex:
        safeQrText(r.sex),

      race,

      project:
        fmt(
          race === 1
            ? r.project1Ms
            : r.project2Ms
        ),

      splits:
        a.map(
          x =>
            Math.round(
              x.cumulativeMs
            )
        ),

      totalMs:
        a.length
          ? Math.round(
              a.at(-1).cumulativeMs
            )
          : null,

      status:
        r.stopped
          ? "medical_stop"
          : "complete",

      statusLabel:
        r.stopped
          ? "INAPTE_MEDICAL"
          : null,

      stoppedAt:
        r.stoppedAt ||
        null,

      createdAt:
        new Date().toISOString()

    };

  }


  function ensureQrDialog() {

    if (
      $("teacherQrDialog")
    ) {
      return;
    }


    const d =
      document.createElement(
        "dialog"
      );


    d.id =
      "teacherQrDialog";


    d.innerHTML =

      '<div class="dialogPanel">' +

      '<h3 id="teacherQrTitle">QR professeur</h3>' +

      '<div id="teacherQrBox" style="display:flex;justify-content:center;margin:18px"></div>' +

      '<p>À scanner dans DemiFond Scan CCF.</p>' +

      '<button id="teacherQrClose" class="btn soft full">Fermer</button>' +

      '</div>';


    document.body.appendChild(d);


    $("teacherQrClose").onclick =
      () =>
        d.close();

  }


  function showTeacherQR(
    rid,
    race
  ) {

    const r =
      state.runners.find(
        x =>
          x.id === rid
      );


    const payload =
      r &&
      qrPayload(
        r,
        race
      );


    if (!payload) {

      return toast(
        "Course non terminée."
      );

    }


    ensureQrDialog();


    $("teacherQrTitle").textContent =
      isExam500()
        ? `${r.last.toUpperCase()} ${r.first} · 3 × 500 m`
        : r.stopped
          ? `${r.last.toUpperCase()} ${r.first} · ARRÊT MÉDICAL · 800 n°${race}`
          : `${r.last.toUpperCase()} ${r.first} · 800 n°${race}`;


    const box =
      $("teacherQrBox");


    box.innerHTML =
      "";


    if (
      window.QRCode
    ) {

      try {

        const qrText =
          JSON.stringify(
            payload
          );

        new QRCode(
          box,
          {

            text:
              qrText,

            width:
              260,

            height:
              260,

            correctLevel:
              QRCode.CorrectLevel.M

          }
        );

      } catch (error) {

        console.error(
          "QR generation failed",
          error
        );

        box.innerHTML =
          '<p>Impossible de générer le QR code. Les caractères du nom ont été sécurisés ; réessaie ou recrée l’élève.</p>';

      }

    } else {

      box.innerHTML =
        '<p>Générateur QR indisponible. Ouvre une fois l’application avec Internet avant le cours.</p>';

    }


    $("teacherQrDialog").showModal();

  }


  function renderInlineQr(
    host,
    payload,
    title
  ) {

    if (
      !host ||
      !payload
    ) {
      return;
    }

    host.innerHTML =
      '<div class="scoreCard" style="margin-top:14px">' +
      '<strong>' +
      esc(title) +
      '</strong>' +
      '<div class="inlineTeacherQr" style="display:flex;justify-content:center;margin:14px 0"></div>' +
      '<span>QR professeur · à scanner dans DemiFond Scan</span>' +
      '</div>';

    const box =
      host.querySelector(
        ".inlineTeacherQr"
      );

    if (
      window.QRCode
    ) {

      try {

        new QRCode(
          box,
          {
            text:
              JSON.stringify(
                payload
              ),
            width:
              230,
            height:
              230,
            correctLevel:
              QRCode
                .CorrectLevel
                .M
          }
        );

      } catch (error) {

        console.error(
          "QR inline failed",
          error
        );

        box.innerHTML =
          "<p>Impossible de générer le QR.</p>";

      }

    } else {

      box.innerHTML =
        "<p>Générateur QR indisponible.</p>";

    }

  }


  function renderTeacherQrActions() {

    const host =
      $("teacherQrActions");


    if (!host) {
      return;
    }


    if (
      !isExamMode()
    ) {

      host.innerHTML =
        "";

      return;

    }


    if (isExam500()) {

      host.innerHTML =
        "";

      state.runners
        .filter(
          r =>
            [1,2,3].every(
              race =>
                done(
                  r.id,
                  race
                )
            )
        )
        .forEach(
          r => {
            const item =
              document
                .createElement(
                  "div"
                );

            host.appendChild(
              item
            );

            renderInlineQr(
              item,
              qrPayload(
                r,
                3
              ),
              r.last.toUpperCase() +
              " " +
              r.first +
              " · 3 × 500 m"
            );
          }
        );

      return;

    }


    host.innerHTML =
      state.runners
        .map(
          r => {

            const racesForQr =
              r.stopped
                ? [
                    Number(
                      r.stoppedRace ||
                      (
                        rr(r.id,2).length
                          ? 2
                          : 1
                      )
                    )
                  ]
                : [1,2].filter(
                    race =>
                      rr(r.id,race).length >=
                      requiredSplits(race)
                  );

            const buttons =
              racesForQr
                .filter(
                  race =>
                    [1,2].includes(race)
                )
                .map(
                  race =>

                    `<button ` +
                    `class="btn primary" ` +
                    `data-qr-runner="${r.id}" ` +
                    `data-qr-race="${race}">` +
                    `QR prof · ${esc(r.last.toUpperCase())} · ` +
                    (
                      r.stopped
                        ? `ARRÊT MÉDICAL · 800 n°${race}`
                        : `800 n°${race}`
                    ) +
                    `</button>`

                )
                .join(" ");


            return buttons
              ? `<div style="margin-top:10px">${buttons}</div>`
              : "";

          }
        )
        .join("");


    host
      .querySelectorAll(
        "[data-qr-runner]"
      )
      .forEach(
        b =>

          b.onclick =
            () =>
              showTeacherQR(
                b.dataset.qrRunner,
                +b.dataset.qrRace
              )

      );

  }


  function renderCCF() {

    const box =
      $("ccfScores");


    if (
      !isExamMode()
    ) {

      box.classList.add("hidden");

      renderTeacherQrActions();

      return;

    }


    if (isExam500()) {

      box.innerHTML =
        "<h3>Examen 3 × 500 m</h3>" +
        "<p>Résultats enregistrés. La note sera calculée dans DemiFond Scan après lecture du QR professeur.</p>";

      box.classList.remove("hidden");
      $("teacherRevealBtn").classList.add("hidden");
      renderTeacherQrActions();
      return;

    }


    const cards =
      state.runners
        .map(
          r => {

            const s =
              ccfSummary(r);


            return s.complete

              ? `<div class="scoreCard">` +

                `<strong>${esc(r.name)}</strong>` +

                `<span>Meilleur 800 : ${fmt(s.best)}</span>` +

                `<span>Performance : <b>${s.perf.toFixed(2)} / 6</b></span>` +

                `<span>Régularité : <b>${s.reg.toFixed(2)} / 6</b></span>` +

                `<span class="scoreTotal">AFL1 : ${s.total.toFixed(2)} / 12</span>` +

                `</div>`

              : `<div class="scoreCard">` +

                `<strong>${esc(r.name)}</strong>` +

                `<span>En attente des deux 800 m.</span>` +

                `</div>`;

          }
        )
        .join("");


    box.innerHTML =

      `<h3>Note CCF — AFL1</h3>` +

      `<div class="scoreGrid">${cards}</div>`;


    box.classList.remove("hidden");


    $("teacherRevealBtn")
      .classList
      .add("hidden");


    renderTeacherQrActions();

  }


  /* =========================================================
     ECRAN PERFORMANCE
  ========================================================= */

  function renderPerf() {

    const ccf =
      state.mode === "ccf";

    const exam500 =
      isExam500();

    const examMode =
      ccf || exam500;


    if (
      isSimple()
    ) {

      $("perfRecap").innerHTML =
        `<span>Chrono simple</span>`;


    } else if (
      isTimed()
    ) {

      const toolLabel =

        state.trainingTool === "vma"

          ? state.vmaProtocol === "6"
            ? "Demi-Cooper"

            : state.vmaProtocol === "12"
              ? "Cooper"

              : "Test VMA personnalisé"

          : "Minuteur / Tours";


      $("perfRecap").innerHTML =

        `<span>${toolLabel}</span>` +

        `<span>${fmtClock(currentTimedDuration())}</span>` +

        `<span>Piste ${currentTrackDistance()} m</span>`;


    } else {

      $("perfRecap").innerHTML =

        `<span>${raceDistance()} m</span>` +

        (raceSplitDistance() < raceDistance() ? `<span>Inter. ${raceSplitDistance()} m</span>` : '<span>Sans intermédiaire</span>') +

        `${
          examMode
            ? `<span>${exam500 ? "500" : "800"} n°${state.activeRace}</span>`
            : ""
        }`;

    }


    setVisible(
      "raceTabs",
      examMode
    );

    setVisible(
      "trainingSequenceTabs",
      isChronoSeries()
    );

    const sequenceTabs =
      $("trainingSequenceTabs");

    if (
      sequenceTabs &&
      isChronoSeries()
    ) {
      sequenceTabs.innerHTML =
        state.chronoSeriesDistances
          .map(
            (distance,index) =>
              '<button type="button" data-series-race="' +
              (index + 1) +
              '" class="' +
              (
                state.activeRace === index + 1
                  ? "active"
                  : ""
              ) +
              '">' +
              (index + 1) +
              ". " +
              distance +
              " m</button>"
          )
          .join("");

      sequenceTabs
        .querySelectorAll(
          "[data-series-race]"
        )
        .forEach(
          button => {
            button.onclick =
              () =>
                setRace(
                  Number(
                    button.dataset
                      .seriesRace
                  )
                );
          }
        );
    }


    document
      .querySelectorAll(
        "[data-race]"
      )
      .forEach(
        x => {
          const race = +x.dataset.race;

          x.classList.toggle(
            "active",
            race === state.activeRace
          );

          if (race === 3) {
            x.classList.toggle(
              "hidden",
              !exam500
            );
          }

          if (race <= 2) {
            x.textContent =
              exam500
                ? `500 m n°${race}`
                : `800 m n°${race}`;
          }
        }
      );

    setVisible(
      "startRecoveryBtn",
      ccf
    );

    setVisible(
      "recoveryDisplay",
      ccf
    );


    setVisible(
      "runnerPerformanceBlock",
      !isSimple()
    );


    setVisible(
      "resultsSection",
      examMode ||
      isChrono()
    );


    setVisible(
      "exportSection",

      (
        isSimple() &&
        !running &&
        elapsedMs > 0
      ) ||
      (
        !isSimple() &&
        (
          examMode ||
          isChrono() ||
          state.timedRuns.some(
            x =>
              x.tool ===
              state.trainingTool
          )
        )
      )
    );


    if (
      !timedFinished
    ) {

      setVisible(
        "timerFinishPanel",
        false
      );

    }


    renderTimer();

    renderProjection();


    if (
      !isSimple()
    ) {

      renderRunners();

    }


    if (
      examMode ||
      isChrono()
    ) {

      renderResults();

      renderStats();

      renderCCF();

    } else {

      setVisible(
        "vmaResultPanel",
        false
      );


      showTimedResult();


      $("ccfScores")
        .classList
        .add("hidden");


      renderTeacherQrActions();

    }

    const exportQrHost =
      $("teacherQrExportActions");

    if (exportQrHost) {

      exportQrHost.innerHTML =
        "";

      if (!running) {
        state.runners.forEach(item => {
          const complete = item.stopped
            ? true
            : isSimple()
              ? elapsedMs > 0
              : isTimed()
              ? !!timedRunFor(item.id)
              : isChrono() && Array.from(
                  { length: raceCount() },
                  (_, index) => done(item.id, index + 1)
                ).every(Boolean);

          if (!complete) return;
          const payload = trainingQrPayload(item);
          if (!payload) return;

          const host = document.createElement("div");
          exportQrHost.appendChild(host);
          const label = isSimple()
            ? "Chrono simple"
            : isChronoSeries()
              ? "Série / pyramide"
              : isChrono()
                ? "Chrono performance"
                : payload.tool === "vma"
                  ? "Test VMA"
                  : "Minuteur / Tours";
          renderInlineQr(
            host,
            payload,
            `${item.last.toUpperCase()} ${item.first} · ${label}`
          );
        });
      }

    }

  }


  function render() {

    document.body.classList.toggle("setup-tools", state.view === "setup" && setupStep === "tools");

    document.body.classList.toggle("setup-cover", state.view === "setup" && setupStep === "cover");

    $("setupPanel")
      .classList
      .toggle(
        "hidden",
        state.view !== "setup"
      );


    $("performancePanel")
      .classList
      .toggle(
        "hidden",
        state.view !== "performance"
      );


    state.view === "setup"
      ? renderSetup()
      : renderPerf();

  }


  /* =========================================================
     EXPORT
  ========================================================= */

  function selectedExportRunner() {

    return (
      state.runners.find(
        r =>
          r.id === exportRunnerId
      ) ||
      activeRunner() ||
      state.runners[0]
    );

  }


  function resultTextFor(r) {

    if (
      isSimple()
    ) {

      if (
        !elapsedMs
      ) {
        return "";
      }

      const identity =
        r
          ? (
              (r.last
                ? r.last.toUpperCase() +
                  " " +
                  r.first
                : r.name) +
              (r.classroom
                ? " · " +
                  r.classroom
                : "")
            )
          : "";

      return (
        "CHRONO SIMPLE\n" +
        (identity
          ? identity + "\n\n"
          : "\n") +
        "Temps total : " +
        fmt(elapsedMs)
      );

    }


    if (!r) {
      return "";
    }

    const identity =
      (r.last
        ? r.last.toUpperCase() + " " + r.first
        : r.name) +
      (r.classroom ? " · " + r.classroom : "");

    if (isTimed()) {

      const tr =
        timedRunFor(r.id);

      if (!tr) {
        return identity;
      }

      return (
        "🏃 " + identity + "\n\n" +
        "⏱ " +
        (tr.tool === "vma"
          ? tr.protocolName || "Test VMA"
          : "Minuteur / Tours") + "\n\n" +
        "⏳ Durée : " + fmtClock(tr.durationMs) + "\n" +
        "🔁 Tours : " + tr.laps + "\n" +
        "📏 Distance : " + tr.totalDistance + " m\n" +
        "⚡ Vitesse moyenne : " + tr.speed.toFixed(1) + " km/h" +
        (tr.vma != null
          ? "\n🚀 VMA estimée : " + tr.vma.toFixed(1) + " km/h"
          : "")
      );

    }

    const results =
      state.results
        .filter(x => x.runnerId === r.id);

    if (!results.length) {
      return identity;
    }

    if (isExamMode()) {

      const distance =
        isExam500() ? 500 : 800;

      const split =
        isExam500() ? 250 : 200;

      const races =
        [...new Set(
          results.map(x => x.race)
        )].sort((a,b) => a-b);

      const lines = [
        "🏃 DEMI-FOND · " +
          (isExam500() ? "3 × 500 m" : "2 × 800 m"),
        identity,
        ""
      ];

      races.forEach(race => {
        const a =
          results
            .filter(x => x.race === race)
            .sort((x,y) => x.distance - y.distance);

        const finish =
          a.at(-1);

        if (!finish) {
          return;
        }

        const project =
          race === 1
            ? r.project1Ms
            : race === 2
              ? r.project2Ms
              : null;

        const title =
          "Course " + race +
          " · " + distance + " m";

        lines.push(title);

        const summary = [
          project
            ? "Projet " + fmt(project)
            : isExam500() && race === 3
              ? "Libre"
              : null,
          "Réalisé " + fmt(finish.cumulativeMs),
          project
            ? "Écart " +
              (
                finish.cumulativeMs - project > 0
                  ? "+"
                  : finish.cumulativeMs - project < 0
                    ? "−"
                    : "±"
              ) +
              short(
                finish.cumulativeMs - project
              )
            : null
        ].filter(Boolean);

        lines.push(
          summary.join(" · ")
        );

        lines.push(
          "Repères : " +
          a.map(
            x =>
              x.distance +
              " m " +
              fmt(x.cumulativeMs)
          ).join(" · ")
        );

        if (a.length > 1) {
          lines.push(
            "Segments : " +
            a.map(
              (x,index) => {
                const start =
                  index * split;

                return (
                  start +
                  "–" +
                  x.distance +
                  " m " +
                  fmt(x.lapMs)
                );
              }
            ).join(" · ")
          );
        }

        lines.push("");
      });

      const finishes =
        races
          .map(race => {
            const a =
              results
                .filter(x => x.race === race)
                .sort((x,y) => x.distance - y.distance);
            return a.at(-1);
          })
          .filter(Boolean);

      if (finishes.length) {
        const best =
          finishes.reduce(
            (a,b) =>
              a.cumulativeMs <= b.cumulativeMs
                ? a
                : b
          );

        const segments =
          results.filter(
            x => x.lapMs > 0
          );

        const fastest =
          segments.length
            ? segments.reduce(
                (a,b) =>
                  a.lapMs <= b.lapMs ? a : b
              )
            : null;

        const slowest =
          segments.length
            ? segments.reduce(
                (a,b) =>
                  a.lapMs >= b.lapMs ? a : b
              )
            : null;

        lines.push("BILAN");
        lines.push(
          "Meilleur " +
          distance +
          " m : " +
          fmt(best.cumulativeMs)
        );

        if (fastest && slowest) {
          lines.push(
            "Meilleur " +
            split +
            " m : " +
            fmt(fastest.lapMs) +
            " (" +
            Math.max(
              0,
              fastest.distance - split
            ) +
            "–" +
            fastest.distance +
            " m)"
          );

          lines.push(
            "Moins bon " +
            split +
            " m : " +
            fmt(slowest.lapMs) +
            " (" +
            Math.max(
              0,
              slowest.distance - split
            ) +
            "–" +
            slowest.distance +
            " m)"
          );
        }
      }

      return lines.join("\n");

    }

    if (
      isChronoSeries()
    ) {

      const lines = [
        "🏃 CHRONO PERFORMANCE · SÉRIE / PYRAMIDE",
        identity,
        ""
      ];

      for (
        let race = 1;
        race <= raceCount();
        race++
      ) {

        const rows =
          results
            .filter(
              item =>
                item.race === race
            )
            .sort(
              (a,b) =>
                a.distance -
                b.distance
            );

        if (!rows.length) {
          continue;
        }

        lines.push(
          "▶ Course " +
          race +
          " · " +
          raceDistance(race) +
          " m"
        );

        rows.forEach(
          item => {

            lines.push(
              item.distance +
              " m : " +
              fmt(
                item.cumulativeMs
              ) +
              (
                rows.length > 1
                  ? " · segment " +
                    fmt(item.lapMs)
                  : ""
              )
            );

          }
        );

        lines.push("");

      }

      return lines.join("\n");

    }


    return (
      "🏃 " + identity + "\n\n" +
      results
        .map(
          x =>
            "📍 " + x.distance + " m\n" +
            "   ⏱ " + fmt(x.cumulativeMs) +
            " · tour " + fmt(x.lapMs) + "\n" +
            "   ⚡ " + x.speed.toFixed(1) + " km/h"
        )
        .join("\n\n")
    );

  }


  function prepareExportDialog() {

    const panel =
      $("carnetDialog")
        .querySelector(
          ".dialogPanel"
        );


    const old =
      $("exportRunnerChoices");


    if (old) {
      old.remove();
    }


    if (
      state.runners.length > 1
    ) {

      const d =
        document.createElement(
          "div"
        );


      d.id =
        "exportRunnerChoices";


      d.innerHTML =

        '<p><strong>Quels résultats veux-tu récupérer ?</strong></p>' +

        state.runners
          .map(
            r =>

              `<button ` +
              `type="button" ` +
              `class="choiceBtn exportRunnerChoice" ` +
              `data-export-runner="${r.id}">` +

              `<strong>${
                esc(
                  r.last
                    ? r.last.toUpperCase() +
                      " " +
                      r.first
                    : r.name
                )
              }</strong>` +

              `<span>${esc(r.classroom || "")}</span>` +

              `</button>`

          )
          .join("");


      panel.insertBefore(
        d,
        $("openCarnetBtn")
      );


      d.querySelectorAll(
        "[data-export-runner]"
      )
      .forEach(
        b => {

          b.onclick =
            () => {

              exportRunnerId =
                b.dataset.exportRunner;


              d.querySelectorAll(
                "button"
              )
              .forEach(
                x =>
                  x.classList.toggle(
                    "active",
                    x === b
                  )
              );

            };

        }
      );


    } else {

      exportRunnerId =
        state.runners[0]?.id ||
        null;

    }

  }


  async function openCarnet() {

    const r =
      selectedExportRunner();


    const text =
      resultTextFor(r);


    if (
      !text
    ) {

      return toast(
        "Aucun résultat à exporter."
      );

    }


    try {

      await navigator
        .clipboard
        .writeText(text);

    } catch {}


    window.open(
      CARNET_URL,
      "_blank"
    );

  }


  function carnetResultsFile() {
    const r = selectedExportRunner();
    const result = resultTextFor(r);
    if (!result || !r) {
      toast("Aucun résultat à enregistrer pour ce coureur.");
      return null;
    }

    // Le bouton « Importer » du Carnet accepte les champs html et text.
    const html = result.split(/\r?\n/)
      .map(line => `<div>${esc(line) || "<br>"}</div>`)
      .join("");
    const name = `${r.last || r.name || "eleve"}_${r.first || ""}`
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "_");
    return new File(
      [JSON.stringify({ html, text: result }, null, 2)],
      `ChronoCarnet_${name}_${new Date().toISOString().slice(0, 10)}.json`,
      { type: "application/json" }
    );
  }

  function downloadResultsForCarnet() {
    const file = carnetResultsFile();
    if (!file) return;
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function shareResultsForCarnet() {
    const file = carnetResultsFile();
    if (!file) return;

    if (!navigator.share || !navigator.canShare?.({ files: [file] })) {
      downloadResultsForCarnet();
      return toast("Fichier enregistré : retrouve-le dans Téléchargements pour l’envoyer.");
    }

    try {
      await navigator.share({ files: [file], title: "Résultats Chrono Carnet" });
    } catch (error) {
      if (error?.name !== "AbortError") {
        toast("Partage impossible. Utilise « Enregistrer pour mon Carnet ».");
      }
    }
  }


  function buildSheet() {

    const r =
      selectedExportRunner();


    if (
      isSimple()
    ) {

      if (
        !elapsedMs
      ) {
        return toast(
          "Aucun résultat à afficher."
        );
      }

      $("captureSheet").innerHTML =

        '<div class="captureTitle">' +
        '<h2>Chrono simple</h2>' +
        '<p>' +
        new Date().toLocaleDateString("fr-FR") +
        '</p>' +
        '</div>' +
        '<section class="captureRunner">' +
        '<table class="captureTable"><tbody>' +
        '<tr><th>Temps total</th><td>' +
        fmt(elapsedMs) +
        '</td></tr>' +
        '</tbody></table>' +
        '</section>';

      $("carnetDialog").close();

      $("sheetDialog").showModal();

      return;

    }


    if (!r) {
      return;
    }


    if (
      isTimed()
    ) {

      const tr =
        timedRunFor(
          r.id
        );


      if (!tr) {

        return toast(
          "Aucun résultat pour ce coureur."
        );

      }


      $("captureSheet").innerHTML =

        `<div class="captureTitle">` +

        `<h2>${
          esc(
            r.last
              ? r.last.toUpperCase() +
                " " +
                r.first
              : r.name
          )
        }</h2>` +

        `<p>${esc(r.classroom || "")} · ${new Date().toLocaleDateString("fr-FR")}</p>` +

        `</div>` +

        `<section class="captureRunner">` +

        `<table class="captureTable">` +

        `<tbody>` +

        `${
          tr.protocolName
            ? `<tr>` +
              `<th>Protocole</th>` +
              `<td>${esc(tr.protocolName)}</td>` +
              `</tr>`
            : ""
        }` +

        `<tr>` +
        `<th>Durée</th>` +
        `<td>${fmtClock(tr.durationMs)}</td>` +
        `</tr>` +

        `<tr>` +
        `<th>Tours</th>` +
        `<td>${tr.laps}</td>` +
        `</tr>` +

        `<tr>` +
        `<th>Distance</th>` +
        `<td>${tr.totalDistance} m</td>` +
        `</tr>` +

        `<tr>` +
        `<th>Vitesse moyenne</th>` +
        `<td>${tr.speed.toFixed(1)} km/h</td>` +
        `</tr>` +

        `${
          tr.vma != null
            ? `<tr>` +
              `<th>VMA estimée</th>` +
              `<td>${tr.vma.toFixed(1)} km/h</td>` +
              `</tr>`
            : ""
        }` +

        `</tbody>` +

        `</table>` +

        `</section>`;


    } else {

      $("captureSheet").innerHTML =

        `<div class="captureTitle">` +

        `<h2>${
          esc(
            r.last
              ? r.last.toUpperCase() +
                " " +
                r.first
              : r.name
          )
        }</h2>` +

        `<p>${esc(r.classroom || "")} · ${new Date().toLocaleDateString("fr-FR")}</p>` +

        `</div>` +

        `<section class="captureRunner">` +

        `<table class="captureTable">` +

        `<thead>` +

        `<tr>` +

        `<th>Course</th>` +

        `<th>Passage</th>` +

        `<th>Tour</th>` +

        `<th>Cumul</th>` +

        `<th>Vitesse</th>` +

        `</tr>` +

        `</thead>` +

        `<tbody>` +

        state.results
          .filter(
            x =>
              x.runnerId === r.id
          )
          .map(
            x =>

              `<tr>` +

              `<td>${
                state.mode === "ccf"
                  ? x.race
                  : "—"
              }</td>` +

              `<td>${x.distance} m</td>` +

              `<td>${fmt(x.lapMs)}</td>` +

              `<td>${fmt(x.cumulativeMs)}</td>` +

              `<td>${x.speed.toFixed(1)} km/h</td>` +

              `</tr>`

          )
          .join("") +

        `</tbody>` +

        `</table>` +

        `</section>`;

    }


    $("carnetDialog").close();

    $("sheetDialog").showModal();

  }


  /* =========================================================
     RECUPERATION CCF
  ========================================================= */

  function updateRecovery() {

    if (
      !state.recoveryStartedAt
    ) {

      $("recoveryDisplay").textContent =
        "";

      return;

    }


    const left =
      Math.max(
        0,
        720000 -
        (
          Date.now() -
          state.recoveryStartedAt
        )
      );


    $("recoveryDisplay").textContent =
      `Récupération : ${fmt(left)}`;


    clearTimeout(
      recoveryTimer
    );


    if (left) {

      recoveryTimer =
        setTimeout(
          updateRecovery,
          500
        );

    }

  }


  /* =========================================================
     EVENEMENTS
  ========================================================= */

  $("addRunnerBtn").onclick =
    addRunner;


  $("setupBackBtn").onclick = () => goSetupStep(
    setupStep === "runners" ? (isExamMode() ? "cover" : "settings")
      : setupStep === "settings" ? "tools" : "cover"
  );
  $("setupNextBtn").onclick = () => goSetupStep("runners");

  $("launchPerformanceBtn").onclick = launch;


  $("backSetupBtn").onclick =
    () => {

      if (running) {

        return toast(
          "Termine la course avant de revenir."
        );

      }


      setupStep = isSimple() ? "settings" : "runners";
      state.view =
        "setup";


      resetClock();

      resetTimedRuntime();

      save();

      render();

    };


  $("startBtn").onclick =
    start;


  $("stopBtn").onclick =
    stopAction;


  $("lapBtn").onclick =
    recordLap;


  $("timerLapBtn").onclick =
    addTimedLap;


  $("undoTimerLapBtn").onclick =
    undoTimedLap;


  $("validatePartialDistanceBtn").onclick =
    validateTimedResult;


  $("resetBtn").onclick =
    resetCurrent;

  $("cancelResetBtn").onclick = cancelResetConfirmation;
  document.addEventListener("pointerdown", event => {
    if (!event.target.closest("#resetBtn")) cancelResetConfirmation();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") cancelResetConfirmation();
  });
  $("projectionTarget").onchange = () => {
    state.projectionTarget = $("projectionTarget").value;
    save();
    renderProjection();
  };
  $("projectionCustomDistance").onchange = () => {
    state.projectionCustomDistance = Math.min(10000, Math.max(50, Number($("projectionCustomDistance").value) || 1000));
    save();
    renderProjection();
  };


  $("newSessionBtn").onclick =
    () => {

      if (
        !confirm(
          "Nouvelle séance ?"
        )
      ) {

        return;

      }


      state =
        base();
      setupStep = "cover";


      resetClock();

      resetTimedRuntime();

      save();

      render();

    };


  $("undoBtn").onclick =
    () => {

      if (
        isTimed()
      ) {

        return undoTimedLap();

      }


      const r =
        activeRunner();


      const a =
        r
          ? rr(r.id)
          : [];


      if (
        !a.length
      ) {

        return;

      }


      const id =
        a.at(-1).id;


      state.results =
        state.results.filter(
          x =>
            x.id !== id
        );


      save();

      renderPerf();

    };


  $("carnetBtn").onclick =
    () => {

      prepareExportDialog();

      $("carnetDialog").showModal();

    };


  $("openCarnetBtn").onclick =
    openCarnet;


  $("saveLaterBtn").onclick =
    buildSheet;

  $("downloadResultsBtn").onclick =
    downloadResultsForCarnet;

  $("shareResultsBtn").onclick =
    shareResultsForCarnet;


  $("closeSheetBtn").onclick =
    () =>
      $("sheetDialog").close();


  $("shareSheetBtn").onclick =
    async () => {

      const r =
        selectedExportRunner();


      try {

        await navigator
          .share({

            title:
              "Chrono EPS",

            text:
              resultTextFor(r)

          });

      } catch {}

    };


  $("startRecoveryBtn").onclick =
    () => {

      if (
        state.mode !== "ccf"
      ) {
        return;
      }

      if (
        !allDone(1)
      ) {

        return toast(
          "Termine d’abord le premier 800 des deux coureurs."
        );

      }


      state.recoveryStartedAt =
        Date.now();


      save();

      updateRecovery();

    };


  /* Mode principal */

  document
    .querySelectorAll(
      '[name="mode"]'
    )
    .forEach(
      x => {

        x.onclick =
          () => {

            if (!x.checked) {
              return;
            }


            state.mode =
              x.value;


            if (
              state.mode === "ccf"
            ) {

              state.totalDistance = 800;
              state.splitDistance = 200;
              state.displayMode = "cumulative";

            } else if (
              isExam500()
            ) {

              state.totalDistance = 500;
              state.splitDistance = 250;
              state.displayMode = "cumulative";

            }


            setupStep = isExamMode() ? "runners" : "tools";
            save();

            renderSetup();

          };

      }
    );


  /* Outil entraînement */

  document
    .querySelectorAll(
      '[name="trainingTool"]'
    )
    .forEach(
      x => {

        x.onclick =
          () => {

            if (!x.checked) {
              return;
            }


            state.trainingTool =
              x.value;


            resetClock();

            resetTimedRuntime();

            setupStep = "settings";
            save();

            renderSetup();

          };

      }
    );


  /* Chrono performance */

  $("chronoPlanMode").onchange =
    () => {

      readConfig();

      state.activeRace = 1;

      save();

      renderSetup();

    };


  $("chronoSeriesText").onchange =
    () => {

      readConfig();

      if (
        !state.chronoSeriesDistances
          .length
      ) {

        return toast(
          "Saisis au moins une distance."
        );

      }

      state.activeRace = 1;

      save();

      renderSetup();

    };


  $("chronoSeriesWithSplits").onchange =
    () => {

      readConfig();

      save();

      renderSetup();

    };


  $("totalDistance").onchange =
    () => {

      if (
        $("totalDistance").value === "custom"
      ) {

        setVisible(
          "customDistanceWrap",
          true
        );

        $("customDistance").value =
          state.totalDistance;

        $("customDistance").focus();

        return;

      }

      readConfig();

      save();

      renderSetup();

    };


  $("splitDistance").onchange =
    () => {

      if (
        $("splitDistance").value === "custom"
      ) {

        setVisible(
          "customSplitWrap",
          true
        );

        $("customSplit").value =
          state.splitDistance;

        $("customSplit").focus();

        return;

      }

      readConfig();

      save();

      renderSetup();

    };


  [
    "displayMode",
    "targetTime",
    "customDistance",
    "customSplit"
  ]
  .forEach(
    id => {

      $(id).onchange =
        () => {

          readConfig();

          save();

          renderSetup();

        };

    }
  );


  /* Minuteur */

  $("timerDuration").onchange =
    () => {

      state.timerDurationChoice =
        $("timerDuration").value;


      if (
        state.timerDurationChoice !==
        "custom"
      ) {

        state.timerDurationMs =
          +state.timerDurationChoice *
          1000;

      }


      save();

      renderSetup();

    };


  $("customTimerDuration").onchange =
    () => {

      state.timerDurationChoice =
        "custom";


      state.timerDurationMs =
        Math.max(
          .5,
          +$("customTimerDuration").value ||
          6
        ) *
        60000;


      save();

      renderSetup();

    };


  $("trackDistance").onchange =
    () => {

      state.trackDistanceChoice =
        $("trackDistance").value;


      if (
        state.trackDistanceChoice !==
        "custom"
      ) {

        state.trackDistance =
          +state.trackDistanceChoice;

      }


      save();

      renderSetup();

    };


  $("customTrackDistance").onchange =
    () => {

      state.trackDistanceChoice =
        "custom";


      state.trackDistance =
        Math.max(
          10,
          +$("customTrackDistance").value ||
          300
        );


      save();

      renderSetup();

    };


  /* VMA */

  $("vmaProtocol").onchange =
    () => {

      state.vmaProtocol =
        $("vmaProtocol").value;


      if (
        state.vmaProtocol === "6"
      ) {

        state.vmaDurationMs =
          360000;

      } else if (
        state.vmaProtocol === "12"
      ) {

        state.vmaDurationMs =
          720000;

      }


      save();

      renderSetup();

    };


  $("vmaCustomDuration").onchange =
    () => {

      state.vmaProtocol =
        "custom";


      state.vmaDurationMs =
        Math.max(
          .5,
          +$("vmaCustomDuration").value ||
          6
        ) *
        60000;


      save();

      renderSetup();

    };


  $("vmaTrackDistance").onchange =
    () => {

      state.vmaTrackDistanceChoice =
        $("vmaTrackDistance").value;


      if (
        state.vmaTrackDistanceChoice !==
        "custom"
      ) {

        state.vmaTrackDistance =
          +state.vmaTrackDistanceChoice;

      }


      save();

      renderSetup();

    };


  $("vmaCustomTrackDistance").onchange =
    () => {

      state.vmaTrackDistanceChoice =
        "custom";


      state.vmaTrackDistance =
        Math.max(
          10,
          +$("vmaCustomTrackDistance").value ||
          300
        );


      save();

      renderSetup();

    };


  /* Courses CCF */

  document
    .querySelectorAll(
      "[data-race]"
    )
    .forEach(
      x =>

        x.onclick =
          () =>
            setRace(
              +x.dataset.race
            )

    );


  /* Réseau et mises à jour : ne jamais recharger la prise de performance. */

  let swRegistration = null;
  let updatePending = false;
  let updateReloading = false;
  let updateChecking = false;
  let hadController = !!navigator.serviceWorker?.controller;

  function renderNetworkStatus() {
    $("offlineBadge").textContent = updatePending
      ? "Mise à jour prête · retour aux paramètres"
      : navigator.onLine ? "En ligne · v69" : "Hors ligne · v69";
  }

  function applyUpdateWhenSafe() {
    if (!updatePending || updateReloading || !navigator.onLine || running ||
        state.view === "performance" || document.visibilityState !== "visible" ||
        (state.recoveryStartedAt && Date.now() - state.recoveryStartedAt < 720000) ||
        document.querySelector("dialog[open]") ||
        document.activeElement?.matches("input, select, textarea") ||
        ["runnerLast", "runnerFirst", "runnerClass", "project1Min", "project1Sec",
         "project2Min", "project2Sec"].some(id => $(id)?.value.trim())) return;
    try {
      save();
      updateReloading = true;
      window.location.reload();
    } catch {
      // Une sauvegarde impossible doit empêcher le rechargement.
      updateReloading = false;
    }
  }

  async function checkForUpdate() {
    if (!swRegistration || !navigator.onLine || updateChecking) return;
    updateChecking = true;
    try {
      await swRegistration.update();
    } catch {
      // Réseau indisponible : la version hors ligne reste utilisable.
    } finally {
      updateChecking = false;
    }
  }

  window.addEventListener(
    "online",
    () => {
      renderNetworkStatus();
      checkForUpdate();
      applyUpdateWhenSafe();
    }
  );


  window.addEventListener(
    "offline",
    renderNetworkStatus
  );


  /* Service worker */

  if (
    "serviceWorker" in navigator
  ) {

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController) {
        updatePending = true;
        renderNetworkStatus();
        applyUpdateWhenSafe();
      }
      hadController = true;
    });

    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
      .then(registration => {
        swRegistration = registration;
        checkForUpdate();
      })
      .catch(() => {
        $("offlineBadge").textContent = "Hors ligne non disponible · v69";
      });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        checkForUpdate();
        applyUpdateWhenSafe();
      }
    });
    window.addEventListener("pageshow", () => {
      checkForUpdate();
      applyUpdateWhenSafe();
    });
    setInterval(checkForUpdate, 60000);
    setInterval(applyUpdateWhenSafe, 2000);

  }


  /* Boucle chrono */

  function tick() {

    if (
      state.view ===
      "performance"
    ) {

      renderTimer();

    }


    requestAnimationFrame(
      tick
    );

  }


  render();

  renderNetworkStatus();

  tick();

  updateRecovery();

})();

