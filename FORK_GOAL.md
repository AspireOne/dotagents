# Dotagents Fork: MCP Portability and Target Overrides

## Purpose

This fork exists to make dotagents usable as the canonical, vendor-neutral source of truth for my global MCP configuration.

I use several AI coding harnesses, primarily:

* Codex — primary harness
* OpenCode
* Pi Agent
* potentially Claude Code and others

I already use `~/.agents/` as the shared home for agent configuration:

* `~/.agents/skills/` is the canonical skills directory.
* `~/.agents/AGENTS.md` is the canonical global instruction file, symlinked where necessary.
* I want `~/.agents/agents.toml` to become the equivalent canonical source for MCP servers.

The desired architecture is:

```text
~/.agents/
├── AGENTS.md
├── skills/
└── agents.toml     ← canonical MCP configuration
                         │
                         ▼
                     dotagents
                  ┌──────┼───────┐
                  ▼      ▼       ▼
                Codex  OpenCode  Claude/others
```

Pi is currently an exception. Pi does not have native core MCP configuration comparable to Codex/OpenCode, so MCP support can continue to use a Pi MCP adapter importing the generated Codex configuration. Pi support is not a requirement of this fork unless it becomes trivial to add cleanly.

## Why dotagents

Several approaches were considered.

### Native configuration only

Every harness can maintain its own MCP configuration.

This works, but causes duplicate configuration and configuration drift. Adding or changing an MCP means updating multiple files with different schemas.

This is the problem this fork is intended to eliminate.

### Symlinking MCP configuration

This works for things such as `AGENTS.md` and often for skills because clients have converged on compatible filesystem conventions.

It does not work for MCP configuration because clients genuinely use different schemas and formats. Codex uses TOML, OpenCode uses its own JSON/JSONC representation, Claude and Cursor use different JSON representations, etc.

MCP configuration therefore needs projection/compilation rather than filesystem sharing.

### MCP gateway/proxy

A central MCP gateway could make every harness connect to one common MCP server.

This solves a different problem and introduces unnecessary runtime infrastructure: another process, another failure point, another protocol hop, centralized tool discovery, and additional debugging complexity.

The goal here is configuration synchronization, not runtime proxying.

### nicepkg/vsync

vsync was the main alternative considered.

Its architecture is roughly:

```text
Codex
  │
  └── vsync
       ├── OpenCode
       ├── Claude
       └── Cursor
```

It has an important practical advantage: the source harness remains authoritative and is not rewritten. Therefore Codex-specific configuration can remain in Codex even when vsync does not understand it.

For my setup, Codex could be the source of truth and this would work reasonably well.

However, this architecture makes one vendor-specific harness arbitrarily special. The canonical representation is still `~/.codex/config.toml`, rather than a neutral agent configuration.

I prefer:

```text
~/.agents/agents.toml
        │
        └── runtime adapters
```

over:

```text
Codex config
        │
        └── runtime adapters
```

Because I am willing to maintain a small fork, the cleaner long-term architecture is more important than minimizing the initial implementation work. I also like dotagents in general - it's philosophy, the convention it's trying to follow and establish, and it's other features, both present (sub-agents management, mcp managemet through cli etc.) and future. I just want to use dotagents itself, because it's the perfect architecture and a great general tool, but I need to tweak this one thing because otherwise I cannot use it as a final central MCP management - I need to be able to enable/disable MCPs (and have it propagate to different harnesses in the format they require) and be able to cleanly pass arbitrary flags as well as an escape hatch.

For that reason, Sentry's dotagents was chosen.

## The current problem with dotagents

Dotagents has the right overall architecture but its MCP abstraction is currently too restrictive.

Its canonical MCP model intentionally contains only broadly portable properties such as:

* `name`
* `command`
* `args`
* `url`
* `headers`
* `env`

That works until a target harness has useful native functionality outside this common denominator.

My current Codex configuration uses examples such as:

```toml
enabled = false
```

```toml
bearer_token_env_var = "ITSAPLAN_API_KEY"
```

```toml
default_tools_approval_mode = "approve"
```

and nested tool configuration:

