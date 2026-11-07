# Live data: the cohort file and the faculty upload files

SmartEdu keeps **synthetic** data (the 50,000-student dataset the model was trained on) apart from
**live** data (`data_source = 'live'`): marks and attendance typed in or uploaded by faculty, and
students imported as a live cohort. Live rows are what Objective 7 evaluates the model on
(`evaluation/live_eval.py`).

> **Privacy:** a live cohort is real student data. Get the institution's approval and the students'
> consent first, import only what the model needs, and do not send it to the free Gemini tier (Google
> may use free-tier prompts to improve its products) - switch chat Layer 2 off or use a paid key.

## 1. Live cohort (admin)

Admin → Overview → Data sources → **Import a live cohort** (`/admin/live-cohort`), or
`POST /api/admin/live-cohort?mode=preview|commit` with the file and `courseId`, `facultyId`, `section`.
Template: `GET /api/admin/live-cohort/template.csv` (header only). One row per student; `preview`
checks every row and saves nothing, `commit` saves the valid rows.

Each valid row creates: a login (`live.<roll no>@smartedu.edu`, a random password nobody sees,
`must_reset_pw`), a student (`data_source='live'`), an enrollment in the live class section (created
if needed, taught by the chosen faculty member), and one academic record
(`student_semester_performance`, `data_source='live'`, `target_label` left empty).
Predictions are not made at import: run them for the class (the page's "Run predictions for this
class" button, or Overview → Run predictions → Class).

### Required columns

A required column must be in the header; a cell may be empty (the model fills it, see below), except
roll_no, full_name, department and semester.

| column | meaning | allowed values | model feature |
|---|---|---|---|
| `roll_no` | the student's roll number | letters, digits, dashes; 3-30 characters; must not already exist in SmartEdu; once per file | — |
| `full_name` | student name | up to 150 characters | — |
| `department` | department | `CS`, `SE`, `EE`, `AI`, `Business` (code or full name) | Department |
| `semester` | current semester | whole number 1-12 | Semester |
| `cgpa` | official CGPA up to last term | 0-4 | CGPA |
| `previous_sgpa` | last term's SGPA | 0-4 | Previous_SGPA |
| `attendance` | attendance % this term so far | 0-100 | Attendance_Percentage |
| `assignment` | assignment average this term | 0-100 | Assignment_Avg |
| `quiz` | quiz average this term | 0-100 | Quiz_Avg |
| `midterm` | midterm mark | 0-100 | Midterm_Marks |
| `final` | final exam mark (or the latest estimate) | 0-100 | Final_Marks |
| `failed_courses` | courses failed so far | whole number 0-30 | Failed_Courses |
| `credits` | credits enrolled this term | whole number 1-40 | Credits_Enrolled |

### Optional columns

| column | meaning | allowed values | model feature |
|---|---|---|---|
| `actual_outcome` | what really happened, from institutional records (for the evaluation only - the model never sees it) | `safe`, `at_risk`, `dropout`, `unknown` (also `at-risk`, `dropout-likely`); empty = not known | — |
| `gender` | | `male` / `female` (`m` / `f`) | Gender |
| `age` | | whole number 14-80 | Age |
| `study_hours` | self-reported study hours per week | 0-100 | Study_Hours_Per_Week |
| `lms_logins` | LMS logins this term | whole number | LMS_Login_Count |
| `submission_rate` | % of assignments submitted | 0-100 | Assignment_Submission_Rate |
| `scholarship` | | `yes` / `no` | Scholarship |
| `hostel` | | `yes` / `no` | Hostel |

### Derived and missing values

- **SGPA** = 2 × CGPA − Previous_SGPA, clamped to 0-4 (the dataset identity CGPA ≈ (Previous_SGPA + SGPA) / 2, R² 0.992).
- **Credits_Passed** = credits − 3 × failed_courses, at least 0 (true for 100% of dataset rows).
- **Missing values stay empty (NULL).** The model's own pipeline fills them: numbers with the training
  data's median, categories (gender, scholarship, hostel) with the most frequent value. The preview and
  the import report list every missing feature and how many students miss it. The policy rules never
  fire on a missing value, and the reasons never mention one.
- Later faculty uploads override the imported values the same way as for every student: live
  attendance replaces Attendance_Percentage; live marks replace the four marks and recompute
  provisional SGPA and projected CGPA.

### Errors

Each bad row is rejected on its own with the row number (the header is row 1), the column and a
message; good rows are still imported. Typical errors: unknown department, a roll number that already
exists or appears twice, a number out of range, an outcome that isn't one of the four values. Limits:
`.csv` only, ≤ 2 MB, ≤ 2,000 rows.

### Undo

`cd backend; node src/scripts/removeLiveCohort.js` lists committed imports;
`node src/scripts/removeLiveCohort.js <id>` deletes the students that import created (their marks,
attendance and predictions go with them) and its class section if the import created it.

## 2. Faculty uploads (results and attendance)

Class page → **Upload** tab, or `POST /api/faculty/classes/:id/upload?kind=results|attendance&mode=preview|commit`.
The templates (`templates/results.csv`, `templates/attendance.csv`) already list the class roster.

| file | columns | rules |
|---|---|---|
| results | `roll_no`, `name` (ignored), `assignment_avg`, `quiz_avg`, `midterm_marks`, `final_marks` | marks 0-100; an empty cell keeps the saved mark; a row with no marks is skipped; one row per student; the grade is derived on the server |
| attendance | `roll_no`, `name` (ignored), `class_date`, `status` | `class_date` a real date `YYYY-MM-DD`, not in the future; `status` `present`, `absent` or `leave`; one row per student per date; a row with no status is skipped |

In both: the roll number must be enrolled in that class and not dropped. Saved rows are tagged
`data_source='live'` with the upload's id; the affected students are re-predicted at once.

## 3. The synthetic stand-in

There is no real cohort file yet. `evaluation/sample_live_cohort.csv` (made by
`evaluation/make_sample_live_cohort.py`) holds 30 students drawn from the synthetic dataset, 10 per
label, in the cohort format. It is **SYNTHETIC**: roll numbers start with `SYN-`, names are
"Synthetic Sample NN", and `actual_outcome` is the dataset's policy-derived label. The model's train/test
split was not saved, so these rows were probably seen in training. Every output built from it says so.
