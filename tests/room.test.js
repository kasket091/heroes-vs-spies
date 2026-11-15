import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { deleteApp } from 'firebase/app';
import { safeStarters } from '../src/game.js';
import { initFirebase, signIn } from '../src/firebase.js';
import {
  createRoom, joinRoom, subscribe, dealRound, pickStarter, openVoting,
  castVote, closeVoting, removePlayer, handOverGm,
} from '../src/room.js';

const config = { apiKey: 'fake', projectId: 'demo-spy' };
const names = ['gm', 'p1', 'p2', 'p3', 'p4', 'p5'];
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
const deal = async (code) => {
  await dealRound(u.gm.db, code, 'cat', 'dog');
  return state('gm', code, (s) => s.secret && s.room.phase === 'clues');
};
const safeOne = (room, spyUid) => safeStarters(room.roundPlayers, spyUid)[0];
const voting = async (code) => {
  const { secret, room } = await deal(code);
  await pickStarter(u.gm.db, code, safeOne(room, secret.spyUid));
  await openVoting(u.gm.db, code);
  return secret;
};
const closeAfterCancel = (code) => removePlayer(u.gm.db, code, u.p4.uid).then(() => joinRoom(u.p4.db, code, u.p4.uid, 'Player4'));
const idOf = (uid) => names.find((n) => u[n].uid === uid);

