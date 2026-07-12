import React from 'react';

interface MetRepsLogoProps {
  className?: string;
  size?: number;
}

export function MetRepsLogo({ className = '', size = 24 }: MetRepsLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`${className} select-none`}
    >
      <defs>
        {/* Left and Right Pill Gradient (Turquoise to deep blue-violet) */}
        <linearGradient id="pill-outer-grad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#00F5D4" />
          <stop offset="50%" stopColor="#00B4D8" />
          <stop offset="100%" stopColor="#6366F1" />
        </linearGradient>

        {/* Middle Pill Gradient (Medium sky-blue to deep blue-violet, slightly darker/deeper) */}
        <linearGradient id="pill-mid-grad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#00B4D8" />
          <stop offset="50%" stopColor="#0077B6" />
          <stop offset="100%" stopColor="#4F46E5" />
        </linearGradient>

        {/* Sine Wave Gradient (Cyan to Blue glow) */}
        <linearGradient id="wave-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#6366F1" />
          <stop offset="25%" stopColor="#00F5D4" />
          <stop offset="50%" stopColor="#00B4D8" />
          <stop offset="75%" stopColor="#00F5D4" />
          <stop offset="100%" stopColor="#6366F1" />
        </linearGradient>

        {/* Filter for wave drop shadow */}
        <filter id="wave-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="8" stdDeviation="6" floodColor="#000000" floodOpacity="0.5" />
        </filter>
        
        {/* Filter for pill glow */}
        <filter id="pill-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Scaled group to fill the SVG space completely without the background squircle */}
      <g transform="translate(256, 256) scale(1.63) translate(-256, -256)">
        {/* Group containing the vertical capsules */}
        <g>
          {/* Left Pill (Vertical Capsule) */}
          <rect
            x="120"
            y="100"
            width="84"
            height="312"
            rx="42"
            fill="url(#pill-outer-grad)"
          />

          {/* Right Pill (Vertical Capsule) */}
          <rect
            x="308"
            y="100"
            width="84"
            height="312"
            rx="42"
            fill="url(#pill-outer-grad)"
          />

          {/* Middle Pill (Vertical Shorter Capsule) */}
          <rect
            x="214"
            y="165"
            width="84"
            height="247"
            rx="42"
            fill="url(#pill-mid-grad)"
          />
        </g>

        {/* Wave Drop Shadow Path (No-filter safe offset) */}
        <path
          d="M 112,251 Q 162,211 200,261 Q 256,316 312,261 Q 350,211 400,251"
          fill="none"
          stroke="#020617"
          strokeWidth="20"
          strokeLinecap="round"
          opacity="0.3"
        />

        {/* Main Sine Wave Path */}
        <path
          d="M 112,245 Q 162,205 200,255 Q 256,310 312,255 Q 350,205 400,245"
          fill="none"
          stroke="url(#wave-grad)"
          strokeWidth="20"
          strokeLinecap="round"
        />

        {/* Wave Inner Light Accent Path for 3D glass look */}
        <path
          d="M 112,245 Q 162,205 200,255 Q 256,310 312,255 Q 350,205 400,245"
          fill="none"
          stroke="#ffffff"
          strokeWidth="4"
          strokeLinecap="round"
          opacity="0.3"
        />
      </g>
    </svg>
  );
}

