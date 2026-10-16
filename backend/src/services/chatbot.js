const support = require("../config/support.json");

// "Ask SmartEdu" Layer 1: an intent router plus answer templates. Works offline and never
// calls a model. Every answer is built only from the one student's chat context
// (services/chatContext.js), so it cannot contain another student's data.
//
// respond(message, ctx, {catalog, rng}) -> {answer, intent, suggestions, links, course?}
//   catalog: [{code, title}] of all courses (to recognise courses the student doesn't take)
//   rng:     () => [0, 1) used to vary the wording (Math.random by default)
//
// Matching order matters: wellbeing first (never miss it), then other-student questions
// (refuse before any data is looked up), then the topic intents, then greeting/help.

const MAX_WORDS = 120;

const SUPPORTIVE = {
  Safe: "You're on track",
  "At-Risk": "Needs attention",
  "Dropout-Likely": "High risk - let's act now",
};

const LINKS = {
  dashboard: { label: "Open my dashboard", href: "/student" },
  results: { label: "See my results", href: "/student/results" },
  attendance: { label: "See my attendance", href: "/student/attendance" },
};

const STARTERS = ["Why is my status this?", "Which course should I focus on?", "Is my attendance OK?", "How can I improve?"];

// ---------------------------------------------------------------- normalising + matching

