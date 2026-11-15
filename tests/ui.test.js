import { describe, it, expect, vi } from 'vitest';
import { screenFor, view, settle, render, friendly } from '../src/ui.js';
import { isRoomCode } from '../src/game.js';

// gm is the host (Gina) and a normal player. d joined after the deal (late joiner).
const NAMES = { gm: 'Gina', a: 'Ann', b: 'Ben', c: 'Cara', d: 'Dev', e: 'Eli', f: 'Fay' };
const players = Object.entries(NAMES).map(([uid, name]) => ({ uid, name }));
const room = (over = {}) => ({
  gmUid: 'gm', gmName: 'Gina', phase: 'lobby', round: 7, roundPlayers: [], starterUid: null, result: null,
  seats: [], names: {}, heroBench: [], spyBench: [], score: { heroes: 0, spies: 0 },
  wordSet: 1, needsWords: false, final: false, winner: null, setStart: false, resultAt: null, ...over,
});
// s.since / s.now feed stalled(); left out, nothing is stalled.
const st = (uid, roomOver, extra = {}, ui = {}, top = {}) => ({
  uid, code: 'ABCD', ui: { fields: {}, ...ui },
  data: { room: room(roomOver), players, myWord: null, myVote: null, waiting: [], ...extra }, ...top,
});
// A round in progress: e and f benched, the host and a, b, c still in, d a late joiner. Who the spy is lives
// only in gm/secret, which no screen state carries.
const { d: _late, ...dealt } = NAMES;
const game = (over = {}) => ({
  names: dealt, seats: ['a', 'b', 'c', 'gm'], roundPlayers: ['a', 'b', 'c', 'gm'], heroBench: ['e'], spyBench: ['f'],
  score: { heroes: 1, spies: 1 }, phase: 'voting', starterUid: 'a', ...over,
});
const notSpy = { outUid: 'b', outName: 'Ben', wasSpy: false, team: 'spies', points: 1, voided: false, spyUid: null, spyName: null, common: null, spy: null };
const caught = { outUid: 'c', outName: 'Cara', wasSpy: true, team: 'heroes', points: 1, voided: false, spyUid: 'c', spyName: 'Cara', common: 'Cola', spy: 'Water' };
const voidedHero = { ...notSpy, outUid: null, outName: null, team: null, points: 0, voided: true };
const inResult = (over = {}) => game({ phase: 'result', result: notSpy, seats: ['a', 'c', 'gm'], heroBench: ['e', 'b'], ...over });
const has = (html, action) => html.includes(`data-action="${action}"`);
const STALL_VOTE = { since: 0, now: 10000 };
const STALL_LINE = "Waiting for Gina's phone. Ask them to open the game.";

