import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/preact';
import { MarkdownContent } from './MarkdownContent';

describe('MarkdownContent', () => {
  it('renders block elements: headers, rule, lists, blank lines, paragraphs', () => {
    const { container } = render(
      <MarkdownContent
        text={'# One\n## Two\n### Three\n---\n- bullet\n1. numbered\n\nplain text'}
      />,
    );

    expect(container.querySelector('h2')?.textContent).toBe('One');
    expect(container.querySelector('h3')?.textContent).toBe('Two');
    expect(container.querySelector('h4')?.textContent).toBe('Three');
    expect(container.querySelector('hr')).toBeTruthy();
    expect(container.querySelector('li:not(.list-decimal)')?.textContent).toBe('bullet');
    expect(container.querySelector('li.list-decimal')?.textContent).toBe('numbered');
    expect(container.querySelectorAll('br')).toHaveLength(1);
    expect(container.querySelector('p')?.textContent).toBe('plain text');
  });

  it('renders inline bold, code spans, and links', () => {
    const { container } = render(
      <MarkdownContent text="**bold** and `code` plus [docs](https://example.com)" />,
    );

    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('code')?.textContent).toBe('code');
    const link = container.querySelector('a');
    expect(link?.textContent).toBe('docs');
    expect(link?.getAttribute('href')).toBe('https://example.com');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
