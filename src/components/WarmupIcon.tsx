import React from 'react';

interface WarmupIconProps {
  className?: string;
  title?: string;
}

export const WarmupIcon: React.FC<WarmupIconProps> = ({
  className = "w-3.5 h-3 text-amber-500 inline-block shrink-0",
  title = "Warmup Set"
}) => (
  <svg
    viewBox="0 0 16 12"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    role="img"
    aria-label={title}
  >
    <title>{title}</title>
    <path d="M 3,1 C 5,3.5 1,7.5 3,10" />
    <path d="M 8,1 C 10,3.5 6,7.5 8,10" />
    <path d="M 13,1 C 15,3.5 11,7.5 13,10" />
  </svg>
);
