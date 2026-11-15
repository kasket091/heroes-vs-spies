import {
  doc, collection, query, orderBy, getDoc, getDocs, setDoc, deleteDoc, onSnapshot,
  writeBatch, runTransaction, updateDoc, serverTimestamp, where, Timestamp,
} from 'firebase/firestore';
import {
  MIN_PLAYERS, starterChoices, speakingOrder, pickSpy, validPair, cleanName, newRoomCode,
  whoIsOut, scoreRound, stage, gameWinner,
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
        tx.set(roomRef(db, code), {
          gmUid: uid, gmName, phase: 'lobby', round: 0, roundPlayers: [], starterUid: null, result: null,
          active: [], names: {}, heroBench: [], spyBench: [], score: { heroes: 0, spies: 0 },
          wordSet: 0, needsWords: false, final: false, winner: null, setStart: false, ...roomTtl(),
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
  // A room made by the version before Heroes vs Spies: refuse before writing anything.
  if (!Array.isArray(room.active)) throw new Error('Old room');
  const same = (n) => n.toLowerCase() === name.toLowerCase();
  // While a game runs, its names (benched and removed players too) stay reserved for their own uid.
  const running = room.phase !== 'lobby' && room.phase !== 'gameOver';
  if (running && Object.entries(room.names).some(([id, n]) => id !== uid && same(n))) throw new Error('Name already taken');
  // The game master already has their own screen; a player doc would put them in the deal.
  if (room.gmUid === uid) return;
  const taken = (await getDocs(playersQuery(db, code))).docs.some((d) => d.id !== uid && d.data().name.toLowerCase() === name.toLowerCase());
  if (taken || room.gmName.toLowerCase() === name.toLowerCase()) throw new Error('Name already taken');
  const ref = sub(db, code, 'players', uid);
  try {
    await runTransaction(db, async (tx) => {
      // Rejoining keeps the original joinedAt (and so the seat) and expiresAt.
      if ((await tx.get(ref)).exists()) tx.update(ref, { name });
      else tx.set(ref, { name, joinedAt: serverTimestamp(), ...recordTtl() });
    });
  } catch (e) {
    if (e.code !== 'permission-denied') throw e;
    // Name and format were checked above, so a refusal means the room is gone, this uid just became the
    // game master, or (by elimination) the expiry bound: a phone more than 6 days slow.
    const now = (await getDoc(roomRef(db, code))).data();
    if (!now) throw new Error('Room not found');
    if (now.gmUid === uid) return;
    throw new Error('Bad clock');
  }
}

export function subscribe(db, code, uid, onState) {
  const s = { room: undefined, players: undefined, priv: null, secret: null, votes: [], myVote: undefined };
  let gmOffs = [];
  let gmMode = false;
  const emit = () => {
    if (s.room === undefined || s.players === undefined) return;
    const dealtIn = s.room && !!s.room.active?.includes(uid);
    onState({
      room: s.room,
      players: s.players,
      myWord: dealtIn && s.priv && s.priv.wordSet === s.room.wordSet ? s.priv.word : null,
      secret: gmMode && s.secret && s.secret.wordSet === s.room.wordSet ? s.secret : null,
      myVote: s.myVote,
      votesCast: gmMode ? s.votes.length : 0,
    });
  };
  const stopGm = () => { gmOffs.forEach((f) => f()); gmOffs = []; s.secret = null; };
  // One listener per round: the game master's current-round votes, or a player's own vote doc.
  let voteOff = () => {};
  let voteKey = null;
  const watchVotes = (room, isGm) => {
    const key = room ? `${isGm}:${room.round}` : null;
    if (key === voteKey) return;
    voteOff(); voteOff = () => {}; voteKey = key; s.votes = []; s.myVote = undefined;
    if (!room || room.round < 1) return;
    // Errors are ignored: a listener can race a hand-over and lose read access.
    if (isGm) {
      const q = query(collection(db, 'rooms', code, 'votes'), where('round', '==', room.round));
      // Only votes from this round's players count: a leftover vote doc (id round_uid) from a stranger is ignored.
      voteOff = onSnapshot(q, (d) => { s.votes = d.docs.filter((x) => s.room?.roundPlayers?.includes(x.id.split('_')[1])).map((x) => x.data()); emit(); }, () => {});
    } else {
      voteOff = onSnapshot(sub(db, code, 'votes', `${room.round}_${uid}`), (d) => { s.myVote = d.exists() ? d.data().target : null; emit(); }, () => { s.myVote = null; emit(); });
    }
  };

  const offs = [
    onSnapshot(roomRef(db, code), (snap) => {
      s.room = snap.exists() ? snap.data() : null;
      const isGm = !!s.room && s.room.gmUid === uid;
      if (isGm && !gmMode) {
        // Errors are ignored: a listener can race a hand-over and lose read access.
        gmOffs = [
          onSnapshot(sub(db, code, 'gm', 'secret'), (d) => { s.secret = d.exists() ? d.data() : null; emit(); }, () => {}),
        ];
      } else if (!isGm && gmMode) stopGm();
      gmMode = isGm;
      watchVotes(s.room, isGm);
      emit();
    }),
    onSnapshot(playersQuery(db, code), { includeMetadataChanges: true }, (q) => {
      // joinRoom's name check cached an older list: wait for the server's.
      if (q.metadata.fromCache) return;
      s.players = q.docs.map((d) => ({ uid: d.id, name: d.data().name }));
      emit();
    }),
    onSnapshot(sub(db, code, 'private', uid), (d) => { s.priv = d.exists() ? d.data() : null; emit(); }),
  ];
  return () => { offs.forEach((f) => f()); stopGm(); voteOff(); };
}

// Everything a round result says before the spy is caught or the game ends: nothing about the spy.
const noSpy = { spyUid: null, spyName: null, common: null, spy: null };
const blankResult = { outUid: null, outName: null, wasSpy: false, team: null, points: 0, voided: false, ...noSpy };

async function readRoom(tx, db, code) {
  const snap = await tx.get(roomRef(db, code));
  if (!snap.exists()) throw new Error('Room not found');
  return snap.data();
}

// Writes only: the caller has read the room and the secret already.
function endGame(tx, db, code, room, secret) {
  const known = secret?.wordSet === room.wordSet && [...room.active, ...room.spyBench].includes(secret.spyUid);
  tx.update(roomRef(db, code), {
    phase: 'gameOver', ...roomTtl(),
    winner: gameWinner(room.score),
    result: {
      ...blankResult,
      // Keep what the last result already made public.
      ...Object.fromEntries(['outUid', 'outName', 'spyUid', 'spyName', 'common', 'spy'].map((k) => [k, room.result?.[k] ?? null])),
      ...(known && { spyUid: secret.spyUid, spyName: room.names[secret.spyUid] ?? null, common: secret.common, spy: secret.spy }),
    },
  });
}

export async function dealWords(db, code, common, spy, rand = Math.random) {
  const players = (await getDocs(playersQuery(db, code))).docs.map((d) => ({ id: d.id, name: d.data().name }));
  await gmTx(db, code, async (tx) => {
    const room = await readRoom(tx, db, code);
    const secret = (await tx.get(sub(db, code, 'gm', 'secret'))).data();
    if (room.phase === 'result' && stage(room.active.length) === 'over') return endGame(tx, db, code, room, secret);
    const fresh = room.phase === 'lobby' || room.phase === 'gameOver';
    if (!fresh && !(room.phase === 'result' && room.needsWords)) throw new Error('Round already running');
    if (!validPair(common, spy)) throw new Error('Invalid word pair');
    if (fresh && players.length < MIN_PLAYERS) throw new Error('Not enough players');
    const active = fresh ? players.map((p) => p.id) : room.active;
    const spyUid = pickSpy(active, rand);
    const wordSet = room.wordSet + 1;
    const words = { common: common.trim(), spy: spy.trim() };
    // round keeps counting across games: vote ids are round_uid and the rules never let a vote be replaced.
    tx.update(roomRef(db, code), {
      phase: 'clues', wordSet, round: room.round + 1, roundPlayers: [...active], starterUid: null, result: null,
      final: stage(active.length) === 'final', needsWords: false, setStart: true, ...roomTtl(),
      ...(fresh && {
        active, names: Object.fromEntries(players.map((p) => [p.id, p.name])),
        heroBench: [], spyBench: [], score: { heroes: 0, spies: 0 }, winner: null,
      }),
    });
    for (const id of active) tx.set(sub(db, code, 'private', id), { word: id === spyUid ? words.spy : words.common, wordSet, ...recordTtl() });
    tx.set(sub(db, code, 'gm', 'secret'), { ...words, spyUid, wordSet, ...recordTtl() });
  });
}

export async function nextRound(db, code) {
  await gmTx(db, code, async (tx) => {
    const room = await readRoom(tx, db, code);
    const secret = (await tx.get(sub(db, code, 'gm', 'secret'))).data();
    if (room.phase !== 'result') return;
    if (stage(room.active.length) === 'over') return endGame(tx, db, code, room, secret);
    if (room.needsWords) return;
    tx.update(roomRef(db, code), {
      round: room.round + 1, roundPlayers: [...room.active], starterUid: null, result: null,
      final: stage(room.active.length) === 'final', phase: 'clues', setStart: false, ...roomTtl(),
    });
  });
}

export async function pickStarter(db, code, starterUid) {
  await gmTx(db, code, async (tx) => {
    const room = await readRoom(tx, db, code);
    const secret = (await tx.get(sub(db, code, 'gm', 'secret'))).data();
    if (room.phase !== 'clues' || secret?.wordSet !== room.wordSet) throw new Error('No round to start');
    if (!starterChoices(room.roundPlayers, secret.spyUid, room.setStart).includes(starterUid)) throw new Error('Not a safe starter');
    tx.update(roomRef(db, code), { roundPlayers: speakingOrder(room.roundPlayers, starterUid), starterUid, ...roomTtl() });
  });
}

export async function openVoting(db, code) {
  await gmTx(db, code, async (tx) => {
    const room = await readRoom(tx, db, code);
    if (room.phase !== 'clues' || !room.starterUid) throw new Error('Cannot open voting yet');
    tx.update(roomRef(db, code), { phase: 'voting', ...roomTtl() });
  });
}

export async function castVote(db, code, uid, target) {
  const { round } = await getRoom(db, code);
  try {
    await setDoc(sub(db, code, 'votes', `${round}_${uid}`), { target, round, ...recordTtl() });
  } catch (e) {
    if (e.code !== 'permission-denied') throw e;
    // The vote is already in (a second tap, a retry): not an error.
    if ((await getDoc(sub(db, code, 'votes', `${round}_${uid}`))).exists()) return;
    // Refused while the vote is still open for this round: the expiry bound (a phone more than 6 days slow).
    const now = await getRoom(db, code);
    if (now.phase === 'voting' && now.round === round) throw new Error('Bad clock');
    throw e;
  }
}

export async function closeVoting(db, code, rand = Math.random) {
  await gmTx(db, code, async (tx) => {
    const room = await readRoom(tx, db, code);
    if (room.phase !== 'voting') return;
    const secret = (await tx.get(sub(db, code, 'gm', 'secret'))).data();
    const votes = {};
    for (const id of room.roundPlayers) {
      const v = await tx.get(sub(db, code, 'votes', `${room.round}_${id}`));
      if (v.exists()) votes[id] = v.data().target;
    }
    const outUid = whoIsOut(votes, room.roundPlayers, rand);
    const { wasSpy, team, points, score } = scoreRound({ outUid, spyUid: secret.spyUid, score: room.score, final: room.final });
    const result = {
      ...blankResult, outUid, outName: room.names[outUid] ?? null, wasSpy, team, points,
      ...((wasSpy || room.final) && { spyUid: secret.spyUid, spyName: room.names[secret.spyUid] ?? null, common: secret.common, spy: secret.spy }),
    };
    if (room.final) {
      tx.update(roomRef(db, code), { score, result, winner: gameWinner(score), phase: 'gameOver', ...roomTtl() });
    } else {
      tx.update(roomRef(db, code), {
        score, result, needsWords: wasSpy, phase: 'result', ...roomTtl(),
        active: room.active.filter((id) => id !== outUid),
        [wasSpy ? 'spyBench' : 'heroBench']: [...room[wasSpy ? 'spyBench' : 'heroBench'], outUid],
      });
    }
  });
}

// Game master only: voiding a round needs the secret and a room update.
export async function removePlayer(db, code, uid) {
  await gmTx(db, code, async (tx) => {
    const room = await readRoom(tx, db, code);
    const secret = (await tx.get(sub(db, code, 'gm', 'secret'))).data();
    const playing = room.active.includes(uid) && room.phase !== 'lobby' && room.phase !== 'gameOver';
    if (playing) {
      const isSpy = secret?.wordSet === room.wordSet && secret.spyUid === uid;
      const update = { active: room.active.filter((id) => id !== uid), needsWords: room.needsWords || isSpy };
      if (room.phase === 'clues' || room.phase === 'voting') {
        update.phase = 'result';
        // The words and the spy are shown only if the spy is the one leaving.
        update.result = {
          ...blankResult, voided: true, outUid: uid, outName: room.names[uid] ?? null,
          ...(isSpy && { spyUid: uid, spyName: room.names[uid] ?? null, common: secret.common, spy: secret.spy }),
        };
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

export const leaveRoom = (db, code, uid) => deleteDoc(sub(db, code, 'players', uid));

export async function handOverGm(db, code, newGmUid) {
  const room = await getRoom(db, code);
  if (room.phase !== 'lobby' && room.phase !== 'gameOver') throw new Error('Round already running');
  const next = await getDoc(sub(db, code, 'players', newGmUid));
  if (!next.exists()) throw new Error('Player not found');
  const batch = writeBatch(db);
  batch.update(roomRef(db, code), { gmUid: newGmUid, gmName: next.data().name, ...roomTtl() });
  batch.delete(sub(db, code, 'players', newGmUid));
  batch.set(sub(db, code, 'players', room.gmUid), { name: room.gmName, joinedAt: serverTimestamp(), ...recordTtl() });
  batch.set(lockRef(db, code), lockTtl());
  await asGm(() => batch.commit());
}

// Game master only. The rules cannot see the player list, so the check is here. A read followed by a delete
// cannot be made atomic under these rules: worst case, a player joins in the gap and finds the room gone.
// The lock record stays, so the code cannot be re-created while leftovers can exist.
// A room with players (or a game in progress) is left alone. Returns whether the room was deleted.
export async function deleteRoom(db, code) {
  const room = await getDoc(roomRef(db, code));
  if (!room.exists() || !['lobby', 'gameOver'].includes(room.data().phase)) return false;
  if (!(await getDocs(playersQuery(db, code))).empty) return false;
  const batch = writeBatch(db);
  batch.delete(sub(db, code, 'gm', 'secret'));
  batch.delete(roomRef(db, code));
  await batch.commit();
  return true;
}
