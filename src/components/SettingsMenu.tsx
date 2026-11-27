import { useEffect, useRef, useState } from 'react';
import {
  Volume2,
  VolumeX,
  Music,
  SkipForward,
  Vibrate,
  Settings,
  X,
} from 'lucide-react';
import {
  sfx,
  music,
  haptics,
  useSfxMuted,
  useMusic,
  useHaptics,
} from './platform';

export interface SettingsMenuProps {
  className?: string;
}

export function SettingsMenu({ className }: SettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const muted = useSfxMuted();
  const musicSnap = useMusic();
  const hapticsSnap = useHaptics();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={`settings-wrap${className ? ` ${className}` : ''}`} ref={wrapRef}>
      <button
        type="button"
        className="icon-btn settings-trigger"
        aria-label="Audio & haptics settings"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          sfx.buttonClick();
          setOpen((v) => !v);
        }}
      >
        {open ? <X /> : <Settings />}
      </button>

      {open && (
        <div className="settings-popover panel" role="dialog" aria-label="Sound and haptics settings">
          <div className="settings-head">
            <span className="panel-title">Tabletop Audio</span>
            <button
              type="button"
              className="settings-close"
              aria-label="Close settings"
              onClick={() => {
                sfx.buttonClick();
                setOpen(false);
              }}
            >
              <X />
            </button>
          </div>

          <div className="settings-list">
            <label className="switch settings-row">
              <span className="row">
                {muted ? <VolumeX className="settings-ico" /> : <Volume2 className="settings-ico" />}
                <span>
                  <strong>Sound Effects</strong>
                  <small className="settings-sub">Dice, hops, ladders &amp; snakes</small>
                </span>
              </span>
              <input
                type="checkbox"
                checked={!muted}
                onChange={() => {
                  sfx.toggleMute();
                  if (muted) sfx.buttonClick();
                }}
              />
              <span className="switch-track">
                <span className="switch-thumb" />
              </span>
            </label>

            <label className="switch settings-row">
              <span className="row">
                <Music className="settings-ico" />
                <span>
                  <strong>Tabletop Music</strong>
                  <small className="settings-sub">
                    {musicSnap.enabled
                      ? musicSnap.trackTitle || (musicSnap.awaitingGesture ? 'Tap anywhere to play' : 'Playing')
                      : 'Muted'}
                  </small>
                </span>
              </span>
              <input
                type="checkbox"
                checked={musicSnap.enabled}
                onChange={() => {
                  sfx.buttonClick();
                  music.toggle();
                }}
              />
              <span className="switch-track">
                <span className="switch-thumb" />
              </span>
            </label>

            {musicSnap.enabled && (
              <div className="settings-music-controls">
                <input
                  type="range"
                  className="settings-slider"
                  min={0}
                  max={1}
                  step={0.05}
                  value={musicSnap.volume}
                  aria-label="Music volume"
                  onChange={(e) => music.setVolume(parseFloat(e.target.value))}
                />
                <button
                  type="button"
                  className="btn btn-sm"
                  title="Next track"
                  onClick={() => {
                    sfx.buttonClick();
                    music.nextTrack();
                  }}
                >
                  <SkipForward />
                  <span>Next</span>
                </button>
              </div>
            )}

            {hapticsSnap.supported && (
              <label className="switch settings-row">
                <span className="row">
                  <Vibrate className="settings-ico" />
                  <span>
                    <strong>Haptic Feedback</strong>
                    <small className="settings-sub">Tactile dice &amp; board vibrations</small>
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={hapticsSnap.enabled}
                  onChange={() => {
                    sfx.buttonClick();
                    haptics.toggle();
                    if (!hapticsSnap.enabled) haptics.hop();
                  }}
                />
                <span className="switch-track">
                  <span className="switch-thumb" />
                </span>
              </label>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default SettingsMenu;
