import { describe, expect, it } from 'vitest';
import { cn, formatMoney, formatPercent, parseMoneyInput, renderMarkdown } from '../../src/index';

describe('ui helpers', () => {
  it('formats money in minor units', () => {
    expect(formatMoney(12345, 'USD')).toBe('$123.45');
    expect(formatMoney(null)).toBe('—');
  });

  it('parses money input into cents', () => {
    expect(parseMoneyInput('19.99')).toBe(1999);
    expect(parseMoneyInput('19,9')).toBe(1990);
    expect(parseMoneyInput('abc')).toBeNull();
  });

  it('renders a safe markdown subset', () => {
    const html = renderMarkdown('# Title\n\n**bold** <script>x</script>\n\n- a\n- b');
    expect(html).toContain('<h3>Title</h3>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<ul><li>a</li><li>b</li></ul>');
  });

  it('joins class names', () => {
    expect(cn('a', false, 'b', null)).toBe('a b');
    expect(formatPercent(12.345)).toBe('+12.3%');
  });
});
