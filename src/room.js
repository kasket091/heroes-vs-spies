import {
  doc, collection, query, orderBy, getDoc, getDocs, setDoc, deleteDoc, onSnapshot,
  writeBatch, runTransaction, updateDoc, serverTimestamp, where, Timestamp, deleteField,
} from 'firebase/firestore';
import {
  MIN_PLAYERS, speakingOrder, pickCarrier, pickStarter, pickUnusedPair, waitingFor, hostStep, cleanName, newRoomCode,
  whoIsOut, roundGains, ranking, stage,
} from './game.js';

export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
export const RECORD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Firestore deletes a document once its expiresAt has passed (the policy is switched on separately).
// The phone's clock is used; the rules accept any clock up to 6 days slow (records) or 12 hours slow (the room) and 23 days fast.
const roomTtl = () => ({ expiresAt: Timestamp.fromMillis(Date.now() + ROOM_TTL_MS) });
// Outlives every record under a room (the rules cap those at 30 days), so a used room code cannot be created again
// while leftovers of the old room may still exist. deleteRoom leaves it in place.
export const LOCK_TTL_MS = 40 * 24 * 60 * 60 * 1000;
const lockTtl = () => ({ expiresAt: Timestamp.fromMillis(Date.now() + LOCK_TTL_MS) });
const lockRef = (db, code) => sub(db, code, 'gm', 'lock');
// A refusal of a game master write that passes all other checks is the room's expiresAt in the past: a slow phone clock.
const asGm = async (fn) => {
  try { return await fn(); } catch (e) {
    if (e.code === 'permission-denied') throw new Error('Bad clock');
    throw e;
  }
};
// Every game master write to the room refreshes the lock in the same transaction (writes come last).
const gmTx = (db, code, fn) => asGm(() => runTransaction(db, async (tx) => {
  const result = await fn(tx);
  tx.set(lockRef(db, code), lockTtl());
  return result;
}));
const recordTtl = () => ({ expiresAt: Timestamp.fromMillis(Date.now() + RECORD_TTL_MS) });

const roomRef = (db, code) => doc(db, 'rooms', code);
const sub = (db, code, ...path) => doc(db, 'rooms', code, ...path);
const playersQuery = (db, code) => query(collection(db, 'rooms', code, 'players'), orderBy('joinedAt'));

async function getRoom(db, code) {
  const snap = await getDoc(roomRef(db, code));
  if (!snap.exists()) throw new Error('Room not found');
  return snap.data();
}

export async function createRoom(db, uid, rawName, nextCode = newRoomCode) {
  const gmName = cleanName(rawName);
  if (!gmName) throw new Error('Name needed');
  // A refused create is a code whose lock still exists (the rules hide it from us) or a past expiresAt: after a few tries, blame the clock.
  for (let refused = 0; ; ) {
    const code = nextCode();
    // Records with no expiresAt (older pages) can outlive a room and its lock: never build a room on leftovers.
    if (!(await getDocs(collection(db, 'rooms', code, 'players'))).empty) continue;
    let ok;
    try {
      ok = await runTransaction(db, async (tx) => {
        if ((await tx.get(roomRef(db, code))).exists()) return false;
        tx.set(sub(db, code, 'players', uid), { name: gmName, joinedAt: serverTimestamp(), ...recordTtl() });
        tx.set(roomRef(db, code), {
          gmUid: uid, gmName, phase: 'lobby', round: 0, roundPlayers: [], starterUid: null, result: null,
          inGame: [], out: [], gone: [], points: {}, names: {}, wordSet: 0, final: false, resultAt: null, ...roomTtl(),
        });
        return true;
      });
    } catch (e) {
      if (e.code !== 'permission-denied') throw e;
      if (++refused >= 5) throw new Error('Bad clock');
      continue;
    }
    if (ok) {
      await asGm(() => setDoc(lockRef(db, code), lockTtl()));
      return code;
    }
  }
}

