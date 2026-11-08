# Operator contract

This file is the runtime contract for a fresh deployment of this branch. It does not contain a usable password. The application does not create a default administrator and does not reset an existing password on startup.

## What is not deployed

- No database file from this repository. `data/autob2b.sqlite` is not part of this branch. Do not copy that historical file, or any backup of it, into `/srv/autob2b/data`.
- No login sheet, `ADMIN_LOGIN.txt`, or `LOGIN-INFO.txt`. Do not recreate those files on the server.
- No demo cars and no sample packages. `npm run seed` and `npm run seed:admins` exit with an error and do not write to the database.
- No Render or Bolt service. `render.yaml` is not in this branch.

A fresh database has no users. Accounts that existed only in the old public database or source tree are not created, so those credentials cannot log in.

## Node runtime

Production image: `node:24.22.2-bookworm-slim` (Node.js 24.22.2 LTS, linux/amd64).

That pin was chosen after checking the dependency, not by floating `node:latest`:

- Express 5.3.0 declares `engines.node` of `>= 18`.
- The app uses the built-in `node:sqlite` `DatabaseSync` API, including the constructor `timeout` option added in Node 22.16.0 and 24.0.0. No `--experimental-sqlite` flag is required on this version.
- The test suite for this commit is run with Node 24.22.2. Node 22.23.4 can load `DatabaseSync`, and on that older patch the runtime prints `ExperimentalWarning: SQLite is an experimental feature`. The 24.22.2 binary used for the suite did not print that warning when opening a database.
- Do not move this deploy to Node 26 without rerunning the suite. Node 26 renamed `DatabaseSync` to `Database` and kept the old name as an alias; this code calls `DatabaseSync`.

A Node.js security release was scheduled for 2026-11-11. Stay on 24.22.2 for this build. Move to a later 24.x patch only after `npm test` passes on that exact binary, then pin the new image digest in `Dockerfile`.

## Process layout

| Item | Value |
| --- | --- |
| Listen | `127.0.0.1:10000` only |
| Database directory | `/srv/autob2b/data` mounted at `/data` |
| Uploads directory | `/srv/autob2b/uploads` mounted at `/uploads` |
| Secrets file | `/srv/autob2b/secrets.env` mounted read-only at `/secrets/secrets.env` |
| Database file | `/data/autob2b.sqlite` (`DB_FILE`) |
| Upload directory | `/uploads` (`UPLOAD_DIR`) |

The compose file uses host networking and does not publish a port. `ENFORCE_LOOPBACK=1` makes the process exit if `HOST` is not a loopback address. Caddy on the same host must proxy to `127.0.0.1:10000`. Do not use the name `localhost` in the proxy address: it can resolve to `::1`, and this process does not listen on IPv6.

## Non-secret environment

Set by `docker-compose.yml`. Do not put passwords in this list or in the shell history.

| Variable | Production value | Meaning |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Listen address |
| `PORT` | `10000` | Listen port |
| `COOKIE_SECURE` | `1` | Session cookie has the `Secure` flag. Required behind HTTPS. Do not set this for a plain HTTP local process or the browser will not store the cookie. |
| `TRUST_PROXY` | `loopback` | Honor `X-Forwarded-For` and `X-Forwarded-Proto` only when the direct peer is loopback. Any other value, including `true`, refuses to start. |
| `ENFORCE_LOOPBACK` | `1` | Refuse to listen on a public interface |
| `REQUIRE_ADMIN` | `1` | Refuse to start when no approved admin exists |
| `NODE_ENV` | `production` | Production mode |
| `DB_FILE` | `/data/autob2b.sqlite` | SQLite path inside the container |
| `UPLOAD_DIR` | `/uploads` | Image directory inside the container |
| `SECRETS_FILE` | `/secrets/secrets.env` | Bootstrap file. When this is set, bootstrap values are read only from that file, not from the process environment. |

`docker compose` must not use `env_file:` for the password. The password stays in the mounted file so it is not copied into the compose service environment.

The container runs as root. That is deliberate: the secrets file is `root:root` mode `0600`, and a non-root user could not read it. The process still binds loopback only. Anyone who can run Docker on the host is effectively root.

## Secrets file

Create `/srv/autob2b/secrets.env` before the first start. Owner `root:root`, mode `0600`. It must be a regular file, not a symlink and not a directory. If a missing source path was mounted once, Docker may have created a directory at that path; remove that directory and create the file.

Allowed keys, and no others:

```
BOOTSTRAP_ADMIN_EMAIL=<operator email>
BOOTSTRAP_ADMIN_PASSWORD=<unique password, 10 to 200 characters>
BOOTSTRAP_ADMIN_NAME=<display name, optional>
```

Rules enforced by the process:

- Both email and password are required to create an account. A missing or empty value does not fall back to a built-in account.
- The password must be 10 to 200 characters, must not equal the email, and must not be a placeholder such as `changeme`, `password`, or `password123`.
- The file is rejected if group or other permission bits are set, if it is larger than 16 KiB, or if it contains any other key.
- The password and email are not written to stdout or stderr.
- Do not pass the password as a `docker compose` argument, a shell argument, or a `curl` command saved in shell history.

`deploy/secrets.env.example` shows the key names with an empty password. Copying it unchanged will not create an admin.

## One-time admin bootstrap

On every start the process counts rows with `role = 'admin'`.

1. Count is zero and the secrets file has a valid email and password: insert one approved admin. The password is stored as a scrypt hash. This is the only moment the bootstrap password is used.
2. Count is already one or more: do nothing to existing rows. The bootstrap password is ignored. A different password in the secrets file does not overwrite the hash, the name, the role, or the status.
3. Count is zero and the secrets file is missing, unreadable, or incomplete: create nobody. With `REQUIRE_ADMIN=1` the process exits 1 before it is willing to serve.

Changing `BOOTSTRAP_ADMIN_PASSWORD` later does not change the live password. Restarting does not change it either.

After the first successful login, open **Adgangskode** and set a new password. That writes a new hash and drops other sessions for that user. The next restart keeps the new hash and the rest of the database, including dealers, cars, lots, orders, and uploads.

You may delete the `BOOTSTRAP_ADMIN_PASSWORD` line after that rotation. The next start still succeeds because an admin already exists. If the data directory is later replaced with an empty database while the secrets file still contains a password, the process will create the first admin again from that file. Treat the file as a recovery secret and keep mode `0600`.

Additional administrators are created in the admin UI under **Forhandlere → Tilføj Administrator**, not from the secrets file. Public registration always creates a pending dealer. The request body cannot choose `role` or `status`.

## Cookies and the proxy

Caddy terminates HTTPS and connects to `127.0.0.1:10000`. The session cookie is `sid`, `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` when `COOKIE_SECURE=1`. Logout clears that same cookie and deletes the server session. Uploaded images require an admin or an approved dealer session; they are not a public catalogue.

Login rate limiting uses the client address from `X-Forwarded-For` only because the direct connection is loopback. A client that can connect to port 10000 without going through Caddy is already on the host.

## Local process, not production

`./start.sh` listens on `127.0.0.1` and does not seed data. For a local process, either export `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` in the environment of that process, or set `SECRETS_FILE` to a mode `0600` file. Leave `COOKIE_SECURE` unset when you use HTTP. Do not point a local process at `/srv/autob2b/data`.
