import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyArrowPatch, Rectangle
import matplotlib.font_manager as fm

NAVY = "#2F5D8A"
NAVY_DARK = "#1F3E5C"
INK = "#101826"
GREY = "#555555"
PAPER = "#F6F4EF"


def draw_sequence(participants, messages, title, outfile, fig_width=11, top=9.3, lane_height=0.55):
    """
    participants: list of labels (left to right)
    messages: list of dicts: {from, to, text, kind: 'sync'|'return'|'self', note?}
      from/to are indices into participants
    """
    n = len(participants)
    fig_height = top - (len(messages) * lane_height) - 1.2
    fig_height = max(4, top - len(messages) * lane_height + 1.5)

    fig, ax = plt.subplots(figsize=(fig_width, fig_height))
    ax.set_xlim(-0.5, n - 0.5)
    header_y = top
    bottom_y = top - len(messages) * lane_height - 0.8
    ax.set_ylim(bottom_y - 0.3, header_y + 0.9)
    ax.axis("off")

    xs = list(range(n))

    # --- Participant headers (boxes) ---
    for x, label in zip(xs, participants):
        box_w = 1.6
        rect = Rectangle((x - box_w / 2, header_y - 0.35), box_w, 0.7,
                          facecolor=NAVY, edgecolor=NAVY_DARK, linewidth=1.2, zorder=3,
                          transform=ax.transData)
        ax.add_patch(rect)
        ax.text(x, header_y, label, ha="center", va="center", color="white",
                 fontsize=10.5, fontweight="bold", zorder=4, wrap=True)

    # --- Lifelines (dashed vertical) ---
    for x in xs:
        ax.plot([x, x], [header_y - 0.35, bottom_y + 0.3], linestyle=(0, (4, 3)),
                 color="#B5B0A4", linewidth=1.3, zorder=1)

    # --- Messages ---
    y = header_y - 0.9
    for m in messages:
        fx, tx = m["from"], m["to"]
        style = m.get("kind", "sync")
        color = INK if style != "return" else "#7A5A2A"
        ls = "-" if style != "return" else "--"

        if fx == tx:
            # self-message (loop)
            loop_w = 0.55
            ax.plot([fx, fx + loop_w], [y, y], color=color, linewidth=1.3, linestyle=ls, zorder=2)
            ax.plot([fx + loop_w, fx + loop_w], [y, y - 0.22], color=color, linewidth=1.3, linestyle=ls, zorder=2)
            arrow = FancyArrowPatch((fx + loop_w, y - 0.22), (fx + 0.05, y - 0.22),
                                     arrowstyle="-|>", mutation_scale=12, color=color,
                                     linewidth=1.3, zorder=2)
            ax.add_patch(arrow)
            ax.text(fx + 0.12, y + 0.12, m["text"], ha="left", va="bottom", fontsize=8.6, color=INK, zorder=4)
            y -= (lane_height + 0.15)
        else:
            arrow = FancyArrowPatch((fx, y), (tx, y), arrowstyle="-|>", mutation_scale=14,
                                     color=color, linewidth=1.4, linestyle=ls,
                                     connectionstyle="arc3,rad=0.0", zorder=2)
            ax.add_patch(arrow)
            mid = (fx + tx) / 2
            ax.text(mid, y + 0.08, m["text"], ha="center", va="bottom", fontsize=8.6,
                     color=INK, zorder=4,
                     bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none", alpha=0.85))
            y -= lane_height

    # --- Activation bars (thin rectangles) on the lifeline of the responder ---
    # (kept simple/omitted for legibility given diagram density)

    ax.text((n - 1) / 2, header_y + 0.75, title, ha="center", va="bottom",
             fontsize=13, fontweight="bold", color=NAVY_DARK, family="serif")

    plt.tight_layout()
    plt.savefig(outfile, dpi=170, facecolor="white", bbox_inches="tight")
    plt.close()
    print("saved", outfile)


# ============================================================
# Diagram 1: Login & Role-Based Verification
# ============================================================
participants_1 = ["User\n(Student/Faculty/Admin)", "React\nFrontend", "Express API\n(auth routes)", "PostgreSQL"]
messages_1 = [
    {"from": 0, "to": 1, "text": "1: enter email + password, submit"},
    {"from": 1, "to": 2, "text": "2: POST /api/auth/login"},
    {"from": 2, "to": 3, "text": "3: SELECT user WHERE email = ?"},
    {"from": 3, "to": 2, "text": "4: user row (password_hash, role)", "kind": "return"},
    {"from": 2, "to": 2, "text": "5: bcrypt.compare() +\n   sign JWT { userId, role }"},
    {"from": 2, "to": 1, "text": "6: 200 OK  { token, role, profile }", "kind": "return"},
    {"from": 1, "to": 0, "text": "7: store token; redirect to\n   /student, /faculty, or /admin", "kind": "return"},
]
draw_sequence(participants_1, messages_1,
              "Sequence Diagram — Login & Role-Based Verification",
              "/home/claude/smartedu/erd/sequence_login.png")

# ============================================================
# Diagram 2: Helper Bot — Student Requests Performance Prediction
# ============================================================
participants_2 = ["Student", "React\nFrontend", "Express API\n(student routes)", "PostgreSQL", "ML Service\n(FastAPI + Random Forest)"]
messages_2 = [
    {"from": 0, "to": 1, "text": "1: click \"Predict my outcome\""},
    {"from": 1, "to": 2, "text": "2: POST /api/student/prediction/refresh"},
    {"from": 2, "to": 3, "text": "3: SELECT latest\n   student_semester_performance"},
    {"from": 3, "to": 2, "text": "4: feature row", "kind": "return"},
    {"from": 2, "to": 4, "text": "5: POST /predict { features }"},
    {"from": 4, "to": 4, "text": "6: preprocess + Random Forest\n   .predict_proba()"},
    {"from": 4, "to": 2, "text": "7: { label, prob_safe, prob_at_risk,\n   prob_dropout }", "kind": "return"},
    {"from": 2, "to": 3, "text": "8: INSERT INTO predictions"},
    {"from": 2, "to": 1, "text": "9: 200 OK  { predicted_label, probabilities }", "kind": "return"},
    {"from": 1, "to": 0, "text": "10: render risk badge + probabilities", "kind": "return"},
]
draw_sequence(participants_2, messages_2,
              "Sequence Diagram — Helper Bot Performance Prediction",
              "/home/claude/smartedu/erd/sequence_prediction.png",
              fig_width=13)
