import { describe, it, expect, vi } from 'vitest';
import { screenFor, view, settle, render, friendly } from '../src/ui.js';
import { isRoomCode } from '../src/game.js';

// gm is the host (Gina) and a normal player. d joined after the deal (late joiner).
const NAMES = { gm: 'Gina', a: 'Ann', b: 'Ben', c: 'Cara', d: 'Dev', e: 'Eli', f: 'Fay' };
const players = Object.entries(NAMES).map(([uid, name]) => ({ uid, name }));
const room = (over = {}) => ({
  gmUid: 'gm', gmName: 'Gina', phase: 'lobby', round: 7, roundPlayers: [], starterUid: null, result: null,
  inGame: [], out: [], gone: [], points: {}, names: {}, wordSet: 1, final: false, resultAt: null, ...over,
});
// s.since / s.now feed stalled(); left out, nothing is stalled.
const st = (uid, roomOver, extra = {}, ui = {}, top = {}) => ({
  uid, code: 'ABCD', ui: { fields: {}, ...ui },
  data: { room: room(roomOver), players, myWord: null, myVote: null, waiting: [], ...extra }, ...top,
});
// A round in progress: the host and a, b, c still in, e voted out, f removed earlier and back in the room
// (waits like d, who joined after the deal). Who carries the virus lives only in gm/secret, which no screen state carries.
const { d: _late, ...dealt } = NAMES;
const game = (over = {}) => ({
  names: dealt, inGame: ['a', 'b', 'c', 'gm'], roundPlayers: ['a', 'b', 'c', 'gm'], out: ['e'], gone: ['f'],
  points: { gm: 0, a: 1, b: 2, c: 0, e: 2, f: 0 }, phase: 'voting', starterUid: 'a', ...over,
});
const words = { carrierUid: 'c', carrierName: 'Cara', common: 'Cola', odd: 'Water' };
const caught = { outUid: 'c', outName: 'Cara', wasCarrier: true, voided: false, ...words, gains: { a: 1, b: 1 } };
const healthy = { outUid: 'b', outName: 'Ben', wasCarrier: false, voided: false, ...words, gains: { c: 2 } };
const voided = { outUid: 'b', outName: 'Ben', wasCarrier: false, voided: true, ...words, gains: {} };
// f is back in the game here, so four are still in after Ben went out.
const inResult = (over = {}) => game({ phase: 'result', result: healthy, inGame: ['a', 'c', 'gm', 'f'], out: ['e', 'b'], gone: [], resultAt: 1, ...over });
const has = (html, action) => html.includes(`data-action="${action}"`);
const STALL_VOTE = { since: 0, now: 10000 };
const STALL_LINE = "Waiting for Gina's phone. Ask them to open the game.";
const MOVE = 'The virus is on the move.';

// Game over: the stored ranking, never recomputed (points here would order them differently).
const rank = (uid, points, place, group) => ({ uid, name: NAMES[uid], points, place, group });
const virusWon = game({
  phase: 'gameOver', final: true, inGame: ['a', 'c', 'gm'], out: ['e', 'b'], points: {},
  result: { ...healthy, outUid: 'a', outName: 'Ann', gains: { c: 4 } },
  ranking: [rank('c', 6, 1, 'podium'), rank('a', 3, 2, 'podium'), rank('gm', 1, 3, 'podium'), rank('b', 2, 4, 'out'), rank('e', 2, 4, 'out'), rank('f', 0, 6, 'gone')],
});
const heroesWon = game({
  phase: 'gameOver', final: true, inGame: ['a', 'c', 'gm'], out: ['e', 'b'], points: {},
  result: { ...caught, gains: { a: 1, gm: 1 } },
  ranking: [rank('a', 3, 1, 'podium'), rank('gm', 3, 1, 'podium'), rank('c', 2, 3, 'podium'), rank('e', 2, 4, 'out'), rank('b', 1, 5, 'out'), rank('f', 0, 6, 'gone')],
});
const tooFew = game({
  phase: 'gameOver', final: false, inGame: ['a', 'gm'], out: ['e'], gone: ['f', 'b', 'c'], points: {}, result: voided,
  ranking: [rank('a', 3, 1, 'out'), rank('gm', 2, 2, 'out'), rank('e', 2, 2, 'out'), rank('b', 2, 4, 'gone'), rank('c', 0, 5, 'gone'), rank('f', 0, 5, 'gone')],
});
const section = (html, from, to) => html.slice(html.indexOf(from), to ? html.indexOf(to, html.indexOf(from)) : undefined);
const rowsOf = (html) => [...html.matchAll(/<li>(.*?)<\/li>/gs)].map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