export async function joinRoom(db, code, uid, rawName) {
  const name = cleanName(rawName);
  if (!name) throw new Error('Name needed');
  const room = await getRoom(db, code);
  // A room made by the version before the jumping virus: refuse before writing anything.
  if (!Array.isArray(room.inGame)) throw new Error('Old room');
  const same = (n) => n.toLowerCase() === name.toLowerCase();
  // While a game runs, its names (voted-out and removed players too) stay reserved for their own uid.
  const running = room.phase !== 'lobby' && room.phase !== 'gameOver';
  if (running && Object.entries(room.names).some(([id, n]) => id !== uid && same(n))) throw new Error('Name already taken');
  // The host already has their player record from createRoom.
  if (room.gmUid === uid) return;
  const taken = (await getDocs(playersQuery(db, code))).docs.some((d) => d.id !== uid && d.data().name.toLowerCase() === name.toLowerCase());
  if (taken) throw new Error('Name already taken');
  const ref = sub(db, code, 'players', uid);
  try {
    await runTransaction(db, async (tx) => {
      // Rejoining keeps the original joinedAt (and so the seat) and expiresAt.
      if ((await tx.get(ref)).exists()) tx.update(ref, { name });
      else tx.set(ref, { name, joinedAt: serverTimestamp(), ...recordTtl() });
    });
  } catch (e) {
    if (e.code !== 'permission-denied') throw e;
    // Name and format were checked above, so a refusal means the room is gone or (by elimination)
    // the expiry bound: a phone more than 6 days slow.
    if (!(await getDoc(roomRef(db, code))).exists()) throw new Error('Room not found');
    throw new Error('Bad clock');
  }
}


// Nothing here ever loads gm/secret or gm/used: the host's phone reads them only inside deal, close and advance.
export function subscribe(db, code, uid, onState) {
  const s = { room: undefined, players: undefined, priv: null, voteDocs: [], myVote: undefined };
  const emit = () => {
    if (s.room === undefined || s.players === undefined) return;
    const { room } = s;
    const isGm = !!room && room.gmUid === uid;
    const state = {
      room,
      players: s.players,
      myWord: !!room && !!room.inGame?.includes(uid) && s.priv && s.priv.wordSet === room.wordSet ? s.priv.word : null,
      myVote: s.myVote,
      waiting: room && room.phase === 'voting' ? waitingFor(room.roundPlayers, s.players, room.round) : [],
    };
    // Only votes from this round's players count: a leftover vote doc (id round_uid) from a stranger is ignored.
    if (isGm) state.votesCast = s.voteDocs.filter((d) => room?.roundPlayers?.includes(d.id.split('_')[1])).length;
    onState(state);
  };
  // One listener per round: the host's current-round votes, or a player's own vote doc.
  let voteOff = () => {};
  let voteKey = null;
  const watchVotes = (room, isGm) => {
    const key = room ? `${isGm}:${room.round}` : null;
    if (key === voteKey) return;
    voteOff(); voteOff = () => {}; voteKey = key; s.voteDocs = []; s.myVote = undefined;
    if (!room || room.round < 1) return;
    // Errors are ignored: a listener can race a hand-over and lose read access.
    if (isGm) {
      const q = query(collection(db, 'rooms', code, 'votes'), where('round', '==', room.round));
      voteOff = onSnapshot(q, (d) => {
        s.voteDocs = d.docs;
        s.myVote = d.docs.find((x) => x.id === `${room.round}_${uid}`)?.data().target ?? null;
        emit();
      }, () => {});
    } else {
      voteOff = onSnapshot(sub(db, code, 'votes', `${room.round}_${uid}`), (d) => { s.myVote = d.exists() ? d.data().target : null; emit(); }, () => { s.myVote = null; emit(); });
    }
  };

  const offs = [
    onSnapshot(roomRef(db, code), (snap) => {
      s.room = snap.exists() ? snap.data() : null;
      watchVotes(s.room, !!s.room && s.room.gmUid === uid);
      emit();
    }),
    onSnapshot(playersQuery(db, code), { includeMetadataChanges: true }, (q) => {
      // joinRoom's name check cached an older list: wait for the server's.
      if (q.metadata.fromCache) return;
      s.players = q.docs.map((d) => ({ uid: d.id, name: d.data().name, votedRound: d.data().votedRound }));
      emit();
    }),
    onSnapshot(sub(db, code, 'private', uid), (d) => { s.priv = d.exists() ? d.data() : null; emit(); }),
  ];
  return () => { offs.forEach((f) => f()); voteOff(); };
}

