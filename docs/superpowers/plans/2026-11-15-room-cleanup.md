# Room Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete a room at once when its game master leaves it with no players, and let Firebase delete any room 24 hours after its last activity.

**Architecture:** Every room and every record under it carries an `expiresAt` timestamp; Firestore's built-in TTL policy deletes records whose time has passed. The game master's phone pushes the room's time 24 hours ahead on every write it already makes. One access rule is added so a game master can delete their own room. No server code.

**Tech Stack:** unchanged, plus `firestore.indexes.json` for the TTL field overrides.

**Spec:** `docs/superpowers/specs/2026-11-15-room-cleanup-design.md` (read it first), building on `2026-11-15-heroes-vs-spies-design.md`.

## Global Constraints

- Room `expiresAt` = 24 hours after the game master's latest write to the room. Records under a room (`players`, `private`, `gm`, `votes`) get `expiresAt` = 7 days after they are written.
- The game master leaving a room with no players deletes the room at once. With players present, leaving keeps the room, as today.
- A room must never be deleted while a game is being played in it.
- Access rules loosen in exactly one way: a room's own game master may delete that room. Every other rule stays as tight or tighter.
- A person whose room is gone lands on the join screen, never an error or a hang.
- Nothing that costs money is switched on without Dave's yes. No existing room is deleted without Dave's yes.
- Dave's planning checks: this adds a catch-up job (the timed deletion), so the first-run step in Task 2 applies. Previews and money guards do not apply.

## Review Focus

1. **First run against current data.** Enabling the TTL policy must delete nothing that exists today (no existing record has `expiresAt`). Task 2 counts today's rooms and shows Dave the number and the command before any one-time cleanup. (Task 2 Steps 3 and 6)
2. **Every way back in after a room is deleted, for every role.** Reload with `?room=`, the bare link (remembered room), typing the code: game master, active player, benched player and late joiner all land on the join form, with "Room not found" where a code was typed. (Task 1 tests `gone room: ...`)
3. **A room in use for more than a day.** A family keeps one room open across two days: the room's time keeps moving on each game master action, and the player list (7-day records) is still there on day two. (Task 1 test `second-day room`)
4. **Leaving with players present, or mid-game.** The room is not deleted; "Leave room" is not offered to the game master mid-game at all. (Task 1 tests `leave with players`, `no leave mid-game`)
5. **A phone with a wrong clock.** `expiresAt` on player and vote records is written by players' phones; a clock that is days off must not make the write fail in a confusing way. (Task 1 test `player expiry uses server time bounds`)

---

### Task 1: Expiry times and delete-on-leave

**Files:**
- Modify: `src/room.js`, `src/main.js`, `src/ui.js`, `firestore.rules`, `tests/room.test.js`, `tests/rules.test.js`, `tests/ui.test.js`

**Interfaces:**
- Produces:
  - `ROOM_TTL_MS = 24 * 60 * 60 * 1000`, `RECORD_TTL_MS = 7 * 24 * 60 * 60 * 1000` in `src/room.js`.
  - Every write to `rooms/{code}` by the game master (`createRoom`, `dealWords`, `nextRound`, `pickStarter`, `openVoting`, `closeVoting`, `removePlayer`, `handOverGm`, and the internal end-of-game write) also sets `expiresAt` to a Firestore `Timestamp` 24 hours after now.
  - Every write of a `players`, `private`, `gm` or `votes` record sets `expiresAt` 7 days after now. A rejoin (name update) leaves the player's `expiresAt` as it was.
  - `deleteRoom(db, code): Promise<boolean>`: game master only. Reads the players; if there are none, deletes `gm/secret` and the room and returns `true`; otherwise deletes nothing and returns `false`.
  - The `leave` action in `src/main.js`: for the game master it calls `deleteRoom`, then forgets the remembered code and shows the join form either way.
  - `src/ui.js`: the game master's line under "Leave room" reads "Nobody has joined, so leaving deletes this room." when the player list is empty, and the current "The room stays open. Type its code to come back." otherwise.
- Access rules:
  - `rooms/{code}`: add `allow delete: if isGm(code);`.
  - `players`: `expiresAt` joins the allowed keys; on create it must be a timestamp later than `request.time` and no later than `request.time + duration.value(8, 'd')`; on update it must be unchanged.
  - `votes`: `expiresAt` joins the allowed keys with the same bounds.
  - Use the server's time for these bounds, not the phone's: have the client send `expiresAt` in a way that passes whatever the phone's clock says (for example compute it from an estimate of server time, or let the rule accept a server-timestamp-based value). If that cannot be done cleanly, report it instead of weakening the bounds.

