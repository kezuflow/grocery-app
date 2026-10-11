# Project skill sources

These skills are installed for this repository. AGENTS.md owns task routing and authorization. DESIGN.md owns visual standards.

| Collection | Source revision | Installed scope |
| --- | --- | --- |
| pstack | [backnotprop/pstack at 3a604672](https://github.com/backnotprop/pstack/tree/3a604672c46cd8187d2b19980eae0a34f9f91138) | All 51 upstream skill directories, including `poteto-mode`, its playbooks, principles and verification generators |
| good-css | [vojtaholik/good-css at 92d436ba](https://github.com/vojtaholik/good-css/tree/92d436ba1937d1b1407c47e35abb3e199eaace2e) | `skills/good-css`, including its eight reference files |
| shadcn-admin | Existing FreshMarkets adaptation of the [official shadcn skill](https://github.com/shadcn-ui/ui/tree/main/skills/shadcn) | Admin-only skill and its existing `.hermes/skills/shadcn-admin` mirror |

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
