// Read-only: list HAR-2030's Builds and Parts with their links. GET only.
// Credentials come from .env via dotenv and are never printed.
import 'dotenv/config';

const base = (process.env.JIRA_URL ?? process.env.JIRA_BASE_URL).replace(/\/$/, '');
const headers = { Authorization: `Bearer ${process.env.JIRA_KEY}`, Accept: 'application/json' };

async function get(path) {
  const res = await fetch(`${base}${path}`, { method: 'GET', headers });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}

const FIELDS = ['summary', 'status', 'issuetype', 'issuelinks', 'customfield_10500',
  'customfield_10501', 'customfield_10502', 'customfield_10110'];
const jql = encodeURIComponent('"Epic Link" = HAR-2030 ORDER BY key ASC');
const { issues } = await get(`/rest/api/2/search?jql=${jql}&maxResults=100&fields=${FIELDS.join(',')}`);
const epic = await get(`/rest/api/2/issue/HAR-2030?fields=summary,status,issuetype`);

const linkText = (key, l) => (l.outwardIssue
  ? `${key} ${l.type.outward} ${l.outwardIssue.key} (#${l.id})`
  : `${key} ${l.type.inward} ${l.inwardIssue.key} (#${l.id})`);

const out = {
  assembly: { key: epic.key, summary: epic.fields.summary, type: epic.fields.issuetype.name, status: epic.fields.status.name },
  issues: issues.map((i) => ({
    key: i.key,
    type: i.fields.issuetype.name,
    summary: i.fields.summary,
    status: i.fields.status.name,
    buildNumber: i.fields.customfield_10501 ?? null,
    revision: i.fields.customfield_10500 ?? null,
    onshapeVersionLink: i.fields.customfield_10502 ?? null,
    links: (i.fields.issuelinks ?? [])
      .filter((l) => ['Used In', 'Revises'].includes(l.type.name))
      .map((l) => linkText(i.key, l)),
  })),
};
console.log(JSON.stringify(out, null, 2));
