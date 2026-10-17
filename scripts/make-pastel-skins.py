#!/usr/bin/env python3
"""Author the pastel skin pairs.

Each pastel scene is two real Hermes skins - light-<slug>.yaml and
dark-<slug>.yaml - because a dynamic scene in Chroma is a light/dark pair joined
in THEME_PAIRS. Writing both from one spec keeps the pair honest: the same hues
in both modes, only the lightness inverted.

Design rules, so a pastel skin is a usable theme and not just a pretty swatch:
  - The LIGHT shell is a pale, faintly tinted background, and body text is dark
    enough to clear WCAG AA on it.
  - The accent is a true pastel (high lightness, low chroma), but dark enough to
    stay visible as a border, prompt symbol and rule. A pastel that is invisible
    is not a theme, it is a decoration.
  - The DARK shell inverts the lightness and lifts the accent, so the pair still
    reads as one family when the mode toggles.

Usage: python scripts/make-pastel-skins.py [skins_dir]
"""

from __future__ import annotations

import sys
from pathlib import Path

SKINS = {
    "pastel-cotton-candy": {
        "description": "Cotton candy — blush and lilac, soft as spun sugar",
        "light": dict(bg="#FDF3F8", surface="#F8E7F0", surface2="#F4DCE8", text="#4A3341",
                      dim="#8A6B7B", accent="#E795BE", strong="#B85F8A", border="#F1D3E3",
                      ok="#6F9469", warn="#BD8A4A", error="#BE6E6C"),
        "dark": dict(bg="#231A1F", surface="#2C2128", surface2="#33262F", text="#F6E6EE",
                     dim="#A98EA0", accent="#F2ACC9", strong="#F7C6DB", border="#46323E",
                     ok="#A8C6A6", warn="#E2B77E", error="#E39293"),
    },
    "pastel-mint-sorbet": {
        "description": "Mint sorbet — cool mint over clean porcelain",
        "light": dict(bg="#F2FAF6", surface="#E7F4EE", surface2="#DDEBE4", text="#2F463D",
                      dim="#6E8A80", accent="#9CD3BA", strong="#4F8E74", border="#D8EAE1",
                      ok="#66956D", warn="#B98C50", error="#BC7571"),
        "dark": dict(bg="#14201B", surface="#1B2A24", surface2="#21322B", text="#E7F3ED",
                     dim="#8FA9A0", accent="#A9E0C6", strong="#C3EBD9", border="#2E453C",
                     ok="#A3C6A4", warn="#E0BA85", error="#E0938E"),
    },
    "pastel-buttercup": {
        "description": "Buttercup — warm butter and cream, gentle as morning light",
        "light": dict(bg="#FEFAF0", surface="#FAF2DF", surface2="#F5EAD1", text="#4A4028",
                      dim="#8A7D5C", accent="#EFD292", strong="#A88A3E", border="#F0E3C6",
                      ok="#6E8A5F", warn="#B5813A", error="#BA6B65"),
        "dark": dict(bg="#201C12", surface="#2A2517", surface2="#332D1D", text="#F7F0DF",
                     dim="#ADA286", accent="#F0DCA4", strong="#F7E9C4", border="#453D26",
                     ok="#A9C39C", warn="#E4BE7C", error="#DF918B"),
    },
    "pastel-powder-blue": {
        "description": "Powder blue — calm sky over fresh snow",
        "light": dict(bg="#F3F8FD", surface="#E8F1FA", surface2="#DEE9F5", text="#2C3D4F",
                      dim="#6C8199", accent="#A9C6E6", strong="#5279A6", border="#DAE7F3",
                      ok="#6A9179", warn="#B98C50", error="#BC7276"),
        "dark": dict(bg="#151E27", surface="#1C2833", surface2="#22303D", text="#E7EFF7",
                     dim="#93A7BA", accent="#B4D0EC", strong="#D0E3F6", border="#2C3D4C",
                     ok="#A2C2AE", warn="#E0B981", error="#E0959A"),
    },
    "pastel-peach-blossom": {
        "description": "Peach blossom — ripe peach and warm cream",
        "light": dict(bg="#FFF6F1", surface="#FBEADF", surface2="#F7E0D2", text="#4A362C",
                      dim="#8B6F60", accent="#F0B694", strong="#B0703F", border="#F3DFD2",
                      ok="#6E8A60", warn="#B98C50", error="#BA6A63"),
        "dark": dict(bg="#231A15", surface="#2C221B", surface2="#342720", text="#F7EAE1",
                     dim="#AE9384", accent="#F3C4A4", strong="#F8D8C0", border="#46342A",
                     ok="#A7C29A", warn="#E2B87C", error="#E09189"),
    },
}

