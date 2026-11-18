# CampusCare backend

Astro and Hono run in one Node deployment. Hono owns `/api`; MongoDB stores all backend data. The existing browser pages still use `localStorage` and have **not** been connected to this API.

## Run

Set `MONGODB_URI` in the process environment. `MONGODB_DB` defaults to `campuscare`. `PORT` defaults to 4321.

```sh
npm install
npm run check
npm run test:api
npm run build
npm start
```

`npm run create-admin -- "Admin Name" ADMIN-1 admin@example.com strong-password` creates the first admin after MongoDB is running. This command puts the password in shell history; use a temporary password and change it after first login. An admin may create staff through `POST /api/staff`. Four department codes are seeded on first connection: `IT`, `Classroom`, `Transport`, `Facilities`.

## Contract

All JSON routes use the same-origin HTTP-only session cookie. Login/register return `{ user }`, not a bearer token. Errors return `{ error }`, with optional validation `details`. Protected routes return 401 without a session; role restrictions return 403.

| Method | Route | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | public | Process health |
| POST | `/api/auth/register` | public | Student registration: name, studentId, email, password (8+ chars) |
| POST | `/api/auth/login` | public | Email/password login |
| GET, PATCH | `/api/auth/me` | signed in | Read/update name, studentId, email |
| PATCH | `/api/auth/password` | signed in | Change password and revoke sessions |
| POST | `/api/auth/logout` | signed in or public | End session |
| GET | `/api/departments` | signed in | List department codes/names |
| GET, POST | `/api/staff` | admin | List/create staff and admins |
| GET, POST | `/api/complaints` | signed in / student creates | List visible complaints; submit JSON or multipart with optional image |
| GET | `/api/complaints/:id` | owner, assigned staff, admin | Complaint detail and timeline |
| GET | `/api/complaints/:id/image` | owner, assigned staff, admin | Private image stream |
| PATCH | `/api/complaints/:id/status` | assigned staff, admin | `{ status, note? }` |
| PATCH | `/api/complaints/:id/assign` | admin | `{ departmentId }` using a department code |
| POST | `/api/complaints/:id/feedback` | owner after resolution | `{ rating, comment }` once |
| GET | `/api/notifications` | signed in | Current user's latest 100 notifications |
| PATCH | `/api/notifications/:id/read` | owner | `{ read: boolean }` |
| PATCH | `/api/notifications/read-all` | signed in | Mark all as read |
| GET | `/api/dashboard/summary` | signed in | Role-scoped totals and category/department counts |
| GET, POST | `/api/support` | signed in | List/create own support requests |

Complaint categories are `IT`, `Classroom`, `Transport`, `Facilities`. Statuses are `Submitted`, `In Progress`, `Resolved`. `id` is the MongoDB ID; `displayId` is the human-facing complaint number. Images accept PNG, JPEG, or WebP up to 5 MB and are stored in MongoDB GridFS. The image endpoint applies the same ownership rules as complaint details.

## Frontend integration

Replace `src/lib/store.ts` and page-local localStorage calls with same-origin `fetch('/api/...', { credentials: 'same-origin' })`. Use `/api/auth/me` for initial session state, multipart `FormData` for reports with images, and the returned immutable `studentId`/complaint `id` instead of matching by name. The current static Astro pages have client-side guards only; keep API authorization as the source of truth.

## Verification

`npm run test:api` uses an isolated temporary MongoDB instance. It covers registration, cookie login/logout, ownership, admin and staff roles, assignment, status changes, notifications, feedback, support requests, and private image upload/download. It does not verify the localStorage frontend against this API.

