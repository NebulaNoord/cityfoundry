// Small line icons drawn on an isometric grid to match the map.
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round', strokeLinecap: 'round' };

export function Icon({ name, size = 22 }) {
  const body = ICONS[name];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {body}
    </svg>
  );
}

const ICONS = {
  inspect: (
    <g {...S}>
      <path d="M5 3l12 7-5.2 1.3L9 17z" />
      <path d="M12 12l5 5" />
    </g>
  ),
  road: (
    <g {...S}>
      <path d="M2 15l10-5 10 5-10 5z" />
      <path d="M7 12.5l10 5M9.5 11.3l1 .5M13.5 13.3l1 .5" strokeDasharray="0" />
      <path d="M12 4v4" />
    </g>
  ),
  zoneR: (
    <g {...S}>
      <path d="M4 14l8-4 8 4-8 4z" />
      <path d="M8 12V8l3-3 3 3v4" />
    </g>
  ),
  zoneC: (
    <g {...S}>
      <path d="M4 15l8-4 8 4-8 4z" />
      <path d="M7 13.5V6h10v7.5M7 9h10" />
    </g>
  ),
  zoneI: (
    <g {...S}>
      <path d="M3 16l9-4.5 9 4.5-9 4.5z" />
      <path d="M6 14.5V9l4 2V8l4 2V7l4 2v5.5M16 8V3h2v6" />
    </g>
  ),
  dezone: (
    <g {...S}>
      <path d="M3 14l9-4.5 9 4.5-9 4.5z" strokeDasharray="2 2" />
      <path d="M8 6l8 6M16 6l-8 6" />
    </g>
  ),
  bulldoze: (
    <g {...S}>
      <path d="M3 18h12v-4l-2-4H7l-2 4H3z" />
      <path d="M15 14l4-2v7l-4-1" />
      <circle cx="6" cy="18" r="1.5" />
      <circle cx="12" cy="18" r="1.5" />
    </g>
  ),
  pause: (
    <g {...S}>
      <path d="M8 6v12M16 6v12" strokeWidth="2.4" />
    </g>
  ),
  save: (
    <g {...S}>
      <path d="M5 4h11l3 3v13H5z" />
      <path d="M8 4v5h7V4M8 20v-6h8v6" />
    </g>
  ),
  menu: (
    <g {...S}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </g>
  ),
  close: (
    <g {...S}>
      <path d="M6 6l12 12M18 6L6 18" />
    </g>
  ),
  plus: (
    <g {...S}>
      <path d="M12 5v14M5 12h14" />
    </g>
  ),
  minus: (
    <g {...S}>
      <path d="M5 12h14" />
    </g>
  ),
};
