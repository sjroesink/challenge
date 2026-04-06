# Push-Up Challenge — Design Spec

## Overview

Web app voor een groep van 4-8 mensen die elke dag 1 extra push-up doen (dag 1 = 1 push-up, dag 2 = 2, etc.). Startdatum: 1 april 2026. Open-ended, geen einddatum.

## Architecture

Monolith: Fastify backend + vanilla HTML/CSS/JS frontend, SQLite database. Eén Docker container.

### Tech Stack

- **Runtime:** Node.js
- **Backend:** Fastify + better-sqlite3
- **Frontend:** Vanilla HTML/CSS/JS (geen framework)
- **Database:** SQLite
- **Deployment:** Docker container achter Traefik op `challenge.sander.ninja`

## Data Model

### `participants.json` (handmatig beheerd)

```json
[
  { "code": "sander123", "name": "Sander" },
  { "code": "jan456", "name": "Jan" }
]
```

### SQLite tabel `checkins`

| kolom      | type    | beschrijving          |
|------------|---------|-----------------------|
| code       | TEXT    | deelnemer code        |
| day        | INTEGER | dagnummer (1-based)   |
| sets       | INTEGER | aantal setjes         |
| checked_at | TEXT    | ISO timestamp         |

Primary key: `(code, day)`

### Dagnummer berekening

`day = floor((now - 2026-04-01T00:00:00) / 86400000) + 1`

Tijdzone: Europe/Amsterdam.

## API Endpoints

### `GET /:code`

- Valideert dat code bestaat in `participants.json`
- Redirect naar `/` (frontend slaat code op in localStorage)
- Bij ongeldige code: 404

### `GET /`

- Servet de static frontend

### `GET /api/progress`

- Retourneert alle deelnemers met hun check-ins
- Geen auth nodig
- Response: `{ participants: [{ code, name }], checkins: [{ code, day, sets, checked_at }], today: number }`

### `POST /api/checkin`

- Header: `X-Participant-Code: <code>`
- Body: `{ "sets": <number> }`
- Validatie:
  - Code moet bestaan in `participants.json`
  - Sets moet >= 1 zijn
  - Alleen huidige dag kan worden ingecheckt
  - Eenmalig per dag (INSERT, geen UPDATE)
- Response: `{ success: true, day, sets }`

## Frontend

### Pagina-structuur

1. **Header:** Titel "Push-Up Challenge" + naam ingelogde gebruiker (of niets als niet ingelogd)
2. **Check-in blok:** Alleen zichtbaar als ingelogd + vandaag nog niet ingecheckt. Toont "Dag X: X push-ups", invoerveld voor sets, bevestigknop.
3. **Voortgangsoverzicht:** Tabel met deelnemers als kolommen, dagen als rijen. Nieuwste dag bovenaan. Toont vinkje + aantal sets, kruis voor gemist, streepje voor nog niet ingecheckt.

### Auth flow

1. Gebruiker bezoekt `/:code`
2. Code wordt opgeslagen in `localStorage`
3. Redirect naar `/`
4. Bij volgende bezoeken aan `/` wordt code uit localStorage gelezen
5. Niet ingelogd = alleen lezen (geen check-in blok)

### Theming

- Primair: donker/sporty thema
- Light mode: volgt OS preference via `prefers-color-scheme`
- Kleuren dark: achtergrond `#0f1117`, tekst `#e2e8f0`, accent blauw `#38bdf8`, success groen `#22c55e`

## Deployment

- Dockerfile met Node.js
- SQLite database op een Docker volume voor persistentie
- `participants.json` als config mount of in de image
