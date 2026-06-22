"""
app.py
-------------
Flask backend for ApprenticeTrack.

Routes:
  Pages:
    GET  /                 -> redirects to login or dashboard
    GET  /signup            -> signup page
    GET  /login              -> login page
    GET  /dashboard         -> dashboard page (protected)
    GET  /logout             -> logs out current user

  API (JSON):
    POST /api/signup         -> create new user account
    POST /api/login          -> authenticate user, start session
    GET  /api/students       -> get all students belonging to logged-in user
    POST /api/students       -> add a new student
    PUT  /api/students/<id>  -> update a student
    DELETE /api/students/<id>-> delete a student
"""

from flask import Flask, request, jsonify, render_template, redirect, url_for, session
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, date
import database as db

app = Flask(__name__)
app.secret_key = "change-this-secret-key-before-deploying"  # used to sign session cookies

# Make sure DB + tables exist before the app starts handling requests
db.init_db()


# ───────────────────────────────────────────────
# Helper functions
# ───────────────────────────────────────────────

def login_required(view_func):
    """Simple decorator to protect routes that need a logged-in user."""
    from functools import wraps

    @wraps(view_func)
    def wrapped(*args, **kwargs):
        if "user_id" not in session:
            # If it's an API call, return JSON error; otherwise redirect to login
            if request.path.startswith("/api/"):
                return jsonify({"error": "Not authenticated"}), 401
            return redirect(url_for("login_page"))
        return view_func(*args, **kwargs)

    return wrapped


def calculate_days(start_date_str, end_date_str):
    """Returns total number of days between two ISO date strings."""
    start = datetime.strptime(start_date_str, "%Y-%m-%d").date()
    end = datetime.strptime(end_date_str, "%Y-%m-%d").date()
    return (end - start).days


def student_row_to_dict(row):
    """Converts a sqlite3.Row for a student into a plain dict for JSON output."""
    return {
        "id": row["id"],
        "name": row["name"],
        "department": row["department"],
        "start": row["start_date"],
        "end": row["end_date"],
        "present": row["present_days"],
        "absent": row["absent_days"],
        "leave": row["leave_days"],
        "totalDays": row["total_days"],
        "color": row["color"],
    }


# ───────────────────────────────────────────────
# PAGE ROUTES
# ───────────────────────────────────────────────

@app.route("/")
def home():
    if "user_id" in session:
        return redirect(url_for("dashboard_page"))
    return redirect(url_for("login_page"))


@app.route("/signup")
def signup_page():
    if "user_id" in session:
        return redirect(url_for("dashboard_page"))
    return render_template("signup.html")


@app.route("/login")
def login_page():
    if "user_id" in session:
        return redirect(url_for("dashboard_page"))
    return render_template("login.html")


@app.route("/dashboard")
@login_required
def dashboard_page():
    return render_template("dashboard.html", user_name=session.get("user_name"))


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login_page"))


# ───────────────────────────────────────────────
# AUTH API
# ───────────────────────────────────────────────