async function readRoom(tx, db, code) {
  const snap = await tx.get(roomRef(db, code));
  if (!snap.exists()) throw new Error('Room not found');
  return snap.data();
}

// Everything a result makes public: who was out, the carrier of that round, both words and the points just earned.
const resultOf = (room, secret, { outUid, voided, gains }) => ({
  outUid, outName: room.names[outUid] ?? null, wasCarrier: outUid === secret.carrierUid, voided,
  carrierUid: secret.carrierUid, carrierName: room.names[secret.carrierUid] ?? null, common: secret.common, odd: secret.odd, gains,
});

// Writes only: picks the pair, the carrier (anyone still in, the last one included) and the first speaker,
// and stores them where players cannot read. `fresh` starts a new game from `inGame`.
function deal(tx, db, code, { room, inGame, names, used, families, rand, fresh }) {
  const picked = pickUnusedPair(families, used, rand);
  const flip = rand() >= 0.5;
  const words = { common: picked.pair[flip ? 1 : 0], odd: picked.pair[flip ? 0 : 1] };
  const carrierUid = pickCarrier(inGame, rand);
  const starterUid = pickStarter(inGame, carrierUid, rand);
  const wordSet = room.wordSet + 1;
  // round keeps counting across games: vote ids are round_uid and the rules never let a vote be replaced.
  tx.update(roomRef(db, code), {
    phase: 'voting', wordSet, round: room.round + 1, roundPlayers: speakingOrder(inGame, starterUid), starterUid, result: null, resultAt: null,
    final: stage(inGame.length) === 'final', ...roomTtl(),
    ...(fresh && { inGame, names, out: [], gone: [], points: Object.fromEntries(inGame.map((id) => [id, 0])), ranking: deleteField() }),
  });
  for (const id of inGame) tx.set(sub(db, code, 'private', id), { word: id === carrierUid ? words.odd : words.common, wordSet, ...recordTtl() });
  tx.set(sub(db, code, 'gm', 'secret'), { ...words, carrierUid, wordSet, ...recordTtl() });
  tx.set(sub(db, code, 'gm', 'used'), { keys: picked.usedKeys, ...recordTtl() });
}

export async function startGame(db, code, families, rand = Math.random) {
  const players = (await getDocs(playersQuery(db, code))).docs.map((d) => ({ id: d.id, name: d.data().name }));
  await gmTx(db, code, async (tx) => {
    const room = await readRoom(tx, db, code);
    if (room.phase !== 'lobby' && room.phase !== 'gameOver') throw new Error('Round already running');
    if (players.length < MIN_PLAYERS) throw new Error('Not enough players');
    const used = (await tx.get(sub(db, code, 'gm', 'used'))).data()?.keys ?? [];
    deal(tx, db, code, {
      room, inGame: players.map((p) => p.id), names: Object.fromEntries(players.map((p) => [p.id, p.name])), used, families, rand, fresh: true,
    });
  });
}

// Host only. `round`, when given, is the round the caller saw: a late copy of a step does nothing to a later round.
export async function advance(db, code, families, rand = Math.random, round) {
  await gmTx(db, code, async (tx) => {
    const room = await readRoom(tx, db, code);
    if (room.phase !== 'result' || (round != null && room.round !== round)) return;
    if (stage(room.inGame.length) === 'over') {
      // Removals left fewer than three: no final, everyone ranked by points.
      const { inGame, out, gone, points, names } = room;
      tx.update(roomRef(db, code), {
        phase: 'gameOver', ...roomTtl(),
        ranking: ranking({ inGame, out, gone, points, names, carrierUid: null, caught: false, hadFinal: false }),
      });
      return;
    }
    const used = (await tx.get(sub(db, code, 'gm', 'used'))).data()?.keys ?? [];
    deal(tx, db, code, { room, inGame: room.inGame, names: room.names, used, families, rand, fresh: false });
  });
}