# Full key set, mirroring the bundled skins: the picker only reads KEEP_KEYS,
# but the file must also work as a real CLI skin.
def build(mode: str, p: dict) -> dict:
    accent = p["accent"]
    # The pastel accent is the theme's signature, and it is deliberately pale:
    # measured at 1.4-2.1:1 against the light shell, it must not carry a rule,
    # a border, or anything the eye has to follow. Those roles take the darker
    # "strong" tone, which clears 3:1. A pale accent is a palette; an invisible
    # input rule is a bug.
    rule = p["strong"] if mode == "light" else accent
    return {
        "background": p["bg"],
        "ui_accent": accent,
        "banner_accent": accent,
        "banner_title": p["text"],
        "banner_text": p["text"],
        "ui_text": p["text"],
        "banner_dim": p["dim"],
        "banner_border": p["border"],
        "ui_border": p["border"],
        "ui_ok": p["ok"],
        "ui_warn": p["warn"],
        "ui_error": p["error"],
        "prompt": p["text"],
        "input_rule": rule,
        "response_border": rule,
        "status_bar_bg": p["surface"],
        "status_bar_text": p["text"],
        "status_bar_good": p["ok"],
        "status_bar_warn": p["warn"],
        "status_bar_critical": p["error"],
        "session_label": p["strong"],
        "session_border": p["border"],
        "ui_tool": p["strong"],
        "ui_thinking": p["dim"],
        "diff_added": p["ok"],
        "diff_removed": p["error"],
        "diff_added_word": p["ok"],
        "diff_removed_word": p["error"],
        "syntax_string": p["ok"],
        "syntax_number": p["strong"],
        "syntax_keyword": p["strong"],
        "syntax_comment": p["dim"],
        "completion_menu_bg": p["surface"],
        "completion_menu_current_bg": p["surface2"],
        "completion_menu_meta_bg": p["surface2"],
        "shell_dollar": p["strong"],
    }


def render(name: str, description: str, mode: str, colors: dict) -> str:
    lines = [
        f"# Hermes skin — {name}.",
        f"# {description}",
        f"name: {name}",
        f"description: {description}",
        "",
        "colors:",
    ]
    for key, value in colors.items():
        lines.append(f'  {key}: "{value}"')
    lines += [
        "",
        "branding:",
        "  agent_name: Hermes Agent",
        "  prompt_symbol: ❯",
        "  help_header: (^_^)? Commands",
        "",
        'tool_prefix: "┊"',
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    script_dir = Path(__file__).resolve().parent
    skins_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else script_dir.parent / "skins"
    if not skins_dir.is_dir():
        print(f"ERROR: no such skins dir: {skins_dir}", file=sys.stderr)
        return 1

    written = []
    for slug, spec in SKINS.items():
        for mode in ("light", "dark"):
            name = f"{mode}-{slug}"
            path = skins_dir / f"{name}.yaml"
            path.write_text(render(name, spec["description"], mode, build(mode, spec[mode])),
                            encoding="utf-8", newline="\n")
            written.append(path.name)

    print(f"wrote {len(written)} skins into {skins_dir}")
    for name in written:
        print("  " + name)
    print("\nAdd one pair per scene to THEME_PAIRS in scripts/regenerate.py:")
    for slug in SKINS:
        print(f'    ("dark-{slug}", "light-{slug}"),')
    return 0


if __name__ == "__main__":
    sys.exit(main())
