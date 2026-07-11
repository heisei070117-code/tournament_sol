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

test("a connector is red only when its team wins the destination match", () => {
  const sourceWinner = { winnerId: "p1" };
  const otherSourceWinner = { winnerId: "p2" };
  const decidedTarget = { winnerId: "p1" };
  const undecidedTarget = { winnerId: null };

  assert.equal(engine.isWinningPath(sourceWinner, decidedTarget), true);
  assert.equal(engine.isWinningPath(otherSourceWinner, decidedTarget), false);
  assert.equal(engine.isWinningPath(sourceWinner, undecidedTarget), false);
});
