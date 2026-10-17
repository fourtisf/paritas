/** The prototype's icon set (I map) as one component. Stroke icons, 24px grid. */
const I = {
  trade: '<path d="M4 17.5 9 12l3.5 3.5L20 7"/><path d="M15 7h5v5"/>',
  markets: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
  pool: '<path d="M12 3.5s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11Z"/><path d="M9.5 15a2.5 2.5 0 0 0 2.5 2.5"/>',
  portfolio: '<rect x="3.5" y="6" width="17" height="13" rx="3"/><path d="M3.5 10.5h17M7 15h3"/>',
  activity: '<path d="M7 3.5h10a1 1 0 0 1 1 1V20l-2.5-1.5L13 20l-2.5-1.5L8 20l-2-1.5V4.5a1 1 0 0 1 1-1Z"/><path d="M9 8h6M9 11.5h6M9 15h3"/>',
  governance: '<path d="M3.5 9.5 12 4l8.5 5.5M5.5 10.5v7M9.8 10.5v7M14.2 10.5v7M18.5 10.5v7M3.5 20h17"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
  ext: '<path d="M14 5h5v5M19 5l-8 8M17 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 18.5v-10A1.5 1.5 0 0 1 5.5 7H10"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.01"/>',
  gear: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  flip: '<path d="M8 4v16m0 0-4-4m4 4 4-4M16 20V4m0 0-4 4m4-4 4 4"/>',
  wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3"/><rect x="4" y="8" width="16" height="11" rx="2.5"/><path d="M16 13.5h.01"/>',
  shield: '<path d="M12 3.5 5 6.5v5c0 4.2 2.9 7.6 7 8.8 4.1-1.2 7-4.6 7-8.8v-5l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  pause: '<rect x="5" y="5" width="14" height="14" rx="3.5"/><path d="M10 9v6M14 9v6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  out: '<path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15M10 16l-4-4 4-4M6 12h10"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2.2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
} as const;

export type IconName = keyof typeof I;

export function Icon({ n, className = "" }: { n: IconName; className?: string }) {
  return (
    <svg
      className={`ic ${className}`.trim()}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: I[n] }}
    />
  );
}