```toml
[mcp_servers.plane.tools.project]
approval_mode = "approve"
```

Codex also supports other target-specific options such as timeouts and tool allow/deny configuration.

The important point is that dotagents should NOT need to understand every one of these properties.

Trying to add every Codex, OpenCode, Claude, Cursor, etc. setting to the portable MCP schema would create permanent maintenance work and destroy the abstraction.

The actual missing feature is an escape hatch for arbitrary target-native configuration.

## Primary required change: per-target MCP overrides

Add an arbitrary per-target override/passthrough mechanism to each MCP declaration.

Proposed configuration:

```toml
[[mcp]]
name = "plane"
url = "https://mcp.plane.so/http/mcp"

[mcp.overrides.codex.tools.project]
approval_mode = "approve"

[mcp.overrides.codex.tools.workitem]
approval_mode = "approve"

[mcp.overrides.codex.tools.workitem_type]
approval_mode = "approve"

[mcp.overrides.codex.tools.label]
approval_mode = "approve"
```

Another example:

```toml
[[mcp]]
name = "playwright"
command = "npx"
args = [
  "@playwright/mcp@latest",
  "--headless",
  "--isolated"
]

[mcp.overrides.codex]
enabled = false

[mcp.overrides.codex.tools.browser_navigate]
approval_mode = "approve"
```

The exact name `overrides` is not mandatory if another name fits the existing codebase better. Preserve the underlying concept.

### Semantics

The generation pipeline should effectively become:

```text
portable MCP declaration
        │
        ▼
target adapter
        │
        ▼
native generated MCP object
        │
        ▼
deep merge target-specific override
        │
        ▼
write target configuration
```

Conceptually:

```ts
const generated = adapter.generate(mcp);
const final = deepMerge(generated, mcp.overrides?.[target]);
```

The target override must win on conflicts.

This makes the canonical portable fields useful as defaults while still allowing complete access to the native target's functionality.

### Override values

Overrides should support arbitrary TOML-compatible configuration values, including:

* strings
* numbers
* booleans
* arrays
* nested objects/tables

Nested configuration is important because Codex uses structures such as:

```toml
[mcp_servers.foo.tools.bar]
approval_mode = "approve"
```

### Merge behavior

Use predictable recursive deep-merge semantics:

* objects/tables merge recursively
* scalar values in the override replace generated values
* arrays in the override replace generated arrays
* the override is applied last

Do not invent target-specific validation for arbitrary override properties.

The entire point of this mechanism is that dotagents does not need to know what `approval_mode`, `enabled_tools`, or some future Codex setting means.

Native clients are the authority on their native settings.

Dotagents may still validate that the override itself is structurally representable.

### Ownership

A dotagents-managed MCP should still be fully owned by dotagents.

The difference is that its expected generated state now includes both:

1. the portable translated configuration, and
2. the declared target override.

Therefore `install` and `sync` should preserve/reconstruct target-specific configuration rather than considering it unwanted drift.

Do not implement this as a post-processing script over already-written config files. It should be part of the normal MCP target generation/writer pipeline.

### Target isolation

An override for one target must never leak into another.

For example:

```toml
[mcp.overrides.codex]
enabled = false
```

must affect Codex only.

OpenCode, Claude, Cursor, etc. should receive only their portable representation plus their own override, if one exists.

### Do not normalize every native feature

In particular, do not solve this by adding:

```text
enabled
approval_mode
enabled_tools
disabled_tools
startup_timeout
...
```

one by one to the universal MCP model.

Some genuinely portable concepts may eventually deserve first-class fields upstream, but this fork should not become a compatibility catalogue for every harness.

The target override is the forward-compatible escape hatch.

## Required Codex fixes

There are also two existing Codex MCP serialization problems that matter independently of overrides.

Before implementing either fix, inspect current upstream `main` and relevant open/merged PRs. If upstream has already fixed a problem, use or preserve the upstream solution rather than implementing a competing version.

### 1. Stdio environment-variable passthrough

Upstream issue: #158.

A canonical declaration such as:

```toml
[[mcp]]
name = "example"
command = "example-mcp"
env = ["API_TOKEN"]
```

represents an inherited environment variable.

