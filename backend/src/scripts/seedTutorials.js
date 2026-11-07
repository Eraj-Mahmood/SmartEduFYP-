// Usage: cd backend; node src/scripts/seedTutorials.js [--no-check]
// Seeds study material for every course (FR11). Every URL is fetched first (GET, redirects
// followed, 20 s timeout); one that fails or can't be checked is stored with is_active = FALSE
// and listed at the end so someone can fix it. Re-running is safe: (course_id, url) is unique,
// and a re-run can deactivate a link that broke but never re-activates one an admin switched off.
// Only well-known, stable sources (MIT OpenCourseWare, Khan Academy, freeCodeCamp, OpenStax,
// official documentation); course pages rather than deep links.
require("dotenv").config();
const pool = require("../config/db");

const T = (title, url, provider, kind, description) => ({ title, url, provider, kind, description });

// The first entry for a course is the one the recommender shows first.
const TUTORIALS = {
  CS301: [
    T("Introduction to Algorithms (6.006)", "https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/", "MIT OpenCourseWare", "video",
      "Lecture videos and notes on sorting, hashing, trees, graphs and dynamic programming."),
    T("Algorithms", "https://www.khanacademy.org/computing/computer-science/algorithms", "Khan Academy", "practice",
      "Short lessons with exercises on searching, sorting, recursion and graph algorithms."),
  ],
  CS302: [
    T("PostgreSQL Tutorial", "https://www.postgresql.org/docs/current/tutorial.html", "PostgreSQL documentation", "notes",
      "Official walkthrough of tables, queries, joins, views and transactions in SQL."),
    T("Database Systems (6.830)", "https://ocw.mit.edu/courses/6-830-database-systems-fall-2010/", "MIT OpenCourseWare", "notes",
      "Lecture notes on the relational model, query processing, indexing and recovery."),
    T("Relational Database", "https://www.freecodecamp.org/learn/relational-database/", "freeCodeCamp", "practice",
      "Hands-on SQL and PostgreSQL practice projects."),
  ],
  CS401: [
    T("Operating Systems: Three Easy Pieces", "https://pages.cs.wisc.edu/~remzi/OSTEP/", "University of Wisconsin-Madison", "notes",
      "Free textbook on processes, scheduling, memory, concurrency and file systems."),
    T("Operating System Engineering (6.828)", "https://ocw.mit.edu/courses/6-828-operating-system-engineering-fall-2012/", "MIT OpenCourseWare", "notes",
      "Lecture notes and labs on how an operating system kernel is built."),
  ],
  CS402: [
    T("Computers and the Internet", "https://www.khanacademy.org/computing/computers-and-internet", "Khan Academy", "video",
      "Short lessons on how data travels: IP, DNS, routing, TCP and HTTP."),
    T("Computer Networks (6.829)", "https://ocw.mit.edu/courses/6-829-computer-networks-fall-2002/", "MIT OpenCourseWare", "notes",
      "Lecture notes on network architecture, routing and congestion control."),
  ],
  SE301: [
    T("Software Engineering Concepts (16.355J)", "https://ocw.mit.edu/courses/16-355j-software-engineering-concepts-fall-2005/", "MIT OpenCourseWare", "notes",
      "Lecture notes on requirements, specification, design and validation of software."),
    T("SWEBOK - Software Engineering Body of Knowledge", "https://www.computer.org/education/bodies-of-knowledge/software-engineering", "IEEE Computer Society", "notes",
      "The reference guide to software engineering knowledge areas, including requirements."),
  ],
  SE302: [
    T("Software Construction (6.005)", "https://ocw.mit.edu/courses/6-005-software-construction-spring-2016/", "MIT OpenCourseWare", "notes",
      "Readings on specifications, abstract data types, design and testing."),
    T("Design Patterns", "https://refactoring.guru/design-patterns", "Refactoring.Guru", "notes",
      "Illustrated catalogue of the classic design patterns with examples."),
  ],
  SE401: [
    T("The Practical Test Pyramid", "https://martinfowler.com/articles/practical-test-pyramid.html", "martinfowler.com", "notes",
      "How to balance unit, integration and end-to-end tests in a real project."),
  ],
  SE402: [
    T("The Scrum Guide", "https://scrumguides.org/scrum-guide.html", "Scrum.org / Scrum Inc.", "notes",
      "The official definition of Scrum: roles, events and artifacts."),
    T("Agile Coach", "https://www.atlassian.com/agile", "Atlassian", "notes",
      "Guides on agile planning, estimation, sprints and project tracking."),
  ],
  EE301: [
    T("Digital Signal Processing (RES.6-008)", "https://ocw.mit.edu/courses/res-6-008-digital-signal-processing-spring-2011/", "MIT OpenCourseWare", "video",
      "Lecture videos on sampling, the z-transform, the DFT/FFT and digital filters."),
  ],
  EE302: [
    T("Feedback Systems (6.302)", "https://ocw.mit.edu/courses/6-302-feedback-systems-spring-2007/", "MIT OpenCourseWare", "notes",
      "Lecture notes on feedback, stability, root locus and frequency response."),
  ],
  EE401: [
    T("Power Electronics (6.334)", "https://ocw.mit.edu/courses/6-334-power-electronics-spring-2007/", "MIT OpenCourseWare", "notes",
      "Lecture notes on converters, rectifiers, inverters and their control."),
  ],
  EE402: [
    T("Computation Structures (6.004)", "https://ocw.mit.edu/courses/6-004-computation-structures-spring-2017/", "MIT OpenCourseWare", "video",
      "Videos on digital logic, processor design, memory and assembly programming."),
    T("Arduino Documentation", "https://docs.arduino.cc/", "Arduino", "practice",
      "Official tutorials for programming a microcontroller board hands-on."),
  ],
  AI301: [
    T("Introduction to Machine Learning (6.036)", "https://ocw.mit.edu/courses/6-036-introduction-to-machine-learning-fall-2020/", "MIT OpenCourseWare", "video",
      "Lectures on regression, classification, features, neural networks and evaluation."),
    T("Machine Learning Crash Course", "https://developers.google.com/machine-learning/crash-course", "Google for Developers", "practice",
      "Short lessons with interactive exercises on core ML ideas."),
    T("scikit-learn User Guide", "https://scikit-learn.org/stable/user_guide.html", "scikit-learn documentation", "notes",
      "Official guide to the classic ML algorithms with code examples."),
  ],
  AI302: [
    T("MIT Introduction to Deep Learning (6.S191)", "https://introtodeeplearning.com/", "MIT", "video",
      "Lecture videos and labs on neural networks, CNNs, RNNs and training."),
    T("PyTorch Tutorials", "https://docs.pytorch.org/tutorials/", "PyTorch documentation", "practice",
      "Official step-by-step tutorials for building and training neural networks."),
  ],
  AI401: [
    T("Hugging Face LLM Course", "https://huggingface.co/learn/llm-course", "Hugging Face", "practice",
      "Free course on transformers, tokenizers and NLP tasks, with notebooks."),
    T("CS224N: Natural Language Processing with Deep Learning", "https://web.stanford.edu/class/cs224n/", "Stanford University", "video",
      "Lectures on word vectors, sequence models and transformers."),
  ],
  AI402: [
    T("CS231n Course Notes", "https://cs231n.github.io/", "Stanford University", "notes",
      "Notes on image classification, convolutional networks and training tips."),
    T("OpenCV Tutorials", "https://docs.opencv.org/4.x/d9/df8/tutorial_root.html", "OpenCV documentation", "practice",
      "Official tutorials on image processing, features and object detection."),
  ],
  BUS301: [
    T("Principles of Marketing", "https://openstax.org/details/books/principles-marketing", "OpenStax", "notes",
      "Free textbook on segmentation, the marketing mix, branding and pricing."),
    T("Marketing Management (15.810)", "https://ocw.mit.edu/courses/15-810-marketing-management-fall-2010/", "MIT OpenCourseWare", "notes",
      "Course notes and cases on marketing strategy."),
  ],
  BUS302: [
    T("Principles of Accounting, Volume 1: Financial Accounting", "https://openstax.org/details/books/principles-financial-accounting", "OpenStax", "notes",
      "Free textbook on the accounting cycle, statements, assets and liabilities."),
  ],
  BUS401: [
    T("Organizational Behavior", "https://openstax.org/details/books/organizational-behavior", "OpenStax", "notes",
      "Free textbook on motivation, teams, leadership, culture and change."),
  ],
  BUS402: [
    T("Principles of Management", "https://openstax.org/details/books/principles-management", "OpenStax", "notes",
      "Free textbook; the strategy chapters cover strategic analysis and competitive advantage."),
  ],
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

/** GET the URL (redirects followed). -> {ok, status, error} */
async function checkUrl(url) {
  try {
    const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, status: null, error: e.name === "TimeoutError" ? "timeout" : e.cause?.code || e.message };
  }
}

