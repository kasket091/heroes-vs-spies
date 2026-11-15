import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp } from 'firebase/app';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { newRoomCode } from '../src/game.js';
import { initFirebase, signIn } from '../src/firebase.js';
import {
  leaveRoom, createRoom, joinRoom, subscribe, startGame, advance, runRoom,
  castVote, closeVoting, removePlayer, handOverGm, deleteRoom, touchPlayer,
} from '../src/room.js';

const config = { apiKey: 'fake', projectId: 'demo-spy' };
const names = ['h', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
const u = {};
let env;

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-spy' });
  for (const n of names) {
    const { auth, db } = initFirebase(config, { emulator: true, name: n });
    u[n] = { auth, db, uid: await signIn(auth) };
  }
});
afterAll(async () => {
  await Promise.all(names.map((n) => deleteApp(u[n].auth.app)));
  await env.cleanup();
});
const asAdmin = (fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));

const FAM = [['cat', 'dog', 'cow', 'pig']];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 6000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(25)) { const v = await fn(); if (v) return v; }
  throw new Error('until timeout');
};

// Resolves with the first state of `who`'s subscription that satisfies `pred`.
const state = (who, code, pred = (s) => s.room && s.players) =>
  new Promise((resolve, reject) => {
    let off = () => {};
    const timer = setTimeout(() => { off(); reject(new Error('state timeout')); }, 5000);
    off = subscribe(u[who].db, code, u[who].uid, (s) => {
      if (pred(s)) { clearTimeout(timer); off(); resolve(s); }
    });
  });

// A room of `total` people: the host (h) and p1..p(total-1).
async function lobby(total = 4) {
  const code = await createRoom(u.h.db, u.h.uid, 'Gina');
  for (let i = 1; i < total; i++) await joinRoom(u[`p${i}`].db, code, u[`p${i}`].uid, `Player${i}`);
  return code;
}
const idOf = (uid) => names.find((n) => u[n].uid === uid);
const nameOf = (uid) => (uid === u.h.uid ? 'Gina' : `Player${idOf(uid).slice(1)}`);
const rawRoom = async (code, who = 'p1') => (await getDoc(doc(u[who].db, 'rooms', code))).data();
const secretOf = async (code) => (await getDoc(doc(u.h.db, 'rooms', code, 'gm', 'secret'))).data();
const usedOf = async (code) => (await getDoc(doc(u.h.db, 'rooms', code, 'gm', 'used'))).data();
const deal = async (code, rand = Math.random) => {
  await startGame(u.h.db, code, FAM, rand);
  return { room: await rawRoom(code, 'h'), secret: await secretOf(code) };
};
// With this rand the host (first seat) is the spy.
const HOST_SPY = () => 0;
// With this rand the last seat is the spy, so the host is a hero in a room of 2 or more.
const LAST_SPY = () => 0.99;
const hero = (room, secret) => room.seats.find((x) => x !== secret.spyUid && x !== u.h.uid);
// Everyone in roundPlayers (or `only`) votes for outUid, who votes for someone else; then the host closes.
const castAll = async (code, outUid, only) => {
  const room = await rawRoom(code, 'h');
  for (const id of room.roundPlayers.filter((x) => !only || only.includes(x))) {
    await castVote(u[idOf(id)].db, code, id, id === outUid ? room.roundPlayers.find((x) => x !== id) : outUid);
  }
};
const playRound = async (code, outUid, only) => {
  await castAll(code, outUid, only);
  await closeVoting(u.h.db, code);
};
const afterClose = (code, round) => state('h', code, (s) => s.room?.round === round && ['result', 'gameOver'].includes(s.room.phase));
const voting = (code, round) => state('h', code, (s) => s.room?.phase === 'voting' && s.room.round === round);

// A clock and timer the test moves by hand. Handles are objects: clearTimeout never hits a real timer.
const fakeClock = () => {
  let offset = 0;
  const c = { timers: [], calls: 0 };
  c.now = () => Date.now() + offset;
  c.setTimer = (fn, ms) => { c.calls += 1; const t = { fn, ms }; c.timers.push(t); return t; };
  c.jump = (ms) => { offset += ms; };
  // Moves the clock past the 10 s wait and fires whatever timer is pending.
  c.tick = async () => {
    await until(() => c.timers.length);
    c.jump(10000);
    c.timers.splice(0).forEach((t) => t.fn()); // each runs hostStep at once, on the moved clock
    c.jump(-10000);
  };
  return c;
};

const ROOM_KEYS = ['gmUid', 'gmName', 'round', 'roundPlayers', 'starterUid', 'result', 'phase', 'seats', 'names', 'heroBench', 'spyBench', 'score', 'wordSet', 'needsWords', 'final', 'winner', 'setStart', 'resultAt', 'expiresAt'];
// What a player can read on the room doc must not name the spy or either word.
const expectNoSecrets = async (code) => {
  const room = await rawRoom(code);
  expect(Object.keys(room).filter((k) => !ROOM_KEYS.includes(k))).toEqual([]);
  expect(JSON.stringify(room)).not.toMatch(/cat|dog|cow|pig|\d+:\d+-\d+/);
  expect(room.result ? [room.result.spyUid, room.result.spyName, room.result.common, room.result.spy] : [null, null, null, null]).toEqual([null, null, null, null]);
  return room;
};
// Records every state `who` is handed. The other word, the spy marker and the used list must never be in one.
const STATE_KEYS = ['room', 'players', 'myWord', 'myVote', 'waiting', 'votesCast'];
const watch = (who, code) => {
  const seen = [];
  const off = subscribe(u[who].db, code, u[who].uid, (s) => seen.push(s));
  return { seen, off };
};
const expectStatesClean = (seen, secret) => {
  expect(seen.length).toBeGreaterThan(0);
  for (const s of seen) {
    expect(Object.keys(s).filter((k) => !STATE_KEYS.includes(k))).toEqual([]);
    const text = JSON.stringify(s);
    expect(text).not.toMatch(/\d+:\d+-\d+/);
    const revealed = s.room?.phase === 'gameOver' || s.room?.result?.spy;
    if (!revealed && s.myWord) expect(text).not.toContain(s.myWord === secret.common ? secret.spy : secret.common);
    if (!revealed) expect(text).not.toMatch(/"spyUid":"[^"]/);
  }
};

