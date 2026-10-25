# UNO PARTY — Fixed full project

## Structure
- `frontend/public/index.html` — page structure and UI
- `frontend/public/style.css` — responsive neon styling
- `frontend/public/app.js` — browser game client and Socket.IO events
- `frontend/public/assets/uno-neon-background.svg` — local hero background art
- `backend/server.js` — authoritative multiplayer server
- `backend/src/game/deck.js` — shuffled 108-card classic deck
- `backend/src/game/rules.js` — move legality and scoring helpers
- `backend/test/game.test.js` — rules/deck smoke tests

## Run on Windows / VS Code
1. Install Node.js 18 or newer.
2. Open terminal in `backend` folder.
3. Run `npm install`.
4. Run `npm test`.
5. Run `npm start`.
6. Visit http://localhost:3000. The backend serves the frontend, so do not double-click index.html or start Live Server separately.

## Fixes in this version
- Create and Join have separate player-name inputs.
- Join validates a six-character room code and shows an inline error for malformed/nonexistent codes. Joining never creates a room.
- The host room code is generated once at room creation.
- Draw one card and then play that drawn card if legal, or pass the turn.
- Server-authoritative deck, turns, card validation, action cards, challenge/accept +4, UNO call/catch, scoring, room size, and host checks.
- Local background SVG; no external background URL needed.

## Notes
This is a fan-made UNO-style implementation, not affiliated with Mattel. The optional house rules are selectable in the room form; stacking and jump-in are supported in basic form. The 7–0 option implements a simplified 7 swap with the next player and 0 rotation. Before public launch, conduct multi-client tests and add persistence, reconnect handling, rate limiting, and automated full-game tests.


## UNO voice announcement and mobile support
- When a player presses UNO, every connected browser receives the server announcement and uses built-in browser text-to-speech to say: "[player name] says UNO!"
- The speaker button in the game header toggles voice announcements on/off.
- The layout includes responsive phone/tablet styles and touch-friendly card selection.
- Speech depends on browser/OS text-to-speech support and the device volume; some browsers may require a user interaction before speech can play.
