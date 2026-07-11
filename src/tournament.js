(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TournamentEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function nextPowerOfTwo(value) {
    if (!Number.isInteger(value) || value < 2) throw new Error("参加者は2名以上必要です。");
    let result = 2;
    while (result < value) result *= 2;
    return result;
  }

  function seedOrder(size) {
    if (size < 2 || (size & (size - 1)) !== 0) throw new Error("枠数は2の累乗である必要があります。");
    let order = [1, 2];
    while (order.length < size) {
      const nextSize = order.length * 2;
      order = order.flatMap((seed) => [seed, nextSize + 1 - seed]);
    }
    return order;
  }

  function shuffle(items, random = Math.random) {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function validateParticipants(participants) {
    if (!Array.isArray(participants) || participants.length < 2) throw new Error("参加者は2名以上必要です。");
    const names = new Set();
    const seeds = new Set();
    participants.forEach((participant) => {
      const name = String(participant.name || "").trim();
      if (!name) throw new Error("参加者名を入力してください。");
      const key = name.toLocaleLowerCase("ja");
      if (names.has(key)) throw new Error(`参加者名「${name}」が重複しています。`);
      names.add(key);
      if (participant.seed != null) {
        if (!Number.isInteger(participant.seed) || participant.seed < 1) throw new Error("シード番号が不正です。");
        if (seeds.has(participant.seed)) throw new Error(`第${participant.seed}シードが重複しています。`);
        seeds.add(participant.seed);
      }
    });
  }

  function assignSeed(participants, participantId, seed) {
    if (!Number.isInteger(seed) || seed < 1) throw new Error("シード番号が不正です。");
    const selected = participants.find((p) => p.id === participantId);
    if (!selected) throw new Error("シードへ割り当てる参加者が見つかりません。");
    if (selected.seed === seed) return participants.map((p) => ({ ...p }));
    const previousSeed = selected.seed;
    return participants.map((p) => {
      if (p.id === participantId) return { ...p, seed };
      if (p.seed === seed) return { ...p, seed: previousSeed ?? null };
      return { ...p };
    });
  }

  function isWinningPath(sourceMatch, targetMatch) {
    return Boolean(
      sourceMatch?.winnerId
      && targetMatch?.winnerId
      && sourceMatch.winnerId === targetMatch.winnerId
    );
  }

  function createDisplayRounds(rounds) {
    if (!Array.isArray(rounds) || rounds.length === 0) return [];
    const firstRoundHasByes = rounds[0].some((match) => match.aStatus === "bye" || match.bStatus === "bye");
    return rounds.map((round, roundIndex) => {
      const matches = round
        .map((match, matchIndex) => ({ match, matchIndex }))
        .filter(({ match }) => !firstRoundHasByes
          || roundIndex !== 0
          || (match.aStatus === "ready" && match.bStatus === "ready"));
      return {
        roundIndex,
        isPreliminary: firstRoundHasByes && roundIndex === 0,
        matches,
      };
    });
  }

  function getTargetSlotIndex(matchIndex) {
    if (!Number.isInteger(matchIndex) || matchIndex < 0) throw new Error("試合番号が不正です。");
    return matchIndex % 2;
  }

  function createDraw(participants, random = Math.random) {
    validateParticipants(participants);
    const size = nextPowerOfTwo(participants.length);
    const order = seedOrder(size);
    const slots = Array(size).fill(null);
    const seeded = participants.filter((p) => p.seed != null).sort((a, b) => a.seed - b.seed);
    const unseeded = participants.filter((p) => p.seed == null);

    seeded.forEach((participant) => {
      if (participant.seed > size) throw new Error(`第${participant.seed}シードは枠数を超えています。`);
      slots[order.indexOf(participant.seed)] = participant.id;
    });

    const byeCount = size - participants.length;
    const firstRoundMatches = Array.from({ length: size / 2 }, (_, matchIndex) => {
      const indices = [matchIndex * 2, matchIndex * 2 + 1];
      const occupied = indices.filter((index) => slots[index] != null);
      const bestSeed = occupied
        .map((index) => participants.find((p) => p.id === slots[index])?.seed ?? Number.MAX_SAFE_INTEGER)
        .sort((a, b) => a - b)[0] ?? Number.MAX_SAFE_INTEGER;
      return { matchIndex, indices, occupied, bestSeed };
    });

    // BYEは1試合につき最大1枠にする。これにより「BYE対BYE」が生まれず、
    // 一部の参加者だけが余分なラウンドを自動通過する偏りを防ぐ。
    const seededByeMatches = firstRoundMatches
      .filter((match) => match.occupied.length === 1)
      .sort((a, b) => a.bestSeed - b.bestSeed);
    const emptyMatches = shuffle(firstRoundMatches.filter((match) => match.occupied.length === 0), random);
    const byeMatches = [...seededByeMatches, ...emptyMatches].slice(0, byeCount);
    const byeSlots = new Set(byeMatches.map((match) => {
      if (match.occupied.length === 1) return match.indices.find((index) => slots[index] == null);
      return match.indices[random() < 0.5 ? 0 : 1];
    }));
    const open = slots.map((value, index) => (value == null ? index : -1)).filter((index) => index >= 0);
    const playableSlots = open.filter((index) => !byeSlots.has(index));
    shuffle(unseeded, random).forEach((participant, index) => {
      slots[playableSlots[index]] = participant.id;
    });
    return slots;
  }

  function createManualSlots(participants) {
    validateParticipants(participants);
    const size = nextPowerOfTwo(participants.length);
    const byeCount = size - participants.length;
    const ids = participants.map((p) => p.id);
    const slots = [];
    let cursor = 0;
    for (let matchIndex = 0; matchIndex < size / 2; matchIndex += 1) {
      slots.push(ids[cursor++]);
      slots.push(matchIndex < byeCount ? null : ids[cursor++]);
    }
    return slots;
  }

  function buildBracket(slots, priorRounds = []) {
    if (!Array.isArray(slots) || slots.length < 2 || (slots.length & (slots.length - 1)) !== 0) {
      throw new Error("トーナメント枠が不正です。");
    }
    const rounds = [];
    let entrants = slots.map((id) => id == null
      ? { id: null, status: "bye" }
      : { id, status: "ready" });
    const roundCount = Math.log2(slots.length);
    for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
      const matches = [];
      for (let i = 0; i < entrants.length; i += 2) {
        const aEntry = entrants[i] ?? { id: null, status: "bye" };
        const bEntry = entrants[i + 1] ?? { id: null, status: "bye" };
        const a = aEntry.status === "ready" ? aEntry.id : null;
        const b = bEntry.status === "ready" ? bEntry.id : null;
        const oldWinner = priorRounds[roundIndex]?.[i / 2]?.winnerId ?? null;
        let winnerId = null;
        let automatic = false;
        let outputStatus = "pending";
        if (aEntry.status === "ready" && bEntry.status === "bye") {
          winnerId = a;
          automatic = true;
          outputStatus = "ready";
        } else if (aEntry.status === "bye" && bEntry.status === "ready") {
          winnerId = b;
          automatic = true;
          outputStatus = "ready";
        } else if (aEntry.status === "bye" && bEntry.status === "bye") {
          outputStatus = "bye";
        } else if (aEntry.status === "ready" && bEntry.status === "ready") {
          winnerId = oldWinner === a || oldWinner === b ? oldWinner : null;
          outputStatus = winnerId ? "ready" : "pending";
        }
        matches.push({
          id: `r${roundIndex}-m${i / 2}`,
          a,
          b,
          aStatus: aEntry.status,
          bStatus: bEntry.status,
          winnerId,
          automatic,
          outputStatus,
        });
      }
      rounds.push(matches);
      entrants = matches.map((match) => ({ id: match.winnerId, status: match.outputStatus }));
    }
    return rounds;
  }

  function setWinner(slots, rounds, roundIndex, matchIndex, winnerId) {
    const target = rounds[roundIndex]?.[matchIndex];
    if (!target
      || target.aStatus !== "ready"
      || target.bStatus !== "ready"
      || (winnerId !== target.a && winnerId !== target.b)) {
      throw new Error("勝者が試合参加者と一致しません。");
    }
    const next = rounds.map((round) => round.map((match) => ({ ...match })));
    next[roundIndex][matchIndex].winnerId = winnerId;
    for (let r = roundIndex + 1; r < next.length; r += 1) {
      next[r].forEach((match) => { match.winnerId = null; });
    }
    return buildBracket(slots, next);
  }

  return { nextPowerOfTwo, seedOrder, shuffle, validateParticipants, assignSeed, isWinningPath, createDisplayRounds, getTargetSlotIndex, createDraw, createManualSlots, buildBracket, setWinner };
});
