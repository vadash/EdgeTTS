import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/preact';
import { ProgressBar } from './ProgressBar';

describe('ProgressBar', () => {
  it('renders null when total is 0', () => {
    const { container } = render(<ProgressBar current={0} total={0} />);
    expect(container.firstChild).toBe(null);
  });

  it('renders current / total with percentage', () => {
    const { container } = render(<ProgressBar current={50} total={100} />);
    expect(container.textContent).toContain('50%');
    expect(container.textContent).toContain('50');
  });

  it('renders done count in green', () => {
    const { container } = render(<ProgressBar current={50} total={100} failed={0} />);
    expect(container.innerHTML).toContain('text-green-400');
    expect(container.textContent).toContain('50');
  });

  it('renders failed count in red when failed > 0', () => {
    const { container } = render(<ProgressBar current={60} total={100} failed={10} />);
    expect(container.innerHTML).toContain('text-red-400');
    expect(container.textContent).toContain('10');
  });

  it('does not render failed section when failed is 0', () => {
    const { container } = render(<ProgressBar current={50} total={100} failed={0} />);
    expect(container.innerHTML).not.toContain('text-red-400');
  });

  it('renders remaining count in gray', () => {
    const { container } = render(<ProgressBar current={60} total={100} failed={10} />);
    expect(container.innerHTML).toContain('text-gray-400');
    // remaining = 100 - 60 - 10 = 30
    expect(container.textContent).toContain('30');
  });

  it('renders ETA when provided', () => {
    const { container } = render(<ProgressBar current={50} total={100} eta="00:05:00" />);
    expect(container.textContent).toContain('00:05:00');
  });

  it('does not render ETA when absent', () => {
    const { container } = render(<ProgressBar current={50} total={100} />);
    expect(container.textContent).not.toContain('ETA');
  });
});
