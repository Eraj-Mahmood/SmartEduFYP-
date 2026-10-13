"""
Replaces the placeholder "Student 12345" names (created by import_dataset.py,
since the CSV has no real names) with realistic randomly-generated full names,
matched to each student's stored gender where possible.

Safe to run once after import_dataset.py. Re-running it will just re-randomize
the names again (harmless, but pointless) - it doesn't check if a name was
already "real", it just overwrites every row.

Usage:
    pip install psycopg2-binary --break-system-packages
    python3 generate_student_names.py --dsn "postgresql://postgres:PASSWORD@localhost:5432/smartedu"
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


def random_name(gender):
    first_pool = MALE_FIRST if gender == "Male" else FEMALE_FIRST if gender == "Female" else MALE_FIRST + FEMALE_FIRST
    return f"{random.choice(first_pool)} {random.choice(LAST_NAMES)}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dsn", required=True)
    args = parser.parse_args()

    conn = psycopg2.connect(args.dsn)
    cur = conn.cursor()

    cur.execute("SELECT student_id, gender FROM students")
    students = cur.fetchall()
    print(f"Generating names for {len(students)} students...")

    updates = [(sid, random_name(gender)) for sid, gender in students]

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
