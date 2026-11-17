import { useId } from "react";
import "./puchi.css";

export type PuchiState = "idle" | "thinking" | "talking";

interface PuchiAvatarProps {
  size?: number;
  state?: PuchiState;
  className?: string;
}

const INK = "#2a211c";
/** Silueta: tubo fino con la punta de ceniza irregular arriba y la boquilla redondeada abajo. */
const BODY =
  "M22 16 Q22 12.6 25 12 L27 10.9 L29.6 12.1 L32 10.6 L34.4 12 L37 10.9 L39 12 Q42 12.6 42 16 V57 Q42 62.4 36.6 62.4 H27.4 Q22 62.4 22 57 Z";

/**
 * Puchi: un cigarrillo con ojos. Papel blanco apenas inclinado, boquilla de
 * corcho abajo, brasa arriba con un hilo de humo. Dibujo propio en SVG inline;
 * las animaciones viven en puchi.css y se apagan con prefers-reduced-motion.
 */
export function PuchiAvatar({ size = 56, state = "idle", className }: PuchiAvatarProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const clip = `puchi-clip-${uid}`;
  const paper = `puchi-paper-${uid}`;
  const ember = `puchi-ember-${uid}`;
  const glow = `puchi-glow-${uid}`;

  return (
    <svg
      className={`puchi${className ? ` ${className}` : ""}`}
      data-state={state}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={clip}>
          <path d={BODY} />
        </clipPath>
        <linearGradient id={paper} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.7" stopColor="#fbf9f4" />
          <stop offset="1" stopColor="#e2dcd0" />
        </linearGradient>
        <linearGradient id={ember} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#ffb238" />
          <stop offset="0.55" stopColor="#f0591f" />
          <stop offset="1" stopColor="#b93412" />
        </linearGradient>
        <radialGradient id={glow}>
          <stop offset="0" stopColor="#ff8a2a" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ff8a2a" stopOpacity="0" />
        </radialGradient>
      </defs>

      <g className="puchi-bob">
        <g transform="rotate(9 32 38)">
          {/* Humo */}
          <g fill="none" stroke="var(--puchi-smoke)" strokeWidth="1.7" strokeLinecap="round">
            <path className="puchi-wisp" d="M31.5 9.5 C27.5 7.5 35.5 5.5 31.5 3 C29.8 1.9 31.2 0.8 31 0" />
            <path className="puchi-wisp puchi-wisp-2" d="M35.5 8.5 C37.3 6.8 34.2 5.6 36 3.8" strokeWidth="1.3" />
          </g>

          {/* Resplandor de la brasa */}
          <circle className="puchi-glow" cx="32" cy="14" r="11" fill={`url(#${glow})`} />

          {/* Cuerpo */}
          <g clipPath={`url(#${clip})`}>
            <rect x="20" y="9" width="24" height="55" fill={`url(#${paper})`} />
            {/* Brasa y ceniza */}
            <rect x="20" y="9" width="24" height="8" fill={`url(#${ember})`} />
            <rect x="20" y="16.6" width="24" height="2.6" fill="#6f655e" />
            <circle cx="26.5" cy="14.4" r="1" fill="#ffe08a" />
            <circle cx="32.5" cy="15.2" r="0.8" fill="#ffd166" />
            <circle cx="37.5" cy="14" r="0.9" fill="#ffe08a" />
            {/* Boquilla de corcho */}
            <rect x="20" y="47.5" width="24" height="16" fill="#d09a58" />
            <rect x="20" y="47.5" width="24" height="1.6" fill="#8f5f2c" />
            <rect x="20" y="50.7" width="24" height="0.9" fill="#b07a3e" />
            <g fill="#a8703a">
              <circle cx="26" cy="54.5" r="0.9" />
              <circle cx="31.5" cy="57.4" r="0.8" />
              <circle cx="36.5" cy="54.2" r="0.9" />
              <circle cx="39" cy="58.4" r="0.7" />
              <circle cx="27.5" cy="59.4" r="0.6" />
            </g>
            <g fill="#e6bd85">
              <circle cx="34" cy="59.6" r="0.7" />
              <circle cx="39.5" cy="53.2" r="0.6" />
              <circle cx="24.5" cy="57.4" r="0.6" />
            </g>
          </g>
          <path d={BODY} fill="none" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />

          {/* Cejas */}
          <g className="puchi-brows" fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round">
            {state === "thinking" ? (
              <>
                <path d="M22.4 23.6 Q25.8 20.8 29.6 22.6" />
                <path d="M34.6 21.4 Q38 19.6 41.6 21.8" />
              </>
            ) : (
              <>
                <path d="M22.4 23.4 Q25.8 21 29.4 22.8" />
                <path d="M34.6 22.8 Q38.2 21 41.6 23.4" />
              </>
            )}
          </g>

          {/* Ojos: sobresalen apenas del papel para que se lean a 56px */}
          <g className="puchi-eyes">
            <ellipse cx="26" cy="32" rx="5.7" ry="6.7" fill="#ffffff" stroke={INK} strokeWidth="1.5" />
            <ellipse cx="38" cy="32" rx="5.7" ry="6.7" fill="#ffffff" stroke={INK} strokeWidth="1.5" />
            <g className="puchi-pupils">
              <circle cx="26.9" cy="33" r="3.2" fill={INK} />
              <circle cx="38.9" cy="33" r="3.2" fill={INK} />
              <circle cx="28.1" cy="31.7" r="1.1" fill="#ffffff" />
              <circle cx="40.1" cy="31.7" r="1.1" fill="#ffffff" />
            </g>
          </g>

          {/* Boca */}
          {state === "talking" ? (
            <ellipse className="puchi-mouth-open" cx="32" cy="43" rx="2.6" ry="2" fill={INK} />
          ) : state === "thinking" ? (
            <path d="M30 43 H34.2" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
          ) : (
            <path d="M28.6 41.8 Q32 45 35.4 41.8" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
          )}
        </g>
      </g>
    </svg>
  );
}
