import { describe, it, expect, vi } from 'vitest';
import { screenFor, view, nextPair, settle, render, friendly } from '../src/ui.js';
import { isRoomCode } from '../src/game.js';

const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
const NAMES = { a: 'Ann', b: 'Ben', c: 'Cara', d: 'Dev', e: 'Eli', f: 'Fay' };
const players = ids.map((uid) => ({ uid, name: NAMES[uid] }));
const room = (over = {}) => ({
  gmUid: 'gm', gmName: 'Gina', phase: 'lobby', round: 7, roundPlayers: [], starterUid: null, result: null,
  active: [], names: {}, heroBench: [], spyBench: [], score: { heroes: 0, spies: 0 },
  wordSet: 1, needsWords: false, final: false, winner: null, setStart: false, ...over,
});
const st = (uid, roomOver, extra = {}, ui = {}) => ({
  uid, code: 'ABCD', ui: { fields: {}, ...ui },
  data: { room: room(roomOver), players, myWord: null, secret: null, votesCast: 0, ...extra },
});
// A game in progress: e and f benched, a-d still in, c is the spy (only the gm's secret says so).
const game = (over = {}) => ({
  names: NAMES, active: ['a', 'b', 'c', 'd'], roundPlayers: ['a', 'b', 'c', 'd'], heroBench: ['e'], spyBench: ['f'],
  score: { heroes: 1, spies: 1 }, phase: 'clues', starterUid: 'a', ...over,
});
const secret = { common: 'Cola', spy: 'Water', spyUid: 'c', wordSet: 1 };
const notSpy = { outUid: 'b', outName: 'Ben', wasSpy: false, team: 'spies', points: 1, voided: false, spyUid: null, spyName: null, common: null, spy: null };
const caught = { outUid: 'c', outName: 'Cara', wasSpy: true, team: 'heroes', points: 1, voided: false, spyUid: 'c', spyName: 'Cara', common: 'Cola', spy: 'Water' };
const voidedHero = { ...notSpy, outUid: null, outName: null, team: null, points: 0, voided: true };
const has = (html, action) => html.includes(`data-action="${action}"`);

