# Games

A single Docker container (nginx, static files) that hosts several browser games behind one game picker.

```
site/
├── index.html            # game picker (reads games.json)
├── games.json            # list of available games
└── games/
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
2. Add an entry to `site/games.json`.
3. Push to `main`. GitHub Actions builds and publishes the image to `ghcr.io/juldenereaz/games`
   (tagged `latest` and `sha-<commit>`; git tags `v*` also become image tags).

## Solitaire

- Draw One / Draw Three, Standard / Vegas / no scoring, timed game, cumulative Vegas score (Game menu)
- Drag & drop, double-click to send a card to a foundation, right-click to send every possible card up
- `F2` / `Space` deals a new game, `Ctrl+Z` undoes the last move (one level, like the original)
- Standard scoring follows the classic rules, including the −2 every 10 s penalty and the 700000 / seconds win bonus
- The bouncing-card win animation
