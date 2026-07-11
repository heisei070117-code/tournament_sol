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
    const open = slots.map((value, index) => (value == null ? index : -1)).filter((index) => index >= 0);
    const preferredByes = seeded
      .map((participant) => order.indexOf(participant.seed) ^ 1)
      .filter((index) => slots[index] == null);
    const remainingByeCandidates = open.filter((index) => !preferredByes.includes(index));
    const byeSlots = new Set([...preferredByes, ...shuffle(remainingByeCandidates, random)].slice(0, byeCount));
    const playableSlots = open.filter((index) => !byeSlots.has(index));
    shuffle(unseeded, random).forEach((participant, index) => {
      slots[playableSlots[index]] = participant.id;
    });
    return slots;
  }

  function createManualSlots(participants) {
    validateParticipants(participants);
    const size = nextPowerOfTwo(participants.length);
    return [...participants.map((p) => p.id), ...Array(size - participants.length).fill(null)];
  }

  function buildBracket(slots, priorRounds = []) {
    if (!Array.isArray(slots) || slots.length < 2 || (slots.length & (slots.length - 1)) !== 0) {
      throw new Error("トーナメント枠が不正です。");
    }
    const rounds = [];
    let entrants = slots.slice();
    const roundCount = Math.log2(slots.length);
    for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
      const matches = [];
      for (let i = 0; i < entrants.length; i += 2) {
        const a = entrants[i] ?? null;
        const b = entrants[i + 1] ?? null;
        const oldWinner = priorRounds[roundIndex]?.[i / 2]?.winnerId ?? null;
        let winnerId = oldWinner;
        let automatic = false;
        if (a && !b) { winnerId = a; automatic = true; }
        else if (!a && b) { winnerId = b; automatic = true; }
        else if (!a && !b) winnerId = null;
        else if (winnerId !== a && winnerId !== b) winnerId = null;
        matches.push({ id: `r${roundIndex}-m${i / 2}`, a, b, winnerId, automatic });
      }
      rounds.push(matches);
      entrants = matches.map((match) => match.winnerId);
    }
    return rounds;
  }

  function setWinner(slots, rounds, roundIndex, matchIndex, winnerId) {
    const target = rounds[roundIndex]?.[matchIndex];
    if (!target || (winnerId !== target.a && winnerId !== target.b)) throw new Error("勝者が試合参加者と一致しません。");
    const next = rounds.map((round) => round.map((match) => ({ ...match })));
    next[roundIndex][matchIndex].winnerId = winnerId;
    for (let r = roundIndex + 1; r < next.length; r += 1) {
      next[r].forEach((match) => { match.winnerId = null; });
    }
    return buildBracket(slots, next);
  }

  return { nextPowerOfTwo, seedOrder, shuffle, validateParticipants, createDraw, createManualSlots, buildBracket, setWinner };
});
