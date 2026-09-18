import { describe, expect, it } from 'vitest';
import { minimalSignupSchema } from '@/lib/actions/onboarding-name';

describe('minimalSignupSchema', () => {
  it('accepts an ordinary name', () => {
    const result = minimalSignupSchema.safeParse({ displayName: 'Priya' });
    expect(result.success).toBe(true);
  });

  it('trims surrounding whitespace', () => {
    const result = minimalSignupSchema.safeParse({ displayName: '  Priya  ' });
    expect(result.success && result.data.displayName).toBe('Priya');
  });

  it('rejects an empty string', () => {
    expect(minimalSignupSchema.safeParse({ displayName: '' }).success).toBe(false);
  });

  it('rejects whitespace-only input, not just a literal empty string', () => {
    // A pasted string of spaces passes an HTML `required` attribute but
    // should not pass here - trim runs before the length check.
    expect(minimalSignupSchema.safeParse({ displayName: '   ' }).success).toBe(false);
  });

  it('rejects a name longer than 80 characters', () => {
    const tooLong = 'a'.repeat(81);
    expect(minimalSignupSchema.safeParse({ displayName: tooLong }).success).toBe(false);
  });

  it('accepts exactly 80 characters', () => {
    const atLimit = 'a'.repeat(80);
    expect(minimalSignupSchema.safeParse({ displayName: atLimit }).success).toBe(true);
  });
});
