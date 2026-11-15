import { describe, it, expect, vi } from 'vitest';
import { screenFor, view, nextPair, settle, render } from '../src/ui.js';
import { isRoomCode } from '../src/game.js';

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

describe('result screens use the names stored in the result', () => {
  const gone = (phase, r) => {
    const s = st('a', { phase, result: r });
    s.data.players = players.filter((p) => p.uid !== r.spyUid && p.uid !== r.votedOutUid);
    return view(s);
  };
  const base = { tie: false, common: 'Cola', spy: 'Water', spyUid: 'zz', spyName: 'Cara' };
  it('cancelled after the spy was removed still names the spy', () => {
    const html = gone('cancelled', { ...base, votedOutUid: null, winner: null, votedOutName: null });
    expect(html).toContain('Round cancelled');
    expect(html).toContain('Cara');
    expect(html).not.toContain('who left');
  });
  it('spy caught: names the spy once', () => {
    const html = gone('reveal', { ...base, votedOutUid: 'zz', votedOutName: 'Cara', winner: 'players' });
    expect(html).toContain('Players win!');
    expect(html.match(/Cara/g).length).toBe(1);
  });
  it('someone else voted out: says who, that they were not the spy, and who was', () => {
    const html = gone('reveal', { ...base, votedOutUid: 'yy', votedOutName: 'Ben', winner: 'spy' });
    expect(html).toContain('The spy wins!');
    expect(html).toMatch(/Ben<\/b> was voted out, but was not the spy/);
    expect(html.match(/Cara/g).length).toBe(1);
  });
  it('tie: nobody voted out, names the spy once', () => {
    const html = gone('reveal', { ...base, tie: true, votedOutUid: null, votedOutName: null, winner: 'spy' });
    expect(html).toContain('Nobody was voted out');
    expect(html.match(/Cara/g).length).toBe(1);
  });
});

describe('nextPair', () => {
  const list = [['Cola', 'Water'], ['Dog', 'Cat'], ['Sun', 'Moon']];
  it('never offers the pair just shown, in either order', () => {
    for (let i = 0; i < 200; i++) {
      const cur = { common: 'Water', spy: 'Cola' };
      const p = nextPair(list, cur);
      expect([p.common, p.spy].sort()).not.toEqual(['Cola', 'Water']);
    }
  });
  it('works with no current pair', () => {
    const p = nextPair(list, null, () => 0);
    expect([p.common, p.spy].sort()).toEqual(['Cola', 'Water']);
  });
});

describe('isRoomCode', () => {
  it('accepts 4 letters from the code alphabet only', () => {
    expect(isRoomCode('KPRT')).toBe(true);
    for (const bad of ['', 'KPR', 'KPRTX', 'kprt', 'KPR1', 'KPRI', 'KPRO', 'KP/T', 'KPRL']) expect(isRoomCode(bad)).toBe(false);
  });
});

describe('settle', () => {
  const s1 = st('gm', {}, {}, { error: 'Type two different words.', view: 'words', pair: { common: 'a', spy: 'b' } });
  it('clears the error when the screen changes, keeps it when it does not', () => {
    expect(settle(s1, s1).error).toBe('Type two different words.');
    const next = { ...s1, ui: { ...s1.ui, view: null } };
    expect(settle(s1, next).error).toBe(null);
  });
  it('resets view and pair when the game master role changes', () => {
    const handed = st('gm', { gmUid: 'a' }, {}, s1.ui);
    expect(settle(s1, handed)).toMatchObject({ view: null, pair: null });
  });
  it('resets confirmRemove when the round changes', () => {
    const a = st('a', { round: 1 }, {}, { confirmRemove: 'b' });
    const b = st('a', { round: 2 }, {}, a.ui);
    expect(settle(a, b)).toMatchObject({ confirmRemove: null });
  });
});

describe('render ignores taps right after the screen changes', () => {
  const fakeRoot = () => {
    const button = { dataset: { action: 'remove', arg: 'b' }, addEventListener(_, f) { this.click = f; } };
    return { button, querySelectorAll: (sel) => (sel === '[data-action]' ? [button] : []) };
  };
  it('drops a tap within 300ms of a changed render, accepts it after', () => {
    vi.useFakeTimers();
    try {
      const root = fakeRoot();
      const remove = vi.fn();
      render(root, st('gm', {}), { remove });
      root.button.click();
      expect(remove).not.toHaveBeenCalled();
      vi.advanceTimersByTime(301);
      root.button.click();
      expect(remove).toHaveBeenCalledWith('b');
    } finally { vi.useRealTimers(); }
  });
});

describe('leave room button', () => {
  const has = (html) => html.includes('data-action="leave"');
  it('on the waiting, reveal and cancelled screens and the game master lobby', () => {
    expect(has(view(st('a', {})))).toBe(true);
    for (const phase of ['reveal', 'cancelled']) {
      expect(has(view(st('a', { phase, result })))).toBe(true);
      expect(has(view(st('gm', { phase, result })))).toBe(true);
    }
    expect(has(view(st('gm', {})))).toBe(true);
    expect(view(st('gm', {}))).toContain('The room stays open');
  });
  it('never mid-round', () => {
    for (const phase of ['clues', 'voting']) {
      for (const who of ['a', 'gm', 'x']) {
        const html = view(st(who, { ...round, phase, starterUid: 'c' }, { secret: { common: 'a', spy: 'b', spyUid: 'c', round: 1 }, myVote: null }));
        expect(has(html)).toBe(false);
      }
    }
  });
});

describe('vote screen', () => {
  const vs = (extra, ui = {}) => view(st('a', { ...round, phase: 'voting', starterUid: 'c' }, extra, ui));
  it('shows a status, not buttons, until the own vote is known', () => {
    const html = vs({ myVote: undefined });
    expect(html).toContain('Checking your vote');
    expect(html).not.toContain('data-action="vote"');
  });
  it('shows Vote sent from the stored vote, not from a local flag', () => {
    expect(vs({ myVote: 'b' })).toContain('Vote sent');
    expect(vs({ myVote: null }, { voted: true })).toContain('Who is the spy?');
  });
});

describe('remove during a round', () => {
  it('a late joiner is removed without the round warning', () => {
    const s = st('gm', { roundPlayers: ['a', 'b', 'c'], phase: 'clues', starterUid: 'a' }, { secret: { common: 'Cola', spy: 'Water', spyUid: 'c', round: 1 } }, { confirmRemove: 'd' });
    expect(view(s)).not.toContain('This ends the round');
  });
  it('keeps the Remove section open while asking to confirm', () => {
    const s = st('gm', { ...round, phase: 'clues', starterUid: 'a' }, { secret: { common: 'Cola', spy: 'Water', spyUid: 'c', round: 1 } }, { confirmRemove: 'c' });
    expect(view(s)).toContain('<details class="manage" open>');
    expect(view(s)).toContain('Remove C? This ends the round.');
  });
});
