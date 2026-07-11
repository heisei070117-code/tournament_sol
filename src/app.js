(function () {
  "use strict";
  const E = window.TournamentEngine;
  const STORAGE_KEY = "bracket-studio-v1";
  const LAYOUT_UNIT = 58;
  const MATCH_HEIGHT = 94;
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
  function roundName(round, displayRound) {
    if (displayRound.isPreliminary) return "PRELIMINARY";
    const entrants = round.length * 2;
    if (entrants === 2) return "FINAL";
    if (entrants === 4) return "SEMI FINAL";
    if (entrants === 8) return "QUARTER FINAL";
    return `ROUND OF ${entrants}`;
  }

  function cardEdgeConnectorPath(startX, startY, laneX, outerY, targetX, targetY) {
    const firstDirection = outerY >= startY ? 1 : -1;
    const finalDirection = targetY >= outerY ? 1 : -1;
    const radius = Math.min(
      6,
      Math.abs(outerY - startY) / 2,
      Math.abs(targetY - outerY) / 2,
      Math.max(0, laneX - startX) / 2,
      Math.max(0, targetX - laneX) / 2,
    );
    if (radius < 1) return `M ${startX} ${startY} H ${laneX} V ${outerY} H ${targetX} V ${targetY}`;
    return `M ${startX} ${startY} H ${laneX - radius} Q ${laneX} ${startY} ${laneX} ${startY + firstDirection * radius} V ${outerY - firstDirection * radius} Q ${laneX} ${outerY} ${laneX + radius} ${outerY} H ${targetX - radius} Q ${targetX} ${outerY} ${targetX} ${outerY + finalDirection * radius} V ${targetY}`;
  }

  function singleBendConnectorPath(startX, startY, targetX, targetY) {
    const direction = targetY >= startY ? 1 : -1;
    const radius = Math.min(6, Math.max(0, targetX - startX) / 2, Math.abs(targetY - startY) / 2);
    if (radius < 1) return `M ${startX} ${startY} H ${targetX} V ${targetY}`;
    return `M ${startX} ${startY} H ${targetX - radius} Q ${targetX} ${startY} ${targetX} ${startY + direction * radius} V ${targetY}`;
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
      return `<div class="competitor ${pending ? "pending" : "bye"}"><span class="name">${pending ? "対戦相手未確定" : "BYE"}</span></div>`;
    }
    const canChoose = match.aStatus === "ready" && match.bStatus === "ready";
    const winner = match.winnerId === id;
    const score = side === "A" ? match.scoreA : match.scoreB;
    const scoreSide = side.toLowerCase();
    return `<div class="competitor ${winner ? "winner" : ""}">
      <button class="competitor-pick" data-winner="${esc(id)}" ${canChoose ? "" : "disabled"} aria-label="${esc(p.name)}を勝者にする">
        ${p.seed ? `<span class="seed-badge">${p.seed}</span>` : `<span class="seed-badge">${side}</span>`}
        <span class="name">${esc(p.name)}</span>${winner ? '<span class="check">✓</span>' : ""}
      </button>
      <input class="score-input" data-score-side="${scoreSide}" type="number" min="0" max="999" step="1" inputmode="numeric" value="${score ?? ""}" ${canChoose ? "" : "disabled"} aria-label="${esc(p.name)}のスコア">
    </div>`;
  }

  function drawConnectors() {
    refs.bracket.querySelector(".bracket-connectors")?.remove();
    const roundNodes = [...refs.bracket.querySelectorAll(".round")];
    if (!roundNodes.length) return;
    const bracketRect = refs.bracket.getBoundingClientRect();
    const width = refs.bracket.scrollWidth;
    const height = refs.bracket.scrollHeight;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "bracket-connectors");
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("aria-hidden", "true");

    function appendPath(d, advanced = false) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("class", `connector-path${advanced ? " advanced" : ""}`);
      path.setAttribute("d", d);
      svg.appendChild(path);
    }

    for (let displayIndex = 0; displayIndex < roundNodes.length; displayIndex += 1) {
      const currentRoundNode = roundNodes[displayIndex];
      const nextRoundNode = roundNodes[displayIndex + 1] ?? null;
      const roundIndex = Number(currentRoundNode.dataset.round);
      const currentMatches = [...currentRoundNode.querySelectorAll(".match")];
      currentMatches.forEach((matchNode) => {
        const matchIndex = Number(matchNode.dataset.match);
        const sourceMatch = state.rounds[roundIndex]?.[matchIndex];
        const competitorNodes = [...matchNode.querySelectorAll(".competitor")];
        if (!sourceMatch || competitorNodes.length !== 2) return;

        const matchRect = matchNode.getBoundingClientRect();
        const competitorRects = competitorNodes.map((node) => node.getBoundingClientRect());
        const startPoints = competitorRects.map((rect) => ({
          x: rect.right - bracketRect.left,
          y: rect.top - bracketRect.top + rect.height / 2,
        }));
        const joinX = matchRect.right - bracketRect.left + 14;
        const joinY = (startPoints[0].y + startPoints[1].y) / 2;

        // 対戦する2チームからそれぞれ線を出し、カード右側で合流させる。
        appendPath(`M ${startPoints[0].x} ${startPoints[0].y} H ${joinX} V ${startPoints[1].y} H ${startPoints[1].x}`);

        // 勝者側の枝だけを合流点まで赤く重ねる。
        const winnerSide = sourceMatch.winnerId === sourceMatch.a ? 0 : sourceMatch.winnerId === sourceMatch.b ? 1 : -1;
        if (winnerSide >= 0) {
          const winnerPoint = startPoints[winnerSide];
          appendPath(`M ${winnerPoint.x} ${winnerPoint.y} H ${joinX} V ${joinY}`, true);
        }

        if (nextRoundNode) {
          const targetMatchIndex = Math.floor(matchIndex / 2);
          const nextNode = nextRoundNode.querySelector(`.match[data-match="${targetMatchIndex}"]`);
          if (!nextNode) return;
          const targetRect = nextNode.getBoundingClientRect();
          const targetSlot = E.getTargetSlotIndex(matchIndex);
          const targetX = targetRect.left - bracketRect.left + targetRect.width / 2;
          const targetY = (targetSlot === 0 ? targetRect.top : targetRect.bottom) - bracketRect.top;
          const outerY = targetY + (targetSlot === 0 ? -14 : 14);
          const laneX = targetRect.left - bracketRect.left - (targetSlot === 0 ? 30 : 16);
          const hasClearApproach = targetSlot === 0 ? joinY <= targetY - 8 : joinY >= targetY + 8;
          appendPath(
            hasClearApproach
              ? singleBendConnectorPath(joinX, joinY, targetX, targetY)
              : cardEdgeConnectorPath(joinX, joinY, laneX, outerY, targetX, targetY),
            E.hasAdvancedWinner(sourceMatch),
          );
        } else {
          // 決勝は次戦がないため、合流点から短い優勝ラインを出す。
          appendPath(`M ${joinX} ${joinY} H ${joinX + 20}`, Boolean(sourceMatch.winnerId));
        }
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
    refs.meta.textContent = n ? `${n} PARTICIPANTS · ${roundCount} ROUNDS` : "NO PARTICIPANTS";
    refs.empty.hidden = Boolean(state.rounds.length);
    refs.scroller.hidden = !state.rounds.length;
    if (!state.rounds.length) { refs.bracket.innerHTML = ""; return; }
    const displayRounds = E.createDisplayRounds(state.rounds);
    const layout = E.createBracketLayout(state.rounds);
    const contentHeight = layout.leafUnits * LAYOUT_UNIT;
    const bracketHeight = Math.max(590, contentHeight);
    const layoutOffset = (bracketHeight - contentHeight) / 2;
    refs.bracket.style.setProperty("--bracket-height", `${bracketHeight}px`);
    const preliminaryCount = displayRounds[0]?.isPreliminary ? displayRounds[0].matches.length : 0;
    refs.meta.textContent = `${n} PARTICIPANTS · ${preliminaryCount ? `${preliminaryCount} PRELIMINARY MATCHES · ` : ""}${roundCount} ROUNDS${state.mode === "manual" ? " · MANUAL" : ""}`;
    refs.bracket.innerHTML = displayRounds.map((displayRound) => {
      const { roundIndex } = displayRound;
      const round = state.rounds[roundIndex];
      const matches = displayRound.matches.map(({ match, matchIndex }, displayMatchIndex) => {
        const top = layoutOffset + layout.centers[roundIndex][matchIndex] * LAYOUT_UNIT - MATCH_HEIGHT / 2;
        return `<article class="match ${match.winnerId ? "complete" : ""} ${roundIndex === state.rounds.length - 1 ? "final-match" : ""}" style="top:${top}px" data-round="${roundIndex}" data-match="${matchIndex}">
        <div class="match-label"><span>MATCH ${displayMatchIndex + 1}</span><span>${match.automatic ? "AUTO" : "BO1"}</span></div>
        ${competitorButton(match.a, match.aStatus, match, "A")}${competitorButton(match.b, match.bStatus, match, "B")}
      </article>`;
      }).join("");
      const championId = roundIndex === state.rounds.length - 1 ? round[0]?.winnerId : null;
      const visibleCount = displayRound.matches.length;
      const matchSummary = displayRound.isPreliminary ? `${visibleCount} PLAY-IN MATCH${visibleCount > 1 ? "ES" : ""}` : `${round.length} MATCH${round.length > 1 ? "ES" : ""}`;
      const championTop = layoutOffset + layout.centers[roundIndex][0] * LAYOUT_UNIT + MATCH_HEIGHT / 2 + 14;
      const champion = championId ? `<div class="champion" style="top:${championTop}px"><small>CHAMPION</small><strong>${esc(participant(championId)?.name)}</strong></div>` : "";
      return `<section class="round ${displayRound.isPreliminary ? "preliminary-round" : ""}" data-round="${roundIndex}"><div class="round-title"><strong>${roundName(round, displayRound)}</strong>${matchSummary}</div><div class="round-matches">${matches}${champion}</div></section>`;
    }).join("");
    refs.bracket.querySelectorAll("[data-winner]").forEach((button) => button.addEventListener("click", () => {
      const matchNode = button.closest(".match");
      try {
        state.rounds = E.setWinner(state.slots, state.rounds, Number(matchNode.dataset.round), Number(matchNode.dataset.match), button.dataset.winner);
        renderBracket(); save();
      } catch (error) { showToast(error.message, true); }
    }));
    refs.bracket.querySelectorAll("[data-score-side]").forEach((input) => input.addEventListener("change", () => {
      const matchNode = input.closest(".match");
      try {
        state.rounds = E.setScore(state.rounds, Number(matchNode.dataset.round), Number(matchNode.dataset.match), input.dataset.scoreSide, input.value);
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
    const displayRounds = E.createDisplayRounds(state.rounds);
    const layout = E.createBracketLayout(state.rounds);
    const layoutContentHeight = layout.leafUnits * LAYOUT_UNIT;
    const svgBracketHeight = Math.max(410, layoutContentHeight);
    const layoutOffset = (svgBracketHeight - layoutContentHeight) / 2;
    const colWidth = 250;
    const width = displayRounds.length * colWidth + 70;
    const height = svgBracketHeight + 90;
    const xml = (value) => esc(value);
    let content = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#f4f6f9"/><style>text{font-family:Arial,sans-serif;fill:#14213d}.head{font-weight:700;font-size:13px}.name{font-size:11px}.muted{fill:#8993a3;font-size:9px}.win{fill:#087d89;font-weight:700}</style><text x="30" y="28" class="head">${xml(state.name)}</text>`;
    displayRounds.forEach((displayRound, displayIndex) => {
      const round = state.rounds[displayRound.roundIndex];
      const x = 30 + displayIndex * colWidth;
      content += `<text x="${x}" y="54" class="muted">${roundName(round, displayRound)}</text>`;
      displayRound.matches.forEach(({ match, matchIndex }) => {
        const y = 70 + layoutOffset + layout.centers[displayRound.roundIndex][matchIndex] * LAYOUT_UNIT - 31;
        content += `<rect x="${x}" y="${y}" width="190" height="62" rx="6" fill="white" stroke="#cfd6e0"/><line x1="${x}" y1="${y + 31}" x2="${x + 190}" y2="${y + 31}" stroke="#e5e9ef"/>`;
        [[match.a, match.aStatus, match.scoreA, y + 20], [match.b, match.bStatus, match.scoreB, y + 51]].forEach(([id, status, score, ty]) => {
          const p = participant(id); const cls = match.winnerId === id ? "name win" : "name";
          const fallback = status === "pending" ? "対戦相手未確定" : "BYE";
          content += `<text x="${x + 10}" y="${ty}" class="${cls}">${xml(p ? `${p.seed ? `[${p.seed}] ` : ""}${p.name}` : fallback)}</text>`;
          if (p && score != null) content += `<text x="${x + 180}" y="${ty}" text-anchor="end" class="${cls}">${score}</text>`;
        });
        const startX = x + 190;
        const joinX = startX + 14;
        const topY = y + 16;
        const bottomY = y + 47;
        const joinY = (topY + bottomY) / 2;
        content += `<path d="M ${startX} ${topY} H ${joinX} V ${bottomY} H ${startX}" fill="none" stroke="#9ca8b8" stroke-width="1.5"/>`;
        const winnerSide = match.winnerId === match.a ? 0 : match.winnerId === match.b ? 1 : -1;
        if (winnerSide >= 0) {
          const winnerY = winnerSide === 0 ? topY : bottomY;
          content += `<path d="M ${startX} ${winnerY} H ${joinX} V ${joinY}" fill="none" stroke="#df3348" stroke-width="2.5"/>`;
        }
        if (displayIndex < displayRounds.length - 1) {
          const nextDisplayRound = displayRounds[displayIndex + 1];
          const targetMatchIndex = Math.floor(matchIndex / 2);
          const targetVisibleIndex = nextDisplayRound.matches.findIndex((entry) => entry.matchIndex === targetMatchIndex);
          if (targetVisibleIndex < 0) return;
          const nextCardY = 70 + layoutOffset + layout.centers[nextDisplayRound.roundIndex][targetMatchIndex] * LAYOUT_UNIT - 31;
          const targetSlot = E.getTargetSlotIndex(matchIndex);
          const nextCardX = x + colWidth;
          const targetX = nextCardX + 95;
          const targetY = nextCardY + (targetSlot === 0 ? 0 : 62);
          const outerY = targetY + (targetSlot === 0 ? -14 : 14);
          const laneX = nextCardX - (targetSlot === 0 ? 30 : 16);
          const hasClearApproach = targetSlot === 0 ? joinY <= targetY - 8 : joinY >= targetY + 8;
          const hasAdvanced = E.hasAdvancedWinner(match);
          const lineColor = hasAdvanced ? "#df3348" : "#9ca8b8";
          const lineWidth = hasAdvanced ? "2.5" : "1.5";
          const connectorPath = hasClearApproach
            ? singleBendConnectorPath(joinX, joinY, targetX, targetY)
            : cardEdgeConnectorPath(joinX, joinY, laneX, outerY, targetX, targetY);
          content += `<path d="${connectorPath}" fill="none" stroke="${lineColor}" stroke-width="${lineWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
        } else {
          const lineColor = match.winnerId ? "#df3348" : "#9ca8b8";
          const lineWidth = match.winnerId ? "2.5" : "1.5";
          content += `<path d="M ${joinX} ${joinY} H ${joinX + 20}" fill="none" stroke="${lineColor}" stroke-width="${lineWidth}"/>`;
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