describe('room data layer', () => {
  it('createRoom: the host is in the player list; seats is []; no active field', async () => {
    const code = await lobby(1);
    const s = await state('h', code, (x) => x.players?.length === 1);
    expect(s.players.map((p) => p.uid)).toEqual([u.h.uid]);
    expect(s.players[0].name).toBe('Gina');
    expect(s.room).toMatchObject({ phase: 'lobby', seats: [], gmUid: u.h.uid, score: { heroes: 0, spies: 0 }, wordSet: 0, needsWords: false, resultAt: null });
    expect('active' in s.room).toBe(false);
  });

  it('createRoom then joinRoom x3 lists 4 names in join order, host first', async () => {
    const code = await lobby(4);
    const s = await state('p1', code, (x) => x.players?.length === 4);
    expect(s.players.map((p) => p.name)).toEqual(['Gina', 'Player1', 'Player2', 'Player3']);
  });

  it('joinRoom rejects unknown code', async () => {
    await expect(joinRoom(u.p1.db, 'ZZZZ', u.p1.uid, 'A')).rejects.toThrow('Room not found');
  });

  it('old room: a room with active but no seats (or neither) rejects Old room before writing anything', async () => {
    for (const [code, extra] of [['QQQQ', { active: [] }], ['QQQR', {}]]) {
      await setDoc(doc(u.h.db, 'rooms', code), { gmUid: u.h.uid, gmName: 'Gina', phase: 'lobby', round: 0, roundPlayers: [], starterUid: null, result: null, ...extra });
      await expect(joinRoom(u.p1.db, code, u.p1.uid, 'Ann')).rejects.toThrow('Old room');
      expect((await getDoc(doc(u.p1.db, 'rooms', code, 'players', u.p1.uid))).exists()).toBe(false);
    }
  });

  it('joinRoom refuses a name from the running game for a different uid; the same uid may rejoin with it', async () => {
    const code = await lobby(4);
    const { room } = await deal(code);
    await removePlayer(u.h.db, code, u.p1.uid);
    expect(room.names[u.p1.uid]).toBe('Player1');
    await expect(joinRoom(u.p5.db, code, u.p5.uid, 'player1')).rejects.toThrow('Name already taken');
    await joinRoom(u.p1.db, code, u.p1.uid, 'Player1');
  });

  it("joinRoom with '   ' rejects with Name needed", async () => {
    const code = await lobby(1);
    await expect(joinRoom(u.p1.db, code, u.p1.uid, '   ')).rejects.toThrow('Name needed');
  });

  it('joinRoom refuses a taken name (any case), the host name included; the host retyping the code returns quietly', async () => {
    const code = await lobby(3);
    await expect(joinRoom(u.p3.db, code, u.p3.uid, 'player1')).rejects.toThrow('Name already taken');
    await expect(joinRoom(u.p3.db, code, u.p3.uid, ' GINA ')).rejects.toThrow('Name already taken');
    await joinRoom(u.p1.db, code, u.p1.uid, 'PLAYER1');
    await joinRoom(u.h.db, code, u.h.uid, 'Gina');
    expect((await state('h', code, (x) => x.players?.length === 3)).players.map((p) => p.uid)).toContain(u.h.uid);
  });

  it('startGame with 3 people rejects Not enough players', async () => {
    const code = await lobby(3);
    await expect(startGame(u.h.db, code, FAM)).rejects.toThrow('Not enough players');
  });

  it('startGame rejects a running round', async () => {
    const code = await lobby(4);
    await deal(code);
    await expect(startGame(u.h.db, code, FAM)).rejects.toThrow('Round already running');
  });

  it('startGame with 4 (host + 3): voting, 4 seats with the host, starter first, one word differs, nothing leaks', async () => {
    const code = await lobby(4);
    const watchers = names.slice(0, 4).map((n) => watch(n, code));
    const { room, secret } = await deal(code);
    expect(room).toMatchObject({ phase: 'voting', round: 1, wordSet: 1, final: false, needsWords: false, setStart: true, result: null, resultAt: null, score: { heroes: 0, spies: 0 } });
    expect(room.seats).toHaveLength(4);
    expect(room.seats).toContain(u.h.uid);
    expect(room.roundPlayers[0]).toBe(room.starterUid);
    expect([...room.roundPlayers].sort()).toEqual([...room.seats].sort());
    const words = [];
    for (const n of names.slice(0, 4)) words.push((await state(n, code, (s) => s.myWord)).myWord);
    expect(words.filter((w) => w === secret.spy)).toHaveLength(1);
    expect(words.filter((w) => w === secret.common)).toHaveLength(3);
    await sleep(200);
    watchers.forEach((w) => { w.off(); expectStatesClean(w.seen, secret); });
    await expectNoSecrets(code);
  });

  it('host as spy: the host state has the spy word as myWord and the same shape as a player state', async () => {
    const code = await lobby(4);
    const { secret } = await deal(code, HOST_SPY);
    expect(secret.spyUid).toBe(u.h.uid);
    const h = await state('h', code, (s) => s.myWord);
    const p = await state('p1', code, (s) => s.myWord);
    expect(h.myWord).toBe(secret.spy);
    expect(p.myWord).toBe(secret.common);
    expect(Object.keys(h).filter((k) => k !== 'votesCast').sort()).toEqual(Object.keys(p).sort());
    expect(h.waiting).toEqual(p.waiting);
  });

  it('used pairs are host-only: a player reading gm/used is refused, the host can; the room doc has no pair keys', async () => {
    const code = await lobby(4);
    await deal(code);
    await expect(getDoc(doc(u.p1.db, 'rooms', code, 'gm', 'used'))).rejects.toThrow();
    expect((await usedOf(code)).keys).toHaveLength(1);
    expect(Object.keys(await rawRoom(code))).not.toContain('used');
    await expectNoSecrets(code);
  });

  it('no repeat in a room: with one family, 6 deals across games are 6 different pairs, the 7th works', async () => {
    const code = await lobby(4);
    const seen = new Set();
    for (let n = 0; n < 6; n++) {
      if (n) await asAdmin((d) => d.doc(`rooms/${code}`).update({ phase: 'gameOver' }));
      const { secret } = await deal(code);
      seen.add([secret.common, secret.spy].sort().join('/'));
      expect((await usedOf(code)).keys).toHaveLength(n + 1);
    }
    expect(seen.size).toBe(6);
    await asAdmin((d) => d.doc(`rooms/${code}`).update({ phase: 'gameOver' }));
    await deal(code);
    expect((await usedOf(code)).keys).toHaveLength(1);
  });

  it('voted marks carry no target; every player\'s waiting drops that uid', async () => {
    const code = await lobby(4);
    const { room } = await deal(code);
    const target = room.seats.find((x) => x !== u.p1.uid);
    expect((await state('p2', code, (s) => s.waiting.includes(u.p1.uid))).waiting).toHaveLength(4);
    await castVote(u.p1.db, code, u.p1.uid, target);
    const mine = (await getDoc(doc(u.p2.db, 'rooms', code, 'players', u.p1.uid))).data();
    expect(Object.keys(mine).sort()).toEqual(['expiresAt', 'joinedAt', 'name', 'votedRound']);
    expect(mine.votedRound).toBe(1);
    for (const who of ['h', 'p2', 'p3']) {
      const s = await state(who, code, (x) => x.players?.find((p) => p.uid === u.p1.uid)?.votedRound === 1);
      expect(s.waiting).toEqual(room.roundPlayers.filter((x) => x !== u.p1.uid));
      expect(JSON.stringify(s)).not.toContain(`"target"`);
    }
  });

  it('a player sees their own vote, after reload too; a second vote changes nothing; the host sees their own too', async () => {
    const code = await lobby(4);
    const { room, secret } = await deal(code);
    const target = room.seats.find((id) => id !== u.p1.uid);
    expect((await state('p1', code, (s) => s.myVote !== undefined)).myVote).toBeNull();
    await castVote(u.p1.db, code, u.p1.uid, target);
    expect((await state('p1', code, (s) => s.myVote)).myVote).toBe(target);
    await castVote(u.p1.db, code, u.p1.uid, secret.spyUid === target ? u.h.uid : secret.spyUid); // already in: not an error, not replaced
    expect((await state('p1', code, (s) => s.myVote)).myVote).toBe(target);
    await castVote(u.h.db, code, u.h.uid, u.p1.uid);
    expect((await state('h', code, (s) => s.myVote)).myVote).toBe(u.p1.uid);
  });

  it('the host counts only current round votes, and only from this round\'s players', async () => {
    const code = await lobby(6);
    const { room } = await deal(code, LAST_SPY);
    await asAdmin((d) => d.doc(`rooms/${code}/votes/${room.round}_ghost`).set({ target: u.p1.uid, round: room.round }));
    await castVote(u.p1.db, code, u.p1.uid, room.seats.find((x) => x !== u.p1.uid));
    expect((await state('h', code, (s) => s.votesCast === 1)).votesCast).toBe(1);
    await sleep(300);
    expect((await state('h', code)).votesCast).toBe(1);
    await closeVoting(u.h.db, code);
    await afterClose(code, 1);
    await advance(u.h.db, code, FAM);
    expect((await state('h', code, (s) => s.room?.round === 2)).votesCast).toBe(0);
  });

  it('vote out a hero: result, score 0-1, bench, resultAt set, nothing about the spy or words', async () => {
    const code = await lobby(6);
    const { secret, room: dealt } = await deal(code, LAST_SPY);
    const out = hero(dealt, secret);
    await playRound(code, out);
    const { room } = await afterClose(code, 1);
    expect(room.phase).toBe('result');
    expect(room.resultAt).toBeGreaterThan(Date.now() - 20000);
    expect(room.result).toMatchObject({ outUid: out, wasSpy: false, team: 'spies', points: 1 });
    expect(room.score).toEqual({ heroes: 0, spies: 1 });
    expect(room.heroBench).toEqual([out]);
    expect(room.seats).not.toContain(out);
    expect(room.needsWords).toBe(false);
    await expectNoSecrets(code);
  });

  it('advance after a hero is out: same wordSet and words, round +1, a seat starts, voting, no secrets', async () => {
    const code = await lobby(6);
    const { secret, room: dealt } = await deal(code, LAST_SPY);
    const before = {};
    for (const id of dealt.seats) before[id] = (await state(idOf(id), code, (s) => s.myWord)).myWord;
    await playRound(code, hero(dealt, secret));
    await afterClose(code, 1);
    await advance(u.h.db, code, FAM);
    const { room } = await voting(code, 2);
    expect(room).toMatchObject({ wordSet: 1, result: null, resultAt: null, final: false, setStart: false });
    expect(room.seats).toContain(room.starterUid);
    expect(room.roundPlayers[0]).toBe(room.starterUid);
    expect([...room.roundPlayers].sort()).toEqual([...room.seats].sort());
    for (const id of room.seats) expect((await state(idOf(id), code, (s) => s.myWord)).myWord).toBe(before[id]);
    await expectNoSecrets(code);
  });

  it('vote out the spy: both words and name shown, heroes +1, spy bench, needsWords; advance deals new words and a new spy', async () => {
    const code = await lobby(6);
    const { secret } = await deal(code, LAST_SPY);
    await playRound(code, secret.spyUid);
    const { room } = await afterClose(code, 1);
    expect(room.result).toMatchObject({ outUid: secret.spyUid, wasSpy: true, team: 'heroes', points: 1, spyUid: secret.spyUid, spyName: nameOf(secret.spyUid), common: secret.common, spy: secret.spy });
    expect(room.score).toEqual({ heroes: 1, spies: 0 });
    expect(room.spyBench).toEqual([secret.spyUid]);
    expect(room.needsWords).toBe(true);
    await advance(u.h.db, code, FAM);
    const next = (await voting(code, 2)).room;
    const secret2 = await secretOf(code);
    expect(next).toMatchObject({ wordSet: 2, needsWords: false, result: null, setStart: true });
    expect(next.seats).toHaveLength(5);
    expect(next.seats).toContain(secret2.spyUid);
    expect(secret2.spyUid).not.toBe(secret.spyUid);
    expect((await state(idOf(secret.spyUid), code, (s) => s.room?.wordSet === 2)).myWord).toBeNull();
    expect((await usedOf(code)).keys).toHaveLength(2);
  });

  it('tie: with rand fixed the drawn tied player is out and the result has no tie field', async () => {
    const code = await lobby(4);
    const { room } = await deal(code);
    const [a, b, c, d] = room.roundPlayers;
    await castVote(u[idOf(a)].db, code, a, b);
    await castVote(u[idOf(b)].db, code, b, a);
    await castVote(u[idOf(c)].db, code, c, a);
    await castVote(u[idOf(d)].db, code, d, b);
    await closeVoting(u.h.db, code, () => 0.99);
    const { room: after } = await afterClose(code, 1);
    expect(after.result.outUid).toBe(b); // a and b tied; 0.99 draws the later one in roundPlayers order
    expect('tie' in after.result).toBe(false);
  });

  it('close with no votes: someone from seats is out, phase result, 3 seats', async () => {
    const code = await lobby(4);
    const { room } = await deal(code);
    await closeVoting(u.h.db, code);
    const { room: after } = await afterClose(code, 1);
    expect(room.seats).toContain(after.result.outUid);
    expect(after.phase).toBe('result');
    expect(after.seats).toHaveLength(3);
  });

  it('closeVoting twice: one result, score moved once; advance twice: round moved once', async () => {
    const code = await lobby(6);
    const { secret, room } = await deal(code, LAST_SPY);
    await castAll(code, hero(room, secret));
    await Promise.all([closeVoting(u.h.db, code), closeVoting(u.h.db, code)]);
    const first = (await afterClose(code, 1)).room;
    expect(first.score).toEqual({ heroes: 0, spies: 1 });
    await Promise.all([advance(u.h.db, code, FAM), advance(u.h.db, code, FAM)]);
    await advance(u.h.db, code, FAM);
    expect((await state('h', code)).room.round).toBe(2);
  });

  it('a late copy of a step (a round number from before) does nothing', async () => {
    const code = await lobby(6);
    const { secret, room } = await deal(code, LAST_SPY);
    await playRound(code, hero(room, secret));
    await afterClose(code, 1);
    await advance(u.h.db, code, FAM, undefined, 1);
    await voting(code, 2);
    await closeVoting(u.h.db, code, undefined, 1);
    await advance(u.h.db, code, FAM, undefined, 1);
    expect((await rawRoom(code, 'h'))).toMatchObject({ phase: 'voting', round: 2 });
  });

  it('a benched player cannot vote; a seated player can in the same round', async () => {
    const code = await lobby(6);
    const { secret, room } = await deal(code, LAST_SPY);
    const out = hero(room, secret);
    await playRound(code, out);
    await afterClose(code, 1);
    await advance(u.h.db, code, FAM);
    const { room: r2 } = await voting(code, 2);
    const target = r2.seats.find((x) => x !== r2.seats[0]);
    await expect(castVote(u[idOf(out)].db, code, out, target)).rejects.toThrow();
    await castVote(u[idOf(r2.seats[0])].db, code, r2.seats[0], target);
    expect((await state('h', code, (s) => s.votesCast === 1)).votesCast).toBe(1);
  });

  it('full game from 6 by hand: rounds to 3 seats, final, game over, nobody newly benched', async () => {
    const code = await lobby(6);
    let { secret, room } = await deal(code, LAST_SPY);
    for (let r = 1; r <= 3; r++) {
      await playRound(code, hero(room, secret));
      await afterClose(code, r);
      await advance(u.h.db, code, FAM);
      ({ room } = await voting(code, r + 1));
    }
    expect(room.seats).toHaveLength(3);
    expect(room.final).toBe(true);
    expect(room.score).toEqual({ heroes: 0, spies: 3 });
    const benchedBefore = room.heroBench.length;
    await playRound(code, hero(room, secret));
    const { room: end } = await afterClose(code, 4);
    expect(end.phase).toBe('gameOver');
    expect(end.score).toEqual({ heroes: 0, spies: 7 }); // 3 + (3 gap + 1)
    expect(end.winner).toBe('spies');
    expect(end.heroBench).toHaveLength(benchedBefore);
    expect(end.seats).toHaveLength(3);
    expect(end.result).toMatchObject({ spyUid: secret.spyUid, common: secret.common, spy: secret.spy });
    expect('active' in end).toBe(false);
  });

  it('final at 1-4 won by heroes: 5-4, winner heroes', async () => {
    const code = await lobby(4);
    const { secret } = await deal(code);
    await asAdmin((d) => d.doc(`rooms/${code}`).update({ score: { heroes: 1, spies: 4 }, final: true }));
    await playRound(code, secret.spyUid);
    const { room } = await afterClose(code, 1);
    expect(room).toMatchObject({ phase: 'gameOver', score: { heroes: 5, spies: 4 }, winner: 'heroes' });
  });

  it('4-person game: any starter incl. the spy; then the final at 3', async () => {
    const code = await lobby(4);
    const { secret } = await deal(code);
    const voter = u.h.uid === secret.spyUid ? u.p1.uid : u.h.uid;
    await castVote(u[idOf(voter)].db, code, voter, secret.spyUid);
    await closeVoting(u.h.db, code, () => 0.99);
    expect((await afterClose(code, 1)).room.seats).toHaveLength(3);
    await advance(u.h.db, code, FAM);
    expect((await voting(code, 2)).room.final).toBe(true);
  });

  it('starter rule: the first round of a word set keeps two speakers ahead of the spy; later rounds do not', async () => {
    for (let k = 0; k < 6; k++) {
      const code = await lobby(6);
      const { room, secret } = await deal(code);
      const order = room.roundPlayers;
      expect(order.indexOf(secret.spyUid)).toBeGreaterThanOrEqual(2);
      await asAdmin((d) => d.doc(`rooms/${code}`).update({ phase: 'gameOver' }));
    }
    const code = await lobby(6);
    const { room, secret } = await deal(code, LAST_SPY);
    await playRound(code, hero(room, secret));
    await afterClose(code, 1);
    await advance(u.h.db, code, FAM, () => 0.99);
    const { room: r2 } = await voting(code, 2);
    expect(r2.setStart).toBe(false);
    expect(r2.starterUid).toBe(r2.seats[r2.seats.length - 1]);
  });

  it('remove an active hero during voting: voided, no score or bench change, no secrets', async () => {
    const code = await lobby(5);
    const { secret, room } = await deal(code, LAST_SPY);
    const out = hero(room, secret);
    await removePlayer(u.h.db, code, out);
    const { room: after } = await state('h', code, (s) => s.room?.phase === 'result');
    expect(after.resultAt).toBeGreaterThan(Date.now() - 20000);
    expect(after.result).toMatchObject({ voided: true, outUid: out, outName: nameOf(out), wasSpy: false });
    expect(after).toMatchObject({ score: { heroes: 0, spies: 0 }, heroBench: [], spyBench: [], needsWords: false });
    expect(after.seats).not.toContain(out);
    await expectNoSecrets(code);
  });

  it('remove the spy during voting: voided with words and spy name, needsWords', async () => {
    const code = await lobby(5);
    const { secret } = await deal(code, LAST_SPY);
    await removePlayer(u.h.db, code, secret.spyUid);
    const { room: after } = await state('h', code, (s) => s.room?.phase === 'result');
    expect(after.result).toMatchObject({ voided: true, outUid: secret.spyUid, outName: nameOf(secret.spyUid), spyUid: secret.spyUid, spyName: nameOf(secret.spyUid), common: secret.common, spy: secret.spy });
    expect(after.needsWords).toBe(true);
    expect(after.spyBench).toEqual([]);
  });

  it("remove a seated player in 'result': seats shrink, score, result and resultAt unchanged; the spy sets needsWords", async () => {
    const code = await lobby(6);
    const { secret, room } = await deal(code, LAST_SPY);
    await playRound(code, hero(room, secret));
    const before = (await afterClose(code, 1)).room;
    const gone = before.seats.find((x) => x !== secret.spyUid && x !== u.h.uid);
    await removePlayer(u.h.db, code, gone);
    const { room: after } = await state('h', code, (s) => !s.room?.seats.includes(gone));
    expect(after.seats).toEqual(before.seats.filter((x) => x !== gone));
    expect({ ...after, seats: 0, expiresAt: 0 }).toEqual({ ...before, seats: 0, expiresAt: 0 });
    await expectNoSecrets(code);
    await removePlayer(u.h.db, code, secret.spyUid);
    expect((await state('h', code, (s) => s.room?.needsWords)).room.needsWords).toBe(true);
  });

  it('stall: removal below 3: the next advance gives gameOver, a level score is a draw', async () => {
    const code = await lobby(4);
    await deal(code);
    await removePlayer(u.h.db, code, u.p1.uid);
    await removePlayer(u.h.db, code, u.p2.uid);
    await state('h', code, (s) => s.room?.seats.length === 2);
    await advance(u.h.db, code, FAM);
    const { room: end } = await state('h', code, (s) => s.room?.phase === 'gameOver');
    expect(end).toMatchObject({ winner: 'draw', score: { heroes: 0, spies: 0 }, wordSet: 1 });
  });

  it('removal below 3 with needsWords: advance gives gameOver and deals nothing', async () => {
    const code = await lobby(4);
    const { secret, room } = await deal(code, LAST_SPY);
    await removePlayer(u.h.db, code, secret.spyUid);
    await removePlayer(u.h.db, code, hero(room, secret));
    await advance(u.h.db, code, FAM);
    expect((await state('h', code, (s) => s.room?.phase === 'gameOver')).room).toMatchObject({ winner: 'draw', wordSet: 1 });
  });

  it('endGame mid-game keeps the secrets out; at game over it shows them', async () => {
    const code = await lobby(4);
    const { secret, room } = await deal(code, LAST_SPY);
    await playRound(code, hero(room, secret));
    const mid = (await afterClose(code, 1)).room;
    await expectNoSecrets(code);
    await removePlayer(u.h.db, code, mid.seats.find((x) => x !== secret.spyUid && x !== u.h.uid));
    await state('h', code, (s) => s.room?.seats.length === 2);
    await expectNoSecrets(code);
    await advance(u.h.db, code, FAM);
    const { room: end } = await state('h', code, (s) => s.room?.phase === 'gameOver');
    expect(end.result).toMatchObject({ spyUid: secret.spyUid, common: secret.common, spy: secret.spy });
    expect(end.winner).toBe('spies');
  });

  it('endGame keeps what the last result made public; after the spy left between rounds it stays null', async () => {
    const code = await lobby(4);
    const { secret, room } = await deal(code, LAST_SPY);
    const out = hero(room, secret);
    await playRound(code, out);
    await afterClose(code, 1);
    await removePlayer(u.h.db, code, secret.spyUid);
    await state('h', code, (s) => s.room?.seats.length === 2);
    await advance(u.h.db, code, FAM);
    const { room: end } = await state('h', code, (s) => s.room?.phase === 'gameOver');
    expect(end.result).toMatchObject({ outUid: out, spyUid: null, common: null, spy: null });
  });

  it('late joiner mid-game: in players, not in seats, myWord null; dealt in by the next new game with a clean slate', async () => {
    const code = await lobby(4);
    const { secret } = await deal(code);
    await joinRoom(u.p4.db, code, u.p4.uid, 'Late');
    const s = await state('p4', code, (x) => x.players?.length === 5);
    expect(s.room.seats).not.toContain(u.p4.uid);
    expect(s.myWord).toBeNull();
    await asAdmin((d) => d.doc(`rooms/${code}`).update({ final: true }));
    await playRound(code, secret.spyUid);
    await afterClose(code, 1);
    await startGame(u.h.db, code, FAM);
    const { room } = await state('h', code, (x) => x.room?.phase === 'voting' && x.room.wordSet === 2);
    expect(room).toMatchObject({ score: { heroes: 0, spies: 0 }, heroBench: [], spyBench: [], winner: null, round: 2 });
    expect(room.seats).toHaveLength(5);
    expect(room.seats).toContain(u.p4.uid);
  });

  it('re-entry: a seated player gets the same word and seat from a fresh subscribe and joinRoom', async () => {
    const code = await lobby(4);
    await deal(code);
    const before = await state('p2', code, (s) => s.myWord);
    await joinRoom(u.p2.db, code, u.p2.uid, 'Player2');
    const after = await state('p2', code, (s) => s.myWord);
    expect(after.myWord).toBe(before.myWord);
    expect(after.room.seats.indexOf(u.p2.uid)).toBe(before.room.seats.indexOf(u.p2.uid));
    expect(after.players.map((p) => p.uid)).toEqual(before.players.map((p) => p.uid));
  });

  it('re-entry: a benched player has no word and stays benched; the benched host has none and still runs the room', async () => {
    const code = await lobby(6);
    const { secret, room } = await deal(code, LAST_SPY);
    const out = hero(room, secret);
    await playRound(code, out);
    await afterClose(code, 1);
    await advance(u.h.db, code, FAM);
    await joinRoom(u[idOf(out)].db, code, out, 'again');
    const s = await state(idOf(out), code, (x) => x.room?.round === 2);
    expect(s.myWord).toBeNull();
    expect(s.room.heroBench).toContain(out);
    expect(s.room.seats).not.toContain(out);
  });

  it('re-entry: a removed player rejoins, not in seats until the next game', async () => {
    const code = await lobby(5);
    const { secret, room } = await deal(code, LAST_SPY);
    const out = hero(room, secret);
    await removePlayer(u.h.db, code, out);
    await joinRoom(u[idOf(out)].db, code, out, 'Back');
    const s = await state(idOf(out), code, (x) => x.players?.some((p) => p.uid === out));
    expect(s.room.seats).not.toContain(out);
    expect(s.myWord).toBeNull();
  });

  it('re-entry: host reload in result: a fresh subscribe + runRoom after 10 s advances exactly once', async () => {
    const code = await lobby(5);
    const { secret, room } = await deal(code, LAST_SPY);
    await playRound(code, hero(room, secret));
    await afterClose(code, 1);
    const clock = fakeClock();
    clock.jump(10000);
    const stop = runRoom(u.h.db, code, u.h.uid, FAM, clock);
    try {
      await voting(code, 2);
      await sleep(400);
      expect((await rawRoom(code, 'h')).round).toBe(2);
    } finally { stop(); }
  });

  it('re-entry: host reload with all votes in closes once, and in the final round ends the game', async () => {
    const code = await lobby(4);
    await deal(code);
    await asAdmin((d) => d.doc(`rooms/${code}`).update({ final: true }));
    await castAll(code, u.p1.uid);
    const stop = runRoom(u.h.db, code, u.h.uid, FAM, fakeClock());
    try {
      expect((await afterClose(code, 1)).room.phase).toBe('gameOver');
    } finally { stop(); }
  });

  it('old page refuses: a room made by this code has no active field at any phase', async () => {
    const code = await lobby(4);
    const check = async () => expect('active' in (await rawRoom(code, 'h'))).toBe(false);
    await check();
    const { secret, room } = await deal(code, LAST_SPY);
    await check();
    await playRound(code, hero(room, secret));
    await check();
    await removePlayer(u.h.db, code, secret.spyUid);
    await advance(u.h.db, code, FAM);
    expect((await rawRoom(code, 'h')).phase).toBe('gameOver');
    await check();
    await joinRoom(u.p3.db, code, u.p3.uid, 'Player3');
    await startGame(u.h.db, code, FAM);
    await check();
  });

  it('handOverGm: rejects during a round, succeeds in the lobby and at gameOver; both keep their player records', async () => {
    const code = await lobby(4);
    await deal(code);
    await expect(handOverGm(u.h.db, code, u.p1.uid)).rejects.toThrow('Round already running');
    await asAdmin((d) => d.doc(`rooms/${code}`).update({ phase: 'gameOver' }));
    await handOverGm(u.h.db, code, u.p1.uid);
    const { room, players } = await state('p2', code, (s) => s.room?.gmUid === u.p1.uid);
    expect(room.gmName).toBe('Player1');
    expect(players.map((p) => p.uid).sort()).toEqual([u.h.uid, u.p1.uid, u.p2.uid, u.p3.uid].sort());
    await expect(handOverGm(u.p1.db, code, u.p5.uid)).rejects.toThrow('Player not found');
  });

  it('handOverGm: the new host starts the game and their runRoom advances it; the old host cannot', async () => {
    const code = await lobby(4);
    await handOverGm(u.h.db, code, u.p1.uid);
    await expect(startGame(u.h.db, code, FAM)).rejects.toThrow();
    await startGame(u.p1.db, code, FAM, LAST_SPY);
    const clock = fakeClock();
    const stop = runRoom(u.p1.db, code, u.p1.uid, FAM, clock);
    try {
      const room = await rawRoom(code, 'p1');
      for (const id of room.roundPlayers) await castVote(u[idOf(id)].db, code, id, id === u.p2.uid ? u.p3.uid : u.p2.uid);
      await until(async () => (await rawRoom(code, 'p1')).phase === 'result');
      await clock.tick();
      await until(async () => (await rawRoom(code, 'p1')).round === 2);
    } finally { stop(); }
  });

  it('leaveRoom removes the player from the list', async () => {
    const code = await lobby(4);
    await leaveRoom(u.p2.db, code, u.p2.uid);
    const s = await state('h', code, (x) => x.players?.length === 3);
    expect(s.players.map((p) => p.uid)).not.toContain(u.p2.uid);
  });

  it('stall: a player leaves mid-game: record gone, still in seats, waiting names them, removing them works', async () => {
    const code = await lobby(5);
    const { room } = await deal(code, LAST_SPY);
    await leaveRoom(u.p2.db, code, u.p2.uid);
    for (const id of room.roundPlayers.filter((x) => x !== u.p2.uid)) await castVote(u[idOf(id)].db, code, id, room.roundPlayers.find((x) => x !== id && x !== u.p2.uid));
    const s = await state('p1', code, (x) => x.players?.length === 4);
    expect(s.room.seats).toContain(u.p2.uid);
    expect(s.waiting).toEqual([u.p2.uid]);
    await removePlayer(u.h.db, code, u.p2.uid);
    const { room: after } = await state('h', code, (x) => x.room?.phase === 'result');
    expect(after.result).toMatchObject({ voided: true, outUid: u.p2.uid });
    expect(after.seats).not.toContain(u.p2.uid);
  });

  it('leaveRoom refuses the host; deleteRoom is their way out; a player may still leave', async () => {
    const code = await lobby(2);
    await expect(leaveRoom(u.h.db, code, u.h.uid)).rejects.toThrow('Hand the room over first');
    expect((await state('p1', code, (x) => x.players?.length === 2)).players).toHaveLength(2);
    await leaveRoom(u.p1.db, code, u.p1.uid);
    expect(await deleteRoom(u.h.db, code)).toBe(true);
  });

  it('castVote by someone not in this round, or with no player record, says Not in this round, not Bad clock', async () => {
    const code = await lobby(4);
    await deal(code);
    await joinRoom(u.p4.db, code, u.p4.uid, 'Late');
    await expect(castVote(u.p4.db, code, u.p4.uid, u.p1.uid)).rejects.toThrow('Not in this round');
    await leaveRoom(u.p1.db, code, u.p1.uid);
    await expect(castVote(u.p1.db, code, u.p1.uid, u.p2.uid)).rejects.toThrow('Not in this round');
  });

  it('no repeat when the pair changes mid-game: a new word set differs from every earlier pair in the room', async () => {
    const code = await lobby(6);
    const pairs = [];
    let secret = (await deal(code, LAST_SPY)).secret;
    for (let n = 1; n <= 3; n++) {
      pairs.push([secret.common, secret.spy].sort().join('/'));
      await playRound(code, secret.spyUid);
      await afterClose(code, n);
      await advance(u.h.db, code, FAM);
      await voting(code, n + 1);
      secret = await secretOf(code);
    }
    pairs.push([secret.common, secret.spy].sort().join('/'));
    expect(new Set(pairs).size).toBe(4);
    expect((await usedOf(code)).keys).toHaveLength(4);
  });

  it('removePlayer of the host rejects Hand the room over first', async () => {
    const code = await lobby(4);
    await expect(removePlayer(u.h.db, code, u.h.uid)).rejects.toThrow('Hand the room over first');
    await deal(code);
    await expect(removePlayer(u.h.db, code, u.h.uid)).rejects.toThrow('Hand the room over first');
    expect((await rawRoom(code, 'h')).phase).toBe('voting');
  });

  it('deleteRoom, host alone: room, secret, used and the host record are gone; the lock remains', async () => {
    const code = await createRoom(u.h.db, u.h.uid, 'Gina');
    await asAdmin(async (d) => { await d.doc(`rooms/${code}/gm/secret`).set({ common: 'a' }); await d.doc(`rooms/${code}/gm/used`).set({ keys: [] }); });
    expect(await deleteRoom(u.h.db, code)).toBe(true);
    expect(await rawRoom(code, 'h')).toBeUndefined();
    await asAdmin(async (d) => {
      for (const p of ['gm/secret', 'gm/used', `players/${u.h.uid}`]) expect((await d.doc(`rooms/${code}/${p}`).get()).exists).toBe(false);
      expect((await d.doc(`rooms/${code}/gm/lock`).get()).exists).toBe(true);
    });
  });

  it('deleteRoom with another player returns false and deletes nothing', async () => {
    const code = await lobby(2);
    await asAdmin((d) => d.doc(`rooms/${code}/gm/used`).set({ keys: [] }));
    expect(await deleteRoom(u.h.db, code)).toBe(false);
    expect(await rawRoom(code)).toBeDefined();
    await asAdmin(async (d) => {
      expect((await d.doc(`rooms/${code}/players/${u.h.uid}`).get()).exists).toBe(true);
      expect((await d.doc(`rooms/${code}/gm/used`).get()).exists).toBe(true);
    });
  });

  it('deleteRoom refuses mid-game even with only the host\'s record left', async () => {
    const code = await lobby(4);
    await deal(code);
    await asAdmin(async (d) => { for (const p of ['p1', 'p2', 'p3']) await d.doc(`rooms/${code}/players/${u[p].uid}`).delete(); });
    expect(await deleteRoom(u.h.db, code)).toBe(false);
    expect(await rawRoom(code)).toBeDefined();
    await asAdmin((d) => d.doc(`rooms/${code}`).update({ phase: 'gameOver' }));
    expect(await deleteRoom(u.h.db, code)).toBe(true);
  });

  it('deals to 15 people: all get a word, exactly one differs', async () => {
    const extra = Array.from({ length: 14 }, (_, i) => `q${i}`);
    for (const n of extra) {
      const { auth, db } = initFirebase(config, { emulator: true, name: n });
      u[n] = { auth, db, uid: await signIn(auth) };
    }
    try {
      const code = await createRoom(u.h.db, u.h.uid, 'Gina');
      for (const n of extra) await joinRoom(u[n].db, code, u[n].uid, n.toUpperCase());
      await startGame(u.h.db, code, FAM);
      const { common, spy } = await secretOf(code);
      const words = [(await state('h', code, (s) => s.myWord)).myWord];
      for (const n of extra) words.push((await state(n, code, (s) => s.myWord)).myWord);
      expect(words.filter((w) => w === common).length).toBe(14);
      expect(words.filter((w) => w === spy).length).toBe(1);
    } finally {
      await Promise.all(extra.map((n) => deleteApp(u[n].auth.app)));
    }
  });
});

