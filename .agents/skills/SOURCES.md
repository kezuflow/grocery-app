# Project skill sources

These skills are installed for this repository. AGENTS.md owns task routing and authorization. DESIGN.md owns visual standards.

Research on 2026-10-11 confirms that the original pstack lives in [cursor/plugins](https://github.com/cursor/plugins/tree/main/pstack). Its [MIT license](https://github.com/cursor/plugins/blob/main/pstack/LICENSE) credits Lauren Tan. The installed backnotprop collection is a standalone mirror with mappings for Codex and other agents. It is not a separate official Codex plugin. [OpenAI's skill documentation](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills) confirms repository discovery through `.agents/skills`.

The [good-css source](https://github.com/vojtaholik/good-css) owns its CSS techniques and references. The [official shadcn skill documentation](https://ui.shadcn.com/docs/skills) and [CLI reference](https://ui.shadcn.com/docs/cli) own upstream component discovery and preview commands. FreshMarkets uses its existing Admin-only adaptation within AGENTS and DESIGN. This research does not update installed upstream files or their pinned revisions.

| Collection | Source revision | Installed scope |
| --- | --- | --- |
| pstack | [backnotprop/pstack at 3a604672](https://github.com/backnotprop/pstack/tree/3a604672c46cd8187d2b19980eae0a34f9f91138) | All 51 upstream skill directories, including `poteto-mode`, its playbooks, principles and verification generators |
| good-css | [vojtaholik/good-css at 92d436ba](https://github.com/vojtaholik/good-css/tree/92d436ba1937d1b1407c47e35abb3e199eaace2e) | `skills/good-css`, including its eight reference files |
| shadcn-admin | Existing FreshMarkets adaptation of the [official shadcn skill](https://github.com/shadcn-ui/ui/tree/main/skills/shadcn) | Admin-only skill and its existing `.hermes/skills/shadcn-admin` mirror |
| verify-freshmarkets | Project-local generation through [create-verification-skill](create-verification-skill/SKILL.md), 2026-10-12 | Existing Web/Core journeys, owned local lifecycle and evidence; native gate awaits Expo Foundation |

The pstack and good-css files are copied from the pinned revisions. The only content adjustment removes one extra blank line at the end of `automate-me/SKILL.md` to pass Git's whitespace check. Their MIT licenses are preserved in `pstack-license.txt` and `good-css-license.txt`. Project-specific overrides stay in AGENTS.md and DESIGN.md.

The new collections were installed with the Codex `skill-installer` helper. Its command accepts an explicit revision, destination and skill paths:

```powershell
$pstackRevision = "3a604672c46cd8187d2b19980eae0a34f9f91138"
$pstackSkills = Invoke-RestMethod -Uri "https://api.github.com/repos/backnotprop/pstack/contents/skills?ref=$pstackRevision"
$pstackPaths = @($pstackSkills | Where-Object type -eq "dir" | ForEach-Object { $_.path })
python C:/Users/reggi/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py --repo backnotprop/pstack --ref $pstackRevision --dest .agents/skills --path $pstackPaths
python C:/Users/reggi/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py --repo vojtaholik/good-css --ref 92d436ba1937d1b1407c47e35abb3e199eaace2e --dest .agents/skills --path skills/good-css
```

The helper refuses to overwrite an existing skill directory. Review an upstream update and its effects before replacing an installed collection. Newly installed skills are available to Codex on the next turn.
