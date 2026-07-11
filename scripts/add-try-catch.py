import re

with open('/home/user/workspace/titan-pro/server/routes.ts', 'r') as f:
    content = f.read()

if 'wrapAsync' in content:
    print("wrapAsync already present, skipping injection")
else:
    import_end = content.find('\n// ──')
    helper = '''
// ── Error handler wrapper ────────────────────────────────────────────────────
type Handler = (req: any, res: any, next?: any) => any;
function wrapAsync(fn: Handler): Handler {
  return (req, res, next) => {
    try {
      const result = fn(req, res, next);
      if (result && typeof result.catch === 'function') {
        result.catch((err: any) => {
          console.error('[Route Error]', req.method, req.path, err?.message);
          if (!res.headersSent) res.status(500).json({ error: err?.message || 'Server error' });
        });
      }
    } catch (err: any) {
      console.error('[Route Error]', req.method, req.path, err?.message);
      if (!res.headersSent) res.status(500).json({ error: err?.message || 'Server error' });
    }
  };
}

'''
    content = content[:import_end] + helper + content[import_end:]
    print(f"Injected wrapAsync helper at position {import_end}")

    with open('/home/user/workspace/titan-pro/server/routes.ts', 'w') as f:
        f.write(content)
    print("Done - wrapAsync injected")