describe('room data layer', () => {
  it('createRoom then joinRoom x4 lists 4 names in join order', async () => {
    const code = await lobby(4);
    const s = await state('p1', code, (x) => x.players?.length === 4);
    expect(s.players.map((p) => p.name)).toEqual(['Player1', 'Player2', 'Player3', 'Player4']);
    expect(s.room.phase).toBe('lobby');
  });

  it('joinRoom rejects unknown code', async () => {
    await expect(joinRoom(u.p1.db, 'ZZZZ', u.p1.uid, 'A')).rejects.toThrow('Room not found');
  });

  it("joinRoom with '   ' rejects with Name needed", async () => {
    const code = await lobby(0);
    await expect(joinRoom(u.p1.db, code, u.p1.uid, '   ')).rejects.toThrow('Name needed');
  });

  it('dealRound with 3 players rejects', async () => {
    const code = await lobby(3);
    await expect(dealRound(u.gm.db, code, 'cat', 'dog')).rejects.toThrow('Not enough players');
  });

  it('dealRound with 4 deals words, one differs, players cannot see secret', async () => {
    const code = await lobby(4);
    await deal(code);
    const words = [];
    for (let i = 1; i <= 4; i++) words.push((await state(`p${i}`, code, (s) => s.myWord)).myWord);
    expect(words.every((w) => ['cat', 'dog'].includes(w))).toBe(true);
    const counts = words.filter((w) => w === words[0]).length;
    expect([1, 3]).toContain(counts);
    const s1 = await state('p1', code, (s) => s.myWord);
    expect(s1.secret).toBeNull();
    expect(s1.room.phase).toBe('clues');
  });

  it('pickStarter in lobby rejects with No round to start', async () => {
    const code = await lobby(4);
    await expect(pickStarter(u.gm.db, code, u.p1.uid)).rejects.toThrow('No round to start');
  });

  it('gm never sees a secret from another round after a second dealRound', async () => {
    const code = await lobby(4);
    await deal(code);
    await closeAfterCancel(code);
    const seen = [];
    const off = subscribe(u.gm.db, code, u.gm.uid, (s) => seen.push(s));
    await dealRound(u.gm.db, code, 'sun', 'moon');
    await state('gm', code, (s) => s.secret?.round === 2);
    off();
    expect(seen.some((s) => s.room?.round === 2 && s.secret)).toBe(true);
    expect(seen.filter((s) => s.secret).every((s) => s.secret.round === s.room.round)).toBe(true);
  });

  it('pickStarter with the spy rejects Not a safe starter', async () => {
    const code = await lobby(4);
    const { secret } = await deal(code);
    await expect(pickStarter(u.gm.db, code, secret.spyUid)).rejects.toThrow('Not a safe starter');
  });

  it('pickStarter with a safe starter puts starter first, spy at index >= 2', async () => {
    const code = await lobby(4);
    const { secret, room: dealt } = await deal(code);
    const starter = safeOne(dealt, secret.spyUid);
    await pickStarter(u.gm.db, code, starter);
    const { room } = await state('gm', code, (s) => s.room?.starterUid);
    expect(room.roundPlayers[0]).toBe(starter);
    expect(room.roundPlayers.indexOf(secret.spyUid)).toBeGreaterThanOrEqual(2);
  });

  it('rejoin keeps seat and word', async () => {
    const code = await lobby(4);
    await deal(code);
    const before = await state('p2', code, (s) => s.myWord);
    await joinRoom(u.p2.db, code, u.p2.uid, 'Player2');
    const after = await state('p2', code, (s) => s.myWord);
    expect(after.myWord).toBe(before.myWord);
    expect(after.players.map((p) => p.uid)).toEqual(before.players.map((p) => p.uid));
    expect(after.room.roundPlayers.indexOf(u.p2.uid)).toBe(before.room.roundPlayers.indexOf(u.p2.uid));
  });

  it('late joiner is not in roundPlayers and has no word', async () => {
    const code = await lobby(4);
    await deal(code);
    await joinRoom(u.p5.db, code, u.p5.uid, 'Late');
    const s = await state('p5', code, (x) => x.players?.length === 5);
    expect(s.room.roundPlayers).not.toContain(u.p5.uid);
    expect(s.myWord).toBeNull();
  });

  it('all four vote for the spy: reveal, players win', async () => {
    const code = await lobby(4);
    const secret = await voting(code);
    const ids = [1, 2, 3, 4].map((i) => u[`p${i}`].uid);
    for (const id of ids) {
      const target = id === secret.spyUid ? ids.find((x) => x !== id) : secret.spyUid;
      await castVote(u[idOf(id)].db, code, id, target);
    }
    const g = await state('gm', code, (s) => s.votesCast === 4);
    expect(g.votesCast).toBe(4);
    await closeVoting(u.gm.db, code);
    const { room } = await state('gm', code, (s) => s.room?.phase === 'reveal');
    expect(room.result.winner).toBe('players');
    expect(room.result.votedOutUid).toBe(secret.spyUid);
    const spyName = `Player${idOf(secret.spyUid).slice(1)}`;
    expect(room.result).toMatchObject({ spyName, votedOutName: spyName });
  });

  it('closeVoting twice writes one result', async () => {
    const code = await lobby(4);
    await voting(code);
    await closeVoting(u.gm.db, code);
    const first = (await state('gm', code, (s) => s.room?.phase === 'reveal')).room.result;
    await closeVoting(u.gm.db, code);
    const second = (await state('gm', code)).room.result;
    expect(second).toEqual(first);
  });

  it('closeVoting with no votes gives spy win and tie', async () => {
    const code = await lobby(4);
    await voting(code);
    await closeVoting(u.gm.db, code);
    const { room } = await state('gm', code, (s) => s.room?.phase === 'reveal');
    expect(room.result).toMatchObject({ winner: 'spy', tie: true, votedOutName: null });
    expect(room.result.spyName).toMatch(/^Player[1-4]$/);
  });

  it("removePlayer of the spy during 'clues' keeps the spy's name in the result", async () => {
    const code = await lobby(4);
    const { secret } = await deal(code);
    await removePlayer(u.gm.db, code, secret.spyUid);
    const { room, players } = await state('gm', code, (s) => s.room?.phase === 'cancelled');
    expect(players.map((p) => p.uid)).not.toContain(secret.spyUid);
    expect(room.result.spyName).toBe(`Player${idOf(secret.spyUid).slice(1)}`);
    expect(room.result.votedOutName).toBe(null);
  });

  it("removePlayer during 'clues' cancels with the secret result", async () => {
    const code = await lobby(4);
    const { secret } = await deal(code);
    await removePlayer(u.gm.db, code, u.p4.uid);
    const { room, players } = await state('gm', code, (s) => s.room?.phase === 'cancelled');
    expect(players.length).toBe(3);
    expect(room.result).toMatchObject({ winner: null, spyUid: secret.spyUid, common: 'cat', spy: 'dog' });
  });

  it('dealRound again after reveal: round 2, old votes do not count', async () => {
    const code = await lobby(4);
    const secret = await voting(code);
    const ids = [1, 2, 3, 4].map((i) => u[`p${i}`].uid);
    for (const id of ids) {
      const target = ids.find((x) => x !== id && x !== secret.spyUid) ?? ids.find((x) => x !== id);
      await castVote(u[idOf(id)].db, code, id, target);
    }
    await closeVoting(u.gm.db, code);
    await state('gm', code, (s) => s.room?.phase === 'reveal');
    const s2 = await (async () => {
      await dealRound(u.gm.db, code, 'sun', 'moon');
      return state('gm', code, (s) => s.room?.round === 2 && s.secret?.round === 2);
    })();
    expect(s2.votesCast).toBe(0);
    const spy2 = s2.secret.spyUid;
    await pickStarter(u.gm.db, code, safeOne(s2.room, spy2));
    await openVoting(u.gm.db, code);
    await closeVoting(u.gm.db, code);
    const { room } = await state('gm', code, (s) => s.room?.phase === 'reveal' && s.room.round === 2);
    expect(room.result.tie).toBe(true);
  });

  it('handOverGm to p1 swaps game master and player list', async () => {
    const code = await lobby(4);
    await handOverGm(u.gm.db, code, u.p1.uid);
    const { room, players } = await state('p2', code, (s) => s.room?.gmUid === u.p1.uid);
    expect(room.gmName).toBe('Player1');
    const ids = players.map((p) => p.uid);
    expect(ids).toContain(u.gm.uid);
    expect(ids).not.toContain(u.p1.uid);
  });
});
