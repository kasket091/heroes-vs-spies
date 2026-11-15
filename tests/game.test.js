import { test, expect } from 'vitest';
import { MIN_PLAYERS, safeStarters, speakingOrder, pickSpy, dealPair, validPair, cleanName, newRoomCode, starterChoices, whoIsOut, finalPoints, scoreRound, stage, gameWinner, teams } from '../src/game.js';

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
test('dealPair gives either side to the spy', () => {
  expect(dealPair(['Cola', 'Water'], () => 0)).toEqual({ common: 'Cola', spy: 'Water' });
  expect(dealPair(['Cola', 'Water'], () => 0.9)).toEqual({ common: 'Water', spy: 'Cola' });
});
test('validPair', () => {
  expect(validPair('Cola', 'Water')).toBe(true);
  expect(validPair('', 'Water')).toBe(false);
  expect(validPair(' cola ', 'Cola')).toBe(false);
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

test('starterChoices: the 2-before rule applies from 5 players', () => {
  expect(starterChoices(['a', 'b', 'c', 'd', 'e'], 'c')).toEqual(['a', 'd', 'e']);
  expect(starterChoices(['a', 'b', 'c', 'd'], 'a')).toEqual(['a', 'b', 'c', 'd']);
  expect(starterChoices(['a', 'b', 'c'], 'c')).toEqual(['a', 'b', 'c']);
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
