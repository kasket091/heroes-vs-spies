import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp } from 'firebase/app';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { starterChoices } from '../src/game.js';
import { initFirebase, signIn } from '../src/firebase.js';
import {
  leaveRoom, createRoom, joinRoom, subscribe, dealWords, nextRound, pickStarter, openVoting,
  castVote, closeVoting, removePlayer, handOverGm, deleteRoom,
} from '../src/room.js';

const config = { apiKey: 'fake', projectId: 'demo-spy' };
const names = ['gm', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
const u = {};

beforeAll(async () => {
  for (const n of names) {
    const { auth, db } = initFirebase(config, { emulator: true, name: n });
    u[n] = { auth, db, uid: await signIn(auth) };
  }
});
afterAll(() => Promise.all(names.map((n) => deleteApp(u[n].auth.app))));

// Resolves with the first state of `who`'s subscription that satisfies `pred`.
const state = (who, code, pred = (s) => s.room && s.players) =>
  new Promise((resolve, reject) => {
    let off = () => {};
    const timer = setTimeout(() => { off(); reject(new Error('state timeout')); }, 5000);
    off = subscribe(u[who].db, code, u[who].uid, (s) => {
      if (pred(s)) { clearTimeout(timer); off(); resolve(s); }
    });
  });

async function lobby(n = 4) {
  const code = await createRoom(u.gm.db, u.gm.uid, 'Gina');
  for (let i = 1; i <= n; i++) await joinRoom(u[`p${i}`].db, code, u[`p${i}`].uid, `Player${i}`);
  return code;
}
const idOf = (uid) => names.find((n) => u[n].uid === uid);
const rawRoom = async (code, who = 'p1') => (await getDoc(doc(u[who].db, 'rooms', code))).data();
const clues = (code) => state('gm', code, (s) => s.room?.phase === 'clues' && s.secret);
const deal = async (code, ...rest) => {
  await dealWords(u.gm.db, code, 'cat', 'dog', ...rest);
  return clues(code);
};
const firstStarter = (room, spyUid) => starterChoices(room.roundPlayers, spyUid, room.setStart)[0];
// From clues: pick a starter, open voting, everyone but outUid votes for outUid, close. Returns the secret.
const playRound = async (code, outUid, votersOnly) => {
  const { secret, room } = await clues(code);
  await pickStarter(u.gm.db, code, firstStarter(room, secret.spyUid));
  await openVoting(u.gm.db, code);
  for (const id of room.active.filter((x) => !votersOnly || votersOnly.includes(x))) {
    await castVote(u[idOf(id)].db, code, id, id === outUid ? room.active.find((x) => x !== id) : outUid);
  }
  await closeVoting(u.gm.db, code);
  return secret;
};
const afterClose = (code, round) => state('gm', code, (s) => s.room?.round === round && ['result', 'gameOver'].includes(s.room.phase));
const hero = (room, secret) => room.active.find((x) => x !== secret.spyUid);
const ROOM_KEYS = ['gmUid', 'gmName', 'round', 'roundPlayers', 'starterUid', 'result', 'phase', 'active', 'names', 'heroBench', 'spyBench', 'score', 'wordSet', 'needsWords', 'final', 'winner', 'setStart', 'expiresAt'];
// What a player can read on the room doc must not name the spy or either word.
const expectNoSecrets = async (code) => {
  const room = await rawRoom(code);
  expect(Object.keys(room).filter((k) => !ROOM_KEYS.includes(k))).toEqual([]);
  expect(JSON.stringify(room)).not.toMatch(/cat|dog/);
  expect(room.result ? [room.result.spyUid, room.result.spyName, room.result.common, room.result.spy] : [null, null, null, null]).toEqual([null, null, null, null]);
  return room;
};


describe('room data layer', () => {
  it('createRoom then joinRoom x4 lists 4 names in join order', async () => {
    const code = await lobby(4);
    const s = await state('p1', code, (x) => x.players?.length === 4);
    expect(s.players.map((p) => p.name)).toEqual(['Player1', 'Player2', 'Player3', 'Player4']);
    expect(s.room).toMatchObject({ phase: 'lobby', active: [], score: { heroes: 0, spies: 0 }, wordSet: 0, needsWords: false });
  });

  it('joinRoom rejects unknown code', async () => {
    await expect(joinRoom(u.p1.db, 'ZZZZ', u.p1.uid, 'A')).rejects.toThrow('Room not found');
  });

  it('joinRoom refuses a room from the older version before writing anything', async () => {
    const code = 'QQQQ';
    await setDoc(doc(u.gm.db, 'rooms', code), { gmUid: u.gm.uid, gmName: 'Gina', phase: 'lobby', round: 0, roundPlayers: [], starterUid: null, result: null });
    await expect(joinRoom(u.p1.db, code, u.p1.uid, 'Ann')).rejects.toThrow('Old room');
    expect((await getDoc(doc(u.p1.db, 'rooms', code, 'players', u.p1.uid))).exists()).toBe(false);
  });

  it('joinRoom refuses a name from the running game for a different uid; the same uid may rejoin with it', async () => {
    const code = await lobby(4);
    const { room } = await deal(code);
    await removePlayer(u.gm.db, code, u.p1.uid);
    await state('gm', code, (s) => s.room?.phase === 'result');
    expect(room.names[u.p1.uid]).toBe('Player1');
    await expect(joinRoom(u.p5.db, code, u.p5.uid, 'player1')).rejects.toThrow('Name already taken');
    await joinRoom(u.p1.db, code, u.p1.uid, 'Player1');
  });

  it("joinRoom with '   ' rejects with Name needed", async () => {
    const code = await lobby(0);
    await expect(joinRoom(u.p1.db, code, u.p1.uid, '   ')).rejects.toThrow('Name needed');
  });

  it('dealWords with 3 players rejects Not enough players', async () => {
    const code = await lobby(3);
    await expect(dealWords(u.gm.db, code, 'cat', 'dog')).rejects.toThrow('Not enough players');
  });

  it('dealWords rejects a bad pair and a running round', async () => {
    const code = await lobby(4);
    await expect(dealWords(u.gm.db, code, 'cat', ' CAT ')).rejects.toThrow('Invalid word pair');
    await deal(code);
    await expect(dealWords(u.gm.db, code, 'sun', 'moon')).rejects.toThrow('Round already running');
  });

  it('dealWords with 6: clues, 6 active, 0-0, exactly one word differs, players cannot see the secret', async () => {
    const code = await lobby(6);
    const { room } = await deal(code);
    expect(room).toMatchObject({ phase: 'clues', score: { heroes: 0, spies: 0 }, round: 1, wordSet: 1, final: false, needsWords: false, starterUid: null });
    expect(room.active).toHaveLength(6);
    expect(room.roundPlayers).toEqual(room.active);
    const words = [];
    for (let i = 1; i <= 6; i++) words.push((await state(`p${i}`, code, (s) => s.myWord)).myWord);
    expect([1, 5]).toContain(words.filter((w) => w === words[0]).length);
    expect(new Set(words)).toEqual(new Set(['cat', 'dog']));
    expect((await state('p1', code, (s) => s.myWord)).secret).toBeNull();
  });

  it('vote out a hero: result, score 0-1, bench, nothing about the spy or words', async () => {
    const code = await lobby(6);
    const { secret, room: dealt } = await deal(code);
    const out = hero(dealt, secret);
    await playRound(code, out);
    const { room } = await afterClose(code, 1);
    expect(room.phase).toBe('result');
    expect(room.result).toMatchObject({ outUid: out, wasSpy: false, team: 'spies', points: 1 });
    expect(room.score).toEqual({ heroes: 0, spies: 1 });
    expect(room.heroBench).toEqual([out]);
    expect(room.active).not.toContain(out);
    expect(room.needsWords).toBe(false);
    expect(room.result).toMatchObject({ spyUid: null, spyName: null, common: null, spy: null });
    await expectNoSecrets(code);
  });

  it('nextRound after a hero is out: same wordSet and words, round +1, no secrets', async () => {
    const code = await lobby(6);
    const { secret, room: dealt } = await deal(code);
    const before = {};
    for (const id of dealt.active) before[id] = (await state(idOf(id), code, (s) => s.myWord)).myWord;
    await playRound(code, hero(dealt, secret));
    await afterClose(code, 1);
    await nextRound(u.gm.db, code);
    const { room } = await state('gm', code, (s) => s.room?.phase === 'clues' && s.room.round === 2);
    expect(room).toMatchObject({ wordSet: 1, starterUid: null, result: null, final: false });
    expect(room.roundPlayers).toEqual(room.active);
    for (const id of room.active) expect((await state(idOf(id), code, (s) => s.myWord)).myWord).toBe(before[id]);
    await expectNoSecrets(code);
  });

  it('vote out the spy: wasSpy with both words and name, heroes +1, spy bench, needsWords', async () => {
    const code = await lobby(6);
    const { secret } = await deal(code);
    await playRound(code, secret.spyUid);
    const { room } = await afterClose(code, 1);
    expect(room.result).toMatchObject({ outUid: secret.spyUid, wasSpy: true, team: 'heroes', points: 1, spyUid: secret.spyUid, spyName: `Player${idOf(secret.spyUid).slice(1)}`, common: secret.common, spy: secret.spy });
    expect(room.score).toEqual({ heroes: 1, spies: 0 });
    expect(room.spyBench).toEqual([secret.spyUid]);
    expect(room.needsWords).toBe(true);
  });

  it('nextRound while needsWords writes nothing', async () => {
    const code = await lobby(6);
    const { secret } = await deal(code);
    await playRound(code, secret.spyUid);
    const before = (await afterClose(code, 1)).room;
    await nextRound(u.gm.db, code);
    expect((await state('gm', code)).room).toEqual(before);
  });

  it('dealWords after the spy is caught: new wordSet, benched player has no word, new spy is active', async () => {
    const code = await lobby(6);
    const { secret } = await deal(code);
    await playRound(code, secret.spyUid);
    await afterClose(code, 1);
    await dealWords(u.gm.db, code, 'sun', 'moon');
    const g = await state('gm', code, (s) => s.room?.phase === 'clues' && s.secret);
    expect(g.room).toMatchObject({ wordSet: 2, round: 2, needsWords: false, result: null });
    expect(g.room.active).toHaveLength(5);
    expect(g.room.active).toContain(g.secret.spyUid);
    expect(g.secret.spyUid).not.toBe(secret.spyUid);
    const benched = await state(idOf(secret.spyUid), code, (s) => s.room?.wordSet === 2);
    expect(benched.myWord).toBeNull();
  });

  it('tie: with rand fixed the drawn tied player is out and the result has no tie field', async () => {
    const code = await lobby(4);
    const { secret, room } = await deal(code);
    await pickStarter(u.gm.db, code, firstStarter(room, secret.spyUid));
    await openVoting(u.gm.db, code);
    const [a, b, c, d] = room.active;
    await castVote(u[idOf(a)].db, code, a, b);
    await castVote(u[idOf(b)].db, code, b, a);
    await castVote(u[idOf(c)].db, code, c, a);
    await castVote(u[idOf(d)].db, code, d, b);
    await closeVoting(u.gm.db, code, () => 0.99);
    const { room: after } = await afterClose(code, 1);
    expect(after.result.outUid).toBe(b); // a and b tied; 0.99 draws the later one in roundPlayers order
    expect('tie' in after.result).toBe(false);
  });

  it('close with no votes: someone from active is out, phase result', async () => {
    const code = await lobby(4);
    const { room } = await deal(code);
    await pickStarter(u.gm.db, code, room.active[0]);
    await openVoting(u.gm.db, code);
    await closeVoting(u.gm.db, code);
    const { room: after } = await afterClose(code, 1);
    expect(room.active).toContain(after.result.outUid);
    expect(after.phase).toBe('result');
    expect(after.active).toHaveLength(3);
  });

  it('closeVoting twice: one result, score moved once', async () => {
    const code = await lobby(6);
    const { secret, room } = await deal(code);
    await playRound(code, hero(room, secret));
    const first = (await afterClose(code, 1)).room;
    await Promise.all([closeVoting(u.gm.db, code), closeVoting(u.gm.db, code)]);
    const second = (await state('gm', code)).room;
    expect(second.result).toEqual(first.result);
    expect(second.score).toEqual({ heroes: 0, spies: 1 });
  });

  it('nextRound twice: round moved once', async () => {
    const code = await lobby(6);
    const { secret, room } = await deal(code);
    await playRound(code, hero(room, secret));
    await afterClose(code, 1);
    await Promise.all([nextRound(u.gm.db, code), nextRound(u.gm.db, code)]);
    await nextRound(u.gm.db, code);
    expect((await state('gm', code)).room.round).toBe(2);
  });

  it('a benched player cannot vote; an active player can in the same round', async () => {
    const code = await lobby(6);
    const { secret, room } = await deal(code);
    const out = hero(room, secret);
    await playRound(code, out);
    await afterClose(code, 1);
    await nextRound(u.gm.db, code);
    const { secret: s2, room: r2 } = await clues(code);
    await pickStarter(u.gm.db, code, firstStarter(r2, s2.spyUid));
    await openVoting(u.gm.db, code);
    const target = r2.active.find((x) => x !== r2.active[0]);
    await expect(castVote(u[idOf(out)].db, code, out, target)).rejects.toThrow();
    await castVote(u[idOf(r2.active[0])].db, code, r2.active[0], target);
    expect((await state('gm', code, (s) => s.votesCast === 1)).votesCast).toBe(1);
  });

  it('full game from 6: three rounds to 3 active, final, game over, nobody newly benched', async () => {
    const code = await lobby(6);
    let { secret, room } = await deal(code);
    for (let r = 1; r <= 3; r++) {
      await playRound(code, hero(room, secret));
      await afterClose(code, r);
      await nextRound(u.gm.db, code);
      ({ secret, room } = await state('gm', code, (s) => s.room?.round === r + 1 && s.room.phase === 'clues' && s.secret));
    }
    expect(room.active).toHaveLength(3);
    expect(room.final).toBe(true);
    expect(room.score).toEqual({ heroes: 0, spies: 3 });
    const benchedBefore = room.heroBench.length;
    await playRound(code, hero(room, secret));
    const { room: end } = await afterClose(code, 4);
    expect(end.phase).toBe('gameOver');
    expect(end.score).toEqual({ heroes: 0, spies: 7 }); // 3 + (3 gap + 1)
    expect(end.winner).toBe('spies');
    expect(end.heroBench).toHaveLength(benchedBefore);
    expect(end.active).toHaveLength(3);
    expect(end.result).toMatchObject({ spyUid: secret.spyUid, common: secret.common, spy: secret.spy });
  });

  it('final at 1-4 won by heroes: 5-4, winner heroes', async () => {
    const code = await lobby(4);
    const { secret } = await deal(code);
    await setDoc(doc(u.gm.db, 'rooms', code), { score: { heroes: 1, spies: 4 }, final: true }, { merge: true });
    await playRound(code, secret.spyUid);
    const { room } = await afterClose(code, 1);
    expect(room).toMatchObject({ phase: 'gameOver', score: { heroes: 5, spies: 4 }, winner: 'heroes' });
  });

  it('4-player game: any starter accepted incl. the spy, then final at 3', async () => {
    const code = await lobby(4);
    const { secret } = await deal(code);
    await pickStarter(u.gm.db, code, secret.spyUid);
    await openVoting(u.gm.db, code);
    const { room: r1 } = await state('gm', code);
    await castVote(u[idOf(r1.active[0] === secret.spyUid ? r1.active[1] : r1.active[0])].db, code, r1.active[0] === secret.spyUid ? r1.active[1] : r1.active[0], secret.spyUid);
    await closeVoting(u.gm.db, code, () => 0.99);
    const mid = (await afterClose(code, 1)).room;
    expect(mid.active).toHaveLength(3);
    await (mid.needsWords ? dealWords(u.gm.db, code, 'sun', 'moon') : nextRound(u.gm.db, code));
    expect((await state('gm', code, (s) => s.room?.phase === 'clues' && s.room.round === 2)).room.final).toBe(true);
  });

  it('pickStarter with 5 active: the spy as starter rejects Not a safe starter', async () => {
    const code = await lobby(5);
    const { secret } = await deal(code);
    await expect(pickStarter(u.gm.db, code, secret.spyUid)).rejects.toThrow('Not a safe starter');
  });

  it('starter rule only in the first round of a word set: later rounds accept the spy, a new deal applies it again', async () => {
    const code = await lobby(6);
    const { secret, room } = await deal(code);
    expect(room.setStart).toBe(true);
    await playRound(code, hero(room, secret));
    await afterClose(code, room.round);
    await nextRound(u.gm.db, code);
    const { room: r2 } = await state('gm', code, (s) => s.room?.phase === 'clues' && s.room.round === room.round + 1);
    expect(r2.active).toHaveLength(5);
    expect(r2.setStart).toBe(false);
    await pickStarter(u.gm.db, code, secret.spyUid);
    expect((await rawRoom(code)).starterUid).toBe(secret.spyUid);
    // Catch the spy, deal again: the flag is back on for the new word set.
    await openVoting(u.gm.db, code);
    for (const id of r2.active) await castVote(u[idOf(id)].db, code, id, id === secret.spyUid ? r2.active.find((x) => x !== id) : secret.spyUid);
    await closeVoting(u.gm.db, code);
    await afterClose(code, r2.round);
    await dealWords(u.gm.db, code, 'sun', 'moon');
    const { room: r3 } = await state('gm', code, (s) => s.room?.phase === 'clues' && s.room.wordSet === room.wordSet + 1);
    expect(r3.setStart).toBe(true);
  });

  it('pickStarter in lobby rejects with No round to start', async () => {
    const code = await lobby(4);
    await expect(pickStarter(u.gm.db, code, u.p1.uid)).rejects.toThrow('No round to start');
  });

  it('gm never sees a secret from another word set', async () => {
    const code = await lobby(5);
    const { secret } = await deal(code);
    await playRound(code, secret.spyUid);
    await afterClose(code, 1);
    const seen = [];
    const off = subscribe(u.gm.db, code, u.gm.uid, (s) => seen.push(s));
    await dealWords(u.gm.db, code, 'sun', 'moon');
    await state('gm', code, (s) => s.secret?.wordSet === 2);
    off();
    expect(seen.filter((s) => s.secret).every((s) => s.secret.wordSet === s.room.wordSet)).toBe(true);
  });

  it('remove an active hero during clues: voided, no score or bench change, no secrets', async () => {
    const code = await lobby(5);
    const { secret, room } = await deal(code);
    const out = hero(room, secret);
    await removePlayer(u.gm.db, code, out);
    const { room: after } = await state('gm', code, (s) => s.room?.phase === 'result');
    expect(after.result).toMatchObject({ voided: true, outUid: out, outName: `Player${idOf(out).slice(1)}`, wasSpy: false });
    expect(after).toMatchObject({ score: { heroes: 0, spies: 0 }, heroBench: [], spyBench: [], needsWords: false });
    expect(after.active).not.toContain(out);
    await expectNoSecrets(code);
  });

  it('remove the active spy during voting: voided with words and spy name, needsWords', async () => {
    const code = await lobby(5);
    const { secret, room } = await deal(code);
    await pickStarter(u.gm.db, code, firstStarter(room, secret.spyUid));
    await openVoting(u.gm.db, code);
    await removePlayer(u.gm.db, code, secret.spyUid);
    const { room: after } = await state('gm', code, (s) => s.room?.phase === 'result');
    const name = `Player${idOf(secret.spyUid).slice(1)}`;
    expect(after.result).toMatchObject({ voided: true, outUid: secret.spyUid, outName: name, spyUid: secret.spyUid, spyName: name, common: secret.common, spy: secret.spy });
    expect(after.needsWords).toBe(true);
    expect(after.spyBench).toEqual([]);
  });

  it("remove an active player in 'result': active shrinks, score and result unchanged, no secrets", async () => {
    const code = await lobby(6);
    const { secret, room } = await deal(code);
    await playRound(code, hero(room, secret));
    const before = (await afterClose(code, 1)).room;
    const gone = before.active.find((x) => x !== secret.spyUid);
    await removePlayer(u.gm.db, code, gone);
    const { room: after } = await state('gm', code, (s) => !s.room?.active.includes(gone));
    expect(after.active).toEqual(before.active.filter((x) => x !== gone));
    expect(after.score).toEqual(before.score);
    expect(after.result).toEqual(before.result);
    expect(after.needsWords).toBe(false);
    await expectNoSecrets(code);
  });

  it("remove the spy in 'result' sets needsWords", async () => {
    const code = await lobby(6);
    const { secret, room } = await deal(code);
    await playRound(code, hero(room, secret));
    await afterClose(code, 1);
    await removePlayer(u.gm.db, code, secret.spyUid);
    expect((await state('gm', code, (s) => s.room?.needsWords)).room.needsWords).toBe(true);
  });

  it('removal below 3: nextRound gives gameOver, level score is a draw', async () => {
    const code = await lobby(4);
    const { room } = await deal(code);
    await removePlayer(u.gm.db, code, room.active[0]);
    await removePlayer(u.gm.db, code, room.active[1]);
    await state('gm', code, (s) => s.room?.active.length === 2);
    await nextRound(u.gm.db, code);
    const { room: end } = await state('gm', code, (s) => s.room?.phase === 'gameOver');
    expect(end).toMatchObject({ winner: 'draw', score: { heroes: 0, spies: 0 } });
  });

  it('removal below 3 with needsWords: dealWords gives gameOver and deals nothing', async () => {
    const code = await lobby(4);
    const { secret, room } = await deal(code);
    await removePlayer(u.gm.db, code, secret.spyUid);
    await removePlayer(u.gm.db, code, hero(room, secret));
    await state('gm', code, (s) => s.room?.active.length === 2);
    await dealWords(u.gm.db, code, 'sun', 'moon');
    const { room: end } = await state('gm', code, (s) => s.room?.phase === 'gameOver');
    expect(end).toMatchObject({ winner: 'draw', wordSet: 1 });
  });

  it('endGame mid-game keeps the secrets out; at game over it shows them', async () => {
    const code = await lobby(4);
    const { secret, room } = await deal(code);
    await playRound(code, hero(room, secret));
    const mid = (await afterClose(code, 1)).room; // 3 left, spy still hidden
    await expectNoSecrets(code);
    expect(mid.phase).toBe('result');
    await removePlayer(u.gm.db, code, hero(mid, secret));
    await state('gm', code, (s) => s.room?.active.length === 2);
    await expectNoSecrets(code);
    await nextRound(u.gm.db, code);
    const { room: end } = await state('gm', code, (s) => s.room?.phase === 'gameOver');
    expect(end.result).toMatchObject({ spyUid: secret.spyUid, common: secret.common, spy: secret.spy });
    expect(end.winner).toBe('spies');
  });

  it('openVoting and pickStarter after the round was voided write nothing', async () => {
    const code = await lobby(5);
    const { secret, room } = await deal(code);
    await pickStarter(u.gm.db, code, firstStarter(room, secret.spyUid));
    await removePlayer(u.gm.db, code, hero(room, secret));
    const { room: voided } = await state('gm', code, (s) => s.room?.phase === 'result');
    await expect(openVoting(u.gm.db, code)).rejects.toThrow('Cannot open voting yet');
    await expect(pickStarter(u.gm.db, code, voided.active[0])).rejects.toThrow('No round to start');
    expect((await state('gm', code)).room).toEqual(voided);
  });

  it('endGame keeps what the last result made public: spy removed in the final, then game over', async () => {
    const code = await lobby(4);
    const { secret, room } = await deal(code);
    await setDoc(doc(u.gm.db, 'rooms', code), { final: true }, { merge: true });
    await removePlayer(u.gm.db, code, secret.spyUid);
    await removePlayer(u.gm.db, code, hero(room, secret));
    await state('gm', code, (s) => s.room?.active.length === 2);
    await nextRound(u.gm.db, code);
    const { room: end } = await state('gm', code, (s) => s.room?.phase === 'gameOver');
    expect(end.result).toMatchObject({ spyUid: secret.spyUid, spyName: `Player${idOf(secret.spyUid).slice(1)}`, common: secret.common, spy: secret.spy });
  });

  it('endGame after the spy left between rounds: spy and words stay null, the last out player is kept', async () => {
    const code = await lobby(4);
    const { secret, room } = await deal(code);
    const out = hero(room, secret);
    await playRound(code, out);
    await afterClose(code, 1);
    await removePlayer(u.gm.db, code, secret.spyUid);
    await state('gm', code, (s) => s.room?.active.length === 2);
    await nextRound(u.gm.db, code);
    const { room: end } = await state('gm', code, (s) => s.room?.phase === 'gameOver');
    expect(end.result).toMatchObject({ outUid: out, spyUid: null, common: null, spy: null });
  });

  it('late joiner mid-game: in players, not in active, myWord null; dealt in by the next new game', async () => {
    const code = await lobby(4);
    const { secret } = await deal(code);
    await joinRoom(u.p5.db, code, u.p5.uid, 'Late');
    const s = await state('p5', code, (x) => x.players?.length === 5);
    expect(s.room.active).not.toContain(u.p5.uid);
    expect(s.myWord).toBeNull();
    await setDoc(doc(u.gm.db, 'rooms', code), { final: true }, { merge: true });
    await playRound(code, secret.spyUid);
    await afterClose(code, 1);
    await dealWords(u.gm.db, code, 'sun', 'moon');
    const { room } = await state('gm', code, (x) => x.room?.phase === 'clues' && x.room.wordSet === 2);
    expect(room.active).toContain(u.p5.uid);
  });

  it('re-entry: an active player gets the same word and seat from a fresh subscribe', async () => {
    const code = await lobby(4);
    await deal(code);
    const before = await state('p2', code, (s) => s.myWord);
    await joinRoom(u.p2.db, code, u.p2.uid, 'Player2');
    const after = await state('p2', code, (s) => s.myWord);
    expect(after.myWord).toBe(before.myWord);
    expect(after.room.active.indexOf(u.p2.uid)).toBe(before.room.active.indexOf(u.p2.uid));
    expect(after.players.map((p) => p.uid)).toEqual(before.players.map((p) => p.uid));
  });

  it('re-entry: a benched player has no word and stays benched after joinRoom', async () => {
    const code = await lobby(6);
    const { secret, room } = await deal(code);
    const out = hero(room, secret);
    await playRound(code, out);
    await afterClose(code, 1);
    await nextRound(u.gm.db, code);
    await joinRoom(u[idOf(out)].db, code, out, 'again');
    const s = await state(idOf(out), code, (x) => x.room?.round === 2);
    expect(s.myWord).toBeNull();
    expect(s.room.heroBench).toContain(out);
    expect(s.room.active).not.toContain(out);
  });

  it('re-entry: a removed player rejoins, not in active until the next game', async () => {
    const code = await lobby(5);
    const { secret, room } = await deal(code);
    const out = hero(room, secret);
    await removePlayer(u.gm.db, code, out);
    await joinRoom(u[idOf(out)].db, code, out, 'Back');
    const s = await state(idOf(out), code, (x) => x.players?.some((p) => p.uid === out));
    expect(s.room.active).not.toContain(out);
    expect(s.myWord).toBeNull();
  });

  it('new game after game over: score 0-0, benches empty, everyone in players is active', async () => {
    const code = await lobby(4);
    const { secret } = await deal(code);
    await setDoc(doc(u.gm.db, 'rooms', code), { final: true }, { merge: true });
    await playRound(code, secret.spyUid);
    await afterClose(code, 1);
    await joinRoom(u.p5.db, code, u.p5.uid, 'Late');
    await dealWords(u.gm.db, code, 'sun', 'moon');
    const { room } = await state('gm', code, (s) => s.room?.phase === 'clues' && s.room.wordSet === 2);
    expect(room).toMatchObject({ score: { heroes: 0, spies: 0 }, heroBench: [], spyBench: [], winner: null, round: 2 });
    expect(room.active).toHaveLength(5);
    expect(room.active).toContain(u.p5.uid);
  });

  it('handOverGm: rejects during result, succeeds during gameOver', async () => {
    const code = await lobby(4);
    const { secret, room } = await deal(code);
    await playRound(code, hero(room, secret));
    await afterClose(code, 1);
    await expect(handOverGm(u.gm.db, code, u.p1.uid)).rejects.toThrow('Round already running');
    const code2 = await lobby(4);
    const d2 = await deal(code2);
    await setDoc(doc(u.gm.db, 'rooms', code2), { final: true }, { merge: true });
    await playRound(code2, d2.secret.spyUid);
    await afterClose(code2, 1);
    await handOverGm(u.gm.db, code2, u.p1.uid);
    expect((await state('p2', code2, (s) => s.room?.gmUid === u.p1.uid)).room.gmName).toBe('Player1');
  });

  it('handOverGm in the lobby swaps game master and player list', async () => {
    const code = await lobby(4);
    await handOverGm(u.gm.db, code, u.p1.uid);
    const { room, players } = await state('p2', code, (s) => s.room?.gmUid === u.p1.uid);
    expect(room.gmName).toBe('Player1');
    expect(players.map((p) => p.uid)).toContain(u.gm.uid);
    expect(players.map((p) => p.uid)).not.toContain(u.p1.uid);
  });

  it('game master joinRoom changes nothing and is not dealt in', async () => {
    const code = await lobby(4);
    await joinRoom(u.gm.db, code, u.gm.uid, 'Gina');
    const s = await state('gm', code, (x) => x.players?.length === 4);
    expect(s.players.map((p) => p.uid)).not.toContain(u.gm.uid);
    expect((await deal(code)).room.active).not.toContain(u.gm.uid);
  });

  it('joinRoom refuses a taken name (any case) and the game master name', async () => {
    const code = await lobby(2);
    await expect(joinRoom(u.p3.db, code, u.p3.uid, 'player1')).rejects.toThrow('Name already taken');
    await expect(joinRoom(u.p3.db, code, u.p3.uid, ' GINA ')).rejects.toThrow('Name already taken');
    await joinRoom(u.p1.db, code, u.p1.uid, 'PLAYER1');
  });

  it('a player sees their own vote, after reload too; a second vote is blocked', async () => {
    const code = await lobby(4);
    const { secret, room } = await deal(code);
    await pickStarter(u.gm.db, code, firstStarter(room, secret.spyUid));
    await openVoting(u.gm.db, code);
    const target = room.active.find((id) => id !== u.p1.uid);
    expect((await state('p1', code, (s) => s.myVote !== undefined)).myVote).toBeNull();
    await castVote(u.p1.db, code, u.p1.uid, target);
    expect((await state('p1', code, (s) => s.myVote)).myVote).toBe(target);
    await expect(castVote(u.p1.db, code, u.p1.uid, secret.spyUid)).rejects.toThrow();
  });

  it('the game master counts only the current round votes', async () => {
    const code = await lobby(6);
    const { secret, room } = await deal(code);
    await pickStarter(u.gm.db, code, firstStarter(room, secret.spyUid));
    await openVoting(u.gm.db, code);
    await castVote(u.p1.db, code, u.p1.uid, room.active.find((x) => x !== u.p1.uid));
    expect((await state('gm', code, (s) => s.votesCast === 1)).votesCast).toBe(1);
    await closeVoting(u.gm.db, code);
    await afterClose(code, 1);
    if ((await state('gm', code)).room.needsWords) await dealWords(u.gm.db, code, 'sun', 'moon');
    else await nextRound(u.gm.db, code);
    expect((await state('gm', code, (s) => s.room?.round === 2)).votesCast).toBe(0);
  });

  it('leaveRoom removes the player from the list', async () => {
    const code = await lobby(4);
    await leaveRoom(u.p2.db, code, u.p2.uid);
    const s = await state('gm', code, (x) => x.players?.length === 3);
    expect(s.players.map((p) => p.uid)).not.toContain(u.p2.uid);
  });

  it('deals to 15 players: all get a word, exactly one differs', async () => {
    const extra = Array.from({ length: 15 }, (_, i) => `q${i}`);
    for (const n of extra) {
      const { auth, db } = initFirebase(config, { emulator: true, name: n });
      u[n] = { auth, db, uid: await signIn(auth) };
    }
    try {
      const code = await createRoom(u.gm.db, u.gm.uid, 'Gina');
      for (const n of extra) await joinRoom(u[n].db, code, u[n].uid, n.toUpperCase());
      await dealWords(u.gm.db, code, 'cat', 'dog');
      const words = [];
      for (const n of extra) words.push((await state(n, code, (s) => s.myWord)).myWord);
      expect(words.filter((w) => w === 'cat').length).toBe(14);
      expect(words.filter((w) => w === 'dog').length).toBe(1);
    } finally {
      await Promise.all(extra.map((n) => deleteApp(u[n].auth.app)));
    }
  });
});

describe('room cleanup', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const near = (ts, ms) => Math.abs(ts.toMillis() - (Date.now() + ms)) < 60000;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const read = async (code, path, who = 'gm') => (await getDoc(doc(u[who].db, 'rooms', code, ...path))).data();
  // Runs fn and checks the room's expiresAt moved later and is about 24 hours ahead.
  const moves = async (code, fn) => {
    const before = (await rawRoom(code)).expiresAt;
    await sleep(15);
    await fn();
    const after = (await rawRoom(code)).expiresAt;
    expect(after.toMillis()).toBeGreaterThan(before.toMillis());
    expect(near(after, DAY)).toBe(true);
  };
  let env;
  beforeAll(async () => { env = await initializeTestEnvironment({ projectId: 'demo-spy' }); });
  afterAll(() => env.cleanup());
  const asAdmin = (fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));

  it('createRoom sets expiresAt about 24 hours ahead', async () => {
    const code = await createRoom(u.gm.db, u.gm.uid, 'Gina');
    expect(near((await rawRoom(code)).expiresAt, DAY)).toBe(true);
  });

  it('every game master action moves expiresAt', async () => {
    const code = await lobby(5);
    await moves(code, () => dealWords(u.gm.db, code, 'cat', 'dog'));
    const { secret, room } = await clues(code);
    await moves(code, () => pickStarter(u.gm.db, code, firstStarter(room, secret.spyUid)));
    await moves(code, () => openVoting(u.gm.db, code));
    const out = hero(room, secret);
    for (const id of room.active) await castVote(u[idOf(id)].db, code, id, id === out ? room.active.find((x) => x !== id) : out);
    await moves(code, () => closeVoting(u.gm.db, code));
    await moves(code, () => nextRound(db0(), code));
    await moves(code, () => removePlayer(u.gm.db, code, room.active.find((x) => x !== out && x !== secret.spyUid)));
  });
  const db0 = () => u.gm.db;

  it('removePlayer in the lobby, handOverGm, and the end-of-game write move expiresAt', async () => {
    const code = await lobby(2);
    await moves(code, () => removePlayer(u.gm.db, code, u.p2.uid));
    await moves(code, () => handOverGm(u.gm.db, code, u.p1.uid));
    const code2 = await lobby(4);
    await deal(code2);
    await asAdmin((d) => d.doc(`rooms/${code2}`).update({ phase: 'result', active: [u.p1.uid, u.p2.uid] }));
    await moves(code2, () => nextRound(u.gm.db, code2)); // fewer than 3 left: the end-of-game write
    expect((await rawRoom(code2)).phase).toBe('gameOver');
  });

  it('records under a room carry expiresAt about 7 days ahead', async () => {
    const code = await lobby(4);
    await deal(code);
    const { room } = await clues(code);
    await pickStarter(u.gm.db, code, firstStarter(room, (await read(code, ['gm', 'secret'])).spyUid));
    await openVoting(u.gm.db, code);
    await castVote(u.p1.db, code, u.p1.uid, u.p2.uid);
    const week = 7 * DAY;
    for (const path of [['players', u.p1.uid], ['private', u.p1.uid], ['gm', 'secret'], ['votes', `${room.round}_${u.p1.uid}`]]) {
      expect(near((await read(code, path)).expiresAt, week)).toBe(true);
    }
  });

  it('handOverGm gives the old game master a player doc that expires in 7 days', async () => {
    const code = await lobby(2);
    await handOverGm(u.gm.db, code, u.p1.uid);
    expect(near((await read(code, ['players', u.gm.uid], 'p1')).expiresAt, 7 * DAY)).toBe(true);
  });

  it('a rejoin keeps the player\'s expiresAt', async () => {
    const code = await lobby(1);
    const before = (await read(code, ['players', u.p1.uid])).expiresAt;
    await sleep(15);
    await joinRoom(u.p1.db, code, u.p1.uid, 'Renamed');
    const after = await read(code, ['players', u.p1.uid]);
    expect(after.name).toBe('Renamed');
    expect(after.expiresAt.isEqual(before)).toBe(true);
  });

  it('second day: a game master action moves the room ahead and the player list is intact', async () => {
    const code = await lobby(4);
    const yesterday = new Date(Date.now() - DAY);
    await asAdmin(async (d) => {
      await d.doc(`rooms/${code}`).update({ expiresAt: yesterday });
      await d.doc(`rooms/${code}/players/${u.p1.uid}`).update({ expiresAt: yesterday });
    });
    await deal(code);
    expect(near((await rawRoom(code)).expiresAt, DAY)).toBe(true);
    expect((await state('gm', code)).players.map((p) => p.uid)).toContain(u.p1.uid);
  });

  it('deleteRoom with no players deletes the room and gm/secret', async () => {
    const code = await createRoom(u.gm.db, u.gm.uid, 'Gina');
    await asAdmin((d) => d.doc(`rooms/${code}/gm/secret`).set({ common: 'a' }));
    expect(await deleteRoom(u.gm.db, code)).toBe(true);
    expect(await rawRoom(code, 'gm')).toBeUndefined();
    await asAdmin(async (d) => expect((await d.doc(`rooms/${code}/gm/secret`).get()).exists).toBe(false));
  });

  it('deleteRoom with a player returns false and deletes nothing', async () => {
    const code = await lobby(1);
    expect(await deleteRoom(u.gm.db, code)).toBe(false);
    expect(await rawRoom(code)).toBeDefined();
  });

  it('deleteRoom refuses mid-game even with no player docs', async () => {
    const code = await lobby(4);
    await deal(code);
    await asAdmin(async (d) => { for (const p of ['p1', 'p2', 'p3', 'p4']) await d.doc(`rooms/${code}/players/${u[p].uid}`).delete(); });
    expect(await deleteRoom(u.gm.db, code)).toBe(false);
    expect(await rawRoom(code)).toBeDefined();
    await asAdmin((d) => d.doc(`rooms/${code}`).update({ phase: 'gameOver' }));
    expect(await deleteRoom(u.gm.db, code)).toBe(true);
  });

  it('a gone room reads as null for the game master, an active player, a benched player and a late joiner', async () => {
    const code = await lobby(5);
    await deal(code);
    const { room, secret } = await clues(code);
    const out = hero(room, secret);
    await playRound(code, out);
    await afterClose(code, room.round);
    await asAdmin((d) => d.doc(`rooms/${code}`).delete());
    const active = idOf(room.active.find((x) => x !== out));
    for (const who of ['gm', active, idOf(out), 'p6']) {
      expect((await state(who, code, (x) => x.room === null && x.players)).room).toBeNull();
    }
    await expect(joinRoom(u.p6.db, code, u.p6.uid, 'Late')).rejects.toThrow('Room not found');
  });

  it('a phone more than 7 days slow: join and vote fail with Bad clock', async () => {
    const code = await lobby(4);
    const spy = vi.spyOn(Date, 'now');
    const real = Date.now();
    spy.mockReturnValue(real - 9 * DAY);
    try {
      await expect(joinRoom(u.p5.db, code, u.p5.uid, 'Slow')).rejects.toThrow('Bad clock');
      spy.mockRestore();
      await deal(code);
      const { room, secret } = await clues(code);
      await pickStarter(u.gm.db, code, firstStarter(room, secret.spyUid));
      await openVoting(u.gm.db, code);
      vi.spyOn(Date, 'now').mockReturnValue(real - 9 * DAY);
      await expect(castVote(u.p1.db, code, u.p1.uid, u.p2.uid)).rejects.toThrow('Bad clock');
    } finally { spy.mockRestore(); }
  });
});
