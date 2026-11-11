# Deploy, backup, restore, and rollback

Run this on the Ubuntu 24.04 host where Docker and Caddy are already installed. The site `hbgproff.dk` and `www.hbgproff.dk` already has HTTPS and a Caddy maintenance response. Do not register a new certificate and do not point DNS anywhere else.

This runbook does not send mail, does not create a dealer with customer data, and does not log into the public site. Review the commit and run the checks below before replacing the maintenance response.

The authoring environment for this branch did not have a Docker daemon. The Node process, not a container, was tested for loopback bind, bootstrap, restart, and purchase races. Start the container on the host only after that review. Confirm `ss` output yourself before reloading Caddy.

The Compose service runs as root on the host network so it can read `/srv/autob2b/secrets.env` when that file is `root:root` mode `0600`. That is not an unprivileged container. See `deploy/OPERATOR.md`.

## 1. Place the release

Use the reviewed commit archive, not a merge commit and not an older checkout. The archive name is `autob2b-release-<full-sha>.tar.gz`. Check it before extracting:

```bash
sha256sum -c autob2b-release-<full-sha>.tar.gz.sha256
bad=$(tar -tzf autob2b-release-<full-sha>.tar.gz | grep -E 'node_modules/|(^|/)\.git/|\.sqlite($|-)|(^|/)secrets\.env$|ADMIN_LOGIN\.txt|LOGIN-INFO\.txt' || true)
uploads=$(tar -tzf autob2b-release-<full-sha>.tar.gz | grep -E 'uploads/.+' | grep -v -E '(^|/)uploads/\.gitkeep$' || true)
if [ -n "$bad$uploads" ]; then echo 'UNEXPECTED PATH'; printf '%s\n' "$bad" "$uploads"; exit 1; fi
echo 'archive path check ok'
sudo mkdir -p /srv/autob2b/releases
sudo tar -xzf autob2b-release-<full-sha>.tar.gz -C /srv/autob2b/releases
sudo mv /srv/autob2b/releases/autob2b /srv/autob2b/releases/<full-sha>
```

The archive excludes `.git`, `node_modules`, database files, secrets, and upload contents. `uploads/.gitkeep` may be present and is an empty marker.

## 2. Host directories

```bash
sudo mkdir -p /srv/autob2b/data /srv/autob2b/uploads /srv/autob2b/releases
sudo chown root:root /srv/autob2b /srv/autob2b/data /srv/autob2b/uploads
sudo chmod 700 /srv/autob2b /srv/autob2b/data /srv/autob2b/uploads
```

`/srv/autob2b/data` must be empty on a fresh deployment. Do not copy a database from the old repository, from Render, or from a developer machine. Do not copy `ADMIN_LOGIN.txt` or `LOGIN-INFO.txt`.

Create the secrets file as root. A sample of the key names is `deploy/secrets.env.example`. Put a new password only in the host file:

```bash
sudo install -m 600 -o root -g root /dev/null /srv/autob2b/secrets.env
sudoedit /srv/autob2b/secrets.env
sudo chmod 600 /srv/autob2b/secrets.env
sudo chown root:root /srv/autob2b/secrets.env
```

Confirm it is a file and not a directory, then confirm the mode. This command prints the mode and the key names, not the values:

```bash
sudo stat -c '%A %U %G %F' /srv/autob2b/secrets.env
sudo awk -F= '/^[A-Za-z_]/{print $1}' /srv/autob2b/secrets.env
```

