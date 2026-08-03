# ProveSpec parity gate — GitHub Action

Grade a repository against a published [ProveSpec](https://provespec.com) specification on
every pull request, and fail the build when parity drops.

No install step and no dependencies: it runs on the runner's Node, fetches the spec over
HTTPS, and computes the score locally.

```yaml
- uses: provespec/action@v1
  with:
    spec: todomvc          # https://provespec.com/catalog/todomvc/
    scope: AI              # engine-only parity; omit for the whole spec
    min: 80                # fail below 80%
    no-regression: true    # fail on any drop
    badge: badges/parity.svg
```

## What it grades

The spec lives in the catalog; your verdicts live in your repo, at
`.provespec/grades.json`:

```json
{
  "product": "my-todo-app",
  "parity": 89,
  "grades": [
    { "path": ["AI", "Model", "Add todo"], "status": "yes", "note": "src/model.ts:42" },
    { "path": "AI > Model > Toggle all", "status": "partial", "note": "no unset when all done" },
    { "path": "AI > Routing > Filter routes", "status": "no" }
  ]
}
```

- `status` is `yes` · `partial` · `no` · `na`.
- `path` accepts `["A","B"]`, `"A > B"` or `"A/B"`, matched case- and space-insensitively.
- `parity` is the score from the *previous* run — what `no-regression` compares against.
- **Capabilities you leave out count as missing.** The gate cannot be passed by omission.

Generating that file is the agent's job, not yours. With the
[MCP server](https://github.com/provespec/mcp) registered, ask any agent to
"grade this repo against the todomvc spec and write `.provespec/grades.json`", and it will
walk the checklist with file-level evidence.

## Inputs

| Input           | Default                  | Meaning                                                    |
| --------------- | ------------------------ | ---------------------------------------------------------- |
| `spec`          | *(required)*             | Catalog slug, e.g. `todomvc`                                |
| `grades`        | `.provespec/grades.json` | Where your self-assessment lives                            |
| `scope`         | —                        | One top-level group, e.g. `AI` (engine) or `UI` (interface)  |
| `min`           | —                        | Fail below this percentage                                  |
| `no-regression` | `false`                  | Fail on any drop versus the recorded `parity`               |
| `tolerance`     | `0`                      | Points of drop tolerated by `no-regression`                 |
| `badge`         | —                        | Write an SVG badge here (commit it, or upload as artifact)   |
| `site`          | `https://provespec.com`  | Catalog to read from — override only for mirrors            |

## Outputs

`parity`, `has`, `declares`, `missing`, `partial`, `ungraded`, `report` (path to the
markdown report). Exit codes: **0** pass · **1** gate failed · **2** misconfigured or
nothing measurable.

Every run writes a job summary with the score, the delta, and a collapsible full report —
so a failing PR shows exactly which capabilities to close.

## Full example

```yaml
name: parity
on: [pull_request, push]

jobs:
  parity:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - id: parity
        uses: provespec/action@v1
        with:
          spec: todomvc
          scope: AI
          min: 80
          badge: badges/parity.svg
      - run: echo "Engine parity is ${{ steps.parity.outputs.parity }}%"
```

Then put the badge in your README:

```markdown
![parity](badges/parity.svg)
```

## Licence

MIT for this action. The specifications it grades against are CC BY 4.0 — see
https://provespec.com.
