import { test, expect } from 'vitest';
import { MIN_PLAYERS, safeStarters, speakingOrder, cleanName, newRoomCode, starterChoices, pickCarrier, roundGains, ranking, whoIsOut, stage, pairKeys, pickUnusedPair, pickStarter, waitingFor, hostStep, stalled } from '../src/game.js';
import families from '../words/word-families.json';

const P = ['a', 'b', 'c', 'd', 'e'];
test('MIN_PLAYERS is 4', () => {
  expect(MIN_PLAYERS).toBe(4);
});
test('safeStarters leaves 2 speakers before the carrier', () => {
  expect(safeStarters(P, 'c')).toEqual(['a', 'd', 'e']);   // not b (carrier 2nd), not c (carrier 1st)
  expect(safeStarters(['a', 'b', 'c', 'd'], 'a')).toEqual(['b', 'c']);
});
test('every safe starter puts the carrier 3rd or later, for every carrier', () => {
  for (const carrier of P) for (const s of safeStarters(P, carrier))
    expect(speakingOrder(P, s).indexOf(carrier)).toBeGreaterThanOrEqual(2);
});
test('speakingOrder wraps around', () => {
  expect(speakingOrder(P, 'd')).toEqual(['d', 'e', 'a', 'b', 'c']);
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

test('pickCarrier is uniform over everyone still in', () => {
  expect(pickCarrier(['a', 'b', 'c', 'd'], () => 0)).toBe('a');
  expect(pickCarrier(['a', 'b', 'c', 'd'], () => 0.26)).toBe('b');
  expect(pickCarrier(['a', 'b', 'c', 'd'], () => 0.99)).toBe('d');
  const counts = { a: 0, b: 0, c: 0, d: 0 };
  for (let i = 0; i < 4000; i += 1) counts[pickCarrier(['a', 'b', 'c', 'd'])] += 1;
  for (const k of Object.keys(counts)) expect(counts[k]).toBeGreaterThan(800);   // 1000 expected each
});
test('the last carrier is as likely as anyone: 600 picks among 4 with real randomness', () => {
  const counts = { a: 0, b: 0, c: 0, d: 0 };
  for (let i = 0; i < 600; i += 1) counts[pickCarrier(['a', 'b', 'c', 'd'])] += 1;
  for (const k of Object.keys(counts)) { expect(counts[k]).toBeGreaterThan(100); expect(counts[k]).toBeLessThan(200); }
});
test('starterChoices: two speak before the carrier from 5 players', () => {
  expect(starterChoices(['a', 'b', 'c', 'd', 'e'], 'c')).toEqual(['a', 'd', 'e']);
  expect(starterChoices(['a', 'b', 'c', 'd'], 'a')).toEqual(['a', 'b', 'c', 'd']);
});
test('roundGains', () => {
  expect(roundGains({ outUid: 'b', carrierUid: 'c', votes: { a: 'b', c: 'b', d: 'c' }, final: false })).toEqual({ c: 2 });
  expect(roundGains({ outUid: 'c', carrierUid: 'c', votes: { a: 'c', b: 'c', c: 'a', d: 'a' }, final: false })).toEqual({ a: 1, b: 1 });
  expect(roundGains({ outUid: 'a', carrierUid: 'c', votes: { a: 'c', b: 'a', c: 'a' }, final: true })).toEqual({ c: 4 });
  expect(roundGains({ outUid: 'c', carrierUid: 'c', votes: { a: 'c', b: 'c', c: 'a' }, final: true })).toEqual({ a: 1, b: 1 });
  expect(roundGains({ outUid: 'c', carrierUid: 'c', votes: {}, final: false })).toEqual({});
});
const N = { a: 'Ana', b: 'Ben', c: 'Cara', d: 'Dino', e: 'Ella', f: 'Fe' };
const places = (r) => r.map((x) => `${x.place}:${x.uid}:${x.group}`);
test('ranking: the virus survives the final', () => {
  const r = ranking({ inGame: ['a', 'b', 'c'], out: ['d', 'e'], gone: ['f'], names: N, carrierUid: 'c', caught: false, hadFinal: true,
    points: { a: 1, b: 3, c: 4, d: 6, e: 0, f: 9 } });
  expect(places(r)).toEqual(['1:c:podium', '2:b:podium', '3:a:podium', '4:d:out', '5:e:out', '6:f:gone']);
  expect(r[0]).toEqual({ uid: 'c', name: 'Cara', points: 4, place: 1, group: 'podium' });
});
test('ranking: the Heroes catch it', () => {
  const r = ranking({ inGame: ['a', 'b', 'c'], out: ['d'], gone: [], names: N, carrierUid: 'c', caught: true, hadFinal: true,
    points: { a: 2, b: 1, c: 9, d: 5 } });
  expect(places(r)).toEqual(['1:a:podium', '2:b:podium', '3:c:podium', '4:d:out']);
});
test('ranking: level points share a place only inside a group', () => {
  const caught = ranking({ inGame: ['a', 'b', 'c'], out: ['d', 'e'], gone: [], names: N, carrierUid: 'c', caught: true, hadFinal: true,
    points: { a: 2, b: 2, c: 2, d: 2, e: 2 } });
  expect(places(caught)).toEqual(['1:a:podium', '1:b:podium', '3:c:podium', '4:d:out', '4:e:out']);
  const survived = ranking({ inGame: ['a', 'b', 'c'], out: [], gone: [], names: N, carrierUid: 'c', caught: false, hadFinal: true,
    points: { a: 5, b: 5, c: 5 } });
  expect(places(survived)).toEqual(['1:c:podium', '2:a:podium', '2:b:podium']);
});
test('ranking: no final, everyone still in or voted out by points, removed players last', () => {
  const r = ranking({ inGame: ['a', 'b'], out: ['d'], gone: ['f'], names: N, carrierUid: null, caught: false, hadFinal: false,
    points: { a: 1, b: 0, d: 3, f: 7 } });
  expect(places(r)).toEqual(['1:d:out', '2:a:out', '3:b:out', '4:f:gone']);
});
test('ranking: players voted out take places 4, 4, 4, 7 on level points', () => {
  const r = ranking({ inGame: ['a', 'b', 'c'], out: ['d', 'e', 'f', 'g'], gone: [], names: { ...N, g: 'Gus' }, carrierUid: 'c', caught: false, hadFinal: true,
    points: { a: 0, b: 0, c: 0, d: 3, e: 3, f: 3, g: 1 } });
  expect(places(r).slice(3)).toEqual(['4:d:out', '4:e:out', '4:f:out', '7:g:out']);
});
test('ranking: removed players are level with each other, and below everyone else', () => {
  const r = ranking({ inGame: ['a', 'b', 'c'], out: ['d'], gone: ['e', 'f'], names: N, carrierUid: 'c', caught: true, hadFinal: true,
    points: { a: 0, b: 0, c: 0, d: 0, e: 5, f: 5 } });
  expect(places(r).slice(4)).toEqual(['5:e:gone', '5:f:gone']);
});
test('ranking: a uid missing from points counts as 0', () => {
  const r = ranking({ inGame: ['a', 'b', 'c'], out: ['d', 'e'], gone: [], names: N, carrierUid: 'c', caught: true, hadFinal: true, points: { e: 1 } });
  expect(r.map((x) => [x.uid, x.points])).toEqual([['a', 0], ['b', 0], ['c', 0], ['e', 1], ['d', 0]]);
});
test('ranking: a caught final with nobody out is the podium alone', () => {
  const r = ranking({ inGame: ['a', 'b', 'c'], out: [], gone: [], names: N, carrierUid: 'a', caught: true, hadFinal: true, points: { a: 1, b: 2, c: 3 } });
  expect(places(r)).toEqual(['1:c:podium', '2:b:podium', '3:a:podium']);
});
test('ranking: no final, two still in level with one voted out share a place', () => {
  const r = ranking({ inGame: ['a', 'b'], out: ['d'], gone: [], names: N, carrierUid: null, caught: false, hadFinal: false, points: { a: 2, b: 2, d: 2 } });
  expect(places(r)).toEqual(['1:a:out', '1:b:out', '1:d:out']);
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
test('stage', () => {
  expect([5, 4, 3, 2].map(stage)).toEqual(['round', 'round', 'final', 'over']);
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
test('pickStarter keeps two speakers ahead of the carrier from 5 players', () => {
  const P5 = ['a', 'b', 'c', 'd', 'e'];
  for (const r of [0, 0.3, 0.6, 0.99]) expect(['a', 'd', 'e']).toContain(pickStarter(P5, 'c', () => r));
  expect(pickStarter(['a', 'b', 'c', 'd'], 'c', () => 0.5)).toBe('c');
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
