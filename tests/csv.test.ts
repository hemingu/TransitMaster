import { describe, expect, it } from 'vitest';
import { parseCsv } from '../scripts/csv.ts';

describe('parseCsv', () => {
  it('先頭の BOM を除去してパースする', () => {
    const text = '﻿a,b\n1,2\n';
    expect(parseCsv(text)).toEqual([{ a: '1', b: '2' }]);
  });

  it('CRLF 改行を扱える', () => {
    const text = 'a,b\r\n1,2\r\n3,4\r\n';
    expect(parseCsv(text)).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('LF 改行を扱える', () => {
    const text = 'a,b\n1,2\n3,4\n';
    expect(parseCsv(text)).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('ダブルクオートで囲まれたフィールド（カンマ・改行・""エスケープを含む）を扱える', () => {
    const text = 'a,b\n"1,1","line1\nline2"\n"say ""hi""",normal\n';
    expect(parseCsv(text)).toEqual([
      { a: '1,1', b: 'line1\nline2' },
      { a: 'say "hi"', b: 'normal' },
    ]);
  });

  it('空行を無視する', () => {
    const text = 'a,b\n1,2\n\n3,4\n';
    expect(parseCsv(text)).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('末尾に改行が無いレコードも取り込む', () => {
    const text = 'a,b\n1,2\n3,4';
    expect(parseCsv(text)).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('各値の前後の空白を trim する', () => {
    const text = 'a,b\n  1  , 2 \n';
    expect(parseCsv(text)).toEqual([{ a: '1', b: '2' }]);
  });

  it('ヘッダのみ・データ行なしの場合は空配列を返す', () => {
    const text = 'a,b\n';
    expect(parseCsv(text)).toEqual([]);
  });

  it('空文字列の場合は空配列を返す', () => {
    expect(parseCsv('')).toEqual([]);
  });
});
