import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import client from "../../api/client";
import { PortalShell } from "../../components/Shell";
import { Card, Button, Modal, EmptyState, SkeletonCard, useToast, Icons, buttonClass } from "../../components/ui";
import useApi from "../../lib/useApi";

// Study material per course (FR11): add, edit, deactivate (and switch back on), open the link.
// /admin/tutorials?course=<id> jumps to one course (the Interventions page links here when a
// student's weakest course has no tutorial).

const KINDS = ["video", "notes", "practice"];
const EMPTY = { title: "", url: "", provider: "", kind: "notes", description: "" };

function TutorialForm({ value, onChange }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="field-label">Title</span>
        <input className="field" required maxLength={200} value={value.title} onChange={set("title")} placeholder="e.g. Introduction to Algorithms" />
      </label>
      <label className="block">
        <span className="field-label">Link</span>
        <input className="field" required type="url" maxLength={500} value={value.url} onChange={set("url")} placeholder="https://..." />
        <span className="block text-xs text-muted mt-1">Prefer a stable course or documentation page over a deep link.</span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="field-label">Provider</span>
          <input className="field" maxLength={100} value={value.provider || ""} onChange={set("provider")} placeholder="e.g. MIT OpenCourseWare" />
        </label>
        <label className="block">
          <span className="field-label">Kind</span>
          <select className="field" value={value.kind} onChange={set("kind")}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="field-label">Description</span>
        <textarea className="field" rows={3} maxLength={1000} value={value.description || ""} onChange={set("description")} placeholder="What it covers, in one sentence." />
      </label>
    </div>
  );
}