describe('runRoom: the room runs itself from the host phone', { timeout: 30000 }, () => {
  const run = (code, clock) => runRoom(u.h.db, code, u.h.uid, FAM, { ...clock, rand: LAST_SPY });

  it('automatic round: the last vote brings the result without any call; 10 s later the next round starts', async () => {
    const code = await lobby(5);
    const clock = fakeClock();
    const stop = run(code, clock);
    try {
      const { room } = await deal(code, LAST_SPY);
      await castAll(code, hero(room, await secretOf(code)));
      await until(async () => (await rawRoom(code, 'h')).phase === 'result');
      await clock.tick();
      await until(async () => (await rawRoom(code, 'h')).round === 2);
      expect((await rawRoom(code, 'h')).phase).toBe('voting');
    } finally { stop(); }
  });

  it('whole game from 5: only startGame by hand; it reaches gameOver with a winner; every state stays clean', async () => {
    const code = await lobby(5);
    const clock = fakeClock();
    const stop = run(code, clock);
    const watchers = ['h', 'p1', 'p2'].map((n) => watch(n, code));
    let secret;
    try {
      ({ secret } = await deal(code, LAST_SPY));
      for (let round = 1; ; round++) {
        const room = await until(async () => { const r = await rawRoom(code, 'h'); return r.phase === 'voting' && r.round === round && r; });
        for (const id of room.roundPlayers) await castVote(u[idOf(id)].db, code, id, room.roundPlayers.find((x) => x !== id && x !== secret.spyUid));
        const end = await until(async () => { const r = await rawRoom(code, 'p3'); return r.round === round && r.phase !== 'voting' && r; });
        await expectNoSecrets(code).catch(() => { if (end.phase !== 'gameOver') throw new Error('leak'); });
        if (end.phase === 'gameOver') {
          expect(end.winner).toBe('spies');
          expect(round).toBe(3);
          break;
        }
        await clock.tick();
      }
      await sleep(200);
    } finally { stop(); watchers.forEach((w) => w.off()); }
    watchers.forEach((w) => expectStatesClean(w.seen, secret));
    const [{ seen }] = watchers;
    const fin = seen.at(-1);
    expect(fin.room.phase).toBe('gameOver');
    expect('votesCast' in fin).toBe(true);
    expect('votesCast' in watchers[1].seen.at(-1)).toBe(false);
  });

  it('host voted out: the host is benched; runRoom still closes and advances the following round', async () => {
    const code = await lobby(5);
    const clock = fakeClock();
    const stop = run(code, clock);
    try {
      await deal(code, LAST_SPY);
      await castAll(code, u.h.uid);
      const { room } = await afterClose(code, 1);
      expect(room.result.outUid).toBe(u.h.uid);
      expect(room.heroBench).toContain(u.h.uid);
      await clock.tick();
      const r2 = (await voting(code, 2)).room;
      expect(r2.seats).not.toContain(u.h.uid);
      await castAll(code, r2.seats.find((x) => x !== r2.roundPlayers[0]));
      await afterClose(code, 2);
      await clock.tick();
      await voting(code, 3);
    } finally { stop(); }
  });

  it('stall: a non-voter: the phase stays voting, waiting names them; removePlayer voids the round; after the wait the next round starts', async () => {
    const code = await lobby(5);
    const clock = fakeClock();
    const stop = run(code, clock);
    try {
      const { room } = await deal(code, LAST_SPY);
      await castAll(code, u.p1.uid, room.roundPlayers.filter((x) => x !== u.p3.uid));
      await sleep(500);
      expect((await rawRoom(code, 'h')).phase).toBe('voting');
      expect((await state('p2', code, (s) => s.waiting.length === 1)).waiting).toEqual([u.p3.uid]);
      await removePlayer(u.h.db, code, u.p3.uid);
      expect((await afterClose(code, 1)).room.result).toMatchObject({ voided: true, outUid: u.p3.uid });
      await clock.tick();
      expect((await voting(code, 2)).room.seats).toHaveLength(4);
    } finally { stop(); }
  });

  it('stall: host asleep then awake: nothing changes while stopped; starting runRoom closes once; an old result advances at once', async () => {
    const code = await lobby(5);
    const { secret, room } = await deal(code, LAST_SPY);
    await castAll(code, hero(room, secret));
    await sleep(500);
    expect((await rawRoom(code, 'h')).phase).toBe('voting');
    let stop = run(code, fakeClock());
    try {
      const r1 = (await afterClose(code, 1)).room;
      await sleep(300);
      expect((await rawRoom(code, 'h')).score).toEqual({ heroes: 0, spies: 1 });
      expect(r1.phase).toBe('result');
    } finally { stop(); }
    await asAdmin((d) => d.doc(`rooms/${code}`).update({ resultAt: Date.now() - 11000 }));
    stop = run(code, fakeClock());
    try {
      await voting(code, 2);
    } finally { stop(); }
  });

  it('stall: a second tab: two runRoom loops on one room give one result per round, the round number moves by 1', async () => {
    const code = await lobby(5);
    const clock = fakeClock();
    const stopA = run(code, clock);
    const stopB = run(code, clock);
    try {
      const { room, secret } = await deal(code, LAST_SPY);
      await castAll(code, hero(room, secret));
      const r1 = (await afterClose(code, 1)).room;
      await sleep(300);
      expect((await rawRoom(code, 'h')).score).toEqual({ heroes: 0, spies: 1 });
      await clock.tick();
      await voting(code, 2);
      await sleep(400);
      expect(await rawRoom(code, 'h')).toMatchObject({ round: 2, phase: 'voting' });
      expect(r1.score).toEqual({ heroes: 0, spies: 1 });
    } finally { stopA(); stopB(); }
  });

  it('no busy loop: a failing step reports once, retries no faster than 5 s with one timer pending, and recovery clears it', async () => {
    const code = await lobby(5);
    const { secret } = await deal(code, LAST_SPY);
    await castAll(code, secret.spyUid);
    await closeVoting(u.h.db, code);
    await afterClose(code, 1);
    const clock = fakeClock();
    clock.jump(10000);
    const errors = [];
    // No word families yet: dealing new words (the spy was caught) throws every time.
    const fam = [];
    const stop = runRoom(u.h.db, code, u.h.uid, fam, { ...clock, onError: (e) => errors.push(e) });
    try {
      await until(() => errors.length);
      await sleep(500);
      expect(clock.timers).toHaveLength(1);
      expect(clock.calls).toBe(1);
      expect(clock.timers[0].ms).toBeGreaterThanOrEqual(5000);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBeInstanceOf(Error);
      // The retry fails the same way: not reported again.
      clock.timers.splice(0).forEach((t) => t.fn());
      await until(() => clock.timers.length);
      expect(errors).toHaveLength(1);
      expect((await rawRoom(code, 'h')).phase).toBe('result');
      // Families appear: the next retry succeeds and clears the error.
      fam.push(...FAM);
      clock.timers.splice(0).forEach((t) => t.fn());
      await until(() => errors.length === 2);
      expect(errors[1]).toBeNull();
      await until(async () => (await rawRoom(code, 'h')).phase === 'voting');
    } finally { stop(); }
  });

  it('runRoom leaves alone a loop for a uid that is not the host (after a hand-over), and a room with no seats array', async () => {
    const code = await lobby(4);
    const { room, secret } = await deal(code, LAST_SPY);
    await castAll(code, hero(room, secret));
    const clock = fakeClock();
    const stop = runRoom(u.p1.db, code, u.p1.uid, FAM, clock);
    try {
      await sleep(600);
      expect((await rawRoom(code, 'h')).phase).toBe('voting');
    } finally { stop(); }
    const old = 'OLDR';
    await setDoc(doc(u.h.db, 'rooms', old), { gmUid: u.h.uid, gmName: 'Gina', phase: 'voting', round: 1, roundPlayers: ['a'], active: ['a'], result: null });
    const stop2 = runRoom(u.h.db, old, u.h.uid, FAM, fakeClock());
    try {
      await sleep(600);
      expect((await rawRoom(old, 'h')).phase).toBe('voting');
    } finally { stop2(); }
  });

  it('stopping runRoom stops it', async () => {
    const code = await lobby(5);
    const { secret, room } = await deal(code, LAST_SPY);
    const stop = run(code, fakeClock());
    stop();
    await castAll(code, hero(room, secret));
    await sleep(500);
    expect((await rawRoom(code, 'h')).phase).toBe('voting');
  });
});

