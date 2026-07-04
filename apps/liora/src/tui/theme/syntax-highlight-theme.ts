import chalk from 'chalk';
import type { Theme } from 'cli-highlight';

import { currentTheme } from './theme';
import type { ColorPalette } from './colors';
import type { ColorToken } from './theme';

const syntax = (palette: ColorPalette, token: ColorToken) => (text: string): string =>
  chalk.hex(palette[token])(text);

export function buildSyntaxHighlightTheme(palette: ColorPalette = currentTheme.palette): Theme {
  const text = syntax(palette, 'syntaxText');
  const keyword = syntax(palette, 'syntaxKeyword');
  const fn = syntax(palette, 'syntaxFunction');
  const type = syntax(palette, 'syntaxType');
  const string = syntax(palette, 'syntaxString');
  const number = syntax(palette, 'syntaxNumber');
  const comment = syntax(palette, 'syntaxComment');
  const operator = syntax(palette, 'syntaxOperator');
  const tag = syntax(palette, 'syntaxTag');
  const meta = syntax(palette, 'syntaxMeta');
  return {
    default: text,
    keyword,
    built_in: keyword,
    literal: number,
    number,
    regexp: string,
    string,
    subst: text,
    symbol: operator,
    class: type,
    type,
    function: fn,
    title: fn,
    params: text,
    comment,
    doctag: comment,
    meta,
    'meta-keyword': meta,
    'meta-string': string,
    section: type,
    tag,
    name: tag,
    'builtin-name': tag,
    attr: type,
    attribute: type,
    variable: text,
    bullet: operator,
    code: text,
    emphasis: (s) => chalk.hex(palette.syntaxText).italic(s),
    strong: (s) => chalk.hex(palette.syntaxText).bold(s),
    formula: text,
    link: syntax(palette, 'primary'),
    quote: comment,
    'selector-tag': tag,
    'selector-id': type,
    'selector-class': type,
    'selector-attr': type,
    'selector-pseudo': operator,
    'template-tag': tag,
    'template-variable': text,
    addition: syntax(palette, 'success'),
    deletion: syntax(palette, 'error'),
  };
}
