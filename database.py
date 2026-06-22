"""
database.py
-------------
Creates and manages the SQLite database for ApprenticeTrack.

Tables:
1. users     -> stores signup/login credentials (admin/mentor accounts)
2. students  -> stores apprenticeship period + attendance data per student
"""

import sqlite3
import os

DB_NAME = os.path.join(os.path.dirname(__file__), "apprenticetrack.db")


def get_connection():
    """Returns a connection to the SQLite database with foreign keys enabled."""
    conn = sqlite3.connect(DB_NAME)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row  # lets us access columns by name
    return conn


def init_db():
    """Creates all required tables if they don't already exist."""
    conn = get_connection()
    cur = conn.cursor()

    # ---------- USERS TABLE (signup/login) ----------
    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name     TEXT NOT NULL,
            email         TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # ---------- STUDENTS TABLE (apprenticeship records) ----------
    cur.execute("""
        CREATE TABLE IF NOT EXISTS students (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_id     INTEGER NOT NULL,           -- which user/mentor added this student
            name         TEXT NOT NULL,
            department   TEXT NOT NULL,
            start_date   DATE NOT NULL,
            end_date     DATE NOT NULL,
            present_days INTEGER NOT NULL DEFAULT 0,
            absent_days  INTEGER NOT NULL DEFAULT 0,
            leave_days   INTEGER NOT NULL DEFAULT 0,
            total_days   INTEGER NOT NULL DEFAULT 0,
            color        TEXT DEFAULT '#0EA5E9',
            created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)

    # ---------- PUNCHES TABLE (daily punch-in / punch-out log) ----------
    cur.execute("""
        CREATE TABLE IF NOT EXISTS punches (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id   INTEGER NOT NULL,
            punch_date   DATE NOT NULL,               -- the calendar day this punch belongs to
            punch_in     TIME,                         -- HH:MM:SS, null if not punched in yet
            punch_out    TIME,                         -- HH:MM:SS, null if not punched out yet
            created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
            UNIQUE (student_id, punch_date)             -- one punch record per student per day
        )
    """)

    conn.commit()
    conn.close()
    print(f"Database ready at: {DB_NAME}")


if __name__ == "__main__":
    init_db()