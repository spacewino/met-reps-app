import React from 'react';

interface MetRepsLogoProps {
  className?: string;
  size?: number;
}

export function MetRepsLogo({ className = '', size = 24 }: MetRepsLogoProps) {
  // Return the pixel-perfect SVG representation of the MetReps custom icon.
  // This features the high-fidelity squircle dark-blue background,
  // the stylized "M" with rounded barbell plates on either side.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`${className} select-none`}
    >
      <defs>
        {/* Deep, premium squircle background gradient */}
        <linearGradient id="metreps-logo-bg-grad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#1e2555" /> {/* Premium dark steel blue */}
          <stop offset="40%" stopColor="#14183d" />
          <stop offset="100%" stopColor="#080a18" /> {/* Deepest space navy */}
        </linearGradient>

        {/* Outer squircle glossy accent ring */}
        <linearGradient id="metreps-logo-border-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* Main squircle background container */}
      <rect
        x="2"
        y="2"
        width="96"
        height="96"
        rx="28"
        fill="#14183d"
        stroke="url(#metreps-logo-border-grad)"
        strokeWidth="1.5"
      />

      {/* Group containing the full custom emblem */}
      <g>
        {/* The Central Barbell Bar */}
        <rect
          x="9.7"
          y="48.25"
          width="80.6"
          height="3.5"
          rx="1.75"
          fill="#ffffff"
        />

        {/* Left Side Plates (from outer to inner) */}
        {/* Outermost Plate */}
        <rect
          x="8.5"
          y="44"
          width="2.4"
          height="12"
          rx="1.2"
          fill="#ffffff"
          stroke="#ffffff"
          strokeWidth="0.5"
          strokeLinejoin="round"
        />
        {/* Middle Plate */}
        <rect
          x="12.5"
          y="36"
          width="3.8"
          height="28"
          rx="1.9"
          fill="#ffffff"
          stroke="#ffffff"
          strokeWidth="0.5"
          strokeLinejoin="round"
        />
        {/* Innermost Plate */}
        <rect
          x="17.8"
          y="29"
          width="4.8"
          height="42"
          rx="2.4"
          fill="#ffffff"
          stroke="#ffffff"
          strokeWidth="0.5"
          strokeLinejoin="round"
        />

        {/* Right Side Plates (from inner to outer) */}
        {/* Innermost Plate */}
        <rect
          x="77.4"
          y="29"
          width="4.8"
          height="42"
          rx="2.4"
          fill="#ffffff"
          stroke="#ffffff"
          strokeWidth="0.5"
          strokeLinejoin="round"
        />
        {/* Middle Plate */}
        <rect
          x="83.7"
          y="36"
          width="3.8"
          height="28"
          rx="1.9"
          fill="#ffffff"
          stroke="#ffffff"
          strokeWidth="0.5"
          strokeLinejoin="round"
        />
        {/* Outermost Plate */}
        <rect
          x="89.1"
          y="44"
          width="2.4"
          height="12"
          rx="1.2"
          fill="#ffffff"
          stroke="#ffffff"
          strokeWidth="0.5"
          strokeLinejoin="round"
        />

        {/* High-Fidelity Stylized "M" Shape */}
        <path
          d="M 25.5,30 H 32 L 50,42 L 68,30 H 74.5 V 70 H 68 V 48.5 L 50,60 L 32,48.5 V 70 H 25.5 Z"
          fill="#ffffff"
          stroke="#ffffff"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