describe('room cleanup', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const near = (ts, ms) => Math.abs(ts.toMillis() - (Date.now() + ms)) < 60000;
  const read = async (code, path, who = 'h') => (await getDoc(doc(u[who].db, 'rooms', code, ...path))).data();
  // Runs fn and checks the room's expiresAt moved later and is about 24 hours ahead.
  const moves = async (code, fn) => {
    const before = (await rawRoom(code)).expiresAt;
    await sleep(15);
    await fn();
    const after = (await rawRoom(code)).expiresAt;
    expect(after.toMillis()).toBeGreaterThan(before.toMillis());
    expect(near(after, DAY)).toBe(true);
  };

  it('createRoom sets expiresAt about 24 hours ahead', async () => {
    const code = await createRoom(u.h.db, u.h.uid, 'Gina');
    expect(near((await rawRoom(code)).expiresAt, DAY)).toBe(true);
  });

  it('every host action moves expiresAt', async () => {
    const code = await lobby(6);
    await moves(code, () => startGame(u.h.db, code, FAM, LAST_SPY));
    const room = await rawRoom(code);
    const secret = await secretOf(code);
    const out = hero(room, secret);
    await castAll(code, out);
    await moves(code, () => closeVoting(u.h.db, code));
    await moves(code, () => advance(u.h.db, code, FAM));
    await moves(code, () => removePlayer(u.h.db, code, room.seats.find((x) => x !== out && x !== secret.spyUid && x !== u.h.uid)));
  });

  it('removePlayer in the lobby, handOverGm, and the end-of-game write move expiresAt', async () => {
    const code = await lobby(3);
    await moves(code, () => removePlayer(u.h.db, code, u.p2.uid));
    await moves(code, () => handOverGm(u.h.db, code, u.p1.uid));
    const code2 = await lobby(4);
    await deal(code2);
    await asAdmin((d) => d.doc(`rooms/${code2}`).update({ phase: 'result', seats: [u.p1.uid, u.p2.uid] }));
    await moves(code2, () => advance(u.h.db, code2, FAM)); // fewer than 3 left: the end-of-game write
    expect((await rawRoom(code2)).phase).toBe('gameOver');
  });

  it('records under a room carry expiresAt about 7 days ahead, the host record and gm/used too', async () => {
    const code = await lobby(4);
    const { room } = await deal(code);
    await castVote(u.p1.db, code, u.p1.uid, u.p2.uid);
    const week = 7 * DAY;
    for (const path of [['players', u.h.uid], ['players', u.p1.uid], ['private', u.p1.uid], ['gm', 'secret'], ['gm', 'used'], ['votes', `${room.round}_${u.p1.uid}`]]) {
      expect(near((await read(code, path)).expiresAt, week)).toBe(true);
    }
  });

  it("a rejoin keeps the player's expiresAt", async () => {
    const code = await lobby(2);
    const before = (await read(code, ['players', u.p1.uid])).expiresAt;
    await sleep(15);
    await joinRoom(u.p1.db, code, u.p1.uid, 'Renamed');
    const after = await read(code, ['players', u.p1.uid]);
    expect(after.name).toBe('Renamed');
    expect(after.expiresAt.isEqual(before)).toBe(true);
  });

  it('second day: a host action moves the room ahead and the player list is intact', async () => {
    const code = await lobby(4);
    const yesterday = new Date(Date.now() - DAY);
    await asAdmin(async (d) => {
      await d.doc(`rooms/${code}`).update({ expiresAt: yesterday });
      await d.doc(`rooms/${code}/players/${u.p1.uid}`).update({ expiresAt: yesterday });
    });
    await deal(code);
    expect(near((await rawRoom(code)).expiresAt, DAY)).toBe(true);
    expect((await state('h', code)).players.map((p) => p.uid)).toContain(u.p1.uid);
  });

  it('a gone room reads as null for the host, a seated player, a benched player and a late joiner', async () => {
    const code = await lobby(6);
    const { room, secret } = await deal(code, LAST_SPY);
    const out = hero(room, secret);
    await playRound(code, out);
    await afterClose(code, 1);
    await asAdmin((d) => d.doc(`rooms/${code}`).delete());
    const seated = idOf(room.seats.find((x) => x !== out && x !== u.h.uid));
    for (const who of ['h', seated, idOf(out), 'p6']) {
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
      vi.spyOn(Date, 'now').mockReturnValue(real - 9 * DAY);
      await expect(castVote(u.p1.db, code, u.p1.uid, u.p2.uid)).rejects.toThrow('Bad clock');
    } finally { spy.mockRestore(); }
  });

  it("closeVoting's final-round branch moves expiresAt", async () => {
    const code = await lobby(4);
    const { room, secret } = await deal(code);
    await asAdmin((d) => d.doc(`rooms/${code}`).update({ final: true }));
    await castAll(code, room.seats.find((x) => x !== secret.spyUid));
    await moves(code, () => closeVoting(u.h.db, code));
    expect((await rawRoom(code)).phase).toBe('gameOver');
  });

  it('gm/lock: exists after createRoom, about 40 days ahead, and moves on a host action', async () => {
    const code = await lobby(4);
    const first = (await read(code, ['gm', 'lock'])).expiresAt;
    expect(near(first, 40 * DAY)).toBe(true);
    await sleep(15);
    await deal(code);
    expect((await read(code, ['gm', 'lock'])).expiresAt.toMillis()).toBeGreaterThan(first.toMillis());
  });

  it('after deleteRoom the code cannot be created again, but createRoom still succeeds with another code', async () => {
    const code = await createRoom(u.h.db, u.h.uid, 'Gina');
    expect(await deleteRoom(u.h.db, code)).toBe(true);
    await asAdmin(async (d) => expect((await d.doc(`rooms/${code}/gm/lock`).get()).exists).toBe(true));
    await expect(setDoc(doc(u.h.db, 'rooms', code), { gmUid: u.h.uid, expiresAt: Timestamp.fromMillis(Date.now() + DAY) })).rejects.toThrow();
    expect(await rawRoom(code, 'h')).toBeUndefined();
    const other = await createRoom(u.h.db, u.h.uid, 'Gina');
    expect(other).not.toBe(code);
  });

  it('a host whose clock is 2 days slow is refused with Bad clock and nothing changes', async () => {
    const code = await lobby(4);
    const before = await rawRoom(code);
    const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() - 2 * DAY);
    try {
      await expect(startGame(u.h.db, code, FAM)).rejects.toThrow('Bad clock');
      await expect(createRoom(u.h.db, u.h.uid, 'Gina')).rejects.toThrow('Bad clock');
    } finally { spy.mockRestore(); }
    expect(await rawRoom(code)).toEqual(before);
  });

  it("touchPlayer moves a player's expiresAt; with no player doc it does nothing and does not throw", async () => {
    const code = await lobby(2);
    const before = (await read(code, ['players', u.p1.uid])).expiresAt;
    await sleep(15);
    await touchPlayer(u.p1.db, code, u.p1.uid);
    const after = (await read(code, ['players', u.p1.uid])).expiresAt;
    expect(after.toMillis()).toBeGreaterThan(before.toMillis());
    await expect(touchPlayer(u.p2.db, code, u.p2.uid)).resolves.toBeUndefined();
    expect(await read(code, ['players', u.p2.uid])).toBeUndefined();
  });

  it('createRoom skips a code that has leftover player docs', async () => {
    await asAdmin((d) => d.doc('rooms/LEFT/players/ghost').set({ name: 'Ghost', joinedAt: new Date() }));
    const codes = ['LEFT'];
    const code = await createRoom(u.h.db, u.h.uid, 'Gina', () => codes.shift() ?? newRoomCode());
    expect(code).not.toBe('LEFT');
    expect(codes).toEqual([]);
    expect(await rawRoom('LEFT', 'h')).toBeUndefined();
  });
});
