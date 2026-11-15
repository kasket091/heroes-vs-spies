# Spy word game: design

Date: 2026-11-15
Status: approved by Dave 2026-11-15

Lines marked **(call)** are choices Claude made, not things Dave asked for. Everything else is Dave's.

## Intent

A party game for friends in the same room. Each person plays on their own phone. Everyone gets the same secret word except one player, the spy, who gets a different word from the same family (example: everyone has *Cola*, the spy has *Water*). Players give clues out loud, then vote on who the spy is.

The spy is not told they are the spy. They find out by noticing that other people's clues don't fit their word, and then try to blend in.

## Goals

- Any number of players can join a room, each on their own phone.
- A room has one game master slot and the rest are player slots.
- The game master sees both words and who the spy is. Players see only their own word.
- The game master picks who gives the first clue. At least 2 players always speak before the spy.
- One vote decides the round. A new random spy is picked every round.

## Non-goals (first version)

- In-app chat, voice or video. People talk out loud. **(call)**
- Accounts, logins, friends lists. A name and a room code are enough. **(call)**
- Scoreboard across rounds. **(call)**
- More than one spy per round. Dave described one spy. **(call)**
- Playing with people who are not in the same room. It may work, but nothing is built for it. **(call)**
- Installed app store versions. **(call)**

## Anti-goals

- A player's screen must never show, hint or leak who the spy is before the reveal. All player screens look the same.
- A player's phone must not be able to read another player's word or the spy's identity from the backend, even with browser developer tools.
- The app must never let the spy speak first or second.

## How a round goes

1. **Lobby.** The game master creates a room and gets a short code. Players open the link, type the code and a name, and appear in the player list in the order they joined. That list is the speaking order. **(call)**
2. **Words.** The game master taps "New round". Only the game master's screen shows a random word pair from the built-in list, with which word the spy would get. The game master decides whether the pair goes ahead: "Use these words" deals it, "Skip" shows another pair. Nothing reaches the players' phones until the game master approves a pair. The game master can also type their own two words. **(call on typing their own)**
3. **Deal.** The app picks one player at random as the spy and sends each player their word. Players see only "Your word: COLA".
4. **First speaker.** The game master's screen shows the player list, the spy marked, and only the safe starters tappable. The game master taps one. **(call: the app limits the choice so a slip can't put the spy first or second)**
5. **Clues.** Every phone shows the speaking order, going around the list from the starter. Players give one clue each, out loud, without saying their word. The app does not track whose turn it is. **(call)**
6. **Vote.** The game master taps "Open voting". Each player picks one other player (not themselves). The game master sees how many have voted, not who they voted for, and can close voting early. Voting closes by itself when everyone has voted, as long as the game master's screen is open. **(call)**
7. **Reveal.** Every phone shows the most-voted player, whether they were the spy, who the spy really was, and both words.
   - Most-voted player is the spy: players win.
   - Anyone else, or a tie for most votes: spy wins. **(call on the tie)**
8. **Next round.** Back to step 2 in the same room. Before starting, the game master can hand the game master slot to a player and take a player slot. **(call)**

## Rules the app enforces

- **Minimum:** 1 game master and 4 players. "New round" is disabled below that. **(call: with 3 players the starter rule leaves only one possible spy, the third speaker, so the round has no mystery)**
- **Safe starter:** with players in seating order and speaking going around the circle from the starter, a starter is safe when the spy is the 3rd speaker or later. With `n` players, starter index `s` and spy index `p`: safe when `(p - s) mod n >= 2`. One shared function decides this for both the game master's screen and the write that saves the starter.
- **Joining mid-round:** a late joiner waits in the lobby and is dealt in next round. **(call)**
- **Dropping out:** a player who closes the tab and reopens the link on the same phone gets their seat and word back. The game master can remove a player. Removing anyone during a round cancels that round and shows the words, because a gap in the order could move the spy into the first two speakers. **(call)**
- **The game master's phone runs the round.** It deals, counts votes and triggers the reveal, so its screen must stay open; the game master screen says so. If it locks or closes, the round pauses and picks up when the game master reopens the link. If the game master leaves for good, the group starts a new room. **(call)**
- **Speaking order is the order on the phones** (join order), not where people physically sit. No reorder control. **(call)**
- **No hard player cap.** **(call)**

## A consequence of the starter rule

Because the spy never speaks first or second, everyone knows the first two speakers are not the spy. That is built into the rule Dave asked for. It makes the spy easier to find, more so in small groups: with 4 players only 2 suspects are left, with 5 players 3, and so on.

## Approaches considered

- **A. Web app from a link, Firebase for sync (chosen).** No install, works on any phone, free tier is enough. The game master's phone deals the words, so no custom server code. Chosen by Claude because Dave left the how open and this is the least to build and the least for friends to do before playing.
- **B. Installed phone app on the same backend.** Every friend installs first; app store accounts and review. Too much friction for a party game.
- **C. Web app with our own game server.** Most cheat-proof dealing, but a server to write, host and pay for. A already keeps each word private with access rules.

## How it is built (all Claude's calls)

- **Platform:** a phone-first web app, also usable on a laptop. English interface.
- **Backend:** Firebase: anonymous sign-in (gives each phone a stable id with no login), Firestore for room state, Firebase Hosting for the site. No Cloud Functions.
- **Who deals:** the game master's phone picks the spy and writes the words. The game master already knows everything, so trusting that phone leaks nothing.
- **Data, per room:**
  - Public room record: code, game master id, phase (lobby, clues, voting, reveal), player list in seating order, starter, count of votes cast, and, only at reveal, the result.
  - One private record per player: their word. Readable only by that player and the game master.
  - One game-master-only record: both words and the spy's id.
  - One vote record per player: writable once by that player during voting, readable only by the game master's phone, which tallies and writes the result at reveal.
- **Access rules** enforce the anti-goals above and are tested with the Firebase emulator.
- **Screens:** join/create, lobby, player round screen (word, speaking order, vote, reveal), game master round screen (words, spy, starter pick, voting progress, reveal).
- **Visual design:** done with the impeccable skill after the plan, per Dave's global instructions.

## Testing

- Unit tests: safe-starter function, vote tally including ties, random spy pick stays within the player list.
- Emulator tests for access rules: a player cannot read another player's word, the game-master-only record, or any vote.
- A manual run with 1 game master and 4 players in separate browser windows.

## Needs Dave

- A Firebase project to deploy to. The plan checks whether one exists; if not, creating it and signing in is a step Dave does or approves.

## Left to the builder

- Frontend framework and build tool.
- Room code format and length.
- How the app loads the built-in word pairs. The list itself is `words/word-pairs.json` (70 pairs, Dave asked for at least 50). The app picks at random which word of a pair goes to the spy.
- Cleanup of old rooms.
- Exact wording and layout of each screen.
