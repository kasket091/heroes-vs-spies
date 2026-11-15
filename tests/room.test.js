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
// With this rand the host (first in the game) is the carrier.
const HOST_CARRIER = () => 0;
// With this rand the last player is the carrier, so the host is a Hero in a room of 2 or more.
const LAST_CARRIER = () => 0.99;
const hero = (room, secret) => room.inGame.find((x) => x !== secret.carrierUid && x !== u.h.uid);
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

const ROOM_KEYS = ['gmUid', 'gmName', 'round', 'roundPlayers', 'starterUid', 'result', 'phase', 'inGame', 'out', 'gone', 'points', 'names', 'wordSet', 'final', 'resultAt', 'expiresAt', 'ranking'];
const WORDS = /\b(cat|dog|cow|pig)\b/;
// A room doc as a player reads it during a vote: only known fields, no carrier, no word, no result, no used pair.
const expectVotingRecordClean = async (code) => {
  const room = await rawRoom(code);
  expect(room.phase).toBe('voting');
  expect(Object.keys(room).filter((k) => !ROOM_KEYS.includes(k))).toEqual([]);
  expect('seats' in room || 'active' in room).toBe(false);
  expect(room.result).toBeNull();
  expect(JSON.stringify(room)).not.toMatch(/carrier|\d+:\d+-\d+/i);
  expect(JSON.stringify(room)).not.toMatch(WORDS);
  return room;
};
// Records every state `who` is handed.
const STATE_KEYS = ['room', 'players', 'myWord', 'myVote', 'waiting', 'votesCast'];
const watch = (who, code) => {
  const seen = [];
  const off = subscribe(u[who].db, code, u[who].uid, (s) => seen.push(s));
  return { seen, off };
};
// While a round is being voted, no state names the carrier or holds the other word; `secrets` is { wordSet: gm/secret }.
const expectStatesClean = (seen, secrets) => {
  expect(seen.length).toBeGreaterThan(0);
  for (const s of seen) {
    expect(Object.keys(s).filter((k) => !STATE_KEYS.includes(k))).toEqual([]);
    const text = JSON.stringify(s);
    expect(text).not.toMatch(/\d+:\d+-\d+/);
    expect(text).not.toContain('"seats"');
    const sec = secrets[s.room?.wordSet];
    if (!sec || s.room.phase !== 'voting') continue;
    expect(s.room.result).toBeNull();
    expect(text).not.toContain('carrier');
    const hidden = s.myWord ? [s.myWord === sec.common ? sec.odd : sec.common] : [sec.common, sec.odd];
    for (const w of hidden) expect(text).not.toContain(`"${w}"`);
  }
};
const sum = (obj) => Object.values(obj).reduce((n, x) => n + x, 0);
// The structure of a value with every string, uid and clock reading made anonymous.
const shape = (v) => {
  if (v === null || v === undefined) return v ?? 'undef';
  if (typeof v === 'string') return 's';
  if (typeof v !== 'object') return v;
  if (typeof v.toMillis === 'function') return 'ts';
  if (Array.isArray(v)) return v.map(shape);
  return Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, shape(x)]));
};
// Votes a whole round the quiet way: everyone names someone who is not the carrier (the carrier names anyone else).
const notCarrier = (room, secret, id) => room.roundPlayers.find((x) => x !== id && x !== secret.carrierUid);
// Plays a running room (runRoom on its host) to game over; returns what each round showed.
const playOut = async (code, clock, vote = notCarrier) => {
  const log = [];
  for (;;) {
    const room = await until(async () => { const r = await rawRoom(code, 'h'); return r.phase === 'voting' && r.round > (log.at(-1)?.room.round ?? 0) && r; });
    const secret = await secretOf(code);
    await expectVotingRecordClean(code);
    for (const id of room.roundPlayers) await castVote(u[idOf(id)].db, code, id, vote(room, secret, id));
    const end = await until(async () => { const r = await rawRoom(code, 'p1'); return r.round === room.round && r.phase !== 'voting' && r; });
    log.push({ room, secret, end });
    if (end.phase === 'gameOver') return log;
    await clock.tick();
  }
};
// 4 people, round 1 votes out a Hero, then the final is dealt with `rand`. Returns the final's room and secret.
const toFinal = async (code, rand = HOST_CARRIER) => {
  const { room, secret } = await deal(code, rand);
  await playRound(code, hero(room, secret));
  await afterClose(code, 1);
  await advance(u.h.db, code, FAM, rand);
  return { room: (await voting(code, 2)).room, secret: await secretOf(code) };
};

