declare module 'preact-i18n' {
  import { ComponentChildren, FunctionalComponent } from 'preact';

  export interface IntlProviderProps {
    definition: Record<string, unknown>;
    children?: ComponentChildren;
  }

  export const IntlProvider: FunctionalComponent<IntlProviderProps>;

  export interface TextProps {
    id: string;
    children?: ComponentChildren;
    plural?: number;
    fields?: Record<string, string | number>;
  }

  export const Text: FunctionalComponent<TextProps>;

  export function useText(mapping: Record<string, string>): Record<string, string>;
}
