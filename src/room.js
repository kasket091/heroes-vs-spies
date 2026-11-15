import {
  doc, collection, query, orderBy, getDoc, getDocs, setDoc, deleteDoc, onSnapshot,
  writeBatch, runTransaction, serverTimestamp, where,
} from 'firebase/firestore';
import {
  MIN_PLAYERS, safeStarters, speakingOrder, pickSpy, validPair, cleanName, tally, newRoomCode,
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
    const dealtIn = s.room && s.room.roundPlayers.includes(uid);
    onState({
      room: s.room,
      players: s.players,
      myWord: dealtIn && s.priv && s.priv.round === s.room.round ? s.priv.word : null,
      secret: gmMode && s.secret && s.secret.round === s.room.round ? s.secret : null,
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

export async function dealRound(db, code, common, spy) {
  const room = await getRoom(db, code);
  if (!['lobby', 'reveal', 'cancelled'].includes(room.phase)) throw new Error('Round already running');
  if (!validPair(common, spy)) throw new Error('Invalid word pair');
  const players = (await getDocs(playersQuery(db, code))).docs.map((d) => d.id);
  if (players.length < MIN_PLAYERS) throw new Error('Not enough players');
  const round = room.round + 1;
  const spyUid = pickSpy(players);
  const words = { common: common.trim(), spy: spy.trim() };
  const batch = writeBatch(db);
  batch.update(roomRef(db, code), { round, roundPlayers: players, starterUid: null, result: null, phase: 'clues' });
  for (const id of players) {
    batch.set(sub(db, code, 'private', id), { word: id === spyUid ? words.spy : words.common, round });
  }
  batch.set(sub(db, code, 'gm', 'secret'), { ...words, spyUid, round });
  await batch.commit();
}

export async function pickStarter(db, code, starterUid) {
  const room = await getRoom(db, code);
  const secret = (await getDoc(sub(db, code, 'gm', 'secret'))).data();
  if (room.phase !== 'clues' || secret?.round !== room.round) throw new Error('No round to start');
  const { spyUid } = secret;
  if (!safeStarters(room.roundPlayers, spyUid).includes(starterUid)) throw new Error('Not a safe starter');
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

export async function closeVoting(db, code) {
  await runTransaction(db, async (tx) => {
    const room = (await tx.get(roomRef(db, code))).data();
    if (room.phase !== 'voting') return;
    const secret = (await tx.get(sub(db, code, 'gm', 'secret'))).data();
    const votes = {};
    for (const id of room.roundPlayers) {
      const v = await tx.get(sub(db, code, 'votes', `${room.round}_${id}`));
      if (v.exists()) votes[id] = v.data().target;
    }
    const { votedOutUid, tie, winner } = tally(votes, secret.spyUid);
    // Names are stored with the result so it still reads right after a player leaves.
    const nameOf = async (id) => (await tx.get(sub(db, code, 'players', id))).data()?.name ?? null;
    const spyName = await nameOf(secret.spyUid);
    const votedOutName = votedOutUid ? await nameOf(votedOutUid) : null;
    tx.update(roomRef(db, code), {
      phase: 'reveal',
      result: {
        votedOutUid, tie, winner, spyUid: secret.spyUid, common: secret.common, spy: secret.spy, spyName, votedOutName,
      },
    });
  });
}

// Game master only: cancelling a round needs the secret and a room update.
export async function removePlayer(db, code, uid) {
  const room = await getRoom(db, code);
  const batch = writeBatch(db);
  // A late joiner is not in the round, so removing them leaves it running.
  if ((room.phase === 'clues' || room.phase === 'voting') && room.roundPlayers.includes(uid)) {
    const { common, spy, spyUid } = (await getDoc(sub(db, code, 'gm', 'secret'))).data();
    // Read before the delete below: the removed player may be the spy.
    const spyName = (await getDoc(sub(db, code, 'players', spyUid))).data()?.name ?? null;
    batch.update(roomRef(db, code), {
      phase: 'cancelled',
      result: { votedOutUid: null, tie: false, winner: null, spyUid, common, spy, spyName, votedOutName: null },
    });
  }
  batch.delete(sub(db, code, 'players', uid));
  await batch.commit();
}

export const leaveRoom = (db, code, uid) => deleteDoc(sub(db, code, 'players', uid));

export async function handOverGm(db, code, newGmUid) {
  const room = await getRoom(db, code);
  if (!['lobby', 'reveal', 'cancelled'].includes(room.phase)) throw new Error('Round already running');
  const next = await getDoc(sub(db, code, 'players', newGmUid));
  if (!next.exists()) throw new Error('Player not found');
  const batch = writeBatch(db);
  batch.update(roomRef(db, code), { gmUid: newGmUid, gmName: next.data().name });
  batch.delete(sub(db, code, 'players', newGmUid));
  batch.set(sub(db, code, 'players', room.gmUid), { name: room.gmName, joinedAt: serverTimestamp() });
  await batch.commit();
}
