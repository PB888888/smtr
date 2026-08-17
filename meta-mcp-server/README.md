# meta-mcp-server

MCP server exposing Meta Graph API comment and message management for Paddock Blade.

Fourteen tools, all prefixed `meta_`. Eight read-only, six writes. Every write is
gated behind a required `confirmed` parameter and appends to an append-only audit
log. See `docs/phase-1-plan.md` for the research this was built on and
`docs/phase-2-notes.md` for verification evidence.

## Quick start

```bash
npm install
npm run build
cp ../.env.example ../.env     # then fill in META_ACCESS_TOKEN
npm start                       # stdio transport
```

Run the `meta_check_access` tool first. It reports whether the configured Graph
API version responds, which scopes the token actually holds, when it expires, and
which Pages and Instagram accounts are reachable.

## Transports

| Command | Transport | Use |
| --- | --- | --- |
| `npm start` | stdio | local use, MCP Inspector, Claude Desktop |
| `npm run start:http` | streamable HTTP, stateless | later remote hosting |

The HTTP entry binds to `127.0.0.1` by default, which enables the SDK's DNS
rebinding protection. It has **no authentication**. Do not bind it to a public
interface without putting authenticated reverse proxy in front — anyone reaching
the port could post publicly as Paddock Blade and read customers' private
messages. It prints a warning if you bind it beyond localhost.

## Safety model

Three independent barriers stand between the agent and a real customer:

1. **`confirmed: boolean`**, required on all six write tools. When not exactly
   `true` the tool returns the full text that *would* be published and makes no
   API call — the client is never reached.
2. **`META_DRY_RUN=true`** makes every write log its intent and return without
   any network call at all, reads included.
3. **The messaging window check** refuses DM sends Meta would not permit, and
   never applies the `HUMAN_AGENT` tag on its own initiative.

## Development

```bash
npm run typecheck
npm run inspect     # MCP Inspector against the built server
```
