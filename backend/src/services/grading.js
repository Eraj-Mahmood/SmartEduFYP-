// Course grade from marks. Same weighting and thresholds as database/seed_demo_data.py:
// the four components are weighted equally, then A >= 85, B >= 70, C >= 55, D >= 40, else F.
// The server always derives the grade; any client-sent grade is ignored.

const MARK_FIELDS = ["assignment_avg", "quiz_avg", "midterm_marks", "final_marks"];

const GRADE_THRESHOLDS = [
  ["A", 85],
  ["B", 70],
  ["C", 55],
  ["D", 40],
];

function overallMark(marks) {
  return MARK_FIELDS.reduce((sum, f) => sum + Number(marks[f] || 0), 0) / MARK_FIELDS.length;
}

function deriveGrade(marks) {
  const overall = overallMark(marks);
  for (const [grade, min] of GRADE_THRESHOLDS) if (overall >= min) return grade;
  return "F";
}

module.exports = { MARK_FIELDS, GRADE_THRESHOLDS, overallMark, deriveGrade };