// The vote and the "voted in round N" mark on the caller's own record are one write, so they cannot differ.
export async function castVote(db, code, uid, target) {
  const { round, roundPlayers } = await getRoom(db, code);
  if (!roundPlayers.includes(uid)) throw new Error('Not in this round');
  const voteRef = sub(db, code, 'votes', `${round}_${uid}`);
  try {
    const batch = writeBatch(db);
    batch.set(voteRef, { target, round, ...recordTtl() });
    batch.update(sub(db, code, 'players', uid), { votedRound: round });
    await batch.commit();
  } catch (e) {
    if (e.code === 'not-found') throw new Error('Not in this round');
    if (e.code !== 'permission-denied') throw e;
    // The vote is already in (a second tap, a retry): not an error.
    if ((await getDoc(voteRef)).exists()) return;
    // No player record to mark: this person was removed or left.
    if (!(await getDoc(sub(db, code, 'players', uid))).exists()) throw new Error('Not in this round');
    // Refused while the vote is still open for this round: the expiry bound (a phone more than 6 days slow).
    const now = await getRoom(db, code);
    if (now.phase === 'voting' && now.round === round) throw new Error('Bad clock');
    // The round was closed or voided while this vote was on its way: nothing to report.
  }
}

// Host only. `round`, when given, is the round the caller saw.
export async function closeVoting(db, code, rand = Math.random, round) {
  await gmTx(db, code, async (tx) => {
    const room = await readRoom(tx, db, code);
    if (room.phase !== 'voting' || (round != null && room.round !== round)) return;
    const secret = (await tx.get(sub(db, code, 'gm', 'secret'))).data();
    // Only this round's players count: a vote from anyone else never scores.
    const votes = {};
    for (const id of room.roundPlayers) {
      const v = await tx.get(sub(db, code, 'votes', `${room.round}_${id}`));
      if (v.exists()) votes[id] = v.data().target;
    }
    const outUid = whoIsOut(votes, room.roundPlayers, rand);
    const gains = roundGains({ outUid, carrierUid: secret.carrierUid, votes, final: room.final });
    const points = { ...room.points };
    for (const [id, n] of Object.entries(gains)) points[id] = (points[id] ?? 0) + n;
    const result = resultOf(room, secret, { outUid, voided: false, gains });
    // The result, the points and (at the end) the ranking go in this one write, so a repeat finds the phase moved on.
    if (room.final) {
      tx.update(roomRef(db, code), {
        points, result, resultAt: Date.now(), phase: 'gameOver', ...roomTtl(),
        ranking: ranking({ inGame: room.inGame, out: room.out, gone: room.gone, points, names: room.names, carrierUid: secret.carrierUid, caught: result.wasCarrier, hadFinal: true }),
      });
    } else {
      tx.update(roomRef(db, code), {
        points, result, resultAt: Date.now(), phase: 'result', ...roomTtl(),
        inGame: room.inGame.filter((id) => id !== outUid), out: [...room.out, outUid],
      });
    }
  });
}

// Host only: voiding a round needs the secret and a room update. The host cannot remove themselves.
export async function removePlayer(db, code, uid) {
  await gmTx(db, code, async (tx) => {
    const room = await readRoom(tx, db, code);
    if (uid === room.gmUid) throw new Error('Hand the room over first');
    const playing = room.inGame.includes(uid) && (room.phase === 'voting' || room.phase === 'result');
    if (playing) {
      const update = { inGame: room.inGame.filter((id) => id !== uid), gone: [...room.gone, uid] };
      if (room.phase === 'voting') {
        const secret = (await tx.get(sub(db, code, 'gm', 'secret'))).data();
        update.phase = 'result';
        update.resultAt = Date.now();
        // A cancelled round scores nothing, but still names the carrier and both words.
        update.result = resultOf(room, secret, { outUid: uid, voided: true, gains: {} });
      }
      tx.update(roomRef(db, code), { ...update, ...roomTtl() });
    } else tx.update(roomRef(db, code), roomTtl());
    tx.delete(sub(db, code, 'players', uid));
  });
}