@app.route("/api/signup", methods=["POST"])
def api_signup():
    data = request.get_json(force=True)
    full_name = (data.get("full_name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not full_name or not email or not password:
        return jsonify({"error": "All fields are required."}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters."}), 400

    conn = db.get_connection()
    cur = conn.cursor()

    # Check if email already registered
    cur.execute("SELECT id FROM users WHERE email = ?", (email,))
    if cur.fetchone():
        conn.close()
        return jsonify({"error": "An account with this email already exists."}), 409

    password_hash = generate_password_hash(password)
    cur.execute(
        "INSERT INTO users (full_name, email, password_hash) VALUES (?, ?, ?)",
        (full_name, email, password_hash),
    )
    conn.commit()
    new_user_id = cur.lastrowid
    conn.close()

    # Auto-login after signup
    session["user_id"] = new_user_id
    session["user_name"] = full_name

    return jsonify({"message": "Account created successfully.", "redirect": "/dashboard"}), 201


@app.route("/api/login", methods=["POST"])
def api_login():
    data = request.get_json(force=True)
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not email or not password:
        return jsonify({"error": "Email and password are required."}), 400

    conn = db.get_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM users WHERE email = ?", (email,))
    user = cur.fetchone()
    conn.close()

    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid email or password."}), 401

    session["user_id"] = user["id"]
    session["user_name"] = user["full_name"]

    return jsonify({"message": "Login successful.", "redirect": "/dashboard"}), 200


# ───────────────────────────────────────────────
# STUDENTS API  (all scoped to logged-in user)
# ───────────────────────────────────────────────

@app.route("/api/students", methods=["GET"])
@login_required
def get_students():
    conn = db.get_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT * FROM students WHERE owner_id = ? ORDER BY created_at DESC",
        (session["user_id"],),
    )
    rows = cur.fetchall()
    conn.close()
    return jsonify([student_row_to_dict(r) for r in rows])


@app.route("/api/students", methods=["POST"])
@login_required
def add_student():
    data = request.get_json(force=True)

    name = (data.get("name") or "").strip()
    department = (data.get("department") or "").strip()
    start_date = data.get("start")
    end_date = data.get("end")
    present = int(data.get("present", 0))
    total_days = int(data.get("totalDays", 0))
    color = data.get("color", "#0EA5E9")

    if not name or not department or not start_date or not end_date:
        return jsonify({"error": "Name, department, start and end dates are required."}), 400
    if total_days <= 0:
        return jsonify({"error": "Total working days must be greater than 0."}), 400
    if present > total_days:
        return jsonify({"error": "Present days cannot exceed total working days."}), 400

    absent = max(0, total_days - present)

    conn = db.get_connection()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO students
            (owner_id, name, department, start_date, end_date,
             present_days, absent_days, leave_days, total_days, color)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (session["user_id"], name, department, start_date, end_date,
          present, absent, 0, total_days, color))
    conn.commit()
    new_id = cur.lastrowid
    conn.close()

    return jsonify({"message": "Student added.", "id": new_id}), 201


@app.route("/api/students/<int:student_id>", methods=["PUT"])
@login_required
def update_student(student_id):
    data = request.get_json(force=True)

    conn = db.get_connection()
    cur = conn.cursor()

    # Make sure this student belongs to the logged-in user
    cur.execute("SELECT * FROM students WHERE id = ? AND owner_id = ?",
                (student_id, session["user_id"]))
    existing = cur.fetchone()
    if not existing:
        conn.close()
        return jsonify({"error": "Student not found."}), 404

    name = data.get("name", existing["name"])
    department = data.get("department", existing["department"])
    start_date = data.get("start", existing["start_date"])
    end_date = data.get("end", existing["end_date"])
    present = int(data.get("present", existing["present_days"]))
    total_days = int(data.get("totalDays", existing["total_days"]))
    absent = max(0, total_days - present)

    cur.execute("""
        UPDATE students
        SET name=?, department=?, start_date=?, end_date=?,
            present_days=?, absent_days=?, total_days=?
        WHERE id=? AND owner_id=?
    """, (name, department, start_date, end_date, present, absent,
          total_days, student_id, session["user_id"]))
    conn.commit()
    conn.close()

    return jsonify({"message": "Student updated."})


@app.route("/api/students/<int:student_id>", methods=["DELETE"])
@login_required
def delete_student(student_id):
    conn = db.get_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM students WHERE id = ? AND owner_id = ?",
                (student_id, session["user_id"]))
    conn.commit()
    deleted = cur.rowcount
    conn.close()

    if deleted == 0:
        return jsonify({"error": "Student not found."}), 404
    return jsonify({"message": "Student deleted."})


# ───────────────────────────────────────────────
# PUNCH IN / PUNCH OUT API
# ───────────────────────────────────────────────

