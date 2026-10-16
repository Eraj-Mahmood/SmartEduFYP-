-- "Ask SmartEdu" chat history: one row per message, scoped to the student.
-- source says who wrote an assistant reply: the Layer 1 templates, the optional LLM, or the
-- Layer 1 fallback used when the LLM failed. It is NULL for the student's own messages.
CREATE TABLE chat_messages (
    id          SERIAL PRIMARY KEY,
    student_id  INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    role        VARCHAR(10) NOT NULL CHECK (role IN ('user', 'assistant')),
    content     TEXT NOT NULL,
    intent      VARCHAR(40),
    source      VARCHAR(10) CHECK (source IN ('template', 'llm', 'fallback')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_messages_student_created ON chat_messages (student_id, created_at);
