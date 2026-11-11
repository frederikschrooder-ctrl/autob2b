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

The compose file uses host networking and does not publish a port. `ENFORCE_LOOPBACK=1` makes the process exit unless `HOST` is exactly `127.0.0.1`. `localhost` and `::1` are refused so the process cannot listen only on IPv6. Caddy on the same host must proxy to `127.0.0.1:10000`.

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
| `SECRETS_FILE` | `/secrets/secrets.env` | Bootstrap and seller file. When this is set, those values are read only from that file, not from the process environment. |

`docker compose` must not use `env_file:` for the password. The password stays in the mounted file so it is not copied into the compose service environment.

The container runs as root on the host network. That is required so it can read a `root:root` mode `0600` secrets file. It is not an unprivileged process. A compromise of the Node process is root inside the host network namespace: it can open the mounted data, uploads, and secrets, and it can attempt other local connections. `ENFORCE_LOOPBACK=1` still refuses to listen on anything except `127.0.0.1`. The secrets file must be owned by the user that runs the process; in this Compose file that user is root, and a mode `0600` file owned by another uid is refused. Dropping to a non-root user would require making the secrets file readable by that user, which this contract does not do. Do not treat the container as a sandbox. Anyone who can run Docker on the host is effectively root.

## Secrets file

Create `/srv/autob2b/secrets.env` before the first start. Owner `root:root`, mode `0600`. It must be a regular file, not a symlink and not a directory. If a missing source path was mounted once, Docker may have created a directory at that path; remove that directory and create the file.

Allowed keys, and no others:

```
BOOTSTRAP_ADMIN_EMAIL=<operator email>
BOOTSTRAP_ADMIN_PASSWORD=<unique password, 4 to 200 characters>
BOOTSTRAP_ADMIN_NAME=<display name, optional>
OWNER_EMAIL=<optional; defaults to BOOTSTRAP_ADMIN_EMAIL>
HEAD_ADMIN_EMAILS=jan@jan.dk
SELLER_LEGAL_NAME=Højbogaard Biler
SELLER_CVR=14952705
SELLER_ADDRESS=Teknologiparken 4, 9440 Aabybro, Denmark
```

Rules enforced by the process:

- Both email and password are required to create an account. A missing or empty value does not fall back to a built-in account.
- An administrator password must be 4 to 200 characters. Longer passwords are allowed. Passwords of 0–3 characters are refused for bootstrap, for changing an admin password, and for creating another administrator.
- A dealer password is 4 to 200 characters. Any characters are allowed. There is no requirement for letters, digits, symbols, or mixed case. Existing password hashes are not rewritten.
- An administrator password must not equal the email and must not be a placeholder such as `changeme`, `password`, or `password123`. Neither an administrator nor a dealer password may be either password that was published in earlier commits of this repository. Those two values are rejected by a SHA-256 denylist. Their plaintext is not in this tree. Choose a new password.
- The file is rejected if group or other permission bits are set, if it is larger than 16 KiB, or if it contains any other key.
- The password and email are not written to stdout or stderr.
- `OWNER_EMAIL` and `HEAD_ADMIN_EMAILS` grant that tier only to an approved account. A self-signup with one of those emails stays a pending dealer with no staff tier until the owner approves it. No administrator can change another user's email to one of those addresses. If both owner emails are empty, the earliest approved administrator is the owner. Startup does not rewrite that row.
- Do not pass the password as a `docker compose` argument, a shell argument, or a `curl` command saved in shell history.

`deploy/secrets.env.example` shows the key names with an empty password. Copying it unchanged will not create an admin.

## Seller on a new purchase agreement

A dealer buy, including turning that dealer's own reservation into a buy, writes the seller onto the agreement and then stores that JSON. A later change to the secrets file does not rewrite an agreement that is already stored. Reservations do not require a seller and do not create an agreement.

All three seller values are required. If any one is missing, not text, or invalid, the buy responds `503` and does not create or convert an order. The legal name is at most 200 characters. The CVR is exactly eight digits. The address is one line of at most 300 characters. A control character is rejected. The process still starts, so administration and reservations keep working.

The name `Højbogaard Biler` is the legal name published for CVR `14952705` on proff.dk, together with the address Teknologiparken 4, 9440 Aabybro, the form enkeltmandsvirksomhed, status Normal, and the start date 29.04.1991. The same CVR and the name appear on https://www.hbg.dk/kontakt, which shows the visiting address Teknologiparken 2-4. datacvr.virk.dk was not available for a direct register check. This is not an official register confirmation. The agreement uses the owner-supplied address line, including the word Denmark:

```
SELLER_LEGAL_NAME=Højbogaard Biler
SELLER_CVR=14952705
SELLER_ADDRESS=Teknologiparken 4, 9440 Aabybro, Denmark
```

Do not add `SELLER_EMAIL`, `SELLER_PHONE`, or any other key. An unsupported key prevents startup. Public email and phone are not selected. The sales address, phone, and mail published on hbg.dk are not copied onto the agreement.

On a new agreement, the invoice sentence names the configured legal seller. The rest of that sentence is unchanged. An agreement already stored keeps its own terms, including an older invoice sentence that says AutoB2B. The last sentence, which says the agreement is binding when it is generated, is unchanged. That sentence is an unreviewed template, not a compliance determination. There is no admin screen for the seller; the secrets file is the only setting.

An existing `/srv/autob2b/secrets.env` that has only the bootstrap keys still starts this build. Buys stay closed until the three seller lines are added and the process is restarted. Adding the lines does not by itself open the public site. Leave the public maintenance response in place until that is a separate decision. Do not put the secrets file in a release archive.

## Admin edits and archive

Starting this build, the process adds `admin_note`, `archived_at`, `archived_by`, and `archive_note` to `orders` if they are missing, and creates `order_corrections` if it is missing. Existing agreement JSON is not read or rewritten by that step. A database from the previous build opens without a manual migration.

Slet on an order archives it. The row, the agreement, and the price stored inside the agreement stay. The order leaves the dashboard counts and the default order list. Arkiv lists it, and Gendan puts it back without changing the agreement. Archiving a pending reservation releases that hold. Archiving a confirmed or completed sale does not put the car or the lot back on sale. There is no action that archives every order.

A price correction requires a written reason. It appends a row to `order_corrections` and updates the operational order price. It does not change the agreement. Dealer passwords, roles, and the secrets file are not editable from these screens. An administrator account cannot be deleted or demoted here.

A confirmed or completed purchase protects its cars and lot whether or not the order is archived. The admin form cannot mark those cars available or delete them. The shop does not list them, and a second buy or reservation is refused. The agreement is left as stored. Cancelling a pending reservation, or cancelling a confirmed order that has not been completed, is the release path: that order stops protecting the cars, and the cars return to sale only when no other purchase still covers them. A completed order cannot be cancelled, so its cars stay protected.

Rollback of the application to `7477c4aa` does not drop the new columns or `order_corrections`, and that build never reads `archived_at`. Opening the migrated database with that older build is not a clean rollback:

- Archived orders show up in the normal order list again.
- An archived reservation is still `pending`. The older build treats every pending or confirmed order as a live hold. A reservation this build already released can block the car again, or sit next to a newer order for the same car.
- An archived confirmed order reappears as a live confirmed order.
- `7477c4aa` does not protect a completed sale from being marked available. Rolling back does not close that hole.

The safe rollback is to restore the database and uploads backup taken before this build started, then run `7477c4aa`. Do not delete orders, agreements, or `order_corrections` by hand. Take that backup before the new build is started against a database that already has orders.

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