describe('room data layer', () => {
  it('createRoom: the host is in the player list; inGame, out, gone are [], points is {}; no seats, no active', async () => {
    const code = await lobby(1);
    const s = await state('h', code, (x) => x.players?.length === 1);
    expect(s.players.map((p) => p.uid)).toEqual([u.h.uid]);
    expect(s.players[0].name).toBe('Gina');
    expect(s.room).toMatchObject({ phase: 'lobby', inGame: [], out: [], gone: [], points: {}, gmUid: u.h.uid, wordSet: 0, resultAt: null });
    expect('active' in s.room || 'seats' in s.room || 'ranking' in s.room).toBe(false);
  });

  it('createRoom then joinRoom x3 lists 4 names in join order, host first', async () => {
    const code = await lobby(4);
    const s = await state('p1', code, (x) => x.players?.length === 4);
    expect(s.players.map((p) => p.name)).toEqual(['Gina', 'Player1', 'Player2', 'Player3']);
  });

  it('joinRoom rejects unknown code', async () => {
    await expect(joinRoom(u.p1.db, 'ZZZZ', u.p1.uid, 'A')).rejects.toThrow('Room not found');
  });

  it('previous-version room: seats and no inGame (or neither) rejects Old room before writing anything; runRoom leaves it alone', async () => {
    for (const [code, extra] of [['QQQQ', { seats: [] }], ['QQQR', {}], ['QQQS', { active: [] }]]) {
      await setDoc(doc(u.h.db, 'rooms', code), { gmUid: u.h.uid, gmName: 'Gina', phase: 'lobby', round: 0, roundPlayers: [], starterUid: null, result: null, ...extra });
      await expect(joinRoom(u.p1.db, code, u.p1.uid, 'Ann')).rejects.toThrow('Old room');
      expect((await getDoc(doc(u.p1.db, 'rooms', code, 'players', u.p1.uid))).exists()).toBe(false);
    }
    const old = 'OLDR';
    await setDoc(doc(u.h.db, 'rooms', old), { gmUid: u.h.uid, gmName: 'Gina', phase: 'voting', round: 1, roundPlayers: ['a'], seats: ['a'], result: null });
    const stop = runRoom(u.h.db, old, u.h.uid, FAM, fakeClock());
    try {
      await sleep(600);
      expect((await rawRoom(old, 'h')).phase).toBe('voting');
    } finally { stop(); }
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

  it('startGame with 4 (host + 3): voting, points 0 for all four, starter first, one word differs, nothing leaks', async () => {
    const code = await lobby(4);
    const watchers = names.slice(0, 4).map((n) => watch(n, code));
    const { room, secret } = await deal(code);
    expect(room).toMatchObject({ phase: 'voting', round: 1, wordSet: 1, final: false, result: null, resultAt: null, out: [], gone: [] });
    expect(room.points).toEqual(Object.fromEntries(room.inGame.map((id) => [id, 0])));
    expect(room.inGame).toHaveLength(4);
    expect(room.inGame).toContain(u.h.uid);
    expect('ranking' in room).toBe(false);
    expect(room.roundPlayers[0]).toBe(room.starterUid);
    expect([...room.roundPlayers].sort()).toEqual([...room.inGame].sort());
    const words = [];
    for (const n of names.slice(0, 4)) words.push((await state(n, code, (s) => s.myWord)).myWord);
    expect(words.filter((w) => w === secret.odd)).toHaveLength(1);
    expect(words.filter((w) => w === secret.common)).toHaveLength(3);
    await sleep(200);
    const secrets = { [secret.wordSet]: secret };
    watchers.forEach((w) => { w.off(); expectStatesClean(w.seen, secrets); });
    await expectVotingRecordClean(code);
  });

  it('startGame at gameOver starts clean: out, gone and ranking cleared, points 0, round keeps counting', async () => {
    const code = await lobby(4);
    const { room: fin } = await toFinal(code);
    await castAll(code, fin.roundPlayers[0]);
    await closeVoting(u.h.db, code);
    const end = (await afterClose(code, 2)).room;
    expect(end.phase).toBe('gameOver');
    expect(end.ranking).toHaveLength(4);
    await joinRoom(u.p4.db, code, u.p4.uid, 'Late');
    await startGame(u.h.db, code, FAM);
    const room = await rawRoom(code, 'h');
    expect(room).toMatchObject({ phase: 'voting', round: 3, wordSet: 3, out: [], gone: [] });
    expect('ranking' in room).toBe(false);
    expect(room.inGame).toHaveLength(5);
    expect(Object.values(room.points)).toEqual([0, 0, 0, 0, 0]);
  });

  it('host as carrier: the host state has the odd word as myWord and the same shape as a player state', async () => {
    const code = await lobby(4);
    const { secret } = await deal(code, HOST_CARRIER);
    expect(secret.carrierUid).toBe(u.h.uid);
    const h = await state('h', code, (s) => s.myWord);
    const p = await state('p1', code, (s) => s.myWord);
    expect(h.myWord).toBe(secret.odd);
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
    await expectVotingRecordClean(code);
  });

  it('no repeat in a room: with one family, 6 deals across games are 6 different pairs, the 7th works', async () => {
    const code = await lobby(4);
    const seen = new Set();
    for (let n = 0; n < 6; n++) {
      if (n) await asAdmin((d) => d.doc(`rooms/${code}`).update({ phase: 'gameOver' }));
      const { secret } = await deal(code);
      seen.add([secret.common, secret.odd].sort().join('/'));
      expect((await usedOf(code)).keys).toHaveLength(n + 1);
    }
    expect(seen.size).toBe(6);
    await asAdmin((d) => d.doc(`rooms/${code}`).update({ phase: 'gameOver' }));
    await deal(code);
    expect((await usedOf(code)).keys).toHaveLength(1);
  });

  it("voted marks carry no target; every player's waiting drops that uid", async () => {
    const code = await lobby(4);
    const { room } = await deal(code);
    const target = room.inGame.find((x) => x !== u.p1.uid);
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
    const target = room.inGame.find((id) => id !== u.p1.uid);
    expect((await state('p1', code, (s) => s.myVote !== undefined)).myVote).toBeNull();
    await castVote(u.p1.db, code, u.p1.uid, target);
    expect((await state('p1', code, (s) => s.myVote)).myVote).toBe(target);
    await castVote(u.p1.db, code, u.p1.uid, secret.carrierUid === target ? u.h.uid : secret.carrierUid); // already in: not an error, not replaced
    expect((await state('p1', code, (s) => s.myVote)).myVote).toBe(target);
    await castVote(u.h.db, code, u.h.uid, u.p1.uid);
    expect((await state('h', code, (s) => s.myVote)).myVote).toBe(u.p1.uid);
  });

  it("the host counts only current round votes, and only from this round's players; a stranger's vote never scores", async () => {
    const code = await lobby(6);
    const { room, secret } = await deal(code, LAST_CARRIER);
    await asAdmin((d) => d.doc(`rooms/${code}/votes/${room.round}_ghost`).set({ target: secret.carrierUid, round: room.round }));
    await castVote(u.p1.db, code, u.p1.uid, room.inGame.find((x) => x !== u.p1.uid));
    expect((await state('h', code, (s) => s.votesCast === 1)).votesCast).toBe(1);
    await sleep(300);
    expect((await state('h', code)).votesCast).toBe(1);
    // Four real voters and the ghost name the carrier: only the four score.
    const others = room.roundPlayers.filter((x) => x !== secret.carrierUid && x !== u.p1.uid);
    for (const id of others.slice(0, 3)) await castVote(u[idOf(id)].db, code, id, secret.carrierUid);
    await castVote(u[idOf(secret.carrierUid)].db, code, secret.carrierUid, u.p1.uid);
    await closeVoting(u.h.db, code);
    const { room: after } = await afterClose(code, 1);
    expect(after.result.gains).toEqual(Object.fromEntries(others.slice(0, 3).map((id) => [id, 1])));
    expect(after.result.outUid).toBe(secret.carrierUid);
    await advance(u.h.db, code, FAM);
    expect((await state('h', code, (s) => s.room?.round === 2)).votesCast).toBe(0);
  });

  it('healthy Hero voted out: result names the carrier and both words; gains {carrier: 2}; points updated; the Hero is out, not in', async () => {
    const code = await lobby(6);
    const { secret, room: dealt } = await deal(code, LAST_CARRIER);
    const out = hero(dealt, secret);
    await playRound(code, out);
    const { room } = await afterClose(code, 1);
    expect(room.phase).toBe('result');
    expect(room.resultAt).toBeGreaterThan(Date.now() - 20000);
    expect(room.result).toEqual({
      outUid: out, outName: nameOf(out), wasCarrier: false, voided: false, carrierUid: secret.carrierUid, carrierName: nameOf(secret.carrierUid),
      common: secret.common, odd: secret.odd, gains: { [secret.carrierUid]: 2 },
    });
    expect(room.points).toEqual({ ...Object.fromEntries(dealt.inGame.map((id) => [id, 0])), [secret.carrierUid]: 2 });
    expect(room.out).toEqual([out]);
    expect(room.inGame).not.toContain(out);
    expect(room.inGame).toHaveLength(5);
  });

  it('carrier voted out: +1 for exactly the players who voted for the carrier; the carrier is out', async () => {
    const code = await lobby(6);
    const { secret, room } = await deal(code, LAST_CARRIER);
    const heroes = room.roundPlayers.filter((x) => x !== secret.carrierUid);
    const [wrong, ...right] = heroes;
    // Four Heroes and nobody else name the carrier; one Hero and the carrier name that Hero.
    const vote = (id, t) => castVote(u[idOf(id)].db, code, id, t);
    for (const id of right) await vote(id, secret.carrierUid);
    await vote(wrong, right[0]);
    await vote(secret.carrierUid, wrong);
    await closeVoting(u.h.db, code);
    const { room: after } = await afterClose(code, 1);
    expect(after.result).toMatchObject({ outUid: secret.carrierUid, wasCarrier: true, voided: false, carrierUid: secret.carrierUid, common: secret.common, odd: secret.odd });
    expect(after.result.gains).toEqual(Object.fromEntries(right.map((id) => [id, 1])));
    expect(after.points[secret.carrierUid]).toBe(0);
    for (const id of right) expect(after.points[id]).toBe(1);
    expect(after.points[wrong]).toBe(0);
    expect(after.out).toEqual([secret.carrierUid]);
    expect(after.inGame).not.toContain(secret.carrierUid);
  });

  it('a new pair and a fresh pick every round: 7 players, no pair repeats, wordSet +1, a new word record for everyone still in, no seats', async () => {
    const code = await lobby(7);
    const clock = fakeClock();
    const stop = runRoom(u.h.db, code, u.h.uid, FAM, clock);
    const watchers = ['h', 'p1', 'p2'].map((n) => watch(n, code));
    let log;
    try {
      await deal(code, LAST_CARRIER);
      const wordSets = [];
      log = [];
      for (;;) {
        const room = await until(async () => { const r = await rawRoom(code, 'h'); return r.phase === 'voting' && r.round > (log.at(-1)?.room.round ?? 0) && r; });
        const secret = await secretOf(code);
        wordSets.push(room.wordSet);
        await expectVotingRecordClean(code);
        // A new word record for every player still in, dated to this deal.
        await asAdmin(async (d) => {
          for (const id of room.inGame) expect((await d.doc(`rooms/${code}/private/${id}`).get()).data().wordSet).toBe(room.wordSet);
        });
        for (const id of room.roundPlayers) await castVote(u[idOf(id)].db, code, id, notCarrier(room, secret, id));
        const end = await until(async () => { const r = await rawRoom(code, 'p1'); return r.round === room.round && r.phase !== 'voting' && r; });
        expect('seats' in end || 'active' in end).toBe(false);
        log.push({ room, secret, end });
        if (end.phase === 'gameOver') break;
        await clock.tick();
      }
      expect(wordSets).toEqual([1, 2, 3, 4, 5]);
      expect(log.map((l) => l.room.inGame.length)).toEqual([7, 6, 5, 4, 3]);
      expect(log.map((l) => l.room.final)).toEqual([false, false, false, false, true]);
      expect(new Set(log.map((l) => [l.secret.common, l.secret.odd].sort().join('/'))).size).toBe(5);
      expect(log.every((l) => l.room.inGame.includes(l.secret.carrierUid))).toBe(true);
      await sleep(200);
    } finally { stop(); watchers.forEach((w) => w.off()); }
    watchers.forEach((w) => expectStatesClean(w.seen, Object.fromEntries(log.map((l) => [l.secret.wordSet, l.secret]))));
  });

  it('the virus can stay: the same player is the carrier two rounds running, and nothing public or emitted differs from a round where it jumped', async () => {
    const round2 = async (rand2) => {
      const code = await lobby(5);
      const { secret: s1 } = await deal(code, HOST_CARRIER);
      await playRound(code, u.p1.uid);
      await afterClose(code, 1);
      await advance(u.h.db, code, FAM, rand2);
      const { room } = await voting(code, 2);
      const s2 = await secretOf(code);
      const emitted = {};
      for (const n of ['h', 'p1', 'p2', 'p3']) {
        emitted[n] = await state(n, code, (s) => s.room?.round === 2 && s.room.phase === 'voting' && s.players && (n === 'p1' || s.myWord));
      }
      // Every player still in has a word record of this deal, whether or not the carrier changed.
      await asAdmin(async (d) => {
        for (const id of room.inGame) expect((await d.doc(`rooms/${code}/private/${id}`).get()).data().wordSet).toBe(2);
      });
      expect(room.inGame).not.toContain(u.p1.uid);
      return { s1, s2, room, emitted };
    };
    const stay = await round2(() => 0);
    const jump = await round2(() => 0.99);
    expect(stay.s1.carrierUid).toBe(u.h.uid);
    expect(stay.s2.carrierUid).toBe(u.h.uid);
    expect(jump.s2.carrierUid).not.toBe(u.h.uid);
    expect(shape(stay.room)).toEqual(shape(jump.room));
    for (const n of Object.keys(stay.emitted)) expect(shape(stay.emitted[n])).toEqual(shape(jump.emitted[n]));
  });

  it('starter rule from 5: with 5 in the round the carrier is never 1st or 2nd; with 4 the carrier can be 1st', async () => {
    for (let k = 0; k < 4; k++) {
      const code = await lobby(5);
      const { room, secret } = await deal(code);
      expect(room.roundPlayers.indexOf(secret.carrierUid)).toBeGreaterThanOrEqual(2);
      await asAdmin((d) => d.doc(`rooms/${code}`).update({ phase: 'gameOver' }));
    }
    const code = await lobby(4);
    const { room, secret } = await deal(code, HOST_CARRIER); // rand 0: the host is the carrier and the first speaker
    expect(secret.carrierUid).toBe(u.h.uid);
    expect(room.roundPlayers[0]).toBe(u.h.uid);
  });

  it('tie: with rand fixed the drawn tied player is out and the points follow from who that was', async () => {
    const code = await lobby(4);
    const { room, secret } = await deal(code);
    const [a, b, c, d] = room.roundPlayers;
    await castVote(u[idOf(a)].db, code, a, b);
    await castVote(u[idOf(b)].db, code, b, a);
    await castVote(u[idOf(c)].db, code, c, a);
    await castVote(u[idOf(d)].db, code, d, b);
    await closeVoting(u.h.db, code, () => 0.99);
    const { room: after } = await afterClose(code, 1);
    expect(after.result.outUid).toBe(b); // a and b tied; 0.99 draws the later one in roundPlayers order
    expect('tie' in after.result).toBe(false);
    const caught = b === secret.carrierUid;
    expect(after.result.gains).toEqual(caught ? { [a]: 1, [d]: 1 } : { [secret.carrierUid]: 2 });
    expect(after.out).toEqual([b]);
  });

  it('close with no votes: a player is drawn, gains follow, they are out', async () => {
    const code = await lobby(4);
    const { room, secret } = await deal(code);
    await closeVoting(u.h.db, code);
    const { room: after } = await afterClose(code, 1);
    expect(room.inGame).toContain(after.result.outUid);
    expect(after.phase).toBe('result');
    expect(after.inGame).toHaveLength(3);
    expect(after.result.gains).toEqual(after.result.outUid === secret.carrierUid ? {} : { [secret.carrierUid]: 2 });
  });

  it('close with no votes in the final: someone is drawn, the ranking is written, the game is over', async () => {
    const code = await lobby(4);
    await toFinal(code);
    await closeVoting(u.h.db, code);
    const { room } = await afterClose(code, 2);
    expect(room.phase).toBe('gameOver');
    expect(room.ranking).toHaveLength(4);
    expect(new Set(room.ranking.map((r) => r.uid)).size).toBe(4);
    expect(room.ranking.map((r) => r.group)).toEqual(['podium', 'podium', 'podium', 'out']);
    expect(room.result.voided).toBe(false);
  });

  it('final: the virus survives: carrier +4 (not +2), place 1; the Heroes 2 and 3 by points; the voted-out player 4', async () => {
    const code = await lobby(4);
    const { room, secret } = await toFinal(code);
    const [a, b] = room.inGame.filter((x) => x !== secret.carrierUid);
    const before = (await rawRoom(code, 'h')).points;
    await asAdmin((d) => d.doc(`rooms/${code}`).update({ [`points.${a}`]: 1, [`points.${b}`]: 3 }));
    await playRound(code, a);
    const { room: end } = await afterClose(code, 2);
    expect(end.phase).toBe('gameOver');
    expect(end.result).toMatchObject({ outUid: a, wasCarrier: false, gains: { [secret.carrierUid]: 4 } });
    expect(end.points[secret.carrierUid]).toBe(before[secret.carrierUid] + 4);
    expect(end.inGame).toEqual(room.inGame);
    expect(end.out).toHaveLength(1);
    expect(end.ranking.map((r) => [r.uid, r.place, r.group])).toEqual([
      [secret.carrierUid, 1, 'podium'], [b, 2, 'podium'], [a, 3, 'podium'], [end.out[0], 4, 'out'],
    ]);
    expect(end.ranking.every((r) => r.points === end.points[r.uid] && r.name === nameOf(r.uid))).toBe(true);
  });

  it('final: the Heroes catch it: each Hero who voted for the carrier +1; the Heroes 1 and 2 by points; the carrier 3', async () => {
    const code = await lobby(4);
    const { room, secret } = await toFinal(code);
    const [a, b] = room.inGame.filter((x) => x !== secret.carrierUid);
    await asAdmin((d) => d.doc(`rooms/${code}`).update({ [`points.${a}`]: 0, [`points.${b}`]: 3, [`points.${secret.carrierUid}`]: 9 }));
    await castVote(u[idOf(a)].db, code, a, secret.carrierUid);
    await castVote(u[idOf(b)].db, code, b, secret.carrierUid);
    await castVote(u[idOf(secret.carrierUid)].db, code, secret.carrierUid, a);
    await closeVoting(u.h.db, code);
    const { room: end } = await afterClose(code, 2);
    expect(end.result).toMatchObject({ outUid: secret.carrierUid, wasCarrier: true, gains: { [a]: 1, [b]: 1 } });
    expect(end.ranking.map((r) => [r.uid, r.place, r.group])).toEqual([
      [b, 1, 'podium'], [a, 2, 'podium'], [secret.carrierUid, 3, 'podium'], [end.out[0], 4, 'out'],
    ]);
    expect(end.inGame).toEqual(room.inGame);
  });

  it('whole game by itself: only startGame by hand; reaches gameOver; every player in the ranking once; points are the sum of the gains', async () => {
    const code = await lobby(6);
    const clock = fakeClock();
    const stop = runRoom(u.h.db, code, u.h.uid, FAM, clock);
    try {
      await deal(code);
      const log = await playOut(code, clock);
      const end = log.at(-1).end;
      expect(log.map((l) => l.room.round)).toEqual([1, 2, 3, 4]);
      expect(end.ranking.map((r) => r.uid).sort()).toEqual(['h', 'p1', 'p2', 'p3', 'p4', 'p5'].map((n) => u[n].uid).sort());
      expect(sum(end.points)).toBe(log.reduce((n, l) => n + sum(l.end.result.gains), 0));
      for (const l of log) expect(l.end.result).toMatchObject({ carrierUid: l.secret.carrierUid, common: l.secret.common, odd: l.secret.odd });
    } finally { stop(); }
  });

  it('ranking is stored and stays: after gameOver players leave and are removed, the ranking is unchanged', async () => {
    const code = await lobby(4);
    await toFinal(code);
    await playRound(code, u.p2.uid);
    const { room: end } = await afterClose(code, 2);
    expect(end.phase).toBe('gameOver');
    const left = end.out[0];
    await leaveRoom(u[idOf(left)].db, code, left);
    await removePlayer(u.h.db, code, end.inGame.find((x) => x !== u.h.uid));
    const after = await rawRoom(code, 'h');
    expect(after.ranking).toEqual(end.ranking);
    expect(after.points).toEqual(end.points);
  });

  it('closeVoting twice: one result, points added once; advance twice: round moved once', async () => {
    const code = await lobby(6);
    const { secret, room } = await deal(code, LAST_CARRIER);
    await castAll(code, hero(room, secret));
    await Promise.all([closeVoting(u.h.db, code), closeVoting(u.h.db, code)]);
    const first = (await afterClose(code, 1)).room;
    expect(first.points[secret.carrierUid]).toBe(2);
    expect(sum(first.points)).toBe(2);
    await Promise.all([advance(u.h.db, code, FAM), advance(u.h.db, code, FAM)]);
    await advance(u.h.db, code, FAM);
    expect((await state('h', code)).room.round).toBe(2);
  });

  it('a late copy of a step (a round number from before) does nothing', async () => {
    const code = await lobby(6);
    const { secret, room } = await deal(code, LAST_CARRIER);
    await playRound(code, hero(room, secret));
    await afterClose(code, 1);
    await advance(u.h.db, code, FAM, undefined, 1);
    await voting(code, 2);
    await closeVoting(u.h.db, code, undefined, 1);
    await advance(u.h.db, code, FAM, undefined, 1);
    expect((await rawRoom(code, 'h'))).toMatchObject({ phase: 'voting', round: 2 });
  });

  it('a voted-out player cannot vote; a player still in can in the same round', async () => {
    const code = await lobby(6);
    const { secret, room } = await deal(code, LAST_CARRIER);
    const out = hero(room, secret);
    await playRound(code, out);
    await afterClose(code, 1);
    await advance(u.h.db, code, FAM);
    const { room: r2 } = await voting(code, 2);
    const target = r2.inGame.find((x) => x !== r2.inGame[0]);
    await expect(castVote(u[idOf(out)].db, code, out, target)).rejects.toThrow();
    await castVote(u[idOf(r2.inGame[0])].db, code, r2.inGame[0], target);
    expect((await state('h', code, (s) => s.votesCast === 1)).votesCast).toBe(1);
  });

  it('4-person game: any starter incl. the carrier; then the final at 3', async () => {
    const code = await lobby(4);
    const { secret } = await deal(code);
    const voter = u.h.uid === secret.carrierUid ? u.p1.uid : u.h.uid;
    await castVote(u[idOf(voter)].db, code, voter, secret.carrierUid);
    await closeVoting(u.h.db, code, () => 0.99);
    expect((await afterClose(code, 1)).room.inGame).toHaveLength(3);
    await advance(u.h.db, code, FAM);
    expect((await voting(code, 2)).room.final).toBe(true);
  });

  it('cancelled round, a Hero removed: voided result names the carrier and words, gains {}; the Hero is gone; the next round has a new pair and a fresh pick', async () => {
    const code = await lobby(5);
    const { secret, room } = await deal(code, LAST_CARRIER);
    const out = hero(room, secret);
    await removePlayer(u.h.db, code, out);
    const { room: after } = await state('h', code, (s) => s.room?.phase === 'result');
    expect(after.resultAt).toBeGreaterThan(Date.now() - 20000);
    expect(after.result).toEqual({
      outUid: out, outName: nameOf(out), wasCarrier: false, voided: true, carrierUid: secret.carrierUid, carrierName: nameOf(secret.carrierUid),
      common: secret.common, odd: secret.odd, gains: {},
    });
    expect(after.gone).toEqual([out]);
    expect(after.out).toEqual([]);
    expect(after.inGame).not.toContain(out);
    expect(sum(after.points)).toBe(0);
    await advance(u.h.db, code, FAM);
    const next = (await voting(code, 2)).room;
    const secret2 = await secretOf(code);
    expect([secret2.common, secret2.odd].sort()).not.toEqual([secret.common, secret.odd].sort());
    expect(next).toMatchObject({ wordSet: 2, result: null });
    expect(next.inGame).toContain(secret2.carrierUid);
    expect(next.roundPlayers).not.toContain(out);
    expect((await usedOf(code)).keys).toHaveLength(2);
  });

  it('cancelled round, the carrier removed: voided result; the next pick is among those still in', async () => {
    const code = await lobby(5);
    const { secret } = await deal(code, LAST_CARRIER);
    await removePlayer(u.h.db, code, secret.carrierUid);
    const { room: after } = await state('h', code, (s) => s.room?.phase === 'result');
    expect(after.result).toMatchObject({ voided: true, wasCarrier: true, outUid: secret.carrierUid, carrierUid: secret.carrierUid, common: secret.common, odd: secret.odd, gains: {} });
    expect(after.gone).toEqual([secret.carrierUid]);
    await advance(u.h.db, code, FAM, () => 0.99);
    const next = (await voting(code, 2)).room;
    const secret2 = await secretOf(code);
    expect(secret2.carrierUid).not.toBe(secret.carrierUid);
    expect(next.inGame).toContain(secret2.carrierUid);
  });

  it("remove a player still in during 'result': inGame shrinks and gone grows; the result, points and resultAt are unchanged", async () => {
    const code = await lobby(6);
    const { secret, room } = await deal(code, LAST_CARRIER);
    await playRound(code, hero(room, secret));
    const before = (await afterClose(code, 1)).room;
    const goner = before.inGame.find((x) => x !== secret.carrierUid && x !== u.h.uid);
    await removePlayer(u.h.db, code, goner);
    const { room: after } = await state('h', code, (s) => !s.room?.inGame.includes(goner));
    expect(after.inGame).toEqual(before.inGame.filter((x) => x !== goner));
    expect(after.gone).toEqual([goner]);
    expect({ ...after, inGame: 0, gone: 0, expiresAt: 0 }).toEqual({ ...before, inGame: 0, gone: 0, expiresAt: 0 });
  });

  it('removing someone voted out deletes only their record', async () => {
    const code = await lobby(6);
    const { secret, room } = await deal(code, LAST_CARRIER);
    const out = hero(room, secret);
    await playRound(code, out);
    const before = (await afterClose(code, 1)).room;
    await removePlayer(u.h.db, code, out);
    const after = await rawRoom(code, 'h');
    expect({ ...after, expiresAt: 0 }).toEqual({ ...before, expiresAt: 0 });
    expect((await getDoc(doc(u.h.db, 'rooms', code, 'players', out))).exists()).toBe(false);
  });

  it('removal below 3: the next advance writes the ranking with no podium group, phase gameOver, nothing dealt', async () => {
    const code = await lobby(4);
    await deal(code);
    await removePlayer(u.h.db, code, u.p1.uid);
    await removePlayer(u.h.db, code, u.p2.uid);
    await state('h', code, (s) => s.room?.inGame.length === 2);
    await advance(u.h.db, code, FAM);
    const { room: end } = await state('h', code, (s) => s.room?.phase === 'gameOver');
    expect(end).toMatchObject({ wordSet: 1, round: 1, out: [], gone: [u.p1.uid, u.p2.uid] });
    expect(end.ranking.map((r) => r.group)).toEqual(['out', 'out', 'gone', 'gone']);
    expect(end.ranking.map((r) => r.place)).toEqual([1, 1, 3, 3]);
    expect(new Set(end.ranking.map((r) => r.uid)).size).toBe(4);
  });

  it('late joiner mid-game: in players, not in inGame, myWord null; dealt in by the next new game with a clean slate', async () => {
    const code = await lobby(4);
    await deal(code);
    await joinRoom(u.p4.db, code, u.p4.uid, 'Late');
    const s = await state('p4', code, (x) => x.players?.length === 5);
    expect(s.room.inGame).not.toContain(u.p4.uid);
    expect(s.myWord).toBeNull();
    await asAdmin((d) => d.doc(`rooms/${code}`).update({ phase: 'gameOver' }));
    await startGame(u.h.db, code, FAM);
    const { room } = await state('h', code, (x) => x.room?.phase === 'voting' && x.room.wordSet === 2);
    expect(room).toMatchObject({ out: [], gone: [], round: 2 });
    expect(room.inGame).toHaveLength(5);
    expect(room.inGame).toContain(u.p4.uid);
    expect(room.points[u.p4.uid]).toBe(0);
  });

  it('re-entry: a player in the round gets the same word and place from a fresh subscribe and joinRoom', async () => {
    const code = await lobby(4);
    await deal(code);
    const before = await state('p2', code, (s) => s.myWord);
    await joinRoom(u.p2.db, code, u.p2.uid, 'Player2');
    const after = await state('p2', code, (s) => s.myWord);
    expect(after.myWord).toBe(before.myWord);
    expect(after.room.inGame.indexOf(u.p2.uid)).toBe(before.room.inGame.indexOf(u.p2.uid));
    expect(after.players.map((p) => p.uid)).toEqual(before.players.map((p) => p.uid));
  });

  it('re-entry: a voted-out player has no word, still sees the points, and joinRoom again changes nothing', async () => {
    const code = await lobby(6);
    const { secret, room } = await deal(code, LAST_CARRIER);
    const out = hero(room, secret);
    await playRound(code, out);
    await afterClose(code, 1);
    await advance(u.h.db, code, FAM);
    const before = await voting(code, 2);
    await joinRoom(u[idOf(out)].db, code, out, 'again');
    const s = await state(idOf(out), code, (x) => x.room?.round === 2 && x.room.phase === 'voting');
    expect(s.myWord).toBeNull();
    expect(s.room.out).toContain(out);
    expect(s.room.inGame).not.toContain(out);
    expect(s.room.points).toEqual(before.room.points);
    expect(s.room.gone).toEqual([]);
  });

  it('re-entry: a removed player rejoins: in players, not in inGame or out, still once in gone; dealt in by the next game', async () => {
    const code = await lobby(5);
    const { secret, room } = await deal(code, LAST_CARRIER);
    const out = hero(room, secret);
    await removePlayer(u.h.db, code, out);
    await joinRoom(u[idOf(out)].db, code, out, 'Back');
    const s = await state(idOf(out), code, (x) => x.players?.some((p) => p.uid === out));
    expect(s.room.inGame).not.toContain(out);
    expect(s.room.out).not.toContain(out);
    expect(s.room.gone).toEqual([out]);
    expect(s.myWord).toBeNull();
    await asAdmin((d) => d.doc(`rooms/${code}`).update({ phase: 'gameOver' }));
    await startGame(u.h.db, code, FAM);
    const next = await rawRoom(code, 'h');
    expect(next.inGame).toContain(out);
    expect(next.gone).toEqual([]);
  });

  it('re-entry: host reload in result: a fresh subscribe + runRoom after 10 s advances exactly once', async () => {
    const code = await lobby(5);
    const { secret, room } = await deal(code, LAST_CARRIER);
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

  it('re-entry: host reload with all votes in closes once, and in the final ends the game with the ranking', async () => {
    const code = await lobby(4);
    const { room: fin } = await toFinal(code);
    await castAll(code, fin.roundPlayers[0]);
    const stop = runRoom(u.h.db, code, u.h.uid, FAM, fakeClock());
    try {
      const { room } = await afterClose(code, 2);
      expect(room.phase).toBe('gameOver');
      expect(room.ranking).toHaveLength(4);
    } finally { stop(); }
  });

  it('a room made by this code has no seats and no active field at any phase of a game', async () => {
    const code = await lobby(4);
    const check = async () => { const r = await rawRoom(code, 'h'); expect('seats' in r || 'active' in r).toBe(false); };
    await check();
    const { secret, room } = await deal(code, LAST_CARRIER);
    await check();
    await playRound(code, hero(room, secret));
    await check();
    await removePlayer(u.h.db, code, secret.carrierUid);
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
    await startGame(u.p1.db, code, FAM, LAST_CARRIER);
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

  it('a player leaves mid-game: record gone, still in inGame, waiting names them, removing them voids the round and the game goes on', async () => {
    const code = await lobby(5);
    const { room } = await deal(code, LAST_CARRIER);
    await leaveRoom(u.p2.db, code, u.p2.uid);
    for (const id of room.roundPlayers.filter((x) => x !== u.p2.uid)) await castVote(u[idOf(id)].db, code, id, room.roundPlayers.find((x) => x !== id && x !== u.p2.uid));
    const s = await state('p1', code, (x) => x.players?.length === 4);
    expect(s.room.inGame).toContain(u.p2.uid);
    expect(s.waiting).toEqual([u.p2.uid]);
    await removePlayer(u.h.db, code, u.p2.uid);
    const { room: after } = await state('h', code, (x) => x.room?.phase === 'result');
    expect(after.result).toMatchObject({ voided: true, outUid: u.p2.uid, outName: 'Player2' });
    expect(after.inGame).not.toContain(u.p2.uid);
    await advance(u.h.db, code, FAM);
    const next = await rawRoom(code, 'h');
    expect(next).toMatchObject({ phase: 'voting', round: 2 });
    expect(next.roundPlayers).toHaveLength(4);
    expect(next.roundPlayers).not.toContain(u.p2.uid);
  });

  it('castVote that loses a race with the close (the round moved on) returns quietly', async () => {
    const code = await lobby(4);
    const { room, secret } = await deal(code, LAST_CARRIER);
    const out = hero(room, secret);
    const late = room.roundPlayers.find((x) => x !== out && x !== u.h.uid);
    await castAll(code, out, room.roundPlayers.filter((x) => x !== late));
    await closeVoting(u.h.db, code);
    await expect(castVote(u[idOf(late)].db, code, late, out)).resolves.toBeUndefined();
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

  it("deleteRoom refuses mid-game even with only the host's record left", async () => {
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
      const { common, odd } = await secretOf(code);
      const words = [(await state('h', code, (s) => s.myWord)).myWord];
      for (const n of extra) words.push((await state(n, code, (s) => s.myWord)).myWord);
      expect(words.filter((w) => w === common).length).toBe(14);
      expect(words.filter((w) => w === odd).length).toBe(1);
    } finally {
      await Promise.all(extra.map((n) => deleteApp(u[n].auth.app)));
    }
  });
});

describe('runRoom: the room runs itself from the host phone', { timeout: 30000 }, () => {
  const run = (code, clock) => runRoom(u.h.db, code, u.h.uid, FAM, { ...clock, rand: LAST_CARRIER });

  it('automatic round: the last vote brings the result without any call; 10 s later the next round starts', async () => {
    const code = await lobby(5);
    const clock = fakeClock();
    const stop = run(code, clock);
    try {
      const { room } = await deal(code, LAST_CARRIER);
      await castAll(code, hero(room, await secretOf(code)));
      await until(async () => (await rawRoom(code, 'h')).phase === 'result');
      await clock.tick();
      await until(async () => (await rawRoom(code, 'h')).round === 2);
      expect((await rawRoom(code, 'h')).phase).toBe('voting');
    } finally { stop(); }
  });

  it('exactly once: two host loops through a whole game: one result per round, points equal the sum of the gains', async () => {
    const code = await lobby(5);
    const clock = fakeClock();
    const stopA = runRoom(u.h.db, code, u.h.uid, FAM, clock);
    const stopB = runRoom(u.h.db, code, u.h.uid, FAM, clock);
    try {
      await deal(code);
      const log = await playOut(code, clock);
      const end = log.at(-1).end;
      expect(log.map((l) => l.room.round)).toEqual([1, 2, 3]);
      expect(sum(end.points)).toBe(log.reduce((n, l) => n + sum(l.end.result.gains), 0));
      expect(end.out).toHaveLength(1 + 1);
      await sleep(300);
      expect(await rawRoom(code, 'h')).toMatchObject({ round: 3, phase: 'gameOver', points: end.points, ranking: end.ranking });
    } finally { stopA(); stopB(); }
  });

  it('whole game: only startGame by hand; the host and a player see clean states the whole way; votesCast only for the host', async () => {
    const code = await lobby(5);
    const clock = fakeClock();
    const stop = run(code, clock);
    const watchers = ['h', 'p1', 'p2'].map((n) => watch(n, code));
    let log;
    try {
      await deal(code, LAST_CARRIER);
      log = await playOut(code, clock);
      await sleep(200);
    } finally { stop(); watchers.forEach((w) => w.off()); }
    watchers.forEach((w) => expectStatesClean(w.seen, Object.fromEntries(log.map((l) => [l.secret.wordSet, l.secret]))));
    expect(log.at(-1).end.phase).toBe('gameOver');
    expect(watchers[0].seen.at(-1).room.phase).toBe('gameOver');
    expect('votesCast' in watchers[0].seen.at(-1)).toBe(true);
    expect('votesCast' in watchers[1].seen.at(-1)).toBe(false);
  });

  it('host voted out: the host is in out; runRoom still closes and advances the following round', async () => {
    const code = await lobby(5);
    const clock = fakeClock();
    const stop = run(code, clock);
    try {
      await deal(code, LAST_CARRIER);
      await castAll(code, u.h.uid);
      const { room } = await afterClose(code, 1);
      expect(room.result.outUid).toBe(u.h.uid);
      expect(room.out).toContain(u.h.uid);
      await clock.tick();
      const r2 = (await voting(code, 2)).room;
      expect(r2.inGame).not.toContain(u.h.uid);
      await castAll(code, r2.inGame.find((x) => x !== r2.roundPlayers[0]));
      await afterClose(code, 2);
      await clock.tick();
      await voting(code, 3);
    } finally { stop(); }
  });

  it('a non-voter: the phase stays voting, waiting names them; removePlayer voids the round; after the wait the next round starts', async () => {
    const code = await lobby(5);
    const clock = fakeClock();
    const stop = run(code, clock);
    try {
      const { room } = await deal(code, LAST_CARRIER);
      await castAll(code, u.p1.uid, room.roundPlayers.filter((x) => x !== u.p3.uid));
      await sleep(500);
      expect((await rawRoom(code, 'h')).phase).toBe('voting');
      expect((await state('p2', code, (s) => s.waiting.length === 1)).waiting).toEqual([u.p3.uid]);
      await removePlayer(u.h.db, code, u.p3.uid);
      expect((await afterClose(code, 1)).room.result).toMatchObject({ voided: true, outUid: u.p3.uid });
      await clock.tick();
      expect((await voting(code, 2)).room.inGame).toHaveLength(4);
    } finally { stop(); }
  });

  it('host asleep then awake: nothing changes while stopped; starting runRoom closes once; an old result advances at once', async () => {
    const code = await lobby(5);
    const { secret, room } = await deal(code, LAST_CARRIER);
    await castAll(code, hero(room, secret));
    await sleep(500);
    expect((await rawRoom(code, 'h')).phase).toBe('voting');
    let stop = run(code, fakeClock());
    try {
      const r1 = (await afterClose(code, 1)).room;
      await sleep(300);
      const now = await rawRoom(code, 'h');
      expect(now.points).toEqual(r1.points);
      expect(now.points[secret.carrierUid]).toBe(2);
      expect(r1.phase).toBe('result');
    } finally { stop(); }
    await asAdmin((d) => d.doc(`rooms/${code}`).update({ resultAt: Date.now() - 11000 }));
    stop = run(code, fakeClock());
    try {
      await voting(code, 2);
    } finally { stop(); }
  });

  it('a second tab: two runRoom loops on one room give one result per round, the round number moves by 1', async () => {
    const code = await lobby(5);
    const clock = fakeClock();
    const stopA = run(code, clock);
    const stopB = run(code, clock);
    try {
      const { room, secret } = await deal(code, LAST_CARRIER);
      await castAll(code, hero(room, secret));
      const r1 = (await afterClose(code, 1)).room;
      await sleep(300);
      expect((await rawRoom(code, 'h')).points[secret.carrierUid]).toBe(2);
      await clock.tick();
      await voting(code, 2);
      await sleep(400);
      expect(await rawRoom(code, 'h')).toMatchObject({ round: 2, phase: 'voting' });
      expect(sum(r1.points)).toBe(2);
    } finally { stopA(); stopB(); }
  });

  it('no busy loop: a failing step reports once, retries no faster than 5 s with one timer pending, and recovery clears it', async () => {
    const code = await lobby(5);
    const { secret } = await deal(code, LAST_CARRIER);
    await castAll(code, secret.carrierUid);
    await closeVoting(u.h.db, code);
    await afterClose(code, 1);
    const clock = fakeClock();
    clock.jump(10000);
    const errors = [];
    // No word families yet: dealing the next round throws every time.
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

  it('runRoom leaves alone a loop for a uid that is not the host (after a hand-over)', async () => {
    const code = await lobby(4);
    const { room, secret } = await deal(code, LAST_CARRIER);
    await castAll(code, hero(room, secret));
    const stop = runRoom(u.p1.db, code, u.p1.uid, FAM, fakeClock());
    try {
      await sleep(600);
      expect((await rawRoom(code, 'h')).phase).toBe('voting');
    } finally { stop(); }
  });

  it('a step that fails after runRoom was stopped sets no retry timer', async () => {
    const code = await lobby(5);
    const { secret } = await deal(code, LAST_CARRIER);
    await castAll(code, secret.carrierUid);
    await closeVoting(u.h.db, code);
    await afterClose(code, 1);
    const clock = fakeClock();
    clock.jump(10000);
    let errors = 0;
    // No word families: dealing fails; the page stops the runner as the error arrives.
    const stop = runRoom(u.h.db, code, u.h.uid, [], { ...clock, onError: () => { errors += 1; stop(); } });
    await until(() => errors);
    await sleep(300);
    expect(clock.calls).toBe(0);
  });

  it('stopping runRoom stops it', async () => {
    const code = await lobby(5);
    const { secret, room } = await deal(code, LAST_CARRIER);
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
    await moves(code, () => startGame(u.h.db, code, FAM, LAST_CARRIER));
    const room = await rawRoom(code);
    const secret = await secretOf(code);
    const out = hero(room, secret);
    await castAll(code, out);
    await moves(code, () => closeVoting(u.h.db, code));
    await moves(code, () => advance(u.h.db, code, FAM));
    await moves(code, () => removePlayer(u.h.db, code, room.inGame.find((x) => x !== out && x !== secret.carrierUid && x !== u.h.uid)));
  });

  it('removePlayer in the lobby, handOverGm, and the end-of-game write move expiresAt', async () => {
    const code = await lobby(3);
    await moves(code, () => removePlayer(u.h.db, code, u.p2.uid));
    await moves(code, () => handOverGm(u.h.db, code, u.p1.uid));
    const code2 = await lobby(4);
    await deal(code2);
    await asAdmin((d) => d.doc(`rooms/${code2}`).update({ phase: 'result', inGame: [u.p1.uid, u.p2.uid] }));
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

  it('a gone room reads as null for the host, a player still in, a voted-out player and a late joiner', async () => {
    const code = await lobby(6);
    const { room, secret } = await deal(code, LAST_CARRIER);
    const out = hero(room, secret);
    await playRound(code, out);
    await afterClose(code, 1);
    await asAdmin((d) => d.doc(`rooms/${code}`).delete());
    const seated = idOf(room.inGame.find((x) => x !== out && x !== u.h.uid));
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
    const { room } = await toFinal(code);
    await castAll(code, room.inGame[1]);
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
