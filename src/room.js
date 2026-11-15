import {
  doc, collection, query, orderBy, getDoc, getDocs, setDoc, deleteDoc, onSnapshot,
  writeBatch, runTransaction, serverTimestamp, where,
} from 'firebase/firestore';
import {
  MIN_PLAYERS, starterChoices, speakingOrder, pickSpy, validPair, cleanName, newRoomCode,
  whoIsOut, scoreRound, stage, gameWinner,
} from './game.js';

const roomRef = (db, code) => doc(db, 'rooms', code);
const sub = (db, code, ...path) => doc(db, 'rooms', code, ...path);
const playersQuery = (db, code) => query(collection(db, 'rooms', code, 'players'), orderBy('joinedAt'));

async function getRoom(db, code) {
  const snap = await getDoc(roomRef(db, code));
  if (!snap.exists()) throw new Error('Room not found');
  return snap.data();
}

export async function createRoom(db, uid, rawName) {
  const gmName = cleanName(rawName);
  if (!gmName) throw new Error('Name needed');
  for (;;) {
    const code = newRoomCode();
    const ok = await runTransaction(db, async (tx) => {
      if ((await tx.get(roomRef(db, code))).exists()) return false;
      tx.set(roomRef(db, code), {
        gmUid: uid, gmName, phase: 'lobby', round: 0, roundPlayers: [], starterUid: null, result: null,
        active: [], names: {}, heroBench: [], spyBench: [], score: { heroes: 0, spies: 0 },
        wordSet: 0, needsWords: false, final: false, winner: null,
      });
      return true;
    });
    if (ok) return code;
  }
}

export async function joinRoom(db, code, uid, rawName) {
  const name = cleanName(rawName);
  if (!name) throw new Error('Name needed');
  const room = await getRoom(db, code);
  // The game master already has their own screen; a player doc would put them in the deal.
  if (room.gmUid === uid) return;
  const taken = (await getDocs(playersQuery(db, code))).docs.some((d) => d.id !== uid && d.data().name.toLowerCase() === name.toLowerCase());
  if (taken || room.gmName.toLowerCase() === name.toLowerCase()) throw new Error('Name already taken');
  const ref = sub(db, code, 'players', uid);
  await runTransaction(db, async (tx) => {
    // Rejoining keeps the original joinedAt (and so the seat).
    if ((await tx.get(ref)).exists()) tx.update(ref, { name });
    else tx.set(ref, { name, joinedAt: serverTimestamp() });
  });
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
      voteOff = onSnapshot(q, (d) => { s.votes = d.docs.map((x) => x.data()); emit(); }, () => {});
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
    phase: 'gameOver',
    winner: gameWinner(room.score),
    result: {
      ...blankResult,
      ...(known && { spyUid: secret.spyUid, spyName: room.names[secret.spyUid] ?? null, common: secret.common, spy: secret.spy }),
    },
  });
}

export async function dealWords(db, code, common, spy, rand = Math.random) {
  const players = (await getDocs(playersQuery(db, code))).docs.map((d) => ({ id: d.id, name: d.data().name }));
  await runTransaction(db, async (tx) => {
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
      final: stage(active.length) === 'final', needsWords: false,
      ...(fresh && {
        active, names: Object.fromEntries(players.map((p) => [p.id, p.name])),
        heroBench: [], spyBench: [], score: { heroes: 0, spies: 0 }, winner: null,
      }),
    });
    for (const id of active) tx.set(sub(db, code, 'private', id), { word: id === spyUid ? words.spy : words.common, wordSet });
    tx.set(sub(db, code, 'gm', 'secret'), { ...words, spyUid, wordSet });
  });
}

export async function nextRound(db, code) {
  await runTransaction(db, async (tx) => {
    const room = await readRoom(tx, db, code);
    const secret = (await tx.get(sub(db, code, 'gm', 'secret'))).data();
    if (room.phase !== 'result') return;
    if (stage(room.active.length) === 'over') return endGame(tx, db, code, room, secret);
    if (room.needsWords) return;
    tx.update(roomRef(db, code), {
      round: room.round + 1, roundPlayers: [...room.active], starterUid: null, result: null,
      final: stage(room.active.length) === 'final', phase: 'clues',
    });
  });
}

export async function pickStarter(db, code, starterUid) {
  const room = await getRoom(db, code);
  const secret = (await getDoc(sub(db, code, 'gm', 'secret'))).data();
  if (room.phase !== 'clues' || secret?.wordSet !== room.wordSet) throw new Error('No round to start');
  if (!starterChoices(room.roundPlayers, secret.spyUid).includes(starterUid)) throw new Error('Not a safe starter');
  await setDoc(roomRef(db, code), { roundPlayers: speakingOrder(room.roundPlayers, starterUid), starterUid }, { merge: true });
}

export async function openVoting(db, code) {
  const room = await getRoom(db, code);
  if (room.phase !== 'clues' || !room.starterUid) throw new Error('Cannot open voting yet');
  await setDoc(roomRef(db, code), { phase: 'voting' }, { merge: true });
}

export async function castVote(db, code, uid, target) {
  const { round } = await getRoom(db, code);
  await setDoc(sub(db, code, 'votes', `${round}_${uid}`), { target, round });
}

export async function closeVoting(db, code, rand = Math.random) {
  await runTransaction(db, async (tx) => {
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
      tx.update(roomRef(db, code), { score, result, winner: gameWinner(score), phase: 'gameOver' });
    } else {
      tx.update(roomRef(db, code), {
        score, result, needsWords: wasSpy, phase: 'result',
        active: room.active.filter((id) => id !== outUid),
        [wasSpy ? 'spyBench' : 'heroBench']: [...room[wasSpy ? 'spyBench' : 'heroBench'], outUid],
      });
    }
  });
}

// Game master only: voiding a round needs the secret and a room update.
export async function removePlayer(db, code, uid) {
  await runTransaction(db, async (tx) => {
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
          ...blankResult, voided: true,
          ...(isSpy && { spyUid: uid, spyName: room.names[uid] ?? null, common: secret.common, spy: secret.spy }),
        };
      }
      tx.update(roomRef(db, code), update);
    }
    tx.delete(sub(db, code, 'players', uid));
  });
}

export const leaveRoom = (db, code, uid) => deleteDoc(sub(db, code, 'players', uid));

export async function handOverGm(db, code, newGmUid) {
  const room = await getRoom(db, code);
  if (room.phase !== 'lobby' && room.phase !== 'gameOver') throw new Error('Round already running');
  const next = await getDoc(sub(db, code, 'players', newGmUid));
  if (!next.exists()) throw new Error('Player not found');
  const batch = writeBatch(db);
  batch.update(roomRef(db, code), { gmUid: newGmUid, gmName: next.data().name });
  batch.delete(sub(db, code, 'players', newGmUid));
  batch.set(sub(db, code, 'players', room.gmUid), { name: room.gmName, joinedAt: serverTimestamp() });
  await batch.commit();
}
