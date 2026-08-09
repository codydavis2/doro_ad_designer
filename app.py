import json
import os
import sqlite3
import uuid
from datetime import datetime

from flask import Flask, g, jsonify, render_template, request, send_from_directory
from werkzeug.utils import secure_filename

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "static", "uploads")
DB_PATH = os.path.join(BASE_DIR, "designs.db")
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "webp"}

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024  # 8 MB upload cap


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    with sqlite3.connect(DB_PATH) as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS designs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                data TEXT NOT NULL,
                thumbnail TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        db.commit()


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/layouts")
def layouts_page():
    return render_template("layouts.html")


@app.route("/static/uploads/<path:filename>")
def uploaded_file(filename):
    return send_from_directory(UPLOAD_DIR, filename)


@app.route("/api/upload", methods=["POST"])
def upload_image():
    if "image" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["image"]
    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400

    if not allowed_file(file.filename):
        return jsonify({"error": "Unsupported file type. Use PNG, JPG, or WEBP."}), 400

    ext = file.filename.rsplit(".", 1)[1].lower()
    safe_name = f"{uuid.uuid4().hex}.{ext}"
    safe_name = secure_filename(safe_name)
    file.save(os.path.join(UPLOAD_DIR, safe_name))

    return jsonify({"url": f"/static/uploads/{safe_name}"})


@app.route("/api/designs", methods=["GET"])
def list_designs():
    db = get_db()
    rows = db.execute(
        "SELECT id, name, thumbnail, created_at, updated_at FROM designs ORDER BY updated_at DESC"
    ).fetchall()
    return jsonify([dict(row) for row in rows])


@app.route("/api/designs", methods=["POST"])
def create_design():
    payload = request.get_json(force=True, silent=True) or {}
    name = (payload.get("name") or "Untitled Design").strip()[:120]
    data = payload.get("data")
    thumbnail = payload.get("thumbnail")

    if data is None:
        return jsonify({"error": "Missing design data"}), 400

    now = datetime.utcnow().isoformat()
    db = get_db()
    cur = db.execute(
        "INSERT INTO designs (name, data, thumbnail, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        (name, json.dumps(data), thumbnail, now, now),
    )
    db.commit()
    return jsonify({"id": cur.lastrowid})


@app.route("/api/designs/<int:design_id>", methods=["GET"])
def get_design(design_id):
    db = get_db()
    row = db.execute("SELECT * FROM designs WHERE id = ?", (design_id,)).fetchone()
    if row is None:
        return jsonify({"error": "Design not found"}), 404
    result = dict(row)
    result["data"] = json.loads(result["data"])
    return jsonify(result)


@app.route("/api/designs/<int:design_id>", methods=["PUT"])
def update_design(design_id):
    payload = request.get_json(force=True, silent=True) or {}
    name = (payload.get("name") or "Untitled Design").strip()[:120]
    data = payload.get("data")
    thumbnail = payload.get("thumbnail")

    if data is None:
        return jsonify({"error": "Missing design data"}), 400

    db = get_db()
    now = datetime.utcnow().isoformat()
    cur = db.execute(
        "UPDATE designs SET name = ?, data = ?, thumbnail = ?, updated_at = ? WHERE id = ?",
        (name, json.dumps(data), thumbnail, now, design_id),
    )
    db.commit()
    if cur.rowcount == 0:
        return jsonify({"error": "Design not found"}), 404
    return jsonify({"ok": True})


@app.route("/api/designs/<int:design_id>", methods=["DELETE"])
def delete_design(design_id):
    db = get_db()
    cur = db.execute("DELETE FROM designs WHERE id = ?", (design_id,))
    db.commit()
    if cur.rowcount == 0:
        return jsonify({"error": "Design not found"}), 404
    return jsonify({"ok": True})


if __name__ == "__main__":
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    init_db()
    app.run(debug=True, host="0.0.0.0", port=5000)
