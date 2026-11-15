import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { beforeAll, beforeEach, afterAll, describe, it } from 'vitest';

let env;
const room = { gmUid: 'gm', gmName: 'GM', phase: 'voting', round: 1, roundPlayers: ['p1', 'p2', 'p3', 'p4'], starterUid: 'p1', result: null };

const now = () => firebase.firestore.FieldValue.serverTimestamp();
const DAY = 24 * 60 * 60 * 1000;
const ahead = (days) => firebase.firestore.Timestamp.fromMillis(Date.now() + days * DAY);
const db = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-spy',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
afterAll(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await d.doc('rooms/ABCD').set(room);
    for (const p of ['p1', 'p2', 'p3', 'p4']) {
      await d.doc(`rooms/ABCD/players/${p}`).set({ name: p, joinedAt: 1 });
      await d.doc(`rooms/ABCD/private/${p}`).set({ word: 'w' + p, round: 1 });
    }
    await d.doc('rooms/ABCD/gm/secret').set({ common: 'a', spy: 'b', spyUid: 'p3', round: 1 });
  });
});

describe('security rules', () => {
  it('p1 reads private/p1', () => assertSucceeds(db('p1').doc('rooms/ABCD/private/p1').get()));
  it('p1 reads private/p2 FAILS', () => assertFails(db('p1').doc('rooms/ABCD/private/p2').get()));
  it('p1 reads gm/secret FAILS', () => assertFails(db('p1').doc('rooms/ABCD/gm/secret').get()));
  it('p1 lists votes FAILS', () => assertFails(db('p1').collection('rooms/ABCD/votes').get()));
  it('p1 updates rooms/ABCD FAILS', () => assertFails(db('p1').doc('rooms/ABCD').update({ phase: 'reveal' })));
  it('p1 writes private/p1 FAILS', () => assertFails(db('p1').doc('rooms/ABCD/private/p1').set({ word: 'x', round: 1 })));
  it('signed-out reads rooms/ABCD FAILS', () => assertFails(db(null).doc('rooms/ABCD').get()));
  it('gm reads private/p2, gm/secret, votes', async () => {
    const g = db('gm');
    await assertSucceeds(g.doc('rooms/ABCD/private/p2').get());
    await assertSucceeds(g.doc('rooms/ABCD/gm/secret').get());
    await assertSucceeds(g.collection('rooms/ABCD/votes').get());
  });
  it('p1 creates votes/1_p1', () => assertSucceeds(db('p1').doc('rooms/ABCD/votes/1_p1').set({ target: 'p2', round: 1, expiresAt: ahead(7) })));
  it('p1 creates votes/1_p1 again FAILS', async () => {
    await assertSucceeds(db('p1').doc('rooms/ABCD/votes/1_p1').set({ target: 'p2', round: 1, expiresAt: ahead(7) }));
    await assertFails(db('p1').doc('rooms/ABCD/votes/1_p1').set({ target: 'p3', round: 1, expiresAt: ahead(7) }));
  });
  it('p1 creates votes/1_p2 FAILS', () => assertFails(db('p1').doc('rooms/ABCD/votes/1_p2').set({ target: 'p3', round: 1, expiresAt: ahead(7) })));
  it('p1 votes for p1 FAILS', () => assertFails(db('p1').doc('rooms/ABCD/votes/1_p1').set({ target: 'p1', round: 1, expiresAt: ahead(7) })));
  it('p1 votes for stranger FAILS', () => assertFails(db('p1').doc('rooms/ABCD/votes/1_p1').set({ target: 'stranger', round: 1, expiresAt: ahead(7) })));
  it('a uid not in roundPlayers (benched) cannot create a vote; one in roundPlayers can', async () => {
    await env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc('rooms/ABCD').update({ active: ['p1', 'p2', 'p3'], roundPlayers: ['p1', 'p2', 'p3'] }));
    await assertFails(db('p4').doc('rooms/ABCD/votes/1_p4').set({ target: 'p1', round: 1, expiresAt: ahead(7) }));
    await assertSucceeds(db('p1').doc('rooms/ABCD/votes/1_p1').set({ target: 'p2', round: 1, expiresAt: ahead(7) }));
  });
  it('p5 votes FAILS', () => assertFails(db('p5').doc('rooms/ABCD/votes/1_p5').set({ target: 'p1', round: 1, expiresAt: ahead(7) })));
  it('p1 votes in clues phase FAILS', async () => {
    await env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc('rooms/ABCD').update({ phase: 'clues' }));
    await assertFails(db('p1').doc('rooms/ABCD/votes/1_p1').set({ target: 'p2', round: 1, expiresAt: ahead(7) }));
  });
  it('p1 creates players/p1 empty name FAILS', () => assertFails(db('p1').doc('rooms/ABCD/players/p1').set({ name: '', joinedAt: 1 })));
  it('p1 creates players/p1 21-char name FAILS', () => assertFails(db('p1').doc('rooms/ABCD/players/p1').set({ name: 'x'.repeat(21), joinedAt: 1 })));
  it('p1 creates players/p2 FAILS', () => assertFails(db('p1').doc('rooms/ABCD/players/p2').set({ name: 'ok', joinedAt: 1 })));
  it('gm deletes players/p1', () => assertSucceeds(db('gm').doc('rooms/ABCD/players/p1').delete()));

  it('signed-in user lists rooms FAILS, gets one room', async () => {
    await assertFails(db('p1').collection('rooms').get());
    await assertSucceeds(db('p1').doc('rooms/ABCD').get());
  });
  it('gm creates own players doc FAILS', () => assertFails(db('gm').doc('rooms/ABCD/players/gm').set({ name: 'Gina', joinedAt: now(), expiresAt: ahead(7) })));
  it('new player with a valid name creates own doc', () => assertSucceeds(db('p5').doc('rooms/ABCD/players/p5').set({ name: 'Eve', joinedAt: now(), expiresAt: ahead(7) })));
  it('players doc with an extra field FAILS', () => assertFails(db('p5').doc('rooms/ABCD/players/p5').set({ name: 'Eve', joinedAt: now(), expiresAt: ahead(7), admin: true })));
  it('players doc with a made-up joinedAt FAILS', () => assertFails(db('p5').doc('rooms/ABCD/players/p5').set({ name: 'Eve', joinedAt: 1 })));
  it('player renames but cannot change joinedAt', async () => {
    await assertSucceeds(db('p1').doc('rooms/ABCD/players/p1').update({ name: 'New' }));
    await assertFails(db('p1').doc('rooms/ABCD/players/p1').update({ joinedAt: 99 }));
    await assertFails(db('p1').doc('rooms/ABCD/players/p1').update({ extra: 1 }));
  });
  it('player reads own vote, not another, still cannot list', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('rooms/ABCD/votes/1_p1').set({ target: 'p2', round: 1, expiresAt: ahead(7) });
      await ctx.firestore().doc('rooms/ABCD/votes/1_p2').set({ target: 'p1', round: 1, expiresAt: ahead(7) });
    });
    await assertSucceeds(db('p1').doc('rooms/ABCD/votes/1_p1').get());
    await assertFails(db('p1').doc('rooms/ABCD/votes/1_p2').get());
    await assertFails(db('p1').collection('rooms/ABCD/votes').get());
  });
  it('vote with a wrong round or an extra key FAILS', async () => {
    await assertFails(db('p1').doc('rooms/ABCD/votes/1_p1').set({ target: 'p2', round: 2, expiresAt: ahead(7) }));
    await assertFails(db('p1').doc('rooms/ABCD/votes/1_p1').set({ target: 'p2', round: 1, extra: 1, expiresAt: ahead(7) }));
    await assertFails(db('p1').doc('rooms/ABCD/votes/1_p1').set({ target: 'p2' }));
  });
});

