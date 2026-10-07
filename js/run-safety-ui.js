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
    // v66: pas de pop-up avant le départ.
  }

  function installStopButton() {
    const timerCard = document.querySelector(".timerCard");
    if (!timerCard || $("stopRunnerBtn")) return;

    const button = document.createElement("button");
    button.id = "stopRunnerBtn";
    button.type = "button";
    button.className = "btn stopRunnerBtn";
    button.textContent = "✚ Infirmerie";

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
          '<h3>✚ Infirmerie · arrêt élève</h3>' +
          '<p>Choisis l’élève qui doit arrêter. Le motif enregistré sera <strong>Inapte / arrêt médical</strong>.</p>' +
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
            "Marquer " + nameOf(runner) + " en « Inapte / arrêt médical » ?\n\n" +
            "Les courses déjà terminées seront conservées. Les courses restantes seront neutralisées."
          )) return;

          runner.stopped = true;
          runner.stoppedReason = "Inapte / arrêt médical";
          runner.stoppedAt = new Date().toISOString();
          runner.stoppedRace = Number(fresh.activeRace || 1);

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
    const simpleTraining =
      state.mode === "training" &&
      state.trainingTool === "simple";

    button.classList.toggle(
      "hidden",
      state.view !== "performance" ||
      simpleTraining ||
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
        background:#fff;color:#b91c1c;border:2px solid #ef4444;
        padding:8px 11px;font-size:12px;font-weight:900;
        box-shadow:0 6px 18px rgba(185,28,28,.18)
      }
      .timerCard{position:relative}
      .startReminder{
        background:#fff7ed!important;
        color:#7c2d12!important;
        border:3px solid #fb923c!important;
        box-shadow:0 0 0 4px rgba(251,146,60,.18),0 10px 26px rgba(124,45,18,.18)!important;
        font-weight:950!important;
        font-size:17px!important;
        line-height:1.35!important;
      }
      .startReminder:not(.hidden){
        animation:chronoReminderPulse 1s ease-in-out infinite;
      }
      @keyframes chronoReminderPulse{
        0%,100%{transform:scale(1);background:#fff7ed}
        50%{transform:scale(1.025);background:#ffedd5}
      }
      .stopRunnerBtn::first-letter{font-size:16px}
      @media(max-width:620px){
        .stopRunnerBtn{top:10px;right:10px;padding:7px 9px}
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