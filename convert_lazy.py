import re

path = "client/src/App.tsx"
with open(path) as f:
    src = f.read()

lines = src.split("\n")

# Keep these page imports STATIC (needed immediately or tiny/frequent)
KEEP_STATIC = {"Login", "not-found"}

new_lines = []
lazy_names = []
has_react_import = any("import React" in l or "import * as React" in l for l in lines)

for line in lines:
    m = re.match(r'import (\w+) from "@/pages/([\w\-/]+)";', line)
    if m:
        comp = m.group(1)
        modpath = m.group(2)
        if modpath in KEEP_STATIC or comp in KEEP_STATIC:
            new_lines.append(line)  # keep static
        else:
            lazy_names.append((comp, modpath))
            # replaced by lazy declaration later; drop the static import
            continue
    else:
        new_lines.append(line)

# Build lazy declarations block
lazy_block = ["", "// Lazy-loaded pages (code-split — each page downloads only when visited)"]
for comp, modpath in lazy_names:
    lazy_block.append(f'const {comp} = lazy(() => import("@/pages/{modpath}"));')
lazy_block.append("")

# Insert React lazy/Suspense import at top
out = "\n".join(new_lines)

# Add lazy/Suspense import after the first import line
if "lazy" not in out.split("function Page")[0]:
    out = out.replace(
        'import { Switch, Route, Router } from "wouter";',
        'import { Switch, Route, Router } from "wouter";\nimport { lazy, Suspense } from "react";',
        1,
    )

# Insert the lazy declarations block right before "function Page("
out = out.replace("function Page(", "\n".join(lazy_block) + "\nfunction Page(", 1)

with open(path, "w") as f:
    f.write(out)

print(f"Converted {len(lazy_names)} pages to lazy. Kept static: {[n for n,_ in [] ]}")
print("Kept static imports for:", KEEP_STATIC)
