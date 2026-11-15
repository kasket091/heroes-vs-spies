# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: Vite with vanilla JavaScript (no framework), Firebase anonymous sign-in, Firestore and Firebase Hosting. Dave left the how to Claude and approved it in the design doc; chosen for no install and the least to build.

## Users

Families with kids, in the same room, each holding their own phone. Mixed ages and mixed reading speed. One person acts as game master for a round; everyone else plays. They are talking and laughing out loud; the phone is glanced at, not studied.

## Product Purpose

A spy word party game. Everyone gets the same secret word except one player, the spy, who gets a related word and is not told they are the spy. Players give clues out loud, then vote once on who the spy is. Success is a round that starts in under a minute, never leaks the spy, and makes people want another round.

## Positioning

The game master is a person in the room who sees everything: both words and who the spy is. They approve or skip each word pair before it reaches the players and pick who speaks first, and the app guarantees at least 2 people speak before the spy.

## Operating Context

- Phones held in one hand, often passed glances between speakers, in living-room light.
- The game master's phone runs the round and must stay open.
- Screens are read at arm's length for a second or two; other people may be sitting close enough to glance at a neighbour's screen.
- Players join with a short room code read out loud.

## Capabilities and Constraints

- One game master slot, any number of player slots, minimum 4 players to start.
- Phases: lobby, clues, voting, reveal, cancelled.
- A player's screen must never show or hint who the spy is before the reveal; all player screens look identical.
- One vote per round; a tie or no votes means the spy wins.
- 70 built-in word pairs in `words/word-pairs.json`; the game master can type their own.
- No chat, accounts, scoreboard, or multiple spies.
- English interface.
- Full rules: `docs/superpowers/specs/2026-11-15-spy-game-design.md`.

## Brand Commitments

- Working title on screen: "Spy Game". Dave will pick a real name later, so the name must live in one place.
- No logo, colours or fonts are fixed.

## Evidence on Hand

- The word pair list. No screenshots, testimonials or player data exist; none may be invented.

## Product Principles

1. The secret comes first: nothing on a player's screen may narrow down the spy.
2. One thing per screen: at any moment a phone shows the one thing its holder needs.
3. The room is the game: the app deals, counts and reveals, and stays out of the conversation.
4. A child can play: plain words, large type, big tap targets.

## Accessibility & Inclusion

Mixed ages including children and grandparents: large readable text, tap targets of at least 44px, strong contrast, and no information carried by colour alone.
