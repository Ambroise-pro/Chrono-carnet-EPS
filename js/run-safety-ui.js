(() => {
  "use strict";

  const KEY = "chronoCarnetEPS_v4";
  const $ = id => document.getElementById(id);

  function readState() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "{}");
    } catch {
      return {};
    }
  }

  function writeState(state) {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  function nameOf(runner) {
    return runner?.last
      ? String(runner.last).toUpperCase() + " " + String(runner.first || "")
      : String(runner?.name || "Élève");
  }

  function modeInfo(state) {
    if (state.mode === "ccf") {
      return {
        title: "CCF · 800 m n°" + (state.activeRace || 1),
        detail: "Intermédiaires : tous les 200 m",
        action: "Appuie sur TOUR à 200, 400, 600 m, puis à 800 m pour valider l’arrivée."
      };
    }

    if (state.mode === "exam500") {
      return {
        title: "Examen · 500 m n°" + (state.activeRace || 1),
        detail: "Intermédiaire : 250 m",
        action: "Appuie sur TOUR à 250 m, puis encore sur TOUR à 500 m pour valider l’arrivée."
      };
    }

    if (state.trainingTool === "timer" || state.trainingTool === "vma") {
      const track = state.trainingTool === "vma"
        ? Number(state.vmaTrackDistance || 0)
        : Number(state.trackDistance || 0);

      return {
        title: state.trainingTool === "vma" ? "Test VMA" : "Course au temps",
        detail: "Piste : " + track + " m",
        action: "Appuie sur +1 TOUR à chaque tour complet. À la fin, indique la distance supplémentaire."
      };
    }

    if (state.trainingTool === "simple") {
      return {
        title: "Chrono simple",
        detail: "Aucun intermédiaire",
        action: "Appuie sur STOP à la fin du chrono."
      };
    }

    const race = Number(state.activeRace || 1);
    const distances = Array.isArray(state.chronoSeriesDistances)
      ? state.chronoSeriesDistances
      : [];
    const distance = state.chronoPlanMode === "series"
      ? Number(distances[race - 1] || state.totalDistance || 0)
      : Number(state.totalDistance || 0);
    const withSplits = state.chronoPlanMode === "series"
      ? !!state.chronoSeriesWithSplits
      : state.chronoSingleWithSplits !== false;
    const split = Number(state.splitDistance || distance);

    if (withSplits && split > 0 && split < distance && distance % split === 0) {
      return {
        title: "Course : " + distance + " m",
        detail: "Intermédiaires : tous les " + split + " m",
        action: "Appuie sur TOUR à chaque " + split + " m, puis encore sur TOUR à l’arrivée pour valider la course."
      };
    }

    return {
      title: "Course : " + distance + " m",
      detail: "Aucun intermédiaire sélectionné",
      action: "Appuie une seule fois sur TOUR à l’arrivée pour valider la course."
    };
  }

  function installBriefing() {
    const start = $("startBtn");
    if (!start || start.dataset.briefingBound === "1") return;

    start.dataset.briefingBound = "1";

    start.addEventListener("click", event => {
      if (start.dataset.briefingBypass === "1") {
        start.dataset.briefingBypass = "";
        return;
      }

      const state = readState();
      if (state.view !== "performance") return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const info = modeInfo(state);
      const runner = (state.runners || []).find(r => r.id === state.activeRunnerId);

      let dialog = $("startBriefingDialog");
      if (!dialog) {
        dialog = document.createElement("dialog");
        dialog.id = "startBriefingDialog";
        dialog.className = "choiceDialog";
        document.body.appendChild(dialog);
      }

      dialog.innerHTML =
        '<div class="dialogPanel startBriefingPanel">' +
          '<p class="eyebrow">AVANT LE DÉPART</p>' +
          '<h3>' + info.title + '</h3>' +
          (runner ? '<p><strong>' + nameOf(runner) + '</strong>' +
            (runner.classroom ? ' · ' + runner.classroom : '') + '</p>' : '') +
          '<div class="startBriefingBand">' +
            '<strong>' + info.detail + '</strong>' +
            '<span>' + info.action + '</span>' +
          '</div>' +
          '<div class="startBriefingActions">' +
            '<button type="button" id="briefingCancel" class="btn soft">Annuler</button>' +
            '<button type="button" id="briefingGo" class="btn primary">J’ai compris · DÉPART</button>' +
          '</div>' +
        '</div>';

      $("briefingCancel").onclick = () => dialog.close();
      $("briefingGo").onclick = () => {
        dialog.close();
        start.dataset.briefingBypass = "1";
        start.click();
      };

      dialog.showModal();
    }, true);
  }

  function installStopButton() {
    const timerCard = document.querySelector(".timerCard");
    if (!timerCard || $("stopRunnerBtn")) return;

    const button = document.createElement("button");
    button.id = "stopRunnerBtn";
    button.type = "button";
    button.className = "btn stopRunnerBtn";
    button.textContent = "⚠ Arrêt élève";

    timerCard.insertBefore(button, timerCard.firstChild);

    button.onclick = () => {
      const state = readState();
      const runners = (state.runners || []).filter(r => !r.stopped);

      if (!runners.length) {
        alert("Aucun élève à neutraliser.");
        return;
      }

      let dialog = $("stopRunnerDialog");
      if (!dialog) {
        dialog = document.createElement("dialog");
        dialog.id = "stopRunnerDialog";
        dialog.className = "choiceDialog";
        document.body.appendChild(dialog);
      }

      dialog.innerHTML =
        '<div class="dialogPanel">' +
          '<h3>⚠ Arrêt élève</h3>' +
          '<p>Choisis l’élève qui doit arrêter. Le motif enregistré sera <strong>Blessé / autre</strong>.</p>' +
          runners.map(r =>
            '<button type="button" class="choiceBtn" data-stop-id="' + r.id + '">' +
              '<strong>' + nameOf(r) + '</strong>' +
              '<span>' + String(r.classroom || "") + '</span>' +
            '</button>'
          ).join("") +
          '<button type="button" id="stopRunnerCancel" class="btn soft full">Annuler</button>' +
        '</div>';

      dialog.querySelectorAll("[data-stop-id]").forEach(choice => {
        choice.onclick = () => {
          const fresh = readState();
          const runner = (fresh.runners || []).find(r => r.id === choice.dataset.stopId);
          if (!runner) return;

          if (!confirm(
            "Marquer " + nameOf(runner) + " en « Blessé / autre » ?\n\n" +
            "Les courses déjà terminées seront conservées. Les courses restantes seront neutralisées."
          )) return;

          runner.stopped = true;
          runner.stoppedReason = "Blessé / autre";
          runner.stoppedAt = new Date().toISOString();
          runner.stoppedRace = Number(fresh.activeRace || 1);

          const race = Number(fresh.activeRace || 1);
          const current = (fresh.results || []).filter(
            row => row.runnerId === runner.id && Number(row.race) === race
          );

          let required = 1;
          if (fresh.mode === "ccf") required = 4;
          else if (fresh.mode === "exam500") required = 2;
          else if (fresh.trainingTool === "chrono") {
            const distances = Array.isArray(fresh.chronoSeriesDistances)
              ? fresh.chronoSeriesDistances
              : [];
            const distance = fresh.chronoPlanMode === "series"
              ? Number(distances[race - 1] || fresh.totalDistance || 0)
              : Number(fresh.totalDistance || 0);
            const withSplits = fresh.chronoPlanMode === "series"
              ? !!fresh.chronoSeriesWithSplits
              : fresh.chronoSingleWithSplits !== false;
            const split = withSplits ? Number(fresh.splitDistance || distance) : distance;
            required = Math.max(1, Math.floor(distance / Math.max(1, split)));
          }

          if (current.length > 0 && current.length < required) {
            fresh.results = (fresh.results || []).filter(
              row => !(row.runnerId === runner.id && Number(row.race) === race)
            );
          }

          if (fresh.activeRunnerId === runner.id) {
            const next = (fresh.runners || []).find(r => !r.stopped && r.id !== runner.id);
            fresh.activeRunnerId = next?.id || null;
          }

          writeState(fresh);
          dialog.close();

          window.dispatchEvent(new CustomEvent("chrono-runner-stopped", {
            detail: { runnerId: runner.id }
          }));

          window.location.reload();
        };
      });

      $("stopRunnerCancel").onclick = () => dialog.close();
      dialog.showModal();
    };
  }

  function refreshStopButton() {
    const button = $("stopRunnerBtn");
    if (!button) return;

    const state = readState();
    button.classList.toggle(
      "hidden",
      state.view !== "performance" ||
      state.trainingTool === "simple" ||
      !(state.runners || []).some(r => !r.stopped)
    );
  }

  function installStyles() {
    if ($("runSafetyStyles")) return;

    const style = document.createElement("style");
    style.id = "runSafetyStyles";
    style.textContent = `
      .stopRunnerBtn{
        position:absolute;top:14px;right:14px;z-index:4;
        background:#fff7ed;color:#9a3412;border:1px solid #fdba74;
        padding:8px 11px;font-size:12px
      }
      .timerCard{position:relative}
      .startBriefingPanel h3{font-size:28px;margin:4px 0 8px}
      .startBriefingBand{
        display:grid;gap:8px;margin:18px 0;padding:18px;
        border-radius:16px;background:#eff6ff;border:2px solid #93c5fd;
        color:#1e3a8a;font-size:17px;line-height:1.45
      }
      .startBriefingBand strong{font-size:20px}
      .startBriefingActions{display:flex;justify-content:flex-end;gap:10px}
      @media(max-width:620px){
        .stopRunnerBtn{top:10px;right:10px;padding:7px 9px}
        .startBriefingActions{display:grid;grid-template-columns:1fr}
      }
    `;
    document.head.appendChild(style);
  }

  function install() {
    installStyles();
    installBriefing();
    installStopButton();
    refreshStopButton();

    const observer = new MutationObserver(() => {
      installBriefing();
      installStopButton();
      refreshStopButton();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"]
    });
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", install)
    : install();
})();