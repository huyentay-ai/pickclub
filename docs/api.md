# API Documentation — Pick Club "Vui cả tuần"

Base URL (local): `http://localhost:3000`

> Note: This project has no `/src/api/` directory. The JSON API lives in
> [`routes/api.js`](../routes/api.js) (mounted at `/api`), with the login
> endpoint used to obtain a session in [`routes/auth.js`](../routes/auth.js)
> (mounted at `/`). This document was generated from those two files plus the
> schema in [`database.js`](../database.js).

## Authentication

There is no API token. Auth is a server-side session cookie (`connect.sid`,
via `express-session` + `connect-sqlite3`), set by `POST /login`.

```bash
# 1. Log in and persist the session cookie
curl -c cookies.txt -X POST http://localhost:3000/login \
  -d "username=hung&password=1234"

# 2. Reuse the cookie on subsequent API calls
curl -b cookies.txt http://localhost:3000/api/notifications
```

Two access levels are enforced per-route:

| Level | Behavior when missing |
|-------|------------------------|
| `public` | No session required |
| `required` (`requireAuthApi`) | `401 { "error": "Unauthorized" }` if no session |
| `admin` (`requireAdminApi`) | `401` if no session, `403 { "error": "Forbidden" }` if session user is not admin |

**Windows/Git Bash note**: Vietnamese text passed through `curl -d '...'` in
Git Bash can get mangled depending on the terminal codepage. If saved
Vietnamese data comes back corrupted, retest with Node's `http` module
(UTF-8 by default) to rule out a shell-encoding issue rather than a server bug.

---

## TypeScript Types

```typescript
interface UserSearchResult {
  id: number;
  username: string;
  full_name: string;
  avatar: string | null;
}

interface Notification {
  id: number;
  user_id: number;
  type: 'challenge' | 'result_finalized' | string;
  message: string;
  link: string | null;
  is_read: 0 | 1;
  created_at: string; // ISO datetime
}

interface FundStats {
  filter: { month: number | null; year: number | null };
  totalFund: number;
  completedMatches: number;
}

interface TodayResult {
  id: number;
  match_date: string;   // "YYYY-MM-DD"
  match_time: string;   // "HH:MM"
  reward: string;
  challenger_name: string;
  challenged_name: string;
  winner_name: string | null; // null if match drew or has no result row
  scores: string | null;
}

interface TodayResultsResponse {
  date: string; // "YYYY-MM-DD"
  totalFund: number;
  results: TodayResult[];
}

type ChallengeStatus =
  | 'pending' | 'accepted' | 'declined' | 'counter'
  | 'scheduled' | 'completed' | 'disputed';

interface CreateChallengeRequest {
  challenger_team_id: number;
  challenged_team_id: number;
  match_date: string;   // "YYYY-MM-DD"
  match_time: string;   // "HH:MM"
  reward?: string;          // default: "Một bữa sáng"
  reward_detail?: string;
}

interface CreateChallengeResponse {
  ok: true;
  challenge: {
    id: number;
    challenger_team_id: number;
    challenged_team_id: number;
    match_date: string;
    match_time: string;
    reward: string;
    reward_detail: string | null;
    status: 'scheduled';
  };
}

interface AdminSubmitResultRequest {
  scores: string;             // e.g. "11-7, 9-11, 11-8"
  winner_team_id?: number;    // omit/empty = draw
  reward_paid?: boolean;
}

interface AdminSubmitResultResponse {
  ok: true;
  challenge: {
    id: number;
    status: 'completed';
    scores: string;
    winner_team_id: number | null;
  };
}

interface ApiError {
  error: string;
}
```

---

## Users

### `GET /api/users/search`

Search users by username or full name (used for the team-creation autocomplete).

| Auth | required |
|------|----------|

**Query params**

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `q` | string | no | Search term; returns `[]` if empty. Matched with `LIKE %q%` against `username` and `full_name`. Max 10 results. |

