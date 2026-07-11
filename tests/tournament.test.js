const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../src/tournament.js");

const players = (count, seeds = 0) => Array.from({ length: count }, (_, i) => ({
  id: `p${i + 1}`,
  name: `Player ${i + 1}`,
  seed: i < seeds ? i + 1 : null,
}));

test("nextPowerOfTwo calculates bracket size", () => {
  assert.equal(engine.nextPowerOfTwo(2), 2);
  assert.equal(engine.nextPowerOfTwo(7), 8);
  assert.equal(engine.nextPowerOfTwo(17), 32);
});

test("seedOrder separates top seeds", () => {
  assert.deepEqual(engine.seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
});

test("draw keeps every participant exactly once and favors seeded byes", () => {
  const entrants = players(6, 2);
  const slots = engine.createDraw(entrants, () => 0.5);
  assert.equal(slots.length, 8);
  assert.deepEqual(slots.filter(Boolean).sort(), entrants.map((p) => p.id).sort());
  assert.equal(slots[0], "p1");
  assert.equal(slots[4], "p2");
  assert.equal(slots[1], null);
  assert.equal(slots[5], null);
});

test("bye advances automatically and winner flows to the next round", () => {
  const slots = ["p1", null, "p2", "p3"];
  let rounds = engine.buildBracket(slots);
  assert.equal(rounds[0][0].winnerId, "p1");
  assert.equal(rounds[1][0].winnerId, null);
  assert.equal(rounds[1][0].bStatus, "pending");
  rounds = engine.setWinner(slots, rounds, 0, 1, "p3");
  assert.deepEqual([rounds[1][0].a, rounds[1][0].b], ["p1", "p3"]);
});

test("an undecided previous match is not mistaken for a bye", () => {
  const rounds = engine.buildBracket(["p1", null, "p2", "p3"]);
  assert.equal(rounds[1][0].a, "p1");
  assert.equal(rounds[1][0].b, null);
  assert.equal(rounds[1][0].bStatus, "pending");
  assert.equal(rounds[1][0].automatic, false);
  assert.equal(rounds[1][0].winnerId, null);
});

test("34-team draw has exactly two preliminary matches and no double byes", () => {
  const entrants = players(34, 8);
  const slots = engine.createDraw(entrants, () => 0.42);
  const firstRoundPairs = Array.from({ length: 32 }, (_, i) => slots.slice(i * 2, i * 2 + 2));
  assert.equal(firstRoundPairs.filter((pair) => pair.every(Boolean)).length, 2);
  assert.equal(firstRoundPairs.filter((pair) => pair.every((slot) => slot == null)).length, 0);
  assert.equal(firstRoundPairs.filter((pair) => pair.filter(Boolean).length === 1).length, 30);

  const rounds = engine.buildBracket(slots);
  assert.equal(rounds[0].filter((match) => match.automatic).length, 30);
  assert.equal(rounds[1].filter((match) => match.automatic).length, 0);
  assert.equal(rounds[1].filter((match) => match.winnerId != null).length, 0);
});

test("manual initial placement also distributes byes one per match", () => {
  const slots = engine.createManualSlots(players(34, 8));
  const pairs = Array.from({ length: 32 }, (_, i) => slots.slice(i * 2, i * 2 + 2));
  assert.equal(pairs.filter((pair) => pair.every((slot) => slot == null)).length, 0);
  assert.equal(pairs.filter((pair) => pair.every(Boolean)).length, 2);
});

test("duplicate names and seeds are rejected", () => {
  assert.throws(() => engine.validateParticipants([
    { id: "1", name: "A", seed: 1 }, { id: "2", name: "A", seed: 2 },
  ]), /重複/);
  assert.throws(() => engine.validateParticipants([
    { id: "1", name: "A", seed: 1 }, { id: "2", name: "B", seed: 1 },
  ]), /重複/);
});

test("seed assignment clearly swaps seeded teams and replaces with unseeded teams", () => {
  let entrants = players(4, 2);
  entrants = engine.assignSeed(entrants, "p2", 1);
  assert.equal(entrants.find((p) => p.id === "p2").seed, 1);
  assert.equal(entrants.find((p) => p.id === "p1").seed, 2);

  entrants = engine.assignSeed(entrants, "p4", 1);
  assert.equal(entrants.find((p) => p.id === "p4").seed, 1);
  assert.equal(entrants.find((p) => p.id === "p2").seed, null);
  assert.equal(entrants.filter((p) => p.seed != null).length, 2);
});

test("an outgoing connector becomes active when its source match has a winner", () => {
  assert.equal(engine.hasAdvancedWinner({ winnerId: "p1" }), true);
  assert.equal(engine.hasAdvancedWinner({ winnerId: null }), false);
  assert.equal(engine.hasAdvancedWinner(null), false);
});

test("34-team display shows two preliminary matches instead of thirty bye cards", () => {
  const slots = engine.createDraw(players(34, 8), () => 0.42);
  const rounds = engine.buildBracket(slots);
  const displayRounds = engine.createDisplayRounds(rounds);

  assert.equal(displayRounds.length, 6);
  assert.equal(displayRounds[0].isPreliminary, true);
  assert.equal(displayRounds[0].matches.length, 2);
  assert.equal(displayRounds[0].matches.every(({ match }) => match.a && match.b), true);
  assert.equal(displayRounds[1].matches.length, 16);
});

test("power-of-two display keeps every first-round match", () => {
  const slots = engine.createDraw(players(32, 8), () => 0.42);
  const displayRounds = engine.createDisplayRounds(engine.buildBracket(slots));
  assert.equal(displayRounds[0].isPreliminary, false);
  assert.equal(displayRounds[0].matches.length, 16);
});

test("adjacent matches connect to the top and bottom slots of the same next match", () => {
  assert.equal(engine.getTargetSlotIndex(0), 0);
  assert.equal(engine.getTargetSlotIndex(1), 1);
  assert.equal(engine.getTargetSlotIndex(12), 0);
  assert.equal(engine.getTargetSlotIndex(13), 1);
});

test("tree layout centers every later match between its two feeder matches", () => {
  const rounds = engine.buildBracket(engine.createDraw(players(29, 8), () => 0.42));
  const layout = engine.createBracketLayout(rounds);
  assert.equal(layout.leafUnits, 29);
  for (let roundIndex = 1; roundIndex < rounds.length; roundIndex += 1) {
    layout.centers[roundIndex].forEach((center, matchIndex) => {
      const upper = layout.centers[roundIndex - 1][matchIndex * 2];
      const lower = layout.centers[roundIndex - 1][matchIndex * 2 + 1];
      assert.equal(center, (upper + lower) / 2);
    });
  }
});

test("scores are stored per team and preserved while entrants stay the same", () => {
  const slots = ["p1", null, "p2", "p3"];
  let rounds = engine.buildBracket(slots);
  rounds = engine.setScore(rounds, 0, 1, "a", 2);
  rounds = engine.setScore(rounds, 0, 1, "b", 1);
  assert.equal(rounds[0][1].scoreA, 2);
  assert.equal(rounds[0][1].scoreB, 1);
  rounds = engine.setWinner(slots, rounds, 0, 1, "p2");
  assert.equal(rounds[0][1].scoreA, 2);
  assert.equal(rounds[0][1].scoreB, 1);
  assert.throws(() => engine.setScore(rounds, 0, 1, "a", -1), /0から999/);
});