export default function Tutorials() {
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const courses = useApi("/admin/courses");
  const tutorials = useApi("/admin/tutorials");
  const [courseFilter, setCourseFilter] = useState(params.get("course") || "");
  const [editing, setEditing] = useState(null); // {mode: 'add'|'edit', course, form, id?}
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const byCourse = useMemo(() => {
    const m = new Map();
    (tutorials.data || []).forEach((t) => m.set(t.course_id, [...(m.get(t.course_id) || []), t]));
    return m;
  }, [tutorials.data]);

  const shown = (courses.data || []).filter((c) => !courseFilter || String(c.course_id) === String(courseFilter));
  const missing = (courses.data || []).filter((c) => !(byCourse.get(c.course_id) || []).some((t) => t.is_active));

  // arriving from "none - add one": open the add form for that course straight away
  useEffect(() => {
    const id = params.get("course");
    if (!id || !courses.data || !tutorials.data) return;
    const course = courses.data.find((c) => String(c.course_id) === id);
    if (course && !(byCourse.get(course.course_id) || []).some((t) => t.is_active)) {
      setEditing({ mode: "add", course, form: { ...EMPTY } });
    }
    // only once per arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courses.data, tutorials.data]);

  function chooseCourse(v) {
    setCourseFilter(v);
    if (v) setParams({ course: v }, { replace: true });
    else setParams({}, { replace: true });
  }

  async function save() {
    setSaving(true);
    try {
      const body = { ...editing.form, provider: editing.form.provider || null, description: editing.form.description || null };
      if (editing.mode === "add") {
        await client.post("/admin/tutorials", { ...body, course_id: editing.course.course_id });
        toast(`Added to ${editing.course.course_code}`, { type: "success", title: "Tutorial added" });
      } else {
        await client.put(`/admin/tutorials/${editing.id}`, body);
        toast("Changes saved", { type: "success" });
      }
      setEditing(null);
      tutorials.reload({ quiet: true });
    } catch (e) {
      toast(e.response?.data?.error || "Could not save the tutorial", { type: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function setActive(t, active) {
    setBusyId(t.tutorial_id);
    try {
      if (active) await client.put(`/admin/tutorials/${t.tutorial_id}`, { is_active: true });
      else await client.put(`/admin/tutorials/${t.tutorial_id}/deactivate`);
      toast(`${t.title} ${active ? "switched on" : "deactivated"}`, { type: active ? "success" : "info" });
      tutorials.reload({ quiet: true });
    } catch (e) {
      toast(e.response?.data?.error || "Could not update the tutorial", { type: "error" });
    } finally {
      setBusyId(null);
    }
  }

  const loading = (courses.loading && !courses.data) || (tutorials.loading && !tutorials.data);
  const formOk = editing && editing.form.title.trim() && /^https?:\/\/\S+$/.test(editing.form.url.trim());

  return (
    <PortalShell>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl sm:text-[28px] mb-1">Tutorials</h1>
          <p className="text-muted text-sm max-w-2xl">
            Study material recommended to students for their weakest course. The first active tutorial of a course is the one students see.
          </p>
        </div>
        <label className="sm:w-72">
          <span className="sr-only">Course</span>
          <select className="field" value={courseFilter} onChange={(e) => chooseCourse(e.target.value)}>
            <option value="">All courses ({(courses.data || []).length})</option>
            {(courses.data || []).map((c) => (
              <option key={c.course_id} value={c.course_id}>
                {c.course_code} · {c.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!loading && missing.length > 0 && (
        <p className="mb-4 rounded-lg border border-risk/30 bg-risk-50 px-4 py-2.5 text-sm">
          <strong>{missing.length}</strong> course{missing.length === 1 ? " has" : "s have"} no active tutorial: {missing.map((c) => c.course_code).join(", ")}.
        </p>
      )}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : courses.error || tutorials.error ? (
        <Card>
          <EmptyState icon={<Icons.AlertOctagon size={22} />} message="We couldn't load the tutorials" detail={courses.error || tutorials.error} />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {shown.map((c) => {
            const list = byCourse.get(c.course_id) || [];
            return (
              <Card
                key={c.course_id}
                title={
                  <>
                    <span className="font-mono text-sm text-muted mr-2">{c.course_code}</span>
                    {c.title}
                  </>
                }
                subtitle={c.department}
                actions={
                  <Button size="sm" variant="secondary" icon={<Icons.Plus size={14} />} onClick={() => setEditing({ mode: "add", course: c, form: { ...EMPTY } })}>
                    Add
                  </Button>
                }
              >
                {list.length === 0 ? (
                  <p className="text-sm text-risk-700">No tutorials yet.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {list.map((t) => (
                      <li key={t.tutorial_id} className={`py-3 first:pt-0 last:pb-0 ${t.is_active ? "" : "opacity-60"}`}>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-ink break-words">{t.title}</p>
                            <p className="text-xs text-muted mt-0.5">
                              {t.provider || "Unknown provider"} · <span className="uppercase tracking-wide">{t.kind}</span>
                              {!t.is_active && <span className="ml-2 rounded bg-ink/10 px-1.5 py-0.5 text-[11px] text-ink">inactive</span>}
                            </p>
                            {t.description && <p className="text-xs text-muted mt-1">{t.description}</p>}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            <a href={t.url} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")} title={t.url}>
                              <Icons.External size={14} /> Open link
                              <span className="sr-only"> (opens in a new tab)</span>
                            </a>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditing({ mode: "edit", id: t.tutorial_id, course: c, form: { title: t.title, url: t.url, provider: t.provider || "", kind: t.kind, description: t.description || "" } })}
                            >
                              Edit
                            </Button>
                            <Button size="sm" variant="ghost" loading={busyId === t.tutorial_id} onClick={() => setActive(t, !t.is_active)}>
                              {t.is_active ? "Deactivate" : "Switch on"}
                            </Button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.mode === "edit" ? "Edit tutorial" : "Add tutorial"}
        subtitle={editing && `${editing.course.course_code} · ${editing.course.title}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving} disabled={!formOk}>
              {editing?.mode === "edit" ? "Save" : "Add tutorial"}
            </Button>
          </>
        }
      >
        {editing && <TutorialForm value={editing.form} onChange={(form) => setEditing((e) => ({ ...e, form }))} />}
      </Modal>
    </PortalShell>
  );
}
