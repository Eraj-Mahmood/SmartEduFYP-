require("dotenv").config();
const { pool } = require("./helpers");
const s = require("../src/services/academicStanding");
const config = require("../src/config/academicStanding.json");

// Academic standing rules (Phase 7, step 4) - BU Student Handbook (Spring 2024), clause 5.5.
// The pure rules need no database; the last block checks the seeded data is consistent.

afterAll(() => pool.end());

describe("config (the only place the handbook numbers live)", () => {
  test("minimum CGPA per programme (1.1.25 / 5.5.1)", () => {
    for (const p of ["AD", "BBA", "BEE", "BS"]) expect(s.minimumFor(p)).toBe(2.0);
    for (const p of ["MBA", "MS", "MPhil"]) expect(s.minimumFor(p)).toBe(2.5);
    expect(s.minimumFor("PhD")).toBe(3.0);
    expect(() => s.minimumFor("XYZ")).toThrow(/No minimum CGPA/);
  });

  test("programme from department; unknown departments use the default", () => {
    expect(s.programmeFor("CS")).toBe("BS");
    expect(s.programmeFor("EE")).toBe("BEE");
    expect(s.programmeFor("Business")).toBe("BBA");
    expect(s.programmeFor("Nope")).toBe(config.default_programme);
  });

  test("two probations before drop; first semester uses GPA; hold on probation 2", () => {
    expect(config.probations_before_drop).toBe(2);
    expect(config.first_semester_uses_gpa).toBe(true);
    expect(config.hold_on_probation_2).toBe(true);
  });
});

describe("nextStanding (pure)", () => {
  test("no completed term (semester 1 still running) -> not evaluated, count kept", () => {
    expect(s.nextStanding("not_evaluated", 0, 1.5, 0)).toEqual({ status: "not_evaluated", count: 0 });
    expect(s.nextStanding("not_evaluated", 0, 1.5, null)).toEqual({ status: "not_evaluated", count: 0 });
    expect(s.nextStanding("not_evaluated", 0, null, 3)).toEqual({ status: "not_evaluated", count: 0 });
  });

  test("at or above the minimum -> good, count 0 (exactly 2.00 is good)", () => {
    expect(s.nextStanding("not_evaluated", 0, 2.0, 1)).toEqual({ status: "good", count: 0 });
    expect(s.nextStanding("good", 0, 3.4, 2)).toEqual({ status: "good", count: 0 });
    expect(s.nextStanding("good", 0, 1.999, 2)).toEqual({ status: "good", count: 0 }); // rounds to 2.00
  });

  test("below the minimum: 0 -> probation 1, 1 -> probation 2, 2 -> dropped (5.5.1, 5.5.3)", () => {
    expect(s.nextStanding("good", 0, 1.8, 2)).toEqual({ status: "probation_1", count: 1 });
    expect(s.nextStanding("probation_1", 1, 1.9, 3)).toEqual({ status: "probation_2", count: 2 });
    expect(s.nextStanding("probation_2", 2, 1.95, 4)).toEqual({ status: "dropped", count: 2 });
  });

  test("raising the CGPA to the minimum takes the student off probation and resets the count (5.5.4)", () => {
    expect(s.nextStanding("probation_1", 1, 2.1, 3)).toEqual({ status: "good", count: 0 });
    expect(s.nextStanding("probation_2", 2, 2.0, 4)).toEqual({ status: "good", count: 0 });
    // and a later low term starts again at probation 1, not 3
    expect(s.nextStanding("good", 0, 1.7, 5)).toEqual({ status: "probation_1", count: 1 });
  });

  test("dropped is final", () => {
    expect(s.nextStanding("dropped", 2, 3.5, 5)).toEqual({ status: "dropped", count: 2 });
  });

  test("programme minimum: an MS student at 2.3 is on probation, a BS student is not; PhD needs 3.0", () => {
    expect(s.nextStanding("good", 0, 2.3, 2, { programme: "MS" })).toEqual({ status: "probation_1", count: 1 });
    expect(s.nextStanding("good", 0, 2.3, 2, { programme: "BS" })).toEqual({ status: "good", count: 0 });
    expect(s.nextStanding("good", 0, 2.9, 2, { programme: "PhD" })).toEqual({ status: "probation_1", count: 1 });
  });
});