describe('screenFor: one test per row of the screen table', () => {
  it('no room in the URL: join', () => expect(screenFor({ uid: 'a', code: null, data: null })).toBe('join'));
  it('unknown room: join (with Room not found)', () => {
    const s = { uid: 'a', code: 'ZZZZ', data: { room: null, players: [] }, ui: { fields: {} } };
    expect(screenFor(s)).toBe('join');
    expect(view(s)).toContain('Room not found');
  });
  it('old room: a room without active shows the join form with the older-version message', () => {
    for (const uid of ['gm', 'a']) {
      const s = st(uid, { phase: 'voting', roundPlayers: ['a', 'b'] });
      delete s.data.room.active;
      expect(screenFor(s)).toBe('join');
      expect(view(s)).toContain('This room is from an older version. Create a new one.');
    }
  });
  it('game master, lobby or gameOver: lobby, with the final result above at gameOver', () => {
    expect(screenFor(st('gm', {}))).toBe('lobby');
    const s = st('gm', game({ phase: 'gameOver', winner: 'heroes', score: { heroes: 5, spies: 4 }, result: caught }));
    expect(screenFor(s)).toBe('lobby');
    const html = view(s);
    expect(html.indexOf('Heroes win')).toBeLessThan(html.indexOf('Room code'));
    expect(has(html, 'words')).toBe(true);
  });
  it('game master, words needed: words for a new game, or a result with needsWords', () => {
    expect(screenFor(st('gm', {}, {}, { view: 'words' }))).toBe('words');
    expect(screenFor(st('gm', game({ phase: 'gameOver' }), {}, { view: 'words' }))).toBe('words');
    expect(screenFor(st('gm', game({ phase: 'result', result: caught, needsWords: true }), {}, { view: 'words' }))).toBe('words');
    expect(screenFor(st('gm', game({ phase: 'result', result: notSpy }), {}, { view: 'words' }))).toBe('gmResult');
  });
  it('game master, clues without a starter: pickStarter, starterChoices decides what is tappable', () => {
    const five = st('gm', game({ active: ['a', 'b', 'c', 'd', 'e'], roundPlayers: ['a', 'b', 'c', 'd', 'e'], heroBench: [], starterUid: null, setStart: true }), { secret });
    expect(screenFor(five)).toBe('pickStarter');
    const html5 = view(five);
    expect(html5).toContain('too close to the spy');
    expect(html5.match(/data-action="pickStarter"/g).length).toBe(3);
    expect(html5).toContain('The spy will speak third or later.');
    // A later round of the same word set: anyone, the spy included.
    const later = view(st('gm', { ...five.data.room, setStart: false }, { secret }));
    expect(later).not.toContain('too close to the spy');
    expect(later.match(/data-action="pickStarter"/g).length).toBe(5);
    expect(later).toContain('Anyone can go first.');
    expect(later).not.toContain('third or later');
    for (const n of [4, 3]) {
      const s = st('gm', game({ active: ids.slice(0, n), roundPlayers: ids.slice(0, n), starterUid: null, setStart: true }), { secret });
      const html = view(s);
      expect(html).not.toContain('too close to the spy');
      expect(html.match(/data-action="pickStarter"/g).length).toBe(n);
    }
  });
  it('game master, clues/voting: gmRound with words, spy, order, scoreboard, keep open, final line', () => {
    for (const phase of ['clues', 'voting']) expect(screenFor(st('gm', game({ phase })))).toBe('gmRound');
    const html = view(st('gm', game({ phase: 'voting', final: true, score: { heroes: 1, spies: 4 }, active: ['a', 'b', 'c'], roundPlayers: ['a', 'b', 'c'] }), { secret, votesCast: 2 }));
    for (const t of ['Cola', 'Water', 'Keep this screen open', '2 of 3', 'Final battle, worth 4', 'Hero bench', 'Spy bench', 'Eli', 'Fay']) expect(html).toContain(t);
    expect(view(st('gm', game({ phase: 'clues' }), { secret }))).not.toContain('Final battle');
  });
  it('game master, result: gmResult with the result, scoreboard, Next round and Remove', () => {
    const s = st('gm', game({ phase: 'result', result: notSpy, active: ['a', 'c', 'd'], heroBench: ['e', 'b'] }));
    expect(screenFor(s)).toBe('gmResult');
    const html = view(s);
    expect(html).toMatch(/Ben<\/b> was not the spy/);
    for (const t of ['Hero bench', 'data-action="nextRound"', 'Remove']) expect(html).toContain(t);
  });
  it('active player, clues/voting: word, vote; with a score line and the final line when final', () => {
    expect(screenFor(st('a', game({ phase: 'clues' })))).toBe('word');
    expect(screenFor(st('a', game({ phase: 'voting' }), { myVote: null }))).toBe('vote');
    const html = view(st('a', game({ final: true, active: ['a', 'b', 'c'], roundPlayers: ['a', 'b', 'c'], score: { heroes: 1, spies: 4 } }), { myWord: 'Cola' }));
    expect(html).toContain('Heroes <b>1</b>');
    expect(html).toContain('Spies <b>4</b>');
    expect(html).toContain('Final battle, worth 4');
    expect(view(st('a', game(), { myWord: 'Cola' }))).not.toContain('Final battle');
  });
  it('benched player, any phase before gameOver: bench, scoreboard only', () => {
    for (const phase of ['clues', 'voting']) {
      expect(screenFor(st('e', game({ phase })))).toBe('bench');
      expect(screenFor(st('f', game({ phase })))).toBe('bench');
    }
    expect(view(st('e', game()))).toContain("You're on the Hero bench");
    expect(view(st('f', game()))).toContain("You're on the Spy bench");
    expect(view(st('e', game({ phase: 'result', result: notSpy })))).toContain("You're on the Hero bench");
  });
  it('in players but not in the game, game running: lateJoiner', () => {
    const s = st('a', game({ active: ['b', 'c', 'd', 'e'], roundPlayers: ['b', 'c', 'd', 'e'], heroBench: [], names: { b: 'Ben', c: 'Cara', d: 'Dev', e: 'Eli' } }));
    expect(screenFor(s)).toBe('lateJoiner');
    expect(view(s)).toContain("A game is in progress. You're in the next one.");
  });
  it('anyone, result: the three verdicts, then the scoreboard', () => {
    const spyHtml = view(st('a', game({ phase: 'result', result: caught, needsWords: true, active: ['a', 'b', 'd'], spyBench: ['f', 'c'] })));
    expect(screenFor(st('a', game({ phase: 'result', result: caught })))).toBe('result');
    expect(spyHtml).toMatch(/Cara<\/b> was the spy! Heroes \+1\./);
    expect(spyHtml).toContain('Cola');
    expect(spyHtml).toContain('Water');
    expect(spyHtml.indexOf('was the spy')).toBeLessThan(spyHtml.indexOf('Hero bench'));
    expect(view(st('a', game({ phase: 'result', result: notSpy })))).toMatch(/Ben<\/b> was not the spy\. Spies \+1\./);
    const left = view(st('a', game({ phase: 'result', result: { ...voidedHero, voided: true, wasSpy: false, spyUid: 'c', spyName: 'Cara', common: 'Cola', spy: 'Water' }, needsWords: true })));
    expect(left).toMatch(/Cara<\/b> left\. This round doesn't count\./);
    expect(left).toContain('Water');
    const leftHero = view(st('a', game({ phase: 'result', result: { ...voidedHero, outUid: 'b', outName: 'Ben' }, active: ['a', 'c', 'd'] })));
    expect(leftHero).toMatch(/Ben<\/b> left\. This round doesn't count\./);
    expect(leftHero).not.toContain('Cola');
    expect(leftHero).not.toContain('class="tag"');
  });
  it('anyone, gameOver: final score, winner, both teams by name, last spy and words', () => {
    const over = game({ phase: 'gameOver', active: ['a', 'b', 'c'], winner: 'spies', score: { heroes: 1, spies: 8 }, result: { ...notSpy, spyUid: 'c', spyName: 'Cara', common: 'Cola', spy: 'Water' } });
    expect(screenFor(st('a', over))).toBe('gameOver');
    expect(screenFor(st('e', over))).toBe('gameOver');
    const html = view(st('a', over));
    for (const t of ['Spies win!', 'Heroes <b>1</b>', 'Spies <b>8</b>', 'Cola', 'Water']) expect(html).toContain(t);
    const heroes = html.slice(html.indexOf('Heroes team'), html.indexOf('Spies team'));
    for (const n of ['Ann', 'Ben', 'Eli']) expect(heroes).toContain(n);
    expect(heroes).not.toContain('Cara');
    expect(html.slice(html.indexOf('Spies team'))).toContain('Fay');
    expect(view(st('a', { ...over, winner: 'draw', score: { heroes: 2, spies: 2 } }))).toContain("It's a draw");
    // One line on who went out in the final; nothing when the game ended without a final vote.
    expect(html).toMatch(/Ben<\/b> was voted out and was not the spy\./);
    expect(view(st('a', { ...over, result: { ...caught, points: 8 } }))).toMatch(/Cara<\/b> was voted out and was the spy!/);
    expect(view(st('a', { ...over, result: { ...notSpy, points: 0 } }))).not.toContain('was voted out');
    const unknown = view(st('a', { ...over, result: { ...notSpy } }));
    expect(unknown).not.toContain('Cola');
    expect(unknown).not.toContain('last spy');
  });
  it('uid not in the room: join', () => expect(screenFor(st('stranger', {}))).toBe('join'));
  it('player in lobby: waiting', () => expect(screenFor(st('a', {}))).toBe('waiting'));
  it('subscription not loaded yet: loading', () => expect(screenFor({ uid: 'a', code: 'ABCD', data: undefined })).toBe('loading'));
});

describe('screenFor re-entry (a reload: fresh ui, same room)', () => {
  it('game master returns to the round or result', () => {
    expect(screenFor(st('gm', game({ phase: 'voting' }), { secret }))).toBe('gmRound');
    expect(screenFor(st('gm', game({ phase: 'result', result: caught, needsWords: true })))).toBe('gmResult');
  });
  it('active player returns to the word', () => {
    const s = st('b', game(), { myWord: 'Cola' });
    expect(screenFor(s)).toBe('word');
    expect(view(s)).toContain('Cola');
  });
  it('benched player returns to the scoreboard', () => expect(screenFor(st('e', game({ phase: 'voting' })))).toBe('bench'));
  it('late joiner, or a removed active player who rejoined, waits for the next game', () => {
    // b was in the game (in names), was removed, and joined again: not in active, on no bench.
    expect(screenFor(st('b', game({ active: ['a', 'c', 'd'], roundPlayers: ['a', 'c', 'd'] })))).toBe('lateJoiner');
  });
});

describe('secrecy on player screens', () => {
  it('a "not the spy" result names no spy and shows neither word', () => {
    for (const uid of ['a', 'e', 'gm']) {
      const html = view(st(uid, game({ phase: 'result', result: notSpy, active: ['a', 'c', 'd'], heroBench: ['e', 'b'] }), { myWord: 'Cola' }));
      expect(html).not.toContain('Cola');
      expect(html).not.toContain('Water');
      expect(html).not.toContain('class="tag"');
      // Cara (the spy) is only listed among the players still in, like everyone else.
      expect(html.slice(html.indexOf('<section class="result">'), html.indexOf('</section>'))).not.toContain('Cara');
    }
  });
  it("the active spy's view equals a hero's view apart from the word, also in the final", () => {
    for (const final of [false, true]) {
      for (const [phase, extra] of [['clues', {}], ['voting', { myVote: null }], ['voting', { myVote: 'a' }], ['voting', { myVote: undefined }]]) {
        const r = game({ phase, final, active: ['a', 'b', 'c'], roundPlayers: ['a', 'b', 'c'], score: { heroes: 2, spies: 1 } });
        const spy = view(st('c', r, { ...extra, myWord: 'Water' })).replace('Water', 'WORD');
        const hero = view(st('c', r, { ...extra, myWord: 'Cola' })).replace('Cola', 'WORD');
        expect(spy).toBe(hero);
      }
    }
  });
  it('two different active players, one the spy, see the same screen apart from the word and their own seat', () => {
    // Players never receive `secret`: their state carries only myWord.
    const mask = (html, word) => html.replace(word, 'WORD').replace('<i>(you)</i>', '')
      .replace(/Ann|Ben|Cara/g, 'NAME').replace(/data-arg="[abc]"/g, 'data-arg="X"');
    for (const final of [false, true]) {
      for (const [phase, extra] of [['clues', {}], ['voting', { myVote: null }]]) {
        const r = game({ phase, final, active: ['a', 'b', 'c'], roundPlayers: ['a', 'b', 'c'], score: { heroes: 2, spies: 1 } });
        const hero = mask(view(st('a', r, { ...extra, myWord: 'Cola' })), 'Cola');
        const spy = mask(view(st('c', r, { ...extra, myWord: 'Water' })), 'Water');
        expect(spy).toBe(hero);
      }
    }
  });
  it('the benched view contains no word', () => {
    for (const phase of ['clues', 'voting']) {
      const html = view(st('e', game({ phase }), { myWord: 'Cola' }));
      expect(html).not.toContain('Cola');
      expect(html).not.toContain('Your word');
    }
  });
  it('the scoreboard lists only caught spies on the Spy bench', () => {
    const html = view(st('e', game()));
    const spyBench = html.slice(html.indexOf('Spy bench'), html.indexOf('Still in'));
    expect(spyBench).toContain('Fay');
    expect(spyBench).not.toContain('Cara');
  });
});

describe('Next round for the game master', () => {
  const gr = (over) => view(st('gm', game({ phase: 'result', ...over })));
  it('opens Words only when needsWords', () => {
    const words = gr({ result: caught, needsWords: true });
    expect(has(words, 'words')).toBe(true);
    expect(has(words, 'nextRound')).toBe(false);
    const next = gr({ result: notSpy });
    expect(has(next, 'nextRound')).toBe(true);
    expect(has(next, 'words')).toBe(false);
  });
  it('ends the game when fewer than 3 are left, even if words are needed', () => {
    const html = gr({ result: caught, needsWords: true, active: ['a', 'b'] });
    expect(has(html, 'nextRound')).toBe(true);
    expect(html).toContain('Show the final score');
  });
  it('says the next round is the final battle at 3', () => {
    expect(gr({ result: notSpy, active: ['a', 'c', 'd'] })).toContain('Start the final battle');
  });
  it('a final worth 1 says point, not points', () => {
    const r = game({ final: true, active: ['a', 'b', 'c'], roundPlayers: ['a', 'b', 'c'], score: { heroes: 2, spies: 2 } });
    for (const s of [st('a', r, { myWord: 'Cola' }), st('gm', r, { secret })]) {
      expect(view(s)).toContain('Final battle, worth 1 point.');
    }
    expect(view(st('a', { ...r, score: { heroes: 1, spies: 2 } }, { myWord: 'Cola' }))).toContain('worth 2 points');
  });
});

describe('view', () => {
  it('game master sees a waiting state, not a stale spy, while secret is null', () => {
    const html = view(st('gm', game({ starterUid: null })));
    expect(html).toContain('Dealing the words');
    expect(html).not.toContain('Spy</span>');
  });
  it('New game is disabled with the reason under 4 players', () => {
    const s = st('gm', {});
    s.data.players = players.slice(0, 3);
    const html = view(s);
    expect(html).toMatch(/data-action="words"[^>]*disabled/);
    expect(html).toContain('New game');
    expect(html).toContain('3 joined so far');
  });
  it('escapes player names', () => {
    const s = st('gm', {});
    s.data.players = [{ uid: 'x', name: '<img src=x onerror=alert(1)>' }];
    expect(view(s)).not.toContain('<img');
    const g = st('e', game({ names: { ...NAMES, f: '<img src=x>' } }));
    expect(view(g)).not.toContain('<img');
  });
  it('never shows the stored round number', () => {
    for (const s of [st('gm', game(), { secret }), st('a', game(), { myWord: 'Cola' }), st('e', game())]) expect(view(s)).not.toMatch(/Round 7/);
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
  it('also guards Open voting turning into Close voting on the same screen', () => {
    vi.useFakeTimers();
    try {
      const root = fakeRoot();
      const remove = vi.fn();
      render(root, st('gm', game({ phase: 'clues' }), { secret }), { remove });
      vi.advanceTimersByTime(301);
      render(root, st('gm', game({ phase: 'voting' }), { secret }), { remove });
      root.button.click();
      expect(remove).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});

describe('leave room button', () => {
  const leave = (html) => has(html, 'leave');
  it('offered between games, to benched players and to late joiners', () => {
    expect(leave(view(st('a', {})))).toBe(true);
    expect(leave(view(st('gm', {})))).toBe(true);
    expect(view(st('gm', {}))).toContain('The room stays open');
    const over = game({ phase: 'gameOver', winner: 'draw', result: notSpy });
    expect(leave(view(st('a', over)))).toBe(true);
    expect(leave(view(st('gm', over)))).toBe(true);
    for (const phase of ['clues', 'voting', 'result']) {
      expect(leave(view(st('e', game({ phase, result: phase === 'result' ? notSpy : null }))))).toBe(true);
      expect(leave(view(st('x', game({ phase, result: phase === 'result' ? notSpy : null }), {}, {})))).toBe(false); // not in players: join form
    }
    const late = st('a', game({ active: ['b', 'c', 'd', 'e'], roundPlayers: ['b', 'c', 'd', 'e'], heroBench: [] }));
    expect(leave(view(late))).toBe(true);
    const lateResult = view(st('a', game({ phase: 'result', result: notSpy, active: ['c', 'd', 'e'], heroBench: ['b'] })));
    expect(leave(lateResult)).toBe(true);
    expect(lateResult).toContain("You're in the next game.");
    expect(lateResult).not.toContain('start the next round');
  });
  it('never to an active player or the game master mid-game', () => {
    for (const phase of ['clues', 'voting', 'result']) {
      const r = game({ phase, result: phase === 'result' ? notSpy : null });
      expect(leave(view(st('a', r, { myVote: null })))).toBe(false);
      expect(leave(view(st('gm', r, { secret })))).toBe(false);
    }
  });
});

describe('vote screen', () => {
  const vs = (extra, ui = {}) => view(st('a', game({ phase: 'voting' }), extra, ui));
  it('shows a status, not buttons, until the own vote is known', () => {
    const html = vs({ myVote: undefined });
    expect(html).toContain('Checking your vote');
    expect(html).not.toContain('data-action="vote"');
  });
  it('shows Vote sent from the stored vote, not from a local flag', () => {
    expect(vs({ myVote: 'b' })).toContain('Vote sent');
    expect(vs({ myVote: null }, { voted: true })).toContain('Who is the spy?');
  });
  it('offers only other active players', () => {
    const html = vs({ myVote: null });
    expect(html.match(/data-action="vote"/g).length).toBe(3);
    expect(html).not.toContain('data-arg="e"');
  });
});

describe('remove', () => {
  it('a benched player is removed mid-round without the round warning', () => {
    const s = st('gm', game(), { secret }, { confirmRemove: 'e' });
    expect(view(s)).not.toContain("This round won't count");
  });
  it('keeps the Remove section open while asking to confirm an active player', () => {
    const s = st('gm', game(), { secret }, { confirmRemove: 'c' });
    expect(view(s)).toContain('<details class="manage" open>');
    expect(view(s)).toContain("Remove Cara? This round won't count.");
  });
});

describe('friendly errors', () => {
  it('an older-version room gets the create-a-new-one message', () => {
    expect(friendly(new Error('Old room'))).toBe('This room is from an older version. Create a new one.');
    expect(friendly(new Error('boom'))).toContain('Something went wrong');
  });
});
