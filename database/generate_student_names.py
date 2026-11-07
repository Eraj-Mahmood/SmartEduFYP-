"""
Replaces the placeholder "Student 12345" names (created by import_dataset.py,
since the CSV has no real names) with realistic randomly-generated full names,
matched to each student's stored gender where possible.

DETERMINISTIC: names come from random.Random(--seed) (default 2026) in student_id order, so the
same database gets the same names on every run. It overwrites every student's full_name (live
cohort students too, so run it before importing a cohort, as `npm run demo:reset` does).

Usage:
    python -m pip install -r database/requirements.txt
    python generate_student_names.py --dsn "postgresql://postgres:PASSWORD@localhost:5432/smartedu" [--seed 2026]
"""
import argparse
import random

import psycopg2
import psycopg2.extras as extras

MALE_FIRST = [
    "Ahmed", "Ali", "Hassan", "Hamza", "Bilal", "Usman", "Omar", "Zain", "Faisal", "Kashif",
    "Danish", "Saad", "Talha", "Waleed", "Fahad", "Imran", "Shahzad", "Adeel", "Rizwan", "Junaid",
    "Nabeel", "Asad", "Kamran", "Naveed", "Salman", "Yasir", "Sohail", "Tariq", "Arslan", "Haris",
]
FEMALE_FIRST = [
    "Ayesha", "Sana", "Hira", "Fatima", "Mahnoor", "Zainab", "Amna", "Rabia", "Maria", "Iqra",
    "Sadia", "Nida", "Warda", "Komal", "Sundas", "Anum", "Farah", "Bushra", "Saba", "Mehwish",
    "Sidra", "Rimsha", "Aiman", "Laiba", "Noor", "Aliya", "Samina", "Tahira", "Sobia", "Uzma",
]
LAST_NAMES = [
    "Khan", "Ahmed", "Malik", "Raza", "Iqbal", "Siddiqui", "Farooq", "Sheikh", "Butt", "Chaudhry",
    "Abbasi", "Qureshi", "Mirza", "Baig", "Hashmi", "Rehman", "Aziz", "Javed", "Tariq", "Akhtar",
    "Riaz", "Shah", "Naqvi", "Zaidi", "Awan", "Gill", "Bhatti", "Cheema", "Dar", "Warraich",
]


DEFAULT_SEED = 2026


def random_name(rng, gender):
    first_pool = MALE_FIRST if gender == "Male" else FEMALE_FIRST if gender == "Female" else MALE_FIRST + FEMALE_FIRST
    return f"{rng.choice(first_pool)} {rng.choice(LAST_NAMES)}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dsn", required=True)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    args = parser.parse_args()
    rng = random.Random(args.seed)

    conn = psycopg2.connect(args.dsn)
    cur = conn.cursor()

    cur.execute("SELECT student_id, gender FROM students ORDER BY student_id")
    students = cur.fetchall()
    print(f"Generating names for {len(students)} students...")

    updates = [(sid, random_name(rng, gender)) for sid, gender in students]

    extras.execute_values(
        cur,
        """UPDATE students AS s SET full_name = v.new_name
           FROM (VALUES %s) AS v(student_id, new_name)
           WHERE s.student_id = v.student_id""",
        updates,
        template="(%s, %s)",
    )
    conn.commit()

    cur.execute("SELECT roll_no, full_name FROM students ORDER BY student_id LIMIT 5")
    print("Sample of updated names:")
    for roll_no, name in cur.fetchall():
        print(f"  {roll_no}: {name}")

    cur.close()
    conn.close()
    print("Done.")


if __name__ == "__main__":
    main()
