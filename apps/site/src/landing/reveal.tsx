import { motion, useReducedMotion, type Variants } from 'motion/react';
import type { PointerEventHandler, ReactNode } from 'react';

/** The page's one easing curve (a quint ease-out): fast start, long soft landing. */
export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Start a reveal a little before the element is fully on screen, and only once. */
const VIEWPORT = { once: true, margin: '0px 0px -10% 0px' } as const;

export interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Seconds to wait after the element enters the viewport. */
  delay?: number;
  /** Distance, in px, the element rises while fading in. */
  y?: number;
}

/**
 * Fades and lifts its content in when it scrolls into view. Only opacity and transform
 * animate. With prefers-reduced-motion the content renders in its final state and nothing
 * moves (`initial={false}` skips the hidden starting pose entirely).
 */
export function Reveal({ children, className, delay = 0, y = 12 }: RevealProps) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={VIEWPORT}
      transition={{ duration: 0.6, ease: EASE_OUT, delay }}
    >
      {children}
    </motion.div>
  );
}

const listVariants: Variants = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.055, delayChildren: 0.03 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE_OUT } },
};

/** A list whose `StaggerItem` children reveal one after another as the list enters view. */
export function StaggerList({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.ul
      aria-label={label}
      className={className}
      variants={listVariants}
      initial={reduce ? false : 'hidden'}
      whileInView="shown"
      viewport={VIEWPORT}
    >
      {children}
    </motion.ul>
  );
}

export function StaggerItem({
  children,
  className,
  onPointerMove,
}: {
  children: ReactNode;
  className?: string;
  onPointerMove?: PointerEventHandler<HTMLLIElement>;
}) {
  return (
    <motion.li className={className} variants={itemVariants} onPointerMove={onPointerMove}>
      {children}
    </motion.li>
  );
}
