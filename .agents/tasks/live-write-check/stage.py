#!/usr/bin/env python3
"""Stage one fix's content per commit. Usage: stage.py <c1|c2|c3|c4|c5>.

Builds each partially-staged file from HEAD (or from the working file) with
exact, single-occurrence replacements, then writes it to the index only.
The working tree is never modified.
"""
import subprocess, sys

REPO = '/Volumes/workplace/6800/bom-uploader'


def git(*args, input=None):
    return subprocess.run(['git', '-C', REPO, *args], input=input, capture_output=True,
                          check=True, text=True).stdout


def head(path):
    return git('show', f'HEAD:{path}')


def work(path):
    with open(f'{REPO}/{path}') as f:
        return f.read()


def rep(text, pairs, path):
    for old, new in pairs:
        n = text.count(old)
        if n != 1:
            sys.exit(f'{path}: expected 1 match, found {n}: {old[:80]!r}')
        text = text.replace(old, new)
    return text


def stage_content(path, content):
    sha = git('hash-object', '-w', '--stdin', input=content).strip()
    git('update-index', '--add', '--cacheinfo', f'100644,{sha},{path}')


def stage_file(path):
    git('add', '--', path)


# ---- reverse pairs: (text in working file, text without that fix) ----------

# F3 bits, removed to get the F4-only intermediate.
ONSHAPE_F3 = [
    ("    if (status === 401) {\n",
     "    if (status === 401 || status === 403) {\n"),
    ("""    // Signed in, but the API key's scopes or the document's sharing don't
    // allow this request (e.g. a read-only key asked to create a version).
    if (status === 403) {
      return new OnshapeApiError(
        'Onshape refused access — the API key may lack write scope, or the document is not shared for this action',
        status,
        endpoint,
      );
    }

""", ""),
]
ONSHAPE_TEST_F3 = [
    ("""        // A 403 is a scope or sharing refusal, not a bad key.
        expect(e.message).toContain('Onshape refused access');
""", """        expect(e.message).toContain('Onshape authentication failed');
"""),
]
UPSTREAM_F3 = [
    ("    if (status === 401 || status === 403) return `OnShape refused the change (${status})`;\n", ""),
]
UPSTREAM_TEST_F3 = [
    ("""  it('describes an OnShape 403 as a refusal', () => {
    expect(describeUpstreamError(new OnshapeApiError('Onshape refused access', 403, 'x')))
      .toBe('OnShape refused the change (403)');
  });

""", ""),
]

# F1 pieces applied forward onto HEAD.
JIRA_F1_OLD = """  /**
   * Create an issue link between two issues.
   *
   * The link type's "outward" phrase describes `outwardKey`'s relationship to
   * `inwardKey` (e.g. for "Used In" — outward "uses", inward "is used in" —
   * outwardKey is the Build and inwardKey is the Part, so the Part's own page
   * reads "is used in" the Build).
   *
   * @param {string} typeName    Link type name (e.g. "Used In", "Revises")
   * @param {string} inwardKey   Issue key on the link type's inward side
   * @param {string} outwardKey  Issue key on the link type's outward side
   * @returns {Promise<void>}
   */
  async createIssueLink(typeName, inwardKey, outwardKey) {
    const endpoint = `issueLinks.linkIssues(${inwardKey}, ${outwardKey})`;
    return this._retry(async () => {
      // jira.js names this method linkIssues (POST /rest/api/2/issueLink).
      await this.client.issueLinks.linkIssues({
        type: { name: typeName },
        inwardIssue: { key: inwardKey },
        outwardIssue: { key: outwardKey },
      });
    }, endpoint);
  }
"""


def extract(text, start, end):
    i = text.index(start)
    j = text.index(end, i) + len(end)
    return text[i:j]


def c1():
    for p in ['src/server/services/partService.js', '__tests__/services/partService.test.js']:
        stage_file(p)