// Gives a player's own doc a fresh expiry, so a room used for more than 7 days keeps its players.
// A refusal or a missing doc is ignored: the doc just keeps the expiry it has.
export async function touchPlayer(db, code, uid) {
  try { await updateDoc(sub(db, code, 'players', uid), recordTtl()); } catch { /* keeps the old expiry */ }
}

export async function leaveRoom(db, code, uid) {
  // The host leaves with deleteRoom (alone) or after handing the room over.
  const room = await getDoc(roomRef(db, code));
  if (room.exists() && room.data().gmUid === uid) throw new Error('Hand the room over first');
  await deleteDoc(sub(db, code, 'players', uid));
}

// Between games only. Both people keep their player records; only who runs the room changes.
export async function handOverGm(db, code, newGmUid) {
  const room = await getRoom(db, code);
  if (room.phase !== 'lobby' && room.phase !== 'gameOver') throw new Error('Round already running');
  const next = await getDoc(sub(db, code, 'players', newGmUid));
  if (!next.exists()) throw new Error('Player not found');
  const batch = writeBatch(db);
  batch.update(roomRef(db, code), { gmUid: newGmUid, gmName: next.data().name, ...roomTtl() });
  batch.set(lockRef(db, code), lockTtl());
  await asGm(() => batch.commit());
}

// Host only. The rules cannot see the player list, so the check is here. A read followed by a delete
// cannot be made atomic under these rules: worst case, a player joins in the gap and finds the room gone.
// The lock record stays, so the code cannot be re-created while leftovers can exist.
// A room with other players (or a game in progress) is left alone. Returns whether the room was deleted.
export async function deleteRoom(db, code) {
  const room = await getDoc(roomRef(db, code));
  if (!room.exists() || !['lobby', 'gameOver'].includes(room.data().phase)) return false;
  const { gmUid } = room.data();
  if ((await getDocs(playersQuery(db, code))).docs.some((d) => d.id !== gmUid)) return false;
  const batch = writeBatch(db);
  batch.delete(sub(db, code, 'gm', 'secret'));
  batch.delete(sub(db, code, 'gm', 'used'));
  batch.delete(sub(db, code, 'players', gmUid));
  batch.delete(roomRef(db, code));
  await batch.commit();
  return true;
}

const RETRY_MS = 5000;

// Host only: runs the room from the host's phone. Safe to run twice and from any phase: every step is a
// transaction that does nothing unless the room is still where this copy saw it. One timer at most.
// onError(error) is called once per distinct failing step, onError(null) when a step next succeeds.
export function runRoom(db, code, uid, families, { now = Date.now, setTimer = setTimeout, rand, onError = () => {} } = {}) {
  let last = null;
  let busy = false;
  let timer = null;
  let stopped = false;
  let failing = null;
  const arm = (ms) => { if (!timer && !stopped) timer = setTimer(() => { timer = null; check(); }, ms); };
  async function check() {
    if (stopped || busy || !last || !last.room) return;
    const seen = last;
    const { room, votesCast = 0 } = seen;
    // Not the host any more (a hand-over), or a room from another version: leave it alone.
    if (room.gmUid !== uid || !Array.isArray(room.inGame)) return;
    const step = hostStep({
      phase: room.phase, allVoted: room.roundPlayers.length > 0 && votesCast >= room.roundPlayers.length, resultAt: room.resultAt, now: now(),
    });
    if (step?.wait != null) return arm(step.wait);
    if (!step) return;
    busy = true;
    const key = `${step}:${room.round}`;
    let failed = false;
    try {
      await (step === 'close' ? closeVoting(db, code, rand, room.round) : advance(db, code, families, rand, room.round));
      if (failing) { failing = null; onError(null); }
    } catch (e) {
      failed = true;
      if (failing !== key) { failing = key; onError(e); }
    }
    busy = false;
    // A failed step is retried after a pause, never at once; a state that arrived meanwhile is looked at now.
    if (failed) arm(RETRY_MS);
    else if (last !== seen) check();
  }
  const off = subscribe(db, code, uid, (state) => { last = state; check(); });
  return () => { stopped = true; clearTimeout(timer); off(); };
}
