# ValorBOM

BOM management tool that bridges Onshape CAD assemblies with Jira project tracking. Syncs assembly data from Onshape, manages part metadata, and creates/updates Jira stories for each part.

## Prerequisites

- Node.js 20+
- npm
- Docker (optional)

## Local Installation

```bash
git clone <repo-url>
cd valorbom
npm install
cp .env.example .env
# Fill in your environment variables in .env
npm run build
npm start
```

## Docker Installation

```bash
docker build -t valorbom .
docker run -p 3000:3000 \
  -e JIRA_URL=https://jira.example.com \
  -e JIRA_KEY=your_jira_token \
  -e PROJECT_KEY=VAL \
  -e ONSHAPE_URL=https://cad.onshape.com \
  -e ONSHAPE_ACCESS=your_access_key \
  -e ONSHAPE_SECRET=your_secret_key \
  -e ONSHAPE_TEAM=your_team_id \
  valorbom
```

## Scripts

| Script | Description |
|---|---|
| `npm start` | Start the production server |
| `npm run dev` | Start Vite dev server with HMR |
| `npm run build` | Build the React frontend |
| `npm run preview` | Preview the production build |
| `npm test` | Run tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage |

## Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Server port (default: 3000) |
| `JIRA_URL` | Jira instance base URL |
| `JIRA_KEY` | Jira personal access token |
| `PROJECT_KEY` | Jira project key (default: VAL) |
| `ONSHAPE_URL` | Onshape API base URL |
| `ONSHAPE_ACCESS` | Onshape API access key |
| `ONSHAPE_SECRET` | Onshape API secret key |
| `ONSHAPE_TEAM` | Onshape team ID (optional) |

## Project Structure

```
src/
  server/
    clients/       # Jira and Onshape API clients
    services/      # Business logic (BOM, Epic, Part, Sync, Export)
    routes/        # Express route handlers
    utils/         # Constants, validators, part number parsing
    index.js       # Express entry point
  client/
    src/
      api/         # Fetch-based API client
      components/  # React components
      App.jsx      # Root component
    index.html     # SPA entry point
__tests__/         # Jest test suites
```
