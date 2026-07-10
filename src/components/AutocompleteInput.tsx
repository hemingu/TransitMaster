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
 * フォーカスで開き、入力に応じて filterOptions で絞り込む。
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
    setOpen(true);
  }

  function handleBlur() {
    // マウスでの候補クリックは onMouseDown で先に確定させるため、
    // blur 時点では単純に閉じるだけでよい。
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      if (results.length === 0) return;
      setHighlightIndex((prev) => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
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
        aria-expanded={open}
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
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
      />
      {open && (
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
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
