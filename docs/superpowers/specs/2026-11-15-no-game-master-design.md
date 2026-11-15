# Heroes vs Spies without a game master: design

Date: 2026-11-15
Status: approved by Dave 2026-11-15
Builds on: `2026-11-15-heroes-vs-spies-design.md` and `2026-11-15-room-cleanup-design.md` (both live). Everything in them still holds unless this design changes it.

Lines marked **(call)** are choices Claude made, not things Dave asked for. Everything else is Dave's.

## Intent

Dave wants the game to run itself. Nobody sits out as game master, nobody chooses or approves words, and the person who creates the room only taps "New game". Everything else happens automatically, and a pair of words never comes up twice in the same room.

## What changes for people

| Today | New |
|---|---|
| One person is game master and does not play | Everyone plays. The person who created the room is called the **host** here; on screen they are just a player with a "New game" button |
| The game master approves or skips each word pair, or types their own | Words are picked at random. Nobody sees them first. No typing your own |
| The game master picks the first speaker | The game picks at random |
| The game master taps Open voting | The vote buttons are on every phone from the start of the round, under the speaking order |
| The game master taps Next round | The next round starts by itself about 10 seconds after the result |
| The game master sees both words and the spy | Nobody does, until the game reveals them |
| At least 4 players plus the game master (5 people) | At least 4 people in the room, the host included |

## Goals

- No game master. The host is a normal player: gets a word, can be the spy, votes, can be voted out.
- The host's only required action is tapping **New game** once at least 4 people are in the room, and again for each new game.
- Word pairs are random and never repeat within a room. When every pair has been used, the list starts over. **(call on starting over)**
- **Word families** (Dave, 2026-11-15, after the design review). The words are grouped into families of 4 related words, for example Cola, Water, Juice, Milk, in `words/word-families.json`. A pair is any two words from one family, so seeing your own word no longer tells you the other one: it could be any of three. 63 families give 378 possible pairs. This replaces the list of 70 fixed pairs, where each word had exactly one partner and regular players could learn them; with no game master there is nobody left to type fresh words.
- Rounds advance by themselves: deal, speaking order, votes, result, next round, final battle, game over.
- Scoring, benches, the final battle and who wins are unchanged.

## Non-goals

- Choosing, skipping or typing words.
- Any screen that shows both words or the spy during play.
- Changing a vote after it is cast. **(call)**
- A timer that forces a vote. A round waits until everyone still in has voted. **(call)**

## Anti-goals

- No screen, the host's included, may show or hint who the spy is or what the other word is before the game reveals it.
- The host's screen during a round must match every other player's, apart from controls that have nothing to do with the spy (see "What the host's phone shows").
- The list of word pairs already used in a room must not be readable by players: it would narrow down the pair in play. (The word list itself ships with the page, so a player can always learn which family their word belongs to; that is accepted.)
- A game must never be left stuck with no way forward.

## The trade-off Dave has been told about

Something has to deal the words, know the spy and count the votes. With no game master, the host's phone does it in the background. It never shows any of it, but the secret is inside that phone's browser, so a host who opens the browser's developer tools could read the spy, every word and every vote, or could write a false result. Players other than the host still cannot. The alternative, dealing on Firebase's side, needs billing switched on, which Dave declined for the room timer. This is accepted for a family game. **(call, stated to Dave before the design)**

## Trade-offs carried over from the earlier designs, re-weighed

- **"The first two speakers are not the spy"** (first round of a word set, 5 or more players). Still true and still once per word set. The first speaker is now random among the allowed starters instead of chosen, which reveals nothing more.
- **"The game master's phone runs the game and must stay open."** Now the host's phone. New consequence: the host is a player who can be voted out and may put their phone down. The game then stops advancing. See "When the game stalls".
- **"Removing a player cancels the round."** Unchanged, and now more important: with no timer, removing a player who has gone is the only way past a vote they will never cast.
- **"The game master is trusted with the room."** The trusted phone now belongs to a player with a stake in the result. That is the trade-off above.
- **Votes were opened only after the clues.** Now they are open from the start, so someone can vote before hearing every clue. That is their loss; a cast vote cannot be changed.
- **The game master could close voting early.** Gone with the game master. Replaced by removal (above).
- **Old pages stay cached for up to an hour after a deploy** (found during the last two deploys). This change is bigger than those: a phone on the old page in a new-style room would show the wrong screens. See "Updating the live game".

