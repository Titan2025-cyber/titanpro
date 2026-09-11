/**
 * mathExpr.ts — tiny safe arithmetic evaluator for estimate/invoice inputs.
 *
 * Field techs and estimators live in "3 rooms × 4 walls × 8 ft" math all
 * day; forcing them to compute in their head or reach for a calculator is
 * friction. This lets them type `3*4*8`, `12/2`, `1+2+5`, `(4+6)*3`, or
 * even Xactimate-style `12x8` into any qty/price field. On blur, we evaluate
 * and write back the numeric result.
 *
 * SAFE — no eval(). Recursive-descent parser over +, -, *, /, x, X,
 * parentheses, decimals, and unary +/-. Anything that isn't a valid
 * expression returns null so the caller can fall back to the raw string
 * (or leave the field untouched).
 *
 * Not a general-purpose calculator: no power, no functions, no variables.
 * Deliberately narrow — a stray character means "this isn't an expression,
 * treat it as a literal number if possible or leave it alone."
 *
 * Examples:
 *   evalExpr("1*5")       -> 5
 *   evalExpr("10 x 3")    -> 30
 *   evalExpr("2+3.5")     -> 5.5
 *   evalExpr("(1+2)*3")   -> 9
 *   evalExpr("12/0")      -> null  (division by zero)
 *   evalExpr("hello")     -> null
 *   evalExpr("5")         -> 5     (bare number is fine)
 *   evalExpr("")          -> null
 */

type Token =
  | { t: "num"; v: number }
  | { t: "op"; v: "+" | "-" | "*" | "/" }
  | { t: "lp" }
  | { t: "rp" };

function tokenize(input: string): Token[] | null {
  const s = input.replace(/\s+/g, "").replace(/[xX×]/g, "*");
  if (!s) return null;
  const tokens: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c >= "0" && c <= "9" || c === ".") {
      let j = i;
      let sawDot = c === ".";
      j++;
      while (j < s.length) {
        const cj = s[j];
        if (cj >= "0" && cj <= "9") { j++; continue; }
        if (cj === "." && !sawDot) { sawDot = true; j++; continue; }
        break;
      }
      const n = Number(s.slice(i, j));
      if (!Number.isFinite(n)) return null;
      tokens.push({ t: "num", v: n });
      i = j;
    } else if (c === "+" || c === "-" || c === "*" || c === "/") {
      tokens.push({ t: "op", v: c });
      i++;
    } else if (c === "(") {
      tokens.push({ t: "lp" });
      i++;
    } else if (c === ")") {
      tokens.push({ t: "rp" });
      i++;
    } else {
      // Any other character means "not an expression"
      return null;
    }
  }
  return tokens;
}

// Recursive-descent parser: expr = term (('+' | '-') term)*
//                           term = factor (('*' | '/') factor)*
//                           factor = ('+' | '-') factor | NUMBER | '(' expr ')'
class Parser {
  private i = 0;
  constructor(private tokens: Token[]) {}

  private peek(): Token | undefined { return this.tokens[this.i]; }
  private consume(): Token { return this.tokens[this.i++]; }

  parse(): number | null {
    const v = this.expr();
    if (v === null) return null;
    if (this.i !== this.tokens.length) return null; // trailing junk
    return v;
  }

  private expr(): number | null {
    let left = this.term();
    if (left === null) return null;
    while (true) {
      const t = this.peek();
      if (t?.t === "op" && (t.v === "+" || t.v === "-")) {
        this.consume();
        const right = this.term();
        if (right === null) return null;
        left = t.v === "+" ? left + right : left - right;
      } else break;
    }
    return left;
  }

  private term(): number | null {
    let left = this.factor();
    if (left === null) return null;
    while (true) {
      const t = this.peek();
      if (t?.t === "op" && (t.v === "*" || t.v === "/")) {
        this.consume();
        const right = this.factor();
        if (right === null) return null;
        if (t.v === "/" && right === 0) return null; // divide by zero
        left = t.v === "*" ? left * right : left / right;
      } else break;
    }
    return left;
  }

  private factor(): number | null {
    const t = this.peek();
    if (!t) return null;
    if (t.t === "op" && (t.v === "+" || t.v === "-")) {
      this.consume();
      const inner = this.factor();
      if (inner === null) return null;
      return t.v === "-" ? -inner : inner;
    }
    if (t.t === "num") {
      this.consume();
      return t.v;
    }
    if (t.t === "lp") {
      this.consume();
      const inner = this.expr();
      if (inner === null) return null;
      if (this.peek()?.t !== "rp") return null;
      this.consume();
      return inner;
    }
    return null;
  }
}

/**
 * Evaluate an arithmetic expression string. Returns the numeric result
 * or null if the input isn't a valid expression.
 *
 * Rounds to 4 decimal places to avoid floating-point display artifacts
 * (0.1 + 0.2 → 0.3, not 0.30000000000000004).
 */
export function evalExpr(input: string): number | null {
  if (typeof input !== "string") return null;
  const tokens = tokenize(input);
  if (!tokens) return null;
  const result = new Parser(tokens).parse();
  if (result === null || !Number.isFinite(result)) return null;
  return Math.round(result * 10000) / 10000;
}

/**
 * Convenience wrapper for input onBlur handlers. Given the raw string
 * from an input, returns the string form of the evaluated result (or the
 * original string if it wasn't an expression, so the field stays as the
 * user typed it — e.g. an empty string stays empty).
 */
export function normalizeExprInput(raw: string): string {
  const r = evalExpr(raw);
  if (r === null) return raw;
  return String(r);
}

/**
 * Detects whether a string contains operator characters that make it
 * an "expression" rather than a plain number. Useful when you want to
 * show a hint or style the input differently while the user is typing.
 */
export function looksLikeExpr(raw: string): boolean {
  return /[+\-*/xX×()]/.test(raw);
}
