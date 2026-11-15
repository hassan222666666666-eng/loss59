import { normalizeDigitsKeepSpaces } from '../../utils/arabicText';

export interface ParsedLineMath {
  hasExpression: boolean;
  expression: string;
  result: number | null;
  formattedResult: string;
}

type Token =
  | { type: 'num'; value: number }
  | { type: 'op'; value: '+' | '-' | '*' | '/' }
  | { type: 'lparen' }
  | { type: 'rparen' };

function tokenize(expr: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen' });
      i++;
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      let numStr = '';
      let dotCount = 0;
      while (
        i < expr.length &&
        ((expr[i] >= '0' && expr[i] <= '9') || expr[i] === '.')
      ) {
        if (expr[i] === '.') {
          dotCount++;
          if (dotCount > 1) return null;
        }
        numStr += expr[i];
        i++;
      }
      if (numStr === '.' || numStr.endsWith('.')) return null;
      // Disallow extra leading zeros like 00 or 05 (0.5 is valid)
      if (/^0\d/.test(numStr)) return null;
      const num = Number(numStr);
      if (!Number.isFinite(num)) return null;
      tokens.push({ type: 'num', value: num });
      continue;
    }
    return null;
  }
  return tokens;
}

/**
 * Validates strict operator sequence rules:
 * - No operator at start except unary '-'
 * - No operator directly after '(' except unary '-'
 * - Unary '-' allowed only at start, after '(', or after '*'/'/'
 * - No stacked binary operators (e.g. '++', '+*', '-+', '--')
 * - Balanced parentheses, non-empty parens
 */
function hasValidTokenGrammar(tokens: Token[]): boolean {
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const prev = i > 0 ? tokens[i - 1] : null;

    if (tok.type === 'lparen') {
      // Disallow implicit paren directly after num or ')'
      if (prev && (prev.type === 'num' || prev.type === 'rparen')) {
        return false;
      }
      depth++;
    } else if (tok.type === 'rparen') {
      depth--;
      if (depth < 0) return false;
      // Disallow empty '()' or trailing operator before ')'
      if (!prev || prev.type === 'lparen' || prev.type === 'op') {
        return false;
      }
    } else if (tok.type === 'num') {
      if (prev && prev.type === 'rparen') return false;
    } else if (tok.type === 'op') {
      if (!prev || prev.type === 'lparen') {
        // Start or after '(' -> only unary '-' allowed
        if (tok.value !== '-') return false;
      } else if (prev.type === 'op') {
        // Op after op -> only '-' allowed right after '*' or '/'
        if (tok.value !== '-' || (prev.value !== '*' && prev.value !== '/')) {
          return false;
        }
      }
    }
  }
  if (depth !== 0) return false;
  const last = tokens[tokens.length - 1];
  if (!last || last.type === 'op' || last.type === 'lparen') return false;
  return true;
}

/**
 * Safe recursive-descent arithmetic evaluator (NO eval, NO Function).
 */
export function evaluateSafeMathExpression(rawInput: string): number | null {
  const normalized = normalizeDigitsKeepSpaces(rawInput)
    .replace(/[×xX]/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/=\s*$/, '')
    .trim();

  if (!normalized) return null;

  // Reject standard date formats (YYYY-MM-DD, DD/MM/YYYY, etc.)
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(normalized)) return null;
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(normalized)) return null;

  const tokens = tokenize(normalized);
  if (!tokens || tokens.length === 0) return null;
  if (!hasValidTokenGrammar(tokens)) return null;

  // Must contain at least one binary arithmetic operator so plain numbers don't show '= num'
  const hasBinaryOp = tokens.some(
    (t, idx) =>
      t.type === 'op' &&
      idx > 0 &&
      tokens[idx - 1].type !== 'lparen' &&
      tokens[idx - 1].type !== 'op'
  );
  if (!hasBinaryOp) return null;

  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];
  const consume = (): Token | undefined => tokens[pos++];

  const parseExpression = (): number | null => {
    let left = parseTerm();
    if (left === null) return null;

    while (true) {
      const next = peek();
      if (next && next.type === 'op' && (next.value === '+' || next.value === '-')) {
        consume();
        const right = parseTerm();
        if (right === null) return null;
        left = next.value === '+' ? left + right : left - right;
      } else {
        break;
      }
    }
    return left;
  };

  const parseTerm = (): number | null => {
    let left = parseFactor();
    if (left === null) return null;

    while (true) {
      const next = peek();
      if (next && next.type === 'op' && (next.value === '*' || next.value === '/')) {
        consume();
        const right = parseFactor();
        if (right === null) return null;
        if (next.value === '/') {
          if (right === 0) return null;
          left = left / right;
        } else {
          left = left * right;
        }
      } else {
        break;
      }
    }
    return left;
  };

  const parseFactor = (): number | null => {
    const next = peek();
    if (!next) return null;

    if (next.type === 'op' && next.value === '-') {
      consume();
      const inner = parseFactor();
      if (inner === null) return null;
      return -inner;
    }

    if (next.type === 'num') {
      consume();
      return next.value;
    }

    if (next.type === 'lparen') {
      consume();
      const inner = parseExpression();
      if (inner === null) return null;
      const closing = consume();
      if (!closing || closing.type !== 'rparen') return null;
      return inner;
    }

    return null;
  };

  const value = parseExpression();
  if (value === null || pos !== tokens.length || !Number.isFinite(value)) {
    return null;
  }

  return Math.round(value * 1000000) / 1000000;
}