def c2():
    for p in ['docs/v3/HANDOFF.md', '__tests__/services/buildService.test.js',
              '__tests__/services/revisionService.test.js',
              '__tests__/services/linkDirection.test.js', '__tests__/mocks/jiraLinkModel.js']:
        stage_file(p)

    p = 'src/server/clients/jiraClient.js'
    new_block = extract(work(p), '  /**\n   * Create an issue link that reads', '    }, endpoint);\n  }\n')
    stage_content(p, rep(head(p), [(JIRA_F1_OLD, new_block)], p))

    p = '__tests__/clients/jiraClient.test.js'
    w = work(p)
    new_describe_start = extract(w, "  describe('createIssueLink', () => {\n",
                                 "data: { type: { name: 'Used In' }, inwardIssue: { key: 'VAL-200' }, outwardIssue: { key: 'VAL-100' } },\n      });\n    });\n")
    old_describe_start = extract(head(p), "  describe('createIssueLink', () => {\n",
                                 "        outwardIssue: { key: 'VAL-200' },\n      });\n    });\n")
    stage_content(p, rep(head(p), [
        (old_describe_start, new_describe_start),
        ("await expect(client.createIssueLink('Revises', 'VAL-1', 'VAL-2'))",
         "await expect(client.createIssueLink('Revises', 'VAL-2', 'VAL-1'))"),
    ], p))

    p = 'src/server/services/buildService.js'
    stage_content(p, rep(head(p), [(
        """    // Part reads "is used in" the Build; Build reads "uses" the Part —
    // matches the inward/outward phrasing the link type was created with.
    await this.jiraClient.createIssueLink(LinkType.USED_IN, partKey, buildKey);
""", """    // "Build uses Part": the Build's page reads "uses" the Part and the
    // Part's page reads "is used in" the Build.
    await this.jiraClient.createIssueLink(LinkType.USED_IN, buildKey, partKey);
""")], p))

    p = 'src/server/services/revisionService.js'
    stage_content(p, rep(head(p), [
        ("      await this.jiraClient.createIssueLink(LinkType.REVISES, previousKey, result.key);\n",
         "      // \"new revises previous\".\n"
         "      await this.jiraClient.createIssueLink(LinkType.REVISES, result.key, previousKey);\n"),
        ("""   * sits on the "revises" (outward) side: that entry's `inwardIssue` is the
   * one it replaced.
""", """   * sits on the "revises" (outward) side. Jira lists that entry on this
   * ticket as `outwardIssue: <the one it replaced>`; a later revision that
   * revises this one appears as `inwardIssue` and is ignored.
"""),
        ("(link) => link.type?.name === LinkType.REVISES && link.inwardIssue,",
         "(link) => link.type?.name === LinkType.REVISES && link.outwardIssue,"),
        ("return revisesLink?.inwardIssue?.key ?? null;",
         "return revisesLink?.outwardIssue?.key ?? null;"),
    ], p))


def c3():
    for p in ['src/server/clients/jiraClient.js', '__tests__/clients/jiraClient.test.js',
              'src/server/middleware/errorHandler.js', 'src/server/middleware/httpError.js',
              '__tests__/routes/middleware.test.js', 'src/server/services/buildService.js',
              'src/server/services/revisionService.js']:
        stage_file(p)
    for p, pairs in [('src/server/clients/onshapeClient.js', ONSHAPE_F3),
                     ('__tests__/clients/onshapeClient.test.js', ONSHAPE_TEST_F3),
                     ('src/server/utils/upstreamError.js', UPSTREAM_F3),
                     ('__tests__/utils/upstreamError.test.js', UPSTREAM_TEST_F3)]:
        stage_content(p, rep(work(p), pairs, p))


def c4():
    for p in ['src/server/clients/onshapeClient.js', '__tests__/clients/onshapeClient.test.js',
              'src/server/utils/upstreamError.js', '__tests__/utils/upstreamError.test.js']:
        stage_file(p)

    p = 'src/client/src/api/client.js'
    stage_content(p, rep(head(p), [
        (" * Thrown for every non-OK response other than 401/403. Carries the HTTP status\n",
         " * Thrown for every non-OK response other than ValorBOM's own 401/403. Carries the HTTP status\n"),
        ("    if (res.status === 401 || res.status === 403) {\n",
         "    // A 401/403 that names a `source` is the tracker or OnShape refusing,\n"
         "    // not ValorBOM's own sign-in gate.\n"
         "    if ((res.status === 401 || res.status === 403) && !body.source) {\n"),
    ], p))

    p = 'src/client/src/lib/friendlyError.js'
    stage_content(p, rep(head(p), [(
        "    if (source === 'onshape') {\n",
        "    if (source === 'onshape') {\n"
        "      if (status === 401 || status === 403) return `OnShape refused the change (${status}).`;\n",
    )], p))

    p = '__tests__/utils/friendlyError.test.js'
    stage_content(p, rep(head(p), [(
        "  it('lowers only a leading \"The\" for use after a colon', () => {\n",
        """  it('describes an OnShape 403 as a refusal', () => {
    expect(friendlyError(apiError(403, { error: 'Onshape refused access', status: 403, source: 'onshape' })))
      .toBe('OnShape refused the change (403).');
  });

  it('lowers only a leading "The" for use after a colon', () => {
""")], p))


def c5():
    for p in ['src/client/src/api/client.js', 'src/client/src/lib/friendlyError.js',
              '__tests__/utils/friendlyError.test.js', '__tests__/utils/apiClient.test.js']:
        stage_file(p)


{'c1': c1, 'c2': c2, 'c3': c3, 'c4': c4, 'c5': c5}[sys.argv[1]]()
print(git('diff', '--cached', '--stat'))
