# AutoB2B

Closed dealer inventory for this fork. Production is Docker Compose on the operator host, behind the existing Caddy site. This branch is not a Render deploy.

There is no default administrator, no password in the source tree, and no demo inventory. The first admin is created once from a root-only secrets file. Later startups do not reset that password.

- Operator contract: `deploy/OPERATOR.md`
- Deploy, backup, restore, and rollback: `deploy/RUNBOOK.md`
- Tests: `npm test`
- Local process, loopback only: `./start.sh` after the bootstrap variables in `deploy/OPERATOR.md` are set. `./stop.sh` stops it.

`npm run seed` and `npm run seed:admins` refuse to run. They do not create accounts or sample cars.