export function formatMathNumber(value: number): string {
  const rounded = Math.round(value * 10000) / 10000;
  if (Object.is(rounded, -0)) return '0';
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/**
 * Parses a note line: supports both pure expressions ("6 * 12")
 * and labeled lines ("حليب 6 * 12" or "كرتون: (4 + 2) * 6").
 * Ignores invalid or incomplete expressions silently.
 */
export function parseNoteLineMath(line: string): ParsedLineMath {
  const trimmed = line.trim();
  if (!trimmed) {
    return { hasExpression: false, expression: '', result: null, formattedResult: '' };
  }

  const normalized = normalizeDigitsKeepSpaces(trimmed);

  // First try the full line
  const direct = evaluateSafeMathExpression(normalized);
  if (direct !== null) {
    return {
      hasExpression: true,
      expression: trimmed,
      result: direct,
      formattedResult: formatMathNumber(direct),
    };
  }

  // Otherwise try a trailing math expression after a Arabic/label separator (space or colon)
  // Carefully ensure we don't salvage part of a malformed double-operator expression like "5 + + 2"
  const spaceIdx = normalized.search(/(?:[^\d.+\-*/×xX÷()\s])\s*[(-\d]/);
  if (spaceIdx >= 0) {
    // Find the first candidate arithmetic start after label text
    const candidateStartMatch = normalized.match(
      /^[^\n]*?[\u0600-\u06FFa-zA-Z:؛]\s+([(+-]?\s*[\d.+\-*/×xX÷()\s]+)=?$/
    );
    if (candidateStartMatch && candidateStartMatch[1]) {
      const expr = candidateStartMatch[1].trim();
      const val = evaluateSafeMathExpression(expr);
      if (val !== null) {
        return {
          hasExpression: true,
          expression: expr,
          result: val,
          formattedResult: formatMathNumber(val),
        };
      }
    }
  }

  return { hasExpression: false, expression: '', result: null, formattedResult: '' };
}

export function computeNoteTotal(body: string): {
  lines: ParsedLineMath[];
  total: number;
  hasAnyCalculated: boolean;
} {
  const rawLines = body.split('\n');
  const lines = rawLines.map((l) => parseNoteLineMath(l));
  let total = 0;
  let hasAnyCalculated = false;

  for (const item of lines) {
    if (item.hasExpression && item.result !== null) {
      total += item.result;
      hasAnyCalculated = true;
    }
  }

  return {
    lines,
    total: Math.round(total * 10000) / 10000,
    hasAnyCalculated,
  };
}

// ----------------- INTERACTIVE CALCULATOR KEYPAD STATE MACHINE -----------------

export interface CalculatorState {
  expression: string;
  justEvaluated: boolean;
}

const OP_CHARS = ['+', '-', '×', '÷'] as const;
const BINARY_NO_UNARY = ['+', '×', '÷'] as const;

function isOperatorChar(ch: string): boolean {
  return (OP_CHARS as readonly string[]).includes(ch);
}

function getCurrentNumberSegment(expr: string): string {
  let i = expr.length - 1;
  while (i >= 0 && ((expr[i] >= '0' && expr[i] <= '9') || expr[i] === '.')) {
    i--;
  }
  return expr.slice(i + 1);
}

function getOpenParenCount(expr: string): number {
  let open = 0;
  for (const ch of expr) {
    if (ch === '(') open++;
    else if (ch === ')') open--;
  }
  return open;
}

/**
 * Applies a keypad press enforcing strict calculator rules:
 * - Operator (+ - × ÷) after another operator replaces the last operator
 *   (except '-' is allowed after ×, ÷, '(', or at the start for negative numbers).
 * - No operator at start (except '-'), none right after '(' (except '-').
 * - No two decimal points in the same number; no extra leading zeros (e.g. '00' or '05').
 * - No ')' without matching '('.
 * - Pressing '=' turns the result into the new starting number; pressing an operator
 *   right after '=' continues from that result.
 */
export function applyCalculatorKey(
  state: CalculatorState,
  key: string
): CalculatorState {
  const expr = state.expression;

  if (key === 'C') {
    return { expression: '', justEvaluated: false };
  }

  if (key === '⌫') {
    return {
      expression: expr.slice(0, -1),
      justEvaluated: false,
    };
  }

  if (key === '=') {
    const val = evaluateSafeMathExpression(expr);
    if (val === null) return state;
    return {
      expression: formatMathNumber(val),
      justEvaluated: true,
    };
  }

  // Operators: +, -, ×, ÷
  if (isOperatorChar(key)) {
    const base = state.justEvaluated ? expr : expr;

    // Empty expression: only '-' allowed at start
    if (base.length === 0) {
      return key === '-'
        ? { expression: '-', justEvaluated: false }
        : { expression: '', justEvaluated: false };
    }

    const last = base[base.length - 1];
    const prevToLast = base.length >= 2 ? base[base.length - 2] : '';

    // Directly after '(': only '-' allowed for negative number
    if (last === '(') {
      return key === '-'
        ? { expression: `${base}-`, justEvaluated: false }
        : { expression: base, justEvaluated: false };
    }

    // Directly after decimal point without trailing digit: append 0 first or ignore? Better trim trailing '.' if op pressed or wait: ignore until digit? Actually replace trailing '.' or ignore: let's trim dangling '.' so '5.' + '+' -> '5+'!
    if (last === '.') {
      const cleaned = base.slice(0, -1);
      if (!cleaned) return state;
      return applyCalculatorKey({ expression: cleaned, justEvaluated: false }, key);
    }

    // If base is just unary '-' at start or '(-' and user presses '+'/'×'/'÷', ignore (no operator at start / after '(' except minus)
    if (last === '-' && (base.length === 1 || prevToLast === '(')) {
      return { expression: base, justEvaluated: false };
    }

    // If base ends with '[×÷]-' (binary op followed by unary minus):
    if (last === '-' && (prevToLast === '×' || prevToLast === '÷')) {
      if (key === '-') {
        // Already ends with unary minus, do not stack '--'
        return { expression: base, justEvaluated: false };
      }
      // Pressing + / × / ÷ replaces the whole '[×÷]-' pair with the new operator
      return {
        expression: `${base.slice(0, -2)}${key}`,
        justEvaluated: false,
      };
    }

    // If base ends with another operator (+, -, ×, ÷):
    if (isOperatorChar(last)) {
      if (key === '-' && (last === '×' || last === '÷')) {
        // Allow minus sign after × or ÷
        return { expression: `${base}-`, justEvaluated: false };
      }
      // Replace last operator with the new one
      return {
        expression: `${base.slice(0, -1)}${key}`,
        justEvaluated: false,
      };
    }

    return {
      expression: `${base}${key}`,
      justEvaluated: false,
    };
  }

  // Opening parenthesis '('
  if (key === '(') {
    if (state.justEvaluated) {
      return { expression: '(', justEvaluated: false };
    }
    const last = expr[expr.length - 1];
    if (!last || last === '(' || isOperatorChar(last)) {
      return { expression: `${expr}(`, justEvaluated: false };
    }
    if ((last >= '0' && last <= '9') || last === ')') {
      return { expression: `${expr}×(`, justEvaluated: false };
    }
    return state;
  }

  // Closing parenthesis ')'
  if (key === ')') {
    if (getOpenParenCount(expr) <= 0) return state;
    const last = expr[expr.length - 1];
    if (!last || last === '(' || isOperatorChar(last) || last === '.') {
      return state;
    }
    return { expression: `${expr})`, justEvaluated: false };
  }

  // Decimal point '.'
  if (key === '.') {
    const base = state.justEvaluated ? '' : expr;
    const last = base[base.length - 1];
    if (last === ')') return state;
    const currentNum = getCurrentNumberSegment(base);
    if (currentNum.includes('.')) {
      // Disallow two decimal points in the same number
      return state;
    }
    if (currentNum === '') {
      return { expression: `${base}0.`, justEvaluated: false };
    }
    return { expression: `${base}.`, justEvaluated: false };
  }

  // Digits '0'..'9'
  if (/^[0-9]$/.test(key)) {
    const base = state.justEvaluated ? '' : expr;
    const last = base[base.length - 1];
    if (last === ')') {
      return { expression: `${base}×${key}`, justEvaluated: false };
    }
    const currentNum = getCurrentNumberSegment(base);
    if (currentNum === '0') {
      // Prevent extra leading zeros (e.g. '00' or '05')
      if (key === '0') {
        return { expression: base, justEvaluated: false };
      }
      return {
        expression: `${base.slice(0, -1)}${key}`,
        justEvaluated: false,
      };
    }
    return { expression: `${base}${key}`, justEvaluated: false };
  }

  // Avoid unused lint on BINARY_NO_UNARY if referenced or remove it
  void BINARY_NO_UNARY;
  return state;
}

export function getCalculatorLiveResult(state: CalculatorState): number | null {
  if (!state.expression || state.justEvaluated) return null;
  return evaluateSafeMathExpression(state.expression);
}
