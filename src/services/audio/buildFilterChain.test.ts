import { describe, expect, it } from 'vitest';
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
  };

  it('returns empty string when all filters disabled', () => {
    expect(buildFilterChain(allOff)).toBe('');
  });

  it('includes EQ filters when eq enabled', () => {
    const chain = buildFilterChain({ ...allOff, eq: true });
    expect(chain).toContain('highpass=f=60');
    expect(chain).toContain('equalizer=f=6000:t=q:w=2.5:g=-2');
    expect(chain).toContain('lowpass=f=11000');
  });

  it('includes deesser when deEss enabled', () => {
    const chain = buildFilterChain({ ...allOff, deEss: true });
    expect(chain).toContain('deesser=');
  });

  it('includes silenceremove when silenceRemoval enabled', () => {
    const chain = buildFilterChain({ ...allOff, silenceRemoval: true });
    expect(chain).toContain('silenceremove=');
  });

  it('includes acompressor when compressor enabled', () => {
    const chain = buildFilterChain({ ...allOff, compressor: true });
    expect(chain).toContain('acompressor=');
    expect(chain).toContain('threshold=0.12589');
    expect(chain).toContain('ratio=4');
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

  it('chains multiple filters with commas', () => {
    const chain = buildFilterChain({ ...allOff, eq: true, deEss: true });
    expect(chain).toMatch(/highpass.*,.*deesser/);
  });
});
