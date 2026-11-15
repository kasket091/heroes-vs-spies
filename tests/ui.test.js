import { describe, it, expect } from 'vitest';
import { screenFor, view } from '../src/ui.js';

const players = ['a', 'b', 'c', 'd'].map((uid) => ({ uid, name: uid.toUpperCase() }));
const room = (over = {}) => ({
  gmUid: 'gm', gmName: 'Gina', phase: 'lobby', round: 1, roundPlayers: [], starterUid: null, result: null, ...over,
});
const st = (uid, roomOver, extra = {}, ui = {}) => ({
  uid, code: 'ABCD', ui: { fields: {}, ...ui },
  data: { room: room(roomOver), players, myWord: null, secret: null, votesCast: 0, ...extra },
});
const round = { roundPlayers: ['a', 'b', 'c', 'd'], round: 1 };
const result = { votedOutUid: 'b', tie: false, winner: 'players', spyUid: 'b', common: 'Cola', spy: 'Water' };

describe('screenFor: one test per row of the screen table', () => {
  it('no room in the URL: join', () => expect(screenFor({ uid: 'a', code: null, data: null })).toBe('join'));
  it('unknown room: join (with Room not found)', () => {
    const s = { uid: 'a', code: 'ZZZZ', data: { room: null, players: [] }, ui: { fields: {} } };
    expect(screenFor(s)).toBe('join');
    expect(view(s)).toContain('Room not found');
  });
  it('game master, lobby/reveal/cancelled: lobby', () => {
    for (const phase of ['lobby', 'reveal', 'cancelled']) expect(screenFor(st('gm', { phase, result }))).toBe('lobby');
  });
  it('game master tapped New round: words', () => expect(screenFor(st('gm', {}, {}, { view: 'words' }))).toBe('words'));
  it('game master, clues, no starter: pickStarter', () => expect(screenFor(st('gm', { ...round, phase: 'clues' }))).toBe('pickStarter'));
  it('game master, clues/voting with starter: gmRound', () => {
    for (const phase of ['clues', 'voting']) expect(screenFor(st('gm', { ...round, phase, starterUid: 'c' }))).toBe('gmRound');
  });
  it('round player, clues: word', () => expect(screenFor(st('a', { ...round, phase: 'clues' }))).toBe('word'));
  it('round player, voting: vote', () => expect(screenFor(st('a', { ...round, phase: 'voting', starterUid: 'c' }))).toBe('vote'));
  it('player not in the round: outOfRound', () => {
    expect(screenFor(st('d', { roundPlayers: ['a', 'b', 'c'], phase: 'voting' }))).toBe('outOfRound');
  });
  it('anyone (not game master), reveal: reveal', () => expect(screenFor(st('a', { phase: 'reveal', result }))).toBe('reveal'));
  it('anyone (not game master), cancelled: cancelled', () => expect(screenFor(st('a', { phase: 'cancelled', result }))).toBe('cancelled'));
  it('uid not in the room: join with the code prefilled', () => expect(screenFor(st('stranger', { phase: 'lobby' }))).toBe('join'));
  it('player in lobby: waiting', () => expect(screenFor(st('a', {}))).toBe('waiting'));
  it('subscription not loaded yet: loading', () => expect(screenFor({ uid: 'a', code: 'ABCD', data: undefined })).toBe('loading'));
});

describe('view', () => {
  it('spy and non-spy player screens differ only in the word', () => {
    for (const phase of ['clues', 'voting']) {
      const r = { ...round, phase, starterUid: 'a', roundPlayers: ['a', 'b', 'c', 'd'] };
      // A player's state carries no spy info, only myWord; same seat with the spy word vs the common word.
      const spy = view(st('c', r, { myWord: 'Water' })).replace('Water', 'WORD');
      const other = view(st('c', r, { myWord: 'Cola' })).replace('Cola', 'WORD');
      expect(spy).toBe(other);
    }
  });
  it('game master sees a waiting state, not a stale spy, while secret is null', () => {
    const html = view(st('gm', { ...round, phase: 'clues' }));
    expect(html).toContain('Dealing the words');
    expect(html).not.toContain('Spy</span>');
  });
  it('New round is disabled with the reason under 4 players', () => {
    const s = st('gm', {});
    s.data.players = players.slice(0, 3);
    const html = view(s);
    expect(html).toMatch(/data-action="newRound"[^>]*disabled/);
    expect(html).toContain('3 joined so far');
  });
  it('escapes player names', () => {
    const s = st('gm', {});
    s.data.players = [{ uid: 'x', name: '<img src=x onerror=alert(1)>' }];
    expect(view(s)).not.toContain('<img');
  });
  it('round screen shows votes cast out of round players', () => {
    const html = view(st('gm', { ...round, phase: 'voting', starterUid: 'a' }, { votesCast: 2, secret: { common: 'Cola', spy: 'Water', spyUid: 'c', round: 1 } }));
    expect(html).toContain('2 of 4');
    expect(html).toContain('Keep this screen open');
  });
});
