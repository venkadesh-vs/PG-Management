# File storage setup

StayFlow stores uploaded files — complaint photos, worker "photo proof",
resolution photos and KYC scans — through `src/server/storage.ts`. Nothing is
ever placed in `public/`: every file is served by `GET /api/uploads/<id>`,
which checks who is asking first.

## Who can open a file

| Viewer          | Can open                                                                 |
| --------------- | ------------------------------------------------------------------------ |
| Owner / manager | Files of their organization, limited to the PGs they have access to      |
| Worker          | Complaint and task-proof photos of their PG, or tasks assigned to them   |
| Resident        | Files on their own record and photos on their own complaints             |

Files of another organization always return 404.

## Upload rules

- `POST /api/uploads` (multipart: `file`, `purpose` = `KYC | COMPLAINT | TASK_PROOF | OTHER`, optional `residentId`)
- Max 5 MB. JPG, PNG, WebP and PDF only — checked from the file's bytes, not its name.
- 30 uploads per user per hour.
- Photos are shrunk in the browser to at most 1600 px (JPEG) before upload,
  which also strips location data from phone cameras.
- The response is `{ id, url }`; `url` (`/api/uploads/<id>`) is what complaints and tasks store.

## Option 1 — local disk (default)

```env
STORAGE_PROVIDER="local"
```

Files go to `./storage/uploads/<organizationId>/<random>.<ext>` (git-ignored).
Good for development and a single VPS. **Not for Netlify/Vercel** — their
functions have no lasting disk, so files would vanish. Back the folder up with
the database.

## Option 2 — Cloudflare R2 (recommended for production)

1. Cloudflare dashboard → R2 → **Create bucket** (e.g. `stayflow-uploads`). Keep it private — no public access, no custom domain needed.
2. R2 → **Manage R2 API Tokens** → Create token with **Object Read & Write** on that bucket.
3. Copy the Access Key ID, Secret Access Key and your account's S3 endpoint.

```env
STORAGE_PROVIDER="s3"
S3_ENDPOINT="https://<account-id>.r2.cloudflarestorage.com"
S3_REGION="auto"
S3_BUCKET="stayflow-uploads"
S3_ACCESS_KEY_ID="…"
S3_SECRET_ACCESS_KEY="…"
```

## Option 3 — AWS S3

1. Create a private bucket (Block all public access: on) in your region, e.g. `ap-south-1`.
2. Create an IAM user with a policy allowing `s3:PutObject` and `s3:GetObject` on `arn:aws:s3:::<bucket>/uploads/*`.

```env
STORAGE_PROVIDER="s3"
S3_ENDPOINT=""                 # blank = https://<bucket>.s3.<region>.amazonaws.com
S3_REGION="ap-south-1"
S3_BUCKET="stayflow-uploads"
S3_ACCESS_KEY_ID="…"
S3_SECRET_ACCESS_KEY="…"
```

MinIO, Wasabi and other S3-compatible services work like R2: set `S3_ENDPOINT`
(path-style addressing is used whenever an endpoint is given).

## How S3 mode works

- Objects are stored at `uploads/<organizationId>/<random>.<ext>`.
- Uploads are a server-side `PUT`, signed with AWS Signature V4 (`node:crypto`, no SDK).
- Downloads: after the access check, `/api/uploads/<id>` redirects (302) to a
  presigned GET URL valid for 5 minutes. The link is never stored.

## Switching providers

Existing rows keep their `key`; the provider is global. When moving from local
to S3, copy `storage/uploads/*` into the bucket under `uploads/` before
switching `STORAGE_PROVIDER`.