@app.route("/api/students/<int:student_id>/punch-status", methods=["GET"])
@login_required
def punch_status(student_id):
    """Returns today's punch record for a student (if any)."""
    today_str = date.today().isoformat()

    conn = db.get_connection()
    cur = conn.cursor()

    # Make sure the student belongs to this user
    cur.execute("SELECT id FROM students WHERE id = ? AND owner_id = ?",
                (student_id, session["user_id"]))
    if not cur.fetchone():
        conn.close()
        return jsonify({"error": "Student not found."}), 404

    cur.execute(
        "SELECT * FROM punches WHERE student_id = ? AND punch_date = ?",
        (student_id, today_str),
    )
    row = cur.fetchone()
    conn.close()

    if not row:
        return jsonify({"punch_in": None, "punch_out": None})

    return jsonify({"punch_in": row["punch_in"], "punch_out": row["punch_out"]})


@app.route("/api/students/<int:student_id>/punch-in", methods=["POST"])
@login_required
def punch_in(student_id):
    """Records punch-in time for today. Fails if already punched in today."""
    today_str = date.today().isoformat()
    now_str = datetime.now().strftime("%H:%M:%S")

    conn = db.get_connection()
    cur = conn.cursor()

    cur.execute("SELECT id FROM students WHERE id = ? AND owner_id = ?",
                (student_id, session["user_id"]))
    if not cur.fetchone():
        conn.close()
        return jsonify({"error": "Student not found."}), 404

    cur.execute(
        "SELECT * FROM punches WHERE student_id = ? AND punch_date = ?",
        (student_id, today_str),
    )
    existing = cur.fetchone()

    if existing and existing["punch_in"]:
        conn.close()
        return jsonify({"error": "Already punched in today."}), 409

    if existing:
        cur.execute(
            "UPDATE punches SET punch_in = ? WHERE id = ?",
            (now_str, existing["id"]),
        )
    else:
        cur.execute(
            "INSERT INTO punches (student_id, punch_date, punch_in) VALUES (?, ?, ?)",
            (student_id, today_str, now_str),
        )

    conn.commit()
    conn.close()
    return jsonify({"message": "Punched in.", "punch_in": now_str})


@app.route("/api/students/<int:student_id>/punch-out", methods=["POST"])
@login_required
def punch_out(student_id):
    """Records punch-out time for today, and marks the day as Present.
    Fails if not punched in yet, or already punched out."""
    today_str = date.today().isoformat()
    now_str = datetime.now().strftime("%H:%M:%S")

    conn = db.get_connection()
    cur = conn.cursor()

    cur.execute("SELECT * FROM students WHERE id = ? AND owner_id = ?",
                (student_id, session["user_id"]))
    student = cur.fetchone()
    if not student:
        conn.close()
        return jsonify({"error": "Student not found."}), 404

    cur.execute(
        "SELECT * FROM punches WHERE student_id = ? AND punch_date = ?",
        (student_id, today_str),
    )
    existing = cur.fetchone()

    if not existing or not existing["punch_in"]:
        conn.close()
        return jsonify({"error": "You must punch in before punching out."}), 400
    if existing["punch_out"]:
        conn.close()
        return jsonify({"error": "Already punched out today."}), 409

    cur.execute(
        "UPDATE punches SET punch_out = ? WHERE id = ?",
        (now_str, existing["id"]),
    )

    # Increment present_days + total_days on the student record for today's attendance
    new_present = student["present_days"] + 1
    new_total = student["total_days"] + 1
    cur.execute(
        "UPDATE students SET present_days = ?, total_days = ? WHERE id = ?",
        (new_present, new_total, student_id),
    )

    conn.commit()
    conn.close()
    return jsonify({"message": "Punched out.", "punch_out": now_str})


# ───────────────────────────────────────────────
# RUN APP
# ───────────────────────────────────────────────

if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=5000)