describe('room cleanup rules', () => {
  const player = (days) => ({ name: 'Eve', joinedAt: now(), expiresAt: ahead(days) });
  const newPlayer = (days) => db('p5').doc('rooms/ABCD/players/p5').set(player(days));
  const vote = (days) => db('p1').doc('rooms/ABCD/votes/1_p1').set({ target: 'p2', round: 1, expiresAt: ahead(days) });

  it('game master deletes own room; a player and another room\'s game master cannot', async () => {
    await env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc('rooms/WXYZ').set({ ...room, gmUid: 'gm2' }));
    await assertFails(db('p1').doc('rooms/ABCD').delete());
    await assertFails(db('gm2').doc('rooms/ABCD').delete());
    await assertSucceeds(db('gm2').doc('rooms/WXYZ').delete());
    await assertSucceeds(db('gm').doc('rooms/ABCD').delete());
  });
  it('player create: expiresAt 7 days ahead succeeds, 60 days ahead FAILS, in the past FAILS, missing FAILS', async () => {
    await assertFails(newPlayer(60));
    await assertFails(newPlayer(-1));
    await assertFails(db('p5').doc('rooms/ABCD/players/p5').set({ name: 'Eve', joinedAt: now() }));
    await assertFails(db('p5').doc('rooms/ABCD/players/p5').set({ name: 'Eve', joinedAt: now(), expiresAt: 5 }));
    await assertSucceeds(newPlayer(7));
  });
  it('player create: the edge sits at 30 days', async () => {
    await assertFails(newPlayer(31));
    await assertSucceeds(newPlayer(29));
  });
  it('player update: name with expiresAt unchanged succeeds, changing expiresAt FAILS', async () => {
    const ref = db('p5').doc('rooms/ABCD/players/p5');
    await assertSucceeds(newPlayer(7));
    const { expiresAt } = (await ref.get()).data();
    await assertFails(ref.update({ expiresAt: ahead(20) }));
    await assertSucceeds(ref.update({ name: 'Evie', expiresAt }));
    await assertSucceeds(ref.update({ name: 'Eva' }));
  });
  it('player doc without expiresAt (older): rename succeeds, adding expiresAt FAILS', async () => {
    const ref = db('p1').doc('rooms/ABCD/players/p1');
    await assertFails(ref.update({ expiresAt: ahead(7) }));
    await assertSucceeds(ref.update({ name: 'New' }));
  });
  it('vote: 7 days ahead succeeds, 60 days ahead FAILS, in the past FAILS', async () => {
    await assertFails(vote(60));
    await assertFails(vote(-1));
    await assertSucceeds(vote(7));
  });
  it('player expiry is checked against the server clock: a phone 3 days slow or 3 days fast still works', async () => {
    // Built as phones would: their own now plus 7 days, so 4 and 10 days past the server's now.
    await assertSucceeds(db('p5').doc('rooms/ABCD/players/p5').set(player(7 - 3)));
    await assertSucceeds(db('p6').doc('rooms/ABCD/players/p6').set(player(7 + 3)));
  });
  it('gm hand-over batch creating the old game master\'s player doc passes', async () => {
    const d = db('gm');
    const b = d.batch();
    b.update(d.doc('rooms/ABCD'), { gmUid: 'p1', gmName: 'p1' });
    b.delete(d.doc('rooms/ABCD/players/p1'));
    b.set(d.doc('rooms/ABCD/players/gm'), { name: 'GM', joinedAt: now(), expiresAt: ahead(7) });
    await assertSucceeds(b.commit());
  });
});
