import { describe, expect, it } from 'vitest';
import { buildFilterChain } from './buildFilterChain';

describe('buildFilterChain', () => {
  const allOff = {
    silenceRemoval: false,
    normalization: false,
    deEss: false,
    silenceGapMs: 100,
    eq: false,
    compressor: false,
    fadeIn: false,
  };

  it('returns empty string when all filters disabled', () => {
    expect(buildFilterChain(allOff)).toBe('');
  });

  it('includes EQ filters when eq enabled', () => {
    const chain = buildFilterChain({ ...allOff, eq: true });
    expect(chain).toContain('highpass=f=80');
    expect(chain).toContain('equalizer=f=6000:t=q:w=2.5:g=-2');
    expect(chain).toContain('lowpass=f=11000');
    // lowpass sits immediately after the equalizer entry, inside the EQ block
    expect(chain).toMatch(/equalizer=f=6000:t=q:w=2\.5:g=-2,lowpass=f=11000/);
  });

  it('keeps lowpass before afade when both eq and fadeIn are on', () => {
    const chain = buildFilterChain({ ...allOff, eq: true, fadeIn: true });
    expect(chain.indexOf('lowpass')).toBeLessThan(chain.indexOf('afade'));
  });

  it('includes deesser when deEss enabled', () => {
    const chain = buildFilterChain({ ...allOff, deEss: true });
    expect(chain).toContain('deesser=');
  });

  it('includes silenceremove when silenceRemoval enabled', () => {
    const chain = buildFilterChain({ ...allOff, silenceRemoval: true });
    expect(chain).toContain('silenceremove=');
  });

  it('clamps stop_silence to the inter-chunk gap', () => {
    // gap above the default floor → emits the gap value
    const big = buildFilterChain({ ...allOff, silenceRemoval: true, silenceGapMs: 500 });
    expect(big).toContain('stop_silence=0.5');
    // gap below the default floor (0.3) → floor wins
    const small = buildFilterChain({ ...allOff, silenceRemoval: true, silenceGapMs: 100 });
    expect(small).toContain('stop_silence=0.3');
  });

  it('includes acompressor when compressor enabled', () => {
    const chain = buildFilterChain({ ...allOff, compressor: true });
    expect(chain).toContain('acompressor=');
    expect(chain).toContain('threshold=0.12589');
    expect(chain).toContain('ratio=3');
  });

  it('includes loudnorm when normalization enabled', () => {
    const chain = buildFilterChain({ ...allOff, normalization: true });
    expect(chain).toContain('loudnorm=');
  });

  it('includes afade when fadeIn enabled', () => {
    const chain = buildFilterChain({ ...allOff, fadeIn: true });
    expect(chain).toContain('afade=t=in');
  });

  it('chains multiple filters with commas', () => {
    const chain = buildFilterChain({ ...allOff, eq: true, deEss: true });
    expect(chain).toMatch(/highpass.*,.*deesser/);
  });

  it('emits the default chain in the correct order', () => {
    const chain = buildFilterChain({
      silenceRemoval: true,
      normalization: true,
      deEss: true,
      eq: false,
      compressor: false,
      fadeIn: true,
      silenceGapMs: 100,
    });
    expect(chain).toMatch(/^deesser=.*silenceremove=.*loudnorm=.*afade=t=in:ss=0:d=0\.1$/);
  });
});