describe('screenFor: one test per row of the screen table', () => {
  it('no room, an unknown room: join', () => {
    expect(screenFor({ uid: 'a', code: null, data: null })).toBe('join');
    const gone = { uid: 'a', code: 'ZZZZ', data: { room: null, players: [] }, ui: { fields: {} } };
    expect(screenFor(gone)).toBe('join');
    expect(view(gone)).toContain('Room not found');
  });
  it('old room: a room with seats only (no inGame) shows the join form with the older-version message, for host and player', () => {
    for (const uid of ['gm', 'a']) {
      const s = st(uid, { phase: 'voting', roundPlayers: ['a', 'b'] });
      delete s.data.room.inGame;
      s.data.room.seats = ['a', 'b'];
      expect(screenFor(s)).toBe('join');
      const html = view(s);
      expect(html).toContain('This room is from an older version. Create a new one.');
      expect(html).not.toContain('code-chip');
    }
  });
  it('lobby, host: the story line, everyone listed, New game, Remove others, hand over, no Leave with others', () => {
    const s = st('gm', {});
    expect(screenFor(s)).toBe('lobby');
    const html = view(s);
    expect(html).toContain('A virus is hiding in one of you. Find it before it moves on.');
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
    const html = view(st('gm', {}, { players: [{ uid: 'gm', name: 'Gina' }] }));
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
  it('lobby, others: the story line, waiting for the host, and Leave', () => {
    const s = st('a', {});
    expect(screenFor(s)).toBe('waiting');
    const html = view(s);
    expect(html).toContain('A virus is hiding in one of you. Find it before it moves on.');
    expect(html).toContain('Waiting for Gina to start the game.');
    expect(html).toContain('Ann <i>(you)</i>');
    expect(has(html, 'leave')).toBe(true);
    expect(has(html, 'newGame')).toBe(false);
  });
  it('gameOver, virus got away: how it ended, the final reveal, the podium three apart, then the others, then did not finish', () => {
    for (const uid of ['a', 'e', 'd']) expect(screenFor(st(uid, virusWon))).toBe('gameOver');
    const html = view(st('e', virusWon));
    expect(html).toContain('The virus got away!');
    expect(html).toMatch(/Ann<\/b> was healthy\./);
    expect(html).toMatch(/The virus was hiding in <b>Cara<\/b>\./);
    expect(html).not.toContain('sent to rest');
    expect(html).not.toContain(MOVE);
    for (const t of ['Cola', 'Water', '+4']) expect(html).toContain(t);
    expect(rowsOf(section(html, 'class="ruled ranking podium"', '</ol>'))).toEqual(['1st Cara 6 points', '2nd Ann 3 points', '3rd Gina 1 point']);
    expect(rowsOf(section(html, 'class="ruled ranking out"', '</ol>'))).toEqual(['4th Ben 2 points', '4th Eli (you) 2 points']);
    const gone = section(html, 'class="ruled ranking gone"', '</ol>');
    expect(rowsOf(gone)).toEqual(['6th Fay 0 points']);
    expect(html.indexOf('Top three')).toBeLessThan(html.indexOf('Voted out'));
    expect(html.indexOf('Voted out')).toBeLessThan(html.indexOf('Did not finish'));
    expect(html).toContain('Waiting for Gina to start a new game.');
    expect(has(html, 'leave')).toBe(true);
    expect(has(html, 'askLeave')).toBe(false);
  });
  it('gameOver, Heroes caught it, level Heroes share 1st', () => {
    const html = view(st('a', heroesWon));
    expect(html).toContain('The Heroes caught the virus!');
    expect(html).toMatch(/Cara<\/b> had the virus! Cara is cured\./);
    expect(html).toContain('<b>+1</b> Ann, Gina');
    expect(rowsOf(section(html, 'class="ruled ranking podium"', '</ol>'))).toEqual(['1st Ann (you) 3 points', '1st Gina 3 points', '3rd Cara 2 points']);
  });
  it('gameOver with no final: "Not enough players left.", everyone by place, nobody called voted out', () => {
    const html = view(st('a', tooFew));
    expect(html).toContain('Not enough players left.');
    for (const t of ['The virus got away', 'The Heroes caught', 'Top three', 'Voted out', 'voted out', 'Cola', MOVE]) expect(html).not.toContain(t);
    expect(rowsOf(section(html, 'class="ruled ranking out"', '</ol>'))).toEqual(['1st Ann (you) 3 points', '2nd Gina 2 points', '2nd Eli 2 points']);
    expect(rowsOf(section(html, 'class="ruled ranking gone"', '</ol>'))).toEqual(['4th Ben 2 points', '5th Cara 0 points', '5th Fay 0 points']);
    expect(html).toContain('Did not finish');
  });
  it('gameOver, host: the ranking above the room code, New game, Remove, hand over, no Leave with others', () => {
    const s = st('gm', virusWon);
    expect(screenFor(s)).toBe('lobby');
    const html = view(s);
    expect(html.indexOf('The virus got away!')).toBeLessThan(html.indexOf('Room code'));
    expect(html.indexOf('Top three')).toBeLessThan(html.indexOf('Room code'));
    expect(has(html, 'newGame')).toBe(true);
    expect(html).toContain('data-action="remove" data-arg="a"');
    expect(html).toContain('data-action="handOver" data-arg="a"');
    expect(has(html, 'leave')).toBe(false);
    expect(html).not.toContain('Keep this screen open');
  });
  it('result, carrier caught: who had it and is cured, both words, the +1s, the move line, the points table', () => {
    const html = view(st('a', inResult({ result: caught, inGame: ['a', 'b', 'gm', 'f'], out: ['e', 'c'] })));
    expect(html).toMatch(/Cara<\/b> had the virus! Cara is cured\./);
    for (const t of ['Cola', 'Water', '<b>+1</b> Ann, Ben', `${MOVE} Next round starts in a moment.`]) expect(html).toContain(t);
    expect(html.indexOf('Cara</b> had the virus')).toBeLessThan(html.indexOf('<h2>Points</h2>'));
  });
  it('result, a healthy Hero voted out: sent to rest, where the virus was hiding, the +2', () => {
    const html = view(st('a', inResult()));
    expect(html).toMatch(/Ben<\/b> was healthy and is sent to rest\./);
    expect(html).toMatch(/The virus was hiding in <b>Cara<\/b>\./);
    for (const t of ['Cola', 'Water', '<b>+2</b> Cara', MOVE]) expect(html).toContain(t);
  });
  it('result, cancelled: who left, it does not count, where the virus was hiding, both words, no points', () => {
    const html = view(st('a', inResult({ result: voided })));
    expect(html).toMatch(/Ben<\/b> left\. This round doesn't count\./);
    expect(html).toMatch(/The virus was hiding in <b>Cara<\/b>\./);
    for (const t of ['Cola', 'Water', 'No points this round.', MOVE]) expect(html).toContain(t);
    expect(html).not.toMatch(/<b>\+\d/);
  });
  it('result: the points table lists everyone dealt in, most points first, with their points', () => {
    const html = view(st('a', inResult({ points: { gm: 0, a: 1, b: 2, c: 2, e: 2, f: 0 } })));
    expect(rowsOf(section(html, 'class="ruled tally"', '</ol>')))
      .toEqual(['Cara 2 points', 'Eli 2 points', 'Ben 2 points', 'Ann (you) 1 point', 'Gina 0 points', 'Fay 0 points']);
  });
  it('result: the next-step line by players left; never a number from another clock', () => {
    for (const uid of ['a', 'e', 'd', 'gm', 'f']) expect(screenFor(st(uid, inResult()))).toBe('result');
    expect(view(st('a', inResult()))).toContain(`${MOVE} Next round starts in a moment.`);
    expect(view(st('a', inResult({ inGame: ['a', 'c', 'gm'] })))).toContain(`${MOVE} The final battle starts in a moment.`);
    const ending = view(st('a', inResult({ inGame: ['a', 'gm'] })));
    expect(ending).toContain('The game ends in a moment.');
    expect(ending).not.toContain(MOVE);
    expect(view(st('a', inResult()))).not.toMatch(/\d+ ?(s|sec|second)\b/);
  });
  it('result: a late joiner is told they are in the next game; a player voted out sees what comes next', () => {
    const late = view(st('d', inResult({ inGame: ['a', 'c', 'gm'] })));
    expect(late).toContain("You're in the next game.");
    expect(late).not.toContain('starts in a moment');
    expect(view(st('e', inResult()))).toContain('Next round starts in a moment.');
  });
  it('result looks the same whether the virus stays or jumps: the page cannot know, and no text says which', () => {
    const at = (next) => { const s = st('a', inResult()); s.data.secret = { carrierUid: next }; return s; };
    const stays = view(at('c'));
    expect(view(at('a'))).toBe(stays);
    expect(stays).toContain(MOVE);
    expect(stays).not.toMatch(/jump|stay/i);
  });
  it('result, stalled after 20 s: the host-phone line, not on the host', () => {
    expect(view(st('a', inResult(), {}, {}, { since: 0, now: 20000 }))).toContain(STALL_LINE);
    expect(view(st('a', inResult(), {}, {}, { since: 0, now: 19999 }))).not.toContain(STALL_LINE);
    expect(view(st('gm', inResult(), {}, {}, { since: 0, now: 20000 }))).not.toContain(STALL_LINE);
  });
  it('in players, not in inGame or out, game running: late joiner (also a removed player back in the room), waiting line, Leave with no question', () => {
    for (const uid of ['d', 'f']) {
      const s = st(uid, game(), { waiting: ['b'] });
      expect(screenFor(s)).toBe('lateJoiner');
      const html = view(s);
      expect(html).toContain("A game is in progress. You're in the next one.");
      expect(html).toContain('Waiting for: Ben');
      expect(has(html, 'leave')).toBe(true);
      expect(has(html, 'askLeave')).toBe(false);
    }
  });
  it('voted out, voting: you are out, the waiting line, the points table, who is out; no word; Leave', () => {
    const s = st('e', game({ out: ['e', 'b'], inGame: ['a', 'c', 'gm'], roundPlayers: ['a', 'c', 'gm'] }), { myWord: 'Cola', waiting: ['c'] });
    expect(screenFor(s)).toBe('out');
    const html = view(s);
    expect(html).toContain('You are out.');
    expect(html).toContain('Watch the Heroes hunt the virus.');
    expect(html).toContain('Waiting for: Cara');
    expect(html).toContain('<h2>Points</h2>');
    expect(rowsOf(section(html, '<h2>Out</h2>', '</ul>'))).toEqual(['Eli', 'Ben']);
    expect(html).not.toContain('Cola');
    expect(html).not.toContain('Your word');
    expect(has(html, 'leave')).toBe(true);
  });
  it('in game, voting, not voted: word, then one list: the speaking order where every other name is a vote button; own points on one line', () => {
    const s = st('b', game(), { myWord: 'Cola' });
    expect(screenFor(s)).toBe('vote');
    const html = view(s);
    expect(html).toContain('Cola');
    expect(html).toContain('Speaking order');
    expect(html.match(/<ol/g).length).toBe(1);
    const list = section(html, '<ol', '</ol>');
    expect([...list.matchAll(/<li>(.*?)<\/li>/g)].map((m) => (m[1].includes('data-action="vote"') ? m[1].match(/data-arg="(\w+)"/)[1] : 'own')))
      .toEqual(['a', 'own', 'c', 'gm']);
    expect(list).toContain('Ben <i>(you)</i>');
    expect(html).toContain('aria-label="Vote for Ann"');
    expect(html.indexOf('tap who you think has the virus')).toBeLessThan(html.indexOf('<ol'));
    expect(html.match(/data-action="vote"/g).length).toBe(3);
    expect(html).not.toContain('data-arg="e"');
    expect(html).toContain('You have <b>2</b> points.');
    expect(html).not.toContain('<h2>Points</h2>');
    expect(html).not.toContain('Final battle');
  });
  it('in game, voting, final: "Final battle" for everyone in it', () => {
    const final = game({ final: true, inGame: ['a', 'b', 'gm'], roundPlayers: ['a', 'b', 'gm'] });
    for (const uid of ['a', 'gm']) expect(view(st(uid, final, { myWord: 'Cola' }))).toContain('Final battle');
    expect(view(st('a', inResult({ final: true })))).not.toContain('Final battle');
  });
  it('in game, voting, voted: Vote sent, who is left to vote in speaking order, above the order', () => {
    const html = view(st('a', game(), { myWord: 'Cola', myVote: 'b', waiting: ['gm', 'c'] }));
    for (const t of ['Cola', 'Speaking order', 'Vote sent', 'Waiting for: Cara, Gina']) expect(html).toContain(t);
    expect(has(html, 'vote')).toBe(false);
    expect(html.indexOf('Vote sent')).toBeLessThan(html.indexOf('<ol'));
  });
  it('voting, everyone voted: "Everyone has voted."; stalled: the host-phone line on every phone but the host', () => {
    const html = view(st('a', game(), { myWord: 'Cola', myVote: 'b', waiting: [] }));
    expect(html).toContain('Everyone has voted.');
    expect(html).not.toContain(STALL_LINE);
    for (const [uid, extra] of [['a', { myVote: 'b' }], ['e', {}], ['d', {}]]) {
      expect(view(st(uid, game(), extra, {}, STALL_VOTE))).toContain(STALL_LINE);
      expect(view(st(uid, game(), extra, {}, { since: 0, now: 9999 }))).not.toContain(STALL_LINE);
      expect(view(st(uid, game(), { ...extra, waiting: ['c'] }, {}, { since: 0, now: 600000 }))).not.toContain(STALL_LINE);
    }
    expect(view(st('gm', game(), { myVote: 'b' }, {}, STALL_VOTE))).not.toContain(STALL_LINE);
  });
  it('the host during a game: the collapsed Remove a player and the keep-open line, on every game screen', () => {
    for (const s of [st('gm', game(), { myWord: 'Cola' }), st('gm', game(), { myVote: 'a' }), st('gm', inResult()),
      st('gm', game({ inGame: ['a', 'b', 'c'], roundPlayers: ['a', 'b', 'c'], out: ['e', 'gm'] }))]) {
      const html = view(s);
      expect(html).toContain('Your phone runs this room. Keep this screen open.');
      expect(html).toContain('<details class="manage" data-open="openRemove"><summary>Remove a player</summary>');
    }
    for (const s of [st('gm', {}), st('gm', virusWon), st('a', game()), st('e', game())]) {
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
  it('host: in the round, voted out, in a result, between games', () => {
    expect(screenFor(st('gm', game(), { myVote: undefined }))).toBe('vote');
    expect(screenFor(st('gm', game({ inGame: ['a', 'b', 'c'], roundPlayers: ['a', 'b', 'c'], out: ['e', 'gm'] })))).toBe('out');
    expect(screenFor(st('gm', inResult()))).toBe('result');
    expect(screenFor(st('gm', {}))).toBe('lobby');
    expect(screenFor(st('gm', virusWon))).toBe('lobby');
  });
  it('player in the round returns to the word and the vote', () => {
    const s = st('b', game(), { myWord: 'Cola', myVote: undefined });
    expect(screenFor(s)).toBe('vote');
    const html = view(s);
    expect(html).toContain('Cola');
    expect(html).toContain('Checking your vote');
    expect(has(html, 'vote')).toBe(false);
  });
  it('voted-out player returns to the points table', () => {
    expect(screenFor(st('e', game()))).toBe('out');
    expect(view(st('e', game()))).toContain('<h2>Points</h2>');
  });
  it('late joiner returns to the wait', () => expect(screenFor(st('d', game()))).toBe('lateJoiner'));
  it('removed player: join; removed and rejoined (in names and gone, not in the game): late joiner', () => {
    const removed = game({ inGame: ['a', 'c', 'gm'], roundPlayers: ['a', 'c', 'gm'], gone: ['f', 'b'] });
    expect(screenFor(st('b', removed, { players: players.filter((p) => p.uid !== 'b') }))).toBe('join');
    expect(screenFor(st('b', removed))).toBe('lateJoiner');
  });
});

describe('secrecy and wording', () => {
  // Host only: the keep-open line and Remove a player. Players only: Leave room (the host hands the room over instead).
  const strip = (html) => html.replace(/<p class="keep">.*?<\/p>/s, '').replace(/<details class="manage".*?<\/details>/s, '')
    .replace(/<button[^>]*data-action="askLeave"[^>]*>Leave room<\/button>/, '');
  // The order is one list: the viewer's own row is the only one that is not a vote button.
  const rows = (html) => html.replace(/<li><button[^>]*data-action="vote"[^>]*>NAME<\/button><\/li>|<li><span>NAME<\/span><\/li>/g, '<li>ROW</li>');
  const names = (html) => html.replace(/ <i>\(you\)<\/i>/g, '').replace(/Gina|Ann|Ben|Cara/g, 'NAME').replace(/data-arg="(gm|a|b|c)"/g, 'data-arg="X"');
  const mask = (html) => rows(names(strip(html)));
  // Everyone in the round on 0, so the own-points line is the same for all.
  const level = { points: { gm: 0, a: 0, b: 0, c: 0, e: 2, f: 0 } };
  it("the carrier's voting view equals a Hero's apart from the word, every state of the vote", () => {
    for (const extra of [{}, { myVote: 'b', waiting: ['b', 'c'] }, { myVote: 'a', waiting: [] }, { myVote: undefined }]) {
      for (const r of [game(), game({ final: true, inGame: ['a', 'c', 'gm'], roundPlayers: ['a', 'c', 'gm'] })]) {
        const carrier = view(st('c', r, { ...extra, myWord: 'Water' })).replace('Water', 'W');
        expect(view(st('c', r, { ...extra, myWord: 'Cola' })).replace('Cola', 'W')).toBe(carrier);
      }
    }
  });
  it("the host's voting view equals a player's once host-only controls and (you) are masked, normal round and final", () => {
    for (const r of [game(level), game({ ...level, final: true, inGame: ['a', 'c', 'gm'], roundPlayers: ['a', 'c', 'gm'] })]) {
      for (const extra of [{ myWord: 'Cola' }, { myWord: 'Water' }, { myWord: 'Cola', myVote: 'b', waiting: ['b'] }]) {
        const host = view(st('gm', r, extra));
        expect(host.match(/data-action="vote"/g)?.length).toBe(view(st('a', r, extra)).match(/data-action="vote"/g)?.length);
        expect(mask(host)).toBe(mask(view(st('a', r, extra))));
      }
    }
  });
  it('no voting view shows the other word or anything about the carrier, for anyone', () => {
    const r = game();
    const states = [
      st('gm', r, { myWord: 'Water' }), st('gm', r, { myWord: 'Cola', myVote: 'a', waiting: ['b'] }), st('gm', r, { myWord: 'Cola' }, { confirmRemove: 'c' }),
      st('a', r, { myWord: 'Cola' }, {}, STALL_VOTE), st('e', r), st('d', r), st('f', r),
      st('gm', game({ inGame: ['a', 'b', 'c'], roundPlayers: ['a', 'b', 'c'], out: ['e', 'gm'] })),
    ];
    for (const s of states) {
      const html = view(s);
      expect(html).not.toContain(s.data.myWord === 'Water' ? 'Cola' : 'Water');
      expect(html).not.toMatch(/carrier|had the virus|virus was hiding|cured|sent to rest/i);
    }
  });
  it('nothing in view reads a secret, the used pairs or a vote count, even if the state carried them', () => {
    const trap = (s) => {
      for (const k of ['secret', 'used', 'votesCast']) Object.defineProperty(s.data, k, { get() { throw new Error(`read ${k}`); } });
      return s;
    };
    for (const s of [st('gm', game(), { myWord: 'Cola' }), st('gm', inResult()), st('gm', {}), st('gm', virusWon), st('a', game(), { myWord: 'Cola' }), st('e', game())]) {
      expect(() => view(trap(s))).not.toThrow();
    }
  });
  it('no screen says spy, bench or team, or shows a team score; the game name stays', () => {
    const all = [st('a', {}), st('gm', {}), st('a', game(), { myWord: 'Cola' }), st('gm', game(), { myWord: 'Cola' }), st('e', game()), st('d', game()),
      st('a', inResult()), st('a', inResult({ result: caught })), st('a', inResult({ result: voided })),
      st('a', virusWon), st('gm', heroesWon), st('a', tooFew), st('gm', game(), {}, { confirmRemove: 'c', confirmClose: true }),
      st('a', game(), {}, { confirmLeave: true }), { uid: 'a', code: null, data: null, ui: { fields: {} } }];
    for (const s of all) {
      const html = view(s);
      expect(html).toContain('<span class="title">Heroes vs Spies</span>');
      const page = html.slice(html.indexOf('<main'));
      expect(page).not.toMatch(/spy|spies|bench|team/i);
      expect(page).not.toMatch(/Heroes\s*<b>\d|killed|eliminat/i);
    }
  });
});

describe('leave', () => {
  it('a player still in the game is asked first, with the warning, during a vote and a result', () => {
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
  it('directly between games, when voted out, for a late joiner, and at game over', () => {
    for (const s of [st('a', {}), st('e', game()), st('e', inResult()), st('d', game()), st('d', inResult()), st('a', virusWon), st('a', tooFew)]) {
      expect(has(view(s), 'leave')).toBe(true);
    }
  });
  it('never to a host with others present, in any phase', () => {
    for (const s of [st('gm', {}), st('gm', game(), { myWord: 'Cola' }), st('gm', game({ inGame: ['a', 'b', 'c'], roundPlayers: ['a', 'b', 'c'], out: ['e', 'gm'] })),
      st('gm', inResult()), st('gm', virusWon), st('gm', tooFew)]) {
      const html = view(s);
      expect(has(html, 'leave')).toBe(false);
      expect(has(html, 'askLeave')).toBe(false);
    }
  });
  it('no screen has more than one Leave control', () => {
    for (const s of [st('a', {}), st('a', game(), { myWord: 'Cola' }), st('a', game(), {}, { confirmLeave: true }), st('e', game()), st('d', game()),
      st('a', inResult()), st('a', virusWon), st('gm', {}, { players: [{ uid: 'gm', name: 'Gina' }] })]) {
      expect((view(s).match(/data-action="(leave|askLeave)"/g) || []).length).toBeLessThanOrEqual(1);
    }
  });
});

describe('remove and close the vote (host only)', () => {
  it('a player still in the round, mid-vote, asks first and keeps the section open', () => {
    const html = view(st('gm', game(), {}, { confirmRemove: 'c' }));
    expect(html).toContain('<details class="manage" data-open="openRemove" open>');
    expect(html).toContain("Remove Cara? This round won't count.");
  });
  it('a voted-out player or a late joiner is removed without the round warning', () => {
    expect(view(st('gm', game(), {}, { confirmRemove: 'e' }))).not.toContain("This round won't count");
    expect(view(st('gm', game(), {}, { confirmRemove: 'd' }))).not.toContain("This round won't count");
  });
  it('the host is never in a remove list', () => {
    for (const s of [st('gm', {}), st('gm', game()), st('gm', inResult()), st('gm', virusWon)]) expect(view(s)).not.toContain('data-action="remove" data-arg="gm"');
  });
  it('a player who left mid-round (no record, still in the game) still has a Remove row with their name', () => {
    const html = view(st('gm', game(), { players: players.filter((p) => p.uid !== 'b') }));
    expect(html).toContain('aria-label="Remove Ben"');
    expect(html).toContain('data-action="remove" data-arg="b"');
    expect(html.match(/data-action="remove" data-arg="c"/g)).toHaveLength(1);
  });
  it('"Close the vote now" for the host in a normal vote and in the final (in the game or out), asked first; nowhere else', () => {
    const final = game({ final: true, inGame: ['a', 'b', 'gm'], roundPlayers: ['a', 'b', 'gm'] });
    const outHost = game({ inGame: ['a', 'b', 'c'], roundPlayers: ['a', 'b', 'c'], out: ['e', 'gm'] });
    for (const r of [game(), final, outHost]) {
      const html = view(st('gm', r, { myWord: 'Cola' }));
      expect(html).toContain('Close the vote now');
      expect(has(html, 'closeVote')).toBe(true);
      const asked = view(st('gm', r, {}, { confirmClose: true }));
      expect(asked).toContain('Close the vote now? Counts the votes cast so far.');
      expect(asked).toContain('<details class="manage" data-open="openRemove" open>');
      expect(has(asked, 'cancelClose')).toBe(true);
    }
    for (const s of [st('gm', inResult()), st('gm', {}), st('gm', virusWon), st('a', game()), st('a', final), st('e', game())]) expect(has(view(s), 'closeVote')).toBe(false);
  });
});

describe('view', () => {
  it("shows the host's background error to the host only", () => {
    expect(view(st('gm', game(), {}, { runError: 'Fix the date and try again.' }))).toContain('<b>Problem:</b> Fix the date and try again.');
    expect(view(st('a', game(), {}, { runError: 'x' }))).not.toContain('Problem:');
  });
  it('escapes player names and words', () => {
    const s = st('gm', {}, { players: [{ uid: 'gm', name: 'Gina' }, { uid: 'x', name: '<img src=x onerror=alert(1)>' }] });
    expect(view(s)).not.toContain('<img');
    expect(view(st('e', game({ names: { ...dealt, a: '<img src=x>' } })))).not.toContain('<img');
    expect(view(st('a', inResult({ result: { ...healthy, outName: '<img>', carrierName: '<img>', common: '<img>' } })))).not.toContain('<img');
    expect(view(st('a', { ...virusWon, ranking: [rank('a', 1, 1, 'out')].map((e) => ({ ...e, name: '<img>' })) }))).not.toContain('<img');
  });
  it('never shows the stored round number', () => {
    for (const s of [st('gm', game()), st('a', game(), { myWord: 'Cola' }), st('e', game()), st('a', inResult())]) expect(view(s)).not.toMatch(/Round 7|>7</);
  });
  it('waiting line shows during a vote on every screen, in speaking order', () => {
    const extra = { waiting: ['gm', 'b'] };
    for (const s of [st('a', game(), { ...extra, myWord: 'Cola' }), st('gm', game(), { ...extra, myWord: 'Cola' }), st('e', game(), extra), st('d', game(), extra)]) {
      expect(view(s)).toContain('Waiting for: Ben, Gina');
    }
    const unvoted = view(st('a', game(), { ...extra, myWord: 'Cola' }));
    expect(unvoted.indexOf('Waiting for: Ben, Gina')).toBeLessThan(unvoted.indexOf('<ol'));
    for (const s of [st('e', game()), st('d', game()), st('a', game(), { myWord: 'Cola' })]) expect(view(s)).toContain('Everyone has voted.');
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
  it('resets confirmRemove, confirmLeave and confirmClose when the round changes', () => {
    const a = st('gm', game({ round: 1 }), {}, { confirmRemove: 'b', confirmLeave: true, confirmClose: true });
    expect(settle(a, st('gm', game({ round: 2 }), {}, a.ui))).toMatchObject({ confirmRemove: null, confirmLeave: false, confirmClose: false });
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

describe('open sections kept', () => {
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

describe('friendly errors', () => {
  it('maps the room errors to plain messages', () => {
    expect(friendly(new Error('Old room'))).toBe('This room is from an older version. Create a new one.');
    expect(friendly(new Error('Bad clock'))).toBe("Your phone's date looks wrong. Fix it and try again.");
    expect(friendly(new Error('Not in this round'))).toBe("You're not in this round any more.");
    expect(friendly(new Error('Hand the room over first'))).toBe('Hand the room to someone before you leave.');
    expect(friendly(new Error('boom'))).toContain('Something went wrong');
  });
});
