import { useEffect, useRef, useState } from 'react';
import type { EmoteId } from '@engine/types';
import { EMOTE_GLYPHS } from './geometry';
import { sfx } from './platform';

const EMOTE_LIST: { id: EmoteId; label: string }[] = [
  { id: 'dice', label: 'Lucky roll' },
  { id: 'ladder', label: 'Climbing up' },
  { id: 'snake', label: 'Watch out, snake!' },
  { id: 'laugh', label: 'Laugh' },
  { id: 'fire', label: 'On fire' },
  { id: 'cry', label: 'Oh no' },
  { id: 'clap', label: 'Well played' },
  { id: 'crown', label: 'Crown' },
];

export interface EmoteBarProps {
  disabled?: boolean;
  compact?: boolean;
  onEmote: (emote: EmoteId) => void;
}

export function EmoteBar({ disabled, compact, onEmote }: EmoteBarProps) {
  const [cooling, setCooling] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const trigger = (id: EmoteId) => {
    if (disabled || cooling) return;
    sfx.emote();
    onEmote(id);
    setCooling(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setCooling(false);
      timerRef.current = null;
    }, 900);
  };

  return (
    <div
      className={`emote-bar${compact ? ' is-compact' : ''}${cooling ? ' is-cooling' : ''}`}
      role="group"
      aria-label="Send reaction emote"
    >
      {EMOTE_LIST.map((item) => (
        <button
          key={item.id}
          type="button"
          className="emote-btn"
          title={item.label}
          aria-label={item.label}
          disabled={disabled || cooling}
          onClick={() => trigger(item.id)}
        >
          <span aria-hidden="true">{EMOTE_GLYPHS[item.id]}</span>
        </button>
      ))}
    </div>
  );
}

export default EmoteBar;
