// The three sign-in portals. One login API (POST /api/auth/login {email, password, portal}); the
// server answers 403 WRONG_PORTAL (with correctPortal) when the password is right but the account
// belongs to another portal. Accent colours are AA with white text.

export const PORTALS = {
  student: {
    key: "student",
    name: "Student",
    title: "Student sign in",
    notYou: "Not a student?",
    description: "See your status, the reasons behind it, your marks and what to do next.",
    hint: "Use your university email, e.g. student100040@smartedu.edu",
    placeholder: "student100040@smartedu.edu",
    accent: "#2F5D8A", // brand
    accentDark: "#1F3E5C",
    tint: "#EEF3F8",
  },
  faculty: {
    key: "faculty",
    name: "Faculty",
    title: "Faculty sign in",
    notYou: "Not faculty?",
    description: "Track risk in your classes, enter marks and attendance, support your counselees.",
    hint: "Use your staff email, e.g. ayesha.khan@smartedu.edu",
    placeholder: "firstname.lastname@smartedu.edu",
    accent: "#2B6E73", // teal
    accentDark: "#1D4F53",
    tint: "#E8F3F3",
  },
  admin: {
    key: "admin",
    name: "Admin",
    title: "Admin sign in",
    notYou: "Not an admin?",
    description: "Run predictions, manage users and coordinate interventions.",
    hint: "Administrator accounts only, e.g. admin@smartedu.edu",
    placeholder: "admin@smartedu.edu",
    accent: "#3A4556", // slate
    accentDark: "#252D3A",
    tint: "#EEF0F3",
  },
};

export const PORTAL_KEYS = Object.keys(PORTALS);

/** "/login/student" etc.; "/" (the portal chooser) for anything unknown. */
export function loginPathFor(portal) {
  return PORTALS[portal] ? `/login/${portal}` : "/";
}

/** The portal a URL belongs to (/student/... -> student), or null. */
export function portalFromPath(pathname = "") {
  const first = String(pathname).split("/")[1];
  return PORTALS[first] ? first : null;
}

/** Where to send a user whose session ended: their role's portal, else the URL's, else the chooser. */
export function sessionEndPath(role, pathname) {
  return loginPathFor(PORTALS[role] ? role : portalFromPath(pathname));
}
