# CampusCare backend

Astro and Hono run in one deployment. Hono owns `/api`; MongoDB stores persistent data. Both browser portals require the API and MongoDB. Browser storage only caches the current user's public profile; the server session controls access.

Students use `/login`; admins and staff use `/admin/login`. Demo accounts and local data fallbacks have been removed. An old demo session in browser storage is ignored.

## Run

Set `MONGODB_URI` in the process environment. `MONGODB_DB` defaults to `campuscare`. `PORT` defaults to 4321.
Use `npm run dev` for local development. The production build targets Vercel and includes the API in the same deployment. Configure `MONGODB_URI` and, optionally, `MONGODB_DB` in the deployment environment before creating an admin account.

```sh
npm install
npm run check
npm run test:api
npm run build
npm run dev
```

`npm run create-admin -- "Admin Name" ADMIN-1 admin@example.com strong-password` creates the first admin after MongoDB is running. This command puts the password in shell history; use a temporary password and change it after first login. An admin may create staff through `POST /api/staff`. Four department codes are seeded on first connection: `IT`, `Classroom`, `Transport`, `Facilities`.

## Contract

All JSON routes use the same-origin HTTP-only session cookie. Login/register return `{ user }`, not a bearer token. Errors return `{ error }`, with optional validation `details`. Protected routes return 401 without a session; role restrictions return 403.

| Method | Route | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | public | Process health and `databaseConfigured` flag |
| POST | `/api/auth/register` | public | Student registration: name, studentId, email, password (8+ chars) |
| POST | `/api/auth/login` | public | Email/password login |
| GET, PATCH | `/api/auth/me` | signed in | Read/update name, studentId, email |
| PATCH | `/api/auth/password` | signed in | Change password and revoke sessions |
| POST | `/api/auth/logout` | signed in or public | End session |
| GET | `/api/departments` | signed in | List department codes/names |
| GET, POST | `/api/staff` | admin | List/create staff and admins |
| PATCH | `/api/staff/:id` | admin | Change role, department, or active status; cannot disable self |
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
| GET, POST | `/api/support` | student | List/create own support requests with status and reply |
| GET | `/api/support/requests` | admin | Paginated support queue without student identity |
| PATCH | `/api/support/requests/:id` | admin | Update status/reply and notify the student |

Complaint categories are `IT`, `Classroom`, `Transport`, `Facilities`. Statuses are `Submitted`, `In Progress`, `Resolved`. `id` is the MongoDB ID; `displayId` is the human-facing complaint number. Images accept PNG, JPEG, or WebP up to 5 MB and are stored in MongoDB GridFS. The image endpoint applies the same ownership rules as complaint details.

Complaint API responses omit the submitting student's account ID and timeline actor IDs. The database retains the private owner reference for student access and notifications. Free text and uploaded images can still disclose identity if students include identifying details.

## Frontend integration

Both portals use same-origin API requests with an HTTP-only session cookie. Student registration, sign in, complaints, images, notifications, feedback, support, and profile updates are connected. Admin sign in, dashboard, complaint management, team management, support queue and replies, and profile updates are connected. Pages check the server session on navigation; API authorization is the source of truth.

## Verification

`npm run test:api` uses an isolated temporary MongoDB instance. It covers registration, cookie login/logout, ownership, admin and staff roles, assignment, status changes, notifications, feedback, support requests, and private image upload/download. The browser flow was also verified against a temporary MongoDB instance: student sign in, report submission, admin review and status update, student dashboard and notifications, support, and profile loading.

