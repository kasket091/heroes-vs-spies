# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: Vite with vanilla JavaScript (no framework), Firebase anonymous sign-in, Firestore and Firebase Hosting. Dave left the how to Claude and approved it in the design doc; chosen for no install and the least to build.

## Users

Families with kids, in the same room, each holding their own phone. Mixed ages and mixed reading speed. Everyone plays; there is no game master. The person who creates the room (the host) is a player like the others whose phone also runs the room. They are talking and laughing out loud; the phone is glanced at, not studied.

## Product Purpose

A spy word party game, played as Heroes vs Spies. Everyone gets the same secret word except one player, the spy, who gets a related word and is not told they are the spy. Players give clues out loud, then vote one player out. If that player was the spy, the Heroes score a point and a new spy gets new words. If not, the Spies score a point and the same spy and words go on. Voted-out players sit on the Hero bench or the Spy bench and win or lose with that team. When 3 players are left, a final battle worth the score gap plus 1 decides the game. Success is a round that starts in under a minute, never leaks the spy, and makes people want another game.

## Positioning

The game runs itself. Nobody sees both words or knows the spy until the game reveals them, the host included. Words are picked at random, the first speaker is picked at random (in the first round after words are dealt, with 5 or more players still in, at least 2 people speak before the spy), and rounds advance by themselves about 10 seconds after each result. The host's only required action is tapping New game.

## Operating Context

- Phones held in one hand, often passed glances between speakers, in living-room light.
- The host's phone runs the room in the background and must stay open. If it sleeps, the other phones say so once everyone has voted or a result has shown for a while.
- Screens are read at arm's length for a second or two; other people may be sitting close enough to glance at a neighbour's screen.
- Players join with a short room code read out loud.

## Capabilities and Constraints

- Any number of players, minimum 4 to start, the host included.
- Phases: lobby, voting, result, gameOver. Vote buttons are on every phone from the start of a round; a vote is cast once and never changed.
- A player's screen must never show or hint who the spy is while that spy is still in the game; all player screens look identical apart from the word. A "not the spy" result shows no words and no spy, and the Spy bench lists only spies already caught.
- One vote per round benches one player. A tie (or no votes) draws one of the tied players at random, the spy included, and the result does not mention the tie.
- In the first round of a word set, with 5 or more players still in, the spy speaks third or later. In later rounds of the same word set, and with 4 or 3 players, anyone may start, the spy included.
- Final battle at 3 players: one vote worth the score gap plus 1, so its winner wins the game. Fewer than 3 left (after removals) ends the game on the current score; a level score is a draw.
- Benched players see only the scoreboard and are not dealt words. Late joiners wait for the next game. Scores start at 0–0 each game.
- 63 word families of 4 related words in `words/word-families.json`; a pair is any two words of one family (378 pairs). A pair never repeats in a room until every pair has been used. Nobody types words.
- No chat, accounts, scores carried between games, or more than one spy at a time.
- English interface.
- Players other than the host can always leave; the host leaves only alone (the room is deleted) or after handing the room to someone between games.
- Full rules: `docs/superpowers/specs/2026-11-15-no-game-master-design.md` (builds on `2026-11-15-heroes-vs-spies-design.md` and `2026-11-15-spy-game-design.md`).

## Brand Commitments

- Name on screen: "Heroes vs Spies" (Dave, 2026-11-15). It is defined in one place, `GAME_NAME` in `src/ui.js`.
- No logo, colours or fonts are fixed.

## Evidence on Hand

- The word families list. No screenshots, testimonials or player data exist; none may be invented.

## Product Principles

1. The secret comes first: nothing on a player's screen may narrow down the spy.
2. One thing per screen: at any moment a phone shows the one thing its holder needs.
3. The room is the game: the app deals, counts and reveals, and stays out of the conversation.
4. A child can play: plain words, large type, big tap targets.

## Accessibility & Inclusion

Mixed ages including children and grandparents: large readable text, tap targets of at least 44px, strong contrast, and no information carried by colour alone.
