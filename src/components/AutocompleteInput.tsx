import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { filterOptions, type AutocompleteOption } from '../lib/autocomplete.ts';
import { LineBadge } from './LineBadge.tsx';

interface AutocompleteInputProps {
  options: AutocompleteOption[];
  placeholder: string;
  onSelect: (id: number) => void;
  autoFocus?: boolean;
  maxResults?: number;
  /** 候補0件時の表示メッセージ。 */
  emptyMessage: string;
}

/**
 * テキスト入力＋ドロップダウン候補によるオートコンプリート入力。
 * 1文字以上（空白のみは不可）入力されて初めて候補を開き、filterOptions で絞り込む。
 * キーボード操作（↑↓・Enter・Esc）とマウス操作の双方に対応する。
 */
export function AutocompleteInput({
  options,
  placeholder,
  onSelect,
  autoFocus,
  maxResults = 50,
  emptyMessage,
}: AutocompleteInputProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  // 空（空白のみ含む）の間は候補を出さない。
  const hasQuery = query.trim() !== '';

  const results = useMemo(
    () => filterOptions(options, query, maxResults),
    [options, query, maxResults]
  );

  // 候補が変わったらハイライトをリセットする（範囲外を指さないように）。
  useEffect(() => {
    setHighlightIndex(-1);
  }, [results]);

  function commit(id: number) {
    onSelect(id);
    setQuery('');
    setOpen(false);
    setHighlightIndex(-1);
  }

  function handleFocus() {
    // 空入力ではフォーカスしても開かない（入力があるときのみ開く）。
    setOpen(hasQuery);
  }

  function handleBlur() {
    // マウスでの候補クリックは onMouseDown で先に確定させるため、
    // blur 時点では単純に閉じるだけでよい。
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!hasQuery) return;
      setOpen(true);
      if (results.length === 0) return;
      setHighlightIndex((prev) => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!hasQuery) return;
      setOpen(true);
      if (results.length === 0) return;
      setHighlightIndex((prev) => (prev <= 0 ? results.length - 1 : prev - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightIndex >= 0 && highlightIndex < results.length) {
        commit(results[highlightIndex].id);
      } else if (results.length === 1) {
        commit(results[0].id);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setHighlightIndex(-1);
    }
  }

  const activeDescendant =
    highlightIndex >= 0 && highlightIndex < results.length
      ? `${listId}-option-${highlightIndex}`
      : undefined;

  return (
    <div className="autocomplete">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open && hasQuery}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeDescendant}
        className="autocomplete-input"
        placeholder={placeholder}
        value={query}
        autoFocus={autoFocus}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={(e) => {
          setQuery(e.target.value);
          // 入力を全部消したら閉じる。
          setOpen(e.target.value.trim() !== '');
        }}
        onKeyDown={handleKeyDown}
      />
      {open && hasQuery && (
        <ul id={listId} role="listbox" className="autocomplete-list">
          {results.length === 0 ? (
            <li className="autocomplete-empty">{emptyMessage}</li>
          ) : (
            results.map((opt, i) => (
              <li
                key={opt.id}
                id={`${listId}-option-${i}`}
                role="option"
                aria-selected={i === highlightIndex}
                className={`autocomplete-option${i === highlightIndex ? ' highlighted' : ''}`}
                onMouseDown={(e) => {
                  // blur より先に確定させるため mousedown で処理する。
                  e.preventDefault();
                  commit(opt.id);
                }}
                onMouseEnter={() => setHighlightIndex(i)}
              >
                {opt.badge && (
                  <LineBadge
                    name={opt.badge.name}
                    company={opt.badge.company}
                    color={opt.badge.color}
                  />
                )}
                <span className="autocomplete-option-label">{opt.label}</span>
                {opt.note && <span className="autocomplete-option-note">{opt.note}</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
