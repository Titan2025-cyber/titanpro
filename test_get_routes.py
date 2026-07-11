#!/usr/bin/env python3
import subprocess, json, sys

BASE = "http://127.0.0.1:5000"
TOK = open("/tmp/owner_tok.txt").read().strip()

# real ids present in clean DB
SUBST = {
    ":jobId": "1", ":id": "1", ":contactId": "6", ":name": "Cody Brantley",
    ":token": "x", ":tech": "John Eisenhower", ":techName": "John Eisenhower",
    ":state": "SC", ":key": "ramp", ":sessionId": "x",
}

routes = [r.strip() for r in open("/tmp/all_get_routes.txt") if r.strip()]

def curl(path):
    # substitute params
    p = path
    for k, v in SUBST.items():
        p = p.replace(k, v.replace(" ", "%20"))
    try:
        out = subprocess.run(
            ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
             "-H", f"Authorization: Bearer {TOK}", f"{BASE}{p}"],
            capture_output=True, text=True, timeout=25)
        return out.stdout.strip(), p
    except Exception as e:
        return f"ERR {e}", p

bad = []
ok = 0
for r in routes:
    code, actual = curl(r)
    if code.startswith("2") or code in ("304",):
        ok += 1
    else:
        bad.append((r, actual, code))

print(f"TESTED {len(routes)} GET routes | OK: {ok} | NON-2xx: {len(bad)}")
print("=" * 60)
for r, actual, code in bad:
    print(f"  [{code}] {r}   (tried {actual})")
