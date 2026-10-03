"""Replace only the parking app's known location blocks; preserve all other apps."""
from pathlib import Path
import re
import sys

LOCATION = re.compile(
    r"(?m)^[ \t]*location (?:= /smartParking(?:/index\.html)?|\^~ /smartParking/|"
    r"= /smartCockpit/api/parking-agent/stream)\s*\{"
)

def update(routes: str, snippet: str) -> str:
    # The production host still ships Python 3.6; avoid assignment expressions.
    while True:
        match = LOCATION.search(routes)
        if match is None:
            break
        depth, end = 1, match.end()
        while end < len(routes) and depth:
            if routes[end] == "{": depth += 1
            elif routes[end] == "}": depth -= 1
            end += 1
        if depth:
            raise ValueError("Unbalanced Nginx location; refusing partial replacement")
        routes = routes[:match.start()] + routes[end:]
    routes = re.sub(r"(?m)^[ \t]*# (?:end-)?smart-parking-static-app\s*$", "", routes)
    return routes.rstrip() + "\n\n" + snippet.strip("\n") + "\n"

if __name__ == "__main__":
    routes, snippet = map(Path, sys.argv[1:3])
    routes.write_text(update(routes.read_text(encoding="utf-8"), snippet.read_text(encoding="utf-8")), encoding="utf-8")