/** lowercase, curly quotes straightened, apostrophes dropped ("don't" -> "dont"), other punctuation -> space */
function normalise(message) {
  return String(message || "")
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/'/g, "")
    .replace(/[^a-z0-9@\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** true if any phrase occurs as whole words in the normalised text */
function has(norm, phrases) {
  return phrases.some((p) => new RegExp(`(^| )${escapeRe(p)}( |$)`).test(norm));
}

const WORDS = {
  selfHarm: [
    "suicide", "suicidal", "kill myself", "killing myself", "end my life", "ending my life", "take my life",
    "hurt myself", "harm myself", "self harm", "cut myself", "dont want to live", "do not want to live",
    "no reason to live", "better off dead", "want to die", "wanna die", "khudkushi", "khud kushi", "mar jana",
    "mar jaun", "mar jaon", "marna chahta", "marna chahti", "jeena nahi", "zindagi khatam", "jaan de doon",
  ],
  quitting: [
    "quit university", "quit uni", "quit my studies", "quit studies", "quit college", "quit my degree", "quit the degree",
    "leave university", "leave uni", "leave my studies", "drop out of", "want to drop out", "thinking of dropping out",
    "thinking about dropping out", "want to quit", "give up on my studies", "parhai chhod", "parhai chor", "parhai chod",
    "uni chhod", "uni chor", "university chhod", "university chor", "chhod dena", "chor dena", "chhod doon", "chor doon",
  ],
  distress: [
    "stress", "stressed", "stressful", "so much pressure", "pressure", "anxious", "anxiety", "panic", "depressed",
    "depression", "hopeless", "no hope", "pointless", "worthless", "i am useless", "im useless", "cant cope",
    "cannot cope", "cant handle", "cannot handle", "overwhelmed", "breaking down", "mental health", "sad", "upset",
    "lonely", "crying", "cry", "give up", "giving up", "burnt out", "burned out", "burnout", "exhausted",
    "tired of everything", "tension", "pareshan", "pareshaan", "dil nahi lagta", "dil nahi karta", "udaas", "udas",
    "mayoos", "mayus", "na umeed", "naumeed", "thak gaya", "thak gayi", "himmat nahi",
  ],
  friend: ["friend", "friends", "dost", "doston", "classmate", "classmates", "roommate", "room mate", "class fellow"],
  // always about someone else, whatever follows
  otherPeople: [
    "someone else", "somebody else", "other student", "other students", "another student", "topper", "toppers",
    "top student", "best student",
  ],
  academic: [
    "cgpa", "gpa", "sgpa", "marks", "mark", "result", "results", "grade", "grades", "attendance", "hazri", "haazri",
    "status", "risk", "score", "scores", "performance", "number", "numbers",
  ],
  whoCanHelp: [
    "who can help", "who could help", "who will help", "talk to someone", "someone to talk", "counselor", "counsellor",
    "counseling", "counselling", "advisor", "adviser", "mentor", "tutor", "kis se baat", "kisse baat", "kis sy baat",
    "kaun madad", "madad kaun", "who should i talk", "who do i talk", "who do i contact", "who should i contact",
    "contact someone", "help from",
  ],
  attendance: [
    "attendance", "attend", "attending", "hazri", "haazri", "hazree", "haziri", "absent", "absence", "absences",
    "missed", "miss classes", "missing classes", "bunk", "how many classes", "classes have i", "session", "sessions",
    "lecture", "lectures",
  ],
  why: [
    "why", "kyun", "kyon", "kyu", "kiyun", "kiun", "kyoon", "wajah", "waja", "reason", "reasons", "how come",
    "explain my status", "what does my status mean", "status ka matlab", "matlab kya", "meaning", "matlab",
  ],
  weakest: [
    "which course", "which subject", "what course", "what subject", "konsa subject", "kaunsa subject", "konsa course",
    "kaunsa course", "kon sa", "kaun sa", "weakest", "weak", "kamzor", "worst", "lowest", "pulling me down",
    "dragging me down", "bringing me down", "focus on", "focus", "struggling", "hardest",
  ],
  improve: [
    "improve", "improvement", "better", "behtar", "bahtar", "get back", "back to safe", "become safe", "be safe",
    "get safe", "what should i do", "what do i do", "what can i do", "kya karun", "kya karoon", "kya karna",
    "kia karun", "next step", "next steps", "tips", "advice", "raise my", "increase my", "boost", "plan", "recover",
    "kaise", "kese", "kaisay", "how can i", "how do i", "how to", "get out of",
  ],
  standing: [
    "cgpa", "gpa", "sgpa", "safe", "standing", "status", "risk", "result", "results", "grade", "grades", "marks",
    "how am i doing", "am i ok", "am i okay", "doing overall", "pass", "passing", "fail", "failing", "probation",
    "kaisa ja raha", "kesa ja raha", "position", "score", "performance", "dropout likely", "at risk",
    "needs attention", "high risk", "on track",
  ],
  help: [
    "help", "what can you do", "what can i ask", "what do you do", "how does this work", "options", "menu",
    "madad", "who are you", "what are you",
  ],
  greeting: [
    "hi", "hello", "hey", "hiya", "salam", "salaam", "assalam", "assalamu", "asalam", "aoa", "good morning",
    "good afternoon", "good evening", "thanks", "thank you", "shukriya", "ok", "okay",
  ],
  noPromise: ["fail", "failing", "pass", "passing", "will i", "going to", "guarantee"],
  marks: ["marks", "grades", "grade", "result", "results", "score", "scores"],
};

// Words that can precede "'s" without being a person ("what's", "it's", "teacher's"...).
const NOT_PEOPLE = new Set([
  "what", "it", "that", "there", "here", "who", "where", "how", "let", "he", "she", "today", "todays", "term",
  "semester", "year", "course", "class", "teacher", "university", "uni", "college", "department", "everyone",
  "one", "my", "student", "whats", "this", "next", "last", "status", "everybody", "nobody", "someone", "somebody",
]);
const URDU_SELF = new Set(["meri", "mera", "mere", "apni", "apna", "apne", "is", "us", "iss", "uss", "course", "subject", "class", "term", "semester"]);

// Common first names (incl. the generator's lists). A name + an academic word = another person.
const FIRST_NAMES = new Set(
  (
    "ahmed ali hassan hamza bilal usman omar zain faisal kashif danish saad talha waleed fahad imran shahzad adeel rizwan " +
    "junaid nabeel asad kamran naveed salman yasir sohail tariq arslan haris ayesha sana hira fatima mahnoor zainab amna " +
    "rabia maria iqra sadia nida warda komal sundas anum farah bushra saba mehwish sidra rimsha aiman laiba noor aliya " +
    "samina tahira sobia uzma muhammad mohammad abdullah ibrahim hussain zara maryam khadija areeba hafsa"
  ).split(" ")
);

const ROLL_RE = /\bbu[\s-]?(\d{5,6})\b/g;
const STUDENT_ID_RE = /\bstudent\s?(\d{5,6})\b|\b(1\d{5})\b/g;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g;

/** Mentions of another student: roll numbers, student emails/IDs, names, "my friend's ...". */
function mentionsOtherStudent(message, norm, ctx) {
  const raw = String(message || "").toLowerCase().replace(/[‘’ʼ`]/g, "'");
  const ownDigits = String(ctx.student.roll_no || "").replace(/\D/g, "");
  const ownEmail = String(ctx.student.email || "").toLowerCase();
  const ownNames = new Set(String(ctx.student.name || "").toLowerCase().split(/\s+/));

  for (const m of raw.matchAll(ROLL_RE)) if (m[1] !== ownDigits) return true;
  for (const m of raw.matchAll(STUDENT_ID_RE)) if ((m[1] || m[2]) !== ownDigits) return true;
  for (const m of raw.matchAll(EMAIL_RE)) if (m[0] !== ownEmail) return true;

  if (has(norm, WORDS.otherPeople)) return true;
  const academic = has(norm, WORDS.academic);
  if (has(norm, WORDS.friend) && (academic || /\b(friend|dost|classmate|roommate)'?s?\b.*\b(ki|ka|ke)\b/.test(raw) || /\b(friend|classmate|roommate)'s\b/.test(raw))) return true;
  if (!academic) return false;

  for (const m of raw.matchAll(/\b([a-z]+)'s\b/g)) if (!NOT_PEOPLE.has(m[1]) && !ownNames.has(m[1])) return true;
  for (const m of raw.matchAll(/\b([a-z]+)\s+(ki|ka|ke)\s+([a-z]+)/g)) {
    if (!URDU_SELF.has(m[1]) && !ownNames.has(m[1]) && WORDS.academic.includes(m[3])) return true;
  }
  for (const m of raw.matchAll(/\b(cgpa|gpa|marks|result|results|attendance|grades?|status)\s+of\s+([a-z]+)\b/g)) {
    if (!["me", "mine", "my", "this", "the", "all", "each", "every", "last", "a", "an", "our"].includes(m[2]) && !ownNames.has(m[2])) return true;
  }
  return norm.split(" ").some((w) => FIRST_NAMES.has(w) && !ownNames.has(w));
}

/** Courses named in the message (codes like "AI301"/"ai 301", or full titles). */
function findCourses(norm, catalog) {
  const found = [];
  const add = (code) => !found.includes(code) && found.push(code);
  for (const m of norm.matchAll(/\b([a-z]{2,4}) ?(\d{3})\b/g)) add(`${m[1].toUpperCase()}${m[2]}`);
  for (const c of catalog) {
    const title = normalise(c.title);
    if (title && new RegExp(`(^| )${escapeRe(title)}( |$)`).test(norm)) add(c.code);
  }
  return found;
}

/** routeIntent(message, ctx, catalog) -> {intent, urgent?, courses?} */
function routeIntent(message, ctx, catalog = []) {
  const norm = normalise(message);
  if (has(norm, WORDS.selfHarm)) return { intent: "wellbeing", urgent: true };
  if (has(norm, WORDS.quitting)) return { intent: "wellbeing", quitting: true };
  if (has(norm, WORDS.distress)) return { intent: "wellbeing" };
  if (mentionsOtherStudent(message, norm, ctx)) return { intent: "other_student" };
  const courses = findCourses(norm, catalog);
  if (courses.length) return { intent: "course_detail", courses, noPromise: has(norm, WORDS.noPromise) };
  if (has(norm, WORDS.attendance)) return { intent: "attendance" };
  if (has(norm, WORDS.whoCanHelp)) return { intent: "who_can_help" };
  if (has(norm, WORDS.why) || /(^| )what (does|do) .+ mean( |$)/.test(norm)) return { intent: "why_risk" };
  if (has(norm, WORDS.weakest)) return { intent: "weakest_course" };
  if (has(norm, WORDS.improve)) return { intent: "improve" };
  if (has(norm, WORDS.standing)) return { intent: "standing", noPromise: has(norm, WORDS.noPromise), wantsMarks: has(norm, WORDS.marks) };
  if (has(norm, WORDS.help) || has(norm, WORDS.greeting) || !norm) return { intent: "greeting" };
  return { intent: "unknown" };
}

// ---------------------------------------------------------------- answer helpers

const pick = (rng, options) => options[Math.floor(rng() * options.length) % options.length];
const gpa = (v) => (v == null ? "-" : Number(v).toFixed(2));
const pct = (v) => (v == null ? "-" : `${Math.round(Number(v) * 10) / 10}%`);
const mark = (v) => (v == null ? "-" : String(Math.round(Number(v))));
const firstName = (ctx) => String(ctx.student.name || "").split(" ")[0] || "there";
const statusName = (label) => `"${SUPPORTIVE[label] || label}" (${label})`;
const wordCount = (s) => s.split(/\s+/).filter(Boolean).length;

/** Keeps whole sentences/lines until the word limit. */
function fit(parts, limit = MAX_WORDS) {
  const out = [];
  let n = 0;
  for (const p of parts.filter(Boolean)) {
    const w = wordCount(p);
    if (n + w > limit) break;
    out.push(p);
    n += w;
  }
  return out.join("\n");
}

function supportLine() {
  const o = support.office;
  return `${o.name} (${o.location}, ${o.phone}, ${o.email}; ${o.hours})`;
}

function counselorLine(ctx) {
  const c = ctx.counselor;
  if (!c) return null;
  return `your counselor ${c.name}${c.email ? ` (${c.email})` : ""}`;
}

// ---------------------------------------------------------------- templates

function whyRisk(ctx, r, rng) {
  const s = ctx.status;
  if (!s) return { answer: "You don't have a status yet. Press Refresh on your dashboard and I can explain it.", links: [LINKS.dashboard] };
  const intro = pick(rng, [
    `Your status is ${statusName(s.label)}.`,
    `Right now your status is ${statusName(s.label)}.`,
    `Your current status: ${statusName(s.label)}.`,
  ]);
  const lead = s.label === "Safe" ? pick(rng, ["Here's what's helping:", "What's working for you:"]) : pick(rng, ["The main reasons:", "This is mostly because of:"]);
  const close = {
    Safe: pick(rng, ["Keep it up!", "Keep doing what you're doing."]),
    "At-Risk": pick(rng, ["This can still change this term - ask me how to improve.", "There's time to turn this around - ask me \"How can I improve?\""]),
    "Dropout-Likely": pick(rng, [
      "This is an early warning, not a final result. Small steps this week matter - ask me how to improve.",
      "It's a warning based on today's numbers, not a decision about you. Let's look at what you can do next.",
    ]),
  }[s.label];
  return {
    answer: fit([intro, lead, ...s.reasons.map((x) => `• ${x}`), close]),
    links: [LINKS.dashboard],
  };
}

function standing(ctx, r, rng) {
  const st = ctx.standing;
  const parts = [
    pick(rng, [
      `Your official CGPA is ${gpa(st.official_cgpa)} - that's from your record up to last term.`,
      `Officially, your CGPA is ${gpa(st.official_cgpa)} (your record up to last term).`,
    ]),
  ];
  if (st.projected_is_estimate) {
    parts.push(
      `Your projected CGPA is ${gpa(st.projected_cgpa)}: an estimate if this term ended with today's marks ` +
        `(provisional SGPA this term ${gpa(st.provisional_sgpa)}, last term's SGPA ${gpa(st.previous_sgpa)}).`
    );
  } else {
    parts.push("No marks are entered this term yet, so your projected CGPA equals your official one.");
  }
  if (ctx.status) parts.push(`Your status: ${statusName(ctx.status.label)}.`);
  parts.push(`For reference: below ${gpa(ctx.thresholds.probation_cgpa)} is the high-risk line, and ${gpa(ctx.thresholds.at_risk_cgpa)} or more is good standing.`);
  if (r.wantsMarks && ctx.courses.length) {
    parts.push(`Course averages: ${ctx.courses.map((c) => `${c.code} ${mark(c.mean)} (${c.grade || "-"})`).join(", ")}.`);
  }
  if (r.noPromise) parts.push("I can't tell you your final result - that depends on the rest of the term.");
  return { answer: fit(parts), links: [LINKS.results] };
}

function courseLine(c, ctx) {
  const att =
    c.attendance_pct == null
      ? "No attendance marked yet."
      : `Attendance ${pct(c.attendance_pct)} (${c.present} of ${c.sessions} classes)${c.attendance_pct < ctx.thresholds.min_attendance_pct ? ` - below the ${ctx.thresholds.min_attendance_pct}% requirement` : ""}.`;
  if (c.mean == null) return `${c.code} (${c.title}): no marks entered yet. ${att}`;
  const m = c.marks;
  return (
    `${c.code} (${c.title}): assignment ${mark(m.assignment)}, quiz ${mark(m.quiz)}, midterm ${mark(m.midterm)}, ` +
    `final ${mark(m.final)} - average ${mark(c.mean)} (${c.grade}). ${att}`
  );
}

function weakestCourse(ctx, r, rng) {
  const w = ctx.weakest_course;
  const c = w && ctx.courses.find((x) => x.code === w.code);
  if (!c) return { answer: "No marks are entered for this term yet, so I can't tell which course needs the most work. Check back once your teachers add marks.", links: [LINKS.results] };
  const intro = pick(rng, [
    "The course pulling your average down most is",
    "Your weakest course right now is",
    "The course to focus on first is",
  ]);
  const tip =
    c.attendance_pct != null && c.attendance_pct < ctx.thresholds.min_attendance_pct
      ? "Getting to every class there is the quickest win."
      : c.mean < 70
        ? "Ask your teacher which upcoming assessments carry the most marks."
        : "It's still a decent mark - a little extra time there keeps you steady.";
  return {
    answer: fit([`${intro} ${courseLine(c, ctx)}`, tip]),
    links: [LINKS.results],
    suggestions: [`Tell me about ${c.code}`, "How can I improve?", "Is my attendance OK?"],
  };
}

function courseDetail(ctx, r, rng) {
  const mine = r.courses.map((code) => ctx.courses.find((c) => c.code === code)).filter(Boolean);
  if (!mine.length) {
    const list = ctx.courses.map((c) => c.code).join(", ");
    return {
      answer: `${r.courses[0]} isn't one of your courses this term${list ? `. Your courses are ${list}` : ""}. Ask me about any of them.`,
      links: [LINKS.results],
    };
  }
  const parts = mine.slice(0, 2).map((c) => courseLine(c, ctx));
  if (mine.length === 1 && ctx.weakest_course && ctx.weakest_course.code === mine[0].code && ctx.courses.length > 1) {
    parts.push(pick(rng, ["This is your lowest course, so extra effort here pays off most.", "It's your weakest course right now - a good place to focus."]));
  }
  if (r.noPromise) parts.push("I can't tell you your final result - that depends on the rest of the term.");
  return { answer: fit(parts), links: [LINKS.results, LINKS.attendance] };
}

function attendance(ctx, r, rng) {
  const a = ctx.attendance;
  const T = ctx.thresholds;
  if (a.source !== "live") {
    return { answer: `No classes have been marked this term yet. Your attendance on record is ${pct(a.pct)}. Aim for ${T.min_attendance_pct}% or more in every course.`, links: [LINKS.attendance] };
  }
  const verdict =
    a.pct < T.severe_attendance_pct
      ? `That's below the ${T.severe_attendance_pct}% severe-absence limit, so it's the most urgent thing to fix.`
      : a.pct < T.min_attendance_pct
        ? `That's below the ${T.min_attendance_pct}% requirement.`
        : pick(rng, [`That's above the ${T.min_attendance_pct}% requirement - well done.`, `You're above ${T.min_attendance_pct}% - good.`]);
  const per = ctx.courses.filter((c) => c.attendance_pct != null).map((c) => `${c.code} ${pct(c.attendance_pct)}`);
  const step = ctx.next_steps.find((s) => s.id === "attendance");
  const low = ctx.courses.filter((c) => c.attendance_pct != null && c.attendance_pct < T.min_attendance_pct).map((c) => c.code);
  return {
    answer: fit([
      `${pick(rng, ["Your overall attendance this term is", "This term you've attended", "Your attendance so far is"])} ${pct(a.pct)} (${a.present} of ${a.sessions} classes). ${verdict}`,
      per.length ? `By course: ${per.join(" · ")}.` : null,
      step ? step.text.replace(/^Your attendance is .*? classes\)\. /, "") : low.length ? `Watch ${low.join(", ")} - below ${T.min_attendance_pct}% there.` : null,
    ]),
    links: [LINKS.attendance],
  };
}

function improve(ctx, r, rng) {
  const steps = ctx.next_steps.slice(0, 3);
  if (!steps.length) {
    return { answer: "I don't have enough of this term's data to suggest steps yet. Keep attending every class and submitting work on time.", links: [LINKS.dashboard] };
  }
  const intro =
    ctx.status && ctx.status.label === "Safe"
      ? pick(rng, ["You're on track. To stay there:", "You're doing well - here's how to keep it that way:"])
      : pick(rng, ["Here are your most useful next steps:", "Here's where to start, most important first:", "These steps will help most:"]);
  return {
    answer: fit([intro, ...steps.map((s, i) => `${i + 1}. ${s.text}`)]),
    links: [LINKS.dashboard, LINKS.results],
  };
}

function whoCanHelp(ctx, r, rng) {
  const c = counselorLine(ctx);
  if (c) {
    return { answer: `You can talk to ${c}. For anything else, the ${supportLine()} can help too.`, links: [] };
  }
  return {
    answer:
      `No counselor is assigned yet - your department admin can assign one. ` +
      `${pick(rng, [`Meanwhile, you can contact the ${supportLine()}.`, `Until then, the ${supportLine()} can help.`])} ` +
      "Your course teachers can also tell you which assessments matter most.",
    links: [],
  };
}

function otherStudent(ctx, r, rng) {
  return {
    answer: pick(rng, [
      "I can only talk about your own records, so I can't share or look up anything about other students. If a friend wants help, they can log in and ask me themselves.",
      "Sorry, I can't discuss other students - I only have access to your own records. Your friend can log in and ask me about theirs.",
    ]),
    links: [],
  };
}

function wellbeing(ctx, r, rng) {
  const who = counselorLine(ctx);
  const o = support.office;
  if (r.urgent) {
    return {
      answer:
        "I'm really sorry you're feeling this way. Your safety matters more than any grade. " +
        `If you might act on these thoughts, please call ${support.emergency.label} (${support.emergency.phone}) now ${support.emergency.note}. ` +
        `You can also reach the ${o.name} at ${o.phone} or ${o.email}${who ? `, or ${who}` : ""}. Please tell someone you trust today - you don't have to handle this alone.`,
      links: [],
      suggestions: ["Who can help me?"],
    };
  }
  const open = r.quitting
    ? pick(rng, ["Thinking about leaving university is a big decision, and it makes sense to feel overwhelmed.", "It sounds like you're thinking about leaving - that's a heavy thing to carry."])
    : pick(rng, ["I'm sorry you're feeling this way - that sounds really hard.", "That sounds like a lot to deal with, and it's okay to feel this way."]);
  const talk = who
    ? `Please talk to ${who}, or the ${supportLine()}.`
    : `Please talk to someone: the ${supportLine()}. Your department admin can also assign you a counselor.`;
  const after = r.quitting
    ? "They can help with options like extra support or a lighter course load before you decide anything."
    : "Talking it through really can help, and asking for support is a strong step.";
  return {
    answer: fit([`${open} ${talk}`, `${after} Whenever you're ready, I can also help you plan your studies.`]),
    links: [],
    suggestions: ["Who can help me?", "How can I improve?"],
  };
}

function greeting(ctx, r, rng) {
  return {
    answer:
      `${pick(rng, ["Hi", "Hello", "Assalam o alaikum"])} ${firstName(ctx)}! I'm SmartEdu's study assistant. ` +
      "I can explain your status, your CGPA, your marks and attendance in each course, and what to do next - using only your own records. Try one of these:",
    links: [],
    suggestions: STARTERS.slice(0, 3),
  };
}

function unknown(ctx, r, rng) {
  return {
    answer: `${pick(rng, ["I'm not sure I understood that.", "Sorry, I can't answer that one."])} I can help with your status, CGPA, course marks, attendance and how to improve. Try one of these:`,
    links: [],
    suggestions: STARTERS.slice(0, 3),
  };
}

const TEMPLATES = {
  why_risk: whyRisk,
  standing,
  weakest_course: weakestCourse,
  course_detail: courseDetail,
  attendance,
  improve,
  who_can_help: whoCanHelp,
  other_student: otherStudent,
  wellbeing,
  greeting,
  unknown,
};

const SUGGESTIONS = {
  why_risk: ["How can I improve?", "Which course should I focus on?", "Is my attendance OK?"],
  standing: ["Why is my status this?", "How can I improve?", "Which course should I focus on?"],
  course_detail: ["Which course should I focus on?", "Is my attendance OK?", "How can I improve?"],
  attendance: ["How can I improve?", "Which course should I focus on?", "What is my CGPA?"],
  improve: ["Which course should I focus on?", "Is my attendance OK?", "Who can help me?"],
  who_can_help: ["How can I improve?", "Why is my status this?"],
  other_student: ["What is my CGPA?", "Why is my status this?"],
};

/** respond(message, ctx, {catalog, rng}) -> {answer, intent, suggestions, links} */
function respond(message, ctx, { catalog = [], rng = Math.random } = {}) {
  const routed = routeIntent(message, ctx, catalog);
  const out = TEMPLATES[routed.intent](ctx, routed, rng);
  return {
    answer: out.answer,
    intent: routed.intent,
    suggestions: (out.suggestions || SUGGESTIONS[routed.intent] || STARTERS).slice(0, 3),
    links: out.links || [],
  };
}

module.exports = { respond, routeIntent, normalise, mentionsOtherStudent, STARTERS, MAX_WORDS, unknown: (ctx, rng = Math.random) => unknown(ctx, {}, rng), otherStudentReply: (ctx, rng = Math.random) => otherStudent(ctx, {}, rng) };
