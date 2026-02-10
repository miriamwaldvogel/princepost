#!/usr/bin/env python3
"""
Add or update a template in templates.json and optionally copy a thumbnail image.
Run from the project root: python add_template.py
"""

import json
import os
import shutil
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
TEMPLATES_JSON = SCRIPT_DIR / "templates.json"


def prompt(text, default=None):
    if default is not None:
        s = input(f"{text} [{default}]: ").strip()
        return s if s else default
    while True:
        s = input(f"{text}: ").strip()
        if s:
            return s


def prompt_int(text, default=None, allow_empty=False):
    while True:
        s = input(f"{text} [{default}] (leave empty to omit): " if default is not None else f"{text} (leave empty to omit): ").strip()
        if not s:
            if allow_empty or default is not None:
                return default
            continue
        try:
            return int(s)
        except ValueError:
            print("  Enter a number.")


def main():
    print("Add or update a template in templates.json\n")

    name = prompt("Template name (exact display name)")
    if not name:
        print("Name is required.")
        return 1

    type_choice = prompt("Type", "slide").lower()
    if type_choice not in ("slide", "cover"):
        type_choice = "slide"
    template_type = type_choice

    if template_type == "slide":
        section = "all"
        structure_str = prompt("Structure (comma-separated layer names)", "Quote 1")
        structure = [s.strip() for s in structure_str.split(",") if s.strip()]
        if not structure:
            structure = ["Quote 1"]
    else:
        section = prompt("Section (all or opinion. Only relevant for covers)", "opinion")
        structure = None

    max_font = prompt_int("maxFont", 80)
    if max_font is None:
        print("maxFont is required.")
        return 1

    print("For nameFont/positionFont: enter 0 if this template has no name/position fields.")
    name_font = prompt_int("nameFont", 60, allow_empty=True)
    position_font = prompt_int("positionFont", 50, allow_empty=True)
    if name_font is None:
        name_font = 0
    if position_font is None:
        position_font = 0

    bg_choice = prompt("Background image? (y/n)", "n").strip().lower()
    background_image = bg_choice in ("y", "yes", "true", "1")

    # Build entry
    entry = {
        "type": template_type,
        "section": section,
        "maxFont": max_font,
        "nameFont": name_font,
        "positionFont": position_font,
        "backgroundImage": background_image,
    }
    if structure is not None:
        entry["structure"] = structure

    # Load, update, write
    if not TEMPLATES_JSON.exists():
        data = {}
    else:
        with open(TEMPLATES_JSON, "r", encoding="utf-8") as f:
            data = json.load(f)

    data[name] = entry

    with open(TEMPLATES_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")

    print(f"\nUpdated templates.json with template \"{name}\".")
    return 0


if __name__ == "__main__":
    exit(main())