## How a game goes

1. **Lobby.** The host creates the room and is on the player list like everyone else. Others join with the code. "New game" is on the host's screen only, disabled under 4 people with the reason shown.
2. **Deal.** The host taps New game. The game picks a word pair at random from those not yet used in this room, picks which word the spy gets, picks the spy, and picks the first speaker (keeping two speakers ahead of the spy when this is the first round of a word set with 5 or more players; otherwise anyone). All in one step.
3. **Round.** Every phone still in shows its word, the speaking order and the vote buttons. People give clues out loud in order, then vote. A phone that has voted shows "Vote sent" and who the game is still waiting for. **(call: naming who has not voted yet, never who voted for whom)** Each phone marks its own player record when it has voted, so every phone can work out who is still to vote without the host's phone being awake. The mark carries no target; the votes themselves stay readable by the host's phone only.
4. **Result.** When the last vote arrives the result appears on every phone, as today: who is out, whether they were the spy, the point, and the words if the spy was caught.
5. **Next round.** About 10 seconds after the result, the next round starts by itself: the same words if a Hero went out, new random words if the spy was caught, the final battle at 3 players. Phones show "Next round starts in a moment."
6. **Game over.** After the final battle, as today. The host's screen has New game again; scores reset; late joiners are dealt in.

A tie, the final battle's points, who wins, benches, late joiners and the shortest game (4 people: one round, then the final) are as in the Heroes vs Spies design.

## What the host's phone shows

Identical to any player's, plus:

- In the lobby and at game over: **New game**, **Remove**, hand the room to another player, **Leave room**.
- During a game: a collapsed **Remove a player** link, and one line, "Your phone runs this room. Keep this screen open."

Nothing else. The host's phone must not load the spy or the other word into anything it displays.

## When the game stalls

- **Someone never votes** (left the room, phone died): everyone sees who the game is waiting for. The host removes that player; the round is cancelled without a point, as today, and the next round starts by itself.
- **The host's phone is asleep or closed:** nothing advances. Other phones can tell in exactly two situations, and only then show "Waiting for <host>'s phone. Ask them to open the game.": everyone still in is marked as having voted but no result has come for about 10 seconds, or a result has been showing for about 20 seconds with no next round. **(call)** During the clues there is nothing to detect and no message. When the host's phone wakes, it carries on from where the room is, including finishing a countdown that had already run out.
- **The host leaves for good:** the game is lost and the group starts a new room. So that they can, every player other than the host has a low-key **Leave room** at all times; during a game it asks first ("You're in a game. Leaving can hold it up for the others."). A player who leaves mid-game is simply someone who will not vote: the host removes them. **(call)**
- **The host wants to leave:** alone in the room, leaving deletes the room and the host's own record. With other people in the room, the host must first hand the room to another player (between games only), and then leaves like anyone else. **(call)**
- **The host is voted out:** they go to a bench like anyone, and their phone keeps running the room.

## Rules the app enforces

- At least 4 people in the room to start, the host included.
- Used word pairs are remembered per room in a record only the host's phone can read. When all are used, the record is cleared.
- Only the host's phone can deal, score, bench, remove and advance, as only the game master's could.
- A player votes once per round, for another player still in, as today.
- The automatic steps are safe to run twice: two tabs on the host's phone, or a reload during a countdown, must not deal twice, score twice or skip a round.
- Removing: the host can remove any other player. The host cannot remove themselves; they hand the room over between games instead.
- Room cleanup: a room is deleted when the host leaves it with nobody else in it, and the host's own player record goes with it.

## Updating the live game

