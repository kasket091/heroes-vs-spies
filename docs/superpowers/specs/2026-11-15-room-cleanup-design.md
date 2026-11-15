# Room cleanup: design

Date: 2026-11-15
Status: approved by Dave 2026-11-15
Builds on: `2026-11-15-heroes-vs-spies-design.md` (the live game).

Lines marked **(call)** are choices Claude made, not things Dave asked for.

## Intent

Dave wants every empty room deleted automatically. Rooms pile up today: the access rules allow no deletion at all, and people leave a room by closing the tab, not by tapping anything.

## What "empty" means (agreed with Dave)

1. **The game master leaves a room that has no players:** the room is deleted right away.
2. **Nothing has happened in a room for 24 hours:** the room is deleted by itself, whether or not people are still listed in it.

A brand-new room with no players yet is not empty in this sense; it only becomes so through rule 1 or rule 2.

## Goals

- Rule 1 and rule 2 above.
- No phone has to be open for rule 2 to work.
- A person whose room disappears lands on the join screen, not an error.

## Non-goals

- Deleting a room the moment its last player leaves while the game master is still there. **(call)**
- Warning people before a room expires. **(call)**
- Keeping any history of deleted rooms.

## Anti-goals

- A room must never be deleted while a game is being played in it.
- Loosening the access rules beyond what these two rules need: only the room's own game master may delete it, and only that room.

## Trade-offs carried over from the earlier designs, re-weighed

- The earlier designs said old rooms are never cleaned up because they are tiny. This design reverses that.
- "Removing a room" was impossible by rule. It becomes possible for the room's game master only. A game master could already end their own room's game at any time, so this adds no new power over other people's rooms.
- Nothing accepted earlier depended on rooms living forever: remembered rooms already fall back to the join screen when the room is gone.

## Approaches considered

- **A. Firestore's built-in expiry ("TTL") (chosen).** Each room carries a "delete after" time, pushed 24 hours ahead whenever the game master does anything. Firebase deletes expired records by itself. No code runs on a schedule and no server is written. Limits, from Firebase's documentation:
  - Deletion is "typically within 24 hours" after the time passes, so a room goes 24 to 48 hours after its last activity, not at exactly 24.
  - Deleting a room does not delete the records under it (players, words, votes); those need their own expiry.
  - The documentation does not say whether this needs billing switched on. The build finds out by trying; if it does need billing, the build stops and asks Dave before anything is switched on.
- **B. A scheduled cleanup function.** Exact timing and one sweep deletes everything under a room. It needs the paid plan for certain, and adds server code to write, test and watch.
- **C. Cleanup from players' phones.** Free and immediate, but phones cannot see other rooms (listing rooms is blocked on purpose), so abandoned rooms would never be found.

## How it works (Claude's calls unless marked)

- **"Delete after" time on the room:** set to 24 hours ahead when the room is created and on every action the game master's phone writes: starting a game, dealing words, picking the first speaker, opening or closing voting, next round, removing a player, handing over. A game in play refreshes it every few minutes, so a running game cannot expire.
- **Records under a room** (players, each player's word, the game master's secret, votes): each gets its own "delete after" time of 7 days from when it is written. Seven days, not 24 hours, so a room in use across several days never loses its player list while it is alive. Leftovers from a deleted room disappear by themselves; until then the room's code is locked (see "Corrections after review").
- **Rule 1:** when the game master taps "Leave room" and the player list is empty, the app deletes the room and the game master's secret. With players present, "Leave room" behaves as today: the room stays.
- **Access rules:** the room's game master may delete that room. Nothing else changes.
- **Rooms that exist today** have no "delete after" time until someone uses them on the new page; from that moment the 24-hour rule applies to them too. The records under them never get a time, so they are only removed by the one-time cleanup. (Corrected 2026-11-15; this line first said they would never be touched.)

## First run against current data (Dave's planning check)

- Turning the expiry on deletes nothing on day one: it only acts on records that carry a "delete after" time, and none do yet.
- A one-time cleanup of today's rooms is a separate, permanent deletion. Before it runs, the build counts the rooms that exist and shows Dave the number and the exact command; nothing is deleted without his yes. Every room that exists today is either a test room or from the old or current version with no way to tell which are in use, so the cleanup is all-or-nothing and best done when nobody is playing.

## Testing

- Unit and emulator tests: every game master action moves the room's "delete after" time 24 hours ahead; every record under a room carries its own time; the game master leaving an empty room deletes it; leaving a room with players does not; a player or another game master cannot delete a room; a player whose room is gone lands on the join screen.
- The expiry itself runs only on Firebase's side and cannot be tested locally. It is checked after deploy by creating a room and confirming it is gone two days later.

## Left to the builder

- Field name and how the expiry is declared in the Firebase config.
- Wording on the "Leave room" line when leaving will delete the room.

## Corrections after review (2026-11-15)

The task review found three faults in this design. Each fix is Claude's call, made to keep the goals above; none changes how the game plays.

- **Leftovers are not unreachable.** Deleting a room frees its code, and whoever creates a room under that code again would become game master over the old room's leftover votes, words and player records. Fix: every room has a lock record that lasts 40 days after the room's last activity, longer than any leftover can live. While the lock exists the access rules refuse to create a room under that code, and the app picks another code. Leaving an empty room deletes the room but keeps the lock.
- **Updating the live game.** Phones that still have the previous page open do not send a "delete after" time. The access rules therefore accept it when present and do not require it. The rules are deployed before the new page.
- **The game master's phone clock.** The room's "delete after" time comes from the game master's phone. The rules refuse a time that is not in the future, and the game master is told their phone's date looks wrong. Players' records accept a time up to 30 days ahead (not 8), so a phone up to a week slow or three weeks fast still works; a leftover can therefore linger up to 30 days.

## Further corrections after the whole-branch review (2026-11-15)

- **Minimum lifetimes.** A record under a room must be stamped between 1 and 30 days ahead, and a room at least 12 hours ahead. A player's phone more than 6 days slow, or a game master's phone more than 12 hours slow, is refused and told its date looks wrong. Without a minimum, a slow phone could stamp a record that expired almost at once.
- **Rooms used for more than 7 days.** A player's record is refreshed each time that player opens the room, so the player list does not expire while people keep coming back.
- **Records with no "delete after" time** (everything that exists today, and anything written by a phone still on the old page) never expire. Two guards stop them resurfacing: the app will not create a room under a code that still has player records, and the vote count ignores votes from anyone not in the current round. The one-time cleanup must delete everything under each room, not only the room.
- **The lock record cannot be deleted** by anyone, the game master included.
- **During the update only:** a game master still on the old page, in a room already used on the new page, stops refreshing the room's time; reloading the page fixes it.

## Outcome at deploy (2026-11-15)

Firebase refused the timed deletion: it needs billing enabled on the project. Dave chose to skip the timer. What is live: a room is deleted when its game master leaves it with nobody in it; rooms people walk away from are not deleted. Records still carry their "delete after" times, so the timer can be switched on later without another code change: enable billing, add `"indexes": "firestore.indexes.json"` back to the `firestore` section of `firebase.json`, and run `npx firebase deploy --only firestore:indexes`. Until then lock records never expire, so a used code is never reused.