- [ ] **Step 1: Write the failing tests.**

`tests/room.test.js`:

```
createRoom sets expiresAt                 about 24 hours ahead (within a minute)
each game master action moves expiresAt   dealWords, pickStarter, openVoting, closeVoting, nextRound, removePlayer,
                                          handOverGm: after each, expiresAt is later than before and about 24 hours ahead
records under a room carry expiresAt      a player doc, a private doc, gm/secret and a vote each have one about 7 days ahead
rejoin keeps the player's expiresAt       joinRoom again under a new name: expiresAt unchanged
second-day room                           with the room's expiresAt and a player doc both written "yesterday" (set by a
                                          rules-disabled write), a game master action moves the room's time ahead and the
                                          player list still has that player
deleteRoom with no players                returns true; the room and gm/secret no longer exist
deleteRoom with a player                  returns false; the room still exists
gone room: every role                     after the room doc is deleted, a fresh subscribe for the game master, an active
                                          player, a benched player and a late joiner each emits room null
gone room: typed code                     joinRoom rejects 'Room not found'
```

`tests/rules.test.js` (each refusal paired with an allowed case on the same path):

```
game master deletes own room              succeeds
a player deletes the room                 FAILS
another room's game master deletes it     FAILS
player creates own doc with expiresAt 7 days ahead      succeeds
player creates own doc with expiresAt 30 days ahead     FAILS
player creates own doc with expiresAt in the past       FAILS
player updates name, expiresAt unchanged                succeeds
player updates expiresAt                                FAILS
vote with expiresAt 7 days ahead                        succeeds
vote with expiresAt 30 days ahead                       FAILS
player expiry uses server time bounds     a create whose expiresAt is right by the server's time succeeds even when
                                          built the way a phone with a wrong clock would build it
```

`tests/ui.test.js`:

```
leave line, empty lobby                   contains "Nobody has joined, so leaving deletes this room."
leave with players                        contains "The room stays open." and not the delete line
no leave mid-game                         the game master's clues, voting and result screens have no "Leave room"
gone room: screenFor                      room null gives the join screen for a game master uid and for a player uid
```

- [ ] **Step 2:** `npm test` fails on the new cases.
- [ ] **Step 3:** Implement. One helper builds the expiry timestamps; do not repeat the arithmetic at each write.
- [ ] **Step 4:** `npm test` passes (144 before this task) and `npm run build` exits 0.
- [ ] **Step 5: Commit.**

### Task 2: Turn the timed deletion on (needs Dave)

**Files:**
- Create: `firestore.indexes.json`
- Modify: `firebase.json`

- [ ] **Step 1:** Look up, in Firebase's current documentation, how a TTL policy is declared for the CLI (field overrides with `"ttl": true` in `firestore.indexes.json`) and whether it works without billing. Write `firestore.indexes.json` with a TTL field override on `expiresAt` for each of the collection groups `rooms`, `players`, `private`, `gm`, `votes`, and point `firebase.json` at it. Commit.
- [ ] **Step 2: Ask Dave before any deploy**, showing the commands: `npx firebase deploy --only firestore:rules`, `npx firebase deploy --only firestore:indexes`, then `npm run build` and `npx firebase deploy --only hosting`.
- [ ] **Step 3: First run.** State to Dave, before deploying: enabling the policy deletes nothing today, because no existing record has `expiresAt`; from now on a room goes 24 to 48 hours after its last activity.
- [ ] **Step 4:** Deploy in that order with his yes. If the indexes deploy says billing is required, stop: deploy nothing further that depends on it, tell Dave what Firebase said and what switching billing on would mean, and wait. Rule 1 (delete on leave) and the rules can still go live without the TTL.
- [ ] **Step 5: Verify on the live site:** create a room and leave it with no players, then type its code: "Room not found". Create a second room and read its `expiresAt` to confirm it is set. Tell Dave the TTL itself can only be confirmed in about two days, and name the room code to check.
- [ ] **Step 6: One-time cleanup of today's rooms.** Count the rooms that exist (Firebase console or an admin read), and show Dave the number and the exact command. It is all-or-nothing and permanent; run it only on his explicit yes, at a time nobody is playing. If he declines, old rooms stay.
- [ ] **Step 7:** `superpowers:verification-before-completion`, then commit, merge and push as Dave chooses.
