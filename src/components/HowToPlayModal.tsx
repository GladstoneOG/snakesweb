import '../styles/screens.css';
import { useEffect, useRef } from 'react';
import { ArrowUpRight, Crown, Dices, Sparkles, Swords, Timer, X } from 'lucide-react';
import { sfx } from '@utils/sfx';

export function HowToPlayModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const close = () => {
    sfx.buttonClick();
    onClose();
  };

  return (
    <div className="modal-backdrop htp-backdrop" onClick={close}>
      <div
        className="modal panel htp-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="htp-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="htp-title">How to Play</h2>
          <button ref={closeRef} type="button" className="icon-btn modal-close" aria-label="Close" onClick={close}>
            <X />
          </button>
        </div>

        <ol className="htp-steps">
          <li>
            <span className="htp-icon htp-icon-brass" aria-hidden="true">
              <Crown />
            </span>
            <div>
              <h3>Race to 100</h3>
              <p>Everyone starts on the Start Pad. The first pawn to reach square 100 wins the crown.</p>
            </div>
          </li>
          <li>
            <span className="htp-icon htp-icon-felt" aria-hidden="true">
              <Dices />
            </span>
            <div>
              <h3>Roll &amp; hop</h3>
              <p>
                On your turn, hold the die (or <kbd>Space</kbd>) to shake it and release to roll. Your pawn hops that many
                squares along the winding path.
              </p>
            </div>
          </li>
          <li>
            <span className="htp-icon htp-icon-good" aria-hidden="true">
              <ArrowUpRight />
            </span>
            <div>
              <h3>Ladders lift you up</h3>
              <p>Land on the foot of a ladder and you climb straight to its top.</p>
            </div>
          </li>
          <li>
            <span className="htp-icon htp-icon-bad" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M5 4c4 0 6 2 4 5s-4 5 0 7 7-1 9 3" />
                <circle cx="5" cy="4" r="1.6" fill="currentColor" />
              </svg>
            </span>
            <div>
              <h3>Snakes slide you down</h3>
              <p>Land on a snake's head and you slither all the way down to its tail.</p>
            </div>
          </li>
        </ol>

        <div className="divider">House rules</div>

        <ul className="htp-rules">
          <li>
            <Sparkles aria-hidden="true" />
            <span>
              <strong>Bonus on 6:</strong> rolling a six grants another roll.
            </span>
          </li>
          <li>
            <Sparkles aria-hidden="true" />
            <span>
              <strong>Triple-six bust:</strong> three sixes in a row sends you back to where the turn began.
            </span>
          </li>
          <li>
            <Sparkles aria-hidden="true" />
            <span>
              <strong>Exact finish:</strong> overshoot 100 and you bounce back by the extra steps.
            </span>
          </li>
          <li>
            <Swords aria-hidden="true" />
            <span>
              <strong>Bump:</strong> land on a rival's square and knock them back.
            </span>
          </li>
          <li>
            <Timer aria-hidden="true" />
            <span>
              <strong>Turn timer:</strong> dawdle too long and the die rolls itself.
            </span>
          </li>
        </ul>

        <button type="button" className="btn btn-primary btn-block htp-cta" onClick={close}>
          Let's play!
        </button>
      </div>
    </div>
  );
}