Codex distinguishes literal environment values from inherited variable names.

The expected Codex representation is conceptually:

```toml
[mcp_servers.example]
command = "example-mcp"
env_vars = ["API_TOKEN"]
```

It must not generate:

```toml
[mcp_servers.example.env]
API_TOKEN = "${API_TOKEN}"
```

because Codex interprets values inside `env` literally.

Literal adapter-provided environment values, if supported separately by dotagents, should remain literal `env` entries. Inherited canonical `env` names should become Codex `env_vars`.

Add exact parsed-object tests for this behavior rather than merely checking that generated TOML contains the server name.

### 2. HTTP environment-backed headers

Upstream issue: #171.

Given:

```toml
[[mcp]]
name = "example"
url = "https://example.test/mcp"

[mcp.headers]
X-Api-Key = "${API_KEY}"
```

Codex expects:

```toml
[mcp_servers.example.env_http_headers]
X-Api-Key = "API_KEY"
```

The current reported bug reverses those values:

```toml
API_KEY = "X-Api-Key"
```

Fix the mapping direction.

Again, add exact tests.

This is especially important because portable bearer-token authentication should be possible through configuration such as:

```toml
[[mcp]]
name = "example"
url = "https://example.test/mcp"
env = ["TOKEN"]

[mcp.headers]
Authorization = "Bearer ${TOKEN}"
```

Authentication must remain symbolic. Do not expand secrets while generating configuration.

For Codex, translate the complete symbolic bearer form
`Authorization = "Bearer ${TOKEN}"` to
`bearer_token_env_var = "TOKEN"`. Other mixed header values remain literal
unless a target override supplies a native representation.

## Representative end state

After this fork, configuration like the following should be possible:

```toml
version = 1

agents = ["codex", "opencode"]

[[mcp]]
name = "chrome-devtools"
command = "npx"
args = [
  "-y",
  "chrome-devtools-mcp@latest",
  "--headless=true",
  "--isolated=true",
  "--executable-path=/usr/bin/chromium-browser"
]

[mcp.overrides.codex.tools.click]
approval_mode = "approve"

[mcp.overrides.codex.tools.evaluate_script]
approval_mode = "approve"

[mcp.overrides.codex.tools.navigate_page]
approval_mode = "approve"

[mcp.overrides.codex.tools.new_page]
approval_mode = "approve"

[mcp.overrides.codex.tools.take_snapshot]
approval_mode = "approve"


[[mcp]]
name = "plane"
url = "https://mcp.plane.so/http/mcp"

[mcp.overrides.codex.tools.project]
approval_mode = "approve"

[mcp.overrides.codex.tools.workitem]
approval_mode = "approve"


[[mcp]]
name = "linear"
url = "https://mcp.linear.app/mcp"

[mcp.overrides.codex]
enabled = false

[mcp.overrides.opencode]
enabled = false
```

The important property is that no manually maintained `[mcp_servers.*]` block should be required in Codex for a dotagents-managed MCP merely because that MCP needs a Codex-specific setting.

`agents.toml` should remain the complete declarative source of truth.

## Scope and non-goals

### Pi Agent MCP projection

Do not add Pi MCP projection as part of this work unless there is an exceptionally clean existing abstraction for it.

Pi currently has different MCP expectations and can use a separate MCP adapter that imports Codex configuration.

Pi already fits the broader `~/.agents` model for skills.

### Universal enable/disable abstraction

Do not initially create a portable universal `enabled` property.

Different harnesses represent enable/disable state differently, and some may model it outside the server object entirely.

For now:

```toml
[mcp.overrides.codex]
enabled = false
```

and an appropriate native OpenCode override are preferable to inventing a misleading universal abstraction.

This can be revisited separately.

### CLI UX for overrides

Supporting arbitrary overrides through `dotagents mcp add ...` is not required for the first implementation.

Direct `agents.toml` configuration is sufficient.

However, existing commands that parse and rewrite `agents.toml`, including `mcp add` and `mcp remove`, must not accidentally discard existing override data.

### Unrelated dotagents functionality

Avoid changing skills, plugins, hooks, subagents, trust behavior, scope behavior, etc. unless required by the MCP changes.