**Response `200`** — `UserSearchResult[]`

```bash
curl -b cookies.txt "http://localhost:3000/api/users/search?q=an"
```

```json
[
  { "id": 3, "username": "an", "full_name": "Nguyễn Văn An", "avatar": "an.jpg" }
]
```

**Errors**: `401 Unauthorized` if not logged in.

---

## Notifications

### `GET /api/notifications`

Unread notifications for the current session user, newest first.

| Auth | required |
|------|----------|

**Response `200`** — `Notification[]`

```bash
curl -b cookies.txt http://localhost:3000/api/notifications
```

```json
[
  {
    "id": 12,
    "user_id": 1,
    "type": "challenge",
    "message": "Trận đấu \"Anh & Kiên\" vs \"Bình & Cường\" đã lên lịch vào Thứ 5, 1/8/2026 lúc 06:00",
    "link": "/challenges/7",
    "is_read": 0,
    "created_at": "2026-07-23 08:00:00"
  }
]
```

**Errors**: `401 Unauthorized` if not logged in.

### `POST /api/notifications/:id/read`

Mark one notification as read. Scoped to the current user — a mismatched
`id`/owner silently updates zero rows rather than erroring.

| Auth | required |
|------|----------|

**Path params**: `id` — notification id.

**Response `200`**

```bash
curl -b cookies.txt -X POST http://localhost:3000/api/notifications/12/read
```

```json
{ "ok": true }
```

**Errors**: `401 Unauthorized` if not logged in.

---

## Fund (Quỹ bữa sáng)

### `GET /api/fund`

Aggregate breakfast-fund total: 1 point per losing-team member per completed
match, optionally filtered by month/year.

| Auth | public |
|------|--------|

**Query params**

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `m` | number (1–12) | no | Month filter. Out-of-range values are ignored (treated as absent). |
| `y` | number (2020–2099) | no | Year filter. Out-of-range values are ignored (treated as absent). |

**Response `200`** — `FundStats`

```bash
# Total fund across all time (no filter)
curl "http://localhost:3000/api/fund"

# Filtered by month + year
curl "http://localhost:3000/api/fund?m=7&y=2026"

# Filtered by year only (all months of 2026)
curl "http://localhost:3000/api/fund?y=2026"

# Filtered by month only (July across all years)
curl "http://localhost:3000/api/fund?m=7"
```

```json
{ "filter": { "month": 7, "year": 2026 }, "totalFund": 42, "completedMatches": 21 }
```

---

## Results

### `GET /api/results/today`

All `completed` matches whose `match_date` is today, plus the running total fund.

| Auth | public |
|------|--------|

**Response `200`** — `TodayResultsResponse`

```bash
curl http://localhost:3000/api/results/today
```

```json
{
  "date": "2026-07-23",
  "totalFund": 42,
  "results": [
    {
      "id": 7,
      "match_date": "2026-07-23",
      "match_time": "06:00",
      "reward": "Một bữa sáng",
      "challenger_name": "Anh & Kiên",
      "challenged_name": "Bình & Cường",
      "winner_name": "Anh & Kiên",
      "scores": "11-7, 9-11, 11-8"
    }
  ]
}
```

---

## Challenges

### `POST /api/challenges`

Create a new challenge between two teams. Goes straight to `scheduled`
status (no accept/decline step) and notifies both team captains.

| Auth | required |
|------|----------|

**Body** — `CreateChallengeRequest` (JSON)

```bash
curl -b cookies.txt -X POST http://localhost:3000/api/challenges \
  -H "Content-Type: application/json" \
  -d '{"challenger_team_id":1,"challenged_team_id":2,"match_date":"2026-08-01","match_time":"06:00","reward":"Một bữa sáng"}'
```

**Response `201`** — `CreateChallengeResponse`