Expected mode is `-rw-------` and owner `root root`. Expected keys are `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, optionally `BOOTSTRAP_ADMIN_NAME`, optionally `OWNER_EMAIL`, optionally `HEAD_ADMIN_EMAILS`, and the three seller lines `SELLER_LEGAL_NAME`, `SELLER_CVR`, and `SELLER_ADDRESS`. No other key is accepted. Do not add a seller email or phone key. `HEAD_ADMIN_EMAILS=jan@jan.dk` makes that login a head admin at runtime and does not rewrite the user row.

Without the three seller lines, the process still starts and reservations still work, but a buy returns 503 and does not write an agreement. The values for this company are in `deploy/OPERATOR.md`. Adding them does not rewrite an agreement that is already stored, and it does not open the public site. Public maintenance stays until that is decided separately.

## 3. Build and start

From the extracted release directory:

```bash
cd /srv/autob2b/releases/<full-sha>
sudo docker compose build
sudo docker tag autob2b:reviewed autob2b:<full-sha>
sudo docker compose up -d
sudo docker compose ps
```

The service must not publish `0.0.0.0:10000`. Check the host sockets:

```bash
sudo ss -ltnp | grep 10000 || true
```

Expected: one listener on `127.0.0.1:10000` and no listener on `0.0.0.0:10000` or `[::]:10000`. If the process logged `Refusing to start` or exited, read `sudo docker compose logs --tail=50`. Those logs must not contain the bootstrap password. A correct first start logs that the first admin was created, without the email or the password.

Health, from the host, still before Caddy is switched:

```bash
curl -fsS http://127.0.0.1:10000/api/health
```

Expected body: `{"ok":true}`.

Log in once in a browser only after Caddy is proxying HTTPS, or with a local HTTPS test you control. Then use **Adgangskode** to replace the bootstrap password. Restart and confirm the new password still works and the bootstrap password does not:

```bash
cd /srv/autob2b/releases/<full-sha>
sudo docker compose restart
```

Cars, lots, dealer approvals, and orders entered before the restart must still be there. Changing the password inside `secrets.env` must not change the live password.

This build adds archive columns on `orders` and an `order_corrections` table the first time it opens the database. It does not rewrite a stored agreement. A confirmed or completed purchase keeps its cars off sale, including after the order is archived. `deploy/OPERATOR.md` describes the fields and the rollback risk. Running `7477c4aa` against this database ignores `archived_at`, so archived orders become visible live orders again. Restore the database backup taken before this build instead of only swapping the application back.

## 4. Caddy

Edit the existing site block. Do not remove the `hbgproff.dk` / `www.hbgproff.dk` site labels. Replace the maintenance `respond` 503 with the snippet in `deploy/Caddyfile.snippet`:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

If the Caddyfile lives somewhere else, validate that file instead. Reload only after `ss` shows `127.0.0.1:10000` and `/api/health` has returned `{"ok":true}`. Until that reload, the public site stays on the current maintenance response.

After reload, HTTPS requests hit the app. The cookie is `Secure`, so the browser sends it only to HTTPS. Login and dealer registration stay closed until you approve a dealer in the admin UI.

## 5. Backup

Stop the process so SQLite checkpoints the WAL, then copy data and uploads. Keep secrets in a separate root-only file, not in a world-readable archive.

```bash
cd /srv/autob2b/releases/<full-sha>
sudo docker compose stop
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
sudo tar -C /srv/autob2b -czf /root/autob2b-data-$STAMP.tar.gz data uploads
sudo install -m 600 /srv/autob2b/secrets.env /root/autob2b-secrets-$STAMP.env
sudo docker compose start
sudo chmod 600 /root/autob2b-data-$STAMP.tar.gz /root/autob2b-secrets-$STAMP.env
```

A consistent backup is a stopped database plus the uploads directory from the same moment. Copying `/srv/autob2b/data` while the process is running also requires the `-wal` and `-shm` files from that same instant; prefer the stop/start sequence above. Do not put `secrets.env` inside the data archive.

Record the image id next to the backup:

```bash
sudo docker image inspect autob2b:<full-sha> --format '{{.Id}}' | sudo tee /root/autob2b-image-$STAMP.txt
sudo chmod 600 /root/autob2b-image-$STAMP.txt
```

## 6. Restore

Restore data only from a backup taken from this deployment, not from the historical public database.

```bash
cd /srv/autob2b/releases/<full-sha>
sudo docker compose stop
sudo mv /srv/autob2b/data /srv/autob2b/data.replaced-$STAMP
sudo mv /srv/autob2b/uploads /srv/autob2b/uploads.replaced-$STAMP
sudo tar -xzf /root/autob2b-data-$STAMP.tar.gz -C /srv/autob2b
sudo chown -R root:root /srv/autob2b/data /srv/autob2b/uploads
sudo chmod 700 /srv/autob2b/data /srv/autob2b/uploads
sudo docker compose start
curl -fsS http://127.0.0.1:10000/api/health
```

Confirm an admin can log in with the password that was current when the backup was taken, and that a known vehicle is still listed. The secrets file is not inside the data archive. Restore it separately, only if it was lost, from `/root/autob2b-secrets-$STAMP.env` to `/srv/autob2b/secrets.env` with mode `0600`. Restoring an old secrets file does not reset a password that is already in the restored database.

## 7. Rollback

Roll back the image, not the security fix, unless you also restore a matching database backup.

Safe rollback of a bad build of this same fix: stop, start the previous release directory that still contains this bootstrap behavior, and tag that image back.

```bash
cd /srv/autob2b/releases/<previous-full-sha>
sudo docker compose up -d --build
```

The data directory stays where it is. Schema in this fix is created with `CREATE TABLE IF NOT EXISTS` and does not migrate or delete rows on startup.

Do not roll this database back to commit `431e4354233cf8210fbb3f0734b10c7c1f08ac41` or any earlier commit. Those builds rewrite administrator password hashes from values stored in source on every startup. If that process starts against `/srv/autob2b/data`, it will replace the current admin password. Leave Caddy on maintenance if you have to stop this build and you do not have a later image.

Public rollback of Caddy, if the new process must be taken out of service:

```bash
# restore the previous Caddy site block that responds 503, then:
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
cd /srv/autob2b/releases/<full-sha>
sudo docker compose stop
```

## 8. Checks before the site leaves maintenance

- `sudo ss -ltnp` shows `127.0.0.1:10000` only.
- `curl -fsS http://127.0.0.1:10000/api/health` returns `{"ok":true}`.
- A fresh data directory does not accept any credential from the old public copy, because those users were not created.
- Restart keeps a password changed in **Adgangskode**, and keeps a car that was added before the restart.
- An unapproved dealer can log in and sees the waiting page, and cannot open the catalogue until an admin approves them.
- Two buyers cannot both purchase the last unit. The application tests cover that race; repeat it in the browser only with test accounts you create yourself.

Browser coverage of the admin and dealer screens was not claimed from this change set. Exercise those screens yourself before removing the Caddy 503.