describe("gradeUsed: first semester GPA, later CGPA (1.1.25)", () => {
  test("semester 1 uses the GPA", () => {
    expect(s.gradeUsed(1, 1.6, 2.4)).toBe(1.6);
    expect(s.nextStanding("not_evaluated", 0, s.gradeUsed(1, 1.6, 2.4), 1)).toEqual({ status: "probation_1", count: 1 });
  });
  test("later semesters use the CGPA", () => {
    expect(s.gradeUsed(2, 1.6, 2.4)).toBe(2.4);
    expect(s.nextStanding("good", 0, s.gradeUsed(2, 1.6, 2.4), 2)).toEqual({ status: "good", count: 0 });
  });
});

describe("seedStatus (starting status for demo:reset)", () => {
  test("semester 1 -> not evaluated", () => {
    expect(s.seedStatus({ semester: 1, cgpa: 1.2, consecutiveLow: true })).toEqual({ status: "not_evaluated", count: 0 });
  });
  test("CGPA >= 2.00 -> good", () => {
    expect(s.seedStatus({ semester: 4, cgpa: 2.0, consecutiveLow: false })).toEqual({ status: "good", count: 0 });
  });
  test("below 2.00 -> Probation 1, never Probation 2 (Phase 7.1 Bug 5: the seed can't prove two probations)", () => {
    expect(s.seedStatus({ semester: 4, cgpa: 1.7, consecutiveLow: true })).toEqual({ status: "probation_1", count: 1 });
    expect(s.seedStatus({ semester: 4, cgpa: 1.7, consecutiveLow: false })).toEqual({ status: "probation_1", count: 1 });
    expect(s.seedStatus({ semester: 8, cgpa: 0.5, consecutiveLow: true })).toEqual({ status: "probation_1", count: 1 });
  });
  test("labels for the screens", () => {
    expect(s.LABELS).toMatchObject({ good: "Good standing", probation_1: "Probation 1 of 2", probation_2: "Probation 2 of 2" });
  });
});

describe("seeded data (after demo:reset)", () => {
  test("Bug 5: no seeded Probation 2 rows, and the first close (Fall 2026 preview) drops nobody", async () => {
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM academic_standing WHERE source = 'seed' AND status IN ('probation_2', 'dropped')");
    expect(rows[0].n).toBe(0);
    const { preview } = require("../src/services/semesterClose");
    const p = await preview("Fall 2026");
    expect(p.total).toBeGreaterThan(0);
    expect(p.counts.dropped).toBe(0);
  });

  test("students.academic_status / probation_count match each student's latest standing row", async () => {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM students s
       JOIN LATERAL (SELECT status, probation_count FROM academic_standing a WHERE a.student_id = s.student_id ORDER BY a.id DESC LIMIT 1) a ON TRUE
       WHERE a.status <> s.academic_status OR a.probation_count <> s.probation_count`
    );
    expect(rows[0].n).toBe(0);
  });

  test("seeded rows follow the seed rule and seeded students have no warning letters", async () => {
    const { rows } = await pool.query(
      `SELECT a.status, a.probation_count, sp.semester, sp.cgpa, sp.consecutive_low_cgpa, d.code
       FROM academic_standing a JOIN students s ON s.student_id = a.student_id
       JOIN departments d ON d.department_id = s.department_id
       JOIN LATERAL (SELECT semester, cgpa, consecutive_low_cgpa FROM student_semester_performance p
                     WHERE p.student_id = a.student_id ORDER BY semester DESC LIMIT 1) sp ON TRUE
       WHERE a.source = 'seed' ORDER BY random() LIMIT 2000`
    );
    expect(rows.length).toBeGreaterThan(0); // demo:reset seeds every student
    for (const r of rows) {
      const want = s.seedStatus({ semester: r.semester, cgpa: Number(r.cgpa), consecutiveLow: r.consecutive_low_cgpa > 0, programme: s.programmeFor(r.code) });
      expect({ status: r.status, count: r.probation_count }).toEqual(want);
    }
    const letters = await pool.query(
      "SELECT COUNT(*)::int AS n FROM warning_letters w JOIN academic_standing a ON a.id = w.standing_id WHERE a.source = 'seed'"
    );
    expect(letters.rows[0].n).toBe(0);
  });
});
