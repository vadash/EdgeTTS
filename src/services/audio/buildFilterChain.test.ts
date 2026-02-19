import { describe, it, expect } from 'vitest';
import { buildFilterChain } from './buildFilterChain';

describe('buildFilterChain', () => {
  const allOff = {
    silenceRemoval: false,
    normalization: false,
    deEss: false,
    silenceGapMs: 0,
    eq: false,
    compressor: false,
    fadeIn: false,
    stereoWidth: false,
  };

  it('returns empty string when all filters disabled', () => {
    expect(buildFilterChain(allOff)).toBe('');
  });

  it('includes EQ filters when eq enabled', () => {
    const chain = buildFilterChain({ ...allOff, eq: true });
    expect(chain).toContain('highpass=f=60');
    expect(chain).toContain('lowshelf=f=120:g=2');
    expect(chain).toContain('equalizer=f=3000:t=q:w=1:g=-2');
  });

  it('includes deesser when deEss enabled', () => {
    const chain = buildFilterChain({ ...allOff, deEss: true });
    expect(chain).toContain('deesser=');
  });

  it('includes silenceremove when silenceRemoval enabled', () => {
    const chain = buildFilterChain({ ...allOff, silenceRemoval: true });
    expect(chain).toContain('silenceremove=');
  });

  it('includes compand when compressor enabled', () => {
    const chain = buildFilterChain({ ...allOff, compressor: true });
    expect(chain).toContain('compand=');
  });

  it('includes loudnorm and alimiter when normalization enabled', () => {
    const chain = buildFilterChain({ ...allOff, normalization: true });
    expect(chain).toContain('loudnorm=');
    expect(chain).toContain('alimiter=');
  });

  it('includes afade when fadeIn enabled', () => {
    const chain = buildFilterChain({ ...allOff, fadeIn: true });
    expect(chain).toContain('afade=t=in');
  });

  it('includes aecho when stereoWidth enabled', () => {
    const chain = buildFilterChain({ ...allOff, stereoWidth: true });
    expect(chain).toContain('aecho=');
  });

  it('chains multiple filters with commas', () => {
    const chain = buildFilterChain({ ...allOff, eq: true, deEss: true });
    expect(chain).toMatch(/highpass.*,.*deesser/);
  });
});
