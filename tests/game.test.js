import { test, expect } from 'vitest';
import { MIN_PLAYERS, safeStarters, speakingOrder, pickSpy, dealPair, validPair, cleanName, tally, newRoomCode } from '../src/game.js';

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
test('tally: spy caught', () => {
  expect(tally({ a: 'c', b: 'c', d: 'a' }, 'c')).toEqual({ votedOutUid: 'c', tie: false, winner: 'players' });
});
test('tally: wrong player voted out', () => {
  expect(tally({ a: 'b', c: 'b', d: 'c' }, 'c')).toEqual({ votedOutUid: 'b', tie: false, winner: 'spy' });
});
test('tally: tie means spy wins, even if the spy is tied', () => {
  expect(tally({ a: 'c', b: 'd' }, 'c')).toEqual({ votedOutUid: null, tie: true, winner: 'spy' });
});
test('tally of no votes', () => {
  expect(tally({}, 'c')).toEqual({ votedOutUid: null, tie: true, winner: 'spy' });
});
test('newRoomCode is 4 allowed letters', () => {
  expect(newRoomCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
});
