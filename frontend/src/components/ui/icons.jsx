// Small inline icon set (24px grid, stroke icons). Decorative by default (aria-hidden).

function Icon({ children, size = 18, className = "", strokeWidth = 2, title }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

export const CheckCircle = (p) => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="m8.5 12.2 2.4 2.4 4.8-5" /></Icon>
);
export const Warning = (p) => (
  <Icon {...p}><path d="M10.3 4.1 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.1a2 2 0 0 0-3.4 0Z" /><path d="M12 9.5v4" /><path d="M12 17h.01" /></Icon>
);
export const AlertOctagon = (p) => (
  <Icon {...p}><path d="M8.2 2.5h7.6l5.7 5.7v7.6l-5.7 5.7H8.2l-5.7-5.7V8.2Z" /><path d="M12 8v4.5" /><path d="M12 16h.01" /></Icon>
);
export const Info = (p) => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></Icon>
);
export const Close = (p) => <Icon {...p}><path d="M18 6 6 18M6 6l12 12" /></Icon>;
export const Menu = (p) => <Icon {...p}><path d="M4 6h16M4 12h16M4 18h16" /></Icon>;
export const Bell = (p) => (
  <Icon {...p}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></Icon>
);
export const Refresh = (p) => (
  <Icon {...p}><path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" /><path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" /><path d="M21 3v5h-5" /><path d="M3 21v-5h5" /></Icon>
);
export const Search = (p) => <Icon {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Icon>;
export const ChevronUp = (p) => <Icon {...p}><path d="m6 15 6-6 6 6" /></Icon>;
export const ChevronDown = (p) => <Icon {...p}><path d="m6 9 6 6 6-6" /></Icon>;
export const ChevronRight = (p) => <Icon {...p}><path d="m9 6 6 6-6 6" /></Icon>;
export const Sort = (p) => <Icon {...p}><path d="m8 9 4-4 4 4" /><path d="m16 15-4 4-4-4" /></Icon>;
export const Inbox = (p) => (
  <Icon {...p}><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1Z" /></Icon>
);
export const ChartIcon = (p) => <Icon {...p}><path d="M3 3v18h18" /><path d="m7 15 4-4 3 3 5-6" /></Icon>;
export const Users = (p) => (
  <Icon {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9" /><path d="M16 3.1a4 4 0 0 1 0 7.8" /></Icon>
);
export const Book = (p) => (
  <Icon {...p}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5Z" /><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" /></Icon>
);
export const Calendar = (p) => (
  <Icon {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></Icon>
);
export const Clock = (p) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Icon>;
export const Logout = (p) => (
  <Icon {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></Icon>
);
export const Target = (p) => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></Icon>
);
export const Play = (p) => <Icon {...p}><path d="m7 4 13 8-13 8Z" /></Icon>;
export const Send = (p) => <Icon {...p}><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></Icon>;
export const Filter = (p) => <Icon {...p}><path d="M22 3H2l8 9.5V19l4 2v-8.5Z" /></Icon>;
