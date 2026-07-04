# AGENTS.md

## Cursor Cloud specific instructions

ForgeSlicer is a browser-based 3D CAD + slicer app. Two services plus a database
must run for end-to-end development:

- **MongoDB** on `localhost:27017` (required; backend crashes on startup without it).
- **Backend** — FastAPI at `backend/server.py` (`server:app`), run with uvicorn on
  port **8001**. Start from `backend/` using the project virtualenv:
  `backend/.venv/bin/uvicorn server:app --host 0.0.0.0 --port 8001 --reload`.
- **Frontend** — React 19 (CRA + CRACO) on port **3000**: `cd frontend && yarn start`.
  The frontend talks to the backend via `REACT_APP_BACKEND_URL` (see `frontend/.env`).

### Environment / secrets

- `.env` files are git-ignored and NOT committed. They are recreated as part of the
  startup update script. Backend needs `MONGO_URL` and `DB_NAME` (mandatory);
  frontend needs `REACT_APP_BACKEND_URL=http://localhost:8001`.
- Every other integration (OpenAI, Meshy, Stripe, Braintree, Resend email, Emergent
  LLM, SSO bridge) is optional and feature-gated via `os.environ.get(...)`; the app
  runs fine without those keys.

### Non-obvious gotchas

- `emergentintegrations` (imported at module load in `server.py`) is NOT on public
  PyPI. Install it with the extra index
  `--extra-index-url https://d33sy5i8bnduwe.cloudfront.net/simple/`. Install it
  BEFORE (or together with) `requirements.txt`, then re-run `pip install -r
  requirements.txt` so the pinned versions (fastapi 0.110.1 etc.) win, since
  emergentintegrations pulls newer fastapi/starlette.
- Backend Python: use the `backend/.venv` virtualenv (Python 3.12). The system
  `python3 -m venv` needs the `python3-venv`/`python3.12-venv` apt packages.
- On startup the backend kicks off an OrcaSlicer auto-install that fails with
  `PermissionError: /app` in this sandbox. This is EXPECTED and harmless — the
  server-side OrcaSlicer engine is optional and the app falls back to the built-in
  in-browser JS slicer.
- The `/workspace` UI route is auth-gated. Local email/password auth works fully
  offline: `POST /api/auth/register` / `/api/auth/login` (no external OAuth needed).
  Use a real-looking domain (e.g. `@example.com`); `.test`/reserved domains are
  rejected by the email validator.
- Frontend uses **yarn** (`packageManager` pins yarn 1.22.22); there was no
  committed lockfile originally. A `postinstall` hook copies
  `node_modules/manifold-3d/manifold.wasm` → `public/manifold.wasm` — do not commit
  the regenerated binary diff.

### Lint / test

- Backend lint: `backend/.venv/bin/flake8 <path>` (also `black`, `mypy` available).
- Frontend lint runs automatically via CRACO/ESLint during `yarn start`/`yarn build`.
- Tests: `backend/.venv/bin/python -m pytest tests/` (run from repo root). Point them
  at the local backend with `REACT_APP_BACKEND_URL=http://localhost:8001`. The
  `tests/test_starter_templates.py` suite passes fully. Some mesh tests require
  local STL fixtures (e.g. `/tmp/cube.stl`) and auth tokens that are not present by
  default, and `/api/mesh/segment` is not a mounted route — those failures are
  pre-existing test-setup/feature gaps, not environment problems.
