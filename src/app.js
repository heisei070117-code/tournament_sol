(function () {
  "use strict";
  const E = window.TournamentEngine;
  const STORAGE_KEY = "bracket-studio-v1";
  const $ = (selector) => document.querySelector(selector);
  const refs = {
    name: $("#tournamentName"), input: $("#participantInput"), seedCount: $("#seedCount"),
    apply: $("#applyButton"), summary: $("#participantSummary"), seedEditor: $("#seedEditor"),
    draw: $("#drawButton"), manual: $("#manualButton"), redraw: $("#redrawButton"),
    clear: $("#clearResultsButton"), title: $("#displayTitle"), meta: $("#bracketMeta"),
    bracket: $("#bracket"), scroller: $("#bracketScroller"), empty: $("#emptyState"),
    manualPanel: $("#manualPanel"), manualSlots: $("#manualSlots"),
    cancelManual: $("#cancelManualButton"), confirmManual: $("#confirmManualButton"),
    json: $("#jsonButton"), svg: $("#svgButton"), print: $("#printButton"),
    importButton: $("#importButton"), importInput: $("#importInput"), toast: $("#toast"),
    saveStatus: $("#saveStatus"),
  };

  let state = {
    version: 1, name: "Summer Championship", participants: [], slots: [], rounds: [], mode: "draw",
  };
  let manualDraft = [];
  let toastTimer;
  let connectorFrame;

  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  }

  function showToast(message, error = false) {
    clearTimeout(toastTimer);
    refs.toast.textContent = message;
    refs.toast.className = `toast show${error ? " error" : ""}`;
    toastTimer = setTimeout(() => { refs.toast.className = "toast"; }, 2700);
  }

  function participant(id) { return state.participants.find((item) => item.id === id); }
  function roundName(index, count) {
    const remaining = count - index;
    if (remaining === 1) return "FINAL";
    if (remaining === 2) return "SEMI FINAL";
    if (remaining === 3) return "QUARTER FINAL";
    return `ROUND ${index + 1}`;
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    refs.saveStatus.textContent = `保存済み ${new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}`;
  }

  function parseNames() {
    return refs.input.value.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
  }

  function applyParticipants(preserveSeeds = false) {
    try {
      const names = parseNames();
      if (names.length < 2) throw new Error("参加者を2名以上入力してください。");
      if (names.length > 256) throw new Error("参加者は256名までにしてください。");
      const unique = new Set(names.map((name) => name.toLocaleLowerCase("ja")));
      if (unique.size !== names.length) throw new Error("同じ参加者名が重複しています。");
      let seedCount = Number(refs.seedCount.value || 0);
      if (!Number.isInteger(seedCount) || seedCount < 0 || seedCount > names.length) throw new Error("シード数は0から参加人数までで指定してください。");
      const oldByName = new Map(state.participants.map((item) => [item.name, item]));
      state.participants = names.map((name, index) => ({
        id: oldByName.get(name)?.id || `p-${Date.now().toString(36)}-${index}`,
        name,
        seed: preserveSeeds ? (oldByName.get(name)?.seed ?? null) : (index < seedCount ? index + 1 : null),
      }));
      const validSeeds = state.participants.filter((p) => p.seed != null && p.seed <= seedCount);
      if (preserveSeeds && validSeeds.length !== seedCount) {
        state.participants.forEach((p) => { p.seed = null; });
        state.participants.slice(0, seedCount).forEach((p, i) => { p.seed = i + 1; });
      }
      state.slots = [];
      state.rounds = [];
      renderSeedEditor(); renderBracket(); save();
      showToast(`${names.length}名の参加者を反映しました。`);
    } catch (error) { showToast(error.message, true); }
  }

  function renderSeedEditor() {
    const count = state.participants.length;
    const seedCount = Math.min(Number(refs.seedCount.value || 0), count);
    refs.seedCount.max = String(count || 0);
    refs.summary.textContent = count ? `${count}名 · ${E.nextPowerOfTwo(count)}枠 · BYE ${E.nextPowerOfTwo(count) - count}` : "";
    if (!seedCount) { refs.seedEditor.innerHTML = ""; return; }
    const assignments = Array.from({ length: seedCount }, (_, index) => {
      const seed = index + 1;
      const assigned = state.participants.find((p) => p.seed === seed);
      const options = state.participants.map((p) => {
        const currentLabel = p.seed && p.seed !== seed ? `（現在 第${p.seed}シード）` : "";
        return `<option value="${esc(p.id)}" ${p.id === assigned?.id ? "selected" : ""}>${esc(p.name)}${currentLabel}</option>`;
      }).join("");
      return `<label class="seed-assignment">
        <span class="seed-number">${seed}</span>
        <span class="seed-label">第${seed}シード</span>
        <select class="seed-select" data-seed="${seed}" aria-label="第${seed}シードのチーム">${options}</select>
      </label>`;
    }).join("");
    refs.seedEditor.innerHTML = `<div class="seed-editor-head"><strong>シード割り当て</strong><span>チームを選ぶと、割り当て済みの場合は自動で入れ替わります</span></div><div class="seed-assignment-list">${assignments}</div>`;
    refs.seedEditor.querySelectorAll("select").forEach((select) => select.addEventListener("change", handleSeedChange));
  }

  function handleSeedChange(event) {
    const seed = Number(event.target.dataset.seed);
    state.participants = E.assignSeed(state.participants, event.target.value, seed);
    renderSeedEditor(); save();
  }

  function validateSeedAssignment() {
    const desired = Number(refs.seedCount.value || 0);
    const assigned = state.participants.filter((p) => p.seed != null);
    if (assigned.length !== desired) throw new Error(`${desired}名分のシード番号を重複なく設定してください。`);
    E.validateParticipants(state.participants);
  }

  function runDraw() {
    try {
      if (state.participants.length < 2) applyParticipants();
      validateSeedAssignment();
      state.slots = E.createDraw(state.participants);
      state.rounds = E.buildBracket(state.slots);
      state.mode = "draw";
      refs.manualPanel.hidden = true;
      renderBracket(); save(); showToast("組み合わせを抽選しました。");
    } catch (error) { showToast(error.message, true); }
  }

  function openManual() {
    try {
      validateSeedAssignment();
      manualDraft = state.slots.length ? state.slots.slice() : E.createManualSlots(state.participants);
      refs.manualPanel.hidden = false;
      refs.scroller.hidden = true;
      renderManualSlots();
    } catch (error) { showToast(error.message, true); }
  }

  function renderManualSlots() {
    refs.manualSlots.innerHTML = manualDraft.map((selected, index) => {
      const options = [`<option value="">BYE（不戦勝枠）</option>`, ...state.participants.map((p) => `<option value="${esc(p.id)}" ${p.id === selected ? "selected" : ""}>${esc(p.name)}${p.seed ? ` [${p.seed}]` : ""}</option>`)].join("");
      return `<label class="manual-slot"><span>${index + 1}</span><select class="slot-select" data-index="${index}">${options}</select></label>`;
    }).join("");
    refs.manualSlots.querySelectorAll("select").forEach((select) => select.addEventListener("change", (event) => {
      const index = Number(event.target.dataset.index);
      const next = event.target.value || null;
      const old = manualDraft[index];
      const duplicate = next ? manualDraft.indexOf(next) : -1;
      manualDraft[index] = next;
      if (duplicate >= 0 && duplicate !== index) manualDraft[duplicate] = old;
      renderManualSlots();
    }));
  }

  function confirmManual() {
    const ids = manualDraft.filter(Boolean);
    const expected = state.participants.map((p) => p.id);
    if (ids.length !== expected.length || new Set(ids).size !== ids.length || expected.some((id) => !ids.includes(id))) {
      showToast("全参加者を重複なく1回ずつ配置してください。", true); return;
    }
    const hasDoubleBye = Array.from({ length: manualDraft.length / 2 }, (_, index) => manualDraft.slice(index * 2, index * 2 + 2))
      .some((pair) => pair.every((id) => id == null));
    if (hasDoubleBye) {
      showToast("同じ1回戦にBYEを2枠置くことはできません。BYEを別の試合へ分散してください。", true); return;
    }
    state.slots = manualDraft.slice();
    state.rounds = E.buildBracket(state.slots);
    state.mode = "manual";
    refs.manualPanel.hidden = true;
    refs.scroller.hidden = false;
    renderBracket(); save(); showToast("手動配置を確定しました。");
  }

  function competitorButton(id, status, match, side) {
    const p = participant(id);
    if (!p) {
      const pending = status === "pending";
      return `<button class="competitor ${pending ? "pending" : "bye"}" disabled><span class="name">${pending ? "対戦相手未確定" : "BYE"}</span></button>`;
    }
    const canChoose = match.aStatus === "ready" && match.bStatus === "ready";
    const winner = match.winnerId === id;
    return `<button class="competitor ${winner ? "winner" : ""}" data-winner="${esc(id)}" ${canChoose ? "" : "disabled"} aria-label="${esc(p.name)}を勝者にする">
      ${p.seed ? `<span class="seed-badge">${p.seed}</span>` : `<span class="seed-badge">${side}</span>`}
      <span class="name">${esc(p.name)}</span>${winner ? '<span class="check">✓</span>' : ""}
    </button>`;
  }

  function drawConnectors() {
    refs.bracket.querySelector(".bracket-connectors")?.remove();
    const roundNodes = [...refs.bracket.querySelectorAll(".round")];
    if (roundNodes.length < 2) return;
    const bracketRect = refs.bracket.getBoundingClientRect();
    const width = refs.bracket.scrollWidth;
    const height = refs.bracket.scrollHeight;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "bracket-connectors");
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("aria-hidden", "true");

    for (let roundIndex = 0; roundIndex < roundNodes.length - 1; roundIndex += 1) {
      const currentMatches = [...roundNodes[roundIndex].querySelectorAll(".match")];
      const nextMatches = [...roundNodes[roundIndex + 1].querySelectorAll(".match")];
      currentMatches.forEach((matchNode, matchIndex) => {
        const nextNode = nextMatches[Math.floor(matchIndex / 2)];
        if (!nextNode) return;
        const from = matchNode.getBoundingClientRect();
        const to = nextNode.getBoundingClientRect();
        const x1 = from.right - bracketRect.left;
        const y1 = from.top - bracketRect.top + from.height / 2;
        const x2 = to.left - bracketRect.left;
        const y2 = to.top - bracketRect.top + to.height / 2;
        const middle = x1 + (x2 - x1) / 2;
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const hasAdvanced = Boolean(state.rounds[roundIndex]?.[matchIndex]?.winnerId);
        path.setAttribute("class", `connector-path${hasAdvanced ? " advanced" : ""}`);
        path.setAttribute("d", `M ${x1} ${y1} H ${middle} V ${y2} H ${x2}`);
        svg.appendChild(path);
      });
    }
    refs.bracket.prepend(svg);
  }

  function scheduleConnectors() {
    cancelAnimationFrame(connectorFrame);
    connectorFrame = requestAnimationFrame(() => requestAnimationFrame(drawConnectors));
  }

  function renderBracket() {
    state.name = refs.name.value.trim() || "Untitled Tournament";
    refs.title.textContent = state.name;
    const n = state.participants.length;
    const roundCount = n >= 2 ? Math.log2(E.nextPowerOfTwo(n)) : 0;
    refs.meta.textContent = n ? `${n} PARTICIPANTS · ${roundCount} ROUNDS${state.mode === "manual" ? " · MANUAL" : ""}` : "NO PARTICIPANTS";
    refs.empty.hidden = Boolean(state.rounds.length);
    refs.scroller.hidden = !state.rounds.length;
    if (!state.rounds.length) { refs.bracket.innerHTML = ""; return; }
    refs.bracket.innerHTML = state.rounds.map((round, roundIndex) => {
      const matches = round.map((match, matchIndex) => `<article class="match ${match.winnerId ? "complete" : ""} ${roundIndex === state.rounds.length - 1 ? "final-match" : ""}" data-round="${roundIndex}" data-match="${matchIndex}">
        <div class="match-label"><span>MATCH ${matchIndex + 1}</span><span>${match.automatic ? "AUTO" : "BO1"}</span></div>
        ${competitorButton(match.a, match.aStatus, match, "A")}${competitorButton(match.b, match.bStatus, match, "B")}
      </article>`).join("");
      const championId = roundIndex === state.rounds.length - 1 ? round[0]?.winnerId : null;
      return `<section class="round"><div class="round-title"><strong>${roundName(roundIndex, state.rounds.length)}</strong>${round.length} MATCH${round.length > 1 ? "ES" : ""}</div><div class="round-matches">${matches}</div>${championId ? `<div class="champion"><small>CHAMPION</small><strong>${esc(participant(championId)?.name)}</strong></div>` : ""}</section>`;
    }).join("");
    refs.bracket.querySelectorAll("[data-winner]").forEach((button) => button.addEventListener("click", () => {
      const matchNode = button.closest(".match");
      try {
        state.rounds = E.setWinner(state.slots, state.rounds, Number(matchNode.dataset.round), Number(matchNode.dataset.match), button.dataset.winner);
        renderBracket(); save();
      } catch (error) { showToast(error.message, true); }
    }));
    scheduleConnectors();
  }

  function clearResults() {
    if (!state.slots.length) return;
    state.rounds = E.buildBracket(state.slots);
    renderBracket(); save(); showToast("試合結果をクリアしました。");
  }

  function download(content, filename, type) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([content], { type }));
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 500);
  }

  function safeFilename(extension) {
    return `${state.name.replace(/[\\/:*?"<>|]/g, "-").trim() || "tournament"}.${extension}`;
  }

  function exportJson() {
    download(JSON.stringify(state, null, 2), safeFilename("json"), "application/json");
    showToast("編集可能なJSONを保存しました。");
  }

  function exportSvg() {
    if (!state.rounds.length) { showToast("先にトーナメントを作成してください。", true); return; }
    const colWidth = 250, width = state.rounds.length * colWidth + 70, height = Math.max(500, state.slots.length * 58);
    const xml = (value) => esc(value);
    let content = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#f4f6f9"/><style>text{font-family:Arial,sans-serif;fill:#14213d}.head{font-weight:700;font-size:13px}.name{font-size:11px}.muted{fill:#8993a3;font-size:9px}.win{fill:#087d89;font-weight:700}</style><text x="30" y="28" class="head">${xml(state.name)}</text>`;
    state.rounds.forEach((round, r) => {
      const x = 30 + r * colWidth;
      content += `<text x="${x}" y="54" class="muted">${roundName(r, state.rounds.length)}</text>`;
      round.forEach((match, m) => {
        const spacing = (height - 90) / round.length;
        const y = 70 + m * spacing + spacing / 2 - 30;
        content += `<rect x="${x}" y="${y}" width="190" height="62" rx="6" fill="white" stroke="#cfd6e0"/><line x1="${x}" y1="${y + 31}" x2="${x + 190}" y2="${y + 31}" stroke="#e5e9ef"/>`;
        [[match.a, match.aStatus, y + 20], [match.b, match.bStatus, y + 51]].forEach(([id, status, ty]) => {
          const p = participant(id); const cls = match.winnerId === id ? "name win" : "name";
          const fallback = status === "pending" ? "対戦相手未確定" : "BYE";
          content += `<text x="${x + 10}" y="${ty}" class="${cls}">${xml(p ? `${p.seed ? `[${p.seed}] ` : ""}${p.name}` : fallback)}</text>`;
        });
        if (r < state.rounds.length - 1) {
          const nextRound = state.rounds[r + 1];
          const nextSpacing = (height - 90) / nextRound.length;
          const nextY = 70 + Math.floor(m / 2) * nextSpacing + nextSpacing / 2 + 1;
          const startX = x + 190;
          const endX = x + colWidth;
          const middle = startX + (endX - startX) / 2;
          const lineColor = match.winnerId ? "#df3348" : "#9ca8b8";
          const lineWidth = match.winnerId ? "2.5" : "1.5";
          content += `<path d="M ${startX} ${y + 31} H ${middle} V ${nextY} H ${endX}" fill="none" stroke="${lineColor}" stroke-width="${lineWidth}"/>`;
        }
      });
    });
    content += "</svg>";
    download(content, safeFilename("svg"), "image/svg+xml");
    showToast("トーナメント表をSVGで保存しました。");
  }

  async function importJson(file) {
    try {
      const imported = JSON.parse(await file.text());
      if (imported.version !== 1 || !Array.isArray(imported.participants) || !Array.isArray(imported.slots)) throw new Error("対応していないJSON形式です。");
      E.validateParticipants(imported.participants);
      const ids = new Set(imported.participants.map((p) => p.id));
      if (imported.slots.some((id) => id != null && !ids.has(id))) throw new Error("参加者と枠の情報が一致しません。");
      state = imported;
      state.rounds = state.slots.length ? E.buildBracket(state.slots, state.rounds || []) : [];
      refs.name.value = state.name;
      refs.input.value = state.participants.map((p) => p.name).join("\n");
      refs.seedCount.value = state.participants.filter((p) => p.seed != null).length;
      renderSeedEditor(); renderBracket(); save(); showToast("JSONを読み込みました。");
    } catch (error) { showToast(`読込エラー: ${error.message}`, true); }
    refs.importInput.value = "";
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved?.version === 1 && saved.participants?.length >= 2) {
        state = saved;
        refs.name.value = state.name;
        refs.input.value = state.participants.map((p) => p.name).join("\n");
        refs.seedCount.value = state.participants.filter((p) => p.seed != null).length;
        state.rounds = state.slots?.length ? E.buildBracket(state.slots, state.rounds || []) : [];
        renderSeedEditor(); renderBracket(); return;
      }
    } catch (_) { localStorage.removeItem(STORAGE_KEY); }
    applyParticipants(); runDraw();
  }

  refs.apply.addEventListener("click", () => applyParticipants(false));
  refs.seedCount.addEventListener("change", () => applyParticipants(false));
  refs.name.addEventListener("input", () => { state.name = refs.name.value; renderBracket(); save(); });
  refs.draw.addEventListener("click", runDraw);
  refs.redraw.addEventListener("click", runDraw);
  refs.manual.addEventListener("click", openManual);
  refs.cancelManual.addEventListener("click", () => { refs.manualPanel.hidden = true; refs.scroller.hidden = !state.rounds.length; });
  refs.confirmManual.addEventListener("click", confirmManual);
  refs.clear.addEventListener("click", clearResults);
  refs.json.addEventListener("click", exportJson);
  refs.svg.addEventListener("click", exportSvg);
  refs.print.addEventListener("click", () => window.print());
  refs.importButton.addEventListener("click", () => refs.importInput.click());
  refs.importInput.addEventListener("change", () => refs.importInput.files[0] && importJson(refs.importInput.files[0]));
  window.addEventListener("resize", scheduleConnectors);
  window.addEventListener("beforeprint", drawConnectors);
  load();
})();