The goal is a small, rebase-friendly fork.

## Compatibility requirements

Preserve existing dotagents behavior for configurations without overrides.

Existing:

```toml
[[mcp]]
name = "foo"
command = "foo"
```

must continue to produce exactly the same effective output as upstream.

Preserve existing ownership behavior:

* undeclared MCP servers in target configurations remain untouched according to existing upstream rules
* unrelated target configuration remains untouched
* declared MCP servers are repaired by `install`/`sync`
* unreadable or incompatible files retain upstream error behavior

Target overrides should extend the generated expected state, not replace the existing ownership model.

## Testing requirements

Before implementation, inspect the repository's current MCP target abstractions and existing tests. Follow existing project conventions rather than building a parallel subsystem.

At minimum add tests covering:

### Generic override behavior

Portable object:

```toml
[[mcp]]
name = "foo"
url = "https://example.test/mcp"
```

plus:

```toml
[mcp.overrides.codex]
enabled = false
```

must generate the normal Codex server plus:

```toml
enabled = false
```

### Nested override behavior

```toml
[mcp.overrides.codex.tools.search]
approval_mode = "approve"
```

must generate the corresponding nested native structure.

### Override precedence

If an override deliberately replaces a generated property, the override should win.

### Array behavior

Arrays should replace rather than unexpectedly concatenate unless there is a strong existing repository convention to the contrary.

### Target isolation

Codex overrides must not appear in OpenCode output and vice versa.

### Idempotency

Running `install` or `sync` repeatedly against an already-correct generated config should produce no semantic changes.

### Drift repair

If an override-produced field is manually changed or removed from a managed target, `sync` should restore it.

### Existing config preservation

Unmanaged MCP servers and unrelated target settings must continue to survive.

### Codex stdio env passthrough

Canonical inherited env names must become `env_vars`.

### Codex HTTP symbolic headers

Header name → environment-variable name must be written in the correct direction.

### Existing MCP fixtures

All existing tests must remain green.

Run the project's complete validation command before considering the work complete:

```bash
pnpm check
```

## Implementation approach

Do not assume the file names or internal architecture described in old issues are still current.

Start by:

1. Fetching/updating from upstream.
2. Reading the repository's `AGENTS.md` and contributor guidance.
3. Locating the current `agents.toml` MCP schema.
4. Locating the shared MCP writer/projection pipeline.
5. Locating each target definition, especially Codex and OpenCode.
6. Inspecting tests around MCP ownership, merging and serialization.
7. Checking the current state of upstream issues #158 and #171 and any linked PRs.
8. Designing the smallest extension that cleanly carries arbitrary target override data from config parsing through target generation.

Prefer adding a generic facility to the existing pipeline rather than special-casing Codex.

## Maintainability / upstream strategy

The fork should remain as close to Sentry upstream as practical.

Prefer a small series of logically separate commits, for example:

1. `fix(codex): serialize inherited MCP env vars correctly`
2. `fix(codex): correct env_http_headers mapping`
3. `feat(mcp): support per-target native overrides`
4. `docs(mcp): document target overrides`

If upstream already has fixes for #158 or #171, use/cherry-pick/rebase onto those implementations rather than keeping redundant fork-only code.

The override feature should ideally be good enough to propose upstream. It is not specific to my configuration; it solves the general problem that a portable multi-agent abstraction inevitably needs a way to retain target-native functionality.

## Definition of done

This work is complete when:

* `~/.agents/agents.toml` can be the complete source of truth for my MCP declarations.
* A managed MCP can contain arbitrary Codex-specific nested configuration without requiring a manually maintained Codex MCP block.
* Equivalent target-specific overrides can be supplied for OpenCode or other supported targets.
* Unsupported native properties survive `install` and `sync` because they are explicitly part of the canonical declaration.
* Canonical stdio environment passthrough works correctly in Codex.
* Canonical environment-backed HTTP headers work correctly in Codex.
* Existing upstream behavior and tests remain intact.
* Repeated synchronization is idempotent.
* The implementation is generic and does not require dotagents to learn every future vendor-specific MCP property.