describe('screenFor: one test per row of the screen table', () => {
  it('no room, an unknown room, or a room with no seats: join', () => {
    expect(screenFor({ uid: 'a', code: null, data: null })).toBe('join');
    const gone = { uid: 'a', code: 'ZZZZ', data: { room: null, players: [] }, ui: { fields: {} } };
    expect(screenFor(gone)).toBe('join');
    expect(view(gone)).toContain('Room not found');
  });
  it('old room: no seats array shows the join form with the older-version message, for host and player', () => {
    for (const uid of ['gm', 'a']) {
      const s = st(uid, { phase: 'voting', roundPlayers: ['a', 'b'] });
      delete s.data.room.seats;
      s.data.room.active = ['a', 'b'];
      expect(screenFor(s)).toBe('join');
      expect(view(s)).toContain('This room is from an older version. Create a new one.');
    }
  });
  it('lobby, host: everyone listed (host included), New game, Remove others, hand over, no Leave with others', () => {
    const s = st('gm', {});
    expect(screenFor(s)).toBe('lobby');
    const html = view(s);
    expect(html).toContain('Gina <i>(you)</i>');
    expect(html).toContain('Players (7)');
    expect(has(html, 'newGame')).toBe(true);
    expect(html).not.toMatch(/data-action="newGame"[^>]*disabled/);
    expect(html).toContain('data-action="remove" data-arg="a"');
    expect(html).not.toContain('data-action="remove" data-arg="gm"');
    expect(html).toContain('data-action="handOver" data-arg="a"');
    expect(html).not.toContain('data-action="handOver" data-arg="gm"');
    expect(has(html, 'leave')).toBe(false);
    expect(has(html, 'askLeave')).toBe(false);
    expect(html).toContain('Hand the room to someone before you leave.');
  });
  it('lobby, host alone: Leave deletes the room; New game disabled with the reason', () => {
    const s = st('gm', {}, { players: [{ uid: 'gm', name: 'Gina' }] });
    const html = view(s);
    expect(has(html, 'leave')).toBe(true);
    expect(html).toContain('leaving deletes this room');
    expect(html).not.toContain('Hand the room to someone');
    expect(html).toMatch(/data-action="newGame"[^>]*disabled/);
    expect(html).toContain('1 here so far');
  });
  it('lobby, host with 3 people: New game disabled, the reason counts the host', () => {
    const html = view(st('gm', {}, { players: players.slice(0, 3) }));
    expect(html).toMatch(/data-action="newGame"[^>]*disabled/);
    expect(html).toContain('Needs at least 4 players, you included. 3 here so far.');
  });
  it('lobby, others: waiting for the host, and Leave', () => {
    const s = st('a', {});
    expect(screenFor(s)).toBe('waiting');
    const html = view(s);
    expect(html).toContain('Waiting for Gina to start the game.');
    expect(html).toContain('Ann <i>(you)</i>');
    expect(has(html, 'leave')).toBe(true);
    expect(has(html, 'newGame')).toBe(false);
  });
  it('in players, not dealt in, game running: late joiner with Leave (no question)', () => {
    const s = st('d', game());
    expect(screenFor(s)).toBe('lateJoiner');
    const html = view(s);
    expect(html).toContain("A game is in progress. You're in the next one.");
    expect(has(html, 'leave')).toBe(true);
    expect(has(html, 'askLeave')).toBe(false);
  });
  it('benched before gameOver: which bench, scoreboard, Leave', () => {
    expect(screenFor(st('e', game()))).toBe('bench');
    expect(screenFor(st('f', game()))).toBe('bench');
    const html = view(st('e', game()));
    expect(html).toContain("You're on the Hero bench");
    expect(html).toContain('Spy bench');
    expect(has(html, 'leave')).toBe(true);
    expect(view(st('f', game()))).toContain("You're on the Spy bench");
  });
  it('seated, voting, not voted: word, then one list: the speaking order where every other name is a vote button', () => {
    const s = st('b', game(), { myWord: 'Cola' });
    expect(screenFor(s)).toBe('vote');
    const html = view(s);
    expect(html).toContain('Cola');
    expect(html).toContain('Speaking order');
    expect(html.match(/<ol/g).length).toBe(1);
    const list = html.slice(html.indexOf('<ol'), html.indexOf('</ol>'));
    expect([...list.matchAll(/<li>(.*?)<\/li>/g)].map((m) => (m[1].includes('data-action="vote"') ? m[1].match(/data-arg="(\w+)"/)[1] : 'own')))
      .toEqual(['a', 'own', 'c', 'gm']);
    expect(list).toContain('Ben <i>(you)</i>');
    expect(html).toContain('aria-label="Vote for Ann"');
    expect(html.indexOf('tap who you think is the spy')).toBeLessThan(html.indexOf('<ol'));
    expect(html.match(/data-action="vote"/g).length).toBe(3);
    expect(html).not.toContain('data-action="vote" data-arg="b"');
    expect(html).not.toContain('data-arg="e"');
    expect(html).toContain('Heroes <b>1</b>');
    expect(html).not.toContain('Final battle');
  });
  it('seated, voting, voted: word, order, Vote sent, who is left to vote in speaking order', () => {
    const s = st('a', game(), { myWord: 'Cola', myVote: 'b', waiting: ['gm', 'c'] });
    expect(screenFor(s)).toBe('vote');
    const html = view(s);
    for (const t of ['Cola', 'Speaking order', 'Vote sent', 'Waiting for: Cara, Gina']) expect(html).toContain(t);
    expect(has(html, 'vote')).toBe(false);
    // Above the order, so it shows without scrolling.
    expect(html.indexOf('Vote sent')).toBeLessThan(html.indexOf('<ol'));
  });
  it('seated, voting, everyone voted and no result yet: "Everyone has voted."', () => {
    const html = view(st('a', game(), { myWord: 'Cola', myVote: 'b', waiting: [] }));
    expect(html).toContain('Everyone has voted.');
    expect(html).not.toContain('Waiting for:');
    expect(html).not.toContain(STALL_LINE);
  });
  it('anyone, voting, everyone voted and stalled: the host-phone line (not on the host)', () => {
    for (const [uid, extra] of [['a', { myVote: 'b' }], ['e', {}], ['d', {}]]) {
      expect(view(st(uid, game(), extra, {}, STALL_VOTE))).toContain(STALL_LINE);
      expect(view(st(uid, game(), extra, {}, { since: 0, now: 9999 }))).not.toContain(STALL_LINE);
      expect(view(st(uid, game(), { ...extra, waiting: ['c'] }, {}, { since: 0, now: 600000 }))).not.toContain(STALL_LINE);
    }
    expect(view(st('gm', game(), { myVote: 'b' }, {}, STALL_VOTE))).not.toContain(STALL_LINE);
  });
  it('anyone, result: the result, then the next-step line; no number from another clock', () => {
    for (const uid of ['a', 'e', 'd', 'gm']) expect(screenFor(st(uid, inResult()))).toBe('result');
    const four = view(st('a', inResult({ seats: ['a', 'c', 'd', 'gm'] })));
    expect(four).toMatch(/Ben<\/b> was not the spy\. Spies \+1\./);
    expect(four).toContain('Next round starts in a moment.');
    expect(view(st('a', inResult()))).toContain('The final battle starts in a moment.');
    expect(view(st('a', inResult({ seats: ['a', 'gm'] })))).toContain('The game ends in a moment.');
    expect(four).not.toMatch(/\d+ ?(s|sec|second)/);
    expect(four.indexOf('was not the spy')).toBeLessThan(four.indexOf('Hero bench'));
  });
  it('anyone, result, stalled after 20 s: the host-phone line', () => {
    expect(view(st('a', inResult(), {}, {}, { since: 0, now: 20000 }))).toContain(STALL_LINE);
    expect(view(st('a', inResult(), {}, {}, { since: 0, now: 19999 }))).not.toContain(STALL_LINE);
    expect(view(st('gm', inResult(), {}, {}, { since: 0, now: 20000 }))).not.toContain(STALL_LINE);
  });
  it('anyone, result: the three verdicts', () => {
    const spyHtml = view(st('a', inResult({ result: caught, needsWords: true, spyBench: ['f', 'c'], heroBench: ['e'], seats: ['a', 'b', 'gm'] })));
    expect(spyHtml).toMatch(/Cara<\/b> was the spy! Heroes \+1\./);
    expect(spyHtml).toContain('Cola');
    expect(spyHtml).toContain('Water');
    const left = view(st('a', inResult({ result: { ...voidedHero, spyUid: 'c', spyName: 'Cara', common: 'Cola', spy: 'Water' }, needsWords: true })));
    expect(left).toMatch(/Cara<\/b> left\. This round doesn't count\./);
    const leftHero = view(st('a', inResult({ result: { ...voidedHero, outUid: 'b', outName: 'Ben' } })));
    expect(leftHero).toMatch(/Ben<\/b> left\. This round doesn't count\./);
    expect(leftHero).not.toContain('Cola');
    expect(leftHero).not.toContain('class="tag"');
  });
  it('result: late joiner is told they are in the next game; benched sees the bench', () => {
    const late = view(st('d', inResult()));
    expect(late).toContain("You're in the next game.");
    expect(late).not.toContain('starts in a moment');
    expect(view(st('e', inResult()))).toContain("You're on the Hero bench.");
  });
  it('the host during a game: the collapsed Remove a player and the keep-open line, on every game screen', () => {
    for (const s of [st('gm', game(), { myWord: 'Cola' }), st('gm', game(), { myVote: 'a' }), st('gm', inResult()),
      st('gm', game({ seats: ['a', 'b', 'c'], roundPlayers: ['a', 'b', 'c'], heroBench: ['e', 'gm'] }))]) {
      const html = view(s);
      expect(html).toContain('Your phone runs this room. Keep this screen open.');
      expect(html).toContain('<details class="manage" data-open="openRemove"><summary>Remove a player</summary>');
    }
    for (const s of [st('gm', {}), st('a', game()), st('e', game())]) {
      expect(view(s)).not.toContain('Keep this screen open');
      expect(view(s)).not.toContain('Remove a player');
    }
  });
  it('uid not in the room: join; subscription not loaded yet: loading', () => {
    expect(screenFor(st('stranger', {}))).toBe('join');
    expect(screenFor(st('stranger', game()))).toBe('join');
    expect(screenFor({ uid: 'a', code: 'ABCD', data: undefined })).toBe('loading');
  });
});

describe('screenFor re-entry (a reload: fresh ui, same room)', () => {
  it('host: seated, benched, in a result, between games', () => {
    expect(screenFor(st('gm', game(), { myVote: undefined }))).toBe('vote');
    expect(screenFor(st('gm', game({ seats: ['a', 'b', 'c'], roundPlayers: ['a', 'b', 'c'], spyBench: ['f', 'gm'] })))).toBe('bench');
    expect(screenFor(st('gm', inResult()))).toBe('result');
    expect(screenFor(st('gm', {}))).toBe('lobby');
  });
  it('active player returns to the word and the vote', () => {
    const s = st('b', game(), { myWord: 'Cola', myVote: undefined });
    expect(screenFor(s)).toBe('vote');
    const html = view(s);
    expect(html).toContain('Cola');
    expect(html).toContain('Checking your vote');
    expect(has(html, 'vote')).toBe(false);
  });
  it('benched player returns to the scoreboard', () => expect(screenFor(st('e', game()))).toBe('bench'));
  it('late joiner returns to the wait', () => expect(screenFor(st('d', game()))).toBe('lateJoiner'));
  it('removed player: join; removed and rejoined (in names, not seated, on no bench): late joiner', () => {
    const removed = st('b', game({ seats: ['a', 'c', 'gm'], roundPlayers: ['a', 'c', 'gm'] }), { players: players.filter((p) => p.uid !== 'b') });
    expect(screenFor(removed)).toBe('join');
    expect(screenFor(st('b', game({ seats: ['a', 'c', 'gm'], roundPlayers: ['a', 'c', 'gm'] })))).toBe('lateJoiner');
  });
});

describe('secrecy', () => {
  // Host only: the keep-open line and Remove a player. Players only: Leave room (the host hands the room over instead).
  const strip = (html) => html.replace(/<p class="keep">.*?<\/p>/s, '').replace(/<details class="manage".*?<\/details>/s, '')
    .replace(/<button[^>]*data-action="askLeave"[^>]*>Leave room<\/button>/, '');
  // The order is one list: the viewer's own row (in their own seat) is the only one that is not a vote button.
  const rows = (html) => html.replace(/<li><button[^>]*data-action="vote"[^>]*>NAME<\/button><\/li>|<li><span>NAME<\/span><\/li>/g, '<li>ROW</li>');
  const names = (html) => html.replace(/ <i>\(you\)<\/i>/g, '').replace(/Gina|Ann|Ben|Cara/g, 'NAME').replace(/data-arg="(gm|a|b|c)"/g, 'data-arg="X"');
  const mask = (html) => rows(names(strip(html)));
  const votes = (html) => (html.match(/data-action="vote"/g) || []).length;
  it('no view before gameOver has the other word or marks the spy, for the host as spy or hero', () => {
    for (const [mine, other] of [['Water', 'Cola'], ['Cola', 'Water']]) {
      const states = [
        st('gm', game(), { myWord: mine }), st('gm', game(), { myWord: mine, myVote: 'a', waiting: ['b'] }),
        st('gm', game(), { myWord: mine, myVote: 'a' }, {}, STALL_VOTE),
        st('gm', inResult(), { myWord: mine }), st('gm', inResult({ result: { ...voidedHero, outUid: 'b', outName: 'Ben' } }), { myWord: mine }),
        st('gm', game({ seats: ['a', 'b', 'c'], roundPlayers: ['a', 'b', 'c'], heroBench: ['e', 'gm'] }), { myWord: mine }),
        st('gm', game(), { myWord: mine }, { confirmRemove: 'c' }),
      ];
      for (const s of states) {
        const html = view(s);
        expect(html).not.toContain(other);
        expect(html).not.toContain('class="tag"');
        expect(html).not.toMatch(/\bspy is\b/i);
      }
    }
  });
  it('nothing in view reads a secret, the used pairs or a vote count, even if the state carried them', () => {
    const trap = (s) => {
      for (const k of ['secret', 'used', 'votesCast']) Object.defineProperty(s.data, k, { get() { throw new Error(`read ${k}`); } });
      return s;
    };
    for (const s of [st('gm', game(), { myWord: 'Cola' }), st('gm', inResult()), st('gm', {}), st('a', game(), { myWord: 'Cola' }), st('e', game())]) {
      expect(() => view(trap(s))).not.toThrow();
    }
  });
  it('a "not the spy" result names no spy and shows neither word, for anyone', () => {
    for (const uid of ['a', 'e', 'gm']) {
      const html = view(st(uid, inResult(), { myWord: 'Cola' }));
      expect(html).not.toContain('Cola');
      expect(html).not.toContain('Water');
      expect(html).not.toContain('class="tag"');
      expect(html.slice(html.indexOf('<section class="result">'), html.indexOf('</section>'))).not.toContain('Cara');
    }
  });
  it('the benched view contains no word; the Spy bench lists only caught spies', () => {
    const html = view(st('e', game(), { myWord: 'Cola' }));
    expect(html).not.toContain('Cola');
    expect(html).not.toContain('Your word');
    const spyBench = html.slice(html.indexOf('Spy bench'), html.indexOf('Still in'));
    expect(spyBench).toContain('Fay');
    expect(spyBench).not.toContain('Cara');
  });
});

describe('leave', () => {
  it('an active player mid-game is asked first, with the warning', () => {
    for (const s of [st('a', game(), { myWord: 'Cola' }), st('a', game(), { myVote: 'b' }), st('a', inResult())]) {
      const html = view(s);
      expect(has(html, 'askLeave')).toBe(true);
      expect(has(html, 'leave')).toBe(false);
      const asked = view({ ...s, ui: { ...s.ui, confirmLeave: true } });
      expect(asked).toContain("You're in a game. Leaving can hold it up for the others.");
      expect(has(asked, 'leave')).toBe(true);
      expect(has(asked, 'stay')).toBe(true);
    }
  });
  it('directly between games, on a bench and for a late joiner', () => {
    for (const s of [st('a', {}), st('e', game()), st('e', inResult()), st('d', game()), st('d', inResult())]) {
      expect(has(view(s), 'leave')).toBe(true);
    }
  });
});

describe('remove', () => {
  it('a seated player mid-vote asks first and keeps the section open', () => {
    const html = view(st('gm', game(), {}, { confirmRemove: 'c' }));
    expect(html).toContain('<details class="manage" data-open="openRemove" open>');
    expect(html).toContain("Remove Cara? This round won't count.");
  });
  it('a benched player is removed without the round warning', () => {
    expect(view(st('gm', game(), {}, { confirmRemove: 'e' }))).not.toContain("This round won't count");
  });
  it('the host is never in a remove list', () => {
    for (const s of [st('gm', {}), st('gm', game()), st('gm', inResult())]) expect(view(s)).not.toContain('data-action="remove" data-arg="gm"');
  });
});

describe('view', () => {
  it("shows the host's background error to the host only", () => {
    expect(view(st('gm', game(), {}, { runError: 'Fix the date and try again.' }))).toContain('<b>Problem:</b> Fix the date and try again.');
    expect(view(st('a', game(), {}, { runError: 'x' }))).not.toContain('Problem:');
  });
  it('escapes player names', () => {
    const s = st('gm', {}, { players: [{ uid: 'gm', name: 'Gina' }, { uid: 'x', name: '<img src=x onerror=alert(1)>' }] });
    expect(view(s)).not.toContain('<img');
    expect(view(st('e', game({ names: { ...dealt, f: '<img src=x>' } })))).not.toContain('<img');
  });
  it('never shows the stored round number', () => {
    for (const s of [st('gm', game()), st('a', game(), { myWord: 'Cola' }), st('e', game()), st('a', inResult())]) expect(view(s)).not.toMatch(/Round 7|>7</);
  });
  it('reads final only during voting', () => {
    expect(view(st('a', inResult({ final: true })))).not.toContain('Final battle');
  });
});

describe('isRoomCode', () => {
  it('accepts 4 letters from the code alphabet only', () => {
    expect(isRoomCode('KPRT')).toBe(true);
    for (const bad of ['', 'KPR', 'KPRTX', 'kprt', 'KPR1', 'KPRI', 'KPRO', 'KP/T', 'KPRL']) expect(isRoomCode(bad)).toBe(false);
  });
});

describe('settle', () => {
  it('clears the error when the screen changes, keeps it when it does not', () => {
    const s1 = st('a', {}, {}, { error: 'Problem' });
    expect(settle(s1, s1).error).toBe('Problem');
    expect(settle(s1, st('a', game(), {}, s1.ui)).error).toBe(null);
  });
  it('resets confirmRemove and confirmLeave when the round changes', () => {
    const a = st('a', game({ round: 1 }), {}, { confirmRemove: 'b', confirmLeave: true });
    const b = st('a', game({ round: 2 }), {}, a.ui);
    expect(settle(a, b)).toMatchObject({ confirmRemove: null, confirmLeave: false });
  });
});

describe('render ignores taps right after the screen changes', () => {
  const fakeRoot = () => {
    const button = { dataset: { action: 'remove', arg: 'b' }, addEventListener(_, f) { this.click = f; } };
    return { button, querySelectorAll: (sel) => (sel === '[data-action]' ? [button] : []) };
  };
  const tapAfter = (first, second) => {
    vi.useFakeTimers();
    try {
      const root = fakeRoot();
      const remove = vi.fn();
      render(root, first, { remove });
      vi.advanceTimersByTime(301);
      render(root, second, { remove });
      root.button.click();
      return remove;
    } finally { vi.useRealTimers(); }
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
  it('also guards the vote buttons giving way to Vote sent, and the Leave question appearing', () => {
    expect(tapAfter(st('a', game(), { myWord: 'Cola' }), st('a', game(), { myWord: 'Cola', myVote: 'b' }))).not.toHaveBeenCalled();
    expect(tapAfter(st('a', game()), st('a', game(), {}, { confirmLeave: true }))).not.toHaveBeenCalled();
  });
});

describe('one Leave control per screen, open sections kept', () => {
  it('keeps Remove a player and the hand-over section open when the page says so', () => {
    expect(view(st('gm', game(), {}, { openRemove: true }))).toContain('<details class="manage" data-open="openRemove" open>');
    expect(view(st('gm', game()))).toContain('<details class="manage" data-open="openRemove">');
    expect(view(st('gm', {}, {}, { openHandOver: true }))).toContain('<details class="manage" data-open="openHandOver" open>');
    expect(view(st('gm', {}))).toContain('<details class="manage" data-open="openHandOver">');
  });
  it('render reports a section opened or closed by hand', () => {
    const details = { dataset: { open: 'openRemove' }, open: true, addEventListener(_, f) { this.toggle = f; } };
    const root = { querySelectorAll: (sel) => (sel === 'details[data-open]' ? [details] : []) };
    const setOpen = vi.fn();
    render(root, st('gm', game()), { setOpen });
    details.toggle();
    expect(setOpen).toHaveBeenCalledWith('openRemove', true);
  });
});

describe('final review fixes', () => {
  it('a seated player who left (no record, still in seats) still has a Remove row with their name', () => {
    const s = st('gm', game(), { players: players.filter((p) => p.uid !== 'b') });
    const html = view(s);
    expect(html).toContain('aria-label="Remove Ben"');
    expect(html).toContain('data-action="remove" data-arg="b"');
    expect(html).not.toContain('data-action="remove" data-arg="gm"');
    expect(html.match(/data-action="remove" data-arg="c"/g)).toHaveLength(1);
  });
  it('who the round waits for shows during voting before voting, on the bench and for a late joiner', () => {
    const extra = { waiting: ['gm', 'b'] };
    for (const s of [st('a', game(), { ...extra, myWord: 'Cola' }), st('gm', game(), { ...extra, myWord: 'Cola' }), st('e', game(), extra), st('d', game(), extra)]) {
      expect(view(s)).toContain('Waiting for: Ben, Gina');
    }
    const unvoted = view(st('a', game(), { ...extra, myWord: 'Cola' }));
    expect(unvoted.indexOf('Waiting for: Ben, Gina')).toBeLessThan(unvoted.indexOf('<ol'));
    for (const s of [st('e', game()), st('d', game()), st('a', game(), { myWord: 'Cola' })]) expect(view(s)).toContain('Everyone has voted.');
  });
  it('the waiting line is the same for the spy and a hero', () => {
    const r = game();
    const spy = view(st('c', r, { myWord: 'Water', waiting: ['b', 'c'] })).replace('Water', 'W').replace(' <i>(you)</i>', '');
    const heroHtml = view(st('c', r, { myWord: 'Cola', waiting: ['b', 'c'] })).replace('Cola', 'W').replace(' <i>(you)</i>', '');
    expect(spy).toBe(heroHtml);
  });
  it('settle drops the close question when the round changes', () => {
    const a = st('gm', game({ round: 1 }), {}, { confirmClose: true });
    expect(settle(a, st('gm', game({ round: 2 }), {}, a.ui))).toMatchObject({ confirmClose: false });
  });
});

describe('friendly errors', () => {
  it('maps the room errors to plain messages', () => {
    expect(friendly(new Error('Old room'))).toBe('This room is from an older version. Create a new one.');
    expect(friendly(new Error('Bad clock'))).toBe("Your phone's date looks wrong. Fix it and try again.");
    expect(friendly(new Error('Not in this round'))).toBe("You're not in this round any more.");
    expect(friendly(new Error('Hand the room over first'))).toBe('Hand the room to someone before you leave.');
    expect(friendly(new Error('boom'))).toContain('Something went wrong');
  });
});