async function main() {
  const check = !process.argv.includes("--no-check");
  const { rows: courses } = await pool.query("SELECT course_id, course_code FROM courses");
  const idByCode = Object.fromEntries(courses.map((c) => [c.course_code, c.course_id]));
  const failed = [];
  let n = 0;
  for (const [code, list] of Object.entries(TUTORIALS)) {
    if (!idByCode[code]) {
      console.log(`skip ${code}: no such course`);
      continue;
    }
    for (const t of list) {
      const r = check ? await checkUrl(t.url) : { ok: true };
      if (!r.ok) failed.push({ code, ...t, status: r.status, error: r.error });
      await pool.query(
        `INSERT INTO tutorials (course_id, title, url, provider, kind, description, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (course_id, url) DO UPDATE
           SET title = EXCLUDED.title, provider = EXCLUDED.provider, kind = EXCLUDED.kind,
               description = EXCLUDED.description, is_active = tutorials.is_active AND EXCLUDED.is_active`,
        [idByCode[code], t.title, t.url, t.provider, t.kind, t.description, r.ok]
      );
      n++;
      console.log(`${r.ok ? "ok  " : "FAIL"} ${code} ${t.url}${r.ok ? "" : ` (${r.status || r.error})`}`);
    }
  }
  const missing = courses.filter((c) => !TUTORIALS[c.course_code]).map((c) => c.course_code);
  const { rows: uncovered } = await pool.query(
    `SELECT c.course_code FROM courses c
     WHERE NOT EXISTS (SELECT 1 FROM tutorials t WHERE t.course_id = c.course_id AND t.is_active)
     ORDER BY c.course_code`
  );
  console.log(`\n${n} tutorials seeded${check ? "" : " (URLs not checked)"}.`);
  if (failed.length) {
    console.log("Inactive (failed the HTTP check):");
    for (const f of failed) console.log(`  ${f.code} ${f.title}: ${f.url} (${f.status || f.error})`);
  }
  if (missing.length) console.log(`Courses with no seed entry: ${missing.join(", ")}`);
  console.log(uncovered.length ? `Courses with no ACTIVE tutorial: ${uncovered.map((r) => r.course_code).join(", ")}` : "Every course has an active tutorial.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