```json
{
  "ok": true,
  "challenge": {
    "id": 8,
    "challenger_team_id": 1,
    "challenged_team_id": 2,
    "match_date": "2026-08-01",
    "match_time": "06:00",
    "reward": "Một bữa sáng",
    "reward_detail": null,
    "status": "scheduled"
  }
}
```

**Errors**

| Status | Body | Cause |
|--------|------|-------|
| `400` | `{ "error": "Vui lòng điền đầy đủ thông tin" }` | Missing one of `challenger_team_id`, `challenged_team_id`, `match_date`, `match_time` |
| `400` | `{ "error": "Không thể thách đấu chính đội mình" }` | `challenger_team_id === challenged_team_id` |
| `404` | `{ "error": "Đội không tồn tại" }` | Either team id doesn't exist |
| `401` | `{ "error": "Unauthorized" }` | Not logged in |

### `POST /api/admin/challenges/:id/result`

Admin enters/overwrites the final result directly — no prior player-submitted
result is required. Sets challenge `status` to `completed`, deletes any
existing `match_results` row for the challenge, inserts the new one, and
notifies both captains.

| Auth | admin |
|------|-------|

**Path params**: `id` — challenge id.

**Body** — `AdminSubmitResultRequest` (JSON)

```bash
curl -b cookies.txt -X POST http://localhost:3000/api/admin/challenges/4/result \
  -H "Content-Type: application/json" \
  -d '{"scores":"11-7, 9-11, 11-8","winner_team_id":10,"reward_paid":false}'
```

**Response `200`** — `AdminSubmitResultResponse`

```json
{ "ok": true, "challenge": { "id": 4, "status": "completed", "scores": "11-7, 9-11, 11-8", "winner_team_id": 10 } }
```

Omit `winner_team_id` (or send `null`/`""`) to record a draw:

```bash
curl -b cookies.txt -X POST http://localhost:3000/api/admin/challenges/4/result \
  -H "Content-Type: application/json" \
  -d '{"scores":"11-9, 9-11","reward_paid":true}'
```

```json
{ "ok": true, "challenge": { "id": 4, "status": "completed", "scores": "11-9, 9-11", "winner_team_id": null } }
```

**Errors**

| Status | Body | Cause |
|--------|------|-------|
| `400` | `{ "error": "Thiếu tỉ số trận đấu" }` | `scores` missing or blank |
| `400` | `{ "error": "Đội thắng không thuộc trận đấu này" }` | `winner_team_id` isn't either team in the challenge |
| `404` | `{ "error": "Thách đấu không tồn tại" }` | Challenge id doesn't exist |
| `401` | `{ "error": "Unauthorized" }` | Not logged in |
| `403` | `{ "error": "Forbidden" }` | Logged in but not admin |

---

## Session (not under `/api`, needed to authenticate)

### `POST /login`

Form-encoded (not JSON): `username`, `password`. On success, sets
`req.session.user` and redirects to `/teams`. On failure, re-renders the
login page with a Vietnamese error message (HTML, not JSON) — there is no
JSON error contract for this endpoint.

```bash
curl -c cookies.txt -X POST http://localhost:3000/login \
  -d "username=hung&password=1234"
```

### `GET /logout`

Destroys the session and redirects to `/login`.

---

## Endpoint Summary

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/users/search?q=` | required | Search users by username/name |
| GET | `/api/notifications` | required | Unread notifications for current user |
| POST | `/api/notifications/:id/read` | required | Mark a notification read |
| GET | `/api/fund` | public | Breakfast fund total (optional `?m=&y=`) |
| GET | `/api/results/today` | public | Completed matches for today + fund |
| POST | `/api/challenges` | required | Create a challenge (`scheduled` immediately) |
| POST | `/api/admin/challenges/:id/result` | admin | Enter/overwrite final match result |
| POST | `/login` | public | Obtain session cookie (form-encoded) |
| GET | `/logout` | — | Destroy session |
