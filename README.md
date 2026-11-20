# Games

A single Docker container (nginx, static files) that hosts several browser games behind one game picker.

```
site/
├── index.html            # game picker (reads games.json)
├── games.json            # list of available games
└── games/
    ├── minesweeper/      # Minesweeper, Windows XP style (canvas, no image assets)
    └── solitaire/        # Klondike Solitaire, Windows XP style
        ├── index.html
        ├── style.css
        ├── favicon.png
        ├── js/solitaire.js
        └── img/<RANK>_<SUIT>.png   # RANK: A 2-9 0(=10) J Q K, SUIT: C D H S
```

## Run

```sh
docker run -d --name games -p 3012:8080 --restart unless-stopped ghcr.io/juldenereaz/games:latest
# or: docker compose up -d
```

Open http://localhost:3012 (the container listens on 8080 internally; pick any free host port). Put it behind your reverse proxy for your domain. All paths are relative, so it also
works under a sub-path such as `https://example.com/games/`. The health check is at `/healthz`.

## Adding a game

1. Create `site/games/<name>/` with an `index.html` (plain static files, no build step).
2. Add an entry to `site/games.json` (`aspect` = width/height of the frame it is shown in on the homepage).
   If the game has an "exit" action, have it call
   `window.parent.postMessage({ type: 'games:exit' }, location.origin)` when embedded.
3. Push to `main`. GitHub Actions builds and publishes the image to `ghcr.io/juldenereaz/games`
   (tagged `latest` and `sha-<commit>`; git tags `v*` also become image tags).

## Solitaire

- Draw One / Draw Three, Standard / Vegas / no scoring, timed game, cumulative Vegas score (Game menu)
- Drag & drop, double-click to send a card to a foundation, right-click to send every possible card up
- `F2` / `Space` deals a new game, `Ctrl+Z` undoes the last move (one level, like the original)
- Standard scoring follows the classic rules, including the −2 every 10 s penalty and the 700000 / seconds win bonus
- The bouncing-card win animation

## Minesweeper

- Beginner (9×9, 10), Intermediate (16×16, 40), Expert (30×16, 99) and Custom fields
- First click is always safe; left-click opens, right-click flags (and `?` marks, toggleable)
- Both buttons or middle-click on a number opens its neighbours when enough flags are placed
- Touch: tap to open, long-press to flag, tap a number to open its neighbours
- Smiley / `F2` for a new game, best times per level with names (stored in the browser)
