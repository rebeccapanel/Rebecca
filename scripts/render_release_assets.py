from __future__ import annotations

import argparse
from pathlib import Path


MANAGED_START = "<!-- REBECCA_RELEASE_ASSETS_START -->"
MANAGED_END = "<!-- REBECCA_RELEASE_ASSETS_END -->"

ASSETS = [
    ("Linux", "386", "rebecca-linux-386.tar.gz"),
    ("Linux", "amd64", "rebecca-linux-amd64.tar.gz"),
    ("Linux", "arm64", "rebecca-linux-arm64.tar.gz"),
    ("Linux", "armv5", "rebecca-linux-armv5.tar.gz"),
    ("Linux", "armv6", "rebecca-linux-armv6.tar.gz"),
    ("Linux", "armv7", "rebecca-linux-armv7.tar.gz"),
    ("Linux", "s390x", "rebecca-linux-s390x.tar.gz"),
    ("Windows", "amd64", "rebecca-windows-amd64.zip"),
]


def release_asset_url(repo: str, tag: str, asset_name: str) -> str:
    return f"https://github.com/{repo}/releases/download/{tag}/{asset_name}"


def shield_url(repo: str, tag: str, label: str, asset_name: str | None = None) -> str:
    if asset_name:
        return f"https://img.shields.io/github/downloads/{repo}/{tag}/{asset_name}?label={label}&style=flat-square"
    return f"https://img.shields.io/github/downloads/{repo}/{tag}/total?label={label}&style=flat-square"


def render_assets_section(repo: str, tag: str) -> str:
    lines = [
        MANAGED_START,
        "## Panel Binary Builds",
        "",
        "| Platform | Architecture | File | Download |",
        "| --- | --- | --- | --- |",
    ]

    for platform, arch, asset_name in ASSETS:
        lines.append(
            f"| {platform} | {arch} | `{asset_name}` | [Download]({release_asset_url(repo, tag, asset_name)}) |"
        )

    lines.extend(
        [
            "",
            "## Reports",
            "",
            f"- ![Total]({shield_url(repo, tag, 'Total')})",
        ]
    )

    for platform, arch, asset_name in ASSETS:
        label = f"{platform.lower()}-{arch}"
        lines.append(f"- ![{label}]({shield_url(repo, tag, label, asset_name)})")

    lines.append(MANAGED_END)
    return "\n".join(lines)


def update_body(existing_body: str, assets_section: str) -> str:
    body = existing_body.strip()
    if MANAGED_START in body and MANAGED_END in body:
        before, rest = body.split(MANAGED_START, 1)
        _, after = rest.split(MANAGED_END, 1)
        return f"{before.rstrip()}\n\n{assets_section}\n\n{after.lstrip()}".strip() + "\n"

    if not body:
        return assets_section + "\n"

    return f"{body}\n\n{assets_section}\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Render Rebecca release asset downloads and reports.")
    parser.add_argument("--repo", required=True, help="GitHub repository in owner/name form.")
    parser.add_argument("--tag", required=True, help="Release tag.")
    parser.add_argument("--existing-body-file", help="Existing release body to update in-place by marker.")
    args = parser.parse_args()

    assets_section = render_assets_section(args.repo, args.tag)
    if args.existing_body_file:
        existing_body = Path(args.existing_body_file).read_text(encoding="utf-8")
        print(update_body(existing_body, assets_section), end="")
    else:
        print(assets_section)


if __name__ == "__main__":
    main()
