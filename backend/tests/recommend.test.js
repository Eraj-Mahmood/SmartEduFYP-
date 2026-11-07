const request = require("supertest");
const app = require("../src/app");
const { recommendFor, pickRecommendation } = require("../src/services/tutorials");
const { getNextSteps } = require("../src/services/nextSteps");
const { login, studentId, pool } = require("./helpers");

// Tutorial recommender (FR11) on the demo students (docs/DEMO_ACCOUNTS.md).

afterAll(() => pool.end());

describe("recommendFor on demo students", () => {
  test.each([
    ["BU-144766", "AI401"], // Dropout-Likely, weakest AI401 (57, 50% attendance)
    ["BU-122785", "AI402"], // At-Risk, weakest AI402 (66)
  ])("%s gets an active tutorial for %s, the course its next steps name", async (roll, code) => {
    const id = await studentId(roll);
    const rec = await recommendFor(id);
    expect(rec.course.course_code).toBe(code);
    expect(rec.tutorial).toEqual(expect.objectContaining({ url: expect.stringMatching(/^https?:\/\//) }));
    expect(rec.reason).toMatch(new RegExp(`^Your ${code} average is \\d+`));

    const steps = await getNextSteps(id);
    expect(steps.find((s) => s.id === "weakest_course").detail.course_code).toBe(code);
    const tut = steps.find((s) => s.id === "tutorial");
    expect(tut.detail).toMatchObject({ course_code: code, url: rec.tutorial.url });

    const { rows } = await pool.query("SELECT is_active FROM tutorials WHERE tutorial_id = $1", [rec.tutorial.tutorial_id]);
    expect(rows[0].is_active).toBe(true);
  });

  test("a Safe student with every course at 70+ gets none", async () => {
    expect(await recommendFor(await studentId("BU-106864"))).toBeNull();
  });

  test("the dashboard carries the recommendation", async () => {
    const token = await login(app, "student144766@smartedu.edu", "student");
    const res = await request(app).get("/api/student/dashboard").set("Authorization", `Bearer ${token}`);
    expect(res.body.recommendation.course.course_code).toBe("AI401");
    expect(res.body.recommendation.tutorial.title).toBeTruthy();
  });
});

describe("pickRecommendation rules", () => {
  const course = (mean, attendance_pct) => ({ course_id: 1, course_code: "X101", title: "X", mean, attendance_pct });
  const tut = new Map([[1, { tutorial_id: 9, title: "T", url: "https://example.com" }]]);
  const pick = (c, label) => pickRecommendation({ weakest: c }, label, tut);

  test("recommends below 70, below 75% attendance or when flagged", () => {
    expect(pick(course(69, 100), "Safe").reason).toBe("Your X101 average is 69 - this covers its core topics");
    expect(pick(course(80, 70), "Safe").reason).toMatch(/attendance is 70%/);
    expect(pick(course(80, 100), "At-Risk").reason).toMatch(/lowest course/);
    expect(pick(course(80, 100), "Safe")).toBeNull();
  });

  test("a course without an active tutorial still comes back, with tutorial null", () => {
    const r = pickRecommendation({ weakest: { ...course(50, 100), course_id: 2 } }, "Safe", tut);
    expect(r.course.course_code).toBe("X101");
    expect(r.tutorial).toBeNull();
  });
});