- Rooms made by the current version have a game master who is not a player. The new page treats them like the last upgrade did: "This room is from an older version. Create a new one."
- A phone still on the OLD page must not be able to run a new-style room: as host it would show the old game master screens, with both words and the spy. New rooms therefore store their list of players still in under a new name, which makes every old page refuse them with its own "older version" message. **(call)**
- A phone still on the old page that joins a new-style room would show the old screens against new data. Mitigation **(call)**: the site stops letting browsers keep the page for an hour (the page itself is always re-checked; only the unchanging script and style files are kept), so this is the last deploy with that problem. For this deploy, games in progress are abandoned and people may need to close and reopen the page.
- The access rules change in two ways only: the host may have a player record (today the game master may not), and a player may mark on their own record which round they have voted in. Every other rule stays as it is or tighter. Rules are deployed before the page; the current page keeps working under them.
- A preview address for Dave to test on phones before the live game is replaced, as last time.

## Approaches considered

- **A. The host's phone runs the game in the background (chosen).** Free plan, no server, reuses the tested room logic. Cost: the host could peek or cheat with developer tools.
- **B. Deal and count on Firebase's side.** Nobody's phone holds the secret. Needs billing, and server code to write and watch.
- **C. No trusted phone: players' phones jointly shuffle with cryptography.** No server and no trusted host, but far too much machinery for a family game, and every phone would have to stay connected for every step.

## How it is built (Claude's calls)

- Same stack and Firebase project. The room keeps its `gmUid` field as "the host" so the tested rules keep working; no screen says "game master".
- The host's player record is created with the room. Access rules drop the one line that forbids it.
- New pure rules with unit tests: choosing an unused pair and resetting when exhausted; choosing a random first speaker from the allowed starters; who the round is still waiting for.
- The room logic gains one "run the room" loop on the host's phone that reacts to the room's state: all votes in, close the vote; result shown for 10 seconds, advance. It reads the secret only inside those steps, never into what the screen draws.
- The room record gains: the renamed list of players still in (which also marks a new-style room) and the time the result was written (read back only by the host's own phone, so clock differences between phones do not matter). Who has voted is read from the players' own records.
- The used-pairs list lives beside the host-only secret.
- Screens removed: words approval, first-speaker pick, the game master's round and result views. Screens changed: the round (vote buttons from the start, "waiting for"), result (countdown line), lobby (host is listed as a player).
- Hosting config: stop the hour-long caching of the page.
- Screens designed with the impeccable skill in the existing writing-pad look.
- After go-live: the How to Play document and its PDF are rewritten for the new flow.

## Testing

- Unit tests for the new pure rules, including: 70 deals in one room never repeat a pair, the 71st works, and no public record lists used pairs.
- Emulator tests: a whole game with no manual step after New game; the host as spy; the host voted out and the game still advancing; a reload and a second tab during the countdown; a player who never votes, then removed; a host's player record allowed by the rules and a paired refusal for someone else's; the host's and a player's round screens identical apart from the host-only controls; nothing public reveals the spy, the words or the used pairs.
- Every way back in for every role: reload, the plain link, typing the code, for the host, an active player, a benched player, a late joiner and a removed player.
- A browser run of a whole game, then Dave on real phones at a preview address before go-live.

## Left to the builder

- Exact wording of the waiting, countdown and stalled lines.
- Whether the 10 seconds is shown as a number or a moving bar.
- Field names for the new-room marker, result time and voted list.

## Changes after the reviews (2026-11-15)

- **Close the vote now** (Claude's call, told to Dave): during a vote the host's collapsed section holds one more control beside Remove a player. It counts the votes cast so far. It exists so that a player who will not vote does not force a cancelled round; it is never part of normal play.
- **Removing someone who left.** The host's remove list covers everyone still in the round, not only people on the player list, so a player who left mid-game can always be removed.
- **Waiting line.** "Waiting for: ..." shows on every screen during a vote, before and after you vote, and on the bench.
- **The "voted" mark** can only be set together with a real vote, enforced by the access rules.
- **Word families are used evenly:** the first 63 deals in a room each come from a different family, so a returning family cannot be narrowed down from memory.
- **Round screen:** the speaking order and the vote buttons are one list.
- **A background step that fails** on the host's phone is shown to the host as a message.
