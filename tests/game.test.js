import { test, expect } from 'vitest';
import { MIN_PLAYERS, safeStarters, speakingOrder, pickSpy, cleanName, newRoomCode, starterChoices, whoIsOut, finalPoints, scoreRound, stage, gameWinner, teams, pairKeys, pickUnusedPair, pickStarter, waitingFor, hostStep, stalled } from '../src/game.js';
import families from '../words/word-families.json';

const P = ['a', 'b', 'c', 'd', 'e'];
test('MIN_PLAYERS is 4', () => {
  expect(MIN_PLAYERS).toBe(4);
});
test('safeStarters leaves 2 speakers before the spy', () => {
  expect(safeStarters(P, 'c')).toEqual(['a', 'd', 'e']);   // not b (spy 2nd), not c (spy 1st)
  expect(safeStarters(['a', 'b', 'c', 'd'], 'a')).toEqual(['b', 'c']);
});
test('every safe starter puts the spy 3rd or later, for every spy', () => {
  for (const spy of P) for (const s of safeStarters(P, spy))
    expect(speakingOrder(P, s).indexOf(spy)).toBeGreaterThanOrEqual(2);
});
test('speakingOrder wraps around', () => {
  expect(speakingOrder(P, 'd')).toEqual(['d', 'e', 'a', 'b', 'c']);
});
test('pickSpy stays inside the list', () => {
  expect(pickSpy(P, () => 0)).toBe('a');
  expect(pickSpy(P, () => 0.999)).toBe('e');
});
test('cleanName', () => {
  expect(cleanName('  Ana ')).toBe('Ana');
  expect(cleanName('   ')).toBeNull();
  expect(cleanName('x'.repeat(30))).toHaveLength(20);
  expect(cleanName('x'.repeat(19) + ' yyyy')).toBe('x'.repeat(19));
});
test('newRoomCode is 4 allowed letters', () => {
  expect(newRoomCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
});

test('starterChoices: the 2-before rule applies only in the first round of a word set, from 5 players', () => {
  expect(starterChoices(['a', 'b', 'c', 'd', 'e'], 'c', true)).toEqual(['a', 'd', 'e']);
  expect(starterChoices(['a', 'b', 'c', 'd', 'e'], 'c', false)).toEqual(['a', 'b', 'c', 'd', 'e']);
  expect(starterChoices(['a', 'b', 'c', 'd'], 'a', true)).toEqual(['a', 'b', 'c', 'd']);
  expect(starterChoices(['a', 'b', 'c'], 'c', true)).toEqual(['a', 'b', 'c']);
});
test('whoIsOut: clear winner', () => {
  expect(whoIsOut({ a: 'c', b: 'c', d: 'a' }, ['a', 'b', 'c', 'd'], () => 0)).toBe('c');
});
test('whoIsOut: a tie draws among the tied only', () => {
  const votes = { a: 'c', b: 'd' };
  expect(whoIsOut(votes, ['a', 'b', 'c', 'd'], () => 0)).toBe('c');
  expect(whoIsOut(votes, ['a', 'b', 'c', 'd'], () => 0.99)).toBe('d');
});
test('whoIsOut: a vote for "constructor" or a non-active id is ignored', () => {
  expect(whoIsOut({ a: 'constructor', b: 'constructor', c: 'zz' }, ['a', 'b', 'c'], () => 0)).toBe('a');
  expect(whoIsOut({ a: 'b', c: '__proto__' }, ['a', 'b', 'c'], () => 0.99)).toBe('b');
});
test('whoIsOut: no votes draws among everyone', () => {
  expect(whoIsOut({}, ['a', 'b', 'c'], () => 0)).toBe('a');
  expect(whoIsOut({}, ['a', 'b', 'c'], () => 0.99)).toBe('c');
});
test('finalPoints is the gap plus 1', () => {
  expect(finalPoints({ heroes: 1, spies: 4 })).toBe(4);
  expect(finalPoints({ heroes: 2, spies: 2 })).toBe(1);
});
test('scoreRound: spy caught, hero out, and both finals from the spec', () => {
  expect(scoreRound({ outUid: 'c', spyUid: 'c', score: { heroes: 0, spies: 0 }, final: false }))
    .toEqual({ wasSpy: true, team: 'heroes', points: 1, score: { heroes: 1, spies: 0 } });
  expect(scoreRound({ outUid: 'b', spyUid: 'c', score: { heroes: 1, spies: 0 }, final: false }))
    .toEqual({ wasSpy: false, team: 'spies', points: 1, score: { heroes: 1, spies: 1 } });
  expect(scoreRound({ outUid: 'c', spyUid: 'c', score: { heroes: 1, spies: 4 }, final: true }).score)
    .toEqual({ heroes: 5, spies: 4 });
  expect(scoreRound({ outUid: 'a', spyUid: 'c', score: { heroes: 1, spies: 4 }, final: true }).score)
    .toEqual({ heroes: 1, spies: 8 });
});
test('stage', () => {
  expect([5, 4, 3, 2].map(stage)).toEqual(['round', 'round', 'final', 'over']);
});
test('gameWinner', () => {
  expect(gameWinner({ heroes: 5, spies: 4 })).toBe('heroes');
  expect(gameWinner({ heroes: 1, spies: 8 })).toBe('spies');
  expect(gameWinner({ heroes: 2, spies: 2 })).toBe('draw');
});
test('teams', () => {
  expect(teams({ active: ['a', 'c'], heroBench: ['b'], spyBench: ['d'], spyUid: 'c' }))
    .toEqual({ heroes: ['a', 'b'], spies: ['c', 'd'] });
  expect(teams({ active: ['a', 'c'], heroBench: [], spyBench: ['d'], spyUid: null }))
    .toEqual({ heroes: ['a', 'c'], spies: ['d'] });
});

const F = [['Cola', 'Water', 'Juice', 'Milk'], ['Dog', 'Cat', 'Rabbit', 'Hamster']];
test('pairKeys: 6 per family of 4', () => {
  expect(pairKeys(F)).toHaveLength(12);
  expect(pairKeys(F)[0]).toBe('0:0-1');
});
test('pickUnusedPair never repeats, then starts over', () => {
  let used = []; const seen = new Set();
  for (let n = 0; n < 12; n += 1) {
    const r = pickUnusedPair(F, used, Math.random);
    expect(seen.has(r.key)).toBe(false); seen.add(r.key); used = r.usedKeys;
  }
  expect(used).toHaveLength(12);
  const again = pickUnusedPair(F, used, () => 0);
  expect(again.usedKeys).toEqual([again.key]);
});
test('pickUnusedPair returns two different words of one family', () => {
  const r = pickUnusedPair(F, [], () => 0);
  expect(r.key).toBe('0:0-1');
  expect(r.pair).toEqual(['Cola', 'Water']);
});
test('the real list: 378 deals without a repeat', () => {
  let used = []; const seen = new Set();
  for (let n = 0; n < 378; n += 1) { const r = pickUnusedPair(families, used); seen.add(r.key); used = r.usedKeys; }
  expect(seen.size).toBe(378);
});
test('pickUnusedPair spreads deals over families: the first 63 deals use 63 different families', () => {
  let used = []; const fams = new Set();
  for (let n = 0; n < families.length; n += 1) { const r = pickUnusedPair(families, used); fams.add(r.key.split(':')[0]); used = r.usedKeys; }
  expect(fams.size).toBe(families.length);
});
test('pickUnusedPair picks from the least-used families only, also with a fixed rand', () => {
  // Family 0 has one pair used, family 1 none: even rand() = 0 must pick from family 1.
  expect(pickUnusedPair(F, ['0:0-1'], () => 0).key.startsWith('1:')).toBe(true);
  expect(pickUnusedPair(F, ['0:0-1', '1:2-3'], () => 0).key).toBe('0:0-2');
});
test('the real list: the 379th deal starts over', () => {
  let used = [];
  for (let n = 0; n < 378; n += 1) used = pickUnusedPair(families, used).usedKeys;
  const r = pickUnusedPair(families, used);
  expect(r.usedKeys).toEqual([r.key]);
});
test('pickStarter keeps two speakers ahead of the spy only in a first round of 5 or more', () => {
  const P5 = ['a', 'b', 'c', 'd', 'e'];
  for (const r of [0, 0.3, 0.6, 0.99]) expect(['a', 'd', 'e']).toContain(pickStarter(P5, 'c', true, () => r));
  expect(pickStarter(P5, 'c', false, () => 0.5)).toBe('c');
  expect(pickStarter(['a', 'b', 'c', 'd'], 'a', true, () => 0)).toBe('a');
});
test('waitingFor lists who has not voted this round', () => {
  const players = [{ uid: 'a', votedRound: 7 }, { uid: 'b', votedRound: 6 }, { uid: 'c' }, { uid: 'x', votedRound: 7 }];
  expect(waitingFor(['c', 'a', 'b'], players, 7)).toEqual(['c', 'b']);
});
test('hostStep', () => {
  expect(hostStep({ phase: 'voting', allVoted: true, now: 0 })).toBe('close');
  expect(hostStep({ phase: 'voting', allVoted: false, now: 0 })).toBeNull();
  expect(hostStep({ phase: 'result', resultAt: 1000, now: 4000 })).toEqual({ wait: 7000 });
  expect(hostStep({ phase: 'result', resultAt: 1000, now: 11000 })).toBe('advance');
  expect(hostStep({ phase: 'result', resultAt: 1000, now: 999999 })).toBe('advance');
  expect(hostStep({ phase: 'result', resultAt: 1000, now: 11000 })).toBe('advance');
  expect(hostStep({ phase: 'result', resultAt: 1000, now: 10999 })).toEqual({ wait: 1 });
  expect(hostStep({ phase: 'result', now: 5000 })).toBe('advance');
  expect(hostStep({ phase: 'result', resultAt: null, now: 5000 })).toBe('advance');
  expect(hostStep({ phase: 'lobby', now: 0 })).toBeNull();
  expect(hostStep({ phase: 'gameOver', now: 0 })).toBeNull();
});
test('stalled', () => {
  expect(stalled({ phase: 'voting', allVoted: true, since: 0, now: 9000 })).toBe(false);
  expect(stalled({ phase: 'voting', allVoted: true, since: 0, now: 10000 })).toBe(true);
  expect(stalled({ phase: 'voting', allVoted: false, since: 0, now: 600000 })).toBe(false);
  expect(stalled({ phase: 'result', since: 0, now: 19000 })).toBe(false);
  expect(stalled({ phase: 'result', since: 0, now: 20000 })).toBe(true);
});
